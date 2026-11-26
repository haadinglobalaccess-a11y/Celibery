import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Product list bulk actions through the real Admin UI: select several, set active / archive / delete. */
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

test('select products, then Set active, Archive and Delete in one click each', async ({ page }) => {
  await login(page);
  const cats = (await (await page.request.get('/api/admin/categories')).json()).data as { _id: string; slug: string }[];
  const category = cats.find((c) => c.slug === 'cables')!._id;
  const ids: string[] = [];
  for (const n of [1, 2, 3]) {
    const r = await page.request.post('/api/admin/products', { headers: H, data: { sku: `E2E-BULKACT-${n}`, slug: `e2e-bulkact-${n}`, category, price: 10, stock: 1, status: 'draft', name: { ar: `منتج ${n}`, en: `Bulk Action Item ${n}` } } });
    expect(r.status()).toBe(201);
    ids.push((await r.json()).data._id);
  }
  const statusOf = async () => Promise.all(ids.map(async (id) => ((await (await page.request.get(`/api/admin/products/${id}`)).json()).data as { status: string }).status));

  try {
    await page.goto('/admin/products?q=E2E-BULKACT');
    await expect(page.locator('table.products-table tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('products-bulk-bar')).toHaveCount(0);

    // Two of three, one by one.
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 1' }).check();
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 2' }).check();
    const bar = page.getByTestId('products-bulk-bar');
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Set active' }).click();
    await expect(page.getByText('2 products set to active')).toBeVisible();
    await expect.poll(statusOf).toEqual(['active', 'active', 'draft']);
    await expect(bar).toHaveCount(0); // selection cleared after the action

    // Homepage placement: Feature and Flagship from the same bar; badges show on the rows.
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 1' }).check();
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 3' }).check();
    await bar.getByRole('button', { name: 'Feature', exact: true }).click();
    await expect(page.getByText('2 products added to Featured')).toBeVisible();
    await expect(page.getByTestId('badge-featured')).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 1' }).check();
    await bar.getByRole('button', { name: 'Flagship', exact: true }).click();
    await expect(page.getByTestId('badge-flagship')).toHaveCount(1);
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 1' }).check();
    await bar.getByRole('button', { name: 'Unfeature' }).click();
    await expect(page.getByTestId('badge-featured')).toHaveCount(1);
    await expect(page.getByTestId('badge-flagship')).toHaveCount(1); // the other flag is unchanged

    // All on the page with the header checkbox, then archive (asks first).
    await page.getByRole('checkbox', { name: 'Select all products on this page' }).check();
    await expect(bar).toContainText('3 selected');
    page.once('dialog', (d) => void d.accept());
    await bar.getByRole('button', { name: 'Archive' }).click();
    await expect.poll(statusOf).toEqual(['archived', 'archived', 'archived']);

    // Delete: cancelling the confirmation changes nothing; accepting deletes.
    await page.getByRole('checkbox', { name: 'Select Bulk Action Item 3' }).check();
    page.once('dialog', (d) => void d.dismiss());
    await bar.getByRole('button', { name: 'Delete' }).click();
    await expect(bar).toContainText('1 selected');
    page.once('dialog', (d) => void d.accept());
    await bar.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('1 deleted')).toBeVisible();
    await expect(page.locator('table.products-table tbody tr')).toHaveCount(2);
  } finally {
    for (const id of ids) await page.request.delete(`/api/admin/products/${id}`, { headers: H });
  }
});
