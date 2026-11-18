import { z } from "zod";
import { usdToCredits } from "@/lib/costs";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://docs.higgsfield.ai/docs/models/genjutsu (motion-transfer, object-swap)
// and https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0 (prix).
// The official Higgsfield Genjutsu, run through its API: their own pipeline and prompts.
const USD_PER_SECOND = { "480p": 0.154, "720p": 0.3446, "1080p": 0.8346 } as const;
const MIN_SECONDS = 4;
const MAX_SECONDS = 30;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  prompt: z.string().trim().max(10_000, "Le prompt dépasse 10 000 caractères."),
  resolution: z.enum(["480p", "720p", "1080p"]),
});

type GenjutsuParams = z.infer<typeof paramsSchema>;

const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;

function genjutsu(o: {
  id: string;
  endpoint: string;
  label: string;
  description: string;
  placeholder: string;
  videoSlot: string;
  videoShort: string;
  videoLabel: string;
  videoAdd: string;
  videoHint: string;
  missingVideo: string;
}): ModelDefinition {
  const duration = (media: MediaSummary) => media[o.videoSlot]?.durations[0];
  return {
    id: o.id,
    provider: "higgsfield",
    kieModel: o.endpoint,
    label: o.label,
    vendor: "Genjutsu officiel",
    group: "Genjutsu : transformer une vidéo",
    category: "video",
    description: o.description,
    promptMaxLength: 10_000,
    promptUse: "optional",
    placeholder: o.placeholder,
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
    ],
    mediaSlots: [
      {
        key: "character",
        shortLabel: "Personnage",
        addLabel: "Ajouter une image du personnage",
        kieField: "image_urls",
        tagPrefix: "Image",
        label: "Images du personnage",
        kind: "image",
        accept: "image/jpeg,image/png,image/webp",
        max: 8,
        maxBytes: 20 * MB,
        array: true,
        hint: "1 à 8 images. Plusieurs angles aident à garder le visage.",
      },
      {
        key: o.videoSlot,
        shortLabel: o.videoShort,
        addLabel: o.videoAdd,
        kieField: "video_url",
        tagPrefix: "Video",
        label: o.videoLabel,
        kind: "video",
        accept: "video/mp4,video/quicktime",
        max: 1,
        maxBytes: 200 * MB,
        array: false,
        hint: o.videoHint,
      },
    ],
    defaults: { prompt: "", resolution: "720p" } satisfies GenjutsuParams,
    paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

    validate(_raw, media) {
      const errors: string[] = [];
      if (count(media, "character") === 0) errors.push("Ajoute une image du personnage.");
      if (count(media, o.videoSlot) === 0) errors.push(o.missingVideo);
      const d = duration(media);
      if (d !== undefined && d < MIN_SECONDS) errors.push("La vidéo doit durer au moins 4 s.");
      return errors;
    },

    estimate(raw, media) {
      const p = raw as unknown as GenjutsuParams;
      const d = duration(media);
      if (d === undefined) return { credits: 0, upperBound: false, perSecond: usdToCredits(USD_PER_SECOND[p.resolution]) };
      // Billed on the source length rounded up to a whole second; longer videos are trimmed to 30 s.
      return { credits: usdToCredits(USD_PER_SECOND[p.resolution] * Math.ceil(Math.min(d, MAX_SECONDS))), upperBound: false };
    },

    buildInput(raw, urls) {
      const p = raw as unknown as GenjutsuParams;
      const input: Record<string, unknown> = { video_url: urls[o.videoSlot]?.[0], image_urls: urls.character ?? [], resolution: p.resolution };
      if (p.prompt) input.prompt = p.prompt;
      return input;
    },
  };
}

export const genjutsuMotion = genjutsu({
  id: "genjutsu-motion-transfer",
  endpoint: "higgsfield/genjutsu/motion-transfer/v1.0",
  label: "Copier un mouvement Pro",
  description: "Le vrai Genjutsu de Higgsfield : jusqu'à 8 images de ton personnage, 1080p.",
  placeholder: "Facultatif : précise la scène ou la tenue. Le mouvement vient de la vidéo.",
  // Same slot as Kling so the motion gallery fills it.
  videoSlot: "motion_video",
  videoShort: "Mouvement",
  videoLabel: "Vidéo de mouvement",
  videoAdd: "Ajouter la vidéo de mouvement, 4 à 30 s",
  videoHint: "4 s minimum, coupée à 30 s.",
  missingVideo: "Ajoute la vidéo de mouvement.",
});

export const genjutsuSwap = genjutsu({
  id: "genjutsu-object-swap",
  endpoint: "higgsfield/genjutsu/object-swap/v1.0",
  label: "Remplacer un personnage Pro",
  description: "Le vrai Genjutsu de Higgsfield : ton personnage prend la place de celui de la vidéo.",
  placeholder: "Facultatif : précise le remplacement. Par défaut, ton personnage prend la place de celui de la vidéo.",
  videoSlot: "source_video",
  videoShort: "Vidéo",
  videoLabel: "Vidéo à transformer",
  videoAdd: "Ajouter la vidéo, 4 à 30 s",
  videoHint: "4 s minimum, coupée à 30 s, au moins 640 x 640 px.",
  missingVideo: "Ajoute la vidéo à transformer.",
});
