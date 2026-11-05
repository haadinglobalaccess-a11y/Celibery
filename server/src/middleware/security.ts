import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';
import { forbidden } from '../lib/errors';

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

export const limiter = (windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' } },
  });

export const apiLimiter = limiter(60_000, 300);
export const authLimiter = limiter(15 * 60_000, 20);
export const checkoutLimiter = limiter(60_000, 20);
export const trackingLimiter = limiter(15 * 60_000, 30);
