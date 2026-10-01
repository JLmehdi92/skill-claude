import type { NextRequest } from "next/server";
import { importTask, listGenerations, type ListFilters } from "@/lib/server/generations";
import { errorMessage, fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
  const status = q.get("status");
  const filters: ListFilters = {
    q: q.get("q")?.trim() || undefined,
    model: q.get("model") || undefined,
    category: q.get("category") || undefined,
    status: status === "success" || status === "failed" || status === "pending" ? status : undefined,
    favorite: q.get("favorite") === "1",
    from: num("from"),
    to: num("to"),
    before: num("before"),
    limit: num("limit"),
    ids: q.get("ids")?.split(",").filter(Boolean),
  };
  return json(listGenerations(filters));
}

/** Import an existing kie task into the local history: { taskId } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { taskId?: string } | null;
  const taskId = body?.taskId?.trim();
  if (!taskId) return fail("Indique un taskId kie.ai.", 422);
  try {
    return json(await importTask(taskId), 201);
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}
