import { expect, test } from "@playwright/test";
import path from "node:path";

// Runs against `next start` with KIE_MOCK=1 (see playwright.config.ts): no credits spent.
const refImage = path.join(process.cwd(), "app/icon.svg");

test.describe.configure({ mode: "serial" });

test("generate, follow progress, open details and remix", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Tokyo/ }).click();
  await expect(page.locator("#prompt")).toHaveValue(/Tokyo/);

  await page.getByRole("button", { name: "Ajouter une référence" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Images/ }).click();
  await (await chooser).setFiles(refImage);
  await page.getByRole("button", { name: /Insérer @Image1/ }).click();
  await expect(page.locator("#prompt")).toHaveValue(/@Image1/);

  await page.getByRole("button", { name: /^Durée/ }).click();
  await page.getByRole("button", { name: "8 s", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Durée : 8 secondes/ })).toBeVisible();

  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Génération lancée")).toBeVisible();
  await expect(page.getByText(/génération prête/)).toBeVisible({ timeout: 30_000 });

  await page.locator("article button").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Terminée", { exact: true })).toBeVisible();
  await expect(drawer.getByText("8 s", { exact: true })).toBeVisible();

  // Every generation has a known seed, even when the field was left empty.
  await expect(drawer.getByText("Seed (auto)")).toBeVisible();
  const seed = (await drawer.getByTitle("Copier le seed").innerText()).trim();
  expect(seed).toMatch(/^\d+$/);

  await drawer.getByRole("button", { name: "Même seed" }).click();
  await page.getByRole("button", { name: "Réglages avancés" }).click();
  await expect(page.locator("#seed")).toHaveValue(seed);
  await page.keyboard.press("Escape");

  await page.locator("article button").first().click();
  await page.locator("#prompt").fill("");
  await drawer.getByRole("button", { name: "Remix" }).click();
  await expect(page.locator("#prompt")).toHaveValue(/Tokyo/);
  await expect(page.getByRole("button", { name: /Insérer @Image1/ })).toBeVisible();
  // Remix of an automatic seed goes back to random.
  await page.getByRole("button", { name: "Réglages avancés" }).click();
  await expect(page.locator("#seed")).toHaveValue("");
  await page.keyboard.press("Escape");

  const cards = await page.locator("article").count();
  await page.locator("article button").first().click();
  await drawer.getByRole("button", { name: "Variante" }).click();
  await expect(page.getByText("Variante lancée")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(cards + 1);
});

test("failed generations stay in history and cost nothing", async ({ page }) => {
  await page.goto("/");
  await page.locator("#prompt").fill("Une scène qui échoue [fail]");
  await page.getByRole("button", { name: "Générer" }).click();
  await expect(page.getByText("Génération échouée")).toBeVisible({ timeout: 30_000 });

  await page.goto("/library");
  await page.getByRole("radio", { name: "Échouées" }).click();
  await expect(page.getByText("Échec simulé (mode mock).")).toBeVisible();
  await page.getByRole("searchbox").fill("Tokyo");
  await expect(page.getByText("Aucun résultat")).toBeVisible();
});

test("spending page tracks euros and enforces the monthly budget", async ({ page }) => {
  await page.goto("/depenses");
  await expect(page.getByRole("heading", { name: "Dépenses", exact: true })).toBeVisible();
  // 720P x 8 s = 128 credits = 0.64 $ = 0.58 EUR at the e2e rate of 0.9
  await expect(page.getByText("0,58 €").first()).toBeVisible();

  await page.getByRole("button", { name: "Définir un budget" }).click();
  // Spent so far: the first video and its variant, 0,58 € each.
  await page.getByLabel("Budget mensuel (€)").fill("1,4");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Plus de 80 % du budget")).toBeVisible();

  await page.goto("/");
  await page.locator("#prompt").fill("Encore une vidéo");
  await page.getByRole("button", { name: "Générer" }).click();
  const modal = page.getByRole("dialog", { name: "Budget mensuel dépassé" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Annuler" }).click();
  await expect(modal).toBeHidden();
});
