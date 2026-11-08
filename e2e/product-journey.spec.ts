import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * One product's information from start to finish, for two products with Arabic and English text:
 * product page description → Add to Cart panel → cart (quantity up/down) → checkout summary →
 * verified payment → the order stored on the server. The products are created through the Admin
 * API with HTML pasted from a web page (as a Shopify export would contain) to prove that no markup
 * or dummy text reaches customers and that each product keeps its own data.
 */
const H = { 'X-Requested-With': 'celibery' };
// What an apostrophe and Arabic letters look like when UTF-8 is shown as Windows-1252 (generated, never typed).
const asCp1252 = (s: string) => new TextDecoder('windows-1252').decode(Buffer.from(s, 'utf8'));
const DAMAGED = [asCp1252('’'), asCp1252('ا'), asCp1252('ل')];
const creds = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '.artifacts/admin.json'), 'utf8')) as { email: string; password: string };

const PRODUCTS = [
  {
    sku: 'E2E-JRN-CABLE', slug: 'e2e-journey-cable', model: 'JC-1', category: 'cables', price: 59, stock: 20,
    name: { ar: 'كابل شحن USB-C', en: 'USB-C Charging Cable' },
    shortDescription: { ar: 'كابل مضفّر بطول متر', en: 'Braided, one metre' },
    description: {
      ar: '<p>كابل مضفّر متين للاستخدام اليومي.</p><ul><li>طول 1 متر</li><li>شحن حتى 60 واط</li></ul>',
      en: '<p>A durable braided cable for everyday use.</p><ul><li>1 metre long</li><li>Charges up to 60W</li></ul>',
    },
    bullets: { ar: ['طول 1 متر', 'شحن حتى 60 واط'], en: ['1 metre long', 'Charges up to 60W'] },
    lead: { ar: 'كابل مضفّر متين للاستخدام اليومي.', en: 'A durable braided cable for everyday use.' },
  },
  {
    sku: 'E2E-JRN-ADAPTER', slug: 'e2e-journey-adapter', model: 'JA-2', category: 'charging-adapters', price: 119, stock: 20,
    name: { ar: 'شاحن جداري 30 واط', en: '30W Wall Charger' },
    shortDescription: { ar: 'شاحن صغير الحجم', en: 'Compact &amp; foldable' },
    description: {
      ar: 'شاحن صغير بمنفذ USB-C.\n\n• قابس قابل للطي\n• حماية من الحرارة',
      en: 'A compact USB-C charger.\n\n• Foldable plug\n• Heat protection',
    },
    bullets: { ar: ['قابس قابل للطي', 'حماية من الحرارة'], en: ['Foldable plug', 'Heat protection'] },
    lead: { ar: 'شاحن صغير بمنفذ USB-C.', en: 'A compact USB-C charger.' },
  },
];

async function adminRequest(page: Page): Promise<APIRequestContext> {
  const c = creds();
  const r = await page.request.post('/api/auth/login', { headers: H, data: c });
  expect(r.ok()).toBeTruthy();
  return page.request;
}

test.describe.serial('product information from product page to stored order', () => {
  const ids: Record<string, string> = {};

  test('Admin creates two products with pasted HTML', async ({ page }) => {
    const req = await adminRequest(page);
    const cats = (await (await req.get('/api/admin/categories')).json()).data as { _id: string; slug: string }[];
    for (const p of PRODUCTS) {
      const { bullets: _b, lead: _l, category, ...body } = p;
      const r = await req.post('/api/admin/products', { headers: H, data: { ...body, category: cats.find((c) => c.slug === category)!._id, status: 'active' } });
      expect(r.status(), await r.text()).toBe(201);
      ids[p.sku] = (await r.json()).data._id;
    }
    await req.post('/api/auth/logout', { headers: H });
  });

  for (const lang of ['en', 'ar'] as const) {
    test(`${lang}: product page shows each product's own, formatted description`, async ({ page }) => {
      for (const p of PRODUCTS) {
        await page.goto(`/${lang}/p/${p.slug}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.name[lang]);
        await expect(page.locator('.cx-pdp__lead')).toHaveText(lang === 'en' && p.sku === 'E2E-JRN-ADAPTER' ? 'Compact & foldable' : p.shortDescription[lang]);
        const desc = page.locator('.cx-overview__text .cx-richtext');
        await expect(desc.locator('p').first()).toHaveText(p.lead[lang]);
        await expect(desc.locator('li')).toHaveText(p.bullets[lang]);
        // No markup, entities, sample text or other products' text anywhere on the page.
        const text = await page.locator('main, body').first().innerText();
        expect(text).not.toMatch(/<\/?(p|ul|li|div|b)>|&nbsp;|&amp;|\ufffd/);
        for (const bad of DAMAGED) expect(text).not.toContain(bad);
        expect(text).not.toContain('Sample product used only to preview');
        const other = PRODUCTS.find((x) => x !== p)!;
        expect(text).not.toContain(other.lead[lang]);
      }
    });
  }

  test('Add to Cart → cart → quantity → checkout → payment → stored order keep each product’s data', async ({ page }) => {
    // Product 1, quantity 1 from the product page.
    await page.goto(`/en/p/${PRODUCTS[0].slug}`);
    await page.getByTestId('add-to-cart').first().click();
    const peek = page.getByTestId('cart-peek');
    await expect(peek).toContainText(PRODUCTS[0].name.en);
    await expect(peek).toContainText('Qty: 1');
    await expect(peek).toContainText('SAR 59.00');
    await expect(peek).not.toContainText(PRODUCTS[0].lead.en); // the cart shows a summary, not the long description

    // Product 2 in Arabic.
    await page.goto(`/ar/p/${PRODUCTS[1].slug}`);
    await page.getByTestId('add-to-cart').first().click();
    await expect(page.getByTestId('cart-peek')).toContainText(PRODUCTS[1].name.ar);

    // Cart: each line has its own name, model and price; quantity up and down updates totals.
    await page.goto('/en/cart');
    const lines = page.getByTestId('cart-line');
    await expect(lines).toHaveCount(2);
    const cable = lines.filter({ hasText: PRODUCTS[0].name.en });
    const adapter = lines.filter({ hasText: PRODUCTS[1].name.en });
    await expect(cable).toContainText('JC-1');
    await expect(adapter).toContainText('JA-2');
    await expect(cable.locator('a.line__name')).toHaveAttribute('href', `/en/p/${PRODUCTS[0].slug}`);
    await cable.getByRole('button', { name: '+' }).click();
    await cable.getByRole('button', { name: '+' }).click();
    await expect(cable).toContainText('SAR 177.00');
    await cable.getByRole('button', { name: '−' }).or(cable.getByRole('button', { name: '-' })).first().click();
    await expect(cable).toContainText('SAR 118.00');
    await expect(page.getByTestId('total')).toContainText('237.00'); // 2 × 59 + 119
    expect(await lines.allInnerTexts()).not.toContainEqual(expect.stringMatching(/<\/?[a-z]|&amp;|Sample product/));

    // Checkout summary.
    await page.goto('/en/checkout');
    const rows = page.locator('li.sum-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: PRODUCTS[0].name.en })).toContainText('×2');
    await expect(rows.filter({ hasText: PRODUCTS[0].name.en })).toContainText('SAR 118.00');
    await expect(rows.filter({ hasText: PRODUCTS[1].name.en })).toContainText('×1');
    await expect(rows.filter({ hasText: PRODUCTS[1].name.en })).toContainText('SAR 119.00');
    await page.locator('input[name="name"]').fill('Journey Test');
    await page.locator('input[name="email"]').fill('journey@test.local');
    await page.locator('input[name="phone"]').fill('0551234567');
    await page.locator('input[name="fullName"]').fill('Journey Test');
    await page.locator('input[name="city"]').fill('Riyadh');
    await page.locator('input[name="district"]').fill('Al Olaya');
    await page.locator('input[name="street"]').fill('King Fahd Road');
    await page.locator('input[name="postalCode"]').fill('12211');
    await page.getByTestId('pay-card').click();
    await expect(page.getByTestId('total')).toContainText('237.00');
    await page.getByTestId('place-order').click();
    await page.getByTestId('sandbox-success').click();
    await expect(page.getByTestId('return-title')).toHaveText('Your order is confirmed');
    const orderNumber = (await page.locator('strong.ltr').first().textContent())!.trim();

    // Customer order page lists the same products.
    await page.getByRole('link', { name: 'View order' }).click();
    await expect(page.getByText(PRODUCTS[0].name.en)).toBeVisible();
    await expect(page.getByText(PRODUCTS[1].name.en)).toBeVisible();

    // The stored order: product references, SKUs, names, quantities and prices.
    const req = await adminRequest(page);
    const found = (await (await req.get(`/api/admin/orders?q=${orderNumber}`)).json()).data[0];
    const detail = (await (await req.get(`/api/admin/orders/${found._id}`)).json()).data.order;
    expect(detail.paymentStatus).toBe('paid');
    expect(detail.items.map((i: { product: string; sku: string; model: string; name: { ar: string; en: string }; quantity: number; unitPrice: number }) => [i.product, i.sku, i.model, i.name.en, i.name.ar, i.quantity, i.unitPrice])).toEqual([
      [ids['E2E-JRN-CABLE'], 'E2E-JRN-CABLE', 'JC-1', PRODUCTS[0].name.en, PRODUCTS[0].name.ar, 2, 5900],
      [ids['E2E-JRN-ADAPTER'], 'E2E-JRN-ADAPTER', 'JA-2', PRODUCTS[1].name.en, PRODUCTS[1].name.ar, 1, 11900],
    ]);
    expect(detail.total).toBe(23700);

    // Inventory moved for exactly these products.
    const stock = async (id: string) => (await (await req.get(`/api/admin/products/${id}`)).json()).data.stock as number;
    expect(await stock(ids['E2E-JRN-CABLE'])).toBe(18);
    expect(await stock(ids['E2E-JRN-ADAPTER'])).toBe(19);
  });
});
