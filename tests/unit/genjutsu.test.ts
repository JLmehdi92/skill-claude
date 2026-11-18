import { describe, expect, it } from "vitest";
import { kling30MotionControl as motion } from "@/lib/models/kling-3-0-motion-control";
import { getModel, summarizeMedia, validateRequest, type FileMeta } from "@/lib/models/registry";
import type { ModelDefinition } from "@/lib/models/types";
import { nanoBanana21 as banana } from "@/lib/models/nano-banana-2-1";
import { genjutsuMotion, genjutsuSwap } from "@/lib/models/genjutsu";
import { gptImage25, gptImage26 } from "@/lib/models/gpt-image";
import { seedance25Edit as edit } from "@/lib/models/seedance-2-5-edit";
import { soul2 } from "@/lib/models/soul-2";
import { wan22AnimateReplace as replace } from "@/lib/models/wan-2-2-animate-replace";

const file = (slot: string, over: Partial<FileMeta> = {}): FileMeta => ({ slot, size: 1000, ...over });
const errorsOf = (model: ModelDefinition, over: Record<string, unknown>, files: FileMeta[] = []) => {
  const r = validateRequest(model, { ...model.defaults, ...over }, files);
  return r.ok ? [] : r.errors;
};

describe("Genjutsu : copier un mouvement (Kling 3.0 Motion Control)", () => {
  it("is registered and runs on Higgsfield, std for 720p and pro for 1080p", () => {
    expect(getModel("kling-3-0-motion-control")).toBe(motion);
    expect(motion.provider).toBe("higgsfield");
    expect(motion.endpoint?.({ ...motion.defaults }, {})).toBe("kling-video/v3/motion-control/std");
    expect(motion.endpoint?.({ ...motion.defaults, resolution: "1080p" }, {})).toBe("kling-video/v3/motion-control/pro");
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
    // 0.092 $/s (720p) and 0.1189 $/s (1080p), 1 credit = 0.005 $.
    expect(motion.estimate({ ...motion.defaults }, media)).toEqual({ credits: 184, upperBound: false });
    expect(motion.estimate({ ...motion.defaults, resolution: "1080p" }, media)).toEqual({ credits: 237.8, upperBound: false });
    expect(motion.estimate({ ...motion.defaults }, {})).toEqual({ credits: 0, upperBound: false, perSecond: 18.4 });
    // Billed on the duration rounded to the nearest second.
    expect(motion.estimate({ ...motion.defaults }, summarizeMedia([file("motion_video", { duration: 4.4 })])).credits).toBe(73.6);
  });

  it("builds the Higgsfield input with single URLs, the sound option and no empty prompt", () => {
    const urls = { character: ["https://x/i.png"], motion_video: ["https://x/v.mp4"] };
    expect(motion.buildInput({ ...motion.defaults }, urls)).toEqual({
      image_url: "https://x/i.png",
      video_url: "https://x/v.mp4",
      character_orientation: "video",
      keep_original_sound: "yes",
    });
    expect(motion.buildInput({ ...motion.defaults, keep_sound: false }, urls).keep_original_sound).toBe("no");
    // Generations made before the sound option still validate.
    expect(errorsOf(motion, { keep_sound: undefined }, [file("character"), file("motion_video", { duration: 5 })])).toEqual([]);
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

describe("Genjutsu officiel (API Higgsfield)", () => {
  it("transfers motion with 1 to 8 character images and a video of 4 s or more", () => {
    expect(genjutsuMotion.provider).toBe("higgsfield");
    expect(genjutsuMotion.kieModel).toBe("higgsfield/genjutsu/motion-transfer/v1.0");
    const images = Array.from({ length: 8 }, () => file("character"));
    expect(errorsOf(genjutsuMotion, {}, [...images, file("motion_video", { duration: 6 })])).toEqual([]);
    expect(errorsOf(genjutsuMotion, {}, [...images, file("character"), file("motion_video", { duration: 6 })]).join(" ")).toMatch(/8 fichier/);
    expect(errorsOf(genjutsuMotion, {}, [file("character"), file("motion_video", { duration: 3 })])).toEqual(["La vidéo doit durer au moins 4 s."]);
  });

  it("bills the source length rounded up, trimmed to 30 s", () => {
    const at = (duration: number, resolution = "720p") => genjutsuSwap.estimate({ ...genjutsuSwap.defaults, resolution }, summarizeMedia([file("source_video", { duration })])).credits;
    expect(at(4.2)).toBe(344.6); // 5 s x 0.3446 $
    expect(at(45, "480p")).toBe(924); // 30 s x 0.154 $
    expect(at(10, "1080p")).toBe(1669.2);
  });

  it("sends the video, the ordered images and the prompt only when written", () => {
    const urls = { character: ["https://x/a.png", "https://x/b.png"], source_video: ["https://x/v.mp4"] };
    expect(genjutsuSwap.buildInput({ ...genjutsuSwap.defaults }, urls)).toEqual({ video_url: "https://x/v.mp4", image_urls: urls.character, resolution: "720p" });
    expect(genjutsuSwap.buildInput({ ...genjutsuSwap.defaults, prompt: "Garde la robe" }, urls).prompt).toBe("Garde la robe");
  });
});

describe("Modifier une vidéo (Seedance 2.5 video-edit via Higgsfield)", () => {
  it("needs a prompt and a video of 2 to 30 s, references are optional", () => {
    expect(errorsOf(edit, {}, [file("source_video", { duration: 6 })])).toEqual(["Écris un prompt."]);
    expect(errorsOf(edit, { prompt: "Sous la neige" }, [file("source_video", { duration: 6 })])).toEqual([]);
    expect(errorsOf(edit, { prompt: "Sous la neige" }, [file("source_video", { duration: 31 })])).toEqual(["La vidéo à modifier doit durer entre 2 et 30 s."]);
  });

  it("bills output seconds only, 4 s at least", () => {
    const at = (duration: number) => edit.estimate({ ...edit.defaults, prompt: "x" }, summarizeMedia([file("source_video", { duration })])).credits;
    expect(at(10)).toBe(652.8); // 10 s x 0.3264 $
    expect(at(2)).toBe(261.12); // normalized to 4 s
  });

  it("sends image references only when there are some", () => {
    const input = edit.buildInput({ ...edit.defaults, prompt: "Sous la neige" }, { source_video: ["https://x/v.mp4"] });
    expect(input).toEqual({ prompt: "Sous la neige", video_url: "https://x/v.mp4", resolution: "720p", generate_audio: true });
  });
});

describe("Images", () => {
  it("Soul 2 runs on Higgsfield at 0.0032 $ (720p) or 0.0057 $ (1080p)", () => {
    expect(soul2.provider).toBe("higgsfield");
    expect(soul2.estimate({ ...soul2.defaults, prompt: "x", resolution: "720p" }, {}).credits).toBe(0.64);
    expect(soul2.estimate({ ...soul2.defaults, prompt: "x" }, {}).credits).toBe(1.14);
    expect(soul2.buildInput({ ...soul2.defaults, prompt: "Portrait" }, {})).toEqual({ prompt: "Portrait", resolution: "1080p", aspect_ratio: "3:4", enhance_prompt: true, batch_size: 1 });
  });

  it("GPT Image switches to image-to-image when references are attached", () => {
    const withRefs = summarizeMedia([file("reference_image")]);
    expect(gptImage25.endpoint?.({ ...gptImage25.defaults }, {})).toBe("gpt-image-2-5-flare-text-to-image");
    expect(gptImage25.endpoint?.({ ...gptImage25.defaults }, withRefs)).toBe("gpt-image-2-5-flare-image-to-image");
    expect(gptImage26.endpoint?.({ ...gptImage26.defaults }, withRefs)).toBe("gpt-image-2-6/economy-image-to-image");
    expect(gptImage25.estimate({ ...gptImage25.defaults, prompt: "x", resolution: "4K" }, {}).credits).toBe(16);
    expect(gptImage26.estimate({ ...gptImage26.defaults, prompt: "x" }, {}).credits).toBe(5);
    expect(gptImage25.buildInput({ ...gptImage25.defaults, prompt: "x" }, { reference_image: ["https://x/r.png"] }).input_urls).toEqual(["https://x/r.png"]);
    expect(gptImage26.buildInput({ ...gptImage26.defaults, prompt: "x" }, {})).not.toHaveProperty("input_urls");
  });
});

describe("Nano Banana 2.1", () => {
  it("prices per image by resolution and sends references", () => {
    expect(getModel("nano-banana-2-1")).toBe(banana);
    expect(banana.estimate({ ...banana.defaults, prompt: "x" }, {}).credits).toBe(4);
    expect(banana.estimate({ ...banana.defaults, prompt: "x", resolution: "4K" }, {}).credits).toBe(9);
    expect(errorsOf(banana, {})).toEqual(["Écris un prompt."]);
    expect(banana.buildInput({ ...banana.defaults, prompt: "un chat" }, { reference_image: ["https://x/r.png"] })).toEqual({
      prompt: "un chat",
      image_input: ["https://x/r.png"],
      aspect_ratio: "auto",
      resolution: "1K",
      output_format: "png",
    });
  });
});
