import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { databaseReady } from '../db/connect';

/**
 * Fail fast while MongoDB is unreachable (RELIABILITY_REPORT.md).
 *
 * Without this, every query waits for Mongoose's command buffer and the driver's server selection
 * (~10 s each), so one API request took 30–40 s to fail during a measured outage — beyond Vercel's
 * 30 s limit and long enough to pile up connections on Railway. Now a request waits at most
 * RECONNECT_GRACE_MS for the driver to reconnect (covers brief blips and replica-set elections), then:
 *
 *  - public, read-only storefront payloads (homepage, categories, public settings) continue from the
 *    last cached copy (lib/public-cache.ts, at most 15 minutes old) — the store stays browsable;
 *  - everything else (checkout, accounts, orders, admin, webhooks) gets 503 DATABASE_UNAVAILABLE with
 *    Retry-After. Nothing is half-written: no request reaches the database code. Payment providers
 *    re-deliver webhooks after a 503, so no payment event is lost.
 */
const RECONNECT_GRACE_MS = 2_000;

/** GET routes (relative to /api) that may be answered from the public cache during an outage. */
const STALE_OK = [/^\/home$/, /^\/settings\/public$/, /^\/categories$/, /^\/categories\/[a-z0-9-]{1,100}$/i];
export const servesStaleWhenDbDown = (req: Pick<Request, 'method' | 'path'>) => req.method === 'GET' && STALE_OK.some((rx) => rx.test(req.path));

function waitForDb(ms: number): Promise<boolean> {
  if (databaseReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const c = mongoose.connection;
    const done = () => {
      clearTimeout(timer);
      c.off('connected', done);
      c.off('reconnected', done);
      resolve(databaseReady());
    };
    const timer = setTimeout(done, ms);
    timer.unref();
    c.on('connected', done);
    c.on('reconnected', done);
  });
}

export function databaseGate(req: Request, res: Response, next: NextFunction) {
  if (databaseReady()) return next();
  void waitForDb(RECONNECT_GRACE_MS).then((up) => {
    if (up) return next();
    if (servesStaleWhenDbDown(req)) {
      res.locals.dbDown = true; // loadUser skips its lookups; the cache serves its last copy
      return next();
    }
    res.setHeader('Retry-After', '5');
    res.status(503).json({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Service temporarily unavailable. Please try again.' } });
  });
}
