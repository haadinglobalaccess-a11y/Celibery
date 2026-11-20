import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Product-page gallery: one main frame with thumbnails underneath, photos and admin-added videos
 * together. Hovering a thumbnail brings it into the main frame; clicking a video thumbnail plays it.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };
const SHOTS = process.env.GALLERY_SHOTS_DIR;

test.describe.serial('Product gallery with videos', () => {
  let id = '';
  const slug = 'e2e-gallery-power-bank';

  test.afterAll(async ({ browser }) => {
    if (!id) return;
    const page = await browser.newPage();
    await page.request.post('/api/auth/login', { headers: H, data: creds() });
    await page.request.delete(`/api/admin/products/${id}`, { headers: H });
    await page.close();
  });

  test('thumbnails switch the main frame on hover; a video plays in the main frame', async ({ page }) => {
    expect((await page.request.post('/api/auth/login', { headers: H, data: creds() })).ok()).toBeTruthy();
    const cats = (await (await page.request.get('/api/admin/categories')).json()).data as { _id: string; slug: string }[];
    const img = (n: string, en: string) => ({ url: `/placeholders/${n}.svg`, alt: { ar: en, en } });
    const r = await page.request.post('/api/admin/products', {
      headers: H,
      data: {
        sku: 'E2E-GALLERY',
        slug,
        category: cats.find((c) => c.slug === 'power-banks')!._id,
        price: 149,
        stock: 10,
        status: 'active',
        name: { ar: 'باور بانك المعرض', en: 'Gallery Power Bank' },
        images: [img('power-banks', 'Front'), img('cables', 'Cable'), img('charging-adapters', 'Adapter')],
        videos: [{ url: '/e2e/demo-video.mp4', posterUrl: '/placeholders/tech-essentials.svg', title: { ar: 'فيديو', en: 'Demo video' } }],
        videoPlacement: 'after_main',
      },
    });
    expect(r.status()).toBe(201);
    id = (await r.json()).data._id;

    await page.goto(`/en/p/${slug}`);
    const main = page.locator('.cx-pdp .gallery__main');
    const thumbs = page.locator('.cx-pdp .gallery__thumbs button');
    await expect(thumbs).toHaveCount(4); // photo, video (after the main photo), photo, photo
    await expect(thumbs.nth(1)).toHaveAttribute('data-kind', 'video');
    await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');

    // The strip sits under the main frame.
    const mainBox = (await main.boundingBox())!;
    const stripBox = (await page.locator('.cx-pdp .gallery__thumbs').boundingBox())!;
    expect(stripBox.y).toBeGreaterThan(mainBox.y + mainBox.height - 1);

    // Hover → main frame changes (no click).
    await thumbs.nth(2).hover();
    await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(main.locator('.gallery__frame img')).toHaveAttribute('alt', 'Cable');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'pdp-hover.png') });

    // Hovering the video thumbnail shows its poster with a play button; clicking it plays the video.
    await thumbs.nth(1).hover();
    await expect(main).toHaveClass(/is-video/);
    await expect(main.locator('.gallery__poster')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Gallery Power Bank' })).toBeVisible();
    if (SHOTS) {
      await page.waitForTimeout(1000); // let the slide turn finish
      await page.screenshot({ path: path.join(SHOTS, 'pdp-video-poster.png') });
    }
    await thumbs.nth(1).click();
    await expect(main.locator('video.gallery__video')).toHaveAttribute('src', '/e2e/demo-video.mp4');

    // Moving on to a photo stops the video.
    await thumbs.nth(3).click();
    await expect(main.locator('video')).toHaveCount(0);
    await expect(main.locator('.gallery__frame img')).toHaveAttribute('alt', 'Adapter');
  });

  test('admin: videos card saves a video and its position', async ({ page }) => {
    await page.goto('/admin');
    const c = creds();
    await page.getByLabel('Email').fill(c.email);
    await page.getByLabel('Password').fill(c.password);
    await page.getByTestId('admin-login').click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.goto(`/admin/products/${id}`);
    const card = page.getByTestId('product-videos');
    await expect(card.getByText('Video 1')).toBeVisible();
    await card.getByRole('button', { name: '+ Add video' }).click();
    await card.getByLabel('Video URL').nth(1).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.getByLabel('Position in the gallery').selectOption('after_photos');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'admin-videos.png'), fullPage: false });
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await expect.poll(async () => (await (await page.request.get(`/api/products/${slug}`)).json()).data.videos.length).toBe(2);
    const pub = (await (await page.request.get(`/api/products/${slug}`)).json()).data;
    expect(pub.videoPlacement).toBe('after_photos');
    expect(pub.videos[1].provider).toBe('youtube');
  });
});
