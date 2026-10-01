import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Duration in seconds, or null when ffprobe is missing or the file is unreadable. */
export async function probeDuration(file: string): Promise<number | null> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeout: 15_000 });
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  } catch {
    return null;
  }
}

/** Writes a poster frame next to the video. Returns false when ffmpeg is unavailable. */
export async function makeThumbnail(video: string, out: string): Promise<boolean> {
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-ss", "0.3", "-i", video, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", out], { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}
