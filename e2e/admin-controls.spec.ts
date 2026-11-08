import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startSmtpSink } from '../server/tests/smtp-sink';

/**
 * Admin Dashboard controls, driven through the real UI:
 *  - Settings → Notifications: configure SMTP (masked secret), test the connection, enable it,
 *    send a test email (received by a local SMTP server) and see it in the delivery log;
 *  - Customers: suspend and reactivate an account;
 *  - Discounts: delete an unused code;
 *  - Shipping settings change what the storefront promises about delivery.
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

test.describe.serial('admin dashboard controls', () => {
  let sink: Awaited<ReturnType<typeof startSmtpSink>>;
  test.beforeAll(async () => {
    sink = await startSmtpSink({ user: 'mailer', pass: 'e2e-smtp-pass-77' });
  });
  test.afterAll(async () => {
    await sink?.close();
  });

  test('email (SMTP) is configured, tested and enabled from Settings → Notifications', async ({ page }) => {
    await login(page);
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Notifications & reviews' }).click();
    const card = page.locator('section.gateway', { hasText: 'Email (SMTP)' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('tab')).toHaveCount(0); // single credential set, no test/live tabs
    await expect(card).toContainText('Not configured');
    // Q28 status reflects the admin configuration (no SMTP/WhatsApp environment variables on this server).
    const q28 = page.getByTestId('q28-status');
    await expect(q28.getByTestId('q28-email').locator('[data-status]')).toHaveAttribute('data-status', 'not_configured');
    await expect(q28.getByTestId('q28-whatsapp').locator('[data-status]')).toHaveAttribute('data-status', 'not_configured');
    // The WhatsApp account card offers every Q28 field.
    const wa = page.locator('section.gateway', { hasText: 'WhatsApp Business (Cloud API)' });
    for (const label of ['WhatsApp Business phone number', 'Phone number ID', 'WhatsApp Business Account ID', 'Meta access token', 'Graph API version', 'Order update template name']) await expect(wa.getByLabel(new RegExp('^' + label))).toBeVisible();
    await expect(wa.getByLabel('Test recipient WhatsApp number')).toBeVisible();
    await expect(wa.getByRole('button', { name: 'Send test WhatsApp message' })).toBeVisible();

    await card.getByLabel('SMTP host').fill('127.0.0.1');
    await card.getByLabel('SMTP port').fill(String(sink.port));
    await card.getByLabel('SMTP security').selectOption('starttls');
    await card.getByLabel('SMTP username').fill('mailer');
    await card.getByLabel('SMTP password').fill('e2e-smtp-pass-77');
    await card.getByLabel('Sender email address').fill('no-reply@celibery.test');
    await card.getByLabel('Sender display name').fill('CELIBERY International');
    await card.getByRole('button', { name: 'Save configuration' }).click();
    await expect(card).toContainText('Managed here');
    // The password is never shown again — only a masked preview.
    await expect(card.locator('.secret-row code')).toContainText('••••');
    await expect(card.locator('.secret-row code')).not.toContainText('e2e-smtp-pass-77');

    await card.getByRole('button', { name: 'Test connection' }).click();
    await expect(card).toContainText('connection verified');
    await expect(q28.getByTestId('q28-email').locator('[data-status]')).toHaveAttribute('data-status', 'configured');
    await card.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(card.locator('.badge', { hasText: /^enabled$/ })).toBeVisible();

    await card.getByLabel('Test recipient email').fill(creds().email);
    await card.getByRole('button', { name: 'Send test email' }).click();
    await expect.poll(() => sink.messages.some((m) => m.to.includes(creds().email))).toBe(true);

    const log = page.locator('.a-card', { hasText: 'Delivery log' });
    await log.getByRole('button', { name: 'Refresh' }).click();
    await expect(log).toContainText('admin.smtp_test');
    await expect(log.locator('.badge', { hasText: 'sent' }).first()).toBeVisible();

    // Leave email disabled for the other suites.
    page.once('dialog', (d) => d.accept());
    await card.getByRole('button', { name: 'Disable' }).click();
    await expect(card.locator('.badge', { hasText: /^disabled$/ })).toBeVisible();
  });

  test('a customer account is suspended and reactivated from the customer page', async ({ page }) => {
    const email = `e2e-cust-${Date.now()}@test.local`;
    const reg = await page.request.post('/api/auth/register', { headers: H, data: { name: 'E2E Customer', email, password: 'Passw0rd!x', phone: '0551234567', lang: 'en' } });
    expect(reg.status()).toBe(201);
    const id = (await reg.json()).data._id as string;
    await page.context().clearCookies();

    await login(page);
    await page.goto(`/admin/customers/${id}`);
    await expect(page.getByRole('heading', { name: 'E2E Customer' })).toBeVisible();
    page.once('dialog', (d) => d.accept('e2e check'));
    await page.getByRole('button', { name: 'Suspend account' }).click();
    await expect(page.locator('.badge', { hasText: 'suspended' })).toBeVisible();

    const blocked = await page.request.post('/api/auth/login', { headers: H, data: { email, password: 'Passw0rd!x' } });
    expect(blocked.status()).toBe(401);

    page.once('dialog', (d) => d.accept(''));
    await page.getByRole('button', { name: 'Reactivate account' }).click();
    await expect(page.locator('.badge', { hasText: 'suspended' })).toHaveCount(0);
  });

  test('an unused discount code is deleted from the Discounts page', async ({ page }) => {
    await login(page);
    const created = await page.request.post('/api/admin/discounts', { headers: H, data: { code: 'E2EDELETE', type: 'percent', value: 5 } });
    expect(created.status()).toBe(201);
    await page.goto('/admin/discounts');
    const row = page.locator('tr', { hasText: 'E2EDELETE' });
    await expect(row).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('the storefront delivery promise follows the shipping settings', async ({ page, browser }) => {
    await login(page);
    const set = (commerce: Record<string, unknown>) => page.request.put('/api/admin/settings', { headers: H, data: { commerce } });
    // Public settings are HTTP-cached for 30 s, so each check uses a visitor arriving after the change.
    const visit = async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto('/en');
      return { p, close: () => ctx.close() };
    };
    expect((await set({ freeDelivery: false, deliveryFee: 25, freeDeliveryThreshold: 300 })).status()).toBe(200);
    try {
      const v = await visit();
      const bar = v.p.locator('.announce');
      await expect(bar).toContainText('Free delivery on orders from SAR 300.00');
      await expect(bar).not.toContainText('Free delivery across Saudi Arabia');
      await expect(v.p.locator('.cx-why__list')).toContainText('Shipping & delivery');
      await expect(v.p.locator('.cx-why__list')).not.toContainText('Free delivery to every region');
      await v.close();
    } finally {
      expect((await set({ freeDelivery: true, deliveryFee: 0, freeDeliveryThreshold: null })).status()).toBe(200);
    }
    const after = await visit();
    await expect(after.p.locator('.announce')).toContainText('Free delivery across Saudi Arabia');
    await expect(after.p.locator('.cx-why__list')).toContainText('Free delivery to every region');
    await after.close();
  });

  test('robots.txt is served from the saved SEO settings', async ({ request }) => {
    const r = await request.get('/robots.txt');
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text).toContain('User-agent: GPTBot');
    expect(text).toMatch(/Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
  });
});
