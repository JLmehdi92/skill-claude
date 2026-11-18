import "server-only";
import { config } from "@/lib/server/config";
import { realHiggsfieldClient, type CharacterClient } from "@/lib/higgsfield/client";
import { realKieClient } from "./client";
import { mockCharacterClient, mockKieClient } from "./mock";
import type { KieClient } from "./types";

export function kie(): KieClient {
  return config.mock ? mockKieClient() : realKieClient(config.kieApiKey);
}

/** Soul ID training (Higgsfield only): file uploads plus character creation and polling. */
export function characterClient(): Pick<KieClient, "uploadFile"> & CharacterClient {
  if (config.mock) return { ...mockKieClient(), ...mockCharacterClient() };
  return realHiggsfieldClient(config.hfApiKey, config.hfApiBaseUrl);
}

/** The client of the provider that runs this model (kie.ai unless the model says Higgsfield). */
export function clientFor(model: { provider?: "kie" | "higgsfield" } | undefined): KieClient {
  if (config.mock) return mockKieClient();
  return model?.provider === "higgsfield" ? realHiggsfieldClient(config.hfApiKey, config.hfApiBaseUrl) : realKieClient(config.kieApiKey);
}

export { KieError } from "./types";
export type { KieTask } from "./types";
