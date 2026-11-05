import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { toHalalas } from '../../lib/money';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { Category, Discount, Product } from '../../models';
import { categoryInput, discountInput, idParam, objectId, productCreate, productListAdmin, productUpdate, stockAdjust } from './admin.schemas';
import { crudRouter } from './crud';
import { importProductsCsv } from './import.service';
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

adminProductRoutes.post(
  '/import',
  requirePermission('products:write', 'inventory:write'),
  validate(z.object({ csv: z.string().min(10).max(900_000), dryRun: z.boolean().default(true) })),
  ah(async (req, res) => {
    const report = await importProductsCsv(req.body.csv, req.user!.id, req.body.dryRun);
    if (!req.body.dryRun) await audit(req, 'import', 'product', '', `${report.created} created, ${report.updated} updated, ${report.skipped} skipped`);
    return ok(res, report);
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

adminProductRoutes.post(
  '/',
  requirePermission('products:write'),
  validate(productCreate),
  ah(async (req, res) => {
    const p = await svc.createProduct(req.body, req.user!.id);
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
});
