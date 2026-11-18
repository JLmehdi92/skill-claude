import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-characters-"));
process.env.STORAGE_DIR = dir;
process.env.KIE_MOCK = "1";
process.env.KIE_MOCK_SECONDS = "0.05";
process.env.KIE_OFFLINE_RATE = "1";
process.env.USD_EUR_RATE = "0.9";

const chars = await import("@/lib/server/characters");
const svc = await import("@/lib/server/generations");
const { setSetting } = await import("@/lib/server/db");
const { monthCommittedEur } = await import("@/lib/server/stats");

const photo = (name = "face.png") => ({ name, mime: "image/png", data: fs.readFileSync(path.join(process.cwd(), "fixtures/sample.png")) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Soul ID", () => {
  it("trains a character, books 2.50 $ in spending without showing it in the gallery, then gets ready", async () => {
    setSetting("monthly_budget_eur", null);
    const before = monthCommittedEur();
    const res = await chars.trainCharacter("Léa", [photo(), photo("profil.png")]);
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.character).toMatchObject({ name: "Léa", status: "training" });
    expect(res.character.thumbUrl).toMatch(/^\/api\/media\/characters\//);
    expect(monthCommittedEur() - before).toBeCloseTo(2.25, 2); // 500 credits x 0.005 $ x 0.9
    expect(svc.listGenerations().items.some((g) => g.model === "soul-id")).toBe(false);

    await sleep(80);
    await chars.pollCharacters();
    expect(chars.listCharacters().find((c) => c.id === res.character.id)?.status).toBe("ready");
  });

  it("refunds a failed training and keeps the reason", async () => {
    const before = monthCommittedEur();
    const res = await chars.trainCharacter("FailRaté", [photo()]);
    if (!res.ok) throw new Error("train failed");
    await sleep(80);
    await chars.pollCharacters();
    const c = chars.listCharacters().find((x) => x.id === res.character.id)!;
    expect(c).toMatchObject({ status: "failed", failReason: "Échec simulé (mode mock)." });
    expect(monthCommittedEur()).toBeCloseTo(before, 4);
  });

  it("validates the request and asks before going over the monthly budget", async () => {
    expect(await chars.trainCharacter(" ", [])).toEqual({ ok: false, status: 422, errors: ["Donne un nom au personnage.", "Ajoute au moins une photo."] });
    expect(await chars.trainCharacter("Léa", [photo()])).toMatchObject({ ok: false, errors: ["Ce nom est déjà pris."] });
    expect(await chars.trainCharacter("léa", [photo()])).toMatchObject({ ok: false, errors: ["Ce nom est déjà pris."] });
    expect(await chars.trainCharacter("Léa Dupont", [photo()])).toMatchObject({ ok: false, status: 422 });
    // "@Image1" already means the first attached image.
    expect(await chars.trainCharacter("Image1", [photo()])).toMatchObject({ ok: false, status: 422 });
    expect(await chars.trainCharacter("Vidéo", [{ name: "a.mp4", mime: "video/mp4", data: Buffer.from("x") }])).toMatchObject({ ok: false, status: 422 });
    setSetting("monthly_budget_eur", "1");
    expect(await chars.trainCharacter("Cher", [photo()])).toMatchObject({ ok: false, status: 409 });
    expect(await chars.trainCharacter("Cher", [photo()], { confirmOverBudget: true })).toMatchObject({ ok: true });
    setSetting("monthly_budget_eur", null);
  });

  it("keeps a training character until it ends, so a failure can still be refunded", async () => {
    const training = chars.listCharacters().find((c) => c.name === "Cher")!;
    expect(training.status).toBe("training");
    expect(await chars.removeCharacter(training.id)).toBe("training");
    // Soul 2 cannot use it yet.
    expect(chars.characterNotReady(training.referenceId)).toMatch(/entraînement/);
    const res = await svc.submitGeneration("soul-2", { ...(await import("@/lib/models/soul-2")).soul2.defaults, prompt: "portrait", custom_reference_id: training.referenceId }, []);
    expect(res).toMatchObject({ ok: false, status: 422 });
  });

  it("removes a character from the local list only, the spending stays", async () => {
    const first = chars.listCharacters().find((c) => c.name === "Léa")!;
    const spent = monthCommittedEur();
    expect(await chars.removeCharacter(first.id)).toBe("ok");
    expect(chars.listCharacters().some((c) => c.id === first.id)).toBe(false);
    expect(fs.existsSync(path.join(dir, "characters", first.id))).toBe(false);
    expect(monthCommittedEur()).toBeCloseTo(spent, 4);
    expect(await chars.removeCharacter(first.id)).toBe("missing");
  });
});
