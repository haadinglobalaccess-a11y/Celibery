import { describe, expect, it } from 'vitest';
import { csvCell, csvToObjects } from '../src/lib/csv';
import { repairMojibake } from '../src/lib/text';
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
      shortDescription: { ar: '', en: new TextDecoder('windows-1252').decode(Buffer.from('It’s compact', 'utf8')) },
      description: { ar: '', en: '<div>Charges phones.<br/>Foldable pins.</div>' },
    });
    const pub = (await client().get('/api/products/legacy-adapter')).body.data;
    expect(pub.name).toEqual({ ar: 'شاحن جداري', en: 'Wall Charger 30W' });
    expect(pub.shortDescription.en).toBe('It’s compact');
    expect(pub.description.en).toBe('Charges phones.\nFoldable pins.');
    const listed = (await client().get('/api/products?q=LG-2')).body.data[0];
    expect(listed.name.en).toBe('Wall Charger 30W');
    expect(JSON.stringify(listed)).not.toMatch(/<[a-z]|&nbsp;/i);
    expect(repairMojibake(JSON.stringify(listed))).toBe(JSON.stringify(listed)); // nothing left to repair

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

describe('text encoding end to end', () => {
  const asCp1252 = (s: string) => new TextDecoder('windows-1252').decode(Buffer.from(s, 'utf8'));
  const LOST = String.fromCodePoint(0xfffd);

  it('every text response declares UTF-8 and keeps Arabic intact', async () => {
    const res = await client().get('/api/products?limit=50&lang=ar');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    const arabic = res.body.data.map((p: { name: { ar: string } }) => p.name.ar).join(' ');
    expect(arabic).toMatch(/[ء-ي]/);
    expect(arabic).not.toContain(LOST);
    for (const url of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
      const r = await client().get(url);
      expect(r.headers['content-type'], url).toMatch(/; charset=utf-8$/i);
    }
  });

  it('CSV exports start with a BOM (Excel) and Arabic survives export → import', async () => {
    const admin = await createStaff('admin');
    for (const url of ['/api/admin/products/export.csv', '/api/admin/reports/orders.csv']) {
      const r = await admin.get(url).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(r.headers['content-type'], url).toBe('text/csv; charset=utf-8');
      const bytes = r.body as Buffer;
      expect([...bytes.subarray(0, 3)], url).toEqual([0xef, 0xbb, 0xbf]);
      if (url.includes('products')) {
        const rows = csvToObjects(bytes.toString('utf8'));
        const sample = await Product.findOne({ sku: 'DEMO-AD-30W' }).lean();
        expect(rows.find((x) => x.sku === 'DEMO-AD-30W')!.name_ar).toBe(sample!.name.ar);
      }
    }
  });

  it('Admin saves repair reversible encoding damage and refuse text whose characters were lost', async () => {
    const admin = await createStaff('admin');
    // Settings (Store & contact): damaged Arabic address is stored repaired.
    const saved = await admin.put('/api/admin/settings').send({ business: { address: { ar: asCp1252('الرياض، حي العليا'), en: asCp1252('Olaya – Riyadh') } } });
    expect(saved.status).toBe(200);
    const pub = (await client().get('/api/settings/public')).body.data;
    expect(pub.business.address).toEqual({ ar: 'الرياض، حي العليا', en: 'Olaya – Riyadh' });
    // Lost characters are refused with a clear message, never stored.
    const refused = await admin.put('/api/admin/settings').send({ business: { address: { ar: `الرياض ${LOST}${LOST}`, en: 'Riyadh' } } });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body.error.details)).toContain('unreadable characters');
    expect((await client().get('/api/settings/public')).body.data.business.address.ar).toBe('الرياض، حي العليا');

    // Message templates (email / WhatsApp wording).
    const key = 'order.shipped';
    const tpl = await admin.put(`/api/admin/templates/${key}`).send({ ar: { subject: asCp1252('تم شحن طلبك {{orderNumber}}') } });
    expect(tpl.status).toBe(200);
    expect(tpl.body.data.effective.ar.subject).toBe('تم شحن طلبك {{orderNumber}}');
    expect((await admin.put(`/api/admin/templates/${key}`).send({ en: { subject: `Shipped ${LOST}` } })).status).toBe(400);

    // Products: name and description.
    const cat = await Category.findOne({ slug: 'cables' }).lean();
    const p = await admin.post('/api/admin/products').send({
      sku: 'CEL-ENC-1', slug: 'encoding-cable', category: String(cat!._id), price: 10, stock: 1,
      name: { ar: asCp1252('كابل شحن'), en: asCp1252('Cable – 1 m “braided”') },
      description: { ar: asCp1252(asCp1252('وصف المنتج')), en: 'Plain' }, // double-encoded
    });
    expect(p.status).toBe(201);
    const stored = await Product.findOne({ sku: 'CEL-ENC-1' }).lean();
    expect(stored!.name).toMatchObject({ ar: 'كابل شحن', en: 'Cable – 1 m “braided”' });
    expect(stored!.description.ar).toBe('وصف المنتج');
    expect((await admin.post('/api/admin/products').send({ sku: 'CEL-ENC-2', slug: 'encoding-2', category: String(cat!._id), price: 10, name: { ar: `كابل ${LOST}`, en: 'Cable' } })).status).toBe(400);
  });

  it('the stored-data repair tool: dry run, backup, apply, restore — orders only on request', async () => {
    const { scanStoredText, applyTextRepairs, restoreTextRepairs } = await import('../src/lib/text-repair');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const cat = await Category.findOne({ slug: 'cables' }).lean();
    // Damage written straight to the database (as an old import or a bad copy-paste would have).
    const { insertedId } = await Product.collection.insertOne({
      sku: 'CEL-DB-1', slug: 'db-damaged', category: cat!._id, price: 100, stock: 1, status: 'draft', dataSource: 'client', images: [], specs: [{ label: { ar: asCp1252('الطول'), en: 'Length' }, value: { ar: '1 م', en: '1 m' } }],
      name: { ar: asCp1252('كابل تالف'), en: asCp1252('It’s damaged') }, shortDescription: { ar: '', en: `Lost ${LOST}` }, description: { ar: '', en: '' },
    });
    await Category.collection.updateOne({ _id: cat!._id }, { $set: { 'description.ar': asCp1252('كابلات شحن') } });
    const order = await Order.findOne().lean();
    if (order) await Order.collection.updateOne({ _id: order._id }, { $set: { 'items.0.name.ar': asCp1252('منتج') } });

    const findings = await scanStoredText();
    const mine = findings.filter((f) => f.id === String(insertedId));
    expect(mine.map((f) => [f.path, f.after])).toEqual(expect.arrayContaining([
      ['name.ar', 'كابل تالف'], ['name.en', 'It’s damaged'], ['specs.0.label.ar', 'الطول'], ['shortDescription.en', null],
    ]));
    expect(findings.some((f) => f.collection === 'categories' && f.after === 'كابلات شحن')).toBe(true);
    // Dry run changed nothing.
    expect((await Product.collection.findOne({ _id: insertedId }))!.name.ar).toBe(asCp1252('كابل تالف'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-repair-'));
    const result = await applyTextRepairs(findings, dir);
    const backup = JSON.parse(fs.readFileSync(result.backup, 'utf8'));
    expect(backup.repairs.some((r: { path: string; before: string }) => r.path === 'name.ar' && r.before === asCp1252('كابل تالف'))).toBe(true);
    const after = (await Product.collection.findOne({ _id: insertedId }))!;
    expect(after.name).toEqual({ ar: 'كابل تالف', en: 'It’s damaged' });
    expect(after.specs[0].label.ar).toBe('الطول');
    expect(after.shortDescription.en).toBe(`Lost ${LOST}`); // unrecoverable: reported, never guessed
    if (order) expect((await Order.collection.findOne({ _id: order._id }))!.items[0].name.ar).toBe(asCp1252('منتج')); // orders untouched by default

    const restored = await restoreTextRepairs(result.backup);
    expect(restored.restored).toBe(result.applied);
    expect((await Product.collection.findOne({ _id: insertedId }))!.name.ar).toBe(asCp1252('كابل تالف'));

    await applyTextRepairs(await scanStoredText(), dir, { includeOrders: true });
    if (order) expect((await Order.collection.findOne({ _id: order._id }))!.items[0].name.ar).toBe('منتج');
    fs.rmSync(dir, { recursive: true, force: true });
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
