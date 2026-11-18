import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateIntegrations } from '../src/integrations/credentials';
import { MediaAsset, Notification, Product, RestockSubscription, Settings } from '../src/models';
import { client, createCustomer, createStaff, useDatabase } from './helpers';
import { eventually, startSmtpSink } from './smtp-sink';

/**
 * Phase 4: packaging images, "notify me when restocked" (real SMTP delivery to an in-process mail
 * server), and the product-page trust benefits — all through the real API.
 */
useDatabase();
const shop = client();
let sink: Awaited<ReturnType<typeof startSmtpSink>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let admin: Awaited<ReturnType<typeof createStaff>>;

const productBy = (sku: string) => Product.findOne({ sku }).lean().then((p) => p!);
const setStock = async (id: string, value: number) => {
  const r = await admin.post(`/api/admin/inventory/${id}/adjust`).send({ mode: 'set', value, reason: 'Phase 4 test', type: 'restock' });
  if (r.status !== 200 && r.body?.error?.code !== 'NO_CHANGE') throw new Error(JSON.stringify(r.body));
};
const mailsTo = (email: string) => sink.messages.filter((m) => m.to.includes(email));
const smtp = (enabled: boolean) => superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled, mode: 'live' });

beforeAll(async () => {
  sink = await startSmtpSink();
  superAdmin = await createStaff('admin');
  admin = await createStaff('administrator');
  await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: { host: '127.0.0.1', port: String(sink.port), security: 'starttls', fromEmail: 'store@celibery.test', fromName: 'CELIBERY' } });
  await superAdmin.post('/api/admin/integrations/smtp/live/verify');
  expect((await smtp(true)).status).toBe(200);
});
afterAll(async () => {
  invalidateIntegrations();
  await sink?.close();
});

describe('notify me when restocked', () => {
  it('only for out-of-stock products; validates email; one request per product and email', async () => {
    const inStock = await productBy('DEMO-PB-10K');
    expect((await shop.post(`/api/products/${inStock.slug}/restock`).send({ email: 'a@test.local' })).body.error.code).toBe('IN_STOCK');
    const out = await productBy('DEMO-HP-WIRED'); // seeded with stock 0
    expect(out.stock).toBe(0);
    expect((await shop.post(`/api/products/${out.slug}/restock`).send({ email: 'not-an-email' })).status).toBe(400);
    expect((await shop.post(`/api/products/${out.slug}/restock`).send({})).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await shop.post(`/api/products/${out.slug}/restock`).send({ email: 'Wait@Test.local', lang: 'en' })).status).toBe(201);
    expect(await RestockSubscription.countDocuments({ product: out._id, email: 'wait@test.local' })).toBe(1);
    // Signed-in customer: the account email is used when none is typed.
    const { c, email } = await createCustomer();
    expect((await c.post(`/api/products/${out.slug}/restock`).send({ lang: 'ar' })).status).toBe(201);
    expect(await RestockSubscription.countDocuments({ product: out._id, email: email.toLowerCase() })).toBe(1);
  });

  it('restocking emails every waiting customer once, with the product name and link', async () => {
    const out = await productBy('DEMO-HP-WIRED');
    await setStock(String(out._id), 5);
    await eventually(() => mailsTo('wait@test.local').length === 1 || null);
    const raw = mailsTo('wait@test.local')[0].data;
    expect(raw).toMatch(/Back in stock/);
    expect(raw.replace(/=\r?\n/g, '')).toContain(`/en/p/${out.slug}`);
    const subs = await RestockSubscription.find({ product: out._id }).lean();
    await eventually(async () => ((await RestockSubscription.countDocuments({ product: out._id, status: 'notified' })) === subs.length) || null);
    expect(await Notification.countDocuments({ template: 'product.back_in_stock', status: 'sent' })).toBe(subs.length);

    // More stock, repeated triggers, concurrent sweeps → no second email.
    await setStock(String(out._id), 9);
    await Promise.all([1, 2, 3].map(() => admin.post(`/api/admin/products/${out._id}/restock/send`).send({})));
    await new Promise((r) => setTimeout(r, 300));
    expect(mailsTo('wait@test.local')).toHaveLength(1);

    // After being notified the customer may ask again for a future restock.
    await setStock(String(out._id), 0);
    expect((await shop.post(`/api/products/${out.slug}/restock`).send({ email: 'wait@test.local' })).status).toBe(201);
    expect(await RestockSubscription.countDocuments({ product: out._id, email: 'wait@test.local' })).toBe(2);
  });

  it('concurrent sweeps claim each request once', async () => {
    const p = await productBy('DEMO-PB-20K');
    await setStock(String(p._id), 0);
    const emails = Array.from({ length: 6 }, (_, i) => `race${i}@test.local`);
    for (const email of emails) await shop.post(`/api/products/${p.slug}/restock`).send({ email });
    await Product.updateOne({ _id: p._id }, { $set: { stock: 4 } }); // stock back without a trigger
    await Promise.all([1, 2, 3, 4].map(() => admin.post(`/api/admin/products/${p._id}/restock/send`).send({})));
    await eventually(async () => ((await RestockSubscription.countDocuments({ product: p._id, status: 'notified' })) === 6) || null);
    for (const email of emails) expect(mailsTo(email)).toHaveLength(1);
  });

  it('email not configured: nothing is lost — sent once email is set up', async () => {
    const p = await productBy('DEMO-AD-65W');
    await setStock(String(p._id), 0);
    await shop.post(`/api/products/${p.slug}/restock`).send({ email: 'later@test.local' });
    await smtp(false);
    await setStock(String(p._id), 3);
    await eventually(async () => (await RestockSubscription.findOne({ email: 'later@test.local' }).lean())?.lastError || null);
    const waiting = (await RestockSubscription.findOne({ email: 'later@test.local' }).lean())!;
    expect(waiting).toMatchObject({ status: 'active', open: true, attempts: 0, lastError: 'Email (SMTP) is not configured' });
    expect(mailsTo('later@test.local')).toHaveLength(0);
    await smtp(true);
    await RestockSubscription.updateOne({ _id: waiting._id }, { $set: { nextAttemptAt: new Date() } }); // skip the 1-hour wait
    await admin.post(`/api/admin/products/${p._id}/restock/send`).send({});
    await eventually(() => mailsTo('later@test.local').length === 1 || null);
  });

  it('delivery failures retry with backoff, then stop as failed', async () => {
    const p = await productBy('DEMO-AD-30W');
    await setStock(String(p._id), 0);
    await shop.post(`/api/products/${p.slug}/restock`).send({ email: 'flaky@test.local' });
    sink.setFailing(true);
    try {
      await setStock(String(p._id), 2);
      await eventually(async () => ((await RestockSubscription.findOne({ email: 'flaky@test.local' }).lean())?.attempts ?? 0) >= 1 || null);
      let s = (await RestockSubscription.findOne({ email: 'flaky@test.local' }).lean())!;
      expect(s).toMatchObject({ status: 'active', attempts: 1, open: true });
      expect(s.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
      for (let i = 0; i < 4; i++) {
        await RestockSubscription.updateOne({ _id: s._id }, { $set: { nextAttemptAt: new Date() } });
        await admin.post(`/api/admin/products/${p._id}/restock/send`).send({});
      }
      s = (await RestockSubscription.findOne({ email: 'flaky@test.local' }).lean())!;
      expect(s).toMatchObject({ status: 'failed', open: false, attempts: 5 });
    } finally {
      sink.setFailing(false);
    }
  });

  it('stock that returns through a cancelled order is picked up by the scheduled sweep', async () => {
    const p = await productBy('DEMO-PB-10K');
    await setStock(String(p._id), 0);
    await shop.post(`/api/products/${p.slug}/restock`).send({ email: 'job@test.local' });
    await Product.updateOne({ _id: p._id }, { $inc: { stock: 1 } }); // e.g. a released reservation
    const { runReservationJob } = await import('../src/jobs');
    const r = await runReservationJob();
    expect(r.restock.sent).toBeGreaterThanOrEqual(1);
    expect(mailsTo('job@test.local')).toHaveLength(1);
  });

  it('admin sees requests and their delivery status; customers never see other emails', async () => {
    const p = await productBy('DEMO-HP-WIRED');
    const r = await admin.get(`/api/admin/products/${p._id}/restock`);
    expect(r.status).toBe(200);
    expect(r.body.data.counts.notified).toBeGreaterThanOrEqual(2);
    expect(r.body.data.items[0]).toHaveProperty('email');
    expect((await shop.get(`/api/admin/products/${p._id}/restock`)).status).toBe(401);
    const pub = await shop.get(`/api/products/${p.slug}`);
    expect(JSON.stringify(pub.body)).not.toContain('@test.local');
  });
});

describe('packaging images', () => {
  it('are saved, ordered, removed and published separately from product images', async () => {
    const p = await productBy('DEMO-AD-65W');
    const before = p.images;
    const img = (n: number) => ({ url: `https://cdn.example.com/box-${n}.jpg`, alt: { en: `Box ${n}`, ar: `علبة ${n}` } });
    expect((await admin.put(`/api/admin/products/${p._id}`).send({ packagingImages: [img(1), img(2), img(3)] })).status).toBe(200);
    let pub = (await shop.get(`/api/products/${p.slug}`)).body.data;
    expect(pub.packagingImages.map((i: { url: string }) => i.url)).toEqual([img(1).url, img(2).url, img(3).url]);
    expect(pub.images).toEqual(expect.arrayContaining(before.map((i) => expect.objectContaining({ url: i.url }))));
    await admin.put(`/api/admin/products/${p._id}`).send({ packagingImages: [img(3), img(1)] });
    pub = (await shop.get(`/api/products/${p.slug}`)).body.data;
    expect(pub.packagingImages.map((i: { url: string }) => i.url)).toEqual([img(3).url, img(1).url]);
    expect((await productBy('DEMO-AD-65W')).images).toHaveLength(before.length); // product photos untouched
    // A packaging photo in use cannot be deleted from the media library.
    const asset = await MediaAsset.create({ kind: 'image', source: 'upload', status: 'ready', url: img(3).url, storage: 'local', key: '' });
    expect((await admin.delete(`/api/admin/media/${asset._id}`)).status).toBe(409);
    // Listing cards stay light (no packaging payload).
    const list = (await shop.get('/api/products?limit=50')).body.data;
    expect(JSON.stringify(list)).not.toContain('packagingImages');
  });
});

describe('product page trust benefits', () => {
  it('default to the four approved benefits; admin can edit, reorder, hide and translate them', async () => {
    let pub = (await shop.get('/api/settings/public')).body.data;
    expect(pub.productTrust.map((x: { title: { en: string } }) => x.title.en)).toEqual(['2-Year Warranty', '30-Day Return/Refund', '2–3 Days Fast Delivery', 'Customer Support']);
    expect(pub.productTrust[1].title.ar).toBe('إرجاع واسترداد خلال 30 يوماً');
    const items = [
      { icon: 'support', title: { en: 'Customer Support', ar: 'دعم العملاء' }, description: { en: 'WhatsApp and email', ar: 'واتساب والبريد' }, link: '/support', visible: true },
      { icon: 'shield', title: { en: '2-Year Warranty', ar: 'ضمان لمدة سنتين' }, link: '/page/warranty', visible: false },
    ];
    expect((await admin.put('/api/admin/content/product-trust').send({ items })).status).toBe(200);
    pub = (await shop.get('/api/settings/public')).body.data;
    expect(pub.productTrust).toHaveLength(1);
    expect(pub.productTrust[0]).toMatchObject({ icon: 'support', description: { en: 'WhatsApp and email' } });
    expect((await admin.put('/api/admin/content/product-trust').send({ items: [{ icon: 'shield', title: { en: '', ar: '' } }] })).status).toBe(400);
    expect((await admin.put('/api/admin/content/product-trust').send({ items: [{ icon: 'shield', title: { en: 'x' }, link: 'javascript:alert(1)' }] })).status).toBe(400);
    const orders = await createStaff('order_manager');
    expect((await orders.put('/api/admin/content/product-trust').send({ items })).status).toBe(403);
    // Back to the approved defaults for other tests.
    await Settings.updateOne({ key: 'store' }, { $unset: { productTrust: 1 } });
  });
});
