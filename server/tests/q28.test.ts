import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { invalidateIntegrations } from '../src/integrations/credentials';
import { parseSender, upgradeValues } from '../src/integrations/credentials/definitions';
import { AuditLog, IntegrationCredential, Notification, Product, Settings } from '../src/models';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';
import { eventually, startSmtpSink } from './smtp-sink';

/**
 * Q28 — customer order updates: the administrator configures the SMTP account and the WhatsApp
 * Business number entirely in the admin. No SMTP_* / WHATSAPP_* environment variables are set in
 * these tests (see tests/setup.ts), so everything below works from dashboard settings alone.
 */
useDatabase();
const shop = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

const USER = 'orders@celibery.test';
const PASS = 'Smtp-App-Password-4411';
let sink: Awaited<ReturnType<typeof startSmtpSink>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;

beforeAll(async () => {
  sink = await startSmtpSink({ user: USER, pass: PASS });
  superAdmin = await createStaff('admin');
  await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
});
afterAll(async () => {
  await sink?.close();
  vi.restoreAllMocks();
});

const status = async (who = superAdmin) => (await who.get('/api/admin/settings')).body.data.integrations as { email: { status: string; message: string; enabled: boolean; usingEnvFallback: boolean }; whatsapp: { status: string; message: string } };
const codOrder = async (email: string, agent = shop) =>
  agent.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod', lang: 'en' });

describe('Q28 email (SMTP) configured entirely in the admin', () => {
  it('needs no environment variables: starts "Not configured", never counts env settings', async () => {
    expect(env.SMTP_HOST).toBe('');
    expect(env.EMAIL_FROM).toBe(''); // no built-in sender address either
    const s = await status();
    expect(s.email).toMatchObject({ status: 'not_configured', usingEnvFallback: false });
    expect(s.whatsapp.status).toBe('not_configured');
  });

  it('wrong password → "Connection failed" with the reason; secrets stay encrypted and masked', async () => {
    const save = await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({
      values: { host: '127.0.0.1', port: String(sink.port), security: 'starttls', user: USER, pass: 'wrong-password-1', fromEmail: 'orders@celibery.test', fromName: 'CELIBERY Orders', replyTo: 'support@celibery.test' },
    });
    expect(save.status).toBe(200);
    expect(save.body.data.channel).toMatchObject({ status: 'not_configured', message: expect.stringMatching(/Test connection/) });
    const v = await superAdmin.post('/api/admin/integrations/smtp/live/verify');
    expect(v.body.data.check.ok).toBe(false);
    expect(v.body.data.integration.channel).toMatchObject({ status: 'failed', message: 'The server rejected the username or password' });
    expect((await status()).email.status).toBe('failed');

    // The password is stored only as ciphertext and never returned.
    const raw = await IntegrationCredential.findOne({ provider: 'smtp' }).select('+modes.live.secrets').lean();
    const cipher = (raw!.modes!.live!.secrets as unknown as Record<string, string>).pass;
    expect(cipher).toMatch(/^v1:/);
    expect(cipher).not.toContain('wrong-password-1');
    const list = await superAdmin.get('/api/admin/integrations');
    expect(JSON.stringify(list.body)).not.toContain('wrong-password-1');
    expect(list.body.data.integrations.find((i: { key: string }) => i.key === 'smtp').modes.live.fields.find((f: { key: string }) => f.key === 'pass')).toMatchObject({ set: true, masked: '••••••••rd-1' });
  });

  it('correct password → "Configured"; the test email goes to the recipient the admin enters, from the admin-chosen sender', async () => {
    await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: { pass: PASS } });
    const v = await superAdmin.post('/api/admin/integrations/smtp/live/verify');
    expect(v.body.data.check).toMatchObject({ ok: true });
    expect(v.body.data.check.message).toMatch(/STARTTLS/);
    expect((await status()).email).toMatchObject({ status: 'configured', enabled: false });

    const bad = await superAdmin.post('/api/admin/integrations/smtp/test-message').send({ to: 'not-an-email' });
    expect(bad.status).toBe(400);
    const r = await superAdmin.post('/api/admin/integrations/smtp/test-message').send({ to: 'manager@celibery.test' });
    expect(r.body.data).toEqual({ sent: true, to: 'manager@celibery.test', from: 'orders@celibery.test' });
    const msg = sink.messages.at(-1)!;
    expect(msg.to).toEqual(['manager@celibery.test']);
    expect(msg.from).toContain('orders@celibery.test');
    expect(msg.data).toMatch(/From: CELIBERY Orders <orders@celibery\.test>/);
    expect(msg.data).toMatch(/Reply-To: support@celibery\.test/);
    expect(await Notification.exists({ to: 'manager@celibery.test', template: 'admin.smtp_test', status: 'sent' })).toBeTruthy();
    expect(await AuditLog.exists({ entity: 'integration', entityId: 'smtp', action: 'credentials_test_message' })).toBeTruthy();
  });

  it('switched on: order emails use the admin account; the Q28 checkbox turns them off and on', async () => {
    expect((await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
    expect((await status()).email).toMatchObject({ status: 'configured', enabled: true });

    const a = `on-${uid().slice(0, 6)}@test.local`;
    expect((await codOrder(a)).status).toBe(201);
    const msg = (await eventually(() => sink.messages.find((m) => m.to.includes(a))))!;
    expect(msg.data).toMatch(/From: CELIBERY Orders <orders@celibery\.test>/);

    const admin = await createStaff('administrator');
    expect((await admin.put('/api/admin/settings').send({ notifications: { emailOrderUpdates: false } })).status).toBe(200);
    const b = `off-${uid().slice(0, 6)}@test.local`;
    const before = sink.messages.length;
    const ob = await codOrder(b);
    expect(ob.status).toBe(201);
    await new Promise((r) => setTimeout(r, 400));
    expect(sink.messages.length).toBe(before);
    expect(await Notification.exists({ to: b, channel: 'email' })).toBeNull(); // not even attempted
    await admin.put('/api/admin/settings').send({ notifications: { emailOrderUpdates: true } });
  });

  it('survives a server restart: a fresh app instance with an empty cache sends with the saved settings', async () => {
    invalidateIntegrations();
    const restarted = request.agent(createApp());
    const email = `restart-${uid().slice(0, 6)}@test.local`;
    const r = await restarted.post('/api/checkout').set('X-Requested-With', 'celibery').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod' });
    expect(r.status).toBe(201);
    const msg = (await eventually(() => sink.messages.find((m) => m.to.includes(email))))!;
    expect(msg.data).toMatch(/orders@celibery\.test/);
  });

  it('only payments:manage administrators can read or change the account; others only see the status', async () => {
    const admin = await createStaff('administrator');
    expect((await admin.get('/api/admin/integrations')).status).toBe(403);
    expect((await admin.post('/api/admin/integrations/smtp/test-message').send({ to: 'x@y.co' })).status).toBe(403);
    const s = await admin.get('/api/admin/settings');
    expect(s.body.data.integrations.email.status).toBe('configured');
    expect(JSON.stringify(s.body)).not.toContain(PASS);
  });
});

describe('Q28 WhatsApp Business configured entirely in the admin', () => {
  const TOKEN = 'EAAGq28-permanent-token-0123456789';
  const calls: { url: string; body?: unknown }[] = [];
  beforeAll(() => {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith('https://graph.facebook.com/')) return real(input, init);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (new Headers(init?.headers).get('authorization') !== `Bearer ${TOKEN}`) return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), { status: 401 });
      if (url.includes('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.q28' }] }), { status: 200 });
      return new Response(JSON.stringify({ display_phone_number: '+966 55 111 2222', verified_name: 'CELIBERY' }), { status: 200 });
    });
  });

  it('validates the fields, checks the token, and rejects a phone number ID that belongs to another number', async () => {
    const bad = await superAdmin.put('/api/admin/integrations/whatsapp/live/credentials').send({ values: { businessPhoneNumber: '+966 55', apiVersion: '20' } });
    expect(Object.keys(bad.body.error.details.fieldErrors).sort()).toEqual(['apiVersion', 'businessPhoneNumber']);

    await superAdmin.put('/api/admin/integrations/whatsapp/live/credentials').send({
      values: { businessPhoneNumber: '966500000000', phoneNumberId: '1098765432', wabaId: '2233445566', accessToken: 'wrong-token-00000', apiVersion: 'v21.0', orderTemplate: 'order_update', templateLangEn: 'en_US' },
    });
    const t1 = await superAdmin.post('/api/admin/integrations/whatsapp/live/verify');
    expect(t1.body.data.integration.channel).toMatchObject({ status: 'failed', message: expect.stringMatching(/401: Invalid OAuth access token/) });

    await superAdmin.put('/api/admin/integrations/whatsapp/live/credentials').send({ values: { accessToken: TOKEN } });
    const t2 = await superAdmin.post('/api/admin/integrations/whatsapp/live/verify');
    expect(t2.body.data.check.message).toMatch(/belongs to \+966551112222, not \+966500000000/);
    expect((await status()).whatsapp.status).toBe('failed');
    expect(calls.at(-1)!.url).toContain('/v21.0/1098765432?'); // admin-chosen API version and number ID
  });

  it('with the right number → "Configured"; the test message goes from that number to the number the admin enters', async () => {
    await superAdmin.put('/api/admin/integrations/whatsapp/live/credentials').send({ values: { businessPhoneNumber: '966551112222' } });
    const ok = await superAdmin.post('/api/admin/integrations/whatsapp/live/verify');
    expect(ok.body.data.check).toMatchObject({ ok: true });
    expect((await status()).whatsapp.status).toBe('configured');
    expect(JSON.stringify((await superAdmin.get('/api/admin/integrations')).body)).not.toContain(TOKEN);

    expect((await superAdmin.post('/api/admin/integrations/whatsapp/test-message').send({ to: '12' })).status).toBe(400);
    const r = await superAdmin.post('/api/admin/integrations/whatsapp/test-message').send({ to: '0551234567', lang: 'en' });
    expect(r.body.data).toEqual({ sent: true, to: '966551234567', from: '966551112222' });
    const sent = calls.at(-1)!;
    expect(sent.url).toBe('https://graph.facebook.com/v21.0/1098765432/messages');
    expect(sent.body).toMatchObject({ to: '966551234567', template: { name: 'order_update', language: { code: 'en_US' } } });
  });

  it('switched on: order updates are sent from the configured number; switched off: logged as skipped', async () => {
    expect((await superAdmin.post('/api/admin/integrations/whatsapp/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
    const r = await codOrder(`wa-${uid().slice(0, 6)}@test.local`);
    expect(r.status).toBe(201);
    await eventually(() => calls.some((c) => c.url.endsWith('/1098765432/messages') && (c.body as { to: string }).to === '966551234567' && JSON.stringify(c.body).includes(r.body.data.order.orderNumber)));

    await superAdmin.post('/api/admin/integrations/whatsapp/activate').send({ enabled: false, mode: 'live' });
    const r2 = await codOrder(`wa2-${uid().slice(0, 6)}@test.local`);
    const log = await eventually(() => Notification.findOne({ order: { $exists: true }, channel: 'whatsapp', status: 'skipped', createdAt: { $gte: new Date(Date.now() - 5000) } }).lean());
    expect(log!.detail).toMatch(/not configured or disabled/);
    expect(r2.status).toBe(201);
  });
});

describe('settings saved before the Q28 fields existed keep working', () => {
  it('a combined "Name <address>" sender is split into display name and address; security follows the port', () => {
    expect(parseSender('CELIBERY International <no-reply@celibery.sa>')).toEqual({ name: 'CELIBERY International', email: 'no-reply@celibery.sa' });
    expect(parseSender('no-reply@celibery.sa')).toEqual({ name: '', email: 'no-reply@celibery.sa' });
    expect(upgradeValues('smtp', { host: 'h', port: '465', from: 'Shop <a@b.co>' })).toEqual({ host: 'h', port: '465', fromEmail: 'a@b.co', fromName: 'Shop', security: 'ssl' });
    expect(upgradeValues('smtp', { port: '587', fromEmail: 'x@y.co', security: 'ssl' })).toEqual({ port: '587', fromEmail: 'x@y.co', security: 'ssl' });
  });
});

describe('WhatsApp set up before the business-number field existed', () => {
  it('keeps sending, but Test connection (and therefore switching on) requires choosing the number', async () => {
    const { verifyWhatsApp } = await import('../src/integrations/notifications/providers');
    const r = await verifyWhatsApp({ phoneNumberId: '1098765432', accessToken: 'x'.repeat(20) });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/WhatsApp Business phone number/) });
    const { missingRequired } = await import('../src/integrations/credentials/definitions');
    expect(missingRequired('whatsapp', { phoneNumberId: true, accessToken: true, orderTemplate: true })).toEqual([]);
  });
});
