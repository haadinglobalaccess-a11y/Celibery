import type { ClientSession, Types } from 'mongoose';
import { env, isTest } from '../../config/env';
import { withTx } from '../../db/tx';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { vatIncluded } from '../../lib/money';
import { randomToken, sha256 } from '../../lib/tokens';
import { cleanLocLine } from '../../lib/text';
import { notifyOrder } from '../../integrations/notifications';
import { queueOrderConfirmation } from '../../integrations/notifications/order-confirmation';
import type { OrderEvent } from '../../integrations/notifications/templates';
import { manualCourier } from '../../integrations/shipping';
import {
  Discount,
  DiscountRedemption,
  InventoryMovement,
  Order,
  ORDER_TRANSITIONS,
  Product,
  User,
  getSettings,
  nextSequence,
  type DiscountDoc,
  type OrderDoc,
  type OrderStatus,
  type PaymentMethod,
} from '../../models';
import type { CheckoutInput } from './order.schemas';
import { codEligibility, deliveryFeeFor, resolveDelivery } from './delivery-rules';

type CartLine = { productId: string; quantity: number };

export type QuoteLine = {
  productId: string;
  slug: string;
  sku: string;
  model: string;
  name: { ar: string; en: string };
  image: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  discount: number;
  available: boolean;
  maxQuantity: number;
  warrantyMonths: number;
};

export type Quote = {
  lines: QuoteLine[];
  issues: { productId?: string; code: string; message: string }[];
  subtotal: number;
  discountTotal: number;
  discount: { code: string; id: string; perCustomerLimit?: number | null } | null;
  discountError: string | null;
  deliveryFee: number;
  codFee: number;
  codAvailable: boolean;
  codUnavailableReason: string;
  /** false while delivery is paused in Admin → Settings → Shipping. */
  shippingAvailable: boolean;
  /** Why delivery is unavailable: 'paused' (store-wide pause) or 'city' (outside every delivery zone). */
  shippingUnavailableReason: '' | 'paused' | 'city';
  /** Delivery zone that priced this quote (only once the city is known). */
  zone: { key: string; name: { ar: string; en: string }; estimatedDelivery: { ar: string; en: string } } | null;
  total: number;
  vatRate: number;
  vatAmount: number;
  currency: string;
};

function mergeLines(items: CartLine[]) {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
  return [...map.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Last 9 digits of a Saudi mobile number (5XXXXXXXX), whatever format was typed (05…, +9665…, 9665…). */
export const phoneKey = (phone?: string | null) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
};

/** Identities one shopper can be recognised by: account, email and phone. */
export function identityKeys(who: { id?: unknown; email?: string | null; phone?: string | null }) {
  const keys: string[] = [];
  if (who.id) keys.push(`c:${String(who.id)}`);
  if (who.email) keys.push(`e:${String(who.email).trim().toLowerCase()}`);
  const p = phoneKey(who.phone);
  if (p) keys.push(`p:${p}`);
  return keys;
}

/**
 * Records one use of a per-customer-limited code for one identity, atomically: increments the
 * counter only while it is below the limit; when the record is already at the limit the upsert
 * collides with the unique index and the use is refused. Safe under parallel checkouts.
 */
async function claimRedemption(discountId: string, key: string, limit: number, session?: ClientSession) {
  if (limit <= 0) return false;
  try {
    const r = await DiscountRedemption.updateOne({ discount: discountId, key, count: { $lt: limit } }, { $inc: { count: 1 } }, { upsert: true, session });
    return r.modifiedCount === 1 || r.upsertedCount === 1;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
}

/** Open cash-on-delivery orders allowed per phone number (stops fake COD orders locking up stock). 0 = no limit. */
export const maxOpenCodOrdersPerPhone = () => env.MAX_OPEN_COD_ORDERS_PER_PHONE ?? (isTest ? 0 : 3);

/** Validates a discount code against the cart. Returns the discount (halalas) and per-line allocation. */
async function evaluateDiscount(
  code: string,
  lines: QuoteLine[],
  subtotal: number,
  customer: { id?: string; email?: string; phone?: string },
): Promise<{ discount: DiscountDoc; amount: number; perLine: number[] } | { error: string }> {
  const d = await Discount.findOne({ code: code.toUpperCase() }).lean();
  const now = new Date();
  if (!d || !d.active) return { error: 'This discount code is not valid' };
  if (d.startsAt && d.startsAt > now) return { error: 'This discount code is not active yet' };
  if (d.endsAt && d.endsAt < now) return { error: 'This discount code has expired' };
  if (d.usageLimit != null && d.usedCount >= d.usageLimit) return { error: 'This discount code has reached its usage limit' };
  if (d.minOrderTotal && subtotal < d.minOrderTotal) return { error: `Minimum order for this code is ${(d.minOrderTotal / 100).toFixed(2)} SAR` };
  if (d.perCustomerLimit != null && (customer.id || customer.email || phoneKey(customer.phone))) {
    const or: Record<string, unknown>[] = [];
    if (customer.id) or.push({ customer: customer.id });
    if (customer.email) or.push({ 'contact.email': customer.email.toLowerCase() });
    // Same phone in any format (a guest cannot reuse a code just by typing a new email).
    const p = phoneKey(customer.phone);
    if (p) or.push({ 'contact.phone': { $regex: `${p}$` } });
    const used = await Order.countDocuments({ 'discount.id': d._id, status: { $ne: 'cancelled' }, $or: or });
    if (used >= d.perCustomerLimit) return { error: 'You have already used this discount code' };
  }

  // Eligibility: restricted to products/categories when configured.
  const productIds = new Set((d.products ?? []).map(String));
  const categoryIds = new Set((d.categories ?? []).map(String));
  let eligibleIdx = lines.map((_, i) => i);
  if (productIds.size || categoryIds.size) {
    const prods = await Product.find({ _id: { $in: lines.map((l) => l.productId) } }).select('category').lean();
    const catOf = new Map(prods.map((p) => [String(p._id), String(p.category)]));
    eligibleIdx = eligibleIdx.filter((i) => productIds.has(lines[i].productId) || categoryIds.has(catOf.get(lines[i].productId) ?? ''));
  }
  const eligibleTotal = eligibleIdx.reduce((s, i) => s + lines[i].lineTotal, 0);
  if (eligibleTotal <= 0) return { error: 'This discount code does not apply to the items in your cart' };

  let amount = d.type === 'percent' ? Math.floor((eligibleTotal * Math.min(d.value, 100)) / 100) : Math.min(d.value, eligibleTotal);
  if (d.type === 'percent' && d.maxDiscount) amount = Math.min(amount, d.maxDiscount);

  // Allocate proportionally to eligible lines (remainder to the last one) for reporting/refunds.
  const perLine = lines.map(() => 0);
  let allocated = 0;
  eligibleIdx.forEach((i, k) => {
    const share = k === eligibleIdx.length - 1 ? amount - allocated : Math.floor((amount * lines[i].lineTotal) / eligibleTotal);
    perLine[i] = share;
    allocated += share;
  });
  return { discount: d as DiscountDoc, amount, perLine };
}

/**
 * Server-authoritative quote. Prices, availability and discounts always come from the
 * database — anything the browser sends besides product ids and quantities is ignored.
 */
export async function quote(
  items: CartLine[],
  opts: { discountCode?: string; paymentMethod?: PaymentMethod; customerId?: string; email?: string; phone?: string; city?: string } = {},
): Promise<Quote> {
  const settings = await getSettings();
  const merged = mergeLines(items);
  const maxQty = settings?.commerce?.maxQuantityPerItem ?? 10;
  const products = await Product.find({ _id: { $in: merged.map((m) => m.productId) } })
    .select('slug sku model name images price stock status warrantyMonths')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const issues: Quote['issues'] = [];
  const lines: QuoteLine[] = [];
  const defaultWarranty = settings?.commerce?.warrantyEnabled ? (settings?.commerce?.warrantyMonths ?? 0) : 0;

  for (const m of merged) {
    const p = byId.get(m.productId);
    if (!p || p.status !== 'active') {
      issues.push({ productId: m.productId, code: 'UNAVAILABLE', message: 'This product is no longer available' });
      continue;
    }
    const limit = Math.min(maxQty, p.stock);
    let qty = m.quantity;
    if (p.stock <= 0) {
      issues.push({ productId: m.productId, code: 'OUT_OF_STOCK', message: 'Out of stock' });
    } else if (qty > limit) {
      issues.push({ productId: m.productId, code: 'QUANTITY_LIMITED', message: `Only ${limit} available` });
      qty = limit;
    }
    lines.push({
      productId: String(p._id),
      slug: p.slug,
      sku: p.sku,
      model: p.model ?? '',
      name: cleanLocLine(p.name), // the order keeps this snapshot: clean text only
      image: p.images?.[0]?.url ?? '',
      unitPrice: p.price,
      quantity: qty,
      lineTotal: p.price * qty,
      discount: 0,
      available: p.stock > 0,
      maxQuantity: Math.max(0, limit),
      warrantyMonths: settings?.commerce?.warrantyEnabled ? (p.warrantyMonths ?? defaultWarranty) : 0,
    });
  }

  const purchasable = lines.filter((l) => l.available);
  const subtotal = purchasable.reduce((s, l) => s + l.lineTotal, 0);

  let discountTotal = 0;
  let discount: Quote['discount'] = null;
  let discountError: string | null = null;
  if (opts.discountCode) {
    const r = await evaluateDiscount(opts.discountCode, purchasable, subtotal, { id: opts.customerId, email: opts.email, phone: opts.phone });
    if ('error' in r) discountError = r.error;
    else {
      discountTotal = r.amount;
      discount = { code: r.discount.code, id: String(r.discount._id), perCustomerLimit: r.discount.perCustomerLimit ?? null };
      purchasable.forEach((l, i) => (l.discount = r.perLine[i]));
    }
  }

  // Delivery zone for the city (Admin → Settings → Shipping); store-wide rules when none applies.
  const delivery = resolveDelivery(settings?.commerce ?? null, opts.city);
  const rules = delivery.rules;
  const deliveryFee = deliveryFeeFor(rules, subtotal - discountTotal);
  const preCod = subtotal - discountTotal + deliveryFee;
  const cod = codEligibility(rules, preCod, opts.city);
  const codAvailable = cod.available;
  const shippingAvailable = delivery.unavailable === '';
  const codFee = opts.paymentMethod === 'cod' && codAvailable ? (rules.codFee ?? 0) : 0;
  const total = preCod + codFee;
  const vatRate = settings?.commerce?.vatRatePercent ?? 0;

  return {
    lines,
    issues,
    subtotal,
    discountTotal,
    discount,
    discountError,
    deliveryFee,
    codFee,
    codAvailable,
    codUnavailableReason: cod.reason,
    shippingAvailable,
    shippingUnavailableReason: delivery.unavailable,
    zone: delivery.zone ? { key: delivery.zone.key, name: { ar: delivery.zone.name?.ar ?? '', en: delivery.zone.name?.en ?? '' }, estimatedDelivery: { ar: delivery.zone.estimatedDelivery?.ar ?? '', en: delivery.zone.estimatedDelivery?.en ?? '' } } : null,
    total,
    vatRate,
    vatAmount: vatIncluded(total, vatRate),
    currency: settings?.commerce?.currency ?? 'SAR',
  };
}

async function writeMovements(
  docs: { product: unknown; type: string; delta: number; stockAfter: number; reason?: string; order?: unknown; user?: unknown }[],
  session?: ClientSession,
) {
  if (docs.length) await InventoryMovement.insertMany(docs, { session });
}

/**
 * Creates an order: validates everything server-side, reserves stock atomically,
 * consumes the discount, and persists the order — in one transaction when available.
 * Idempotent: replaying the same idempotencyKey returns the original order.
 */
export async function createOrder(input: CheckoutInput, customerId?: string) {
  const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey }).lean();
  if (existing) {
    if (existing.contact.email !== input.contact.email) throw conflict('IDEMPOTENCY_CONFLICT', 'This checkout request was already used');
    return { order: existing, accessToken: null as string | null, replayed: true };
  }

  const settings = await getSettings();
  const q = await quote(input.items, { discountCode: input.discountCode || undefined, paymentMethod: input.paymentMethod, customerId, email: input.contact.email, phone: input.contact.phone, city: input.shippingAddress.city });
  // Any change (unavailable item, reduced stock) must be reviewed by the customer first.
  if (q.issues.length) throw unprocessable('CART_CHANGED', 'Some items in your cart changed. Please review your cart.', { issues: q.issues });
  if (input.discountCode && q.discountError) throw unprocessable('DISCOUNT_INVALID', q.discountError);
  if (q.shippingUnavailableReason === 'city') throw unprocessable('SHIPPING_CITY_UNAVAILABLE', 'We do not deliver to this city yet. Please choose another delivery address or contact us.');
  if (!q.shippingAvailable) throw unprocessable('SHIPPING_PAUSED', 'Delivery is temporarily unavailable. Please try again later.');
  if (input.paymentMethod === 'cod' && !q.codAvailable) throw unprocessable('COD_UNAVAILABLE', 'Cash on delivery is not available for this order');
  if (input.paymentMethod !== 'cod') {
    const { availablePaymentMethods } = await import('../payments/payment.service');
    const methods = availablePaymentMethods(settings);
    if (!methods[input.paymentMethod as keyof typeof methods]) throw unprocessable('PAYMENT_METHOD_UNAVAILABLE', 'This payment method is not available right now');
  }
  if (q.total <= 0) throw unprocessable('INVALID_TOTAL', 'Order total must be greater than zero');

  const orderNumber = `CEL-${100000 + (await nextSequence('order'))}`;
  const accessToken = randomToken(24);
  const isCod = input.paymentMethod === 'cod';
  const reservationMinutes = settings?.commerce?.reservationMinutes ?? 30;

  // Fake cash-on-delivery orders reserve stock until staff cancel them: cap open COD orders per phone.
  const codCap = maxOpenCodOrdersPerPhone();
  const phone = phoneKey(input.contact.phone);
  if (isCod && codCap > 0 && phone) {
    const open = await Order.countDocuments({ paymentMethod: 'cod', status: { $in: ['pending', 'confirmed', 'processing'] }, 'contact.phone': { $regex: `${phone}$` } });
    if (open >= codCap) {
      throw unprocessable('TOO_MANY_OPEN_ORDERS', 'You already have several cash-on-delivery orders in progress. Please wait for them to arrive, choose another payment method, or contact us on WhatsApp.');
    }
  }

  const redemptionKeys = identityKeys({ id: customerId, email: input.contact.email, phone: input.contact.phone });
  const applied: { productId: string; qty: number }[] = [];
  const claimedKeys: string[] = [];
  let discountConsumed = false;

  const run = async (session?: ClientSession) => {
    applied.length = 0;
    claimedKeys.length = 0;
    discountConsumed = false;
    const movements = [];
    for (const l of q.lines) {
      const updated = await Product.findOneAndUpdate(
        { _id: l.productId, status: 'active', stock: { $gte: l.quantity } },
        { $inc: { stock: -l.quantity } },
        { new: true, session, projection: { stock: 1 } },
      ).lean();
      if (!updated) throw conflict('OUT_OF_STOCK', 'Some items just went out of stock. Please review your cart.', { productId: l.productId });
      applied.push({ productId: l.productId, qty: l.quantity });
      movements.push({ product: l.productId, type: 'order_reserve', delta: -l.quantity, stockAfter: updated.stock, reason: orderNumber });
    }
    if (q.discount) {
      const r = await Discount.updateOne(
        { _id: q.discount.id, active: true, $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
        { $inc: { usedCount: 1 } },
        { session },
      );
      if (r.modifiedCount !== 1) throw unprocessable('DISCOUNT_INVALID', 'This discount code has reached its usage limit');
      discountConsumed = true;
      // Per-customer limit, enforced again here atomically (the quote-time count alone let
      // parallel checkouts by one shopper each see "not used yet").
      const limit = q.discount.perCustomerLimit;
      if (limit != null) {
        for (const key of redemptionKeys) {
          if (!(await claimRedemption(q.discount.id, key, limit, session))) {
            throw unprocessable('DISCOUNT_INVALID', 'You have already used this discount code');
          }
          claimedKeys.push(key);
        }
      }
    }
    const [order] = await Order.create(
      [
        {
          orderNumber,
          customer: customerId,
          idempotencyKey: input.idempotencyKey,
          accessTokenHash: sha256(accessToken),
          lang: input.lang,
          contact: input.contact,
          shippingAddress: input.shippingAddress,
          items: q.lines.map((l) => ({
            product: l.productId,
            sku: l.sku,
            model: l.model,
            slug: l.slug,
            name: l.name,
            image: l.image,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
            discount: l.discount,
            warrantyMonths: l.warrantyMonths,
          })),
          currency: q.currency,
          subtotal: q.subtotal,
          discountTotal: q.discountTotal,
          deliveryFee: q.deliveryFee,
          shippingZone: q.zone?.key ?? '',
          codFee: q.codFee,
          total: q.total,
          vatRate: q.vatRate,
          vatAmount: q.vatAmount,
          discount: q.discount ? { id: q.discount.id, code: q.discount.code } : undefined,
          paymentMethod: input.paymentMethod,
          paymentStatus: isCod ? 'cod_pending' : 'pending',
          status: isCod ? 'confirmed' : 'pending',
          reservationExpiresAt: isCod ? undefined : new Date(Date.now() + reservationMinutes * 60_000),
          delivery: { courier: settings?.commerce?.courierName ?? '', estimatedDelivery: settings?.commerce?.estimatedDelivery ?? {} },
          customerNote: input.customerNote,
          history: [
            { status: 'pending', note: 'Order placed', visibleToCustomer: true },
            ...(isCod ? [{ status: 'confirmed', note: 'Cash on delivery order confirmed', visibleToCustomer: true }] : []),
          ],
        },
      ],
      { session },
    );
    await writeMovements(movements.map((m) => ({ ...m, order: order._id })), session);
    return order;
  };

  let order;
  try {
    order = await withTx(run);
  } catch (err) {
    // Standalone MongoDB (no transactions): undo partial reservations.
    if (applied.length || discountConsumed) {
      const { supportsTransactions } = await import('../../db/connect');
      if (!(await supportsTransactions())) {
        for (const a of applied) await Product.updateOne({ _id: a.productId }, { $inc: { stock: a.qty } });
        if (discountConsumed && q.discount) await Discount.updateOne({ _id: q.discount.id }, { $inc: { usedCount: -1 } });
        if (claimedKeys.length && q.discount) {
          await DiscountRedemption.updateMany({ discount: q.discount.id, key: { $in: claimedKeys }, count: { $gt: 0 } }, { $inc: { count: -1 } });
        }
      }
    }
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (e?.code === 11000 && e.keyPattern?.idempotencyKey) {
      const again = await Order.findOne({ idempotencyKey: input.idempotencyKey }).lean();
      if (again) return { order: again, accessToken: null, replayed: true };
    }
    throw err;
  }

  if (customerId && input.saveAddress) {
    await User.updateOne(
      { _id: customerId, 'addresses.10': { $exists: false } },
      { $push: { addresses: { ...input.shippingAddress, label: '', isDefault: false } } },
    ).catch(() => undefined);
  }

  const plain = order.toObject ? order.toObject() : order;
  if (isCod) {
    void notifyOrder(plain, 'order_placed', orderLink(plain, accessToken));
    // Order confirmation email + prepared WhatsApp message (online payments: once the payment is confirmed).
    void queueOrderConfirmation(plain._id, { link: orderLink(plain, accessToken) });
  }
  return { order: plain, accessToken, replayed: false };
}

export function orderLink(order: { orderNumber: string; lang?: string | null }, accessToken?: string | null) {
  const lang = order.lang === 'en' ? 'en' : 'ar';
  return accessToken
    ? `${env.PUBLIC_SITE_URL}/${lang}/track?order=${order.orderNumber}&token=${accessToken}`
    : `${env.PUBLIC_SITE_URL}/${lang}/account/orders/${order.orderNumber}`;
}

/** Returns reserved stock to inventory exactly once (guarded by stockReleased). */
export async function releaseStock(orderId: Types.ObjectId | string, reason: string, userId?: string) {
  return withTx(async (session) => {
    const order = await Order.findOneAndUpdate({ _id: orderId, stockReleased: false }, { $set: { stockReleased: true } }, { new: true, session });
    if (!order) return false;
    const movements = [];
    for (const it of order.items) {
      const p = await Product.findOneAndUpdate({ _id: it.product }, { $inc: { stock: it.quantity } }, { new: true, session, projection: { stock: 1 } }).lean();
      if (p) movements.push({ product: it.product, type: 'order_release', delta: it.quantity, stockAfter: p.stock, reason, order: order._id, user: userId });
    }
    await writeMovements(movements, session);
    if (order.discount?.id) {
      await Discount.updateOne({ _id: order.discount.id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
      // A cancelled or expired order gives the shopper's per-customer use back (matches the quote-time count).
      const keys = identityKeys({ id: order.customer, email: order.contact?.email, phone: order.contact?.phone });
      await DiscountRedemption.updateMany({ discount: order.discount.id, key: { $in: keys }, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session });
    }
    return true;
  });
}

const eventFor: Partial<Record<OrderStatus, OrderEvent>> = {
  processing: 'processing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  returned: 'returned',
};

/** Validated status transition with side effects (stock, COD collection, notifications). */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  opts: { by?: string; note?: string; notify?: boolean; trackingNumber?: string; courier?: string; restock?: boolean; system?: boolean },
) {
  const order = await Order.findById(orderId);
  if (!order) throw notFound('Order');
  const from = order.status as OrderStatus;
  if (from === to) throw badRequest('NO_CHANGE', `Order is already ${to}`);
  if (!ORDER_TRANSITIONS[from].includes(to)) throw unprocessable('INVALID_TRANSITION', `Cannot change order from ${from} to ${to}`);

  const paidLike = ['paid', 'cod_pending', 'cod_collected'].includes(order.paymentStatus);
  if (['confirmed', 'processing', 'shipped'].includes(to) && !paidLike) {
    throw unprocessable('PAYMENT_REQUIRED', 'This order has not been paid yet');
  }

  const settings = await getSettings();
  const update: Record<string, unknown> = { status: to };
  if (to === 'shipped') {
    const tracking = opts.trackingNumber ?? order.delivery?.trackingNumber ?? '';
    const courier = opts.courier || order.delivery?.courier || settings?.commerce?.courierName || '';
    update['delivery.trackingNumber'] = tracking;
    update['delivery.courier'] = courier;
    update['delivery.trackingUrl'] = manualCourier.trackingUrl(tracking, settings?.commerce?.courierTrackingUrlTemplate ?? '');
    update['delivery.shippedAt'] = new Date();
  }
  if (to === 'delivered') {
    update['delivery.deliveredAt'] = new Date();
    if (order.paymentStatus === 'cod_pending') update.paymentStatus = 'cod_collected';
  }
  if (to === 'cancelled') update.cancelledAt = new Date();

  // Optimistic concurrency: only apply if the status is still what we validated against.
  const saved = await Order.findOneAndUpdate(
    { _id: order._id, status: from },
    { $set: update, $push: { history: { status: to, note: opts.note ?? '', by: opts.by, visibleToCustomer: true } } },
    { new: true },
  );
  if (!saved) throw conflict('CONCURRENT_UPDATE', 'The order was updated by someone else. Please reload.');

  if (to === 'cancelled' && from !== 'shipped') await releaseStock(saved._id, `Cancelled ${saved.orderNumber}`, opts.by);
  if (to === 'returned' && opts.restock !== false) {
    const movements = [];
    for (const it of saved.items) {
      const p = await Product.findOneAndUpdate({ _id: it.product }, { $inc: { stock: it.quantity } }, { new: true, projection: { stock: 1 } }).lean();
      if (p) movements.push({ product: it.product, type: 'return_restock', delta: it.quantity, stockAfter: p.stock, reason: `Returned ${saved.orderNumber}`, order: saved._id, user: opts.by });
    }
    await writeMovements(movements);
  }

  const ev = eventFor[to];
  if (ev && opts.notify !== false) void notifyOrder(saved.toObject(), ev, orderLink(saved));
  // Confirmed by staff (e.g. after a manual payment check): send the order confirmation (once per order).
  if (to === 'confirmed' && opts.notify !== false) void queueOrderConfirmation(saved._id);
  return saved.toObject();
}

/**
 * Cancels unpaid online orders whose stock reservation expired. Before cancelling, the
 * gateway is asked once more so a late payment is never lost. Called by Vercel Cron and
 * opportunistically from admin pages.
 */
export async function releaseExpiredReservations(limit = 50) {
  const { verifyOrderPayment } = await import('../payments/payment.service');
  const expired = await Order.find({
    status: 'pending',
    paymentMethod: { $ne: 'cod' },
    paymentStatus: { $in: ['pending', 'failed'] },
    reservationExpiresAt: { $lt: new Date() },
    stockReleased: false,
  })
    .limit(limit)
    .lean();
  let cancelled = 0;
  for (const o of expired) {
    try {
      const status = await verifyOrderPayment(String(o._id));
      if (status === 'paid') continue;
      const r = await Order.updateOne(
        { _id: o._id, status: 'pending', paymentStatus: { $in: ['pending', 'failed'] } },
        {
          $set: { status: 'cancelled', paymentStatus: 'expired', cancelledAt: new Date() },
          $push: { history: { status: 'cancelled', note: 'Payment was not completed in time', visibleToCustomer: true } },
        },
      );
      if (r.modifiedCount) {
        await releaseStock(o._id, `Expired ${o.orderNumber}`);
        cancelled++;
      }
    } catch (err) {
      logger.warn('Failed to expire order', { order: o.orderNumber, err: String(err) });
    }
  }
  return { checked: expired.length, cancelled };
}

/** Customer-safe order view (no internal notes, no internal history entries). */
export function toCustomerOrder(o: OrderDoc | Record<string, unknown>) {
  const order = o as OrderDoc;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    createdAt: (order as unknown as { createdAt: Date }).createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    contact: order.contact,
    shippingAddress: order.shippingAddress,
    items: order.items,
    currency: order.currency,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    discountCode: order.discount?.code ?? null,
    deliveryFee: order.deliveryFee,
    codFee: order.codFee,
    total: order.total,
    vatRate: order.vatRate,
    vatAmount: order.vatAmount,
    delivery: order.delivery,
    reservationExpiresAt: order.reservationExpiresAt,
    history: (order.history ?? []).filter((h) => h.visibleToCustomer).map((h) => ({ status: h.status, note: h.note, at: h.at })),
  };
}
