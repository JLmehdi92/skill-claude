import { z } from "zod";
import { usdToCredits } from "@/lib/costs";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://docs.higgsfield.ai/docs/models/seedance-2-5/video-edit
// and https://open.higgsfield.ai/models/bytedance/seedance-2.5/video-edit (prix, ~15 % sous kie.ai).
const USD_PER_SECOND = { "480p": 0.1387, "720p": 0.3264, "1080p": 0.7858 } as const;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  prompt: z.string().trim().min(1, "Écris un prompt.").max(20_000, "Le prompt dépasse 20 000 caractères."),
  resolution: z.enum(["480p", "720p", "1080p"]),
  audio: z.boolean(),
});

type EditParams = z.infer<typeof paramsSchema>;

const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;

export const seedance25Edit: ModelDefinition = {
  id: "seedance-2-5-edit",
  provider: "higgsfield",
  kieModel: "bytedance/seedance-2.5/video-edit",
  label: "Modifier une vidéo",
  vendor: "Seedance 2.5",
  group: "Genjutsu : transformer une vidéo",
  category: "video",
  description: "Change ce que tu veux dans une vidéo avec un prompt, et jusqu'à 30 images de référence.",
  promptMaxLength: 20_000,
  placeholder: "Décris le changement : « remplace sa veste par celle de l'image », « mets la scène sous la neige »...",
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
  ],
  mediaSlots: [
    {
      key: "source_video",
      shortLabel: "Vidéo",
      addLabel: "Ajouter la vidéo à modifier, 2 à 30 s",
      kieField: "video_url",
      label: "Vidéo à modifier",
      kind: "video",
      accept: "video/mp4,video/quicktime",
      max: 1,
      maxBytes: 200 * MB,
      array: false,
      hint: "2 à 30 s.",
    },
    {
      key: "reference_image",
      shortLabel: "Référence",
      addLabel: "Ajouter une image de référence",
      kieField: "image_urls",
      label: "Images de référence",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp",
      max: 30,
      maxBytes: 30 * MB,
      array: true,
      hint: "Facultatif : un vêtement, un objet, un personnage à mettre dans la vidéo.",
    },
  ],
  defaults: { prompt: "", resolution: "720p", audio: true } satisfies EditParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate(_raw, media) {
    const errors: string[] = [];
    if (count(media, "source_video") === 0) errors.push("Ajoute la vidéo à modifier.");
    const d = media.source_video?.durations[0];
    if (d !== undefined && (d < 2 || d > 30.05)) errors.push("La vidéo à modifier doit durer entre 2 et 30 s.");
    return errors;
  },

  estimate(raw, media) {
    const p = raw as unknown as EditParams;
    const d = media.source_video?.durations[0];
    if (d === undefined) return { credits: 0, upperBound: false, perSecond: usdToCredits(USD_PER_SECOND[p.resolution]) };
    // The output follows the source, normalized to 4 s at least.
    return { credits: usdToCredits(USD_PER_SECOND[p.resolution] * Math.ceil(Math.max(d, 4))), upperBound: false };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as EditParams;
    const input: Record<string, unknown> = { prompt: p.prompt, video_url: urls.source_video?.[0], resolution: p.resolution, generate_audio: p.audio };
    if (urls.reference_image?.length) input.image_urls = urls.reference_image;
    return input;
  },
};
