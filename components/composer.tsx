"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CaretDown,
  Clock,
  CornersOut,
  DiceFive,
  File as FileIcon,
  FilmStrip,
  Image as ImageIcon,
  MusicNotes,
  Plus,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { api, ApiError, notifyStatsChanged, type BudgetConflict } from "@/lib/client/api";
import { creditsToEur, formatCredits, formatEur } from "@/lib/costs";
import { MODELS, summarizeMedia, validateRequest } from "@/lib/models/registry";
import type { Field, MediaKind, MediaSlot, ModelDefinition, Params } from "@/lib/models/types";
import type { Generation } from "@/lib/types";
import { Button, Chip, cx, Kbd, MenuItem, Modal, Popover, Switch } from "./ui";

interface Attachment {
  id: string;
  slot: string;
  file: File;
  url: string;
  kind: MediaKind;
  duration?: number;
}

export interface ComposerHandle {
  loadFrom(gen: Generation): Promise<void>;
  setPrompt(prompt: string): void;
}

const SLOT_ICONS: Record<MediaKind, typeof ImageIcon> = { image: ImageIcon, video: FilmStrip, audio: MusicNotes, document: FileIcon };
const DURATION_PRESETS = [-1, 3, 5, 8, 10, 15, 20, 30];

function measureDuration(file: File, kind: MediaKind): Promise<number | undefined> {
  if (kind !== "video" && kind !== "audio") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    const done = (v?: number) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

function kindOf(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export const Composer = forwardRef<
  ComposerHandle,
  { usdEurRate: number; nsfwDefault: boolean; onSubmitted: (g: Generation) => void }
>(function Composer({ usdEurRate, nsfwDefault, onSubmitted }, ref) {
  const [model, setModel] = useState<ModelDefinition>(MODELS[0]);
  const [params, setParams] = useState<Params>({ ...MODELS[0].defaults, nsfw_checker: nsfwDefault });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetConflict | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<MediaSlot | null>(null);

  const set = useCallback((key: string, value: unknown) => {
    setParams((p) => ({ ...p, [key]: value }));
    setServerErrors([]);
  }, []);

  // Keep the textarea sized to its content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.32)}px`;
  }, [params.prompt]);

  const metas = useMemo(() => attachments.map((a) => ({ slot: a.slot, size: a.file.size, duration: a.duration })), [attachments]);
  const media = useMemo(() => summarizeMedia(metas), [metas]);
  const check = useMemo(() => validateRequest(model, params, metas), [model, params, metas]);
  const estimate = useMemo(() => model.estimate(params, media), [model, params, media]);
  const estimateEur = creditsToEur(estimate.credits, usdEurRate);

  const visibleErrors = useMemo(() => {
    if (serverErrors.length) return serverErrors;
    if (check.ok) return [];
    return triedSubmit ? check.errors : check.errors.filter((e) => e !== "Écris un prompt.");
  }, [check, serverErrors, triedSubmit]);

  const addFiles = useCallback(
    async (files: File[], forcedSlot?: MediaSlot) => {
      const next: Attachment[] = [];
      for (const file of files) {
        const kind = kindOf(file);
        const slot =
          forcedSlot ??
          model.mediaSlots.find((s) => {
            if (s.kind !== kind) return false;
            if (s.key === "first_frame" || s.key === "last_frame") return false; // frames only via the menu
            return true;
          });
        if (!slot) {
          toast.error(`Type de fichier non pris en charge : ${file.name}`);
          continue;
        }
        const used = attachments.filter((a) => a.slot === slot.key).length + next.filter((a) => a.slot === slot.key).length;
        if (used >= slot.max) {
          toast.error(`${slot.label} : ${slot.max} maximum.`);
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          slot: slot.key,
          file,
          url: URL.createObjectURL(file),
          kind: slot.kind,
          duration: await measureDuration(file, slot.kind),
        });
      }
      if (next.length) {
        setAttachments((prev) => [...prev, ...next]);
        setServerErrors([]);
      }
    },
    [attachments, model.mediaSlots],
  );

  const removeAttachment = (id: string) =>
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((a) => a.id !== id);
    });

  const tagFor = (a: Attachment) => {
    const slot = model.mediaSlots.find((s) => s.key === a.slot);
    if (!slot?.tagPrefix) return null;
    const index = attachments.filter((x) => x.slot === a.slot).indexOf(a);
    return `@${slot.tagPrefix}${index + 1}`;
  };

  const insertTag = (tag: string) => {
    const el = textareaRef.current;
    const prompt = String(params.prompt);
    const start = el?.selectionStart ?? prompt.length;
    const end = el?.selectionEnd ?? prompt.length;
    const before = prompt.slice(0, start);
    const insert = `${before && !before.endsWith(" ") ? " " : ""}${tag} `;
    set("prompt", before + insert + prompt.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + insert.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const submit = useCallback(
    async (confirmOverBudget = false) => {
      setTriedSubmit(true);
      if (!check.ok || submitting) return;
      setSubmitting(true);
      setServerErrors([]);
      const form = new FormData();
      form.set("model", model.id);
      form.set("params", JSON.stringify(check.params));
      form.set("meta", JSON.stringify(attachments.map((a) => ({ slot: a.slot, duration: a.duration }))));
      for (const a of attachments) form.append("file", a.file, a.file.name);
      if (confirmOverBudget) form.set("confirmOverBudget", "1");
      try {
        const gen = await api.generate(form);
        setBudget(null);
        setTriedSubmit(false);
        onSubmitted(gen);
        notifyStatsChanged();
        toast.success("Génération lancée", { description: `${model.label}, ${estimate.upperBound ? "jusqu'à " : "≈ "}${formatEur(estimateEur)}` });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setBudget((err.body as { budget: BudgetConflict }).budget);
        } else if (err instanceof ApiError) {
          setServerErrors(err.errors);
        } else {
          setServerErrors([(err as Error).message]);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [attachments, check, estimate.upperBound, estimateEur, model, onSubmitted, submitting],
  );

  // Cmd/Ctrl+Enter submits from anywhere, "/" focuses the prompt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      } else if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  // Drop files anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void addFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  useImperativeHandle(ref, () => ({
    async loadFrom(gen) {
      const def = MODELS.find((m) => m.id === gen.model) ?? model;
      setModel(def);
      setParams({ ...def.defaults, ...gen.params });
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
      const restored: Attachment[] = [];
      for (const input of gen.inputs) {
        try {
          const blob = await fetch(input.url).then((r) => r.blob());
          const file = new File([blob], input.name, { type: input.mime });
          restored.push({ id: crypto.randomUUID(), slot: input.slot, file, url: URL.createObjectURL(file), kind: input.kind, duration: input.duration });
        } catch {
          toast.error(`Référence introuvable : ${input.name}`);
        }
      }
      setAttachments(restored);
      setServerErrors([]);
      setTriedSubmit(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    setPrompt(prompt) {
      set("prompt", prompt);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }));

  const openPicker = (slot: MediaSlot) => {
    pendingSlot.current = slot;
    const input = fileInputRef.current!;
    input.accept = slot.accept;
    input.multiple = slot.max > 1;
    input.click();
  };

  const mainFields = model.fields.filter((f) => !f.advanced);
  const advancedFields = model.fields.filter((f) => f.advanced);
  const promptLength = String(params.prompt).length;

  return (
    <>
      {dragging && (
        <div className="fade-in pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
          <div className="rounded-[var(--radius-surface)] border border-dashed border-accent/60 px-10 py-8 text-center">
            <p className="text-lg font-medium">Dépose tes références</p>
            <p className="mt-1 text-sm text-muted">Images, vidéos, audio ou document</p>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-canvas via-canvas/90 to-transparent px-2 pt-10 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="pointer-events-auto mx-auto max-w-[880px] rounded-[var(--radius-surface)] border border-line-strong bg-surface/95 transition-[border-color] duration-200 focus-within:border-white/25 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] backdrop-blur-xl"
        >
          {attachments.length > 0 && (
            <ul className="scrollbar-none flex gap-2 overflow-x-auto px-3 pt-3.5 pb-1" aria-label="Références jointes">
              {attachments.map((a) => (
                <AttachmentThumb
                  key={a.id}
                  attachment={a}
                  label={tagFor(a) ?? model.mediaSlots.find((s) => s.key === a.slot)?.label ?? a.slot}
                  isTag={tagFor(a) !== null}
                  onInsert={() => {
                    const tag = tagFor(a);
                    if (tag) insertTag(tag);
                  }}
                  onRemove={() => removeAttachment(a.id)}
                />
              ))}
            </ul>
          )}

          <label htmlFor="prompt" className="sr-only">
            Prompt
          </label>
          <textarea
            id="prompt"
            ref={textareaRef}
            value={String(params.prompt)}
            onChange={(e) => set("prompt", e.target.value)}
            rows={2}
            maxLength={model.promptMaxLength}
            placeholder="Décris ta scène. Cite tes références avec @Image1, @Video1..."
            className="block max-h-[28vh] min-h-[60px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-base leading-relaxed text-fg placeholder:text-faint focus:outline-none sm:max-h-[32vh] sm:text-[15px]"
          />

          {visibleErrors.length > 0 && (
            <ul className="space-y-0.5 px-4 pb-2 text-[13px] text-danger" role="alert">
              {visibleErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {/* Mobile: settings wrap on their own rows so none hide off-screen, actions get a full row. */}
          <div className="flex flex-col gap-2.5 border-t border-line px-2.5 py-2.5 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex flex-wrap items-center gap-1.5 sm:scrollbar-none sm:-my-1 sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:overflow-x-auto sm:px-0.5 sm:py-1">
              <AddMenu model={model} attachments={attachments} params={params} onPick={openPicker} />
              <ModelMenu model={model} />
              {mainFields.map((f) => (
                <FieldControl key={f.key} field={f} value={params[f.key]} onChange={(v) => set(f.key, v)} />
              ))}
              {advancedFields.length > 0 && <AdvancedMenu fields={advancedFields} params={params} onChange={set} />}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end sm:pl-1">
              <div className="pl-1.5 leading-tight sm:pl-0 sm:text-right" title={`1 crédit = 0,005 $. Taux USD/EUR : ${usdEurRate.toFixed(4)}`}>
                <div className="text-sm font-medium tabular-nums">
                  {estimate.upperBound ? "≤ " : "≈ "}
                  {formatEur(estimateEur)}
                </div>
                <div className="text-[11px] text-faint tabular-nums">{formatCredits(estimate.credits)}</div>
              </div>
              <Button type="submit" variant="primary" size="md" disabled={submitting} aria-label="Générer" className="h-11 min-w-36 sm:h-9 sm:min-w-0 sm:pr-3">
                {submitting ? "Envoi" : "Générer"}
                <span className="hidden sm:inline-flex">
                  <Kbd className="border-on-accent/20 text-on-accent/70">⌘↵</Kbd>
                </span>
              </Button>
            </div>
          </div>
          {promptLength > model.promptMaxLength * 0.9 && (
            <p className="px-4 pb-2 text-right text-[11px] text-faint tabular-nums">
              {promptLength} / {model.promptMaxLength}
            </p>
          )}
        </form>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length && pendingSlot.current) void addFiles(files, pendingSlot.current);
        }}
      />

      <Modal open={budget !== null} onClose={() => setBudget(null)} title="Budget mensuel dépassé">
        {budget && (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Ce mois-ci : <span className="text-fg tabular-nums">{formatEur(budget.spentEur)}</span> engagés sur{" "}
              <span className="text-fg tabular-nums">{formatEur(budget.monthlyBudgetEur)}</span>. Cette génération coûterait{" "}
              <span className="text-fg tabular-nums">{formatEur(budget.estimateEur)}</span> de plus.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBudget(null)}>
                Annuler
              </Button>
              <Button variant="primary" onClick={() => void submit(true)} disabled={submitting}>
                Lancer quand même
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
});

function AttachmentThumb({
  attachment: a,
  label,
  isTag,
  onInsert,
  onRemove,
}: {
  attachment: Attachment;
  label: string;
  isTag: boolean;
  onInsert: () => void;
  onRemove: () => void;
}) {
  const Icon = SLOT_ICONS[a.kind];
  return (
    <li className="fade-in group relative shrink-0">
      <button
        type="button"
        onClick={onInsert}
        disabled={!isTag}
        title={isTag ? `Insérer ${label} dans le prompt` : a.file.name}
        aria-label={isTag ? `Insérer ${label} dans le prompt` : `${label} : ${a.file.name}`}
        className="pressable block overflow-hidden rounded-[var(--radius-tile)] border border-line bg-raised"
      >
        <div className="flex size-16 items-center justify-center">
          {a.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt="" className="size-full object-cover" />
          ) : a.kind === "video" ? (
            <video src={a.url} muted preload="metadata" className="size-full object-cover" />
          ) : (
            <Icon size={22} className="text-muted" />
          )}
        </div>
        <span className="block border-t border-line px-1.5 py-1 text-center text-[11px] text-muted">
          {label}
          {a.duration !== undefined && <span className="text-faint"> {Math.round(a.duration)} s</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${a.file.name}`}
        className="pressable absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-line-strong bg-hover text-muted hover:text-fg"
      >
        <X size={10} weight="bold" />
      </button>
    </li>
  );
}

function AddMenu({
  model,
  attachments,
  params,
  onPick,
}: {
  model: ModelDefinition;
  attachments: Attachment[];
  params: Params;
  onPick: (slot: MediaSlot) => void;
}) {
  const count = (key: string) => attachments.filter((a) => a.slot === key).length;
  const usesFrames = count("first_frame") + count("last_frame") > 0;
  const usesRefs = count("reference_image") > 0 || count("reference_file") > 0 || (params.reference_link_urls as string[] | undefined)?.length;
  const blocked = (slot: MediaSlot): string | null => {
    if (count(slot.key) >= slot.max) return "complet";
    if ((slot.key === "first_frame" || slot.key === "last_frame") && usesRefs) return "incompatible";
    if ((slot.key === "reference_image" || slot.key === "reference_file") && usesFrames) return "incompatible";
    if (slot.key === "last_frame" && !count("first_frame")) return "début d'abord";
    return null;
  };
  return (
    <Popover
      trigger={({ open, toggle, id }) => (
        <Chip onClick={toggle} active={open} aria-expanded={open} aria-controls={id} aria-label="Ajouter une référence" className="px-2.5">
          <Plus size={14} weight="bold" />
        </Chip>
      )}
    >
      {(close) => (
        <div className="w-full sm:w-64">
          {model.mediaSlots.map((slot) => {
            const Icon = SLOT_ICONS[slot.kind];
            const reason = blocked(slot);
            return (
              <MenuItem
                key={slot.key}
                disabled={reason !== null}
                onClick={() => {
                  close();
                  onPick(slot);
                }}
                hint={reason ?? `${count(slot.key)}/${slot.max}`}
                title={slot.hint}
              >
                <Icon size={16} />
                {slot.label}
              </MenuItem>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function ModelMenu({ model }: { model: ModelDefinition }) {
  return (
    <Popover
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open} aria-expanded={open}>
          <Sparkle size={14} weight="fill" className="text-accent" />
          <span className="text-fg">{model.label}</span>
          <CaretDown size={11} />
        </Chip>
      )}
    >
      {(close) => (
        <div className="w-full sm:w-72">
          {MODELS.map((m) => (
            <MenuItem key={m.id} selected={m.id === model.id} onClick={close} className="items-start">
              <span className="flex flex-col gap-0.5">
                <span className="text-fg">
                  {m.label} <span className="text-faint">{m.vendor}</span>
                </span>
                <span className="text-xs leading-snug text-faint">{m.description}</span>
              </span>
            </MenuItem>
          ))}
          <p className="px-2.5 pt-2 pb-1 text-[11px] text-faint">D&apos;autres modèles arrivent via le registre.</p>
        </div>
      )}
    </Popover>
  );
}

function FieldControl({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === "toggle") {
    const on = value === true;
    const Icon = field.key === "audio" ? (on ? SpeakerHigh : SpeakerSlash) : Sparkle;
    return (
      <Chip onClick={() => onChange(!on)} active={on} aria-pressed={on} title={field.hint}>
        <Icon size={14} />
        {field.label}
      </Chip>
    );
  }
  if (field.type === "select") {
    const current = field.options.find((o) => o.value === value);
    const Icon = field.key === "aspect_ratio" ? CornersOut : null;
    return (
      <Popover
        trigger={({ open, toggle }) => (
          <Chip onClick={toggle} active={open} aria-expanded={open} aria-label={`${field.label} : ${current?.label}`}>
            {Icon && <Icon size={14} />}
            {current?.label ?? field.label}
            <CaretDown size={11} />
          </Chip>
        )}
      >
        {(close) => (
          <div className="w-full sm:w-40">
            <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">{field.label}</p>
            {field.options.map((o) => (
              <MenuItem
                key={o.value}
                selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                {o.label}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
    );
  }
  if (field.type === "duration") {
    const v = Number(value);
    return (
      <Popover
        trigger={({ open, toggle }) => (
          <Chip onClick={toggle} active={open} aria-expanded={open} aria-label={`Durée : ${v === -1 ? "auto" : `${v} secondes`}`}>
            <Clock size={14} />
            {v === -1 ? "Auto" : `${v} s`}
            <CaretDown size={11} />
          </Chip>
        )}
      >
        {() => (
          <div className="w-full p-1 sm:w-64">
            <p className="px-1.5 pb-2 text-[11px] text-faint">Durée de la vidéo</p>
            <div className="grid grid-cols-4 gap-1">
              {DURATION_PRESETS.filter((d) => d === -1 || (d >= field.min && d <= field.max)).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange(d)}
                  className={cx(
                    "pressable h-10 rounded-full text-[13px] tabular-nums sm:h-8",
                    d === v ? "bg-accent text-on-accent" : "bg-hover text-muted hover:text-fg",
                  )}
                >
                  {d === -1 ? "Auto" : `${d} s`}
                </button>
              ))}
            </div>
            <label className="mt-3 block px-1.5 text-[11px] text-faint" htmlFor="duration-range">
              Précis : {v === -1 ? "auto" : `${v} s`}
            </label>
            <input
              id="duration-range"
              type="range"
              min={field.min}
              max={field.max}
              value={v === -1 ? 5 : v}
              onChange={(e) => onChange(Number(e.target.value))}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
            {field.allowAuto && <p className="px-1.5 pt-1 text-[11px] leading-snug text-faint">Auto : le modèle choisit, facturé jusqu&apos;à 30 s.</p>}
          </div>
        )}
      </Popover>
    );
  }
  return null;
}

function AdvancedMenu({ fields, params, onChange }: { fields: Field[]; params: Params; onChange: (k: string, v: unknown) => void }) {
  const changed = fields.some((f) => (f.type === "seed" ? params[f.key] !== null : f.type === "links" ? (params[f.key] as string[]).length > 0 : false));
  return (
    <Popover
      align="end"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open || changed} aria-expanded={open} aria-label="Réglages avancés">
          <SlidersHorizontal size={14} />
          Avancé
        </Chip>
      )}
    >
      {() => (
        <div className="w-full space-y-4 p-2.5 sm:w-80">
          {fields.map((f) => {
            if (f.type === "seed") {
              const seed = params[f.key] as number | null;
              return (
                <div key={f.key} className="space-y-1.5">
                  <label htmlFor="seed" className="text-[13px] text-fg">
                    {f.label}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="seed"
                      inputMode="numeric"
                      value={seed ?? ""}
                      placeholder="Aléatoire"
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                        onChange(f.key, digits ? Math.min(Number(digits), 2_147_483_647) : null);
                      }}
                      className="h-9 min-w-0 flex-1 rounded-full border border-line-strong bg-canvas px-3 text-base tabular-nums sm:h-8 sm:text-[13px] placeholder:text-faint focus:border-accent focus:outline-none"
                    />
                    <Chip onClick={() => onChange(f.key, Math.floor(Math.random() * 2_147_483_647))} aria-label="Seed au hasard">
                      <DiceFive size={14} />
                    </Chip>
                  </div>
                  <p className="text-[11px] text-faint">Même seed et mêmes réglages : résultat reproductible.</p>
                </div>
              );
            }
            if (f.type === "toggle") {
              return (
                <div key={f.key} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] text-fg">{f.label}</p>
                    {f.hint && <p className="mt-0.5 text-[11px] leading-snug text-faint">{f.hint}</p>}
                  </div>
                  <Switch checked={params[f.key] === true} onChange={(v) => onChange(f.key, v)} label={f.label} />
                </div>
              );
            }
            if (f.type === "links") {
              const links = params[f.key] as string[];
              return (
                <div key={f.key} className="space-y-1.5">
                  <label htmlFor={`link-${f.key}`} className="text-[13px] text-fg">
                    {f.label}
                  </label>
                  <input
                    id={`link-${f.key}`}
                    type="url"
                    value={links[0] ?? ""}
                    placeholder="https://"
                    onChange={(e) => onChange(f.key, e.target.value.trim() ? [e.target.value.trim()] : [])}
                    className="h-9 w-full rounded-full border border-line-strong bg-canvas px-3 text-base placeholder sm:h-8 sm:text-[13px]:text-faint focus:border-accent focus:outline-none"
                  />
                  {f.hint && <p className="text-[11px] leading-snug text-faint">{f.hint}</p>}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </Popover>
  );
}
