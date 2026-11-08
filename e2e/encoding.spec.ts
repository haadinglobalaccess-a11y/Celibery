import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { repairMojibake } from '../server/src/lib/text';

/**
 * Rendered-text encoding check: every storefront page (Arabic RTL and English LTR) and every Admin
 * page is opened in the browser and its visible text must contain no mojibake (UTF-8 shown as
 * Windows-1252), no U+FFFD replacement characters and no control characters. Runs on desktop and
 * mobile. Detection uses exact byte reversal, so legitimate Arabic, symbols and emoji never trip it.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

function encodingProblems(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const bad = [...line].filter((c) => {
      const cp = c.codePointAt(0)!;
      return cp === 0xfffd || (cp >= 0x80 && cp <= 0x9f) || (cp < 0x20 && cp !== 0x09);
    });
    if (bad.length) out.push(`control/replacement character in: ${JSON.stringify(line.slice(0, 80))}`);
    else if (repairMojibake(line) !== line) out.push(`mojibake: ${JSON.stringify(line.slice(0, 80))}`);
  }
  return out;
}

async function check(page: Page, url: string, rtl?: boolean) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.characterSet), url).toBe('UTF-8');
  if (rtl !== undefined) expect(await page.evaluate(() => document.documentElement.dir), url).toBe(rtl ? 'rtl' : 'ltr');
  const text = await page.evaluate(() => document.body.innerText + '\n' + document.title + '\n' + [...document.querySelectorAll('[aria-label],[title],[placeholder],img[alt]')].map((e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.getAttribute('alt')].filter(Boolean).join('\n')).join('\n'));
  expect(encodingProblems(text), url).toEqual([]);
  return text;
}

test('storefront text renders without encoding damage (Arabic RTL and English LTR)', async ({ page }) => {
  test.setTimeout(240_000);
  const list = await (await page.request.get('/api/products?limit=1&lang=en')).json();
  const slug = list.data[0].slug as string;
  const cats = await (await page.request.get('/api/categories')).json();
  const cat = cats.data[0].slug as string;
  for (const lang of ['ar', 'en'] as const) {
    const rtl = lang === 'ar';
    const home = await check(page, `/${lang}`, rtl);
    if (rtl) expect(home).toMatch(/[ء-ي]/); // Arabic is really there
    for (const p of ['/shop', `/c/${cat}`, `/search?q=${rtl ? encodeURIComponent('شاحن') : 'charger'}`, `/p/${slug}`, '/bundles', '/track', '/login', '/register', '/wishlist', '/page/returns', '/page/privacy']) {
      await check(page, `/${lang}${p}`, rtl);
    }
    // Cart and checkout with a product in the bag.
    await page.goto(`/${lang}/p/${slug}`);
    await page.getByTestId('add-to-cart').first().click();
    await check(page, `/${lang}/cart`, rtl);
    await check(page, `/${lang}/checkout`, rtl);
  }
});

test('Admin Dashboard text renders without encoding damage', async ({ page }) => {
  test.setTimeout(240_000);
  const r = await page.request.post('/api/auth/login', { headers: H, data: creds() });
  expect(r.ok()).toBeTruthy();
  for (const p of ['', '/orders', '/returns', '/products', '/products/new', '/categories', '/inventory', '/customers', '/discounts', '/content', '/reports', '/staff', '/media', '/settings', '/activity']) {
    await check(page, `/admin${p}`);
  }
  // Every Settings tab (labels, hints, integration help text).
  await page.goto('/admin/settings');
  const tabs = page.getByRole('tab');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    const text = await page.evaluate(() => document.body.innerText);
    expect(encodingProblems(text), `settings tab ${i}`).toEqual([]);
  }
  // Website content tabs (the hints repaired in this pass).
  await page.goto('/admin/content');
  const ctabs = page.getByRole('tab');
  for (let i = 0; i < (await ctabs.count()); i++) {
    await ctabs.nth(i).click();
    expect(encodingProblems(await page.evaluate(() => document.body.innerText)), `content tab ${i}`).toEqual([]);
  }
  await page.goto('/admin/products/new');
  await expect(page.getByRole('link', { name: '← Products' })).toBeVisible(); // was shown damaged before
});
