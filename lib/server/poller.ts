import "server-only";
import { pollCharacters } from "./characters";
import { pollPending } from "./generations";

const g = globalThis as unknown as { __hfPoller?: NodeJS.Timeout };
const INTERVAL_MS = 4000;

export function startPoller(): void {
  if (g.__hfPoller) return;
  let running = false;
  g.__hfPoller = setInterval(async () => {
    if (running) return;
    running = true;
    // Separate tries: a failing generation poll must not stop following trainings, and the reverse.
    try {
      await pollPending();
    } catch (err) {
      console.error("[poller]", err);
    }
    try {
      await pollCharacters();
    } catch (err) {
      console.error("[poller]", err);
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
  g.__hfPoller.unref?.();
}
