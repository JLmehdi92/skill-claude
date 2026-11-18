import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { creditsToEur, creditsToUsd, usdToCredits } from "@/lib/costs";
import { characterClient } from "@/lib/kie";
import type { Character } from "@/lib/types";
import { config } from "./config";
import { db, getSetting } from "./db";
import { getUsdEurRate } from "./rates";
import { mediaUrl, removeDir, safeName, writeFile } from "./storage";
import { monthCommittedEur } from "./stats";

// Source: https://docs.higgsfield.ai/docs/models/soul-id/create-character, price on open.higgsfield.ai (2.50 $ / request).
export const SOUL_ID_CREDITS = usdToCredits(2.5);
const MAX_IMAGES = 100;
const MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
// Names being trained right now: the uniqueness check comes before slow uploads, two sends must not both pass.
const inFlight = new Set<string>();
const nameKey = (name: string) => name.toLocaleLowerCase("fr");

interface CharacterRow {
  id: string;
  name: string;
  hf_reference_id: string;
  status: Character["status"];
  thumb_path: string | null;
  fail_reason: string | null;
  ledger_id: string;
  created_at: number;
}

export interface TrainingFile {
  name: string;
  mime: string;
  data: Buffer;
}

export type TrainResult =
  | { ok: true; character: Character }
  | { ok: false; status: 422 | 429; errors: string[] }
  | { ok: false; status: 409; budget: { monthlyBudgetEur: number; spentEur: number; estimateEur: number } };

const toCharacter = (r: CharacterRow): Character => ({
  id: r.id,
  name: r.name,
  referenceId: r.hf_reference_id,
  status: r.status,
  thumbUrl: mediaUrl(r.thumb_path),
  failReason: r.fail_reason,
  createdAt: r.created_at,
});

export function listCharacters(): Character[] {
  return (db().prepare("SELECT * FROM characters ORDER BY created_at DESC").all() as unknown as CharacterRow[]).map(toCharacter);
}

export async function trainCharacter(rawName: string, files: TrainingFile[], opts: { confirmOverBudget?: boolean } = {}): Promise<TrainResult> {
  const name = rawName.trim();
  const errors: string[] = [];
  // The name doubles as the @mention in prompts: same characters as a mention.
  if (!name) errors.push("Donne un nom au personnage.");
  else if (!/^[\p{L}\p{N}_-]{1,30}$/u.test(name)) errors.push("Nom de 30 caractères maximum : lettres, chiffres et tirets, sans espace.");
  // "@Image1" is a file mention: a character with that name could never be mentioned.
  else if (/^(image|video|audio)\d+$/i.test(name)) errors.push("Ce nom est réservé aux fichiers joints (@Image1…). Choisis-en un autre.");
  else if (inFlight.has(nameKey(name)) || listCharacters().some((c) => nameKey(c.name) === nameKey(name))) errors.push("Ce nom est déjà pris.");
  if (!files.length) errors.push("Ajoute au moins une photo.");
  if (files.length > MAX_IMAGES) errors.push("100 photos maximum.");
  if (files.some((f) => !IMAGE_TYPES.has(f.mime))) errors.push("Photos JPEG, PNG, WebP ou GIF uniquement.");
  if (files.some((f) => f.data.length > MAX_BYTES)) errors.push("20 Mo maximum par photo.");
  if (!config.mock && !config.hfApiKey) errors.push("Soul ID passe par l'API Higgsfield : colle ta clé de open.higgsfield.ai dans HF_API_KEY (.env.local), telle quelle.");
  if (errors.length) return { ok: false, status: 422, errors };

  const { rate } = await getUsdEurRate();
  const estimateEur = creditsToEur(SOUL_ID_CREDITS, rate);
  const budget = Number(getSetting("monthly_budget_eur"));
  if (budget > 0 && !opts.confirmOverBudget) {
    const spentEur = monthCommittedEur();
    if (spentEur + estimateEur > budget) return { ok: false, status: 409, budget: { monthlyBudgetEur: budget, spentEur, estimateEur } };
  }

  const key = nameKey(name);
  if (inFlight.has(key)) return { ok: false, status: 422, errors: ["Ce nom est déjà pris."] };
  inFlight.add(key);
  try {
    return await createAndRecord(name, files, rate, estimateEur);
  } finally {
    inFlight.delete(key);
  }
}

async function createAndRecord(name: string, files: TrainingFile[], rate: number, estimateEur: number): Promise<TrainResult> {
  const client = characterClient();
  const urls: string[] = [];
  for (const f of files) urls.push(await client.uploadFile(f.data, safeName(f.name), f.mime, "higgsfield-local/soul-id"));
  let referenceId: string;
  try {
    referenceId = await client.createCharacter(name, urls);
  } catch (err) {
    const code = (err as { code?: number }).code;
    return { ok: false, status: code === 429 ? 429 : 422, errors: [(err as Error).message] };
  }

  // Billed from here: record first, in one transaction, so a disk error on the thumbnail never hides the spend.
  const id = randomUUID();
  const now = Date.now();
  const ledgerId = randomUUID();
  db().exec("BEGIN");
  try {
    // The cost goes in the generations ledger (hidden from the gallery by deleted_at) so spending,
    // budget, stats and export count it without a second accounting path. Never deleted.
    db()
      .prepare(
        `INSERT INTO generations (id, model, model_label, category, status, prompt, params_json, inputs_json, estimated_credits,
          credits, cost_usd, cost_eur, usd_eur_rate, created_at, completed_at, deleted_at, provider)
         VALUES (?, 'soul-id', 'Soul ID (entraînement)', 'image', 'success', ?, '{}', '[]', ?, ?, ?, ?, ?, ?, ?, ?, 'higgsfield')`,
      )
      .run(ledgerId, name, SOUL_ID_CREDITS, SOUL_ID_CREDITS, creditsToUsd(SOUL_ID_CREDITS), estimateEur, rate, now, now, now);
    db()
      .prepare("INSERT INTO characters (id, name, hf_reference_id, status, thumb_path, fail_reason, ledger_id, created_at) VALUES (?, ?, ?, 'training', NULL, NULL, ?, ?)")
      .run(id, name, referenceId, ledgerId, now);
    db().exec("COMMIT");
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }
  try {
    const thumb = await writeFile(path.join("characters", id, `thumb-${safeName(files[0].name)}`), files[0].data);
    db().prepare("UPDATE characters SET thumb_path = ? WHERE id = ?").run(thumb, id);
  } catch (err) {
    console.error("[characters] vignette", (err as Error).message);
  }
  return { ok: true, character: toCharacter(db().prepare("SELECT * FROM characters WHERE id = ?").get(id) as unknown as CharacterRow) };
}

/** Called by the server poller: follows trainings until they are ready or failed. */
export async function pollCharacters(): Promise<void> {
  const rows = db().prepare("SELECT * FROM characters WHERE status = 'training'").all() as unknown as CharacterRow[];
  if (!rows.length) return;
  const client = characterClient();
  for (const row of rows) {
    try {
      const c = await client.getCharacter(row.hf_reference_id);
      if (c.state === "ready") db().prepare("UPDATE characters SET status = 'ready' WHERE id = ?").run(row.id);
      if (c.state === "failed") markFailed(row, c.failReason ?? "L'entraînement a échoué chez Higgsfield.");
    } catch (err) {
      // An unknown reference never becomes ready: stop following it instead of polling forever.
      if ((err as { code?: number }).code === 404) markFailed(row, "Personnage introuvable chez Higgsfield.");
      else console.error("[characters]", (err as Error).message);
    }
  }
}

function markFailed(row: CharacterRow, reason: string) {
  db().prepare("UPDATE characters SET status = 'failed', fail_reason = ? WHERE id = ?").run(reason, row.id);
  // Failed requests are not charged (Higgsfield docs, errors and retries); assumed for training too.
  db().prepare("UPDATE generations SET credits = 0, cost_usd = 0, cost_eur = 0 WHERE id = ?").run(row.ledger_id);
}

/** A character a Soul 2 generation may use: unknown ids pass (removed locally, still valid at Higgsfield). */
export function characterNotReady(referenceId: string): string | null {
  const row = db().prepare("SELECT status FROM characters WHERE hf_reference_id = ?").get(referenceId) as { status: Character["status"] } | undefined;
  if (row?.status === "training") return "Ce personnage est encore en entraînement.";
  if (row?.status === "failed") return "L'entraînement de ce personnage a échoué. Choisis-en un autre.";
  return null;
}

/**
 * Removes the character from the local list. Higgsfield documents no deletion route: the reference stays there.
 * Refused while training: the poller would lose it and could never refund a failed training.
 */
export async function removeCharacter(id: string): Promise<"ok" | "missing" | "training"> {
  const row = db().prepare("SELECT status FROM characters WHERE id = ?").get(id) as { status: Character["status"] } | undefined;
  if (!row) return "missing";
  if (row.status === "training") return "training";
  await removeDir(path.join("characters", id));
  db().prepare("DELETE FROM characters WHERE id = ?").run(id);
  return "ok";
}
