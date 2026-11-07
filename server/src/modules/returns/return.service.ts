import { Types } from 'mongoose';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { formatSar } from '../../lib/money';
import { notifyOrder } from '../../integrations/notifications';
import type { OrderEvent } from '../../integrations/notifications/templates';
import { InventoryMovement, Order, Product, ReturnRequest, getSettings, nextSequence, type OrderDoc, type ReturnReason, type ReturnStatus } from '../../models';
import { orderLink, transitionOrder } from '../orders/order.service';
import { refundOrder } from '../payments/refund.service';
import { canTransition, eligibility, unitsAmount, type OrderLine } from './return-rules';

type Actor = { userId?: string; byCustomer?: boolean };

const eventFor: Partial<Record<ReturnStatus, OrderEvent>> = {
  requested: 'return_requested',
  approved: 'return_approved',
  rejected: 'return_rejected',
  received: 'return_received',
  refunded: 'return_refunded',
};

/** Fire-and-forget customer notification (email + WhatsApp) for a return step. */
function notify(order: OrderDoc | Record<string, unknown>, ret: { returnNumber: string; refund?: { amount?: number | null } | null; decisionNote?: string | null }, status: ReturnStatus) {
  const ev = eventFor[status];
  if (!ev) return;
  const o = order as Parameters<typeof notifyOrder>[0];
  void notifyOrder(o, ev, orderLink(o as { orderNumber: string; lang?: string | null }), {
    returnNumber: ret.returnNumber,
    refundAmount: ret.refund?.amount != null ? formatSar(ret.refund.amount) : '',
    note: ret.decisionNote ?? '',
  });
}

/** What the customer can return from this order right now. */
export async function returnOptions(order: OrderDoc | Record<string, unknown>) {
  const o = order as unknown as { _id: unknown; status: string; delivery?: { deliveredAt?: Date | null } | null; items: OrderLine[] };
  const [settings, existing] = await Promise.all([getSettings(), ReturnRequest.find({ order: o._id }).sort({ createdAt: -1 }).lean()]);
  const e = eligibility(o, settings?.commerce ?? {}, existing);
  return { ...e, windowDays: settings?.commerce?.returnWindowDays ?? 7, returns: existing.map(toCustomerReturn) };
}

export function toCustomerReturn(r: Record<string, unknown> | InstanceType<typeof ReturnRequest>) {
  const x = r as unknown as {
    returnNumber: string; status: string; reason: string; details: string; items: unknown[]; requestedAmount: number;
    refund?: { amount?: number; status?: string; at?: Date } | null; decisionNote?: string; createdAt: Date;
    history: { status: string; note?: string; at: Date; visibleToCustomer?: boolean }[];
  };
  return {
    returnNumber: x.returnNumber,
    status: x.status,
    reason: x.reason,
    details: x.details,
    items: x.items,
    requestedAmount: x.requestedAmount,
    refund: x.refund?.amount != null ? { amount: x.refund.amount, status: x.refund.status, at: x.refund.at } : null,
    decisionNote: x.decisionNote ?? '',
    createdAt: x.createdAt,
    history: (x.history ?? []).filter((h) => h.visibleToCustomer !== false).map((h) => ({ status: h.status, note: h.note ?? '', at: h.at })),
  };
}

/** Creates a return request for an order the caller is allowed to access. */
export async function createReturn(
  order: OrderDoc | Record<string, unknown>,
  input: { items: { productId: string; quantity: number }[]; reason: ReturnReason; details: string },
  actor: Actor & { customerId?: string },
) {
  const o = order as unknown as OrderDoc & { items: OrderLine[] };
  const opts = await returnOptions(o);
  if (!opts.eligible) {
    const msg = {
      disabled: 'Returns are not available at the moment. Please contact us.',
      not_delivered: 'A return can be requested once the order has been delivered.',
      window_closed: `The return period (${opts.windowDays} days after delivery) has ended for this order.`,
      nothing_left: 'All items of this order are already in a return request.',
      '': '',
    }[opts.reason];
    throw unprocessable('RETURN_NOT_ALLOWED', msg, { reason: opts.reason });
  }
  // Merge duplicate lines, then check every quantity against what is still returnable.
  const wanted = new Map<string, number>();
  for (const it of input.items) wanted.set(it.productId, (wanted.get(it.productId) ?? 0) + it.quantity);
  const items = [];
  for (const [productId, quantity] of wanted) {
    const line = opts.lines.find((l) => l.productId === productId);
    const orderLine = o.items.find((it) => String(it.product) === productId);
    if (!line || !orderLine) throw badRequest('RETURN_ITEM_INVALID', 'An item is not part of this order');
    if (quantity > line.returnable) throw unprocessable('RETURN_QUANTITY', `Only ${line.returnable} unit(s) of ${line.sku} can still be returned`);
    items.push({ product: orderLine.product, sku: orderLine.sku, name: line.name, image: line.image, quantity, amount: unitsAmount(orderLine, quantity) });
  }
  const seq = await nextSequence('return');
  const doc = await ReturnRequest.create({
    returnNumber: `RET-${String(seq).padStart(5, '0')}`,
    order: o._id,
    orderNumber: o.orderNumber,
    customer: o.customer ?? (actor.customerId ? new Types.ObjectId(actor.customerId) : undefined),
    contact: { name: o.contact.name, email: o.contact.email, phone: o.contact.phone },
    lang: o.lang === 'en' ? 'en' : 'ar',
    items,
    reason: input.reason,
    details: input.details,
    requestedAmount: items.reduce((s, i) => s + i.amount, 0),
    history: [{ status: 'requested', note: '', by: actor.userId, byCustomer: Boolean(actor.byCustomer) }],
  });
  notify(o, doc, 'requested');
  return doc.toObject();
}

/** Moves a return to its next status with an optimistic-concurrency guard. */
async function move(id: string, to: ReturnStatus, patch: Record<string, unknown>, history: { note?: string; by?: string; byCustomer?: boolean }) {
  const current = await ReturnRequest.findById(id).lean();
  if (!current) throw notFound('Return request');
  const from = current.status as ReturnStatus;
  if (!canTransition(from, to)) throw unprocessable('INVALID_TRANSITION', `Cannot change a return from ${from} to ${to}`);
  const saved = await ReturnRequest.findOneAndUpdate(
    { _id: id, status: from },
    { $set: { status: to, ...patch }, $push: { history: { status: to, note: history.note ?? '', by: history.by, byCustomer: Boolean(history.byCustomer) } } },
    { new: true },
  ).lean();
  if (!saved) throw conflict('CONCURRENT_UPDATE', 'The return was updated by someone else. Please reload.');
  return saved;
}

async function orderOf(r: { order: unknown }) {
  const order = await Order.findById(r.order).lean();
  if (!order) throw notFound('Order');
  return order;
}

export async function approveReturn(id: string, note: string, by: string) {
  const r = await move(id, 'approved', {}, { note, by });
  notify(await orderOf(r), r, 'approved');
  return r;
}

export async function rejectReturn(id: string, note: string, by: string) {
  if (!note.trim()) throw badRequest('NOTE_REQUIRED', 'Tell the customer why the return is rejected');
  const r = await move(id, 'rejected', { decisionNote: note.trim() }, { note, by });
  notify(await orderOf(r), r, 'rejected');
  return r;
}

/** Customer withdraws a request that has not been received yet. */
export async function cancelReturnByCustomer(returnNumber: string, orderId: unknown) {
  const r = await ReturnRequest.findOne({ returnNumber, order: orderId }).lean();
  if (!r) throw notFound('Return request');
  if (!['requested', 'approved'].includes(r.status)) throw unprocessable('INVALID_TRANSITION', 'This return can no longer be cancelled');
  return move(String(r._id), 'cancelled', {}, { note: 'Cancelled by the customer', byCustomer: true });
}

/**
 * The returned items arrived. Optionally puts them back into stock (ledgered), and marks the
 * order Returned once every unit of it has been received back.
 */
export async function receiveReturn(id: string, opts: { restock: boolean; note: string; by: string }) {
  const r = await move(id, 'received', { restocked: opts.restock }, { note: opts.note, by: opts.by });
  if (opts.restock) {
    const movements = [];
    for (const it of r.items) {
      const p = await Product.findOneAndUpdate({ _id: it.product }, { $inc: { stock: it.quantity } }, { new: true, projection: { stock: 1 } }).lean();
      if (p) movements.push({ product: it.product, type: 'return_restock', delta: it.quantity, stockAfter: p.stock, reason: `Return ${r.returnNumber}`, order: r.order, user: opts.by });
    }
    if (movements.length) await InventoryMovement.insertMany(movements);
  }
  const order = await orderOf(r);
  const back = await ReturnRequest.find({ order: r.order, status: { $in: ['received', 'refunded'] } }).lean();
  const units = new Map<string, number>();
  for (const x of back) for (const it of x.items) units.set(String(it.product), (units.get(String(it.product)) ?? 0) + it.quantity);
  const everything = order.items.every((it) => (units.get(String(it.product)) ?? 0) >= it.quantity);
  if (everything && order.status === 'delivered') {
    // Stock was already handled per return above — do not restock again.
    await transitionOrder(String(order._id), 'returned', { by: opts.by, note: `All items returned (${r.returnNumber})`, restock: false, notify: false });
  }
  notify(order, r, 'received');
  return ReturnRequest.findById(id).lean();
}

/**
 * Refunds a received return through the refund ledger (gateway refund, or a recorded cash
 * refund for COD). Idempotent per return: retrying returns the same refund. The return becomes
 * "refunded" only once the refund has succeeded; an uncertain gateway outcome keeps it
 * "received" until reconciliation settles it, and the next attempt picks up the final result.
 */
export async function refundReturn(id: string, opts: { amount?: number; note: string; by: string }) {
  const r = await ReturnRequest.findById(id).lean();
  if (!r) throw notFound('Return request');
  if (r.status !== 'received') throw unprocessable('INVALID_TRANSITION', r.status === 'refunded' ? 'This return is already refunded' : 'Mark the items as received before refunding');
  const amount = r.refund?.amount ?? opts.amount ?? r.requestedAmount;
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('INVALID_AMOUNT', 'Refund amount must be positive');
  if (amount > r.requestedAmount) throw unprocessable('REFUND_TOO_LARGE', `A return can be refunded up to ${formatSar(r.requestedAmount)}`);
  const result = await refundOrder(String(r.order), amount, `Return ${r.returnNumber}${opts.note ? ` — ${opts.note}` : ''}`, opts.by, `return_${r._id}`);
  const refund = { id: new Types.ObjectId(result.refundId), amount, status: result.status, at: new Date() };
  if (result.status !== 'succeeded') {
    await ReturnRequest.updateOne({ _id: r._id }, { $set: { refund } });
    return { return: await ReturnRequest.findById(id).lean(), refund: result };
  }
  const saved = await move(id, 'refunded', { refund }, { note: opts.note, by: opts.by });
  notify(await orderOf(saved), saved, 'refunded');
  return { return: saved, refund: result };
}
