import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-cancel-"));
process.env.STORAGE_DIR = dir;
process.env.KIE_MOCK = "1";
// Long mock queue: the request stays cancelable during the test.
process.env.KIE_MOCK_SECONDS = "60";
process.env.KIE_OFFLINE_RATE = "1";
process.env.USD_EUR_RATE = "0.9";

const svc = await import("@/lib/server/generations");
const { setSetting } = await import("@/lib/server/db");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("annulation", () => {
  it("cancels a queued generation at the provider, at no cost, and keeps it in history", async () => {
    setSetting("monthly_budget_eur", null);
    const res = await svc.submitGeneration("soul-2", { prompt: "Portrait", resolution: "720p", aspect_ratio: "1:1", enhance_prompt: false }, []);
    if (!res.ok) throw new Error("submit failed");
    for (let i = 0; i < 50 && svc.getGeneration(res.generation.id)!.status !== "queued"; i++) await sleep(20);

    // The task stays with the provider it was sent to, even if the model moves later.
    expect(svc.getRow(res.generation.id)!.provider).toBe("higgsfield");
    const cancel = await svc.cancelGeneration(res.generation.id);
    if (!cancel.ok) throw new Error(cancel.error);
    expect(cancel.generation).toMatchObject({ status: "failed", credits: 0 });
    expect(cancel.generation.error).toMatch(/Annulée/);

    expect(await svc.cancelGeneration(res.generation.id)).toMatchObject({ ok: false, status: 409 });
    expect(await svc.cancelGeneration("inconnue")).toMatchObject({ ok: false, status: 404 });
  });
});
