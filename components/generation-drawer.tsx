"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { toast } from "sonner";
import { ArrowClockwise, Check, Copy, DownloadSimple, FilmStrip, Heart, LockSimple, MagicWand, Shuffle, Trash, Warning, X } from "@phosphor-icons/react";
import { api, ApiError } from "@/lib/client/api";
import { copyText } from "@/lib/client/clipboard";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { formatCredits, formatEur } from "@/lib/costs";
import { getModel, inferMode } from "@/lib/models/registry";
import { isPending, type Generation } from "@/lib/types";
import { Button, buttonClass, cx, Tally } from "./ui";

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
        <Drawer.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Drawer.Content
          className={
            desktop
              ? "fixed top-2 right-2 bottom-2 z-50 flex w-[min(540px,calc(100vw-16px))] flex-col overflow-hidden rounded-sheet border border-line-strong bg-surface shadow-float outline-none"
              : "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-sheet border-t border-line-strong bg-surface pb-[env(safe-area-inset-bottom)] shadow-float outline-none"
          }
          aria-describedby={undefined}
        >
          {!desktop && <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-edge" />}
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
  // Which value was just copied: its button shows a check for a moment.
  const [copied, setCopied] = useState<string | null>(null);
  // Id of the generation just added to the motion gallery (the drawer can switch generation).
  const [savedMotion, setSavedMotion] = useState<string | null>(null);
  const [savingMotion, setSavingMotion] = useState(false);
  const saveMotion = async () => {
    setSavingMotion(true);
    try {
      await api.motionFromGeneration(gen.id);
      setSavedMotion(gen.id);
      toast.success("Ajoutée aux mouvements", { description: "Retrouve-la dans Copier un mouvement, bouton Galerie." });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.errors[0] : "Ajout impossible. Réessaie.");
    } finally {
      setSavingMotion(false);
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) {
      toast.success(`${what} copié`);
      setCopied(what);
    } else toast.error("Copie impossible sur ce navigateur. Sélectionne le texte à la main.");
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
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-4">
        <Drawer.Title className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
          {gen.modelLabel}
          <span aria-live="polite" className={cx("flex items-center gap-1.5 font-normal", gen.status === "failed" ? "text-danger" : "text-muted")}>
            {isPending(gen.status) && <Tally />}
            {STATUS[gen.status]}
          </span>
        </Drawer.Title>
        <button type="button" onClick={onClose} aria-label="Fermer" className="pressable flex size-11 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Letterbox: pure black in both themes, the frame is judged on black like a monitor. */}
        <div className="bg-black">
          {gen.status === "success" && output?.kind === "video" && (
            <video key={output.url} src={output.url} poster={gen.thumbUrl ?? undefined} controls autoPlay muted loop playsInline className="mx-auto max-h-[46dvh] w-full sm:max-h-[56vh]" />
          )}
          {gen.status === "success" && output?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={output.url} alt={gen.prompt.slice(0, 120)} className="max-h-[56vh] w-full object-contain" />
          )}
          {gen.status === "success" && output?.kind === "audio" && <audio src={output.url} controls className="w-full p-4" />}
          {isPending(gen.status) && <div className="shimmer aspect-video w-full" />}
          {gen.status === "failed" && (
            <div className="bg-surface px-4 py-6">
              <p className="flex items-center gap-2 text-sm font-medium text-danger">
                <Warning size={18} weight="bold" />
                La génération a échoué
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{gen.error}</p>
            </div>
          )}
        </div>

        {/* Phones: two columns of 44px buttons; from sm, one row. */}
        <div className="grid grid-cols-2 gap-2 border-b border-line p-3 sm:flex sm:flex-wrap sm:px-4">
          <Button variant="primary" size="sm" onClick={() => onRemix(gen)} title="Recharge le prompt, les réglages et les références">
            <MagicWand size={16} />
            Remix
          </Button>
          {seed !== null && (
            <Button size="sm" onClick={() => onRemix(gen, true)} title="Recharge tout avec ce seed fixé : retouche le prompt en gardant la même prise">
              <LockSimple size={16} />
              Même seed
            </Button>
          )}
          <Button size="sm" onClick={() => onVariant(gen)} title="Relance avec les mêmes réglages et un nouveau seed">
            <Shuffle size={16} />
            Variante
          </Button>
          <Button size="sm" onClick={() => onRetry(gen)} title="Relance à l'identique, même seed">
            <ArrowClockwise size={16} />
            Relancer
          </Button>
          {output && (
            <a href={`${output.url}?download`} className={buttonClass("secondary", "sm")}>
              <DownloadSimple size={16} />
              Télécharger
            </a>
          )}
          {gen.status === "success" && output?.kind === "video" && (
            <Button
              size="sm"
              // aria-disabled, not disabled: focus stays on the button once the video is added.
              onClick={() => savedMotion !== gen.id && !savingMotion && void saveMotion()}
              aria-disabled={savedMotion === gen.id || savingMotion}
              aria-busy={savingMotion}
              className="aria-disabled:opacity-60"
            >
              {savedMotion === gen.id ? <Check size={16} weight="bold" /> : <FilmStrip size={16} />}
              {savedMotion === gen.id ? "Dans les mouvements" : "Ajouter aux mouvements"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onFavorite(gen)} aria-label="Favori" aria-pressed={gen.favorite} className="max-sm:col-span-full">
            <Heart size={16} weight={gen.favorite ? "fill" : "regular"} className={gen.favorite ? "check-in text-fg" : undefined} key={String(gen.favorite)} />
            {gen.favorite ? "Favori" : "Ajouter aux favoris"}
          </Button>
        </div>

        {gen.prompt && (
          <section className="space-y-2 px-4 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] text-faint">Prompt</h3>
              <button
                type="button"
                onClick={() => copy(gen.prompt, "Prompt")}
                className="pressable -my-2 -mr-2 flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted hover:bg-hover hover:text-fg sm:h-8"
              >
                <CopyIcon done={copied === "Prompt"} />
                <span className="grid [&>*]:col-start-1 [&>*]:row-start-1">
                  <span className="swap" data-on={copied !== "Prompt"} aria-hidden={copied === "Prompt"}>
                    Copier
                  </span>
                  <span className="swap" data-on={copied === "Prompt"} aria-hidden={copied !== "Prompt"}>
                    Copié
                  </span>
                </span>
              </button>
            </div>
            <p className="max-h-60 overflow-y-auto text-[15px] leading-relaxed whitespace-pre-wrap text-fg sm:text-sm">{gen.prompt}</p>
          </section>
        )}

        {gen.inputs.length > 0 && (
          <section className="px-4 pb-4">
            <h3 className="pb-2 text-[13px] text-faint">Références</h3>
            <ul className="flex flex-wrap gap-2">
              {gen.inputs.map((i) => (
                <li key={i.url}>
                  <a href={i.url} target="_blank" rel="noreferrer" title={i.name} className="block overflow-hidden rounded-control border border-line-strong bg-sunken">
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

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-4 text-sm">
          <Detail label="Coût" value={gen.costEur !== null ? formatEur(gen.costEur) : `≈ ${formatEur(gen.estimatedEur)} (estimé)`} strong />
          <Detail label="Crédits" value={formatCredits(gen.credits ?? gen.estimatedCredits)} />
          {rows.map(([label, value]) => (
            <Detail key={label} label={label} value={value} />
          ))}
          {seed !== null && (
            <div className="min-w-0">
              <dt className="text-xs text-faint">Seed{seedAuto ? " (auto)" : ""}</dt>
              <dd>
                <button
                  type="button"
                  onClick={() => copy(String(seed), "Seed")}
                  title="Copier le seed"
                  className="-mx-1 mt-0.5 flex min-h-11 max-w-full items-center gap-1.5 rounded-item px-1 text-muted hover:bg-hover hover:text-fg sm:min-h-8"
                >
                  <span className="truncate">{seed}</span>
                  <CopyIcon done={copied === "Seed"} />
                </button>
              </dd>
            </div>
          )}
          <Detail label="Créée le" value={dateFmt.format(gen.createdAt)} />
          {gen.completedAt && <Detail label="Terminée le" value={dateFmt.format(gen.completedAt)} />}
          <Detail label="Taux USD/EUR" value={gen.usdEurRate.toFixed(4)} />
          {gen.kieTaskId && (
            <div className="col-span-2 min-w-0">
              <dt className="text-xs text-faint">Tâche kie.ai</dt>
              <dd>
                <button
                  type="button"
                  onClick={() => copy(gen.kieTaskId!, "Identifiant")}
                  className="-mx-1 mt-0.5 flex min-h-11 max-w-full items-center gap-1.5 rounded-item px-1 font-mono text-xs text-muted hover:bg-hover hover:text-fg sm:min-h-8"
                >
                  <span className="truncate">{gen.kieTaskId}</span>
                  <CopyIcon done={copied === "Identifiant"} />
                </button>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="shrink-0 border-t border-line p-3 sm:px-4">
        <button
          type="button"
          className="hold pressable relative h-12 w-full touch-manipulation overflow-hidden rounded-control border border-danger/40 text-sm font-medium text-danger select-none sm:h-10"
          onPointerDown={() => {
            holdTimer.current = setTimeout(() => onDelete(gen), 1200);
          }}
          onPointerUp={() => clearTimeout(holdTimer.current)}
          onPointerLeave={() => clearTimeout(holdTimer.current)}
          onPointerCancel={() => clearTimeout(holdTimer.current)}
          onContextMenu={(e) => e.preventDefault()}
          // Keyboard: hold Enter or Space, same 1.2 s as a finger, so deleting stays deliberate.
          onKeyDown={(e) => {
            if ((e.key !== "Enter" && e.key !== " ") || e.repeat) return;
            e.preventDefault();
            e.currentTarget.dataset.holding = "";
            holdTimer.current = setTimeout(() => onDelete(gen), 1200);
          }}
          onKeyUp={(e) => {
            delete e.currentTarget.dataset.holding;
            clearTimeout(holdTimer.current);
          }}
          onBlur={(e) => {
            delete e.currentTarget.dataset.holding;
            clearTimeout(holdTimer.current);
          }}
          aria-describedby="hold-hint"
        >
          <span aria-hidden className="hold-overlay absolute inset-0 bg-danger/15" />
          <span className="relative flex items-center justify-center gap-1.5">
            <Trash size={16} />
            Maintenir pour supprimer
          </span>
          <span id="hold-hint" className="sr-only">
            Garde le doigt ou la touche Entrée enfoncé une seconde. Les fichiers sont effacés, le coût reste dans les dépenses.
          </span>
        </button>
      </div>
    </>
  );
}

/** Copy icon that turns into a check for a moment after copying. */
function CopyIcon({ done }: { done: boolean }) {
  return done ? <Check key="done" size={14} weight="bold" className="check-in shrink-0 text-accent" /> : <Copy key="copy" size={14} className="shrink-0" />;
}

function Detail({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={cx("mt-0.5 truncate", strong ? "font-medium text-fg" : "text-muted")} title={value}>
        {value}
      </dd>
    </div>
  );
}
