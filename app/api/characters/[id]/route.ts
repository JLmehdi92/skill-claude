import { removeCharacter } from "@/lib/server/characters";
import { errorMessage, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await removeCharacter(id);
    if (result === "missing") return fail("Personnage introuvable.", 404);
    if (result === "training") return fail("Attends la fin de l'entraînement pour le retirer.", 409);
    return json({ ok: true });
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
