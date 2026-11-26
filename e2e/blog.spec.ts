import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/** Blog through the real UI: starter guides from Admin, published articles on /blog in both languages. */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

test('blog: admin adds starter guides; published articles show on /blog in English and Arabic', async ({ page }) => {
  const c = creds();
  await page.goto('/admin');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByTestId('admin-login').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/content');
  await page.getByRole('tab', { name: 'Blog' }).click();
  await page.getByRole('button', { name: 'Add starter guides' }).click();
  await expect(page.getByText('/blog/what-is-a-gan-charger')).toBeVisible();

  const rows = (await (await page.request.get('/api/admin/content/blog')).json()).data as Record<string, unknown>[];
  const ids: string[] = [];
  try {
    // Drafts are not public.
    expect(((await (await page.request.get('/api/blog')).json()).data as unknown[]).length).toBe(0);
    for (const r of rows) {
      const { _id, createdAt: _c, updatedAt: _u, __v: _v, ...rest } = r;
      ids.push(String(_id));
      const res = await page.request.put(`/api/admin/content/blog/${_id}`, { headers: H, data: { ...rest, relatedProducts: ((rest.relatedProducts as unknown[]) ?? []).map(String), status: 'published' } });
      expect(res.ok()).toBeTruthy();
    }
    await page.goto('/en/blog');
    await expect(page.locator('h1')).toHaveText('CELIBERY blog and buying guides');
    await expect(page.locator('.cx-post')).toHaveCount(3);
    await page.getByRole('link', { name: /How to choose the right power bank/ }).first().click();
    await expect(page).toHaveURL(/\/en\/blog\/how-to-choose-a-power-bank$/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.cx-article__answer')).toContainText('three numbers');
    await expect(page.getByRole('heading', { name: 'Can I take a power bank on a plane?' })).toBeVisible();
    // The header links to the blog; Arabic article is right-to-left.
    await expect(page.locator('header').getByRole('link', { name: 'Blog' }).first()).toBeVisible();
    await page.goto('/ar/blog/how-to-choose-a-power-bank');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'هل يمكنني أخذ الباور بانك في الطائرة؟' })).toBeVisible();
    expect(await page.title()).toMatch(/الباور بانك/);
  } finally {
    for (const id of ids) await page.request.delete(`/api/admin/content/blog/${id}`, { headers: H });
  }
});
