import { z } from "zod";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://docs.kie.ai/market/wan/2-2-animate-replace and https://kie.ai/wan-animate (prix)
const CREDITS_PER_SECOND = { "480p": 6, "580p": 9.5, "720p": 12.5 } as const;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  // No prompt: the model takes only the image and the video.
  prompt: z.literal(""),
  resolution: z.enum(["480p", "580p", "720p"]),
  nsfw_checker: z.boolean(),
});

type ReplaceParams = z.infer<typeof paramsSchema>;

const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;

export const wan22AnimateReplace: ModelDefinition = {
  id: "wan-2-2-animate-replace",
  kieModel: "wan/2-2-animate-replace",
  label: "Remplacer un personnage",
  vendor: "Wan 2.2 Animate",
  group: "Genjutsu : transformer une vidéo",
  category: "video",
  description: "Ton personnage prend la place de celui de la vidéo.",
  placeholder: "Pas de prompt : le personnage de ton image remplace celui de la vidéo, gestes et décor conservés.",
  promptMaxLength: 0,
  promptUse: "none",
  tiles: true,
  fields: [
    {
      key: "resolution",
      label: "Résolution",
      type: "select",
      options: [
        { value: "480p", label: "480p" },
        { value: "580p", label: "580p" },
        { value: "720p", label: "720p" },
      ],
    },
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
      addLabel: "Ajouter le personnage",
      kieField: "image_url",
      label: "Image du personnage",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp",
      max: 1,
      maxBytes: 10 * MB,
      array: false,
      hint: "La personne qui prendra la place de celle de la vidéo.",
    },
    {
      key: "source_video",
      shortLabel: "Vidéo",
      addLabel: "Ajouter la vidéo, 10 Mo max",
      kieField: "video_url",
      label: "Vidéo à transformer",
      kind: "video",
      accept: "video/mp4,video/quicktime,video/x-matroska",
      max: 1,
      maxBytes: 10 * MB,
      array: false,
      hint: "10 Mo maximum.",
    },
  ],
  defaults: {
    prompt: "",
    resolution: "480p",
    nsfw_checker: false,
  } satisfies ReplaceParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate(_raw, media) {
    const errors: string[] = [];
    if (count(media, "character") === 0) errors.push("Ajoute une image du personnage.");
    if (count(media, "source_video") === 0) errors.push("Ajoute la vidéo à transformer.");
    return errors;
  },

  estimate(raw, media) {
    const p = raw as unknown as ReplaceParams;
    const rate = CREDITS_PER_SECOND[p.resolution];
    const d = media.source_video?.durations[0];
    // Billed per second of output, which follows the source video.
    if (d === undefined) return { credits: 0, upperBound: false, perSecond: rate };
    return { credits: Math.ceil(rate * d), upperBound: false };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as ReplaceParams;
    return {
      video_url: urls.source_video?.[0],
      image_url: urls.character?.[0],
      resolution: p.resolution,
      // Always sent explicitly, like Wan 3.0.
      nsfw_checker: p.nsfw_checker,
    };
  },
};
