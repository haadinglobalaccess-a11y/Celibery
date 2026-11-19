import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { Category, Discount, InventoryMovement, Order, Product, Review, Settings } from '../src/models';
import { address, client, contact, createCustomer, createStaff, uid, useDatabase } from './helpers';

/**
 * Phase 5 through the real API: verified-purchase reviews with moderation and photos, automatic
 * offers next to discount codes (no stacking, server-side only), and bundles whose items carry the
 * stock through cart, checkout, cancellation and returns.
 */
useDatabase();
const shop = client();
let admin: Awaited<ReturnType<typeof createStaff>>;
const prod = (sku: string) => Product.findOne({ sku }).lean().then((p) => p!);
const stockOf = async (sku: string) => (await prod(sku)).stock;
const quote = (items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}, c = shop) => c.post('/api/cart/quote').send({ items, ...extra }).then((r) => r.body.data);
const cod = (items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}, c = shop) =>
  c.post('/api/checkout').send({ idempotencyKey: uid(), items, contact, shippingAddress: address, paymentMethod: 'cod', lang: 'en', ...extra });

beforeAll(async () => {
  admin = await createStaff('admin');
  await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0, 'reviews.enabled': true } });
});

async function deliveredBuyer(sku: string) {
  const { c, email } = await createCustomer();
  const p = await prod(sku);
  const r = await cod([{ productId: String(p._id), quantity: 1 }], { contact: { ...contact, email } }, c);
  expect(r.status).toBe(201);
  for (const status of ['processing', 'shipped', 'delivered']) expect((await admin.post(`/api/admin/orders/${r.body.data.order.id}/status`).send({ status, trackingNumber: 'T1' })).status).toBe(200);
  return { c, email, slug: p.slug };
}

describe('reviews', () => {
  let a: Awaited<ReturnType<typeof deliveredBuyer>>;
  let b: Awaited<ReturnType<typeof deliveredBuyer>>;
  beforeAll(async () => {
    a = await deliveredBuyer('DEMO-AD-65W');
    b = await deliveredBuyer('DEMO-AD-65W');
  });

  it('validates input; only buyers; one review each; pending until approved', async () => {
    const r = { rating: 5, title: 'Great charger', body: 'Fast and cool.', lang: 'en' };
    expect((await shop.post(`/api/products/${a.slug}/reviews`).send(r)).status).toBe(401);
    expect((await a.c.post(`/api/products/${a.slug}/reviews`).send({ ...r, rating: 6 })).status).toBe(400);
    expect((await a.c.post(`/api/products/${a.slug}/reviews`).send({ ...r, rating: 0 })).status).toBe(400);
    const stranger = (await createCustomer()).c;
    expect((await stranger.post(`/api/products/${a.slug}/reviews`).send(r)).body.error.code).toBe('NOT_VERIFIED_PURCHASE');
    expect((await stranger.get(`/api/products/${a.slug}/reviews/mine`)).body.data).toMatchObject({ canReview: false, review: null });
    expect((await a.c.get(`/api/products/${a.slug}/reviews/mine`)).body.data.canReview).toBe(true);
    const sent = await a.c.post(`/api/products/${a.slug}/reviews`).send({ ...r, status: 'approved', order: 'x', verifiedPurchase: true });
    expect(sent.status).toBe(201);
    expect(sent.body.data.status).toBe('pending');
    expect((await a.c.post(`/api/products/${a.slug}/reviews`).send(r)).body.error.code).toBe('ALREADY_REVIEWED');
    expect((await shop.get(`/api/products/${a.slug}/reviews`)).body.data).toEqual([]);
    expect((await a.c.get(`/api/products/${a.slug}/reviews/mine`)).body.data.review).toMatchObject({ status: 'pending', rating: 5 });
  });

  it('moderation: approve → public with verified purchase, private display name; summary and distribution', async () => {
    await b.c.post(`/api/products/${b.slug}/reviews`).send({ rating: 2, title: 'Gets warm', body: '', lang: 'ar' });
    const pending = (await admin.get('/api/admin/reviews?status=pending')).body.data;
    expect(pending.items.length).toBeGreaterThanOrEqual(2);
    for (const r of pending.items) expect((await admin.patch(`/api/admin/reviews/${r._id}`).send({ status: 'approved' })).status).toBe(200);
    const pub = (await shop.get(`/api/products/${a.slug}/reviews`)).body.data;
    expect(pub).toHaveLength(2);
    for (const r of pub) {
      expect(r.verifiedPurchase).toBe(true);
      expect(r).not.toHaveProperty('customer');
      expect(r).not.toHaveProperty('order');
      expect(r.displayName).toBe('Test C.'); // "Test Customer" → first name + initial
    }
    const detail = (await shop.get(`/api/products/${a.slug}`)).body.data.reviews;
    expect(detail).toEqual({ average: 3.5, count: 2, distribution: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 } });
    // Filters & search for staff.
    expect((await admin.get('/api/admin/reviews?rating=2')).body.data.items.every((x: { rating: number }) => x.rating === 2)).toBe(true);
    expect((await admin.get('/api/admin/reviews?q=warm')).body.data.items).toHaveLength(1);
    expect((await admin.get('/api/admin/reviews?q=DEMO-AD-65W')).body.data.total).toBe(2);
    const orders = await createStaff('order_manager');
    expect((await orders.get('/api/admin/reviews')).status).toBe(403);
  });

  it('editing re-enters moderation and leaves the summary; hide/delete update it; reports are one per customer', async () => {
    await a.c.put(`/api/products/${a.slug}/reviews/mine`).send({ rating: 4, title: 'Updated', body: 'Still good', lang: 'en' });
    expect((await shop.get(`/api/products/${a.slug}`)).body.data.reviews).toMatchObject({ count: 1, average: 2 });
    const mineA = (await Review.findOne({ title: 'Updated' }).lean())!;
    expect(mineA.status).toBe('pending');
    await admin.patch(`/api/admin/reviews/${mineA._id}`).send({ status: 'approved' });
    expect((await shop.get(`/api/products/${a.slug}`)).body.data.reviews).toMatchObject({ count: 2, average: 3 });

    // b reports a's review (twice → counted once); a cannot report itself.
    expect((await b.c.post(`/api/reviews/${mineA._id}/report`).send({ reason: 'spam' })).status).toBe(200);
    expect((await b.c.post(`/api/reviews/${mineA._id}/report`).send({ reason: 'spam' })).body.data.duplicate).toBe(true);
    expect((await a.c.post(`/api/reviews/${mineA._id}/report`).send({})).status).toBe(403);
    expect((await admin.get('/api/admin/reviews?reported=1')).body.data.items.map((x: { _id: string }) => x._id)).toEqual([String(mineA._id)]);

    await admin.patch(`/api/admin/reviews/${mineA._id}`).send({ status: 'hidden', note: 'checking' });
    expect((await shop.get(`/api/products/${a.slug}/reviews`)).body.data).toHaveLength(1);
    const mineB = (await Review.findOne({ title: 'Gets warm' }).lean())!;
    expect((await b.c.delete(`/api/products/${b.slug}/reviews/mine`)).status).toBe(200);
    expect(await Review.findById(mineB._id)).toBeNull();
    expect((await shop.get(`/api/products/${a.slug}`)).body.data.reviews.count).toBe(0);
    expect((await admin.delete(`/api/admin/reviews/${mineA._id}`)).status).toBe(200);
  });

  it('staff-entered reviews: real reviews from WhatsApp/Instagram, published with their source, counted, editable by staff only', async () => {
    const p = await prod('DEMO-HP-WIRED');
    const base = { productId: String(p._id), displayName: 'Ahmed K.', rating: 5, title: '', body: 'Excellent power bank, charges my phone 4 times.', lang: 'en', source: 'whatsapp', receivedAt: '2026-10-01T10:00:00.000Z' };
    expect((await shop.post('/api/admin/reviews').send(base)).status).toBe(401);
    expect((await admin.post('/api/admin/reviews').send({ ...base, source: 'customer' })).status).toBe(400); // never passed off as a site review
    expect((await admin.post('/api/admin/reviews').send({ ...base, body: '' })).status).toBe(400);
    expect((await admin.post('/api/admin/reviews').send({ ...base, rating: 6 })).status).toBe(400);
    const made = await admin.post('/api/admin/reviews').send(base);
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ status: 'approved', source: 'whatsapp', displayName: 'Ahmed K.' });
    expect(new Date(made.body.data.createdAt).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    // A second one on the same product (each has its own reviewer key).
    const second = await admin.post('/api/admin/reviews').send({ ...base, displayName: 'Sara', rating: 4, source: 'instagram', receivedAt: null });
    expect(second.status).toBe(201);

    const pub = (await shop.get(`/api/products/${p.slug}/reviews`)).body.data;
    expect(pub).toHaveLength(2);
    for (const r of pub) {
      expect(r.verifiedPurchase).toBe(false); // no order behind it — never labelled verified
      expect(['whatsapp', 'instagram']).toContain(r.source);
      expect(r).not.toHaveProperty('evidenceUrl');
    }
    expect((await shop.get(`/api/products/${p.slug}`)).body.data.reviews).toMatchObject({ average: 4.5, count: 2 });

    // Staff can correct their own entries, never a customer's review.
    const fixed = await admin.put(`/api/admin/reviews/${second.body.data._id}`).send({ ...base, productId: undefined, displayName: 'Sara M.', rating: 5, source: 'instagram' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data).toMatchObject({ displayName: 'Sara M.', rating: 5 });
    const customerReview = await Review.create({ product: p._id, customer: new Types.ObjectId(), order: new Types.ObjectId(), rating: 3, body: 'From the site', status: 'approved' });
    expect(customerReview.source).toBe('customer');
    expect((await admin.put(`/api/admin/reviews/${customerReview._id}`).send({ ...base, productId: undefined })).status).toBe(403);
    const orders = await createStaff('order_manager');
    expect((await orders.post('/api/admin/reviews').send(base)).status).toBe(403);
  });

  it('review photos: verified upload, owner-only, shown once approved', async () => {
    (env as Record<string, unknown>).MEDIA_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-rv-'));
    const buyer = await deliveredBuyer('DEMO-PB-20K');
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0]), Buffer.alloc(64)]);
    const start = await buyer.c.post('/api/reviews/uploads').send({ filename: 'mine.png', contentType: 'image/png', size: PNG.length });
    expect(start.status).toBe(201);
    expect((await buyer.c.agent.put(start.body.data.upload.url).set('X-Requested-With', 'celibery').set('Content-Type', 'image/png').send(PNG)).status).toBe(200);
    const done = await buyer.c.post(`/api/reviews/uploads/${start.body.data.assetId}/complete`).send({});
    expect(done.status).toBe(200);
    // Too big and not-an-image are refused.
    expect((await buyer.c.post('/api/reviews/uploads').send({ filename: 'x.png', contentType: 'image/png', size: 6 * 1024 * 1024 })).status).toBe(400);
    expect((await buyer.c.post('/api/reviews/uploads').send({ filename: 'x.mp4', contentType: 'video/mp4', size: 100 })).status).toBe(400);
    // Someone else's photo cannot be attached.
    const other = await deliveredBuyer('DEMO-PB-20K');
    expect((await other.c.post(`/api/products/${other.slug}/reviews`).send({ rating: 5, imageIds: [done.body.data.id] })).body.error.code).toBe('INVALID_IMAGE');
    const sent = await buyer.c.post(`/api/products/${buyer.slug}/reviews`).send({ rating: 5, title: 'With photo', imageIds: [done.body.data.id] });
    expect(sent.status).toBe(201);
    expect((await shop.get(`/api/products/${buyer.slug}/reviews`)).body.data).toEqual([]);
    await admin.patch(`/api/admin/reviews/${sent.body.data.id}`).send({ status: 'approved' });
    const pub = (await shop.get(`/api/products/${buyer.slug}/reviews`)).body.data;
    expect(pub[0].images).toEqual([{ url: done.body.data.url }]);
    // The photo is "in use" for the media library while the review exists.
    expect((await admin.delete(`/api/admin/media/${done.body.data.id}`)).status).toBe(409);
  });
});

describe('offers (automatic) and discount codes', () => {
  const offer = (o: Record<string, unknown>) => admin.post('/api/admin/discounts').send({ type: 'percent', value: 10, automatic: true, title: { en: 'Offer', ar: 'عرض' }, ...o });

  it('category and product offers apply automatically; expired, disabled, used-up and min-order rules hold', async () => {
    const p = await prod('DEMO-AD-30W');
    const cat = (await Category.findById(p.category).lean())!;
    const item = [{ productId: String(p._id), quantity: 2 }];
    const base = await quote(item);
    expect(base.discount).toBeNull();
    expect((await offer({ code: 'CAT-OFF', categories: [String(cat._id)], title: { en: 'Charger week', ar: 'أسبوع الشواحن' } })).status).toBe(201);
    let q = await quote(item);
    expect(q.discount).toMatchObject({ automatic: true, title: { en: 'Charger week' } });
    expect(q.discountTotal).toBe(Math.floor((p.price * 2 * 10) / 100));
    expect(q.total).toBe(base.total - q.discountTotal);
    // A fixed product offer worth more wins; offers never stack.
    await offer({ code: 'PROD-OFF', type: 'fixed', value: 40, products: [String(p._id)], title: { en: 'SAR 40 off', ar: 'خصم 40' } });
    q = await quote(item);
    expect(q.discount.code).toBe('PROD-OFF');
    expect(q.discountTotal).toBe(4000);
    // Disabled / expired / not started / used up → ignored.
    await Discount.updateOne({ code: 'PROD-OFF' }, { $set: { active: false } });
    expect((await quote(item)).discount.code).toBe('CAT-OFF');
    await Discount.updateOne({ code: 'CAT-OFF' }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    expect((await quote(item)).discount).toBeNull();
    await Discount.updateOne({ code: 'CAT-OFF' }, { $set: { endsAt: null, startsAt: new Date(Date.now() + 86_400_000) } });
    expect((await quote(item)).discount).toBeNull();
    await Discount.updateOne({ code: 'CAT-OFF' }, { $set: { startsAt: null, usageLimit: 1, usedCount: 1 } });
    expect((await quote(item)).discount).toBeNull();
    await Discount.updateOne({ code: 'CAT-OFF' }, { $set: { usageLimit: null, usedCount: 0, minOrderTotal: p.price * 3 } });
    expect((await quote(item)).discount).toBeNull();
    expect((await quote([{ productId: String(p._id), quantity: 3 }])).discount.code).toBe('CAT-OFF');
    await Discount.updateMany({ code: { $in: ['CAT-OFF', 'PROD-OFF'] } }, { $set: { active: false } });
  });

  it('eligibility: signed-in and first-order-only offers', async () => {
    const p = await prod('DEMO-CB-CC-1M');
    const item = [{ productId: String(p._id), quantity: 1 }];
    await offer({ code: 'MEMBERS', eligibility: 'signed_in', products: [String(p._id)] });
    expect((await quote(item)).discount).toBeNull();
    const { c } = await createCustomer();
    expect((await quote(item, {}, c)).discount?.code).toBe('MEMBERS');
    await Discount.updateOne({ code: 'MEMBERS' }, { $set: { active: false } });

    await offer({ code: 'WELCOME', eligibility: 'new_customers', products: [String(p._id)] });
    expect((await quote(item, { email: 'brand-new@test.local' })).discount?.code).toBe('WELCOME');
    // A returning customer (an earlier, non-cancelled order with this email) is not eligible.
    await Discount.updateOne({ code: 'WELCOME' }, { $set: { active: false } });
    expect((await cod(item, { contact: { ...contact, email: 'returning@test.local' } })).status).toBe(201);
    await Discount.updateOne({ code: 'WELCOME' }, { $set: { active: true } });
    expect((await quote(item, { email: 'returning@test.local' })).discount).toBeNull();
    expect((await quote(item, { email: 'returning@test.local' })).discountErrorCode ?? null).toBeNull(); // automatic: silently not applied
    await Discount.updateOne({ code: 'WELCOME' }, { $set: { active: false } });
  });

  it('code vs offer: the better one applies, never both; manipulated values are ignored; checkout matches the quote', async () => {
    const p = await prod('DEMO-PB-10K');
    const item = [{ productId: String(p._id), quantity: 1 }];
    await offer({ code: 'AUTO15', value: 15, products: [String(p._id)] });
    await admin.post('/api/admin/discounts').send({ code: 'SMALL5', type: 'percent', value: 5 });
    await admin.post('/api/admin/discounts').send({ code: 'BIG30', type: 'percent', value: 30 });
    let q = await quote(item, { discountCode: 'SMALL5' });
    expect(q).toMatchObject({ discount: { code: 'AUTO15' }, discountErrorCode: 'better_offer' });
    q = await quote(item, { discountCode: 'BIG30' });
    expect(q.discount).toMatchObject({ code: 'BIG30', automatic: false });
    expect(q.discountTotal).toBe(Math.floor(p.price * 0.3));

    // The browser cannot set prices or discounts.
    const tampered = await shop.post('/api/cart/quote').send({ items: [{ ...item[0], price: 1 }], discountTotal: 999999, discount: { code: 'X', amount: 999999 } });
    expect(tampered.body.data.discountTotal).toBe(Math.floor(p.price * 0.15));

    const before = (await Discount.findOne({ code: 'AUTO15' }).lean())!.usedCount;
    const r = await cod(item, { discountCode: 'SMALL5', subtotal: 1, total: 1 });
    expect(r.status).toBe(201); // a weaker code does not block checkout: the better offer applies
    const order = (await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean())!;
    const expected = await quote(item);
    expect(order.total).toBe(expected.total);
    expect(order.discount?.code).toBe('AUTO15');
    expect((await Discount.findOne({ code: 'AUTO15' }).lean())!.usedCount).toBe(before + 1);
    expect(order.items[0].unitPrice).toBe(p.price); // SAR price untouched
    expect((await prod('DEMO-PB-10K')).price).toBe(p.price);
    await Discount.updateOne({ code: 'AUTO15' }, { $set: { active: false } });
  });

  it('offer settings are validated', async () => {
    expect((await admin.post('/api/admin/discounts').send({ code: 'BAD1', type: 'percent', value: 150 })).status).toBe(400);
    expect((await admin.post('/api/admin/discounts').send({ code: 'BAD2', type: 'fixed', value: 0 })).status).toBe(400);
    expect((await admin.post('/api/admin/discounts').send({ code: 'BAD3', type: 'percent', value: 10, automatic: true })).status).toBe(400); // needs a title
    expect((await admin.post('/api/admin/discounts').send({ code: 'BAD4', type: 'percent', value: 10, startsAt: '2026-12-02', endsAt: '2026-12-01' })).status).toBe(400);
  });
});

describe('bundles', () => {
  let bundleId = '';
  let slug = '';

  it('a bundle of existing products: stock follows its items; value and savings are computed', async () => {
    const pb = await prod('DEMO-PB-10K');
    const cable = await prod('DEMO-CB-CC-1M');
    await Product.updateMany({ _id: { $in: [pb._id, cable._id] } }, { $set: { stock: 10 } });
    const cat = pb.category;
    const r = await admin.post('/api/admin/products').send({
      slug: 'p5-power-kit',
      sku: 'P5-KIT',
      name: { en: 'Power kit', ar: 'طقم الطاقة' },
      category: String(cat),
      price: (pb.price + cable.price * 2 - 2000) / 100, // SAR
      status: 'active',
      isBundle: true,
      bundleItems: [{ product: String(pb._id), quantity: 1 }, { product: String(cable._id), quantity: 2 }],
      stock: 99, // ignored for bundles with items
    });
    expect(r.status).toBe(201);
    bundleId = r.body.data._id;
    slug = 'p5-power-kit';
    expect((await Product.findById(bundleId).lean())!.stock).toBe(5); // min(10/1, 10/2)
    const d = (await shop.get(`/api/products/${slug}`)).body.data;
    expect(d.bundle).toMatchObject({ value: pb.price + cable.price * 2, savings: 2000 });
    expect(d.bundleContents.map((x: { quantity: number }) => x.quantity)).toEqual([1, 2]);
    expect(d.available).toBe(true);
    // Bundle stock cannot be set by hand; bundles cannot nest.
    expect((await admin.post(`/api/admin/inventory/${bundleId}/adjust`).send({ mode: 'set', value: 50, reason: 'try' })).body.error.code).toBe('BUNDLE_STOCK');
    expect((await admin.post('/api/admin/products').send({ slug: 'p5-nest', sku: 'P5-NEST', name: { en: 'Nest', ar: 'ن' }, category: String(cat), price: 10, isBundle: true, bundleItems: [{ product: bundleId, quantity: 1 }] })).status).toBe(400);
  });

  it('checkout reserves the items; cancelling returns them; combined demand is checked', async () => {
    const pb = await prod('DEMO-PB-10K');
    const cable = await prod('DEMO-CB-CC-1M');
    const q = await quote([{ productId: bundleId, quantity: 2 }]);
    expect(q.issues).toEqual([]);
    expect(q.lines[0].components.map((c: { quantity: number }) => c.quantity)).toEqual([1, 2]);
    const r = await cod([{ productId: bundleId, quantity: 2 }]);
    expect(r.status).toBe(201);
    expect(await stockOf('DEMO-PB-10K')).toBe(pb.stock - 2);
    expect(await stockOf('DEMO-CB-CC-1M')).toBe(cable.stock - 4);
    const order = (await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean())!;
    expect(order.items[0]).toMatchObject({ product: expect.anything(), quantity: 2, unitPrice: (await Product.findById(bundleId).lean())!.price });
    expect(order.items[0].components?.map((c) => c.quantity)).toEqual([1, 2]);
    const moves = await InventoryMovement.find({ reason: order.orderNumber }).lean();
    expect(moves.map((m) => m.delta).sort((x, y) => x - y)).toEqual([-4, -2]);
    await new Promise((res) => setTimeout(res, 200));
    expect((await Product.findById(bundleId).lean())!.stock).toBe(3); // min(8, 6/2)

    // Cancel → items come back.
    expect((await admin.post(`/api/admin/orders/${r.body.data.order.id}/status`).send({ status: 'cancelled' })).status).toBe(200);
    expect(await stockOf('DEMO-PB-10K')).toBe(pb.stock);
    expect(await stockOf('DEMO-CB-CC-1M')).toBe(cable.stock);
    expect((await Product.findById(bundleId).lean())!.stock).toBe(5);

    // Bundle + the same cable bought separately share one stock.
    await Product.updateOne({ _id: cable._id }, { $set: { stock: 5 } });
    const both = await quote([{ productId: bundleId, quantity: 2 }, { productId: String(cable._id), quantity: 2 }]);
    expect(both.issues[0]).toMatchObject({ code: 'QUANTITY_LIMITED' });
    expect((await cod([{ productId: bundleId, quantity: 2 }, { productId: String(cable._id), quantity: 2 }])).body.error.code).toBe('CART_CHANGED');
    await Product.updateOne({ _id: cable._id }, { $set: { stock: 10 } });
  });

  it('unavailable items, insufficient stock, schedule, and editing contents', async () => {
    const cable = await prod('DEMO-CB-CC-1M');
    await Product.updateOne({ _id: cable._id }, { $set: { status: 'draft' } });
    expect((await quote([{ productId: bundleId, quantity: 1 }])).issues[0]).toMatchObject({ code: 'UNAVAILABLE' });
    await Product.updateOne({ _id: cable._id }, { $set: { status: 'active', stock: 1 } });
    expect((await quote([{ productId: bundleId, quantity: 1 }])).issues[0]).toMatchObject({ code: 'OUT_OF_STOCK' });
    await Product.updateOne({ _id: cable._id }, { $set: { stock: 10 } });

    await admin.put(`/api/admin/products/${bundleId}`).send({ availableFrom: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await quote([{ productId: bundleId, quantity: 1 }])).issues[0]).toMatchObject({ code: 'UNAVAILABLE' });
    expect((await Product.findById(bundleId).lean())!.stock).toBe(0);
    await admin.put(`/api/admin/products/${bundleId}`).send({ availableFrom: null });

    // Edit contents: only the power bank ×2 now.
    const pb = await prod('DEMO-PB-10K');
    await admin.put(`/api/admin/products/${bundleId}`).send({ bundleItems: [{ product: String(pb._id), quantity: 2 }] });
    expect((await Product.findById(bundleId).lean())!.stock).toBe(Math.floor(pb.stock / 2));
    expect((await shop.get(`/api/products/${slug}`)).body.data.bundleContents).toHaveLength(1);
  });

  it('legacy bundles without contents keep their own stock', async () => {
    const gift = await prod('DEMO-KIT-GIFT');
    expect(gift.bundleItems).toHaveLength(0);
    const r = await cod([{ productId: String(gift._id), quantity: 1 }]);
    expect(r.status).toBe(201);
    expect(await stockOf('DEMO-KIT-GIFT')).toBe(gift.stock - 1);
  });
});
