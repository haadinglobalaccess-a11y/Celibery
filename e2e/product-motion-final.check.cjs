const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
      await page.goto('http://localhost:5173/en');
      await page.waitForSelector('.product-motion');
      const section = page.locator('.product-motion').first();
      const card = section.locator('.card').first();
      for (let cycle = 0; cycle < 3; cycle++) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(150);
        await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(250);
        const during = await card.locator('.card__body').evaluate(el => getComputedStyle(el).translate);
        assert.notEqual(during, 'none');
        assert.notEqual(during, '0px');
        const headingOpacity = await section.locator('.product-motion__heading').evaluate(el => Number(getComputedStyle(el).opacity));
        assert.ok(headingOpacity > 0 && headingOpacity < 1, `heading fade ${headingOpacity}`);
        await page.waitForTimeout(1500);
        assert.equal(await card.evaluate(el => getComputedStyle(el).opacity), '1');
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        await page.waitForTimeout(150);
        assert.equal(await card.evaluate(el => getComputedStyle(el).opacity), '0');
        await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(1750);
        assert.equal(await card.evaluate(el => getComputedStyle(el).opacity), '1');
      }
      await page.screenshot({ path: `e2e/.artifacts/product-final-${width}.png` });
      await card.locator('.card__wish').click();
      await page.setViewportSize({width,height:400}); await page.goto('http://localhost:5173/en/wishlist');
      await page.waitForSelector('.product-motion__card');
      const wished = page.locator('.product-motion__card').first();
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); });
        await page.waitForTimeout(200);
        assert.equal(await wished.evaluate(el => getComputedStyle(el).opacity), '0');
        await wished.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(1700);
        assert.equal(await wished.evaluate(el => getComputedStyle(el).opacity), '1');
      }
      await wished.locator('.card__title a').click();
      await page.waitForURL('**/en/p/**');
      await page.waitForSelector('[data-testid=add-to-cart]');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reduced = await page.locator('.product-motion__card').evaluateAll(els => els.every(el => getComputedStyle(el).transitionDuration === '0s' && [...el.children].every(child => getComputedStyle(child).animationName === 'none')));
      assert.ok(reduced);
      console.log(`PASS ${width}: final movement and heading fade, 3 down/up homepage cycles, 3 wishlist cycles, product navigation, reduced motion`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
