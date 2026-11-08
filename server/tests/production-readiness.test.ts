import { describe, expect, it } from 'vitest';
import { csvCell, csvToObjects } from '../src/lib/csv';
import { Category, Order, Product, Review, Settings } from '../src/models';
import { address, client, contact, createCustomer, createStaff, uid, useDatabase } from './helpers';

useDatabase();

describe('verified-purchase reviews (storefront → moderation → display)', () => {
  it('only lets a customer with a delivered order review, and shows the review only after approval', async () => {
    const product = await Product.findOne({ sku: 'DEMO-AD-30W' }).lean();
    const slug = product!.slug;
    const admin = await createStaff('admin');
    const { c: customer, email } = await createCustomer();
    const review = { rating: 4, title: 'Charges fast', body: 'Works well with my phone.', displayName: 'Sara', lang: 'en' };

    // Off by default (Q19): no submissions, no reviews, no rating summary.
    expect((await customer.post(`/api/products/${slug}/reviews`).send(review)).body.error.code).toBe('REVIEWS_DISABLED');
    expect((await client().get(`/api/products/${slug}`)).body.data.reviews).toBeNull();

    expect((await admin.put('/api/admin/settings').send({ reviews: { enabled: true } })).status).toBe(200);

    // Anonymous visitors and customers without a delivered order cannot review.
    expect((await client().post(`/api/products/${slug}/reviews`).send(review)).status).toBe(401);
    const early = await customer.post(`/api/products/${slug}/reviews`).send(review);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('NOT_VERIFIED_PURCHASE');

    // Buy (COD) → admin fulfils → delivered.
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const order = await customer.post('/api/checkout').send({
      idempotencyKey: uid(),
      items: [{ productId: String(product!._id), quantity: 1 }],
      contact: { ...contact, email },
      shippingAddress: address,
      paymentMethod: 'cod',
    });
    expect(order.status).toBe(201);
    const id = order.body.data.order.id;
    for (const status of ['processing', 'shipped', 'delivered']) {
      expect((await admin.post(`/api/admin/orders/${id}/status`).send({ status, trackingNumber: 'IM1' })).status).toBe(200);
    }

    // A client-supplied status is stripped: every review starts pending.
    const sent = await customer.post(`/api/products/${slug}/reviews`).send({ ...review, status: 'approved' });
    expect(sent.status).toBe(201);
    expect(sent.body.data.status).toBe('pending');
    expect((await customer.post(`/api/products/${slug}/reviews`).send(review)).body.error.code).toBe('ALREADY_REVIEWED');

    // Pending reviews are invisible on the store.
    expect((await client().get(`/api/products/${slug}/reviews`)).body.data).toEqual([]);
    expect((await client().get(`/api/products/${slug}`)).body.data.reviews).toEqual({ average: 0, count: 0 });

    // Moderation in Admin → Website content → Reviews.
    const list = await admin.get('/api/admin/content/reviews');
    const mine = list.body.data.find((r: { _id: string }) => r._id === sent.body.data.id);
    expect(mine.status).toBe('pending');
    expect((await admin.patch(`/api/admin/content/reviews/${mine._id}`).send({ status: 'approved' })).status).toBe(200);

    const shown = (await client().get(`/api/products/${slug}/reviews`)).body.data;
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ rating: 4, title: 'Charges fast', displayName: 'Sara' });
    expect(shown[0].customer).toBeUndefined(); // no customer identifiers on the public API
    expect((await client().get(`/api/products/${slug}`)).body.data.reviews).toEqual({ average: 4, count: 1 });

    // Rejecting hides it again; content-only staff without the permission cannot moderate.
    const orderManager = await createStaff('order_manager');
    expect((await orderManager.patch(`/api/admin/content/reviews/${mine._id}`).send({ status: 'rejected' })).status).toBe(403);
    expect((await admin.patch(`/api/admin/content/reviews/${mine._id}`).send({ status: 'rejected' })).status).toBe(200);
    expect((await client().get(`/api/products/${slug}/reviews`)).body.data).toEqual([]);
    expect(await Review.countDocuments()).toBe(1);
  });
});

describe('product CSV export', () => {
  it('exports every product in the import template format, re-importable without changes', async () => {
    const admin = await createStaff('admin');
    const res = await admin.get('/api/admin/products/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="celibery-products-/);

    const rows = csvToObjects(res.text);
    const total = await Product.countDocuments();
    expect(rows).toHaveLength(total);
    const sample = await Product.findOne({ sku: 'DEMO-AD-30W' }).lean();
    const row = rows.find((r) => r.sku === 'DEMO-AD-30W')!;
    expect(row.price_sar).toBe((sample!.price / 100).toFixed(2));
    expect(row.stock).toBe(String(sample!.stock));
    expect(row.category_slug).toBe('charging-adapters');
    expect(row.name_ar).toBe(sample!.name.ar);
    // Sample products stay identifiable outside the dashboard too.
    expect(row.data_source).toBe('demo');

    // Round trip: importing the export reports no errors and changes nothing.
    const stockBefore = await Product.find().select('sku stock price').sort({ sku: 1 }).lean();
    const dry = await admin.post('/api/admin/products/import').send({ csv: res.text, dryRun: true });
    expect(dry.body.data.errors).toEqual([]);
    const real = await admin.post('/api/admin/products/import').send({ csv: res.text, dryRun: false });
    expect(real.body.data).toMatchObject({ created: 0, updated: total, skipped: 0, errors: [] });
    const stockAfter = await Product.find().select('sku stock price').sort({ sku: 1 }).lean();
    expect(stockAfter.map((p) => [p.sku, p.stock, p.price])).toEqual(stockBefore.map((p) => [p.sku, p.stock, p.price]));
  });

  it('filters by status and requires products:read', async () => {
    const admin = await createStaff('admin');
    const drafts = csvToObjects((await admin.get('/api/admin/products/export.csv?status=archived')).text);
    expect(drafts.every((r) => r.status === 'archived')).toBe(true);
    expect((await admin.get('/api/admin/products/export.csv?status=bogus')).status).toBe(400);
    expect((await client().get('/api/admin/products/export.csv')).status).toBe(401);
    const customer = (await createCustomer()).c;
    expect((await customer.get('/api/admin/products/export.csv')).status).toBe(403);
  });
});

describe('product text: Admin → database → API → cart → order', () => {
  it('stores and serves clean descriptions, and the order keeps the right product data', async () => {
    const admin = await createStaff('admin');
    const cables = await Category.findOne({ slug: 'cables' }).lean();
    const adapters = await Category.findOne({ slug: 'charging-adapters' }).lean();

    // 1. Admin pastes Shopify HTML.
    const created = await admin.post('/api/admin/products').send({
      sku: 'CEL-TXT-1', slug: 'text-cable', model: 'TX-1', category: String(cables!._id), price: 49, stock: 10, status: 'active',
      name: { ar: 'كابل <b>USB-C</b>', en: '<p>USB-C Cable</p>' },
      shortDescription: { ar: 'كابل شحن سريع', en: 'Fast&nbsp;charging &amp; data' },
      description: { ar: '<p>كابل متين.</p><ul><li>طول 1 م</li><li>60 واط</li></ul>', en: '<p>A durable cable.</p><ul><li>1 m long</li><li>60W</li></ul>' },
      specs: [{ label: { ar: 'الطول', en: '<i>Length</i>' }, value: { ar: '1 م', en: '1 m' } }],
    });
    expect(created.status).toBe(201);
    const stored = await Product.findOne({ sku: 'CEL-TXT-1' }).lean();
    expect(stored!.name).toMatchObject({ ar: 'كابل USB-C', en: 'USB-C Cable' });
    expect(stored!.shortDescription).toMatchObject({ en: 'Fast charging & data' });
    expect(stored!.description).toMatchObject({ ar: 'كابل متين.\n\n- طول 1 م\n- 60 واط', en: 'A durable cable.\n\n- 1 m long\n- 60W' });
    expect(stored!.specs[0].label.en).toBe('Length');

    // 2. A product saved before cleaning existed (damaged encoding, raw HTML) is served clean.
    const mojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
    await Product.collection.insertOne({
      sku: 'CEL-TXT-2', slug: 'legacy-adapter', model: 'LG-2', category: adapters!._id, price: 9900, stock: 5, status: 'active', dataSource: 'client',
      images: [], tags: [], specs: [], attributes: { connectors: [] }, featured: false, isBundle: false, bundleItems: [], related: [], createdAt: new Date(), updatedAt: new Date(),
      name: { ar: mojibake('شاحن جداري'), en: 'Wall Charger&nbsp;30W' },
      shortDescription: { ar: '', en: 'Itâ€™s compact' },
      description: { ar: '', en: '<div>Charges phones.<br/>Foldable pins.</div>' },
    });
    const pub = (await client().get('/api/products/legacy-adapter')).body.data;
    expect(pub.name).toEqual({ ar: 'شاحن جداري', en: 'Wall Charger 30W' });
    expect(pub.shortDescription.en).toBe('It’s compact');
    expect(pub.description.en).toBe('Charges phones.\nFoldable pins.');
    const listed = (await client().get('/api/products?q=LG-2')).body.data[0];
    expect(listed.name.en).toBe('Wall Charger 30W');
    expect(JSON.stringify(listed)).not.toMatch(/<[a-z]|&nbsp;|â€/i);

    // 3. Cart quote and order carry each product's own data (id, SKU, model, clean name, price, quantity).
    const { c: customer, email } = await createCustomer();
    const items = [
      { productId: String(stored!._id), quantity: 2 },
      { productId: pub._id, quantity: 1 },
    ];
    const quote = (await customer.post('/api/cart/quote').send({ items })).body.data;
    expect(quote.lines.map((l: { sku: string; model: string; quantity: number; unitPrice: number }) => [l.sku, l.model, l.quantity, l.unitPrice])).toEqual([
      ['CEL-TXT-1', 'TX-1', 2, 4900],
      ['CEL-TXT-2', 'LG-2', 1, 9900],
    ]);
    expect(quote.lines[1].name.ar).toBe('شاحن جداري');
    expect(quote.subtotal).toBe(2 * 4900 + 9900);

    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const order = await customer.post('/api/checkout').send({ idempotencyKey: uid(), items, contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod', lang: 'ar' });
    expect(order.status).toBe(201);
    const saved = await Order.findById(order.body.data.order.id).lean();
    expect(saved!.items.map((i) => [String(i.product), i.sku, i.model, i.name.en, i.name.ar, i.quantity, i.unitPrice, i.lineTotal])).toEqual([
      [String(stored!._id), 'CEL-TXT-1', 'TX-1', 'USB-C Cable', 'كابل USB-C', 2, 4900, 9800],
      [pub._id, 'CEL-TXT-2', 'LG-2', 'Wall Charger 30W', 'شاحن جداري', 1, 9900, 9900],
    ]);
    expect(saved!.total).toBe(9800 + 9900);
    // The customer's own order view shows the same lines.
    const mine = (await customer.get(`/api/orders/${saved!.orderNumber}`)).body.data;
    expect(mine.items.map((i: { sku: string; quantity: number }) => [i.sku, i.quantity])).toEqual([['CEL-TXT-1', 2], ['CEL-TXT-2', 1]]);
    // Stock moved for exactly these products.
    expect((await Product.findById(stored!._id).lean())!.stock).toBe(8);
    expect((await Product.findOne({ sku: 'CEL-TXT-2' }).lean())!.stock).toBe(4);
  });
});

describe('CSV formula guard', () => {
  it('neutralises spreadsheet formulas on export and restores the value on import', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+966500000000')).toBe(`'+966500000000`);
    const parsed = csvToObjects(`sku,name_en\nA,${csvCell('=SUM(1)')}\nB,${csvCell('plain, text')}`);
    expect(parsed).toEqual([
      { sku: 'A', name_en: '=SUM(1)' },
      { sku: 'B', name_en: 'plain, text' },
    ]);
  });
});
