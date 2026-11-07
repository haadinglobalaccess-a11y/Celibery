import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { ah, escapeRegex, ok } from '../../lib/http';
import { toHalalas } from '../../lib/money';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { Refund, ReturnRequest, RETURN_STATUSES } from '../../models';
import { approveReturn, receiveReturn, refundReturn, rejectReturn } from '../returns/return.service';
import { idParam } from './admin.schemas';

/** Admin → Returns: customer return requests (requested → approved → received → refunded). */
export const adminReturnRoutes = Router();

const listQuery = z.object({
  status: z.enum(RETURN_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const note = z.object({ note: z.string().trim().max(500).default('') });

adminReturnRoutes.get(
  '/',
  requirePermission('orders:read'),
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const query = q(req, listQuery);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ returnNumber: rx }, { orderNumber: rx }, { 'contact.name': rx }, { 'contact.email': rx }];
    }
    const [items, total, counts] = await Promise.all([
      ReturnRequest.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      ReturnRequest.countDocuments(filter),
      ReturnRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    return ok(res, items, 200, { total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)), counts: Object.fromEntries(counts.map((c: { _id: string; n: number }) => [c._id, c.n])) });
  }),
);

adminReturnRoutes.get(
  '/:id',
  requirePermission('orders:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const r = await ReturnRequest.findById(req.params.id).populate('history.by', 'name').lean();
    if (!r) throw notFound('Return request');
    const refund = r.refund?.id ? await Refund.findById(r.refund.id).select('status amount providerRefundId createdAt').lean() : null;
    return ok(res, { ...r, refundRecord: refund });
  }),
);

adminReturnRoutes.post(
  '/:id/approve',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(note),
  ah(async (req, res) => {
    const r = await approveReturn(req.params.id, req.body.note, req.user!.id);
    await audit(req, 'return_approve', 'return', req.params.id, r.returnNumber);
    return ok(res, r);
  }),
);

adminReturnRoutes.post(
  '/:id/reject',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ note: z.string().trim().min(3, 'Tell the customer why').max(500) })),
  ah(async (req, res) => {
    const r = await rejectReturn(req.params.id, req.body.note, req.user!.id);
    await audit(req, 'return_reject', 'return', req.params.id, `${r.returnNumber} — ${req.body.note}`);
    return ok(res, r);
  }),
);

adminReturnRoutes.post(
  '/:id/receive',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ restock: z.boolean().default(true), note: z.string().trim().max(500).default('') })),
  ah(async (req, res) => {
    const r = await receiveReturn(req.params.id, { restock: req.body.restock, note: req.body.note, by: req.user!.id });
    await audit(req, 'return_receive', 'return', req.params.id, `${r!.returnNumber}${req.body.restock ? ' (restocked)' : ' (not restocked)'}`);
    return ok(res, r);
  }),
);

adminReturnRoutes.post(
  '/:id/refund',
  requirePermission('orders:refund'),
  validate(idParam, 'params'),
  // Amount in SAR (optional: defaults to the amount paid for the returned units).
  validate(z.object({ amount: z.number().positive().max(1_000_000).optional(), note: z.string().trim().max(300).default('') })),
  ah(async (req, res) => {
    const amount = req.body.amount != null ? toHalalas(req.body.amount) : undefined;
    const r = await refundReturn(req.params.id, { amount, note: req.body.note, by: req.user!.id });
    await audit(req, 'return_refund', 'return', req.params.id, `${r.return!.returnNumber}: ${((r.return!.refund?.amount ?? 0) / 100).toFixed(2)} SAR → ${r.refund.status}`);
    return ok(res, r);
  }),
);

adminReturnRoutes.patch(
  '/:id/notes',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ internalNotes: z.string().trim().max(2000) })),
  ah(async (req, res) => {
    const r = await ReturnRequest.findByIdAndUpdate(req.params.id, { $set: { internalNotes: req.body.internalNotes } }, { new: true }).lean();
    if (!r) throw notFound('Return request');
    return ok(res, r);
  }),
);
