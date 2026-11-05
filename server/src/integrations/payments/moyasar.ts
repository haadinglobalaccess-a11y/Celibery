import { env } from '../../config/env';
import { integration } from '../credentials';
import { GatewayError, gatewayFetch } from './http';
import type { CredentialCheck, InitiateInput, PaymentProvider, StatusResult } from './types';

/**
 * Moyasar (Saudi gateway) adapter — hosted invoice page supporting mada, Visa, Mastercard,
 * Apple Pay and STC Pay (methods must be enabled on the merchant account).
 *
 * Credentials come from Admin → Settings → Payments (encrypted at rest) or, until an administrator
 * saves them there, from the legacy MOYASAR_* environment variables (integrations/credentials).
 *
 * STATUS: implemented against Moyasar's public REST API (v1); NOT verified against a live or
 * test account because no credentials were supplied. Verify in Moyasar test mode before launch.
 */
const BASE = 'https://api.moyasar.com/v1';

const secretKey = (values?: Record<string, string>) => (values ?? integration('moyasar').values).secretKey ?? '';
const authHeader = (key: string) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

function call<T>(path: string, init: RequestInit & { key?: string; timeoutMs?: number } = {}): Promise<T> {
  const { key, ...rest } = init;
  return gatewayFetch<T>('moyasar', BASE + path, {
    ...rest,
    headers: { Authorization: authHeader(key ?? secretKey()), 'Content-Type': 'application/json', ...((rest.headers as Record<string, string>) ?? {}) },
  });
}

type MoyasarPayment = { id: string; status: string; amount: number; refunded?: number };
type MoyasarInvoice = {
  id: string;
  status: 'initiated' | 'paid' | 'failed' | 'refunded' | 'canceled' | 'on_hold' | 'expired' | string;
  amount: number;
  currency: string;
  url: string;
  payments?: MoyasarPayment[];
};

const mapStatus = (s: string): StatusResult['status'] => {
  switch (s) {
    case 'paid':
    case 'captured':
    case 'refunded': // a refunded invoice was paid first; refunds are tracked by our ledger
      return 'paid';
    case 'authorized':
      return 'authorized';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'voided':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return 'pending';
  }
};

const captured = (inv: MoyasarInvoice) => inv.payments?.find((p) => ['paid', 'captured', 'refunded'].includes(p.status));

export const moyasarProvider: PaymentProvider = {
  name: 'moyasar',
  isConfigured: () => {
    const i = integration('moyasar');
    return i.enabled && Boolean(i.values.secretKey);
  },
  async initiate(input: InitiateInput) {
    const invoice = await call<MoyasarInvoice>('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount, // halalas
        currency: input.currency,
        description: input.description,
        success_url: input.returnUrl,
        back_url: input.cancelUrl,
        callback_url: `${env.PUBLIC_SITE_URL}/api/webhooks/moyasar`,
        metadata: { payment_id: input.paymentId, order_number: input.orderNumber },
      }),
    });
    return { providerRef: invoice.id, redirectUrl: invoice.url };
  },
  async fetchStatus(ref: string) {
    const inv = await call<MoyasarInvoice>(`/invoices/${encodeURIComponent(ref)}`);
    return { status: mapStatus(inv.status), amount: inv.amount, currency: inv.currency, capturedPaymentId: captured(inv)?.id };
  },
  async refund(ref: string, amount: number) {
    // Moyasar refunds the underlying payment of the invoice. Moyasar's public API does not document
    // an idempotency header for refunds, so uncertain outcomes are settled by fetchRefundedTotal().
    const inv = await call<MoyasarInvoice>(`/invoices/${encodeURIComponent(ref)}`);
    const p = captured(inv);
    if (!p) throw new GatewayError('moyasar', 404, true, 'No captured Moyasar payment found for this invoice');
    const res = await call<{ id: string }>(`/payments/${encodeURIComponent(p.id)}/refund`, { method: 'POST', body: JSON.stringify({ amount }) });
    return { providerRefundId: res.id ?? p.id };
  },
  async fetchRefundedTotal(ref: string) {
    const inv = await call<MoyasarInvoice>(`/invoices/${encodeURIComponent(ref)}`);
    return (inv.payments ?? []).reduce((sum, p) => sum + (Number(p.refunded) || 0), 0);
  },
  async verifyCredentials(values): Promise<CredentialCheck> {
    const key = values.secretKey ?? '';
    if (!key) return { ok: false, status: 'failed', message: 'Secret API key is missing' };
    try {
      // Read-only call: lists at most one payment. Moves no money.
      await call('/payments?per_page=1', { key, timeoutMs: 15_000 });
      return { ok: true, status: 'ok', message: `Moyasar accepted the ${key.startsWith('sk_live_') ? 'live' : 'test'} secret key` };
    } catch (e) {
      const g = e as GatewayError;
      if (g.httpStatus === 401 || g.httpStatus === 403) return { ok: false, status: 'failed', message: 'Moyasar rejected the secret key (unauthorised)' };
      return { ok: false, status: 'failed', message: `Could not reach Moyasar to verify (${g.httpStatus ?? 'network'}) — try again` };
    }
  },
};
