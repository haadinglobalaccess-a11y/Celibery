import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { badRequest } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { limiter } from '../../middleware/security';
import { validate } from '../../middleware/validate';
import { idParam } from '../admin/admin.schemas';
import * as svc from './restock.service';

const slugParam = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,120}$/) });
const subscribeInput = z.object({ email: z.string().trim().max(254).optional(), lang: z.enum(['ar', 'en']).default('ar') });
const restockLimiter = limiter(60 * 60_000, 20, 'restock');

/**
 * Public: POST /api/products/:slug/restock — "notify me when restocked".
 * A signed-in customer may omit the email (their account email is used).
 */
export const publicRestockRoutes = Router();
publicRestockRoutes.post(
  '/products/:slug/restock',
  restockLimiter,
  validate(slugParam, 'params'),
  validate(subscribeInput),
  ah(async (req, res) => {
    const account = req.user?.type === 'customer' ? req.user : null;
    const email = (req.body.email || account?.email || '').trim();
    if (!svc.validEmail(email)) throw badRequest('VALIDATION_ERROR', 'Enter a valid email address', { fieldErrors: { email: ['Enter a valid email address'] } });
    return ok(res, await svc.subscribe(req.params.slug, { email, lang: req.body.lang, userId: account?.id }), 201);
  }),
);

/** Admin: requests for a product and "send now" (mounted under /api/admin/products). */
export const adminRestockRoutes = Router();
adminRestockRoutes.get('/:id/restock', requirePermission('products:read'), validate(idParam, 'params'), ah(async (req, res) => ok(res, await svc.forProduct(req.params.id))));
adminRestockRoutes.post(
  '/:id/restock/send',
  requirePermission('inventory:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const r = await svc.sweepRestock({ productIds: [req.params.id] });
    await audit(req, 'restock_notify', 'product', req.params.id, `sent ${r.sent}, retry ${r.retry}, failed ${r.failed}, not configured ${r.skipped}`);
    return ok(res, r);
  }),
);
