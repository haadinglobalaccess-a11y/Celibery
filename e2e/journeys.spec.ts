import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Audit 2026-11-10 — customer and staff journeys driven entirely through the real UI:
 *  B. customer account: register → sign out → sign in → profile change persists → order history → order detail
 *  C. admin product management: create with an uploaded photo, price and stock → storefront → edit price →
 *     storefront → archive (hidden from the store) → delete
 *  E. homepage management: hero headline and brand story saved in Admin appear on the refreshed storefront
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// A real 1×1 PNG (the media library checks file contents, not just the extension).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function adminLogin(page: Page) {
  const c = creds();
  await page.goto('/admin');
  await page.getByLabel('Email', { exact: true }).fill(c.email);
  await page.getByLabel('Password', { exact: true }).fill(c.password);
  await page.getByTestId('admin-login').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
const locField = (page: Page, label: string, lang: 'ar' | 'en') => page.locator('.field', { hasText: label }).locator(`[lang="${lang}"]`).first();

test.describe('journeys through the real UI', () => {
  test('B. customer account: register, sign out, sign in, profile, order history and detail', async ({ page }) => {
    const id = stamp();
    const email = `journey-${id}@test.local`;
    const password = 'Journey-Pass-1';
    await page.goto('/en/register');
    await page.getByLabel('Full name', { exact: true }).fill('Journey Customer');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mobile number (optional)').fill('0551230000');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.locator('form').getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/en\/account/);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // Sign out → the account is no longer accessible.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/en/account');
    await expect(page).toHaveURL(/\/en\/login/);

    // Wrong password is refused; the right one signs in.
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Wrong-Pass-9');
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.alert, [role="alert"]').first()).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/en\/account/);

    // Profile change persists after a reload.
    await page.goto('/en/account/profile');
    await page.getByLabel('Full name', { exact: true }).fill('Journey Customer Renamed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Journey Customer Renamed');

    // An order placed while signed in appears in the order history with its details.
    const list = await (await page.request.get('/api/products?limit=60&lang=en')).json();
    const product = (list.data as { _id: string; available: boolean }[]).find((p) => p.available)!;
    const r = await page.request.post('/api/checkout', {
      headers: H,
      data: {
        idempotencyKey: `journey-b-${id}`,
        items: [{ productId: product._id, quantity: 1 }],
        contact: { name: 'Journey Customer Renamed', email, phone: '0551230000' },
        shippingAddress: { fullName: 'Journey Customer Renamed', phone: '0551230000', city: 'Riyadh', district: 'Al Olaya', street: 'Journey Street 1', buildingNumber: '1', postalCode: '12211' },
        paymentMethod: 'card',
        lang: 'en',
      },
    });
    expect(r.status()).toBe(201);
    const { order, redirectUrl } = (await r.json()).data;
    expect((await page.request.post(`/api/payments/sandbox/${String(redirectUrl).split('/').pop()}/complete`, { headers: H, data: { outcome: 'success' } })).ok()).toBeTruthy();
    await page.goto('/en/account');
    const card = page.locator('.order-card', { hasText: order.orderNumber });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/en/account/orders/${order.orderNumber}`));
    await expect(page.getByText('Journey Street 1')).toBeVisible();
  });

  test('C. admin creates, edits, archives and deletes a product; the storefront follows', async ({ page }) => {
    const id = stamp();
    const nameEn = `Audit Cable ${id}`;
    await adminLogin(page);
    await page.goto('/admin/products/new');
    await locField(page, 'Name', 'ar').fill(`كابل تدقيق ${id}`);
    await locField(page, 'Name', 'en').fill(nameEn);
    await page.locator('.field', { hasText: 'SKU *' }).locator('input').fill(`AUDIT-${id}`);
    await expect(page.locator('.field', { hasText: 'URL slug *' }).locator('input')).toHaveValue(`audit-cable-${id}`);
    await locField(page, 'Short description', 'en').fill('Braided USB-C cable for the audit test.');
    await locField(page, 'Short description', 'ar').fill('كابل USB-C مضفور لاختبار التدقيق.');
    await page.locator('.a-card', { hasText: 'Category *' }).locator('select').selectOption({ index: 1 });
    await page.locator('.field', { hasText: 'Visibility' }).locator('select').selectOption('active');
    await page.locator('.field', { hasText: 'Price *' }).locator('input').fill('123.45');
    await page.locator('.field', { hasText: 'Initial stock' }).locator('input').fill('7');
    await page.locator('.gallery-tile--add input[type="file"]').setInputFiles({ name: 'audit.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.gallery-tile:not(.gallery-tile--add):not(.is-uploading) img')).toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId('save-product').click();
    await expect(page.getByText('Product created')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/[a-f0-9]{24}$/);
    const adminUrl = page.url();

    // Storefront shows the product with its price, photo and stock.
    await page.goto(`/en/p/audit-cable-${id}`);
    await expect(page.getByRole('heading', { name: nameEn })).toBeVisible();
    await expect(page.locator('main')).toContainText('123.45');
    const img = page.locator('main img[src*="/uploads/"], main img[src*="media"]').first();
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId('add-to-cart').first()).toBeEnabled();

    // Edit the price → storefront follows after a refresh.
    await page.goto(adminUrl);
    await page.locator('.field', { hasText: 'Price *' }).locator('input').fill('99.50');
    await page.getByTestId('save-product').click();
    await expect(page.getByText('Product saved')).toBeVisible();
    await page.goto(`/en/p/audit-cable-${id}`);
    await expect(page.locator('main')).toContainText('99.50');
    await expect(page.locator('main')).not.toContainText('123.45');

    // Archive → hidden from the store and from search.
    await page.goto(adminUrl);
    await page.locator('.field', { hasText: 'Visibility' }).locator('select').selectOption('archived');
    await page.getByTestId('save-product').click();
    await expect(page.getByText('Product saved')).toBeVisible();
    await page.goto(`/en/p/audit-cable-${id}`);
    await expect(page.locator('.not-found')).toBeVisible();
    const search = await (await page.request.get(`/api/products?q=${encodeURIComponent(nameEn)}&lang=en`)).json();
    expect(search.data).toHaveLength(0);

    // Delete (never ordered → really deleted).
    await page.goto(adminUrl);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete / archive' }).click();
    await expect(page.getByText('Product deleted')).toBeVisible();
    expect((await page.request.get(adminUrl.replace('/admin/products/', '/api/admin/products/'))).status()).toBe(404);
  });

  test('E. homepage content saved in Admin appears on the refreshed storefront', async ({ page }) => {
    const id = stamp();
    await adminLogin(page);
    const before = (await (await page.request.get('/api/admin/settings')).json()).data.settings.homepage;
    try {
      await page.goto('/admin/content');
      await locField(page, 'Hero headline (empty = default)', 'en').fill(`Power for every journey ${id}`);
      await locField(page, 'Hero headline (empty = default)', 'ar').fill(`طاقة لكل رحلة ${id}`);
      await page.locator('.field', { hasText: 'Hero sort order' }).locator('input').fill('-1000');
      await locField(page, 'Story text (only facts confirmed by CELIBERY)', 'en').fill(`Our story text ${id}`);
      await locField(page, 'Story text (only facts confirmed by CELIBERY)', 'ar').fill(`نص قصتنا ${id}`);
      await page.getByRole('button', { name: 'Save homepage' }).click();
      await expect(page.getByText('Homepage saved')).toBeVisible();

      // Persists in the Admin after a refresh.
      await page.reload();
      await expect(locField(page, 'Hero headline (empty = default)', 'en')).toHaveValue(`Power for every journey ${id}`);

      for (const [lang, headline, story] of [['en', `Power for every journey ${id}`, `Our story text ${id}`], ['ar', `طاقة لكل رحلة ${id}`, `نص قصتنا ${id}`]] as const) {
        await page.goto(`/${lang}`);
        await expect(page.getByText(headline).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(story).first()).toBeAttached();
      }
    } finally {
      await page.request.put('/api/admin/settings', { headers: H, data: { homepage: { heroTitle: before.heroTitle, heroSortOrder: before.heroSortOrder, brandStory: before.brandStory } } });
    }
  });
  test('customer forms: newsletter signup, saved addresses (add / edit / delete) and password change', async ({ page, playwright, baseURL }) => {
    const id = stamp();
    // Newsletter from the homepage → stored, visible to staff.
    const nlEmail = `news-${id}@test.local`;
    await page.goto('/en');
    await page.locator('#nl-email').fill(nlEmail);
    await page.locator('.cx-closing__form').getByRole('button', { name: /Subscribe/ }).click();
    await expect(page.getByText('You are subscribed')).toBeVisible();
    const admin = await playwright.request.newContext({ baseURL });
    expect((await admin.post('/api/auth/login', { headers: H, data: creds() })).ok()).toBeTruthy();
    const subs = (await (await admin.get('/api/admin/customers/newsletter')).json()).data as { email: string }[];
    expect(subs.some((s) => s.email === nlEmail)).toBe(true);
    await admin.dispose();

    // Account with saved addresses.
    const email = `forms-${id}@test.local`;
    await page.goto('/en/register');
    await page.getByLabel('Full name', { exact: true }).fill('Forms Customer');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Forms-Pass-1');
    await page.locator('form').getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/en\/account/);

    await page.goto('/en/account/addresses');
    await page.getByRole('button', { name: '+ Add address' }).click();
    const form = page.locator('form.panel');
    await form.getByLabel('Full name', { exact: true }).fill('Forms Customer');
    await form.getByLabel('Mobile number', { exact: true }).fill('0551110000');
    await form.getByLabel('City', { exact: true }).fill('Jeddah');
    await form.getByLabel('District', { exact: true }).fill('Al Rawdah');
    await form.getByLabel('Street', { exact: true }).fill('Address Street 5');
    await form.getByRole('button', { name: 'Save' }).click();
    const card = page.locator('.order-card', { hasText: 'Address Street 5' });
    await expect(card).toBeVisible();
    await page.reload();
    await expect(card).toContainText('Jeddah');

    await card.getByRole('button', { name: 'Edit' }).click();
    await form.getByLabel('City', { exact: true }).fill('Dammam');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.order-card', { hasText: 'Address Street 5' })).toContainText('Dammam');

    // Delete asks first: cancelling keeps it, confirming removes it.
    page.once('dialog', (d) => d.dismiss());
    await page.locator('.order-card', { hasText: 'Address Street 5' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.order-card', { hasText: 'Address Street 5' })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.locator('.order-card', { hasText: 'Address Street 5' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.order-card', { hasText: 'Address Street 5' })).toHaveCount(0);
    await expect(page.getByText('No saved addresses')).toBeVisible();

    // Password change from the profile page.
    await page.goto('/en/account/profile');
    await page.getByLabel('Current password').fill('Forms-Pass-1');
    await page.getByLabel('New password').fill('Forms-Pass-2');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    const fresh = await playwright.request.newContext({ baseURL });
    expect((await fresh.post('/api/auth/login', { headers: H, data: { email, password: 'Forms-Pass-1' } })).status()).toBe(401);
    expect((await fresh.post('/api/auth/login', { headers: H, data: { email, password: 'Forms-Pass-2' } })).ok()).toBeTruthy();
    await fresh.dispose();
  });
});
