import type { Request } from 'express';
import { logger } from './logger';

/**
 * Structured security events (one JSON line each, `"security": true`), for the host's log drain,
 * alerting and incident investigation. Never include passwords, tokens, codes or cookies — the
 * logger redacts secret-looking keys as a second line of defence (lib/redact.ts).
 *
 * Suggested alerts (CELIBERY_PRODUCTION_SECURITY_CHECKLIST.md): many `auth.login_failed` from one
 * IP, any `auth.account_locked` for staff, `authz.denied` bursts, `webhook.bad_signature`,
 * `mfa.disabled`, `mfa.reset_by_admin`.
 */
export type SecurityEvent =
  | 'auth.login_failed'
  | 'auth.login_success'
  | 'auth.account_locked'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.session_rejected'
  | 'mfa.challenge_failed'
  | 'mfa.challenge_passed'
  | 'mfa.enabled'
  | 'mfa.disabled'
  | 'mfa.recovery_code_used'
  | 'mfa.reset_by_admin'
  | 'mfa.enrollment_required'
  | 'authz.denied'
  | 'rate_limit.exceeded'
  | 'rate_limit.store_unavailable'
  | 'webhook.bad_signature'
  | 'cron.bad_secret'
  | 'staff.privilege_blocked';

/** Masks the local part of an email address ("ab***@example.com") so logs stay useful but not a customer list. */
export function maskEmail(email: string | undefined | null): string {
  if (!email) return '';
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

export function securityEvent(event: SecurityEvent, req: Request | null, meta: Record<string, unknown> = {}) {
  const level = event.startsWith('auth.login_success') || event === 'auth.logout' || event === 'mfa.challenge_passed' ? 'info' : 'warn';
  logger[level](`security:${event}`, {
    security: true,
    event,
    ip: req?.ip ?? '',
    method: req?.method,
    path: req?.originalUrl?.split('?')[0],
    ua: String(req?.get?.('user-agent') ?? '').slice(0, 160),
    userId: req?.user?.id,
    ...meta,
  });
}
