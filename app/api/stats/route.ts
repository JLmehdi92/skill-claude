import { json } from "@/lib/server/http";
import { getStats } from "@/lib/server/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getStats());
}
