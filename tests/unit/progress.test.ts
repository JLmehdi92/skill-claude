import { describe, expect, it } from "vitest";
import { formatProgress, progressOf, queueLabel } from "@/lib/progress";
import type { Generation } from "@/lib/types";

const T0 = 1_700_000_000_000;
const gen = (over: Partial<Generation> = {}) =>
  ({ status: "generating", progress: null, provider: "kie", startedAt: T0, typicalMs: 120_000, createdAt: T0 - 30_000, category: "video", ...over }) as Generation;

describe("progress", () => {
  it("estimates from the time since work started and the model's usual length", () => {
    expect(progressOf(gen(), T0 + 60_000)).toEqual({ value: 50, estimated: true });
    expect(formatProgress(progressOf(gen(), T0 + 60_000)!)).toBe("≈ 50 %");
  });

  it("never claims to be done, and starts above zero", () => {
    expect(progressOf(gen(), T0 + 10 * 60_000)?.value).toBe(95);
    expect(progressOf(gen(), T0)?.value).toBe(1);
  });

  it("prefers the API's own value", () => {
    expect(progressOf(gen({ progress: 42 }), T0 + 60_000)).toEqual({ value: 42, estimated: false });
    expect(formatProgress({ value: 42, estimated: false })).toBe("42 %");
    // A reported 0 means unknown: the estimate takes over.
    expect(progressOf(gen({ progress: 0 }), T0 + 60_000)).toEqual({ value: 50, estimated: true });
  });

  it("falls back to the creation time for rows started before the column existed, and shows nothing while queued", () => {
    expect(progressOf(gen({ startedAt: null }), T0 + 30_000)?.value).toBe(50);
    expect(progressOf(gen({ status: "queued" }), T0 + 60_000)).toBeNull();
  });

  it("says where it waits and for how long", () => {
    expect(queueLabel(gen({ status: "queued", createdAt: T0 }), T0 + 30_000)).toBe("En file chez kie.ai");
    expect(queueLabel(gen({ status: "queued", createdAt: T0, provider: "higgsfield" }), T0 + 6.5 * 60_000)).toBe("En file chez Higgsfield\u00a0·\u00a06\u00a0min");
  });
});
