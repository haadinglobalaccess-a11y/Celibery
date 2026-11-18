import { describe, expect, it } from 'vitest';
import { Discount, Product } from '../src/models';
import { client, createCustomer, useDatabase } from './helpers';

/**
 * Machine-readable reasons the storefront needs to word errors in Arabic or English. The English
 * `message` / `discountError` stay exactly as before (backward compatible); amounts are unchanged.
 */
useDatabase();
const c = client();

describe('localizable error reasons', () => {
  it('sign-in failures carry a reason (same message as before)', async () => {
    const { email } = await createCustomer();
    const r = await client().post('/api/auth/login').send({ email, password: 'Wrong-pass-123' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Incorrect email or password', details: { reason: 'invalid' } });
    const unknown = await client().post('/api/auth/login').send({ email: 'nobody@test.local', password: 'Wrong-pass-123' });
    expect(unknown.body.error.details).toEqual({ reason: 'invalid' }); // no account enumeration
  });

  it('discount problems carry a code; totals are unaffected', async () => {
    const p = (await Product.findOne({ sku: 'DEMO-AD-30W' }).lean())!;
    const items = [{ productId: String(p._id), quantity: 1 }];
    await Discount.create([
      { code: 'L10N-OLD', type: 'percent', value: 10, endsAt: new Date(Date.now() - 86_400_000) },
      { code: 'L10N-SOON', type: 'percent', value: 10, startsAt: new Date(Date.now() + 86_400_000) },
      { code: 'L10N-MIN', type: 'fixed', value: 500, minOrderTotal: 1_000_000 },
      { code: 'L10N-USED', type: 'fixed', value: 500, usageLimit: 1, usedCount: 1 },
    ]);
    const quote = async (discountCode: string) => (await c.post('/api/cart/quote').send({ items, discountCode })).body.data;
    const plain = (await c.post('/api/cart/quote').send({ items })).body.data;
    for (const [code, reason] of [
      ['NOPE-123', 'invalid'],
      ['L10N-OLD', 'expired'],
      ['L10N-SOON', 'not_active'],
      ['L10N-USED', 'usage_limit'],
    ]) {
      const q = await quote(code);
      expect(q.discountErrorCode, code).toBe(reason);
      expect(q.discountError).toBeTruthy();
      expect(q.total).toBe(plain.total);
    }
    const min = await quote('L10N-MIN');
    expect(min).toMatchObject({ discountErrorCode: 'min_order', discountMinOrder: 1_000_000, discountError: 'Minimum order for this code is 10000.00 SAR' });
    expect(plain).toMatchObject({ discountError: null, discountErrorCode: null, discountMinOrder: null });
  });
});
