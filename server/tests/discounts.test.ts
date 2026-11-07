import { describe, expect, it } from 'vitest';
import { Discount, Payment, Product } from '../src/models';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';

/**
 * Discount codes from Admin creation through quote, checkout and the payment amount.
 * Demo prices (halalas): DEMO-AD-65W 14900, DEMO-AD-30W 6900, DEMO-CB-CC-1M 3900.
 * Demo settings: free delivery, COD off, 15% VAT included.
 */
useDatabase();
const c = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

let admin: Awaited<ReturnType<typeof createStaff>>;
/** Creates a code through the Admin API with exactly the payload the Admin → Discounts form sends. */
async function adminCreate(over: Record<string, unknown>) {
  admin ??= await createStaff('admin');
  const r = await admin.post('/api/admin/discounts').send({
    description: { ar: '', en: '' },
    type: 'percent',
    value: 10,
    maxDiscount: null,
    minOrderTotal: 0,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    categories: [],
    products: [],
    active: true,
    ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { _id: string; code: string; value: number };
}

const quote = (items: { productId: string; quantity: number }[], discountCode?: string, extra: Record<string, unknown> = {}) =>
  c.post('/api/cart/quote').send({ items, ...(discountCode === undefined ? {} : { discountCode }), ...extra }).then((r) => {
    expect(r.status).toBe(200);
    return r.body.data as { subtotal: number; discountTotal: number; discount: { code: string } | null; discountError: string | null; total: number; lines: { discount: number }[] };
  });

const checkout = (items: { productId: string; quantity: number }[], discountCode?: string, extra: Record<string, unknown> = {}) =>
  c.post('/api/checkout').send({ idempotencyKey: uid(), items, contact, shippingAddress: address, paymentMethod: 'card', discountCode, ...extra });

describe('discount codes created in Admin', () => {
  it('percentage code: lowers the total, keeps the subtotal, and is stored as a percent', async () => {
    const d = await adminCreate({ code: 'PCT10' });
    expect(d.value).toBe(10);
    const q = await quote([{ productId: await pid('DEMO-AD-65W'), quantity: 1 }], 'pct10');
    expect(q.discountError).toBeNull();
    expect(q.discount?.code).toBe('PCT10');
    expect(q.subtotal).toBe(14900);
    expect(q.discountTotal).toBe(1490);
    expect(q.total).toBe(13410);
  });

  it('percentage code respects the maximum discount cap (SAR → halalas)', async () => {
    await adminCreate({ code: 'PCT50CAP', value: 50, maxDiscount: 25 });
    const q = await quote([{ productId: await pid('DEMO-AD-65W'), quantity: 1 }], 'PCT50CAP');
    expect(q.discountTotal).toBe(2500);
    expect(q.total).toBe(12400);
  });

  it('fixed code: entered in SAR, stored and applied in halalas', async () => {
    const d = await adminCreate({ code: 'FIX20', type: 'fixed', value: 20 });
    expect(d.value).toBe(2000);
    const q = await quote([{ productId: await pid('DEMO-AD-65W'), quantity: 1 }], 'FIX20');
    expect(q.discountTotal).toBe(2000);
    expect(q.total).toBe(12900);
  });

  it('fixed code never exceeds the eligible subtotal and never makes the total negative', async () => {
    await adminCreate({ code: 'FIX500', type: 'fixed', value: 500 });
    const q = await quote([{ productId: await pid('DEMO-CB-CC-1M'), quantity: 1 }], 'FIX500');
    expect(q.discountTotal).toBe(3900);
    expect(q.total).toBe(0);
  });

  it('invalid code: error returned and price unchanged', async () => {
    const q = await quote([{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], 'DOES-NOT-EXIST');
    expect(q.discountError).toMatch(/not valid/);
    expect(q.discountTotal).toBe(0);
    expect(q.discount).toBeNull();
    expect(q.total).toBe(6900);
  });

  it('expired and not-yet-started codes do not reduce the price', async () => {
    await adminCreate({ code: 'EXPIRED', endsAt: new Date(Date.now() - 3600_000).toISOString(), startsAt: new Date(Date.now() - 7200_000).toISOString() });
    await adminCreate({ code: 'FUTURE', startsAt: new Date(Date.now() + 3600_000).toISOString() });
    const id = await pid('DEMO-AD-30W');
    const e = await quote([{ productId: id, quantity: 1 }], 'EXPIRED');
    expect(e.discountError).toMatch(/expired/);
    expect(e.total).toBe(6900);
    const f = await quote([{ productId: id, quantity: 1 }], 'FUTURE');
    expect(f.discountError).toMatch(/not active yet/);
    expect(f.total).toBe(6900);
  });

  it('inactive code does not reduce the price, and deactivating a code in Admin stops it', async () => {
    await adminCreate({ code: 'OFFCODE', active: false });
    const id = await pid('DEMO-AD-30W');
    expect((await quote([{ productId: id, quantity: 1 }], 'OFFCODE')).discountError).toMatch(/not valid/);

    const live = await adminCreate({ code: 'TOGGLE' });
    expect((await quote([{ productId: id, quantity: 1 }], 'TOGGLE')).discountTotal).toBe(690);
    const upd = await admin.put(`/api/admin/discounts/${live._id}`).send({ code: 'TOGGLE', type: 'percent', value: 10, categories: [], products: [], active: false });
    expect(upd.status).toBe(200);
    const q = await quote([{ productId: id, quantity: 1 }], 'TOGGLE');
    expect(q.discountTotal).toBe(0);
    expect(q.total).toBe(6900);
  });

  it('minimum order: blocked below the minimum, applied at or above it', async () => {
    await adminCreate({ code: 'MIN100', type: 'fixed', value: 10, minOrderTotal: 100 });
    const id = await pid('DEMO-AD-30W'); // 69.00
    const below = await quote([{ productId: id, quantity: 1 }], 'MIN100');
    expect(below.discountError).toMatch(/Minimum order for this code is 100\.00 SAR/);
    expect(below.total).toBe(6900);
    const above = await quote([{ productId: id, quantity: 2 }], 'MIN100'); // 138.00
    expect(above.discountTotal).toBe(1000);
    expect(above.total).toBe(12800);
  });

  it('removing the code restores the original total', async () => {
    const items = [{ productId: await pid('DEMO-AD-65W'), quantity: 1 }];
    expect((await quote(items, 'PCT10')).total).toBe(13410);
    expect((await quote(items)).total).toBe(14900);
    const empty = await quote(items, '');
    expect(empty.discountTotal).toBe(0);
    expect(empty.total).toBe(14900);
  });

  it('changing quantities recalculates the discount', async () => {
    const id = await pid('DEMO-AD-65W');
    const one = await quote([{ productId: id, quantity: 1 }], 'PCT10');
    const three = await quote([{ productId: id, quantity: 3 }], 'PCT10');
    expect(one.discountTotal).toBe(1490);
    expect(three.subtotal).toBe(44700);
    expect(three.discountTotal).toBe(4470);
    expect(three.total).toBe(40230);
  });

  it('category restriction only discounts eligible lines', async () => {
    const cat = (await c.get('/api/categories')).body.data.find((x: { slug: string }) => x.slug === 'cables');
    await adminCreate({ code: 'CABLES10', categories: [cat._id] });
    const q = await quote([{ productId: await pid('DEMO-CB-CC-1M'), quantity: 2 }, { productId: await pid('DEMO-AD-65W'), quantity: 1 }], 'CABLES10');
    expect(q.discountTotal).toBe(780);
    expect(q.total).toBe(7800 + 14900 - 780);
  });

  it('applies a code once: duplicate cart lines are merged and the discount is not stacked', async () => {
    const id = await pid('DEMO-AD-65W');
    await adminCreate({ code: 'ONCE20', type: 'fixed', value: 20 });
    const q = await quote([{ productId: id, quantity: 1 }, { productId: id, quantity: 1 }], 'ONCE20');
    expect(q.subtotal).toBe(29800);
    expect(q.discountTotal).toBe(2000);
    expect(q.lines.reduce((s, l) => s + l.discount, 0)).toBe(2000);
    expect(q.total).toBe(27800);
  });

  it('ignores any discount or total the browser tries to send', async () => {
    const id = await pid('DEMO-AD-65W');
    const q = await quote([{ productId: id, quantity: 1 }], 'PCT10', { discountTotal: 14900, total: 1 });
    expect(q.discountTotal).toBe(1490);
    expect(q.total).toBe(13410);
    const r = await checkout([{ productId: id, quantity: 1 }], 'PCT10', { discountTotal: 14900, total: 1 });
    expect(r.status).toBe(201);
    expect(r.body.data.order.discountTotal).toBe(1490);
    expect(r.body.data.order.total).toBe(13410);
  });
});

describe('checkout with a discount code', () => {
  it('creates the order at the discounted total and sends that exact amount to the payment provider', async () => {
    await adminCreate({ code: 'PAY15', type: 'fixed', value: 15 });
    const items = [{ productId: await pid('DEMO-AD-65W'), quantity: 2 }];
    const q = await quote(items, 'PAY15');
    expect(q.total).toBe(29800 - 1500);

    const r = await checkout(items, 'PAY15');
    expect(r.status).toBe(201);
    const o = r.body.data.order;
    expect(o.subtotal).toBe(29800);
    expect(o.discountTotal).toBe(1500);
    expect(o.discountCode).toBe('PAY15');
    expect(o.total).toBe(q.total);

    // Amount handed to the (sandbox) gateway — no real payment is made.
    const ref = (r.body.data.redirectUrl as string).split('/').pop()!;
    const gw = await c.get(`/api/payments/sandbox/${ref}`);
    expect(gw.status).toBe(200);
    expect(gw.body.data.amount).toBe(28300);
    const pay = await Payment.findOne({ providerRef: ref }).lean();
    expect(pay).not.toBeNull();
    expect(pay!.amount).toBe(28300);
  });

  it('rejects an order with an invalid code instead of silently charging full price', async () => {
    const r = await checkout([{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], 'EXPIRED');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('DISCOUNT_INVALID');
  });

  it('enforces the total usage limit and counts an idempotent retry only once', async () => {
    await adminCreate({ code: 'LIMIT1', type: 'fixed', value: 5, usageLimit: 1 });
    const items = [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }];
    const key = uid();
    const body = { idempotencyKey: key, items, contact, shippingAddress: address, paymentMethod: 'card', discountCode: 'LIMIT1' };
    const first = await c.post('/api/checkout').send(body);
    expect(first.status).toBe(201);
    expect(first.body.data.order.total).toBe(6400);
    const replay = await c.post('/api/checkout').send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect((await Discount.findOne({ code: 'LIMIT1' }).lean())!.usedCount).toBe(1);

    const q = await quote(items, 'LIMIT1');
    expect(q.discountError).toMatch(/usage limit/);
    expect(q.total).toBe(6900);
    const again = await checkout(items, 'LIMIT1');
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('DISCOUNT_INVALID');
  });

  it('enforces the per-customer limit by email', async () => {
    await adminCreate({ code: 'PERCUST', type: 'fixed', value: 5, perCustomerLimit: 1 });
    const items = [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }];
    const email = `pc-${uid().slice(0, 6)}@test.local`;
    const first = await checkout(items, 'PERCUST', { contact: { ...contact, email } });
    expect(first.status).toBe(201);
    const second = await checkout(items, 'PERCUST', { contact: { ...contact, email } });
    expect(second.status).toBe(422);
    expect(second.body.error.message).toMatch(/already used/);
  });
});
