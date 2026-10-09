import { test, expect, uniq } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { AgentPanel } from './pages/AgentPanel.js';

test.describe('Headquarters (constellation)', () => {
  test('renders the constellation with one entity per coworker and flies to one on click', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const name = uniq('Entite QA');
    await api('create_agent', { name, spaceId: (await api('list_spaces')).spaces[0].id });
    await page.reload();
    await home.useView('Constellation');
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
    await home.useView('Constellation');
    await expect(home.world.locator('canvas')).toBeVisible();
    await api('chat', { agentId: a.agentId, message: '/tool ask_user {"questions":[{"question":"Ok ?"}]}' });
    await expect(home.world.locator('.hud-chip.warn')).toBeVisible();
    await expect(page.getByTestId('ticker')).toContainText(/a besoin de toi|s’est mis au travail/);
  });

  test('the core shows who waits for you and opens what you have to handle', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const a = await api('create_agent', { name: uniq('Noyau'), spaceId: (await api('list_spaces')).spaces[0].id });
    await home.useView('Constellation');
    const core = page.getByTestId('core');
    await expect(core).toBeVisible({ timeout: 20_000 });
    await api('chat', { agentId: a.agentId, message: '/tool ask_user {"questions":[{"question":"On y va ?"}]}' });
    await expect(core).toContainText(/t’attend/);
    await expect(core).toHaveClass(/warn/);
    await core.click({ force: true });
    const inbox = page.getByRole('dialog', { name: 'À traiter' });
    await expect(inbox).toBeVisible();
    await expect(inbox).toContainText('On y va ?');
  });

  test('the legend explains the visual language, in French', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Constellation');
    await page.getByTestId('legend-btn').click();
    const legend = page.getByRole('dialog', { name: 'Lire la constellation' });
    await expect(legend).toBeVisible();
    for (const word of ['prête', 'au travail', 't’attend', 'erreur', 'éteinte', 'lunes', 'éclats', 'comète']) await expect(legend).toContainText(word);
    await legend.getByRole('button', { name: 'Fermer' }).click();
    await expect(legend).toBeHidden();
  });

  test('names can be hidden, except for coworkers that need you', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const name = uniq('Discret');
    await api('create_agent', { name, spaceId: (await api('list_spaces')).spaces[0].id });
    await page.reload();
    await home.useView('Constellation');
    const label = home.world.locator('.bot-label', { hasText: name });
    await expect(label).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Noms' }).click();
    await expect(label).toHaveCSS('opacity', '0');
    await page.getByRole('button', { name: 'Noms' }).click();
    await expect(label).toHaveCSS('opacity', '1');
  });

  test('the list view shows the same coworkers as cards', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Liste');
    const { agents } = await api('list_agents');
    await expect(page.locator('.desk-card')).toHaveCount(agents.length);
    await home.useView('Constellation');
  });
});
