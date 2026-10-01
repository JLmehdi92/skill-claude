import "server-only";
import { KieError, type KieClient, type KieTask } from "./types";

const API = "https://api.kie.ai";
const UPLOAD = "https://kieai.redpandaai.co";

interface Envelope<T> {
  code: number;
  msg?: string;
  data: T;
}

export function realKieClient(apiKey: string): KieClient {
  async function call<T>(url: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    if (!apiKey) throw new KieError(401);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      if (attempt < 3) return retry();
      throw new Error(`kie.ai injoignable : ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    const code = body?.code ?? res.status;
    if (code === 200 && body) return body.data;
    const error = new KieError(code, body?.msg);
    if (error.retryable && attempt < 3) return retry();
    throw error;

    async function retry(): Promise<T> {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return call<T>(url, init, attempt + 1);
    }
  }

  return {
    async createTask(model, input) {
      const data = await call<{ taskId: string }>(`${API}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input }),
      });
      return data.taskId;
    },

    async getTask(taskId) {
      const d = await call<{
        taskId: string;
        model?: string;
        state: KieTask["state"];
        param?: string;
        resultJson?: string;
        failMsg?: string;
        progress?: number;
        creditsConsumed?: number;
        createTime?: number;
        completeTime?: number;
      }>(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
      return {
        taskId: d.taskId,
        model: d.model,
        state: d.state,
        resultUrls: parseJson<{ resultUrls?: string[] }>(d.resultJson)?.resultUrls ?? [],
        failMsg: d.failMsg || undefined,
        progress: d.progress,
        creditsConsumed: typeof d.creditsConsumed === "number" ? d.creditsConsumed : undefined,
        param: parseJson(d.param) ?? undefined,
        createTime: d.createTime,
        completeTime: d.completeTime,
      };
    },

    async uploadFile(data, fileName, mimeType, uploadPath) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), fileName);
      form.append("uploadPath", uploadPath);
      form.append("fileName", fileName);
      const d = await call<{ downloadUrl?: string; fileUrl?: string }>(`${UPLOAD}/api/file-stream-upload`, { method: "POST", body: form });
      const url = d.downloadUrl ?? d.fileUrl;
      if (!url) throw new Error("kie.ai n'a pas renvoyé l'URL du fichier envoyé.");
      return url;
    },

    async getCredits() {
      return call<number>(`${API}/api/v1/chat/credit`);
    },

    async download(url) {
      let res = await fetch(url, { signal: AbortSignal.timeout(300_000) }).catch(() => null);
      if (!res?.ok) {
        // Some kie result URLs must be exchanged for a signed download link first.
        const signed = await call<string>(`${API}/api/v1/common/download-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        res = await fetch(signed, { signal: AbortSignal.timeout(300_000) });
      }
      if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}).`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

function parseJson<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
