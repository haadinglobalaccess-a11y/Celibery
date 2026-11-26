import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Bulk product photos through the real Admin UI: files named after the SKU are matched, uploaded
 * to the media library and put on the right product in number order; nothing else changes.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const SKU = 'E2E-BULK-PHOTO';

async function login(page: Page) {
  const c = creds();
  await page.goto('/admin');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByTestId('admin-login').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('Bulk photos: SKU file names go to the right product, in order', async ({ page }) => {
  await login(page);
  const cats = (await (await page.request.get('/api/admin/categories')).json()).data as { _id: string; slug: string }[];
  const created = await page.request.post('/api/admin/products', {
    headers: H,
    data: { sku: SKU, slug: 'e2e-bulk-photo', category: cats.find((c) => c.slug === 'cables')!._id, price: 49, stock: 3, status: 'draft', name: { ar: 'كابل', en: 'Bulk Photo Cable' }, description: { ar: 'وصف', en: 'Keep me' } },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).data._id as string;

  try {
    await page.goto('/admin/products');
    await page.getByRole('button', { name: 'Bulk photos' }).click();
    const dialog = page.getByRole('dialog', { name: 'Bulk product photos' });
    await dialog.locator('input[type=file]').setInputFiles([
      { name: `${SKU}-2.png`, mimeType: 'image/png', buffer: PNG },
      { name: `${SKU.toLowerCase()}-1.png`, mimeType: 'image/png', buffer: PNG },
      { name: 'NOBODY-SKU-1.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect(dialog.getByText('2 photos for 1 products')).toBeVisible();
    await expect(dialog.getByText('1 not matched')).toBeVisible();
    await expect(dialog.getByText('No product with this SKU')).toBeVisible();
    await dialog.getByRole('button', { name: 'Upload and attach 2 photos' }).click();
    await expect(dialog.getByText('Photos saved on 1 product.')).toBeVisible({ timeout: 30_000 });

    const p = (await (await page.request.get(`/api/admin/products/${id}`)).json()).data as { images: { url: string; mediaId?: string }[]; description: { en: string }; stock: number; price: number };
    expect(p.images).toHaveLength(2);
    expect(p.images.every((i) => i.mediaId)).toBe(true);
    expect(p.description.en).toBe('Keep me');
    expect(p.stock).toBe(3);
    // Photo 1 (uploaded from the second file) comes first.
    const first = (await (await page.request.get(`/api/admin/media?q=${encodeURIComponent(`${SKU.toLowerCase()}-1`)}`)).json()).data as { url: string }[];
    expect(p.images[0].url).toBe(first[0].url);
  } finally {
    await page.request.delete(`/api/admin/products/${id}`, { headers: H });
  }
});
