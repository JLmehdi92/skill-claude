import type { z } from "zod";

export type Category = "video" | "image" | "audio";
export type MediaKind = "image" | "video" | "audio" | "document";

/** A slot the user can drop files into. Maps to one kie input field. */
export interface MediaSlot {
  key: string;
  kieField: string;
  label: string;
  kind: MediaKind;
  accept: string;
  max: number;
  maxBytes: number;
  /** Kie expects an array of URLs (true) or a single URL string (false). */
  array: boolean;
  /** Short label for small tiles (e.g. "Début"). */
  shortLabel?: string;
  /** Prefix used for prompt mentions, e.g. "Image" gives @Image1. */
  tagPrefix?: string;
  hint?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export type Field =
  | { key: string; label: string; type: "select"; options: SelectOption[]; advanced?: boolean }
  | { key: string; label: string; type: "duration"; min: number; max: number; allowAuto: boolean; advanced?: boolean }
  | { key: string; label: string; type: "toggle"; hint?: string; advanced?: boolean }
  | { key: string; label: string; type: "seed"; advanced?: boolean }
  | { key: string; label: string; type: "links"; max: number; hint?: string; advanced?: boolean };

/**
 * A way of using a model (e.g. text only, keyframes, references). Each mode allows a subset
 * of the media slots; the UI only shows those and the server rejects anything else.
 */
export interface ModelMode {
  id: string;
  label: string;
  hint: string;
  /** Media slot keys usable in this mode. */
  slots: string[];
  /** Field keys that must stay empty in this mode (hidden in the UI). */
  hiddenFields?: string[];
  /** Slot that must hold at least one file in this mode. */
  requiredSlot?: string;
  placeholder: string;
}

/** What the validator needs to know about attached files, without the files themselves. */
export type MediaSummary = Record<string, { count: number; durations: number[] }>;

export interface Estimate {
  credits: number;
  /** True when the real cost depends on the model (auto duration): credits is then a ceiling. */
  upperBound: boolean;
}

export type Params = Record<string, unknown> & { prompt: string };

export interface ModelDefinition {
  id: string;
  kieModel: string;
  label: string;
  vendor: string;
  category: Category;
  description: string;
  promptMaxLength: number;
  fields: Field[];
  mediaSlots: MediaSlot[];
  /** Optional modes, in display order. The first one is the default. */
  modes?: ModelMode[];
  defaults: Params;
  paramsSchema: z.ZodType<Params>;
  /** Cross-field rules. Returns user-facing (French) error messages. */
  validate(params: Params, media: MediaSummary): string[];
  estimate(params: Params, media: MediaSummary): Estimate;
  /** Builds the kie `input` object from validated params and uploaded file URLs. */
  buildInput(params: Params, urls: Record<string, string[]>): Record<string, unknown>;
}
