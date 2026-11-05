/**
 * Premium-upgrade integration tests (3 Nov 2026): refund ledger, webhook lifecycle, admin
 * settings permissions, encrypted gateway credentials, media upload/URL, policy approval and
 * checkout delivery/COD rules. Runs against the in-memory MongoDB replica set like the other
 * suites. Payment gateways are the sandbox or mocked HTTP — never a live gateway.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { GatewayError } from '../src/integrations/payments/http';
import { sandboxProvider } from '../src/integrations/payments/sandbox';
import { IntegrationCredential, MediaAsset, Order, Page, PageRevision, Payment, ProcessedEvent, Product, Refund, Role, Settings } from '../src/models';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';

useDatabase();

const shop = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

async function paidOrder(sku = 'DEMO-AD-30W', qty = 2) {
  const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid(sku), quantity: qty }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'en' });
  const { order, accessToken, redirectUrl } = r.body.data;
  await shop.post(`/api/payments/sandbox/${redirectUrl.split('/').pop()}/complete`).send({ outcome: 'success' });
  await shop.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
  const doc = await Order.findOne({ orderNumber: order.orderNumber }).lean();
  return { id: String(doc!._id), total: doc!.total };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = '';
  (env as Record<string, unknown>).MOYASAR_SECRET_KEY = '';
});

describe('refund ledger', () => {
  it('a repeated submission with the same idempotency key returns the same refund', async () => {
    const o = await paidOrder();
    const admin = await createStaff('admin');
    const body = { amount: 1000, reason: 'Double click', idempotencyKey: 'rf_test_double_click_1' };
    const [a, b] = await Promise.all([admin.post(`/api/admin/orders/${o.id}/refund`).send(body), admin.post(`/api/admin/orders/${o.id}/refund`).send(body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.refundId).toBe(b.body.data.refundId);
    expect(await Refund.countDocuments({ order: o.id })).toBe(1);
    expect((await Order.findById(o.id).lean())!.refundedAmount).toBe(1000);
  });

  it('many concurrent refunds never exceed the total, and order, payment and ledger agree', async () => {
    const o = await paidOrder(); // 2 × 69.00 = 138.00 SAR
    const admin = await createStaff('admin');
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 4000, reason: `race ${i}` })));
    const okCount = results.filter((r) => r.status === 200).length;
    expect(okCount).toBe(3); // 3 × 40.00 ≤ 138.00 < 4 × 40.00
    expect(results.filter((r) => r.status === 422).length).toBe(3);
    const order = (await Order.findById(o.id).lean())!;
    const payment = (await Payment.findOne({ order: o.id, provider: 'sandbox' }).lean())!;
    const succeeded = await Refund.find({ order: o.id, status: 'succeeded' }).lean();
    expect(order.refundedAmount).toBe(12000);
    expect(order.refundReservedAmount).toBe(0);
    expect(payment.refundedAmount).toBe(12000);
    expect(succeeded.reduce((s, r) => s + r.amount, 0)).toBe(12000);
    expect(payment.refunds.length).toBe(3);
  });

  it('a definitive gateway refusal fails the refund and releases the reservation', async () => {
    const o = await paidOrder();
    const admin = await createStaff('admin');
    vi.spyOn(sandboxProvider, 'refund').mockRejectedValueOnce(new GatewayError('sandbox', 400, true, 'refused'));
    const r = await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 5000, reason: 'refused' });
    expect(r.status).toBe(422);
    const order = (await Order.findById(o.id).lean())!;
    expect(order.refundedAmount).toBe(0);
    expect(order.refundReservedAmount).toBe(0);
    expect((await Refund.findOne({ order: o.id }).lean())!.status).toBe('failed');
  });

  it('an uncertain gateway outcome keeps the amount reserved until reconciliation decides', async () => {
    const o = await paidOrder();
    const admin = await createStaff('admin');
    vi.spyOn(sandboxProvider, 'refund').mockRejectedValueOnce(new GatewayError('sandbox', null, false, 'timeout'));
    const r = await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 10000, reason: 'timeout' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('reconciliation_required');
    let order = (await Order.findById(o.id).lean())!;
    expect(order.refundedAmount).toBe(0); // never counted before the gateway confirms
    expect(order.refundReservedAmount).toBe(10000); // …but held so it cannot be refunded twice
    // Only 38.00 SAR is refundable meanwhile.
    expect((await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 5000, reason: 'second' })).status).toBe(422);
    // The sandbox gateway never received the refund → reconciliation marks it failed and releases the hold.
    const rec = await admin.post(`/api/admin/orders/${o.id}/refunds/reconcile`).send({});
    expect(rec.status).toBe(200);
    order = (await Order.findById(o.id).lean())!;
    expect(order.refundReservedAmount).toBe(0);
    expect((await Refund.findOne({ order: o.id }).lean())!.status).toBe('failed');
  });

  it('a refund the gateway made is never rolled back when recording it fails; reconciliation completes it', async () => {
    const o = await paidOrder();
    const admin = await createStaff('admin');
    // The gateway call really happens (sandbox records it); the first database write afterwards fails.
    vi.spyOn(Order, 'updateOne').mockRejectedValueOnce(new Error('database unavailable'));
    const r = await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 3000, reason: 'db failure' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('reconciliation_required');
    vi.restoreAllMocks();
    let order = (await Order.findById(o.id).lean())!;
    expect(order.refundReservedAmount).toBe(3000);
    await admin.post(`/api/admin/orders/${o.id}/refunds/reconcile`).send({});
    order = (await Order.findById(o.id).lean())!;
    expect(order.refundedAmount).toBe(3000);
    expect(order.refundReservedAmount).toBe(0);
    expect((await Refund.findOne({ order: o.id }).lean())!.status).toBe('succeeded');
    expect((await Payment.findOne({ order: o.id, provider: 'sandbox' }).lean())!.refundedAmount).toBe(3000);
  });

  it('staff can resolve an uncertain refund manually (audited, permission-checked)', async () => {
    const o = await paidOrder();
    const admin = await createStaff('admin');
    vi.spyOn(sandboxProvider, 'refund').mockRejectedValueOnce(new GatewayError('sandbox', 503, false, 'unavailable'));
    const r = await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 2000, reason: 'manual' });
    const refundId = r.body.data.refundId;
    const manager = await createStaff('order_manager');
    expect((await manager.post(`/api/admin/orders/${o.id}/refunds/${refundId}/resolve`).send({ outcome: 'failed', note: 'checked' })).status).toBe(403);
    const res = await admin.post(`/api/admin/orders/${o.id}/refunds/${refundId}/resolve`).send({ outcome: 'failed', note: 'Gateway dashboard shows no refund' });
    expect(res.status).toBe(200);
    expect((await Order.findById(o.id).lean())!.refundReservedAmount).toBe(0);
  });
});

describe('webhook lifecycle', () => {
  async function moyasarOrder(ref: string) {
    (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = 'whsec';
    (env as Record<string, unknown>).MOYASAR_SECRET_KEY = 'sk_test_x';
    const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-65W'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const order = (await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean())!;
    await Payment.updateMany({ order: order._id }, { $set: { provider: 'moyasar', providerRef: ref } });
    return order;
  }

  it('an invalid signature is rejected before anything is recorded', async () => {
    (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = 'whsec';
    const before = await ProcessedEvent.countDocuments();
    const r = await shop.post('/api/webhooks/moyasar').send({ id: 'evt_bad', secret_token: 'nope', data: { invoice_id: 'x' } });
    expect(r.status).toBe(403);
    expect(await ProcessedEvent.countDocuments()).toBe(before);
  });

  it('a failed processing attempt is retried on re-delivery instead of being dropped as a duplicate', async () => {
    const order = await moyasarOrder('inv_retry_1');
    const body = { id: 'evt_retry_1', type: 'payment_paid', secret_token: 'whsec', data: { invoice_id: 'inv_retry_1' } };
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))));
    const first = await shop.post('/api/webhooks/moyasar').send(body);
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect((await ProcessedEvent.findOne({ eventId: 'evt_retry_1' }).lean())!.status).toBe('failed');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'inv_retry_1', status: 'paid', amount: order.total, currency: 'SAR', payments: [] }))));
    const second = await shop.post('/api/webhooks/moyasar').send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.result).toBe('paid');
    const ev = (await ProcessedEvent.findOne({ eventId: 'evt_retry_1' }).lean())!;
    expect(ev.status).toBe('processed');
    expect(ev.attempts).toBe(2);
    const third = await shop.post('/api/webhooks/moyasar').send(body);
    expect(third.body.data.duplicate).toBe(true);
    const after = (await Order.findById(order._id).lean())!;
    expect(after.history.filter((h) => h.status === 'paid').length).toBe(1);
  });
});

describe('settings & permissions', () => {
  it('legal identity needs business:write; other settings need settings:write', async () => {
    await Role.create({ key: 'test_settings_only', name: { ar: 'إعدادات', en: 'Settings only' }, permissions: ['settings:write'] });
    const settingsOnly = await createStaff('test_settings_only');
    expect((await settingsOnly.put('/api/admin/settings').send({ business: { crNumber: '1010101010' } })).status).toBe(403);
    expect((await settingsOnly.put('/api/admin/settings').send({ business: { phone: '0110000000' }, announcement: { enabled: true, text: { ar: 'مرحبا', en: 'Hello' }, link: '/shop' } })).status).toBe(200);
    const admin = await createStaff('admin');
    expect((await admin.put('/api/admin/settings').send({ business: { crNumber: '1010101010', vatNumber: '300000000000003' } })).status).toBe(200);
    const s = await Settings.findOne({ key: 'store' }).lean().orFail();
    expect(s.business.crNumber).toBe('1010101010');
    expect(s.announcement.text.en).toBe('Hello');
    expect((await settingsOnly.get('/api/admin/settings')).body.data.hosting.mediaStorage.provider).toBeTruthy();
  });

  it('COD rules, free-delivery threshold and delivery pause are configurable and enforced at checkout', async () => {
    const admin = await createStaff('admin');
    const r = await admin.put('/api/admin/settings').send({ commerce: { codEnabled: true, codAllowedCities: ['Jeddah', 'جدة'], codMinOrderTotal: null } });
    expect(r.status).toBe(200);
    const item = { productId: await pid('DEMO-AD-30W'), quantity: 1 };
    const qRiyadh = await shop.post('/api/cart/quote').send({ items: [item], city: 'Riyadh' });
    expect(qRiyadh.body.data.codAvailable).toBe(false);
    expect(qRiyadh.body.data.codUnavailableReason).toBe('city');
    const qJeddah = await shop.post('/api/cart/quote').send({ items: [item], city: 'jeddah' });
    expect(qJeddah.body.data.codAvailable).toBe(true);
    const codRiyadh = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [item], contact, shippingAddress: address, paymentMethod: 'cod' });
    expect(codRiyadh.body.error.code).toBe('COD_UNAVAILABLE');

    await admin.put('/api/admin/settings').send({ commerce: { freeDelivery: false, deliveryFee: 25, freeDeliveryThreshold: 100 } });
    expect((await shop.post('/api/cart/quote').send({ items: [item] })).body.data.deliveryFee).toBe(2500); // 69 SAR < 100
    expect((await shop.post('/api/cart/quote').send({ items: [{ ...item, quantity: 2 }] })).body.data.deliveryFee).toBe(0); // 138 ≥ 100

    await admin.put('/api/admin/settings').send({ commerce: { shippingAvailable: false } });
    const paused = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [item], contact, shippingAddress: address, paymentMethod: 'card' });
    expect(paused.body.error.code).toBe('SHIPPING_PAUSED');
    await admin.put('/api/admin/settings').send({ commerce: { shippingAvailable: true, freeDelivery: true, codEnabled: false, codAllowedCities: [] } });
  });
});

describe('payment gateway credentials (encrypted, masked, permission-gated)', () => {
  it('only payments:manage can see or change credentials; secrets are never returned', async () => {
    const administrator = await createStaff('administrator');
    expect((await administrator.get('/api/admin/integrations')).status).toBe(403);
    const admin = await createStaff('admin');
    const secret = 'sk_test_' + 'a1b2c3d4e5f6g7h8i9j0';
    const save = await admin.put('/api/admin/integrations/moyasar/test/credentials').send({ values: { secretKey: secret, publishableKey: 'pk_test_abc123', webhookSecret: 'whsec_test_value' } });
    expect(save.status).toBe(200);
    expect(JSON.stringify(save.body)).not.toContain(secret);
    expect(JSON.stringify(save.body)).not.toContain('whsec_test_value');
    const field = save.body.data.modes.test.fields.find((f: { key: string }) => f.key === 'secretKey');
    expect(field.masked).toMatch(/^sk_test_•+i9j0$/);
    const list = await admin.get('/api/admin/integrations');
    expect(JSON.stringify(list.body)).not.toContain(secret);
    // Stored encrypted at rest.
    const raw = await IntegrationCredential.findOne({ provider: 'moyasar' }).select('+modes.test.secrets').lean().orFail();
    const stored = Object.values(raw.modes!.test.secrets as Record<string, string>);
    expect(stored.every((v) => v.startsWith('v1:'))).toBe(true);
    expect(JSON.stringify(raw)).not.toContain(secret);
    // Public endpoints never expose it.
    expect(JSON.stringify((await shop.get('/api/settings/public')).body)).not.toContain(secret);
    expect(JSON.stringify((await admin.get('/api/admin/settings')).body)).not.toContain(secret);
  });

  it('rejects a live key in the test slot and requires verification + typed LIVE before live payments', async () => {
    const admin = await createStaff('admin');
    const wrongSlot = await admin.put('/api/admin/integrations/moyasar/test/credentials').send({ values: { secretKey: 'sk_live_wrongslot123' } });
    expect(wrongSlot.status).toBe(400);
    expect((await admin.put('/api/admin/integrations/moyasar/live/credentials').send({ values: { secretKey: 'sk_live_realkey123456' } })).status).toBe(200);
    const notVerified = await admin.post('/api/admin/integrations/moyasar/activate').send({ enabled: true, mode: 'live' });
    expect(notVerified.body.error.code).toBe('NOT_VERIFIED');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ payments: [] }))));
    const verify = await admin.post('/api/admin/integrations/moyasar/live/verify').send({});
    expect(verify.body.data.check.ok).toBe(true);
    const noConfirm = await admin.post('/api/admin/integrations/moyasar/activate').send({ enabled: true, mode: 'live' });
    expect(noConfirm.body.error.code).toBe('LIVE_CONFIRMATION_REQUIRED');
    const live = await admin.post('/api/admin/integrations/moyasar/activate').send({ enabled: true, mode: 'live', confirm: 'LIVE' });
    expect(live.status).toBe(200);
    expect(live.body.data.effective).toMatchObject({ source: 'admin', enabled: true, mode: 'live' });
    // Back to disabled so other tests keep using the sandbox.
    await admin.post('/api/admin/integrations/moyasar/activate').send({ enabled: false, mode: 'live' });
  });
});

describe('media library: direct upload and URL', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 4, 0xb0, 0, 0, 3, 0x20, 8, 6, 0, 0, 0]), Buffer.alloc(64)]);

  it('uploads an image (content verified), adds URL media, and protects media in use', async () => {
    (env as Record<string, unknown>).MEDIA_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-media-'));
    const editor = await createStaff('content_editor');
    const created = await editor.post('/api/admin/media/uploads').send({ kind: 'image', filename: 'photo.png', parts: [{ role: 'original', contentType: 'image/png', size: PNG.length }] });
    expect(created.status).toBe(201);
    const { assetId, uploads } = created.body.data;
    const put = await editor.agent.put(uploads[0].url).set('X-Requested-With', 'celibery').set('Content-Type', 'image/png').send(PNG);
    expect(put.status).toBe(200);
    const done = await editor.post(`/api/admin/media/${assetId}/complete`).send({});
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('ready');
    expect(done.body.data.width).toBe(1200);

    // A renamed text file is refused by its content.
    const fake = Buffer.from('not really a png at all, just text..............');
    const c2 = await editor.post('/api/admin/media/uploads').send({ kind: 'image', filename: 'fake.png', parts: [{ role: 'original', contentType: 'image/png', size: fake.length }] });
    const put2 = await editor.agent.put(c2.body.data.uploads[0].url).set('X-Requested-With', 'celibery').set('Content-Type', 'image/png').send(fake);
    expect(put2.status).toBe(422);

    // URLs: https only; videos must be playable sources.
    expect((await editor.post('/api/admin/media/external').send({ kind: 'image', url: 'http://insecure.example/x.jpg' })).status).toBe(400);
    expect((await editor.post('/api/admin/media/external').send({ kind: 'video', url: 'https://example.com/page.html' })).status).toBe(400);
    expect((await editor.post('/api/admin/media/external').send({ kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(201);

    // In use on a product → cannot be deleted.
    const asset = (await MediaAsset.findById(assetId).lean())!;
    await Product.updateOne({ sku: 'DEMO-AD-30W' }, { $push: { images: { url: asset.url, alt: { ar: '', en: '' }, mediaId: asset._id } } });
    expect((await editor.delete(`/api/admin/media/${assetId}`)).status).toBe(409);
  });

  it('roles without media permissions cannot upload', async () => {
    const orders = await createStaff('order_manager');
    expect((await orders.post('/api/admin/media/uploads').send({ kind: 'image', filename: 'x.png', parts: [{ role: 'original', contentType: 'image/png', size: 10 }] })).status).toBe(403);
  });

  it('existing products with plain image URLs keep working', async () => {
    const p = await Product.findOne({ sku: 'DEMO-AD-65W' }).lean();
    const pub = await shop.get(`/api/products/${p!.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.images[0].url).toBeTruthy();
    expect(pub.body.data.images[0].variants).toBeUndefined(); // plain URL record, unchanged
  });
});

describe('policy pages', () => {
  it('content editors draft; approving needs business:write; every save keeps a revision', async () => {
    const page = (await Page.findOne({ slug: 'refunds' }).lean())!;
    expect(page).toBeTruthy();
    const editor = await createStaff('content_editor');
    const body = { title: page.title, body: { ar: 'نص', en: 'Text' }, status: 'approved', approvedBy: 'me' };
    expect((await editor.put(`/api/admin/content/pages/${page._id}`).send(body)).status).toBe(403);
    expect((await editor.put(`/api/admin/content/pages/${page._id}`).send({ ...body, status: 'draft', reason: 'First draft' })).status).toBe(200);
    const admin = await createStaff('admin');
    const approved = await admin.put(`/api/admin/content/pages/${page._id}`).send({ ...body, approvedBy: 'Legal advisor' });
    expect(approved.body.data.status).toBe('approved');
    expect(await PageRevision.countDocuments({ page: page._id })).toBe(2);
    const revs = (await admin.get(`/api/admin/content/pages/${page._id}/revisions`)).body.data;
    const restored = await admin.post(`/api/admin/content/pages/${page._id}/revisions/${revs[revs.length - 1]._id}/restore`).send({});
    expect(restored.body.data.status).toBe('draft');
  });
});
