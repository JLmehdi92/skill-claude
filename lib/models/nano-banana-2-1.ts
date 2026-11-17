import { z } from "zod";
import type { ModelDefinition, Params } from "./types";

// Source: https://docs.kie.ai/market/google/nanobanana-2-1 and https://kie.ai/nano-banana-2-1 (prix)
const CREDITS_PER_IMAGE = { "1K": 4, "2K": 6, "4K": 9 } as const;
const ASPECTS = ["auto", "1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "21:9"] as const;
const MB = 1024 * 1024;

const paramsSchema = z.object({
  prompt: z.string().trim().min(1, "Écris un prompt.").max(20_000, "Le prompt dépasse 20 000 caractères."),
  resolution: z.enum(["1K", "2K", "4K"]),
  aspect_ratio: z.enum(ASPECTS),
});

type ImageParams = z.infer<typeof paramsSchema>;

export const nanoBanana21: ModelDefinition = {
  id: "nano-banana-2-1",
  kieModel: "nano-banana-2-1",
  label: "Nano Banana 2.1",
  vendor: "Google",
  group: "Créer une image",
  category: "image",
  description: "Images jusqu'en 4K, avec jusqu'à 10 images de référence.",
  promptMaxLength: 20_000,
  placeholder: "Décris ton image. Ajoute des références pour garder un visage, un produit ou un style.",
  fields: [
    {
      key: "resolution",
      label: "Résolution",
      type: "select",
      options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
    },
    {
      key: "aspect_ratio",
      label: "Format",
      type: "select",
      options: ASPECTS.map((a) => ({ value: a, label: a === "auto" ? "Auto" : a })),
    },
  ],
  mediaSlots: [
    {
      key: "reference_image",
      kieField: "image_input",
      label: "Images de référence",
      kind: "image",
      accept: "image/jpeg,image/png,image/webp",
      max: 10,
      maxBytes: 30 * MB,
      array: true,
    },
  ],
  defaults: { prompt: "", resolution: "1K", aspect_ratio: "auto" } satisfies ImageParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate: () => [],

  estimate(raw) {
    return { credits: CREDITS_PER_IMAGE[(raw as unknown as ImageParams).resolution], upperBound: false };
  },

  buildInput(raw, urls) {
    const p = raw as unknown as ImageParams;
    return { prompt: p.prompt, image_input: urls.reference_image ?? [], aspect_ratio: p.aspect_ratio, resolution: p.resolution, output_format: "png" };
  },
};
