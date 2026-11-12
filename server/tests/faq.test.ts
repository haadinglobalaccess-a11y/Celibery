/**
 * FAQ system (CELIBERY_FAQ_IMPLEMENTATION_REPORT.md): full admin → storefront workflow, access
 * control and content-safety rules. All content here is test data created by the test itself.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Faq } from '../src/models';
import { app, client, createCustomer, createStaff, useDatabase } from './helpers';

useDatabase();

type PublicFaq = { id: string; question: { ar: string; en: string }; answer: { ar: string; en: string }; categoryId: string | null; featured: boolean };
const publicFaqs = async () => (await client().get('/api/faq')).body.data as { items: PublicFaq[]; categories: { id: string; name: { en: string } }[]; settings: Record<string, unknown> };
const homeFaq = async () => (await client().get('/api/home')).body.data.faq as { enabled: boolean; items: PublicFaq[] };

const sample = (n: string, extra: Record<string, unknown> = {}) => ({
  question: { en: `[Test] How does delivery work ${n}?`, ar: `[اختبار] كيف يعمل التوصيل ${n}؟` },
  answer: { en: `Test answer ${n}.\n\n- First point\n- Second point`, ar: `إجابة اختبار ${n}.` },
  ...extra,
});

describe('FAQ workflow: admin → API → storefront', () => {
  it('runs the complete lifecycle (draft, publish, homepage, edit, reorder, unpublish, delete)', async () => {
    const editor = await createStaff('content_editor');

    // 1–2. Bilingual FAQ saved as draft, in a new category.
    const cat = await editor.post('/api/admin/faq/categories').send({ name: { en: 'Orders & Delivery (test)', ar: 'الطلبات والتوصيل (اختبار)' } });
    expect(cat.status).toBe(201);
    expect(cat.body.data.slug).toBe('orders-delivery-test');
    const created = await editor.post('/api/admin/faq').send(sample('A', { categoryId: cat.body.data._id, status: 'draft' }));
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;
    expect(created.body.data.status).toBe('draft');

    // 3. Draft is not public anywhere.
    expect((await publicFaqs()).items.find((f) => f.id === id)).toBeUndefined();
    expect((await homeFaq()).items.find((f) => f.id === id)).toBeUndefined();

    // 4–5. Published → on /api/faq (with its category), not yet on the homepage.
    expect((await editor.patch(`/api/admin/faq/${id}/status`).send({ status: 'published' })).status).toBe(200);
    let page = await publicFaqs();
    const pub = page.items.find((f) => f.id === id)!;
    expect(pub.question.en).toContain('How does delivery work A');
    expect(pub.question.ar).toContain('كيف يعمل التوصيل');
    expect(page.categories.map((c) => c.id)).toContain(cat.body.data._id);
    expect((await homeFaq()).items.find((f) => f.id === id)).toBeUndefined();

    // 6–7. Homepage visibility.
    const full = (await editor.get(`/api/admin/faq/${id}`)).body.data;
    const body = { ...sample('A'), categoryId: cat.body.data._id, status: 'published', showOnHomepage: true };
    expect((await editor.put(`/api/admin/faq/${id}`).send(body)).status).toBe(200);
    expect(full.createdAt).toBeTruthy();
    const home = await homeFaq();
    expect(home.enabled).toBe(true);
    expect(home.items.map((f) => f.id)).toContain(id);

    // 8–9. Edited answer is what the storefront shows.
    expect((await editor.put(`/api/admin/faq/${id}`).send({ ...body, answer: { en: 'Updated answer.', ar: 'إجابة محدثة.' } })).status).toBe(200);
    expect((await publicFaqs()).items.find((f) => f.id === id)!.answer).toEqual({ en: 'Updated answer.', ar: 'إجابة محدثة.' });

    // 10–11. Order follows the admin order (reorder and move).
    const second = await editor.post('/api/admin/faq').send(sample('B', { status: 'published', showOnHomepage: true }));
    const id2 = second.body.data._id as string;
    const order = async () => (await publicFaqs()).items.map((f) => f.id).filter((x) => x === id || x === id2);
    expect(await order()).toEqual([id, id2]);
    expect((await editor.post('/api/admin/faq/reorder').send({ ids: [id2, id] })).status).toBe(200);
    expect(await order()).toEqual([id2, id]);
    expect((await homeFaq()).items.map((f) => f.id).filter((x) => x === id || x === id2)).toEqual([id2, id]);
    expect((await editor.post(`/api/admin/faq/${id}/move`).send({ direction: 'up' })).body.data.moved).toBe(true);
    expect(await order()).toEqual([id, id2]);

    // 12–13. Unpublished → gone from both public views.
    expect((await editor.patch(`/api/admin/faq/${id}/status`).send({ status: 'draft' })).status).toBe(200);
    expect((await publicFaqs()).items.find((f) => f.id === id)).toBeUndefined();
    expect((await homeFaq()).items.find((f) => f.id === id)).toBeUndefined();

    // 14. Deleted.
    expect((await editor.delete(`/api/admin/faq/${id}`)).status).toBe(200);
    expect((await editor.get(`/api/admin/faq/${id}`)).status).toBe(404);
    expect((await editor.delete(`/api/admin/faq/${id2}`)).status).toBe(200);
  });

  it('public responses contain published content only, with allow-listed fields', async () => {
    const editor = await createStaff('content_editor');
    await editor.post('/api/admin/faq').send(sample('P', { status: 'published', seoTitle: { en: 'Internal SEO', ar: '' } }));
    await editor.post('/api/admin/faq').send(sample('D', { status: 'draft' }));
    const res = await client().get('/api/faq');
    expect(res.headers['cache-control']).toBe('no-cache');
    const json = JSON.stringify(res.body);
    expect(json).toContain('delivery work P');
    expect(json).not.toContain('delivery work D');
    expect(json).not.toMatch(/createdBy|updatedBy|"status"|publishedAt|showOnHomepage|sortOrder|Internal SEO/);
    for (const f of res.body.data.items) expect(Object.keys(f).sort()).toEqual(['answer', 'categoryId', 'featured', 'id', 'question']);
    await Faq.deleteMany({});
  });

  it('homepage preview respects the configured count and on/off switch', async () => {
    const editor = await createStaff('content_editor');
    for (const n of ['1', '2', '3']) await editor.post('/api/admin/faq').send(sample(n, { status: 'published', showOnHomepage: true }));
    expect((await editor.put('/api/admin/faq/settings').send({ homepageLimit: 2, title: { en: 'Questions, answered', ar: 'أسئلة وأجوبة' } })).status).toBe(200);
    let home = (await client().get('/api/home')).body.data.faq;
    expect(home.items).toHaveLength(2);
    expect(home.title.en).toBe('Questions, answered');
    await editor.put('/api/admin/faq/settings').send({ homepageEnabled: false });
    home = (await client().get('/api/home')).body.data.faq;
    expect(home.enabled).toBe(false);
    expect(home.items).toHaveLength(0);
    await editor.put('/api/admin/faq/settings').send({ homepageEnabled: true, homepageLimit: 6 });
    await Faq.deleteMany({});
  });

  it('hidden categories hide their questions; categories holding FAQs are only deleted with an explicit reassignment', async () => {
    const editor = await createStaff('content_editor');
    const a = (await editor.post('/api/admin/faq/categories').send({ name: { en: 'Cat A', ar: 'أ' } })).body.data;
    const b = (await editor.post('/api/admin/faq/categories').send({ name: { en: 'Cat B', ar: 'ب' } })).body.data;
    const f = (await editor.post('/api/admin/faq').send(sample('C', { status: 'published', categoryId: a._id }))).body.data;
    expect((await publicFaqs()).items.map((x) => x.id)).toContain(f._id);
    await editor.put(`/api/admin/faq/categories/${a._id}`).send({ name: a.name, visible: false });
    expect((await publicFaqs()).items.map((x) => x.id)).not.toContain(f._id);
    await editor.put(`/api/admin/faq/categories/${a._id}`).send({ name: a.name, visible: true });

    const blocked = await editor.delete(`/api/admin/faq/categories/${a._id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');
    expect((await editor.delete(`/api/admin/faq/categories/${a._id}?reassignTo=${b._id}`)).body.data.moved).toBe(1);
    expect(String((await Faq.findById(f._id).lean())!.category)).toBe(b._id);
    const list = (await editor.get('/api/admin/faq/categories')).body.data;
    expect(list.categories.find((c: { _id: string }) => c._id === b._id).faqCount).toBe(1);
    expect((await editor.delete(`/api/admin/faq/categories/${b._id}?reassignTo=none`)).status).toBe(200);
    expect((await Faq.findById(f._id).lean())!.category).toBeNull();
    await Faq.deleteMany({});
  });

  it('admin list: search, filters, sorting, stats; duplicate makes a draft copy', async () => {
    const editor = await createStaff('content_editor');
    const one = (await editor.post('/api/admin/faq').send({ question: { en: 'Warranty length?', ar: '' }, answer: { en: 'Twelve months.', ar: '' }, status: 'published', showOnHomepage: true })).body.data;
    await editor.post('/api/admin/faq').send({ question: { en: '', ar: 'هل الشحن مجاني؟' }, answer: { en: '', ar: 'نعم.' } });
    let r = await editor.get('/api/admin/faq?q=warranty');
    expect(r.body.data.map((f: { _id: string }) => f._id)).toEqual([one._id]);
    expect((await editor.get(`/api/admin/faq?q=${encodeURIComponent('الشحن')}`)).body.data).toHaveLength(1);
    expect((await editor.get('/api/admin/faq?status=draft')).body.data).toHaveLength(1);
    expect((await editor.get('/api/admin/faq?homepage=1')).body.data).toHaveLength(1);
    r = await editor.get('/api/admin/faq?sort=updated');
    expect(r.body.meta.stats).toEqual({ total: 2, published: 1, draft: 1, homepage: 1, categories: expect.any(Number) });
    const copy = await editor.post(`/api/admin/faq/${one._id}/duplicate`).send({});
    expect(copy.status).toBe(201);
    expect(copy.body.data.status).toBe('draft');
    expect(copy.body.data.showOnHomepage).toBe(false);
    expect(copy.body.data.question.en).toBe('Warranty length?');
    await Faq.deleteMany({});
  });
});

describe('FAQ access control', () => {
  it('anonymous visitors, customers and staff without content:write cannot read or modify FAQs', async () => {
    const editor = await createStaff('content_editor');
    const f = (await editor.post('/api/admin/faq').send(sample('X', { status: 'published' }))).body.data;
    const { c: customer } = await createCustomer();
    const orders = await createStaff('order_manager');
    const anon = client();
    for (const [who, c, code] of [
      ['anonymous', anon, 401],
      ['customer', customer, 403],
      ['order manager', orders, 403],
    ] as const) {
      expect((await c.get('/api/admin/faq')).status, who).toBe(code);
      expect((await c.post('/api/admin/faq').send(sample('Y'))).status, who).toBe(code);
      expect((await c.put(`/api/admin/faq/${f._id}`).send(sample('Z'))).status, who).toBe(code);
      expect((await c.patch(`/api/admin/faq/${f._id}/status`).send({ status: 'draft' })).status, who).toBe(code);
      expect((await c.delete(`/api/admin/faq/${f._id}`)).status, who).toBe(code);
      expect((await c.post('/api/admin/faq/categories').send({ name: { en: 'x', ar: '' } })).status, who).toBe(code);
      expect((await c.put('/api/admin/faq/settings').send({ homepageLimit: 1 })).status, who).toBe(code);
    }
    expect((await Faq.findById(f._id).lean())!.status).toBe('published');
    // CSRF: even a valid staff session cannot write without the request header.
    expect((await editor.agent.post('/api/admin/faq').send(sample('CSRF'))).status).toBe(403);
    // There is no public write route.
    expect((await request(app).post('/api/faq').set('X-Requested-With', 'celibery').send(sample('W'))).status).toBe(404);
    await Faq.deleteMany({});
  });
});

describe('FAQ content safety and validation', () => {
  it('refuses HTML, script and unsafe links; keeps safe Markdown, Arabic and links intact', async () => {
    const editor = await createStaff('content_editor');
    const bad = [
      { en: '<script>alert(1)</script>', ar: '' },
      { en: 'Hi <img src=x onerror=alert(1)>', ar: '' },
      { en: 'Click [here](javascript:alert(1))', ar: '' },
      { en: 'Go [there](//evil.example)', ar: '' },
      { en: 'Go [there](data:text/html,<b>x</b>)', ar: '' },
    ];
    for (const answer of bad) {
      const r = await editor.post('/api/admin/faq').send({ question: { en: 'Q?', ar: '' }, answer });
      expect(r.status, answer.en).toBe(400);
    }
    expect((await editor.post('/api/admin/faq').send({ question: { en: '<b>Q</b>?', ar: '' }, answer: { en: 'A', ar: '' } })).status).toBe(400);
    const okRes = await editor.post('/api/admin/faq').send({
      question: { en: 'Where is my order?', ar: 'أين طلبي؟' },
      answer: { en: '**Track it** on [the tracking page](/en/track) or [I Mile](https://www.imile.com/track).\r\n\r\n1. Open the link\n2. Enter the number', ar: 'تتبّع طلبك من **صفحة التتبع**.' },
    });
    expect(okRes.status).toBe(201);
    expect(okRes.body.data.answer.en).toContain('[the tracking page](/en/track)');
    expect(okRes.body.data.answer.en).not.toContain('\r');
    expect(okRes.body.data.answer.ar).toBe('تتبّع طلبك من **صفحة التتبع**.');
    await Faq.deleteMany({});
  });

  it('rejects incomplete or unpublishable content, operator injection and mass assignment', async () => {
    const editor = await createStaff('content_editor');
    expect((await editor.post('/api/admin/faq').send({ question: { en: 'Only a question?', ar: '' }, answer: { en: '', ar: '' } })).status).toBe(400);
    expect((await editor.post('/api/admin/faq').send({ question: { en: '', ar: '' }, answer: { en: '', ar: '' }, status: 'published' })).status).toBe(400);
    expect((await editor.post('/api/admin/faq').send({ ...sample('L'), answer: { en: 'x'.repeat(6001), ar: '' } })).status).toBe(400);
    expect((await editor.post('/api/admin/faq').send({ ...sample('M'), categoryId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })).status).toBe(400);
    expect((await editor.get('/api/admin/faq?q[$ne]=x')).status).toBe(400);
    expect((await editor.get('/api/admin/faq?limit=100000')).status).toBe(400);
    expect((await editor.get(`/api/admin/faq?q=${'a'.repeat(101)}`)).status).toBe(400);
    expect((await editor.post('/api/admin/faq').send({ ...sample('N'), $where: '1' })).status).toBe(400);
    const r = await editor.post('/api/admin/faq').send({ ...sample('O'), _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', createdBy: 'cccccccccccccccccccccccc', publishedAt: '2000-01-01', createdAt: '2000-01-01' });
    expect(r.status).toBe(201);
    expect(r.body.data._id).not.toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(r.body.data.createdBy).not.toBe('cccccccccccccccccccccccc');
    expect(r.body.data.publishedAt).toBeUndefined();
    expect(new Date(r.body.data.createdAt).getFullYear()).toBeGreaterThan(2020);
    expect((await editor.post('/api/admin/faq/reorder').send({ ids: [r.body.data._id, r.body.data._id] })).status).toBe(400);
    await Faq.deleteMany({});
  });

  it('lists the FAQ page in the sitemap only once something is published', async () => {
    expect((await client().get('/sitemap.xml')).text).not.toContain('/faq<');
    const editor = await createStaff('content_editor');
    await editor.post('/api/admin/faq').send(sample('S', { status: 'published' }));
    const xml = (await client().get('/sitemap.xml')).text;
    expect(xml).toContain('/ar/faq</loc>');
    expect(xml).toContain('/en/faq</loc>');
    await Faq.deleteMany({});
  });
});
