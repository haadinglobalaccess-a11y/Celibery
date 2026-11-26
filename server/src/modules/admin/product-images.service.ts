import { badRequest } from '../../lib/errors';
import { MediaAsset, Product } from '../../models';
import { keepImage } from './import.service';
import { updateProduct } from './products.service';

/**
 * Bulk product photos: the graphics team names each file after the product SKU
 * (CEL-PB-20000-1.jpg, CEL-PB-20000-2.jpg, …), uploads them all at once in Admin → Products, and
 * each photo is put on its product in that order. No URLs to copy, no product to open one by one.
 */
export const MAX_PRODUCT_IMAGES = 40;

/**
 * File name → SKU and photo position. "SKU-2", "SKU_2", "SKU 2" and "SKU (2)" are photo 2 of SKU;
 * a file named just "SKU" is photo 1. SKUs that end in a number themselves (CEL-CB-100) still work,
 * because a split is used only when the part before it is a real SKU.
 */
export function matchImageFile(fileName: string, skus: Set<string>): { sku: string; position: number } | null {
  const base = fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '').trim().toUpperCase();
  if (!base) return null;
  const m = /^(.+?)[\s_-]+\(?(\d{1,2})\)?$/.exec(base) ?? /^(.+?)\s*\((\d{1,2})\)$/.exec(base);
  if (m) {
    const sku = m[1].trim();
    const position = Number(m[2]);
    if (skus.has(sku) && position >= 1 && position <= MAX_PRODUCT_IMAGES) return { sku, position };
  }
  if (skus.has(base)) return { sku: base, position: 1 };
  return null;
}

/** Which product each file belongs to (preview before anything is uploaded). */
export async function matchImageFiles(files: string[]) {
  const products = await Product.find().select('sku name images').lean();
  const skus = new Set(products.map((p) => p.sku));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  return files.map((file) => {
    const hit = matchImageFile(file, skus);
    if (!hit) return { file, sku: null };
    const p = bySku.get(hit.sku)!;
    return { file, sku: hit.sku, position: hit.position, productId: String(p._id), name: { ar: p.name?.ar ?? '', en: p.name?.en ?? '' }, currentImages: p.images?.length ?? 0 };
  });
}

/**
 * Puts uploaded media-library images on products. `replace` makes them the product's photos (in the
 * given order); `append` adds them after the current photos (a photo already there is not repeated).
 */
export async function attachImages(items: { sku: string; mediaIds: string[] }[], mode: 'replace' | 'append') {
  const ids = [...new Set(items.flatMap((i) => i.mediaIds))];
  const assets = await MediaAsset.find({ _id: { $in: ids }, kind: 'image', status: 'ready' }).lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));
  const results: { sku: string; ok: boolean; images?: number; error?: string }[] = [];
  for (const item of items) {
    const sku = item.sku.trim().toUpperCase();
    const product = await Product.findOne({ sku }).select('_id name images').lean();
    if (!product) {
      results.push({ sku, ok: false, error: 'No product has this SKU' });
      continue;
    }
    const missing = item.mediaIds.filter((id) => !byId.has(id));
    if (missing.length) {
      results.push({ sku, ok: false, error: 'A photo did not finish uploading: upload it again' });
      continue;
    }
    const alt = { ar: product.name?.ar ?? '', en: product.name?.en ?? '' };
    const added = item.mediaIds.map((id) => {
      const a = byId.get(id)!;
      return {
        url: a.url,
        alt,
        mediaId: String(a._id),
        ...(a.variants?.length ? { variants: a.variants.map((v) => ({ width: v.width, url: v.url })) } : {}),
        ...(a.width ? { width: a.width } : {}),
        ...(a.height ? { height: a.height } : {}),
      };
    });
    const current = mode === 'append' ? (product.images ?? []).map((i) => keepImage(i as Parameters<typeof keepImage>[0])) : [];
    const seen = new Set(current.map((i) => i.url));
    const images = [...current, ...added.filter((i) => !seen.has(i.url) && seen.add(i.url))];
    if (images.length > MAX_PRODUCT_IMAGES) {
      results.push({ sku, ok: false, error: `A product can have at most ${MAX_PRODUCT_IMAGES} photos` });
      continue;
    }
    await updateProduct(String(product._id), { images });
    results.push({ sku, ok: true, images: images.length });
  }
  if (!results.length) throw badRequest('NOTHING_TO_ATTACH', 'No photos to attach');
  return results;
}
