"use client";

import { useRef } from "react";
import { Drawer } from "vaul";
import { toast } from "sonner";
import { ArrowClockwise, Copy, DownloadSimple, Heart, LockSimple, MagicWand, Shuffle, Trash, X } from "@phosphor-icons/react";
import { copyText } from "@/lib/client/clipboard";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { formatCredits, formatEur } from "@/lib/costs";
import { getModel, inferMode } from "@/lib/models/registry";
import { isPending, type Generation } from "@/lib/types";
import { Button } from "./ui";

const STATUS: Record<string, string> = {
  uploading: "Envoi des références",
  queued: "En file d'attente",
  generating: "En cours",
  success: "Terminée",
  failed: "Échouée",
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length)) return "Aucun";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (key === "duration") return Number(value) === -1 ? "Auto" : `${value} s`;
  if (key === "aspect_ratio" && value === "adaptive") return "Auto";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function GenerationDrawer({
  gen,
  onClose,
  onRemix,
  onRetry,
  onVariant,
  onFavorite,
  onDelete,
}: {
  gen: Generation | null;
  onClose: () => void;
  /** keepSeed: reload with the same seed (retouch the prompt, keep the take). */
  onRemix: (g: Generation, keepSeed?: boolean) => void;
  onRetry: (g: Generation) => void;
  /** Same parameters, new random seed. */
  onVariant: (g: Generation) => void;
  onFavorite: (g: Generation) => void;
  onDelete: (g: Generation) => void;
}) {
  // Phones get a bottom sheet (swipe down to close), larger screens a side panel.
  const desktop = useMediaQuery("(min-width: 640px)");
  return (
    <Drawer.Root open={gen !== null} onOpenChange={(o) => !o && onClose()} direction={desktop ? "right" : "bottom"}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content
          className={
            desktop
              ? "fixed top-2 right-2 bottom-2 z-50 flex w-[min(540px,calc(100vw-16px))] flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line-strong bg-surface outline-none"
              : "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[20px] border-t border-line-strong bg-surface pb-[env(safe-area-inset-bottom)] outline-none"
          }
          aria-describedby={undefined}
        >
          {!desktop && <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
          {gen && <DrawerBody gen={gen} onClose={onClose} onRemix={onRemix} onRetry={onRetry} onVariant={onVariant} onFavorite={onFavorite} onDelete={onDelete} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function DrawerBody({
  gen,
  onClose,
  onRemix,
  onRetry,
  onVariant,
  onFavorite,
  onDelete,
}: {
  gen: Generation;
  onClose: () => void;
  /** keepSeed: reload with the same seed (retouch the prompt, keep the take). */
  onRemix: (g: Generation, keepSeed?: boolean) => void;
  onRetry: (g: Generation) => void;
  /** Same parameters, new random seed. */
  onVariant: (g: Generation) => void;
  onFavorite: (g: Generation) => void;
  onDelete: (g: Generation) => void;
}) {
  const model = getModel(gen.model);
  const output = gen.outputs[0];
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copié`);
    else toast.error("Copie impossible sur ce navigateur. Sélectionne le texte à la main.");
  };

  const seed = typeof gen.params.seed === "number" ? gen.params.seed : null;
  const seedAuto = gen.params.seed_auto === true;
  const mode = model ? inferMode(model, gen.params, gen.inputs.map((i) => i.slot)) : undefined;
  const fieldRows: [string, string][] = model
    ? model.fields
        .filter((f) => f.type !== "seed" && !(mode?.hiddenFields ?? []).includes(f.key))
        .map((f): [string, string] => [
          f.label,
          f.type === "select"
            ? (f.options.find((o) => o.value === gen.params[f.key])?.label ?? formatValue(f.key, gen.params[f.key]))
            : formatValue(f.key, gen.params[f.key]),
        ])
    : Object.entries(gen.params)
        .filter(([k]) => !["prompt", "seed", "seed_auto", "mode"].includes(k))
        .map(([k, v]): [string, string] => [k, formatValue(k, v)]);
  const rows: [string, string][] = mode ? [["Mode", mode.label], ...fieldRows] : fieldRows;

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 sm:h-14">
        <Drawer.Title className="text-[15px] font-medium">
          {gen.modelLabel} <span className="font-normal text-faint">{STATUS[gen.status]}</span>
        </Drawer.Title>
        <button type="button" onClick={onClose} aria-label="Fermer" className="pressable rounded-full p-2 text-muted hover:bg-raised hover:text-fg">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="bg-canvas">
          {gen.status === "success" && output?.kind === "video" && (
            <video key={output.url} src={output.url} poster={gen.thumbUrl ?? undefined} controls autoPlay muted loop playsInline className="max-h-[46dvh] w-full bg-black sm:max-h-[56vh]" />
          )}
          {gen.status === "success" && output?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={output.url} alt={gen.prompt.slice(0, 120)} className="max-h-[56vh] w-full object-contain" />
          )}
          {gen.status === "success" && output?.kind === "audio" && <audio src={output.url} controls className="w-full p-4" />}
          {isPending(gen.status) && <div className="shimmer aspect-video w-full" />}
          {gen.status === "failed" && (
            <div className="px-5 py-8">
              <p className="text-sm font-medium text-danger">La génération a échoué</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{gen.error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <Button variant="primary" size="sm" onClick={() => onRemix(gen)} title="Recharge le prompt, les réglages et les références">
            <MagicWand size={14} />
            Remix
          </Button>
          {seed !== null && (
            <Button size="sm" onClick={() => onRemix(gen, true)} title="Recharge tout avec ce seed fixé : retouche le prompt en gardant la même prise">
              <LockSimple size={14} />
              Même seed
            </Button>
          )}
          <Button size="sm" onClick={() => onVariant(gen)} title="Relance avec les mêmes réglages et un nouveau seed">
            <Shuffle size={14} />
            Variante
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRetry(gen)} title="Relance à l'identique, même seed">
            <ArrowClockwise size={14} />
            Relancer
          </Button>
          {output && (
            <a href={`${output.url}?download`} className="pressable inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 text-[13px] font-medium hover:bg-hover">
              <DownloadSimple size={14} />
              Télécharger
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={() => onFavorite(gen)} aria-pressed={gen.favorite}>
            <Heart size={14} weight={gen.favorite ? "fill" : "regular"} />
            {gen.favorite ? "Favori" : "Ajouter aux favoris"}
          </Button>
        </div>

        <section className="space-y-2 px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] text-faint">Prompt</h3>
            <button type="button" onClick={() => copy(gen.prompt, "Prompt")} className="pressable flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg">
              <Copy size={12} />
              Copier
            </button>
          </div>
          <p className="max-h-60 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-fg">{gen.prompt}</p>
        </section>

        {gen.inputs.length > 0 && (
          <section className="px-4 pb-4">
            <h3 className="pb-2 text-[13px] text-faint">Références</h3>
            <ul className="flex flex-wrap gap-2">
              {gen.inputs.map((i) => (
                <li key={i.url}>
                  <a href={i.url} target="_blank" rel="noreferrer" title={i.name} className="block overflow-hidden rounded-[var(--radius-tile)] border border-line bg-raised">
                    {i.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.url} alt={i.name} className="size-16 object-cover" />
                    ) : (
                      <span className="flex size-16 items-center justify-center p-1 text-center text-[10px] leading-tight break-all text-muted">{i.name}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-4 text-sm">
          <Detail label="Coût" value={gen.costEur !== null ? formatEur(gen.costEur) : `≈ ${formatEur(gen.estimatedEur)} (estimé)`} strong />
          <Detail label="Crédits" value={formatCredits(gen.credits ?? gen.estimatedCredits)} />
          {rows.map(([label, value]) => (
            <Detail key={label} label={label} value={value} />
          ))}
          {seed !== null && (
            <div className="min-w-0">
              <p className="text-[12px] text-faint">Seed{seedAuto ? " (auto)" : ""}</p>
              <button
                type="button"
                onClick={() => copy(String(seed), "Seed")}
                title="Copier le seed"
                className="mt-0.5 flex max-w-full items-center gap-1.5 text-muted tabular-nums hover:text-fg"
              >
                <span className="truncate">{seed}</span>
                <Copy size={12} className="shrink-0" />
              </button>
            </div>
          )}
          <Detail label="Créée le" value={dateFmt.format(gen.createdAt)} />
          {gen.completedAt && <Detail label="Terminée le" value={dateFmt.format(gen.completedAt)} />}
          <Detail label="Taux USD/EUR" value={gen.usdEurRate.toFixed(4)} />
          {gen.kieTaskId && (
            <div className="col-span-2">
              <p className="text-[12px] text-faint">Tâche kie.ai</p>
              <button type="button" onClick={() => copy(gen.kieTaskId!, "Identifiant")} className="mt-0.5 max-w-full truncate font-mono text-xs text-muted hover:text-fg">
                {gen.kieTaskId}
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        <button
          type="button"
          className="hold pressable relative w-full touch-manipulation overflow-hidden rounded-full border border-danger/30 py-3 text-[13px] text-danger select-none sm:py-2"
          onPointerDown={() => {
            holdTimer.current = setTimeout(() => onDelete(gen), 1200);
          }}
          onPointerUp={() => clearTimeout(holdTimer.current)}
          onPointerLeave={() => clearTimeout(holdTimer.current)}
          onPointerCancel={() => clearTimeout(holdTimer.current)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Delete" || e.key === "Backspace") onDelete(gen);
          }}
        >
          <span aria-hidden className="hold-overlay absolute inset-0 bg-danger/20" />
          <span className="relative flex items-center justify-center gap-1.5">
            <Trash size={14} />
            Maintenir pour supprimer
          </span>
        </button>
      </div>
    </>
  );
}

function Detail({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-faint">{label}</p>
      <p className={`mt-0.5 truncate tabular-nums ${strong ? "font-medium text-fg" : "text-muted"}`} title={value}>
        {value}
      </p>
    </div>
  );
}
