import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Existing scroll-triggered animations (motion theatre: [data-fx] → .fx-in) replay on every entry,
 * scrolling down and up, without flickering while an element stays on screen. Reduced motion keeps
 * everything visible and never resets it.
 */

async function settle(page: Page) {
  // Two frames for IntersectionObserver delivery after an instant scroll.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function scrollToY(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' as ScrollBehavior }), y);
  await settle(page);
}

/** Puts the element's centre in the middle of the viewport. */
async function centre(page: Page, el: Locator) {
  const y = await el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    return window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
  });
  await scrollToY(page, y);
}

const playing = (el: Locator) => expect(el).toHaveClass(/(^|\s)fx-in(\s|$)/);
const armed = (el: Locator) => expect(el).not.toHaveClass(/(^|\s)fx-in(\s|$)/);

/**
 * Kinetic headline start state: desktop shifts each word down (CSS `translate`), phones hide the whole
 * heading (opacity) — see celibery.css "kinetic typography".
 */
const atStart = (el: Locator) =>
  el.evaluate((n) => {
    const word = n.querySelector('.cx-kw > span');
    // Computed translate is "none", "0px" or "<x> <y>"; the start state shifts the word down by its height.
    const y = word ? parseFloat(getComputedStyle(word).translate.split(' ')[1] ?? '0') || 0 : 0;
    return y > 1 || getComputedStyle(n).opacity === '0';
  });
/** The existing keyframe animations running on the headline or its words right now (name + elapsed ms). */
const runningAnimations = (el: Locator) =>
  el.evaluate((n) =>
    [n, ...n.querySelectorAll('.cx-kw > span')]
      .flatMap((e) => e.getAnimations())
      .filter((a) => a.playState === 'running')
      .map((a) => ({ name: (a as CSSAnimation).animationName, t: Number(a.currentTime ?? 0) })),
  );

async function pageBottom(page: Page) {
  await scrollToY(page, await page.evaluate(() => document.documentElement.scrollHeight));
}

test('homepage section animations replay on every re-entry, downward and upward, without flicker', async ({ page }) => {
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  const heading = page.locator('#cx-why-title'); // "Why CELIBERY" kinetic headline, far below the fold
  await expect(heading).toHaveAttribute('data-fx', 'kinetic');
  await scrollToY(page, 0);
  await armed(heading);

  // Scrolling down into the section, then back up past it, three times.
  for (let round = 1; round <= 3; round++) {
    await centre(page, heading);
    await playing(heading);
    await scrollToY(page, 0); // completely off screen (below)
    await armed(heading);
  }
  // Entering from below: scroll past it to the end of the page, then back up into it, three times.
  for (let round = 1; round <= 3; round++) {
    await pageBottom(page);
    await armed(heading);
    await centre(page, heading);
    await playing(heading);
  }

  // It really replays: re-armed off screen it is back at its start state, and on re-entry the
  // existing keyframe animation (fx-word on desktop, fx-rise on phones) starts again from the beginning.
  await scrollToY(page, 0);
  await armed(heading);
  expect(await atStart(heading)).toBe(true);
  await centre(page, heading);
  await playing(heading);
  const anims = await runningAnimations(heading);
  expect(anims.length).toBeGreaterThan(0);
  // fx-word / fx-rise elsewhere; this section's own refined fade (cx-standard-fade).
  expect(anims.every((a) => ['fx-word', 'fx-rise', 'cx-standard-fade'].includes(a.name))).toBe(true);
  expect(Math.min(...anims.map((a) => a.t))).toBeLessThan(600); // freshly restarted, not left over
  await expect.poll(async () => (await runningAnimations(heading)).length, { timeout: 6000 }).toBe(0); // and it finishes
  expect(await atStart(heading)).toBe(false);

  // No flicker: small scrolls while it stays on screen never touch its class.
  const changes = await heading.evaluate((n) => {
    (window as unknown as { __mut: number }).__mut = 0;
    new MutationObserver(() => ((window as unknown as { __mut: number }).__mut += 1)).observe(n, { attributes: true, attributeFilter: ['class'] });
    return 0;
  });
  expect(changes).toBe(0);
  const y0 = await page.evaluate(() => window.scrollY);
  for (const d of [40, -40, 80, -80, 20, -20]) await scrollToY(page, y0 + d);
  expect(await page.evaluate(() => (window as unknown as { __mut: number }).__mut)).toBe(0);

  // At the very edge (a sliver still visible) it stays played — it only re-arms once fully gone.
  const edgeY = await heading.evaluate((n) => window.scrollY + n.getBoundingClientRect().top - window.innerHeight + 4);
  await scrollToY(page, edgeY);
  await playing(heading);
  expect(await page.evaluate(() => (window as unknown as { __mut: number }).__mut)).toBe(0);
});

test('every theatre element on the homepage re-arms off screen and replays on re-entry', async ({ page }) => {
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  const all = page.locator('.cx-theatre [data-fx]');
  const count = await all.count();
  expect(count).toBeGreaterThan(5);
  // Elements below the first screen: play once, re-arm, play again.
  let checked = 0;
  for (let i = 0; i < count && checked < 8; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible())) continue;
    const top = await el.evaluate((n) => n.getBoundingClientRect().top + window.scrollY);
    const tall = await el.evaluate((n) => n.getBoundingClientRect().height > window.innerHeight * 0.9);
    if (top < (await page.evaluate(() => window.innerHeight * 1.5)) || tall) continue;
    await centre(page, el);
    await playing(el);
    await scrollToY(page, 0);
    await armed(el);
    await centre(page, el);
    await playing(el);
    checked++;
  }
  expect(checked).toBeGreaterThan(3);
});

test('product page section animations replay on re-entry', async ({ page }) => {
  const list = await (await page.request.get('/api/products?limit=60&lang=en')).json();
  const slug = (list.data as { slug: string }[])[0].slug;
  await page.goto(`/en/p/${slug}`);
  await page.waitForLoadState('networkidle');
  const el = page.locator('.cx-theatre [data-fx]').last();
  await centre(page, el);
  await playing(el);
  for (let round = 1; round <= 2; round++) {
    await scrollToY(page, 0);
    // The last section may be close to the top on short pages; only assert when it is really off screen.
    const off = await el.evaluate((n) => n.getBoundingClientRect().top >= window.innerHeight);
    if (off) await armed(el);
    await centre(page, el);
    await playing(el);
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('content is shown at once and never reset', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
    const heading = page.locator('#cx-why-title');
    await playing(heading);
    await centre(page, heading);
    await scrollToY(page, 0);
    await playing(heading);
  });
});
