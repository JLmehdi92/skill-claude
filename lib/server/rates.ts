import "server-only";
import { config } from "./config";
import { getSetting, setSetting } from "./db";

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

const DAY = 24 * 60 * 60 * 1000;
const SOURCES = [
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR",
  "https://api.frankfurter.app/latest?from=USD&to=EUR",
];

/** USD -> EUR from the European Central Bank (via frankfurter), cached 24 h. */
export async function getUsdEurRate(): Promise<{ rate: number; source: "ecb" | "cache" | "fallback" }> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < DAY) return { rate: cached.rate, source: "cache" };
  if (!config.offlineRate) {
    for (const url of SOURCES) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        const body = (await res.json()) as { rates?: { EUR?: number } };
        const rate = body.rates?.EUR;
        if (res.ok && typeof rate === "number" && rate > 0) {
          setSetting("usd_eur_rate", JSON.stringify({ rate, fetchedAt: Date.now() } satisfies CachedRate));
          return { rate, source: "ecb" };
        }
      } catch {
        // try the next source
      }
    }
  }
  if (cached) return { rate: cached.rate, source: "cache" };
  return { rate: config.usdEurFallback, source: "fallback" };
}

function readCache(): CachedRate | null {
  const raw = getSetting("usd_eur_rate");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as CachedRate;
    return v.rate > 0 ? v : null;
  } catch {
    return null;
  }
}
