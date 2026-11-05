import { Schema, model, models } from 'mongoose';
import { env } from '../../config/env';
import { randomToken } from '../../lib/tokens';
import { GatewayError } from './http';
import type { InitiateInput, PaymentProvider, StatusResult } from './types';

/**
 * Development / test gateway. It behaves like a hosted payment page: the customer is
 * redirected to /sandbox-pay/:ref, chooses an outcome, and the server later fetches the
 * status from this "gateway" store — exactly the same verification path as a real gateway.
 * It is refused in production unless ALLOW_SANDBOX_PAYMENTS=true (see env.ts).
 */
const SandboxPaymentSchema = new Schema(
  {
    ref: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    method: { type: String, required: true },
    status: { type: String, enum: ['pending', 'authorized', 'paid', 'failed', 'cancelled', 'expired'], default: 'pending' },
    refunded: { type: Number, default: 0 },
    returnUrl: { type: String, required: true },
    cancelUrl: { type: String, required: true },
    orderNumber: { type: String, required: true },
  },
  { timestamps: true },
);
export const SandboxPayment = models.SandboxPayment || model('SandboxPayment', SandboxPaymentSchema);

export const sandboxProvider: PaymentProvider & { refund: NonNullable<PaymentProvider['refund']> } = {
  name: 'sandbox',
  isConfigured: () => true,
  async initiate(input: InitiateInput) {
    const ref = 'sbx_' + randomToken(12);
    await SandboxPayment.create({
      ref,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      orderNumber: input.orderNumber,
    });
    return { providerRef: ref, redirectUrl: `${env.PUBLIC_SITE_URL}/${input.lang}/sandbox-pay/${ref}` };
  },
  async fetchStatus(ref: string): Promise<StatusResult> {
    const p = await SandboxPayment.findOne({ ref }).lean<{ status: StatusResult['status']; amount: number; currency: string }>();
    if (!p) return { status: 'failed', reason: 'Unknown sandbox payment' };
    return { status: p.status, amount: p.amount, currency: p.currency };
  },
  async capture(ref: string) {
    await SandboxPayment.updateOne({ ref, status: 'authorized' }, { $set: { status: 'paid' } });
    return this.fetchStatus(ref);
  },
  async refund(ref: string, amount: number) {
    // Like a real gateway: refusing more than was captured is a definitive failure.
    const r = await SandboxPayment.updateOne({ ref, $expr: { $lte: [{ $add: ['$refunded', amount] }, '$amount'] } }, { $inc: { refunded: amount } });
    if (r.modifiedCount !== 1) throw new GatewayError('sandbox', 422, true, 'Refund exceeds the captured amount');
    return { providerRefundId: 'sbx_rf_' + randomToken(8) };
  },
  async fetchRefundedTotal(ref: string) {
    const p = await SandboxPayment.findOne({ ref }).lean<{ refunded?: number }>();
    return p?.refunded ?? 0;
  },
  async verifyCredentials() {
    return { ok: true, status: 'ok' as const, message: 'Sandbox gateway (development only)' };
  },
};
