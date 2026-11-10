import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateIntegrations } from '../src/integrations/credentials';
import { queueOrderConfirmation, retryOrderNotifications, sampleOrder, buildWhatsAppConfirmation, safeOverride } from '../src/integrations/notifications/order-confirmation';
import { whatsappNumber } from '../src/integrations/notifications/whatsapp-channel';
import { MessageTemplate, Notification, Order, OrderNotification, Product, Settings } from '../src/models';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';
import { eventually, startSmtpSink } from './smtp-sink';

/**
 * Order confirmation & notification system: one confirmation email per successful order (EN/AR,
 * full order details), retry after a mail-server failure without touching the order, a prepared
 * WhatsApp click-to-chat message that is never reported as delivered, admin templates with
 * validation and preview, duplicate prevention, and settings stored in the database.
 */
useDatabase();
const shop = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);
let sink: Awaited<ReturnType<typeof startSmtpSink>>;
let superAdmin: Awaited<ReturnType<typeof createStaff>>;
let admin: Awaited<ReturnType<typeof createStaff>>;

/** Subject and decoded text/html parts of a raw message received by the sink. */
function decode(data: string) {
  const qp = (t: string) => Buffer.from(t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  const raw = /^Subject: (.*(?:\n[ \t].*)*)/m.exec(data)?.[1].replace(/\n[ \t]/g, ' ') ?? '';
  const subject = raw.replace(/=\?UTF-8\?([QB])\?([^?]*)\?=\s*/gi, (_m, enc: string, txt: string) => (enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64').toString('utf8') : qp(txt.replace(/_/g, ' '))));
  const parts: string[] = [];
  for (const p of data.split(/\n--[^\n]+\n/)) {
    const i = p.indexOf('\n\n');
    if (i < 0) continue;
    const head = p.slice(0, i);
    const body = p.slice(i + 2);
    if (/Content-Transfer-Encoding: base64/i.test(head)) parts.push(Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8'));
    else if (/Content-Transfer-Encoding: quoted-printable/i.test(head)) parts.push(qp(body));
    else if (/Content-Type: text/i.test(head)) parts.push(body);
  }
  return { subject, body: parts.join('\n') };
}

const codOrder = async (email: string, lang: 'ar' | 'en' = 'en', qty = 1) => {
  const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: qty }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod', lang });
  expect(r.status).toBe(201);
  return withId(r.body.data.order);
};
/** The checkout response is the customer view (no database id); staff endpoints need the id. */
async function withId(order: { orderNumber: string }) {
  const doc = (await Order.findOne({ orderNumber: order.orderNumber }).lean())!;
  return { ...(order as object), _id: String(doc._id), orderNumber: doc.orderNumber, total: doc.total, items: doc.items as unknown as { name: { ar: string; en: string }; quantity: number }[] };
}
const mailsTo = (email: string) => sink.messages.filter((m) => m.to.includes(email));
const record = (orderId: string, channel: 'email' | 'whatsapp') => OrderNotification.findOne({ order: orderId, channel }).lean();
const sentRecord = (orderId: string) => eventually(async () => {
  const r = await record(orderId, 'email');
  return r && r.status === 'sent' ? r : null;
});
const money = (h: number) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

beforeAll(async () => {
  sink = await startSmtpSink();
  superAdmin = await createStaff('admin');
  admin = await createStaff('administrator');
  await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
  await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: { host: '127.0.0.1', port: String(sink.port), security: 'starttls', fromEmail: 'orders@celibery.test', fromName: 'CELIBERY' } });
  await superAdmin.post('/api/admin/integrations/smtp/live/verify');
  expect((await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
});
afterAll(async () => {
  invalidateIntegrations();
  await sink?.close();
});

describe('order confirmation email', () => {
  it('1–2. a successful order sends exactly ONE confirmation email with the correct order details', async () => {
    const email = `conf-${uid().slice(0, 6)}@test.local`;
    const o = await codOrder(email, 'en', 2);
    const rec = await sentRecord(o._id);
    expect(rec).toMatchObject({ status: 'sent', to: email, attempts: 1, provider: 'smtp' });
    await new Promise((r) => setTimeout(r, 400));
    expect(mailsTo(email)).toHaveLength(1); // not an additional "order received" email
    expect(await Notification.exists({ to: email, template: 'order.order_placed', channel: 'email' })).toBeNull();

    const { subject, body } = decode(mailsTo(email)[0].data);
    expect(subject).toContain(`Order confirmation ${o.orderNumber}`);
    for (const part of [`Hello ${contact.name}`, o.orderNumber, o.items[0].name.en, '× 2', money(o.total), 'Cash on delivery', 'Confirmed', address.street, address.city, 'Order date', 'Shipping address', 'Tracking number', 'Shared once your order ships'])
      expect(body).toContain(part);
    expect(body).toContain(`/en/track?order=${o.orderNumber}`); // guest: private link of the immediate attempt
    expect(body).not.toMatch(/\{\{|\}\}/);
    expect(await Notification.exists({ to: email, template: 'order.confirmation', status: 'sent' })).toBeTruthy();
  });

  it('3. Arabic orders get the Arabic template (right-to-left), English orders the English one', async () => {
    const email = `conf-ar-${uid().slice(0, 6)}@test.local`;
    const o = await codOrder(email, 'ar');
    const rec = await sentRecord(o._id);
    expect(rec!.subject).toBe(`تأكيد الطلب ${o.orderNumber} — سيليبري إنترناشونال`);
    const { subject, body } = decode(mailsTo(email)[0].data);
    expect(subject).toContain('تأكيد الطلب');
    expect(body).toContain('dir="rtl"');
    expect(body).toContain(`مرحباً ${contact.name}`);
    expect(body).toContain('الدفع عند الاستلام');
    expect(body).toContain(o.items[0].name.ar);
    expect(body).toContain('مؤكد');
    expect(body).not.toContain('Cash on delivery');
  });

  it('online payment: no confirmation while unpaid; exactly one after the payment is confirmed (replays ignored)', async () => {
    const email = `conf-card-${uid().slice(0, 6)}@test.local`;
    const r = await shop.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'card', lang: 'en' });
    expect(r.status).toBe(201);
    const { accessToken, redirectUrl } = r.body.data;
    const order = await withId(r.body.data.order);
    await new Promise((res) => setTimeout(res, 300));
    expect(await record(order._id, 'email')).toBeNull();
    expect(mailsTo(email)).toHaveLength(0);

    const ref = String(redirectUrl).split('/').pop();
    expect((await shop.post(`/api/payments/sandbox/${ref}/complete`).send({ outcome: 'success' })).status).toBe(200);
    expect((await shop.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken })).body.data.paymentStatus).toBe('paid');
    await sentRecord(order._id);
    // Webhook replay / second verification / repeated trigger: still one email.
    await shop.post(`/api/orders/${order.orderNumber}/verify-payment`).send({ token: accessToken });
    await queueOrderConfirmation(order._id);
    await new Promise((res) => setTimeout(res, 400));
    expect(mailsTo(email)).toHaveLength(1);
    const { body } = decode(mailsTo(email)[0].data);
    expect(body).toContain('Credit / debit card');
  });

  it('8. a mail-server failure never affects the order; the email is retried and sent once later', async () => {
    sink.setFailing(true);
    const email = `conf-fail-${uid().slice(0, 6)}@test.local`;
    let o;
    try {
      o = await codOrder(email); // the order itself succeeds
      const failed = await eventually(async () => {
        const r = await record(o!._id, 'email');
        return r?.status === 'failed' ? r : null;
      });
      expect(failed!.attempts).toBe(1);
      expect(failed!.nextAttemptAt).toBeTruthy();
      expect(failed!.lastError).toMatch(/451|Temporary/);
      expect((await Order.findById(o._id).lean())!.status).toBe('confirmed');
      expect(await Notification.exists({ to: email, template: 'order.confirmation', status: 'failed' })).toBeTruthy();
      // Not due yet → the scheduled job leaves it alone.
      await retryOrderNotifications();
      expect((await record(o._id, 'email'))!.attempts).toBe(1);
    } finally {
      sink.setFailing(false);
    }
    await OrderNotification.updateOne({ order: o._id, channel: 'email' }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const r = await retryOrderNotifications();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const rec = await record(o._id, 'email');
    expect(rec).toMatchObject({ status: 'sent', attempts: 2 });
    expect(rec!.history.map((h) => h.action)).toEqual(['queued', 'attempt_failed', 'sent']);
    expect(mailsTo(email)).toHaveLength(1);
    // A guest's retried email links to the tracking page (the private token is never stored).
    expect(decode(mailsTo(email)[0].data).body).toContain(`/en/track?order=${o.orderNumber}`);
  });

  it('gives up after the maximum attempts (no endless retries)', async () => {
    sink.setFailing(true);
    try {
      const o = await codOrder(`conf-max-${uid().slice(0, 6)}@test.local`);
      await eventually(async () => (await record(o._id, 'email'))?.status === 'failed');
      for (let i = 0; i < 6; i++) {
        await OrderNotification.updateOne({ order: o._id, channel: 'email', nextAttemptAt: { $ne: null } }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
        await retryOrderNotifications();
      }
      const rec = await record(o._id, 'email');
      expect(rec).toMatchObject({ status: 'failed', attempts: 5, nextAttemptAt: null });
      expect(rec!.history.at(-1)!.detail).toMatch(/no more automatic retries/);
    } finally {
      sink.setFailing(false);
    }
  });

  it('9. duplicates are prevented: parallel triggers create one email; resending needs an explicit choice', async () => {
    const email = `conf-dup-${uid().slice(0, 6)}@test.local`;
    const o = await codOrder(email);
    await sentRecord(o._id);
    await Promise.all([queueOrderConfirmation(o._id), queueOrderConfirmation(o._id), queueOrderConfirmation(o._id)]);
    expect(await OrderNotification.countDocuments({ order: o._id, channel: 'email' })).toBe(1);

    const again = await admin.post(`/api/admin/order-notifications/orders/${o._id}/email`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SENT');
    await new Promise((r) => setTimeout(r, 200));
    expect(mailsTo(email)).toHaveLength(1);

    const resend = await admin.post(`/api/admin/order-notifications/orders/${o._id}/email`).send({ resend: true });
    expect(resend.status).toBe(200);
    expect(resend.body.data.email.status).toBe('sent');
    expect(mailsTo(email)).toHaveLength(2);
    expect(resend.body.data.email.history.map((h: { action: string }) => h.action)).toContain('resend_requested');
    expect(resend.body.data.email.history.find((h: { action: string }) => h.action === 'resend_requested').by.name).toBe('Test administrator');

    // Concurrent independent triggers on an order without a record: still one email.
    const email2 = `conf-par-${uid().slice(0, 6)}@test.local`;
    const o2 = await codOrder(email2);
    await sentRecord(o2._id);
    await OrderNotification.deleteMany({ order: o2._id });
    sink.messages.splice(0, sink.messages.length, ...sink.messages.filter((m) => !m.to.includes(email2)));
    await Promise.all(Array.from({ length: 5 }, () => queueOrderConfirmation(o2._id)));
    await sentRecord(o2._id);
    await new Promise((r) => setTimeout(r, 400));
    expect(mailsTo(email2)).toHaveLength(1);
  });
});

describe('WhatsApp click-to-chat confirmation (no WhatsApp API)', () => {
  it('5–7. prepares the message for the customer number; opening WhatsApp is never counted as delivered', async () => {
    const o = await codOrder(`wa-${uid().slice(0, 6)}@test.local`);
    const v = await eventually(async () => {
      const r = await admin.get(`/api/admin/order-notifications/orders/${o._id}`);
      return r.body.data.whatsapp ? r.body.data : null;
    });
    expect(v.config.whatsappApi).toBe(false);
    expect(v.whatsapp).toMatchObject({ status: 'prepared', to: '966551234567' });
    const link: string = v.whatsapp.link;
    expect(link.startsWith('https://wa.me/966551234567?text=')).toBe(true);
    const text = decodeURIComponent(link.split('?text=')[1]);
    expect(text).toBe(v.whatsapp.message);
    for (const part of [`Hello ${contact.name},`, o.orderNumber, `Order Total: ${money(o.total)} SAR`, o.items[0].name.en, 'Payment method: Cash on delivery']) expect(text).toContain(part);
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(v.whatsapp.history[0].detail).toMatch(/Not sent yet/);

    const opened = await admin.post(`/api/admin/order-notifications/orders/${o._id}/whatsapp/opened`).send({});
    expect(opened.body.data.whatsapp.status).toBe('opened'); // NOT sent
    expect(opened.body.data.whatsapp.confirmedAt).toBeNull();
    expect(await Notification.exists({ order: o._id, channel: 'whatsapp', status: 'sent' })).toBeNull();

    const confirmed = await admin.post(`/api/admin/order-notifications/orders/${o._id}/whatsapp/confirm-sent`).send({});
    expect(confirmed.body.data.whatsapp).toMatchObject({ status: 'sent_manual', confirmedBy: { name: 'Test administrator' } });
    expect((await admin.post(`/api/admin/order-notifications/orders/${o._id}/whatsapp/confirm-sent`).send({})).status).toBe(409);
    expect((await admin.post(`/api/admin/order-notifications/orders/${o._id}/whatsapp/prepare`).send({})).status).toBe(409);
    const again = await admin.post(`/api/admin/order-notifications/orders/${o._id}/whatsapp/prepare`).send({ again: true });
    expect(again.body.data.whatsapp.status).toBe('prepared');
    expect(again.body.data.whatsapp.history.map((h: { action: string }) => h.action)).toEqual(['prepared', 'opened', 'confirmed_sent', 'prepared_again']);
  });

  it('an invalid customer phone is handled gracefully (skipped with the reason, nothing broken)', async () => {
    const o = await codOrder(`wa-bad-${uid().slice(0, 6)}@test.local`);
    await eventually(() => record(o._id, 'whatsapp'));
    await Order.updateOne({ _id: o._id }, { $set: { 'contact.phone': '12', 'shippingAddress.phone': 'n/a' } });
    const r = await admin.post(`/api/admin/order-notifications/orders/${o._id}/whatsapp/prepare`).send({ again: true });
    expect(r.status).toBe(200);
    expect(r.body.data.whatsapp).toMatchObject({ status: 'skipped', link: null, lastError: expect.stringMatching(/not a valid WhatsApp number/) });
  });

  it('validates phone numbers', () => {
    expect(whatsappNumber('0551234567')).toBe('966551234567');
    expect(whatsappNumber('+966 55 123 4567')).toBe('966551234567');
    expect(whatsappNumber('00966551234567')).toBe('966551234567');
    expect(whatsappNumber('551234567')).toBe('966551234567');
    expect(whatsappNumber('+971 50 123 4567')).toBe('971501234567');
    expect(whatsappNumber('0112345678')).toBeNull(); // Saudi landline
    expect(whatsappNumber('96611234567')).toBeNull();
    expect(whatsappNumber('12')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
  });
});

describe('templates and settings', () => {
  it('4. admin edits and previews the templates; unknown variables are refused', async () => {
    const list = await admin.get('/api/admin/templates');
    const t = list.body.data.find((x: { key: string }) => x.key === 'order.confirmation');
    expect(t).toMatchObject({ whatsapp: true, whatsappMode: 'chat', customized: false });
    expect(t.variables).toEqual(['customer_name', 'order_number', 'order_date', 'order_total', 'currency', 'payment_method', 'order_status', 'products', 'shipping_address', 'tracking_number', 'store_name']);

    const bad = await admin.put('/api/admin/templates/order.confirmation').send({ en: { subject: 'Hi {{customer}}', whatsapp: 'Order {{order_no}}' }, ar: { body: 'مرحباً {{name}}' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fieldErrors).sort()).toEqual(['ar.body', 'en.subject', 'en.whatsapp']);

    const wa = 'Hi {{customer_name}},\n\nOrder {{order_number}} — {{order_total}} {{currency}}\n{{products}}';
    const prev = await admin.post('/api/admin/templates/order.confirmation/preview').send({ lang: 'en', content: { subject: 'Thanks {{customer_name}}: {{order_number}}', whatsapp: wa } });
    expect(prev.status).toBe(200);
    expect(prev.body.data.email.subject).toBe('Thanks Sample Customer: CEL-SAMPLE');
    expect(prev.body.data.email.html).toContain('Sample product A');
    expect(prev.body.data.whatsapp).toBe('Hi Sample Customer,\n\nOrder CEL-SAMPLE — 298.00 SAR\n• Sample product A × 1 — 199.00 SAR\n• Sample product B × 2 — 99.00 SAR');
    const prevAr = await admin.post('/api/admin/templates/order.confirmation/preview').send({ lang: 'ar' });
    expect(prevAr.body.data.whatsapp).toContain('إجمالي الطلب: 298.00 ر.س');
    expect(prevAr.body.data.email.html).toContain('dir="rtl"');

    expect((await admin.put('/api/admin/templates/order.confirmation').send({ en: { subject: 'Your {{store_name}} order {{order_number}}', whatsapp: wa } })).status).toBe(200);
    const email = `tpl-${uid().slice(0, 6)}@test.local`;
    const o = await codOrder(email);
    const rec = await sentRecord(o._id);
    expect(rec!.subject).toBe(`Your CELIBERY International order ${o.orderNumber}`);
    const w = await eventually(() => record(o._id, 'whatsapp'));
    expect(w!.message.startsWith(`Hi ${contact.name},\n\nOrder ${o.orderNumber} — ${money(o.total)} SAR\n• `)).toBe(true);
    await admin.delete('/api/admin/templates/order.confirmation');
  });

  it('an invalid template stored in the database falls back to the default wording (never a broken message)', async () => {
    await MessageTemplate.updateOne({ key: 'order.confirmation' }, { $set: { 'en.whatsapp': 'Order {{bogus}}' } }, { upsert: true });
    const stored = (await MessageTemplate.findOne({ key: 'order.confirmation' }).lean()) as never;
    const { override, problems } = safeOverride(stored);
    expect(override).toBeNull();
    expect(problems[0]).toMatch(/bogus/);
    const msg = buildWhatsAppConfirmation(sampleOrder('en'), 'en', override);
    expect(msg).toContain('Your order CEL-SAMPLE has been successfully received.');
    expect(msg).not.toContain('{{');
    await MessageTemplate.deleteOne({ key: 'order.confirmation' });
  });

  it('10. settings persist in the database; switches turn each channel off', async () => {
    expect((await admin.put('/api/admin/settings').send({ orderNotifications: { whatsappBusinessNumber: '123' } })).status).toBe(400);
    expect((await admin.put('/api/admin/settings').send({ orderNotifications: { confirmationEmail: false, whatsappPrepare: false, whatsappBusinessNumber: '+966 55 111 2222' } })).status).toBe(200);
    const s = await admin.get('/api/admin/settings');
    expect(s.body.data.settings.orderNotifications).toEqual({ confirmationEmail: false, whatsappPrepare: false, whatsappBusinessNumber: '966551112222' });
    expect((await Settings.findOne({ key: 'store' }).lean())!.orderNotifications!.whatsappBusinessNumber).toBe('966551112222');

    // Off: no confirmation record; the regular "order received" update email is sent instead.
    const email = `off-${uid().slice(0, 6)}@test.local`;
    const o = await codOrder(email);
    await eventually(() => Notification.exists({ to: email, template: 'order.order_placed', status: 'sent' }));
    await new Promise((r) => setTimeout(r, 300));
    expect(await OrderNotification.countDocuments({ order: o._id })).toBe(0);
    expect(mailsTo(email)).toHaveLength(1);

    const view = await admin.get(`/api/admin/order-notifications/orders/${o._id}`);
    expect(view.body.data.config).toMatchObject({ emailEnabled: false, whatsappEnabled: false, businessNumber: '966551112222', smtpConfigured: true });
    expect(JSON.stringify(view.body)).not.toMatch(/pass|smtp\.|127\.0\.0\.1/i);

    await admin.put('/api/admin/settings').send({ orderNotifications: { confirmationEmail: true, whatsappPrepare: true } });
  });

  it('test email and test WhatsApp preparation from Settings (permission: settings:write)', async () => {
    const to = `test-${uid().slice(0, 6)}@test.local`;
    const r = await admin.post('/api/admin/order-notifications/test-email').send({ to, lang: 'ar' });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ sent: true, to, from: 'orders@celibery.test' });
    const { subject, body } = decode((await eventually(() => mailsTo(to)[0]))!.data);
    expect(subject).toContain('[TEST] تأكيد الطلب CEL-SAMPLE');
    expect(body).toContain('منتج تجريبي أ');

    const w = await admin.post('/api/admin/order-notifications/test-whatsapp').send({ phone: '0551234567', lang: 'en' });
    expect(w.body.data).toMatchObject({ status: 'prepared', to: '966551234567', from: '966551112222' });
    expect(w.body.data.link).toMatch(/^https:\/\/wa\.me\/966551234567\?text=Hello%20Sample%20Customer/);
    expect((await admin.post('/api/admin/order-notifications/test-whatsapp').send({ phone: '12345', lang: 'en' })).status).toBe(422);

    const manager = await createStaff('order_manager');
    expect((await manager.post('/api/admin/order-notifications/test-email').send({ to, lang: 'en' })).status).toBe(403);
    expect((await manager.post('/api/admin/order-notifications/test-whatsapp').send({ phone: '0551234567', lang: 'en' })).status).toBe(403);
  });

  it('without SMTP: the email is recorded as skipped with the reason and can be sent later', async () => {
    expect((await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: false, mode: 'live' })).status).toBe(200);
    const email = `nosmtp-${uid().slice(0, 6)}@test.local`;
    try {
      const o = await codOrder(email);
      const rec = await eventually(async () => {
        const r = await record(o._id, 'email');
        return r?.status === 'skipped' ? r : null;
      });
      expect(rec!.lastError).toMatch(/not configured or disabled/);
      expect((await Order.findById(o._id).lean())!.status).toBe('confirmed');
      expect((await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
      const sent = await admin.post(`/api/admin/order-notifications/orders/${o._id}/email`).send({});
      expect(sent.body.data.email.status).toBe('sent');
      expect(mailsTo(email)).toHaveLength(1);
    } finally {
      await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' });
    }
  });
});
