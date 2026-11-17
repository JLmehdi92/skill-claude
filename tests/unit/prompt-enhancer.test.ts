import { describe, expect, it } from "vitest";
import { enhancePrompt, previewEnhancedPrompt } from "@/lib/prompt-enhancer";
import { getPreset } from "@/lib/presets/registry";
import { PRESETS } from "@/lib/presets/registry";
import type { Preset } from "@/lib/presets/types";

describe("enhancePrompt", () => {
  it("returns the prompt unchanged when no options are set", () => {
    expect(enhancePrompt("a cat walking")).toBe("a cat walking");
  });

  it("adds cinematic details when enhance is true", () => {
    const result = enhancePrompt("a cat walking", { enhance: true });
    expect(result).toContain("a cat walking");
    expect(result).toContain("cinematic lighting");
  });

  it("skips cinematic details when prompt already has cinematic hints", () => {
    const result = enhancePrompt("a cinematic shot of a cat", { enhance: true });
    expect(result).toBe("a cinematic shot of a cat");
  });

  it("appends preset suffixes", () => {
    const preset = getPreset("push-in")!;
    const result = enhancePrompt("a cat walking", { presets: [preset] });
    expect(result).toContain("push-in");
  });

  it("combines enhancer and multiple presets", () => {
    const presets = [getPreset("push-in")!, getPreset("cinematic")!];
    const result = enhancePrompt("a cat walking", { presets, enhance: true });
    expect(result).toContain("push-in");
    expect(result).toContain("anamorphic");
    expect(result).toContain("cinematic lighting");
  });

  it("does nothing on empty prompt even with enhance", () => {
    expect(enhancePrompt("", { enhance: true })).toBe("");
    expect(enhancePrompt("  ", { enhance: true })).toBe("");
  });
});

describe("presets registry", () => {
  it("has presets in all four categories", () => {
    const categories = new Set(PRESETS.map((p) => p.category));
    expect(categories).toContain("camera");
    expect(categories).toContain("style");
    expect(categories).toContain("motion");
    expect(categories).toContain("effect");
  });

  it("every preset has a unique id", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every preset has a promptSuffix", () => {
    for (const p of PRESETS) {
      expect(p.promptSuffix, `${p.id} missing promptSuffix`).toBeTruthy();
    }
  });

  it("getPreset returns undefined for unknown id", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });
});

describe("previewEnhancedPrompt", () => {
  it("matches enhancePrompt output", () => {
    const presets = [getPreset("anime")!];
    const result = previewEnhancedPrompt("test", presets, true);
    const expected = enhancePrompt("test", { presets, enhance: true });
    expect(result).toBe(expected);
  });
});
