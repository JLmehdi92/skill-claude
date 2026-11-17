import { z } from "zod";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://docs.kie.ai/market/bytedance/seedance-2-5 and https://kie.ai/seedance-2-5 (prix)
// With a video input, kie bills the input video plus the output (which matches it in edit mode).
const CREDITS_PER_SECOND = { "480p": 17, "720p": 38, "1080p": 95 } as const;
const MB = 1024 * 1024;
const DEFAULT_INSTRUCTION =
  "Replace the main person in the reference video with the character from the reference images. Keep the motion, timing, camera and background of the video.";

const paramsSchema = z.object({
  prompt: z.string().trim().max(20_000, "Le prompt dépasse 20 000 caractères."),
  resolution: z.enum(["480p", "720p", "1080p"]),
  audio: z.boolean(),
  nsfw_checker: z.boolean(),
});

type SeedanceParams = z.infer<typeof paramsSchema>;

const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;

export const seedance25Replace: ModelDefinition = {
  id: "seedance-2-5-replace",
  kieModel: "bytedance/seedance-2-5",
  label: "Remplacer un personnage Pro",
  vendor: "Seedance 2.5",
  group: "Genjutsu : transformer une vidéo",
  category: "video",
  description: "Qualité maximale : jusqu'à 30 images de ton personnage, 1080p, prompt pour guider.",
  promptMaxLength: 20_000,
  promptUse: "optional",
  placeholder: "Facultatif : précise le remplacement. Par défaut, le personnage de tes images prend la place de celui de la vidéo.",
  tiles: true,
  fields: [
    {
      key: "resolution",
      label: "Résolution",
      type: "select",
      options: [
        { value: "480p", label: "480p" },
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
      ],
    },
    { key: "audio", label: "Audio", type: "toggle", hint: "Génère la bande son avec la vidéo." },
    {
      key: "nsfw_checker",
      label: "Filtre NSFW",
      type: "toggle",
      hint: "Filtre de contenu de kie.ai. Désactivé par défaut.",
      advanced: true,
    },
  ],
  mediaSlots: [
    {
      key: "character",
      shortLabel: "Personnage",
      addLabel: "Ajouter une image du personnage",
      kieField: "reference_image_urls",
      label: "Images du personnage",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp",
      max: 30,
      maxBytes: 30 * MB,
      array: true,
      hint: "Plusieurs angles du même personnage aident à garder son visage.",
    },
    {
      key: "source_video",
      shortLabel: "Vidéo",
      addLabel: "Ajouter la vidéo, 2 à 30 s",
      kieField: "reference_video_urls",
      label: "Vidéo à transformer",
      kind: "video",
      accept: "video/mp4,video/quicktime,video/x-matroska",
      max: 1,
      maxBytes: 200 * MB,
      array: true,
      hint: "2 à 30 s, 720p maximum.",
    },
  ],
  defaults: { prompt: "", resolution: "720p", audio: true, nsfw_checker: false } satisfies SeedanceParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate(_raw, media) {
    const errors: string[] = [];
    if (count(media, "character") === 0) errors.push("Ajoute une image du personnage.");
    if (count(media, "source_video") === 0) errors.push("Ajoute la vidéo à transformer.");
    const d = media.source_video?.durations[0];
    if (d !== undefined && (d < 2 || d > 30.05)) errors.push("La vidéo à transformer doit durer entre 2 et 30 s.");
    return errors;
  },

  estimate(raw, media) {
    const p = raw as unknown as SeedanceParams;
    // Input seconds + output seconds; the output keeps the input's length, but kie outputs 4 s at least.
    const rate = CREDITS_PER_SECOND[p.resolution];
    const d = media.source_video?.durations[0];
    if (d === undefined) return { credits: 0, upperBound: false, perSecond: rate * 2 };
    return { credits: Math.ceil(rate * (d + Math.max(d, 4))), upperBound: false };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as SeedanceParams;
    return {
      prompt: p.prompt || DEFAULT_INSTRUCTION,
      reference_image_urls: urls.character ?? [],
      reference_video_urls: urls.source_video ?? [],
      omni_reference_task_type: "edit",
      // -1: in edit mode the output matches the input video's length.
      duration: -1,
      resolution: p.resolution,
      generate_audio: p.audio,
      nsfw_checker: p.nsfw_checker,
    };
  },
};
