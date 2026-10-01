import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-local-"));
process.env.STORAGE_DIR = dir;
process.env.KIE_MOCK = "1";
process.env.KIE_MOCK_SECONDS = "0.05";
process.env.KIE_OFFLINE_RATE = "1";
process.env.USD_EUR_RATE = "0.9";

const svc = await import("@/lib/server/generations");
const { setSetting } = await import("@/lib/server/db");
const { getStats } = await import("@/lib/server/stats");
const { wan30Video } = await import("@/lib/models/wan-3-0-video");

const params = (over: Record<string, unknown> = {}) => ({ ...wan30Video.defaults, prompt: "Une vague au ralenti", resolution: "480P", duration: 5, ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitDone(id: string) {
  for (let i = 0; i < 100; i++) {
    await svc.pollPending();
    const g = svc.getGeneration(id)!;
    if (g.status === "success" || g.status === "failed") return g;
    await sleep(30);
  }
  throw new Error("timeout");
}

beforeAll(() => setSetting("monthly_budget_eur", null));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("generation service (mock kie)", () => {
  it("runs a generation end to end and stores the video locally", async () => {
    const png = fs.readFileSync(path.join(process.cwd(), "app/icon.svg"));
    const res = await svc.submitGeneration("wan-3-0-video", params(), [{ slot: "reference_image", name: "ref.png", mime: "image/png", data: png }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const done = await waitDone(res.generation.id);
    expect(done.status).toBe("success");
    expect(done.outputs[0].url).toMatch(/^\/api\/media\/outputs\//);
    expect(fs.existsSync(path.join(dir, done.outputs[0].url.replace("/api/media/", "")))).toBe(true);
    expect(done.inputs).toHaveLength(1);
    // 480P, 5 s: 40 credits = 0.20 $ = 0.18 €
    expect(done.credits).toBe(40);
    expect(done.costEur).toBe(0.18);
    const row = svc.getRow(done.id)!;
    expect(JSON.parse(row.kie_input_json!).nsfw_checker).toBe(false);
  });

  it("always picks, stores and sends a seed, and keeps or redraws it on retry", async () => {
    const res = await svc.submitGeneration("wan-3-0-video", params({ seed: null }), []);
    if (!res.ok) throw new Error("submit failed");
    const seed = res.generation.params.seed as number;
    expect(Number.isInteger(seed)).toBe(true);
    expect(res.generation.params.seed_auto).toBe(true);
    await waitDone(res.generation.id);
    expect(JSON.parse(svc.getRow(res.generation.id)!.kie_input_json!).seed).toBe(seed);

    const same = await svc.retryGeneration(res.generation.id);
    if (!same.ok) throw new Error("retry failed");
    expect(same.generation.params.seed).toBe(seed);
    expect(same.generation.params.seed_auto).toBe(true);

    const variant = await svc.retryGeneration(res.generation.id, { newSeed: true });
    if (!variant.ok) throw new Error("variant failed");
    expect(variant.generation.params.seed).not.toBe(seed);
    await Promise.all([waitDone(same.generation.id), waitDone(variant.generation.id)]);
  });

  it("keeps a seed chosen by the user and marks it as manual", async () => {
    const res = await svc.submitGeneration("wan-3-0-video", params({ seed: 42 }), []);
    if (!res.ok) throw new Error("submit failed");
    expect(res.generation.params.seed).toBe(42);
    expect(res.generation.params.seed_auto).toBe(false);
    await waitDone(res.generation.id);
  });

  it("records failures at zero cost", async () => {
    const res = await svc.submitGeneration("wan-3-0-video", params({ prompt: "boom [fail]" }), []);
    if (!res.ok) throw new Error("submit failed");
    const done = await waitDone(res.generation.id);
    expect(done.status).toBe("failed");
    expect(done.costEur).toBe(0);
  });

  it("rejects invalid requests without storing them", async () => {
    const before = svc.listGenerations().items.length;
    const res = await svc.submitGeneration("wan-3-0-video", params({ prompt: "" }), []);
    expect(res.ok).toBe(false);
    expect(svc.listGenerations().items.length).toBe(before);
  });

  it("asks for confirmation past the monthly budget", async () => {
    setSetting("monthly_budget_eur", "0.2");
    const res = await svc.submitGeneration("wan-3-0-video", params(), []);
    expect(res.ok).toBe(false);
    if (!res.ok && res.status === 409) expect(res.budget.monthlyBudgetEur).toBe(0.2);
    else throw new Error("expected 409");
    const forced = await svc.submitGeneration("wan-3-0-video", params(), [], { confirmOverBudget: true });
    expect(forced.ok).toBe(true);
    if (forced.ok) await waitDone(forced.generation.id);
    setSetting("monthly_budget_eur", null);
  });

  it("keeps the cost in spending after deleting a generation", async () => {
    const before = (await getStats()).total;
    const first = svc.listGenerations({ status: "success" }).items[0];
    await svc.deleteGeneration(first.id);
    expect(svc.listGenerations().items.some((g) => g.id === first.id)).toBe(false);
    expect((await getStats()).total).toBe(before);
  });

  it("imports a task by id", async () => {
    const { mockKieClient } = await import("@/lib/kie/mock");
    const taskId = await mockKieClient().createTask("wan/3-0-video", { prompt: "importée", resolution: "720P", duration: 5 });
    await sleep(80);
    const g = await svc.importTask(taskId);
    expect(g.model).toBe("wan-3-0-video");
    expect(g.prompt).toBe("importée");
    const done = svc.getGeneration(g.id)!;
    expect(done.status).toBe("success");
    expect(done.credits).toBe(80); // no creditsConsumed from kie: 720P x 5 s estimate
  });
});
