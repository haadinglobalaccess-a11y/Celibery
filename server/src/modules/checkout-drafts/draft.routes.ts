import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { ah, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { limiter } from '../../middleware/security';
import { q, validate } from '../../middleware/validate';
import { CheckoutDraft } from '../../models';
import { ADMIN_FILTERS, adminGetDraft, adminListDrafts, deleteDraftForCustomer, draftInput, getDraftForCustomer, saveDraft } from './draft.service';

const tokenOnly = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() });
const who = (req: { user?: { type: string; id: string } }) => ({ customerId: req.user?.type === 'customer' ? req.user.id : undefined });

/** Autosave is debounced in the browser; this only stops abuse. */
const draftLimiter = limiter(60_000, 90);

/* Customer: save progress, resume, clear. The token proves ownership (only its hash is stored). */
export const draftRoutes = Router();
draftRoutes.put('/checkout/draft', draftLimiter, validate(draftInput), ah(async (req, res) => ok(res, await saveDraft(req.body, who(req)))));
draftRoutes.get(
  '/checkout/draft',
  draftLimiter,
  validate(tokenOnly, 'query'),
  ah(async (req, res) => ok(res, await getDraftForCustomer(q(req, tokenOnly).token, who(req)))),
);
draftRoutes.delete('/checkout/draft', draftLimiter, validate(tokenOnly), ah(async (req, res) => ok(res, await deleteDraftForCustomer(req.body.token, who(req)))));

/* Admin → Abandoned checkouts (customer data: same permission as orders). */
const listQuery = z.object({
  filter: z.enum(ADMIN_FILTERS).default('incomplete'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) });

export const adminDraftRoutes = Router();
adminDraftRoutes.get(
  '/',
  requirePermission('orders:read'),
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const r = await adminListDrafts(q(req, listQuery));
    return ok(res, r.items, 200, { total: r.total, page: r.page, pages: r.pages, counts: r.counts, abandonAfterMinutes: r.abandonAfterMinutes, retentionDays: r.retentionDays });
  }),
);
adminDraftRoutes.get(
  '/:id',
  requirePermission('orders:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const d = await adminGetDraft(req.params.id);
    if (!d) throw notFound('Checkout');
    return ok(res, d);
  }),
);
/** Erasure on request (or clean-up). Converted checkouts stay with their order record until they expire. */
adminDraftRoutes.delete(
  '/:id',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const r = await CheckoutDraft.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Checkout');
    await audit(req, 'delete', 'checkout_draft', req.params.id, 'Saved checkout deleted');
    return ok(res, { deleted: true });
  }),
);
