import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { creditsToEur, creditsToUsd } from "@/lib/costs";
import { kie, KieError } from "@/lib/kie";
import { getModel, validateRequest, type FileMeta } from "@/lib/models/registry";
import type { Category, MediaKind, Params } from "@/lib/models/types";
import type { Generation, InputFile, OutputFile, Status } from "@/lib/types";
import { db, getSetting, type GenerationRow } from "./db";
import { makeThumbnail, probeDuration } from "./ffmpeg";
import { getUsdEurRate } from "./rates";
import { absolute, categoryFromExt, extFromUrl, mediaUrl, removeDir, safeName, writeFile } from "./storage";
import { monthCommittedEur } from "./stats";

export interface IncomingFile {
  slot: string;
  name: string;
  mime: string;
  data: Buffer;
  /** Duration measured by the browser, used when ffprobe is not installed. */
  clientDuration?: number;
}

interface StoredInput {
  slot: string;
  name: string;
  kind: MediaKind;
  mime: string;
  path: string;
  duration?: number;
}

interface StoredOutput {
  path: string;
  kind: Category;
}

export interface SubmitOptions {
  confirmOverBudget?: boolean;
  /** Draw a fresh random seed even if the params carry one (used by "Variante"). */
  newSeed?: boolean;
}

/** Largest seed accepted by the models (int32). */
const MAX_SEED = 2_147_483_647;

/**
 * kie.ai does not report the seed it picks when none is sent, so a great result could never be
 * reproduced. We always choose the seed ourselves and remember whether it was automatic.
 */
function resolveSeed(model: NonNullable<ReturnType<typeof getModel>>, rawParams: unknown, newSeed: boolean) {
  const raw = { ...(rawParams as Record<string, unknown>) };
  if (!model.fields.some((f) => f.type === "seed")) return { raw, seedAuto: undefined };
  if (newSeed || raw.seed === null || raw.seed === undefined) {
    raw.seed = randomInt(0, MAX_SEED + 1);
    return { raw, seedAuto: true };
  }
  return { raw, seedAuto: raw.seed_auto === true };
}

export type SubmitResult =
  | { ok: true; generation: Generation }
  | { ok: false; status: 404 | 422; errors: string[] }
  | { ok: false; status: 409; budget: { monthlyBudgetEur: number; spentEur: number; estimateEur: number } };

const globalState = globalThis as unknown as { __hfInflight?: Set<string>; __hfRefreshing?: Set<string> };
/** Generations whose upload/createTask is running in this process. */
const inflight = (globalState.__hfInflight ??= new Set());
const refreshing = (globalState.__hfRefreshing ??= new Set());

export async function submitGeneration(
  modelId: string,
  rawParams: unknown,
  files: IncomingFile[],
  opts: SubmitOptions = {},
): Promise<SubmitResult> {
  const model = getModel(modelId);
  if (!model) return { ok: false, status: 404, errors: [`Modèle inconnu : ${modelId}.`] };
  const { raw, seedAuto } = resolveSeed(model, rawParams, opts.newSeed === true);

  const id = randomUUID();
  const inputs = await storeInputs(id, model.mediaSlots, files);
  const metas: FileMeta[] = inputs.map((i, n) => ({ slot: i.slot, size: files[n].data.length, duration: i.duration, mime: i.mime, name: i.name }));

  const check = validateRequest(model, raw, metas);
  if (!check.ok) {
    await removeDir(path.join("inputs", id));
    return { ok: false, status: 422, errors: check.errors };
  }

  const estimate = model.estimate(check.params, check.media);
  const { rate } = await getUsdEurRate();
  const estimateEur = creditsToEur(estimate.credits, rate);

  const budget = Number(getSetting("monthly_budget_eur"));
  if (budget > 0 && !opts.confirmOverBudget) {
    const spentEur = monthCommittedEur();
    if (spentEur + estimateEur > budget) {
      await removeDir(path.join("inputs", id));
      return { ok: false, status: 409, budget: { monthlyBudgetEur: budget, spentEur, estimateEur } };
    }
  }

  db()
    .prepare(
      `INSERT INTO generations (id, model, model_label, category, status, prompt, params_json, inputs_json,
        estimated_credits, usd_eur_rate, created_at)
       VALUES (?, ?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      model.id,
      model.label,
      model.category,
      check.params.prompt,
      JSON.stringify(seedAuto === undefined ? check.params : { ...check.params, seed_auto: seedAuto }),
      JSON.stringify(inputs),
      estimate.credits,
      rate,
      Date.now(),
    );

  inflight.add(id);
  void startTask(id).finally(() => inflight.delete(id));
  return { ok: true, generation: getGeneration(id)! };
}

/** Re-runs a generation with the same parameters and the locally stored reference files. */
export async function retryGeneration(id: string, opts: SubmitOptions = {}): Promise<SubmitResult> {
  const row = getRow(id);
  if (!row) return { ok: false, status: 404, errors: ["Génération introuvable."] };
  const inputs = JSON.parse(row.inputs_json) as StoredInput[];
  const files: IncomingFile[] = await Promise.all(
    inputs.map(async (i) => ({ slot: i.slot, name: i.name, mime: i.mime, data: await fs.readFile(absolute(i.path)), clientDuration: i.duration })),
  );
  return submitGeneration(row.model, JSON.parse(row.params_json), files, opts);
}

async function storeInputs(id: string, slots: { key: string; kind: MediaKind }[], files: IncomingFile[]): Promise<StoredInput[]> {
  return Promise.all(
    files.map(async (f, n) => {
      const kind = slots.find((s) => s.key === f.slot)?.kind ?? "document";
      const rel = await writeFile(path.join("inputs", id, `${n}-${safeName(f.name)}`), f.data);
      let duration: number | undefined;
      if (kind === "video" || kind === "audio") {
        duration = (await probeDuration(absolute(rel))) ?? f.clientDuration;
      }
      return { slot: f.slot, name: f.name, kind, mime: f.mime || "application/octet-stream", path: rel, duration };
    }),
  );
}

async function startTask(id: string): Promise<void> {
  const row = getRow(id);
  if (!row) return;
  const model = getModel(row.model)!;
  try {
    const client = kie();
    const inputs = JSON.parse(row.inputs_json) as StoredInput[];
    const urls: Record<string, string[]> = {};
    for (const input of inputs) {
      const data = await fs.readFile(absolute(input.path));
      const url = await client.uploadFile(data, path.basename(input.path), input.mime, `higgsfield-local/${id}`);
      (urls[input.slot] ??= []).push(url);
    }
    const kieInput = model.buildInput(JSON.parse(row.params_json) as Params, urls);
    const taskId = await client.createTask(model.kieModel, kieInput);
    db()
      .prepare("UPDATE generations SET kie_task_id = ?, kie_input_json = ?, status = 'queued' WHERE id = ?")
      .run(taskId, JSON.stringify(kieInput), id);
  } catch (err) {
    // Nothing reached kie's generation queue: nothing was billed.
    markFailed(id, err instanceof Error ? err.message : String(err), 0);
  }
}

/** Polls kie for one pending generation and stores the result locally once ready. */
export async function refreshGeneration(id: string): Promise<void> {
  if (refreshing.has(id)) return;
  const row = getRow(id);
  if (!row || !row.kie_task_id || (row.status !== "queued" && row.status !== "generating")) return;
  refreshing.add(id);
  try {
    const task = await kie().getTask(row.kie_task_id);
    if (task.state === "waiting" || task.state === "queuing") {
      setStatus(id, "queued", null);
    } else if (task.state === "generating") {
      setStatus(id, "generating", task.progress ?? null);
    } else if (task.state === "fail") {
      markFailed(id, task.failMsg ?? "La génération a échoué.", task.creditsConsumed ?? 0);
    } else if (task.state === "success") {
      await completeGeneration(row, task.resultUrls, task.creditsConsumed);
    }
  } catch (err) {
    if (err instanceof KieError && err.code === 404) markFailed(id, err.message, 0);
    else db().prepare("UPDATE generations SET error = ? WHERE id = ?").run(`Suivi en pause : ${(err as Error).message}`, id);
  } finally {
    refreshing.delete(id);
  }
}

async function completeGeneration(row: GenerationRow, resultUrls: string[], creditsConsumed: number | undefined): Promise<void> {
  if (!resultUrls.length) {
    markFailed(row.id, "kie.ai n'a renvoyé aucun fichier.", creditsConsumed ?? row.estimated_credits);
    return;
  }
  const credits = creditsConsumed ?? row.estimated_credits;
  if (row.deleted_at) {
    // Deleted while generating: record what it cost, skip the download.
    db()
      .prepare("UPDATE generations SET status = 'success', result_urls_json = ?, credits = ?, cost_usd = ?, cost_eur = ?, completed_at = ? WHERE id = ?")
      .run(JSON.stringify(resultUrls), credits, creditsToUsd(credits), creditsToEur(credits, row.usd_eur_rate), Date.now(), row.id);
    return;
  }
  const client = kie();
  const outputs: StoredOutput[] = [];
  for (const [n, url] of resultUrls.entries()) {
    const ext = url.startsWith("mock://") ? path.extname(url) : extFromUrl(url, row.category === "image" ? ".png" : ".mp4");
    const data = await client.download(url);
    const rel = await writeFile(path.join("outputs", row.id, `${n}${ext}`), data);
    outputs.push({ path: rel, kind: categoryFromExt(ext) });
  }

  let thumb: string | null = null;
  const firstVideo = outputs.find((o) => o.kind === "video");
  if (firstVideo) {
    const rel = path.join("outputs", row.id, "thumb.jpg");
    if (await makeThumbnail(absolute(firstVideo.path), absolute(rel))) thumb = rel;
  } else if (outputs[0]?.kind === "image") {
    thumb = outputs[0].path;
  }

  db()
    .prepare(
      `UPDATE generations SET status = 'success', result_urls_json = ?, outputs_json = ?, thumb_path = ?, credits = ?,
        cost_usd = ?, cost_eur = ?, error = NULL, progress = 100, completed_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(resultUrls), JSON.stringify(outputs), thumb, credits, creditsToUsd(credits), creditsToEur(credits, row.usd_eur_rate), Date.now(), row.id);
}

function setStatus(id: string, status: Status, progress: number | null) {
  db().prepare("UPDATE generations SET status = ?, progress = ?, error = NULL WHERE id = ?").run(status, progress, id);
}

function markFailed(id: string, message: string, credits: number) {
  const row = getRow(id);
  const rate = row?.usd_eur_rate ?? 0;
  db()
    .prepare("UPDATE generations SET status = 'failed', error = ?, credits = ?, cost_usd = ?, cost_eur = ?, completed_at = ? WHERE id = ?")
    .run(message, credits, creditsToUsd(credits), creditsToEur(credits, rate), Date.now(), id);
}

/** Called on a timer by the server: advances every pending generation, even with no browser open. */
export async function pollPending(): Promise<void> {
  const rows = db().prepare("SELECT id, status FROM generations WHERE status IN ('uploading', 'queued', 'generating')").all() as Pick<GenerationRow, "id" | "status">[];
  for (const row of rows) {
    if (row.status === "uploading") {
      // The upload promise lives in memory: if it is not running, the server restarted mid-upload.
      if (!inflight.has(row.id)) markFailed(row.id, "Envoi interrompu par un redémarrage du serveur. Relance la génération.", 0);
      continue;
    }
    await refreshGeneration(row.id);
  }
}

/** Brings a task created elsewhere (kie playground, another tool) into the local history. */
export async function importTask(taskId: string): Promise<Generation> {
  const existing = db().prepare("SELECT id FROM generations WHERE kie_task_id = ?").get(taskId) as { id: string } | undefined;
  if (existing) {
    db().prepare("UPDATE generations SET deleted_at = NULL WHERE id = ?").run(existing.id);
    return getGeneration(existing.id)!;
  }

  const task = await kie().getTask(taskId);
  const modelName = task.param?.model ?? task.model ?? "inconnu";
  const model = getModel(modelName);
  const input = task.param?.input ?? {};
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const category: Category = model?.category ?? (task.resultUrls[0] ? categoryFromExt(extFromUrl(task.resultUrls[0], ".mp4")) : "video");
  const { rate } = await getUsdEurRate();
  const id = randomUUID();
  const params = { ...(model?.defaults ?? {}), ...input, prompt };
  // kie does not always report creditsConsumed: fall back to our own price estimate.
  const estimated = task.creditsConsumed ?? (model ? safeEstimate(model, params) : 0);

  db()
    .prepare(
      `INSERT INTO generations (id, model, model_label, category, kie_task_id, status, prompt, params_json, kie_input_json,
        estimated_credits, usd_eur_rate, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, model?.id ?? modelName, model?.label ?? modelName, category, taskId, prompt, JSON.stringify(params), JSON.stringify(input), estimated, rate, task.createTime ?? Date.now());
  await refreshGeneration(id);
  return getGeneration(id)!;
}

function safeEstimate(model: NonNullable<ReturnType<typeof getModel>>, params: Params): number {
  try {
    return model.estimate(params, {}).credits;
  } catch {
    return 0;
  }
}

export function getRow(id: string): GenerationRow | undefined {
  return db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as GenerationRow | undefined;
}

export function getGeneration(id: string): Generation | null {
  const row = getRow(id);
  return row ? toDto(row) : null;
}

export interface ListFilters {
  q?: string;
  model?: string;
  category?: string;
  status?: "success" | "failed" | "pending";
  favorite?: boolean;
  from?: number;
  to?: number;
  ids?: string[];
  before?: number;
  limit?: number;
}

export function listGenerations(f: ListFilters = {}): { items: Generation[]; nextCursor: number | null } {
  const where: string[] = ["deleted_at IS NULL"];
  const args: (string | number)[] = [];
  if (f.q) {
    where.push("prompt LIKE ? ESCAPE '\\'");
    args.push(`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  if (f.model) where.push("model = ?"), args.push(f.model);
  if (f.category) where.push("category = ?"), args.push(f.category);
  if (f.status === "pending") where.push("status IN ('uploading', 'queued', 'generating')");
  else if (f.status) where.push("status = ?"), args.push(f.status);
  if (f.favorite) where.push("favorite = 1");
  if (f.from) where.push("created_at >= ?"), args.push(f.from);
  if (f.to) where.push("created_at < ?"), args.push(f.to);
  if (f.before) where.push("created_at < ?"), args.push(f.before);
  if (f.ids?.length) where.push(`id IN (${f.ids.map(() => "?").join(",")})`), args.push(...f.ids);
  const limit = Math.min(Math.max(f.limit ?? 40, 1), 200);
  const sql = `SELECT * FROM generations WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`;
  const rows = db().prepare(sql).all(...args, limit + 1) as unknown as GenerationRow[];
  const page = rows.slice(0, limit);
  return { items: page.map(toDto), nextCursor: rows.length > limit ? page[page.length - 1].created_at : null };
}

export function setFavorite(id: string, favorite: boolean): Generation | null {
  db().prepare("UPDATE generations SET favorite = ? WHERE id = ?").run(favorite ? 1 : 0, id);
  return getGeneration(id);
}

/**
 * Removes the generation from the history and erases its files, but keeps the
 * row (flagged deleted) so the money it cost stays in the spending tracker.
 */
export async function deleteGeneration(id: string): Promise<boolean> {
  const res = db().prepare("UPDATE generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(Date.now(), id);
  await Promise.all([removeDir(path.join("inputs", id)), removeDir(path.join("outputs", id))]);
  return res.changes > 0;
}

export function toDto(row: GenerationRow): Generation {
  const inputs = JSON.parse(row.inputs_json || "[]") as StoredInput[];
  const outputs = row.outputs_json ? (JSON.parse(row.outputs_json) as StoredOutput[]) : [];
  return {
    id: row.id,
    model: row.model,
    modelLabel: row.model_label,
    category: row.category as Category,
    status: row.status,
    prompt: row.prompt,
    params: JSON.parse(row.params_json) as Params,
    inputs: inputs.map(
      (i): InputFile => ({ slot: i.slot, name: i.name, kind: i.kind, mime: i.mime, url: mediaUrl(i.path)!, duration: i.duration }),
    ),
    outputs: outputs.map((o): OutputFile => ({ url: mediaUrl(o.path)!, kind: o.kind })),
    thumbUrl: mediaUrl(row.thumb_path),
    estimatedCredits: row.estimated_credits,
    estimatedEur: creditsToEur(row.estimated_credits, row.usd_eur_rate),
    credits: row.credits,
    costUsd: row.cost_usd,
    costEur: row.cost_eur,
    usdEurRate: row.usd_eur_rate,
    error: row.error,
    progress: row.progress,
    favorite: row.favorite === 1,
    kieTaskId: row.kie_task_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
