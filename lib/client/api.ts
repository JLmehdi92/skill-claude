import type { AppConfig, Generation, Stats } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public errors: string[],
    public body: unknown,
  ) {
    super(errors.join(" "));
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const errors = (body as { errors?: string[] } | null)?.errors ?? [`Erreur ${res.status}.`];
    throw new ApiError(res.status, errors, body);
  }
  return body as T;
}

export interface BudgetConflict {
  monthlyBudgetEur: number;
  spentEur: number;
  estimateEur: number;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  stats: () => request<Stats>("/api/stats"),
  credits: () => request<{ credits: number; eur: number }>("/api/credits"),
  list: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return request<{ items: Generation[]; nextCursor: number | null }>(`/api/generations?${q}`);
  },
  get: (id: string) => request<Generation>(`/api/generations/${id}`),
  generate: (form: FormData) => request<Generation>("/api/generate", { method: "POST", body: form }),
  retry: (id: string, confirmOverBudget = false) =>
    request<Generation>(`/api/generations/${id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmOverBudget }),
    }),
  favorite: (id: string, favorite: boolean) =>
    request<Generation>(`/api/generations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }),
  remove: (id: string) => request<{ ok: true }>(`/api/generations/${id}`, { method: "DELETE" }),
  importTask: (taskId: string) =>
    request<Generation>("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    }),
  setBudget: (monthlyBudgetEur: number | null) =>
    request<{ monthlyBudgetEur: number | null }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyBudgetEur }),
    }),
};

/** Lets the nav budget gauge and the spending page refresh when costs change. */
export const STATS_EVENT = "hf:stats-changed";
export const notifyStatsChanged = () => window.dispatchEvent(new Event(STATS_EVENT));
