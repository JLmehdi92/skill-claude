import { expect, test } from "@playwright/test";
import path from "node:path";

const image = path.join(process.cwd(), "app/icon.svg");
const video = path.join(process.cwd(), "fixtures/sample.mp4");

// Named to run after studio.spec, which needs an empty gallery (files run in name order, one worker).

test("genjutsu: copy a motion onto a character, priced from the video", async ({ page }) => {
  await page.request.put("/api/settings", { data: { monthlyBudgetEur: null } });
  await page.goto("/");

  // An image added in Wan moves to the character tile when switching model.
  await page.getByRole("radio", { name: "Images clés" }).click();
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter l'image de début" }).click();
  await (await chooser).setFiles(image);

  await page.getByRole("button", { name: /^Modèle :/ }).click();
  const models = page.getByRole("radiogroup", { name: "Modèle" });
  await expect(models.getByRole("group", { name: "Genjutsu : transformer une vidéo" })).toBeVisible();
  await models.getByRole("radio", { name: /Copier un mouvement/ }).click();

  await expect(page.getByRole("button", { name: "Modèle : Copier un mouvement" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Personnage : icon\.svg/ })).toBeVisible();
  // Prompt-driven tools and modes do not apply here.
  await expect(page.getByRole("radiogroup", { name: "Mode de génération" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Préréglages/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enrichir" })).toHaveCount(0);
  await expect(page.getByText("selon la durée de la vidéo")).toBeVisible();

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter la vidéo de mouvement, 3 à 30 s" }).click();
  await (await chooser).setFiles(video);
  await expect(page.getByRole("button", { name: /Mouvement : sample\.mp4/ })).toBeVisible();
  // 4 s at 22.7 credits/s.
  await expect(page.getByText("91 crédits")).toBeVisible();

  await page.getByRole("button", { name: "Générer" }).click();
  await expect(page.getByText("Génération lancée")).toBeVisible();
  await expect(page.locator("article").first()).toContainText("Copier un mouvement");
  // Finished before the next spec starts: no completion toast leaks into it.
  await expect(page.getByText("Copier un mouvement : génération prête")).toBeVisible({ timeout: 30_000 });
});

test("genjutsu: replacing a character takes no prompt, and undo restores the files", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Référence" }).click();
  await page.locator("#prompt").fill("une scène");
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter une référence" }).click();
  await page.getByRole("button", { name: /^Images/ }).click();
  await (await chooser).setFiles([image, image]);
  await expect(page.getByRole("button", { name: "Insérer @Image2 dans le prompt" })).toBeVisible();

  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await page.getByRole("radio", { name: /Remplacer un personnage Wan/ }).click();
  // One image fits the character tile, the second one is removed with an undo.
  await expect(page.getByText("1 fichier retiré : pas accepté par ce modèle.")).toBeVisible();
  await expect(page.locator("#prompt")).toHaveCount(0);
  await expect(page.getByText(/Pas de prompt : le personnage de ton image remplace/)).toBeVisible();

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("button", { name: "Modèle : Wan 3.0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Insérer @Image2 dans le prompt" })).toBeVisible();
  await expect(page.locator("#prompt")).toHaveValue("une scène");

  // Back on the replace model, the video goes to its tile and the generation is sent without prompt.
  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await page.getByRole("radio", { name: /Remplacer un personnage Wan/ }).click();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter la vidéo, 10 Mo max" }).click();
  await (await chooser).setFiles(video);
  // 4 s at 6 credits/s in 480p.
  await expect(page.getByText("24 crédits")).toBeVisible();
  await page.getByRole("button", { name: "Générer" }).click();
  await expect(page.getByText("Génération lancée")).toBeVisible();
  await expect(page.locator("article").first()).toContainText("Remplacer un personnage");
  // Finished before the next spec starts: no completion toast leaks into it.
  await expect(page.getByText("Remplacer un personnage : génération prête")).toBeVisible({ timeout: 30_000 });
});

test("presets: French labels, checkboxes, prompt preview", async ({ page }) => {
  await page.goto("/");
  await page.locator("#prompt").fill("un chat");
  await page.getByRole("button", { name: /^Préréglages/ }).click();
  const presets = page.getByRole("group", { name: "Préréglages" });
  await presets.getByRole("checkbox", { name: /Push In/ }).click();
  await presets.getByRole("checkbox", { name: /Anime/ }).click();
  await expect(presets.getByRole("checkbox", { name: /Push In/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Préréglages (2)" })).toBeVisible();
  await page.getByRole("button", { name: "Aperçu" }).click();
  await expect(page.getByText(/^un chat, smooth push-in camera movement/)).toBeVisible();
});

test("motion gallery: add a video, pick it for the motion tile, remove it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await page.getByRole("radio", { name: /Copier un mouvement/ }).click();
  await page.getByRole("button", { name: "Galerie de mouvements" }).click();
  const gallery = page.getByRole("dialog", { name: "Galerie de mouvements" });
  await expect(gallery.getByText(/Garde ici les vidéos de mouvement/)).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await gallery.getByRole("button", { name: /Ajouter une vidéo/ }).click();
  await (await chooser).setFiles(video);
  await expect(page.getByText("Vidéo ajoutée à la galerie")).toBeVisible();

  await gallery.getByRole("button", { name: "Choisir sample, 4 s" }).click();
  await expect(gallery).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Mouvement : sample\.mp4/ })).toBeVisible();
  await expect(page.getByText("91 crédits")).toBeVisible();

  await page.getByRole("button", { name: "Galerie de mouvements" }).click();
  await gallery.getByRole("button", { name: "Retirer sample de la galerie" }).click();
  await expect(page.getByText("Mouvement retiré")).toBeVisible();
  await expect(gallery.getByRole("button", { name: "Choisir sample, 4 s" })).toHaveCount(0);
  // Focus stays in the dialog, on "Ajouter une vidéo" once the list is empty.
  await expect(gallery.getByRole("button", { name: /Ajouter une vidéo/ })).toBeFocused();
  // Deleted for real: reopening does not bring it back.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Galerie de mouvements" }).click();
  await expect(gallery.getByText(/Garde ici les vidéos de mouvement/)).toBeVisible();
});

test("motion gallery: a finished generation video can be added from its detail", async ({ page }) => {
  await page.goto("/");
  await page.locator("article button").first().click();
  const detail = page.getByRole("dialog");
  await detail.getByRole("button", { name: "Ajouter aux mouvements" }).click();
  await expect(page.getByText("Ajoutée aux mouvements")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Dans les mouvements" })).toHaveAttribute("aria-disabled", "true");
});

test("images: Nano Banana 2.1 makes an image, priced per image, without video presets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await expect(page.getByRole("group", { name: "Créer une image" })).toBeVisible();
  await page.getByRole("radio", { name: /Nano Banana 2\.1/ }).click();
  await expect(page.getByRole("button", { name: /^Préréglages/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enrichir" })).toHaveCount(0);
  await page.locator("#prompt").fill("Portrait d'une femme aux cheveux roux, lumière de fenêtre");
  await expect(page.getByText("4 crédits")).toBeVisible();
  await page.getByRole("button", { name: /^Résolution/ }).click();
  await page.getByRole("radio", { name: "4K" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("9 crédits")).toBeVisible();
  await page.getByRole("button", { name: "Générer" }).click();
  await expect(page.getByText("Génération lancée")).toBeVisible();
  await expect(page.getByText("Nano Banana 2.1 : génération prête")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("article").first().locator("img")).toBeVisible();
});

test("genjutsu pro: several character images, Seedance bills input and output seconds", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Référence" }).click();
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter une référence" }).click();
  await page.getByRole("button", { name: /^Images/ }).click();
  await (await chooser).setFiles([image, image]);
  await expect(page.getByRole("button", { name: "Insérer @Image2 dans le prompt" })).toBeVisible();

  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await page.getByRole("radio", { name: /Remplacer un personnage Pro/ }).click();
  // Both images move to the character slot, which still has room.
  await expect(page.getByRole("button", { name: /Personnage 1 : icon\.svg/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Personnage 2 : icon\.svg/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une image du personnage" })).toBeVisible();

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Ajouter la vidéo, 2 à 30 s" }).click();
  await (await chooser).setFiles(video);
  // 4 s in + 4 s out at 38 credits/s (720p).
  await expect(page.getByText("304 crédits")).toBeVisible();
  await page.getByRole("button", { name: "Générer" }).click();
  await expect(page.getByText("Génération lancée")).toBeVisible();
  await expect(page.getByText("Remplacer un personnage Pro : génération prête")).toBeVisible({ timeout: 30_000 });
});

test("a scene prompt is not sent as a Genjutsu instruction, and comes back afterwards", async ({ page }) => {
  await page.goto("/");
  await page.locator("#prompt").fill("Un chat sur une plage au coucher du soleil");
  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await page.getByRole("radio", { name: /Copier un mouvement/ }).click();
  await expect(page.locator("#prompt")).toHaveValue("");
  await page.getByRole("button", { name: /^Modèle :/ }).click();
  await page.getByRole("radio", { name: /Nano Banana 2\.1/ }).click();
  await expect(page.locator("#prompt")).toHaveValue("Un chat sur une plage au coucher du soleil");
});
