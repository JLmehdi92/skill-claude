import { z } from "zod";
import { usdToCredits } from "@/lib/costs";
import type { ModelDefinition, Params } from "./types";

// Source: https://docs.higgsfield.ai/docs/models/soul-2/generate
// and https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard (prix : 0,0032 $ en 720p, 0,0057 $ en 1080p).
const USD_PER_IMAGE = { "720p": 0.0032, "1080p": 0.0057 } as const;
const ASPECTS = ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2"] as const;

const paramsSchema = z.object({
  prompt: z.string().trim().min(1, "Écris un prompt.").max(20_000, "Le prompt dépasse 20 000 caractères."),
  resolution: z.enum(["720p", "1080p"]),
  aspect_ratio: z.enum(ASPECTS),
  enhance_prompt: z.boolean(),
  // Soul ID character (Higgsfield reference id); defaults keep older generations valid.
  custom_reference_id: z.string().min(1).max(200).nullable().default(null),
  custom_reference_strength: z.enum(["1", "0.7", "0.4"]).default("1"),
});

type SoulParams = z.infer<typeof paramsSchema>;

export const soul2: ModelDefinition = {
  id: "soul-2",
  provider: "higgsfield",
  kieModel: "higgsfield-ai/soul/v2/standard",
  label: "Soul 2",
  vendor: "Higgsfield",
  group: "Créer une image",
  mentions: "strip",
  category: "image",
  characters: true,
  description: "Le modèle photo de Higgsfield : rendu mode et éditorial, très peu cher.",
  promptMaxLength: 20_000,
  placeholder: "Décris ta photo : sujet, tenue, lieu, lumière, cadrage...",
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
    { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS.map((a) => ({ value: a, label: a })) },
    {
      key: "enhance_prompt",
      label: "Prompt amélioré par Higgsfield",
      type: "toggle",
      hint: "Higgsfield retravaille ton prompt avant de générer. Les prompts courts le sont parfois même sans.",
    },
    {
      key: "custom_reference_strength",
      label: "Ressemblance",
      type: "select",
      showIf: "custom_reference_id",
      options: [
        { value: "1", label: "Ressemblance forte" },
        { value: "0.7", label: "Ressemblance moyenne" },
        { value: "0.4", label: "Ressemblance légère" },
      ],
    },
  ],
  mediaSlots: [],
  defaults: {
    prompt: "",
    resolution: "1080p",
    aspect_ratio: "3:4",
    enhance_prompt: true,
    custom_reference_id: null,
    custom_reference_strength: "1",
  } satisfies SoulParams,
  paramsSchema: paramsSchema as unknown as z.ZodType<Params>,

  validate: () => [],

  estimate(raw) {
    return { credits: usdToCredits(USD_PER_IMAGE[(raw as unknown as SoulParams).resolution]), upperBound: false };
  },

  buildInput(raw) {
    const p = raw as unknown as SoulParams;
    const input: Record<string, unknown> = { prompt: p.prompt, resolution: p.resolution, aspect_ratio: p.aspect_ratio, enhance_prompt: p.enhance_prompt, batch_size: 1 };
    if (p.custom_reference_id) {
      input.custom_reference_id = p.custom_reference_id;
      input.custom_reference_strength = Number(p.custom_reference_strength);
    }
    return input;
  },
};
