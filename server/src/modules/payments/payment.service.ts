import { env } from '../../config/env';
import { badRequest, notFound, serviceUnavailable, unprocessable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { notifyOrder } from '../../integrations/notifications';
import { integration, loadIntegrations } from '../../integrations/credentials';
import { effectiveCardGateway, providerByName, providerFor, sandboxAllowed, type OnlineMethod } from '../../integrations/payments';
import { moyasarProvider } from '../../integrations/payments/moyasar';
import { tabbyProvider } from '../../integrations/payments/tabby';
import type { StatusResult } from '../../integrations/payments/types';
import { Order, Payment, getSettings, type SettingsDoc } from '../../models';
import { orderLink } from '../orders/order.service';

/** Which payment methods can be offered right now (settings flag AND a working provider). */
export function availablePaymentMethods(settings: SettingsDoc) {
  const flags = settings?.payments ?? {};
  const has = (m: OnlineMethod) => Boolean(providerFor(m));
  const total = (key: string) => flags[key] !== false;
  const card = effectiveCardGateway();
  return {
    card: total('card') && has('card'), // mada, Visa, Mastercard
    applepay: total('applepay') && has('applepay'),
    stcpay: total('stcpay') && has('stcpay'),
    tabby: total('tabby') && has('tabby'),
    cod: Boolean(settings?.commerce?.codEnabled),
    gateway: card,
    sandbox: card === 'sandbox' && sandboxAllowed(),
  };
}

/** Status of each payment integration for the admin (never includes secret values). */
export function gatewayDiagnostics() {
  const m = integration('moyasar');
  const t = integration('tabby');
  return {
    cardGateway: effectiveCardGateway(),
    sandboxAllowed: sandboxAllowed(),
    moyasarConfigured: moyasarProvider.isConfigured(),
    moyasarWebhookSecretSet: Boolean(m.values.webhookSecret),
    moyasarSource: m.source,
    moyasarMode: m.mode,
    tabbyConfigured: tabbyProvider.isConfigured(),
    tabbyWebhookSecretSet: Boolean(t.values.webhookSecret),
    tabbySource: t.source,
    tabbyMode: t.mode,
  };
}

type PayableOrder = {
  _id: unknown;
  orderNumber: string;
  lang?: string | null;
  total: number;
  currency?: string | null;
  paymentMethod: string;
  contact: { name: string; email: string; phone: string };
  shippingAddress: { city: string; street: string; district: string; postalCode?: string | null };
  items: { name: { ar?: string | null; en?: string | null }; quantity: number; unitPrice: number; sku: string }[];
};

/** Starts a payment with the gateway and returns the hosted-page URL to redirect to. */
export async function initiatePayment(order: PayableOrder, accessToken: string | null) {
  await loadIntegrations();
  const method = order.paymentMethod as OnlineMethod;
  const provider = providerFor(method);
  if (!provider) throw serviceUnavailable('PAYMENT_UNAVAILABLE', 'Online payment is not configured');
  const lang = order.lang === 'en' ? 'en' : 'ar';
  const payment = await Payment.create({ order: order._id, provider: provider.name, method, amount: order.total, currency: order.currency ?? 'SAR', status: 'initiated' });
  const base = `${env.PUBLIC_SITE_URL}/${lang}/checkout/return?order=${order.orderNumber}&payment=${payment._id}${accessToken ? `&token=${accessToken}` : ''}`;
  try {
    const res = await provider.initiate({
      paymentId: String(payment._id),
      orderNumber: order.orderNumber,
      amount: order.total,
      currency: order.currency ?? 'SAR',
      method,
      lang,
      description: `CELIBERY order ${order.orderNumber}`,
      returnUrl: base,
      cancelUrl: base + '&cancelled=1',
      customer: order.contact,
      shippingAddress: { ...order.shippingAddress, postalCode: order.shippingAddress.postalCode ?? '' },
      items: order.items.map((i) => ({ title: (lang === 'ar' ? i.name.ar : i.name.en) || i.name.en || i.sku, quantity: i.quantity, unitPrice: i.unitPrice, sku: i.sku })),
    });
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { providerRef: res.providerRef, redirectUrl: res.redirectUrl, status: 'pending' }, $push: { events: { type: 'initiated', source: 'server', status: 'pending' } } },
    );
    return { paymentId: String(payment._id), redirectUrl: res.redirectUrl };
  } catch (err) {
    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'failed', failureReason: String((err as Error).message).slice(0, 300) } });
    logger.warn('Payment initiation failed', { order: order.orderNumber, err: String(err) });
    throw err instanceof Error && 'status' in err ? err : serviceUnavailable('PAYMENT_UNAVAILABLE', 'Could not start the payment. Please try again.');
  }
}

/** Payment statuses from which a gateway "paid" may still be applied (late success included). */
const PAYABLE_PAYMENT_STATUSES = ['initiated', 'pending', 'authorized', 'failed', 'cancelled', 'expired'];

/**
 * Applies an authoritative gateway status to our records. Idempotent: running it twice for the
 * same payment never double-confirms an order, captures twice or sends duplicate notifications,
 * and it never moves a refunded payment back to "paid".
 */
export async function applyGatewayStatus(paymentId: string, result: StatusResult, source: string) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw notFound('Payment');
  if (['paid', 'refunded', 'partially_refunded'].includes(payment.status)) return 'paid';
  const provider = providerByName(payment.provider);

  // Authorise-then-capture gateways (Tabby, sandbox-tabby): capture exactly once.
  if (result.status === 'authorized' && provider?.capture && payment.providerRef) {
    const claim = await Payment.updateOne({ _id: payment._id, captureRequestedAt: { $exists: false } }, { $set: { captureRequestedAt: new Date(), status: 'authorized' } });
    if (claim.modifiedCount === 1) {
      try {
        result = await provider.capture(payment.providerRef, payment.amount, { idempotencyKey: `cap_${payment._id}` });
      } catch (err) {
        // Uncertain capture: release the claim only if the gateway definitely did nothing.
        if ((err as { definitive?: boolean }).definitive) await Payment.updateOne({ _id: payment._id }, { $unset: { captureRequestedAt: 1 } });
        throw err;
      }
    } else {
      result = await provider.fetchStatus(payment.providerRef);
    }
  }

  await Payment.updateOne({ _id: payment._id }, { $push: { events: { type: 'status', source, status: result.status } } });

  if (result.status === 'paid') {
    // Reconcile amount and currency with what we charged.
    if ((result.amount !== undefined && result.amount !== payment.amount) || (result.currency && result.currency !== payment.currency)) {
      await Payment.updateOne({ _id: payment._id }, { $set: { failureReason: `AMOUNT_MISMATCH gateway=${result.amount} ${result.currency}` } });
      await Order.updateOne({ _id: payment.order }, { $push: { history: { status: 'payment_review', note: 'Gateway amount did not match the order total — manual review required', visibleToCustomer: false } } });
      logger.error('Payment amount mismatch', { paymentId, expected: payment.amount, got: result.amount });
      return 'review';
    }
    const changed = await Payment.updateOne({ _id: payment._id, status: { $in: PAYABLE_PAYMENT_STATUSES } }, { $set: { status: 'paid' } });
    if (changed.modifiedCount === 0) return 'paid'; // already processed

    const confirmed = await Order.findOneAndUpdate(
      { _id: payment.order, status: 'pending', paymentStatus: { $in: ['pending', 'failed'] } },
      {
        $set: { paymentStatus: 'paid', status: 'confirmed', paidAt: new Date() },
        $unset: { reservationExpiresAt: 1 },
        $push: { history: { $each: [{ status: 'paid', note: 'Payment confirmed', visibleToCustomer: true }, { status: 'confirmed', note: '', visibleToCustomer: true }] } },
      },
      { new: true },
    );
    if (confirmed) {
      void notifyOrder(confirmed.toObject(), 'payment_confirmed', orderLink(confirmed));
    } else {
      // Paid after the order was cancelled/expired: keep the money visible and flag for staff.
      // (Never touches an order whose payment was already recorded or refunded.)
      await Order.updateOne(
        { _id: payment.order, paymentStatus: { $in: ['pending', 'failed', 'expired'] } },
        {
          $set: { paymentStatus: 'paid', paidAt: new Date() },
          $push: { history: { status: 'payment_review', note: 'Payment received after the order was cancelled — refund or restore the order', visibleToCustomer: false } },
        },
      );
    }
    return 'paid';
  }

  if (['failed', 'cancelled', 'expired'].includes(result.status)) {
    await Payment.updateOne({ _id: payment._id, status: { $in: ['initiated', 'pending', 'authorized'] } }, { $set: { status: result.status, failureReason: result.reason ?? '' } });
    await Order.updateOne({ _id: payment.order, paymentStatus: 'pending' }, { $set: { paymentStatus: 'failed' } });
    return 'failed';
  }
  return 'pending';
}

export async function verifyPayment(paymentId: string) {
  await loadIntegrations();
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw notFound('Payment');
  if (['paid', 'refunded', 'partially_refunded'].includes(payment.status)) return 'paid';
  if (!payment.providerRef) return 'failed';
  const provider = providerByName(payment.provider);
  if (!provider) throw serviceUnavailable('PAYMENT_UNAVAILABLE', 'Payment provider unavailable');
  const status = await provider.fetchStatus(payment.providerRef);
  return applyGatewayStatus(paymentId, status, 'verify');
}

/** Verifies the most recent payment of an order; returns the order's resulting payment status. */
export async function verifyOrderPayment(orderId: string) {
  const payment = await Payment.findOne({ order: orderId, provider: { $ne: 'cod' } }).sort({ createdAt: -1 }).lean();
  if (payment && payment.providerRef && !['paid', 'refunded', 'partially_refunded'].includes(payment.status)) {
    try {
      await verifyPayment(String(payment._id));
    } catch (err) {
      logger.warn('Payment verification failed', { orderId, err: String(err) });
    }
  }
  const o = await Order.findById(orderId).select('paymentStatus').lean();
  return o?.paymentStatus ?? 'pending';
}

export async function retryPayment(orderId: string, accessToken: string | null) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw notFound('Order');
  if (order.paymentMethod === 'cod') throw badRequest('NOT_ONLINE', 'This order is paid on delivery');
  if (order.status !== 'pending' || !['pending', 'failed'].includes(order.paymentStatus)) throw unprocessable('NOT_PAYABLE', 'This order can no longer be paid');
  if (order.reservationExpiresAt && order.reservationExpiresAt < new Date()) throw unprocessable('RESERVATION_EXPIRED', 'This order expired. Please place a new order.');
  const status = await verifyOrderPayment(orderId);
  if (status === 'paid') return { paid: true as const };
  const res = await initiatePayment(order, accessToken);
  return { paid: false as const, ...res };
}

// Refunds live in refund.service.ts (ledger, reservation, reconciliation). Re-exported for
// existing imports.
export { refundOrder, reconcilePayment, reconcileOpenRefunds, resolveRefundManually } from './refund.service';

export async function cachedSettings() {
  return getSettings();
}
