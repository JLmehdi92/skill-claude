import { test, expect, uniq } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { AgentPanel } from './pages/AgentPanel.js';

test.describe('Headquarters', () => {
  test('renders the 3D world with one robot label per coworker and opens one on click', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const name = uniq('Robot QA');
    await api('create_agent', { name, spaceId: (await api('list_spaces')).spaces[0].id });
    await page.reload();
    await home.useView('Monde 3D');
    await expect(home.world.locator('canvas')).toBeVisible();
    const label = home.world.locator('.bot-label', { hasText: name });
    await expect(label).toBeVisible({ timeout: 20_000 });
    const { agents } = await api('list_agents');
    await expect(home.world.locator('.bot-label')).toHaveCount(agents.length);
    await label.click({ force: true });
    const panel = new AgentPanel(page);
    await expect(panel.root.locator('h2')).toContainText(name.split(' ')[0], { timeout: 15_000 });
  });

  test('shows waiting coworkers in the HUD and the ticker', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const a = await api('create_agent', { name: uniq('Attente'), spaceId: (await api('list_spaces')).spaces[0].id });
    await home.useView('Monde 3D');
    await expect(home.world.locator('canvas')).toBeVisible();
    await api('chat', { agentId: a.agentId, message: '/tool ask_user {"questions":[{"question":"Ok ?"}]}' });
    await expect(home.world.locator('.hud-chip.warn')).toBeVisible();
    await expect(page.getByTestId('ticker')).toContainText(/a besoin de toi|s’est mis au travail/);
  });

  test('the list view shows the same coworkers as cards', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Liste');
    const { agents } = await api('list_agents');
    await expect(page.locator('.desk-card')).toHaveCount(agents.length);
    await home.useView('Monde 3D');
  });
});
