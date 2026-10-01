import type { Category, MediaKind, Params } from "./models/types";

export type Status = "uploading" | "queued" | "generating" | "success" | "failed";

export interface InputFile {
  slot: string;
  name: string;
  kind: MediaKind;
  mime: string;
  url: string;
  duration?: number;
}

export interface OutputFile {
  url: string;
  kind: Category;
}

export interface Generation {
  id: string;
  model: string;
  modelLabel: string;
  category: Category;
  status: Status;
  prompt: string;
  params: Params;
  inputs: InputFile[];
  outputs: OutputFile[];
  thumbUrl: string | null;
  estimatedCredits: number;
  estimatedEur: number;
  credits: number | null;
  costUsd: number | null;
  costEur: number | null;
  usdEurRate: number;
  error: string | null;
  progress: number | null;
  favorite: boolean;
  kieTaskId: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface SpendBucket {
  key: string;
  label: string;
  eur: number;
  count: number;
}

export interface Stats {
  today: number;
  week: number;
  month: number;
  total: number;
  pendingEur: number;
  pendingCount: number;
  successCount: number;
  failedCount: number;
  monthlyBudgetEur: number | null;
  byModel: SpendBucket[];
  byCategory: SpendBucket[];
  daily: { date: string; eur: number; count: number }[];
  usdEurRate: number;
  rateSource: "ecb" | "cache" | "fallback";
}

export interface AppConfig {
  mock: boolean;
  hasKey: boolean;
  nsfwCheckerDefault: boolean;
  monthlyBudgetEur: number | null;
}

export const PENDING: Status[] = ["uploading", "queued", "generating"];
export const isPending = (s: Status) => PENDING.includes(s);
