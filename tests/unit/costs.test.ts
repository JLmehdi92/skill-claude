import { describe, expect, it } from "vitest";
import { creditsToEur, creditsToUsd, formatEur } from "@/lib/costs";

describe("costs", () => {
  it("prices a credit at $0.005", () => {
    expect(creditsToUsd(8)).toBe(0.04);
    expect(creditsToUsd(320)).toBe(1.6);
  });

  it("converts to euros with the frozen rate", () => {
    expect(creditsToEur(80, 0.9)).toBe(0.36);
  });

  it("keeps a third decimal for small amounts", () => {
    expect(formatEur(0.036).replace(/\s/g, " ")).toBe("0,036 €");
    expect(formatEur(12.4).replace(/\s/g, " ")).toBe("12,40 €");
  });
});
