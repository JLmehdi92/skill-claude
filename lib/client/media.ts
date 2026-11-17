import type { MediaKind } from "@/lib/models/types";

/**
 * Reads a video/audio duration in the browser. iOS Safari may never fire loadedmetadata for a
 * detached element, so this gives up after a few seconds (the server measures again with ffprobe).
 */
export function measureDuration(file: File, kind: MediaKind): Promise<number | undefined> {
  if (kind !== "video" && kind !== "audio") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (v?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(undefined), 5000);
    el.preload = "metadata";
    el.muted = true;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
    el.load();
  });
}
