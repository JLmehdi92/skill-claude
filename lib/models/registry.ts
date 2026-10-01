import { kindOfFile } from "./media";
import type { MediaSummary, ModelDefinition, ModelMode, Params } from "./types";
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
  /** When known, checked against the slot kind (image, video, audio, document). */
  mime?: string;
  name?: string;
}

export function getMode(model: ModelDefinition, id: unknown): ModelMode | undefined {
  return model.modes?.find((m) => m.id === id);
}

function filled(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
}

/** Best mode for existing params and files (generations made before modes, imported kie tasks). */
export function inferMode(model: ModelDefinition, params: Params, slots: string[]): ModelMode | undefined {
  if (!model.modes?.length) return undefined;
  const saved = getMode(model, params.mode);
  if (saved) return saved;
  const used = new Set(slots);
  const fits = (m: ModelMode) =>
    [...used].every((s) => m.slots.includes(s)) && !(m.hiddenFields ?? []).some((f) => filled(params[f])) && (!m.requiredSlot || used.has(m.requiredSlot));
  // Prefer the narrowest mode that fits: text, then whichever matches the files.
  return model.modes.find((m) => fits(m) && (used.size > 0 ? m.slots.length > 0 : true)) ?? model.modes.find(fits) ?? model.modes[0];
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
    const slot = model.mediaSlots.find((s) => s.key === f.slot);
    if (!slot) errors.push(`Type de fichier inattendu : ${f.slot}.`);
    else if ((f.mime !== undefined || f.name !== undefined) && kindOfFile(f.mime, f.name ?? "") !== slot.kind) {
      errors.push(`${slot.label} : « ${f.name ?? "fichier"} » n'est pas du bon type.`);
    }
  }

  const mode = model.modes && parsed.data.mode !== undefined ? getMode(model, parsed.data.mode) : undefined;
  if (model.modes && parsed.data.mode !== undefined && !mode) errors.push("Mode inconnu.");
  if (mode) {
    const outside = [...new Set(files.map((f) => f.slot).filter((s) => !mode.slots.includes(s)))];
    for (const key of outside) {
      const label = model.mediaSlots.find((s) => s.key === key)?.label ?? key;
      errors.push(`${label} : pas disponible en mode ${mode.label}.`);
    }
    for (const key of mode.hiddenFields ?? []) {
      if (filled(parsed.data[key])) {
        const label = model.fields.find((f) => f.key === key)?.label ?? key;
        errors.push(`${label} : pas disponible en mode ${mode.label}.`);
      }
    }
    if (mode.requiredSlot && !files.some((f) => f.slot === mode.requiredSlot)) {
      const label = model.mediaSlots.find((s) => s.key === mode.requiredSlot)?.label ?? mode.requiredSlot;
      errors.push(`Ajoute une ${label.toLowerCase()}.`);
    }
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
