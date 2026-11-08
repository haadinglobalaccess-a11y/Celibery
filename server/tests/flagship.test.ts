import { describe, expect, it } from 'vitest';
import { csvToObjects } from '../src/lib/csv';
import { Category, Product, ProductCollection } from '../src/models';
import { client, createStaff, useDatabase } from './helpers';

useDatabase();

type Row = { _id: string; sku: string; featured: boolean; flagship?: boolean; flagshipOrder?: number };

describe('independent Featured and Flagship selections', () => {
  it('saves, edits, filters and serves the two selections independently', async () => {
    const admin = await createStaff('admin');
    const cat = await Category.findOne({ slug: 'cables' }).lean();
    const img = [{ url: '/placeholders/cables.svg', alt: { ar: '', en: '' } }];
    const make = async (sku: string, extra: Record<string, unknown>) => {
      const r = await admin.post('/api/admin/products').send({ sku, slug: sku.toLowerCase(), category: String(cat!._id), price: 50, stock: 5, status: 'active', images: img, name: { ar: `منتج ${sku}`, en: `Product ${sku}` }, ...extra });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.data as Row;
    };

    // 1–4: every combination.
    const featOnly = await make('FS-FEAT', { featured: true });
    const flagOnly = await make('FS-FLAG', { flagship: true, flagshipOrder: 2 });
    const both = await make('FS-BOTH', { featured: true, flagship: true, flagshipOrder: 1 });
    const neither = await make('FS-NONE', {});
    const stored = async (id: string) => (await admin.get(`/api/admin/products/${id}`)).body.data as Row;
    expect(await stored(featOnly._id)).toMatchObject({ featured: true, flagship: false });
    expect(await stored(flagOnly._id)).toMatchObject({ featured: false, flagship: true, flagshipOrder: 2 });
    expect(await stored(both._id)).toMatchObject({ featured: true, flagship: true, flagshipOrder: 1 });
    expect(await stored(neither._id)).toMatchObject({ featured: false, flagship: false });

    // 7: editing other fields keeps both selections; changing one never changes the other.
    expect((await admin.put(`/api/admin/products/${both._id}`).send({ name: { ar: 'منتج معدّل', en: 'Edited' } })).status).toBe(200);
    expect(await stored(both._id)).toMatchObject({ featured: true, flagship: true, flagshipOrder: 1 });
    await admin.put(`/api/admin/products/${featOnly._id}`).send({ featured: false });
    expect(await stored(featOnly._id)).toMatchObject({ featured: false, flagship: false });
    await admin.put(`/api/admin/products/${featOnly._id}`).send({ featured: true });
    await admin.put(`/api/admin/products/${flagOnly._id}`).send({ flagship: false });
    expect(await stored(flagOnly._id)).toMatchObject({ featured: false, flagship: false });
    await admin.put(`/api/admin/products/${flagOnly._id}`).send({ flagship: true });
    expect(await stored(flagOnly._id)).toMatchObject({ featured: false, flagship: true, flagshipOrder: 2 });

    // A product saved before this field existed reads as "not flagship" everywhere.
    await Product.collection.insertOne({ sku: 'FS-OLD', slug: 'fs-old', category: cat!._id, price: 100, stock: 1, status: 'active', featured: true, images: img, name: { ar: 'قديم', en: 'Old' }, dataSource: 'client', createdAt: new Date(), updatedAt: new Date() });

    // 5–6: placement filters, alone and with search, status and pagination.
    const list = async (qs: string) => (await admin.get(`/api/admin/products?limit=100&${qs}`)).body as { data: Row[]; meta: { total: number; pages: number } };
    const featured = (await list('placement=featured')).data;
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.every((p) => p.featured)).toBe(true);
    expect(featured.map((p) => p.sku)).toEqual(expect.arrayContaining(['FS-FEAT', 'FS-BOTH', 'FS-OLD']));
    const flagship = (await list('placement=flagship')).data;
    expect(flagship.map((p) => p.sku).sort()).toEqual(['FS-BOTH', 'FS-FLAG']);
    expect((await list('placement=flagship&q=FS-FLAG')).data.map((p) => p.sku)).toEqual(['FS-FLAG']);
    expect((await list('placement=featured&q=FS-')).data.map((p) => p.sku).sort()).toEqual(['FS-BOTH', 'FS-FEAT', 'FS-OLD']);
    const page1 = (await admin.get('/api/admin/products?placement=flagship&limit=1&page=1')).body;
    const page2 = (await admin.get('/api/admin/products?placement=flagship&limit=1&page=2')).body;
    expect(page1.meta).toMatchObject({ total: 2, pages: 2 });
    expect(new Set([page1.data[0].sku, page2.data[0].sku])).toEqual(new Set(['FS-BOTH', 'FS-FLAG']));
    // Status filters are unchanged and separate from placement.
    expect((await list('status=active')).data.every((p) => (p as unknown as { status: string }).status === 'active')).toBe(true);
    expect((await admin.get('/api/admin/products?placement=bestsellers')).status).toBe(400);

    // 8–10: homepage. Flagship = only selected, active, with a photo, in Flagship order.
    await make('FS-DRAFT-FLAG', { flagship: true, flagshipOrder: 0, status: 'draft' });
    await make('FS-NOPHOTO-FLAG', { flagship: true, flagshipOrder: 0, images: [] });
    // Featured products and a curated Best Sellers collection exist — neither may enter Flagship.
    await ProductCollection.updateOne({ kind: 'best_sellers' }, { $set: { active: true, products: [featOnly._id, neither._id] } });
    const home = (await client().get('/api/home')).body.data as { flagship: Row[]; featured: Row[]; bestSellers: { items: Row[] } };
    expect(home.flagship.map((p) => p.sku)).toEqual(['FS-BOTH', 'FS-FLAG']); // order 1, then 2
    expect(home.featured.map((p) => p.sku)).toEqual(expect.arrayContaining(['FS-FEAT', 'FS-BOTH'])); // Featured still works on its own
    expect(home.bestSellers.items.length).toBeGreaterThan(0);
    for (const sku of ['FS-FEAT', 'FS-NONE', 'FS-OLD', 'FS-DRAFT-FLAG', 'FS-NOPHOTO-FLAG']) expect(home.flagship.map((p) => p.sku)).not.toContain(sku);

    // Reordering is Admin-controlled; at most three are shown.
    await admin.put(`/api/admin/products/${flagOnly._id}`).send({ flagshipOrder: 0 });
    await make('FS-FLAG-3', { flagship: true, flagshipOrder: 3 });
    await make('FS-FLAG-4', { flagship: true, flagshipOrder: 4 });
    const again = (await client().get('/api/home')).body.data.flagship as Row[];
    expect(again.map((p) => p.sku)).toEqual(['FS-FLAG', 'FS-BOTH', 'FS-FLAG-3']);

    // With nothing selected the section has nothing to show (nothing is filled in automatically).
    await Product.updateMany({}, { $set: { flagship: false } });
    expect((await client().get('/api/home')).body.data.flagship).toEqual([]);
  });

  it('CSV export carries both selections; importing an older file without them keeps Flagship', async () => {
    const admin = await createStaff('admin');
    const p = await Product.findOne({ dataSource: 'demo' }).lean();
    await Product.updateOne({ _id: p!._id }, { $set: { flagship: true, flagshipOrder: 7, featured: false } });
    const csv = (await admin.get('/api/admin/products/export.csv')).text;
    const row = csvToObjects(csv).find((r) => r.sku === p!.sku)!;
    expect(row).toMatchObject({ featured: 'no', flagship: 'yes', flagship_order: '7' });

    // Re-import the export: unchanged.
    expect((await admin.post('/api/admin/products/import').send({ csv, dryRun: false })).body.data.errors).toEqual([]);
    expect(await Product.findById(p!._id).lean()).toMatchObject({ flagship: true, flagshipOrder: 7, featured: false });

    // An older file (no flagship columns) updates other fields but never resets the selection.
    const body = csv.codePointAt(0) === 0xfeff ? csv.slice(1) : csv; // Excel BOM
    const lines = body.split('\n');
    const header = lines[0].split(',');
    const drop = new Set([header.indexOf('flagship'), header.indexOf('flagship_order')]);
    const strip = (line: string) => {
      // Parse one line with the shared parser, then rebuild it without the two columns.
      const cells = line === lines[0] ? header : Object.values(csvToObjects(`${lines[0]}\n${line}`)[0]);
      return cells.filter((_, i) => !drop.has(i)).map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
    };
    const older = [strip(lines[0]), strip(lines.find((l) => l.startsWith(`${p!.sku},`))!)].join('\n');
    const res = await admin.post('/api/admin/products/import').send({ csv: older, dryRun: false });
    expect(res.body.data).toMatchObject({ updated: 1, errors: [] });
    expect(await Product.findById(p!._id).lean()).toMatchObject({ flagship: true, flagshipOrder: 7 });
  });
});
