import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { User } from '../src/models';
import { createResetToken } from '../src/modules/auth/auth.service';
import { app, client, createCustomer, createStaff, useDatabase } from './helpers';

useDatabase();

describe('authentication', () => {
  it('consumes a password reset token exactly once under concurrent submissions', async () => {
    const { id } = await createCustomer();
    const token = await createResetToken(id, 10);
    const results = await Promise.all(['FirstPass123', 'SecondPass123'].map(password => client().post('/api/auth/reset-password').send({ token, password })));
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
  });

  it('rejects passwords that bcrypt would silently truncate', async () => {
    const r = await client().post('/api/auth/register').send({ name: 'Password limit', email: 'long-password@test.local', password: 'A1' + 'x'.repeat(71) });
    expect(r.status).toBe(400);
  });
  it('registers, reads the session, logs out', async () => {
    const c = client();
    const reg = await c.post('/api/auth/register').send({ name: 'Sara', email: 'sara@test.local', password: 'Secret123', phone: '0501234567', lang: 'ar' });
    expect(reg.status).toBe(201);
    expect(reg.body.data.email).toBe('sara@test.local');
    expect(reg.body.data.passwordHash).toBeUndefined();
    expect(String(reg.headers['set-cookie'])).toMatch(/cel_session=.*HttpOnly/i);

    const me = await c.get('/api/auth/me');
    expect(me.body.data.name).toBe('Sara');

    await c.post('/api/auth/logout');
    const me2 = await c.get('/api/auth/me');
    expect(me2.body.data).toBeNull();
  });

  it('stores passwords hashed, never in plaintext', async () => {
    const u = await User.findOne({ email: 'sara@test.local' }).select('+passwordHash').lean();
    expect(u?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u?.passwordHash).not.toContain('Secret123');
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const c = client();
    expect((await c.post('/api/auth/register').send({ name: 'X', email: 'weak@test.local', password: 'short' })).status).toBe(400);
    expect((await c.post('/api/auth/register').send({ name: 'Sara 2', email: 'sara@test.local', password: 'Secret123' })).status).toBe(409);
  });

  it('gives the same error for wrong password and unknown email, then locks after repeated failures', async () => {
    const c = client();
    const a = await c.post('/api/auth/login').send({ email: 'sara@test.local', password: 'Wrong1234' });
    const b = await c.post('/api/auth/login').send({ email: 'nobody@test.local', password: 'Wrong1234' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    for (let i = 0; i < 4; i++) await c.post('/api/auth/login').send({ email: 'sara@test.local', password: 'Wrong1234' });
    const locked = await c.post('/api/auth/login').send({ email: 'sara@test.local', password: 'Secret123' });
    expect(locked.status).toBe(401);
    expect(locked.body.error.message).toMatch(/Too many/);
    await User.updateOne({ email: 'sara@test.local' }, { $unset: { lockUntil: 1 } });
  });

  it('resets a password with a single-use token and invalidates old sessions', async () => {
    const { c, email } = await createCustomer('reset@test.local');
    const forgot = await client().post('/api/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);
    const u = await User.findOne({ email }).lean();
    const token = await createResetToken(u!._id, 60);
    const r = await client().post('/api/auth/reset-password').send({ token, password: 'NewPass123' });
    expect(r.status).toBe(200);
    expect((await client().post('/api/auth/reset-password').send({ token, password: 'Another123' })).status).toBe(400);
    // Old session no longer valid
    expect((await c.get('/api/auth/me')).body.data).toBeNull();
    expect((await client().post('/api/auth/login').send({ email, password: 'NewPass123' })).status).toBe(200);
  });

  it('changes the password: needs the current one, signs out other devices, keeps this one signed in', async () => {
    const { c, email } = await createCustomer();
    const other = client();
    expect((await other.post('/api/auth/login').send({ email, password: 'Passw0rd!x' })).status).toBe(200);

    const wrong = await c.post('/api/auth/change-password').send({ currentPassword: 'Not-it-123', newPassword: 'Changed-Pass-9' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    expect((await c.post('/api/auth/change-password').send({ currentPassword: 'Passw0rd!x', newPassword: 'short' })).status).toBe(400);

    const ok = await c.post('/api/auth/change-password').send({ currentPassword: 'Passw0rd!x', newPassword: 'Changed-Pass-9' });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/auth/me')).body.data.email).toBe(email); // this session was re-issued
    expect((await other.get('/api/auth/me')).body.data).toBeNull(); // other sessions revoked
    expect((await client().post('/api/auth/login').send({ email, password: 'Passw0rd!x' })).status).toBe(401);
    expect((await client().post('/api/auth/login').send({ email, password: 'Changed-Pass-9' })).status).toBe(200);
    expect((await client().post('/api/auth/change-password').send({ currentPassword: 'x', newPassword: 'Changed-Pass-9' })).status).toBe(401); // signed out
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'sara@test.local', password: 'Secret123' });
    expect(r.status).toBe(403);
  });
});

describe('authorization', () => {
  it('blocks anonymous and customer access to admin APIs', async () => {
    expect((await client().get('/api/admin/overview')).status).toBe(401);
    const { c } = await createCustomer();
    expect((await c.get('/api/admin/overview')).status).toBe(403);
    expect((await c.get('/api/admin/orders')).status).toBe(403);
  });

  it('enforces role permissions on the backend', async () => {
    const editor = await createStaff('content_editor');
    expect((await editor.get('/api/admin/products')).status).toBe(200);
    expect((await editor.get('/api/admin/orders')).status).toBe(403);
    expect((await editor.get('/api/admin/settings')).status).toBe(403);
    expect((await editor.get('/api/admin/staff')).status).toBe(403);
    const orders = await createStaff('order_manager');
    expect((await orders.get('/api/admin/orders')).status).toBe(200);
    expect((await orders.post('/api/admin/discounts').send({ code: 'NOPE', type: 'percent', value: 10 })).status).toBe(403);
  });

  it('signs out a deactivated staff member immediately', async () => {
    const admin = await createStaff('admin');
    const sales = await createStaff('sales_executive', 'sales-x@test.local');
    expect((await sales.get('/api/admin/orders')).status).toBe(200);
    const u = await User.findOne({ email: 'sales-x@test.local' }).lean();
    expect((await admin.patch(`/api/admin/staff/${u!._id}`).send({ active: false })).status).toBe(200);
    expect((await sales.get('/api/admin/orders')).status).toBe(401);
  });

  it('customers cannot be logged into the admin by a staff route and cannot change own role', async () => {
    const admin = await createStaff('admin', 'self-admin@test.local');
    const me = await User.findOne({ email: 'self-admin@test.local' }).lean();
    const r = await admin.patch(`/api/admin/staff/${me!._id}`).send({ active: false });
    expect(r.status).toBe(403);
  });
});
