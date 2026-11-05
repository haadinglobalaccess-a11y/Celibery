export type GatewayStatus = 'pending' | 'authorized' | 'paid' | 'failed' | 'cancelled' | 'expired';

export type InitiateInput = {
  paymentId: string;
  orderNumber: string;
  /** halalas */
  amount: number;
  currency: string;
  method: 'card' | 'applepay' | 'stcpay' | 'tabby';
  lang: 'ar' | 'en';
  description: string;
  returnUrl: string;
  cancelUrl: string;
  customer: { name: string; email: string; phone: string };
  shippingAddress: { city: string; street: string; district: string; postalCode?: string };
  items: { title: string; quantity: number; unitPrice: number; sku: string }[];
};

export type InitiateResult = { providerRef: string; redirectUrl: string };

export type StatusResult = {
  status: GatewayStatus;
  /** Amount reported by the gateway in halalas (used to reconcile against the order). */
  amount?: number;
  currency?: string;
  reason?: string;
  /** Gateway id of the underlying captured payment (used for refunds), when different from providerRef. */
  capturedPaymentId?: string;
};

/** Result of testing merchant credentials against the gateway API. */
export type CredentialCheck = { ok: boolean; status: 'ok' | 'failed' | 'unsupported'; message: string };

export type MoneyOpOptions = {
  /** Our stable id for the operation; passed to the gateway where it supports idempotent requests. */
  idempotencyKey?: string;
};

export interface PaymentProvider {
  readonly name: 'sandbox' | 'moyasar' | 'tabby';
  isConfigured(): boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Fetches the authoritative status from the gateway (never trust the browser). */
  fetchStatus(providerRef: string): Promise<StatusResult>;
  /** Some gateways (Tabby) authorise first and require an explicit capture. */
  capture?(providerRef: string, amount: number, opts?: MoneyOpOptions): Promise<StatusResult>;
  /**
   * Refunds part or all of a captured payment. Errors are GatewayError: `definitive: true` means the
   * gateway certainly did not refund; anything else must be reconciled (refund.service.ts).
   */
  refund?(providerRef: string, amount: number, reason: string, opts?: MoneyOpOptions): Promise<{ providerRefundId: string }>;
  /** Total refunded so far according to the gateway (halalas) — used to reconcile uncertain refunds. */
  fetchRefundedTotal?(providerRef: string): Promise<number>;
  /** Tests merchant credentials (values of the integration's fields) without moving money. */
  verifyCredentials(values: Record<string, string>): Promise<CredentialCheck>;
}
