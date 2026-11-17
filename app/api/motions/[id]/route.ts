import { errorMessage, fail, json } from "@/lib/server/http";
import { removeMotion } from "@/lib/server/motions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return (await removeMotion(id)) ? json({ ok: true }) : fail("Mouvement introuvable.", 404);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
