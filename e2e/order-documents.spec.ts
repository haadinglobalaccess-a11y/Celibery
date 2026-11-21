import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Admin order documents: "Print invoice" (customer, addresses, prices, VAT, totals) and
 * "Print packing slip" (same order and address details, no prices, tick column, signatures).
 * window.print is stubbed; the document is checked as it is rendered for printing.
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

test('order invoice and packing slip carry the full order details', async ({ page, request }) => {
  const product = (await (await request.get('/api/products/demo-wall-charger-65w', { headers: H })).json()).data;
  const contact = { name: 'Document Tester', email: 'docs@test.local', phone: '0551234567' };
  const address = { fullName: 'Document Tester', phone: '0551234567', city: 'Riyadh', district: 'Al Olaya', street: 'King Fahd Road', buildingNumber: '7421', postalCode: '12211', shortAddress: 'RAAA1234', notes: '' };
  const r = await request.post('/api/checkout', { headers: H, data: { idempotencyKey: `e2edoc${Date.now()}`, items: [{ productId: product._id, quantity: 2 }], contact, shippingAddress: address, paymentMethod: 'card', lang: 'en' } });
  expect(r.status()).toBe(201);
  const { order, accessToken, redirectUrl } = (await r.json()).data;
  await request.post(`/api/payments/sandbox/${redirectUrl.split('/').pop()}/complete`, { headers: H, data: { outcome: 'success' } });
  await request.post(`/api/orders/${order.orderNumber}/verify-payment`, { headers: H, data: { token: accessToken } });

  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
  await login(page);
  const list = await (await page.request.get(`/api/admin/orders?q=${order.orderNumber}`, { headers: H })).json();
  await page.goto(`/admin/orders/${list.data[0]._id}`);

  await page.getByTestId('print-invoice').click();
  await page.waitForFunction(() => (window as unknown as { __printed: number }).__printed === 1);
  const invoice = page.locator('.a-doc--invoice');
  await expect(invoice).toContainText('Invoice');
  await expect(invoice).toContainText(order.orderNumber);
  await expect(invoice).toContainText('Document Tester');
  await expect(invoice).toContainText('docs@test.local');
  await expect(invoice).toContainText('King Fahd Road 7421');
  await expect(invoice).toContainText('RAAA1234');
  await expect(invoice).toContainText('DEMO-AD-65W');
  await expect(invoice).toContainText('SAR 298.00');
  await expect(invoice).toContainText('Total (VAT included)');
  await expect(invoice).toContainText('Includes VAT 15%');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(invoice).toHaveCount(0);

  await page.getByTestId('print-packing').click();
  await page.waitForFunction(() => (window as unknown as { __printed: number }).__printed === 2);
  const slip = page.locator('.a-doc--packing');
  await expect(slip).toContainText('Packing slip');
  await expect(slip).toContainText(order.orderNumber);
  await expect(slip).toContainText('DEMO-AD-65W');
  await expect(slip).toContainText('Packed by');
  await expect(slip).not.toContainText('SAR 298.00');
});
