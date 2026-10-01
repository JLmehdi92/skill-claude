import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { KieClient, KieTask } from "./types";

/**
 * Stateless fake of the kie API (KIE_MOCK=1). The task id encodes its creation
 * time and outcome, so tasks keep progressing across server restarts.
 * A prompt containing "[fail]" produces a failed task.
 */
const SECONDS = Number(process.env.KIE_MOCK_SECONDS) || 6;

export function mockKieClient(): KieClient {
  return {
    async createTask(model, input) {
      const fail = String(input.prompt ?? "").includes("[fail]") ? "f" : "s";
      const params = Buffer.from(JSON.stringify({ model, input })).toString("base64url");
      return `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fail}_${params}`;
    },

    async getTask(taskId) {
      const [, ts, , outcome, params] = taskId.split("_");
      const started = Number(ts);
      if (!Number.isFinite(started)) throw new Error("Tâche mock inconnue.");
      const elapsed = (Date.now() - started) / 1000;
      const param = params ? (JSON.parse(Buffer.from(params, "base64url").toString()) as KieTask["param"]) : undefined;
      const base = { taskId, model: param?.model, param, createTime: started };
      if (elapsed < SECONDS * 0.25) return { ...base, state: "queuing", resultUrls: [] };
      if (elapsed < SECONDS) {
        return { ...base, state: "generating", resultUrls: [], progress: Math.round((elapsed / SECONDS) * 100) };
      }
      if (outcome === "f") return { ...base, state: "fail", resultUrls: [], failMsg: "Échec simulé (mode mock)." };
      return { ...base, state: "success", resultUrls: ["mock://sample.mp4"], completeTime: started + SECONDS * 1000 };
    },

    async uploadFile(_data, fileName) {
      return `https://mock.kie.local/uploads/${Date.now()}-${encodeURIComponent(fileName)}`;
    },

    async getCredits() {
      return 4820;
    },

    async download(url) {
      if (!url.startsWith("mock://")) throw new Error("URL mock invalide.");
      return fs.readFile(path.join(process.cwd(), "fixtures", url.slice("mock://".length)));
    },
  };
}
