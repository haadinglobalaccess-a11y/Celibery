import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { ok } from '../../lib/http';
import { q } from '../../middleware/validate';
import { Category, NewsletterSubscription, Order, Page, Product, Review, getSettings } from '../../models';
import * as svc from './catalog.service';
import { productListQuery } from './catalog.schemas';

export async function categories(_req: Request, res: Response) {
  return ok(res, await svc.listCategories());
}

export async function category(req: Request, res: Response) {
  return ok(res, await svc.getCategory(req.params.slug));
}

export async function products(req: Request, res: Response) {
  const query = q(req, productListQuery);
  const result = await svc.listProducts(query);
  return ok(res, result.items, 200, { total: result.total, page: result.page, pages: result.pages, category: result.category });
}

export async function product(req: Request, res: Response) {
  return ok(res, await svc.getProduct(req.params.slug));
}

export async function collection(req: Request, res: Response) {
  return ok(res, await svc.collectionWithProducts(req.params.slug));
}

export async function home(_req: Request, res: Response) {
  // Admin-managed homepage media must be fresh after a save and page refresh.
  res.set('Cache-Control', 'no-store');
  return ok(res, await svc.homePayload());
}

export async function campaign(req: Request, res: Response) {
  return ok(res, await svc.getCampaign(req.params.slug));
}

export async function settings(_req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  return ok(res, await svc.publicSettings());
}

export async function page(req: Request, res: Response) {
  const p = await Page.findOne({ slug: req.params.slug }).select('slug title body status approvedAt updatedAt').lean();
  if (!p) throw notFound('Page');
  return ok(res, p);
}

export async function newsletter(req: Request, res: Response) {
  await NewsletterSubscription.updateOne({ email: req.body.email }, { $set: { active: true, lang: req.body.lang } }, { upsert: true });
  return ok(res, { subscribed: true }, 201);
}

export async function productReviews(req: Request, res: Response) {
  const s = await getSettings();
  if (!s?.reviews?.enabled) return ok(res, []);
  const p = await Product.findOne({ slug: req.params.slug }).select('_id').lean();
  if (!p) throw notFound('Product');
  const reviews = await Review.find({ product: p._id, status: 'approved' }).select('rating title body displayName lang createdAt').sort({ createdAt: -1 }).limit(50).lean();
  return ok(res, reviews);
}

/** Verified-purchase reviews only: the customer must have a delivered order containing the product. */
export async function submitReview(req: Request, res: Response) {
  const s = await getSettings();
  if (!s?.reviews?.enabled) throw unprocessable('REVIEWS_DISABLED', 'Reviews are not enabled');
  const p = await Product.findOne({ slug: req.params.slug }).select('_id').lean();
  if (!p) throw notFound('Product');
  const order = await Order.findOne({ customer: req.user!.id, status: 'delivered', 'items.product': p._id }).select('_id').lean();
  if (!order) throw unprocessable('NOT_VERIFIED_PURCHASE', 'Only customers who received this product can review it');
  try {
    const r = await Review.create({ ...req.body, product: p._id, customer: req.user!.id, order: order._id, status: 'pending' });
    return ok(res, { id: r._id, status: r.status }, 201);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('ALREADY_REVIEWED', 'You already reviewed this product');
    throw e;
  }
}

/** User agents of AI assistants / AI search crawlers controlled by Admin → Settings → SEO. */
export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Google-Extended', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'anthropic-ai', 'CCBot', 'Applebot-Extended'];

/** robots.txt built from the saved SEO settings (Q37) — replaces the former static file. */
export function robotsTxt(allowAiCrawlers: boolean, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '');
  const privatePaths = ['/admin', '/api/', '/*/checkout', '/*/account'];
  const lines = ['# CELIBERY International', 'User-agent: *', 'Allow: /', ...privatePaths.map((p) => `Disallow: ${p}`), ''];
  for (const bot of AI_CRAWLERS) {
    lines.push(`User-agent: ${bot}`);
    if (allowAiCrawlers) lines.push('Allow: /', ...privatePaths.map((p) => `Disallow: ${p}`));
    else lines.push('Disallow: /');
    lines.push('');
  }
  lines.push(`Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}

export async function robots(_req: Request, res: Response) {
  const settings = await getSettings();
  res.type('text/plain').setHeader('Cache-Control', 'public, max-age=300');
  res.send(robotsTxt(settings?.seo?.allowAiCrawlers !== false, env.PUBLIC_SITE_URL));
}

export async function sitemap(_req: Request, res: Response) {
  const [cats, prods, pages] = await Promise.all([
    Category.find({ active: true }).select('slug updatedAt').lean(),
    Product.find({ status: 'active' }).select('slug updatedAt').lean(),
    Page.find({ status: 'approved' }).select('slug updatedAt').lean(),
  ]);
  const base = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const urls: { path: string; lastmod?: Date }[] = [
    { path: '' },
    { path: '/shop' },
    { path: '/bundles' },
    ...cats.map((c) => ({ path: `/c/${c.slug}`, lastmod: c.updatedAt as Date })),
    ...prods.map((p) => ({ path: `/p/${p.slug}`, lastmod: p.updatedAt as Date })),
    ...pages.map((p) => ({ path: `/page/${p.slug}`, lastmod: p.updatedAt as Date })),
  ];
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls
      .map((u) => {
        const ar = `${base}/ar${u.path}`;
        const en = `${base}/en${u.path}`;
        const alt = `<xhtml:link rel="alternate" hreflang="ar-SA" href="${ar}"/><xhtml:link rel="alternate" hreflang="en-SA" href="${en}"/>`;
        const lm = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : '';
        return `<url><loc>${ar}</loc>${lm}${alt}</url>\n<url><loc>${en}</loc>${lm}${alt}</url>`;
      })
      .join('\n') +
    '\n</urlset>';
  res.type('application/xml').send(xml);
}
