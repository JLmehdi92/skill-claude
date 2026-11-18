import "server-only";
import path from "node:path";

/** Read lazily so tests and the e2e server can set env vars before first use. */
export const config = {
  get kieApiKey() {
    return process.env.KIE_API_KEY?.trim() ?? "";
  },
  /** The complete key copied from open.higgsfield.ai, as-is (sent as "Key <key>"). */
  get hfApiKey() {
    return process.env.HF_API_KEY?.trim() ?? "";
  },
  get hfApiBaseUrl() {
    // https only, no trailing slash: the key goes to this host.
    const url = process.env.HF_API_BASE_URL?.trim().replace(/\/+$/, "");
    return url?.startsWith("https://") ? url : "https://api.higgsfield.ai";
  },
  get mock() {
    return process.env.KIE_MOCK === "1";
  },
  get nsfwCheckerDefault() {
    return process.env.KIE_NSFW_CHECKER === "true";
  },
  get usdEurFallback() {
    const n = Number(process.env.USD_EUR_RATE);
    return Number.isFinite(n) && n > 0 ? n : 0.86;
  },
  /** Skip the network call for the exchange rate (tests, offline use). */
  get offlineRate() {
    return process.env.KIE_OFFLINE_RATE === "1";
  },
  get storageDir() {
    // Local app, never deployed: skip output tracing for this user-chosen path.
    return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || "storage");
  },
};
