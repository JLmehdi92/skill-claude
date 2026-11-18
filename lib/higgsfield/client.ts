import "server-only";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { KieError, type KieClient, type KieTask } from "@/lib/kie/types";

// Source: https://docs.higgsfield.ai/docs/llms.txt (requests, file uploads, errors) and Higgsfield's integration brief.
const run = promisify(execFile);

const MESSAGES: Record<number, string> = {
  400: "Higgsfield a refusé les paramètres.",
  401: "Clé API Higgsfield invalide ou absente. Colle la clé de open.higgsfield.ai dans HF_API_KEY (.env.local), telle quelle.",
  403: "Solde Higgsfield insuffisant. Recharge ton compte sur open.higgsfield.ai.",
  404: "Requête introuvable chez Higgsfield.",
  422: "Higgsfield a refusé les paramètres.",
  423: "Ce modèle est temporairement bloqué chez Higgsfield.",
  429: "Trop de requêtes vers Higgsfield (ou trop de personnages en entraînement). Réessaie dans un instant.",
  500: "Erreur serveur chez Higgsfield.",
  503: "Ce modèle n'est pas disponible chez Higgsfield pour l'instant.",
};

/** Same shape as KieError so the generation service handles both providers alike. */
export class HiggsfieldError extends KieError {
  constructor(code: number, detail?: string) {
    super(code);
    const base = MESSAGES[code] ?? `Erreur Higgsfield (${code}).`;
    this.message = detail ? `${base} ${detail}` : base;
  }

  get retryable(): boolean {
    return [429, 500, 503].includes(this.code);
  }
}

interface StatusResponse {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
  request_id: string;
  error?: string | null;
  images?: { url: string }[];
  video?: { url: string };
}

/** Higgsfield storage takes video/mp4 only: an iPhone .mov is remuxed (no re-encode) with ffmpeg. */
async function toMp4(data: Buffer): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-mov-"));
  try {
    await fs.writeFile(path.join(dir, "in.mov"), data);
    await run("ffmpeg", ["-y", "-v", "error", "-i", path.join(dir, "in.mov"), "-c", "copy", "-movflags", "+faststart", path.join(dir, "out.mp4")], { timeout: 120_000 });
    return await fs.readFile(path.join(dir, "out.mp4"));
  } catch {
    throw new Error("Vidéo MOV impossible à convertir en MP4 pour Higgsfield (ffmpeg absent ?). Exporte-la en MP4.");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export type CharacterState = "training" | "ready" | "failed";

export interface CharacterClient {
  /** Starts a Soul ID training (Soul 2 family) from public image URLs. Returns the reference id. */
  createCharacter(name: string, imageUrls: string[]): Promise<string>;
  getCharacter(referenceId: string): Promise<{ state: CharacterState; thumbnailUrl?: string; failReason?: string }>;
}

/** apiKey: the complete copied credential, sent as "Key <apiKey>" without splitting it. */
export function realHiggsfieldClient(apiKey: string, API: string): KieClient & CharacterClient {
  async function call<T>(url: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    if (!apiKey) throw new HiggsfieldError(401);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Key ${apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      if (attempt < 3) return retry();
      throw new Error(`Higgsfield injoignable : ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as (T & { detail?: unknown }) | null;
    if (res.ok && body) return body;
    const detail = typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? JSON.stringify(body.detail).slice(0, 300) : undefined;
    const error = new HiggsfieldError(res.status, detail);
    if (error.retryable && attempt < 3) return retry();
    throw error;

    async function retry(): Promise<T> {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return call<T>(url, init, attempt + 1);
    }
  }

  return {
    async createTask(endpoint, input) {
      // Same key on retries inside call(): an ambiguous timeout cannot create a second paid request.
      const data = await call<{ request_id: string }>(`${API}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify(input),
      });
      return data.request_id;
    },

    async getTask(requestId) {
      const d = await call<StatusResponse>(`${API}/requests/${encodeURIComponent(requestId)}/status`);
      const urls = [...(d.images ?? []).map((i) => i.url), ...(d.video ? [d.video.url] : [])];
      const base = { taskId: requestId, resultUrls: urls };
      const state: Record<StatusResponse["status"], KieTask["state"]> = {
        queued: "queuing",
        in_progress: "generating",
        completed: "success",
        failed: "fail",
        nsfw: "fail",
        canceled: "fail",
      };
      const failMsg =
        d.status === "nsfw" ? "Refusé par la modération de Higgsfield." : d.status === "canceled" ? "Annulée chez Higgsfield." : (d.error ?? "La génération a échoué chez Higgsfield.");
      // Failed, moderated and canceled requests are not charged (docs: errors and retries).
      return d.status === "failed" || d.status === "nsfw" || d.status === "canceled" ? { ...base, state: "fail", failMsg, creditsConsumed: 0 } : { ...base, state: state[d.status] };
    },

    async uploadFile(data, _fileName, mimeType) {
      const mov = mimeType === "video/quicktime";
      const body = mov ? await toMp4(data) : data;
      const contentType = mov ? "video/mp4" : mimeType;
      const up = await call<{ public_url: string; upload_url: string; upload_headers: Record<string, string> }>(`${API}/files/generate-upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: contentType }),
      });
      // The presigned URL gets its own headers only, never our credentials.
      const put = await fetch(up.upload_url, { method: "PUT", headers: up.upload_headers, body: new Uint8Array(body), signal: AbortSignal.timeout(300_000) });
      if (!put.ok) throw new Error(`Envoi du fichier vers Higgsfield impossible (${put.status}).`);
      return up.public_url;
    },

    async cancelTask(requestId) {
      if (!apiKey) throw new HiggsfieldError(401);
      // 202 when canceled, 400 once processing started (docs: requests and lifecycle).
      const res = await fetch(`${API}/requests/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST",
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 202 || res.ok) return true;
      if (res.status === 400) return false;
      const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
      throw new HiggsfieldError(res.status, typeof body?.detail === "string" ? body.detail : undefined);
    },

    async getCredits() {
      throw new Error("Le solde Higgsfield se consulte sur open.higgsfield.ai.");
    },

    // Source: https://docs.higgsfield.ai/docs/models/soul-id/create-character
    async createCharacter(name, imageUrls) {
      const data = await call<{ id: string }>(`${API}/v1/custom-references`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ name, model_version: "v2", input_images: imageUrls.map((image_url) => ({ type: "image_url", image_url })) }),
      });
      return data.id;
    },

    async getCharacter(referenceId) {
      const d = await call<{ status: string; thumbnail_url?: string | null; fail_reason?: string | null }>(`${API}/v1/custom-references/${encodeURIComponent(referenceId)}`);
      const state: CharacterState = d.status === "completed" ? "ready" : d.status === "failed" ? "failed" : "training";
      return { state, thumbnailUrl: d.thumbnail_url ?? undefined, failReason: d.fail_reason ?? undefined };
    },

    async download(url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`Téléchargement Higgsfield impossible (${res.status}).`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
