import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { ok } from '../../lib/http';
import { q } from '../../middleware/validate';
import { BlogPost, Campaign, Category, NewsletterSubscription, Order, Page, Product, ProductCollection, Review, getSettings } from '../../models';
import { availablePaymentMethods } from '../payments/payment.service';
import * as svc from './catalog.service';
import { productListQuery } from './catalog.schemas';
import { lastPublishedChange } from '../faq/faq.service';

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
  // Revalidated on every load (cheap 304 via ETag) so Admin → Settings changes show after a refresh.
  res.set('Cache-Control', 'no-cache');
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

type LlmsInput = {
  siteUrl: string;
  storeName: string;
  description: string;
  categories: { slug: string; name: string; productCount: number }[];
  campaigns: { slug: string; title: string }[];
  pages: { slug: string; title: string; approved: boolean }[];
  guides?: { slug: string; title: string; excerpt: string }[];
  delivery: string;
  payments: string[];
  contact: { email?: string; phone?: string; whatsapp?: string };
};

/** llms.txt (https://llmstxt.org) — a plain summary of the public store for AI assistants (Q37). */
export function llmsTxt(d: LlmsInput): string {
  const base = d.siteUrl.replace(/\/$/, '');
  const out = [`# ${d.storeName}`, '', `> ${d.description || 'Online store in Saudi Arabia.'} Arabic is the default language (${base}/ar); English is available at ${base}/en.`, ''];
  if (d.delivery || d.payments.length) {
    out.push('## Buying');
    if (d.delivery) out.push(`- Delivery: ${d.delivery}`);
    if (d.payments.length) out.push(`- Payment methods: ${d.payments.join(', ')}`);
    out.push('');
  }
  if (d.categories.length) {
    out.push('## Shop', ...d.categories.map((c) => `- [${c.name}](${base}/en/c/${c.slug}): ${c.productCount} product${c.productCount === 1 ? '' : 's'}`), `- [Bundles & Gift Kits](${base}/en/bundles)`, '');
  }
  if (d.campaigns.length) out.push('## Current campaigns', ...d.campaigns.map((c) => `- [${c.title}](${base}/en/campaign/${c.slug})`), '');
  if (d.guides?.length) out.push('## Buying guides', ...d.guides.map((g) => `- [${g.title}](${base}/en/blog/${g.slug})${g.excerpt ? `: ${g.excerpt}` : ''}`), '');
  if (d.pages.length) out.push('## Policies', ...d.pages.map((p) => `- [${p.title}](${base}/en/page/${p.slug})${p.approved ? '' : ' (draft, pending approval)'}`), '');
  const contact = [d.contact.email && `Email: ${d.contact.email}`, d.contact.phone && `Phone: ${d.contact.phone}`, d.contact.whatsapp && `WhatsApp: +${d.contact.whatsapp.replace(/^\+/, '')}`].filter(Boolean);
  if (contact.length) out.push('## Contact', ...contact.map((c) => `- ${c}`), '');
  out.push('## More', `- [Full product catalogue with prices and specifications](${base}/llms-full.txt)`, `- [FAQ](${base}/en/faq)`, '');
  out.push(`Sitemap: ${base}/sitemap.xml`, '');
  return out.join('\n');
}

type CatalogueProduct = {
  slug: string;
  sku: string;
  model?: string;
  name?: { ar?: string; en?: string };
  shortDescription?: { ar?: string; en?: string };
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  category?: unknown;
  specs?: { label?: { en?: string; ar?: string }; value?: { en?: string; ar?: string } }[];
  attributes?: { capacityMah?: number | null; powerW?: number | null; connectors?: string[] };
  dataSource?: string;
};

/**
 * llms-full.txt — the complete public catalogue in plain Markdown for AI assistants and AI search
 * (GEO): every active product with its English and Arabic name, link, price (SAR, incl. VAT),
 * availability, model and specifications — only stored data, nothing invented.
 */
export function llmsFullTxt(d: { siteUrl: string; storeName: string; categories: { id: string; slug: string; name: string; nameAr: string }[]; products: CatalogueProduct[] }): string {
  const base = d.siteUrl.replace(/\/$/, '');
  const out = [
    `# ${d.storeName} — full product catalogue`,
    '',
    `> Official CELIBERY online store for Saudi Arabia. Prices are in Saudi riyals (SAR) and include VAT. English pages: ${base}/en, Arabic pages: ${base}/ar.`,
    '',
  ];
  for (const c of d.categories) {
    const items = d.products.filter((p) => String(p.category) === c.id && p.dataSource !== 'demo');
    if (!items.length) continue;
    out.push(`## ${c.name}${c.nameAr ? ` (${c.nameAr})` : ''}`, `${base}/en/c/${c.slug}`, '');
    for (const p of items) {
      const en = p.name?.en || p.name?.ar || p.slug;
      out.push(`### ${en}`);
      if (p.name?.ar && p.name.ar !== en) out.push(`- Arabic name: ${p.name.ar}`);
      out.push(`- Link: ${base}/en/p/${p.slug} (Arabic: ${base}/ar/p/${p.slug})`);
      out.push(`- Price: SAR ${(p.price / 100).toFixed(2)} incl. VAT${p.compareAtPrice && p.compareAtPrice > p.price ? ` (was SAR ${(p.compareAtPrice / 100).toFixed(2)})` : ''}`);
      out.push(`- Availability: ${p.stock > 0 ? 'in stock' : 'out of stock'}`);
      out.push(`- SKU: ${p.sku}${p.model ? ` · Model: ${p.model}` : ''}`);
      const a = p.attributes ?? {};
      if (a.capacityMah) out.push(`- Capacity: ${a.capacityMah.toLocaleString('en-US')} mAh`);
      if (a.powerW) out.push(`- Power: ${a.powerW} W`);
      if (a.connectors?.length) out.push(`- Connectors: ${a.connectors.join(', ')}`);
      for (const s of p.specs ?? []) if (s.label?.en && s.value?.en) out.push(`- ${s.label.en}: ${s.value.en}`);
      if (p.shortDescription?.en) out.push('', p.shortDescription.en.replace(/\s+/g, ' ').trim());
      out.push('');
    }
  }
  out.push(`Sitemap: ${base}/sitemap.xml`, '');
  return out.join('\n');
}

export async function llmsFull(_req: Request, res: Response) {
  const [s, cats, products] = await Promise.all([
    getSettings(),
    svc.listCategories(),
    Product.find({ status: 'active' }).select('slug sku model name shortDescription price compareAtPrice stock category specs attributes dataSource').sort({ category: 1, sortOrder: 1, createdAt: 1 }).lean(),
  ]);
  const name = (l?: { en?: string; ar?: string }) => l?.en || l?.ar || '';
  res.type('text/plain').setHeader('Cache-Control', 'public, max-age=300');
  res.send(
    llmsFullTxt({
      siteUrl: env.PUBLIC_SITE_URL,
      storeName: name(s?.business?.name as { en?: string }) || 'CELIBERY International',
      categories: cats.map((c) => ({ id: String(c._id), slug: c.slug, name: name(c.name as { en?: string }), nameAr: (c.name as { ar?: string })?.ar ?? '' })),
      products: products as unknown as CatalogueProduct[],
    }),
  );
}

export async function llms(_req: Request, res: Response) {
  const now = new Date();
  const [s, cats, campaigns, pages, guides] = await Promise.all([
    getSettings(),
    svc.listCategories(),
    Campaign.find({ active: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] }] })
      .select('slug title')
      .lean(),
    Page.find().select('slug title status').sort({ slug: 1 }).lean(),
    BlogPost.find({ status: 'published', publishedAt: { $ne: null, $lte: now } }).select('slug title excerpt').sort({ publishedAt: -1 }).limit(50).lean(),
  ]);
  const en = (l?: { en?: string; ar?: string }) => l?.en || l?.ar || '';
  const c = s?.commerce ?? {};
  const sar = (h: number) => `SAR ${(h / 100).toFixed(2)}`;
  const delivery = c.shippingAvailable === false
    ? 'temporarily paused'
    : c.freeDelivery !== false
      ? 'free delivery across Saudi Arabia'
      : `${sar(c.deliveryFee ?? 0)}${c.freeDeliveryThreshold ? `, free on orders from ${sar(c.freeDeliveryThreshold)}` : ''}`;
  const pm = availablePaymentMethods(s);
  const payments = [pm.card && 'mada / Visa / Mastercard', pm.applepay && 'Apple Pay', pm.stcpay && 'STC Pay', pm.tabby && 'Tabby', pm.cod && 'Cash on delivery'].filter(Boolean) as string[];
  res.type('text/plain').setHeader('Cache-Control', 'public, max-age=300');
  res.send(
    llmsTxt({
      siteUrl: env.PUBLIC_SITE_URL,
      storeName: en(s?.business?.name) || 'CELIBERY International',
      description: en(s?.business?.description),
      categories: cats.map((x) => ({ slug: x.slug, name: en(x.name as { en?: string }), productCount: x.productCount })),
      campaigns: campaigns.map((x) => ({ slug: x.slug, title: en(x.title as { en?: string }) })),
      pages: pages.map((p) => ({ slug: p.slug, title: en(p.title as { en?: string }) || p.slug, approved: p.status === 'approved' })),
      guides: guides.map((g) => ({ slug: g.slug, title: en(g.title as { en?: string }) || g.slug, excerpt: en(g.excerpt as { en?: string }) })),
      delivery: c.warrantyEnabled && c.warrantyMonths ? `${delivery}; ${c.warrantyMonths}-month warranty` : delivery,
      payments,
      contact: { email: s?.business?.email || undefined, phone: s?.business?.phone || undefined, whatsapp: s?.business?.whatsappNumber || undefined },
    }),
  );
}

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export async function sitemap(_req: Request, res: Response) {
  const now = new Date();
  const [cats, prods, pages, collections, campaigns, posts] = await Promise.all([
    Category.find({ active: true }).select('slug updatedAt').lean(),
    Product.find({ status: 'active' }).select('slug updatedAt images name').lean(),
    Page.find({ status: 'approved' }).select('slug updatedAt').lean(),
    ProductCollection.find({ active: true }).select('slug updatedAt').lean(),
    Campaign.find({ active: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] }] })
      .select('slug updatedAt')
      .lean(),
    BlogPost.find({ status: 'published', publishedAt: { $ne: null, $lte: now } }).select('slug updatedAt').lean(),
  ]);
  const base = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`);
  type U = { path: string; lastmod?: Date; images?: { url: string; title: string }[] };
  const urls: U[] = [
    { path: '' },
    { path: '/shop' },
    { path: '/bundles' },
    { path: '/about' },
    { path: '/contact' },
    { path: '/support' },
    ...cats.map((c) => ({ path: `/c/${c.slug}`, lastmod: c.updatedAt as Date })),
    // Product photos are listed for image search (up to 10 per product).
    ...prods.map((p) => ({
      path: `/p/${p.slug}`,
      lastmod: p.updatedAt as Date,
      images: ((p.images ?? []) as { url?: string }[])
        .filter((i) => i.url && !/\.svg($|\?)/i.test(i.url))
        .slice(0, 10)
        .map((i) => ({ url: abs(i.url!), title: (p.name as { en?: string; ar?: string } | undefined)?.en || (p.name as { ar?: string } | undefined)?.ar || '' })),
    })),
    ...collections.map((c) => ({ path: `/collection/${c.slug}`, lastmod: c.updatedAt as Date })),
    ...campaigns.map((c) => ({ path: `/campaign/${c.slug}`, lastmod: c.updatedAt as Date })),
    ...pages.map((p) => ({ path: `/page/${p.slug}`, lastmod: p.updatedAt as Date })),
    ...(posts.length ? [{ path: '/blog', lastmod: posts.reduce((m, p) => (p.updatedAt && (p.updatedAt as Date) > m ? (p.updatedAt as Date) : m), new Date(0)) }] : []),
    ...posts.map((p) => ({ path: `/blog/${p.slug}`, lastmod: p.updatedAt as Date })),
  ];
  // The FAQ page is listed only once something is published on it.
  const faqChanged = await lastPublishedChange();
  if (faqChanged) urls.push({ path: '/faq', lastmod: faqChanged });
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    urls
      .map((u) => {
        const ar = xmlEsc(`${base}/ar${u.path}`);
        const en = xmlEsc(`${base}/en${u.path}`);
        const alt = `<xhtml:link rel="alternate" hreflang="ar-SA" href="${ar}"/><xhtml:link rel="alternate" hreflang="en-SA" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${ar}"/>`;
        const lm = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : '';
        const img = (u.images ?? []).map((i) => `<image:image><image:loc>${xmlEsc(i.url)}</image:loc>${i.title ? `<image:title>${xmlEsc(i.title)}</image:title>` : ''}</image:image>`).join('');
        return `<url><loc>${ar}</loc>${lm}${alt}${img}</url>\n<url><loc>${en}</loc>${lm}${alt}${img}</url>`;
      })
      .join('\n') +
    '\n</urlset>';
  res.type('application/xml').setHeader('Cache-Control', 'public, max-age=300');
  res.send(xml);
}
