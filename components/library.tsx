"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DownloadSimple, Heart, MagnifyingGlass, CloudArrowDown } from "@phosphor-icons/react";
import { api } from "@/lib/client/api";
import { useGenerations } from "@/lib/client/use-generations";
import type { Generation } from "@/lib/types";
import { GenerationCard } from "./generation-card";
import { GenerationDrawer } from "./generation-drawer";
import { Button, Chip, cx, Modal } from "./ui";
import { useGenerationActions } from "./use-generation-actions";

const CATEGORIES = [
  { value: "", label: "Tout" },
  { value: "video", label: "Vidéo" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
];
const STATUSES = [
  { value: "", label: "Tous les statuts" },
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
    <main className="mx-auto max-w-[1600px] px-3 pt-6 pb-16 sm:px-6 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Historique</h1>
          <p className="mt-1 text-sm text-muted">Toutes tes générations, stockées en local avec leurs fichiers.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <CloudArrowDown size={14} />
            Importer de kie.ai
          </Button>
          <a href="/api/export?format=json" className="pressable inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 text-[13px] font-medium hover:bg-hover">
            <DownloadSimple size={14} />
            Sauvegarde JSON
          </a>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-auto sm:min-w-56 sm:flex-1 sm:max-w-80">
          <span className="sr-only">Rechercher dans les prompts</span>
          <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un prompt"
            className="h-10 w-full rounded-full border border-line bg-raised pr-3 pl-8 text-base placeholder:text-faint focus:border-accent focus:outline-none sm:h-8 sm:text-[13px]"
          />
        </label>
        <Segmented options={CATEGORIES} value={category} onChange={setCategory} label="Type" />
        <Segmented options={STATUSES} value={status} onChange={setStatus} label="Statut" />
        <Segmented options={PERIODS} value={period} onChange={choosePeriod} label="Période" />
        <Chip active={favorite} aria-pressed={favorite} onClick={() => setFavorite((f) => !f)}>
          <Heart size={14} weight={favorite ? "fill" : "regular"} />
          Favoris
        </Chip>
      </div>

      <div className="mt-6">
        {error && <p className="text-sm text-danger">{error}</p>}
        {loading && items.length === 0 && (
          <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 2xl:columns-4">
            {[16 / 9, 1, 9 / 16, 16 / 9].map((r, i) => (
              <div key={i} className="shimmer mb-3 rounded-[var(--radius-tile)]" style={{ aspectRatio: r }} />
            ))}
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="max-w-md py-16">
            <p className="text-lg font-medium">{filtered ? "Aucun résultat" : "Rien pour l'instant"}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {filtered ? "Essaie d'autres filtres ou un autre mot-clé." : "Tes générations apparaîtront ici dès ton premier lancement."}
            </p>
            {!filtered && (
              <Button variant="primary" size="sm" className="mt-4" onClick={() => router.push("/")}>
                Créer une vidéo
              </Button>
            )}
          </div>
        )}
        {items.length > 0 && (
          <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 2xl:columns-4">
            {items.map((g) => (
              <GenerationCard key={g.id} gen={g} onOpen={() => setSelected(g)} onRetry={() => void actions.retry(g)} />
            ))}
          </div>
        )}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <Button size="sm" variant="ghost" onClick={() => void loadMore()}>
              Afficher plus
            </Button>
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

function Segmented({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="scrollbar-none flex h-9 max-w-full items-center overflow-x-auto rounded-full border border-line bg-raised p-0.5 sm:h-8">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-full rounded-full px-3 text-[13px] whitespace-nowrap transition-colors duration-150",
            o.value === value ? "bg-hover text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
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
        <label htmlFor="task-id" className="text-sm text-muted">
          Identifiant de tâche (taskId), visible dans ton historique kie.ai
        </label>
        <input
          id="task-id"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          autoFocus
          className="mt-2 h-11 w-full rounded-full border border-line-strong bg-canvas px-4 font-mono text-base focus:border-accent focus:outline-none sm:h-10 sm:text-sm"
        />
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !taskId.trim()}>
            {busy ? "Import" : "Importer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
