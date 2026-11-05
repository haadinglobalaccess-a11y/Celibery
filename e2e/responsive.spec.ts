import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const shots = path.resolve(__dirname, '.artifacts/screens');
fs.mkdirSync(shots, { recursive: true });

const PAGES = ['/ar', '/en', '/ar/c/power-banks', '/en/p/demo-power-bank-20000', '/ar/cart', '/en/track', '/ar/page/warranty'];

test.describe('responsive layout & direction', () => {
  for (const url of PAGES) {
    test(`no horizontal overflow: ${url}`, async ({ page }, info) => {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const dir = await page.locator('html').getAttribute('dir');
      expect(dir).toBe(url.startsWith('/ar') ? 'rtl' : 'ltr');
      await page.screenshot({ path: path.join(shots, `resp-${info.project.name}-${url.replace(/\W+/g, '_')}.png`) });
    });
  }

  test('images never render broken', async ({ page }) => {
    await page.goto('/ar');
    await page.waitForLoadState('networkidle');
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').map((i) => i.src));
    expect(broken).toEqual([]);
  });

  test('mobile menu / sticky add-to-cart work on small screens', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'mobile-only behaviour');
    await page.goto('/ar');
    await page.getByRole('button', { name: 'القائمة' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('link', { name: 'باور بانك' }).click();
    await expect(page).toHaveURL(/\/ar\/c\/power-banks/);
    await page.goto('/ar/p/demo-power-bank-10000');
    const sticky = page.locator('.sticky-buy');
    await expect(sticky).toBeVisible();
    await sticky.getByRole('button').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('Arabic numbers use Western digits', async ({ page }) => {
    await page.goto('/ar/p/demo-power-bank-20000');
    const price = await page.locator('.pdp__price .price__now').textContent();
    expect(price).toMatch(/199\.00/);
    expect(price).not.toMatch(/[٠-٩]/);
  });
});
