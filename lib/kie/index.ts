import "server-only";
import { config } from "@/lib/server/config";
import { realKieClient } from "./client";
import { mockKieClient } from "./mock";
import type { KieClient } from "./types";

export function kie(): KieClient {
  return config.mock ? mockKieClient() : realKieClient(config.kieApiKey);
}

export { KieError } from "./types";
export type { KieTask } from "./types";
