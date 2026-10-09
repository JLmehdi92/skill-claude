import { test as base, expect } from '@playwright/test';

// Noise that is not an app error: software-GL performance hints.
const IGNORED = [/GL Driver Message/i, /GPU stall/i, /WebGL.*performance/i];

export const test = base.extend({
  /** Every test fails if the page logs an error or throws. */
  page: async ({ page }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(`console: ${m.text()}`); });
    // A request cancelled by a navigation (reload, goto) reports ERR_ABORTED: that is the test moving on, not the app failing.
    page.on('requestfailed', (r) => { if (!r.url().includes('/api/events') && r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    await use(page);
    if (errors.length) await testInfo.attach('errors', { body: errors.join('\n'), contentType: 'text/plain' });
    expect(errors, 'no console errors, page errors or failed requests').toEqual([]);
  },
  /** Call the local UI API with the page token (seed data without clicking through the UI). */
  api: async ({ page }, use) => {
    await use(async (name, args = {}) => {
      if (!page.url().startsWith('http')) await page.goto('/');
      return page.evaluate(async ([n, a]) => {
        const token = document.querySelector('meta[name="crewbox-token"]').content;
        const r = await fetch(`/api/ui/${n}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewbox-token': token }, body: JSON.stringify(a) });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        return body;
      }, [name, args]);
    });
  },
});

export { expect };
export const uniq = (p) => `${p} ${Math.random().toString(36).slice(2, 6)}`;
