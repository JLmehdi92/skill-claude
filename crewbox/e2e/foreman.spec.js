import { test, expect } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { BoardPage } from './pages/BoardPage.js';
import { AgentPanel } from './pages/AgentPanel.js';
import { OnboardingPage } from './pages/OnboardingPage.js';

// The fake company website and the fake Resend API started by scripts/e2e-server.js.
const PORT = Number(process.env.E2E_PORT || 4810);
const SITE = `http://127.0.0.1:${PORT + 1}`;
const RESEND = `http://127.0.0.1:${PORT + 2}`;
const GOAL = 'Trouver des leads et leur envoyer des emails de prospection';

test.describe.serial('Foreman: from a website to a team that sends emails with Resend', () => {
  test('reads the website into the Brain, plans a lead team and builds it', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();
    // Rerun-style: the Boxes menu brings Foreman's welcome back.
    await board.workspace.click();
    await page.getByRole('menuitem', { name: 'Monter une équipe avec Foreman' }).click();
    const fm = new OnboardingPage(page);
    await expect(fm.root).toBeVisible();
    await expect(fm.root).toContainText('Salut, moi c’est Foreman.');

    await fm.analyze(SITE);
    await expect(fm.brain).toContainText('Facturo');
    await expect(fm.root).toContainText(/Stripe/);
    const brain = await api('list_brain');
    expect(brain.pages.map((p) => p.slug)).toEqual(expect.arrayContaining(['company', 'offer', 'customers']));

    await fm.design(GOAL);
    await expect(fm.agents).toHaveCount(2);
    await expect(fm.agents.filter({ hasText: 'Lina' })).toContainText('Apollo');
    const outreach = fm.agents.filter({ hasText: 'Oscar' });
    await expect(outreach).toContainText('Resend');

    await fm.build();
    // The first coworker opens on its guided setup.
    await expect(new AgentPanel(page).root).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    const { agents } = await api('list_agents');
    const lina = agents.find((a) => a.name.startsWith('Lina'));
    const oscar = agents.find((a) => a.name.startsWith('Oscar'));
    expect(lina && oscar).toBeTruthy();
    // Schedules are created paused; apps still to connect show on the board as locked blocks.
    expect((await api('list_schedules', { agentId: lina.id })).schedules.every((s) => !s.enabled)).toBe(true);
    await board.show();
    await expect(board.block(lina.name)).toHaveClass(/st-locked/, { timeout: 15_000 });
    await expect(board.block(lina.name).locator('.rb-status')).toHaveText('apps à connecter');
  });

  test('connects Resend with a key and the coworker sends an email after approval', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const oscar = (await api('list_agents')).agents.find((a) => a.name.startsWith('Oscar'));
    await home.useView('Liste');
    await page.locator('.desk-card', { hasText: oscar.name }).click();
    const panel = new AgentPanel(page);
    await panel.tab('Apps');
    const row = panel.root.getByTestId('app-resend');
    await expect(row).toContainText('à configurer');
    await row.getByRole('button', { name: 'Connecter' }).click();

    const connect = page.getByTestId('connect-app');
    await expect(connect.getByRole('radio', { name: /Clé API/ })).toHaveAttribute('aria-checked', 'true');
    await connect.getByLabel('API key').fill('re_e2e_key_42');
    await connect.getByTestId('connect-save').click();
    await expect(connect).toBeHidden();
    await expect(row).toContainText('connecté');
    // The key never shows up in the page.
    await expect(page.locator('body')).not.toContainText('re_e2e_key_42');

    await panel.tab('Chat');
    const email = { from: 'Oscar <oscar@facturo.fr>', to: ['claire@agence-nova.fr'], subject: 'Vos relances de factures', text: 'Bonjour Claire, ...' };
    await panel.send(`/tool mcp__resend__send_email ${JSON.stringify(email)}`);
    await expect(panel.pauseCard).toContainText('send_email');
    const before = await (await page.request.get(`${RESEND}/__calls`)).json();
    expect(before.filter((c) => c.url === '/emails')).toHaveLength(0);
    await panel.pauseCard.getByRole('button', { name: 'Autoriser une fois' }).click();
    await panel.pauseCard.getByRole('button', { name: 'Envoyer la réponse' }).click();
    await expect(await panel.lastReply()).toContainText('POST /emails → 200');

    const sent = (await (await page.request.get(`${RESEND}/__calls`)).json()).filter((c) => c.url === '/emails');
    expect(sent).toHaveLength(1);
    expect(sent[0].auth).toBe('Bearer re_e2e_key_42');
    expect(sent[0].body).toEqual(email);
  });

  test('the app library holds every Rerun connector and finds one by what it does', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const oscar = (await api('list_agents')).agents.find((a) => a.name.startsWith('Oscar'));
    await home.useView('Liste');
    await page.locator('.desk-card', { hasText: oscar.name }).click();
    const panel = new AgentPanel(page);
    await panel.tab('Apps');
    expect((await api('list_connectors', { limit: 1 })).total).toBeGreaterThanOrEqual(207);
    await panel.root.getByPlaceholder(/Chercher une app/).fill('hubspot');
    const card = panel.root.getByTestId('lib-hubspot');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Se connecter');
    await card.getByRole('button', { name: 'Installer' }).click();
    // HubSpot signs in with OAuth: the connect dialog offers the sign-in button.
    await expect(page.getByTestId('connect-signin')).toContainText('Se connecter à HubSpot');
    await page.keyboard.press('Escape');
    await expect(panel.root.getByTestId('app-hubspot')).toContainText('à connecter');
  });

  test('the Brain shows the website pages and a coworker proposal the owner accepts', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    const lina = (await api('list_agents')).agents.find((a) => a.name.startsWith('Lina'));
    await api('chat', { agentId: lina.id, message: '/tool brain_propose {"slug":"icp","title":"Client idéal","body":"Agences de 5 à 50 personnes en France.","reason":"Vu sur la page d’accueil."}' });
    await expect.poll(async () => (await api('list_brain')).proposals.length).toBe(1);
    await page.reload();
    await page.locator('.dock').getByRole('button', { name: /Cerveau/ }).click();
    const brain = page.getByTestId('brain');
    await expect(brain.locator('.brain-list')).toContainText('tiré de ton site');
    const proposal = brain.getByTestId('brain-proposal');
    await expect(proposal).toContainText('Client idéal');
    await proposal.getByRole('button', { name: 'Accepter' }).click();
    await expect(proposal).toBeHidden();
    await expect(brain.locator('.brain-list')).toContainText('Client idéal');
    expect((await api('list_brain')).pages.find((p) => p.slug === 'icp').body).toContain('Agences');
  });

  test('Autopilot rules are saved and switched on from the settings', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();
    await board.workspace.click();
    await page.getByRole('menuitem', { name: /Pilote auto/ }).click();
    const ap = page.getByTestId('autopilot');
    await ap.getByLabel('Règle 1').fill('Approuve les emails de prospection vers de nouveaux leads, 30 par jour maximum.');
    await ap.getByRole('button', { name: 'Enregistrer les règles' }).click();
    await ap.locator('label.toggle').click();
    await expect(ap.getByRole('switch')).toBeChecked();
    await expect.poll(async () => (await api('get_autopilot')).enabled).toBe(true);
    expect((await api('get_autopilot')).rules).toEqual(['Approuve les emails de prospection vers de nouveaux leads, 30 par jour maximum.']);
    await api('set_autopilot', { enabled: false });
  });

  test('the orb opens Foreman, the assistant', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await home.useView('Plateau');
    const board = new BoardPage(page);
    await board.show();
    await board.orb.click();
    await expect(new AgentPanel(page).root.locator('h2')).toContainText('Foreman', { timeout: 15_000 });
  });
});
