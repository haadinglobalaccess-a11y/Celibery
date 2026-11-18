import type { Dict } from '../i18n/strings';
import { ApiError } from './api';
import { formatPrice } from './format';
import type { Lang, Quote } from './types';

/**
 * Customer-facing text for an API error, in the page language — the ONE place storefront errors
 * are worded. The server's `message` is English, so it is never shown on Arabic pages: known error
 * codes have their own translation; an unknown code falls back to the server's message in English
 * and to a generic message in Arabic (never a mixed-language page).
 */
export function errorText(err: unknown, t: Dict, lang: Lang): string {
  const e = t.errors;
  const fallback = (msg?: string) => (lang === 'en' && msg ? msg : e.generic);
  if (!(err instanceof ApiError)) return fallback(err instanceof Error ? err.message : undefined);
  const reason = (err.details as { reason?: string } | undefined)?.reason;
  switch (err.code) {
    case 'NETWORK':
      return e.network;
    case 'DATABASE_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return err.status >= 500 ? e.unavailable : e.generic;
    case 'RATE_LIMITED':
    case 'ACCOUNT_LOCKED':
      return err.code === 'ACCOUNT_LOCKED' ? e.locked : e.rateLimited;
    case 'VALIDATION_ERROR':
    case 'INVALID_INPUT':
    case 'BAD_JSON':
      return e.validation;
    case 'NOT_FOUND':
      return e.notFound;
    case 'UNAUTHORIZED':
      return reason === 'invalid' ? e.invalidLogin : reason === 'locked' ? e.locked : reason === 'disabled' ? e.disabled : e.signInRequired;
    case 'FORBIDDEN':
      return e.forbidden;
    case 'MFA_REQUIRED':
    case 'MFA_ENROLLMENT_REQUIRED':
      return e.staffAccount;
    case 'EMAIL_IN_USE':
      return e.emailInUse;
    case 'INVALID_TOKEN':
      return e.invalidLink;
    case 'WRONG_PASSWORD':
      return e.wrongPassword;
    case 'ADDRESS_LIMIT':
      return e.addressLimit;
    case 'CART_CHANGED':
    case 'OUT_OF_STOCK':
      return t.cart.changed;
    case 'DISCOUNT_INVALID':
      return e.discount.invalid;
    case 'COD_UNAVAILABLE':
      return e.codUnavailable;
    case 'PAYMENT_UNAVAILABLE':
      return e.paymentUnavailable;
    case 'PAYMENT_METHOD_UNAVAILABLE':
      return e.paymentMethodUnavailable;
    case 'SHIPPING_PAUSED':
      return t.checkout.shippingPaused;
    case 'SHIPPING_CITY_UNAVAILABLE':
      return t.checkout.cityUnavailable;
    case 'TOO_MANY_OPEN_ORDERS':
      return e.tooManyCodOrders;
    case 'IDEMPOTENCY_CONFLICT':
      return e.duplicateRequest;
    case 'RESERVATION_EXPIRED':
      return t.ret.expired;
    case 'NOT_PAYABLE':
      return e.notPayable;
    case 'INVALID_TOTAL':
      return e.invalidTotal;
    case 'CONCURRENT_UPDATE':
      return e.updatedElsewhere;
    case 'ALREADY_REVIEWED':
      return t.reviews.already;
    case 'NOT_VERIFIED_PURCHASE':
      return t.reviews.notVerified;
    case 'RETURN_NOT_ALLOWED':
      return reason === 'window_closed'
        ? t.returns.closed
        : reason === 'nothing_left'
          ? t.returns.allRequested
          : reason === 'not_delivered'
            ? e.returnNotDelivered
            : t.returns.unavailable;
    case 'RETURN_QUANTITY':
      return e.returnQuantity;
    case 'RETURN_ITEM_INVALID':
      return e.returnItem;
    case 'INVALID_TRANSITION':
      return e.returnClosed;
  }
  return fallback(err.message);
}

/** The discount problem shown under the code field (quote.discountErrorCode from the server). */
export function discountErrorText(q: Pick<Quote, 'discountError' | 'discountErrorCode' | 'discountMinOrder'>, t: Dict, lang: Lang): string | null {
  if (!q.discountError) return null;
  const d = t.errors.discount;
  switch (q.discountErrorCode) {
    case 'not_active':
      return d.notActive;
    case 'expired':
      return d.expired;
    case 'usage_limit':
      return d.usageLimit;
    case 'min_order':
      // The minimum is a SAR rule of the order itself, so it is stated in SAR.
      return d.minOrder(formatPrice(q.discountMinOrder ?? 0, lang));
    case 'already_used':
      return d.alreadyUsed;
    case 'not_applicable':
      return d.notApplicable;
    case 'invalid':
      return d.invalid;
  }
  return lang === 'en' ? q.discountError : d.invalid;
}
