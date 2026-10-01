import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

for (const path of ["/", "/library", "/depenses"]) {
  test(`no horizontal scroll on ${path} at phone width`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await page.waitForTimeout(300); // let ResizeObserver-driven charts re-measure
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(client);
    }
  });
}

test("every composer setting is reachable on a phone", async ({ page }) => {
  await page.goto("/");
  for (const name of [/Ajouter une référence/, /^Durée/, /Réglages avancés/, /^Générer$/]) {
    const el = page.getByRole("button", { name });
    await expect(el).toBeInViewport();
  }
  await page.getByRole("button", { name: "Réglages avancés" }).tap();
  const panel = page.getByRole("dialog");
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
