import { test, expect, uniq } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { BoardPage } from './pages/BoardPage.js';
import { AgentPanel } from './pages/AgentPanel.js';

const firstSpace = async (api) => (await api('list_spaces')).spaces[0].id;

test.describe('Board', () => {
  test('draws one floor per Box and one block per coworker, and opens a coworker on click', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const name = uniq('Bloc QA');
    await api('create_agent', { name, spaceId: await firstSpace(api) });
    await page.reload();
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();
    const { spaces } = await api('list_spaces');
    const { agents } = await api('list_agents');
    await expect(board.root.locator('.rb-tile')).toHaveCount(spaces.length);
    await expect(board.root.locator('.rb-block')).toHaveCount(agents.length);
    await expect(board.tile(spaces[0].name)).toBeVisible();
    await board.block(name).click({ force: true });
    await expect(new AgentPanel(page).root.locator('h2')).toContainText(name.split(' ')[0], { timeout: 15_000 });
  });

  test('a block shows its state: waiting, switched off, asleep until its next task', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const spaceId = await firstSpace(api);
    const waiting = await api('create_agent', { name: uniq('Attente'), spaceId });
    const off = await api('create_agent', { name: uniq('Eteint'), spaceId });
    const sleepy = await api('create_agent', { name: uniq('Dodo'), spaceId });
    await api('update_agent', { agentId: off.agentId, enabled: false });
    await api('upsert_schedule', { agentId: sleepy.agentId, name: 'Lundi', cron: '0 9 * * 1', body: 'Fais le point.', enabled: true });
    await page.reload();
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();
    await expect(board.block(off.name)).toHaveClass(/st-off/);
    await expect(board.block(sleepy.name)).toHaveClass(/st-sleep/);
    await api('chat', { agentId: waiting.agentId, message: '/tool ask_user {"questions":[{"question":"On lance ?"}]}' });
    await expect(board.block(waiting.name)).toHaveClass(/st-waiting/);
    await expect(board.block(waiting.name).locator('.rb-bubble')).toBeVisible();
    await expect(board.progress.locator('.rb-dot.amber')).toBeVisible();
    await board.progress.click();
    await expect(page.getByRole('dialog', { name: 'À traiter' })).toContainText('On lance ?');
  });

  test('the HUD: Boxes menu, search, zoom, recenter, new coworker and the orb', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const name = uniq('Chercheur');
    await api('create_agent', { name, spaceId: await firstSpace(api) });
    await page.reload();
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();

    await board.workspace.click();
    const menu = page.getByRole('menu');
    const { spaces } = await api('list_spaces');
    for (const s of spaces) await expect(menu).toContainText(s.name);
    await menu.getByRole('menuitem', { name: /Nouvelle Box/ }).click();
    await expect(page.getByRole('dialog', { name: 'Nouvelle Box' })).toBeVisible();
    await page.keyboard.press('Escape');

    const before = await board.transform();
    await board.root.getByRole('button', { name: 'Zoomer', exact: true }).click();
    await expect.poll(() => board.transform()).not.toBe(before);
    await board.root.getByRole('button', { name: 'Recentrer' }).click();
    await expect.poll(() => board.transform(), { timeout: 3000 }).toBe(before);

    await board.search.click();
    await page.getByPlaceholder('Trouver un coworker…').fill(name.split(' ')[1]);
    await page.keyboard.press('Enter');
    await expect(new AgentPanel(page).root.locator('h2')).toContainText('Chercheur', { timeout: 15_000 });
    await page.keyboard.press('Escape');

    await board.add.click();
    await expect(page.getByRole('dialog', { name: 'Nouveau coworker' })).toBeVisible();
    await page.keyboard.press('Escape');
    await board.orb.click();
    await expect(page.getByRole('dialog', { name: 'Nouveau coworker' })).toBeVisible();
  });

  test('a coworker can wear a board colour', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const a = await api('create_agent', { name: uniq('Couleur'), spaceId: await firstSpace(api), color: '#16a37a' });
    expect((await api('get_agent', { agentId: a.agentId })).color).toBe('#16a37a');
    // An invalid colour is refused (sent outside the page, so the expected 400 is not a console error).
    const token = await page.locator('meta[name="crewbox-token"]').getAttribute('content');
    const bad = await page.request.post('/api/ui/update_agent', { headers: { 'x-crewbox-token': token }, data: { agentId: a.agentId, color: 'green' } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toMatch(/#rrggbb/);
    await page.reload();
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await expect(board.block(a.name).locator('linearGradient stop').first()).toHaveAttribute('stop-color', /^#[0-9a-f]{6}$/);
    // Pick another colour from the coworker settings.
    await board.block(a.name).click({ force: true });
    const panel = new AgentPanel(page);
    await panel.tab('Réglages');
    await panel.root.getByRole('radio', { name: '#cc43ae' }).click();
    await panel.root.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(async () => (await api('get_agent', { agentId: a.agentId })).color).toBe('#cc43ae');
  });

  test('the list view shows the same coworkers as cards', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Liste');
    const { agents } = await api('list_agents');
    await expect(page.locator('.desk-card')).toHaveCount(agents.length);
    await home.useView('Plateau');
    await expect(home.board).toBeVisible();
  });
});
