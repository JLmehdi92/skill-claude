import type { Generation } from "./types";

/** After this long in a provider's queue, the detail explains that the wait is on their side. */
export const SLOW_QUEUE_MS = 10 * 60_000;

export const providerName = (g: Pick<Generation, "provider">) => (g.provider === "higgsfield" ? "Higgsfield" : "kie.ai");

/**
 * Progress of a running generation: the API's own value when it sends one, else an estimate from
 * the time since work started and the model's usual length. Capped at 95 %: an estimate never says done.
 */
export function progressOf(g: Generation, now: number): { value: number; estimated: boolean } | null {
  if (g.status !== "generating") return null;
  // 0 is how some APIs say "not known": the estimate is more useful than a frozen 0 %.
  if (g.progress) return { value: g.progress, estimated: false };
  if (!g.typicalMs) return null;
  const elapsed = Math.max(0, now - (g.startedAt ?? g.createdAt));
  return { value: Math.min(95, Math.max(1, Math.round((elapsed / g.typicalMs) * 100))), estimated: true };
}

/** "En file chez kie.ai · 6 min": where it waits, and for how long once it is a minute or more. */
export function queueLabel(g: Generation, now: number): string {
  const minutes = Math.floor((now - g.createdAt) / 60_000);
  // Non-breaking spaces: on a narrow card "kie.ai · 14 min" wraps as one piece, never "14" / "min".
  return `En file chez ${providerName(g)}${minutes >= 1 ? `\u00a0·\u00a0${minutes}\u00a0min` : ""}`;
}

export const formatProgress = (p: { value: number; estimated: boolean }) => `${p.estimated ? "≈ " : ""}${p.value} %`;
