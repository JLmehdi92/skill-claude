import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { absolute } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

/** Serves files from the local storage dir, with Range support so videos can seek. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  let file: string;
  try {
    file = absolute(parts.map(decodeURIComponent).join("/"));
  } catch {
    return new Response("Interdit", { status: 403 });
  }
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) return new Response("Introuvable", { status: 404 });

  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${path.basename(file)}"`;

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
