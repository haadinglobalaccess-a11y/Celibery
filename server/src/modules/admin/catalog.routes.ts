import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { toHalalas } from '../../lib/money';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { Category, Discount, Order, Product } from '../../models';
import { categoryInput, discountInput, idParam, objectId, productCreate, productListAdmin, productUpdate, stockAdjust } from './admin.schemas';
import { crudRouter } from './crud';
import { exportProductsCsv, importProductsCsv } from './import.service';
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
    res.send('﻿' + csv); // BOM so Excel opens Arabic text correctly
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
  // Orders keep a reference to the code (reports, refunds, per-customer limits): codes that were
  // used are deactivated instead of deleted.
  beforeDelete: async (id) => {
    if (await Order.exists({ 'discount.id': id })) throw conflict('DISCOUNT_IN_USE', 'This code was used on orders, so it cannot be deleted. Untick “Active” to stop it instead.');
  },
});
