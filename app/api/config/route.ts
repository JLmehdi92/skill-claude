import { config } from "@/lib/server/config";
import { getSetting } from "@/lib/server/db";
import { json } from "@/lib/server/http";
import type { AppConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  const budget = Number(getSetting("monthly_budget_eur"));
  return json<AppConfig>({
    mock: config.mock,
    hasKey: config.mock || Boolean(config.kieApiKey),
    nsfwCheckerDefault: config.nsfwCheckerDefault,
    monthlyBudgetEur: budget > 0 ? budget : null,
  });
}
