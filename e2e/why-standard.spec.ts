import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * "The CELIBERY standard" / "Why CELIBERY" section entrance: eyebrow reveal, headline fade, staggered
 * reasons — replayed on every entry (down and up), never restarted while on screen, off for reduced
 * motion. Runs on desktop and mobile.
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
  const eyebrow = section.locator('.cx-why__intro .cx-eyebrow');
  const heading = section.locator('#cx-why-title');
  const items = section.locator('.cx-why__item');

  // Headings unchanged: the same text, order and elements as before.
  await expect(eyebrow).toHaveText('The CELIBERY standard');
  await expect(heading).toHaveAttribute('aria-label', 'Why CELIBERY');
  await expect(heading).toHaveText('Why CELIBERY');
  expect(await section.locator('.cx-why__intro > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]))).toEqual(['cx-eyebrow', 'cx-display', 'cx-why__mark']);

  // Reasons are staggered one after another (hairline and content delays grow by 140ms per item).
  const n = await items.count();
  expect(n).toBeGreaterThan(1);
  const delays = await items.evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue('--i').trim()));
  expect(delays).toEqual([...Array(n).keys()].map(String));

  for (const [label, away] of [['from above', () => scrollToY(page, 0)], ['from below', () => bottom(page)]] as const) {
    for (let round = 0; round < 2; round++) {
      await away();
      await expect(eyebrow, label).not.toHaveClass(/fx-in/);
      await expect(heading, label).not.toHaveClass(/fx-in/);
      expect(await heading.evaluate((e) => getComputedStyle(e).opacity), label).toBe('0'); // re-armed, out of sight
      await centre(page, section.locator('.cx-why__intro'));
      // Eyebrow reveal and headline fade start fresh on this entry.
      await expect.poll(async () => (await anims(eyebrow)).map((a) => a.name), { message: label }).toContain('cx-standard-reveal');
      const h = await anims(heading);
      expect(h.map((a) => a.name), label).toContain('cx-standard-fade');
      expect(Math.min(...h.map((a) => a.t)), label).toBeLessThan(700);
      // No word-by-word motion in this section: one calm fade.
      expect(await heading.locator('.cx-kw > span').first().evaluate((e) => getComputedStyle(e).animationName), label).toBe('none');
    }
  }

  // Each reason that is playing waits for the one before it (on phones only some are on screen at once).
  await centre(page, items.first());
  const lineDelays = await items.evaluateAll((els) => els.filter((e) => e.classList.contains('fx-in')).map((e) => parseFloat(getComputedStyle(e, '::before').animationDelay)));
  expect(lineDelays.length).toBeGreaterThan(1);
  for (let i = 1; i < lineDelays.length; i++) expect(lineDelays[i]).toBeGreaterThan(lineDelays[i - 1]);

  // While the section stays on screen it never restarts: small scrolls do not touch the classes.
  await centre(page, section.locator('.cx-why__intro'));
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
    expect(await section.locator('.cx-why__intro .cx-eyebrow').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  });
});
