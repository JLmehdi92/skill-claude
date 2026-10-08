import { test, expect } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { AgentPanel } from './pages/AgentPanel.js';

test.describe('Templates', () => {
  test('lists the rerun.build library with categories and search', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.scrollTo('#templates');
    await expect(page.locator('.cat-chip').first()).toContainText('Tout');
    await expect(page.locator('.cat-chip', { hasText: 'Immobilier' })).toBeVisible();
    await page.locator('.tpl-search input').fill('Overdue');
    await expect(home.templateGrid.locator('.tpl-card').first()).toContainText(/overdue/i);
    await expect(home.templateGrid.locator('.pill', { hasText: 'rerun.build' }).first()).toBeVisible();
  });

  test('installs a rerun.build template with its skills and starts the guided setup', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.installTemplate('Follow Up on Overdue Invoices');
    const panel = new AgentPanel(page);
    await expect(panel.root.locator('.chat-bar select').first()).toContainText('Guided setup');
    await panel.tab('Skills');
    await expect(panel.root.locator('.mini-card').first()).toBeVisible();
    await panel.tab('Apps');
    await expect(panel.root.getByText('Stripe').first()).toBeVisible();
    const { agents } = await api('list_agents');
    expect(agents.some((a) => a.name === 'Overdue Invoice Follow-Up')).toBe(true);
  });
});
