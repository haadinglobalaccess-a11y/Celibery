import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BlogPost } from '../src/models';
import { app, client, createStaff, useDatabase } from './helpers';

useDatabase();

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const ldOf = (html: string) => {
  const m = /<script type="application\/ld\+json" id="celibery-ssr-ld"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m ? (JSON.parse(m[1]) as { '@graph': Record<string, unknown>[] }) : null;
};

describe('blog', () => {
  it('admin: starter guides arrive as drafts (once); drafts are never public', async () => {
    const admin = await createStaff('admin');
    const r = await admin.post('/api/admin/content/blog/starter');
    expect(r.status).toBe(200);
    expect(r.body.data.added).toEqual(['how-to-choose-a-power-bank', 'what-is-a-gan-charger', 'usb-c-vs-lightning-cable-guide']);
    expect((await admin.post('/api/admin/content/blog/starter')).body.data.added).toEqual([]);
    const list = (await admin.get('/api/admin/content/blog')).body.data as { status: string; title: { ar: string; en: string } }[];
    expect(list).toHaveLength(3);
    expect(list.every((p) => p.status === 'draft' && p.title.ar && p.title.en)).toBe(true);
    const shop = client();
    expect((await shop.get('/api/blog')).body.data).toEqual([]);
    expect((await shop.get('/api/blog/how-to-choose-a-power-bank')).status).toBe(404);
    // People without content rights cannot write articles.
    const orders = await createStaff('order_manager');
    expect((await orders.post('/api/admin/content/blog/starter')).status).toBe(403);
  });

  it('publishing sets the date; the article is public with its products, sitemap and llms.txt list it', async () => {
    const admin = await createStaff('admin');
    const post = await BlogPost.findOne({ slug: 'how-to-choose-a-power-bank' }).lean();
    const { _id, createdAt: _c, updatedAt: _u, __v: _v, ...rest } = post as unknown as Record<string, unknown>;
    const r = await admin.put(`/api/admin/content/blog/${String(_id)}`).send({ ...rest, relatedProducts: ((rest.relatedProducts as unknown[]) ?? []).map(String), status: 'published', publishedAt: null });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.publishedAt).toBeTruthy();

    const shop = client();
    const list = (await shop.get('/api/blog')).body.data as { slug: string }[];
    expect(list.map((x) => x.slug)).toEqual(['how-to-choose-a-power-bank']);
    const one = (await shop.get('/api/blog/how-to-choose-a-power-bank')).body.data;
    expect(one.title.en).toMatch(/power bank/i);
    expect(one.body.en).toContain('### Can I take a power bank on a plane?');
    expect(Array.isArray(one.products)).toBe(true);

    const sm = (await request(app).get('/sitemap.xml')).text;
    expect(sm).toMatch(/<loc>https?:\/\/[^<]+\/en\/blog<\/loc>/);
    expect(sm).toMatch(/<loc>https?:\/\/[^<]+\/ar\/blog\/how-to-choose-a-power-bank<\/loc>/);
    expect(sm).not.toContain('what-is-a-gan-charger'); // still a draft
    const llms = (await request(app).get('/llms.txt')).text;
    expect(llms).toContain('## Buying guides');
    expect(llms).toMatch(/\[How to choose the right power bank[^\]]*\]\(https?:\/\/[^)]+\/en\/blog\/how-to-choose-a-power-bank\)/);
  });

  it('crawlers get the article: one H1, sub-headings, lists, BlogPosting + Breadcrumb JSON-LD', async () => {
    const r = await request(app).get('/en/blog/how-to-choose-a-power-bank').set('User-Agent', GOOGLEBOT);
    expect(r.status).toBe(200);
    const h = r.text;
    expect((h.match(/<h1>/g) ?? []).length).toBe(1);
    expect(h).toContain('<h2>Can I take a power bank on a plane?</h2>');
    expect(h).toMatch(/<ul><li><strong>10,000 mAh<\/strong>/);
    const ld = ldOf(h)!;
    const art = ld['@graph'].find((x) => x['@type'] === 'BlogPosting')!;
    expect(art).toMatchObject({ inLanguage: 'en-SA' });
    expect(String(art.headline)).toMatch(/power bank/i);
    expect(art.datePublished).toBeTruthy();
    const crumbs = ld['@graph'].find((x) => x['@type'] === 'BreadcrumbList') as { itemListElement: { name: string }[] };
    expect(crumbs.itemListElement.map((x) => x.name)).toEqual(['Home', 'Blog', expect.stringMatching(/power bank/i)]);
    // Blog list page and the Arabic article.
    const list = await request(app).get('/ar/blog').set('User-Agent', GOOGLEBOT);
    expect(list.status).toBe(200);
    expect(ldOf(list.text)!['@graph'].some((x) => x['@type'] === 'Blog')).toBe(true);
    expect(list.text).toContain('href="');
    const ar = await request(app).get('/ar/blog/how-to-choose-a-power-bank').set('User-Agent', GOOGLEBOT);
    expect(ar.text).toContain('<html lang="ar" dir="rtl">');
    expect(ar.text).toContain('<h2>هل يمكنني أخذ الباور بانك في الطائرة؟</h2>');
    // Drafts and unknown slugs are 404 for crawlers too; every page links to the blog.
    expect((await request(app).get('/en/blog/what-is-a-gan-charger').set('User-Agent', GOOGLEBOT)).status).toBe(404);
    expect((await request(app).get('/en/shop').set('User-Agent', GOOGLEBOT)).text).toMatch(/href="[^"]+\/en\/blog"/);
  });

  it('validates articles (title in both languages, slug format)', async () => {
    const admin = await createStaff('admin');
    expect((await admin.post('/api/admin/content/blog').send({ slug: 'Bad Slug', title: { ar: 'x', en: 'y' } })).status).toBe(400);
    expect((await admin.post('/api/admin/content/blog').send({ slug: 'ok-slug', title: { ar: '', en: 'y' } })).status).toBe(400);
    const ok = await admin.post('/api/admin/content/blog').send({ slug: 'ok-slug', title: { ar: 'عنوان', en: 'Title' }, body: { ar: 'نص', en: 'Text' } });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ status: 'draft', publishedAt: null });
  });
});
