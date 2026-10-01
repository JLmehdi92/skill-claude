import { describe, expect, it } from "vitest";
import { computeStats } from "@/lib/server/stats";

const now = new Date(2026, 9, 15, 12); // Thursday 15 October 2026
const at = (y: number, m: number, d: number) => new Date(y, m, d, 10).getTime();
const row = (over: Partial<Parameters<typeof computeStats>[0][number]>) => ({
  model: "wan-3-0-video",
  model_label: "Wan 3.0",
  category: "video",
  status: "success",
  cost_eur: 1,
  estimated_credits: 100,
  usd_eur_rate: 0.9,
  created_at: at(2026, 9, 15),
  ...over,
});

describe("computeStats", () => {
  const rows = [
    row({ cost_eur: 1.5 }), // today
    row({ cost_eur: 2, created_at: at(2026, 9, 12) }), // Monday, this week
    row({ cost_eur: 3, created_at: at(2026, 9, 2) }), // this month
    row({ cost_eur: 4, created_at: at(2026, 8, 20), category: "image", model: "img", model_label: "Image X" }), // last month
    row({ status: "failed", cost_eur: 0 }),
    row({ status: "generating", cost_eur: null, estimated_credits: 200 }),
  ];
  const s = computeStats(rows, now);

  it("sums spending per period", () => {
    expect(s.today).toBe(1.5);
    expect(s.week).toBe(3.5);
    expect(s.month).toBe(6.5);
    expect(s.total).toBe(10.5);
  });

  it("keeps pending generations out of spending and estimates them apart", () => {
    expect(s.pendingCount).toBe(1);
    expect(s.pendingEur).toBe(0.9); // 200 credits * 0.005 $ * 0.9
  });

  it("breaks down by model and category", () => {
    expect(s.byModel.map((b) => [b.label, b.eur])).toEqual([
      ["Wan 3.0", 6.5],
      ["Image X", 4],
    ]);
    expect(s.byCategory.find((b) => b.key === "image")?.label).toBe("Image");
  });

  it("returns 30 daily buckets ending today", () => {
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)).toMatchObject({ date: "2026-10-15", eur: 1.5 });
  });
});
