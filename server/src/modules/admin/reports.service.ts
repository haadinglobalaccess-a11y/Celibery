import { ORDER_STATUSES, Order, Product, User, getSettings } from '../../models';
import { toCsv } from '../../lib/csv';

/**
 * Paid orders = money received (online capture, or cash collected on delivery). Same rule as
 * analytics.service.ts — COD orders not yet collected are pending payments, not revenue; refunds
 * are subtracted for net revenue.
 */
const revenueMatch = { paymentStatus: { $in: ['paid', 'partially_refunded', 'refunded', 'cod_collected'] } };

/** Saudi Arabia is UTC+3 all year (no daylight saving). Reports use Riyadh calendar days. */
const RIYADH_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** Start (00:00 Riyadh time, as a UTC instant) of the Riyadh calendar day containing `d`. */
export function riyadhDayStart(d: Date): Date {
  const local = new Date(d.getTime() + RIYADH_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - RIYADH_OFFSET_MS);
}

/**
 * Inclusive report range in Riyadh calendar days — independent of the server's time zone (the
 * hosting runs in UTC). Date-only inputs ("2026-11-01") mean that calendar day in Riyadh.
 */
export function range(from?: Date, to?: Date) {
  const endDay = riyadhDayStart(to ?? new Date());
  const startDay = from ? riyadhDayStart(from) : new Date(endDay.getTime() - 29 * DAY_MS);
  return { start: startDay, end: new Date(endDay.getTime() + DAY_MS - 1) };
}

export async function overview() {
  const settings = await getSettings();
  const lowDefault = settings?.commerce?.lowStockThreshold ?? 5;
  const { start, end } = range();
  const [totals, byStatus, trend, lowStock, recent, customers] = await Promise.all([
    Order.aggregate([{ $match: revenueMatch }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $subtract: ['$total', { $ifNull: ['$refundedAmount', 0] }] } } } }]),
    // One index count per status (COUNT_SCAN on status_1) instead of grouping every order document.
    Promise.all(ORDER_STATUSES.map(async (s) => ({ _id: s, n: await Order.countDocuments({ status: s }) }))).then((rows) => rows.filter((r) => r.n > 0)),
    Order.aggregate([
      { $match: { ...revenueMatch, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Riyadh' } }, orders: { $sum: 1 }, revenue: { $sum: { $subtract: ['$total', { $ifNull: ['$refundedAmount', 0] }] } } } },
      { $sort: { _id: 1 } },
    ]),
    Product.find({ status: { $ne: 'archived' }, $expr: { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', lowDefault] }] } })
      .select('sku name stock lowStockThreshold status')
      .sort({ stock: 1 })
      .limit(20)
      .lean(),
    Order.find().select('orderNumber contact.name total status paymentStatus paymentMethod createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    User.countDocuments({ type: 'customer' }),
  ]);
  const statusMap = Object.fromEntries(byStatus.map((s: { _id: string; n: number }) => [s._id, s.n]));
  const needsReview = await Order.countDocuments({ 'history.status': 'payment_review' });
  return {
    totalOrders: totals[0]?.orders ?? 0,
    revenue: totals[0]?.revenue ?? 0,
    pendingOrders: (statusMap.pending ?? 0) + (statusMap.confirmed ?? 0) + (statusMap.processing ?? 0),
    ordersByStatus: statusMap,
    salesTrend: fillDays(trend, start, end),
    lowStock,
    outOfStock: lowStock.filter((p) => p.stock === 0).length,
    recentOrders: recent,
    customers,
    paymentReviewCount: needsReview,
  };
}

function fillDays(rows: { _id: string; orders: number; revenue: number }[], start: Date, end: Date) {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out: { date: string; orders: number; revenue: number }[] = [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    const key = fmt.format(d);
    const r = map.get(key);
    out.push({ date: key, orders: r?.orders ?? 0, revenue: r?.revenue ?? 0 });
  }
  return out;
}

/** Sales report = analytics for the range (same figures as the dashboard and CSV exports). */
export async function salesReport(from?: Date, to?: Date) {
  const { analytics } = await import('./analytics.service');
  return analytics(from, to);
}

export async function ordersCsv(from?: Date, to?: Date) {
  const { start, end } = range(from, to);
  const orders = await Order.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: 1 }).lean();
  const header = ['order_number', 'created_at', 'status', 'payment_status', 'payment_method', 'customer', 'email', 'phone', 'city', 'items', 'subtotal_sar', 'discount_sar', 'delivery_sar', 'cod_fee_sar', 'total_sar', 'vat_sar', 'refunded_sar', 'discount_code', 'tracking'];
  const rows = orders.map((o) => [
    o.orderNumber,
    new Date((o as unknown as { createdAt: Date }).createdAt).toISOString(),
    o.status,
    o.paymentStatus,
    o.paymentMethod,
    o.contact.name,
    o.contact.email,
    o.contact.phone,
    o.shippingAddress.city,
    o.items.map((i) => `${i.sku} x${i.quantity}`).join('; '),
    (o.subtotal / 100).toFixed(2),
    (o.discountTotal / 100).toFixed(2),
    (o.deliveryFee / 100).toFixed(2),
    (o.codFee / 100).toFixed(2),
    (o.total / 100).toFixed(2),
    (o.vatAmount / 100).toFixed(2),
    ((o.refundedAmount ?? 0) / 100).toFixed(2),
    o.discount?.code ?? '',
    o.delivery?.trackingNumber ?? '',
  ]);
  return toCsv([header, ...rows]);
}
