import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Whole-site crawl (audit 2026-11-10). Follows every internal storefront link in Arabic and English,
 * then opens every Admin Dashboard page, and fails on any of:
 *  - a link that lands on the 404 page,
 *  - a browser console error or uncaught page error,
 *  - an API response with status ≥ 500, or an unexpected 4xx,
 *  - a same-origin image that failed to load.
 * Problems are collected for every page first, so one run reports all of them.
 */
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

type Problem = { page: string; kind: string; detail: string };

function watch(page: Page, origin: string, problems: Problem[], current: () => string, allow4xx: RegExp[] = []) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Network failures are reported (with their URL) by the response handler below.
    if (/Failed to load resource/.test(text)) return;
    problems.push({ page: current(), kind: 'console', detail: text.slice(0, 300) });
  });
  page.on('pageerror', (e) => problems.push({ page: current(), kind: 'pageerror', detail: String(e).slice(0, 300) }));
  page.on('response', (r) => {
    const url = r.url();
    if (!url.startsWith(origin)) return;
    const s = r.status();
    if (s >= 500) problems.push({ page: current(), kind: `http ${s}`, detail: url });
    else if (s >= 400 && s !== 401 && !allow4xx.some((rx) => rx.test(url))) problems.push({ page: current(), kind: `http ${s}`, detail: url });
  });
}

async function brokenImages(page: Page, origin: string) {
  return page.evaluate((o) => Array.from(document.images).filter((i) => i.src.startsWith(o) && i.complete && i.naturalWidth === 0 && i.getAttribute('loading') !== 'lazy').map((i) => i.src), origin);
}

test.describe('full-site audit crawl', () => {
  test.setTimeout(600_000);

  test('storefront: every internal link (AR + EN) loads without 404s, errors or broken images', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const problems: Problem[] = [];
    let current = '';
    // Expected 4xx: signed-out session probe, guest wishlist/account calls, tracking without an order.
    watch(page, origin, problems, () => current, [/\/api\/auth\/me/, /\/api\/account\//, /\/api\/wishlist/, /\/api\/checkout\/draft/]);

    const seeds = ['/ar', '/en', '/ar/shop', '/en/shop', '/en/bundles', '/ar/bundles', '/en/search?q=power', '/ar/search?q=power', '/en/cart', '/ar/cart', '/en/checkout', '/en/track', '/ar/track', '/en/wishlist', '/en/login', '/ar/login', '/en/register', '/en/forgot-password'];
    const queue = [...seeds];
    const seen = new Set<string>(queue);
    const visited: string[] = [];
    while (queue.length && visited.length < 160) {
      const url = queue.shift()!;
      current = url;
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), url).toBeLessThan(400);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      visited.push(url);
      if (await page.locator('.not-found').count()) problems.push({ page: url, kind: '404 page', detail: 'link leads to the not-found page' });
      for (const src of await brokenImages(page, origin)) problems.push({ page: url, kind: 'broken image', detail: src });
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const h of hrefs) {
        const u = new URL(h);
        if (u.origin !== origin) continue;
        if (!/^\/(ar|en)(\/|$)/.test(u.pathname)) continue;
        if (/\/(sandbox-pay|checkout\/return|reset-password)/.test(u.pathname)) continue;
        const key = u.pathname + u.search;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
    fs.mkdirSync(path.resolve(__dirname, '.artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '.artifacts/storefront-crawl.json'), JSON.stringify({ visited, problems }, null, 2));
    expect(visited.length).toBeGreaterThan(40);
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });

  test('admin: every dashboard page opens without errors or failed API calls', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const problems: Problem[] = [];
    let current = '/admin';
    watch(page, origin, problems, () => current);
    const c = creds();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(c.email);
    await page.getByLabel('Password').fill(c.password);
    await page.getByTestId('admin-login').click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const req = page.request;
    const order = (await (await req.get('/api/admin/orders?limit=1')).json()).data[0];
    const product = (await (await req.get('/api/admin/products?limit=1')).json()).data[0];
    const customer = (await (await req.get('/api/admin/customers?limit=1')).json()).data?.[0];
    const pages = [
      '/admin', '/admin/orders', '/admin/checkouts', '/admin/returns', '/admin/products', '/admin/products/new', '/admin/categories', '/admin/inventory', '/admin/customers',
      '/admin/discounts', '/admin/content', '/admin/reports', '/admin/staff', '/admin/media', '/admin/settings', '/admin/activity',
      ...(order ? [`/admin/orders/${order._id}`] : []),
      ...(product ? [`/admin/products/${product._id}`] : []),
      ...(customer ? [`/admin/customers/${customer._id}`] : []),
    ];
    for (const p of pages) {
      current = p;
      await page.goto(p, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await expect(page.locator('.a-main, main').first()).toBeVisible();
      if (await page.getByText(/something went wrong/i).count()) problems.push({ page: p, kind: 'error panel', detail: 'error shown' });
    }
    // Every Settings tab.
    current = '/admin/settings (tabs)';
    await page.goto('/admin/settings');
    const tabs = await page.locator('.settings-tabs [role="tab"]').allTextContents();
    for (const t of tabs) {
      current = `/admin/settings → ${t}`;
      await page.locator('.settings-tabs [role="tab"]', { hasText: t }).first().click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    }
    expect(tabs.length).toBeGreaterThan(5);
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });

  test('admin: a failed load shows an error with retry instead of an endless spinner', async ({ page }) => {
    const c = creds();
    await page.goto('/admin');
    await page.getByLabel('Email').fill(c.email);
    await page.getByLabel('Password').fill(c.password);
    await page.getByTestId('admin-login').click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    for (const [url, api] of [['/admin/inventory', '**/api/admin/inventory?*'], ['/admin/customers', '**/api/admin/customers?*']] as const) {
      let fail = true;
      await page.route(api, (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'X', message: 'Simulated outage' } }) }) : route.continue()));
      await page.goto(url);
      const alert = page.locator('.state[role="alert"]');
      await expect(alert).toContainText('Simulated outage');
      fail = false;
      await alert.getByRole('button').click();
      await expect(page.locator('table').first()).toBeVisible();
      await page.unroute(api);
    }

    let fail = true;
    await page.route('**/api/admin/settings', (route) => (fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'X', message: 'Simulated outage' } }) }) : route.continue()));
    await page.goto('/admin/content');
    await expect(page.getByText('Simulated outage')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Save homepage' })).toBeVisible();
  });
});
