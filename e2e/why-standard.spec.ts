import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * "The CELIBERY standard" / "Why CELIBERY" section: service promises as tiles (UGREEN style), with a
 * calm headline fade and staggered tiles — replayed on every entry (down and up), never restarted while
 * on screen, off for reduced motion. Runs on desktop and mobile.
 */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
async function scrollToY(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y);
  await settle(page);
}
async function centre(page: Page, el: Locator) {
  await scrollToY(page, await el.evaluate((n) => window.scrollY + n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2 - window.innerHeight / 2));
}
const bottom = async (page: Page) => scrollToY(page, await page.evaluate(() => document.documentElement.scrollHeight));

/** Running animations on an element (and optionally its ::before), as name + elapsed ms. */
const anims = (el: Locator, sub = false) =>
  el.evaluate((n, withSub) => {
    const list = withSub ? n.getAnimations({ subtree: true }) : n.getAnimations();
    return list.filter((a) => a.playState === 'running').map((a) => ({ name: (a as CSSAnimation).animationName, t: Number(a.currentTime ?? 0) }));
  }, sub);

test('the section keeps its headings and plays the premium entrance on every entry, both directions', async ({ page }) => {
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  const section = page.locator('section.cx-why');
  const eyebrow = section.locator('.cx-head .cx-eyebrow');
  const heading = section.locator('#cx-why-title');
  const items = section.locator('.cx-why__tile');
  const head = section.locator('.cx-head');

  // Same headings; each promise is a tile with its icon, title and text.
  await expect(eyebrow).toHaveText('The CELIBERY standard');
  await expect(heading).toHaveAttribute('aria-label', 'Why CELIBERY');
  await expect(heading).toHaveText('Why CELIBERY');
  const n = await items.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    await expect(items.nth(i).locator('.cx-why__icon svg')).toHaveCount(1);
    await expect(items.nth(i).locator('h3')).not.toBeEmpty();
  }

  // Tiles are staggered one after another (90ms per tile).
  const delays = await items.evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue('--d').trim()));
  expect(delays).toEqual([...Array(n).keys()].map((i) => `${i * 90}ms`));

  for (const [label, away] of [['from above', () => scrollToY(page, 0)], ['from below', () => bottom(page)]] as const) {
    for (let round = 0; round < 2; round++) {
      await away();
      await expect(eyebrow, label).not.toHaveClass(/fx-in/);
      await expect(heading, label).not.toHaveClass(/fx-in/);
      expect(await heading.evaluate((e) => getComputedStyle(e).opacity), label).toBe('0'); // re-armed, out of sight
      await centre(page, head);
      // The headline fade starts fresh on this entry.
      await expect.poll(async () => (await anims(heading)).map((a) => a.name), { message: label }).toContain('cx-standard-fade');
      const h = await anims(heading);
      expect(h.map((a) => a.name), label).toContain('cx-standard-fade');
      expect(Math.min(...h.map((a) => a.t)), label).toBeLessThan(700);
      // No word-by-word motion in this section: one calm fade.
      expect(await heading.locator('.cx-kw > span').first().evaluate((e) => getComputedStyle(e).animationName), label).toBe('none');
    }
  }

  // Tiles enter as the section is reached.
  await centre(page, items.first());
  await expect(items.first()).toHaveClass(/fx-in/);

  // While the section stays on screen it never restarts: small scrolls do not touch the classes.
  await centre(page, head);
  await page.waitForTimeout(1800); // entrance finished
  // Watch every animated element that stays fully on screen during the small scrolls below (on phones
  // the section is taller than the screen, so a reason at the edge may legitimately enter for the first time).
  const watched = await section.evaluate((s) => {
    (window as unknown as { __m: number }).__m = 0;
    const margin = 80;
    const els = [...s.querySelectorAll('[data-fx]')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= margin && r.bottom <= window.innerHeight - margin;
    });
    const mo = new MutationObserver(() => ((window as unknown as { __m: number }).__m += 1));
    els.forEach((e) => mo.observe(e, { attributes: true, attributeFilter: ['class'] }));
    return els.length;
  });
  expect(watched).toBeGreaterThan(0);
  const y = await page.evaluate(() => window.scrollY);
  for (const d of [30, -30, 60, -60]) await scrollToY(page, y + d);
  expect(await page.evaluate(() => (window as unknown as { __m: number }).__m)).toBe(0);
  expect(await anims(heading)).toEqual([]);
  expect(await heading.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('everything is shown at once with no animation', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
    const section = page.locator('section.cx-why');
    await centre(page, section);
    expect(await section.evaluate((s) => s.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)).toBe(0);
    expect(await section.locator('#cx-why-title').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    expect(await section.locator('.cx-head .cx-eyebrow').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    expect(await section.locator('.cx-why__tile').first().evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  });
});
