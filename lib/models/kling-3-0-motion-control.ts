import { z } from "zod";
import { usdToCredits } from "@/lib/costs";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://docs.higgsfield.ai/docs/models/kling-3-motion-control (std = 720p, pro = 1080p)
// and https://open.higgsfield.ai/models/kling-video/v3/motion-control/std (prix). Higgsfield: ~20 % sous kie.ai.
const USD_PER_SECOND = { "720p": 0.092, "1080p": 0.1189 } as const;
const TIER = { "720p": "std", "1080p": "pro" } as const;
const MAX_SECONDS = { video: 30, image: 10 } as const;
const MIN_SECONDS = 3;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  prompt: z.string().trim().max(2500, "Le prompt dépasse 2 500 caractères."),
  resolution: z.enum(["720p", "1080p"]),
  character_orientation: z.enum(["video", "image"]),
  // Default for generations made before this option existed.
  keep_sound: z.boolean().default(true),
});

type MotionParams = z.infer<typeof paramsSchema>;

const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;
const duration = (media: MediaSummary) => media.motion_video?.durations[0];

export const kling30MotionControl: ModelDefinition = {
  id: "kling-3-0-motion-control",
  provider: "higgsfield",
  kieModel: "kling-video/v3/motion-control/std",
  endpoint: (p) => `kling-video/v3/motion-control/${TIER[(p as unknown as MotionParams).resolution]}`,
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
    { key: "keep_sound", label: "Son de la vidéo", type: "toggle", hint: "Garde le son de la vidéo de mouvement." },
  ],
  mediaSlots: [
    {
      key: "character",
      shortLabel: "Personnage",
      addLabel: "Ajouter le personnage",
      kieField: "image_url",
      tagPrefix: "Image",
      label: "Image du personnage",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp",
      max: 1,
      maxBytes: 10 * MB,
      array: false,
      hint: "Tête, épaules et buste bien visibles.",
    },
    {
      key: "motion_video",
      shortLabel: "Mouvement",
      addLabel: "Ajouter la vidéo de mouvement, 3 à 30 s",
      kieField: "video_url",
      tagPrefix: "Video",
      label: "Vidéo de mouvement",
      kind: "video",
      accept: "video/mp4,video/quicktime",
      max: 1,
      maxBytes: 100 * MB,
      array: false,
      hint: "3 à 30 s, une personne cadrée tête, épaules et buste.",
    },
  ],
  defaults: { prompt: "", resolution: "720p", character_orientation: "video", keep_sound: true } satisfies MotionParams,
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
    const rate = usdToCredits(USD_PER_SECOND[p.resolution]);
    const d = duration(media);
    // Billed on the motion video's length rounded to the nearest second.
    if (d === undefined) return { credits: 0, upperBound: false, perSecond: rate };
    return { credits: usdToCredits(USD_PER_SECOND[p.resolution] * Math.round(d)), upperBound: false };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as MotionParams;
    const input: Record<string, unknown> = {
      image_url: urls.character?.[0],
      video_url: urls.motion_video?.[0],
      character_orientation: p.character_orientation,
      keep_original_sound: p.keep_sound ? "yes" : "no",
    };
    if (p.prompt) input.prompt = p.prompt;
    return input;
  },
};
