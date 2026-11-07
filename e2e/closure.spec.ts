import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Remaining features, driven through the real UI:
 *  - a customer requests a return from the order page; staff approve, receive and refund it in
 *    Admin → Returns; the customer sees each step;
 *  - delivery zones configured in Admin → Settings → Shipping price the checkout by city;
 *  - message templates are edited, previewed and reset in Admin → Settings → Notifications;
 *  - llms.txt is generated from the catalogue.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

async function login(page: Page) {
  const c = creds();
  await page.goto('/admin');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByTestId('admin-login').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

const contact = { name: 'Return Tester', email: 'returns@test.local', phone: '0551234567' };
const address = { fullName: 'Return Tester', phone: '0551234567', city: 'Riyadh', district: 'Al Olaya', street: 'King Fahd Road', buildingNumber: '', postalCode: '12211', shortAddress: '', notes: '' };

/** Paid (sandbox) card order for the 65W charger, then shipped + delivered by the admin API. */
async function deliveredOrder(guest: APIRequestContext, admin: APIRequestContext) {
  const product = await (await guest.get('/api/products/demo-wall-charger-65w', { headers: H })).json();
  const r = await guest.post('/api/checkout', { headers: H, data: { idempotencyKey: `e2eret${Date.now()}x${Math.random().toString(36).slice(2, 10)}`, items: [{ productId: product.data._id, quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'en' } });
  expect(r.status()).toBe(201);
  const { order, accessToken, redirectUrl } = (await r.json()).data;
  await guest.post(`/api/payments/sandbox/${redirectUrl.split('/').pop()}/complete`, { headers: H, data: { outcome: 'success' } });
  await guest.post(`/api/orders/${order.orderNumber}/verify-payment`, { headers: H, data: { token: accessToken } });
  const list = await (await admin.get(`/api/admin/orders?q=${order.orderNumber}`, { headers: H })).json();
  const id = list.data[0]._id as string;
  for (const status of ['processing', 'shipped', 'delivered']) {
    const s = await admin.post(`/api/admin/orders/${id}/status`, { headers: H, data: { status, trackingNumber: 'IM-E2E-RET' } });
    expect(s.status(), await s.text()).toBe(200);
  }
  return { orderNumber: order.orderNumber as string, token: accessToken as string };
}

test.describe.serial('closure features', () => {
  test('return request: customer → admin approve / receive / refund → customer sees Refunded', async ({ page, browser }) => {
    await login(page);
    const guestCtx = await browser.newContext();
    const o = await deliveredOrder(guestCtx.request, page.request);

    // Customer (guest with the order link) requests a return.
    const customer = await guestCtx.newPage();
    await customer.goto(`/en/track?order=${o.orderNumber}&token=${o.token}`);
    const box = customer.getByTestId('order-returns');
    await expect(box).toBeVisible();
    await box.getByTestId('request-return').click();
    await box.getByRole('combobox', { name: /Wall Charger 65W/ }).selectOption('1');
    await box.getByRole('combobox').last().selectOption('defective');
    await box.getByRole('textbox').fill('USB-C port 2 does not charge');
    await box.getByRole('button', { name: 'Send return request' }).click();
    await expect(box.getByTestId('customer-return')).toContainText('Under review');
    const returnNumber = ((await box.getByTestId('customer-return').locator('strong').first().textContent()) ?? '').trim();
    expect(returnNumber).toMatch(/^RET-\d{5}$/);

    // Admin handles it in Admin → Returns.
    await page.goto('/admin/returns');
    const row = page.getByTestId('return-row').filter({ hasText: returnNumber });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: returnNumber }).click();
    const detail = page.getByTestId('return-detail');
    await expect(detail).toContainText('USB-C port 2 does not charge');
    await detail.getByRole('button', { name: 'Approve' }).click();
    await expect(detail.getByRole('button', { name: 'Mark items received' })).toBeVisible();
    await detail.getByRole('button', { name: 'Mark items received' }).click();
    const refundBtn = detail.getByRole('button', { name: 'Refund', exact: true });
    await expect(refundBtn).toBeVisible();
    await expect(detail.getByLabel('Refund amount (SAR)')).toHaveValue('149.00');
    await refundBtn.click();
    await expect(detail).toContainText('Refunded');
    await expect(detail).toContainText('succeeded');

    // The customer sees the outcome.
    await customer.reload();
    await expect(customer.getByTestId('customer-return')).toContainText('Refunded');
    await expect(customer.getByTestId('customer-return')).toContainText('Refunded: SAR 149.00');
    await guestCtx.close();
  });

  test('delivery zones from Settings → Shipping price the checkout by city', async ({ page, browser }) => {
    await login(page);
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Shipping & I Mile' }).click();
    const card = page.locator('.a-card', { hasText: 'Delivery zones' });
    await card.getByRole('button', { name: '+ Add zone' }).click();
    const zone = card.getByTestId('zone').last();
    await zone.getByLabel('Zone key').fill('e2e-north');
    await zone.getByLabel('English').first().fill('North');
    await zone.getByLabel('Cities (one per line, Arabic or English)').fill('تبوك');
    await zone.getByLabel('Delivery fee (SAR)').fill('35');
    await zone.getByLabel('English').last().fill('3–5 days');
    await card.getByRole('button', { name: 'Save zones' }).click();
    await expect(page.getByText('Delivery zones saved')).toBeVisible();

    try {
      const ctx = await browser.newContext();
      const shop = await ctx.newPage();
      await shop.goto('/en/p/demo-wall-charger-65w');
      await shop.getByTestId('add-to-cart').click();
      await shop.goto('/en/checkout');
      await shop.locator('input[name="city"]').fill('Tabuk'); // English spelling of the Arabic city in the zone
      await expect(shop.getByTestId('delivery-zone')).toContainText('Delivery zone: North · 3–5 days');
      await expect(shop.getByTestId('summary')).toContainText('SAR 35.00');
      await expect(shop.getByTestId('total')).toContainText('184.00');
      await shop.locator('input[name="city"]').fill('Riyadh');
      await expect(shop.getByTestId('delivery-zone')).toHaveCount(0);
      await expect(shop.getByTestId('total')).toContainText('149.00');
      await ctx.close();
    } finally {
      const r = await page.request.put('/api/admin/settings', { headers: H, data: { commerce: { shippingZones: [], deliverToUnlistedCities: true } } });
      expect(r.status()).toBe(200);
    }
  });

  test('message templates are edited, previewed and reset in Settings → Notifications', async ({ page }) => {
    await login(page);
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Notifications & reviews' }).click();
    const card = page.locator('.a-card', { hasText: 'Message templates' });
    await card.getByRole('combobox', { name: 'Template' }).selectOption('order.shipped');
    await card.getByRole('tab', { name: 'English' }).click();
    await card.getByLabel('Email subject').fill('On its way: {{orderNumber}} 🚚');
    await card.getByRole('button', { name: 'Preview' }).click();
    await expect(card.getByTestId('template-preview')).toContainText('On its way: CEL-1042');

    // Unknown placeholders are refused by the server.
    await card.getByLabel('Email subject').fill('Hi {{password}}');
    await card.getByRole('button', { name: 'Save both languages' }).click();
    await expect(card).toContainText('Unknown placeholder');

    await card.getByLabel('Email subject').fill('On its way: {{orderNumber}}');
    await card.getByRole('button', { name: 'Save both languages' }).click();
    await expect(page.getByText('Template saved')).toBeVisible();
    await expect(card.getByRole('combobox', { name: 'Template' })).toContainText('Order shipped (edited)');
    page.once('dialog', (d) => d.accept());
    await card.getByRole('button', { name: 'Reset to default' }).click();
    await expect(card.getByLabel('Email subject')).toHaveValue('Your order {{orderNumber}} has shipped');
  });

  test('llms.txt lists the live categories', async ({ request }) => {
    const r = await request.get('/llms.txt');
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text).toContain('# CELIBERY International');
    expect(text).toMatch(/\[Power Banks\]\(http:\/\/localhost:\d+\/en\/c\/power-banks\): \d+ products/);
  });
});
