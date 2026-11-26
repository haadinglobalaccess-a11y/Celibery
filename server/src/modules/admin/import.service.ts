import { csvToObjects, toCsv } from '../../lib/csv';
import { Category, InventoryMovement, Product } from '../../models';
import { slugify } from '../../lib/slug';
import { productCreate, productUpdate } from './admin.schemas';
import { createProduct, updateProduct } from './products.service';

/**
 * Imports CELIBERY's product list (Q14) from the CSV template in docs/product-import-template.csv.
 * Upserts by SKU. Rows are validated with the same rules as the admin product form; invalid rows
 * are reported and skipped. Stock for existing products is set through the inventory ledger.
 *
 * Existing products: only filled-in cells change anything. An empty cell, or a column the file does
 * not have, keeps the current value. So the details team can import text without touching the
 * photos, and a photos-only file never wipes names, prices or stock. New products need the full row.
 */
const split = (v: string) => (v ? v.split('|').map((x) => x.trim()).filter(Boolean) : []);
const num = (v: string) => (v === '' ? undefined : Number(v));

export function rowToProduct(r: Record<string, string>, categoryId: string | undefined) {
  const specs = [];
  for (let i = 1; i <= 8; i++) {
    const la = r[`spec${i}_label_ar`] ?? '';
    const le = r[`spec${i}_label_en`] ?? '';
    const va = r[`spec${i}_value_ar`] ?? '';
    const ve = r[`spec${i}_value_en`] ?? '';
    if (la || le || va || ve) specs.push({ label: { ar: la, en: le }, value: { ar: va, en: ve } });
  }
  const colorKey = (r.color_key ?? '').toLowerCase();
  return {
    sku: r.sku,
    slug: r.slug,
    model: r.model ?? '',
    category: categoryId ?? '',
    name: { ar: r.name_ar ?? '', en: r.name_en ?? '' },
    shortDescription: { ar: r.short_description_ar ?? '', en: r.short_description_en ?? '' },
    description: { ar: r.description_ar ?? '', en: r.description_en ?? '' },
    series: r.series ?? '',
    images: split(r.image_urls ?? '').map((url) => ({ url, alt: { ar: r.name_ar ?? '', en: r.name_en ?? '' } })),
    price: num(r.price_sar ?? '') as number,
    compareAtPrice: num(r.compare_at_price_sar ?? '') ?? null,
    stock: num(r.stock ?? '') ?? 0,
    status: (r.status || 'draft') as 'draft' | 'active' | 'archived',
    featured: ['1', 'true', 'yes'].includes((r.featured ?? '').toLowerCase()),
    flagship: ['1', 'true', 'yes'].includes((r.flagship ?? '').toLowerCase()),
    flagshipOrder: num(r.flagship_order ?? '') ?? 0,
    attributes: {
      capacityMah: num(r.capacity_mah ?? '') ?? null,
      powerW: num(r.power_w ?? '') ?? null,
      connectors: split(r.connectors ?? ''),
      color: colorKey ? { key: colorKey, name: { ar: r.color_name_ar ?? '', en: r.color_name_en ?? '' }, hex: r.color_hex ?? '' } : null,
    },
    specs,
    tags: split(r.tags ?? ''),
    warrantyMonths: num(r.warranty_months ?? '') ?? null,
  };
}

type Loc = { ar?: string | null; en?: string | null } | null | undefined;
type ExistingImage = { url: string; alt?: Loc; mediaId?: unknown; variants?: { width: number; url: string }[] | null; width?: number | null; height?: number | null };
type ExistingProduct = {
  _id: unknown;
  stock: number;
  name?: Loc;
  shortDescription?: Loc;
  description?: Loc;
  images?: ExistingImage[] | null;
  attributes?: { capacityMah?: number | null; powerW?: number | null; connectors?: string[] | null; color?: { key?: string | null; name?: Loc; hex?: string | null } | null } | null;
};

const filled = (r: Record<string, string>, k: string) => (r[k] ?? '').trim() !== '';
const LOCALIZED: [field: 'name' | 'shortDescription' | 'description', column: string][] = [
  ['name', 'name'],
  ['shortDescription', 'short_description'],
  ['description', 'description'],
];
const yes = (v: string) => ['1', 'true', 'yes'].includes(v.trim().toLowerCase());

/** An image already on a product, in the shape the product schema accepts (keeps responsive sizes). */
export function keepImage(old: ExistingImage) {
  return {
    url: old.url,
    alt: { ar: old.alt?.ar ?? '', en: old.alt?.en ?? '' },
    ...(old.mediaId ? { mediaId: String(old.mediaId) } : {}),
    ...(old.variants?.length ? { variants: old.variants.map((v) => ({ width: v.width, url: v.url })) } : {}),
    ...(old.width ? { width: old.width } : {}),
    ...(old.height ? { height: old.height } : {}),
  };
}

/**
 * The changes one CSV row makes to an existing product: only the cells that are filled in.
 * One language of a pair keeps the other language's current text. Photos that are already on the
 * product keep their media-library data (responsive sizes) when the same URL is listed again.
 */
export function rowToUpdate(r: Record<string, string>, existing: ExistingProduct, categoryId: string | undefined) {
  const full = rowToProduct(r, categoryId);
  const u: Record<string, unknown> = {};
  if (filled(r, 'slug')) u.slug = full.slug;
  if (filled(r, 'model')) u.model = full.model;
  if (filled(r, 'category_slug')) u.category = categoryId ?? '';
  for (const [field, col] of LOCALIZED) {
    if (!filled(r, `${col}_ar`) && !filled(r, `${col}_en`)) continue;
    u[field] = { ar: filled(r, `${col}_ar`) ? r[`${col}_ar`] : (existing[field]?.ar ?? ''), en: filled(r, `${col}_en`) ? r[`${col}_en`] : (existing[field]?.en ?? '') };
  }
  if (filled(r, 'series')) u.series = full.series;
  if (filled(r, 'image_urls')) {
    const byUrl = new Map((existing.images ?? []).map((i) => [i.url, i]));
    const name = (u.name as Loc) ?? existing.name;
    u.images = split(r.image_urls).map((url) => {
      const old = byUrl.get(url);
      return old ? keepImage(old) : { url, alt: { ar: name?.ar ?? '', en: name?.en ?? '' } };
    });
  }
  if (filled(r, 'price_sar')) u.price = full.price;
  if (filled(r, 'compare_at_price_sar')) u.compareAtPrice = full.compareAtPrice;
  if (filled(r, 'status')) u.status = r.status.trim().toLowerCase();
  if (filled(r, 'featured')) u.featured = yes(r.featured);
  if (filled(r, 'flagship')) u.flagship = yes(r.flagship);
  if (filled(r, 'flagship_order')) u.flagshipOrder = full.flagshipOrder;
  if (filled(r, 'warranty_months')) u.warrantyMonths = full.warrantyMonths;
  if (filled(r, 'tags')) u.tags = full.tags;

  const colorCols = ['color_key', 'color_name_ar', 'color_name_en', 'color_hex'];
  if (['capacity_mah', 'power_w', 'connectors', ...colorCols].some((c) => filled(r, c))) {
    const a = existing.attributes ?? {};
    const old = a.color ?? null;
    let color: { key: string; name: { ar: string; en: string }; hex: string } | null = old?.key ? { key: old.key, name: { ar: old.name?.ar ?? '', en: old.name?.en ?? '' }, hex: old.hex ?? '' } : null;
    if (colorCols.some((c) => filled(r, c))) {
      const key = filled(r, 'color_key') ? r.color_key.trim().toLowerCase() : (old?.key ?? '');
      color = key
        ? {
            key,
            name: { ar: filled(r, 'color_name_ar') ? r.color_name_ar : (old?.name?.ar ?? ''), en: filled(r, 'color_name_en') ? r.color_name_en : (old?.name?.en ?? '') },
            hex: filled(r, 'color_hex') ? r.color_hex : (old?.hex ?? ''),
          }
        : null;
    }
    u.attributes = {
      capacityMah: filled(r, 'capacity_mah') ? full.attributes.capacityMah : (a.capacityMah ?? null),
      powerW: filled(r, 'power_w') ? full.attributes.powerW : (a.powerW ?? null),
      connectors: filled(r, 'connectors') ? full.attributes.connectors : (a.connectors ?? []),
      color,
    };
  }
  // Specifications are one list: any filled spec cell replaces the whole list with the file's rows.
  if (Object.keys(r).some((k) => /^spec\d+_/.test(k) && filled(r, k))) u.specs = full.specs;
  return u;
}

/** URL part for a new product when the slug cell is empty: from the English name (else the SKU). */
async function autoSlug(r: Record<string, string>, taken: Set<string>) {
  const base = (slugify(r.name_en ?? '') || slugify(r.sku ?? '') || 'product').slice(0, 80);
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 76)}-${n}`;
    if (!taken.has(candidate) && !(await Product.exists({ slug: candidate }))) return candidate;
  }
  return `${base.slice(0, 70)}-${Date.now().toString(36)}`;
}

const errorText = (e: unknown) => {
  const x = e as { code?: number; keyValue?: Record<string, unknown>; message?: string };
  if (x?.code === 11000) return `Another product already uses this ${Object.keys(x.keyValue ?? {}).join(', ') || 'value'}`;
  return x?.message ? String(x.message).slice(0, 300) : 'Could not be saved';
};

export async function importProductsCsv(text: string, userId: string | undefined, dryRun: boolean) {
  const rows = csvToObjects(text);
  const cats = await Category.find().select('slug').lean();
  const catBySlug = new Map(cats.map((c) => [c.slug, String(c._id)]));
  const report = { rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [] as { row: number; sku: string; errors: unknown }[] };
  const fail = (row: number, sku: string, errors: unknown) => {
    report.skipped++;
    report.errors.push({ row, sku, errors });
  };
  const newSlugs = new Set<string>();
  const seenSkus = new Set<string>();

  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2; // header is row 1
    const sku = (r.sku ?? '').trim().toUpperCase();
    if (!sku) {
      fail(rowNo, '', 'SKU is empty: every row needs the product SKU');
      continue;
    }
    if (seenSkus.has(sku)) {
      fail(rowNo, sku, 'This SKU is listed twice in the file: keep one row per product');
      continue;
    }
    seenSkus.add(sku);
    const catSlug = (r.category_slug ?? '').trim().toLowerCase();
    const catId = catBySlug.get(catSlug);
    if (catSlug && !catId) {
      fail(rowNo, sku, `Unknown category_slug "${r.category_slug}". Use one of: ${[...catBySlug.keys()].join(', ')}`);
      continue;
    }
    const existing = (await Product.findOne({ sku }).select('_id stock name shortDescription description images attributes').lean()) as ExistingProduct | null;

    if (!existing) {
      if (!catId) {
        fail(rowNo, sku, 'New product: category_slug is required');
        continue;
      }
      const row: Record<string, string> = { ...r, sku };
      if (!filled(r, 'slug')) row.slug = await autoSlug(r, newSlugs);
      const parsed = productCreate.safeParse(rowToProduct(row, catId));
      if (!parsed.success) {
        fail(rowNo, sku, parsed.error.flatten().fieldErrors);
        continue;
      }
      newSlugs.add(parsed.data.slug);
      if (dryRun) continue;
      try {
        await createProduct(parsed.data, userId ?? '');
        report.created++;
      } catch (e) {
        fail(rowNo, sku, errorText(e));
      }
      continue;
    }

    const parsed = productUpdate.safeParse(rowToUpdate(r, existing, catId));
    if (!parsed.success) {
      fail(rowNo, sku, parsed.error.flatten().fieldErrors);
      continue;
    }
    const stock = filled(r, 'stock') ? Number(r.stock) : undefined;
    if (stock !== undefined && !(Number.isInteger(stock) && stock >= 0 && stock <= 1_000_000)) {
      fail(rowNo, sku, `Stock "${r.stock}" must be a whole number of 0 or more`);
      continue;
    }
    if (dryRun) continue;
    try {
      if (Object.keys(parsed.data).length) await updateProduct(String(existing._id), parsed.data);
    } catch (e) {
      fail(rowNo, sku, errorText(e));
      continue;
    }
    // Stock only when the stock cell is filled in (a photos-only or text-only file never touches it).
    if (stock !== undefined && stock !== existing.stock) {
      // Only when stock has not moved since it was read (an order may have reserved units meanwhile).
      const set = await Product.updateOne({ _id: existing._id, stock: existing.stock }, { $set: { stock } });
      if (set.modifiedCount === 1) {
        await InventoryMovement.create({ product: existing._id, type: 'import', delta: stock - existing.stock, stockAfter: stock, reason: 'CSV import', user: userId });
      } else {
        report.errors.push({ row: rowNo, sku, errors: 'Stock changed during the import (new order or adjustment); product details were updated but stock was left unchanged — import again or adjust stock in Inventory' });
      }
    }
    report.updated++;
  }
  return report;
}

/** Column order of docs/product-import-template.csv (spec columns are added after these). */
export const PRODUCT_CSV_COLUMNS = [
  'sku', 'slug', 'model', 'category_slug', 'name_ar', 'name_en', 'short_description_ar', 'short_description_en', 'description_ar', 'description_en',
  'price_sar', 'compare_at_price_sar', 'stock', 'status', 'featured', 'flagship', 'flagship_order', 'capacity_mah', 'power_w', 'connectors', 'color_key', 'color_name_ar', 'color_name_en',
  'color_hex', 'warranty_months', 'series', 'tags', 'image_urls',
];

type ExportProduct = {
  sku: string; slug: string; model?: string | null; category?: unknown; name?: { ar?: string | null; en?: string | null } | null;
  shortDescription?: { ar?: string | null; en?: string | null } | null; description?: { ar?: string | null; en?: string | null } | null;
  price: number; compareAtPrice?: number | null; stock: number; status: string; featured?: boolean | null; flagship?: boolean | null; flagshipOrder?: number | null; series?: string | null;
  tags?: string[] | null; images?: { url: string }[] | null; warrantyMonths?: number | null; dataSource?: string | null;
  attributes?: { capacityMah?: number | null; powerW?: number | null; connectors?: string[] | null; color?: { key?: string | null; name?: { ar?: string | null; en?: string | null } | null; hex?: string | null } | null } | null;
  specs?: { label?: { ar?: string | null; en?: string | null } | null; value?: { ar?: string | null; en?: string | null } | null }[] | null;
};

const sar = (halalas: number | null | undefined) => (halalas == null ? '' : (halalas / 100).toFixed(2));

/**
 * Inverse of rowToProduct: the exported file can be edited and imported again unchanged.
 * `data_source` is informational (sample products are marked "demo") and ignored on import.
 */
export function productToRow(p: ExportProduct, categorySlug: string, specColumns: number): string[] {
  const a = p.attributes ?? {};
  const row = [
    p.sku, p.slug, p.model ?? '', categorySlug, p.name?.ar ?? '', p.name?.en ?? '', p.shortDescription?.ar ?? '', p.shortDescription?.en ?? '',
    p.description?.ar ?? '', p.description?.en ?? '', sar(p.price), sar(p.compareAtPrice), String(p.stock ?? 0), p.status, p.featured ? 'yes' : 'no', p.flagship ? 'yes' : 'no', String(p.flagshipOrder ?? 0),
    a.capacityMah == null ? '' : String(a.capacityMah), a.powerW == null ? '' : String(a.powerW), (a.connectors ?? []).join('|'),
    a.color?.key ?? '', a.color?.name?.ar ?? '', a.color?.name?.en ?? '', a.color?.hex ?? '',
    p.warrantyMonths == null ? '' : String(p.warrantyMonths), p.series ?? '', (p.tags ?? []).join('|'), (p.images ?? []).map((i) => i.url).join('|'),
  ];
  for (let i = 0; i < specColumns; i++) {
    const s = p.specs?.[i];
    row.push(s?.label?.ar ?? '', s?.label?.en ?? '', s?.value?.ar ?? '', s?.value?.en ?? '');
  }
  row.push(p.dataSource ?? 'client');
  return row;
}

/** All products (any status) as CSV in the import template format. */
export async function exportProductsCsv(filter: { status?: string; category?: string } = {}) {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  const [products, cats] = await Promise.all([Product.find(where).sort({ sku: 1 }).lean(), Category.find().select('slug').lean()]);
  const slugOf = new Map(cats.map((c) => [String(c._id), c.slug]));
  // The importer reads up to 8 spec rows; always export at least the 4 the template shows.
  const specColumns = Math.min(8, Math.max(4, ...products.map((p) => p.specs?.length ?? 0)));
  const header = [...PRODUCT_CSV_COLUMNS];
  for (let i = 1; i <= specColumns; i++) header.push(`spec${i}_label_ar`, `spec${i}_label_en`, `spec${i}_value_ar`, `spec${i}_value_en`);
  header.push('data_source');
  const rows = products.map((p) => productToRow(p as unknown as ExportProduct, slugOf.get(String(p.category)) ?? '', specColumns));
  return { csv: toCsv([header, ...rows]), count: products.length };
}
