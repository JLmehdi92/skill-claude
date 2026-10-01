"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, notifyStatsChanged } from "./api";
import { isPending, type Generation } from "@/lib/types";

type Filters = Record<string, string | number | undefined>;

/**
 * Loads generations for the given filters and keeps pending ones fresh.
 * The server advances tasks on its own timer; this only re-reads them.
 */
export function useGenerations(filters: Filters, pageSize = 40) {
  const [items, setItems] = useState<Generation[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);
  const loading = loadedKey !== key;
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    api
      .list({ ...JSON.parse(key), limit: pageSize })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setCursor(res.nextCursor);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoadedKey(key));
    return () => {
      cancelled = true;
    };
  }, [key, pageSize]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const res = await api.list({ ...JSON.parse(key), limit: pageSize, before: cursor });
    setItems((prev) => [...prev, ...res.items.filter((g) => !prev.some((p) => p.id === g.id))]);
    setCursor(res.nextCursor);
  }, [cursor, key, pageSize]);

  const hasPending = items.some((g) => isPending(g.status));
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(async () => {
      const pending = itemsRef.current.filter((g) => isPending(g.status));
      if (!pending.length) return;
      try {
        const res = await api.list({ ids: pending.map((g) => g.id).join(","), limit: pending.length });
        let costChanged = false;
        for (const fresh of res.items) {
          const old = pending.find((p) => p.id === fresh.id);
          if (!old || isPending(fresh.status)) continue;
          costChanged = true;
          if (fresh.status === "success") toast.success(`${fresh.modelLabel} : génération prête`, { description: truncate(fresh.prompt, 70) });
          else toast.error("Génération échouée", { description: fresh.error ?? undefined });
        }
        setItems((prev) => prev.map((g) => res.items.find((f) => f.id === g.id) ?? g));
        if (costChanged) notifyStatsChanged();
      } catch {
        // keep polling
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [hasPending]);

  const upsert = useCallback((g: Generation) => {
    setItems((prev) => (prev.some((p) => p.id === g.id) ? prev.map((p) => (p.id === g.id ? g : p)) : [g, ...prev]));
  }, []);
  const removeLocal = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.id !== id)), []);

  return { items, loading, error, hasMore: cursor !== null, loadMore, upsert, removeLocal };
}

export function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}
