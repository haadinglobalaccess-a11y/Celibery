import net from 'node:net';
import type { Request } from 'express';
import { env, isProd, isTest } from '../../config/env';
import { normaliseCountry } from './currencies';

/**
 * Visitor country (ISO 3166-1 alpha-2) from the request, for choosing a DISPLAY currency only.
 *
 * Order of trust:
 *  1. Vercel (process.env.VERCEL): `x-vercel-ip-country`, set by Vercel's edge network from the
 *     connecting IP. Only read on Vercel, where the platform controls it.
 *  2. GEO_COUNTRY_HEADER: a header set by a CDN/proxy you run in front of the app and that overwrites
 *     any client value (e.g. `cf-ipcountry` behind Cloudflare). Never read unless configured.
 *  3. IP lookup (GEO_IP_LOOKUP_URL, default api.country.is) for the client IP Express derives with
 *     the configured TRUST_PROXY_HOPS. Private/loopback addresses are never looked up. Results are
 *     cached per IP for 24 h (failures for 10 min) so a visitor causes at most one lookup a day.
 *  4. GEO_DEV_COUNTRY: fixed country for local development and tests (ignored in production).
 * No GPS, no browser language. Unknown → null (the storefront then shows SAR).
 */

export type CountrySource = 'vercel' | 'header' | 'ip-lookup' | 'dev';
export type DetectedCountry = { country: string | null; source: CountrySource | null };

const LOOKUP_TIMEOUT_MS = 2_500;
const HIT_TTL_MS = 24 * 3_600_000;
const MISS_TTL_MS = 10 * 60_000;
const CACHE_MAX = 10_000;

type CacheEntry = { country: string | null; until: number };
const ipCache = new Map<string, CacheEntry>();
const ipInflight = new Map<string, Promise<string | null>>();

type LookupFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
let lookupFetch: LookupFetch = (url, init) => fetch(url, init);

/** True for addresses that can never be geolocated (loopback, private, link-local, CGNAT, unique-local…). */
export function isPrivateIp(ip: string): boolean {
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(v)) {
    const l = v.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
  }
  return true; // not an IP at all
}

function lookupUrlTemplate(): string | null {
  const v = env.GEO_IP_LOOKUP_URL.trim();
  if (!v) return isTest ? null : 'https://api.country.is/{ip}';
  if (v.toLowerCase() === 'off') return null;
  return /^https:\/\/.+\{ip\}/i.test(v) ? v : null;
}

/** Reads the country from common geolocation API answers ({country}, {country_code}, {countryCode}). */
export function parseLookupPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  return normaliseCountry(p.country_code ?? p.countryCode ?? p.country);
}

async function lookupIp(ip: string): Promise<string | null> {
  const template = lookupUrlTemplate();
  if (!template || isPrivateIp(ip)) return null;
  const cached = ipCache.get(ip);
  if (cached && cached.until > Date.now()) return cached.country;
  const pending = ipInflight.get(ip);
  if (pending) return pending;
  const run = (async () => {
    let country: string | null = null;
    try {
      const res = await lookupFetch(template.replace('{ip}', encodeURIComponent(ip)), { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), headers: { Accept: 'application/json' } });
      if (res.ok) country = parseLookupPayload(await res.json());
    } catch {
      /* timeout or network error: treated as unknown and retried after MISS_TTL_MS */
    }
    if (ipCache.size >= CACHE_MAX) ipCache.delete(ipCache.keys().next().value as string); // oldest entry
    ipCache.set(ip, { country, until: Date.now() + (country ? HIT_TTL_MS : MISS_TTL_MS) });
    return country;
  })().finally(() => ipInflight.delete(ip));
  ipInflight.set(ip, run);
  return run;
}

type Req = Pick<Request, 'ip'> & { get(name: string): string | undefined };

/**
 * The visitor's address for choosing a DISPLAY currency: the first public address in
 * X-Forwarded-For (the original client, as the hosting edge records it), else req.ip.
 * Behind Railway, req.ip can be the platform's own edge (e.g. Singapore), which showed SGD to
 * visitors from Pakistan. A client can forge this header, but that only changes the currency it is
 * shown itself — it is never used for rate limits, sessions or anything else.
 */
export function visitorIp(req: Req): string | undefined {
  const forwarded = (req.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded.find((ip) => /^[0-9a-f.:]+$/i.test(ip) && !isPrivateIp(ip)) ?? req.ip;
}

export async function detectCountry(req: Req, platform: { vercel?: boolean } = { vercel: Boolean(process.env.VERCEL) }): Promise<DetectedCountry> {
  if (platform.vercel) {
    const c = normaliseCountry(req.get('x-vercel-ip-country'));
    if (c) return { country: c, source: 'vercel' };
  }
  const header = env.GEO_COUNTRY_HEADER.trim().toLowerCase();
  if (header) {
    const c = normaliseCountry(req.get(header));
    if (c) return { country: c, source: 'header' };
  }
  const ip = visitorIp(req);
  if (ip) {
    const c = await lookupIp(ip);
    if (c) return { country: c, source: 'ip-lookup' };
  }
  if (!isProd) {
    const c = normaliseCountry(env.GEO_DEV_COUNTRY);
    if (c) return { country: c, source: 'dev' };
  }
  return { country: null, source: null };
}

export function __setGeoFetchForTests(fn: LookupFetch | null) {
  lookupFetch = fn ?? ((url, init) => fetch(url, init));
  ipCache.clear();
  ipInflight.clear();
}
