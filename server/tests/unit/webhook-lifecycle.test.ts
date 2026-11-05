import { describe, expect, it } from 'vitest';
import { claimDecision, responseFor, sanitizeError, WEBHOOK_LEASE_MS, WEBHOOK_MAX_ATTEMPTS } from '../../src/modules/payments/webhook-lifecycle';

const now = new Date('2026-11-03T10:00:00Z');

describe('webhook event lifecycle', () => {
  it('treats processed events (and legacy records without status) as duplicates', () => {
    expect(claimDecision({ status: 'processed' }, now)).toBe('duplicate');
    expect(claimDecision({}, now)).toBe('duplicate');
  });
  it('lets a provider retry re-process a failed or ignored event', () => {
    expect(claimDecision({ status: 'failed', attempts: 1 }, now)).toBe('claim');
    expect(claimDecision({ status: 'ignored', attempts: 1 }, now)).toBe('claim');
  });
  it('does not run two deliveries concurrently, but recovers from a crashed one', () => {
    const lockedFuture = new Date(now.getTime() + 10_000);
    const lockedPast = new Date(now.getTime() - 1);
    expect(claimDecision({ status: 'processing', lockedUntil: lockedFuture, attempts: 1 }, now)).toBe('in_progress');
    expect(claimDecision({ status: 'processing', lockedUntil: lockedPast, attempts: 1 }, now)).toBe('claim');
    expect(WEBHOOK_LEASE_MS).toBeGreaterThanOrEqual(30_000);
  });
  it('stops after the maximum number of attempts', () => {
    expect(claimDecision({ status: 'failed', attempts: WEBHOOK_MAX_ATTEMPTS }, now)).toBe('give_up');
  });
  it('answers duplicates with 200 and in-progress with a retryable status', () => {
    expect(responseFor('duplicate').status).toBe(200);
    expect(responseFor('in_progress').status).toBeGreaterThanOrEqual(400);
  });
  it('never stores secrets in error text', () => {
    const msg = sanitizeError(new Error('Moyasar failed with key sk_live_ABCDEF123 and Bearer abc.def.ghi'));
    expect(msg).not.toContain('ABCDEF123');
    expect(msg).not.toContain('abc.def.ghi');
  });
});
