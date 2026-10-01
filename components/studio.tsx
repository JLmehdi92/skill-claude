"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useGenerations } from "@/lib/client/use-generations";
import type { AppConfig, Generation } from "@/lib/types";
import { Composer, type ComposerHandle } from "./composer";
import { GenerationCard } from "./generation-card";
import { GenerationDrawer } from "./generation-drawer";
import { useGenerationActions } from "./use-generation-actions";

const EXAMPLES = [
  "Plan-séquence au steadicam dans une ruelle de Tokyo sous la pluie. Les néons se reflètent sur le bitume, une femme en imperméable jaune avance vers la caméra.",
  "Macro d'une goutte de café qui tombe dans une tasse en céramique, éclaboussure au ralenti, lumière du matin rasante.",
  "Un drone survole les falaises d'Étretat au coucher du soleil puis plonge vers les vagues. Son du vent et de la mer.",
  "Pub produit : une sneaker blanche tourne sur un socle, un faisceau de lumière balaye le cuir, fond studio gris anthracite.",
];

export function Studio() {
  const composer = useRef<ComposerHandle>(null);
  const router = useRouter();
  const search = useSearchParams();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [selected, setSelected] = useState<Generation | null>(null);
  const { items, loading, upsert, removeLocal, hasMore, loadMore } = useGenerations({}, 30);
  const actions = useGenerationActions({ upsert, removeLocal, setSelected });

  useEffect(() => {
    api.config().then(setCfg).catch(() => setCfg({ mock: false, hasKey: false, nsfwCheckerDefault: false, monthlyBudgetEur: null }));
    api
      .stats()
      .then((s) => setRate(s.usdEurRate))
      .catch(() => setRate(0.86));
  }, []);

  // /?remix=<id> loads a generation from the history into the composer.
  const remixId = search.get("remix");
  useEffect(() => {
    if (!remixId || !cfg) return;
    api
      .get(remixId)
      .then((g) => composer.current?.loadFrom(g))
      .catch(() => toast.error("Génération introuvable."))
      .finally(() => router.replace("/", { scroll: false }));
  }, [remixId, cfg, router]);

  const remix = useCallback((g: Generation) => {
    setSelected(null);
    void composer.current?.loadFrom(g);
  }, []);

  // Keep the open drawer in sync with polling updates.
  const live = selected ? (items.find((g) => g.id === selected.id) ?? selected) : null;

  return (
    <main className="mx-auto max-w-[1600px] px-4 pt-6 pb-72 sm:px-6">
      {!loading && items.length === 0 && (
        <section className="fade-in max-w-2xl pt-[8vh]">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">Qu&apos;est-ce qu&apos;on tourne aujourd&apos;hui ?</h1>
          <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-muted">
            Écris un prompt, ajoute des références et lance Wan 3.0. Chaque vidéo est enregistrée sur ta machine avec son coût.
          </p>
          <ul className="mt-8 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => composer.current?.setPrompt(ex)}
                  className="pressable h-full w-full rounded-[var(--radius-tile)] border border-line bg-surface p-4 text-left text-sm leading-relaxed text-muted hover:border-line-strong hover:text-fg"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && items.length === 0 && (
        <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 2xl:columns-4" aria-busy="true">
          {[16 / 9, 9 / 16, 1, 16 / 9, 4 / 3, 16 / 9].map((r, i) => (
            <div key={i} className="shimmer mb-3 rounded-[var(--radius-tile)]" style={{ aspectRatio: r }} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <>
          <h1 className="sr-only">Créer</h1>
          <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 2xl:columns-4">
            {items.map((g) => (
              <GenerationCard key={g.id} gen={g} onOpen={() => setSelected(g)} onRetry={() => void actions.retry(g)} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={() => void loadMore()} className="pressable rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-fg">
                Afficher plus
              </button>
            </div>
          )}
        </>
      )}

      {cfg && rate !== null && (
        <Composer ref={composer} usdEurRate={rate} nsfwDefault={cfg.nsfwCheckerDefault} onSubmitted={(g) => upsert(g)} />
      )}

      <GenerationDrawer
        gen={live}
        onClose={() => setSelected(null)}
        onRemix={remix}
        onRetry={(g) => void actions.retry(g)}
        onFavorite={(g) => void actions.favorite(g)}
        onDelete={(g) => void actions.remove(g)}
      />
      {actions.budgetModal}
    </main>
  );
}
