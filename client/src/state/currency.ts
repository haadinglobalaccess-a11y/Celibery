import { useMemo, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/I18n';
import { get } from '../lib/api';
import { BASE_CURRENCY, formatMoney, validRate } from '../lib/currency';

/**
 * Selected display currency for the storefront.
 *
 * Priority (never reordered):
 *  1. the customer's manual choice (localStorage, kept across visits);
 *  2. the currency of the country the API detected from the visitor's IP;
 *  3. SAR (detection failed, unsupported country, or no valid rate).
 * Automatic detection only ever updates the detected currency; it can never overwrite a manual choice.
 *
 * The last detection + rates are kept on the device, so returning visitors render in their currency
 * on the first paint (no reload, no flash). The API is asked again in the background at most once
 * an hour — never per navigation, and never blocking rendering.
 */

const PREF_KEY = 'celibery.currency.pref.v1';
// v2: earlier detections behind Railway's Singapore edge could be wrong (SGD in Pakistan) — re-detect once.
const CTX_KEY = 'celibery.currency.ctx.v2';
const REFRESH_AFTER_MS = 60 * 60_000;
const CODE_RX = /^[A-Z]{3}$/;

export type CurrencyContext = {
  country: string | null;
  /** Currency for the detected country (SAR when unknown/unsupported). */
  currency: string;
  /** 1 SAR = rates[CODE] CODE. */
  rates: Record<string, number>;
  ratesUpdatedAt: string | null;
  savedAt: number;
};

type State = { pref: string | null; ctx: CurrencyContext | null };

export type CurrencyView = {
  /** Currency prices are shown in right now. */
  code: string;
  rate: number;
  mode: 'manual' | 'auto';
  /** Currency automatic detection chose (what "Automatic" means). */
  detected: string;
  /** Currencies that can be selected (have a valid rate), SAR first. */
  available: string[];
  /** True when prices are shown in something other than the SAR charge currency. */
  converted: boolean;
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / storage blocked: the choice lasts for this page view */
  }
}

/** Accepts only a well-formed context (also used for data read back from storage). */
function sanitise(raw: unknown, savedAt: number): CurrencyContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rates: Record<string, number> = { [BASE_CURRENCY]: 1 };
  if (r.rates && typeof r.rates === 'object') {
    for (const [k, v] of Object.entries(r.rates as Record<string, unknown>)) if (CODE_RX.test(k) && k !== BASE_CURRENCY && validRate(v)) rates[k] = v;
  }
  const currency = typeof r.currency === 'string' && CODE_RX.test(r.currency) && rates[r.currency] ? r.currency : BASE_CURRENCY;
  const country = typeof r.country === 'string' && /^[A-Z]{2}$/.test(r.country) ? r.country : null;
  const ratesUpdatedAt = typeof r.ratesUpdatedAt === 'string' ? r.ratesUpdatedAt : null;
  return { country, currency, rates, ratesUpdatedAt, savedAt };
}

function readCtx(): CurrencyContext | null {
  try {
    const raw = safeGet(CTX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown };
    return sanitise(parsed, typeof parsed.savedAt === 'number' ? parsed.savedAt : 0);
  } catch {
    return null;
  }
}
function readPref(): string | null {
  const v = safeGet(PREF_KEY);
  return v && CODE_RX.test(v) ? v : null;
}

let state: State = { pref: readPref(), ctx: readCtx() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function setState(next: State) {
  state = next;
  emit();
}

function resolve(s: State): CurrencyView {
  const rates = s.ctx?.rates ?? { [BASE_CURRENCY]: 1 };
  const detected = s.ctx?.currency && validRate(rates[s.ctx.currency]) ? s.ctx.currency : BASE_CURRENCY;
  const wanted = s.pref ?? detected;
  const rate = wanted === BASE_CURRENCY ? 1 : rates[wanted];
  const code = validRate(rate) ? wanted : BASE_CURRENCY; // no valid rate → original SAR prices
  const available = Object.keys(rates).filter((k) => validRate(rates[k]));
  return { code, rate: code === BASE_CURRENCY ? 1 : (rate as number), mode: s.pref ? 'manual' : 'auto', detected, available, converted: code !== BASE_CURRENCY };
}

let viewFor: State | null = null;
let view: CurrencyView = resolve(state);
const getView = () => {
  if (viewFor !== state) {
    viewFor = state;
    view = resolve(state);
  }
  return view;
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let inflight: Promise<void> | null = null;
/** Fetches detection + rates in the background. Never throws; failures keep the current state. */
export function refreshCurrency(force = false): Promise<void> {
  if (!force && state.ctx && Date.now() - state.ctx.savedAt < REFRESH_AFTER_MS) return Promise.resolve();
  inflight ??= get<unknown>('/api/currency/context')
    .then((data) => {
      const ctx = sanitise(data, Date.now());
      if (!ctx) return;
      safeSet(CTX_KEY, JSON.stringify(ctx));
      setState({ ...state, ctx });
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Starts the background refresh as early as possible (called once from main.tsx) and syncs other tabs. */
export function initCurrency() {
  void refreshCurrency();
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === PREF_KEY) setState({ ...state, pref: readPref() });
      else if (e.key === CTX_KEY) setState({ ...state, ctx: readCtx() ?? state.ctx });
    });
  } catch {
    /* non-browser environment */
  }
}

/** Manual choice (takes priority over detection and is remembered), or null to return to automatic. */
export function setCurrency(code: string | null) {
  const pref = code && CODE_RX.test(code) ? code : null;
  safeSet(PREF_KEY, pref);
  setState({ ...state, pref });
  if (!pref) void refreshCurrency(); // back to automatic: re-check the country if the copy is old
}

export function useCurrency(): CurrencyView {
  return useSyncExternalStore(subscribe, getView, getView);
}

/** Formatter for SAR halalas in the selected display currency: `const money = useMoney(); money(14900)`. */
export function useMoney(): (halalas: number) => string {
  const { lang } = useI18n();
  const v = useCurrency();
  return useMemo(() => (halalas: number) => formatMoney(halalas, v.code, v.rate, lang), [v.code, v.rate, lang]);
}
