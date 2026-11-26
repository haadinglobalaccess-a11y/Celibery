import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { toHalalas } from '../../lib/money';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { Category, Discount, Order, Product, RestockSubscription } from '../../models';
import { categoryInput, discountInput, idParam, objectId, productCreate, productListAdmin, productUpdate, stockAdjust } from './admin.schemas';
import { crudRouter } from './crud';
import { exportProductsCsv, importProductsCsv } from './import.service';
import { attachImages, matchImageFiles } from './product-images.service';
import { adminRestockRoutes } from '../restock/restock.routes';
import { triggerRestock } from '../restock/restock.service';
import { syncBundleStock } from '../catalog/bundles';
import * as svc from './products.service';

// ---- Products ----------------------------------------------------------------------------
export const adminProductRoutes = Router();

adminProductRoutes.get(
  '/',
  requirePermission('products:read'),
  validate(productListAdmin, 'query'),
  ah(async (req, res) => {
    const r = await svc.listProducts(q(req, productListAdmin));
    return ok(res, r.items, 200, { total: r.total, page: r.page, pages: r.pages });
  }),
);

adminProductRoutes.use(adminRestockRoutes);

adminProductRoutes.post(
  '/import',
  requirePermission('products:write', 'inventory:write'),
  validate(z.object({ csv: z.string().min(10).max(900_000), dryRun: z.boolean().default(true) })),
  ah(async (req, res) => {
    const report = await importProductsCsv(req.body.csv, req.user!.id, req.body.dryRun);
    if (!req.body.dryRun) {
      await audit(req, 'import', 'product', '', `${report.created} created, ${report.updated} updated, ${report.skipped} skipped`);
      // Imported stock may bring products back: notify their waiting customers (the sweep checks stock).
      await syncBundleStock();
      const waiting = await RestockSubscription.distinct('product', { status: 'active' });
      triggerRestock(waiting.map(String));
    }
    return ok(res, report);
  }),
);

// Bulk photos (graphics team): files named after the SKU are matched, uploaded, then attached.
adminProductRoutes.post(
  '/images/match',
  requirePermission('products:write'),
  validate(z.object({ files: z.array(z.string().trim().min(1).max(200)).min(1).max(500) })),
  ah(async (req, res) => ok(res, await matchImageFiles(req.body.files))),
);

adminProductRoutes.post(
  '/images/attach',
  requirePermission('products:write'),
  validate(
    z.object({
      mode: z.enum(['replace', 'append']),
      items: z.array(z.object({ sku: z.string().trim().min(2).max(60), mediaIds: z.array(objectId).min(1).max(40) })).min(1).max(500),
    }),
  ),
  ah(async (req, res) => {
    const results = await attachImages(req.body.items, req.body.mode);
    const done = results.filter((r) => r.ok);
    await audit(req, 'bulk_images', 'product', '', `${req.body.mode}: ${done.length} products, ${done.reduce((s, r) => s + (r.images ?? 0), 0)} photos`);
    return ok(res, results);
  }),
);

const productExportQuery = z.object({ status: z.enum(['draft', 'active', 'archived']).optional(), category: objectId.optional() });

// Registered before '/:id'. Same columns as the import template, so the file can be edited and re-imported.
adminProductRoutes.get(
  '/export.csv',
  requirePermission('products:read'),
  validate(productExportQuery, 'query'),
  ah(async (req, res) => {
    const { csv, count } = await exportProductsCsv(q(req, productExportQuery));
    await audit(req, 'export', 'product', '', `${count} products exported`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="celibery-products-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\ufeff' + csv); // BOM so Excel opens Arabic text correctly
  }),
);

adminProductRoutes.get(
  '/:id',
  requirePermission('products:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const p = await Product.findById(req.params.id).lean();
    if (!p) throw notFound('Product');
    return ok(res, p);
  }),
);

// Bulk actions from the product list: status, homepage placement (Featured / Flagship) or delete,
// for many products at once. Delete follows the single-product rule: products in orders are archived.
const BULK_FLAGS = {
  feature: ['featured', true],
  unfeature: ['featured', false],
  flagship: ['flagship', true],
  unflagship: ['flagship', false],
} as const;
adminProductRoutes.post(
  '/bulk',
  requirePermission('products:write'),
  validate(z.object({ ids: z.array(objectId).min(1).max(500), action: z.enum(['active', 'draft', 'archived', 'delete', 'feature', 'unfeature', 'flagship', 'unflagship']) })),
  ah(async (req, res) => {
    const ids = [...new Set(req.body.ids as string[])];
    const action = req.body.action as 'active' | 'draft' | 'archived' | 'delete' | keyof typeof BULK_FLAGS;
    const found = await Product.find({ _id: { $in: ids } }).select('_id sku status featured flagship').lean();
    const result = { requested: ids.length, updated: 0, deleted: 0, archived: 0, notFound: ids.length - found.length };
    if (action in BULK_FLAGS) {
      // Featured and Flagship are independent of each other and of the status (as in the product form).
      const [field, value] = BULK_FLAGS[action as keyof typeof BULK_FLAGS];
      const change = found.filter((p) => Boolean(p[field]) !== value);
      if (change.length) {
        await Product.updateMany({ _id: { $in: change.map((p) => p._id) } }, { $set: { [field]: value } });
        for (const p of change) await audit(req, 'update', 'product', p._id, `${p.sku}: ${field} ${value ? 'on' : 'off'} (bulk)`);
      }
      result.updated = change.length;
      return ok(res, result);
    }
    if (action === 'delete') {
      for (const p of found) {
        const r = await svc.deleteProduct(String(p._id));
        if (r.deleted) result.deleted++;
        else result.archived++;
        await audit(req, r.deleted ? 'delete' : 'archive', 'product', p._id, `${p.sku} (bulk)`);
      }
    } else {
      const change = found.filter((p) => p.status !== action);
      if (change.length) {
        await Product.updateMany({ _id: { $in: change.map((p) => p._id) } }, { $set: { status: action } });
        for (const p of change) await audit(req, 'update', 'product', p._id, `${p.sku}: status ${p.status} → ${action} (bulk)`);
      }
      result.updated = change.length;
    }
    // Status decides what the shop shows: bundles that use these products follow, waiting customers are told.
    triggerRestock(await syncBundleStock(found.map((p) => String(p._id))));
    return ok(res, result);
  }),
);

adminProductRoutes.post(
  '/',
  requirePermission('products:write'),
  validate(productCreate),
  ah(async (req, res) => {
    const p = await svc.createProduct(req.body, req.user!.id);
    await syncBundleStock([String(p._id)]);
    await audit(req, 'create', 'product', p._id, p.sku);
    return ok(res, p, 201);
  }),
);

adminProductRoutes.put(
  '/:id',
  requirePermission('products:write'),
  validate(idParam, 'params'),
  validate(productUpdate),
  ah(async (req, res) => {
    const p = await svc.updateProduct(req.params.id, req.body);
    // Contents, schedule or status changed: bundles that use this product follow.
    triggerRestock(await syncBundleStock([req.params.id]));
    await audit(req, 'update', 'product', req.params.id, p.sku);
    return ok(res, p);
  }),
);

adminProductRoutes.delete(
  '/:id',
  requirePermission('products:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const r = await svc.deleteProduct(req.params.id);
    await audit(req, r.deleted ? 'delete' : 'archive', 'product', req.params.id);
    return ok(res, r);
  }),
);

// ---- Categories --------------------------------------------------------------------------
export const adminCategoryRoutes = crudRouter(Category, categoryInput, {
  entity: 'category',
  readPermission: 'products:read',
  writePermission: 'categories:write',
  sort: { sortOrder: 1 },
  beforeDelete: async (id) => {
    if (await Product.exists({ category: id })) throw conflict('CATEGORY_IN_USE', 'Move or delete the products in this category first');
  },
});

// ---- Inventory ---------------------------------------------------------------------------
export const adminInventoryRoutes = Router();

adminInventoryRoutes.get(
  '/',
  requirePermission('inventory:read'),
  validate(productListAdmin, 'query'),
  ah(async (req, res) => {
    const r = await svc.inventoryOverview(q(req, productListAdmin));
    return ok(res, r.items, 200, { total: r.total, page: r.page, pages: r.pages });
  }),
);

adminInventoryRoutes.get(
  '/movements',
  requirePermission('inventory:read'),
  validate(z.object({ product: objectId.optional() }), 'query'),
  ah(async (req, res) => ok(res, await svc.movements((req as unknown as { validatedQuery: { product?: string } }).validatedQuery.product))),
);

adminInventoryRoutes.post(
  '/:id/adjust',
  requirePermission('inventory:write'),
  validate(idParam, 'params'),
  validate(stockAdjust),
  ah(async (req, res) => {
    const r = await svc.adjustStock(req.params.id, req.body, req.user!.id);
    await audit(req, 'stock_adjust', 'product', req.params.id, `${r.delta > 0 ? '+' : ''}${r.delta} → ${r.stock} (${req.body.reason})`);
    // Bundles containing this product follow its stock; back-in-stock emails for anything that returned.
    const bundlesBack = await syncBundleStock([req.params.id]);
    triggerRestock([...(r.stock > 0 ? [req.params.id] : []), ...bundlesBack]);
    return ok(res, r);
  }),
);

// ---- Discounts ---------------------------------------------------------------------------
export const adminDiscountRoutes = crudRouter(Discount, discountInput, {
  entity: 'discount',
  readPermission: 'discounts:read',
  writePermission: 'discounts:write',
  transform: (b) => ({
    ...b,
    value: b.type === 'fixed' ? toHalalas(b.value as number) : b.value,
    maxDiscount: b.maxDiscount == null ? null : toHalalas(b.maxDiscount as number),
    minOrderTotal: toHalalas((b.minOrderTotal as number) ?? 0),
  }),
  // Orders keep a reference to the code (reports, refunds, per-customer limits): codes that were
  // used are deactivated instead of deleted.
  beforeDelete: async (id) => {
    if (await Order.exists({ 'discount.id': id })) throw conflict('DISCOUNT_IN_USE', 'This code was used on orders, so it cannot be deleted. Untick “Active” to stop it instead.');
  },
});
