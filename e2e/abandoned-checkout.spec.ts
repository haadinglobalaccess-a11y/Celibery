import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Abandoned / incomplete checkout tracking in the real browser: progressive autosave, refresh and
 * resume, offline + device shutdown, conversion to an order, opt-out, and Admin → Abandoned checkouts.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

async function adminApi(playwright: { request: { newContext: (o: { baseURL?: string }) => Promise<APIRequestContext> } }, baseURL: string) {
  const req = await playwright.request.newContext({ baseURL });
  expect((await req.post('/api/auth/login', { headers: H, data: creds() })).ok()).toBeTruthy();
  return req;
}
type AdminDraft = { id: string; status: string; contact: { name: string; email: string; phone: string }; shippingAddress: { street: string; city: string }; progress: number; order: { orderNumber: string } | null; items: { quantity: number }[] };
async function findDraft(req: APIRequestContext, q: string): Promise<AdminDraft | undefined> {
  const r = await req.get(`/api/admin/checkouts?filter=all&q=${encodeURIComponent(q)}`);
  return ((await r.json()).data as AdminDraft[])[0];
}

async function startCheckout(page: Page) {
  const list = await (await page.request.get('/api/products?limit=60&lang=en')).json();
  const product = (list.data as { slug: string; available: boolean }[]).find((p) => p.available)!;
  await page.goto(`/en/p/${product.slug}`);
  await page.getByTestId('add-to-cart').first().click();
  await page.goto('/en/checkout');
  await expect(page.getByTestId('draft-notice')).toContainText('saved automatically');
}
const saved = (page: Page) => expect(page.getByTestId('draft-status')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });

test.describe.serial('abandoned checkout tracking', () => {
  test('progressive save → refresh restores → the order converts the checkout', async ({ page, playwright }, info) => {
    const admin = await adminApi(playwright, info.project.use.baseURL!);
    await startCheckout(page);
    // 2. Name and phone only.
    await page.locator('input[name="name"]').fill('Draft Guest One');
    await page.locator('input[name="phone"]').fill('0551231231');
    await saved(page);
    await expect.poll(async () => (await findDraft(admin, 'Draft Guest One'))?.contact.phone).toBe('0551231231');
    expect((await findDraft(admin, 'Draft Guest One'))!.status).toBe('in_progress');

    // More of the form, then a refresh: everything comes back.
    await page.locator('input[name="email"]').fill('draft.one@test.local');
    await page.locator('input[name="city"]').fill('Riyadh');
    await page.locator('input[name="district"]').fill('Al Olaya');
    await page.locator('input[name="street"]').fill('Draft Street 1');
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('draft-restored')).toBeVisible();
    await expect(page.locator('input[name="name"]')).toHaveValue('Draft Guest One');
    await expect(page.locator('input[name="email"]')).toHaveValue('draft.one@test.local');
    await expect(page.locator('input[name="street"]')).toHaveValue('Draft Street 1');

    // 7–8. Complete and place the order (sandbox card).
    await page.locator('input[name="fullName"]').fill('Draft Guest One');
    await page.locator('input[name="addrPhone"]').fill('0551231231');
    await page.locator('input[name="postalCode"]').fill('12211');
    await page.getByTestId('pay-card').click();
    await page.getByTestId('place-order').click();
    await page.getByTestId('sandbox-success').click();
    await expect(page.getByTestId('return-title')).toHaveText('Your order is confirmed');
    const orderNumber = (await page.locator('strong.ltr').first().textContent())!.trim();
    await expect.poll(async () => (await findDraft(admin, 'Draft Guest One'))?.order?.orderNumber).toBe(orderNumber);
    expect((await findDraft(admin, 'Draft Guest One'))!.status).toBe('converted');
    // The finished checkout is cleared from this browser.
    expect(await page.evaluate(() => [localStorage.getItem('cel_checkout_draft'), localStorage.getItem('cel_checkout_draft_pending')])).toEqual([null, null]);
    await admin.dispose();
  });

  test('3 & 4. offline, then the device shuts down: nothing is lost and it syncs on the next visit', async ({ page, context, playwright }, info) => {
    const admin = await adminApi(playwright, info.project.use.baseURL!);
    await startCheckout(page);
    await page.locator('input[name="name"]').fill('Draft Offline Two');
    await page.locator('input[name="email"]').fill('draft.two@test.local');
    await saved(page);
    // Connection lost while typing the address.
    await context.setOffline(true);
    await page.locator('input[name="city"]').fill('Jeddah');
    await page.locator('input[name="street"]').fill('Offline Street 2');
    await expect(page.getByTestId('draft-status')).toHaveAttribute('data-status', 'offline', { timeout: 10_000 });
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('cel_checkout_draft_pending') ?? 'null'));
    expect(pending.shippingAddress.street).toBe('Offline Street 2');
    expect((await findDraft(admin, 'Draft Offline Two'))!.shippingAddress.street).toBe(''); // the server never got it
    // "Shutdown": the page is gone without ever reconnecting.
    await page.close();

    // Later, back online, the customer opens the store again.
    await context.setOffline(false);
    const again = await context.newPage();
    await again.goto('/en/checkout');
    await expect(again.locator('input[name="street"]')).toHaveValue('Offline Street 2');
    await expect(again.locator('input[name="name"]')).toHaveValue('Draft Offline Two');
    await expect.poll(async () => (await findDraft(admin, 'Draft Offline Two'))?.shippingAddress.street, { timeout: 10_000 }).toBe('Offline Street 2');
    const d = (await findDraft(admin, 'Draft Offline Two'))!;
    expect(d.shippingAddress.city).toBe('Jeddah');
    // 9. Still one record for this checkout.
    expect(((await (await admin.get('/api/admin/checkouts?filter=all&q=draft.two%40test.local')).json()).data as unknown[]).length).toBe(1);
    await admin.dispose();
  });

  test('the customer can opt out: the saved copy is deleted and nothing more is saved', async ({ page, playwright }, info) => {
    const admin = await adminApi(playwright, info.project.use.baseURL!);
    await startCheckout(page);
    await page.locator('input[name="name"]').fill('Draft Optout Three');
    await saved(page);
    await expect.poll(async () => Boolean(await findDraft(admin, 'Draft Optout Three'))).toBe(true);
    await page.getByTestId('draft-optout').click();
    await expect(page.getByTestId('draft-notice')).toContainText('not being saved');
    await expect.poll(async () => Boolean(await findDraft(admin, 'Draft Optout Three'))).toBe(false);
    await page.locator('input[name="email"]').fill('draft.three@test.local');
    await page.waitForTimeout(2500);
    expect(await findDraft(admin, 'draft.three@test.local')).toBeUndefined();
    await admin.dispose();
  });

  test('12. Admin → Abandoned checkouts: search, filters and detail', async ({ page }) => {
    const c = creds();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(c.email);
    await page.getByLabel('Password').fill(c.password);
    await page.getByTestId('admin-login').click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('link', { name: 'Abandoned checkouts' }).first().click();
    await expect(page.getByRole('heading', { name: 'Abandoned checkouts' })).toBeVisible();

    await page.getByTestId('drafts-search').fill('Draft Offline Two');
    await page.getByTestId('drafts-search').press('Enter');
    const row = page.getByTestId('draft-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('draft.two@test.local');
    await expect(row.getByTestId('draft-status-badge')).toHaveAttribute('data-status', 'in_progress');

    await page.getByTestId('drafts-filter-converted').click();
    await page.getByTestId('drafts-search').fill('');
    await page.getByTestId('drafts-search').press('Enter');
    await expect(page.getByTestId('draft-row').filter({ hasText: 'Draft Guest One' })).toHaveCount(1);
    await expect(page.getByTestId('draft-row').filter({ hasText: 'Draft Offline Two' })).toHaveCount(0);

    await page.getByTestId('drafts-filter-in_progress').click();
    await page.getByRole('link', { name: 'Draft Offline Two' }).click();
    await expect(page.getByTestId('draft-missing')).toContainText('Recipient name');
    await expect(page.getByText('Offline Street 2')).toBeVisible();
    await expect(page.getByTestId('draft-items')).toBeVisible();
  });
});
