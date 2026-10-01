import { expect, test } from "@playwright/test";
import path from "node:path";

// Runs on a phone viewport through the LAN address (see playwright.config.ts): not a secure
// context, so crypto.randomUUID and navigator.clipboard do not exist, as on a real phone at home.
const image = path.join(process.cwd(), "app/icon.svg");
const video = path.join(process.cwd(), "fixtures/sample.mp4");

test("phone on the LAN: insecure context as expected", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
});

test("phone on the LAN: reference image and video show up", async ({ page }) => {
  // Independent of earlier tests: the spending test leaves a small monthly budget behind.
  await page.request.put("/api/settings", { data: { monthlyBudgetEur: null } });
  await page.goto("/");
  await page.getByRole("radio", { name: "Référence" }).tap();

  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter une référence" }).tap();
  await page.getByRole("button", { name: /^Images/ }).tap();
  await (await chooser).setFiles(image);
  await expect(page.getByRole("button", { name: "Insérer @Image1 dans le prompt" })).toBeVisible();

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter une référence" }).tap();
  await page.getByRole("button", { name: /^Vidéos/ }).tap();
  await (await chooser).setFiles(video);
  await expect(page.getByRole("button", { name: "Insérer @Video1 dans le prompt" })).toBeVisible();

  // And the whole flow goes through from the phone: tags in the prompt, generation, result.
  await page.getByRole("button", { name: "Insérer @Image1 dans le prompt" }).tap();
  await page.getByRole("button", { name: "Insérer @Video1 dans le prompt" }).tap();
  await page.locator("#prompt").pressSequentially("la femme de l'image danse comme dans la vidéo");
  await expect(page.locator("#prompt")).toHaveValue(/@Image1 @Video1 la femme/);
  await page.getByRole("button", { name: "Générer" }).tap();
  await expect(page.getByText("Génération lancée")).toBeVisible();
  await expect(page.getByText(/génération prête/)).toBeVisible({ timeout: 30_000 });
  await page.locator("article button").first().tap();
  await expect(page.getByRole("dialog").getByText("Référence", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: /icon\.svg/ })).toBeVisible();
});

test("phone on the LAN: keyframe start image shows up", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Images clés" }).tap();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter l'image de début" }).tap();
  await (await chooser).setFiles(image);
  await expect(page.getByRole("button", { name: /Début : icon\.svg/ })).toBeVisible();
});

test("phone on the LAN: copy buttons work", async ({ page }) => {
  await page.goto("/");
  await page.locator("article button").first().tap();
  await page.getByTitle("Copier le seed").tap();
  await expect(page.getByText("Seed copié")).toBeVisible();
});
