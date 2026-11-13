/**
 * Order and coupon abuse regression suite (final review, 13 Nov 2026):
 *  - CEL-SEC-07 a "1 per customer" code was reused by sending several checkouts at the same moment
 *  - CEL-SEC-08 a guest reused a per-customer code by typing a new email (same phone)
 *  - CEL-SEC-09 unlimited fake cash-on-delivery orders could lock up stock
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { Discount, DiscountRedemption, Order, Product, Settings } from '../src/models';
import { releaseStock } from '../src/modules/orders/order.service';
import { address, client, contact, createCustomer, uid, useDatabase } from './helpers';

useDatabase();

let productId = '';
beforeAll(async () => {
  await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
  const p = await Product.findOne({ sku: 'DEMO-AD-30W' }).lean();
  productId = String(p!._id);
});
afterEach(() => {
  env.MAX_OPEN_COD_ORDERS_PER_PHONE = undefined;
});

let n = 0;
async function coupon(perCustomerLimit: number) {
  n += 1;
  const code = `ONCE${n}${Date.now() % 100000}`;
  await Product.updateOne({ _id: productId }, { $set: { stock: 500 } });
  return (await Discount.create({ code, type: 'percent', value: 10, active: true, perCustomerLimit })).code;
}

const checkout = (c: ReturnType<typeof client>, body: { email: string; phone?: string; code?: string; method?: 'cod' | 'card' }) =>
  c.post('/api/checkout').send({
    idempotencyKey: uid(),
    items: [{ productId, quantity: 1 }],
    contact: { ...contact, email: body.email, phone: body.phone ?? contact.phone },
    shippingAddress: address,
    paymentMethod: body.method ?? 'cod',
    lang: 'en',
    ...(body.code ? { discountCode: body.code } : {}),
  });

describe('CEL-SEC-07 per-customer coupon limit under parallel checkouts', () => {
  it('five simultaneous checkouts with a "1 per customer" code: exactly one gets the discount', async () => {
    const code = await coupon(1);
    const { c, email } = await createCustomer();
    const rs = await Promise.all(Array.from({ length: 5 }, () => checkout(c, { email, code })));
    const statuses = rs.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('DISCOUNT_INVALID');
    const d = await Discount.findOne({ code }).lean();
    expect(await Order.countDocuments({ 'discount.id': d!._id })).toBe(1);
    expect(d!.usedCount).toBe(1);
  });

  it('a limit of 2 allows exactly two parallel uses', async () => {
    const code = await coupon(2);
    const { c, email } = await createCustomer();
    const rs = await Promise.all(Array.from({ length: 5 }, () => checkout(c, { email, code })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
  });

  it('cancelling the order gives the use back', async () => {
    const code = await coupon(1);
    const { c, email } = await createCustomer();
    const first = await checkout(c, { email, code });
    expect(first.status).toBe(201);
    expect((await checkout(c, { email, code })).status).toBe(422);
    await releaseStock(first.body.data.order.id, 'test cancellation');
    await Order.updateOne({ _id: first.body.data.order.id }, { $set: { status: 'cancelled' } });
    expect((await checkout(c, { email, code })).status).toBe(201);
  });

  it('different shoppers are not affected by each other', async () => {
    const code = await coupon(1);
    const a = await createCustomer();
    const b = await createCustomer();
    const [ra, rb] = await Promise.all([checkout(a.c, { email: a.email, phone: '0551110001', code }), checkout(b.c, { email: b.email, phone: '0551110002', code })]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
  });
});

describe('CEL-SEC-08 guests cannot reuse a per-customer code with a new email', () => {
  it('same phone in another format with a different email is refused', async () => {
    const code = await coupon(1);
    expect((await checkout(client(), { email: `g1-${uid()}@test.local`, phone: '0559876543', code })).status).toBe(201);
    const again = await checkout(client(), { email: `g2-${uid()}@test.local`, phone: '+966559876543', code });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('DISCOUNT_INVALID');
    expect(await DiscountRedemption.countDocuments({ key: 'p:559876543' })).toBe(1);
  });
});

describe('CEL-SEC-09 open cash-on-delivery orders per phone', () => {
  it('a fourth open COD order for one phone is refused; other phones and card payment still work', async () => {
    env.MAX_OPEN_COD_ORDERS_PER_PHONE = 3;
    await Product.updateOne({ _id: productId }, { $set: { stock: 500 } });
    const phone = '0557770001';
    for (let i = 0; i < 3; i++) expect((await checkout(client(), { email: `cod${i}-${uid()}@test.local`, phone })).status).toBe(201);
    const fourth = await checkout(client(), { email: `cod3-${uid()}@test.local`, phone: '966557770001' });
    expect(fourth.status).toBe(422);
    expect(fourth.body.error.code).toBe('TOO_MANY_OPEN_ORDERS');
    expect((await checkout(client(), { email: `other-${uid()}@test.local`, phone: '0557770002' })).status).toBe(201);
    expect((await checkout(client(), { email: `card-${uid()}@test.local`, phone, method: 'card' })).status).toBe(201);
  });

  it('delivered or cancelled orders no longer count', async () => {
    env.MAX_OPEN_COD_ORDERS_PER_PHONE = 1;
    await Product.updateOne({ _id: productId }, { $set: { stock: 500 } });
    const phone = '0557770009';
    const first = await checkout(client(), { email: `d1-${uid()}@test.local`, phone });
    expect(first.status).toBe(201);
    expect((await checkout(client(), { email: `d2-${uid()}@test.local`, phone })).status).toBe(422);
    await Order.updateOne({ _id: first.body.data.order.id }, { $set: { status: 'delivered' } });
    expect((await checkout(client(), { email: `d3-${uid()}@test.local`, phone })).status).toBe(201);
  });
});
