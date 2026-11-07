import { describe, expect, it } from 'vitest';
import { AuditLog, InventoryMovement, Notification, Order, Product, Refund, ReturnRequest, Settings } from '../src/models';
import { canTransition, eligibility, returnableLines, unitsAmount } from '../src/modules/returns/return-rules';
import { address, client, contact, createCustomer, createStaff, uid, useDatabase } from './helpers';

/** Return requests: requested → approved → received → refunded, with refunds through the ledger. */
useDatabase();
const shop = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);
const stockOf = async (sku: string) => (await Product.findOne({ sku }).lean())!.stock;

/** A paid card order (sandbox gateway), shipped and delivered by staff. */
async function deliveredOrder(items: { sku: string; quantity: number }[], opts: { discountCode?: string; agent?: ReturnType<typeof client> } = {}) {
  const agent = opts.agent ?? shop;
  const r = await agent.post('/api/checkout').send({ idempotencyKey: uid(), items: await Promise.all(items.map(async (i) => ({ productId: await pid(i.sku), quantity: i.quantity }))), contact, shippingAddress: address, paymentMethod: 'card', lang: 'en', discountCode: opts.discountCode });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const { order, accessToken, redirectUrl } = r.body.data;
  await agent.post(`/api/payments/sandbox/${redirectUrl.split('/').pop()}/complete`).send({ outcome: 'success' });
  await agent.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
  const staff = await createStaff('order_manager');
  const id = String((await Order.findOne({ orderNumber: order.orderNumber }).lean())!._id);
  for (const status of ['processing', 'shipped', 'delivered']) expect((await staff.post(`/api/admin/orders/${id}/status`).send({ status, trackingNumber: 'IM1' })).status).toBe(200);
  return { id, orderNumber: order.orderNumber as string, token: accessToken as string };
}

describe('return rules (pure)', () => {
  const line = (product: string, quantity: number, lineTotal: number, discount = 0) => ({ product, sku: product, name: { ar: '', en: product }, unitPrice: lineTotal / quantity, quantity, lineTotal, discount });
  it('allows only the documented transitions', () => {
    expect(canTransition('requested', 'approved')).toBe(true);
    expect(canTransition('requested', 'received')).toBe(false);
    expect(canTransition('approved', 'refunded')).toBe(false);
    expect(canTransition('received', 'refunded')).toBe(true);
    expect(canTransition('refunded', 'cancelled')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
  });
  it('counts units in active requests only; rejected/cancelled ones free their units', () => {
    const items = [line('a', 3, 3000), line('b', 1, 1000)];
    const lines = returnableLines(items, [
      { status: 'approved', items: [{ product: 'a', quantity: 2 }] },
      { status: 'rejected', items: [{ product: 'a', quantity: 1 }, { product: 'b', quantity: 1 }] },
      { status: 'cancelled', items: [{ product: 'b', quantity: 1 }] },
    ]);
    expect(lines.map((l) => [l.productId, l.returnable])).toEqual([['a', 1], ['b', 1]]);
  });
  it('enforces delivery, the window and the setting', () => {
    const order = { status: 'delivered', delivery: { deliveredAt: new Date('2026-11-01T10:00:00Z') }, items: [line('a', 1, 1000)] };
    expect(eligibility(order, { returnWindowDays: 7 }, [], new Date('2026-11-08T09:59:00Z')).eligible).toBe(true);
    expect(eligibility(order, { returnWindowDays: 7 }, [], new Date('2026-11-08T10:01:00Z')).reason).toBe('window_closed');
    expect(eligibility(order, { returnsEnabled: false }, [], new Date('2026-11-02')).reason).toBe('disabled');
    expect(eligibility({ ...order, status: 'shipped' }, {}, [], new Date('2026-11-02')).reason).toBe('not_delivered');
    expect(eligibility(order, {}, [{ status: 'requested', items: [{ product: 'a', quantity: 1 }] }], new Date('2026-11-02')).reason).toBe('nothing_left');
  });
  it('refunds what was paid for the units, after the discount, never more', () => {
    expect(unitsAmount({ lineTotal: 29800, discount: 2980, quantity: 2 }, 2)).toBe(26820);
    expect(unitsAmount({ lineTotal: 29800, discount: 2980, quantity: 2 }, 1)).toBe(13410);
    expect(unitsAmount({ lineTotal: 1000, discount: 1, quantity: 3 }, 1)).toBe(333); // floor
  });
});

describe('return requests', () => {
  it('guest requests a partial return; staff approve, receive (restock) and refund through the gateway', async () => {
    const o = await deliveredOrder([{ sku: 'DEMO-AD-65W', quantity: 2 }, { sku: 'DEMO-AD-30W', quantity: 1 }]);
    const stockBefore = await stockOf('DEMO-AD-65W');

    // Without the access token the order (and its returns) are invisible.
    expect((await client().get(`/api/orders/${o.orderNumber}/returns`)).status).toBe(404);
    const opts = await shop.get(`/api/orders/${o.orderNumber}/returns?token=${o.token}`);
    expect(opts.status).toBe(200);
    expect(opts.body.data).toMatchObject({ eligible: true, windowDays: 7 });
    expect(opts.body.data.lines.find((l: { sku: string }) => l.sku === 'DEMO-AD-65W').returnable).toBe(2);

    // More than ordered is refused.
    const tooMany = await shop.post(`/api/orders/${o.orderNumber}/returns`).send({ token: o.token, items: [{ productId: await pid('DEMO-AD-65W'), quantity: 3 }], reason: 'defective' });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('RETURN_QUANTITY');

    const created = await shop.post(`/api/orders/${o.orderNumber}/returns`).send({ token: o.token, items: [{ productId: await pid('DEMO-AD-65W'), quantity: 1 }], reason: 'defective', details: 'One port does not charge' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'requested', requestedAmount: 14900 });
    const rn = created.body.data.returnNumber as string;
    expect(rn).toMatch(/^RET-\d{5}$/);
    const ret = (await ReturnRequest.findOne({ returnNumber: rn }).lean())!;
    const rid = String(ret._id);

    // Units in an open request cannot be requested twice.
    const again = await shop.get(`/api/orders/${o.orderNumber}/returns?token=${o.token}`);
    expect(again.body.data.lines.find((l: { sku: string }) => l.sku === 'DEMO-AD-65W').returnable).toBe(1);

    // Permissions: viewing needs orders:read, deciding orders:write, refunding orders:refund.
    const content = await createStaff('content_editor');
    expect((await content.get('/api/admin/returns')).status).toBe(403);
    const manager = await createStaff('order_manager');
    const list = await manager.get('/api/admin/returns?status=requested');
    expect(list.body.data.some((r: { returnNumber: string }) => r.returnNumber === rn)).toBe(true);

    // Order of steps is enforced.
    expect((await manager.post(`/api/admin/returns/${rid}/receive`).send({})).body.error.code).toBe('INVALID_TRANSITION');
    expect((await manager.post(`/api/admin/returns/${rid}/approve`).send({ note: 'Send it back' })).status).toBe(200);
    expect((await manager.post(`/api/admin/returns/${rid}/refund`).send({})).status).toBe(403); // no orders:refund
    const recv = await manager.post(`/api/admin/returns/${rid}/receive`).send({ restock: true });
    expect(recv.status).toBe(200);
    expect(recv.body.data).toMatchObject({ status: 'received', restocked: true });
    expect(await stockOf('DEMO-AD-65W')).toBe(stockBefore + 1);
    expect(await InventoryMovement.exists({ type: 'return_restock', reason: `Return ${rn}` })).toBeTruthy();
    // Partial return: the order stays Delivered.
    expect((await Order.findById(o.id).lean())!.status).toBe('delivered');

    const admin = await createStaff('admin');
    expect((await admin.post(`/api/admin/returns/${rid}/refund`).send({ amount: 200 })).body.error.code).toBe('REFUND_TOO_LARGE');
    const refund = await admin.post(`/api/admin/returns/${rid}/refund`).send({ note: 'Defective unit' });
    expect(refund.status).toBe(200);
    expect(refund.body.data.refund.status).toBe('succeeded');
    expect(refund.body.data.return).toMatchObject({ status: 'refunded', refund: { amount: 14900, status: 'succeeded' } });
    const order = (await Order.findById(o.id).lean())!;
    expect(order.refundedAmount).toBe(14900);
    expect(order.paymentStatus).toBe('partially_refunded');
    expect(await Refund.countDocuments({ order: o.id })).toBe(1);

    // Retrying never refunds twice.
    expect((await admin.post(`/api/admin/returns/${rid}/refund`).send({})).body.error.code).toBe('INVALID_TRANSITION');
    expect(await Refund.countDocuments({ order: o.id })).toBe(1);

    // The customer sees each step; staff actions are audited; every step notified the customer.
    const seen = await shop.get(`/api/orders/${o.orderNumber}/returns?token=${o.token}`);
    const mine = seen.body.data.returns.find((r: { returnNumber: string }) => r.returnNumber === rn);
    expect(mine.status).toBe('refunded');
    expect(mine.history.map((h: { status: string }) => h.status)).toEqual(['requested', 'approved', 'received', 'refunded']);
    expect(mine.refund.amount).toBe(14900);
    const audit = await AuditLog.find({ entity: 'return', entityId: rid }).lean();
    expect(audit.map((a) => a.action).sort()).toEqual(['return_approve', 'return_receive', 'return_refund']);
    const notes = await Notification.find({ order: o.id, template: /^order\.return_/ }).lean();
    expect(new Set(notes.map((n) => n.template))).toEqual(new Set(['order.return_requested', 'order.return_approved', 'order.return_received', 'order.return_refunded']));
  });

  it('returning every unit marks the order Returned without restocking twice; discounts are refunded pro rata', async () => {
    const admin = await createStaff('admin');
    await admin.post('/api/admin/discounts').send({ code: 'RET10', type: 'percent', value: 10 });
    const o = await deliveredOrder([{ sku: 'DEMO-AD-30W', quantity: 2 }], { discountCode: 'RET10' }); // 138.00 − 13.80
    const before = await stockOf('DEMO-AD-30W');
    const c = await shop.post(`/api/orders/${o.orderNumber}/returns`).send({ token: o.token, items: [{ productId: await pid('DEMO-AD-30W'), quantity: 2 }], reason: 'changed_mind' });
    expect(c.body.data.requestedAmount).toBe(12420);
    const rid = String((await ReturnRequest.findOne({ returnNumber: c.body.data.returnNumber }).lean())!._id);
    await admin.post(`/api/admin/returns/${rid}/approve`).send({});
    await admin.post(`/api/admin/returns/${rid}/receive`).send({ restock: true });
    expect(await stockOf('DEMO-AD-30W')).toBe(before + 2);
    const order = (await Order.findById(o.id).lean())!;
    expect(order.status).toBe('returned');
    const r = await admin.post(`/api/admin/returns/${rid}/refund`).send({});
    expect(r.body.data.return.refund.amount).toBe(12420);
    expect((await Order.findById(o.id).lean())!.paymentStatus).toBe('refunded');
  });

  it('rejection needs a reason the customer sees; rejected units can be requested again; customers can cancel', async () => {
    const o = await deliveredOrder([{ sku: 'DEMO-CB-CC-1M', quantity: 1 }]);
    const admin = await createStaff('order_manager');
    const c1 = await shop.post(`/api/orders/${o.orderNumber}/returns`).send({ token: o.token, items: [{ productId: await pid('DEMO-CB-CC-1M'), quantity: 1 }], reason: 'changed_mind' });
    const rid = String((await ReturnRequest.findOne({ returnNumber: c1.body.data.returnNumber }).lean())!._id);
    expect((await admin.post(`/api/admin/returns/${rid}/reject`).send({ note: '' })).status).toBe(400);
    expect((await admin.post(`/api/admin/returns/${rid}/reject`).send({ note: 'Packaging opened and item used' })).status).toBe(200);
    const seen = await shop.get(`/api/orders/${o.orderNumber}/returns?token=${o.token}`);
    expect(seen.body.data.returns[0]).toMatchObject({ status: 'rejected', decisionNote: 'Packaging opened and item used' });
    expect(seen.body.data.eligible).toBe(true); // rejected units are free again

    const c2 = await shop.post(`/api/orders/${o.orderNumber}/returns`).send({ token: o.token, items: [{ productId: await pid('DEMO-CB-CC-1M'), quantity: 1 }], reason: 'defective' });
    expect(c2.status).toBe(201);
    const cancel = await shop.post(`/api/orders/${o.orderNumber}/returns/${c2.body.data.returnNumber}/cancel`).send({ token: o.token });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('cancelled');
    // Someone else's token cannot cancel.
    expect((await client().post(`/api/orders/${o.orderNumber}/returns/${c2.body.data.returnNumber}/cancel`).send({ token: 'x'.repeat(40) })).status).toBe(404);
  });

  it('refuses returns before delivery, after the window, and when returns are switched off', async () => {
    const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const pending = await shop.post(`/api/orders/${r.body.data.order.orderNumber}/returns`).send({ token: r.body.data.accessToken, items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], reason: 'defective' });
    expect(pending.status).toBe(422);
    expect(pending.body.error.details.reason).toBe('not_delivered');

    const o = await deliveredOrder([{ sku: 'DEMO-AD-30W', quantity: 1 }]);
    await Order.updateOne({ _id: o.id }, { $set: { 'delivery.deliveredAt': new Date(Date.now() - 8 * 86400000) } });
    const late = await shop.post(`/api/orders/${o.orderNumber}/returns`).send({ token: o.token, items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], reason: 'defective' });
    expect(late.body.error.details.reason).toBe('window_closed');

    // The window and the switch are Admin settings.
    const admin = await createStaff('administrator');
    expect((await admin.put('/api/admin/settings').send({ commerce: { returnWindowDays: 14 } })).status).toBe(200);
    expect((await shop.get(`/api/orders/${o.orderNumber}/returns?token=${o.token}`)).body.data.eligible).toBe(true);
    await admin.put('/api/admin/settings').send({ commerce: { returnsEnabled: false } });
    expect((await shop.get(`/api/orders/${o.orderNumber}/returns?token=${o.token}`)).body.data.reason).toBe('disabled');
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.returnsEnabled': true, 'commerce.returnWindowDays': 7 } });
  });

  it('signed-in customers request returns for their own orders without a token', async () => {
    const { c } = await createCustomer();
    const o = await deliveredOrder([{ sku: 'DEMO-AD-30W', quantity: 1 }], { agent: c });
    const r = await c.post(`/api/orders/${o.orderNumber}/returns`).send({ items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], reason: 'wrong_item' });
    expect(r.status).toBe(201);
    const other = await createCustomer();
    expect((await other.c.get(`/api/orders/${o.orderNumber}/returns`)).status).toBe(404);
  });
});
