import { submitGeneration, type IncomingFile } from "@/lib/server/generations";
import { errorMessage, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

interface Meta {
  slot: string;
  duration?: number;
}

/**
 * multipart/form-data:
 *   model   model id
 *   params  JSON parameters
 *   meta    JSON array, one { slot, duration? } per `file` entry, same order
 *   file    attached files (repeated)
 *   confirmOverBudget  "1" to go past the monthly budget
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Requête invalide.", 400);
  }
  try {
    const params = JSON.parse(String(form.get("params") ?? "{}"));
    const meta = JSON.parse(String(form.get("meta") ?? "[]")) as Meta[];
    const blobs = form.getAll("file").filter((f): f is File => f instanceof File);
    if (blobs.length !== meta.length) return fail("Fichiers et métadonnées ne correspondent pas.", 400);

    const files: IncomingFile[] = await Promise.all(
      blobs.map(async (f, i) => ({
        slot: meta[i].slot,
        name: f.name || `fichier-${i + 1}`,
        mime: f.type,
        data: Buffer.from(await f.arrayBuffer()),
        clientDuration: typeof meta[i].duration === "number" ? meta[i].duration : undefined,
      })),
    );

    const result = await submitGeneration(String(form.get("model") ?? ""), params, files, {
      confirmOverBudget: form.get("confirmOverBudget") === "1",
    });
    if (result.ok) return json(result.generation, 201);
    if (result.status === 409) return json({ budget: result.budget }, 409);
    return json({ errors: result.errors }, result.status);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
