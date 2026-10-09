import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';

// WCAG 2.2 AA through axe-core. A clean run is necessary, not sufficient: keyboard checks follow.
const scan = (page) => new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
  .analyze();
const summary = (v) => v.map((x) => `${x.id} (${x.impact}) × ${x.nodes.length}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);

test.describe('Accessibility', () => {
  for (const lang of ['fr', 'en']) {
    test(`home page has no serious WCAG AA violation (${lang})`, async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(lang);
      await home.useView(lang === 'fr' ? 'Plateau' : 'Board');
      await expect(page.getByTestId('rb-orb')).toBeVisible();
      const { violations } = await scan(page);
      const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      expect(summary(serious), 'serious or critical axe violations').toEqual([]);
    });
  }

  test('the agent panel and a dialog pass axe too', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await api('create_agent', { name: 'A11y QA', spaceId: (await api('list_spaces')).spaces[0].id });
    await page.reload();
    await home.useView('Liste');
    await page.locator('.desk-card', { hasText: 'A11y QA' }).first().click();
    await expect(home.panel).toBeVisible();
    const { violations } = await scan(page);
    expect(summary(violations.filter((v) => ['serious', 'critical'].includes(v.impact)))).toEqual([]);
  });

  test('the main journey works with the keyboard only', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.jobInput.focus();
    await page.keyboard.type('Résume mes mails non lus chaque matin à 8h');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.textContent?.trim());
    expect(focused).toBeTruthy();
    // Every interactive element shows a visible focus indicator: on itself or on its wrapper (:focus-within).
    const noRing = await page.evaluate(() => {
      const look = (el) => { const out = []; for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { const c = getComputedStyle(n); out.push(c.outlineStyle + c.outlineColor + c.boxShadow + c.borderColor); } return out.join('|'); };
      return [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => el.offsetParent).slice(0, 60).filter((el) => {
        el.blur(); const before = look(el);
        el.focus(); const after = look(el);
        return el === document.activeElement && before === after;
      }).map((el) => `${el.tagName}.${el.className}`);
    });
    expect(noRing, 'focus indicator').toEqual([]);
  });
});
