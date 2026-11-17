/** A preset appends a description to the prompt before sending to the API. */
export interface Preset {
  id: string;
  label: string;
  /** Short French description shown below the label. */
  description: string;
  category: PresetCategory;
  /** Text appended to the user prompt before sending. */
  promptSuffix: string;
}

export type PresetCategory = "camera" | "style" | "motion" | "effect";

export const PRESET_CATEGORY_LABELS: Record<PresetCategory, string> = {
  camera: "Caméra",
  style: "Style",
  motion: "Mouvement",
  effect: "Effet",
};
