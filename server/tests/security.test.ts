/**
 * Security regression suite (CELIBERY_COMPLETE_SECURITY_AUDIT.md). Each block names the finding
 * it guards. Runs against the in-memory replica set like every other API test.
 */
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env, jwtSecret } from '../src/config/env';
import { logger } from '../src/lib/logger';
import { MongoRateLimitStore } from '../src/lib/rate-limit-store';
import { redact } from '../src/lib/redact';
import { base32Decode, hotp, totpStep } from '../src/lib/totp';
import { Order, Payment, Product, Role, Session, Settings, User } from '../src/models';
import { applyGatewayStatus } from '../src/modules/payments/payment.service';
import { address, app, client, contact, createCustomer, createStaff, uid, useDatabase } from './helpers';

useDatabase();
beforeAll(async () => {
  await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
});

const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);
const cookieOf = (res: request.Response) => String(res.headers['set-cookie'] ?? '').split(';')[0];

async function guestOrder(paymentMethod: 'cod' | 'card' = 'cod') {
  const r = await client().post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact, shippingAddress: address, paymentMethod, lang: 'en' });
  expect(r.status).toBe(201);
  return r.body.data as { order: { orderNumber: string; id: string; total: number }; accessToken: string; redirectUrl: string | null };
}

describe('authentication required (broken authentication)', () => {
  it('rejects anonymous access to account, order history and admin APIs', async () => {
    const c = client();
    for (const path of ['/api/me/addresses', '/api/me/wishlist', '/api/me/orders', '/api/admin/orders', '/api/admin/settings', '/api/admin/staff', '/api/auth/mfa']) {
      expect((await c.get(path)).status, path).toBe(401);
    }
    expect((await c.post('/api/auth/change-password').send({ currentPassword: 'x', newPassword: 'Newpass123' })).status).toBe(401);
  });

  it('a customer session cannot reach any admin API', async () => {
    const { c } = await createCustomer();
    for (const path of ['/api/admin/orders', '/api/admin/customers', '/api/admin/settings', '/api/admin/integrations', '/api/admin/audit']) {
      expect((await c.get(path)).status, path).toBe(403);
    }
  });
});

describe('object-level authorization (IDOR / BOLA)', () => {
  it('a customer cannot read, track or return another customer’s order', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const r = await a.c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email: a.email }, shippingAddress: address, paymentMethod: 'cod' });
    expect(r.status).toBe(201);
    const num = r.body.data.order.orderNumber;
    expect((await a.c.get(`/api/orders/${num}`)).status).toBe(200);
    expect((await b.c.get(`/api/orders/${num}`)).status).toBe(404); // existence not revealed
    expect((await b.c.get(`/api/orders/${num}/returns`)).status).toBe(404);
    expect((await b.c.post(`/api/orders/${num}/verify-payment`).send({})).status).toBe(404);
    const mine = await b.c.get('/api/me/orders');
    expect(mine.body.data.map((o: { orderNumber: string }) => o.orderNumber)).not.toContain(num);
  });

  it('a customer cannot edit or delete another customer’s saved address', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const saved = await a.c.post('/api/me/addresses').send({ ...address, label: 'Home' });
    const addrId = saved.body.data[0]._id;
    expect((await b.c.put(`/api/me/addresses/${addrId}`).send({ ...address, street: 'Hijacked' })).status).toBe(404);
    expect((await b.c.delete(`/api/me/addresses/${addrId}`)).status).toBe(404);
    const still = await a.c.get('/api/me/addresses');
    expect(still.body.data[0].street).toBe(address.street);
  });

  it('a guest order is reachable only with its access token (wrong, array or missing token → 404, never 500)', async () => {
    const { order, accessToken } = await guestOrder();
    const c = client();
    expect((await c.get(`/api/orders/${order.orderNumber}?token=${accessToken}`)).status).toBe(200);
    expect((await c.get(`/api/orders/${order.orderNumber}?token=${'x'.repeat(32)}`)).status).toBe(404);
    expect((await c.get(`/api/orders/${order.orderNumber}?token=a&token=b`)).status).toBe(404);
    expect((await c.get(`/api/orders/${order.orderNumber}`)).status).toBe(404);
  });
});

describe('function-level authorization (staff permissions enforced on the server)', () => {
  it('a content manager cannot read orders, refund, change settings or manage staff', async () => {
    const editor = await createStaff('content_editor');
    const { order } = await guestOrder();
    expect((await editor.get('/api/admin/orders')).status).toBe(403);
    expect((await editor.post(`/api/admin/orders/${order.id}/refund`).send({ amount: 100, reason: 'test' })).status).toBe(403);
    expect((await editor.put('/api/admin/settings').send({ commerce: { codEnabled: false } })).status).toBe(403);
    expect((await editor.get('/api/admin/staff')).status).toBe(403);
    expect((await editor.get('/api/admin/integrations')).status).toBe(403);
  });

  it('an order manager can update orders but cannot issue refunds', async () => {
    const om = await createStaff('order_manager');
    const { order } = await guestOrder();
    expect((await om.get(`/api/admin/orders/${order.id}`)).status).toBe(200);
    expect((await om.post(`/api/admin/orders/${order.id}/refund`).send({ amount: 100, reason: 'test' })).status).toBe(403);
  });
});

describe('privilege escalation through staff management (fixed)', () => {
  it('a custom role holding staff:manage cannot grant or reach permissions it does not have', async () => {
    await Role.create({ key: 'hr_manager', name: { ar: 'موارد', en: 'HR' }, permissions: ['staff:manage', 'customers:read'] });
    const hr = await createStaff('hr_manager');
    const superAdmin = await createStaff('admin');
    const adminRole = await Role.findOne({ key: 'admin' }).lean();
    const superAdminUser = await User.findOne({ type: 'staff', role: adminRole!._id }).lean();

    // Cannot create a role with payment permissions, nor invite someone as Super Administrator.
    expect((await hr.post('/api/admin/staff/roles').send({ key: 'sneaky', name: { ar: 'س', en: 'S' }, permissions: ['payments:manage'] })).status).toBe(403);
    expect((await hr.post('/api/admin/staff').send({ name: 'Mallory', email: 'mallory@test.local', roleId: String(adminRole!._id) })).status).toBe(403);
    // Cannot take over the Super Administrator (reset link, deactivate, 2FA reset).
    expect((await hr.post(`/api/admin/staff/${superAdminUser!._id}/reset-link`).send({})).status).toBe(403);
    expect((await hr.patch(`/api/admin/staff/${superAdminUser!._id}`).send({ active: false })).status).toBe(403);
    expect((await hr.post(`/api/admin/staff/${superAdminUser!._id}/reset-mfa`).send({})).status).toBe(403);
    // Within its own permissions it still works.
    expect((await hr.post('/api/admin/staff/roles').send({ key: 'support_reader', name: { ar: 'د', en: 'Support' }, permissions: ['customers:read'] })).status).toBe(201);
    // The Super Administrator is unaffected.
    expect((await superAdmin.post('/api/admin/staff/roles').send({ key: 'payments_role', name: { ar: 'م', en: 'Payments' }, permissions: ['payments:manage'] })).status).toBe(201);
  });
});

describe('mass assignment and injection', () => {
  it('registration and profile updates ignore privileged fields', async () => {
    const adminRole = await Role.findOne({ key: 'admin' }).lean();
    const c = client();
    const r = await c.post('/api/auth/register').send({ name: 'Eve', email: 'eve@test.local', password: 'Secret123', type: 'staff', role: String(adminRole!._id), active: true, tokenVersion: 9 });
    expect(r.status).toBe(201);
    const u = await User.findOne({ email: 'eve@test.local' }).lean();
    expect(u!.type).toBe('customer');
    expect(u!.role).toBeUndefined();
    await c.patch('/api/me/profile').send({ name: 'Eve 2', email: 'admin@celibery.test', type: 'staff' });
    const after = await User.findOne({ _id: u!._id }).lean();
    expect(after!.email).toBe('eve@test.local');
    expect(after!.type).toBe('customer');
    expect((await c.get('/api/admin/orders')).status).toBe(403);
  });

  it('rejects MongoDB operator and prototype-pollution payloads', async () => {
    const c = client();
    expect((await c.post('/api/auth/login').send({ email: { $ne: '' }, password: { $ne: '' } })).status).toBe(400);
    expect((await c.get('/api/orders/track?orderNumber[$ne]=x&phone=0551234567')).status).toBe(400);
    expect((await c.post('/api/cart/quote').send({ items: [{ productId: { $gt: '' }, quantity: 1 }] })).status).toBe(400);
    expect((await c.post('/api/newsletter').send(JSON.parse('{"email":"a@b.co","__proto__":{"admin":true}}'))).status).toBe(400);
    expect((await c.post('/api/newsletter').send({ email: 'a@b.co', $where: 'sleep(1000)' })).status).toBe(400);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it('refuses protocol-relative and backslash links that browsers treat as another site', async () => {
    const sa = await createStaff('admin');
    for (const link of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', 'https://']) {
      expect((await sa.put('/api/admin/settings').send({ announcement: { link } })).status, link).toBe(400);
    }
    expect((await sa.put('/api/admin/settings').send({ announcement: { link: '/en/shop?sort=newest' } })).status).toBe(200);
    expect((await sa.put('/api/admin/settings').send({ announcement: { link: 'https://celibery.example/offers' } })).status).toBe(200);
  });
});

describe('CSRF and CORS', () => {
  it('state-changing requests without the CSRF header are refused, even when signed in', async () => {
    const { c } = await createCustomer();
    const res = await c.agent.post('/api/me/addresses').send({ ...address, label: 'x' });
    expect(res.status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' })).status).toBe(403);
  });

  it('CORS only answers allowed origins and never with a wildcard', async () => {
    const evil = await request(app).options('/api/auth/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const good = await request(app).options('/api/auth/me').set('Origin', env.CORS_ORIGINS.split(',')[0]).set('Access-Control-Request-Method', 'POST');
    expect(good.headers['access-control-allow-origin']).toBe(env.CORS_ORIGINS.split(',')[0]);
    expect(good.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('server-side sessions (logout really ends the session — fixed)', () => {
  it('a session cookie copied before logout no longer works after logout', async () => {
    const c = client();
    const reg = await c.post('/api/auth/register').send({ name: 'Copy Cat', email: 'copycat@test.local', password: 'Secret123' });
    const stolen = cookieOf(reg);
    expect((await request(app).get('/api/auth/me').set('Cookie', stolen)).body.data.email).toBe('copycat@test.local');
    await c.post('/api/auth/logout');
    expect((await request(app).get('/api/auth/me').set('Cookie', stolen)).body.data).toBeNull();
  });

  it('changing the password ends every other session but keeps the current one', async () => {
    const email = 'twodevices@test.local';
    const phone = client();
    await phone.post('/api/auth/register').send({ name: 'Two Devices', email, password: 'Secret123' });
    const laptop = client();
    expect((await laptop.post('/api/auth/login').send({ email, password: 'Secret123' })).status).toBe(200);
    expect((await laptop.post('/api/auth/change-password').send({ currentPassword: 'Secret123', newPassword: 'Secret456' })).status).toBe(200);
    expect((await laptop.get('/api/auth/me')).body.data.email).toBe(email);
    expect((await phone.get('/api/auth/me')).body.data).toBeNull();
  });

  it('every sign-in gets a fresh session id (no session fixation) and the cookie is HttpOnly', async () => {
    const email = 'fixation@test.local';
    const c = client();
    const reg = await c.post('/api/auth/register').send({ name: 'Fix', email, password: 'Secret123' });
    const login = await c.post('/api/auth/login').send({ email, password: 'Secret123' });
    expect(cookieOf(login)).not.toBe(cookieOf(reg));
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(String(login.headers['set-cookie'])).toMatch(/SameSite=Lax/i);
  });

  it('a forged token without a server-side session is not accepted for staff', async () => {
    await createStaff('admin', 'legacy-admin@test.local');
    const u = await User.findOne({ email: 'legacy-admin@test.local' }).lean();
    const legacy = jwt.sign({ sub: String(u!._id), tv: 0, typ: 'staff' }, jwtSecret(), { algorithm: 'HS256', expiresIn: '1h' });
    const r = await request(app).get('/api/admin/orders').set('Cookie', `cel_session=${legacy}`);
    expect(r.status).toBe(401);
    const forged = jwt.sign({ sub: String(u!._id), tv: 0, typ: 'staff', sid: 'made-up-session' }, jwtSecret(), { algorithm: 'HS256', expiresIn: '1h' });
    expect((await request(app).get('/api/admin/orders').set('Cookie', `cel_session=${forged}`)).status).toBe(401);
    const otherKey = jwt.sign({ sub: String(u!._id), tv: 0, typ: 'staff' }, 'x'.repeat(48), { algorithm: 'HS256' });
    expect((await request(app).get('/api/admin/orders').set('Cookie', `cel_session=${otherKey}`)).status).toBe(401);
  });

  it('suspending a staff member ends their sessions immediately', async () => {
    const sa = await createStaff('admin');
    const victim = await createStaff('order_manager', 'suspend-me@test.local');
    const v = await User.findOne({ email: 'suspend-me@test.local' }).lean();
    expect((await victim.get('/api/admin/orders')).status).toBe(200);
    expect((await sa.patch(`/api/admin/staff/${v!._id}`).send({ active: false })).status).toBe(200);
    expect((await victim.get('/api/admin/orders')).status).toBe(401);
    expect(await Session.countDocuments({ user: v!._id, revokedAt: { $exists: false } })).toBe(0);
  });
});

describe('two-factor authentication for staff (new)', () => {
  const codeFor = (secret: string, step: number) => hotp(base32Decode(secret), step);
  afterEach(() => {
    (env as Record<string, unknown>).STAFF_MFA_REQUIRED = false;
  });

  it('enrols, then requires a one-time code at sign-in; codes cannot be replayed; recovery codes work once', async () => {
    const email = 'mfa-admin@test.local';
    const password = 'Passw0rd!x';
    const staff = await createStaff('admin', email, password);
    expect((await staff.post('/api/auth/mfa/setup').send({ password: 'wrong-password' })).status).toBe(400);
    const setup = await staff.post('/api/auth/mfa/setup').send({ password });
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const stored = await User.findOne({ email }).select('+mfaPendingSecret').lean();
    expect(stored!.mfaPendingSecret).not.toContain(secret); // encrypted at rest

    expect((await staff.post('/api/auth/mfa/enable').send({ code: '000000' })).status).toBe(400);
    const step = totpStep();
    const enable = await staff.post('/api/auth/mfa/enable').send({ code: codeFor(secret, step) });
    expect(enable.status).toBe(200);
    const recovery = enable.body.data.recoveryCodes as string[];
    expect(recovery).toHaveLength(10);
    expect((await staff.get('/api/admin/orders')).status).toBe(200); // this session passed 2FA

    // Password alone no longer signs in.
    const c = client();
    const first = await c.post('/api/auth/login').send({ email, password });
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    expect(first.headers['set-cookie']).toBeUndefined();
    expect((await c.get('/api/admin/orders')).status).toBe(401);
    expect((await c.post('/api/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code: '123456' })).status).toBe(401);
    // The code used for enrolment is spent; the next one works exactly once.
    expect((await c.post('/api/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code: codeFor(secret, step) })).status).toBe(401);
    const ok = await c.post('/api/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code: codeFor(secret, step + 1) });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/admin/orders')).status).toBe(200);
    const again = await client().post('/api/auth/login').send({ email, password });
    expect((await client().post('/api/auth/mfa/verify').send({ mfaToken: again.body.data.mfaToken, code: codeFor(secret, step + 1) })).status).toBe(401);

    // Recovery code: once.
    const r1 = await client().post('/api/auth/login').send({ email, password });
    const viaRecovery = client();
    expect((await viaRecovery.post('/api/auth/mfa/verify').send({ mfaToken: r1.body.data.mfaToken, code: recovery[0] })).status).toBe(200);
    const r2 = await client().post('/api/auth/login').send({ email, password });
    expect((await client().post('/api/auth/mfa/verify').send({ mfaToken: r2.body.data.mfaToken, code: recovery[0] })).status).toBe(401);
    await User.updateOne({ email }, { $set: { failedLogins: 0 }, $unset: { lockUntil: 1 } });

    // A challenge token is not a session and cannot be used as one.
    expect((await request(app).get('/api/admin/orders').set('Cookie', `cel_session=${r2.body.data.mfaToken}`)).status).toBe(401);
  });

  it('an administrator can reset a colleague’s 2FA; that ends the colleague’s sessions', async () => {
    const email = 'mfa-reset@test.local';
    const staff = await createStaff('order_manager', email);
    const setup = await staff.post('/api/auth/mfa/setup').send({ password: 'Passw0rd!x' });
    await staff.post('/api/auth/mfa/enable').send({ code: codeFor(setup.body.data.secret, totpStep()) });
    const sa = await createStaff('admin');
    const u = await User.findOne({ email }).lean();
    expect((await sa.post(`/api/admin/staff/${u!._id}/reset-mfa`).send({})).status).toBe(200);
    expect((await User.findOne({ email }).lean())!.mfaEnabled).toBe(false);
    expect((await staff.get('/api/admin/orders')).status).toBe(401);
    const login = await client().post('/api/auth/login').send({ email, password: 'Passw0rd!x' });
    expect(login.body.data.mfaRequired).toBeUndefined();
  });

  it('when 2FA is mandatory, staff without it can only reach the enrolment endpoints', async () => {
    const staff = await createStaff('order_manager');
    (env as Record<string, unknown>).STAFF_MFA_REQUIRED = true;
    const r = await staff.get('/api/admin/orders');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect((await staff.get('/api/auth/mfa')).body.data).toEqual({ enabled: false, required: true });
    expect((await staff.post('/api/auth/mfa/setup').send({ password: 'Passw0rd!x' })).status).toBe(200);
  });
});

describe('shared rate limiting (fixed: was in-memory per instance)', () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_IN_TESTS;
  });

  it('two independent store instances (two servers) count against one limit in MongoDB', async () => {
    const a = new MongoRateLimitStore('rl:test-shared');
    const b = new MongoRateLimitStore('rl:test-shared');
    a.init({ windowMs: 60_000 } as never);
    b.init({ windowMs: 60_000 } as never);
    const key = 'ip:203.0.113.7';
    await a.increment(key);
    await b.increment(key);
    const third = await a.increment(key);
    expect(third.totalHits).toBe(3);
    expect(third.resetTime!.getTime()).toBeGreaterThan(Date.now());
    const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).increment('ip:198.51.100.1')));
    expect(Math.max(...parallel.map((p) => p.totalHits))).toBe(10);
    expect(new Set(parallel.map((p) => p.totalHits)).size).toBe(10); // atomic: no lost or double counts
  });

  it('starts a new window after the old one expires (no permanent blocking)', async () => {
    const s = new MongoRateLimitStore('rl:test-window');
    s.init({ windowMs: 50 } as never);
    await s.increment('k');
    await s.increment('k');
    await new Promise((r) => setTimeout(r, 80));
    expect((await s.increment('k')).totalHits).toBe(1);
  });

  it('falls back to a per-instance counter when MongoDB is unavailable', async () => {
    const s = new MongoRateLimitStore('rl:test-fallback');
    s.init({ windowMs: 60_000 } as never);
    const spy = vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0 as never);
    try {
      expect((await s.increment('k')).totalHits).toBe(1);
      expect((await s.increment('k')).totalHits).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('limits password-reset emails per address and answers 429 with Retry-After', async () => {
    process.env.RATE_LIMIT_IN_TESTS = '1';
    const c = client();
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await c.post('/api/auth/forgot-password').send({ email: 'victim-inbox@test.local' });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('payments: duplicate payment is flagged for refund (fixed)', () => {
  it('a second successful payment on an already-paid order is recorded and flagged, never silently absorbed', async () => {
    const { order } = await guestOrder('card');
    const o = await Order.findOne({ orderNumber: order.orderNumber }).lean();
    const p1 = await Payment.create({ order: o!._id, provider: 'sandbox', method: 'card', amount: o!.total, currency: 'SAR', status: 'pending', providerRef: 'sbx_dup_first_' + uid().slice(0, 8) });
    expect(await applyGatewayStatus(String(p1._id), { status: 'paid', amount: o!.total, currency: 'SAR' }, 'test')).toBe('paid');
    const p2 = await Payment.create({ order: o!._id, provider: 'sandbox', method: 'card', amount: o!.total, currency: 'SAR', status: 'pending', providerRef: 'sbx_dup_second_' + uid().slice(0, 8) });
    await applyGatewayStatus(String(p2._id), { status: 'paid', amount: o!.total, currency: 'SAR' }, 'test');
    const after = await Order.findById(o!._id).lean();
    expect(after!.history.some((h) => h.status === 'payment_review' && /second payment/.test(h.note ?? ''))).toBe(true);
    // Replaying the same gateway result does not add another flag (idempotent).
    await applyGatewayStatus(String(p2._id), { status: 'paid', amount: o!.total, currency: 'SAR' }, 'test');
    const again = await Order.findById(o!._id).lean();
    expect(again!.history.filter((h) => /second payment/.test(h.note ?? '')).length).toBe(1);
  });
});

describe('sensitive data exposure', () => {
  it('payment secrets are never returned by admin APIs, even to the Super Administrator', async () => {
    const sa = await createStaff('admin');
    const SECRET = 'sk_test_SECURITYSUITE_9f8e7d6c5b4a';
    expect((await sa.put('/api/admin/integrations/moyasar/test/credentials').send({ values: { secretKey: SECRET, webhookSecret: 'whsec_SECURITYSUITE_123456' } })).status).toBe(200);
    for (const path of ['/api/admin/integrations', '/api/admin/settings']) {
      const body = JSON.stringify((await sa.get(path)).body);
      expect(body, path).not.toContain(SECRET);
      expect(body, path).not.toContain('whsec_SECURITYSUITE_123456');
    }
    const pub = JSON.stringify((await client().get('/api/settings/public')).body) + JSON.stringify((await client().get('/api/checkout/options')).body);
    expect(pub).not.toContain('SECURITYSUITE');
  });

  it('profiles and staff lists never include password hashes, reset tokens or 2FA secrets', async () => {
    const sa = await createStaff('admin');
    const list = JSON.stringify((await sa.get('/api/admin/staff')).body);
    const me = JSON.stringify((await sa.get('/api/auth/me')).body);
    for (const s of [list, me]) {
      expect(s).not.toMatch(/passwordHash|resetTokenHash|mfaSecret|mfaPendingSecret|mfaRecoveryHashes|\$2[aby]\$/);
    }
  });

  it('failed sign-ins are logged as security events without the password and with a masked email', async () => {
    const warn = vi.spyOn(logger, 'warn');
    await client().post('/api/auth/login').send({ email: 'someone.private@test.local', password: 'MySecretPassw0rd' });
    const calls = warn.mock.calls.filter((c) => String(c[0]).startsWith('security:'));
    warn.mockRestore();
    expect(calls.map((c) => c[0])).toContain('security:auth.login_failed');
    const all = JSON.stringify(calls);
    expect(all).not.toContain('MySecretPassw0rd');
    expect(all).not.toContain('someone.private@');
    expect(all).toContain('so***@test.local');
    expect((calls[0][1] as Record<string, unknown>).security).toBe(true);
    // And the log formatter strips anything secret-looking that a future caller might add.
    expect(JSON.stringify(redact({ password: 'MySecretPassw0rd', cookie: 'cel_session=abc', note: 'Bearer abcdefghijklmnop' }))).not.toMatch(/MySecretPassw0rd|cel_session=abc|abcdefghijklmnop/);
  });
});
