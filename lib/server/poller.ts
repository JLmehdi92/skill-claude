import "server-only";
import { pollPending } from "./generations";

const g = globalThis as unknown as { __hfPoller?: NodeJS.Timeout };
const INTERVAL_MS = 4000;

export function startPoller(): void {
  if (g.__hfPoller) return;
  let running = false;
  g.__hfPoller = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await pollPending();
    } catch (err) {
      console.error("[poller]", err);
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
  g.__hfPoller.unref?.();
}
