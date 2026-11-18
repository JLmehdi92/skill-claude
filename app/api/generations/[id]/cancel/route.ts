import { cancelGeneration } from "@/lib/server/generations";
import { errorMessage, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await cancelGeneration(id);
    return result.ok ? json(result.generation) : fail(result.error, result.status);
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}
