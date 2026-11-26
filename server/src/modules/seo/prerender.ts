import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { databaseReady } from '../../db/connect';
import { logger } from '../../lib/logger';
import { Category, Page, Product, getSettings } from '../../models';
import * as catalog from '../catalog/catalog.service';
import { publicFaqPage } from '../faq/faq.service';
import { isBot } from './bots';

/**
 * Server-rendered pages for crawlers (SEO, AEO, GEO).
 *
 * The storefront is a single-page app: without JavaScript a crawler sees an empty page. Search
 * engines, AI assistants and link-preview bots (modules/seo/bots.ts) get the same page as HTML —
 * title, description, canonical, hreflang, Open Graph, schema.org JSON-LD, one H1, the page's
 * real content and its internal links — built from the same data the storefront shows (no
 * invented claims). People keep getting the normal storefront from the CDN.
 *
 * Head tags use the same selectors as client/src/lib/useSeo.ts, which updates them in place once
 * the app runs, so nothing is duplicated. Unknown products/categories/pages answer 404 (no soft-404).
 */

type Lang = 'ar' | 'en';
type Loc = { ar?: string | null; en?: string | null } | null | undefined;
type Crumb = { name: string; path: string };
type Built = {
  status: number;
  title: string;
  description: string;
  h1?: string;
  body: string;
  noindex?: boolean;
  image?: string;
  ogType?: 'website' | 'product';
  ld?: Record<string, unknown>[];
  crumbs?: Crumb[];
};

// ---- small helpers ---------------------------------------------------------------------------

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const L = (v: Loc, lang: Lang) => (v?.[lang] || v?.[lang === 'ar' ? 'en' : 'ar'] || '').trim();
/** Stored text may hold light markup (rich text): crawlers get clean sentences. */
const plain = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/[*_#>`]/g, '').replace(/[ \t]+/g, ' ').trim();
const paras = (s: string) =>
  plain(s)
    .split(/\n\s*\n|\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p>${esc(x)}</p>`)
    .join('');
const clip = (s: string, n = 158) => {
  const t = plain(s).replace(/\s+/g, ' ');
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
};
const sar = (halalas: number, lang: Lang) => (lang === 'ar' ? `${(halalas / 100).toFixed(2)} ر.س` : `SAR ${(halalas / 100).toFixed(2)}`);
const abs = (url: string | undefined | null, base: string) => {
  if (!url) return '';
  try {
    return new URL(url, base).href;
  } catch {
    return '';
  }
};

const T = {
  ar: {
    brand: 'سيليبري',
    home: 'الرئيسية',
    shop: 'كل المنتجات',
    categories: 'تسوق حسب الفئة',
    bundles: 'الباقات وأطقم الهدايا',
    faq: 'الأسئلة الشائعة',
    about: 'عن سيليبري',
    contact: 'تواصل معنا',
    support: 'مركز الدعم',
    supportTitle: 'كيف يمكننا مساعدتك؟',
    faqTitle: 'الأسئلة الشائعة',
    contactDesc: 'تواصل مع خدمة عملاء سيليبري إنترناشونال في السعودية عبر البريد الإلكتروني أو الهاتف أو واتساب.',
    supportDesc: 'دعم سيليبري: تتبع الطلب والتوصيل والدفع والضمان والإرجاع وطرق التواصل مع فريقنا.',
    bundlesDesc: 'أطقم جاهزة للسفر والعمرة والهدايا.',
    track: 'تتبع الطلب',
    policies: 'السياسات',
    featured: 'منتجات مختارة',
    related: 'منتجات ذات صلة',
    specs: 'المواصفات',
    inStock: 'متوفر',
    outOfStock: 'غير متوفر حالياً',
    priceVat: 'السعر شامل ضريبة القيمة المضافة',
    products: (n: number) => `${n} منتج`,
    heroTitle: 'طاقة تواكب يومك',
    heroSubtitle: 'شواحن وباور بانك وكابلات وسماعات مصممة للاستخدام اليومي في المملكة.',
    story: 'سيليبري إنترناشونال علامة تجارية متخصصة في إكسسوارات الشحن والتقنية للسوق السعودي.',
    shopDesc: (cats: string) => `تسوق منتجات سيليبري في السعودية: ${cats}. الأسعار بالريال شاملة الضريبة.`,
    catDesc: (name: string, n: number) => `تسوق ${name} من سيليبري في السعودية — ${n} منتج، الأسعار بالريال شاملة الضريبة.`,
    prodDesc: (name: string, price: string) => `${name} من سيليبري. السعر ${price} شامل الضريبة.`,
    notFound: 'الصفحة غير موجودة',
    notFoundText: 'لم نعثر على هذه الصفحة. تصفح المنتجات أو عد إلى الرئيسية.',
    other: 'English',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    whatsapp: 'واتساب',
  },
  en: {
    brand: 'CELIBERY',
    home: 'Home',
    shop: 'All products',
    categories: 'Shop by category',
    bundles: 'Bundles & Gift Kits',
    faq: 'FAQ',
    about: 'About CELIBERY',
    contact: 'Contact us',
    support: 'Support center',
    supportTitle: 'How can we help?',
    faqTitle: 'Frequently asked questions',
    contactDesc: 'Contact CELIBERY International customer service in Saudi Arabia by email, phone or WhatsApp.',
    supportDesc: 'CELIBERY support: order tracking, delivery, payment, warranty and returns, and how to reach our team.',
    bundlesDesc: 'Ready-made kits for travel, Umrah and gifting.',
    track: 'Track order',
    policies: 'Policies',
    featured: 'Featured products',
    related: 'Related products',
    specs: 'Specifications',
    inStock: 'In stock',
    outOfStock: 'Currently out of stock',
    priceVat: 'Price includes VAT',
    products: (n: number) => `${n} product${n === 1 ? '' : 's'}`,
    heroTitle: 'Power that keeps up with your day',
    heroSubtitle: 'Chargers, power banks, cables and audio designed for everyday life in Saudi Arabia.',
    story: 'CELIBERY International is a charging and tech accessories brand for the Saudi market.',
    shopDesc: (cats: string) => `Shop CELIBERY in Saudi Arabia: ${cats}. Prices in SAR including VAT.`,
    catDesc: (name: string, n: number) => `Shop CELIBERY ${name} in Saudi Arabia — ${n} products, prices in SAR including VAT.`,
    prodDesc: (name: string, price: string) => `${name} by CELIBERY. ${price} including VAT.`,
    notFound: 'Page not found',
    notFoundText: 'We could not find this page. Browse the products or go back to the homepage.',
    other: 'العربية',
    email: 'Email',
    phone: 'Phone',
    whatsapp: 'WhatsApp',
  },
};

type ListProduct = { _id: unknown; slug: string; name?: Loc; shortDescription?: Loc; price: number; compareAtPrice?: number | null; images?: { url: string }[]; stock?: number; dataSource?: string };
const LIST_FIELDS = 'slug name shortDescription price compareAtPrice images stock dataSource';

async function activeProducts(filter: Record<string, unknown> = {}, limit = 300): Promise<ListProduct[]> {
  return Product.find({ status: 'active', ...filter }).select(LIST_FIELDS).sort({ featured: -1, sortOrder: 1, createdAt: -1, _id: 1 }).limit(limit).lean() as unknown as Promise<ListProduct[]>;
}

function productList(items: ListProduct[], lang: Lang, base: string) {
  if (!items.length) return '';
  return `<ul class="seo-products">${items
    .map((p) => {
      const img = p.images?.[0]?.url;
      return `<li><a href="${base}/${lang}/p/${esc(p.slug)}">${img ? `<img src="${esc(img)}" alt="${esc(L(p.name, lang))}" width="400" height="400" loading="lazy">` : ''}<span>${esc(L(p.name, lang))}</span></a> — <span>${esc(sar(p.price, lang))}</span>${L(p.shortDescription, lang) ? ` <span>${esc(clip(L(p.shortDescription, lang), 140))}</span>` : ''}</li>`;
    })
    .join('')}</ul>`;
}

const itemListLd = (items: ListProduct[], lang: Lang, base: string, name: string) => ({
  '@type': 'ItemList',
  name,
  numberOfItems: items.length,
  itemListElement: items.slice(0, 100).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/${lang}/p/${p.slug}`, name: L(p.name, lang) })),
});

// ---- pages -----------------------------------------------------------------------------------

type Ctx = { lang: Lang; base: string; settings: Awaited<ReturnType<typeof getSettings>>; categories: Awaited<ReturnType<typeof catalog.listCategories>> };

async function homePage(c: Ctx): Promise<Built> {
  const { lang, base, settings } = c;
  const t = T[lang];
  const seoTitle = L(settings?.seo?.title as Loc, lang);
  const desc = L(settings?.seo?.description as Loc, lang) || L(settings?.business?.description as Loc, lang) || t.heroSubtitle;
  const [featured, faq] = await Promise.all([activeProducts({}, 24), publicFaqPage().catch(() => null)]);
  const story = L((settings?.homepage as { brandStory?: Loc } | undefined)?.brandStory, lang) || t.story;
  const faqs = (faq?.items ?? []).filter((f) => L(f.question, lang) && L(f.answer, lang)).slice(0, 8);
  const name = L(settings?.business?.name as Loc, lang) || 'CELIBERY International';
  const social = Object.values((settings?.business as { social?: Record<string, string> } | undefined)?.social ?? {}).filter((v) => typeof v === 'string' && /^https?:\/\//.test(v));
  const logo = abs((settings?.brand as { logoUrl?: string } | undefined)?.logoUrl, base);
  const body = [
    `<p>${esc(desc)}</p>`,
    `<section><h2>${esc(t.categories)}</h2><ul>${c.categories.map((x) => `<li><a href="${base}/${lang}/c/${esc(x.slug)}">${esc(L(x.name as Loc, lang))}</a> (${esc(t.products(x.productCount))})</li>`).join('')}</ul></section>`,
    featured.length ? `<section><h2>${esc(t.featured)}</h2>${productList(featured, lang, base)}<p><a href="${base}/${lang}/shop">${esc(t.shop)}</a></p></section>` : '',
    `<section><h2>${esc(t.about)}</h2>${paras(story)}</section>`,
    faqs.length ? `<section><h2>${esc(t.faq)}</h2>${faqs.map((f) => `<h3>${esc(L(f.question, lang))}</h3>${paras(L(f.answer, lang))}`).join('')}<p><a href="${base}/${lang}/faq">${esc(t.faq)}</a></p></section>` : '',
  ].join('');
  return {
    status: 200,
    title: seoTitle || `${name} — ${t.heroTitle}`,
    description: clip(desc),
    h1: seoTitle || t.heroTitle,
    body,
    image: logo || undefined,
    ld: [
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name,
        url: `${base}/${lang}`,
        ...(logo ? { logo } : {}),
        ...(social.length ? { sameAs: social } : {}),
        ...(settings?.business?.email || settings?.business?.phone
          ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer service', areaServed: 'SA', availableLanguage: ['ar', 'en'], ...(settings?.business?.email ? { email: settings.business.email } : {}), ...(settings?.business?.phone ? { telephone: settings.business.phone } : {}) } }
          : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        name,
        url: `${base}/${lang}`,
        inLanguage: lang === 'ar' ? 'ar-SA' : 'en-SA',
        publisher: { '@id': `${base}/#organization` },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${base}/${lang}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
      },
      ...(faqs.length ? [{ '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: L(f.question, lang), acceptedAnswer: { '@type': 'Answer', text: plain(L(f.answer, lang)) } })) }] : []),
    ],
  };
}

async function shopPage(c: Ctx): Promise<Built> {
  const { lang, base } = c;
  const t = T[lang];
  const items = await activeProducts();
  const desc = t.shopDesc(c.categories.map((x) => L(x.name as Loc, lang)).filter(Boolean).join(lang === 'ar' ? '، ' : ', '));
  return {
    status: 200,
    title: t.shop,
    description: clip(desc),
    h1: t.shop,
    body: `<p>${esc(desc)}</p><nav aria-label="${esc(t.categories)}"><ul>${c.categories.map((x) => `<li><a href="${base}/${lang}/c/${esc(x.slug)}">${esc(L(x.name as Loc, lang))}</a></li>`).join('')}</ul></nav>${productList(items, lang, base)}`,
    crumbs: [{ name: t.shop, path: '/shop' }],
    ld: [{ '@type': 'CollectionPage', name: t.shop, url: `${base}/${lang}/shop`, mainEntity: itemListLd(items, lang, base, t.shop) }],
  };
}

async function categoryPage(c: Ctx, slug: string): Promise<Built | null> {
  const { lang, base } = c;
  const t = T[lang];
  const cat = await Category.findOne({ slug, active: true }).lean();
  if (!cat) return null;
  const items = await activeProducts({ category: cat._id });
  const name = L(cat.name as Loc, lang);
  const own = L((cat as { description?: Loc }).description, lang);
  const desc = own || t.catDesc(name, items.length);
  const seo = (cat as { seo?: { title?: Loc; description?: Loc } }).seo;
  const others = c.categories.filter((x) => x.slug !== slug);
  return {
    status: 200,
    title: L(seo?.title, lang) || name,
    description: clip(L(seo?.description, lang) || desc),
    h1: name,
    body: `${paras(desc)}${productList(items, lang, base)}${others.length ? `<nav aria-label="${esc(t.categories)}"><h2>${esc(t.categories)}</h2><ul>${others.map((x) => `<li><a href="${base}/${lang}/c/${esc(x.slug)}">${esc(L(x.name as Loc, lang))}</a></li>`).join('')}</ul></nav>` : ''}`,
    image: (cat as { image?: { url?: string } }).image?.url || items[0]?.images?.[0]?.url,
    crumbs: [
      { name: t.shop, path: '/shop' },
      { name, path: `/c/${slug}` },
    ],
    ld: [{ '@type': 'CollectionPage', name, url: `${base}/${lang}/c/${slug}`, ...(desc ? { description: clip(desc, 300) } : {}), mainEntity: itemListLd(items, lang, base, name) }],
  };
}

type FullProduct = Awaited<ReturnType<typeof catalog.getProduct>> & {
  name?: Loc;
  shortDescription?: Loc;
  description?: Loc;
  specs?: { label?: Loc; value?: Loc }[];
  seo?: { title?: Loc; description?: Loc };
  category?: { slug?: string; name?: Loc } | null;
  images?: { url: string; alt?: Loc }[];
  related?: ListProduct[];
  sku?: string;
  model?: string;
  price: number;
  available?: boolean;
  dataSource?: string;
  reviews?: { average?: number; count?: number } | null;
  attributes?: { color?: { name?: Loc } | null } | null;
};

async function productPage(c: Ctx, slug: string): Promise<Built | null> {
  const { lang, base, settings } = c;
  const t = T[lang];
  let p: FullProduct;
  try {
    p = (await catalog.getProduct(slug)) as FullProduct;
  } catch {
    return null;
  }
  const name = L(p.name, lang);
  const price = sar(p.price, lang);
  const short = L(p.shortDescription, lang);
  const long = L(p.description, lang);
  const desc = L(p.seo?.description, lang) || short || clip(long) || t.prodDesc(name, price);
  const cat = p.category && typeof p.category === 'object' ? p.category : null;
  const specs = (p.specs ?? []).filter((s) => L(s.label, lang) && L(s.value, lang));
  const images = (p.images ?? []).map((i) => i.url).filter(Boolean);
  const url = `${base}/${lang}/p/${slug}`;
  const related = (p.related ?? []) as ListProduct[];
  const body = [
    images.length ? images.slice(0, 8).map((src, i) => `<img src="${esc(src)}" alt="${esc(i === 0 ? name : `${name} ${i + 1}`)}" width="1200" height="1200">`).join('') : '',
    `<p><strong>${esc(price)}</strong> — ${esc(t.priceVat)}. ${esc(p.available ? t.inStock : t.outOfStock)}.</p>`,
    p.sku ? `<p>SKU: ${esc(p.sku)}${p.model ? ` · ${lang === 'ar' ? 'الموديل' : 'Model'}: ${esc(p.model)}` : ''}</p>` : '',
    short ? `<p>${esc(short)}</p>` : '',
    long ? `<section>${paras(long)}</section>` : '',
    specs.length ? `<section><h2>${esc(t.specs)}</h2><table><tbody>${specs.map((s) => `<tr><th scope="row">${esc(L(s.label, lang))}</th><td>${esc(L(s.value, lang))}</td></tr>`).join('')}</tbody></table></section>` : '',
    cat?.slug ? `<p><a href="${base}/${lang}/c/${esc(cat.slug)}">${esc(L(cat.name, lang))}</a></p>` : '',
    related.length ? `<section><h2>${esc(t.related)}</h2>${productList(related, lang, base)}</section>` : '',
  ].join('');
  const currency = (settings?.commerce as { currency?: string } | undefined)?.currency || 'SAR';
  const ld: Record<string, unknown>[] =
    p.dataSource === 'demo'
      ? []
      : [
          {
            '@type': 'Product',
            '@id': `${url}#product`,
            name,
            url,
            sku: p.sku,
            ...(p.model ? { mpn: p.model } : {}),
            brand: { '@type': 'Brand', name: 'CELIBERY' },
            ...(desc ? { description: clip(long || desc, 5000) } : {}),
            ...(cat ? { category: L(cat.name, lang) } : {}),
            ...(L(p.attributes?.color?.name, lang) ? { color: L(p.attributes?.color?.name, lang) } : {}),
            image: images.map((u) => abs(u, base)).filter(Boolean),
            ...(specs.length ? { additionalProperty: specs.map((s) => ({ '@type': 'PropertyValue', name: L(s.label, lang), value: L(s.value, lang) })) } : {}),
            offers: {
              '@type': 'Offer',
              url,
              priceCurrency: currency,
              price: (p.price / 100).toFixed(2),
              availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              itemCondition: 'https://schema.org/NewCondition',
              seller: { '@id': `${base}/#organization` },
              areaServed: 'SA',
            },
            ...(settings?.reviews?.enabled && p.reviews?.count
              ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.reviews.average, reviewCount: p.reviews.count, bestRating: 5, worstRating: 1 } }
              : {}),
          },
        ];
  return {
    status: 200,
    title: L(p.seo?.title, lang) || name,
    description: clip(desc),
    h1: name,
    body,
    image: images[0],
    ogType: 'product',
    crumbs: [
      { name: t.shop, path: '/shop' },
      ...(cat?.slug ? [{ name: L(cat.name, lang), path: `/c/${cat.slug}` }] : []),
      { name, path: `/p/${slug}` },
    ],
    ld,
  };
}

async function bundlesPage(c: Ctx): Promise<Built> {
  const { lang, base } = c;
  const t = T[lang];
  // The storefront's /bundles page is the "bundles" collection (falls back to bundle products).
  const col = await catalog.collectionWithProducts('bundles').catch(() => null);
  const items = col?.products?.length ? (col.products as unknown as ListProduct[]) : await activeProducts({ isBundle: true });
  return {
    status: 200,
    title: t.bundles,
    description: clip(t.bundlesDesc),
    h1: t.bundles,
    body: productList(items, lang, base),
    crumbs: [{ name: t.bundles, path: '/bundles' }],
    ld: [{ '@type': 'CollectionPage', name: t.bundles, url: `${base}/${lang}/bundles`, mainEntity: itemListLd(items, lang, base, t.bundles) }],
  };
}

async function faqPage(c: Ctx): Promise<Built | null> {
  const { lang } = c;
  const t = T[lang];
  const faq = await publicFaqPage().catch(() => null);
  const items = (faq?.items ?? []).filter((f) => L(f.question, lang) && L(f.answer, lang));
  if (!items.length) return null;
  const title = L(faq?.settings?.title as Loc, lang) || t.faqTitle;
  const sub = L(faq?.settings?.subtitle as Loc, lang);
  return {
    status: 200,
    title,
    description: clip(sub || (lang === 'ar' ? 'إجابات عن الطلبات والتوصيل والدفع والضمان والإرجاع لدى سيليبري.' : 'Answers about orders, delivery, payment, warranty and returns at CELIBERY.')),
    h1: title,
    body: `${sub ? `<p>${esc(sub)}</p>` : ''}${items.map((f) => `<section><h2>${esc(L(f.question, lang))}</h2>${paras(L(f.answer, lang))}</section>`).join('')}`,
    crumbs: [{ name: title, path: '/faq' }],
    ld: [{ '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: L(f.question, lang), acceptedAnswer: { '@type': 'Answer', text: plain(L(f.answer, lang)) } })) }],
  };
}

async function contentPage(c: Ctx, slug: string): Promise<Built | null> {
  const { lang } = c;
  const page = await Page.findOne({ slug, status: 'approved' }).lean();
  if (!page) return null;
  const title = L(page.title as Loc, lang) || slug;
  const text = L((page as { body?: Loc }).body, lang);
  return { status: 200, title, description: clip(text || title), h1: title, body: paras(text), crumbs: [{ name: title, path: `/page/${slug}` }], ld: [{ '@type': 'WebPage', name: title }] };
}

async function campaignPage(c: Ctx, slug: string): Promise<Built | null> {
  const { lang, base } = c;
  let camp: Awaited<ReturnType<typeof catalog.getCampaign>>;
  try {
    camp = await catalog.getCampaign(slug);
  } catch {
    return null;
  }
  const title = L(camp.title as Loc, lang) || slug;
  const text = L((camp as { description?: Loc }).description, lang) || L((camp as { subtitle?: Loc }).subtitle, lang);
  const items = (camp.products ?? []) as ListProduct[];
  return { status: 200, title, description: clip(text || title), h1: title, body: `${paras(text)}${productList(items, lang, base)}`, crumbs: [{ name: title, path: `/campaign/${slug}` }] };
}

async function collectionPage(c: Ctx, slug: string): Promise<Built | null> {
  const { lang, base } = c;
  let col: Awaited<ReturnType<typeof catalog.collectionWithProducts>>;
  try {
    col = await catalog.collectionWithProducts(slug);
  } catch {
    return null;
  }
  const title = L((col as { title?: Loc; name?: Loc }).title ?? (col as { name?: Loc }).name, lang) || slug;
  const text = L((col as { description?: Loc }).description, lang);
  const items = (col.products ?? []) as unknown as ListProduct[];
  return {
    status: 200,
    title,
    description: clip(text || title),
    h1: title,
    body: `${paras(text)}${productList(items, lang, base)}`,
    crumbs: [{ name: title, path: `/collection/${slug}` }],
    ld: [{ '@type': 'CollectionPage', name: title, url: `${base}/${lang}/collection/${slug}`, mainEntity: itemListLd(items, lang, base, title) }],
  };
}

function infoPage(c: Ctx, kind: 'about' | 'contact' | 'support'): Built {
  const { lang, base, settings } = c;
  const t = T[lang];
  const b = settings?.business;
  const contact = [
    b?.email ? `<li>${esc(t.email)}: <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></li>` : '',
    b?.phone ? `<li>${esc(t.phone)}: <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></li>` : '',
    b?.whatsappNumber ? `<li>${esc(t.whatsapp)}: <a href="https://wa.me/${esc(String(b.whatsappNumber).replace(/\D/g, ''))}">+${esc(String(b.whatsappNumber).replace(/^\+/, ''))}</a></li>` : '',
  ].join('');
  const story = L((settings?.homepage as { brandStory?: Loc } | undefined)?.brandStory, lang) || L(b?.description as Loc, lang) || t.story;
  const title = kind === 'about' ? t.about : kind === 'contact' ? t.contact : t.supportTitle;
  const body =
    kind === 'about'
      ? paras(story)
      : kind === 'contact'
        ? contact
          ? `<ul>${contact}</ul>`
          : ''
        : `<ul><li><a href="${base}/${lang}/faq">${esc(t.faq)}</a></li><li><a href="${base}/${lang}/track">${esc(t.track)}</a></li><li><a href="${base}/${lang}/contact">${esc(t.contact)}</a></li></ul>`;
  return { status: 200, title, description: clip(kind === 'about' ? story : kind === 'contact' ? t.contactDesc : t.supportDesc), h1: title, body, crumbs: [{ name: title, path: `/${kind}` }], ld: [{ '@type': kind === 'about' ? 'AboutPage' : kind === 'contact' ? 'ContactPage' : 'WebPage', name: title }] };
}

const PRIVATE = new Set(['cart', 'checkout', 'track', 'wishlist', 'login', 'register', 'forgot-password', 'reset-password', 'account', 'search', 'sandbox-pay']);

/** Builds the page for a storefront path (without the /ar or /en prefix). */
export async function buildPage(lang: Lang, rest: string, base: string): Promise<Built> {
  const [settings, categories] = await Promise.all([getSettings(), catalog.listCategories()]);
  const c: Ctx = { lang, base, settings, categories };
  const parts = rest.split('/').filter(Boolean);
  const [a, b] = parts;
  let page: Built | null = null;
  if (!a) page = await homePage(c);
  else if (PRIVATE.has(a)) page = { status: 200, title: T[lang].brand, description: '', body: '', noindex: true };
  else if (parts.length === 1 && a === 'shop') page = await shopPage(c);
  else if (parts.length === 1 && a === 'bundles') page = await bundlesPage(c);
  else if (parts.length === 1 && a === 'faq') page = await faqPage(c);
  else if (parts.length === 1 && (a === 'about' || a === 'contact' || a === 'support')) page = infoPage(c, a);
  else if (parts.length === 2 && /^[a-z0-9-]{1,100}$/.test(b)) {
    if (a === 'c') page = await categoryPage(c, b);
    else if (a === 'p') page = await productPage(c, b);
    else if (a === 'page') page = await contentPage(c, b);
    else if (a === 'campaign') page = await campaignPage(c, b);
    else if (a === 'collection') page = await collectionPage(c, b);
  }
  if (page) return page;
  const t = T[lang];
  return { status: 404, title: t.notFound, description: t.notFoundText, h1: t.notFound, body: `<p>${esc(t.notFoundText)}</p>`, noindex: true };
}

// ---- HTML ------------------------------------------------------------------------------------

function chrome(c: { lang: Lang; base: string; categories: Ctx['categories'] }, pages: { slug: string; title: Loc }[], rest: string) {
  const { lang, base } = c;
  const t = T[lang];
  const other: Lang = lang === 'ar' ? 'en' : 'ar';
  const header = `<header><a href="${base}/${lang}">${esc(t.brand)}</a><nav aria-label="${esc(t.categories)}"><ul><li><a href="${base}/${lang}/shop">${esc(t.shop)}</a></li>${c.categories.map((x) => `<li><a href="${base}/${lang}/c/${esc(x.slug)}">${esc(L(x.name as Loc, lang))}</a></li>`).join('')}<li><a href="${base}/${lang}/bundles">${esc(t.bundles)}</a></li></ul></nav><a href="${base}/${other}${rest}" hreflang="${other}" lang="${other}">${esc(t.other)}</a></header>`;
  const footer = `<footer><nav aria-label="${esc(t.policies)}"><ul><li><a href="${base}/${lang}/about">${esc(t.about)}</a></li><li><a href="${base}/${lang}/faq">${esc(t.faq)}</a></li><li><a href="${base}/${lang}/support">${esc(t.support)}</a></li><li><a href="${base}/${lang}/contact">${esc(t.contact)}</a></li><li><a href="${base}/${lang}/track">${esc(t.track)}</a></li>${pages.map((p) => `<li><a href="${base}/${lang}/page/${esc(p.slug)}">${esc(L(p.title, lang) || p.slug)}</a></li>`).join('')}</ul></nav><p>© ${new Date().getFullYear()} CELIBERY International</p></footer>`;
  return { header, footer };
}

const breadcrumbHtml = (crumbs: Crumb[], lang: Lang, base: string) =>
  `<nav aria-label="breadcrumb"><ol><li><a href="${base}/${lang}">${esc(T[lang].home)}</a></li>${crumbs.map((x) => `<li><a href="${base}/${lang}${x.path}">${esc(x.name)}</a></li>`).join('')}</ol></nav>`;

const breadcrumbLd = (crumbs: Crumb[], lang: Lang, base: string) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [{ name: T[lang].home, path: '' }, ...crumbs].map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: `${base}/${lang}${x.path}` })),
});

const ldScript = (data: unknown, id: string) => `<script type="application/ld+json" id="${id}" data-ssr="1">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export function renderHtml(template: string, page: Built, opts: { lang: Lang; rest: string; base: string; header: string; footer: string }) {
  const { lang, rest, base } = opts;
  const url = `${base}/${lang}${rest}`;
  const fullTitle = page.title ? `${page.title} | CELIBERY` : 'CELIBERY International';
  const img = abs(page.image, base);
  const head = [
    `<title>${esc(fullTitle)}</title>`,
    page.description ? `<meta name="description" content="${esc(page.description)}">` : '',
    page.noindex ? '<meta name="robots" content="noindex, follow">' : '',
    page.status === 200 && !page.noindex ? `<link rel="canonical" href="${esc(url)}">` : '',
    ...(page.status === 200 && !page.noindex
      ? [
          `<link rel="alternate" hreflang="ar-SA" href="${esc(`${base}/ar${rest}`)}">`,
          `<link rel="alternate" hreflang="en-SA" href="${esc(`${base}/en${rest}`)}">`,
          `<link rel="alternate" hreflang="x-default" href="${esc(`${base}/ar${rest}`)}">`,
        ]
      : []),
    '<meta property="og:site_name" content="CELIBERY International">',
    `<meta property="og:title" content="${esc(fullTitle)}">`,
    `<meta property="og:type" content="${page.ogType ?? 'website'}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:locale" content="${lang === 'ar' ? 'ar_SA' : 'en_SA'}">`,
    `<meta property="og:locale:alternate" content="${lang === 'ar' ? 'en_SA' : 'ar_SA'}">`,
    page.description ? `<meta property="og:description" content="${esc(page.description)}">` : '',
    img ? `<meta property="og:image" content="${esc(img)}">` : '',
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`,
  ];
  const graph = [...(page.ld ?? []), ...(page.crumbs?.length ? [breadcrumbLd(page.crumbs, lang, base)] : [])];
  if (graph.length && page.status === 200) head.push(ldScript({ '@context': 'https://schema.org', '@graph': graph }, 'celibery-ssr-ld'));
  const main = `${page.crumbs?.length ? breadcrumbHtml(page.crumbs, lang, base) : ''}<main>${page.h1 ? `<h1>${esc(page.h1)}</h1>` : ''}${page.body}</main>`;
  let html = template
    .replace(/<html[^>]*>/i, `<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '');
  html = html.replace(/<\/head>/i, `${head.filter(Boolean).join('\n')}\n</head>`);
  html = html.replace(/<div id="root"><\/div>/i, `<div id="root">${opts.header}${main}${opts.footer}</div>`);
  return html;
}

// ---- template and Express handler ------------------------------------------------------------

const FALLBACK_TEMPLATE = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>';
let cachedTemplate: { html: string; at: number } | null = null;

async function loadTemplate(clientDir?: string): Promise<string> {
  if (cachedTemplate && Date.now() - cachedTemplate.at < 5 * 60_000) return cachedTemplate.html;
  let html = '';
  try {
    if (clientDir) html = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');
    else {
      // Vercel: index.html is a static file on the CDN (not in the function bundle).
      const r = await fetch(`${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/index.html`, { headers: { 'user-agent': 'celibery-prerender' }, signal: AbortSignal.timeout(3000) });
      if (r.ok) html = await r.text();
    }
  } catch {
    /* fall back below */
  }
  if (!html.includes('<div id="root"></div>')) html = FALLBACK_TEMPLATE;
  cachedTemplate = { html, at: Date.now() };
  return html;
}

/**
 * GET /, /ar…, /en… for crawlers. On Vercel only crawlers are routed here (vercel.json `has`
 * user-agent rule), so every request is rendered; on a single server, people fall through to the
 * normal storefront (express.static + index.html).
 */
export function prerender(clientDir?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!process.env.VERCEL && !isBot(req.get('user-agent'))) return next();
    const m = /^\/(ar|en)(\/.*)?$/.exec(req.path);
    if (!m) {
      if (req.path === '/' || req.path === '') return res.redirect(301, '/ar');
      return next();
    }
    const lang = m[1] as Lang;
    const rest = (m[2] ?? '').replace(/\/+$/, '');
    const base = env.PUBLIC_SITE_URL.replace(/\/$/, '');
    try {
      // Database not connected: never make a crawler (or anyone) wait — serve the plain storefront.
      if (!databaseReady()) throw new Error('database not ready');
      const [template, page, pages, categories] = await Promise.all([
        loadTemplate(clientDir),
        buildPage(lang, rest, base),
        Page.find({ status: 'approved' }).select('slug title').sort({ slug: 1 }).lean(),
        catalog.listCategories(),
      ]);
      const { header, footer } = chrome({ lang, base, categories }, pages as unknown as { slug: string; title: Loc }[], rest);
      const html = renderHtml(template, page, { lang, rest, base, header, footer });
      res.status(page.status);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', page.status === 200 ? 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400' : 'public, max-age=0, s-maxage=60');
      res.setHeader('X-Robots-Tag', page.noindex || page.status !== 200 ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1');
      return res.send(html);
    } catch (e) {
      logger.warn('Prerender failed; serving the plain storefront', { path: req.path, err: e instanceof Error ? e.message : String(e) });
      if (!process.env.VERCEL) return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(await loadTemplate(clientDir));
    }
  };
}

/** Test hook. */
export const _resetTemplateCache = () => {
  cachedTemplate = null;
};

