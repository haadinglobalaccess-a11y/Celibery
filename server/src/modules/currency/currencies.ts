/**
 * Display currencies and the country → currency map used by automatic currency detection.
 *
 * CELIBERY prices are stored, quoted and charged in SAR (halalas). Every other currency here is a
 * DISPLAY currency only: prices are converted in the browser from the SAR amount with the rates in
 * rates.service.ts. Nothing in this module touches product prices, orders or payments.
 *
 * Adding a country or currency: add the ISO 4217 code to DISPLAY_CURRENCIES (it must be offered by
 * the exchange-rate provider) and the ISO 3166-1 alpha-2 codes that use it to COUNTRY_CURRENCY.
 * A country that is not listed (or whose currency is not offered) is shown SAR.
 */

export const BASE_CURRENCY = 'SAR' as const;

/** Offered display currencies, in the order the storefront selector lists them. */
export const DISPLAY_CURRENCIES = [
  'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR',
  'USD', 'EUR', 'GBP', 'PKR', 'INR', 'CAD', 'AUD', 'TRY', 'JPY', 'CNY', 'CHF', 'SGD', 'MYR',
  'EGP', 'JOD', 'MAD', 'BDT', 'LKR', 'NPR', 'IDR', 'PHP', 'THB', 'KRW', 'HKD', 'NZD', 'ZAR',
  'SEK', 'NOK', 'DKK', 'PLN', 'NGN', 'KES', 'BRL', 'MXN',
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

const DISPLAY_SET = new Set<string>(DISPLAY_CURRENCIES);
export const isDisplayCurrency = (code: string): code is DisplayCurrency => DISPLAY_SET.has(code);

/** Countries grouped by the official currency they use (ISO 4217 → ISO 3166-1 alpha-2). */
const COUNTRIES_BY_CURRENCY: Record<DisplayCurrency, string[]> = {
  SAR: ['SA'],
  AED: ['AE'],
  KWD: ['KW'],
  QAR: ['QA'],
  BHD: ['BH'],
  OMR: ['OM'],
  USD: ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'EC', 'SV', 'PA', 'TL', 'FM', 'MH', 'PW', 'BQ', 'TC', 'VG', 'IO'],
  EUR: [
    'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
    'AD', 'MC', 'SM', 'VA', 'ME', 'XK', 'GF', 'GP', 'MQ', 'RE', 'YT', 'PM', 'BL', 'MF', 'AX',
  ],
  GBP: ['GB', 'IM', 'JE', 'GG'],
  PKR: ['PK'],
  INR: ['IN'],
  CAD: ['CA'],
  AUD: ['AU', 'CX', 'CC', 'NF', 'KI', 'NR', 'TV'],
  TRY: ['TR'],
  JPY: ['JP'],
  CNY: ['CN'],
  CHF: ['CH', 'LI'],
  SGD: ['SG'],
  MYR: ['MY'],
  EGP: ['EG'],
  JOD: ['JO'],
  MAD: ['MA'],
  BDT: ['BD'],
  LKR: ['LK'],
  NPR: ['NP'],
  IDR: ['ID'],
  PHP: ['PH'],
  THB: ['TH'],
  KRW: ['KR'],
  HKD: ['HK'],
  NZD: ['NZ'],
  ZAR: ['ZA'],
  SEK: ['SE'],
  NOK: ['NO', 'SJ', 'BV'],
  DKK: ['DK', 'GL', 'FO'],
  PLN: ['PL'],
  NGN: ['NG'],
  KES: ['KE'],
  BRL: ['BR'],
  MXN: ['MX'],
};

export const COUNTRY_CURRENCY: Readonly<Record<string, DisplayCurrency>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(COUNTRIES_BY_CURRENCY) as [DisplayCurrency, string[]][]).flatMap(([currency, countries]) => countries.map((c) => [c, currency])),
  ),
);

/** Normalises a country code to ISO 3166-1 alpha-2, or null (unknown, "XX", Tor "T1", malformed). */
export function normaliseCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const c = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'ZZ') return null;
  return c;
}

/** Display currency for a country, or null when the country is unknown or its currency is not offered. */
export function currencyForCountry(country: string | null | undefined): DisplayCurrency | null {
  const c = normaliseCountry(country);
  return c ? (COUNTRY_CURRENCY[c] ?? null) : null;
}
