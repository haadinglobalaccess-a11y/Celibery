import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Independent "Featured on homepage" and "Show in Flagship section" controls, through the real UI:
 * Admin form (save and reload), the product-list status dropdown (Featured / Flagship options and
 * badges), and the homepage Flagship section showing only Admin-selected products in Admin order.
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

test.describe.serial('Featured and Flagship selections', () => {
  const ids: Record<string, string> = {};

  // Leave the shared test store as it was: other specs count products per category.
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    const r = await page.request.post('/api/auth/login', { headers: H, data: creds() });
    expect(r.ok()).toBeTruthy();
    for (const id of Object.values(ids)) expect((await page.request.delete(`/api/admin/products/${id}`, { headers: H })).ok()).toBeTruthy();
    await page.close();
  });

  test('Admin sets each selection independently and it persists after reload', async ({ page }) => {
    await login(page);
    const cats = (await (await page.request.get('/api/admin/categories')).json()).data as { _id: string; slug: string }[];
    const category = cats.find((c) => c.slug === 'power-banks')!._id;
    for (const [sku, name] of [['E2E-FLAG-A', 'Flagship Alpha Power Bank'], ['E2E-FLAG-B', 'Flagship Beta Power Bank'], ['E2E-FEAT-ONLY', 'Featured Only Power Bank']]) {
      const r = await page.request.post('/api/admin/products', {
        headers: H,
        data: { sku, slug: sku.toLowerCase(), category, price: 99, stock: 10, status: 'active', name: { ar: name, en: name }, images: [{ url: '/placeholders/power-banks.svg', alt: { ar: '', en: '' } }] },
      });
      expect(r.status()).toBe(201);
      ids[sku] = (await r.json()).data._id;
    }

    // A: Flagship only (order 2). B: Flagship + Featured (order 1). FEAT-ONLY: Featured only.
    const setOn = async (sku: string, opts: { featured: boolean; flagship: boolean; order?: string }) => {
      await page.goto(`/admin/products/${ids[sku]}`);
      const feat = page.getByTestId('featured-toggle');
      const flag = page.getByTestId('flagship-toggle');
      await expect(feat).not.toBeChecked();
      await expect(flag).not.toBeChecked();
      await expect(page.getByTestId('flagship-order')).toHaveCount(0); // only shown for Flagship products
      if (opts.featured) await feat.check();
      if (opts.flagship) {
        await flag.check();
        await page.getByTestId('flagship-order').fill(opts.order ?? '0');
      }
      // Ticking one never ticks the other.
      await expect(feat).toBeChecked({ checked: opts.featured });
      await expect(flag).toBeChecked({ checked: opts.flagship });
      await page.getByTestId('save-product').click();
      await expect(page.getByText('Product saved')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('featured-toggle')).toBeChecked({ checked: opts.featured });
      await expect(page.getByTestId('flagship-toggle')).toBeChecked({ checked: opts.flagship });
      if (opts.flagship) await expect(page.getByTestId('flagship-order')).toHaveValue(opts.order ?? '0');
    };
    await setOn('E2E-FLAG-A', { featured: false, flagship: true, order: '2' });
    await setOn('E2E-FLAG-B', { featured: true, flagship: true, order: '1' });
    await setOn('E2E-FEAT-ONLY', { featured: true, flagship: false });
  });

  test('the product list dropdown filters by Featured and Flagship and shows both badges', async ({ page }) => {
    await login(page);
    await page.goto('/admin/products');
    const filter = page.getByTestId('products-status-filter');
    await expect(filter.locator('option')).toHaveText(['All products', 'Active', 'Draft', 'Archived (inactive)', 'Featured', 'Flagship']);

    await filter.selectOption('flagship');
    await expect(page).toHaveURL(/placement=flagship/);
    const rows = page.locator('table.products-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Flagship Alpha' }).getByTestId('badge-flagship')).toBeVisible();
    await expect(rows.filter({ hasText: 'Flagship Alpha' }).getByTestId('badge-featured')).toHaveCount(0);
    const beta = rows.filter({ hasText: 'Flagship Beta' });
    await expect(beta.getByTestId('badge-featured')).toBeVisible();
    await expect(beta.getByTestId('badge-flagship')).toBeVisible();

    // Works together with search.
    await page.locator('.products-search-input').fill('Beta');
    await page.locator('.products-search-input').press('Enter');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Flagship Beta');

    await page.goto('/admin/products?placement=featured');
    await expect(page.getByTestId('products-status-filter')).toHaveValue('featured');
    const featured = page.locator('table.products-table tbody tr');
    await expect(featured.filter({ hasText: 'Featured Only' })).toHaveCount(1);
    await expect(featured.filter({ hasText: 'Flagship Alpha' })).toHaveCount(0);
    for (const row of await featured.all()) await expect(row.getByTestId('badge-featured')).toBeVisible();

    // Status filters still work and replace the placement filter.
    await page.getByTestId('products-status-filter').selectOption('active');
    await expect(page).toHaveURL(/status=active/);
    await expect(page).not.toHaveURL(/placement=/);
  });

  test('homepage Flagship shows only the selected products, in Admin order', async ({ page }) => {
    await page.goto('/en');
    const flagships = page.locator('.cx-flagships');
    await expect(flagships).toBeVisible();
    const text = await flagships.innerText();
    expect(text.indexOf('Flagship Beta')).toBeGreaterThan(-1);
    expect(text.indexOf('Flagship Alpha')).toBeGreaterThan(text.indexOf('Flagship Beta')); // order 1 before order 2
    expect(text).not.toContain('Featured Only'); // Featured never enters Flagship
    // The seeded demo products are Featured but not Flagship: none of them appears.
    const home = (await (await page.request.get('/api/home')).json()).data as { featured: { name: { en: string } }[]; flagship: { name: { en: string } }[] };
    expect(home.flagship.map((p) => p.name.en)).toEqual(['Flagship Beta Power Bank', 'Flagship Alpha Power Bank']);
    for (const f of home.featured.filter((p) => !home.flagship.some((x) => x.name.en === p.name.en))) expect(text).not.toContain(f.name.en);
  });
});
