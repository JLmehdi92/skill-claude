/** The "@word" being typed at the caret: where it starts and what follows the "@". Null outside a mention. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Case and accent insensitive prefix match on any word of the label: "@ima" keeps "@Image1" and "Ajouter une image". */
export function matchesMention(label: string, query: string): boolean {
  if (!query) return true;
  const q = fold(query);
  return fold(label)
    .split(/[\s@]+/)
    .some((w) => w.startsWith(q));
}
