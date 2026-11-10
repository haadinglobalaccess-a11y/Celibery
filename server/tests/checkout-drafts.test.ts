import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuditLog, CheckoutDraft, Order, Product, Settings } from '../src/models';
import { containsCardNumber, markAbandonedDrafts } from '../src/modules/checkout-drafts/draft.service';
import { sha256 } from '../src/lib/tokens';
import { address, client, createCustomer, createStaff, uid, useDatabase } from './helpers';

useDatabase();

/** The browser creates its token before the first save (lib/checkoutDraft.ts). */
const browserToken = () => crypto.randomBytes(32).toString('base64url');
const pid = async (sku = 'DEMO-AD-30W') => String((await Product.findOne({ sku }).lean())!._id);
const byToken = (token: string) => CheckoutDraft.findOne({ tokenHash: sha256(token) }).lean();
/** Moves a draft's last activity into the past (instead of waiting for the inactivity threshold). */
const ageDraft = (token: string, minutes: number) => CheckoutDraft.updateOne({ tokenHash: sha256(token) }, { $set: { lastActivityAt: new Date(Date.now() - minutes * 60_000) } });

const fullForm = async (token: string) => ({
  token,
  items: [{ productId: await pid(), quantity: 2 }],
  contact: { name: 'Fahad Al-Test', email: 'fahad.draft@test.local', phone: '0551234567' },
  shippingAddress: { fullName: 'Fahad Al-Test', phone: '0551234567', city: 'Riyadh', district: 'Al Olaya', street: 'King Fahd Road', buildingNumber: '1234', postalCode: '12211', shortAddress: 'RRRD1234' },
  paymentMethod: 'card',
  lang: 'en',
});

describe('abandoned / incomplete checkout tracking', () => {
  it('1 & 4. a complete form saved progressively is kept when the customer just leaves (or the device shuts down)', async () => {
    const shop = client();
    const token = browserToken();
    // The same request may arrive twice (normal save + the keepalive sent while the page closed).
    const body = await fullForm(token);
    const r1 = await shop.put('/api/checkout/draft').send(body);
    const r2 = await shop.put('/api/checkout/draft').send(body);
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ enabled: true, token: null, status: 'in_progress', progress: 100 });
    expect(r2.body.data.token).toBeNull();
    expect(await CheckoutDraft.countDocuments({ tokenHash: sha256(token) })).toBe(1); // one record, never duplicated
    const d = (await byToken(token))!;
    expect(d.contact).toMatchObject({ name: 'Fahad Al-Test', email: 'fahad.draft@test.local', phone: '0551234567' });
    expect(d.shippingAddress).toMatchObject({ city: 'Riyadh', street: 'King Fahd Road', shortAddress: 'RRRD1234' });
    expect(d.items[0]).toMatchObject({ quantity: 2, sku: 'DEMO-AD-30W' });
    expect(d.total).toBeGreaterThan(0);
    expect(await Order.countDocuments({ 'contact.email': 'fahad.draft@test.local' })).toBe(0); // a draft never creates an order
  });

  it('2. only name and phone: exactly that is kept, with progress and the missing fields', async () => {
    const token = browserToken();
    await client().put('/api/checkout/draft').send({ token, items: [{ productId: await pid(), quantity: 1 }], contact: { name: 'Sara', phone: '0559876543', email: 'sara@' } });
    const d = (await byToken(token))!;
    expect(d.contact).toMatchObject({ name: 'Sara', phone: '0559876543', email: '' }); // half-typed email is not kept
    expect(d.completedFields).toEqual(['name', 'phone']);
    expect(d.progress).toBe(22);
    const admin = await createStaff('admin');
    const detail = (await admin.get(`/api/admin/checkouts/${d._id}`)).body.data;
    expect(detail.missingFields).toEqual(['email', 'fullName', 'addressPhone', 'city', 'district', 'street', 'paymentMethod']);
  });

  it('3 & 5. offline retries and page refreshes update the same record and restore what was entered', async () => {
    const shop = client();
    const token = browserToken();
    const first = await fullForm(token);
    first.shippingAddress = { ...first.shippingAddress, street: '' };
    await shop.put('/api/checkout/draft').send(first);
    // Connection dropped; the queued newer state is sent later, possibly more than once.
    const later = await fullForm(token);
    for (let i = 0; i < 3; i++) await shop.put('/api/checkout/draft').send(later);
    expect(await CheckoutDraft.countDocuments({ 'contact.email': 'fahad.draft@test.local', tokenHash: sha256(token) })).toBe(1);
    // Refresh: the browser asks for its saved checkout.
    const restored = (await shop.get(`/api/checkout/draft?token=${token}`)).body.data;
    expect(restored.contact.name).toBe('Fahad Al-Test');
    expect(restored.shippingAddress.street).toBe('King Fahd Road');
    expect(restored.paymentMethod).toBe('card');
    expect(restored.items[0]).toMatchObject({ quantity: 2, slug: expect.any(String), price: expect.any(Number) });
    expect(restored).not.toHaveProperty('tokenHash');
  });

  it('abandonment uses the configurable inactivity threshold; 6. returning marks it recovered', async () => {
    await Settings.updateOne({ key: 'store' }, { $set: { 'checkoutRecovery.abandonAfterMinutes': 30 } });
    const admin = await createStaff('admin');
    const shop = client();
    const token = browserToken();
    await shop.put('/api/checkout/draft').send(await fullForm(token));
    const id = String((await byToken(token))!._id);
    const status = async () => (await admin.get(`/api/admin/checkouts/${id}`)).body.data.status;

    await ageDraft(token, 20);
    expect(await status()).toBe('in_progress'); // still within 30 minutes: not abandoned while possibly active
    await ageDraft(token, 31);
    expect(await status()).toBe('abandoned'); // derived from last activity even before the job runs
    expect((await markAbandonedDrafts()).abandoned).toBeGreaterThan(0);
    const stored = (await byToken(token))!;
    expect(stored.status).toBe('abandoned');
    expect(Math.abs(new Date(stored.abandonedAt!).getTime() - (new Date(stored.lastActivityAt).getTime() + 30 * 60_000))).toBeLessThan(1000);

    // The customer comes back and resumes.
    await shop.get(`/api/checkout/draft?token=${token}`);
    const back = (await admin.get(`/api/admin/checkouts/${id}`)).body.data;
    expect(back).toMatchObject({ status: 'recovered', returned: true, returnCount: 1 });
    const recoveredList = (await admin.get('/api/admin/checkouts?filter=recovered')).body.data.map((d: { id: string }) => d.id);
    expect(recoveredList).toContain(id);
    await Settings.updateOne({ key: 'store' }, { $set: { 'checkoutRecovery.abandonAfterMinutes': 60 } });
  });

  it('7–9. placing the order converts and links the checkout, once; drafts never duplicate orders', async () => {
    await Settings.updateOne({ key: 'store' }, { $set: { 'commerce.codEnabled': true, 'commerce.codFee': 0 } });
    const shop = client();
    const token = browserToken();
    const form = await fullForm(token);
    await shop.put('/api/checkout/draft').send(form);
    const idempotencyKey = uid();
    const checkout = { idempotencyKey, items: form.items, contact: form.contact, shippingAddress: address, paymentMethod: 'cod', lang: 'en', draftToken: token };
    const r = await shop.post('/api/checkout').send(checkout);
    expect(r.status).toBe(201);
    const orderNumber = r.body.data.order.orderNumber;
    const d = (await byToken(token))!;
    expect(d).toMatchObject({ status: 'converted', orderNumber });
    expect(String(d.order)).toBe(r.body.data.order.id);

    // Replayed checkout (double click / retry): same order, no second link, no second order.
    const again = await shop.post('/api/checkout').send(checkout);
    expect(again.body.data.order.orderNumber).toBe(orderNumber);
    expect(await Order.countDocuments({ idempotencyKey })).toBe(1);
    expect(await CheckoutDraft.countDocuments({ order: d.order })).toBe(1);

    // A save with the finished checkout's token starts a NEW checkout (fresh token), never touches the converted one.
    const next = await shop.put('/api/checkout/draft').send(await fullForm(token));
    expect(next.body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next.body.data.token).not.toBe(token);
    expect((await byToken(token))!.status).toBe('converted');

    const admin = await createStaff('admin');
    const converted = (await admin.get('/api/admin/checkouts?filter=converted')).body.data;
    expect(converted.find((x: { order: { orderNumber: string } | null }) => x.order?.orderNumber === orderNumber)).toBeTruthy();
    const incomplete = (await admin.get('/api/admin/checkouts?filter=incomplete')).body.data;
    expect(incomplete.some((x: { order: unknown }) => x.order)).toBe(false);
  });

  it('10. signed-in customers: linked to the account, resumable without the token, private to them', async () => {
    const { c: alice, id: aliceId } = await createCustomer();
    const { c: bob } = await createCustomer();
    const token = browserToken();
    await alice.put('/api/checkout/draft').send(await fullForm(token));
    const d = (await byToken(token))!;
    expect(String(d.customer)).toBe(aliceId);
    // Another device (no token): the customer's own unfinished checkout comes back.
    expect((await alice.get('/api/checkout/draft')).body.data.contact.name).toBe('Fahad Al-Test');
    // Nobody else can read or overwrite it — not another customer, not an anonymous visitor with the token.
    expect((await bob.get(`/api/checkout/draft?token=${token}`)).body.data).toBeNull();
    expect((await client().get(`/api/checkout/draft?token=${token}`)).body.data).toBeNull();
    const hijack = await client().put('/api/checkout/draft').send({ ...(await fullForm(token)), contact: { name: 'Mallory', email: 'm@test.local', phone: '0550000000' } });
    expect(hijack.body.data.token).not.toBe(token); // a separate draft was created instead
    expect((await byToken(token))!.contact?.name).toBe('Fahad Al-Test');
    expect((await bob.delete('/api/checkout/draft').send({ token })).body.data.deleted).toBe(false);
    // Guests: no customer link, no invented identity.
    const guestToken = browserToken();
    await client().put('/api/checkout/draft').send({ token: guestToken, items: [{ productId: await pid(), quantity: 1 }] });
    const guest = (await byToken(guestToken))!;
    expect(guest.customer).toBeUndefined();
    expect(guest.contact).toMatchObject({ name: '', email: '', phone: '' });
  });

  it('11. payment details are never captured; prices come from the store, not the browser', async () => {
    const token = browserToken();
    const card = '4111 1111 1111 1111';
    const form = await fullForm(token);
    await client()
      .put('/api/checkout/draft')
      .send({
        ...form,
        cardNumber: card,
        cvv: '123',
        password: 'secret',
        items: [{ productId: form.items[0].productId, quantity: 1, unitPrice: 1 }],
        shippingAddress: { ...form.shippingAddress, street: `Card ${card}` },
        contact: { ...form.contact, name: '4111-1111-1111-1111' },
      });
    const raw = (await CheckoutDraft.collection.findOne({ tokenHash: sha256(token) }))!;
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/4111|cvv|cardNumber|password|secret/);
    expect(raw.shippingAddress.street).toBe('');
    expect(raw.contact.name).toBe('');
    const product = (await Product.findById(form.items[0].productId).lean())!;
    expect(raw.items[0].unitPrice).toBe(product.price);
    expect(containsCardNumber('Building 1234, PO 12211')).toBe(false);
    expect(containsCardNumber('5555555555554444')).toBe(true);
  });

  it('12. admin: list, filters, search, detail, delete — with permissions', async () => {
    const admin = await createStaff('admin');
    const token = browserToken();
    await client().put('/api/checkout/draft').send({ ...(await fullForm(token)), contact: { name: 'Searchable Person', email: 'find.me@test.local', phone: '0551112223' } });
    const list = await admin.get('/api/admin/checkouts?q=find.me');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ status: 'in_progress', contact: { name: 'Searchable Person' }, progress: 100 });
    expect(list.body.meta.counts).toMatchObject({ incomplete: expect.any(Number), converted: expect.any(Number), in_progress: expect.any(Number) });
    expect((await admin.get('/api/admin/checkouts?q=0551112223')).body.data).toHaveLength(1);
    expect((await admin.get('/api/admin/checkouts?filter=in_progress&q=find.me')).body.data).toHaveLength(1);
    expect((await admin.get('/api/admin/checkouts?filter=converted&q=find.me')).body.data).toHaveLength(0);
    expect((await admin.get('/api/admin/checkouts?filter=nonsense')).status).toBe(400);
    const id = list.body.data[0].id;

    // Customer data: staff without order access, customers and visitors are refused.
    expect((await (await createStaff('content_editor')).get('/api/admin/checkouts')).status).toBe(403);
    expect((await (await createCustomer()).c.get('/api/admin/checkouts')).status).toBe(403);
    expect((await client().get(`/api/admin/checkouts/${id}`)).status).toBe(401);
    // Order managers can read; deleting needs orders:write and is audited.
    const om = await createStaff('order_manager');
    expect((await om.get(`/api/admin/checkouts/${id}`)).status).toBe(200);
    expect((await admin.delete(`/api/admin/checkouts/${id}`)).status).toBe(200);
    expect(await CheckoutDraft.exists({ _id: id })).toBeNull();
    expect(await AuditLog.exists({ entity: 'checkout_draft', entityId: id })).toBeTruthy();
  });

  it('settings: saving can be switched off; retention sets the expiry (TTL index)', async () => {
    const days = 12;
    await Settings.updateOne({ key: 'store' }, { $set: { 'checkoutRecovery.retentionDays': days } });
    const token = browserToken();
    await client().put('/api/checkout/draft').send(await fullForm(token));
    const d = (await byToken(token))!;
    expect(Math.abs(new Date(d.expiresAt).getTime() - (Date.now() + days * 86_400_000))).toBeLessThan(60_000);
    const indexes = await CheckoutDraft.collection.indexes();
    expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);

    await Settings.updateOne({ key: 'store' }, { $set: { 'checkoutRecovery.enabled': false } });
    const off = browserToken();
    expect((await client().put('/api/checkout/draft').send(await fullForm(off))).body.data).toEqual({ enabled: false });
    expect(await byToken(off)).toBeNull();
    expect((await client().get('/api/settings/public')).body.data.checkoutRecovery).toEqual({ enabled: false });
    await Settings.updateOne({ key: 'store' }, { $set: { 'checkoutRecovery.enabled': true, 'checkoutRecovery.retentionDays': 30 } });
  });

  it('the customer can erase what was saved', async () => {
    const shop = client();
    const token = browserToken();
    await shop.put('/api/checkout/draft').send(await fullForm(token));
    expect((await shop.delete('/api/checkout/draft').send({ token })).body.data.deleted).toBe(true);
    expect(await byToken(token)).toBeNull();
  });

});
