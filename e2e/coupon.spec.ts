import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Discount codes end to end: a code created through the Admin API must reduce the cart and
 * checkout totals in the real storefront, and the order/payment must be charged the
 * discounted, server-calculated total.
 *
 * Demo product: 65W wall charger = SAR 149.00, free delivery in the demo settings.
 */
const PRODUCT = '/en/p/demo-wall-charger-65w';
const H = { 'X-Requested-With': 'celibery' };

async function adminCreateDiscount(request: APIRequestContext, body: Record<string, unknown>) {
  const creds = JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8'));
  const login = await request.post('/api/auth/login', { headers: H, data: creds });
  expect(login.status()).toBe(200);
  // Same shape the Admin → Discounts form sends.
  const res = await request.post('/api/admin/discounts', {
    headers: H,
    data: {
      description: { ar: '', en: '' },
      maxDiscount: null,
      minOrderTotal: 0,
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      perCustomerLimit: null,
      categories: [],
      products: [],
      active: true,
      ...body,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function applyCode(page: Page, code: string) {
  await page.locator('#code').fill(code);
  await page.locator('.code-form').getByRole('button', { name: 'Apply' }).click();
}

async function fillCheckout(page: Page) {
  await page.locator('input[name="name"]').fill('Coupon Tester');
  await page.locator('input[name="email"]').fill('coupon@test.local');
  await page.locator('input[name="phone"]').fill('0551234567');
  await page.locator('input[name="fullName"]').fill('Coupon Tester');
  await page.locator('input[name="city"]').fill('Riyadh');
  await page.locator('input[name="district"]').fill('Al Olaya');
  await page.locator('input[name="street"]').fill('King Fahd Road');
  await page.locator('input[name="postalCode"]').fill('12211');
  await page.getByTestId('pay-card').click();
}

test.describe.serial('discount codes in the storefront', () => {
  test.beforeAll(async ({ request }) => {
    await adminCreateDiscount(request, { code: 'E2EPCT10', type: 'percent', value: 10 });
    await adminCreateDiscount(request, { code: 'E2EFIX20', type: 'fixed', value: 20 });
  });

  test('cart: percentage code lowers the total, follows quantity changes, and removal restores it', async ({ page }) => {
    await page.goto(PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await page.goto('/en/cart');
    await expect(page.getByTestId('total')).toContainText('149.00');

    await applyCode(page, 'e2epct10');
    const summary = page.getByTestId('summary');
    await expect(summary).toContainText('E2EPCT10');
    await expect(summary).toContainText('−SAR 14.90');
    await expect(summary).toContainText('149.00'); // subtotal stays visible
    await expect(page.getByTestId('total')).toContainText('134.10');

    await page.getByTestId('cart-line').getByRole('button', { name: '+' }).click();
    await expect(summary).toContainText('−SAR 29.80');
    await expect(page.getByTestId('total')).toContainText('268.20');

    await page.locator('.code-form').getByRole('button', { name: 'Remove' }).click();
    await expect(summary).not.toContainText('E2EPCT10');
    await expect(page.getByTestId('total')).toContainText('298.00');

    await applyCode(page, 'NOT-A-CODE');
    await expect(page.locator('.alert--error')).toContainText('not valid');
    await expect(page.getByTestId('total')).toContainText('298.00');
  });

  test('checkout: applying a code updates the summary without placing the order; order is charged the discounted total', async ({ page }) => {
    await page.goto(PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await page.goto('/en/checkout');
    await fillCheckout(page);
    await expect(page.getByTestId('total')).toContainText('149.00');

    let checkoutCalls = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/checkout') checkoutCalls++;
    });

    // Applying the code with a fully valid form must only apply the code.
    await applyCode(page, 'E2EFIX20');
    await expect(page.getByTestId('summary')).toContainText('−SAR 20.00');
    await expect(page.getByTestId('total')).toContainText('129.00');
    await page.waitForTimeout(500);
    expect(checkoutCalls).toBe(0);
    await expect(page).toHaveURL(/\/en\/checkout$/);

    const resP = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/checkout' && r.request().method() === 'POST');
    await page.getByTestId('place-order').click();
    const res = await resP;
    expect(res.request().postDataJSON().discountCode).toBe('E2EFIX20');
    const body = await res.json();
    expect(body.data.order.discountTotal).toBe(2000);
    expect(body.data.order.subtotal).toBe(14900);
    expect(body.data.order.total).toBe(12900);

    await expect(page.getByTestId('sandbox-pay')).toBeVisible();
    await expect(page.getByTestId('sandbox-pay')).toContainText('129.00');
  });

  test('checkout: pressing Enter in the code field applies the code and never places the order', async ({ page }) => {
    await page.goto(PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await page.goto('/en/checkout');
    await fillCheckout(page);
    let checkoutCalls = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/checkout') checkoutCalls++;
    });
    await page.locator('#code').fill('e2epct10');
    await page.locator('#code').press('Enter');
    await expect(page.getByTestId('summary')).toContainText('−SAR 14.90');
    await expect(page.getByTestId('total')).toContainText('134.10');
    await page.waitForTimeout(500);
    expect(checkoutCalls).toBe(0);
    // Entered details survive (no page reload).
    await expect(page.locator('input[name="name"]')).toHaveValue('Coupon Tester');

    // Remove restores the full price on checkout too.
    await page.locator('.code-form').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('total')).toContainText('149.00');
    expect(checkoutCalls).toBe(0);
  });
});
