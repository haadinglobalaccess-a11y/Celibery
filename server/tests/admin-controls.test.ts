import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { invalidateIntegrations } from '../src/integrations/credentials';
import { AuditLog, Discount, IntegrationCredential, Notification, Order, Product, Settings } from '../src/models';
import { range, riyadhDayStart, salesReport } from '../src/modules/admin/reports.service';
import { address, client, contact, createCustomer, createStaff, uid, useDatabase } from './helpers';
import { eventually, startSmtpSink } from './smtp-sink';

/**
 * Admin Dashboard controls added in the backend/admin audit:
 *  - email (SMTP) and WhatsApp credentials managed in Admin (encrypted, masked, tested, enabled)
 *    and actually used by order notifications;
 *  - robots.txt follows the SEO "allow AI assistants" setting;
 *  - discount codes can be deleted unless orders used them;
 *  - customer accounts can be suspended / reactivated;
 *  - reports use Riyadh calendar days regardless of the server time zone.
 */
useDatabase();
const c = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

const SMTP_USER = 'mailer@celibery.test';
const SMTP_PASS = 'smtp-Secret-Pass-9081';
let sink: Awaited<ReturnType<typeof startSmtpSink>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let superAdminEmail = '';

beforeAll(async () => {
  sink = await startSmtpSink({ user: SMTP_USER, pass: SMTP_PASS });
  superAdminEmail = `super-${uid().slice(0, 6)}@test.local`;
  superAdmin = await createStaff('admin', superAdminEmail);
});
afterAll(async () => {
  await sink?.close();
  vi.restoreAllMocks();
});

describe('email (SMTP) credentials managed in Admin', () => {
  const smtpValues = (over: Record<string, string> = {}) => ({ host: '127.0.0.1', port: String(sink.port), user: SMTP_USER, pass: SMTP_PASS, from: 'CELIBERY International <no-reply@celibery.test>', ...over });

  it('only payments:manage can see or change notification credentials', async () => {
    const administrator = await createStaff('administrator');
    expect((await administrator.get('/api/admin/integrations')).status).toBe(403);
    expect((await administrator.put('/api/admin/integrations/smtp/live/credentials').send({ values: smtpValues() })).status).toBe(403);
    expect((await c.post('/api/admin/integrations/smtp/test-message')).status).toBe(401);
  });

  it('validates the values and refuses the test/live split for single-mode providers', async () => {
    const bad = await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: { host: 'https://smtp.example.com', port: '99999', from: 'not an address' } });
    expect(bad.status).toBe(400);
    const errs = bad.body.error.details.fieldErrors;
    expect(Object.keys(errs).sort()).toEqual(['from', 'host', 'port']);
    const testSlot = await superAdmin.put('/api/admin/integrations/smtp/test/credentials').send({ values: smtpValues() });
    expect(testSlot.status).toBe(400);
    expect(testSlot.body.error.code).toBe('MODE_NOT_SUPPORTED');
  });

  it('stores the password encrypted, never returns it, and requires a passing connection test before enabling', async () => {
    const wrong = await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: smtpValues({ pass: 'wrong-password-123' }) });
    expect(wrong.status).toBe(200);
    expect(JSON.stringify(wrong.body)).not.toContain('wrong-password-123');

    // Saved but not verified → cannot be enabled.
    const early = await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('NOT_VERIFIED');

    // Wrong password → the real SMTP handshake fails with a clear message.
    const failed = await superAdmin.post('/api/admin/integrations/smtp/live/verify');
    expect(failed.status).toBe(200);
    expect(failed.body.data.check.ok).toBe(false);
    expect(failed.body.data.check.message).toMatch(/username or password/);

    // Replace the password: stored as ciphertext, shown masked only.
    const fixed = await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: { pass: SMTP_PASS } });
    expect(fixed.status).toBe(200);
    const raw = await IntegrationCredential.findOne({ provider: 'smtp' }).select('+modes.live.secrets').lean();
    const stored = (raw!.modes!.live!.secrets as unknown as Record<string, string>).pass;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(SMTP_PASS);
    const list = await superAdmin.get('/api/admin/integrations');
    expect(JSON.stringify(list.body)).not.toContain(SMTP_PASS);
    const view = list.body.data.integrations.find((i: { key: string }) => i.key === 'smtp');
    expect(view.singleMode).toBe(true);
    expect(view.modes.live.fields.find((f: { key: string }) => f.key === 'pass')).toMatchObject({ set: true, secret: true });
    expect(view.modes.live.verification.status).toBe('unverified'); // password change reset the earlier failure

    const ok = await superAdmin.post('/api/admin/integrations/smtp/live/verify');
    expect(ok.body.data.check).toMatchObject({ ok: true, status: 'ok' });

    // Notification providers do not need the payment "type LIVE" confirmation.
    const on = await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' });
    expect(on.status).toBe(200);
    expect(on.body.data.effective).toMatchObject({ source: 'admin', enabled: true, configured: true });
    const audit = await AuditLog.find({ entity: 'integration', entityId: 'smtp' }).lean();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['credentials_update', 'credentials_verify', 'integration_enable']));
    expect(JSON.stringify(audit)).not.toContain(SMTP_PASS);
  });

  it('sends a real test email to the signed-in administrator', async () => {
    const before = sink.messages.length;
    const r = await superAdmin.post('/api/admin/integrations/smtp/test-message');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ sent: true, to: superAdminEmail });
    const msg = sink.messages[before];
    expect(msg.to).toEqual([superAdminEmail]);
    expect(msg.data).toMatch(/Subject: CELIBERY — test email|Subject: =\?UTF-8/);
    expect(await Notification.exists({ template: 'admin.smtp_test', status: 'sent' })).toBeTruthy();
  });

  it('order emails are delivered through the Admin-configured server', async () => {
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const email = `buyer-${uid().slice(0, 6)}@test.local`;
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod' });
    expect(r.status).toBe(201);
    const msg = (await eventually(() => sink.messages.find((m) => m.to.includes(email))))!;
    expect(msg.from).toContain('no-reply@celibery.test');
    expect(msg.data).toContain(r.body.data.order.orderNumber);
    const log = await eventually(() => Notification.findOne({ to: email, channel: 'email' }).lean());
    expect(log!.status).toBe('sent');
  });

  it('disabling email stops sending and logs the attempt as skipped', async () => {
    const off = await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: false, mode: 'live' });
    expect(off.status).toBe(200);
    const email = `buyer2-${uid().slice(0, 6)}@test.local`;
    const before = sink.messages.length;
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod' });
    expect(r.status).toBe(201);
    const log = await eventually(() => Notification.findOne({ to: email, channel: 'email' }).lean());
    expect(log!.status).toBe('skipped');
    expect(log!.detail).toMatch(/not configured or disabled/);
    expect(sink.messages.length).toBe(before);
  });

  it('staff with orders:read can read the delivery log', async () => {
    const om = await createStaff('order_manager');
    const r = await om.get('/api/admin/notifications');
    expect(r.status).toBe(200);
    expect(r.body.data.some((n: { status: string }) => n.status === 'skipped')).toBe(true);
  });
});

describe('WhatsApp credentials managed in Admin', () => {
  it('verifies against the Cloud API and sends order updates with the configured template', async () => {
    const TOKEN = 'EAAG-test-token-very-secret-1234567890';
    const realFetch = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith('https://graph.facebook.com/')) return realFetch(input, init);
      calls.push({ url, init });
      const auth = new Headers(init?.headers).get('authorization');
      if (auth !== `Bearer ${TOKEN}`) return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), { status: 401 });
      if (url.includes('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
      return new Response(JSON.stringify({ display_phone_number: '+966 50 000 0000', verified_name: 'CELIBERY' }), { status: 200 });
    });
    try {
      const save = await superAdmin.put('/api/admin/integrations/whatsapp/live/credentials').send({ values: { phoneNumberId: '1234567890', accessToken: 'bad-token-000000', orderTemplate: 'order_update', templateLangAr: 'ar', templateLangEn: 'en_US' } });
      expect(save.status).toBe(200);
      const bad = await superAdmin.post('/api/admin/integrations/whatsapp/live/verify');
      expect(bad.body.data.check).toMatchObject({ ok: false });
      expect(bad.body.data.check.message).toMatch(/401/);

      await superAdmin.put('/api/admin/integrations/whatsapp/live/credentials').send({ values: { accessToken: TOKEN } });
      const good = await superAdmin.post('/api/admin/integrations/whatsapp/live/verify');
      expect(good.body.data.check).toMatchObject({ ok: true });
      expect(good.body.data.check.message).toContain('CELIBERY');
      expect((await superAdmin.post('/api/admin/integrations/whatsapp/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
      expect(JSON.stringify((await superAdmin.get('/api/admin/integrations')).body)).not.toContain(TOKEN);

      const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'cod', lang: 'en' });
      expect(r.status).toBe(201);
      const sent = (await eventually(() => calls.find((x) => x.url.endsWith('/1234567890/messages'))))!;
      const body = JSON.parse(String(sent.init!.body));
      expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '966551234567', type: 'template', template: { name: 'order_update', language: { code: 'en_US' } } });
      const log = await eventually(() => Notification.findOne({ channel: 'whatsapp', to: '966551234567', status: 'sent' }).lean());
      expect(log!.template).toBe('order.order_placed');
    } finally {
      spy.mockRestore();
      await superAdmin.post('/api/admin/integrations/whatsapp/activate').send({ enabled: false, mode: 'live' });
      invalidateIntegrations();
    }
  });
});

describe('robots.txt follows Admin → Settings → SEO', () => {
  it('allows or blocks AI crawlers as configured and points to an absolute sitemap', async () => {
    const admin = await createStaff('administrator');
    const allowed = await c.get('/robots.txt');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['content-type']).toMatch(/text\/plain/);
    expect(allowed.text).toMatch(/User-agent: GPTBot\nAllow: \//);
    expect(allowed.text).toContain('Disallow: /admin');
    expect(allowed.text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);

    expect((await admin.put('/api/admin/settings').send({ seo: { allowAiCrawlers: false } })).status).toBe(200);
    const blocked = await c.get('/robots.txt');
    expect(blocked.text).toMatch(/User-agent: GPTBot\nDisallow: \/\n/);
    expect(blocked.text).toMatch(/User-agent: ClaudeBot\nDisallow: \/\n/);
    // Regular search engines are unaffected.
    expect(blocked.text).toMatch(/User-agent: \*\nAllow: \//);
    await admin.put('/api/admin/settings').send({ seo: { allowAiCrawlers: true } });
  });
});

describe('discount codes can be deleted unless orders used them', () => {
  it('deletes an unused code; refuses a used one (deactivate instead)', async () => {
    const admin = await createStaff('admin');
    const unused = await admin.post('/api/admin/discounts').send({ code: 'DELME', type: 'percent', value: 5 });
    expect((await admin.delete(`/api/admin/discounts/${unused.body.data._id}`)).status).toBe(200);
    expect(await Discount.exists({ code: 'DELME' })).toBeNull();

    const used = await admin.post('/api/admin/discounts').send({ code: 'KEEPME', type: 'fixed', value: 5 });
    const order = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card', discountCode: 'KEEPME' });
    expect(order.status).toBe(201);
    const del = await admin.delete(`/api/admin/discounts/${used.body.data._id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('DISCOUNT_IN_USE');
    expect(await Discount.exists({ code: 'KEEPME' })).toBeTruthy();

    // Read-only discount staff cannot delete.
    const pm = await createStaff('product_manager');
    expect((await pm.delete(`/api/admin/discounts/${used.body.data._id}`)).status).toBe(403);
  });
});

describe('customer accounts can be suspended and reactivated', () => {
  it('suspension signs the customer out and blocks sign-in; reactivation restores it; permission-checked and audited', async () => {
    const { c: cust, email, id } = await createCustomer();
    expect((await cust.get('/api/auth/me')).body.data.email).toBe(email);

    const orderManager = await createStaff('order_manager'); // customers:read only
    expect((await orderManager.patch(`/api/admin/customers/${id}/status`).send({ active: false })).status).toBe(403);

    const admin = await createStaff('administrator');
    const s = await admin.patch(`/api/admin/customers/${id}/status`).send({ active: false, reason: 'fraud report' });
    expect(s.status).toBe(200);
    expect(s.body.data.active).toBe(false);
    expect((await cust.get('/api/auth/me')).body.data).toBeNull(); // existing session revoked
    const login = await client().post('/api/auth/login').send({ email, password: 'Passw0rd!x' });
    expect(login.status).toBe(401);

    const detail = await admin.get(`/api/admin/customers/${id}`);
    expect(detail.body.data.active).toBe(false);

    expect((await admin.patch(`/api/admin/customers/${id}/status`).send({ active: true })).status).toBe(200);
    expect((await client().post('/api/auth/login').send({ email, password: 'Passw0rd!x' })).status).toBe(200);

    const log = await AuditLog.find({ entity: 'customer', entityId: id }).sort({ createdAt: 1 }).lean();
    expect(log.map((l) => l.action)).toEqual(['customer_suspend', 'customer_reactivate']);
    expect(log[0].summary).toContain('fraud report');

    // Only customer accounts: a staff id is not found.
    const staffList = await createStaff('admin');
    const me = (await staffList.get('/api/auth/me')).body.data;
    expect((await admin.patch(`/api/admin/customers/${me._id ?? me.id}/status`).send({ active: false })).status).toBe(404);
  });
});

describe('reports use Riyadh calendar days', () => {
  it('computes day boundaries in UTC+3 regardless of the server time zone', () => {
    expect(riyadhDayStart(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(riyadhDayStart(new Date('2026-10-31T21:30:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z'); // 00:30 Riyadh, 1 Nov
    expect(riyadhDayStart(new Date('2026-10-31T20:59:00Z')).toISOString()).toBe('2026-10-30T21:00:00.000Z'); // 23:59 Riyadh, 31 Oct
    const r = range(new Date('2026-11-01'), new Date('2026-11-07'));
    expect(r.start.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-07T20:59:59.999Z');
  });

  it('an order placed at 01:30 Riyadh time on 1 Nov belongs to 1 Nov', async () => {
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-65W'), quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'cod' });
    expect(r.status).toBe(201);
    // createdAt is immutable in Mongoose; backdate through the driver.
    await Order.collection.updateOne({ orderNumber: r.body.data.order.orderNumber }, { $set: { createdAt: new Date('2026-10-31T22:30:00Z') } });
    const nov = await salesReport(new Date('2026-11-01'), new Date('2026-11-01'));
    expect(nov.summary.orders).toBe(1);
    expect(nov.daily).toEqual([{ date: '2026-11-01', orders: 1, revenue: 14900 }]);
    const oct = await salesReport(new Date('2026-10-31'), new Date('2026-10-31'));
    expect(oct.summary.orders).toBe(0);
  });
});
