"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudArrowDown, DownloadSimple, Heart, MagnifyingGlass, X } from "@phosphor-icons/react";
import { api } from "@/lib/client/api";
import { useGenerations } from "@/lib/client/use-generations";
import type { Generation } from "@/lib/types";
import { GenerationCard } from "./generation-card";
import { GenerationDrawer } from "./generation-drawer";
import { Button, buttonClass, Chip, cx, fieldClass, Modal, ModalActions, Segmented } from "./ui";
import { useGenerationActions } from "./use-generation-actions";

const CATEGORIES = [
  { value: "", label: "Tout" },
  { value: "video", label: "Vidéo" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
];
const STATUSES = [
  { value: "", label: "Tous" },
  { value: "success", label: "Réussies" },
  { value: "pending", label: "En cours" },
  { value: "failed", label: "Échouées" },
];
const PERIODS = [
  { value: "", label: "Toujours" },
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
];

export function Library() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [selected, setSelected] = useState<Generation | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const [from, setFrom] = useState<number | undefined>();
  const choosePeriod = (v: string) => {
    setPeriod(v);
    setFrom(v ? Date.now() - Number(v) * 86_400_000 : undefined);
  };

  const { items, loading, error, hasMore, loadMore, upsert, removeLocal } = useGenerations({
    q,
    category,
    status,
    favorite: favorite ? 1 : undefined,
    from,
  });
  const actions = useGenerationActions({ upsert, removeLocal, setSelected });
  const live = selected ? (items.find((g) => g.id === selected.id) ?? selected) : null;
  const filtered = Boolean(q || category || status || favorite || period);

  return (
    <main className="mx-auto max-w-[1600px] px-3 pt-5 pb-16 sm:px-6 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-wide text-[32px] leading-tight">Historique</h1>
          <p className="mt-1 text-sm text-muted">Toutes tes générations, stockées en local avec leurs fichiers.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <CloudArrowDown size={16} />
            Importer de kie.ai
          </Button>
          <a href="/api/export?format=json" className={buttonClass("secondary", "sm")}>
            <DownloadSimple size={16} />
            Sauvegarde JSON
          </a>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative lg:w-72">
          <label htmlFor="library-search" className="sr-only">
            Rechercher dans les prompts
          </label>
          <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
          <input
            id="library-search"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Rechercher un prompt"
            className={cx(fieldClass, "pl-10", query && "pr-11")}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Effacer la recherche"
              className="pressable absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-item text-muted hover:text-fg sm:size-9"
            >
              <X size={16} weight="bold" />
            </button>
          )}
        </div>
        {/* Phones: one full-width row per filter, period and favourites share the last one. */}
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <Segmented options={CATEGORIES} value={category} onChange={setCategory} label="Type" />
          <Segmented options={STATUSES} value={status} onChange={setStatus} label="Statut" />
          <div className="flex gap-2 sm:col-span-2 lg:contents">
            <Segmented options={PERIODS} value={period} onChange={choosePeriod} label="Période" className="flex-1 lg:flex-none" />
            <Chip active={favorite} aria-pressed={favorite} onClick={() => setFavorite((f) => !f)}>
              <Heart key={String(favorite)} size={16} weight={favorite ? "fill" : "regular"} className="check-in" />
              Favoris
            </Chip>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {loading && items.length === 0 && (
          <div className="columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4 2xl:columns-5">
            {[9 / 16, 1, 16 / 9, 9 / 16].map((r, i) => (
              <div key={i} className="shimmer mb-2 rounded-panel sm:mb-3" style={{ aspectRatio: r }} />
            ))}
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="max-w-md py-12">
            <p className="font-wide text-xl">{filtered ? "Aucun résultat" : "Rien pour l'instant"}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {filtered ? "Essaie d'autres filtres ou un autre mot-clé." : "Tes générations apparaîtront ici dès ton premier lancement."}
            </p>
            {!filtered && (
              <Button variant="primary" className="mt-4" onClick={() => router.push("/")}>
                Créer une vidéo
              </Button>
            )}
          </div>
        )}
        {items.length > 0 && (
          <div className="columns-2 gap-2 sm:columns-3 sm:gap-3 lg:columns-4 2xl:columns-5">
            {items.map((g) => (
              <GenerationCard key={g.id} gen={g} onOpen={() => setSelected(g)} onRetry={() => void actions.retry(g)} />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <Button onClick={() => void loadMore()}>Afficher plus</Button>
          </div>
        )}
      </div>

      <GenerationDrawer
        gen={live}
        onClose={() => setSelected(null)}
        onRemix={(g, keepSeed) => router.push(`/?remix=${g.id}${keepSeed ? "&seed=1" : ""}`)}
        onRetry={(g) => void actions.retry(g)}
        onVariant={(g) => void actions.retry(g, { newSeed: true })}
        onFavorite={(g) => void actions.favorite(g)}
        onDelete={(g) => void actions.remove(g)}
      />
      {actions.budgetModal}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={(g) => upsert(g)} />
    </main>
  );
}

function ImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (g: Generation) => void }) {
  const [taskId, setTaskId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!taskId.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const g = await api.importTask(taskId.trim());
      onImported(g);
      toast.success("Tâche importée dans l'historique");
      setTaskId("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Importer une tâche kie.ai">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="task-id" className="text-sm leading-relaxed text-muted">
          Identifiant de tâche (taskId), visible dans ton historique kie.ai
        </label>
        <input
          id="task-id"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          data-autofocus
          className={cx(fieldClass, "mt-2 font-mono")}
        />
        {err && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {err}
          </p>
        )}
        <ModalActions>
          <Button onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy || !taskId.trim()}>
            {busy ? "Import" : "Importer"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
