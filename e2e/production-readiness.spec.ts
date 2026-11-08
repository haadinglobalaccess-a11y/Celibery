import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Production-readiness additions, through the real UI:
 *  - Customer reviews appear on the product page only when Admin → Settings enables them,
 *    and visitors are asked to sign in (the server allows verified purchases only);
 *  - Product pages carry social preview tags; sample (demo) products get no schema.org offer;
 *  - Admin → SEO title/description reach the homepage;
 *  - Admin → Products exports the catalogue as CSV.
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

test.describe.serial('production readiness', () => {
  test('reviews section follows the admin setting; product SEO tags are present', async ({ page }) => {
    const list = await (await page.request.get('/api/products?limit=1&lang=en')).json();
    const slug = list.data[0].slug as string;

    await page.goto(`/en/p/${slug}`);
    await expect(page.getByTestId('add-to-cart')).toBeVisible();
    await expect(page.getByTestId('product-reviews')).toHaveCount(0); // disabled by default (Q19)
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'product');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /\| CELIBERY$/);
    // Every seeded product is sample data: no structured offer may be published for it.
    await expect(page.locator('#celibery-page-ld')).toHaveCount(0);

    await login(page);
    const on = await page.request.put('/api/admin/settings', { headers: H, data: { reviews: { enabled: true } } });
    expect(on.ok()).toBeTruthy();
    // Staff are not customers: the section shows the sign-in prompt, never the form.
    await page.goto(`/en/p/${slug}`);
    const section = page.getByTestId('product-reviews');
    await expect(section).toBeVisible();
    await expect(section).toContainText('No reviews for this product yet.');
    await expect(section.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', new RegExp(`/en/login\\?next=`));
    await expect(section.getByTestId('write-review')).toHaveCount(0);

    await page.request.put('/api/admin/settings', { headers: H, data: { reviews: { enabled: false } } });
  });

  test('admin SEO title and description are used on the homepage', async ({ page }) => {
    await login(page);
    const r = await page.request.put('/api/admin/settings', {
      headers: H,
      data: { seo: { title: { ar: 'متجر سيليبري', en: 'CELIBERY Store' }, description: { ar: 'وصف', en: 'Chargers and power banks in Saudi Arabia.' } } },
    });
    expect(r.ok()).toBeTruthy();
    await page.goto('/en');
    await expect(page).toHaveTitle('CELIBERY Store | CELIBERY');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Chargers and power banks in Saudi Arabia.');
    const ld = JSON.parse((await page.locator('#celibery-page-ld').textContent()) ?? '{}');
    expect(ld['@type']).toBe('Organization');
    expect(ld.url).toMatch(/\/en$/);
  });

  test('admin exports products as CSV', async ({ page }) => {
    await login(page);
    await page.goto('/admin/products');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^celibery-products-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = fs.readFileSync((await download.path())!, 'utf8');
    expect(text.split('\n')[0]).toContain('sku,slug,model,category_slug');
    expect(text).toContain(',demo');
  });
});
