import { test, expect, uniq } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { BoardPage } from './pages/BoardPage.js';

test.describe('Mobile', () => {
  test('hero, dock, board and panel work on a phone', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await expect(home.createButton).toBeVisible();
    await expect(page.locator('.dock')).toBeVisible();
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noScroll, 'no horizontal scroll').toBe(true);
    const name = uniq('Mobile QA');
    await api('create_agent', { name, spaceId: (await api('list_spaces')).spaces[0].id });
    await page.reload();
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();
    // The board takes over the screen: its HUD in the corners, the page dock steps aside.
    await expect(page.locator('body')).toHaveClass(/rb-immersive/);
    for (const el of [board.workspace, board.templates, board.bell, board.progress, board.search, board.orb]) await expect(el).toBeInViewport();
    await expect(board.block(name)).toBeInViewport();
    await board.search.click();
    const search = page.getByRole('dialog', { name: 'Chercher un coworker' });
    await expect(search).toBeInViewport({ ratio: 1 });
    await page.getByPlaceholder('Trouver un coworker…').fill(name);
    await search.getByRole('button', { name: new RegExp(name) }).click();
    await expect(home.panel).toBeVisible({ timeout: 15_000 });
  });
});
