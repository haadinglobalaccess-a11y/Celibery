import type { NextFunction, Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { env, isTest } from '../config/env';
import { AppError, forbidden } from '../lib/errors';
import { MongoRateLimitStore } from '../lib/rate-limit-store';
import { securityEvent } from '../lib/security-log';

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must carry the
 * custom header `X-Requested-With: celibery`. Browsers cannot add custom headers to
 * cross-site form posts, and cross-origin fetches with it require a CORS preflight that
 * only allowed origins pass. Payment webhooks / cron are exempt (they authenticate separately).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/cron/')) return next();
  if (req.get('x-requested-with') !== 'celibery') return next(forbidden('Missing or invalid request header'));
  next();
}

/**
 * Defence in depth against MongoDB operator injection and prototype pollution: request bodies
 * and query strings may not contain keys that start with "$" or are "__proto__" / "constructor" /
 * "prototype". (Every route also validates its input with a strict zod schema.)
 */
const FORBIDDEN_KEY = /^\$|^(__proto__|constructor|prototype)$/;
function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 20 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKey(v, depth + 1));
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(k)) return true;
    if (hasForbiddenKey((value as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}
export function rejectOperatorKeys(req: Request, _res: Response, next: NextFunction) {
  if (hasForbiddenKey(req.query) || (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && hasForbiddenKey(req.body))) {
    return next(new AppError(400, 'INVALID_INPUT', 'The request contains invalid field names'));
  }
  next();
}

/** Rate limits are skipped in the test suite unless a test switches them on explicitly. */
const skipInTests = () => isTest && process.env.RATE_LIMIT_IN_TESTS !== '1';

const RATE_MESSAGE = { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' } };

type LimiterOpts = {
  keyGenerator?: Options['keyGenerator'];
  skipSuccessfulRequests?: boolean;
  requestWasSuccessful?: Options['requestWasSuccessful'];
  /** Per-instance counter even when the shared store is on (see apiLimiter). */
  local?: boolean;
};

/**
 * Endpoint-specific limiter. Counters are shared by every instance (MongoDB store) unless
 * RATE_LIMIT_STORE=memory. `name` must be unique per limiter: it namespaces the counters.
 * A 429 carries Retry-After and RateLimit headers; the client is never blocked permanently —
 * every window ends on its own.
 */
export const limiter = (windowMs: number, limit: number, name = `w${windowMs}l${limit}`, opts: LimiterOpts = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skipInTests,
    store: env.RATE_LIMIT_STORE === 'mongo' && !opts.local ? new MongoRateLimitStore(`rl:${name}`) : undefined,
    keyGenerator: opts.keyGenerator,
    skipSuccessfulRequests: opts.skipSuccessfulRequests,
    ...(opts.requestWasSuccessful ? { requestWasSuccessful: opts.requestWasSuccessful } : {}),
    // The IP comes from req.ip, which honours exactly TRUST_PROXY_HOPS proxies (app.ts).
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req, res, _next, options) => {
      const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfter = reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      securityEvent('rate_limit.exceeded', req, { limiter: name });
      res.status(options.statusCode).json(RATE_MESSAGE);
    },
  });

/** Per-account key (lower-cased email in the body), so one account cannot be hammered from many IPs. */
const byEmail = (req: Request) => `email:${String((req.body as { email?: unknown })?.email ?? '').trim().toLowerCase().slice(0, 200) || req.ip}`;

/**
 * Global burst limit on every API request. Deliberately per instance: a database write on every
 * request would turn a flood into load on MongoDB. Volumetric attacks belong to the CDN/WAF
 * (checklist); the shared limits below protect the sensitive and expensive endpoints.
 */
export const apiLimiter = limiter(60_000, 300, 'api', { local: true });
/** Login / registration / reset per IP. */
export const authLimiter = limiter(15 * 60_000, 20, 'auth');
/** Failed sign-ins per account across all IPs (successful sign-ins do not count). */
export const loginAccountLimiter = limiter(15 * 60_000, 10, 'login-account', {
  keyGenerator: byEmail,
  skipSuccessfulRequests: true,
  // A sign-in refused because the server is busy (503 SIGN_IN_BUSY) is not a failed password attempt:
  // overload must never lock a customer out of their account.
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 503,
});
/** Password-reset emails per address: stops mail-bombing a victim's inbox. */
export const resetEmailLimiter = limiter(60 * 60_000, 5, 'reset-email', { keyGenerator: byEmail });
/** Two-factor code attempts per IP. */
export const mfaLimiter = limiter(15 * 60_000, 15, 'mfa');
export const checkoutLimiter = limiter(60_000, 20, 'checkout');
export const trackingLimiter = limiter(15 * 60_000, 30, 'tracking');
/** Coupon checks and cart quotes (coupon enumeration). */
export const quoteLimiter = limiter(60_000, 60, 'quote');
/** Newsletter sign-ups (list pollution / abuse). */
export const newsletterLimiter = limiter(60 * 60_000, 10, 'newsletter');
/** Review submissions. */
export const reviewLimiter = limiter(60 * 60_000, 10, 'review');
/** Catalogue search (text search over unindexed fields is the most expensive public query). */
export const searchLimiter = limiter(60_000, 120, 'search');
