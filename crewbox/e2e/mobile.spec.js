import { test, expect, uniq } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { BoardPage } from './pages/BoardPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';

const SITE = `http://127.0.0.1:${Number(process.env.E2E_PORT || 4810) + 1}`;

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

  test('Foreman onboarding fits a phone, from the website to the plan', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await page.evaluate(() => window.dispatchEvent(new Event('crewbox:onboarding')));
    const fm = new OnboardingPage(page);
    await expect(fm.root).toBeVisible();
    await expect(fm.analyzeButton).toBeInViewport();
    await fm.analyze(SITE);
    await expect(fm.goal).toBeVisible();
    await fm.design('Répondre aux demandes du support client');
    await expect(fm.agents.first()).toBeVisible();
    const fits = await page.evaluate(() => [...document.querySelectorAll('[data-testid="plan-agent"]')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1));
    expect(fits, 'plan cards fit the screen').toBe(true);
    await fm.buildButton.scrollIntoViewIfNeeded();
    await expect(fm.buildButton).toBeInViewport();
    await fm.root.getByRole('button', { name: 'Passer' }).click();
    await expect(fm.root).toBeHidden();
  });
});
