const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const base = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const home = (await (await fetch(base + '/api/home')).json()).data;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = process.env.PRODUCT_TEST_RESUME === '1'
    ? JSON.parse(fs.readFileSync('e2e/.artifacts/product-real-results.json', 'utf8')) : [];
  try {
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const routes = ['/en', '/en/shop', ...home.categories.map(c => '/en/c/' + c.slug), '/en/bundles', '/en/p/' + home.featured[0].slug];
      for (const route of routes) {
        if (results.some(result => result.width === width && result.route === route)) continue;
        // A shorter window lets the final recommendation row leave the viewport above the footer.
        await page.setViewportSize({ width, height: route.includes('/p/') ? 400 : 900 });
        await page.goto(base + route);
        await page.waitForTimeout(1200);
        const sections = page.locator('.product-motion');
        const count = await sections.count();
        const names = [];
        for (let index = 0; index < count; index++) {
          const section = sections.nth(index);
          const cards = section.locator('.product-motion__card');
          const card = cards.first();
          const name = await section.evaluate(el => el.querySelector('h2')?.textContent || document.querySelector('h1')?.textContent);
          names.push(name);
          for (let cycle = 0; cycle < 3; cycle++) {
            await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
            const box = await card.boundingBox();
            // Move the page so the card is below the viewport before entering from below.
            await card.evaluate(el => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - innerHeight - 150)));
            await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(200);
            await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.waitForTimeout(450);
            const early = await card.evaluate(el => Number(getComputedStyle(el).opacity));
            assert.ok(early < .99, `${route} ${name}: entrance already finished (${early})`);
            if (route === '/en' && index === 0 && cycle === 0) await page.screenshot({ path: `e2e/.artifacts/product-real-${width}-during.png` });
            await page.waitForTimeout(100);
            await expect(card).toHaveCSS('opacity', '1');
            // Verify all vertically/horizontally offscreen cards reveal when reached.
            if (cycle === 0) {
              for (let n = 1; n < await cards.count(); n++) {
                await cards.nth(n).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
                await page.waitForTimeout(100);
                await expect(cards.nth(n)).toHaveCSS('opacity', '1');
              }
            }
            await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
            await page.waitForTimeout(200);
            assert.equal(await card.evaluate(el => getComputedStyle(el).opacity), '0', `${route} reset below`);
            await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.waitForTimeout(100);
            await expect(card).toHaveCSS('opacity', '1');
          }
          if (route === '/en' && index === 0) {
            await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await page.waitForTimeout(100);
            await expect(card).toHaveCSS('opacity', '1');
            await page.screenshot({ path: `e2e/.artifacts/product-real-${width}-after.png` });
            assert.ok((await card.locator('.card__title a').getAttribute('href')).startsWith('/en/p/'));
          }
        }
        results.push({ width, route, sections: names, cycles: count ? 3 : 0 });
        console.log(JSON.stringify(results.at(-1)));
      }
      await page.goto(base + '/en/shop');
      await page.waitForSelector('.product-motion__card');
      await page.locator('#sort').selectOption('price_asc');
      await page.waitForTimeout(800);
      assert.ok(page.url().includes('sort=price_asc'));
      const card = page.locator('.card').filter({ has: page.locator('.card__add:not([disabled])') }).first();
      await card.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(100);
      await card.locator('.card__add').click();
      assert.equal(await page.getByTestId('cart-count').first().textContent(), '1');
      await card.locator('.card__wish').click();
      await page.goto(base + '/en/wishlist');
      await page.waitForSelector('.product-motion__card');
      assert.equal(await page.locator('.product-motion__card').count(), 1);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.card').first().evaluate(el => getComputedStyle(el).opacity), '1');
      assert.deepEqual(errors, []);
      results.push({ width, interactions: 'sort, cart, wishlist, reduced motion passed' });
      await page.close();
    }
  } finally {
    fs.writeFileSync('e2e/.artifacts/product-real-results.json', JSON.stringify(results, null, 2));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
