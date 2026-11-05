/**
 * Refund lifecycle rules — pure functions, no database access, unit tested in isolation.
 *
 *   requested ──reserve──▶ reserved ──call gateway──▶ processing ──▶ succeeded
 *       │                     │                          │
 *       └──▶ failed ◀─────────┘ (validation / definitive  ├──▶ failed  (gateway definitively refused:
 *                                gateway refusal)         │            reservation released)
 *                                                         └──▶ reconciliation_required
 *                                                              (timeout / network / 5xx, or the gateway
 *                                                               succeeded but our database write failed:
 *                                                               the reservation is KEPT until reconciled)
 *
 * Money rules:
 *  - Order.refundReservedAmount holds in-flight refunds so concurrent requests can never exceed
 *    the amount paid (refunded + reserved + new ≤ total, checked atomically).
 *  - Order.refundedAmount / Payment.refundedAmount only grow when the gateway confirmed the refund.
 *  - A reservation is released only when the gateway has certainly NOT refunded.
 */
export const REFUND_STATUSES = ['requested', 'reserved', 'processing', 'succeeded', 'failed', 'reconciliation_required'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  requested: ['reserved', 'failed'],
  reserved: ['processing', 'failed'],
  processing: ['succeeded', 'failed', 'reconciliation_required'],
  reconciliation_required: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};

export function canTransition(from: RefundStatus, to: RefundStatus): boolean {
  return REFUND_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Refunds whose reservation is still held (counted against the refundable balance). */
export const HOLDS_RESERVATION: RefundStatus[] = ['reserved', 'processing', 'reconciliation_required'];
export const isOpen = (s: RefundStatus) => HOLDS_RESERVATION.includes(s) || s === 'requested';

/** Maximum amount that can still be refunded. */
export function refundableBalance(o: { total: number; refundedAmount?: number | null; refundReservedAmount?: number | null }): number {
  return Math.max(0, o.total - (o.refundedAmount ?? 0) - (o.refundReservedAmount ?? 0));
}

export function validateRefundAmount(amount: number, o: { total: number; refundedAmount?: number | null; refundReservedAmount?: number | null }): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'INVALID_AMOUNT';
  if (amount > refundableBalance(o)) return 'REFUND_TOO_LARGE';
  return null;
}

/** What to do after the gateway call threw. */
export function outcomeForGatewayError(err: { definitive?: boolean } | unknown): 'failed' | 'reconciliation_required' {
  const definitive = Boolean(err && typeof err === 'object' && (err as { definitive?: boolean }).definitive === true);
  return definitive ? 'failed' : 'reconciliation_required';
}

export type ReconcileInput = {
  /** Total refunded according to the gateway, for this payment (halalas). */
  gatewayRefunded: number;
  /** Total of refunds we already recorded as succeeded for this payment. */
  confirmedRefunded: number;
  /** Open refunds for this payment (oldest first), each with its amount. */
  unresolved: { id: string; amount: number }[];
};

export type ReconcileDecision = { succeeded: string[]; failed: string[]; manual: string[]; note: string };

/**
 * Matches the gateway's refunded total against our ledger. Unexplained differences are never
 * guessed: they are left for a person to resolve (manual), with a note.
 *  - difference 0                         → no open refund reached the gateway → all failed;
 *  - difference equals a prefix sum       → those (oldest-first) succeeded, the rest failed;
 *  - difference equals another subset sum → only when exactly one subset matches;
 *  - anything else (negative, too large, ambiguous) → manual.
 */
export function decideReconciliation(input: ReconcileInput): ReconcileDecision {
  const diff = input.gatewayRefunded - input.confirmedRefunded;
  const ids = input.unresolved.map((u) => u.id);
  if (!input.unresolved.length) return { succeeded: [], failed: [], manual: [], note: diff === 0 ? 'Nothing to reconcile' : `Gateway shows ${diff} more than recorded, with no open refund` };
  if (diff < 0) return { succeeded: [], failed: [], manual: ids, note: 'Gateway reports less refunded than our confirmed ledger — check the gateway dashboard' };
  if (diff === 0) return { succeeded: [], failed: ids, manual: [], note: 'Gateway shows no additional refund — open refunds did not happen' };

  const n = input.unresolved.length;
  if (n > 12) return { succeeded: [], failed: [], manual: ids, note: 'Too many open refunds to match automatically' };
  const matches: number[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += input.unresolved[i].amount;
    if (sum === diff) matches.push(mask);
    if (matches.length > 1) break;
  }
  if (matches.length !== 1) {
    return { succeeded: [], failed: [], manual: ids, note: matches.length ? 'Several combinations of open refunds match the gateway total — resolve manually' : 'Gateway total does not match any combination of open refunds — resolve manually' };
  }
  const mask = matches[0];
  const succeeded = ids.filter((_, i) => mask & (1 << i));
  const failed = ids.filter((_, i) => !(mask & (1 << i)));
  return { succeeded, failed, manual: [], note: 'Matched gateway refunded total' };
}

/** Order payment status derived from stored totals (so out-of-order completions agree). */
export function derivedPaymentStatus(o: { total: number; refundedAmount: number; current: string }): string {
  if (o.refundedAmount <= 0) return o.current;
  return o.refundedAmount >= o.total ? 'refunded' : 'partially_refunded';
}
