import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/lib/csv';
import { Category, InventoryMovement, MediaAsset, Order, Product } from '../src/models';
import { matchImageFile } from '../src/modules/admin/product-images.service';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';

useDatabase();

const csv = (header: string[], ...rows: string[][]) => toCsv([header, ...rows]);

async function makeProduct(admin: Awaited<ReturnType<typeof createStaff>>, sku: string) {
  const cat = await Category.findOne({ slug: 'cables' }).lean();
  const r = await admin.post('/api/admin/products').send({
    sku,
    slug: sku.toLowerCase(),
    category: String(cat!._id),
    price: 50,
    compareAtPrice: 70,
    stock: 7,
    status: 'active',
    featured: true,
    images: [{ url: '/placeholders/cables.svg', alt: { ar: 'صورة', en: 'Photo' } }],
    name: { ar: `منتج ${sku}`, en: `Product ${sku}` },
    description: { ar: 'وصف', en: 'Old description' },
    attributes: { powerW: 60, connectors: ['usb-c'], color: { key: 'black', name: { ar: 'أسود', en: 'Black' }, hex: '#111111' } },
    specs: [{ label: { ar: 'الطول', en: 'Length' }, value: { ar: '1 م', en: '1 m' } }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { _id: string };
}

describe('CSV import: empty cells never erase data', () => {
  it('a text-only file keeps photos, price, stock, status and colour', async () => {
    const admin = await createStaff('admin');
    const { _id } = await makeProduct(admin, 'BULK-A');
    const file = csv(['sku', 'description_en', 'image_urls', 'price_sar', 'stock', 'status', 'color_key'], ['BULK-A', 'New description', '', '', '', '', '']);
    const res = await admin.post('/api/admin/products/import').send({ csv: file, dryRun: false });
    expect(res.body.data).toMatchObject({ updated: 1, skipped: 0, errors: [] });
    const p = (await Product.findById(_id).lean())!;
    expect(p.description).toMatchObject({ en: 'New description', ar: 'وصف' }); // Arabic kept
    expect(p.images).toHaveLength(1);
    expect(p.price).toBe(5000);
    expect(p.compareAtPrice).toBe(7000);
    expect(p.stock).toBe(7);
    expect(p.status).toBe('active');
    expect(p.featured).toBe(true);
    expect(p.attributes?.color?.key).toBe('black');
    expect(p.specs).toHaveLength(1);
    expect(p.name?.en).toBe('Product BULK-A');
  });

  it('a photos-only file (sku + image_urls) changes only the photos', async () => {
    const admin = await createStaff('admin');
    const { _id } = await makeProduct(admin, 'BULK-B');
    const file = csv(['sku', 'image_urls'], ['BULK-B', 'https://cdn.example.com/b-1.jpg|https://cdn.example.com/b-2.jpg']);
    const res = await admin.post('/api/admin/products/import').send({ csv: file, dryRun: false });
    expect(res.body.data).toMatchObject({ updated: 1, errors: [] });
    const p = (await Product.findById(_id).lean())!;
    expect(p.images?.map((i) => i.url)).toEqual(['https://cdn.example.com/b-1.jpg', 'https://cdn.example.com/b-2.jpg']);
    expect(p.description?.en).toBe('Old description');
    expect(p.stock).toBe(7); // no stock column: never reset to 0
    expect(await InventoryMovement.countDocuments({ product: _id, type: 'import' })).toBe(0);
    expect(p.status).toBe('active'); // no status column: never set back to draft
  });

  it('filled cells still update; partial colour and specs merge correctly', async () => {
    const admin = await createStaff('admin');
    const { _id } = await makeProduct(admin, 'BULK-C');
    const file = csv(['sku', 'price_sar', 'stock', 'color_name_en', 'power_w', 'spec1_label_en', 'spec1_value_en'], ['BULK-C', '45.50', '12', 'Midnight', '', 'Weight', '30 g']);
    const res = await admin.post('/api/admin/products/import').send({ csv: file, dryRun: false });
    expect(res.body.data.errors).toEqual([]);
    const p = (await Product.findById(_id).lean())!;
    expect(p.price).toBe(4550);
    expect(p.stock).toBe(12);
    expect(p.attributes?.color).toMatchObject({ key: 'black', hex: '#111111', name: { en: 'Midnight', ar: 'أسود' } });
    expect(p.attributes?.powerW).toBe(60);
    expect(p.attributes?.connectors).toEqual(['usb-c']);
    expect(p.specs?.map((s) => s.label?.en)).toEqual(['Weight']);
  });

  it('an exported file imported again keeps media-library photo data', async () => {
    const admin = await createStaff('admin');
    const { _id } = await makeProduct(admin, 'BULK-D');
    await Product.updateOne({ _id }, { $set: { images: [{ url: 'https://cdn.example.com/d.jpg', alt: { ar: 'a', en: 'b' }, width: 1600, height: 1600, variants: [{ width: 480, url: 'https://cdn.example.com/d-w480.webp' }] }] } });
    const exported = (await admin.get('/api/admin/products/export.csv')).text;
    expect((await admin.post('/api/admin/products/import').send({ csv: exported, dryRun: false })).body.data.errors).toEqual([]);
    const p = (await Product.findById(_id).lean())!;
    expect(p.images?.[0]).toMatchObject({ url: 'https://cdn.example.com/d.jpg', width: 1600 });
    expect(p.images?.[0].variants).toHaveLength(1);
  });

  it('new products: slug is made from the English name; rows with problems are explained', async () => {
    const admin = await createStaff('admin');
    await makeProduct(admin, 'BULK-E');
    const header = ['sku', 'category_slug', 'name_ar', 'name_en', 'price_sar', 'stock'];
    const file = csv(
      header,
      ['bulk-new-1', 'cables', 'كابل', 'Super Cable 2M', '39', '5'],
      ['BULK-NEW-2', 'cables', 'كابل', 'Super Cable 2M', '39', '5'],
      ['BULK-NEW-3', '', 'كابل', 'No category', '39', '5'],
      ['BULK-NEW-1', 'cables', 'كابل', 'Duplicate row', '39', '5'],
      ['BULK-E', 'nope', '', '', '', ''],
      ['', 'cables', 'x', 'y', '1', '1'],
      ['BULK-E', '', '', '', '', '-3'],
    );
    const dry = await admin.post('/api/admin/products/import').send({ csv: file, dryRun: true });
    const errs = dry.body.data.errors as { row: number; errors: unknown }[];
    expect(errs.map((e) => e.row)).toEqual([4, 5, 6, 7, 8]);
    const real = await admin.post('/api/admin/products/import').send({ csv: file, dryRun: false });
    expect(real.body.data.created).toBe(2);
    expect((await Product.findOne({ sku: 'BULK-NEW-1' }).lean())?.slug).toBe('super-cable-2m');
    expect((await Product.findOne({ sku: 'BULK-NEW-2' }).lean())?.slug).toBe('super-cable-2m-2');
    expect((await Product.findOne({ sku: 'BULK-E' }).lean())?.stock).toBe(7);
  });
});

describe('bulk photos by SKU file name', () => {
  const skus = new Set(['CEL-PB-20000', 'CEL-CB-100', 'CEL-CB', 'ABC']);
  it('reads the SKU and the photo number from the file name', () => {
    expect(matchImageFile('CEL-PB-20000-1.jpg', skus)).toEqual({ sku: 'CEL-PB-20000', position: 1 });
    expect(matchImageFile('cel-pb-20000_3.PNG', skus)).toEqual({ sku: 'CEL-PB-20000', position: 3 });
    expect(matchImageFile('CEL-PB-20000 (2).webp', skus)).toEqual({ sku: 'CEL-PB-20000', position: 2 });
    expect(matchImageFile('CEL-PB-20000.jpg', skus)).toEqual({ sku: 'CEL-PB-20000', position: 1 });
    expect(matchImageFile('CEL-CB-100.jpg', skus)).toEqual({ sku: 'CEL-CB-100', position: 1 }); // SKU ending in a number
    expect(matchImageFile('CEL-CB-100-2.jpg', skus)).toEqual({ sku: 'CEL-CB-100', position: 2 });
    expect(matchImageFile('ABC 4.jpg', skus)).toEqual({ sku: 'ABC', position: 4 });
    expect(matchImageFile('UNKNOWN-1.jpg', skus)).toBeNull();
    expect(matchImageFile('photo.jpg', skus)).toBeNull();
  });

  it('matches, then attaches photos in order (replace and append); never touches other fields', async () => {
    const admin = await createStaff('admin');
    const { _id } = await makeProduct(admin, 'BULK-IMG');
    const match = await admin.post('/api/admin/products/images/match').send({ files: ['BULK-IMG-2.jpg', 'bulk-img-1.jpg', 'nobody-1.jpg'] });
    expect(match.status).toBe(200);
    expect(match.body.data).toMatchObject([
      { file: 'BULK-IMG-2.jpg', sku: 'BULK-IMG', position: 2, productId: _id, currentImages: 1 },
      { file: 'bulk-img-1.jpg', sku: 'BULK-IMG', position: 1 },
      { file: 'nobody-1.jpg', sku: null },
    ]);
    const asset = (n: number) =>
      MediaAsset.create({ kind: 'image', source: 'upload', status: 'ready', url: `https://cdn.example.com/m${n}.jpg`, width: 1200, height: 1200, variants: [{ width: 480, url: `https://cdn.example.com/m${n}-480.webp`, key: `k${n}` }] });
    const [a1, a2, a3] = await Promise.all([asset(1), asset(2), asset(3)]);
    const pending = await MediaAsset.create({ kind: 'image', source: 'upload', status: 'pending', url: 'https://cdn.example.com/p.jpg' });

    const rep = await admin.post('/api/admin/products/images/attach').send({ mode: 'replace', items: [{ sku: 'bulk-img', mediaIds: [String(a1._id), String(a2._id)] }, { sku: 'NOBODY', mediaIds: [String(a3._id)] }] });
    expect(rep.status).toBe(200);
    expect(rep.body.data).toEqual([{ sku: 'BULK-IMG', ok: true, images: 2 }, { sku: 'NOBODY', ok: false, error: 'No product has this SKU' }]);
    let p = (await Product.findById(_id).lean())!;
    expect(p.images?.map((i) => i.url)).toEqual(['https://cdn.example.com/m1.jpg', 'https://cdn.example.com/m2.jpg']);
    expect(String(p.images?.[0].mediaId)).toBe(String(a1._id));
    expect(p.images?.[0]).toMatchObject({ width: 1200, alt: { en: 'Product BULK-IMG' } });
    expect(p.images?.[0].variants?.[0].url).toBe('https://cdn.example.com/m1-480.webp');
    expect(p).toMatchObject({ price: 5000, stock: 7, status: 'active', description: { en: 'Old description' } });

    await admin.post('/api/admin/products/images/attach').send({ mode: 'append', items: [{ sku: 'BULK-IMG', mediaIds: [String(a3._id), String(a1._id)] }] });
    p = (await Product.findById(_id).lean())!;
    expect(p.images?.map((i) => i.url)).toEqual(['https://cdn.example.com/m1.jpg', 'https://cdn.example.com/m2.jpg', 'https://cdn.example.com/m3.jpg']);
    expect(p.images?.[0].variants).toHaveLength(1); // kept on append

    const half = await admin.post('/api/admin/products/images/attach').send({ mode: 'replace', items: [{ sku: 'BULK-IMG', mediaIds: [String(pending._id)] }] });
    expect(half.body.data[0].ok).toBe(false);
    expect((await Product.findById(_id).lean())!.images).toHaveLength(3); // unchanged
  });

  it('needs the products:write permission', async () => {
    const viewer = await createStaff('order_manager');
    expect((await viewer.post('/api/admin/products/images/match').send({ files: ['A-1.jpg'] })).status).toBe(403);
    expect((await viewer.post('/api/admin/products/images/attach').send({ mode: 'replace', items: [{ sku: 'AA', mediaIds: ['0123456789abcdef01234567'] }] })).status).toBe(403);
  });
});

describe('bulk actions on the product list', () => {
  it('sets the status of many products at once; delete archives products that are in orders', async () => {
    const admin = await createStaff('admin');
    const ids: string[] = [];
    for (const sku of ['BULK-S1', 'BULK-S2', 'BULK-S3']) ids.push((await makeProduct(admin, sku))._id);
    const status = async () => (await Product.find({ _id: { $in: ids } }).select('status').lean()).map((p) => p.status);

    const draft = await admin.post('/api/admin/products/bulk').send({ ids, action: 'draft' });
    expect(draft.body.data).toMatchObject({ requested: 3, updated: 3 });
    expect(await status()).toEqual(['draft', 'draft', 'draft']);
    // Only the selected ones change; already-active ones are not counted twice.
    expect((await admin.post('/api/admin/products/bulk').send({ ids: [ids[0], ids[1]], action: 'active' })).body.data.updated).toBe(2);
    expect((await admin.post('/api/admin/products/bulk').send({ ids: [ids[0]], action: 'active' })).body.data.updated).toBe(0);
    expect((await admin.post('/api/admin/products/bulk').send({ ids: [ids[2]], action: 'archived' })).body.data.updated).toBe(1);
    expect((await Product.find({ _id: { $in: ids } }).sort({ sku: 1 }).select('status').lean()).map((p) => p.status)).toEqual(['active', 'active', 'archived']);

    // A product in a past order is archived, never deleted (order history stays intact).
    const shop = client();
    const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: ids[0], quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'ar' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await Order.exists({ 'items.product': ids[0] })).toBeTruthy();
    const del = await admin.post('/api/admin/products/bulk').send({ ids, action: 'delete' });
    expect(del.body.data).toMatchObject({ deleted: 2, archived: 1 });
    const left = await Product.find({ _id: { $in: ids } }).lean();
    expect(left.map((p) => [p.sku, p.status])).toEqual([['BULK-S1', 'archived']]);
  });

  it('validates input and needs products:write', async () => {
    const admin = await createStaff('admin');
    expect((await admin.post('/api/admin/products/bulk').send({ ids: [], action: 'active' })).status).toBe(400);
    expect((await admin.post('/api/admin/products/bulk').send({ ids: ['0123456789abcdef01234567'], action: 'publish' })).status).toBe(400);
    const missing = await admin.post('/api/admin/products/bulk').send({ ids: ['0123456789abcdef01234567'], action: 'active' });
    expect(missing.body.data).toMatchObject({ updated: 0, notFound: 1 });
    const viewer = await createStaff('order_manager');
    expect((await viewer.post('/api/admin/products/bulk').send({ ids: ['0123456789abcdef01234567'], action: 'delete' })).status).toBe(403);
  });
});
