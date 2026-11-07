import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const shots = path.resolve(__dirname, '.artifacts/screens');
fs.mkdirSync(shots, { recursive: true });
const shot = (page: import('@playwright/test').Page, name: string) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false });

const CATEGORIES = ['headphones', 'power-banks', 'car-essentials', 'cables', 'charging-adapters', 'tech-essentials'];

test.describe.serial('complete shopping flow (required end-to-end test)', () => {
  let browserErrors: string[] = [];
  test.beforeEach(async ({ page }) => {
    browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('requestfailed', request => {
      if (request.url().includes('/api/') && !request.failure()?.errorText.includes('ERR_ABORTED')) browserErrors.push(`API request failed: ${new URL(request.url()).pathname}`);
    });
  });
  test.afterEach(() => expect(browserErrors).toEqual([]));
  let orderNumber = '';
  let trackUrl = '';

  test('1–2. homepage in Arabic (RTL), switch to English (LTR) on the same page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByTestId('category-tile')).toHaveCount(6);
    await shot(page, '01-home-ar');

    await page.getByTestId('lang-switch').click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Shop by category' })).toBeVisible();
    await shot(page, '02-home-en');
  });

  test('3. browse all six categories', async ({ page }) => {
    for (const slug of CATEGORIES) {
      await page.goto(`/en/c/${slug}`);
      await expect(page.getByTestId('result-count')).toContainText(/\d+ products?/);
      expect(await page.getByTestId('product-card').count()).toBeGreaterThan(0);
    }
    await shot(page, '03-category');
  });

  test('4. search and category-specific filters', async ({ page }) => {
    await page.goto('/en');
    await page.locator('#search-d').fill('power bank');
    await page.locator('#search-d').press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=power/);
    await expect(page.getByTestId('result-count')).toContainText('3 products');

    await page.goto('/en/c/power-banks');
    await expect(page.getByRole('heading', { name: 'Capacity (mAh)' })).toBeVisible();
    await page.getByRole('button', { name: '20,000', exact: true }).click();
    await expect(page.getByTestId('result-count')).toContainText('1 product');
    await shot(page, '04-filtered');
    // Irrelevant filters are not shown for other categories
    await page.goto('/en/c/headphones');
    await expect(page.getByRole('heading', { name: 'Capacity (mAh)' })).toHaveCount(0);
  });

  test('5–7. open a product, add to cart, update quantity; cart survives language switch', async ({ page }) => {
    await page.goto('/en/p/demo-wall-charger-65w');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('65W');
    await expect(page.getByText('Sample product used to preview', { exact: false }).or(page.getByText('This is a sample product'))).toBeVisible();
    await shot(page, '05-product');
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.getByTestId('cart-link').click();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await page.getByTestId('cart-line').getByRole('button', { name: '+' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('2');
    await expect(page.getByTestId('total')).toContainText('298.00');

    await page.getByTestId('lang-switch').click();
    await expect(page).toHaveURL(/\/ar\/cart$/);
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-count')).toHaveText('2');
    await shot(page, '06-cart-ar');
    await page.getByTestId('lang-switch').click();
  });

  test('8–10. checkout, backend order creation and verified payment', async ({ page }) => {
    await page.goto('/en/p/demo-wall-charger-65w');
    await page.getByTestId('add-to-cart').click();
    await page.goto('/en/checkout');
    await page.locator('input[name="name"]').fill('Fahad Al-Test');
    await page.locator('input[name="email"]').fill('fahad@test.local');
    await page.locator('input[name="phone"]').fill('0551234567');
    await page.locator('input[name="fullName"]').fill('Fahad Al-Test');
    await page.locator('input[name="city"]').fill('Riyadh');
    await page.locator('input[name="district"]').fill('Al Olaya');
    await page.locator('input[name="street"]').fill('King Fahd Road');
    await page.locator('input[name="postalCode"]').fill('12211');
    await page.getByTestId('pay-card').click();
    await expect(page.getByTestId('summary')).toContainText('Free');
    await shot(page, '07-checkout');
    await page.getByTestId('place-order').click();

    await expect(page.getByTestId('sandbox-pay')).toBeVisible();
    await shot(page, '08-sandbox-gateway');
    await page.getByTestId('sandbox-success').click();

    await expect(page.getByTestId('checkout-return')).toBeVisible();
    await expect(page.getByTestId('return-title')).toHaveText('Your order is confirmed');
    orderNumber = (await page.locator('strong.ltr').first().textContent())!.trim();
    expect(orderNumber).toMatch(/^CEL-\d+$/);
    await shot(page, '09-confirmed');
    await page.getByRole('link', { name: 'View order' }).click();
    await expect(page.getByTestId('order-status')).toHaveText('Confirmed');
    trackUrl = page.url();
    // Cart was cleared after the order was created
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });

  test('11–13. order appears in admin; status update is visible to the customer', async ({ page }) => {
    const creds = JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8'));
    await page.goto('/admin');
    await page.getByLabel('Email').fill(creds.email);
    await page.getByLabel('Password').fill(creds.password);
    await page.getByTestId('admin-login').click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByTestId('kpi-orders')).not.toHaveText('0');
    await shot(page, '10-admin-overview');

    await page.getByRole('link', { name: 'Orders', exact: true }).click();
    await page.getByRole('link', { name: orderNumber }).click();
    await expect(page.getByRole('heading', { name: `Order ${orderNumber}` })).toBeVisible();
    await page.getByTestId('to-processing').click();
    await page.getByTestId('confirm-status').click();
    await expect(page.getByTestId('to-shipped')).toBeVisible();
    await page.getByTestId('to-shipped').click();
    await page.getByTestId('tracking-input').fill('IM-E2E-001');
    await page.getByTestId('confirm-status').click();
    await expect(page.getByTestId('to-delivered')).toBeVisible();
    await shot(page, '11-admin-order');

    await page.goto(trackUrl);
    await expect(page.getByTestId('order-status')).toHaveText('Shipped');
    await expect(page.getByText('IM-E2E-001')).toBeVisible();
    await shot(page, '12-customer-tracking');
  });
});
