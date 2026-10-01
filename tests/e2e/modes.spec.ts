import { expect, test } from "@playwright/test";
import path from "node:path";

const image = path.join(process.cwd(), "app/icon.svg");

test("modes: keyframe slots, undo on switch, remembered choice", async ({ page }) => {
  await page.goto("/");
  const modes = page.getByRole("radiogroup", { name: "Mode de génération" });
  await expect(modes.getByRole("radio", { name: "Texte" })).toHaveAttribute("aria-checked", "true");

  // Keyframes: dedicated start / end slots, end only after start.
  await modes.getByRole("radio", { name: "Images clés" }).click();
  await expect(page.getByRole("button", { name: "Ajouter l'image de fin" })).toBeDisabled();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter l'image de début" }).click();
  await (await chooser).setFiles(image);
  await expect(page.getByRole("button", { name: /Début : icon.svg/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter l'image de fin" })).toBeEnabled();

  // Switching mode removes the keyframe, and "Annuler" brings it back.
  await modes.getByRole("radio", { name: "Référence" }).click();
  await expect(page.getByText("Mode Référence")).toBeVisible();
  await expect(page.getByRole("button", { name: /Début : icon.svg/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(modes.getByRole("radio", { name: "Images clés" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /Début : icon.svg/ })).toBeVisible();

  // The chosen mode survives a reload.
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Mode de génération" }).getByRole("radio", { name: "Images clés" })).toHaveAttribute("aria-checked", "true");
});

test("modes: adding a reference from text mode switches to Référence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ajouter une référence" }).click();
  await expect(page.getByText("Référence (change de mode)")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Images/ }).click();
  await (await chooser).setFiles(image);
  await expect(page.getByRole("radio", { name: "Référence" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /Insérer @Image1/ })).toBeVisible();
  // Keyboard: arrows move between modes.
  await page.getByRole("radio", { name: "Référence" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Images clés" })).toHaveAttribute("aria-checked", "true");
});
