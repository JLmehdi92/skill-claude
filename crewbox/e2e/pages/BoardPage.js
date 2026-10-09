import { expect } from '@playwright/test';

/** The isometric board: Box floors, coworker blocks and the HUD around them. */
export class BoardPage {
  constructor(page) {
    this.page = page;
    this.root = page.getByTestId('board');
    this.svg = this.root.locator('svg.rb-svg');
    this.camera = this.svg.locator(':scope > g').first();
    this.workspace = page.getByTestId('rb-workspace');
    this.progress = page.getByTestId('rb-progress');
    this.bell = page.getByTestId('rb-bell');
    this.add = page.getByTestId('rb-add');
    this.search = page.getByTestId('rb-search');
    this.orb = page.getByTestId('rb-orb');
    this.templates = page.getByTestId('rb-templates');
  }

  block(name) { return this.root.locator(`.rb-block[aria-label="${name}"]`); }
  tile(name) { return this.root.locator('.rb-tile').filter({ has: this.page.locator('.rb-tile-name', { hasText: name }) }); }
  async transform() { return this.camera.getAttribute('transform'); }

  /** Bring the whole board into the viewport, as when the user scrolls to it. */
  async show() {
    // Smooth scrolling (Lenis) may still be gliding to an older target: scroll until the board stays put.
    await expect.poll(async () => {
      const top = await this.root.evaluate((el) => { const t = el.getBoundingClientRect().top; if (Math.abs(t) > 1) window.scrollTo(0, t + window.scrollY); return t; });
      await this.page.waitForTimeout(250);
      return Math.abs(top) < 2 && Math.abs(await this.root.evaluate((el) => el.getBoundingClientRect().top)) < 2;
    }, { timeout: 10_000 }).toBe(true);
    await expect(this.root).toBeInViewport({ ratio: 0.95 });
  }
}
