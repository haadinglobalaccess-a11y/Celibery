import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditLog, InventoryMovement, Notification, Order, Product } from '../src/models';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';

useDatabase();

const shop = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

async function paidOrder(sku = 'DEMO-AD-65W', qty = 1) {
  const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid(sku), quantity: qty }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'ar' });
  const { order, accessToken, redirectUrl } = r.body.data;
  await shop.post(`/api/payments/sandbox/${redirectUrl.split('/').pop()}/complete`).send({ outcome: 'success' });
  await shop.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
  const doc = await Order.findOne({ orderNumber: order.orderNumber }).lean();
  return { id: String(doc!._id), orderNumber: order.orderNumber as string, token: accessToken as string };
}

describe('admin: products, categories, inventory', () => {
  it('creates a product with prices entered in SAR and stores halalas; initial stock is ledgered', async () => {
    const admin = await createStaff('admin');
    const cats = (await shop.get('/api/categories')).body.data;
    const cat = cats.find((c: { slug: string }) => c.slug === 'cables');
    const r = await admin.post('/api/admin/products').send({
      slug: 'cel-test-cable',
      sku: 'cel-test-1',
      name: { ar: 'كابل اختبار', en: 'Test Cable' },
      category: cat._id,
      price: 49.5,
      compareAtPrice: 59,
      stock: 7,
      status: 'active',
      attributes: { connectors: ['usb-c'], powerW: 60 },
    });
    expect(r.status).toBe(201);
    expect(r.body.data.price).toBe(4950);
    expect(r.body.data.compareAtPrice).toBe(5900);
    expect(r.body.data.sku).toBe('CEL-TEST-1');
    expect(r.body.data.dataSource).toBe('client');
    const mv = await InventoryMovement.findOne({ product: r.body.data._id }).lean();
    expect(mv?.type).toBe('initial');
    expect(mv?.delta).toBe(7);

    // Stock cannot be changed through the product form
    const u = await admin.put(`/api/admin/products/${r.body.data._id}`).send({ stock: 999, price: 45 });
    expect(u.body.data.stock).toBe(7);
    expect(u.body.data.price).toBe(4500);
    expect(u.body.data.status).toBe('active');
    expect(u.body.data.name).toEqual(r.body.data.name);
    expect(u.body.data.attributes).toEqual(r.body.data.attributes);

    // Missing Arabic name is rejected
    const bad = await admin.post('/api/admin/products').send({ slug: 'x-y', sku: 'XY', name: { ar: '', en: 'X' }, category: cat._id, price: 1 });
    expect(bad.status).toBe(400);
    expect(await AuditLog.countDocuments({ entity: 'product', action: 'create' })).toBeGreaterThan(0);
  });

  it('adjusts stock through the ledger and never below zero', async () => {
    const admin = await createStaff('sales_executive');
    const id = await pid('DEMO-HP-SPORT');
    const before = (await Product.findById(id).lean())!.stock;
    const add = await admin.post(`/api/admin/inventory/${id}/adjust`).send({ mode: 'delta', value: 10, reason: 'Shipment received', type: 'restock' });
    expect(add.body.data.stock).toBe(before + 10);
    const set = await admin.post(`/api/admin/inventory/${id}/adjust`).send({ mode: 'set', value: 3, reason: 'Stock count' });
    expect(set.body.data.stock).toBe(3);
    const neg = await admin.post(`/api/admin/inventory/${id}/adjust`).send({ mode: 'delta', value: -10, reason: 'Damage' });
    expect(neg.status).toBe(422);
    const hist = await admin.get(`/api/admin/inventory/movements?product=${id}`);
    expect(hist.body.data.length).toBeGreaterThanOrEqual(3);
    const low = await admin.get('/api/admin/inventory?lowStock=1');
    expect(low.body.data.some((p: { _id: string }) => p._id === id)).toBe(true);
  });

  it('archives (not deletes) products that appear in orders; blocks deleting a used category', async () => {
    const admin = await createStaff('admin');
    await paidOrder('DEMO-CB-CL-1M');
    const id = await pid('DEMO-CB-CL-1M');
    const del = await admin.delete(`/api/admin/products/${id}`);
    expect(del.body.data).toEqual({ archived: true, deleted: false });
    expect((await shop.get('/api/products/demo-usb-c-lightning-cable')).status).toBe(404);
    const cats = (await admin.get('/api/admin/categories')).body.data;
    expect((await admin.delete(`/api/admin/categories/${cats[0]._id}`)).status).toBe(409);
  });

  it('imports products from the CSV template (dry run, then real)', async () => {
    const admin = await createStaff('admin');
    const csv = fs.readFileSync(path.resolve(__dirname, '../../docs/product-import-template.csv'), 'utf8');
    const dry = await admin.post('/api/admin/products/import').send({ csv, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.data.errors).toEqual([]);
    expect(dry.body.data.created).toBe(0);
    const real = await admin.post('/api/admin/products/import').send({ csv, dryRun: false });
    expect(real.body.data.created).toBe(dry.body.data.rows);
    const again = await admin.post('/api/admin/products/import').send({ csv, dryRun: false });
    expect(again.body.data.updated).toBe(dry.body.data.rows);
  });
});

describe('admin: orders', () => {
  it('runs the fulfilment workflow and the customer sees each status', async () => {
    const admin = await createStaff('order_manager');
    const o = await paidOrder();
    const detail = await admin.get(`/api/admin/orders/${o.id}`);
    expect(detail.body.data.order.status).toBe('confirmed');
    expect(detail.body.data.payments[0].status).toBe('paid');

    expect((await admin.post(`/api/admin/orders/${o.id}/status`).send({ status: 'processing' })).status).toBe(200);
    const ship = await admin.post(`/api/admin/orders/${o.id}/status`).send({ status: 'shipped', trackingNumber: 'IM123456' });
    expect(ship.body.data.delivery.trackingNumber).toBe('IM123456');
    expect(ship.body.data.delivery.courier).toBe('I Mile Logistics');

    const seen = await shop.get(`/api/orders/track?orderNumber=${o.orderNumber}&token=${o.token}`);
    expect(seen.body.data.order.status).toBe('shipped');
    expect(seen.body.data.order.delivery.trackingNumber).toBe('IM123456');

    // Invalid transitions are rejected
    expect((await admin.post(`/api/admin/orders/${o.id}/status`).send({ status: 'pending' })).status).toBe(422);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`).send({ status: 'cancelled' })).status).toBe(422);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`).send({ status: 'delivered' })).status).toBe(200);

    // Notifications are recorded honestly as skipped (no provider configured)
    const notes = await Notification.find({ order: o.id }).lean();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.status === 'skipped')).toBe(true);
  });

  it('cannot confirm or ship an unpaid order; cancelling releases stock', async () => {
    const admin = await createStaff('order_manager');
    const before = (await Product.findOne({ sku: 'DEMO-PB-MAG' }).lean())!.stock;
    const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-PB-MAG'), quantity: 2 }], contact, shippingAddress: address, paymentMethod: 'card' });
    const orderId = String((await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean())!._id);
    expect((await admin.post(`/api/admin/orders/${orderId}/status`).send({ status: 'confirmed' })).body.error.code).toBe('PAYMENT_REQUIRED');
    expect((await admin.post(`/api/admin/orders/${orderId}/status`).send({ status: 'cancelled', note: 'Customer request' })).status).toBe(200);
    expect((await Product.findOne({ sku: 'DEMO-PB-MAG' }).lean())!.stock).toBe(before);
  });

  it('refunds through the gateway (partial then full) with permission checks', async () => {
    const o = await paidOrder('DEMO-AD-30W', 2);
    const manager = await createStaff('order_manager');
    expect((await manager.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 100, reason: 'test' })).status).toBe(403);
    const admin = await createStaff('admin');
    const part = await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 6900, reason: 'One item returned' });
    expect(part.body.data.fully).toBe(false);
    expect((await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 999999, reason: 'too much' })).status).toBe(422);
    const rest = await admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 6900, reason: 'Second item' });
    expect(rest.body.data.fully).toBe(true);
    expect((await Order.findById(o.id).lean())!.paymentStatus).toBe('refunded');
  });

  it('concurrent refunds can never exceed the order total', async () => {
    const o = await paidOrder('DEMO-AD-30W', 2); // 2 × 69.00 = 138.00 SAR
    const admin = await createStaff('admin');
    const results = await Promise.all([
      admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 10000, reason: 'race A' }),
      admin.post(`/api/admin/orders/${o.id}/refund`).send({ amount: 10000, reason: 'race B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const after = (await Order.findById(o.id).lean())!;
    expect(after.refundedAmount).toBe(10000);
    expect(after.paymentStatus).toBe('partially_refunded');
  });

  it('lists and searches orders, exports CSV, and shows real overview figures', async () => {
    const admin = await createStaff('admin');
    const o = await paidOrder();
    const list = await admin.get(`/api/admin/orders?q=${o.orderNumber}`);
    expect(list.body.data).toHaveLength(1);
    const ov = await admin.get('/api/admin/overview');
    expect(ov.body.data.totalOrders).toBeGreaterThan(0);
    expect(ov.body.data.revenue).toBeGreaterThan(0);
    expect(ov.body.data.salesTrend).toHaveLength(30);
    const rep = await admin.get('/api/admin/reports/sales');
    expect(rep.body.data.summary.orders).toBeGreaterThan(0);
    expect(rep.body.data.byPaymentMethod.length).toBeGreaterThan(0);
    const csv = await admin.get('/api/admin/reports/orders.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(o.orderNumber);
  });
});

describe('admin: settings, staff, content', () => {
  it('updates settings sections without wiping others; validates VAT format', async () => {
    const admin = await createStaff('admin');
    const r = await admin.put('/api/admin/settings').send({ business: { whatsappNumber: '966500000000' }, commerce: { codEnabled: true, codFee: 0 } });
    expect(r.status).toBe(200);
    expect(r.body.data.business.whatsappNumber).toBe('966500000000');
    expect(r.body.data.commerce.freeDelivery).toBe(true);
    expect(r.body.data.commerce.warrantyMonths).toBe(24);
    expect((await admin.put('/api/admin/settings').send({ business: { vatNumber: '12345' } })).status).toBe(400);
    await admin.put('/api/admin/settings').send({ commerce: { codEnabled: false } });
    const s = await admin.get('/api/admin/settings');
    expect(s.body.data.integrations.cardGateway).toBe('sandbox');
  });

  it('invites staff without ever setting a password for them', async () => {
    const admin = await createStaff('admin');
    const roles = (await admin.get('/api/admin/staff/roles/all')).body.data;
    const sales = roles.find((r: { key: string }) => r.key === 'sales_executive');
    const inv = await admin.post('/api/admin/staff').send({ name: 'Shuja Mubeen', email: 'shuja@test.local', title: 'Online Sales Executive', roleId: sales._id });
    expect(inv.status).toBe(201);
    expect(inv.body.data.emailStatus).toBe('skipped');
    expect(inv.body.data.inviteLink).toMatch(/\/admin\/set-password\?token=/);
    const token = new URL(inv.body.data.inviteLink).searchParams.get('token');
    const login1 = await client().post('/api/auth/login').send({ email: 'shuja@test.local', password: 'Anything1' });
    expect(login1.status).toBe(401);
    expect((await client().post('/api/auth/reset-password').send({ token, password: 'Shuja2026x' })).status).toBe(200);
    const s = client();
    expect((await s.post('/api/auth/login').send({ email: 'shuja@test.local', password: 'Shuja2026x' })).status).toBe(200);
    expect((await s.get('/api/admin/orders')).status).toBe(200);
    expect((await s.get('/api/admin/staff')).status).toBe(403);
  });

  it('the administrator role cannot be edited', async () => {
    const admin = await createStaff('admin');
    const roles = (await admin.get('/api/admin/staff/roles/all')).body.data;
    const adm = roles.find((r: { key: string }) => r.key === 'admin');
    expect((await admin.put(`/api/admin/staff/roles/${adm._id}`).send({ key: 'admin', name: { ar: 'x', en: 'x' }, permissions: [] })).status).toBe(403);
  });

  it('manages banners and campaigns; inactive campaigns are not public', async () => {
    const admin = await createStaff('content_editor');
    const b = await admin.post('/api/admin/content/banners').send({ placement: 'hero', title: { ar: 'عنوان', en: 'Title' }, imageUrl: { ar: '/placeholders/hero.svg', en: '/placeholders/hero.svg' } });
    expect(b.status).toBe(201);
    expect((await shop.get('/api/home')).body.data.hero.banners).toHaveLength(1);
    expect((await shop.get('/api/campaigns/national-day')).status).toBe(404);
    const camps = (await admin.get('/api/admin/content/campaigns')).body.data;
    const nd = camps.find((c: { slug: string }) => c.slug === 'national-day');
    await admin.put(`/api/admin/content/campaigns/${nd._id}`).send({ ...nd, _id: undefined, createdAt: undefined, updatedAt: undefined, __v: undefined, active: true, collection: null });
    expect((await shop.get('/api/campaigns/national-day')).status).toBe(200);
  });
});
