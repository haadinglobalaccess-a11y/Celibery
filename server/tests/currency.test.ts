import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { Order, Payment, Product } from '../src/models';
import { __resetRatesForTests, __setRatesFetchForTests } from '../src/modules/currency/rates.service';
import { address, client, contact, uid, useDatabase } from './helpers';

/**
 * Display currency end to end through the real API: detection + rates for the storefront, and proof
 * that it changes nothing about stored prices, quotes, orders or payment amounts (all SAR).
 */
useDatabase();
const c = client();
const mutableEnv = env as unknown as Record<string, string>;
const RATES = { SAR: 1, USD: 0.2667, PKR: 74.2, EUR: 0.2301, GBP: 0.2011, AED: 0.9793, INR: 22.4, KWD: 0.0819, QAR: 0.9707, BHD: 0.1003, OMR: 0.1026 };
let providerUp = true;

beforeAll(() => {
  mutableEnv.EXCHANGE_RATE_API_URL = 'https://rates.test/{base}';
  mutableEnv.GEO_COUNTRY_HEADER = 'x-test-country'; // stands in for a trusted CDN header
  __setRatesFetchForTests(() =>
    providerUp
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: 'success', base_code: 'SAR', rates: RATES }) })
      : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
  );
});
afterEach(() => {
  providerUp = true;
});
afterAll(() => {
  mutableEnv.EXCHANGE_RATE_API_URL = '';
  mutableEnv.GEO_COUNTRY_HEADER = '';
  __setRatesFetchForTests(null);
  __resetRatesForTests();
});

const context = (country?: string) => {
  const r = c.get('/api/currency/context');
  return country ? r.set('X-Test-Country', country) : r;
};

describe('GET /api/currency/context', () => {
  it.each([
    ['PK', 'PKR'], ['US', 'USD'], ['SA', 'SAR'], ['AE', 'AED'], ['GB', 'GBP'], ['DE', 'EUR'],
    ['IN', 'INR'], ['KW', 'KWD'], ['QA', 'QAR'], ['BH', 'BHD'], ['OM', 'OMR'],
  ])('visitor from %s gets %s', async (country, currency) => {
    const r = await context(country);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ base: 'SAR', country, countrySource: 'header', currency });
    expect(r.body.data.rates[currency]).toBeGreaterThan(0);
    expect(r.headers['cache-control']).toContain('no-store'); // varies per visitor: never shared-cached
  });

  it('detection failure → SAR', async () => {
    const r = await context();
    expect(r.body.data).toMatchObject({ country: null, currency: 'SAR' });
  });

  it('unsupported country → SAR', async () => {
    const r = await context('AQ');
    expect(r.body.data).toMatchObject({ country: 'AQ', currency: 'SAR' });
  });

  it('persists rates and keeps serving them while the provider is down (new instance, cold memory)', async () => {
    await context('US');
    const stored = await mongoose.connection.db!.collection('exchange_rates').findOne({ _id: 'SAR' as unknown as never });
    expect(stored?.rates.USD).toBe(0.2667);

    __resetRatesForTests(); // a fresh serverless instance
    providerUp = false;
    const r = await context('US');
    expect(r.body.data.currency).toBe('USD');
    expect(r.body.data.rates.USD).toBe(0.2667);
  });

  it('no valid rates anywhere → SAR only', async () => {
    await mongoose.connection.db!.collection('exchange_rates').deleteMany({});
    __resetRatesForTests();
    providerUp = false;
    const r = await context('PK');
    expect(r.body.data).toMatchObject({ currency: 'SAR', rates: { SAR: 1 }, ratesUpdatedAt: null });
  });
});

describe('display currency never touches prices, orders or payments', () => {
  it('product prices in the database, quotes and the charged amount stay SAR', async () => {
    const before = await Product.find({}, { price: 1, compareAtPrice: 1 }).sort({ _id: 1 }).lean();
    for (const country of ['PK', 'US', 'KW']) await context(country);
    const after = await Product.find({}, { price: 1, compareAtPrice: 1 }).sort({ _id: 1 }).lean();
    expect(after).toEqual(before);

    const prod = (await Product.findOne({ sku: 'DEMO-PB-10K' }).lean())!;
    const q = await c.post('/api/cart/quote').set('X-Test-Country', 'PK').send({ items: [{ productId: String(prod._id), quantity: 2 }] });
    expect(q.body.data.subtotal).toBe(prod.price * 2);

    const r = await c
      .post('/api/checkout')
      .set('X-Test-Country', 'US')
      .send({ idempotencyKey: uid(), items: [{ productId: String(prod._id), quantity: 2 }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'en' });
    expect(r.status).toBe(201);
    const order = (await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean())!;
    expect(order.currency).toBe('SAR');
    expect(order.total).toBe(q.body.data.total);
    const payment = await Payment.findOne({ order: order._id }).lean();
    expect(payment?.currency).toBe('SAR');
    expect(payment?.amount).toBe(order.total);
  });
});
