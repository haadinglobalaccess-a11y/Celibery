import type { Lang } from './types';

/**
 * Display-currency conversion and formatting — the ONE place storefront prices are converted.
 *
 * Every amount the storefront receives from the API is SAR in halalas (product prices, compare-at
 * prices, cart and checkout totals). Conversion happens only here, at format time, from that SAR
 * amount: converted values are never stored, sent back to the API or fed into another conversion,
 * so double conversion cannot happen and the charged amount (SAR) is never affected.
 *
 *   displayed = round(SAR × rate, minor units of the target currency)
 */

export const BASE_CURRENCY = 'SAR';

/** ISO 4217 minor units that differ from 2. Others fall back to Intl, then 2. */
const MINOR_UNITS: Record<string, number> = { JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, JOD: 3, IQD: 3, LYD: 3, TND: 3 };

/** Arabic abbreviations used on Arabic pages (the existing "ر.س" style); other currencies show their code. */
const AR_SYMBOL: Record<string, string> = {
  SAR: 'ر.س',
  AED: 'د.إ',
  KWD: 'د.ك',
  QAR: 'ر.ق',
  BHD: 'د.ب',
  OMR: 'ر.ع.',
  JOD: 'د.أ',
  EGP: 'ج.م',
  MAD: 'د.م.',
};

export function minorUnits(code: string): number {
  if (code in MINOR_UNITS) return MINOR_UNITS[code];
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(lang: Lang, digits: number) {
  const key = `${lang}:${digits}`;
  let f = numberFormats.get(key);
  if (!f) {
    // Q11: Arabic pages use Western digits (matches lib/format.ts).
    f = new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(key, f);
  }
  return f;
}

/** A usable rate: finite and positive. */
export const validRate = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0;

/**
 * SAR halalas → formatted price in `code`, using `rate` (1 SAR = rate × code).
 * Falls back to SAR whenever the rate is missing or invalid, so a price is never shown wrong.
 * SAR output is identical to lib/format.ts formatPrice: "SAR 149.00" / "149.00 ر.س".
 */
export function formatMoney(halalas: number, code: string, rate: number | undefined, lang: Lang): string {
  const useBase = code === BASE_CURRENCY || !validRate(rate);
  const cur = useBase ? BASE_CURRENCY : code;
  const digits = useBase ? 2 : minorUnits(cur);
  const amount = useBase ? halalas / 100 : (halalas / 100) * (rate as number);
  const n = numberFormat(lang, digits).format(amount);
  return lang === 'ar' ? `${n} ${AR_SYMBOL[cur] ?? cur}` : `${cur} ${n}`;
}

/** Currency symbol for the selector (e.g. "$", "€", "Rs"); the code when the browser has none. */
export function currencySymbol(code: string, lang: Lang): string {
  if (lang === 'ar' && AR_SYMBOL[code]) return AR_SYMBOL[code];
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

const nameFormats: Partial<Record<Lang, Intl.DisplayNames | null>> = {};
/** Localised currency name ("US Dollar" / "دولار أمريكي"); the code when unavailable. */
export function currencyName(code: string, lang: Lang): string {
  if (!(lang in nameFormats)) {
    try {
      nameFormats[lang] = new Intl.DisplayNames([lang === 'ar' ? 'ar' : 'en'], { type: 'currency' });
    } catch {
      nameFormats[lang] = null;
    }
  }
  try {
    return nameFormats[lang]?.of(code) ?? code;
  } catch {
    return code;
  }
}
