/**
 * Regression suite for production-audit/14_RISK_REGISTER.md (27 Nov 2026):
 *  - H-01 payment webhooks work WITHOUT the browser CSRF header (gateways never send it);
 *         every other state-changing request still needs it
 *  - H-02 the Moyasar webhook callback uses PUBLIC_API_URL when the API is a separate service
 *  - M-01 refunds (and manual refund resolution) need a recent password proof
 *  - L-04 parallel wrong passwords still lock the account
 *  - mfa/disable: a valid fresh code is required (no replay of the enabling code)
 *
 * Requests here use bare supertest (no default headers) on purpose: the shared client() helper adds
 * X-Requested-With to every call, which is exactly what hid H-01 (M-04).
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { moyasarProvider } from '../src/integrations/payments/moyasar';
import { base32Decode, hotp, totpStep } from '../src/lib/totp';
import { REAUTH_WINDOW_MINUTES } from '../src/middleware/auth';
import { hashPassword } from '../src/modules/auth/auth.service';
import { Order, Payment, Product, Role, Session, User } from '../src/models';
import { address, app, client, contact, uid, useDatabase } from './helpers';

useDatabase();

const PASSWORD = 'Passw0rd!x';
const mutableEnv = env as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
  mutableEnv.MOYASAR_WEBHOOK_SECRET = '';
  mutableEnv.MOYASAR_SECRET_KEY = '';
  mutableEnv.TABBY_WEBHOOK_SECRET = '';
  mutableEnv.PUBLIC_API_URL = '';
});

async function superAdmin() {
  const email = `owner-${crypto.randomBytes(3).toString('hex')}@test.local`;
  const role = await Role.findOne({ key: 'admin' }).lean();
  const user = await User.create({ type: 'staff', name: 'Owner', email, passwordHash: await hashPassword(PASSWORD), role: role!._id });
  const c = client();
  expect((await c.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return { c, id: String(user._id) };
}

async function ageSessions(userId: string) {
  const past = new Date(Date.now() - (REAUTH_WINDOW_MINUTES + 5) * 60_000);
  await Session.collection.updateMany({ user: new mongoose.Types.ObjectId(userId) }, { $set: { createdAt: past }, $unset: { reauthAt: '' } });
}

describe('H-01 webhooks are exempt from the CSRF header; nothing else is', () => {
  it('a Moyasar webhook without X-Requested-With reaches the handler and confirms the order', async () => {
    mutableEnv.MOYASAR_WEBHOOK_SECRET = 'whsec';
    mutableEnv.MOYASAR_SECRET_KEY = 'sk_test_x';
    const p = await Product.findOne({ sku: 'DEMO-AD-30W' }).lean();
    const r = await client().post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: String(p!._id), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card' });
    expect(r.status).toBe(201);
    const order = (await Order.findOne({ orderNumber: r.body.data.order.orderNumber }).lean())!;
    await Payment.updateMany({ order: order._id }, { $set: { provider: 'moyasar', providerRef: 'inv_nohdr_1' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'inv_nohdr_1', status: 'paid', amount: order.total, currency: 'SAR', payments: [] }))));

    // Wrong secret: refused by the webhook handler itself (not by the CSRF guard).
    const bad = await request(app).post('/api/webhooks/moyasar').send({ id: 'evt_nohdr_0', secret_token: 'wrong', data: { invoice_id: 'inv_nohdr_1' } });
    expect(bad.status).toBe(403);
    expect(bad.body.error.message).toBe('Invalid webhook signature');

    const ok = await request(app).post('/api/webhooks/moyasar').send({ id: 'evt_nohdr_1', secret_token: 'whsec', data: { invoice_id: 'inv_nohdr_1' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.result).toBe('paid');
    expect((await Order.findById(order._id).lean())!).toMatchObject({ paymentStatus: 'paid', status: 'confirmed' });
  });

  it('a Tabby webhook without X-Requested-With is judged by its own secret', async () => {
    mutableEnv.TABBY_WEBHOOK_SECRET = 'tabsec';
    const r = await request(app).post('/api/webhooks/tabby').set('X-Celibery-Webhook-Secret', 'wrong').send({ id: 'tabby_x', status: 'authorized' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe('Invalid webhook signature');
  });

  it('every other state-changing API request still needs the header', async () => {
    for (const path of ['/api/checkout', '/api/auth/login', '/api/cart/quote', '/api/webhooksx/moyasar']) {
      const r = await request(app).post(path).send({});
      expect(r.status, path).toBe(403);
      expect(r.body.error.message, path).toBe('Missing or invalid request header');
    }
  });
});

describe('H-02 webhook callback URL', () => {
  const initiate = async () => {
    mutableEnv.MOYASAR_SECRET_KEY = 'sk_test_x';
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ id: 'inv_cb', status: 'initiated', amount: 100, currency: 'SAR', url: 'https://checkout.moyasar.com/invoices/inv_cb' }));
      }),
    );
    await moyasarProvider.initiate({
      paymentId: 'p1', orderNumber: 'CEL-100001', amount: 100, currency: 'SAR', method: 'card', lang: 'en', description: 'd',
      returnUrl: 'https://shop.example/r', cancelUrl: 'https://shop.example/c', customer: { name: 'n', email: 'e@x.test', phone: '0551234567' },
      shippingAddress: { city: 'Riyadh', street: 's', district: 'd' }, items: [],
    });
    return String(sent.callback_url);
  };

  it('uses the site origin when the API shares it, and PUBLIC_API_URL when the API is separate', async () => {
    expect(await initiate()).toBe(`${env.PUBLIC_SITE_URL.replace(/\/+$/, '')}/api/webhooks/moyasar`);
    mutableEnv.PUBLIC_API_URL = 'https://api.example.test/';
    expect(await initiate()).toBe('https://api.example.test/api/webhooks/moyasar');
  });
});

describe('M-01 refunds need step-up re-authentication', () => {
  it('an old staff session cannot refund or resolve a refund until the password is re-entered', async () => {
    const { c, id } = await superAdmin();
    const orderId = new mongoose.Types.ObjectId().toString();
    const refundId = new mongoose.Types.ObjectId().toString();
    const refund = () => c.post(`/api/admin/orders/${orderId}/refund`).send({ amount: 100, reason: 'Test refund' });
    const resolve = () => c.post(`/api/admin/orders/${orderId}/refunds/${refundId}/resolve`).send({ outcome: 'failed', note: 'checked dashboard' });

    // Fresh sign-in: passes the gate (the order does not exist → 404).
    expect((await refund()).status).toBe(404);

    await ageSessions(id);
    for (const r of [await refund(), await resolve()]) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('REAUTH_REQUIRED');
    }
    // Reading the refund ledger stays available.
    expect((await c.get(`/api/admin/orders/${orderId}/refunds`)).status).toBe(404);

    expect((await c.post('/api/auth/reauth').send({ password: PASSWORD })).status).toBe(200);
    expect((await refund()).status).toBe(404);
  });
});

describe('L-04 lock-out under parallel guesses', () => {
  it('parallel wrong passwords lock the account; the right password is then refused until it expires', async () => {
    const email = `parallel-${crypto.randomBytes(3).toString('hex')}@test.local`;
    await User.create({ type: 'customer', name: 'Parallel', email, passwordHash: await hashPassword(PASSWORD) });
    await Promise.all(Array.from({ length: 8 }, () => client().post('/api/auth/login').send({ email, password: 'wrong-password-1' })));
    const u = (await User.findOne({ email }).select('+lockUntil').lean())!;
    expect(u.lockUntil && u.lockUntil > new Date()).toBe(true);
    const right = await client().post('/api/auth/login').send({ email, password: PASSWORD });
    expect(right.status).toBe(401);
    expect(right.body.error.details.reason).toBe('locked');
  });
});

describe('mfa/disable', () => {
  it('refuses the code that enabled 2FA and accepts a fresh one', async () => {
    const { c } = await superAdmin();
    const secret = (await c.post('/api/auth/mfa/setup').send({ password: PASSWORD })).body.data.secret as string;
    const step = totpStep();
    expect((await c.post('/api/auth/mfa/enable').send({ code: hotp(base32Decode(secret), step) })).status).toBe(200);

    const replay = await c.post('/api/auth/mfa/disable').send({ password: PASSWORD, code: hotp(base32Decode(secret), step) });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_CODE');

    const fresh = await c.post('/api/auth/mfa/disable').send({ password: PASSWORD, code: hotp(base32Decode(secret), step + 1) });
    expect(fresh.status).toBe(200);
  });
});
