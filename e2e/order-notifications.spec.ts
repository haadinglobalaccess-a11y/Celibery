import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Order confirmation in the real admin UI: the order page shows the email and WhatsApp state,
 * "Open WhatsApp & Send" opens the customer conversation with the prepared message and is NOT
 * recorded as delivered, staff confirm the send explicitly; Settings → Notifications holds the
 * switches, the business number, tests and the template preview.
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

/** A paid card order (sandbox gateway) placed through the public API, as a customer would. */
async function paidOrder(page: Page) {
  const list = await (await page.request.get('/api/products?limit=60&lang=en')).json();
  const product = (list.data as { id?: string; _id?: string; available: boolean }[]).find((p) => p.available)!;
  const r = await page.request.post('/api/checkout', {
    headers: H,
    data: {
      idempotencyKey: `e2e-oc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      items: [{ productId: product.id ?? product._id, quantity: 1 }],
      contact: { name: 'Notify Customer', email: 'notify.customer@test.local', phone: '0551239876' },
      shippingAddress: { fullName: 'Notify Customer', phone: '0551239876', city: 'Riyadh', district: 'Al Olaya', street: 'Notify Street 9', buildingNumber: '9', postalCode: '12211' },
      paymentMethod: 'card',
      lang: 'en',
    },
  });
  expect(r.status()).toBe(201);
  const { order, accessToken, redirectUrl } = (await r.json()).data;
  const ref = String(redirectUrl).split('/').pop();
  expect((await page.request.post(`/api/payments/sandbox/${ref}/complete`, { headers: H, data: { outcome: 'success' } })).ok()).toBeTruthy();
  const v = await page.request.post(`/api/orders/${order.orderNumber}/verify-payment`, { headers: H, data: { token: accessToken } });
  expect((await v.json()).data.paymentStatus).toBe('paid');
  return order.orderNumber as string;
}

test.describe.serial('order confirmation notifications', () => {
  test('order page: WhatsApp is prepared, opening it is not "sent", staff confirm the send', async ({ page, context }) => {
    // Never leave the test environment: answer the WhatsApp link locally.
    let opened = '';
    await context.route('https://wa.me/**', (route) => {
      opened = route.request().url();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' });
    });
    const orderNumber = await paidOrder(page);
    await login(page);
    const found = (await (await page.request.get(`/api/admin/orders?q=${orderNumber}`)).json()).data[0];
    await page.goto(`/admin/orders/${found._id}`);

    const panel = page.getByTestId('order-confirmation');
    await expect(panel).toBeVisible();
    // Email: whatever the SMTP state of this environment, it is reported honestly (never silently "sent").
    await expect(panel.getByTestId('oc-email').getByTestId('oc-status')).toHaveAttribute('data-status', /^(sent|skipped|failed|pending)$/);
    const wa = panel.getByTestId('oc-whatsapp');
    await expect(wa.getByTestId('oc-status')).toHaveAttribute('data-status', 'prepared');
    await expect(wa.getByTestId('oc-status')).toHaveText('Prepared — not sent');
    await expect(wa).toContainText('+966551239876');
    await expect(wa.getByTestId('oc-wa-note')).toContainText('does not mean the customer received it');

    const link = wa.getByTestId('oc-wa-open');
    const href = (await link.getAttribute('href'))!;
    expect(href.startsWith('https://wa.me/966551239876?text=')).toBe(true);
    const text = decodeURIComponent(href.split('?text=')[1]);
    expect(text).toContain(`Your order ${orderNumber} has been successfully received.`);
    expect(text).toContain('Payment method: Credit / debit card');

    const popup = page.waitForEvent('popup');
    await link.click();
    await (await popup).close();
    expect(opened.startsWith('https://wa.me/966551239876?text=')).toBe(true);
    await expect(wa.getByTestId('oc-status')).toHaveAttribute('data-status', 'opened');
    await expect(wa.getByTestId('oc-status')).toHaveText('Opened in WhatsApp — not confirmed');

    page.once('dialog', (d) => d.accept());
    await wa.getByTestId('oc-wa-mark-sent').click();
    await expect(wa.getByTestId('oc-status')).toHaveAttribute('data-status', 'sent_manual');
    await expect(wa).toContainText('Sent (confirmed by staff)');
    await expect(wa.getByTestId('oc-wa-open')).toHaveCount(0);
    await panel.getByText('Notification history').click();
    await expect(panel.getByTestId('oc-history')).toContainText('confirmed sent');
  });

  test('Settings → Notifications: switches, business number, test preparation and template preview', async ({ page, context }) => {
    await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }));
    await login(page);
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Notifications & reviews' }).click();
    const card = page.getByTestId('order-confirmation-settings');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('oc-wa-explainer')).toContainText('cannot send WhatsApp messages by itself');

    await card.getByTestId('oc-wa-number').fill('+966 55 000 1111');
    await page.getByTestId('order-confirmation-save').click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    const saved = (await (await page.request.get('/api/admin/settings')).json()).data.settings.orderNotifications;
    expect(saved.whatsappBusinessNumber).toBe('966550001111');

    await card.getByTestId('oc-test-phone').fill('0551112233');
    await card.getByTestId('oc-test-wa-prepare').click();
    const result = card.getByTestId('oc-test-wa-result');
    await expect(result).toContainText('Prepared for +966551112233 — not sent');
    await expect(result).toContainText('+966550001111');
    await expect(result.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/966551112233\?text=/);

    const tpl = page.locator('.a-card', { hasText: 'Message templates' });
    await expect(tpl.getByRole('combobox', { name: 'Template' })).toHaveValue('order.confirmation');
    await tpl.getByRole('tab', { name: 'English' }).click();
    await expect(tpl.getByTestId('tpl-whatsapp')).toHaveValue(/\{\{order_number\}\}/);
    await tpl.getByRole('button', { name: 'Preview' }).click();
    await expect(tpl.getByTestId('tpl-whatsapp-preview')).toContainText('Your order CEL-SAMPLE has been successfully received.');
    const frame = page.frameLocator('[data-testid="tpl-email-frame"]');
    await expect(frame.getByText('Sample product A')).toBeVisible();
    await expect(frame.getByText('Order confirmation CEL-SAMPLE', { exact: false })).toHaveCount(0); // subject is shown outside the email body
    await expect(tpl.getByTestId('template-preview')).toContainText('Order confirmation CEL-SAMPLE');

    // Unknown variables are refused.
    await tpl.getByTestId('tpl-whatsapp').fill('Order {{order_id}}');
    await tpl.getByRole('button', { name: 'Save both languages' }).click();
    await expect(tpl).toContainText('Unknown placeholder {{order_id}}');

    // Restore.
    await card.getByTestId('oc-wa-number').fill('');
    await page.getByTestId('order-confirmation-save').click();
  });
});
