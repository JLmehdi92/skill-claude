import { z } from "zod";
import { setSetting } from "@/lib/server/db";
import { fail, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const body = z.object({ monthlyBudgetEur: z.number().min(0).max(1_000_000).nullable() });

export async function PUT(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Budget invalide.", 422);
  const v = parsed.data.monthlyBudgetEur;
  setSetting("monthly_budget_eur", v && v > 0 ? String(v) : null);
  return json({ monthlyBudgetEur: v && v > 0 ? v : null });
}
