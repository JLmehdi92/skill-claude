import { describe, expect, it } from "vitest";
import { validateRequest, type FileMeta } from "@/lib/models/registry";
import { wan30Video as wan } from "@/lib/models/wan-3-0-video";

const params = (over: Record<string, unknown> = {}) => ({ ...wan.defaults, prompt: "Un chat sur un toit", ...over });
const file = (slot: string, duration?: number): FileMeta => ({ slot, size: 1000, duration });
const errorsOf = (p: unknown, files: FileMeta[] = []) => {
  const r = validateRequest(wan, p, files);
  return r.ok ? [] : r.errors;
};

describe("Wan 3.0 validation", () => {
  it("accepts a plain text-to-video request", () => {
    expect(errorsOf(params())).toEqual([]);
  });

  it("requires a prompt", () => {
    expect(errorsOf(params({ prompt: "   " }))).toContain("Écris un prompt.");
  });

  it("rejects durations outside 2-30 s but allows auto (-1)", () => {
    expect(errorsOf(params({ duration: 1 }))).not.toEqual([]);
    expect(errorsOf(params({ duration: 31 }))).not.toEqual([]);
    expect(errorsOf(params({ duration: -1 }))).toEqual([]);
  });

  it("forbids mixing keyframes with reference images", () => {
    const errs = errorsOf(params(), [file("first_frame"), file("reference_image")]);
    expect(errs.join(" ")).toMatch(/images de début ou de fin/);
  });

  it("requires a first frame before a last frame", () => {
    expect(errorsOf(params(), [file("last_frame")]).join(" ")).toMatch(/image de début/);
  });

  it("forbids link and document together", () => {
    const errs = errorsOf(params({ reference_link_urls: ["https://example.com"] }), [file("reference_file")]);
    expect(errs).toContain("Choisis un lien web ou un document, pas les deux.");
  });

  it("caps reference videos at 15 s total and 30 s with the output", () => {
    expect(errorsOf(params({ duration: 5 }), [file("reference_video", 10), file("reference_video", 6)]).join(" ")).toMatch(/15 s au total/);
    expect(errorsOf(params({ duration: 20 }), [file("reference_video", 12)]).join(" ")).toMatch(/30 s maximum/);
    expect(errorsOf(params({ duration: 15 }), [file("reference_video", 12)])).toEqual([]);
  });

  it("enforces per-slot file counts", () => {
    const eleven = Array.from({ length: 11 }, () => file("reference_image"));
    expect(errorsOf(params(), eleven).join(" ")).toMatch(/10 fichier/);
  });
});

describe("Wan 3.0 pricing", () => {
  it("bills credits per second by resolution, input video included", () => {
    expect(wan.estimate(params({ resolution: "480P", duration: 5 }), {})).toEqual({ credits: 40, upperBound: false });
    expect(wan.estimate(params({ resolution: "1080P", duration: 10 }), {})).toEqual({ credits: 320, upperBound: false });
    expect(wan.estimate(params({ resolution: "720P", duration: 5 }), { reference_video: { count: 1, durations: [4] } }).credits).toBe(144);
  });

  it("uses the 30 s ceiling for auto duration", () => {
    expect(wan.estimate(params({ resolution: "720P", duration: -1 }), {})).toEqual({ credits: 480, upperBound: true });
  });
});

describe("Wan 3.0 kie payload", () => {
  it("always sends nsfw_checker, false by default", () => {
    const input = wan.buildInput(params(), {});
    expect(input).toHaveProperty("nsfw_checker", false);
  });

  it("omits an empty seed and maps files to kie fields", () => {
    const input = wan.buildInput(params({ seed: null }), {
      first_frame: ["https://f/1.png"],
      reference_video: ["https://f/a.mp4", "https://f/b.mp4"],
    });
    expect(input).not.toHaveProperty("seed");
    expect(input.first_frame_url).toBe("https://f/1.png");
    expect(input.reference_video_urls).toEqual(["https://f/a.mp4", "https://f/b.mp4"]);
    expect(input.model).toBeUndefined();
  });

  it("keeps a chosen seed", () => {
    expect(wan.buildInput(params({ seed: 42 }), {}).seed).toBe(42);
  });
});
