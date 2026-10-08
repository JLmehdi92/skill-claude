import { expect } from '@playwright/test';

export class AgentPanel {
  constructor(page) {
    this.page = page;
    this.root = page.getByTestId('agent-panel');
    this.composer = page.getByTestId('composer');
    this.pauseCard = page.getByTestId('pause-card');
  }

  async tab(label) {
    await this.root.locator('.tabs button', { hasText: label }).click();
    await expect(this.root.locator('.tabs button.active', { hasText: label })).toBeVisible();
  }

  async send(text) {
    await this.composer.fill(text);
    await this.composer.press('Enter');
  }

  async lastReply() {
    const bubble = this.root.locator('.msg.assistant .bubble').last();
    await expect(bubble).toBeVisible();
    return bubble;
  }

  async close() {
    await this.page.keyboard.press('Escape');
    await expect(this.root).toBeHidden();
  }
}
