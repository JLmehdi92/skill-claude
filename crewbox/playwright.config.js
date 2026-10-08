// End-to-end tests (Playwright), following the ECC e2e-testing patterns: Page Objects,
// data-testid locators, condition-based waits, traces and screenshots on failure, and a
// fixture that fails any test on a console error or an uncaught page error.
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4810);
const chromium = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const launchOptions = {
  ...(chromium ? { executablePath: chromium } : {}),
  // Software WebGL so the 3D headquarters renders on machines without a GPU (CI, containers).
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testMatch: /mobile\.spec/, use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: { command: 'node scripts/e2e-server.js', url: `http://127.0.0.1:${PORT}/`, timeout: 120_000, reuseExistingServer: false, env: { E2E_PORT: String(PORT) } },
});
