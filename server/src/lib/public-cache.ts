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

type Entry = { at: number; version: number; value: unknown };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let versionMemo: { at: number; value: number } | null = null;
let versionInflight: Promise<number> | null = null;
const stats = { hits: 0, misses: 0, errors: 0, stale: 0 };

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
  if (hit && hit.version === version && Date.now() - hit.at < ttlMs) {
    stats.hits++;
    return hit.value as T;
  }
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  stats.misses++;
  const p = load()
    .then((value) => {
      store.set(key, { at: Date.now(), version, value });
      // Bounded: public keys are few (homepage, categories, one entry per category); guard anyway.
      if (store.size > 500) store.delete(store.keys().next().value as string);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const publicCacheStats = () => ({ ...stats, entries: store.size });
