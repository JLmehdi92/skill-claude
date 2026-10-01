import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const port = 3107;
const chromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: fs.existsSync(chromium) ? { executablePath: chromium } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: false,
    env: { KIE_MOCK: "1", STORAGE_DIR: "storage-e2e", USD_EUR_RATE: "0.9", KIE_OFFLINE_RATE: "1" },
  },
});
