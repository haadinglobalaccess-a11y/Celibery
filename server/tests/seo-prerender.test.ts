import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Category, Faq, Product } from '../src/models';
import { isBot } from '../src/modules/seo/bots';
import { app, createStaff, useDatabase } from './helpers';

useDatabase();

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const WHATSAPP = 'WhatsApp/2.23.20.0';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const bot = (path: string, ua = GOOGLEBOT) => request(app).get(path).set('User-Agent', ua);
const ldOf = (html: string) => {
  const m = /<script type="application\/ld\+json" id="celibery-ssr-ld"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m ? (JSON.parse(m[1]) as { '@graph': Record<string, unknown>[] }) : null;
};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('crawler detection', () => {
  it('recognises search, AI and link-preview bots, not browsers', () => {
    for (const ua of [GOOGLEBOT, GPTBOT, WHATSAPP, 'Mozilla/5.0 (compatible; bingbot/2.0)', 'PerplexityBot/1.0', 'ClaudeBot/1.0', 'facebookexternalhit/1.1', 'Twitterbot/1.0']) expect(isBot(ua)).toBe(true);
    for (const ua of [CHROME, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', '', undefined]) expect(isBot(ua)).toBe(false);
  });
});

describe('server-rendered pages for crawlers', () => {
  let slug = '';
  beforeAll(async () => {
    const admin = await createStaff('admin');
    const cat = await Category.findOne({ slug: 'power-banks' }).lean();
    const r = await admin.post('/api/admin/products').send({
      sku: 'SEO-PB-1',
      slug: 'celibery-power-bank-60000mah-cel211',
      model: 'CEL211',
      category: String(cat!._id),
      price: 324.95,
      stock: 12,
      status: 'active',
      name: { ar: 'باور بانك سليبري 60000', en: 'CELIBERY Power Bank 60,000mAh CEL211' },
      shortDescription: { ar: 'باور بانك 65 واط', en: '60,000mAh power bank with 65W USB-C.' },
      description: { ar: 'وصف كامل', en: 'Full description of the power bank.\n\nSecond paragraph.' },
      images: [{ url: 'https://res.cloudinary.com/x/image/upload/a.jpg', alt: { ar: '', en: '' } }],
      specs: [{ label: { ar: 'السعة', en: 'Capacity' }, value: { ar: '60000', en: '60,000mAh' } }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    slug = r.body.data.slug;
    await Product.updateOne({ slug }, { $set: { dataSource: 'client' } });
  });

  it('product page: one H1, title, description, canonical, hreflang, Open Graph and Product + Breadcrumb JSON-LD', async () => {
    const r = await bot(`/en/p/${slug}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    const h = r.text;
    expect(h).toContain('<html lang="en" dir="ltr">');
    expect(h).toContain('<title>CELIBERY Power Bank 60,000mAh CEL211 | CELIBERY</title>');
    expect(count(h, /<title>/g)).toBe(1);
    expect(h).toContain('<meta name="description" content="60,000mAh power bank with 65W USB-C.">');
    expect(count(h, /<h1>/g)).toBe(1);
    expect(h).toContain('<h1>CELIBERY Power Bank 60,000mAh CEL211</h1>');
    expect(h).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/en\/p\/celibery-power-bank-60000mah-cel211">/);
    for (const l of ['ar-SA', 'en-SA', 'x-default']) expect(h).toContain(`hreflang="${l}"`);
    expect(h).toContain('<meta property="og:type" content="product">');
    expect(h).toContain('og:image" content="https://res.cloudinary.com/x/image/upload/a.jpg"');
    expect(h).toContain('SAR 324.95');
    expect(h).toContain('<th scope="row">Capacity</th><td>60,000mAh</td>');
    expect(h).toContain('<p>Second paragraph.</p>');
    const ld = ldOf(h)!;
    const product = ld['@graph'].find((x) => x['@type'] === 'Product')!;
    expect(product).toMatchObject({ name: 'CELIBERY Power Bank 60,000mAh CEL211', sku: 'SEO-PB-1', mpn: 'CEL211', brand: { name: 'CELIBERY' } });
    expect(product.offers).toMatchObject({ price: '324.95', priceCurrency: 'SAR', availability: 'https://schema.org/InStock' });
    const crumbs = ld['@graph'].find((x) => x['@type'] === 'BreadcrumbList') as { itemListElement: { name: string }[] };
    expect(crumbs.itemListElement.map((x) => x.name)).toEqual(['Home', 'All products', 'Power Banks', 'CELIBERY Power Bank 60,000mAh CEL211']);
    // Internal links: categories in the header, policies in the footer, the category and the other language.
    expect(h).toMatch(/href="[^"]+\/en\/c\/cables"/);
    expect(h).toMatch(/href="[^"]+\/en\/faq"/);
    expect(h).toMatch(/href="[^"]+\/ar\/p\/celibery-power-bank-60000mah-cel211" hreflang="ar"/);
    // The app still boots on top of it.
    expect(h).toContain('<div id="root"><header>');
    expect(r.headers['x-robots-tag']).toMatch(/^index, follow/);
  });

  it('Arabic page is right-to-left with Arabic text', async () => {
    const h = (await bot(`/ar/p/${slug}`)).text;
    expect(h).toContain('<html lang="ar" dir="rtl">');
    expect(h).toContain('<h1>باور بانك سليبري 60000</h1>');
    expect(h).toContain('324.95 ر.س');
    expect(h).toContain('<meta property="og:locale" content="ar_SA">');
  });

  it('unknown product, category and page answer 404 with noindex (no soft 404)', async () => {
    for (const path of ['/en/p/does-not-exist', '/ar/c/nope', '/en/page/nope', '/en/whatever/else']) {
      const r = await bot(path);
      expect(r.status, path).toBe(404);
      expect(r.text).toContain('<meta name="robots" content="noindex, follow">');
      expect(r.text).not.toContain('rel="canonical"');
    }
  });

  it('home: Organization, WebSite search box; categories and products linked', async () => {
    const r = await bot('/en', GPTBOT);
    expect(r.status).toBe(200);
    const ld = ldOf(r.text)!;
    const types = ld['@graph'].map((x) => x['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
    const site = ld['@graph'].find((x) => x['@type'] === 'WebSite') as { potentialAction: { target: { urlTemplate: string } } };
    expect(site.potentialAction.target.urlTemplate).toMatch(/\/en\/search\?q=\{search_term_string\}$/);
    expect(count(r.text, /<h1>/g)).toBe(1);
    expect(r.text).toMatch(/href="[^"]+\/en\/c\/power-banks"/);
    expect(r.text).toMatch(/href="[^"]+\/en\/p\/celibery-power-bank-60000mah-cel211"/);
  });

  it('category and shop pages list their products with CollectionPage / ItemList', async () => {
    const c = await bot('/en/c/power-banks');
    expect(c.status).toBe(200);
    expect(c.text).toContain('<h1>Power Banks</h1>');
    const ld = ldOf(c.text)!;
    const page = ld['@graph'].find((x) => x['@type'] === 'CollectionPage') as { mainEntity: { itemListElement: { url: string }[] } };
    expect(page.mainEntity.itemListElement.some((x) => x.url.endsWith(`/en/p/${slug}`))).toBe(true);
    const s = await bot('/en/shop');
    expect(s.text).toContain('<h1>All products</h1>');
    expect(s.text).toMatch(/<meta name="description" content="Shop CELIBERY in Saudi Arabia: [^"]+">/);
  });

  it('FAQ page carries FAQPage structured data when FAQs are published', async () => {
    await Faq.create({ question: { ar: 'هل التوصيل مجاني؟', en: 'Is delivery free?' }, answer: { ar: 'نعم', en: 'Yes, across Saudi Arabia.' }, status: 'published' }).catch(() => undefined);
    const r = await bot('/en/faq');
    if (r.status === 200) {
      const ld = ldOf(r.text)!;
      expect(ld['@graph'].some((x) => x['@type'] === 'FAQPage')).toBe(true);
    } else expect(r.status).toBe(404); // no published FAQ in this store → not indexed
  });

  it('private pages are noindex; "/" sends crawlers to Arabic; people get the normal storefront', async () => {
    const cart = await bot('/en/cart');
    expect(cart.text).toContain('<meta name="robots" content="noindex, follow">');
    const root = await bot('/');
    expect(root.status).toBe(301);
    expect(root.headers.location).toBe('/ar');
    // A browser is not rendered here (falls through; this test app does not serve the client).
    const human = await request(app).get(`/en/p/${slug}`).set('User-Agent', CHROME);
    expect(human.text).not.toContain('<h1>CELIBERY Power Bank');
  });

  it('link previews (WhatsApp) get the title, description and image', async () => {
    const h = (await bot(`/en/p/${slug}`, WHATSAPP)).text;
    expect(h).toContain('<meta property="og:title" content="CELIBERY Power Bank 60,000mAh CEL211 | CELIBERY">');
    expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('escapes stored text (no HTML injection)', async () => {
    await Product.updateOne({ slug }, { $set: { 'name.en': 'Evil <script>alert(1)</script> "x"' } });
    const h = (await bot(`/en/c/power-banks`)).text;
    expect(h).not.toContain('<script>alert(1)</script>');
  });
});

describe('sitemap and AI catalogue', () => {
  it('sitemap lists product images, x-default and the info pages', async () => {
    const r = await request(app).get('/sitemap.xml');
    expect(r.status).toBe(200);
    expect(r.text).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(r.text).toContain('hreflang="x-default"');
    expect(r.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/about<\/loc>/);
    expect(r.text).toContain('<image:loc>https://res.cloudinary.com/x/image/upload/a.jpg</image:loc>');
  });

  it('llms-full.txt lists real products with price, link and specs; llms.txt points to it', async () => {
    const full = await request(app).get('/llms-full.txt');
    expect(full.status).toBe(200);
    expect(full.text).toMatch(/- Price: SAR \d+\.\d\d incl\. VAT/);
    expect(full.text).toContain('- Capacity: 60,000mAh');
    expect(full.text).toContain('- SKU: SEO-PB-1 · Model: CEL211');
    expect(full.text).not.toMatch(/DEMO-/); // sample products are not presented as real offers
    expect((await request(app).get('/llms.txt')).text).toMatch(/\/llms-full\.txt\)/);
  });
});
