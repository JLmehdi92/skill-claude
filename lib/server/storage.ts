import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

/** Paths stored in the DB are relative to the storage dir and served by /api/media. */
export function absolute(rel: string): string {
  const root = config.storageDir;
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Chemin hors du stockage.");
  return full;
}

export function mediaUrl(rel: string | null | undefined): string | null {
  return rel ? `/api/media/${rel.split(path.sep).join("/")}` : null;
}

export function safeName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return base.slice(-80) || "file";
}

export async function writeFile(rel: string, data: Buffer | Uint8Array): Promise<string> {
  const full = absolute(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return rel;
}

export async function removeDir(rel: string): Promise<void> {
  await fs.rm(absolute(rel), { recursive: true, force: true });
}

export function extFromUrl(url: string, fallback: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
  } catch {
    return fallback;
  }
}

export function categoryFromExt(ext: string): "video" | "image" | "audio" {
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(ext)) return "audio";
  return "video";
}
