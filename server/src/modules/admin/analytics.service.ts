import type { PipelineStage } from 'mongoose';
import { toCsv } from '../../lib/csv';
import { Order, Payment, Product, getSettings } from '../../models';
import { range } from './reports.service';

/**
 * Business analytics — ONE definition of every figure, used by the dashboard, the reports page and
 * the CSV exports, so totals always agree. All amounts are SAR halalas (the charge currency); the
 * storefront's display currencies never enter these figures. Server-side aggregation only.
 *
 * Period: orders PLACED in the range, by Riyadh calendar day (Asia/Riyadh, UTC+3, no DST).
 * Refunds are attributed to the order's date (the day the sale was made).
 *
 *   paid order          paymentStatus ∈ {paid, partially_refunded, refunded, cod_collected}
 *                       — money was received (online capture or cash collected on delivery)
 *   pending payment     paymentStatus ∈ {pending, cod_pending} and status ∉ {cancelled, returned}
 *                       — not revenue yet (online awaiting confirmation, COD not yet collected)
 *   gross merchandise   Σ subtotal          of paid orders (item prices before discounts)
 *   discounts           Σ discountTotal     of paid orders (codes and automatic offers)
 *   collected           Σ total             of paid orders (after discounts, incl. delivery, COD fee, VAT)
 *   refunds             Σ refundedAmount    of paid orders (full and partial)
 *   net revenue         collected − refunds
 *   AOV                 collected ÷ paid orders
 *   VAT                 Σ vatAmount         of paid orders (VAT included in collected)
 * Cancelled orders that were never paid are excluded from money figures (counted as cancelled).
 * A paid order that was later cancelled stays in "collected" until it is refunded, because the money
 * was received; its refund then brings net revenue back down.
 */

export const PAID = ['paid', 'partially_refunded', 'refunded', 'cod_collected'] as const;
export const PENDING = ['pending', 'cod_pending'] as const;
const OPEN_STATUSES_EXCLUDED = ['cancelled', 'returned'];

const MAX_RANGE_DAYS = 400;
const dayKey = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Riyadh' } };

export function boundedRange(from?: Date, to?: Date) {
  const r = range(from, to);
  if (r.end.getTime() - r.start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    return { start: new Date(r.end.getTime() + 1 - MAX_RANGE_DAYS * 86_400_000), end: r.end, clipped: true };
  }
  return { ...r, clipped: false };
}

function fillDays<T extends { date: string }>(rows: Map<string, T>, start: Date, end: Date, empty: Omit<T, 'date'>) {
  const out: T[] = [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const key = fmt.format(d);
    out.push(rows.get(key) ?? ({ date: key, ...empty } as T));
  }
  return out;
}

export async function analytics(from?: Date, to?: Date) {
  const { start, end, clipped } = boundedRange(from, to);
  const inRange = { createdAt: { $gte: start, $lte: end } };
  const paidMatch = { ...inRange, paymentStatus: { $in: [...PAID] } };
  const lineRevenue = { $subtract: ['$items.lineTotal', { $ifNull: ['$items.discount', 0] }] };

  const settings = await getSettings();
  const lowDefault = settings?.commerce?.lowStockThreshold ?? 5;

  const [money, statusRows, pending, daily, byMethod, topProducts, byCategory, promotions, bundles, identities, lowStock, recent] = await Promise.all([
    Order.aggregate([
      { $match: paidMatch },
      {
        $group: {
          _id: null,
          paidOrders: { $sum: 1 },
          gross: { $sum: '$subtotal' },
          discounts: { $sum: '$discountTotal' },
          collected: { $sum: '$total' },
          refunds: { $sum: { $ifNull: ['$refundedAmount', 0] } },
          vat: { $sum: { $ifNull: ['$vatAmount', 0] } },
          delivery: { $sum: { $ifNull: ['$deliveryFee', 0] } },
          units: { $sum: { $sum: '$items.quantity' } },
          refundedOrders: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$refundedAmount', 0] }, 0] }, 1, 0] } },
        },
      },
    ]),
    Order.aggregate<{ _id: string; n: number }>([{ $match: inRange }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { ...inRange, paymentStatus: { $in: [...PENDING] }, status: { $nin: OPEN_STATUSES_EXCLUDED } } },
      { $group: { _id: '$paymentStatus', orders: { $sum: 1 }, amount: { $sum: '$total' } } },
    ]),
    Order.aggregate<{ _id: string; orders: number; collected: number; refunds: number; placed: number }>([
      { $match: inRange },
      {
        $group: {
          _id: dayKey,
          placed: { $sum: 1 },
          orders: { $sum: { $cond: [{ $in: ['$paymentStatus', [...PAID]] }, 1, 0] } },
          collected: { $sum: { $cond: [{ $in: ['$paymentStatus', [...PAID]] }, '$total', 0] } },
          refunds: { $sum: { $cond: [{ $in: ['$paymentStatus', [...PAID]] }, { $ifNull: ['$refundedAmount', 0] }, 0] } },
        },
      },
    ]),
    Order.aggregate([{ $match: paidMatch }, { $group: { _id: '$paymentMethod', orders: { $sum: 1 }, collected: { $sum: '$total' } } }, { $sort: { collected: -1 } }]),
    Order.aggregate([
      { $match: paidMatch },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', sku: { $first: '$items.sku' }, name: { $first: '$items.name' }, units: { $sum: '$items.quantity' }, orders: { $sum: 1 }, revenue: { $sum: lineRevenue } } },
      { $sort: { revenue: -1, units: -1 } },
      { $limit: 20 },
    ]),
    Order.aggregate([
      { $match: paidMatch },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p', pipeline: [{ $project: { category: 1 } }] } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'categories', localField: 'p.category', foreignField: '_id', as: 'c', pipeline: [{ $project: { slug: 1, name: 1 } }] } },
      { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$c.slug', 'uncategorised'] }, name: { $first: '$c.name' }, units: { $sum: '$items.quantity' }, revenue: { $sum: lineRevenue } } },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: { ...paidMatch, 'discount.id': { $exists: true, $ne: null } } },
      { $group: { _id: '$discount.id', code: { $first: '$discount.code' }, orders: { $sum: 1 }, discount: { $sum: '$discountTotal' }, collected: { $sum: '$total' } } },
      { $lookup: { from: 'discounts', localField: '_id', foreignField: '_id', as: 'd', pipeline: [{ $project: { automatic: 1, title: 1 } }] } },
      { $unwind: { path: '$d', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, code: 1, orders: 1, discount: 1, collected: 1, automatic: { $ifNull: ['$d.automatic', false] }, title: '$d.title' } },
      { $sort: { orders: -1 } },
    ]),
    Order.aggregate([
      { $match: paidMatch },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p', pipeline: [{ $project: { isBundle: 1 } }] } },
      { $match: { 'p.0.isBundle': true } },
      { $group: { _id: '$items.product', sku: { $first: '$items.sku' }, name: { $first: '$items.name' }, units: { $sum: '$items.quantity' }, revenue: { $sum: lineRevenue } } },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]),
    // Customers in the period (signed-in id, else email) and the date of their first ever paid order.
    Order.aggregate<{ _id: string }>([{ $match: paidMatch }, { $group: { _id: { $ifNull: [{ $toString: '$customer' }, { $toLower: '$contact.email' }] } } }]),
    Product.find({ status: { $ne: 'archived' }, $expr: { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', lowDefault] }] } })
      .select('sku name stock lowStockThreshold status isBundle')
      .sort({ stock: 1 })
      .limit(20)
      .lean(),
    Order.find(inRange).select('orderNumber total status paymentStatus paymentMethod createdAt').sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  // New vs returning: a customer is "new" when their first paid order falls inside the period.
  let newCustomers = 0;
  let returningCustomers = 0;
  if (identities.length) {
    const ids = identities.map((i) => i._id).filter(Boolean);
    const firsts = await Order.aggregate<{ _id: string; first: Date }>([
      { $match: { paymentStatus: { $in: [...PAID] } } },
      { $project: { createdAt: 1, who: { $ifNull: [{ $toString: '$customer' }, { $toLower: '$contact.email' }] } } },
      { $match: { who: { $in: ids } } },
      { $group: { _id: '$who', first: { $min: '$createdAt' } } },
    ]);
    for (const f of firsts) {
      if (f.first >= start) newCustomers++;
      else returningCustomers++;
    }
  }

  const m = money[0] ?? { paidOrders: 0, gross: 0, discounts: 0, collected: 0, refunds: 0, vat: 0, delivery: 0, units: 0, refundedOrders: 0 };
  const byStatus = Object.fromEntries(statusRows.map((s) => [s._id, s.n]));
  const placed = statusRows.reduce((a, s) => a + s.n, 0);
  const pendingOrders = pending.reduce((a, p) => a + p.orders, 0);
  const pendingAmount = pending.reduce((a, p) => a + p.amount, 0);
  const dailyMap = new Map(daily.map((d) => [d._id, { date: d._id, placed: d.placed, orders: d.orders, revenue: d.collected, net: d.collected - d.refunds }]));

  return {
    from: start,
    to: end,
    clipped,
    timezone: 'Asia/Riyadh',
    currency: 'SAR',
    summary: {
      placed,
      orders: m.paidOrders, // paid orders (kept as "orders" for existing consumers)
      paidOrders: m.paidOrders,
      pendingOrders,
      pendingAmount,
      pendingCod: pending.find((p) => p._id === 'cod_pending')?.amount ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      refundedOrders: m.refundedOrders,
      units: m.units,
      gross: m.gross,
      discounts: m.discounts,
      revenue: m.collected, // collected (kept as "revenue" for existing consumers)
      collected: m.collected,
      refunds: m.refunds,
      net: m.collected - m.refunds,
      vat: m.vat,
      delivery: m.delivery,
      aov: m.paidOrders ? Math.round(m.collected / m.paidOrders) : 0,
    },
    byStatus,
    daily: fillDays(dailyMap, start, end, { placed: 0, orders: 0, revenue: 0, net: 0 }),
    byPaymentMethod: byMethod.map((x) => ({ _id: x._id, orders: x.orders, revenue: x.collected })),
    topProducts,
    byCategory,
    promotions,
    discounts: promotions.map((p) => ({ _id: p.code, orders: p.orders, discount: p.discount })),
    bundles,
    customers: { new: newCustomers, returning: returningCustomers },
    lowStock,
    recentOrders: recent,
    funnel: null as null, // no reliable page-view/add-to-cart event tracking exists — not reported
  };
}

/** CSV exports of the same figures (no customer contact details). */
export async function analyticsCsv(kind: 'summary' | 'products' | 'payments', from?: Date, to?: Date) {
  const a = await analytics(from, to);
  const sar = (h: number) => (h / 100).toFixed(2);
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
  if (kind === 'summary') {
    const s = a.summary;
    const rows: (string | number)[][] = [
      ['metric', 'value'],
      ['period_from', day(a.from)],
      ['period_to', day(a.to)],
      ['currency', 'SAR'],
      ['orders_placed', s.placed],
      ['paid_orders', s.paidOrders],
      ['pending_payment_orders', s.pendingOrders],
      ['cancelled_orders', s.cancelled],
      ['refunded_orders', s.refundedOrders],
      ['units_sold', s.units],
      ['gross_merchandise_sar', sar(s.gross)],
      ['discounts_sar', sar(s.discounts)],
      ['collected_sar', sar(s.collected)],
      ['refunds_sar', sar(s.refunds)],
      ['net_revenue_sar', sar(s.net)],
      ['pending_payments_sar', sar(s.pendingAmount)],
      ['vat_included_sar', sar(s.vat)],
      ['average_order_value_sar', sar(s.aov)],
      ['new_customers', a.customers.new],
      ['returning_customers', a.customers.returning],
      [],
      ['date', 'orders_placed', 'paid_orders', 'collected_sar', 'net_sar'],
      ...a.daily.map((d) => [d.date, d.placed, d.orders, sar(d.revenue), sar(d.net)]),
    ];
    return toCsv(rows);
  }
  if (kind === 'products') {
    return toCsv([
      ['sku', 'name_en', 'name_ar', 'paid_orders', 'units', 'revenue_after_discounts_sar'],
      ...a.topProducts.map((p: { sku: string; name?: { en?: string; ar?: string }; orders: number; units: number; revenue: number }) => [p.sku, p.name?.en ?? '', p.name?.ar ?? '', p.orders, p.units, sar(p.revenue)]),
    ]);
  }
  const payments = await Payment.find({ createdAt: { $gte: a.from, $lte: a.to } }).populate('order', 'orderNumber').sort({ createdAt: 1 }).limit(20_000).lean();
  return toCsv([
    ['created_at', 'order_number', 'provider', 'method', 'status', 'amount_sar', 'currency', 'refunded_sar', 'transaction_ref', 'failure_reason'],
    ...payments.map((p) => [
      new Date((p as unknown as { createdAt: Date }).createdAt).toISOString(),
      (p.order as unknown as { orderNumber?: string } | null)?.orderNumber ?? '',
      p.provider,
      p.method,
      p.status,
      sar(p.amount),
      p.currency ?? 'SAR',
      sar(p.refundedAmount ?? 0),
      p.providerRef ?? '',
      (p.failureReason ?? '').slice(0, 120),
    ]),
  ]);
}

/** Payment records for the admin (no card data is ever stored; only gateway references). */
export async function listPayments(q: { status?: string; provider?: string; method?: string; q?: string; from?: Date; to?: Date; page: number; limit: number }) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.provider) filter.provider = q.provider;
  if (q.method) filter.method = q.method;
  if (q.from || q.to) {
    const r = boundedRange(q.from, q.to);
    filter.createdAt = { $gte: r.start, $lte: r.end };
  }
  if (q.q) {
    const term = q.q.trim();
    const orders = await Order.find({ orderNumber: term.toUpperCase() }).select('_id').lean();
    filter.$or = [{ providerRef: term }, ...(orders.length ? [{ order: { $in: orders.map((o) => o._id) } }] : [])];
  }
  const pipeline: PipelineStage[] = [{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }];
  const [items, total, counts] = await Promise.all([
    Payment.find(filter)
      .select('order provider method amount currency status providerRef failureReason refundedAmount createdAt updatedAt')
      .populate('order', 'orderNumber status paymentStatus total')
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Payment.countDocuments(filter),
    Payment.aggregate<{ _id: string; n: number; amount: number }>(pipeline),
  ]);
  return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)), counts: Object.fromEntries(counts.map((c) => [c._id, { n: c.n, amount: c.amount }])) };
}

export async function paymentDetail(id: string) {
  return Payment.findById(id).select('-redirectUrl').populate('order', 'orderNumber status paymentStatus total refundedAmount paymentMethod createdAt').populate('refunds.by', 'name').lean();
}
