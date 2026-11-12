import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * FAQ system end to end: Admin → Website → FAQ management drives the homepage FAQ preview and
 * the /faq page. Every question here is [E2E] test data created and deleted by this file.
 */
const H = { 'X-Requested-With': 'celibery' };
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };
const Q_EN = '[E2E] Do you deliver to Jeddah?';
const Q_AR = '[E2E] هل توصلون إلى جدة؟';

async function login(page: Page) {
  const c = creds();
  await page.goto('/admin');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(c.password);
  await page.getByTestId('admin-login').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe.serial('FAQ management → storefront', () => {
  test.skip(({ isMobile }) => isMobile, 'admin workflow runs on desktop; the mobile layout test is below');

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => {
    // Clean up any [E2E] FAQs and categories left behind by a failed run.
    const list = await page.request.get('/api/admin/faq?q=%5BE2E%5D&limit=100');
    for (const f of (await list.json()).data ?? []) await page.request.delete(`/api/admin/faq/${f._id}`, { headers: H });
    const cats = await page.request.get('/api/admin/faq/categories');
    for (const c of (await cats.json()).data?.categories ?? []) if (/E2E/.test(c.name.en)) await page.request.delete(`/api/admin/faq/categories/${c._id}?reassignTo=none`, { headers: H });
    await page.close();
  });

  test('admin creates a bilingual FAQ as draft — it is not public', async () => {
    await page.goto('/admin/faqs');
    await expect(page.getByRole('heading', { name: 'FAQ management' })).toBeVisible();
    await page.getByTestId('faq-add').click();
    const editor = page.getByTestId('faq-editor');
    const q = editor.locator('.loc-pair').nth(0);
    await q.locator('input[lang="ar"]').fill(Q_AR);
    await q.locator('input[lang="en"]').fill(Q_EN);
    const a = editor.locator('.loc-pair').nth(1);
    await a.locator('textarea[lang="ar"]').fill('نعم، نوصل إلى جدة خلال **٢–٤ أيام عمل**.');
    await a.locator('textarea[lang="en"]').fill('Yes — delivery to Jeddah takes **2–4 working days**.\n\n- Tracking by SMS\n- Cash on delivery available');
    // Preview shows both languages with their own direction.
    await page.getByRole('tab', { name: /Preview/ }).click();
    await expect(page.getByTestId('faq-preview').locator('[dir="rtl"]')).toContainText(Q_AR);
    await expect(page.getByTestId('faq-preview').locator('[dir="ltr"]')).toContainText(Q_EN);
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.getByTestId('faq-save-draft').click();
    const row = page.getByTestId('faq-admin-row').filter({ hasText: Q_EN });
    await expect(row).toContainText('Draft');

    await page.goto('/en/faq');
    await expect(page.getByTestId('faq-page')).toBeVisible();
    await expect(page.getByText(Q_EN)).toHaveCount(0);
  });

  test('published FAQ appears on /faq in English (LTR) and Arabic (RTL), keyboard accessible', async () => {
    await page.goto('/admin/faqs');
    await page.getByTestId('faq-admin-row').filter({ hasText: Q_EN }).getByTestId('faq-publish').click();
    await expect(page.getByTestId('faq-admin-row').filter({ hasText: Q_EN })).toContainText('Published');

    await page.goto('/en/faq');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page).toHaveTitle(/Frequently asked questions/);
    const btn = page.getByRole('button', { name: Q_EN });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const region = page.getByRole('region', { name: Q_EN });
    await expect(region).toContainText('2–4 working days');
    await expect(region.locator('strong')).toHaveText('2–4 working days');
    await expect(region.locator('li')).toHaveCount(2);
    await page.keyboard.press('Space');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    // Structured data contains the published question only.
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join('')).toContain('"FAQPage"');
    expect(ld.join('')).toContain(Q_EN);

    await page.goto('/ar/faq');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const ar = page.getByRole('button', { name: Q_AR });
    await ar.click();
    await expect(page.getByRole('region', { name: Q_AR })).toContainText('جدة');
    expect(await ar.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  });

  test('homepage visibility, edited answer and ordering reach the storefront', async () => {
    await page.goto('/admin/faqs');
    await page.getByTestId('faq-admin-row').filter({ hasText: Q_EN }).getByTestId('faq-edit').click();
    await page.getByTestId('faq-homepage').check();
    const a = page.getByTestId('faq-editor').locator('.loc-pair').nth(1);
    await a.locator('textarea[lang="en"]').fill('Yes — Jeddah deliveries now arrive in **1–3 working days**.');
    await page.getByTestId('faq-save-publish').click();
    await expect(page.getByTestId('faq-editor')).toHaveCount(0);

    await page.goto('/en');
    const home = page.getByTestId('home-faq');
    await home.scrollIntoViewIfNeeded();
    await expect(home.getByRole('button', { name: Q_EN })).toBeVisible();
    await home.getByRole('button', { name: Q_EN }).click();
    await expect(home.getByRole('region', { name: Q_EN })).toContainText('1–3 working days');
    // The FAQ preview sits right before the newsletter / closing section.
    const order = await page.evaluate(() => {
      const faq = document.querySelector('[data-testid="home-faq"]')!;
      const next = faq.nextElementSibling;
      return next?.querySelector('#cx-closing-title') ? 'closing-next' : next?.className ?? '';
    });
    expect(order).toBe('closing-next');
    await home.getByTestId('faq-view-all').click();
    await expect(page).toHaveURL(/\/en\/faq$/);

    // Ordering: a second question moved above the first.
    const second = await page.request.post('/api/admin/faq', { headers: H, data: { question: { en: '[E2E] Is installation included?', ar: '[E2E] هل التركيب مشمول؟' }, answer: { en: 'No installation is needed.', ar: 'لا يحتاج إلى تركيب.' }, status: 'published' } });
    const secondId = (await second.json()).data._id;
    const first = (await (await page.request.get('/api/admin/faq?q=Jeddah')).json()).data[0]._id;
    expect((await page.request.post('/api/admin/faq/reorder', { headers: H, data: { ids: [secondId, first] } })).ok()).toBe(true);
    await page.goto('/en/faq');
    const texts = await page.getByTestId('faq-item').allTextContents();
    const iSecond = texts.findIndex((t) => t.includes('Is installation included'));
    const iFirst = texts.findIndex((t) => t.includes('Do you deliver to Jeddah'));
    expect(iSecond).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeLessThan(iFirst);
  });

  test('search and category filtering', async () => {
    const cat = await page.request.post('/api/admin/faq/categories', { headers: H, data: { name: { en: 'E2E Delivery', ar: 'E2E التوصيل' } } });
    const catId = (await cat.json()).data._id;
    const other = await page.request.post('/api/admin/faq/categories', { headers: H, data: { name: { en: 'E2E Products', ar: 'E2E المنتجات' } } });
    const otherId = (await other.json()).data._id;
    const list = (await (await page.request.get('/api/admin/faq?q=%5BE2E%5D')).json()).data as { _id: string; question: { en: string; ar: string }; answer: { en: string; ar: string } }[];
    for (const f of list) {
      const categoryId = f.question.en.includes('Jeddah') ? catId : otherId;
      await page.request.put(`/api/admin/faq/${f._id}`, { headers: H, data: { question: f.question, answer: f.answer, categoryId, status: 'published', showOnHomepage: f.question.en.includes('Jeddah') } });
    }
    await page.goto('/en/faq');
    await page.getByRole('button', { name: 'E2E Products', exact: true }).click();
    await expect(page.getByRole('button', { name: 'E2E Products', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: Q_EN })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '[E2E] Is installation included?' })).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();

    await page.getByTestId('faq-search').fill('jeddah');
    await expect(page.getByRole('button', { name: Q_EN })).toBeVisible();
    await expect(page.getByRole('button', { name: '[E2E] Is installation included?' })).toHaveCount(0);
    await page.getByTestId('faq-search').fill('zzz-no-such-question');
    await expect(page.getByTestId('faq-no-results')).toBeVisible();

    // Arabic search ignores diacritics / alef forms.
    await page.goto('/ar/faq');
    await page.getByTestId('faq-search').fill('جده');
    await expect(page.getByRole('button', { name: Q_AR })).toBeVisible();
  });

  test('unpublished FAQ disappears; delete with confirmation; anonymous writes are refused', async () => {
    await page.goto('/admin/faqs');
    const row = page.getByTestId('faq-admin-row').filter({ hasText: Q_EN });
    await row.getByRole('button', { name: 'Unpublish' }).click();
    await expect(row).toContainText('Draft');
    await page.goto('/en/faq');
    await expect(page.getByTestId('faq-page')).toBeVisible();
    await expect(page.getByRole('button', { name: Q_EN })).toHaveCount(0);
    await page.goto('/en');
    await expect(page.getByTestId('home-faq').getByRole('button', { name: Q_EN })).toHaveCount(0);

    await page.goto('/admin/faqs');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('faq-admin-row').filter({ hasText: Q_EN }).getByTestId('faq-delete').click();
    await expect(page.getByTestId('faq-admin-row').filter({ hasText: Q_EN })).toHaveCount(0);

    const anon = await page.context().browser()!.newContext();
    const r = await anon.request.post(`${new URL(page.url()).origin}/api/admin/faq`, { headers: H, data: { question: { en: 'x', ar: '' }, answer: { en: 'y', ar: '' } } });
    expect(r.status()).toBe(401);
    await anon.close();
  });
});

test('FAQ page layout works on mobile and desktop without horizontal scrolling', async ({ page, request }) => {
  // Seed through the API with a short-lived admin session (works in any project).
  const c = creds();
  const login = await request.post('/api/auth/login', { headers: H, data: c });
  expect(login.ok()).toBe(true);
  const made = await request.post('/api/admin/faq', {
    headers: H,
    data: { question: { en: '[E2E] Layout check question with a fairly long title to test wrapping on small screens?', ar: '[E2E] سؤال لاختبار التخطيط على الشاشات الصغيرة؟' }, answer: { en: 'Layout answer.', ar: 'إجابة التخطيط.' }, status: 'published' },
  });
  const id = (await made.json()).data._id;
  try {
    for (const lang of ['en', 'ar']) {
      await page.goto(`/${lang}/faq`);
      const btn = page.getByRole('button', { name: /\[E2E\] (Layout check|سؤال لاختبار)/ });
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  } finally {
    await request.delete(`/api/admin/faq/${id}`, { headers: H });
  }
});
