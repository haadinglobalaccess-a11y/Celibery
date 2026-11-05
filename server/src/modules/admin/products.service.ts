import type { Types } from 'mongoose';
import { withTx } from '../../db/tx';
import { badRequest, notFound, unprocessable } from '../../lib/errors';
import { escapeRegex } from '../../lib/http';
import { toHalalas } from '../../lib/money';
import { Category, InventoryMovement, Order, Product, getSettings } from '../../models';

type Input = Record<string, unknown> & {
  price?: number;
  compareAtPrice?: number | null;
  category?: string;
  bundleItems?: { product: string; quantity: number }[];
};

/** Converts admin input (SAR) to storage (halalas) and validates references. */
async function normalize(input: Input, selfId?: string) {
  const out: Record<string, unknown> = { ...input };
  if (input.price !== undefined) out.price = toHalalas(input.price);
  if (input.compareAtPrice !== undefined) out.compareAtPrice = input.compareAtPrice == null ? undefined : toHalalas(input.compareAtPrice);
  if (input.category && !(await Category.exists({ _id: input.category }))) throw badRequest('INVALID_CATEGORY', 'Category not found');
  if (input.bundleItems?.some((b) => b.product === selfId)) throw badRequest('INVALID_BUNDLE', 'A bundle cannot contain itself');
  if (out.compareAtPrice !== undefined && out.price !== undefined && (out.compareAtPrice as number) <= (out.price as number)) {
    out.compareAtPrice = undefined; // only meaningful when higher than the selling price
  }
  return out;
}

export async function listProducts(q: { q?: string; status?: string; category?: string; lowStock?: string; page: number; limit: number }) {
  const settings = await getSettings();
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = q.category;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ 'name.ar': rx }, { 'name.en': rx }, { sku: rx }, { model: rx }, { slug: rx }];
  }
  if (q.lowStock) {
    const def = settings?.commerce?.lowStockThreshold ?? 5;
    filter.$expr = { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', def] }] };
  }
  const [items, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'slug name')
      .sort({ updatedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) };
}

export async function createProduct(input: Input & { stock?: number }, userId: string) {
  const data = await normalize(input);
  const stock = input.stock ?? 0;
  return withTx(async (session) => {
    const [p] = await Product.create([{ ...data, stock, dataSource: 'client' }], { session });
    if (stock > 0) await InventoryMovement.create([{ product: p._id, type: 'initial', delta: stock, stockAfter: stock, reason: 'Initial stock', user: userId }], { session });
    return p.toObject();
  });
}

/** Stock is intentionally not editable here — use the inventory endpoints (ledgered). */
export async function updateProduct(id: string, input: Input) {
  const data = await normalize(input, id);
  delete data.stock;
  const unset: Record<string, 1> = {};
  if ('compareAtPrice' in input && data.compareAtPrice === undefined) {
    unset.compareAtPrice = 1;
    delete data.compareAtPrice;
  }
  const p = await Product.findByIdAndUpdate(id, { $set: data, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, runValidators: true }).lean();
  if (!p) throw notFound('Product');
  return p;
}

/** Products that appear in orders are archived (history must stay intact); others are deleted. */
export async function deleteProduct(id: string) {
  const used = await Order.exists({ 'items.product': id });
  if (used) {
    await Product.updateOne({ _id: id }, { $set: { status: 'archived' } });
    return { archived: true, deleted: false };
  }
  const r = await Product.deleteOne({ _id: id });
  if (!r.deletedCount) throw notFound('Product');
  await InventoryMovement.deleteMany({ product: id });
  return { archived: false, deleted: true };
}

export async function adjustStock(productId: string, input: { mode: 'delta' | 'set'; value: number; reason: string; type: 'adjustment' | 'restock' }, userId: string) {
  return withTx(async (session) => {
    const current = await Product.findById(productId).select('stock').session(session ?? null).lean();
    if (!current) throw notFound('Product');
    const delta = input.mode === 'set' ? input.value - current.stock : input.value;
    if (delta === 0) throw badRequest('NO_CHANGE', 'Stock is unchanged');
    // Conditional update prevents going negative even under concurrent checkouts.
    const updated = await Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: delta < 0 ? -delta : 0 } },
      { $inc: { stock: delta } },
      { new: true, session, projection: { stock: 1 } },
    ).lean();
    if (!updated) throw unprocessable('INSUFFICIENT_STOCK', 'Stock cannot go below zero');
    await InventoryMovement.create([{ product: productId, type: input.type, delta, stockAfter: updated.stock, reason: input.reason, user: userId }], { session });
    return { stock: updated.stock, delta };
  });
}

export async function inventoryOverview(q: { q?: string; lowStock?: string; page: number; limit: number }) {
  return listProducts({ ...q, status: undefined });
}

export async function movements(productId: string | undefined, limit = 100) {
  const filter: Record<string, unknown> = {};
  if (productId) filter.product = productId as unknown as Types.ObjectId;
  return InventoryMovement.find(filter).populate('product', 'sku name').populate('user', 'name').sort({ createdAt: -1 }).limit(limit).lean();
}
