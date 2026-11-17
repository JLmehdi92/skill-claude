/** A preset modifies the prompt and/or params before sending to the API. */
export interface Preset {
  id: string;
  label: string;
  /** Short French description shown below the label. */
  description: string;
  category: PresetCategory;
  /** Emoji or icon hint for the UI. */
  icon: string;
  /** Text prepended/appended to the user prompt by the enhancer. */
  promptSuffix?: string;
  /** Param overrides applied when the preset is selected. */
  paramOverrides?: Record<string, unknown>;
}

export type PresetCategory = "camera" | "style" | "motion" | "effect";

export const PRESET_CATEGORY_LABELS: Record<PresetCategory, string> = {
  camera: "Caméra",
  style: "Style",
  motion: "Mouvement",
  effect: "Effet",
};
