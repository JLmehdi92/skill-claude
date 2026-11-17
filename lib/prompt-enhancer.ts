import type { Preset } from "./presets/types";

/**
 * Enhances a user prompt with cinematic details and preset modifiers.
 * Runs client-side so the user sees the final prompt before sending.
 */
export function enhancePrompt(
  userPrompt: string,
  options: {
    presets?: Preset[];
    enhance?: boolean;
  } = {},
): string {
  const { presets = [], enhance = false } = options;
  let result = userPrompt.trim();
  // Suffixes alone would send a prompt that starts with ", ...".
  if (!result) return result;

  if (enhance) {
    result = addCinematicDetails(result);
  }

  for (const preset of presets) result += preset.promptSuffix;

  return result;
}

const CINEMATIC_HINTS = [
  "high quality",
  "detailed",
  "professional lighting",
  "smooth motion",
  "4K",
  "cinematic",
  "film",
  "camera",
  "depth of field",
  "color grading",
];

function addCinematicDetails(prompt: string): string {
  const lower = prompt.toLowerCase();
  const alreadyCinematic = CINEMATIC_HINTS.some((h) => lower.includes(h));
  if (alreadyCinematic) return prompt;
  return `${prompt}, high quality, smooth camera motion, professional cinematic lighting, detailed textures`;
}
