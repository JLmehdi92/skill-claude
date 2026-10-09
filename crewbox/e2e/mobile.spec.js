import { test, expect } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';

test.describe('Mobile', () => {
  test('hero, dock, constellation and panel work on a phone', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await expect(home.createButton).toBeVisible();
    await expect(page.locator('.dock')).toBeVisible();
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noScroll, 'no horizontal scroll').toBe(true);
    await api('create_agent', { name: 'Mobile QA', spaceId: (await api('list_spaces')).spaces[0].id });
    await page.reload();
    await home.useView('Constellation');
    await expect(home.world.locator('canvas')).toBeVisible();
    await expect(page.getByTestId('core')).toBeVisible({ timeout: 20_000 });
    await expect(home.world.locator('.bot-label', { hasText: 'Mobile QA' }).first()).toBeVisible();
    await home.useView('Liste');
    await page.locator('.desk-card', { hasText: 'Mobile QA' }).first().click();
    await expect(home.panel).toBeVisible();
  });
});
