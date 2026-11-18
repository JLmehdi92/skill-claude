import type { MediaSummary, ModelDefinition } from "./types";

/** A mention: "@" at the start or after whitespace, then letters (accents too), digits, "_" or "-". */
const MENTION = /(^|\s)@([\p{L}\p{N}_-]+)/gu;
const FILE_TAG = /^(Image|Video|Audio)(\d+)$/;

/** File mentions used in a prompt that point to no attached file ("@Image3" with two images). */
export function orphanMentions(prompt: string, model: ModelDefinition, media: MediaSummary): string[] {
  const out = new Set<string>();
  for (const m of prompt.matchAll(MENTION)) {
    const tag = FILE_TAG.exec(m[2]);
    if (!tag) continue;
    const slot = model.mediaSlots.find((s) => s.tagPrefix === tag[1]);
    if (!slot || Number(tag[2]) < 1 || Number(tag[2]) > (media[slot.key]?.count ?? 0)) out.add(`@${m[2]}`);
  }
  return [...out];
}

/**
 * What the API reads, from what the user typed. The saved prompt keeps the "@".
 * - native (Wan 3.0 on kie): "@Image1" is the documented syntax, sent as is.
 * - words (default): "@Image2" becomes "image 2", in the order the files are sent.
 * - strip (Soul 2): "@Léa" is removed when Léa is one of `characters`, which go through custom_reference_id.
 *   Any other "@word" (a brand, a handle) stays.
 */
export function resolveMentions(prompt: string, model: ModelDefinition, characters: string[] = []): string {
  const mode = model.mentions ?? "words";
  if (mode === "native") return prompt;
  if (mode === "strip") {
    const known = new Set(characters.map((n) => n.toLocaleLowerCase("fr")));
    let stripped = false;
    const out = prompt.replace(MENTION, (all, lead: string, word: string) => {
      if (!known.has(word.toLocaleLowerCase("fr"))) return all;
      stripped = true;
      return lead;
    });
    return stripped ? out.replace(/ {2,}/g, " ").trim() : out;
  }
  return prompt.replace(MENTION, (all, lead: string, word: string) => {
    const tag = FILE_TAG.exec(word);
    return tag ? `${lead}${tag[1].toLowerCase()} ${tag[2]}` : all;
  });
}
