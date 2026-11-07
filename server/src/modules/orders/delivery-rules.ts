/**
 * Delivery fee and cash-on-delivery eligibility — pure rules (unit tested), applied by the
 * server-side quote and checkout. All amounts in halalas.
 */
export type CommerceRules = {
  freeDelivery?: boolean | null;
  deliveryFee?: number | null;
  freeDeliveryThreshold?: number | null;
  shippingAvailable?: boolean | null;
  codEnabled?: boolean | null;
  codFee?: number | null;
  codMinOrderTotal?: number | null;
  codMaxOrderTotal?: number | null;
  codAllowedCities?: string[] | null;
};

/** Q25: free delivery everywhere; otherwise the fee, waived from the optional threshold. */
export function deliveryFeeFor(c: CommerceRules | null | undefined, goodsTotal: number): number {
  if (!c || c.freeDelivery !== false) return 0;
  const threshold = c.freeDeliveryThreshold;
  if (threshold != null && threshold > 0 && goodsTotal >= threshold) return 0;
  return Math.max(0, c.deliveryFee ?? 0);
}

/** Lower-case, trims, folds Arabic letter variants (أ/إ/آ→ا, ة→ه, ى→ي) and strips "al-"/"ال" prefixes. */
export function normalizeCity(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // harakat, tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/^(al[\s-]+|ال)/, '')
    .replace(/[\s\-_.]+/g, ' ');
}

/**
 * Arabic and common English spellings of the cities the checkout suggests, so a city listed in a
 * zone (or the COD city list) in one language matches a customer who typed it in the other.
 * Cities not listed here still match on their own spelling (normalizeCity).
 */
const CITY_NAMES: string[][] = [
  ['Riyadh', 'الرياض'],
  ['Jeddah', 'Jiddah', 'جدة'],
  ['Makkah', 'Mecca', 'Makkah Al Mukarramah', 'مكة', 'مكة المكرمة'],
  ['Madinah', 'Medina', 'Al Madinah Al Munawwarah', 'المدينة', 'المدينة المنورة'],
  ['Dammam', 'الدمام'],
  ['Khobar', 'الخبر'],
  ['Dhahran', 'الظهران'],
  ['Taif', 'الطائف'],
  ['Tabuk', 'تبوك'],
  ['Abha', 'أبها'],
  ['Khamis Mushait', 'Khamis Mushayt', 'خميس مشيط'],
  ['Buraidah', 'Buraydah', 'بريدة'],
  ['Hail', "Ha'il", 'حائل'],
  ['Jazan', 'Jizan', 'جازان', 'جيزان'],
  ['Najran', 'نجران'],
  ['Al Ahsa', 'Al Hasa', 'Hofuf', 'Al Hofuf', 'الأحساء', 'الهفوف'],
  ['Jubail', 'الجبيل'],
  ['Yanbu', 'ينبع'],
  ['Al Kharj', 'الخرج'],
  ['Qatif', 'القطيف'],
];
const CITY_ALIASES = new Map<string, string>();
for (const names of CITY_NAMES) {
  const canonical = normalizeCity(names[0]);
  for (const n of names) CITY_ALIASES.set(normalizeCity(n), canonical);
}

/** normalizeCity + the Arabic/English alias table: الرياض, Riyadh and "Al-Riyadh" are one city. */
export function canonicalCity(city: string): string {
  const n = normalizeCity(city).replace(/'/g, '');
  return CITY_ALIASES.get(n) ?? CITY_ALIASES.get(normalizeCity(city)) ?? n;
}

export type CodDecision = { available: boolean; reason: '' | 'disabled' | 'below_min' | 'above_max' | 'city' };

/**
 * COD availability. When no city is known yet (cart page), the city rule is not applied; the
 * checkout always re-checks with the delivery city.
 */
export function codEligibility(c: CommerceRules | null | undefined, orderTotal: number, city?: string | null): CodDecision {
  if (!c?.codEnabled) return { available: false, reason: 'disabled' };
  if (c.codMinOrderTotal != null && orderTotal < c.codMinOrderTotal) return { available: false, reason: 'below_min' };
  if (c.codMaxOrderTotal != null && orderTotal > c.codMaxOrderTotal) return { available: false, reason: 'above_max' };
  const cities = (c.codAllowedCities ?? []).map(canonicalCity).filter(Boolean);
  if (cities.length && city && city.trim() && !cities.includes(canonicalCity(city))) return { available: false, reason: 'city' };
  return { available: true, reason: '' };
}

/** A delivery zone (Admin → Settings → Shipping). Amounts in halalas. */
export type ShippingZone = {
  key: string;
  name?: { ar?: string; en?: string } | null;
  active?: boolean | null;
  cities?: string[] | null;
  freeDelivery?: boolean | null;
  deliveryFee?: number | null;
  freeDeliveryThreshold?: number | null;
  codEnabled?: boolean | null;
  /** Empty = the store-wide COD fee. */
  codFee?: number | null;
  estimatedDelivery?: { ar?: string; en?: string } | null;
};

export type ZoneRules = CommerceRules & { shippingZones?: ShippingZone[] | null; deliverToUnlistedCities?: boolean | null };

export type ZoneDecision = {
  /** The rules to price this delivery with (store-wide rules with the zone's values applied). */
  rules: CommerceRules;
  zone: ShippingZone | null;
  /** '' = deliverable; 'paused' = shipping paused store-wide; 'city' = city outside every zone and unlisted cities are not served. */
  unavailable: '' | 'paused' | 'city';
};

/** The active zone that lists `city` (Arabic/English spellings matched loosely), if any. */
export function zoneForCity(zones: ShippingZone[] | null | undefined, city?: string | null): ShippingZone | null {
  if (!city || !city.trim()) return null;
  const n = canonicalCity(city);
  return (zones ?? []).find((z) => z.active !== false && (z.cities ?? []).some((c) => canonicalCity(c) === n)) ?? null;
}

/**
 * Applies the delivery zone for `city`. Store-wide rules stay authoritative where they restrict:
 * the shipping pause, the COD master switch, COD min/max order totals and the COD city list. A
 * zone sets its own delivery fee / free-delivery rule, can turn COD off (never on, if the store
 * has COD off) and can set its own COD fee. Without zones, or before the city is known (cart
 * page), the store-wide rules apply unchanged.
 */
export function resolveDelivery(c: ZoneRules | null | undefined, city?: string | null): ZoneDecision {
  const base: CommerceRules = c ?? {};
  if (c?.shippingAvailable === false) return { rules: base, zone: null, unavailable: 'paused' };
  const zone = zoneForCity(c?.shippingZones, city);
  if (!zone) {
    const hasZones = (c?.shippingZones ?? []).some((z) => z.active !== false);
    const cityKnown = Boolean(city && city.trim());
    if (hasZones && cityKnown && c?.deliverToUnlistedCities === false) return { rules: base, zone: null, unavailable: 'city' };
    return { rules: base, zone: null, unavailable: '' };
  }
  return {
    zone,
    unavailable: '',
    rules: {
      ...base,
      freeDelivery: zone.freeDelivery === true,
      deliveryFee: zone.deliveryFee ?? 0,
      freeDeliveryThreshold: zone.freeDeliveryThreshold ?? null,
      codEnabled: Boolean(base.codEnabled) && zone.codEnabled !== false,
      codFee: zone.codFee ?? base.codFee ?? 0,
    },
  };
}
