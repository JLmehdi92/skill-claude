import { z } from "zod";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://docs.kie.ai/market/kling/motion-control-v3 and https://kie.ai/kling-3-motion-control (prix)
const CREDITS_PER_SECOND = { "720p": 22.7, "1080p": 30.2 } as const;
const MAX_SECONDS = { video: 30, image: 10 } as const;
const MIN_SECONDS = 3;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  prompt: z.string().trim().max(2500, "Le prompt dépasse 2 500 caractères."),
  resolution: z.enum(["720p", "1080p"]),
  character_orientation: z.enum(["video", "image"]),
});

type MotionParams = z.infer<typeof paramsSchema>;

const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;
const duration = (media: MediaSummary) => media.motion_video?.durations[0];

export const kling30MotionControl: ModelDefinition = {
  id: "kling-3-0-motion-control",
  kieModel: "kling-3.0/motion-control",
  label: "Copier un mouvement",
  vendor: "Kling 3.0",
  group: "Genjutsu : transformer une vidéo",
  category: "video",
  description: "Ton personnage refait les gestes d'une vidéo de 3 à 30 s.",
  promptMaxLength: 2500,
  promptUse: "optional",
  placeholder: "Facultatif : décris le décor ou l'ambiance. Le mouvement vient de la vidéo.",
  tiles: true,
  fields: [
    {
      key: "resolution",
      label: "Résolution",
      type: "select",
      options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
      ],
    },
    {
      key: "character_orientation",
      label: "Orientation",
      type: "select",
      options: [
        { value: "video", label: "Suit la vidéo (30 s max)" },
        { value: "image", label: "Suit l'image (10 s max)" },
      ],
    },
  ],
  mediaSlots: [
    {
      key: "character",
      shortLabel: "Personnage",
      addLabel: "Ajouter le personnage",
      kieField: "input_urls",
      label: "Image du personnage",
      kind: "image",
      accept: "image/jpeg,image/png",
      max: 1,
      maxBytes: 10 * MB,
      array: true,
      hint: "Tête, épaules et buste bien visibles. Plus de 340 px.",
    },
    {
      key: "motion_video",
      shortLabel: "Mouvement",
      addLabel: "Ajouter la vidéo de mouvement, 3 à 30 s",
      kieField: "video_urls",
      label: "Vidéo de mouvement",
      kind: "video",
      accept: "video/mp4,video/quicktime",
      max: 1,
      maxBytes: 100 * MB,
      array: true,
      hint: "3 à 30 s, une personne cadrée tête, épaules et buste.",
    },
  ],
  defaults: {
    prompt: "",
    resolution: "720p",
    character_orientation: "video",
  } satisfies MotionParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate(raw, media) {
    const p = raw as unknown as MotionParams;
    const errors: string[] = [];
    // "Ajoute ..." messages wait for a submit attempt in the composer.
    if (count(media, "character") === 0) errors.push("Ajoute une image du personnage.");
    if (count(media, "motion_video") === 0) errors.push("Ajoute la vidéo de mouvement.");
    const d = duration(media);
    const max = MAX_SECONDS[p.character_orientation];
    if (d !== undefined && (d < MIN_SECONDS || d > MAX_SECONDS.video + 0.05)) {
      errors.push("La vidéo de mouvement doit durer entre 3 et 30 s.");
    } else if (d !== undefined && d > max + 0.05) {
      errors.push("Avec « suit l'image », la vidéo doit durer 10 s max.");
    }
    return errors;
  },

  estimate(raw, media) {
    const p = raw as unknown as MotionParams;
    const rate = CREDITS_PER_SECOND[p.resolution];
    const d = duration(media);
    // Billed per second of output, which follows the motion video.
    if (d === undefined) return { credits: 0, upperBound: false, perSecond: rate };
    return { credits: Math.ceil(rate * d), upperBound: false };
  },

  paramsFromKie(input) {
    // kie calls the resolution "mode"; ours is "resolution" ("mode" is the composer's UI mode).
    const { mode, ...rest } = input;
    return mode === undefined ? rest : { ...rest, resolution: mode };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as MotionParams;
    const input: Record<string, unknown> = {
      input_urls: urls.character ?? [],
      video_urls: urls.motion_video ?? [],
      mode: p.resolution,
      character_orientation: p.character_orientation,
    };
    if (p.prompt) input.prompt = p.prompt;
    return input;
  },
};
