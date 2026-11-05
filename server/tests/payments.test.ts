import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { moyasarProvider } from '../src/integrations/payments/moyasar';
import { tabbyProvider } from '../src/integrations/payments/tabby';
import { Order, Payment, ProcessedEvent, Product } from '../src/models';
import { address, client, contact, uid, useDatabase } from './helpers';

useDatabase();
const c = client();

afterEach(() => {
  vi.unstubAllGlobals();
  (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = '';
  (env as Record<string, unknown>).MOYASAR_SECRET_KEY = '';
  (env as Record<string, unknown>).TABBY_WEBHOOK_SECRET = '';
});

describe('Moyasar adapter (mocked HTTP — not a live gateway test)', () => {
  it('creates an invoice in halalas with return URLs and maps statuses', async () => {
    (env as Record<string, unknown>).MOYASAR_SECRET_KEY = 'sk_test_x';
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (init.method === 'POST') return new Response(JSON.stringify({ id: 'inv_1', status: 'initiated', amount: 9900, currency: 'SAR', url: 'https://checkout.moyasar.com/invoices/inv_1' }));
        return new Response(JSON.stringify({ id: 'inv_1', status: 'paid', amount: 9900, currency: 'SAR', url: '', payments: [{ id: 'pay_1', status: 'paid', amount: 9900 }] }));
      }),
    );
    const res = await moyasarProvider.initiate({
      paymentId: 'p1',
      orderNumber: 'CEL-100001',
      amount: 9900,
      currency: 'SAR',
      method: 'card',
      lang: 'ar',
      description: 'x',
      returnUrl: 'https://shop/return',
      cancelUrl: 'https://shop/cancel',
      customer: contact,
      shippingAddress: address,
      items: [],
    });
    expect(res).toEqual({ providerRef: 'inv_1', redirectUrl: 'https://checkout.moyasar.com/invoices/inv_1' });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.amount).toBe(9900);
    expect(body.success_url).toBe('https://shop/return');
    expect(String((calls[0].init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
    const st = await moyasarProvider.fetchStatus('inv_1');
    expect(st).toMatchObject({ status: 'paid', amount: 9900, currency: 'SAR', capturedPaymentId: 'pay_1' });
  });

  it('Tabby maps AUTHORIZED/CLOSED/REJECTED', async () => {
    (env as Record<string, unknown>).TABBY_SECRET_KEY = 'x';
    for (const [api, ours] of [['AUTHORIZED', 'authorized'], ['CLOSED', 'paid'], ['REJECTED', 'failed']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: api, amount: '99.00', currency: 'SAR' }))));
      expect((await tabbyProvider.fetchStatus('t1')).status).toBe(ours);
    }
  });
});

describe('payment webhooks', () => {
  it('rejects Moyasar webhooks without the shared secret', async () => {
    (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = 'whsec';
    const r = await c.post('/api/webhooks/moyasar').send({ id: 'evt', type: 'payment_paid', secret_token: 'wrong', data: { invoice_id: 'x' } });
    expect(r.status).toBe(403);
    const r2 = await c.post('/api/webhooks/tabby').send({ id: 'x', status: 'authorized' });
    expect(r2.status).toBe(403);
  });

  it('a valid webhook verifies with the gateway, and replays are ignored', async () => {
    (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = 'whsec';
    (env as Record<string, unknown>).MOYASAR_SECRET_KEY = 'sk_test_x';
    const p = await Product.findOne({ sku: 'DEMO-AD-30W' }).lean();
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: String(p!._id), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const order = await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean();
    // Simulate this order having been paid through Moyasar.
    await Payment.updateMany({ order: order!._id }, { $set: { provider: 'moyasar', providerRef: 'inv_live_1' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'inv_live_1', status: 'paid', amount: order!.total, currency: 'SAR', payments: [] }))));

    const body = { id: 'evt_1', type: 'payment_paid', secret_token: 'whsec', data: { id: 'pay_x', invoice_id: 'inv_live_1' } };
    const w1 = await c.post('/api/webhooks/moyasar').send(body);
    expect(w1.status).toBe(200);
    expect(w1.body.data.result).toBe('paid');
    const w2 = await c.post('/api/webhooks/moyasar').send(body);
    expect(w2.body.data.duplicate).toBe(true);
    expect(await ProcessedEvent.countDocuments({ provider: 'moyasar' })).toBe(1);
    const after = await Order.findById(order!._id).lean();
    expect(after!.paymentStatus).toBe('paid');
    expect(after!.status).toBe('confirmed');
  });

  it('flags an amount mismatch for manual review instead of confirming', async () => {
    (env as Record<string, unknown>).MOYASAR_WEBHOOK_SECRET = 'whsec';
    (env as Record<string, unknown>).MOYASAR_SECRET_KEY = 'sk_test_x';
    const p = await Product.findOne({ sku: 'DEMO-AD-65W' }).lean();
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: String(p!._id), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const order = await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean();
    await Payment.updateMany({ order: order!._id }, { $set: { provider: 'moyasar', providerRef: 'inv_live_2' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'inv_live_2', status: 'paid', amount: 100, currency: 'SAR', payments: [] }))));
    const w = await c.post('/api/webhooks/moyasar').send({ id: 'evt_2', secret_token: 'whsec', data: { invoice_id: 'inv_live_2' } });
    expect(w.body.data.result).toBe('review');
    const after = await Order.findById(order!._id).lean();
    expect(after!.paymentStatus).toBe('pending');
    expect(after!.history.some((h) => h.status === 'payment_review')).toBe(true);
  });

  it('the sandbox gateway is not reachable when another gateway is configured', async () => {
    (env as Record<string, unknown>).PAYMENT_GATEWAY = 'moyasar';
    const r = await c.get('/api/payments/sandbox/sbx_abcdefghij');
    expect(r.status).toBe(404);
    (env as Record<string, unknown>).PAYMENT_GATEWAY = 'sandbox';
  });
});
