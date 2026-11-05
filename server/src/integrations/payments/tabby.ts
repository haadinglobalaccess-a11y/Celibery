import { integration } from '../credentials';
import { GatewayError, gatewayFetch } from './http';
import type { CredentialCheck, InitiateInput, PaymentProvider, StatusResult } from './types';

/**
 * Tabby (buy now, pay later) adapter — Checkout API v2.
 * Flow: create checkout session → redirect customer → payment becomes AUTHORIZED →
 * merchant captures → CLOSED.
 *
 * Credentials come from Admin → Settings → Payments (encrypted at rest) or, until an administrator
 * saves them there, from the legacy TABBY_* environment variables.
 *
 * STATUS: implemented against Tabby's public API docs; NOT verified with live/test credentials
 * (none supplied). Verify with Tabby test keys before launch.
 */
const BASE = 'https://api.tabby.ai/api/v2';

const vals = (values?: Record<string, string>) => values ?? integration('tabby').values;

function call<T>(path: string, init: RequestInit & { key?: string; timeoutMs?: number } = {}): Promise<T> {
  const { key, ...rest } = init;
  return gatewayFetch<T>('tabby', BASE + path, {
    ...rest,
    headers: { Authorization: `Bearer ${key ?? vals().secretKey ?? ''}`, 'Content-Type': 'application/json', ...((rest.headers as Record<string, string>) ?? {}) },
  });
}

const sar = (halalas: number) => (halalas / 100).toFixed(2);
const halalas = (amount: string | number) => Math.round(Number(amount) * 100);

const mapStatus = (s: string): StatusResult['status'] => {
  switch (s.toUpperCase()) {
    case 'AUTHORIZED':
      return 'authorized';
    case 'CLOSED':
      return 'paid';
    case 'REJECTED':
      return 'failed';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'pending';
  }
};

type TabbyPayment = { status: string; amount: string; currency: string; refunds?: { id?: string; amount: string }[]; captures?: { amount: string }[] };

export const tabbyProvider: PaymentProvider = {
  name: 'tabby',
  isConfigured: () => {
    const i = integration('tabby');
    return i.enabled && Boolean(i.values.secretKey && i.values.merchantCode);
  },
  async initiate(input: InitiateInput) {
    const session = await call<{
      status: string;
      payment: { id: string };
      configuration?: { available_products?: { installments?: { web_url: string }[] } };
    }>('/checkout', {
      method: 'POST',
      body: JSON.stringify({
        payment: {
          amount: sar(input.amount),
          currency: input.currency,
          description: input.description,
          buyer: { name: input.customer.name, email: input.customer.email, phone: input.customer.phone },
          shipping_address: { city: input.shippingAddress.city, address: `${input.shippingAddress.street}, ${input.shippingAddress.district}`, zip: input.shippingAddress.postalCode ?? '' },
          order: {
            reference_id: input.orderNumber,
            items: input.items.map((i) => ({ title: i.title, quantity: i.quantity, unit_price: sar(i.unitPrice), reference_id: i.sku, category: 'Electronics' })),
          },
        },
        lang: input.lang,
        merchant_code: vals().merchantCode,
        merchant_urls: { success: input.returnUrl, cancel: input.cancelUrl, failure: input.cancelUrl },
      }),
    });
    const url = session.configuration?.available_products?.installments?.[0]?.web_url;
    if (session.status !== 'created' || !url) throw new GatewayError('tabby', 422, true, 'Tabby is not available for this order');
    return { providerRef: session.payment.id, redirectUrl: url };
  },
  async fetchStatus(ref: string) {
    const p = await call<TabbyPayment>(`/payments/${encodeURIComponent(ref)}`);
    return { status: mapStatus(p.status), amount: halalas(p.amount), currency: p.currency };
  },
  async capture(ref: string, amount: number, opts) {
    // reference_id: Tabby uses it to recognise a repeated capture request.
    await call(`/payments/${encodeURIComponent(ref)}/captures`, { method: 'POST', body: JSON.stringify({ amount: sar(amount), reference_id: opts?.idempotencyKey }) });
    return this.fetchStatus(ref);
  },
  async refund(ref: string, amount: number, reason: string, opts) {
    const r = await call<{ id?: string; refunds?: { id?: string }[] }>(`/payments/${encodeURIComponent(ref)}/refunds`, {
      method: 'POST',
      body: JSON.stringify({ amount: sar(amount), reason, reference_id: opts?.idempotencyKey }),
    });
    return { providerRefundId: r.refunds?.[r.refunds.length - 1]?.id ?? r.id ?? opts?.idempotencyKey ?? '' };
  },
  async fetchRefundedTotal(ref: string) {
    const p = await call<TabbyPayment>(`/payments/${encodeURIComponent(ref)}`);
    return (p.refunds ?? []).reduce((sum, r) => sum + halalas(r.amount), 0);
  },
  async verifyCredentials(values): Promise<CredentialCheck> {
    const v = vals(values);
    if (!v.secretKey) return { ok: false, status: 'failed', message: 'Secret key is missing' };
    if (!v.merchantCode) return { ok: false, status: 'failed', message: 'Merchant code is missing' };
    try {
      // Read-only call (lists at most one payment). The merchant code itself can only be confirmed
      // by Tabby when the first checkout session is created.
      await call('/payments?limit=1', { key: v.secretKey, timeoutMs: 15_000 });
      return { ok: true, status: 'ok', message: 'Tabby accepted the secret key (merchant code is confirmed at the first test checkout)' };
    } catch (e) {
      const g = e as GatewayError;
      if (g.httpStatus === 401 || g.httpStatus === 403) return { ok: false, status: 'failed', message: 'Tabby rejected the secret key (unauthorised)' };
      return { ok: false, status: 'failed', message: `Could not reach Tabby to verify (${g.httpStatus ?? 'network'}) — try again` };
    }
  },
};
