import { test, expect } from './fixtures.js';
import { HomePage } from './pages/HomePage.js';

test.describe('Settings', () => {
  test('connects a Claude subscription with a setup token', async ({ page, api }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await page.locator('.dock-item[aria-label="Réglages"]').click();
    const modal = page.locator('.modal').last();
    await expect(modal).toContainText('Fournisseurs d’IA');
    await modal.getByRole('button', { name: 'Ajouter un fournisseur' }).click();
    const editor = page.locator('.modal').last();
    await expect(editor).toContainText('claude setup-token');
    await editor.locator('input[type="password"]').fill('sk-ant-oat01-e2e-token');
    await editor.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('.modal').last()).toContainText('Abonnement Claude (Pro / Max)');
    const { connections } = await api('list_ai_connections');
    const sub = connections.find((c) => c.provider === 'claude-subscription');
    expect(sub?.connected).toBe(true);
    await api('delete_connection', { connectionId: sub.id });
  });

  test('creates an API key and shows the Claude Code command', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto('fr');
    await page.locator('.dock-item[aria-label="Réglages"]').click();
    await page.locator('.modal .seg button', { hasText: 'API & MCP' }).click();
    await page.getByRole('button', { name: 'Nouvelle clé' }).click();
    await page.locator('.modal').last().getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.modal').last()).toContainText('claude mcp add --transport http crewbox');
  });
});
