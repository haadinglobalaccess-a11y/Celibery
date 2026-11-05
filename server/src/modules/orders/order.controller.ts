import type { Request, Response } from 'express';
import { forbidden, notFound } from '../../lib/errors';
import { ok } from '../../lib/http';
import { safeEqual, sha256 } from '../../lib/tokens';
import { normalizeSaudiPhone } from '../../integrations/notifications';
import { Order, getSettings } from '../../models';
import { q } from '../../middleware/validate';
import { availablePaymentMethods, initiatePayment, retryPayment, verifyOrderPayment } from '../payments/payment.service';
import * as svc from './order.service';
import { trackSchema } from './order.schemas';

export async function checkoutOptions(_req: Request, res: Response) {
  const s = await getSettings();
  return ok(res, {
    paymentMethods: availablePaymentMethods(s),
    freeDelivery: s?.commerce?.freeDelivery ?? true,
    deliveryFee: s?.commerce?.freeDelivery ? 0 : (s?.commerce?.deliveryFee ?? 0),
    freeDeliveryThreshold: s?.commerce?.freeDelivery ? null : (s?.commerce?.freeDeliveryThreshold ?? null),
    shippingAvailable: s?.commerce?.shippingAvailable !== false,
    shippingUnavailableMessage: s?.commerce?.shippingUnavailableMessage ?? { ar: '', en: '' },
    codMinOrderTotal: s?.commerce?.codMinOrderTotal ?? null,
    codCitiesLimited: (s?.commerce?.codAllowedCities ?? []).length > 0,
    courier: s?.commerce?.courierName ?? '',
    estimatedDelivery: s?.commerce?.estimatedDelivery ?? { ar: '', en: '' },
    codFee: s?.commerce?.codFee ?? 0,
    codMaxOrderTotal: s?.commerce?.codMaxOrderTotal ?? null,
  });
}

export async function quote(req: Request, res: Response) {
  const customerId = req.user?.type === 'customer' ? req.user.id : undefined;
  const result = await svc.quote(req.body.items, {
    discountCode: req.body.discountCode || undefined,
    paymentMethod: req.body.paymentMethod,
    customerId,
    email: req.body.email ?? req.user?.email,
    city: req.body.city,
  });
  return ok(res, result);
}

export async function checkout(req: Request, res: Response) {
  const customerId = req.user?.type === 'customer' ? req.user.id : undefined;
  const { order, accessToken, replayed } = await svc.createOrder(req.body, customerId);
  const view = svc.toCustomerOrder(order);
  if (order.paymentMethod === 'cod' || replayed) {
    return ok(res, { order: view, accessToken, replayed, redirectUrl: null }, replayed ? 200 : 201);
  }
  try {
    const pay = await initiatePayment(order, accessToken);
    return ok(res, { order: view, accessToken, replayed, redirectUrl: pay.redirectUrl, paymentId: pay.paymentId }, 201);
  } catch (err) {
    // The order exists and holds stock; the customer can retry payment from the order page.
    return ok(res, { order: view, accessToken, replayed, redirectUrl: null, paymentError: (err as Error).message }, 201);
  }
}

/** Grants access to an order for its owner, a holder of the guest access token, or staff. */
async function loadAccessibleOrder(req: Request, orderNumber: string, token?: string) {
  const order = await Order.findOne({ orderNumber }).select('+accessTokenHash').lean();
  if (!order) throw notFound('Order');
  const owner = req.user?.type === 'customer' && order.customer && String(order.customer) === req.user.id;
  const staff = req.user?.type === 'staff' && req.user.permissions.has('orders:read');
  const tokenOk = Boolean(token) && safeEqual(sha256(token!), order.accessTokenHash);
  if (!owner && !staff && !tokenOk) throw notFound('Order'); // do not reveal existence
  return order;
}

export async function verifyPayment(req: Request, res: Response) {
  const order = await loadAccessibleOrder(req, req.params.orderNumber, req.body?.token);
  await verifyOrderPayment(String(order._id));
  const fresh = await Order.findById(order._id).lean();
  return ok(res, svc.toCustomerOrder(fresh!));
}

export async function retry(req: Request, res: Response) {
  const order = await loadAccessibleOrder(req, req.params.orderNumber, req.body?.token);
  const result = await retryPayment(String(order._id), req.body?.token ?? null);
  return ok(res, result);
}

export async function getOrder(req: Request, res: Response) {
  const order = await loadAccessibleOrder(req, req.params.orderNumber, (req.query.token as string) || undefined);
  return ok(res, svc.toCustomerOrder(order));
}

/** Public tracking by order number + token (full view) or + phone (limited view, no personal data). */
export async function track(req: Request, res: Response) {
  const input = q(req, trackSchema);
  const order = await Order.findOne({ orderNumber: input.orderNumber }).select('+accessTokenHash').lean();
  if (!order) throw notFound('Order');
  if (input.token && safeEqual(sha256(input.token), order.accessTokenHash)) return ok(res, { full: true, order: svc.toCustomerOrder(order) });
  if (input.phone && normalizeSaudiPhone(input.phone) === normalizeSaudiPhone(order.contact.phone)) {
    const v = svc.toCustomerOrder(order);
    return ok(res, {
      full: false,
      order: {
        orderNumber: v.orderNumber,
        createdAt: v.createdAt,
        status: v.status,
        paymentStatus: v.paymentStatus,
        total: v.total,
        items: v.items.map((i) => ({ name: i.name, quantity: i.quantity, image: i.image })),
        delivery: { courier: v.delivery?.courier, trackingNumber: v.delivery?.trackingNumber, trackingUrl: v.delivery?.trackingUrl, shippedAt: v.delivery?.shippedAt, deliveredAt: v.delivery?.deliveredAt },
        history: v.history,
      },
    });
  }
  throw notFound('Order');
}

export async function myOrders(req: Request, res: Response) {
  if (req.user?.type !== 'customer') throw forbidden();
  const orders = await Order.find({ customer: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, orders.map(svc.toCustomerOrder));
}
