import mongoose from 'mongoose';
import { env } from '../config/env';
import { serviceUnavailable } from './errors';
import { logger } from './logger';

/**
 * Short-lived, per-instance cache for PUBLIC, anonymous, read-only payloads (homepage, category
 * list, category facets, public settings). Never used for anything tied to a customer, a session,
 * an order, a payment or a checkout price: checkout always re-reads prices and stock from MongoDB.
 *
 * Why not Redis: measured load (LOAD_TEST_REPORT.md) is dominated by recomputing the same public
 * homepage on every request. A per-instance memo removes that; a shared cache would add a network
 * hop and a new service without removing more work. MongoDB stays the source of truth.
 *
 * Freshness across instances (Vercel functions, Railway replicas): every admin change bumps a
 * version number stored in MongoDB (`counters` collection, _id "public-cache") BEFORE the admin
 * receives the success response. Each cached read checks that version (one primary-key lookup,
 * itself memoised for VERSION_CHECK_MS), so an edit made in the Admin Dashboard is visible on
 * every instance within VERSION_CHECK_MS. Data that changes without an admin action (stock
 * availability flags after orders, best sellers, scheduled banners) is at most `ttlMs` old.
 *
 * Stampede protection: concurrent misses for the same key share one computation.
 */
const VERSION_ID = 'public-cache';
const VERSION_CHECK_MS = 1_000;
/** Oldest copy that may be shown while the database is unreachable. */
const STALE_MAX_MS = 15 * 60_000;
/**
 * Stale-while-revalidate window. Once an entry passes its TTL (and the admin version is unchanged),
 * the next visitor still gets it instantly while ONE background recomputation refreshes it. Without
 * this, a low-traffic store found almost every entry expired, so almost every visitor waited for the
 * full ~20-query homepage computation (measured 16 Nov 2026: 5.9–7 s for /api/home on a cold entry).
 * An admin change bumps the version, which never takes this path: it always recomputes before answering.
 */
const REVALIDATE_WINDOW_MS = 2 * 60_000;

type Entry = { at: number; version: number; value: unknown };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let versionMemo: { at: number; value: number } | null = null;
let versionInflight: Promise<number> | null = null;
const stats = { hits: 0, misses: 0, errors: 0, stale: 0, revalidated: 0 };

const counters = () => mongoose.connection.db!.collection<{ _id: string; seq: number }>('counters');

async function currentVersion(): Promise<number> {
  if (versionMemo && Date.now() - versionMemo.at < VERSION_CHECK_MS) return versionMemo.value;
  if (versionInflight) return versionInflight;
  versionInflight = counters()
    .findOne({ _id: VERSION_ID }, { projection: { seq: 1 }, maxTimeMS: 2_000 })
    .then((d) => {
      versionMemo = { at: Date.now(), value: d?.seq ?? 0 };
      return versionMemo.value;
    })
    .finally(() => {
      versionInflight = null;
    });
  return versionInflight;
}

/** Marks every cached public payload stale on all instances. Called after any successful admin change. */
export async function bumpPublicCacheVersion(): Promise<void> {
  store.clear();
  versionMemo = null;
  try {
    await counters().updateOne({ _id: VERSION_ID }, { $inc: { seq: 1 } }, { upsert: true, maxTimeMS: 2_000 });
  } catch (err) {
    // Local entries are already cleared; other instances fall back to the TTL.
    logger.warn('Public cache version bump failed', { err: String((err as Error)?.message ?? err) });
  }
}

export const publicCacheTtlMs = () => env.PUBLIC_CACHE_TTL_SECONDS * 1000;

/**
 * Returns the cached value for `key`, or computes it with `load`. With PUBLIC_CACHE_TTL_SECONDS=0
 * the cache is off and every call runs `load` (the previous behaviour).
 */
export async function cached<T>(key: string, load: () => Promise<T>, ttlMs = publicCacheTtlMs()): Promise<T> {
  if (ttlMs <= 0) return load();
  const last = store.get(key);
  const staleOk = () => last && Date.now() - last.at < STALE_MAX_MS;
  // Database outage (middleware/db-gate.ts): the last copy keeps the storefront browsable. Prices
  // shown may be up to STALE_MAX_MS old, but nothing can be bought until the database is back.
  if (mongoose.connection.readyState !== 1) {
    if (staleOk()) {
      stats.stale++;
      return last!.value as T;
    }
    throw serviceUnavailable('DATABASE_UNAVAILABLE', 'Service temporarily unavailable. Please try again.');
  }
  let version: number;
  try {
    version = await currentVersion();
  } catch {
    stats.errors++;
    return load(); // cannot prove freshness: do not serve from cache
  }
  const hit = store.get(key);
  if (hit && hit.version === version) {
    const age = Date.now() - hit.at;
    if (age < ttlMs) {
      stats.hits++;
      return hit.value as T;
    }
    if (age < ttlMs + REVALIDATE_WINDOW_MS) {
      // Same admin version, just past its TTL: answer now, refresh once in the background.
      stats.revalidated++;
      if (!inflight.has(key)) {
        compute(key, load, version).catch((err) => {
          stats.errors++;
          logger.warn('Public cache background refresh failed', { key, err: String((err as Error)?.message ?? err) });
        });
      }
      return hit.value as T;
    }
  }
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  stats.misses++;
  return compute(key, load, version);
}

function compute<T>(key: string, load: () => Promise<T>, version: number): Promise<T> {
  const p = load()
    .then((value) => {
      // A newer admin version may have been stored meanwhile: never overwrite it with older data.
      const current = store.get(key);
      if (!current || current.version <= version) store.set(key, { at: Date.now(), version, value });
      // Bounded: public keys are few (homepage, categories, one entry per category/listing); guard anyway.
      if (store.size > 500) store.delete(store.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Keeps the always-needed public payloads computed (homepage, public settings, category list) so the
 * first visitor after a quiet period or a deploy does not pay for the computation. Long-running servers
 * only (server.ts); each refresh goes through `cached`, so it shares in-flight work with visitors.
 */
export function keepWarm(entries: { key: string; load: () => Promise<unknown> }[], everyMs = 60_000) {
  if (publicCacheTtlMs() <= 0) return () => {};
  const tick = () => {
    if (mongoose.connection.readyState !== 1) return;
    for (const { key, load } of entries) {
      // Force a refresh when the entry is older than half its TTL; otherwise this is a cheap hit.
      const e = store.get(key);
      if (e && Date.now() - e.at < publicCacheTtlMs() / 2) continue;
      if (inflight.has(key)) continue;
      currentVersion()
        .then((v) => compute(key, load, v))
        .catch((err) => logger.warn('Public cache warm-up failed', { key, err: String((err as Error)?.message ?? err) }));
    }
  };
  const first = setTimeout(tick, 2_000);
  const timer = setInterval(tick, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export const publicCacheStats = () => ({ ...stats, entries: store.size });
