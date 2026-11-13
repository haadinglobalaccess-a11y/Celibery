/**
 * Security regression suite for SECURITY_AUDIT_REPORT.md (13 Nov 2026):
 *  - CEL-SEC-01 step-up re-authentication for payment credentials and staff/role management
 *  - CEL-SEC-02 in-session password re-checks count toward the account lock-out
 *  - CEL-SEC-03 library client errors (e.g. "../" refused by serve-static) answer 4xx, not 500
 * Runs against the in-memory replica set like every other API test.
 */
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/lib/logger';
import { base32Decode, hotp, totpStep } from '../src/lib/totp';
import { Role, Session, User } from '../src/models';
import { REAUTH_WINDOW_MINUTES } from '../src/middleware/auth';
import { hashPassword } from '../src/modules/auth/auth.service';
import { client, createCustomer, useDatabase } from './helpers';

useDatabase();
afterEach(() => vi.restoreAllMocks());

const PASSWORD = 'Passw0rd!x';

async function superAdmin() {
  const email = `owner-${crypto.randomBytes(3).toString('hex')}@test.local`;
  const role = await Role.findOne({ key: 'admin' }).lean();
  const user = await User.create({ type: 'staff', name: 'Owner', email, passwordHash: await hashPassword(PASSWORD), role: role!._id });
  const c = client();
  expect((await c.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  return { c, email, id: String(user._id) };
}

/** Makes every live session of the user look older than the step-up window (native driver: createdAt is immutable in Mongoose). */
async function ageSessions(userId: string, minutes = REAUTH_WINDOW_MINUTES + 5) {
  const past = new Date(Date.now() - minutes * 60_000);
  await Session.collection.updateMany({ user: new (await import('mongoose')).Types.ObjectId(userId) }, { $set: { createdAt: past }, $unset: { reauthAt: '' } });
}

const newStaff = () => ({ name: 'New Colleague', email: `colleague-${crypto.randomBytes(3).toString('hex')}@test.local`, roleKey: 'content_editor' });
async function staffBody() {
  const b = newStaff();
  const role = await Role.findOne({ key: b.roleKey }).lean();
  return { name: b.name, email: b.email, roleId: String(role!._id) };
}

describe('CEL-SEC-01 step-up re-authentication', () => {
  it('a fresh sign-in can manage staff; an old session must re-enter the password first', async () => {
    const { c, id } = await superAdmin();
    expect((await c.post('/api/admin/staff').send(await staffBody())).status).toBe(201);

    await ageSessions(id);
    const blocked = await c.post('/api/admin/staff').send(await staffBody());
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('REAUTH_REQUIRED');
    // Reading stays available without step-up.
    expect((await c.get('/api/admin/staff')).status).toBe(200);

    const wrong = await c.post('/api/auth/reauth').send({ password: 'not-the-password' });
    expect(wrong.status).toBe(400);
    expect((await c.post('/api/admin/staff').send(await staffBody())).status).toBe(403);

    expect((await c.post('/api/auth/reauth').send({ password: PASSWORD })).status).toBe(200);
    expect((await c.post('/api/admin/staff').send(await staffBody())).status).toBe(201);
  });

  it('payment and integration credentials need step-up too', async () => {
    const { c, id } = await superAdmin();
    await ageSessions(id);
    const r = await c.put('/api/admin/integrations/moyasar/test/credentials').send({ values: { publishableKey: 'pk_test_x' } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('REAUTH_REQUIRED');
    expect((await c.post('/api/admin/integrations/moyasar/activate').send({ enabled: false, mode: 'test' })).status).toBe(403);
    expect((await c.get('/api/admin/integrations')).status).toBe(200);
  });

  it('the step-up window expires', async () => {
    const { c, id } = await superAdmin();
    await ageSessions(id);
    expect((await c.post('/api/auth/reauth').send({ password: PASSWORD })).status).toBe(200);
    // Push the re-authentication itself back past the window.
    await Session.collection.updateMany({ user: (await User.findById(id).lean())!._id }, { $set: { reauthAt: new Date(Date.now() - (REAUTH_WINDOW_MINUTES + 1) * 60_000) } });
    expect((await c.post('/api/admin/staff').send(await staffBody())).status).toBe(403);
  });

  it('with 2FA on, step-up needs a valid one-time code (no replay)', async () => {
    const { c, id } = await superAdmin();
    const setup = await c.post('/api/auth/mfa/setup').send({ password: PASSWORD });
    const secret = setup.body.data.secret as string;
    const step = totpStep();
    expect((await c.post('/api/auth/mfa/enable').send({ code: hotp(base32Decode(secret), step) })).status).toBe(200);
    await ageSessions(id);

    const noCode = await c.post('/api/auth/reauth').send({ password: PASSWORD });
    expect(noCode.status).toBe(400);
    expect(noCode.body.error.code).toBe('CODE_REQUIRED');
    // The code already used to enable 2FA cannot be replayed.
    const replay = await c.post('/api/auth/reauth').send({ password: PASSWORD, code: hotp(base32Decode(secret), step) });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_CODE');
    expect((await c.post('/api/auth/reauth').send({ password: PASSWORD, code: hotp(base32Decode(secret), step + 1) })).status).toBe(200);
    expect((await c.post('/api/admin/staff').send(await staffBody())).status).toBe(201);
  });

  it('only staff sessions can step up', async () => {
    const { c } = await createCustomer();
    expect((await c.post('/api/auth/reauth').send({ password: PASSWORD })).status).toBe(403);
    expect((await client().post('/api/auth/reauth').send({ password: PASSWORD })).status).toBe(401);
  });
});

describe('CEL-SEC-02 password re-checks inside a session count toward the lock-out', () => {
  it('change-password cannot be used to guess the password: 5 failures lock the account and end the session', async () => {
    const { c, email } = await createCustomer(undefined, PASSWORD);
    for (let i = 0; i < 4; i++) {
      const r = await c.post('/api/auth/change-password').send({ currentPassword: `guess-${i}-Xx1`, newPassword: 'Another-Passw0rd!' });
      expect(r.status).toBe(400);
    }
    const fifth = await c.post('/api/auth/change-password').send({ currentPassword: 'guess-4-Xx1', newPassword: 'Another-Passw0rd!' });
    expect(fifth.status).toBe(400);
    // The session that made the guesses is over …
    expect((await c.get('/api/me/addresses')).status).toBe(401);
    // … and the account is locked, even for the right password.
    const user = await User.findOne({ email }).select('+lockUntil').lean();
    expect(user!.lockUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await client().post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
  });

  it('2FA set-up (password re-check) counts failures the same way', async () => {
    const { c, email } = await superAdmin();
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/mfa/setup').send({ password: `guess-${i}` })).status).toBe(400);
    const user = await User.findOne({ email }).select('+lockUntil').lean();
    expect(user!.lockUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await c.get('/api/admin/staff')).status).toBe(401);
  });

  it('a correct re-check resets the failure counter', async () => {
    const { c, email } = await createCustomer(undefined, PASSWORD);
    for (let i = 0; i < 3; i++) await c.post('/api/auth/change-password').send({ currentPassword: `guess-${i}-Xx1`, newPassword: 'Another-Passw0rd!' });
    expect((await c.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Another-Passw0rd!' })).status).toBe(200);
    const user = await User.findOne({ email }).select('+failedLogins').lean();
    expect(user!.failedLogins ?? 0).toBe(0);
  });
});

describe('CEL-SEC-03 library client errors are not reported as server errors', () => {
  it('"../" in a media path answers 4xx and logs no error-level stack trace', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    for (const path of ['/media/..%2f..%2f.env', '/media/%2e%2e/%2e%2e/package.json']) {
      const r = await client().get(path);
      expect(r.status, path).toBeGreaterThanOrEqual(400);
      expect(r.status, path).toBeLessThan(500);
      expect(JSON.stringify(r.body)).not.toMatch(/node_modules|at \w+ \(/);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
