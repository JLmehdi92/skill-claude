import { test, expect, uniq } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';
import { AgentPanel } from './pages/AgentPanel.js';

async function openNew(page, api, extra = {}) {
  const home = new HomePage(page);
  await home.goto('fr');
  const name = uniq('Chat QA');
  const a = await api('create_agent', { name, spaceId: (await api('list_spaces')).spaces[0].id, ...extra });
  await home.useView('Liste');
  await page.locator('.desk-card', { hasText: name }).click();
  const panel = new AgentPanel(page);
  await expect(panel.root).toBeVisible();
  return { panel, agent: a };
}

test.describe('Chat and human in the loop', () => {
  test('answers a message and streams the reply', async ({ page, api }) => {
    const { panel } = await openNew(page, api);
    await panel.send('Bonjour !');
    await expect(await panel.lastReply()).toContainText('Bonjour');
  });

  test('a question card pauses the coworker and the answer resumes it', async ({ page, api }) => {
    const { panel } = await openNew(page, api);
    await panel.send('/tool ask_user {"questions":[{"question":"Quel ton pour les relances ?","options":["Poli","Ferme"]}]}');
    await expect(panel.pauseCard).toBeVisible();
    await panel.pauseCard.getByRole('button', { name: /Ferme/ }).click();
    await panel.pauseCard.getByRole('button', { name: 'Envoyer la réponse' }).click();
    await expect(panel.pauseCard).toBeHidden();
    await expect(await panel.lastReply()).toContainText('Ferme');
  });

  test('an approval gate holds a shell command until it is allowed', async ({ page, api }) => {
    const { panel } = await openNew(page, api, { approvals: { shell: true } });
    await panel.send('/tool shell_run {"command":"echo e2e-ok"}');
    await expect(panel.pauseCard).toContainText('shell_run');
    await panel.pauseCard.getByRole('button', { name: 'Autoriser une fois' }).click();
    await panel.pauseCard.getByRole('button', { name: 'Envoyer la réponse' }).click();
    await expect(await panel.lastReply()).toContainText('e2e-ok');
  });

  test('every tab renders', async ({ page, api }) => {
    const { panel } = await openNew(page, api);
    for (const tab of ['À traiter', 'Skills', 'Automatisations', 'Apps', 'Mémoire', 'Base de données', 'Fichiers', 'Runs', 'Réglages', 'Chat']) {
      await panel.tab(tab);
    }
    await panel.close();
  });
});
