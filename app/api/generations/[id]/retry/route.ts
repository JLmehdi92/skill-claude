import { retryGeneration } from "@/lib/server/generations";
import { errorMessage, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { confirmOverBudget?: boolean; newSeed?: boolean };
  try {
    const result = await retryGeneration(id, { confirmOverBudget: body.confirmOverBudget === true, newSeed: body.newSeed === true });
    if (result.ok) return json(result.generation, 201);
    if (result.status === 409) return json({ budget: result.budget }, 409);
    return json({ errors: result.errors }, result.status);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
