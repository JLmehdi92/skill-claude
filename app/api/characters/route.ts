import { listCharacters, trainCharacter, type TrainingFile } from "@/lib/server/characters";
import { errorMessage, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json(listCharacters());
}

/** multipart/form-data { name, file (repeated, 1 to 100 photos), confirmOverBudget? } */
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("Requête invalide.", 400);
    const blobs = form.getAll("file").filter((f): f is File => f instanceof File);
    const files: TrainingFile[] = await Promise.all(blobs.map(async (f, i) => ({ name: f.name || `photo-${i + 1}.jpg`, mime: f.type, data: Buffer.from(await f.arrayBuffer()) })));
    const result = await trainCharacter(String(form.get("name") ?? ""), files, { confirmOverBudget: form.get("confirmOverBudget") === "1" });
    if (result.ok) return json(result.character, 201);
    if (result.status === 409) return json({ budget: result.budget }, 409);
    return json({ errors: result.errors }, result.status);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
