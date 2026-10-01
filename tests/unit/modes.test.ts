import { describe, expect, it } from "vitest";
import { kindOfFile } from "@/lib/models/media";
import { inferMode, validateRequest, type FileMeta } from "@/lib/models/registry";
import { wan30Video as wan } from "@/lib/models/wan-3-0-video";

const params = (over: Record<string, unknown> = {}) => ({ ...wan.defaults, prompt: "Une scène", ...over });
const file = (slot: string, over: Partial<FileMeta> = {}): FileMeta => ({ slot, size: 1000, ...over });
const errorsOf = (p: unknown, files: FileMeta[] = []) => {
  const r = validateRequest(wan, p, files);
  return r.ok ? [] : r.errors;
};

describe("Wan 3.0 modes", () => {
  it("text mode accepts no file and no web link", () => {
    expect(errorsOf(params({ mode: "text" }))).toEqual([]);
    expect(errorsOf(params({ mode: "text" }), [file("reference_image")]).join(" ")).toMatch(/pas disponible en mode Texte/);
    expect(errorsOf(params({ mode: "text", reference_link_urls: ["https://example.com"] })).join(" ")).toMatch(/Page web de référence : pas disponible/);
  });

  it("reference mode takes references and refuses keyframes", () => {
    expect(errorsOf(params({ mode: "reference" }), [file("reference_image"), file("reference_audio", { duration: 5 })])).toEqual([]);
    expect(errorsOf(params({ mode: "reference", reference_link_urls: ["https://example.com"] }))).toEqual([]);
    expect(errorsOf(params({ mode: "reference" }), [file("first_frame")]).join(" ")).toMatch(/Image de début : pas disponible en mode Référence/);
  });

  it("keyframes mode needs a start image and refuses references", () => {
    expect(errorsOf(params({ mode: "keyframes" }))).toContain("Ajoute une image de début.");
    expect(errorsOf(params({ mode: "keyframes" }), [file("first_frame"), file("last_frame")])).toEqual([]);
    expect(errorsOf(params({ mode: "keyframes" }), [file("first_frame"), file("reference_video", { duration: 3 })]).join(" ")).toMatch(
      /Vidéos : pas disponible en mode Images clés/,
    );
  });

  it("rejects an unknown mode and keeps working without any mode (API callers)", () => {
    expect(errorsOf(params({ mode: "magic" }))).not.toEqual([]);
    expect(errorsOf(params(), [file("reference_image")])).toEqual([]);
  });

  it("checks that each file matches its slot type", () => {
    expect(errorsOf(params({ mode: "reference" }), [file("reference_image", { mime: "video/mp4", name: "clip.mp4" })]).join(" ")).toMatch(/pas du bon type/);
    expect(errorsOf(params({ mode: "reference" }), [file("reference_image", { mime: "", name: "photo.JPG" })])).toEqual([]);
    expect(errorsOf(params({ mode: "reference" }), [file("reference_file", { mime: "application/pdf", name: "brief.pdf" })])).toEqual([]);
  });

  it("infers the mode of older generations and imported tasks", () => {
    expect(inferMode(wan, params(), [])?.id).toBe("text");
    expect(inferMode(wan, params(), ["reference_image"])?.id).toBe("reference");
    expect(inferMode(wan, params(), ["first_frame", "last_frame"])?.id).toBe("keyframes");
    expect(inferMode(wan, params({ reference_link_urls: ["https://example.com"] }), [])?.id).toBe("reference");
    expect(inferMode(wan, params({ mode: "keyframes" }), [])?.id).toBe("keyframes");
  });
});

describe("kindOfFile", () => {
  it("uses the MIME type, then the extension", () => {
    expect(kindOfFile("image/png", "a.png")).toBe("image");
    expect(kindOfFile("", "voix.MP3")).toBe("audio");
    expect(kindOfFile(undefined, "clip.mov")).toBe("video");
    expect(kindOfFile("application/pdf", "brief.pdf")).toBe("document");
  });
});
