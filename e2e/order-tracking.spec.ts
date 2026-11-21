import fs from 'node:fs';
import path from 'node:path';
import { expect, request as pwRequest, test } from '@playwright/test';

/**
 * Customer order tracking: the tracking panel (status headline, dated progress, courier shipment
 * with tracking number and courier link) and the lookup by order number + email or mobile number.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

test('customers track a shipped order by link, email or mobile number', async ({ page, request, baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL });
  expect((await admin.post('/api/auth/login', { headers: H, data: creds() })).ok()).toBeTruthy();
  const product = (await (await request.get('/api/products/demo-wall-charger-65w', { headers: H })).json()).data;
  const contact = { name: 'Tracking Tester', email: 'tracking@test.local', phone: '0551234567' };
  const address = { fullName: 'Tracking Tester', phone: '0551234567', city: 'Jeddah', district: 'Al Rawdah', street: 'Prince Sultan Road', buildingNumber: '3310', postalCode: '23435', shortAddress: '', notes: '' };
  const r = await request.post('/api/checkout', { headers: H, data: { idempotencyKey: `e2etrk${Date.now()}`, items: [{ productId: product._id, quantity: 1 }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'en' } });
  expect(r.status()).toBe(201);
  const { order, accessToken, redirectUrl } = (await r.json()).data;
  await request.post(`/api/payments/sandbox/${redirectUrl.split('/').pop()}/complete`, { headers: H, data: { outcome: 'success' } });
  await request.post(`/api/orders/${order.orderNumber}/verify-payment`, { headers: H, data: { token: accessToken } });
  const id = (await (await admin.get(`/api/admin/orders?q=${order.orderNumber}`, { headers: H })).json()).data[0]._id;
  for (const status of ['processing', 'shipped']) expect((await admin.post(`/api/admin/orders/${id}/status`, { headers: H, data: { status, trackingNumber: 'IM-E2E-TRK', courier: 'iMile' } })).status()).toBe(200);
  await admin.post(`/api/admin/orders/${id}/tracking`, { headers: H, data: { trackingNumber: 'IM-E2E-TRK', courier: 'iMile', trackingUrl: 'https://courier.example/track?no=IM-E2E-TRK' } });
  await admin.dispose();

  // The link from the order emails (order number + access token).
  await page.goto(`/en/track?order=${order.orderNumber}&token=${accessToken}`);
  const panel = page.getByTestId('tracking-panel');
  await expect(page.getByTestId('tracking-headline')).toHaveText('On its way');
  await expect(panel.locator('[aria-current="step"]')).toContainText('Shipped');
  await expect(page.getByTestId('tracking-number')).toHaveText('IM-E2E-TRK');
  await expect(page.getByTestId('tracking-courier-link')).toHaveAttribute('href', 'https://courier.example/track?no=IM-E2E-TRK');

  // Lookup with the email (any letter case), then with the mobile number.
  for (const who of ['TRACKING@test.local', '0551234567']) {
    await page.goto('/en/track');
    await page.getByLabel('Order number').fill(order.orderNumber);
    await page.getByTestId('track-contact').fill(who);
    await page.getByRole('button', { name: 'Track' }).click();
    await expect(page.getByTestId('tracking-headline')).toHaveText('On its way');
    await expect(page.getByTestId('tracking-number')).toHaveText('IM-E2E-TRK');
  }

  // A wrong email finds nothing.
  await page.goto('/en/track');
  await page.getByLabel('Order number').fill(order.orderNumber);
  await page.getByTestId('track-contact').fill('someone@else.test');
  await page.getByRole('button', { name: 'Track' }).click();
  await expect(page.getByText('We could not find an order with these details.')).toBeVisible();
});
