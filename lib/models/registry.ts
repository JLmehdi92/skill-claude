import type { MediaSummary, ModelDefinition, Params } from "./types";
import { wan30Video } from "./wan-3-0-video";

/** Every model the studio can run. Adding a model = adding a definition file here. */
export const MODELS: ModelDefinition[] = [wan30Video];

export function getModel(id: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === id || m.kieModel === id);
}

export interface FileMeta {
  slot: string;
  size: number;
  duration?: number;
}

export function summarizeMedia(files: FileMeta[]): MediaSummary {
  const summary: MediaSummary = {};
  for (const f of files) {
    const entry = (summary[f.slot] ??= { count: 0, durations: [] });
    entry.count += 1;
    if (typeof f.duration === "number") entry.durations.push(f.duration);
  }
  return summary;
}

export type ValidationResult =
  | { ok: true; params: Params; media: MediaSummary }
  | { ok: false; errors: string[] };

/** Full validation shared by the composer (live feedback) and the API (enforcement). */
export function validateRequest(model: ModelDefinition, rawParams: unknown, files: FileMeta[]): ValidationResult {
  const parsed = model.paramsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { ok: false, errors: [...new Set(parsed.error.issues.map((i) => i.message))] };
  }
  const errors: string[] = [];
  for (const f of files) {
    if (!model.mediaSlots.some((s) => s.key === f.slot)) errors.push(`Type de fichier inattendu : ${f.slot}.`);
  }
  for (const slot of model.mediaSlots) {
    const mine = files.filter((f) => f.slot === slot.key);
    if (mine.length > slot.max) errors.push(`${slot.label} : ${slot.max} fichier(s) maximum.`);
    if (mine.some((f) => f.size > slot.maxBytes)) {
      errors.push(`${slot.label} : ${Math.round(slot.maxBytes / 1024 / 1024)} Mo maximum par fichier.`);
    }
  }
  const media = summarizeMedia(files);
  errors.push(...model.validate(parsed.data, media));
  return errors.length ? { ok: false, errors } : { ok: true, params: parsed.data, media };
}
