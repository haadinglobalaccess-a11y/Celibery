import { csvToObjects } from '../../lib/csv';
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
      await updateProduct(String(existing._id), rest);
      if (r.stock !== '' && stock !== existing.stock) {
        await Product.updateOne({ _id: existing._id }, { $set: { stock } });
        await InventoryMovement.create({ product: existing._id, type: 'import', delta: stock - existing.stock, stockAfter: stock, reason: 'CSV import', user: userId });
      }
      report.updated++;
    }
  }
  return report;
}
