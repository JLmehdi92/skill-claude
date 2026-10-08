import { test, expect } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';

test.describe('Home', () => {
  test('loads in French by default with the hero, prompt bar and stats', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await expect(page.locator('.hero-title')).toContainText('Ton travail récurrent');
    await expect(home.jobInput).toHaveAttribute('placeholder', /Trouve de nouveaux leads/);
    await expect(page.locator('.stat')).toHaveCount(4);
    await expect(page.locator('.dock-item')).toHaveCount(8);
  });

  test('switches to English and back, and remembers the choice', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.switchLang('en');
    await expect(page.locator('.hero-title')).toContainText('Your recurring work');
    expect((await api('get_preferences')).language).toBe('en');
    await page.reload();
    await expect(page.locator('.hero-title')).toContainText('Your recurring work');
    await home.switchLang('fr');
    await expect(page.locator('.hero-title')).toContainText('Ton travail récurrent');
    expect((await api('get_preferences')).language).toBe('fr');
  });

  test('creates a coworker from a plain description', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.jobInput.fill('Chaque lundi, résume les ventes de la semaine dans un rapport.');
    await home.createButton.click();
    await expect(home.panel).toBeVisible();
    await expect(page.locator('.toast')).toBeVisible();
  });
});
