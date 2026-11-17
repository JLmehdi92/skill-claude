import { describe, expect, it } from "vitest";
import { kling30MotionControl as motion } from "@/lib/models/kling-3-0-motion-control";
import { getModel, summarizeMedia, validateRequest, type FileMeta } from "@/lib/models/registry";
import type { ModelDefinition } from "@/lib/models/types";
import { wan22AnimateReplace as replace } from "@/lib/models/wan-2-2-animate-replace";

const file = (slot: string, over: Partial<FileMeta> = {}): FileMeta => ({ slot, size: 1000, ...over });
const errorsOf = (model: ModelDefinition, over: Record<string, unknown>, files: FileMeta[] = []) => {
  const r = validateRequest(model, { ...model.defaults, ...over }, files);
  return r.ok ? [] : r.errors;
};

describe("Genjutsu : copier un mouvement (Kling 3.0 Motion Control)", () => {
  it("is registered", () => {
    expect(getModel("kling-3-0-motion-control")).toBe(motion);
    expect(getModel("kling-3.0/motion-control")).toBe(motion);
  });

  it("needs a character image and a motion video, the prompt is optional", () => {
    expect(errorsOf(motion, {})).toEqual(["Ajoute une image du personnage.", "Ajoute la vidéo de mouvement."]);
    expect(errorsOf(motion, {}, [file("character"), file("motion_video", { duration: 8 })])).toEqual([]);
  });

  it("keeps the motion video between 3 and 30 s, 10 s when following the image", () => {
    const withVideo = (duration: number) => [file("character"), file("motion_video", { duration })];
    expect(errorsOf(motion, {}, withVideo(2))).toEqual(["La vidéo de mouvement doit durer entre 3 et 30 s."]);
    expect(errorsOf(motion, {}, withVideo(31))).toEqual(["La vidéo de mouvement doit durer entre 3 et 30 s."]);
    expect(errorsOf(motion, { character_orientation: "image" }, withVideo(12))).toEqual(["Avec « suit l'image », la vidéo doit durer 10 s max."]);
    expect(errorsOf(motion, { character_orientation: "image" }, withVideo(10))).toEqual([]);
  });

  it("refuses a video in the image slot", () => {
    expect(errorsOf(motion, {}, [file("character", { mime: "video/mp4", name: "a.mp4" }), file("motion_video", { duration: 5 })]).join(" ")).toMatch(
      /Image du personnage : « a.mp4 » n'est pas du bon type/,
    );
  });

  it("prices per second of the motion video, per second only before it is known", () => {
    const media = summarizeMedia([file("character"), file("motion_video", { duration: 10 })]);
    expect(motion.estimate({ ...motion.defaults }, media)).toEqual({ credits: 227, upperBound: false });
    expect(motion.estimate({ ...motion.defaults, resolution: "1080p" }, media)).toEqual({ credits: 302, upperBound: false });
    expect(motion.estimate({ ...motion.defaults }, {})).toEqual({ credits: 0, upperBound: false, perSecond: 22.7 });
  });

  it("builds the kie input with mode as the resolution and no empty prompt", () => {
    const urls = { character: ["https://x/i.png"], motion_video: ["https://x/v.mp4"] };
    expect(motion.buildInput({ ...motion.defaults }, urls)).toEqual({
      input_urls: ["https://x/i.png"],
      video_urls: ["https://x/v.mp4"],
      mode: "720p",
      character_orientation: "video",
    });
    expect(motion.buildInput({ ...motion.defaults, prompt: "Sur une plage" }, urls).prompt).toBe("Sur une plage");
  });
});

describe("Genjutsu : remplacer un personnage (Wan 2.2 Animate Replace)", () => {
  it("is registered and takes no prompt", () => {
    expect(getModel("wan/2-2-animate-replace")).toBe(replace);
    expect(errorsOf(replace, { prompt: "texte" }, [file("character"), file("source_video", { duration: 4 })])).not.toEqual([]);
  });

  it("needs a character image and a video of 10 MB at most", () => {
    expect(errorsOf(replace, {})).toEqual(["Ajoute une image du personnage.", "Ajoute la vidéo à transformer."]);
    expect(errorsOf(replace, {}, [file("character"), file("source_video", { duration: 4 })])).toEqual([]);
    expect(errorsOf(replace, {}, [file("character"), file("source_video", { size: 11 * 1024 * 1024 })]).join(" ")).toMatch(/10 Mo maximum/);
  });

  it("prices per second of the source video at each resolution", () => {
    const media = summarizeMedia([file("character"), file("source_video", { duration: 4 })]);
    expect(replace.estimate({ ...replace.defaults }, media).credits).toBe(24);
    expect(replace.estimate({ ...replace.defaults, resolution: "580p" }, media).credits).toBe(38);
    expect(replace.estimate({ ...replace.defaults, resolution: "720p" }, media).credits).toBe(50);
    expect(replace.estimate({ ...replace.defaults }, {}).perSecond).toBe(6);
  });

  it("builds the kie input with single URLs and an explicit NSFW setting", () => {
    expect(replace.buildInput({ ...replace.defaults }, { character: ["https://x/i.png"], source_video: ["https://x/v.mp4"] })).toEqual({
      video_url: "https://x/v.mp4",
      image_url: "https://x/i.png",
      resolution: "480p",
      nsfw_checker: false,
    });
  });
});
