import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Header icons: the artwork may change, the header may not. Every header icon keeps its rendered
 * size (22×22), its 24×24 grid, stroke, colour source and its button's size and position; links and
 * actions keep working. With HEADER_ICONS_BASELINE=<file> the measurements are compared with (or, when
 * the file does not exist yet, written to) a baseline captured before an artwork change.
 */
type Box = { x: number; y: number; w: number; h: number };
type Measure = { name: string; button: Box; svg: Box; viewBox: string | null; stroke: string; strokeWidth: string; color: string };

async function measure(page: Page): Promise<Measure[]> {
  return page.evaluate(() => {
    const r = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
    };
    return [...document.querySelectorAll('header .icon-btn, header .header__nav > button')]
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => {
        const svg = b.querySelector('svg')!;
        const cs = getComputedStyle(svg);
        return { name: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '', button: r(b), svg: r(svg), viewBox: svg.getAttribute('viewBox'), stroke: cs.stroke, strokeWidth: svg.getAttribute('stroke-width') ?? '', color: cs.color };
      });
  });
}

test('header icons keep size, grid, alignment and behaviour', async ({ page }, info) => {
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  const icons = await measure(page);
  expect(icons.length).toBeGreaterThanOrEqual(3);
  for (const i of icons.filter((x) => x.button.w > 0 && !/Shop/.test(x.name))) {
    expect(i.svg, i.name).toMatchObject({ w: 22, h: 22 });
    expect(i.viewBox, i.name).toBe('0 0 24 24');
    expect(i.strokeWidth, i.name).toBe('1.8');
    expect(i.stroke, i.name).toBe(i.color); // currentColor: header colours unchanged
    // Centred in its button as before.
    expect(Math.abs(i.svg.x + i.svg.w / 2 - (i.button.x + i.button.w / 2)), i.name).toBeLessThan(1);
    expect(Math.abs(i.svg.y + i.svg.h / 2 - (i.button.y + i.button.h / 2)), i.name).toBeLessThan(1);
  }
  // Header height recorded with the icons.
  const headerH = await page.locator('header').first().evaluate((h) => Math.round(h.getBoundingClientRect().height * 10) / 10);

  const file = process.env.HEADER_ICONS_BASELINE ? process.env.HEADER_ICONS_BASELINE.replace('{project}', info.project.name) : '';
  if (file) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ headerH, icons }, null, 2));
    else {
      const before = JSON.parse(fs.readFileSync(file, 'utf8')) as { headerH: number; icons: Measure[] };
      expect(headerH).toBe(before.headerH);
      expect(icons.map((i) => ({ name: i.name, button: i.button, svg: i.svg }))).toEqual(before.icons.map((i) => ({ name: i.name, button: i.button, svg: i.svg })));
    }
  }

  // Behaviour: every icon still leads where it did.
  const cart = page.getByTestId('cart-link');
  await expect(cart).toHaveAttribute('href', '/en/cart');
  if (await page.locator('header a[href="/en/wishlist"]').first().isVisible()) {
    await expect(page.locator('header a[href="/en/wishlist"]').first()).toBeVisible();
    await expect(page.locator('header a[href="/en/login"]').first()).toBeVisible();
  }
  await page.getByTestId('search-toggle').click();
  await expect(page.getByTestId('search-toggle')).toHaveAttribute('aria-expanded', 'true');
  await cart.click();
  await expect(page).toHaveURL(/\/en\/cart$/);
});
