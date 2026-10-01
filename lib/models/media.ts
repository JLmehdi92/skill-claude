import type { MediaKind } from "./types";

const EXT: Record<string, MediaKind> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", bmp: "image", gif: "image",
  mp4: "video", mov: "video", m4v: "video", webm: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", flac: "audio",
};

/** Kind of a file from its MIME type, falling back to the extension (some browsers send no type). */
export function kindOfFile(mime: string | undefined, name: string): MediaKind {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT[ext] ?? "document";
}
