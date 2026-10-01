import { z } from "zod";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Source: https://kie.ai/wan3.0-video and https://docs.kie.ai/market/wan/3-0-video
const CREDITS_PER_SECOND = { "480P": 8, "720P": 16, "1080P": 32 } as const;
const MAX_TOTAL_SECONDS = 30;
const MAX_REFERENCE_SECONDS = 15;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  prompt: z.string().trim().min(1, "Écris un prompt.").max(20_000, "Le prompt dépasse 20 000 caractères."),
  resolution: z.enum(["480P", "720P", "1080P"]),
  aspect_ratio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  duration: z
    .number()
    .int()
    .refine((v) => v === -1 || (v >= 2 && v <= MAX_TOTAL_SECONDS), "La durée doit être entre 2 et 30 s, ou auto."),
  audio: z.boolean(),
  seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  nsfw_checker: z.boolean(),
  reference_link_urls: z.array(z.string().url("Lien invalide.")).max(1),
});

type WanParams = z.infer<typeof paramsSchema>;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const count = (media: MediaSummary, key: string) => media[key]?.count ?? 0;
const durations = (media: MediaSummary, key: string) => media[key]?.durations ?? [];

export const wan30Video: ModelDefinition = {
  id: "wan-3-0-video",
  kieModel: "wan/3-0-video",
  label: "Wan 3.0",
  vendor: "Alibaba",
  category: "video",
  description: "Vidéo multimodale jusqu'à 30 s : texte, images, vidéos, audio et keyframes.",
  promptMaxLength: 20_000,
  fields: [
    {
      key: "resolution",
      label: "Résolution",
      type: "select",
      options: [
        { value: "480P", label: "480p" },
        { value: "720P", label: "720p" },
        { value: "1080P", label: "1080p" },
      ],
    },
    {
      key: "aspect_ratio",
      label: "Format",
      type: "select",
      options: [
        { value: "adaptive", label: "Auto" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
      ],
    },
    { key: "duration", label: "Durée", type: "duration", min: 2, max: MAX_TOTAL_SECONDS, allowAuto: true },
    { key: "audio", label: "Audio", type: "toggle", hint: "Génère la bande son avec la vidéo." },
    { key: "seed", label: "Seed", type: "seed", advanced: true },
    {
      key: "nsfw_checker",
      label: "Filtre NSFW",
      type: "toggle",
      hint: "Filtre de contenu de kie.ai. Désactivé par défaut.",
      advanced: true,
    },
    {
      key: "reference_link_urls",
      label: "Page web de référence",
      type: "links",
      max: 1,
      hint: "Une page publique. Incompatible avec les keyframes et le document.",
      advanced: true,
    },
  ],
  mediaSlots: [
    {
      key: "first_frame",
      kieField: "first_frame_url",
      label: "Image de début",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp,image/bmp",
      max: 1,
      maxBytes: 20 * MB,
      array: false,
    },
    {
      key: "last_frame",
      kieField: "last_frame_url",
      label: "Image de fin",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp,image/bmp",
      max: 1,
      maxBytes: 20 * MB,
      array: false,
    },
    {
      key: "reference_image",
      kieField: "reference_image_urls",
      label: "Images",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp,image/bmp",
      max: 10,
      maxBytes: 20 * MB,
      array: true,
      tagPrefix: "Image",
    },
    {
      key: "reference_video",
      kieField: "reference_video_urls",
      label: "Vidéos",
      kind: "video",
      accept: "video/mp4,video/quicktime",
      max: 5,
      maxBytes: 100 * MB,
      array: true,
      tagPrefix: "Video",
      hint: "1 à 15 s chacune, 15 s au total.",
    },
    {
      key: "reference_audio",
      kieField: "reference_audio_urls",
      label: "Audio",
      kind: "audio",
      accept: "audio/mpeg,audio/wav,audio/x-wav",
      max: 5,
      maxBytes: 15 * MB,
      array: true,
      tagPrefix: "Audio",
      hint: "1 à 15 s chacun, 15 s au total.",
    },
    {
      key: "reference_file",
      kieField: "reference_file_urls",
      label: "Document",
      kind: "document",
      accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.key,.pages,.numbers",
      max: 1,
      maxBytes: 100 * MB,
      array: true,
      hint: "Brief, PDF, présentation. 50 pages max.",
    },
  ],
  defaults: {
    prompt: "",
    resolution: "720P",
    aspect_ratio: "adaptive",
    duration: 5,
    audio: true,
    seed: null,
    nsfw_checker: false,
    reference_link_urls: [],
  } satisfies WanParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate(raw, media) {
    const p = raw as unknown as WanParams;
    const errors: string[] = [];
    const usesFrames = count(media, "first_frame") + count(media, "last_frame") > 0;
    const hasLink = p.reference_link_urls.length > 0;
    const hasFile = count(media, "reference_file") > 0;

    if (count(media, "last_frame") > 0 && count(media, "first_frame") === 0) {
      errors.push("Une image de fin demande aussi une image de début.");
    }
    if (usesFrames && count(media, "reference_image") > 0) {
      errors.push("Les images de référence ne se combinent pas avec les images de début ou de fin.");
    }
    if (usesFrames && (hasLink || hasFile)) {
      errors.push("Le lien web et le document ne se combinent pas avec les images de début ou de fin.");
    }
    if (hasLink && hasFile) {
      errors.push("Choisis un lien web ou un document, pas les deux.");
    }

    for (const key of ["reference_video", "reference_audio"] as const) {
      const ds = durations(media, key);
      const noun = key === "reference_video" ? "vidéo" : "audio";
      if (ds.some((d) => d < 1 || d > MAX_REFERENCE_SECONDS)) {
        errors.push(`Chaque ${noun} de référence doit durer entre 1 et 15 s.`);
      }
      if (sum(ds) > MAX_REFERENCE_SECONDS + 0.05) {
        errors.push(`Les ${noun}s de référence dépassent 15 s au total.`);
      }
    }

    const videoTotal = sum(durations(media, "reference_video"));
    if (p.duration !== -1 && videoTotal + p.duration > MAX_TOTAL_SECONDS + 0.05) {
      errors.push("Vidéos de référence + durée demandée : 30 s maximum.");
    }
    return errors;
  },

  estimate(raw, media) {
    const p = raw as unknown as WanParams;
    const rate = CREDITS_PER_SECOND[p.resolution];
    const videoTotal = sum(durations(media, "reference_video"));
    if (p.duration === -1) {
      return { credits: Math.ceil(rate * MAX_TOTAL_SECONDS), upperBound: true };
    }
    return { credits: Math.ceil(rate * (videoTotal + p.duration)), upperBound: false };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as WanParams;
    const input: Record<string, unknown> = {
      prompt: p.prompt,
      resolution: p.resolution,
      aspect_ratio: p.aspect_ratio,
      duration: p.duration,
      audio: p.audio,
      // Always sent explicitly: kie's playground defaults this to true.
      nsfw_checker: p.nsfw_checker,
    };
    if (p.seed !== null) input.seed = p.seed;
    if (p.reference_link_urls.length) input.reference_link_urls = p.reference_link_urls;
    for (const slot of wan30Video.mediaSlots) {
      const list = urls[slot.key];
      if (!list?.length) continue;
      input[slot.kieField] = slot.array ? list : list[0];
    }
    return input;
  },
};
