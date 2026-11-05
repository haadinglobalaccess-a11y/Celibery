import type { ClientSession } from 'mongoose';
import { withTx } from '../../db/tx';
import { badRequest, conflict, notFound, serviceUnavailable, unprocessable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { randomToken } from '../../lib/tokens';
import { loadIntegrations } from '../../integrations/credentials';
import { providerByName } from '../../integrations/payments';
import { Order, Payment, Refund } from '../../models';
import { decideReconciliation, outcomeForGatewayError, refundableBalance, type RefundStatus } from './refund-state';
import { sanitizeError } from './webhook-lifecycle';

/**
 * Reliable refunds (fixes the refund-concurrency regression found in the 3 Nov 2026 audit).
 *
 * Guarantees:
 *  1. Concurrent refunds can never exceed the amount paid: each refund first RESERVES its amount
 *     with one atomic conditional update (refunded + reserved + amount ≤ total).
 *  2. Confirmed totals (Order.refundedAmount, Payment.refundedAmount) only grow after the gateway
 *     confirmed the refund, with atomic $inc (no stale read-modify-write), exactly once per refund
 *     (guarded by Order.appliedRefunds / Payment.refunds.refund).
 *  3. A reservation is released only when the gateway has certainly not refunded. Timeouts,
 *     network errors and 5xx keep the reservation and mark the refund reconciliation_required.
 *  4. If the gateway refunded but our database write failed, the refund is NOT rolled back: it is
 *     marked reconciliation_required and completed by reconcileRefunds() (cron + admin button).
 *  5. Repeated submissions with the same idempotency key return the original refund.
 */

export type RefundResult = {
  refundId: string;
  status: RefundStatus;
  refunded: number;
  totalRefunded: number;
  fully: boolean;
  replayed?: boolean;
  message?: string;
};

const OPEN_FOR_RECONCILE: RefundStatus[] = ['processing', 'reconciliation_required'];
/** A refund still "processing" after this long is assumed interrupted and gets reconciled. */
export const STALE_PROCESSING_MS = 5 * 60_000;

async function snapshotResult(refundId: unknown, replayed = false): Promise<RefundResult> {
  const r = await Refund.findById(refundId).lean();
  if (!r) throw notFound('Refund');
  const o = await Order.findById(r.order).select('refundedAmount total').lean();
  const totalRefunded = o?.refundedAmount ?? 0;
  return {
    refundId: String(r._id),
    status: r.status as RefundStatus,
    refunded: r.status === 'succeeded' ? r.amount : 0,
    totalRefunded,
    fully: Boolean(o && totalRefunded >= o.total),
    replayed,
    message:
      r.status === 'reconciliation_required'
        ? 'The gateway did not confirm the refund in time. The amount stays reserved until the refund is reconciled — do not refund again from the gateway dashboard.'
        : r.status === 'failed'
          ? r.lastError || 'Refund failed'
          : undefined,
  };
}

async function transition(refundId: unknown, from: RefundStatus[], to: RefundStatus, set: Record<string, unknown> = {}, note = '', by?: string, session?: ClientSession) {
  const r = await Refund.updateOne(
    { _id: refundId, status: { $in: from } },
    { $set: { status: to, ...set }, $push: { history: { status: to, note: note.slice(0, 300), by } } },
    { session },
  );
  return r.modifiedCount === 1;
}

const orderStatusPipeline = [
  {
    $set: {
      paymentStatus: {
        $cond: [{ $gte: ['$refundedAmount', '$total'] }, 'refunded', { $cond: [{ $gt: ['$refundedAmount', 0] }, 'partially_refunded', '$paymentStatus'] }],
      },
    },
  },
];
const paymentStatusPipeline = [
  { $set: { status: { $cond: [{ $gte: ['$refundedAmount', '$amount'] }, 'refunded', { $cond: [{ $gt: ['$refundedAmount', 0] }, 'partially_refunded', '$status'] }] } } },
];

/**
 * Records a gateway-confirmed refund. Every step is idempotent (safe to re-run during
 * reconciliation) and the whole set runs in one transaction when the database supports it.
 */
export async function commitRefundSuccess(refundId: string, providerRefundId: string, note: string, by?: string) {
  const refund = await Refund.findById(refundId).lean();
  if (!refund) throw notFound('Refund');
  if (refund.status === 'succeeded' || refund.status === 'failed') return false;
  const amount = refund.amount;
  await withTx(async (session) => {
    await Order.updateOne(
      { _id: refund.order, appliedRefunds: { $ne: refund._id } },
      {
        $inc: { refundedAmount: amount, refundReservedAmount: -amount },
        $push: {
          appliedRefunds: refund._id,
          history: { status: 'refund', note: `Refunded ${(amount / 100).toFixed(2)} SAR — ${refund.reason}`, by: refund.requestedBy, visibleToCustomer: true },
        },
      },
      { session },
    );
    await Order.updateOne({ _id: refund.order }, orderStatusPipeline, { session });
    if (refund.payment) {
      await Payment.updateOne(
        { _id: refund.payment, 'refunds.refund': { $ne: refund._id } },
        { $inc: { refundedAmount: amount }, $push: { refunds: { amount, providerRefundId, reason: refund.reason, by: refund.requestedBy, refund: refund._id } } },
        { session },
      );
      await Payment.updateOne({ _id: refund.payment }, paymentStatusPipeline, { session });
    }
    await transition(refund._id, ['requested', 'reserved', 'processing', 'reconciliation_required'], 'succeeded', { providerRefundId, completedAt: new Date(), lastError: '' }, note, by, session);
  });
  return true;
}

/** Marks a refund failed and releases its reservation — only if it was never applied. */
export async function markRefundFailed(refundId: string, reason: string, by?: string) {
  const refund = await Refund.findById(refundId).lean();
  if (!refund || refund.status === 'succeeded' || refund.status === 'failed') return false;
  const order = await Order.findById(refund.order).select('appliedRefunds').lean();
  if ((order?.appliedRefunds ?? []).some((id: unknown) => String(id) === String(refund._id))) {
    // Already counted as refunded on the order: finish it instead of contradicting the ledger.
    await commitRefundSuccess(String(refund._id), refund.providerRefundId || '', 'Completed: refund was already applied', by);
    return false;
  }
  return withTx(async (session) => {
    const ok = await transition(refund._id, ['requested', 'reserved', 'processing', 'reconciliation_required'], 'failed', { lastError: reason.slice(0, 300), completedAt: new Date() }, reason, by, session);
    if (!ok) return false;
    if (refund.status !== 'requested') {
      await Order.updateOne(
        { _id: refund.order, releasedRefunds: { $ne: refund._id }, appliedRefunds: { $ne: refund._id } },
        { $inc: { refundReservedAmount: -refund.amount }, $push: { releasedRefunds: refund._id } },
        { session },
      );
    }
    return true;
  });
}

export async function refundOrder(orderId: string, amount: number, reason: string, by: string, idempotencyKey?: string): Promise<RefundResult> {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('INVALID_AMOUNT', 'Refund amount must be a positive amount');
  await loadIntegrations();
  const key = idempotencyKey || `auto_${randomToken(16)}`;

  const existing = await Refund.findOne({ idempotencyKey: key }).lean();
  if (existing) {
    if (String(existing.order) !== String(orderId) || existing.amount !== amount) throw conflict('IDEMPOTENCY_CONFLICT', 'This refund request was already used for a different refund');
    return snapshotResult(existing._id, true);
  }

  const order = await Order.findById(orderId).lean();
  if (!order) throw notFound('Order');
  const balance = refundableBalance(order);
  if (amount > balance) throw unprocessable('REFUND_TOO_LARGE', `Maximum refundable amount is ${(balance / 100).toFixed(2)} SAR`);

  const isCod = order.paymentMethod === 'cod';
  let payment: { _id: unknown; providerRef?: string | null; provider: string } | null = null;
  if (isCod) {
    if (!['cod_collected', 'partially_refunded'].includes(order.paymentStatus)) throw unprocessable('NOT_COLLECTED', 'Cash has not been collected for this order');
  } else {
    if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) throw unprocessable('NOT_PAID', 'Only paid orders can be refunded');
    payment = await Payment.findOne({ order: order._id, status: { $in: ['paid', 'partially_refunded'] } }).lean();
    if (!payment || !payment.providerRef) throw unprocessable('NO_PAYMENT', 'No captured payment found');
    const provider = providerByName(payment.provider);
    if (!provider?.refund) throw serviceUnavailable('REFUND_UNSUPPORTED', 'Refunds are not supported for this gateway — refund from the gateway dashboard');
  }

  // 1. Durable intent.
  let refund;
  try {
    refund = await Refund.create({
      order: order._id,
      payment: payment?._id,
      provider: isCod ? 'cod' : payment!.provider,
      amount,
      currency: order.currency ?? 'SAR',
      reason,
      idempotencyKey: key,
      requestedBy: by,
      status: 'requested',
      history: [{ status: 'requested', note: reason, by }],
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const again = await Refund.findOne({ idempotencyKey: key }).lean();
      if (again) return snapshotResult(again._id, true);
    }
    throw e;
  }
  const refundId = String(refund._id);

  // 2. Atomic reservation — concurrent refunds can never exceed the total.
  const reserved = await Order.findOneAndUpdate(
    {
      _id: order._id,
      $expr: { $lte: [{ $add: [{ $ifNull: ['$refundedAmount', 0] }, { $ifNull: ['$refundReservedAmount', 0] }, amount] }, '$total'] },
    },
    { $inc: { refundReservedAmount: amount } },
    { new: true },
  ).lean();
  if (!reserved) {
    await transition(refund._id, ['requested'], 'failed', { lastError: 'REFUND_TOO_LARGE', completedAt: new Date() }, 'Would exceed the amount paid', by);
    throw unprocessable('REFUND_TOO_LARGE', 'This refund would exceed the amount paid. Please reload the order.');
  }
  await transition(refund._id, ['requested'], 'reserved', {}, '', by);

  // Cash on delivery: the cash is returned by staff — nothing to call.
  if (isCod) {
    await commitRefundSuccess(refundId, '', 'Cash refund recorded', by);
    return snapshotResult(refundId);
  }

  // 3. Gateway call.
  await transition(refund._id, ['reserved'], 'processing', { providerAttemptedAt: new Date() }, '', by);
  const provider = providerByName(payment!.provider)!;
  let providerRefundId: string;
  try {
    const r = await provider.refund!(payment!.providerRef!, amount, reason, { idempotencyKey: refundId });
    providerRefundId = r.providerRefundId;
  } catch (err) {
    const outcome = outcomeForGatewayError(err);
    const msg = sanitizeError(err);
    if (outcome === 'failed') {
      await markRefundFailed(refundId, `Gateway refused the refund: ${msg}`, by);
      throw unprocessable('REFUND_REJECTED', `The gateway refused the refund: ${msg}`);
    }
    await transition(refund._id, ['processing'], 'reconciliation_required', { lastError: msg }, 'Gateway outcome unknown — awaiting reconciliation', by);
    await Order.updateOne(
      { _id: order._id },
      { $push: { history: { status: 'refund_pending', note: `Refund of ${(amount / 100).toFixed(2)} SAR awaiting gateway confirmation`, by, visibleToCustomer: false } } },
    ).catch(() => undefined);
    logger.warn('Refund outcome uncertain — reconciliation required', { refundId, order: order.orderNumber });
    return snapshotResult(refundId);
  }

  // 4. Record success. If this fails, the refund is real: never roll back — reconcile later.
  try {
    await commitRefundSuccess(refundId, providerRefundId, 'Gateway confirmed the refund', by);
  } catch (dbErr) {
    logger.error('Refund succeeded at the gateway but could not be recorded — reconciliation required', { refundId, err: sanitizeError(dbErr) });
    await Refund.updateOne(
      { _id: refund._id, status: 'processing' },
      { $set: { status: 'reconciliation_required', providerRefundId, lastError: `Gateway refunded; recording failed: ${sanitizeError(dbErr)}` }, $push: { history: { status: 'reconciliation_required', note: 'Recording failed after gateway success' } } },
    ).catch(() => undefined);
    return { refundId, status: 'reconciliation_required', refunded: 0, totalRefunded: order.refundedAmount ?? 0, fully: false, message: 'The gateway confirmed the refund but it could not be recorded yet. It will be completed automatically by reconciliation.' };
  }
  return snapshotResult(refundId);
}

/**
 * Reconciles open refunds of one payment against the gateway's refunded total.
 * Safe to run repeatedly and concurrently (all writes are guarded).
 */
export async function reconcilePayment(paymentId: string, by?: string) {
  await loadIntegrations();
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw notFound('Payment');
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const open = await Refund.find({
    payment: payment._id,
    $or: [{ status: 'reconciliation_required' }, { status: 'processing', providerAttemptedAt: { $lt: staleBefore } }],
  })
    .sort({ createdAt: 1 })
    .lean();
  if (!open.length) return { reconciled: 0, succeeded: [], failed: [], manual: [], note: 'Nothing to reconcile' };

  // Finish refunds already applied to the payment ledger (recording was interrupted half-way).
  const appliedIds = new Set((payment.refunds ?? []).map((r: { refund?: unknown }) => String(r.refund ?? '')));
  const finished: string[] = [];
  for (const r of open) {
    if (appliedIds.has(String(r._id))) {
      await commitRefundSuccess(String(r._id), r.providerRefundId || '', 'Completed by reconciliation', by);
      finished.push(String(r._id));
    }
  }
  const remaining = open.filter((r) => !finished.includes(String(r._id)));
  if (!remaining.length) return { reconciled: finished.length, succeeded: finished, failed: [], manual: [], note: 'Completed interrupted recordings' };

  const provider = providerByName(payment.provider);
  if (!provider?.fetchRefundedTotal || !payment.providerRef) {
    return { reconciled: finished.length, succeeded: finished, failed: [], manual: remaining.map((r) => String(r._id)), note: 'This gateway cannot report refunds automatically — check the gateway dashboard and resolve manually' };
  }
  const fresh = await Payment.findById(payment._id).select('refundedAmount').lean();
  const gatewayRefunded = await provider.fetchRefundedTotal(payment.providerRef);
  const decision = decideReconciliation({
    gatewayRefunded,
    confirmedRefunded: fresh?.refundedAmount ?? 0,
    unresolved: remaining.map((r) => ({ id: String(r._id), amount: r.amount })),
  });
  for (const id of decision.succeeded) await commitRefundSuccess(id, '', `Reconciled: ${decision.note}`, by);
  for (const id of decision.failed) await markRefundFailed(id, `Reconciled: ${decision.note}`, by);
  for (const id of decision.manual) {
    await Refund.updateOne({ _id: id, status: 'processing' }, { $set: { status: 'reconciliation_required' }, $push: { history: { status: 'reconciliation_required', note: decision.note } } });
    await Refund.updateOne({ _id: id }, { $set: { lastError: decision.note } });
  }
  return { reconciled: finished.length + decision.succeeded.length + decision.failed.length, succeeded: [...finished, ...decision.succeeded], failed: decision.failed, manual: decision.manual, note: decision.note };
}

/** Cron / admin: reconcile every payment that has open refunds. */
export async function reconcileOpenRefunds(limit = 50) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const payments = await Refund.distinct('payment', {
    payment: { $ne: null },
    $or: [{ status: 'reconciliation_required' }, { status: 'processing', providerAttemptedAt: { $lt: staleBefore } }],
  });
  let reconciled = 0;
  const errors: string[] = [];
  for (const p of payments.slice(0, limit)) {
    try {
      reconciled += (await reconcilePayment(String(p))).reconciled;
    } catch (e) {
      errors.push(sanitizeError(e));
      logger.warn('Refund reconciliation failed', { payment: String(p), err: sanitizeError(e) });
    }
  }
  return { payments: payments.length, reconciled, errors: errors.length };
}

/** Staff decision after checking the gateway dashboard (audited by the route). */
export async function resolveRefundManually(refundId: string, outcome: 'succeeded' | 'failed', note: string, by: string) {
  const r = await Refund.findById(refundId).lean();
  if (!r) throw notFound('Refund');
  if (!OPEN_FOR_RECONCILE.includes(r.status as RefundStatus)) throw unprocessable('NOT_OPEN', `This refund is already ${r.status}`);
  if (outcome === 'succeeded') await commitRefundSuccess(refundId, r.providerRefundId || '', `Confirmed manually: ${note}`, by);
  else await markRefundFailed(refundId, `Marked failed manually: ${note}`, by);
  return snapshotResult(refundId);
}
