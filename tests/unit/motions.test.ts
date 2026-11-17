import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-motions-"));
process.env.STORAGE_DIR = dir;
process.env.KIE_MOCK = "1";
process.env.KIE_MOCK_SECONDS = "0.05";
process.env.KIE_OFFLINE_RATE = "1";
process.env.USD_EUR_RATE = "0.9";

const motions = await import("@/lib/server/motions");
const svc = await import("@/lib/server/generations");
const { wan30Video } = await import("@/lib/models/wan-3-0-video");

const sample = fs.readFileSync(path.join(process.cwd(), "fixtures/sample.mp4"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("galerie de mouvements", () => {
  it("adds, lists and removes a motion with its files", async () => {
    const res = await motions.addMotion("danse.mp4", sample);
    if (!res.ok) throw new Error(res.error);
    expect(res.motion).toMatchObject({ name: "danse.mp4", duration: 4 });
    expect(res.motion.url).toMatch(/^\/api\/media\/motions\/.+\/danse\.mp4$/);
    expect(motions.listMotions().map((m) => m.id)).toContain(res.motion.id);

    expect(await motions.removeMotion(res.motion.id)).toBe(true);
    expect(motions.listMotions().map((m) => m.id)).not.toContain(res.motion.id);
    expect(fs.existsSync(path.join(dir, "motions", res.motion.id))).toBe(false);
    expect(await motions.removeMotion(res.motion.id)).toBe(false);
  });

  it("refuses unreadable, too short and non-video files without keeping them", async () => {
    expect(await motions.addMotion("geste.mp4", Buffer.from("pas une vidéo"))).toEqual({ ok: false, error: "Durée de la vidéo illisible. Réessaie avec un MP4." });
    expect(await motions.addMotion("geste.mp4", Buffer.from("pas une vidéo"), 2)).toEqual({ ok: false, error: "Un mouvement doit durer entre 3 et 30 s." });
    expect(await motions.addMotion("image.png", sample)).toEqual({ ok: false, error: "Vidéo MP4 ou MOV uniquement." });
    expect(fs.readdirSync(path.join(dir, "motions"))).toEqual([]);
  });

  it("saves the video of a successful generation", async () => {
    const sub = await svc.submitGeneration("wan-3-0-video", { ...wan30Video.defaults, prompt: "Une danse sur la plage", duration: 5 }, []);
    if (!sub.ok) throw new Error("submit failed");
    for (let i = 0; i < 100 && svc.getGeneration(sub.generation.id)!.status !== "success"; i++) {
      await svc.pollPending();
      await sleep(30);
    }
    const res = await motions.addMotionFromGeneration(sub.generation.id);
    if (!res.ok) throw new Error(res.error);
    expect(res.motion).toMatchObject({ name: "Une danse sur la plage.mp4", duration: 4 });
    expect(await motions.addMotionFromGeneration("inconnue")).toEqual({ ok: false, error: "Aucune vidéo réussie à ajouter." });
  });
});
