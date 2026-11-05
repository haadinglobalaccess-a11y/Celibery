import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { ah, escapeRegex, ok } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { q, validate } from '../../middleware/validate';
import { Notification, Order, Payment, Refund } from '../../models';
import { notifyOrder } from '../../integrations/notifications';
import { adminOrderListQuery, refundSchema, statusUpdateSchema } from '../orders/order.schemas';
import { orderLink, releaseExpiredReservations, transitionOrder } from '../orders/order.service';
import { verifyOrderPayment } from '../payments/payment.service';
import { reconcileOpenRefunds, reconcilePayment, refundOrder, resolveRefundManually } from '../payments/refund.service';
import { idParam } from './admin.schemas';

export const adminOrderRoutes = Router();

adminOrderRoutes.get(
  '/',
  requirePermission('orders:read'),
  validate(adminOrderListQuery, 'query'),
  ah(async (req, res) => {
    void releaseExpiredReservations(20).catch(() => undefined);
    const query = q(req, adminOrderListQuery);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ orderNumber: rx }, { 'contact.name': rx }, { 'contact.email': rx }, { 'contact.phone': rx }, { 'delivery.trackingNumber': rx }];
    }
    const [items, total] = await Promise.all([
      Order.find(filter)
        .select('orderNumber contact total status paymentStatus paymentMethod createdAt items.quantity delivery.trackingNumber history.status')
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return ok(
      res,
      items.map((o) => ({ ...o, needsReview: (o.history ?? []).some((h) => h.status === 'payment_review'), history: undefined })),
      200,
      { total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)) },
    );
  }),
);

adminOrderRoutes.get(
  '/:id',
  requirePermission('orders:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const order = await Order.findById(req.params.id).populate('customer', 'name email phone').populate('history.by', 'name').lean();
    if (!order) throw notFound('Order');
    const [payments, notifications] = await Promise.all([
      Payment.find({ order: order._id }).sort({ createdAt: -1 }).lean(),
      Notification.find({ order: order._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return ok(res, { order, payments, notifications });
  }),
);

adminOrderRoutes.post(
  '/:id/status',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(statusUpdateSchema),
  ah(async (req, res) => {
    const order = await transitionOrder(req.params.id, req.body.status, {
      by: req.user!.id,
      note: req.body.note,
      notify: req.body.notifyCustomer,
      trackingNumber: req.body.trackingNumber,
      courier: req.body.courier,
      restock: req.body.restock,
    });
    await audit(req, 'status', 'order', req.params.id, `${order.orderNumber} → ${req.body.status}`);
    return ok(res, order);
  }),
);

adminOrderRoutes.post(
  '/:id/verify-payment',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const status = await verifyOrderPayment(req.params.id);
    await audit(req, 'verify_payment', 'order', req.params.id, status);
    return ok(res, { paymentStatus: status });
  }),
);

adminOrderRoutes.post(
  '/:id/refund',
  requirePermission('orders:refund'),
  validate(idParam, 'params'),
  validate(refundSchema),
  ah(async (req, res) => {
    const result = await refundOrder(req.params.id, req.body.amount, req.body.reason, req.user!.id, req.body.idempotencyKey);
    if (!result.replayed) await audit(req, 'refund', 'order', req.params.id, `${(req.body.amount / 100).toFixed(2)} SAR — ${req.body.reason} → ${result.status}`);
    return ok(res, result);
  }),
);

/** Refund ledger of one order (every request with its lifecycle history). */
adminOrderRoutes.get(
  '/:id/refunds',
  requirePermission('orders:read'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const order = await Order.findById(req.params.id).select('total refundedAmount refundReservedAmount').lean();
    if (!order) throw notFound('Order');
    const refunds = await Refund.find({ order: order._id }).sort({ createdAt: -1 }).populate('requestedBy', 'name').lean();
    return ok(res, { refunds, refundedAmount: order.refundedAmount ?? 0, reservedAmount: order.refundReservedAmount ?? 0, total: order.total });
  }),
);

/** Re-checks open (uncertain) refunds of this order with the gateway. */
adminOrderRoutes.post(
  '/:id/refunds/reconcile',
  requirePermission('orders:refund'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const payments = await Refund.distinct('payment', { order: req.params.id, status: { $in: ['processing', 'reconciliation_required'] }, payment: { $ne: null } });
    const results: Awaited<ReturnType<typeof reconcilePayment>>[] = [];
    for (const p of payments) results.push(await reconcilePayment(String(p), req.user!.id));
    await audit(req, 'refund_reconcile', 'order', req.params.id, results.map((r) => r.note).join('; '));
    return ok(res, { results });
  }),
);

/** Staff decision for a refund the system could not settle automatically (after checking the gateway dashboard). */
adminOrderRoutes.post(
  '/:id/refunds/:refundId/resolve',
  requirePermission('orders:refund'),
  validate(z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i), refundId: z.string().regex(/^[a-f0-9]{24}$/i) }), 'params'),
  validate(z.object({ outcome: z.enum(['succeeded', 'failed']), note: z.string().trim().min(3).max(300) })),
  ah(async (req, res) => {
    const r = await Refund.findOne({ _id: req.params.refundId, order: req.params.id }).select('_id').lean();
    if (!r) throw notFound('Refund');
    const result = await resolveRefundManually(req.params.refundId, req.body.outcome, req.body.note, req.user!.id);
    await audit(req, 'refund_resolve', 'order', req.params.id, `${req.params.refundId} → ${req.body.outcome}: ${req.body.note}`);
    return ok(res, result);
  }),
);

/** Reconciles every open refund (also run by the scheduled job). */
adminOrderRoutes.post(
  '/refunds/reconcile-all',
  requirePermission('orders:refund'),
  ah(async (req, res) => {
    const r = await reconcileOpenRefunds(100);
    await audit(req, 'refund_reconcile_all', 'order', '', JSON.stringify(r));
    return ok(res, r);
  }),
);

adminOrderRoutes.patch(
  '/:id/notes',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ internalNotes: z.string().trim().max(2000) })),
  ah(async (req, res) => {
    const o = await Order.findByIdAndUpdate(req.params.id, { $set: { internalNotes: req.body.internalNotes } }, { new: true }).select('internalNotes').lean();
    if (!o) throw notFound('Order');
    await audit(req, 'notes', 'order', req.params.id);
    return ok(res, o);
  }),
);

adminOrderRoutes.post(
  '/:id/tracking',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  validate(z.object({ trackingNumber: z.string().trim().max(60), courier: z.string().trim().max(80).optional(), trackingUrl: z.string().trim().url().or(z.literal('')).optional() })),
  ah(async (req, res) => {
    const set: Record<string, string> = { 'delivery.trackingNumber': req.body.trackingNumber };
    if (req.body.courier) set['delivery.courier'] = req.body.courier;
    if (req.body.trackingUrl !== undefined) set['delivery.trackingUrl'] = req.body.trackingUrl;
    const o = await Order.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
    if (!o) throw notFound('Order');
    await audit(req, 'tracking', 'order', req.params.id, req.body.trackingNumber);
    return ok(res, o);
  }),
);

adminOrderRoutes.post(
  '/:id/resend-notification',
  requirePermission('orders:write'),
  validate(idParam, 'params'),
  ah(async (req, res) => {
    const o = await Order.findById(req.params.id).lean();
    if (!o) throw notFound('Order');
    const ev = o.status === 'shipped' ? 'shipped' : o.status === 'delivered' ? 'delivered' : o.status === 'cancelled' ? 'cancelled' : o.paymentStatus === 'paid' ? 'payment_confirmed' : 'order_placed';
    await notifyOrder(o, ev, orderLink(o));
    await audit(req, 'resend_notification', 'order', req.params.id, ev);
    return ok(res, { event: ev });
  }),
);
