import { DEFAULT_ROLES } from '../lib/permissions';
import { Campaign, Category, InventoryMovement, Page, Product, ProductCollection, Role, getSettings } from '../models';
import { CAMPAIGNS, CATEGORIES, COLLECTIONS, PAGES } from './base-data';
import { DEMO_PRODUCTS } from './demo-data';

/** Idempotent: creates missing records only; never overwrites content edited in the admin. */
export async function seedBase() {
  await getSettings();
  for (const r of DEFAULT_ROLES) {
    await Role.updateOne({ key: r.key }, { $setOnInsert: r }, { upsert: true });
  }
  // The administrator role always holds every permission (new permissions are added on upgrade).
  const admin = DEFAULT_ROLES.find((r) => r.key === 'admin')!;
  await Role.updateOne({ key: 'admin' }, { $set: { permissions: admin.permissions, system: true } });

  for (const c of CATEGORIES) {
    await Category.updateOne(
      { slug: c.slug },
      { $setOnInsert: { slug: c.slug, name: c.name, filters: c.filters, sortOrder: c.sortOrder, active: true, image: { url: c.image, alt: c.name } } },
      { upsert: true },
    );
  }
  for (const c of COLLECTIONS) {
    await ProductCollection.updateOne({ slug: c.slug }, { $setOnInsert: { ...c, products: [], active: true } }, { upsert: true });
  }
  for (const c of CAMPAIGNS) {
    await Campaign.updateOne({ slug: c.slug }, { $setOnInsert: { ...c, active: false } }, { upsert: true });
  }
  for (const p of PAGES) {
    await Page.updateOne({ slug: p.slug }, { $setOnInsert: { ...p, status: 'draft' } }, { upsert: true });
  }
  return { roles: DEFAULT_ROLES.length, categories: CATEGORIES.length, pages: PAGES.length };
}

/**
 * DEVELOPMENT DATA ONLY. Creates clearly-labelled demo products (dataSource = "demo",
 * SKU prefix DEMO-) so the storefront can be reviewed before CELIBERY's real catalogue
 * (Q14) is imported. Remove with `removeDemo()` / `npm run seed:demo -- --remove`.
 */
export async function seedDemo() {
  await seedBase();
  const cats = await Category.find().lean();
  const bySlug = new Map(cats.map((c) => [c.slug, c._id]));
  let created = 0;
  for (const d of DEMO_PRODUCTS) {
    const exists = await Product.exists({ sku: d.sku });
    if (exists) continue;
    const p = await Product.create({ ...d, category: bySlug.get(d.category), dataSource: 'demo', status: 'active' });
    await InventoryMovement.create({ product: p._id, type: 'initial', delta: d.stock, stockAfter: d.stock, reason: 'Demo seed' });
    created++;
  }
  // Demo bundle contents + collections.
  const demo = await Product.find({ dataSource: 'demo' }).lean();
  const bySku = new Map(demo.map((p) => [p.sku, p._id]));
  const kit = demo.find((p) => p.sku === 'DEMO-KIT-TRAVEL');
  if (kit) {
    await Product.updateOne(
      { _id: kit._id },
      { $set: { bundleItems: ['DEMO-PB-10K', 'DEMO-CB-CC-1M', 'DEMO-AD-30W'].map((s) => ({ product: bySku.get(s), quantity: 1 })).filter((b) => b.product) } },
    );
  }
  const setCol = (slug: string, skus: string[]) =>
    ProductCollection.updateOne({ slug, products: { $size: 0 } }, { $set: { products: skus.map((s) => bySku.get(s)).filter(Boolean) } });
  await setCol('bundles', ['DEMO-KIT-TRAVEL', 'DEMO-KIT-GIFT']);
  await setCol('best-sellers', ['DEMO-AD-65W', 'DEMO-PB-20K', 'DEMO-HP-ANC', 'DEMO-CB-CC-1M']);
  await setCol('for-travel', ['DEMO-PB-10K', 'DEMO-AD-30W', 'DEMO-KIT-TRAVEL', 'DEMO-HP-ANC']);
  await setCol('for-work', ['DEMO-AD-65W', 'DEMO-CB-CC-2M', 'DEMO-TE-HUB']);
  await setCol('for-fitness', ['DEMO-HP-SPORT', 'DEMO-PB-10K']);
  await setCol('for-home', ['DEMO-AD-65W', 'DEMO-TE-STAND', 'DEMO-CB-CL-1M']);
  return { created };
}

export async function removeDemo() {
  const demo = await Product.find({ dataSource: 'demo' }).select('_id').lean();
  const ids = demo.map((d) => d._id);
  await ProductCollection.updateMany({}, { $pull: { products: { $in: ids } } });
  await InventoryMovement.deleteMany({ product: { $in: ids } });
  const r = await Product.deleteMany({ _id: { $in: ids } });
  return { removed: r.deletedCount };
}
