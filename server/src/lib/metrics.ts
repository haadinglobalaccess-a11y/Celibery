import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from './logger';
import { publicCacheStats } from './public-cache';

/**
 * In-process operational metrics (no external agent, no dependency). Exposed as JSON by
 * GET /api/health/metrics behind METRICS_TOKEN so an uptime/monitoring service can poll and alert.
 * Values are per instance and reset on restart; they complement, not replace, the host's metrics.
 *
 * Nothing here records URLs with query strings, bodies, cookies or user data — only the route
 * pattern (e.g. /api/orders/:orderNumber), status and duration.
 */
const BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const started = Date.now();
const http = {
  total: 0,
  inFlight: 0,
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } as Record<string, number>,
  buckets: BUCKETS_MS.map(() => 0),
  over: 0,
  slow: 0,
};
// Counted from the first request on (connections opened during start-up are not included).
const pool = { created: 0, closed: 0, checkedOut: 0, waiting: 0, checkoutFailures: 0 };
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

let poolWatched = false;
/** Subscribes to the driver's connection-pool events (once, after the first connection). */
export function watchPool() {
  if (poolWatched || !mongoose.connection.readyState) return;
  const client = mongoose.connection.getClient?.();
  if (!client) return;
  poolWatched = true;
  client.on('connectionCreated', () => pool.created++);
  client.on('connectionClosed', () => pool.closed++);
  client.on('connectionCheckOutStarted', () => pool.waiting++);
  client.on('connectionCheckedOut', () => {
    pool.waiting = Math.max(0, pool.waiting - 1);
    pool.checkedOut++;
  });
  client.on('connectionCheckOutFailed', () => {
    pool.waiting = Math.max(0, pool.waiting - 1);
    pool.checkoutFailures++;
  });
  client.on('connectionCheckedIn', () => (pool.checkedOut = Math.max(0, pool.checkedOut - 1)));
}

/** Route pattern only (never the raw URL, which can carry order access tokens). */
const routeOf = (req: Request) => (req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched');

export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const t0 = process.hrtime.bigint();
  http.inFlight++;
  watchPool();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    http.inFlight--;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    http.total++;
    const cls = `${Math.floor(res.statusCode / 100)}xx`;
    if (cls in http.byClass) http.byClass[cls]++;
    const i = BUCKETS_MS.findIndex((b) => ms <= b);
    if (i === -1) http.over++;
    else http.buckets[i]++;
    if (env.SLOW_REQUEST_MS > 0 && ms >= env.SLOW_REQUEST_MS) {
      http.slow++;
      logger.warn('slow_request', { method: req.method, route: routeOf(req), status: res.statusCode, ms: Math.round(ms), poolCheckedOut: pool.checkedOut, poolWaiting: pool.waiting });
    }
  };
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

export function metricsSnapshot() {
  const mem = process.memoryUsage();
  const cumulative: Record<string, number> = {};
  let acc = 0;
  BUCKETS_MS.forEach((b, i) => {
    acc += http.buckets[i];
    cumulative[`le_${b}ms`] = acc;
  });
  cumulative.le_inf = acc + http.over;
  return {
    uptimeSec: Math.round((Date.now() - started) / 1000),
    pid: process.pid,
    memoryMB: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576), heapTotal: Math.round(mem.heapTotal / 1048576) },
    cpuMicros: process.cpuUsage(),
    eventLoopDelayMs: { p50: loopDelay.percentile(50) / 1e6, p99: loopDelay.percentile(99) / 1e6, max: loopDelay.max / 1e6 },
    http: { total: http.total, inFlight: http.inFlight, byClass: http.byClass, slow: http.slow, latency: cumulative },
    mongo: { readyState: mongoose.connection.readyState, maxPoolSize: env.MONGODB_MAX_POOL_SIZE, ...pool },
    publicCache: publicCacheStats(),
  };
}
