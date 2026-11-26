import { expect, test } from '@playwright/test';

for (const width of [320, 360, 375, 390, 414, 430, 820, 1366, 1920]) {
  for (const lang of ['en', 'ar']) {
    test(`commerce layout ${lang} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const route of ['', '/c/power-banks', '/p/demo-power-bank-20000']) {
        await page.goto(`/${lang}${route}`);
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), route).toBeLessThanOrEqual(1);
      }
      expect(errors).toEqual([]);
      if ([320, 390, 1366].includes(width)) await page.screenshot({ path: `e2e/.artifacts/screens/commerce-${lang}-${width}.png` });
    });
  }
}

test('price range keeps both bounds and product details are shown', async ({ page }) => {
  await page.goto('/en/c/power-banks');
  await page.getByRole('textbox', { name: 'Min', exact: true }).fill('100');
  await page.getByRole('textbox', { name: 'Max', exact: true }).fill('250');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/minPrice=100&maxPrice=250/);
  await page.goto('/en/p/demo-power-bank-20000');
  // Description and specifications are shown open (no toggle to find).
  await expect(page.locator('.cx-overview__text')).toBeVisible();
  await expect(page.locator('.cx-overview__text')).not.toBeEmpty();
  await expect(page.locator('.cx-specs__list')).toBeVisible();
  await expect(page.locator('.cx-overview details, .cx-specs details')).toHaveCount(0);
});

test('customer information pages use bilingual layouts on narrow and wide screens', async ({ page }) => {
  for (const width of [320, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    for (const lang of ['ar', 'en']) for (const route of ['about', 'contact', 'support', 'faq', 'search?q=power']) {
      await page.goto(`/${lang}/${route}`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.not-found')).toHaveCount(0);
    }
  }
});

test('mobile navigation traps focus and hero keeps a single active slide', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/en');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('link').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
  await expect(page.locator('.campaign-slide[data-active="true"]')).toHaveCount(1);
  expect(await page.locator('.campaign-media video, .campaign-media iframe').count()).toBeLessThanOrEqual(1);
  const indicators = page.locator('.campaign-indicators button');
  if (await indicators.count() > 1) {
    await indicators.nth(1).click();
    await expect(indicators.nth(1)).toHaveAttribute('aria-current', 'true');
  }
});
