import { expect } from '@playwright/test';

export class HomePage {
  constructor(page) {
    this.page = page;
    this.jobInput = page.getByTestId('job-input');
    this.createButton = page.getByTestId('create-coworker');
    this.board = page.getByTestId('board');
    this.templateGrid = page.getByTestId('template-grid');
    this.panel = page.getByTestId('agent-panel');
  }

  async goto(lang = 'fr') {
    // Seed the language once per tab, so a reload keeps whatever the test switched to.
    await this.page.addInitScript((l) => {
      try {
        if (!sessionStorage.getItem('e2e.lang-seeded')) { localStorage.setItem('crewbox.lang', l); sessionStorage.setItem('e2e.lang-seeded', '1'); }
      } catch { /* ignore */ }
    }, lang);
    await this.page.goto('/');
    await expect(this.page.locator('.hero-title')).toBeVisible();
  }

  async switchLang(l) {
    await this.page.locator('.lang-switch button', { hasText: l.toUpperCase() }).click();
    await expect(this.page.locator('html')).toHaveAttribute('lang', l);
  }

  async scrollTo(id) {
    await this.page.evaluate((sel) => window.scrollTo(0, document.querySelector(sel).offsetTop - 10), id);
  }

  async useView(name) {
    await this.scrollTo('#board');
    await this.page.locator('#board .seg button', { hasText: name }).click();
  }

  async installTemplate(name) {
    await this.scrollTo('#templates');
    await this.page.locator('.tpl-search input').fill(name);
    const card = this.templateGrid.locator('.tpl-card', { hasText: name }).first();
    await card.getByRole('button', { name: /Installer|Install/ }).click();
    await expect(this.panel).toBeVisible();
  }
}
