import { expect, test } from "@playwright/test";

// The page follows the system setting through prefers-color-scheme; no toggle in the app.
// Values are the --canvas tokens of app/globals.css (light #e3e3e0, dark #1c1d20).
const CANVAS = { light: "rgb(227, 227, 224)", dark: "rgb(28, 29, 32)" } as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} system setting`, () => {
    test.use({ colorScheme: scheme });

    test(`page background is the ${scheme} canvas`, async ({ page }) => {
      await page.goto("/library");
      await expect(page.locator("body")).toHaveCSS("background-color", CANVAS[scheme]);
    });
  });
}
