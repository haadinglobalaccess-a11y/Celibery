import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { analytics } from '../src/modules/admin/analytics.service';
import { Order, Payment, ProcessedEvent, Product, Settings } from '../src/models';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';

/**
 * Phase 6. Payments through the real checkout API with the Moyasar and Tabby adapters talking to a
 * MOCKED gateway (stubbed fetch) — no real gateway, no real charge. Then analytics figures checked
 * against the order records they are computed from.
 */
useDatabase();
const shop = client();
const E = env as unknown as Record<string, unknown>;
let admin: Awaited<ReturnType<typeof createStaff>>;
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

type Gateway = { invoice?: Record<string, unknown>; tabby?: Record<string, unknown>; calls: { url: string; method: string; body: unknown }[] };
let seq = 0; // the real gateways return a new id for every invoice / session
function mockGateway(g: Gateway) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      g.calls.push({ url, method, body });
      if (url.includes('api.moyasar.com')) {
        if (method === 'POST' && url.endsWith('/invoices')) {
          const id = `inv_t${++seq}`;
          return new Response(JSON.stringify({ id, status: 'initiated', amount: body.amount, currency: body.currency, url: `https://checkout.moyasar.com/invoices/${id}` }));
        }
        if (method === 'POST' && url.includes('/refund')) return new Response(JSON.stringify({ id: 'pay_t1', status: 'refunded' }));
        return new Response(JSON.stringify(g.invoice));
      }
      if (url.includes('api.tabby.ai')) {
        if (method === 'POST' && url.endsWith('/checkout')) return new Response(JSON.stringify({ status: 'created', payment: { id: `tabby_t${++seq}` }, configuration: { available_products: { installments: [{ web_url: 'https://checkout.tabby.ai/x' }] } } }));
        if (method === 'POST' && url.includes('/captures')) {
          g.tabby = { ...g.tabby, status: 'CLOSED' };
          return new Response(JSON.stringify(g.tabby));
        }
        return new Response(JSON.stringify(g.tabby));
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

beforeAll(async () => {
  admin = await createStaff('admin');
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(E, { PAYMENT_GATEWAY: 'sandbox', MOYASAR_SECRET_KEY: '', MOYASAR_WEBHOOK_SECRET: '', TABBY_SECRET_KEY: '', TABBY_MERCHANT_CODE: '', TABBY_WEBHOOK_SECRET: '' });
});

const checkout = (method: string, sku = 'DEMO-AD-30W') =>
  pid(sku).then((id) => shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: id, quantity: 1 }], contact, shippingAddress: address, paymentMethod: method, lang: 'en' }));
const verify = (orderNumber: string, token: string) => shop.post(`/api/orders/${orderNumber}/verify-payment`).send({ token });

describe('Moyasar (cards, mada, Apple Pay, STC Pay) — mocked gateway', () => {
  it('initialises with the order total in SAR halalas; pending, declined, then paid; duplicates and replays change nothing', async () => {
    Object.assign(E, { PAYMENT_GATEWAY: 'moyasar', MOYASAR_SECRET_KEY: 'sk_test_x', MOYASAR_WEBHOOK_SECRET: 'whsec' });
    const g: Gateway = { calls: [], invoice: { id: 'inv_t1', status: 'initiated', amount: 0, currency: 'SAR' } };
    mockGateway(g);
    const r = await checkout('card');
    expect(r.status).toBe(201);
    const { order, accessToken, redirectUrl } = r.body.data;
    const pay = (await Payment.findOne({ order: (await Order.findOne({ orderNumber: order.orderNumber }).lean())!._id }).lean())!;
    expect(redirectUrl).toBe(`https://checkout.moyasar.com/invoices/${pay.providerRef}`);
    const sent = g.calls.find((c) => c.method === 'POST')!.body as { amount: number; currency: string; callback_url: string };
    expect(sent).toMatchObject({ amount: order.total, currency: 'SAR' }); // SAR halalas — never a display currency
    expect(sent.callback_url).toMatch(/\/api\/webhooks\/moyasar$/);
    expect(pay).toMatchObject({ provider: 'moyasar', status: 'pending', amount: order.total, currency: 'SAR' });
    g.invoice!.amount = order.total;

    // The browser landing on the success URL proves nothing: still pending until the gateway says paid.
    expect((await verify(order.orderNumber, accessToken)).body.data.paymentStatus).toBe('pending');
    // Declined.
    g.invoice!.status = 'failed';
    expect((await verify(order.orderNumber, accessToken)).body.data.paymentStatus).toBe('failed');
    expect((await Order.findOne({ orderNumber: order.orderNumber }).lean())!.status).toBe('pending'); // can still retry
    // Paid (e.g. a retry on the same invoice) — confirmed once.
    g.invoice!.status = 'paid';
    g.invoice!.payments = [{ id: 'pay_t1', status: 'paid', amount: order.total }];
    const w = { id: 'evt_t1', type: 'payment_paid', secret_token: 'whsec', data: { id: 'pay_t1', invoice_id: pay.providerRef } };
    expect((await shop.post('/api/webhooks/moyasar').send(w)).body.data.result).toBe('paid');
    expect((await shop.post('/api/webhooks/moyasar').send(w)).body.data.duplicate).toBe(true);
    expect((await shop.post('/api/webhooks/moyasar').send({ ...w, id: 'evt_t2' })).body.data.result).toBe('paid'); // another event, same payment
    expect((await verify(order.orderNumber, accessToken)).body.data.paymentStatus).toBe('paid');
    const after = (await Order.findOne({ orderNumber: order.orderNumber }).lean())!;
    expect(after).toMatchObject({ paymentStatus: 'paid', status: 'confirmed', currency: 'SAR' });
    expect(after.history.filter((h) => h.status === 'paid')).toHaveLength(1);
    expect((await shop.post('/api/webhooks/moyasar').send({ ...w, id: 'evt_bad', secret_token: 'nope' })).status).toBe(403);

    // Refund through the admin: the gateway refund endpoint is called with SAR halalas.
    const ref = await admin.post(`/api/admin/orders/${after._id}/refund`).send({ amount: 1000, reason: 'Goodwill', idempotencyKey: 'rf-moyasar-1' });
    expect(ref.status).toBe(200);
    const refundCall = g.calls.find((c) => c.method === 'POST' && c.url.includes('/refund'))!;
    expect(refundCall.body).toEqual({ amount: 1000 });
    const refunded = (await Order.findById(after._id).lean())!;
    expect(refunded).toMatchObject({ refundedAmount: 1000, paymentStatus: 'partially_refunded' });
  });

  it('cancelled at the gateway; a currency mismatch is never confirmed', async () => {
    Object.assign(E, { PAYMENT_GATEWAY: 'moyasar', MOYASAR_SECRET_KEY: 'sk_test_x' });
    const g: Gateway = { calls: [], invoice: { id: 'inv_t1', status: 'canceled', amount: 0, currency: 'SAR' } };
    mockGateway(g);
    const a = (await checkout('card')).body.data;
    const payOf = async (n: string) => (await Payment.findOne({ order: (await Order.findOne({ orderNumber: n }).lean())!._id }).lean())!;
    expect((await verify(a.order.orderNumber, a.accessToken)).body.data.paymentStatus).toBe('failed');
    expect((await payOf(a.order.orderNumber)).status).toBe('cancelled');

    const b = (await checkout('card', 'DEMO-PB-10K')).body.data;
    g.invoice = { id: (await payOf(b.order.orderNumber)).providerRef, status: 'paid', amount: b.order.total, currency: 'USD', payments: [] };
    expect((await verify(b.order.orderNumber, b.accessToken)).body.data.paymentStatus).toBe('pending');
    const o = (await Order.findOne({ orderNumber: b.order.orderNumber }).lean())!;
    expect(o.history.some((h) => h.status === 'payment_review')).toBe(true);
  });
});

describe('Tabby (authorise → capture) — mocked gateway', () => {
  it('captures exactly once, only when the authorised amount matches', async () => {
    Object.assign(E, { PAYMENT_GATEWAY: 'moyasar', TABBY_SECRET_KEY: 'sk_tabby', TABBY_MERCHANT_CODE: 'CEL', TABBY_WEBHOOK_SECRET: 'tabsec' });
    const g: Gateway = { calls: [] };
    mockGateway(g);
    const r = await checkout('tabby');
    expect(r.status).toBe(201);
    const { order, accessToken } = r.body.data;
    const session = g.calls.find((c) => c.url.endsWith('/checkout'))!.body as { payment: { amount: string; currency: string } };
    expect(session.payment).toMatchObject({ amount: (order.total / 100).toFixed(2), currency: 'SAR' });
    g.tabby = { status: 'AUTHORIZED', amount: (order.total / 100).toFixed(2), currency: 'SAR' };
    const ref = (await Payment.findOne({ order: (await Order.findOne({ orderNumber: order.orderNumber }).lean())!._id }).lean())!.providerRef;
    const hook = () => shop.post('/api/webhooks/tabby').set('X-Celibery-Webhook-Secret', 'tabsec').send({ id: ref, status: 'authorized' });
    expect((await hook()).body.data.result).toBe('paid');
    await hook();
    await verify(order.orderNumber, accessToken);
    expect(g.calls.filter((c) => c.url.includes('/captures'))).toHaveLength(1);
    expect((await Order.findOne({ orderNumber: order.orderNumber }).lean())!.paymentStatus).toBe('paid');
    expect((await shop.post('/api/webhooks/tabby').send({ id: 'tabby_t1', status: 'authorized' })).status).toBe(403);
  });

  it('an authorisation for a different amount is not captured', async () => {
    Object.assign(E, { PAYMENT_GATEWAY: 'moyasar', TABBY_SECRET_KEY: 'sk_tabby', TABBY_MERCHANT_CODE: 'CEL', TABBY_WEBHOOK_SECRET: 'tabsec' });
    const g: Gateway = { calls: [] };
    mockGateway(g);
    const { order, accessToken } = (await checkout('tabby', 'DEMO-PB-10K')).body.data;
    g.tabby = { status: 'AUTHORIZED', amount: '1.00', currency: 'SAR' };
    expect((await verify(order.orderNumber, accessToken)).body.data.paymentStatus).toBe('pending');
    expect(g.calls.filter((c) => c.url.includes('/captures'))).toHaveLength(0);
    expect((await Order.findOne({ orderNumber: order.orderNumber }).lean())!.history.some((h) => h.status === 'payment_review')).toBe(true);
  });
});

describe('analytics = the order records', () => {
  it('separates paid, pending, cancelled and refunded money; daily and exports agree', async () => {
    await Order.deleteMany({});
    await Payment.deleteMany({});
    await ProcessedEvent.deleteMany({});
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const place = async (sku: string) => (await checkout('cod', sku)).body.data.order.orderNumber as string;
    const A = await place('DEMO-AD-30W'); // COD not collected → pending
    const B = await place('DEMO-AD-65W'); // COD collected → paid
    const C = await place('DEMO-PB-10K'); // paid online
    const D = await place('DEMO-PB-20K'); // paid, partly refunded
    const X = await place('DEMO-CB-CC-1M'); // cancelled before payment
    const set = (n: string, s: Record<string, unknown>) => Order.collection.updateOne({ orderNumber: n }, { $set: s });
    await set(B, { paymentStatus: 'cod_collected', status: 'delivered' });
    await set(C, { paymentStatus: 'paid', paymentMethod: 'card' });
    await set(D, { paymentStatus: 'partially_refunded', paymentMethod: 'card', refundedAmount: 5000 });
    await set(X, { paymentStatus: 'pending', status: 'cancelled' });
    const all = await Order.find().lean();
    const tot = (n: string) => all.find((o) => o.orderNumber === n)!.total;

    const a = await analytics();
    const collected = tot(B) + tot(C) + tot(D);
    expect(a.summary).toMatchObject({
      placed: 5,
      paidOrders: 3,
      pendingOrders: 1,
      pendingAmount: tot(A),
      cancelled: 1,
      refundedOrders: 1,
      collected,
      refunds: 5000,
      net: collected - 5000,
      aov: Math.round(collected / 3),
    });
    expect(a.currency).toBe('SAR');
    expect(a.daily.reduce((s, d) => s + d.revenue, 0)).toBe(collected);
    expect(a.daily.reduce((s, d) => s + d.net, 0)).toBe(collected - 5000);
    expect(a.daily.reduce((s, d) => s + d.placed, 0)).toBe(5);
    expect(a.byPaymentMethod.reduce((s, m) => s + m.revenue, 0)).toBe(collected);
    expect(a.topProducts.reduce((s: number, p: { revenue: number }) => s + p.revenue, 0)).toBe(all.filter((o) => [B, C, D].includes(o.orderNumber)).reduce((s, o) => s + o.subtotal - o.discountTotal, 0));
    expect(a.topProducts.map((p: { sku: string }) => p.sku)).not.toContain('DEMO-AD-30W'); // pending, not sold yet
    expect(a.customers.new + a.customers.returning).toBeGreaterThanOrEqual(1);

    // Date filters: an order 40 days ago leaves the 30-day window but is in the 90-day one.
    await Order.collection.updateOne({ orderNumber: C }, { $set: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const d30 = await analytics(new Date(Date.now() - 29 * 86_400_000), new Date());
    const d90 = await analytics(new Date(Date.now() - 89 * 86_400_000), new Date());
    expect(d30.summary.paidOrders).toBe(2);
    expect(d90.summary.paidOrders).toBe(3);
    expect(d90.daily).toHaveLength(90);

    // HTTP: the dashboard endpoint and the CSV report give the same numbers.
    // Report dates are Riyadh calendar days (not the UTC date of the server or the browser).
    const riyadh = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
    const from = riyadh(new Date(Date.now() - 89 * 86_400_000));
    const to = riyadh(new Date());
    const api = (await admin.get(`/api/admin/reports/analytics?from=${from}&to=${to}`)).body.data;
    expect(api.summary.net).toBe(d90.summary.net);
    const csv = (await admin.get(`/api/admin/reports/summary.csv?from=${from}&to=${to}`)).text;
    expect(csv).toContain(`net_revenue_sar,${(d90.summary.net / 100).toFixed(2)}`);
    expect(csv).toContain(`pending_payments_sar,${(tot(A) / 100).toFixed(2)}`);
    expect(csv).not.toMatch(/@test\.local|0551234567/); // no customer contact details
    const sales = (await admin.get(`/api/admin/reports/sales?from=${from}&to=${to}`)).body.data;
    expect(sales.summary.revenue).toBe(d90.summary.collected);
    const ov = (await admin.get('/api/admin/overview')).body.data;
    expect(ov.revenue).toBe(collected - 5000); // all-time net with the same rule
    expect((await admin.get('/api/admin/reports/analytics?from=not-a-date')).status).toBe(400);
  });

  it('payment records: search, filter, detail, export; staff authorisation', async () => {
    await Payment.create([
      { order: (await Order.findOne().lean())!._id, provider: 'moyasar', method: 'card', amount: 9900, currency: 'SAR', status: 'paid', providerRef: 'inv_find_me' },
      { order: (await Order.findOne().lean())!._id, provider: 'tabby', method: 'tabby', amount: 5000, currency: 'SAR', status: 'failed', providerRef: 'tab_fail', failureReason: 'REJECTED' },
    ]);
    const list = (await admin.get('/api/admin/payments')).body.data;
    expect(list.total).toBeGreaterThanOrEqual(2);
    expect((await admin.get('/api/admin/payments?q=inv_find_me')).body.data.items).toHaveLength(1);
    expect((await admin.get('/api/admin/payments?status=failed')).body.data.items.every((p: { status: string }) => p.status === 'failed')).toBe(true);
    expect((await admin.get('/api/admin/payments?provider=tabby')).body.data.items.every((p: { provider: string }) => p.provider === 'tabby')).toBe(true);
    const orderNumber = list.items[0].order.orderNumber;
    expect((await admin.get(`/api/admin/payments?q=${orderNumber}`)).body.data.items.length).toBeGreaterThanOrEqual(1);
    const detail = (await admin.get(`/api/admin/payments/${list.items[0]._id}`)).body.data;
    expect(detail).toHaveProperty('events');
    expect(detail).not.toHaveProperty('redirectUrl');
    const csv = (await admin.get('/api/admin/reports/payments.csv')).text;
    expect(csv).toContain('inv_find_me');
    expect((await shop.get('/api/admin/payments')).status).toBe(401);
    const editor = await createStaff('content_editor');
    expect((await editor.get('/api/admin/payments')).status).toBe(403);
    expect((await editor.get('/api/admin/reports/analytics')).status).toBe(403);
    const orders = await createStaff('order_manager');
    expect((await orders.get('/api/admin/payments')).status).toBe(200);
  });
});
