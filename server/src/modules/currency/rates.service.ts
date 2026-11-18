import mongoose from 'mongoose';
import { env, isTest } from '../../config/env';
import { databaseReady } from '../../db/connect';
import { logger } from '../../lib/logger';
import { BASE_CURRENCY, DISPLAY_CURRENCIES } from './currencies';

/**
 * SAR → display-currency exchange rates (one central service; the browser never calls a rate API).
 *
 * - Rates are fetched periodically (scheduled maintenance job, and lazily when the copy is older than
 *   EXCHANGE_RATE_REFRESH_MINUTES), never per product or per visitor.
 * - The last successful set is kept in memory and in MongoDB (`exchange_rates` collection, one
 *   document), so a new serverless instance or a provider outage still has rates.
 * - Providers are tried in order, each with a timeout and one retry. A response is accepted only if
 *   it is a sane SAR-based set (see validateRates). Failed sets never replace a good cached set.
 * - A cached set older than EXCHANGE_RATE_MAX_AGE_HOURS is no longer used: the storefront then shows
 *   the original SAR prices.
 *
 * These rates are for DISPLAY only. Checkout, orders and payments keep using SAR amounts.
 */

export type RateSet = {
  base: typeof BASE_CURRENCY;
  /** 1 SAR = rates[CODE] units of CODE. Always contains SAR: 1. Only display currencies. */
  rates: Record<string, number>;
  /** When CELIBERY fetched the set (ms since epoch). */
  fetchedAt: number;
  /** Provider host the set came from (never a URL containing a key). */
  provider: string;
};

type Provider = { name: string; url: string };

const FETCH_TIMEOUT_MS = 5_000;
const ATTEMPTS_PER_PROVIDER = 2;
/** After every provider failed, wait this long before trying again on demand. */
const FAILURE_BACKOFF_MS = 5 * 60_000;
/** How often a stale in-memory copy re-checks MongoDB for a newer set written by another instance. */
const DB_RECHECK_MS = 60_000;
const COLLECTION = 'exchange_rates';

/**
 * The Saudi riyal is pegged at 3.75 per US dollar (since 1986), so 1 SAR ≈ 0.2667 USD. A provider
 * answer outside this band is corrupt or not SAR-based and is rejected.
 */
const USD_PEG_BAND = [0.255, 0.278] as const;

/** Free providers that need no key (tried in order). Overridden by EXCHANGE_RATE_API_URL. */
const DEFAULT_PROVIDER_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base_lower}.json',
  'https://latest.currency-api.pages.dev/v1/currencies/{base_lower}.json',
  'https://open.er-api.com/v6/latest/{base}',
];

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
};
const fill = (url: string) => url.replaceAll('{base}', BASE_CURRENCY).replaceAll('{base_lower}', BASE_CURRENCY.toLowerCase());

/** Providers from the environment. In the test suite nothing is called unless explicitly configured. */
export function configuredProviders(e: { EXCHANGE_RATE_API_KEY: string; EXCHANGE_RATE_API_URL: string } = env): Provider[] {
  const list: Provider[] = [];
  const key = e.EXCHANGE_RATE_API_KEY.trim();
  if (key) list.push({ name: 'v6.exchangerate-api.com', url: `https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/${BASE_CURRENCY}` });
  const custom = e.EXCHANGE_RATE_API_URL.split(',').map((u) => u.trim()).filter(Boolean);
  if (custom.length === 1 && custom[0].toLowerCase() === 'off') return list;
  const urls = custom.length ? custom : isTest ? [] : DEFAULT_PROVIDER_URLS;
  for (const u of urls) {
    const url = fill(u);
    if (!/^https:\/\//i.test(url)) continue; // never fetch rates over plain HTTP
    list.push({ name: hostOf(url), url });
  }
  return list;
}

/**
 * Reads SAR-based rates from the common provider formats:
 *  - { rates: { USD: 0.2666 } }               (open.er-api.com, most REST APIs)
 *  - { conversion_rates: { USD: 0.2666 } }    (exchangerate-api.com v6)
 *  - { date, sar: { usd: 0.2666 } }           (fawazahmed0 currency-api)
 * Returns null when the payload is unusable or says it is based on another currency.
 */
export function parseProviderPayload(payload: unknown): Record<string, number> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.result === 'string' && p.result !== 'success') return null;
  const declaredBase = p.base_code ?? p.base ?? p.source;
  if (typeof declaredBase === 'string' && declaredBase.toUpperCase() !== BASE_CURRENCY) return null;
  const raw = p.rates ?? p.conversion_rates ?? p[BASE_CURRENCY.toLowerCase()] ?? p[BASE_CURRENCY];
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number') out[k.toUpperCase()] = v;
  }
  return out;
}

/** Keeps only display currencies with finite, positive rates; null if the set fails the USD peg check. */
export function validateRates(all: Record<string, number> | null): Record<string, number> | null {
  if (!all) return null;
  const usd = all.USD;
  if (!(Number.isFinite(usd) && usd >= USD_PEG_BAND[0] && usd <= USD_PEG_BAND[1])) return null;
  const rates: Record<string, number> = {};
  for (const code of DISPLAY_CURRENCIES) {
    if (code === BASE_CURRENCY) {
      rates[code] = 1;
      continue;
    }
    const r = all[code];
    if (typeof r === 'number' && Number.isFinite(r) && r > 0 && r < 1e7) rates[code] = r;
  }
  return rates;
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let memory: RateSet | null = null;
let memoryCheckedDbAt = 0;
let inflight: Promise<RateSet | null> | null = null;
let lastFailureAt = 0;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);

const ttlMs = () => env.EXCHANGE_RATE_REFRESH_MINUTES * 60_000;
const maxAgeMs = () => env.EXCHANGE_RATE_MAX_AGE_HOURS * 3_600_000;

async function fetchFrom(provider: Provider): Promise<Record<string, number>> {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt++) {
    try {
      const res = await fetchImpl(provider.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // a client error will not fix itself
        continue;
      }
      const rates = validateRates(parseProviderPayload(await res.json()));
      if (rates) return rates;
      lastError = 'invalid or non-SAR payload';
      break; // a well-formed but wrong answer will be the same on retry
    } catch (e) {
      lastError = (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network error';
    }
  }
  throw new Error(lastError);
}

const collection = () => mongoose.connection.db!.collection<{ _id: string; rates: Record<string, number>; fetchedAt: Date; provider: string }>(COLLECTION);

async function loadPersisted(): Promise<RateSet | null> {
  if (!databaseReady()) return null;
  try {
    const doc = await collection().findOne({ _id: BASE_CURRENCY }, { maxTimeMS: 2_000 });
    if (!doc?.rates || !(doc.fetchedAt instanceof Date)) return null;
    const rates = validateRates(doc.rates);
    return rates ? { base: BASE_CURRENCY, rates, fetchedAt: doc.fetchedAt.getTime(), provider: doc.provider ?? '' } : null;
  } catch (e) {
    logger.warn('Exchange rates: could not read the cached copy', { err: String(e) });
    return null;
  }
}

async function persist(set: RateSet) {
  if (!databaseReady()) return;
  try {
    await collection().updateOne(
      { _id: BASE_CURRENCY },
      { $set: { rates: set.rates, fetchedAt: new Date(set.fetchedAt), provider: set.provider } },
      { upsert: true },
    );
  } catch (e) {
    logger.warn('Exchange rates: could not store the latest copy', { err: String(e) });
  }
}

const newer = (a: RateSet | null, b: RateSet | null) => (!a ? b : !b ? a : a.fetchedAt >= b.fetchedAt ? a : b);

/** Fetches a fresh set from the first provider that answers correctly. Concurrent callers share one fetch. */
export function refreshRates(): Promise<RateSet | null> {
  inflight ??= (async () => {
    const providers = configuredProviders();
    if (!providers.length) return null;
    const failures: string[] = [];
    for (const provider of providers) {
      try {
        const rates = await fetchFrom(provider);
        const set: RateSet = { base: BASE_CURRENCY, rates, fetchedAt: Date.now(), provider: provider.name };
        memory = set;
        memoryCheckedDbAt = Date.now();
        lastFailureAt = 0;
        await persist(set);
        return set;
      } catch (e) {
        failures.push(`${provider.name}: ${(e as Error).message}`);
      }
    }
    lastFailureAt = Date.now();
    logger.warn('Exchange rates: every provider failed; keeping the last cached rates', { failures });
    return null;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Scheduled job: refreshes when the stored copy is due. Never throws. */
export async function refreshRatesIfDue() {
  try {
    const current = newer(memory, await loadPersisted());
    if (current) memory = current;
    if (current && Date.now() - current.fetchedAt < ttlMs()) return { refreshed: false, ageMinutes: Math.round((Date.now() - current.fetchedAt) / 60_000) };
    const set = await refreshRates();
    return { refreshed: Boolean(set), provider: set?.provider ?? null };
  } catch (e) {
    logger.warn('Exchange rates: scheduled refresh failed', { err: String(e) });
    return { refreshed: false, error: true };
  }
}

/**
 * Current rates for the storefront. Answers from cache whenever possible:
 *  - fresh copy → returned as is;
 *  - stale but within the maximum age → returned at once, refreshed in the background;
 *  - no usable copy → one bounded fetch; if that fails too, null (the storefront shows SAR).
 */
export async function getRates(): Promise<{ set: RateSet | null; stale: boolean }> {
  const now = Date.now();
  if (!memory || (now - memory.fetchedAt >= ttlMs() && now - memoryCheckedDbAt >= DB_RECHECK_MS)) {
    memoryCheckedDbAt = now;
    memory = newer(memory, await loadPersisted());
  }
  const age = memory ? now - memory.fetchedAt : Infinity;
  if (age < ttlMs()) return { set: memory, stale: false };
  const mayFetch = now - lastFailureAt >= FAILURE_BACKOFF_MS;
  if (memory && age < maxAgeMs()) {
    if (mayFetch) void refreshRates().catch(() => undefined);
    return { set: memory, stale: true };
  }
  if (mayFetch) await refreshRates().catch(() => null);
  if (memory && Date.now() - memory.fetchedAt < maxAgeMs()) return { set: memory, stale: Date.now() - memory.fetchedAt >= ttlMs() };
  return { set: null, stale: true };
}

/** Test hooks: replace the HTTP client and clear the per-process cache. */
export function __setRatesFetchForTests(fn: FetchLike | null) {
  fetchImpl = fn ?? ((url, init) => fetch(url, init));
}
export function __resetRatesForTests() {
  memory = null;
  memoryCheckedDbAt = 0;
  inflight = null;
  lastFailureAt = 0;
}
