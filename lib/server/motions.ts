import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Motion } from "@/lib/types";
import { db } from "./db";
import { makeThumbnail, probeDuration } from "./ffmpeg";
import { getRow } from "./generations";
import { absolute, mediaUrl, removeDir, safeName, writeFile } from "./storage";

// Same limits as the motion video slot of Kling 3.0 Motion Control.
const MIN_SECONDS = 3;
const MAX_SECONDS = 30;
export const MAX_MOTION_BYTES = 100 * 1024 * 1024;
const VIDEO = /\.(mp4|mov)$/i;

interface MotionRow {
  id: string;
  name: string;
  path: string;
  thumb_path: string | null;
  duration: number;
  created_at: number;
}

export type MotionResult = { ok: true; motion: Motion } | { ok: false; error: string };

const toMotion = (r: MotionRow): Motion => ({
  id: r.id,
  name: r.name,
  url: mediaUrl(r.path)!,
  thumbUrl: mediaUrl(r.thumb_path),
  duration: r.duration,
  createdAt: r.created_at,
});

export function listMotions(): Motion[] {
  return (db().prepare("SELECT * FROM motions ORDER BY created_at DESC").all() as unknown as MotionRow[]).map(toMotion);
}

/** clientDuration: what the browser measured, used only when ffprobe cannot read the file (as for generations). */
export async function addMotion(fileName: string, data: Buffer, clientDuration?: number): Promise<MotionResult> {
  if (!VIDEO.test(fileName)) return { ok: false, error: "Vidéo MP4 ou MOV uniquement." };
  if (data.length > MAX_MOTION_BYTES) return { ok: false, error: "Vidéo de 100 Mo maximum." };
  const id = randomUUID();
  const dir = path.join("motions", id);
  try {
    const rel = await writeFile(path.join(dir, safeName(fileName)), data);
    const duration = (await probeDuration(absolute(rel))) ?? clientDuration;
    if (duration === undefined || !Number.isFinite(duration)) {
      await removeDir(dir);
      return { ok: false, error: "Durée de la vidéo illisible. Réessaie avec un MP4." };
    }
    if (duration < MIN_SECONDS || duration > MAX_SECONDS + 0.05) {
      await removeDir(dir);
      return { ok: false, error: "Un mouvement doit durer entre 3 et 30 s." };
    }
    const thumbRel = path.join(dir, "thumb.jpg");
    const thumb = (await makeThumbnail(absolute(rel), absolute(thumbRel))) ? thumbRel : null;
    const row: MotionRow = { id, name: fileName.slice(0, 120), path: rel, thumb_path: thumb, duration, created_at: Date.now() };
    db()
      .prepare("INSERT INTO motions (id, name, path, thumb_path, duration, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.name, row.path, row.thumb_path, row.duration, row.created_at);
    return { ok: true, motion: toMotion(row) };
  } catch (err) {
    // No row without its file, no file without its row.
    await removeDir(dir).catch(() => {});
    throw err;
  }
}

/** Copies the video of a successful generation into the gallery. */
export async function addMotionFromGeneration(genId: string): Promise<MotionResult> {
  const gen = getRow(genId);
  const outputs = gen?.outputs_json ? (JSON.parse(gen.outputs_json) as { path: string; kind: string }[]) : [];
  const video = gen && !gen.deleted_at && gen.status === "success" ? outputs.find((o) => o.kind === "video") : undefined;
  if (!gen || !video) return { ok: false, error: "Aucune vidéo réussie à ajouter." };
  const data = await fs.readFile(absolute(video.path));
  const label = gen.prompt.trim() ? gen.prompt.trim().slice(0, 40) : gen.model_label;
  return addMotion(`${label}${path.extname(video.path) || ".mp4"}`, data);
}

export async function removeMotion(id: string): Promise<boolean> {
  if (!db().prepare("SELECT 1 FROM motions WHERE id = ?").get(id)) return false;
  // Files first: if that fails, the row stays and the motion can be removed again.
  await removeDir(path.join("motions", id));
  db().prepare("DELETE FROM motions WHERE id = ?").run(id);
  return true;
}
