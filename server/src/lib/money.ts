/**
 * All monetary amounts are stored and calculated as integer halalas (1 SAR = 100 halalas)
 * to avoid floating-point rounding errors. Conversion to SAR happens only for display.
 */
export const toHalalas = (sar: number) => Math.round(sar * 100);
export const toSar = (halalas: number) => halalas / 100;

/** VAT contained in a VAT-inclusive amount (Saudi retail prices are shown VAT-inclusive). */
export function vatIncluded(totalHalalas: number, ratePercent: number) {
  if (!ratePercent) return 0;
  return Math.round((totalHalalas * ratePercent) / (100 + ratePercent));
}

export function formatSar(halalas: number) {
  return `${(halalas / 100).toFixed(2)} SAR`;
}
