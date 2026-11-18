import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env';
import { COUNTRY_CURRENCY, DISPLAY_CURRENCIES, currencyForCountry } from '../../src/modules/currency/currencies';
import { __setGeoFetchForTests, detectCountry, isPrivateIp, parseLookupPayload } from '../../src/modules/currency/geo';
import {
  __resetRatesForTests,
  __setRatesFetchForTests,
  configuredProviders,
  getRates,
  parseProviderPayload,
  refreshRates,
  validateRates,
} from '../../src/modules/currency/rates.service';

const mutableEnv = env as unknown as Record<string, string | number>;
const RATES = { SAR: 1, USD: 0.2667, PKR: 74.2, EUR: 0.2301, GBP: 0.2011, AED: 0.9793, INR: 22.4, KWD: 0.0819, QAR: 0.9707, BHD: 0.1003, OMR: 0.1026, JPY: 40.1 };

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const req = (headers: Record<string, string>, ip = '203.0.113.9') => ({ ip, get: (n: string) => headers[n.toLowerCase()] });

describe('country → currency mapping', () => {
  it.each([
    ['PK', 'PKR'], ['US', 'USD'], ['SA', 'SAR'], ['AE', 'AED'], ['GB', 'GBP'], ['DE', 'EUR'], ['FR', 'EUR'], ['IN', 'INR'],
    ['KW', 'KWD'], ['QA', 'QAR'], ['BH', 'BHD'], ['OM', 'OMR'], ['CA', 'CAD'], ['AU', 'AUD'], ['TR', 'TRY'], ['JP', 'JPY'],
    ['CN', 'CNY'], ['CH', 'CHF'], ['SG', 'SGD'], ['MY', 'MYR'],
  ])('%s → %s', (country, currency) => {
    expect(currencyForCountry(country)).toBe(currency);
    expect(currencyForCountry(country.toLowerCase())).toBe(currency);
  });

  it('unknown, unsupported and malformed countries map to nothing (storefront shows SAR)', () => {
    for (const c of ['XX', 'ZZ', 'T1', '', 'USA', null, undefined, 'AQ']) expect(currencyForCountry(c as string)).toBeNull();
  });

  it('every mapped currency is an offered display currency', () => {
    for (const cur of Object.values(COUNTRY_CURRENCY)) expect(DISPLAY_CURRENCIES).toContain(cur);
  });
});

describe('exchange-rate payloads', () => {
  it('reads the common provider formats', () => {
    expect(parseProviderPayload({ result: 'success', base_code: 'SAR', rates: { USD: 0.2667 } })).toEqual({ USD: 0.2667 });
    expect(parseProviderPayload({ result: 'success', base_code: 'SAR', conversion_rates: { USD: 0.2667 } })).toEqual({ USD: 0.2667 });
    expect(parseProviderPayload({ date: '2026-11-18', sar: { usd: 0.2667, pkr: 74.2 } })).toEqual({ USD: 0.2667, PKR: 74.2 });
  });

  it('rejects errors and sets based on another currency', () => {
    expect(parseProviderPayload({ result: 'error', 'error-type': 'invalid-key' })).toBeNull();
    expect(parseProviderPayload({ base_code: 'USD', rates: { SAR: 3.75 } })).toBeNull();
    expect(parseProviderPayload('nope')).toBeNull();
  });

  it('keeps only display currencies with valid rates and enforces the SAR/USD peg', () => {
    const v = validateRates({ USD: 0.2667, PKR: 74.2, EUR: -1, GBP: Number.NaN, BTC: 0.000003, JPY: 0 })!;
    expect(v).toEqual({ SAR: 1, USD: 0.2667, PKR: 74.2 });
    expect(validateRates({ USD: 1, PKR: 280 })).toBeNull(); // USD-based data passed off as SAR
    expect(validateRates({ PKR: 74.2 })).toBeNull(); // cannot verify the base
    expect(validateRates(null)).toBeNull();
  });
});

describe('exchange-rate service (mocked provider)', () => {
  beforeEach(() => {
    __resetRatesForTests();
    mutableEnv.EXCHANGE_RATE_API_URL = 'https://rates-a.test/{base},https://rates-b.test/{base_lower}.json';
    mutableEnv.EXCHANGE_RATE_API_KEY = '';
  });
  afterEach(() => {
    __setRatesFetchForTests(null);
    __resetRatesForTests();
    mutableEnv.EXCHANGE_RATE_API_URL = '';
    vi.useRealTimers();
  });

  it('builds the provider chain from the environment and never uses plain HTTP; a key goes first', () => {
    mutableEnv.EXCHANGE_RATE_API_URL = 'http://insecure.test/x,https://ok.test/{base}';
    mutableEnv.EXCHANGE_RATE_API_KEY = 'k3y';
    const p = configuredProviders();
    expect(p.map((x) => x.url)).toEqual(['https://v6.exchangerate-api.com/v6/k3y/latest/SAR', 'https://ok.test/SAR']);
    expect(p[0].name).not.toContain('k3y'); // provider names are logged/stored; keys never are
  });

  it('retries, falls through to the next provider, and caches the result', async () => {
    const calls: string[] = [];
    __setRatesFetchForTests((url) => {
      calls.push(url);
      return url.startsWith('https://rates-a.test') ? json({}, 503) : json({ date: '2026-11-18', sar: Object.fromEntries(Object.entries(RATES).map(([k, v]) => [k.toLowerCase(), v])) });
    });
    const r = await getRates();
    expect(r.set?.rates.PKR).toBe(74.2);
    expect(r.set?.provider).toBe('rates-b.test');
    expect(calls).toEqual(['https://rates-a.test/SAR', 'https://rates-a.test/SAR', 'https://rates-b.test/sar.json']);
    await getRates();
    expect(calls).toHaveLength(3); // served from cache, no new provider call
  });

  it('concurrent refreshes share one provider call', async () => {
    let n = 0;
    __setRatesFetchForTests(() => {
      n++;
      return json({ result: 'success', base_code: 'SAR', rates: RATES });
    });
    await Promise.all([refreshRates(), refreshRates(), getRates()]);
    expect(n).toBe(1);
  });

  it('API failure with nothing cached → no rates (storefront falls back to SAR), without throwing', async () => {
    __setRatesFetchForTests(() => Promise.reject(new TypeError('fetch failed')));
    const r = await getRates();
    expect(r.set).toBeNull();
  });

  it('invalid provider data is never accepted', async () => {
    __setRatesFetchForTests(() => json({ result: 'success', base_code: 'SAR', rates: { USD: 3.75, PKR: 280 } }));
    expect((await getRates()).set).toBeNull();
  });

  it('uses the last cached rates while the provider is down, until the maximum age', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T00:00:00Z'));
    __setRatesFetchForTests(() => json({ result: 'success', base_code: 'SAR', rates: RATES }));
    expect((await getRates()).set?.rates.USD).toBe(0.2667);

    __setRatesFetchForTests(() => json({}, 500));
    vi.setSystemTime(new Date('2026-11-19T00:00:00Z')); // past the refresh interval
    const stale = await getRates();
    expect(stale.set?.rates.USD).toBe(0.2667);
    expect(stale.stale).toBe(true);

    vi.setSystemTime(new Date(Date.parse('2026-11-18T00:00:00Z') + (Number(env.EXCHANGE_RATE_MAX_AGE_HOURS) + 1) * 3_600_000));
    expect((await getRates()).set).toBeNull(); // too old to trust → SAR
  });
});

describe('visitor country detection', () => {
  afterEach(() => {
    __setGeoFetchForTests(null);
    mutableEnv.GEO_COUNTRY_HEADER = '';
    mutableEnv.GEO_IP_LOOKUP_URL = '';
    mutableEnv.GEO_DEV_COUNTRY = '';
  });

  it("uses Vercel's edge header on Vercel", async () => {
    expect(await detectCountry(req({ 'x-vercel-ip-country': 'PK' }), { vercel: true })).toEqual({ country: 'PK', source: 'vercel' });
  });

  it('ignores a client-supplied Vercel or CDN header when the platform does not set it', async () => {
    const r = await detectCountry(req({ 'x-vercel-ip-country': 'US', 'cf-ipcountry': 'US' }), { vercel: false });
    expect(r.country).toBeNull();
  });

  it('reads a configured trusted CDN header', async () => {
    mutableEnv.GEO_COUNTRY_HEADER = 'cf-ipcountry';
    expect(await detectCountry(req({ 'cf-ipcountry': 'ae' }), { vercel: false })).toEqual({ country: 'AE', source: 'header' });
  });

  it('looks up public IPs once (cached), never private ones', async () => {
    mutableEnv.GEO_IP_LOOKUP_URL = 'https://geo.test/{ip}';
    const calls: string[] = [];
    __setGeoFetchForTests((url) => {
      calls.push(url);
      return json({ ip: '203.0.113.9', country: 'GB' });
    });
    expect(await detectCountry(req({}), { vercel: false })).toEqual({ country: 'GB', source: 'ip-lookup' });
    expect(await detectCountry(req({}), { vercel: false })).toEqual({ country: 'GB', source: 'ip-lookup' });
    expect(calls).toEqual(['https://geo.test/203.0.113.9']);
    expect((await detectCountry(req({}, '192.168.1.4'), { vercel: false })).country).toBeNull();
    expect((await detectCountry(req({}, '::1'), { vercel: false })).country).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('lookup failure → unknown country, no exception', async () => {
    mutableEnv.GEO_IP_LOOKUP_URL = 'https://geo.test/{ip}';
    __setGeoFetchForTests(() => Promise.reject(new Error('timeout')));
    expect(await detectCountry(req({}), { vercel: false })).toEqual({ country: null, source: null });
  });

  it('GEO_DEV_COUNTRY applies outside production when nothing else detected the country', async () => {
    mutableEnv.GEO_DEV_COUNTRY = 'KW';
    expect(await detectCountry(req({}, '127.0.0.1'), { vercel: false })).toEqual({ country: 'KW', source: 'dev' });
  });

  it('helpers', () => {
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false);
    expect(parseLookupPayload({ country_code: 'in' })).toBe('IN');
    expect(parseLookupPayload({ countryCode: 'QA' })).toBe('QA');
    expect(parseLookupPayload({ error: true })).toBeNull();
  });
});
