import { expect } from '@playwright/test';

/** Foreman's welcome: website → Brain → goal → plan card → team. */
export class OnboardingPage {
  constructor(page) {
    this.page = page;
    this.root = page.getByTestId('onboarding');
    this.url = page.getByTestId('onboarding-url');
    this.analyzeButton = page.getByTestId('onboarding-analyze');
    this.pages = page.getByTestId('onboarding-pages');
    this.brain = page.getByTestId('onboarding-brain');
    this.goal = page.getByTestId('onboarding-goal');
    this.designButton = page.getByTestId('onboarding-design');
    this.plan = page.getByTestId('onboarding-plan');
    this.agents = page.getByTestId('plan-agent');
    this.buildButton = page.getByTestId('onboarding-build');
  }

  async analyze(site) {
    await this.url.fill(site);
    await this.analyzeButton.click();
    await expect(this.brain).toBeVisible({ timeout: 30_000 });
  }

  async design(goal) {
    await this.goal.fill(goal);
    await this.designButton.click();
    await expect(this.plan).toBeVisible({ timeout: 30_000 });
  }

  async build() {
    await this.buildButton.click();
    await expect(this.root).toBeHidden({ timeout: 30_000 });
  }
}
