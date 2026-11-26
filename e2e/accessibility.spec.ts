import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automated WCAG 2.2 A/AA checks (axe-core) on the main storefront pages, in both languages.
 * Fails on "critical" and "serious" violations; "moderate"/"minor" findings are printed only.
 * Automated checks find roughly a third of accessibility problems: keyboard and screen-reader
 * reviews are still needed.
 */
const PAGES = ['/ar', '/en', '/ar/c/power-banks', '/en/shop', '/en/p/demo-power-bank-20000', '/ar/cart', '/en/checkout', '/en/track', '/en/login', '/ar/faq', '/en/blog'];

for (const url of PAGES) {
  test(`no serious accessibility violations: ${url}`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    const minor = result.violations.filter((v) => !blocking.includes(v));
    if (minor.length) console.log(`${url}: non-blocking`, minor.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(', '));
    const report = blocking.map((v) => `${v.id} [${v.impact}] ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    expect(report, `${url}\n${report.join('\n')}`).toEqual([]);
  });
}
