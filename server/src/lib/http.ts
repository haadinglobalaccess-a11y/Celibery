import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Consistent success envelope: { ok: true, data, meta? } */
export function ok(res: Response, data: unknown, status = 200, meta?: Record<string, unknown>) {
  return res.status(status).json(meta ? { ok: true, data, meta } : { ok: true, data });
}

/** Wraps async route handlers so rejected promises reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function pageParams(q: { page?: number; limit?: number }, maxLimit = 100) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(q.limit) || 24));
  return { page, limit, skip: (page - 1) * limit };
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
