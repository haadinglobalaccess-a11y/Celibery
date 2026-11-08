import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { invalidateIntegrations } from '../src/integrations/credentials';
import { orderEmail, placeholderErrors, whatsappParamErrors, whatsappStatusText } from '../src/integrations/notifications/templates';
import { storage, storageStatus } from '../src/integrations/storage';
import { Category, Notification, Order, Product, Settings } from '../src/models';
import { resolveDelivery } from '../src/modules/orders/delivery-rules';
import { address, client, contact, createStaff, uid, useDatabase } from './helpers';
import { eventually, startSmtpSink } from './smtp-sink';

/** Shipping zones, editable message templates, dynamic llms.txt and the Admin-managed S3 key. */
useDatabase();
const c = client();
const pid = async (sku: string) => String((await Product.findOne({ sku }).lean())!._id);

describe('shipping zones — rules', () => {
  const zones = [
    { key: 'riyadh', active: true, cities: ['Riyadh', 'الرياض'], freeDelivery: true, deliveryFee: 0, codEnabled: true },
    { key: 'north', active: true, cities: ['Tabuk', 'Al-Jouf'], freeDelivery: false, deliveryFee: 3500, freeDeliveryThreshold: 50000, codEnabled: false },
    { key: 'off', active: false, cities: ['Abha'], freeDelivery: true, deliveryFee: 0 },
  ];
  const store = { freeDelivery: false, deliveryFee: 2500, codEnabled: true, codFee: 1000, shippingZones: zones };
  it('uses the zone of the city (loose Arabic/English matching), store-wide rules otherwise', () => {
    expect(resolveDelivery(store, 'الرياض').zone?.key).toBe('riyadh');
    expect(resolveDelivery(store, 'riyadh ').rules.freeDelivery).toBe(true);
    expect(resolveDelivery(store, 'Jouf').zone?.key).toBe('north'); // "Al-" prefix folded
    expect(resolveDelivery(store, 'Tabuk').rules).toMatchObject({ deliveryFee: 3500, freeDeliveryThreshold: 50000, codEnabled: false });
    expect(resolveDelivery(store, 'Abha').zone).toBeNull(); // inactive zone ignored
    expect(resolveDelivery(store, 'Jeddah').rules.deliveryFee).toBe(2500);
    expect(resolveDelivery(store, undefined).zone).toBeNull();
  });
  it('a zone never enables COD the store has off, keeps the shipping pause, and can refuse unlisted cities', () => {
    expect(resolveDelivery({ ...store, codEnabled: false }, 'Riyadh').rules.codEnabled).toBe(false);
    expect(resolveDelivery({ ...store, shippingAvailable: false }, 'Riyadh').unavailable).toBe('paused');
    expect(resolveDelivery({ ...store, deliverToUnlistedCities: false }, 'Jeddah').unavailable).toBe('city');
    expect(resolveDelivery({ ...store, deliverToUnlistedCities: false }, undefined).unavailable).toBe(''); // city not known yet (cart)
    expect(resolveDelivery({ ...store, deliverToUnlistedCities: false }, 'Riyadh').unavailable).toBe('');
  });
});

describe('shipping zones — Admin settings drive the checkout', () => {
  it('validates, stores halalas, prices the quote per city, stores the zone on the order, and refuses uncovered cities', async () => {
    const admin = await createStaff('administrator');
    const dup = await admin.put('/api/admin/settings').send({ commerce: { shippingZones: [{ key: 'a', name: { ar: 'أ', en: 'A' }, cities: ['Riyadh'] }, { key: 'b', name: { ar: 'ب', en: 'B' }, cities: ['الرياض'] }] } });
    expect(dup.status).toBe(400); // same city (Arabic/English) in two active zones

    const ok = await admin.put('/api/admin/settings').send({
      commerce: {
        freeDelivery: false,
        deliveryFee: 25,
        codEnabled: true,
        codFee: 10,
        shippingZones: [
          { key: 'central', name: { ar: 'الوسطى', en: 'Central' }, cities: ['Riyadh'], freeDelivery: true, codEnabled: true, codFee: 5, estimatedDelivery: { ar: 'يوم واحد', en: '1 day' } },
          { key: 'north', name: { ar: 'الشمال', en: 'North' }, cities: ['Tabuk'], deliveryFee: 35, freeDeliveryThreshold: 300, codEnabled: false },
        ],
      },
    });
    expect(ok.status).toBe(200);
    const stored = (await Settings.findOne({ key: 'store' }).lean())!.commerce.shippingZones;
    expect(stored[1]).toMatchObject({ key: 'north', deliveryFee: 3500, freeDeliveryThreshold: 30000, codEnabled: false });
    expect(stored[0].codFee).toBe(500);
    expect(stored[1].codFee).toBeUndefined(); // empty = store-wide COD fee

    const items = [{ productId: await pid('DEMO-AD-65W'), quantity: 1 }]; // 149.00
    const q = (city?: string, paymentMethod?: string) => c.post('/api/cart/quote').send({ items, city, paymentMethod }).then((r) => r.body.data);
    expect((await q()).deliveryFee).toBe(2500); // city unknown: store-wide
    const riyadh = await q('الرياض', 'cod');
    expect(riyadh).toMatchObject({ deliveryFee: 0, codAvailable: true, codFee: 500, zone: { key: 'central', estimatedDelivery: { en: '1 day' } } });
    const tabuk = await q('Tabuk', 'cod');
    expect(tabuk).toMatchObject({ deliveryFee: 3500, codAvailable: false, codFee: 0 });
    expect((await q('Jeddah', 'cod')).codFee).toBe(1000);
    const bigTabuk = await c.post('/api/cart/quote').send({ items: [{ productId: items[0].productId, quantity: 3 }], city: 'Tabuk' });
    expect(bigTabuk.body.data.deliveryFee).toBe(0); // zone threshold 300 SAR

    // Checkout charges the zone price and records the zone.
    const order = await c.post('/api/checkout').send({ idempotencyKey: uid(), items, contact, shippingAddress: { ...address, city: 'Tabuk' }, paymentMethod: 'card' });
    expect(order.status).toBe(201);
    expect(order.body.data.order).toMatchObject({ deliveryFee: 3500, total: 14900 + 3500 });
    expect((await Order.findOne({ orderNumber: order.body.data.order.orderNumber }).lean())!.shippingZone).toBe('north');
    const cod = await c.post('/api/checkout').send({ idempotencyKey: uid(), items, contact, shippingAddress: { ...address, city: 'Tabuk' }, paymentMethod: 'cod' });
    expect(cod.body.error.code).toBe('COD_UNAVAILABLE');

    // Only zone cities when unlisted cities are switched off.
    await admin.put('/api/admin/settings').send({ commerce: { deliverToUnlistedCities: false } });
    expect(await q('Jeddah')).toMatchObject({ shippingAvailable: false, shippingUnavailableReason: 'city' });
    const refused = await c.post('/api/checkout').send({ idempotencyKey: uid(), items, contact, shippingAddress: { ...address, city: 'Jeddah' }, paymentMethod: 'card' });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('SHIPPING_CITY_UNAVAILABLE');

    await admin.put('/api/admin/settings').send({ commerce: { shippingZones: [], deliverToUnlistedCities: true, freeDelivery: true, deliveryFee: 0, codEnabled: false, codFee: 0 } });
  });
});

describe('message templates', () => {
  it('rules: placeholders must be known; WhatsApp text follows Meta parameter rules', () => {
    expect(placeholderErrors('Hi {{name}} {{orderNumber}}', ['name', 'orderNumber'])).toEqual([]);
    expect(placeholderErrors('Hi {{password}}', ['name'])[0]).toMatch(/Unknown placeholder \{\{password\}\}/);
    expect(placeholderErrors('Hi {{name}', ['name'])[0]).toMatch(/not written correctly/);
    expect(whatsappParamErrors('line\nbreak')).toHaveLength(1);
    expect(whatsappParamErrors('a     b')).toHaveLength(1);
    expect(whatsappParamErrors('x'.repeat(1025))).toHaveLength(1);
  });

  it('defaults reproduce the built-in wording; overrides are escaped and keep the system link', () => {
    const data = { name: 'Fahad', orderNumber: 'CEL-1', total: 14900, link: 'https://shop.test/o/1' };
    const d = orderEmail('en', 'shipped', data);
    expect(d.subject).toBe('Your order CEL-1 has shipped');
    expect(d.html).toContain('<p>Hello Fahad,</p><p>Your order is on its way.</p>');
    const o = orderEmail('en', 'shipped', { ...data, name: '<script>x</script>' }, { en: { body: 'Hi {{name}} <b>bold</b>' } });
    expect(o.html).toContain('Hi &lt;script&gt;x&lt;/script&gt; &lt;b&gt;bold&lt;/b&gt;');
    expect(o.html).toContain('href="https://shop.test/o/1"');
    expect(whatsappStatusText('ar', 'shipped', 'CEL-1')).toBe('تم شحن طلبك CEL-1');
  });

  it('Admin edits, previews and resets templates; sent emails use the saved wording', async () => {
    const sink = await startSmtpSink();
    try {
      const superAdmin = await createStaff('admin');
      const admin = await createStaff('administrator');
      expect((await (await createStaff('order_manager')).get('/api/admin/templates')).status).toBe(403);

      const list = await admin.get('/api/admin/templates');
      const placed = list.body.data.find((t: { key: string }) => t.key === 'order.order_placed');
      expect(placed).toMatchObject({ customized: false, whatsapp: true });
      expect(placed.variables).toContain('orderNumber');

      const bad = await admin.put('/api/admin/templates/order.order_placed').send({ en: { subject: 'Hi {{secret}}', whatsapp: 'two\nlines' } });
      expect(bad.status).toBe(400);
      expect(Object.keys(bad.body.error.details.fieldErrors).sort()).toEqual(['en.subject', 'en.whatsapp']);
      expect((await admin.put('/api/admin/templates/nope').send({})).status).toBe(400);

      const prev = await admin.post('/api/admin/templates/order.order_placed/preview').send({ lang: 'en', content: { subject: 'Thanks {{name}} — {{orderNumber}}' } });
      expect(prev.body.data.email.subject).toBe('Thanks Fahad — CEL-1042');
      expect(prev.body.data.whatsapp).toBe('We received your order CEL-1042');

      const saved = await admin.put('/api/admin/templates/order.order_placed').send({ en: { subject: 'Order {{orderNumber}} is in!', body: 'Dear {{name}},\n\nWe are on it.' } });
      expect(saved.status).toBe(200);
      expect(saved.body.data.customized).toBe(true);
      expect(saved.body.data.effective.ar.subject).toBe('تم استلام طلبك {{orderNumber}}'); // Arabic untouched

      // Real send through SMTP uses the saved wording.
      await superAdmin.put('/api/admin/integrations/smtp/live/credentials').send({ values: { host: '127.0.0.1', port: String(sink.port), security: 'starttls', fromEmail: 'shop@celibery.test' } });
      await superAdmin.post('/api/admin/integrations/smtp/live/verify');
      expect((await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
      await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
      const email = `tpl-${uid().slice(0, 6)}@test.local`;
      const r = await c.post('/api/checkout').send({ idempotencyKey: uid(), items: [{ productId: await pid('DEMO-AD-30W'), quantity: 1 }], contact: { ...contact, email }, shippingAddress: address, paymentMethod: 'cod', lang: 'en' });
      expect(r.status).toBe(201);
      const msg = (await eventually(() => sink.messages.find((m) => m.to.includes(email))))!;
      expect(msg.data).toContain(`Subject: Order ${r.body.data.order.orderNumber} is in!`);
      expect(msg.data).toContain('We are on it.');

      const reset = await admin.delete('/api/admin/templates/order.order_placed');
      expect(reset.body.data.customized).toBe(false);
      await superAdmin.post('/api/admin/integrations/smtp/activate').send({ enabled: false, mode: 'live' });
      await eventually(() => Notification.exists({ to: email, status: 'sent' }));
    } finally {
      await sink.close();
      await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': false } });
    }
  });
});

describe('llms.txt', () => {
  it('is generated from the live catalogue and settings', async () => {
    const r = await c.get('/llms.txt');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    const cats = await Category.find({ active: true }).sort({ sortOrder: 1 }).lean();
    for (const cat of cats) expect(r.text).toContain(`/en/c/${cat.slug}`);
    expect(r.text).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
    expect(r.text).toContain('free delivery across Saudi Arabia');

    // A new category appears, an inactive one disappears — no file to maintain.
    await Category.create({ slug: 'smart-home-test', name: { ar: 'المنزل الذكي', en: 'Smart Home Test' }, sortOrder: 99, active: true });
    await Category.updateOne({ slug: cats[0].slug }, { $set: { active: false } });
    const after = await c.get('/llms.txt');
    expect(after.text).toContain('[Smart Home Test]');
    expect(after.text).not.toContain(`/en/c/${cats[0].slug})`);
    await Category.updateOne({ slug: cats[0].slug }, { $set: { active: true } });
    await Category.deleteOne({ slug: 'smart-home-test' });
  });
});

describe('media storage key managed in Admin', () => {
  let server: http.Server;
  let port = 0;
  const seen: { method: string; auth: string; url: string }[] = [];
  const saved = { MEDIA_STORAGE: env.MEDIA_STORAGE, S3_ENDPOINT: env.S3_ENDPOINT, S3_BUCKET: env.S3_BUCKET, MEDIA_PUBLIC_BASE_URL: env.MEDIA_PUBLIC_BASE_URL, S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE };
  beforeAll(async () => {
    // A stand-in S3 endpoint that accepts only the key "AKIAGOODKEY000000001".
    server = http.createServer((req, res) => {
      const auth = req.headers.authorization ?? '';
      seen.push({ method: req.method!, auth, url: req.url! });
      res.statusCode = auth.includes('Credential=AKIAGOODKEY000000001/') ? (req.method === 'DELETE' ? 204 : 200) : 403;
      req.resume();
      req.on('end', () => res.end());
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    Object.assign(env, { MEDIA_STORAGE: 's3', S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_BUCKET: 'media', MEDIA_PUBLIC_BASE_URL: 'https://media.test', S3_FORCE_PATH_STYLE: true });
  });
  afterAll(async () => {
    Object.assign(env, saved);
    invalidateIntegrations();
    await new Promise((r) => server.close(r));
  });

  it('uploads stay off until a key is enabled; the key is tested with a real write + delete and then used to sign uploads', async () => {
    expect(storageStatus()).toMatchObject({ provider: 's3', uploadsEnabled: false });
    expect(storageStatus().reason).toMatch(/no storage access key/);

    const superAdmin = await createStaff('admin');
    expect((await (await createStaff('administrator')).get('/api/admin/integrations')).status).toBe(403);
    await superAdmin.put('/api/admin/integrations/s3/live/credentials').send({ values: { accessKeyId: 'AKIABADKEY0000000001', secretAccessKey: 'bad-secret-value-xyz' } });
    const bad = await superAdmin.post('/api/admin/integrations/s3/live/verify');
    expect(bad.body.data.check).toMatchObject({ ok: false });
    expect(bad.body.data.check.message).toMatch(/Access denied/);

    const SECRET = 'good-secret-value-0123456789';
    await superAdmin.put('/api/admin/integrations/s3/live/credentials').send({ values: { accessKeyId: 'AKIAGOODKEY000000001', secretAccessKey: SECRET } });
    const good = await superAdmin.post('/api/admin/integrations/s3/live/verify');
    expect(good.body.data.check).toMatchObject({ ok: true });
    const probes = seen.filter((s) => s.url.startsWith('/media/media/0000/00/healthcheck-') && s.auth.includes('AKIAGOODKEY'));
    expect(probes.map((p) => p.method)).toEqual(['PUT', 'DELETE']); // wrote, then cleaned up
    expect((await superAdmin.post('/api/admin/integrations/s3/activate').send({ enabled: true, mode: 'live' })).status).toBe(200);
    expect(JSON.stringify((await superAdmin.get('/api/admin/integrations')).body)).not.toContain(SECRET);

    expect(storageStatus().uploadsEnabled).toBe(true);
    const target = await storage()!.uploadTarget('media/2026/11/image-abcdefgh12.webp', 'image/webp', 'asset1');
    expect(target.url).toContain(`http://127.0.0.1:${port}/media/media/2026/11/image-abcdefgh12.webp`);
    expect(decodeURIComponent(target.url)).toContain('X-Amz-Credential=AKIAGOODKEY000000001/');

    await superAdmin.post('/api/admin/integrations/s3/activate').send({ enabled: false, mode: 'live' });
    expect(storageStatus().uploadsEnabled).toBe(false); // no environment key to fall back to in tests
  });
});
