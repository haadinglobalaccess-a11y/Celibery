import type { Lang, Localized } from './types';

/**
 * Q11: Arabic pages use Western digits (0–9) to match model numbers and specs.
 * The `-u-nu-latn` extension forces Latin digits in the Arabic locale.
 */
const numberFormats: Record<Lang, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  en: new Intl.NumberFormat('en-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
const intFormats: Record<Lang, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat('ar-SA-u-nu-latn'),
  en: new Intl.NumberFormat('en-SA'),
};

/**
 * halalas → "149.00 ر.س" / "SAR 149.00" — always SAR, the currency orders are quoted and charged in.
 * Used for the admin, placed orders, refunds and payment amounts. Storefront catalogue/cart prices
 * use useMoney() (state/currency.ts), which shows them in the visitor's display currency.
 */
export function formatPrice(halalas: number, lang: Lang) {
  const n = numberFormats[lang].format(halalas / 100);
  return lang === 'ar' ? `${n} ر.س` : `SAR ${n}`;
}

export const formatInt = (n: number, lang: Lang) => intFormats[lang].format(n);

export function formatDate(iso: string | Date | undefined, lang: Lang, withTime = false) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

/** Picks the text for the current language. Falls back to the other language only if empty. */
export function L(v: Localized | undefined | null, lang: Lang) {
  if (!v) return '';
  return v[lang] || v[lang === 'ar' ? 'en' : 'ar'] || '';
}

/** Arabic for common colour names, used only when a product's colour has no Arabic name in the Admin. */
const AR_COLOURS: Record<string, string> = {
  black: 'أسود', white: 'أبيض', grey: 'رمادي', gray: 'رمادي', silver: 'فضي', gold: 'ذهبي', blue: 'أزرق', navy: 'كحلي', red: 'أحمر',
  green: 'أخضر', pink: 'وردي', rose: 'وردي', orange: 'برتقالي', purple: 'بنفسجي', yellow: 'أصفر', brown: 'بني', beige: 'بيج',
  lilac: 'ليلكي', lavender: 'لافندر', coral: 'مرجاني', olive: 'زيتوني', ivory: 'عاجي', charcoal: 'فحمي', graphite: 'جرافيتي',
  gunmetal: 'رمادي معدني', midnight: 'كحلي داكن', champagne: 'شامبانيا', sand: 'رملي', teal: 'أزرق مخضر', turquoise: 'فيروزي', cyan: 'سماوي',
  'navy blue': 'كحلي', 'sky blue': 'أزرق سماوي', 'space grey': 'رمادي فلكي', 'space gray': 'رمادي فلكي', 'matte black': 'أسود مطفي',
  'midnight black': 'أسود داكن', 'pearl white': 'أبيض لؤلؤي', 'ivory white': 'أبيض عاجي', 'silver white': 'أبيض فضي', 'sand beige': 'بيج رملي',
  'rose pink': 'وردي', 'olive green': 'أخضر زيتوني', 'sage green': 'أخضر مريمي', 'champagne gold': 'ذهبي شامبانيا', 'rose gold': 'ذهبي وردي',
};

/** A colour's name in the active language; in Arabic, a common English colour name is translated when the Arabic name is empty. */
export function colourName(name: Localized | undefined | null, lang: Lang, key?: string) {
  if (lang === 'ar' && !name?.ar?.trim()) {
    const en = (name?.en || key || '').trim();
    const parts = en.split('/').map((x) => AR_COLOURS[x.trim().toLowerCase().replace(/\s+/g, ' ')]);
    if (en && parts.every(Boolean)) return parts.join(' / ');
  }
  return L(name, lang) || key || '';
}

/** List separator for the active language: the Arabic comma in Arabic, ", " in English. */
export function listSep(lang: Lang) {
  return lang === 'ar' ? '، ' : ', ';
}

export function connectorLabel(key: string, lang: Lang) {
  const map: Record<string, [string, string]> = {
    'usb-c': ['USB-C', 'USB-C'],
    'usb-a': ['USB-A', 'USB-A'],
    lightning: ['لايتنينج', 'Lightning'],
    'micro-usb': ['مايكرو USB', 'Micro-USB'],
    magsafe: ['مغناطيسي (MagSafe)', 'Magnetic (MagSafe)'],
    wireless: ['لاسلكي', 'Wireless'],
    'aux-3.5mm': ['AUX 3.5 مم', '3.5mm AUX'],
    bluetooth: ['بلوتوث', 'Bluetooth'],
    'car-12v': ['ولاعة السيارة 12V', 'Car 12V socket'],
    other: ['أخرى', 'Other'],
  };
  const v = map[key];
  return v ? v[lang === 'ar' ? 0 : 1] : key;
}

export function placeholderFor(categorySlug?: string) {
  const known = ['headphones', 'power-banks', 'car-essentials', 'cables', 'charging-adapters', 'tech-essentials'];
  return `/placeholders/${known.includes(categorySlug ?? '') ? categorySlug : 'tech-essentials'}.svg`;
}
