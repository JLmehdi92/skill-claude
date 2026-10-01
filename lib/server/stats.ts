import "server-only";
import { creditsToEur } from "@/lib/costs";
import type { SpendBucket, Stats } from "@/lib/types";
import { db, getSetting } from "./db";
import { getUsdEurRate } from "./rates";

interface CostRow {
  model: string;
  model_label: string;
  category: string;
  status: string;
  cost_eur: number | null;
  estimated_credits: number;
  usd_eur_rate: number;
  created_at: number;
}

const CATEGORY_LABELS: Record<string, string> = { video: "Vidéo", image: "Image", audio: "Audio" };

export function startOfDay(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function startOfWeek(d = new Date()): number {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

export function startOfMonth(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const isPending = (s: string) => s === "uploading" || s === "queued" || s === "generating";
/** Money actually spent: finished generations with a recorded cost (failed ones are 0 unless kie billed them). */
const spent = (r: CostRow) => (isPending(r.status) ? 0 : (r.cost_eur ?? 0));

/** Spent this month plus what pending generations are expected to cost. Used for the budget guard. */
export function monthCommittedEur(now = new Date()): number {
  const rows = db().prepare("SELECT * FROM generations WHERE created_at >= ?").all(startOfMonth(now)) as unknown as CostRow[];
  return round(rows.reduce((acc, r) => acc + (isPending(r.status) ? creditsToEur(r.estimated_credits, r.usd_eur_rate) : spent(r)), 0));
}

export function computeStats(rows: CostRow[], now = new Date(), days = 30): Omit<Stats, "monthlyBudgetEur" | "usdEurRate" | "rateSource"> {
  const t0 = startOfDay(now);
  const w0 = startOfWeek(now);
  const m0 = startOfMonth(now);
  const sumSince = (since: number) => round(rows.filter((r) => r.created_at >= since).reduce((a, r) => a + spent(r), 0));

  const pending = rows.filter((r) => isPending(r.status));
  const bucket = (keyOf: (r: CostRow) => string, labelOf: (r: CostRow) => string): SpendBucket[] => {
    const map = new Map<string, SpendBucket>();
    for (const r of rows) {
      if (isPending(r.status)) continue;
      const key = keyOf(r);
      const b = map.get(key) ?? { key, label: labelOf(r), eur: 0, count: 0 };
      b.eur += spent(r);
      b.count += 1;
      map.set(key, b);
    }
    return [...map.values()].map((b) => ({ ...b, eur: round(b.eur) })).sort((a, b) => b.eur - a.eur);
  };

  const daily: Stats["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime());
    daily.push({ date, eur: 0, count: 0 });
  }
  const byDate = new Map(daily.map((d) => [d.date, d]));
  for (const r of rows) {
    const d = byDate.get(localDate(r.created_at));
    if (d && !isPending(r.status)) {
      d.eur = round(d.eur + spent(r));
      d.count += 1;
    }
  }

  return {
    today: sumSince(t0),
    week: sumSince(w0),
    month: sumSince(m0),
    total: sumSince(0),
    pendingEur: round(pending.reduce((a, r) => a + creditsToEur(r.estimated_credits, r.usd_eur_rate), 0)),
    pendingCount: pending.length,
    successCount: rows.filter((r) => r.status === "success").length,
    failedCount: rows.filter((r) => r.status === "failed").length,
    byModel: bucket((r) => r.model, (r) => r.model_label),
    byCategory: bucket((r) => r.category, (r) => CATEGORY_LABELS[r.category] ?? r.category),
    daily,
  };
}

export async function getStats(): Promise<Stats> {
  const rows = db().prepare("SELECT model, model_label, category, status, cost_eur, estimated_credits, usd_eur_rate, created_at FROM generations").all() as unknown as CostRow[];
  const { rate, source } = await getUsdEurRate();
  const budget = Number(getSetting("monthly_budget_eur"));
  return { ...computeStats(rows), monthlyBudgetEur: budget > 0 ? budget : null, usdEurRate: rate, rateSource: source };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
