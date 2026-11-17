import { errorMessage, fail, json } from "@/lib/server/http";
import { addMotion, addMotionFromGeneration, listMotions, MAX_MOTION_BYTES } from "@/lib/server/motions";

export const dynamic = "force-dynamic";

export function GET() {
  return json(listMotions());
}

/** multipart/form-data { file, duration? } to upload, or JSON { generationId } to save a generation's video. */
export async function POST(req: Request) {
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { generationId?: unknown } | null;
      if (typeof body?.generationId !== "string") return fail("Génération manquante.", 422);
      const res = await addMotionFromGeneration(body.generationId);
      return res.ok ? json(res.motion, 201) : fail(res.error, 422);
    }
    if (Number(req.headers.get("content-length")) > MAX_MOTION_BYTES + 1024 * 1024) return fail("Vidéo de 100 Mo maximum.", 413);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail("Vidéo manquante.", 422);
    if (file.size > MAX_MOTION_BYTES) return fail("Vidéo de 100 Mo maximum.", 413);
    const duration = Number(form?.get("duration"));
    const res = await addMotion(file.name, Buffer.from(await file.arrayBuffer()), Number.isFinite(duration) && duration > 0 ? duration : undefined);
    return res.ok ? json(res.motion, 201) : fail(res.error, 422);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
