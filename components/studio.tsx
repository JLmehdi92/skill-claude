"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown } from "@phosphor-icons/react";
import { api } from "@/lib/client/api";
import { useGenerations } from "@/lib/client/use-generations";
import type { AppConfig, Generation } from "@/lib/types";
import { Composer, type ComposerHandle } from "./composer";
import { GenerationCard } from "./generation-card";
import { GenerationDrawer } from "./generation-drawer";
import { Button } from "./ui";
import { useGenerationActions } from "./use-generation-actions";

const EXAMPLES = [
  "Vidéo verticale face caméra : une jeune femme tient un flacon de sérum près de son visage et explique pourquoi elle l'utilise le matin. Lumière naturelle d'une fenêtre, filmé au téléphone.",
  "Unboxing vertical : un homme ouvre la boîte d'un casque audio sur la table de sa cuisine, gros plan sur ses mains puis sa réaction face caméra. Son d'ambiance de la pièce.",
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
  const remixKeepSeed = search.get("seed") === "1" ? true : undefined;
  useEffect(() => {
    if (!remixId || !cfg) return;
    api
      .get(remixId)
      .then((g) => composer.current?.loadFrom(g, { keepSeed: remixKeepSeed }))
      .catch(() => toast.error("Génération introuvable."))
      .finally(() => router.replace("/", { scroll: false }));
  }, [remixId, remixKeepSeed, cfg, router]);

  const remix = useCallback((g: Generation, keepSeed?: boolean) => {
    setSelected(null);
    void composer.current?.loadFrom(g, { keepSeed });
  }, []);

  // Keep the open drawer in sync with polling updates.
  const live = selected ? (items.find((g) => g.id === selected.id) ?? selected) : null;

  return (
    <main className="mx-auto max-w-[1600px] px-3 pt-3 pb-[26rem] sm:px-6 sm:pt-6 sm:pb-72">
      {!loading && items.length === 0 && (
        <section className="fade-in max-w-2xl pt-4 sm:pt-[6vh]">
          <h1 className="font-wide text-[32px] leading-[1.1] text-balance sm:text-[40px]">Décris la scène, Wan 3.0 la tourne.</h1>
          <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-muted">
            Écris un prompt, ajoute des références et lance Wan 3.0. Chaque vidéo est enregistrée sur ta machine avec son coût.
          </p>
          <h2 className="mt-8 text-sm font-medium text-fg">Partir d&apos;un exemple</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => composer.current?.setPrompt(ex)}
                  className="group flex w-full items-start gap-3 py-3.5 text-left text-[15px] leading-relaxed text-muted transition-colors duration-150 hover:text-fg sm:text-sm"
                >
                  <ArrowDown size={16} className="mt-1 shrink-0 text-faint transition-colors duration-150 group-hover:text-accent" />
                  <span>{ex}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && items.length === 0 && (
        <div className="columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4 2xl:columns-5" aria-busy="true">
          {[9 / 16, 16 / 9, 1, 9 / 16, 4 / 3, 16 / 9].map((r, i) => (
            <div key={i} className="shimmer mb-2 rounded-panel sm:mb-3" style={{ aspectRatio: r }} />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <>
          <h1 className="sr-only">Créer</h1>
          {/* UGC videos are vertical: two side by side on a phone. */}
          <div className="columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4 2xl:columns-5">
            {items.map((g) => (
              <GenerationCard key={g.id} gen={g} onOpen={() => setSelected(g)} onRetry={() => void actions.retry(g)} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <Button onClick={() => void loadMore()}>Afficher plus</Button>
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
        onVariant={(g) => void actions.retry(g, { newSeed: true })}
        onFavorite={(g) => void actions.favorite(g)}
        onDelete={(g) => void actions.remove(g)}
      />
      {actions.budgetModal}
    </main>
  );
}
