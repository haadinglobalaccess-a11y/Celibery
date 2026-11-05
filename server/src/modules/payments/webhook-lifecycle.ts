/**
 * Webhook event lifecycle — pure decision rules (unit tested without a database).
 *
 *   (new) ──claim──▶ processing ──ok──▶ processed            (replays answered 200 "duplicate")
 *                        │
 *                        ├──error──▶ failed                    (retry allowed: provider re-delivers)
 *                        ├──no matching payment──▶ ignored     (retry allowed on re-delivery)
 *                        └──lease expired (crash/timeout)──▶ claimable again
 *
 * An event is only "processed" after its handler finished successfully, so a crash or error never
 * turns a provider's retry into a silently ignored duplicate. Events whose signature fails are
 * rejected before any record is created.
 */
export const WEBHOOK_STATUSES = ['processing', 'processed', 'failed', 'ignored'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

/** How long a delivery may hold the processing lease before another delivery may take over. */
export const WEBHOOK_LEASE_MS = 60_000;
/** After this many failed attempts the event stays failed for staff review (provider retries stop mattering). */
export const WEBHOOK_MAX_ATTEMPTS = 12;

export type ExistingEvent = { status?: WebhookStatus | null; lockedUntil?: Date | null; attempts?: number | null };

export type ClaimDecision = 'claim' | 'duplicate' | 'in_progress' | 'give_up';

/**
 * Decides what a new delivery of an already-recorded event should do. Records created before this
 * lifecycle existed have no status: they were only written after successful processing… or before
 * a failure that deleted them, so a surviving legacy record means "processed".
 */
export function claimDecision(existing: ExistingEvent, now: Date): ClaimDecision {
  const status = existing.status ?? 'processed';
  if (status === 'processed') return 'duplicate';
  if ((existing.attempts ?? 0) >= WEBHOOK_MAX_ATTEMPTS) return 'give_up';
  if (status === 'processing') {
    return existing.lockedUntil && existing.lockedUntil.getTime() > now.getTime() ? 'in_progress' : 'claim';
  }
  return 'claim'; // failed or ignored → try again
}

/** HTTP answer for each decision. Non-2xx makes the provider retry later. */
export function responseFor(decision: Exclude<ClaimDecision, 'claim'>): { status: number; body: Record<string, unknown> } {
  switch (decision) {
    case 'duplicate':
      return { status: 200, body: { duplicate: true } };
    case 'in_progress':
      return { status: 409, body: { inProgress: true } };
    case 'give_up':
      return { status: 200, body: { failed: true, reason: 'max_attempts' } };
  }
}

/** Short, secret-free error text stored on the event record. */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/(sk|pk)_(test|live)_[A-Za-z0-9]+/g, '$1_$2_[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}
