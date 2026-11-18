import type { ClientSession, Types } from 'mongoose';
import { Product } from '../../models';

/**
 * Product bundles = a catalogue listing (`isBundle`) whose contents are references to existing
 * products (`bundleItems`: product + quantity per bundle). No placeholder products are created.
 *
 * Inventory follows the contents: selling one bundle takes its items out of stock (checkout
 * reserves every item atomically), and releasing/returning puts the items back. The bundle's own
 * `stock` is a derived, display-only figure — how many complete bundles the items' stock allows —
 * kept up to date by syncBundleStock() after every stock change and on the scheduled job. Checkout
 * never trusts it: the quote and the reservation always read the items' live stock.
 *
 * A legacy bundle listing without any items keeps its own stock (sold as one SKU), as before.
 */

export type Component = { product: string; sku: string; quantity: number };
type BundleLike = { isBundle?: boolean | null; bundleItems?: { product: unknown; quantity?: number | null }[] | null; availableFrom?: Date | null; availableUntil?: Date | null };

export const hasComponents = (p: BundleLike) => Boolean(p.isBundle && p.bundleItems?.length);

/** Inside the optional availability window (scheduled bundles). */
export function windowOpen(p: BundleLike, now = new Date()) {
  if (p.availableFrom && p.availableFrom > now) return false;
  if (p.availableUntil && p.availableUntil < now) return false;
  return true;
}

/**
 * Live availability of bundles with contents: complete bundles the items allow (0 when an item is
 * missing, inactive, or the window is closed), plus each bundle's component snapshot.
 */
export async function liveBundleState(bundles: (BundleLike & { _id: unknown })[], session?: ClientSession) {
  const withItems = bundles.filter(hasComponents);
  const ids = [...new Set(withItems.flatMap((b) => b.bundleItems!.map((i) => String(i.product))))];
  const comps = ids.length ? await Product.find({ _id: { $in: ids } }).select('sku stock status').session(session ?? null).lean() : [];
  const byId = new Map(comps.map((c) => [String(c._id), c]));
  const out = new Map<string, { units: number; components: Component[]; problem: '' | 'item_unavailable' | 'window' }>();
  const now = new Date();
  for (const b of withItems) {
    const components: Component[] = [];
    let units = Number.POSITIVE_INFINITY;
    let problem: '' | 'item_unavailable' | 'window' = windowOpen(b, now) ? '' : 'window';
    for (const it of b.bundleItems!) {
      const c = byId.get(String(it.product));
      const per = Math.max(1, it.quantity ?? 1);
      if (!c || c.status !== 'active') {
        problem ||= 'item_unavailable';
        units = 0;
        continue;
      }
      components.push({ product: String(c._id), sku: c.sku, quantity: per });
      units = Math.min(units, Math.floor(c.stock / per));
    }
    out.set(String(b._id), { units: problem ? 0 : Number.isFinite(units) ? units : 0, components, problem });
  }
  return out;
}

/**
 * Recomputes the derived stock of bundles that contain any of `productIds` (or are among them);
 * all bundles when omitted. Returns the ids of bundles that went from 0 to available.
 */
export async function syncBundleStock(productIds?: (string | Types.ObjectId)[]): Promise<string[]> {
  const ids = productIds?.map(String);
  const filter = ids ? { isBundle: true, 'bundleItems.0': { $exists: true }, $or: [{ _id: { $in: ids } }, { 'bundleItems.product': { $in: ids } }] } : { isBundle: true, 'bundleItems.0': { $exists: true } };
  const bundles = await Product.find(filter).select('stock isBundle bundleItems availableFrom availableUntil').lean();
  if (!bundles.length) return [];
  const state = await liveBundleState(bundles);
  const back: string[] = [];
  for (const b of bundles) {
    const units = state.get(String(b._id))?.units ?? 0;
    if (units !== b.stock) {
      await Product.updateOne({ _id: b._id }, { $set: { stock: units } });
      if (b.stock === 0 && units > 0) back.push(String(b._id));
    }
  }
  return back;
}

/** Stock movements an order line causes: the bundle's items × quantity, or the product itself. */
export function stockTargets(item: { product: unknown; quantity: number; components?: { product: unknown; quantity: number }[] | null }) {
  return item.components?.length
    ? item.components.map((c) => ({ product: String(c.product), qty: c.quantity * item.quantity }))
    : [{ product: String(item.product), qty: item.quantity }];
}

/** Sums targets per product (a bundle and the same item bought separately share one stock). */
export function aggregateTargets(items: Parameters<typeof stockTargets>[0][]) {
  const need = new Map<string, number>();
  for (const it of items) for (const t of stockTargets(it)) need.set(t.product, (need.get(t.product) ?? 0) + t.qty);
  return need;
}
