import { describe, expect, it } from 'vitest';
import { codEligibility, deliveryFeeFor, normalizeCity } from '../../src/modules/orders/delivery-rules';

describe('delivery fee rules', () => {
  it('free delivery across KSA by default (Q25)', () => {
    expect(deliveryFeeFor(null, 5000)).toBe(0);
    expect(deliveryFeeFor({ freeDelivery: true, deliveryFee: 2500 }, 5000)).toBe(0);
  });
  it('charges the fee when free delivery is off', () => {
    expect(deliveryFeeFor({ freeDelivery: false, deliveryFee: 2500 }, 5000)).toBe(2500);
  });
  it('waives the fee from the threshold', () => {
    const c = { freeDelivery: false, deliveryFee: 2500, freeDeliveryThreshold: 20000 };
    expect(deliveryFeeFor(c, 19999)).toBe(2500);
    expect(deliveryFeeFor(c, 20000)).toBe(0);
  });
});

describe('cash on delivery rules', () => {
  it('disabled unless enabled', () => {
    expect(codEligibility({}, 1000).reason).toBe('disabled');
    expect(codEligibility({ codEnabled: true }, 1000).available).toBe(true);
  });
  it('minimum and maximum order totals', () => {
    const c = { codEnabled: true, codMinOrderTotal: 5000, codMaxOrderTotal: 100000 };
    expect(codEligibility(c, 4999).reason).toBe('below_min');
    expect(codEligibility(c, 5000).available).toBe(true);
    expect(codEligibility(c, 100001).reason).toBe('above_max');
  });
  it('city list matches Arabic and English spellings loosely', () => {
    const c = { codEnabled: true, codAllowedCities: ['Riyadh', 'الرياض', 'Jeddah'] };
    expect(codEligibility(c, 1000, ' riyadh ').available).toBe(true);
    expect(codEligibility(c, 1000, 'الرياض').available).toBe(true);
    expect(codEligibility(c, 1000, 'Dammam').reason).toBe('city');
    // City not typed yet (cart page): the city rule waits for checkout.
    expect(codEligibility(c, 1000).available).toBe(true);
  });
  it('normalises Arabic letter variants and the al- prefix', () => {
    expect(normalizeCity('المدينة المنورة')).toBe(normalizeCity('مدينة المنوره'));
    expect(normalizeCity('Al-Khobar')).toBe(normalizeCity('khobar'));
  });
});
