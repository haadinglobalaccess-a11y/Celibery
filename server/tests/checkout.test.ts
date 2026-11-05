import { describe, expect, it } from 'vitest';
import { Discount, InventoryMovement, Order, Product, Settings } from '../src/models';
import { releaseExpiredReservations } from '../src/modules/orders/order.service';
import { address, client, contact, createCustomer, createStaff, uid, useDatabase } from './helpers';

useDatabase();
const c = client();

const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);
const stockOf = async (sku: string) => (await Product.findOne({ sku }).lean())!.stock;

async function completeSandbox(redirectUrl: string, outcome: 'success' | 'failure' | 'cancel' = 'success') {
  const ref = redirectUrl.split('/').pop()!;
  const r = await c.post(`/api/payments/sandbox/${ref}/complete`).send({ outcome });
  expect(r.status).toBe(200);
  return r.body.data.redirectUrl as string;
}

describe('cart quote', () => {
  it('uses database prices and ignores anything else the browser sends', async () => {
    const id = await pid('DEMO-AD-30W');
    const r = await c.post('/api/cart/quote').send({ items: [{ productId: id, quantity: 2, price: 1 }] });
    expect(r.status).toBe(200);
    expect(r.body.data.subtotal).toBe(13800);
    expect(r.body.data.total).toBe(13800);
    expect(r.body.data.deliveryFee).toBe(0); // free delivery (Q25)
    expect(r.body.data.vatAmount).toBe(Math.round((13800 * 15) / 115));
  });

  it('reports out-of-stock and limited quantities', async () => {
    const r = await c.post('/api/cart/quote').send({ items: [{ productId: await pid('DEMO-HP-WIRED'), quantity: 1 }, { productId: await pid('DEMO-PB-20K'), quantity: 9 }] });
    const codes = r.body.data.issues.map((i: { code: string }) => i.code).sort();
    expect(codes).toEqual(['OUT_OF_STOCK', 'QUANTITY_LIMITED']);
  });
});

describe('checkout with online payment (sandbox gateway)', () => {
  it('creates an order, reserves stock, and only marks it paid after server-side verification', async () => {
    const id = await pid('DEMO-PB-10K');
    const before = await stockOf('DEMO-PB-10K');
    const key = uid();
    const r = await c.post('/api/checkout').send({ idempotencyKey: key, items: [{ productId: id, quantity: 2 }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'en' });
    expect(r.status).toBe(201);
    const { order, accessToken, redirectUrl } = r.body.data;
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('pending');
    expect(order.total).toBe(19800);
    expect(accessToken).toBeTruthy();
    expect(redirectUrl).toMatch(/\/en\/sandbox-pay\/sbx_/);
    expect(await stockOf('DEMO-PB-10K')).toBe(before - 2);

    // The browser claiming success is not enough: verifying before completing keeps it pending.
    const early = await c.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
    expect(early.body.data.paymentStatus).toBe('pending');

    const back = await completeSandbox(redirectUrl, 'success');
    expect(back).toContain(`order=${order.orderNumber}`);
    const v = await c.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
    expect(v.body.data.paymentStatus).toBe('paid');
    expect(v.body.data.status).toBe('confirmed');

    // Idempotent: verifying again changes nothing and does not duplicate history.
    const v2 = await c.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
    expect(v2.body.data.history.filter((h: { status: string }) => h.status === 'paid')).toHaveLength(1);

    const movements = await InventoryMovement.find({ type: 'order_reserve', reason: order.orderNumber }).lean();
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-2);
  });

  it('replaying the same idempotency key does not create a second order or reserve stock twice', async () => {
    const id = await pid('DEMO-AD-30W');
    const key = uid();
    const body = { idempotencyKey: key, items: [{ productId: id, quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' };
    const before = await stockOf('DEMO-AD-30W');
    const [a, b] = await Promise.all([c.post('/api/checkout').send(body), c.post('/api/checkout').send(body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await Order.countDocuments({ idempotencyKey: key })).toBe(1);
    expect(await stockOf('DEMO-AD-30W')).toBe(before - 1);
  });

  it('never oversells the last unit under concurrent checkouts', async () => {
    const p = await Product.findOneAndUpdate({ sku: 'DEMO-TE-HUB' }, { $set: { stock: 1 } }, { new: true }).lean();
    const attempt = () =>
      c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: String(p!._id), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBe(1);
    for (const r of results.filter((x) => x.status !== 201)) expect([409, 422]).toContain(r.status);
    expect(await stockOf('DEMO-TE-HUB')).toBe(0);
  });

  it('a failed payment can be retried; an expired reservation is cancelled and stock released', async () => {
    const id = await pid('DEMO-CB-CC-2M');
    const before = await stockOf('DEMO-CB-CC-2M');
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: id, quantity: 3 }], contact, shippingAddress: address, paymentMethod: 'stcpay' });
    const { order, accessToken, redirectUrl } = r.body.data;
    await completeSandbox(redirectUrl, 'failure');
    const v = await c.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
    expect(v.body.data.paymentStatus).toBe('failed');
    expect(v.body.data.status).toBe('pending');

    const retry = await c.post(`/api/orders/${order.orderNumber}/retry-payment`).send({ token: accessToken });
    expect(retry.status).toBe(200);
    expect(retry.body.data.redirectUrl).toMatch(/sandbox-pay/);

    await Order.updateOne({ orderNumber: order.orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const res = await releaseExpiredReservations();
    expect(res.cancelled).toBeGreaterThanOrEqual(1);
    const o = await Order.findOne({ orderNumber: order.orderNumber }).lean();
    expect(o!.status).toBe('cancelled');
    expect(o!.paymentStatus).toBe('expired');
    expect(await stockOf('DEMO-CB-CC-2M')).toBe(before);
    // Releasing twice never double-restocks
    await releaseExpiredReservations();
    expect(await stockOf('DEMO-CB-CC-2M')).toBe(before);
  });

  it('Tabby payments are authorised then captured before the order is confirmed', async () => {
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-HP-ANC'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'tabby' });
    const { order, accessToken, redirectUrl } = r.body.data;
    await completeSandbox(redirectUrl, 'success');
    const v = await c.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
    expect(v.body.data.paymentStatus).toBe('paid');
  });
});

describe('discounts', () => {
  it('applies a valid code to eligible items and enforces usage limits', async () => {
    const admin = await createStaff('admin');
    const cat = await (await c.get('/api/categories')).body.data.find((x: { slug: string }) => x.slug === 'cables');
    const cr = await admin.post('/api/admin/discounts').send({ code: 'CABLE10', type: 'percent', value: 10, usageLimit: 1, categories: [cat._id] });
    expect(cr.status).toBe(201);

    const cable = await pid('DEMO-CB-CC-1M');
    const adapter = await pid('DEMO-AD-65W');
    const q = await c.post('/api/cart/quote').send({ items: [{ productId: cable, quantity: 2 }, { productId: adapter, quantity: 1 }], discountCode: 'cable10' });
    expect(q.body.data.discountTotal).toBe(780); // 10% of 2 × 39.00 only
    expect(q.body.data.total).toBe(7800 + 14900 - 780);

    const ok = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: cable, quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card', discountCode: 'CABLE10' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.order.discountTotal).toBe(390);
    expect((await Discount.findOne({ code: 'CABLE10' }).lean())!.usedCount).toBe(1);

    const again = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: cable, quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card', discountCode: 'CABLE10' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('DISCOUNT_INVALID');
  });

  it('rejects unknown and expired codes', async () => {
    await Discount.create({ code: 'OLD', type: 'fixed', value: 1000, endsAt: new Date(Date.now() - 86400000) });
    const id = await pid('DEMO-AD-30W');
    expect((await c.post('/api/cart/quote').send({ items: [{ productId: id, quantity: 1 }], discountCode: 'NOPE' })).body.data.discountError).toBeTruthy();
    expect((await c.post('/api/cart/quote').send({ items: [{ productId: id, quantity: 1 }], discountCode: 'OLD' })).body.data.discountError).toMatch(/expired/);
  });
});

describe('cash on delivery', () => {
  it('is unavailable until enabled in settings, then confirms immediately with the configured fee', async () => {
    const id = await pid('DEMO-CAR-CHG');
    const body = () => ({ idempotencyKey: uid(), items: [{ productId: id, quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'cod' });
    const off = await c.post('/api/checkout').send(body());
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('COD_UNAVAILABLE');

    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const on = await c.post('/api/checkout').send(body());
    expect(on.status).toBe(201);
    expect(on.body.data.order.status).toBe('confirmed');
    expect(on.body.data.order.paymentStatus).toBe('cod_pending');
    expect(on.body.data.redirectUrl).toBeNull();
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': false } });
  });
});

describe('order access and tracking', () => {
  it('guests track with the access token (full) or phone (limited, no personal data)', async () => {
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-TE-STAND'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const { order, accessToken } = r.body.data;
    const full = await c.get(`/api/orders/track?orderNumber=${order.orderNumber}&token=${accessToken}`);
    expect(full.body.data.full).toBe(true);
    expect(full.body.data.order.shippingAddress.city).toBe('Riyadh');
    const limited = await c.get(`/api/orders/track?orderNumber=${order.orderNumber}&phone=0551234567`);
    expect(limited.body.data.full).toBe(false);
    expect(limited.body.data.order.shippingAddress).toBeUndefined();
    expect(limited.body.data.order.contact).toBeUndefined();
    expect((await c.get(`/api/orders/track?orderNumber=${order.orderNumber}&phone=0559999999`)).status).toBe(404);
    expect((await c.get(`/api/orders/${order.orderNumber}`)).status).toBe(404);
  });

  it('customers only see their own orders', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const r = await a.c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-CAR-MOUNT'), quantity: 1 }], contact: { ...contact, email: a.email }, shippingAddress: address, paymentMethod: 'card', saveAddress: true });
    expect(r.status).toBe(201);
    const num = r.body.data.order.orderNumber;
    expect((await a.c.get('/api/me/orders')).body.data.map((o: { orderNumber: string }) => o.orderNumber)).toContain(num);
    expect((await b.c.get('/api/me/orders')).body.data).toHaveLength(0);
    expect((await a.c.get(`/api/orders/${num}`)).status).toBe(200);
    expect((await b.c.get(`/api/orders/${num}`)).status).toBe(404);
    expect((await a.c.get('/api/me/addresses')).body.data).toHaveLength(1);
  });

  it('customer wishlist add/remove', async () => {
    const a = await createCustomer();
    const id = await pid('DEMO-HP-ANC');
    expect((await a.c.post('/api/me/wishlist').send({ productIds: [id] })).body.data).toHaveLength(1);
    expect((await a.c.delete(`/api/me/wishlist/${id}`)).body.data).toHaveLength(0);
  });
});
