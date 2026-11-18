import { z } from "zod";
import type { MediaSummary, ModelDefinition, Params } from "./types";

// Sources: https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image (et image-to-image),
// https://docs.kie.ai/market/gpt/gpt-image-2-6-economy-text-to-image (et image-to-image),
// prix : https://kie.ai/gpt-image-2-5 (6/10/16 crédits), https://kie.ai/pricing (2.6 Economy : 5 crédits, 1K).
// GPT Image 2.6 Flare/Sunburst are billed by tokens on kie: no price before sending, so not offered.
const MB = 1024 * 1024;
const refs = (media: MediaSummary) => (media.reference_image?.count ?? 0) > 0;

const referenceSlot = {
  key: "reference_image",
  kieField: "input_urls",
  label: "Images de référence",
  kind: "image" as const,
  accept: "image/jpeg,image/png,image/webp",
  max: 16,
  maxBytes: 20 * MB,
  array: true,
  hint: "Avec des références, l'image est créée à partir d'elles.",
};

const ASPECTS_25 = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] as const;
const PRICE_25 = { "1K": 6, "2K": 10, "4K": 16 } as const;

const schema25 = z.object({
  prompt: z.string().trim().min(1, "Écris un prompt.").max(20_000, "Le prompt dépasse 20 000 caractères."),
  resolution: z.enum(["1K", "2K", "4K"]),
  aspect_ratio: z.enum(ASPECTS_25),
});
type Params25 = z.infer<typeof schema25>;

export const gptImage25: ModelDefinition = {
  id: "gpt-image-2-5",
  kieModel: "gpt-image-2-5-flare-text-to-image",
  endpoint: (_p, media) => (refs(media) ? "gpt-image-2-5-flare-image-to-image" : "gpt-image-2-5-flare-text-to-image"),
  label: "GPT Image 2.5",
  vendor: "OpenAI",
  group: "Créer une image",
  category: "image",
  description: "Le modèle d'image de ChatGPT : texte lisible dans l'image, jusqu'en 4K.",
  promptMaxLength: 20_000,
  placeholder: "Décris ton image. Mets entre guillemets le texte qui doit apparaître dessus.",
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
    { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_25.map((a) => ({ value: a, label: a === "auto" ? "Auto" : a })) },
  ],
  mediaSlots: [referenceSlot],
  defaults: { prompt: "", resolution: "1K", aspect_ratio: "auto" } satisfies Params25,
  paramsSchema: schema25 as unknown as z.ZodType<Params>,
  validate: () => [],
  estimate: (raw) => ({ credits: PRICE_25[(raw as unknown as Params25).resolution], upperBound: false }),
  buildInput(raw, urls) {
    const p = raw as unknown as Params25;
    const input: Record<string, unknown> = { prompt: p.prompt, resolution: p.resolution, aspect_ratio: p.aspect_ratio };
    if (urls.reference_image?.length) input.input_urls = urls.reference_image;
    return input;
  },
};

const ASPECTS_26 = ["auto", "1:1", "16:9", "9:16", "3:2", "2:3", "21:9", "4:3"] as const;
const PRICE_26 = 5;

const schema26 = z.object({
  prompt: z.string().trim().min(1, "Écris un prompt.").max(20_000, "Le prompt dépasse 20 000 caractères."),
  aspect_ratio: z.enum(ASPECTS_26),
});
type Params26 = z.infer<typeof schema26>;

export const gptImage26: ModelDefinition = {
  id: "gpt-image-2-6",
  kieModel: "gpt-image-2-6/economy-text-to-image",
  endpoint: (_p, media) => (refs(media) ? "gpt-image-2-6/economy-image-to-image" : "gpt-image-2-6/economy-text-to-image"),
  label: "GPT Image 2.6",
  vendor: "OpenAI, 1K",
  group: "Créer une image",
  category: "image",
  description: "La dernière version du modèle d'image de ChatGPT, en 1K, à prix fixe.",
  promptMaxLength: 20_000,
  placeholder: "Décris ton image. Mets entre guillemets le texte qui doit apparaître dessus.",
  fields: [{ key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_26.map((a) => ({ value: a, label: a === "auto" ? "Auto" : a })) }],
  mediaSlots: [referenceSlot],
  defaults: { prompt: "", aspect_ratio: "auto" } satisfies Params26,
  paramsSchema: schema26 as unknown as z.ZodType<Params>,
  validate: () => [],
  estimate: () => ({ credits: PRICE_26, upperBound: false }),
  buildInput(raw, urls) {
    const p = raw as unknown as Params26;
    const input: Record<string, unknown> = { prompt: p.prompt, aspect_ratio: p.aspect_ratio, output_format: "png" };
    if (urls.reference_image?.length) input.input_urls = urls.reference_image;
    return input;
  },
};
