import { csvToObjects, toCsv } from '../../lib/csv';
import { Category, InventoryMovement, Product } from '../../models';
import { productCreate } from './admin.schemas';
import { createProduct, updateProduct } from './products.service';

/**
 * Imports CELIBERY's product list (Q14) from the CSV template in docs/product-import-template.csv.
 * Upserts by SKU. Rows are validated with the same rules as the admin product form; invalid rows
 * are reported and skipped. Stock for existing products is set through the inventory ledger.
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

export async function importProductsCsv(text: string, userId: string | undefined, dryRun: boolean) {
  const rows = csvToObjects(text);
  const cats = await Category.find().select('slug').lean();
  const catBySlug = new Map(cats.map((c) => [c.slug, String(c._id)]));
  const report = { rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [] as { row: number; sku: string; errors: unknown }[] };

  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2; // header is row 1
    const catId = catBySlug.get((r.category_slug ?? '').toLowerCase());
    if (!catId) {
      report.skipped++;
      report.errors.push({ row: rowNo, sku: r.sku, errors: `Unknown category_slug "${r.category_slug}"` });
      continue;
    }
    const parsed = productCreate.safeParse(rowToProduct(r, catId));
    if (!parsed.success) {
      report.skipped++;
      report.errors.push({ row: rowNo, sku: r.sku, errors: parsed.error.flatten().fieldErrors });
      continue;
    }
    if (dryRun) continue;
    const existing = await Product.findOne({ sku: parsed.data.sku }).select('_id stock').lean();
    if (!existing) {
      await createProduct(parsed.data, userId ?? '');
      report.created++;
    } else {
      const { stock, ...rest } = parsed.data;
      // Files without the flagship columns (older template) never reset the Admin's Flagship selection.
      const update: Partial<typeof rest> = { ...rest };
      if (!('flagship' in r)) delete update.flagship;
      if (!('flagship_order' in r)) delete update.flagshipOrder;
      await updateProduct(String(existing._id), update);
      if (r.stock !== '' && stock !== existing.stock) {
        // Only when stock has not moved since it was read (an order may have reserved units meanwhile).
        const set = await Product.updateOne({ _id: existing._id, stock: existing.stock }, { $set: { stock } });
        if (set.modifiedCount === 1) {
          await InventoryMovement.create({ product: existing._id, type: 'import', delta: stock - existing.stock, stockAfter: stock, reason: 'CSV import', user: userId });
        } else {
          report.errors.push({ row: rowNo, sku: r.sku, errors: 'Stock changed during the import (new order or adjustment); product details were updated but stock was left unchanged — import again or adjust stock in Inventory' });
        }
      }
      report.updated++;
    }
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
