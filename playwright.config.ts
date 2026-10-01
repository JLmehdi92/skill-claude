import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";

const port = 3107;
const chromium = "/opt/pw-browsers/chromium";

// The machine's LAN address: pages opened through it are NOT a secure context (unlike localhost),
// exactly like a phone opening http://192.168.x.x:3000. Some browser APIs are missing there.
const lanIp =
  Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? "127.0.0.1";

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
    {
      name: "desktop",
      testIgnore: "**/lan.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone-lan",
      testMatch: "**/lan.spec.ts",
      dependencies: ["desktop"],
      use: { ...devices["Pixel 7"], browserName: "chromium", baseURL: `http://${lanIp}:${port}` },
    },
  ],
  webServer: {
    command: `npx next start -H 0.0.0.0 -p ${port}`,
    port,
    reuseExistingServer: false,
    env: { KIE_MOCK: "1", STORAGE_DIR: "storage-e2e", USD_EUR_RATE: "0.9", KIE_OFFLINE_RATE: "1" },
  },
});
