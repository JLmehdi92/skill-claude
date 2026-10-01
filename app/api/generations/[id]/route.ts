import { deleteGeneration, getGeneration, refreshGeneration, setFavorite } from "@/lib/server/generations";
import { fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await refreshGeneration(id);
  const gen = getGeneration(id);
  return gen ? json(gen) : fail("Génération introuvable.", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { favorite?: boolean } | null;
  if (typeof body?.favorite !== "boolean") return fail("Rien à modifier.", 422);
  const gen = setFavorite(id, body.favorite);
  return gen ? json(gen) : fail("Génération introuvable.", 404);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return (await deleteGeneration(id)) ? json({ ok: true }) : fail("Génération introuvable.", 404);
}
