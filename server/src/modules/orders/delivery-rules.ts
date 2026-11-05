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

export type CodDecision = { available: boolean; reason: '' | 'disabled' | 'below_min' | 'above_max' | 'city' };

/**
 * COD availability. When no city is known yet (cart page), the city rule is not applied; the
 * checkout always re-checks with the delivery city.
 */
export function codEligibility(c: CommerceRules | null | undefined, orderTotal: number, city?: string | null): CodDecision {
  if (!c?.codEnabled) return { available: false, reason: 'disabled' };
  if (c.codMinOrderTotal != null && orderTotal < c.codMinOrderTotal) return { available: false, reason: 'below_min' };
  if (c.codMaxOrderTotal != null && orderTotal > c.codMaxOrderTotal) return { available: false, reason: 'above_max' };
  const cities = (c.codAllowedCities ?? []).map(normalizeCity).filter(Boolean);
  if (cities.length && city && city.trim() && !cities.includes(normalizeCity(city))) return { available: false, reason: 'city' };
  return { available: true, reason: '' };
}
