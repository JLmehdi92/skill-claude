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
import { kindOfFile } from "@/lib/models/media";
import { getMode, inferMode, MODELS, summarizeMedia, validateRequest } from "@/lib/models/registry";
import type { Field, MediaKind, MediaSlot, ModelDefinition, ModelMode, Params } from "@/lib/models/types";
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
  /** keepSeed: reuse the generation's seed; otherwise an automatic seed goes back to random. */
  loadFrom(gen: Generation, opts?: { keepSeed?: boolean }): Promise<void>;
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

const MODE_KEY = "hf:composer-mode";

function savedMode(model: ModelDefinition): string | undefined {
  if (!model.modes?.length) return undefined;
  try {
    const id = window.localStorage.getItem(MODE_KEY);
    if (id && getMode(model, id)) return id;
  } catch {
    // storage unavailable (private mode): fall back to the default mode
  }
  return model.modes[0].id;
}

function rememberMode(id: string | undefined) {
  if (!id) return;
  try {
    window.localStorage.setItem(MODE_KEY, id);
  } catch {
    // ignore
  }
}

function filled(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
}

export const Composer = forwardRef<
  ComposerHandle,
  { usdEurRate: number; nsfwDefault: boolean; onSubmitted: (g: Generation) => void }
>(function Composer({ usdEurRate, nsfwDefault, onSubmitted }, ref) {
  const [model, setModel] = useState<ModelDefinition>(MODELS[0]);
  const [params, setParams] = useState<Params>(() => ({ ...MODELS[0].defaults, nsfw_checker: nsfwDefault, mode: savedMode(MODELS[0]) }));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Source of truth for async adds: two quick drops must not both pass the per-slot limit.
  const attachmentsRef = useRef<Attachment[]>([]);
  const commitAttachments = useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);
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
    // "Missing something" messages wait for a submit attempt; conflicts show right away.
    return triedSubmit ? check.errors : check.errors.filter((e) => e !== "Écris un prompt." && !e.startsWith("Ajoute "));
  }, [check, serverErrors, triedSubmit]);

  const mode = getMode(model, params.mode);
  const slotByKey = useCallback((key: string) => model.mediaSlots.find((s) => s.key === key), [model.mediaSlots]);
  const modeOfSlot = (key: string) => model.modes?.find((m) => m.slots.includes(key));

  /**
   * Switches mode. Files and fields the new mode does not accept are taken out, with an
   * "Annuler" toast that puts everything back.
   */
  const switchMode = (id: string): ModelMode | undefined => {
    const next = getMode(model, id);
    if (!next || next.id === params.mode) return next;
    const prevMode = params.mode;
    const before = attachmentsRef.current;
    const removed = before.filter((a) => !next.slots.includes(a.slot));
    const cleared: Record<string, unknown> = {};
    for (const key of next.hiddenFields ?? []) if (filled(params[key])) cleared[key] = params[key];

    commitAttachments(before.filter((a) => next.slots.includes(a.slot)));
    setParams((p) => ({ ...p, mode: id, ...Object.fromEntries(Object.keys(cleared).map((k) => [k, model.defaults[k]])) }));
    rememberMode(id);
    setServerErrors([]);

    const lost = removed.length + Object.keys(cleared).length;
    if (lost > 0) {
      let restored = false;
      const parts = [
        removed.length ? `${removed.length} fichier${removed.length > 1 ? "s" : ""}` : "",
        Object.keys(cleared).length ? "le lien web" : "",
      ].filter(Boolean);
      toast(`Mode ${next.label}`, {
        description: `${parts.join(" et ")} retiré${lost > 1 ? "s" : ""} : pas disponible${lost > 1 ? "s" : ""} dans ce mode.`,
        action: {
          label: "Annuler",
          onClick: () => {
            restored = true;
            const added = attachmentsRef.current.filter((a) => !before.includes(a));
            commitAttachments([...before, ...added]);
            setParams((p) => ({ ...p, mode: prevMode, ...cleared }));
            rememberMode(prevMode as string | undefined);
          },
        },
        onDismiss: () => !restored && removed.forEach((a) => URL.revokeObjectURL(a.url)),
        onAutoClose: () => !restored && removed.forEach((a) => URL.revokeObjectURL(a.url)),
      });
    }
    return next;
  };

  const addFiles = async (files: File[], forcedSlot?: MediaSlot) => {
    if (!files.length) return;
    let target = mode;
    // Text mode takes no files: dropping some switches to the first mode that accepts them.
    if (!forcedSlot && target && target.slots.length === 0) {
      const fit = model.modes?.find((m) => files.some((f) => m.slots.some((k) => slotByKey(k)?.kind === kindOfFile(f.type, f.name))));
      if (fit) target = switchMode(fit.id);
    }
    const measured = await Promise.all(
      files.map(async (file) => {
        const kind = kindOfFile(file.type, file.name);
        return { file, kind, duration: await measureDuration(file, kind) };
      }),
    );

    const accepted: Attachment[] = [];
    for (const { file, kind, duration } of measured) {
      const candidates = forcedSlot
        ? [forcedSlot]
        : (target ? target.slots.map((k) => slotByKey(k)!) : model.mediaSlots).filter((s) => s.kind === kind);
      if (!candidates.length) {
        toast.error(`« ${file.name} » n'est pas accepté${target ? ` en mode ${target.label}` : ""}.`);
        continue;
      }
      if (forcedSlot && forcedSlot.kind !== kind) {
        toast.error(`${forcedSlot.label} : « ${file.name} » n'est pas du bon type.`);
        continue;
      }
      const all = [...attachmentsRef.current, ...accepted];
      const slot = candidates.find((s) => all.filter((a) => a.slot === s.key).length < s.max);
      if (!slot) {
        toast.error(`${candidates[0].label} : ${candidates[0].max} maximum.`);
        continue;
      }
      if (file.size > slot.maxBytes) {
        toast.error(`${slot.label} : « ${file.name} » dépasse ${Math.round(slot.maxBytes / 1024 / 1024)} Mo.`);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), slot: slot.key, file, url: URL.createObjectURL(file), kind, duration });
    }
    if (accepted.length) {
      commitAttachments([...attachmentsRef.current, ...accepted]);
      setServerErrors([]);
    }
  };

  const removeAttachment = (id: string) => {
    const gone = attachmentsRef.current.find((a) => a.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    commitAttachments(attachmentsRef.current.filter((a) => a.id !== id));
    setServerErrors([]);
  };

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

  // Drop files anywhere on the page. Listeners are bound once and call the latest addFiles.
  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });
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
      void addFilesRef.current([...(e.dataTransfer?.files ?? [])]);
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
  }, []);

  useImperativeHandle(ref, () => ({
    async loadFrom(gen, opts = {}) {
      const def = MODELS.find((m) => m.id === gen.model) ?? model;
      setModel(def);
      const { seed_auto: seedAuto, ...saved } = gen.params;
      const keepSeed = opts.keepSeed ?? seedAuto !== true;
      const restoredMode = inferMode(def, saved as Params, gen.inputs.map((i) => i.slot));
      setParams({ ...def.defaults, ...saved, mode: restoredMode?.id, ...(keepSeed ? {} : { seed: null }) } as Params);
      rememberMode(restoredMode?.id);
      attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.url));
      commitAttachments([]);
      const restored: Attachment[] = [];
      for (const input of gen.inputs) {
        try {
          const res = await fetch(input.url);
          if (!res.ok) throw new Error(String(res.status));
          const file = new File([await res.blob()], input.name, { type: input.mime });
          restored.push({ id: crypto.randomUUID(), slot: input.slot, file, url: URL.createObjectURL(file), kind: input.kind, duration: input.duration });
        } catch {
          toast.error(`Référence introuvable : ${input.name}`);
        }
      }
      commitAttachments(restored);
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

  /** Opens the file picker for a slot, switching to the mode that owns it first. */
  const pickSlot = (slot: MediaSlot) => {
    const owner = modeOfSlot(slot.key);
    if (owner && owner.id !== params.mode) switchMode(owner.id);
    openPicker(slot);
  };

  const hidden = new Set(mode?.hiddenFields ?? []);
  const mainFields = model.fields.filter((f) => !f.advanced && !hidden.has(f.key));
  const advancedFields = model.fields.filter((f) => f.advanced && !hidden.has(f.key));
  const frameSlots = mode?.id === "keyframes" ? mode.slots.map((k) => slotByKey(k)!).filter(Boolean) : [];
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
          {model.modes && mode && (
            <div className="flex items-center gap-3 px-2.5 pt-2.5">
              <ModeTabs modes={model.modes} value={mode.id} onChange={(id) => switchMode(id)} />
              <p className="hidden min-w-0 truncate text-xs text-faint sm:block" title={mode.hint}>
                {mode.hint}
              </p>
            </div>
          )}

          {frameSlots.length > 0 && (
            <ul className="flex gap-2 px-3 pt-3 pb-1" aria-label="Images clés">
              {frameSlots.map((slot) => {
                const a = attachments.find((x) => x.slot === slot.key);
                const needsFirst = slot.key !== frameSlots[0].key && !attachments.some((x) => x.slot === frameSlots[0].key);
                return a ? (
                  <AttachmentThumb
                    key={a.id}
                    attachment={a}
                    label={slot.shortLabel ?? slot.label}
                    isTag={false}
                    onInsert={() => {}}
                    onRemove={() => removeAttachment(a.id)}
                  />
                ) : (
                  <li key={slot.key}>
                    <button
                      type="button"
                      onClick={() => pickSlot(slot)}
                      disabled={needsFirst}
                      aria-label={`Ajouter l'${slot.label.toLowerCase()}`}
                      className="pressable flex w-[66px] flex-col items-center overflow-hidden rounded-[var(--radius-tile)] border border-dashed border-line-strong text-muted hover:border-accent/60 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="flex size-16 items-center justify-center">
                        <Plus size={16} />
                      </span>
                      <span className="w-full border-t border-dashed border-line-strong px-1 py-1 text-center text-[11px]">
                        {slot.shortLabel ?? slot.label}
                        {slot.key !== frameSlots[0].key && <span className="text-faint"> (option)</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {frameSlots.length === 0 && attachments.length > 0 && (
            <ul className="scrollbar-none flex gap-2 overflow-x-auto px-3 pt-3.5 pb-1" aria-label="Références jointes">
              {attachments.map((a) => (
                <AttachmentThumb
                  key={a.id}
                  attachment={a}
                  label={tagFor(a) ?? slotByKey(a.slot)?.shortLabel ?? slotByKey(a.slot)?.label ?? a.slot}
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
            placeholder={mode?.placeholder ?? "Décris ta scène. Cite tes références avec @Image1, @Video1..."}
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
              {(!mode || mode.id !== "keyframes") && <AddMenu model={model} mode={mode} attachments={attachments} params={params} onPick={pickSlot} />}
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

function ModeTabs({ modes, value, onChange }: { modes: ModelMode[]; value: string; onChange: (id: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = modes.findIndex((m) => m.id === value);
  const move = (delta: number) => {
    const next = (index + delta + modes.length) % modes.length;
    onChange(modes[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Mode de génération"
      className="flex h-9 shrink-0 items-center rounded-full border border-line bg-raised p-0.5 max-sm:w-full sm:h-8"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {modes.map((m, i) => (
        <button
          key={m.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={m.id === value}
          tabIndex={m.id === value ? 0 : -1}
          title={m.hint}
          onClick={() => onChange(m.id)}
          className={cx(
            "h-full rounded-full px-3 text-[13px] whitespace-nowrap transition-colors duration-150 max-sm:flex-1",
            m.id === value ? "bg-hover text-fg" : "text-muted hover:text-fg",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function AddMenu({
  model,
  mode,
  attachments,
  params,
  onPick,
}: {
  model: ModelDefinition;
  mode: ModelMode | undefined;
  attachments: Attachment[];
  params: Params;
  onPick: (slot: MediaSlot) => void;
}) {
  const count = (key: string) => attachments.filter((a) => a.slot === key).length;
  const hasLink = ((params.reference_link_urls as string[] | undefined) ?? []).length > 0;
  const blocked = (slot: MediaSlot): string | null => {
    if (count(slot.key) >= slot.max) return "complet";
    if (slot.key === "reference_file" && hasLink) return "lien web déjà choisi";
    return null;
  };
  // Current mode first; other modes' slots switch mode when picked. Without modes: every slot.
  const groups: { title?: string; switchTo?: string; slots: MediaSlot[] }[] = model.modes
    ? [...model.modes]
        .sort((a, b) => (a.id === mode?.id ? -1 : b.id === mode?.id ? 1 : 0))
        .filter((m) => m.slots.length > 0)
        .map((m) => ({
          title: m.id === mode?.id ? m.label : `${m.label} (change de mode)`,
          switchTo: m.id === mode?.id ? undefined : m.label,
          slots: m.slots.map((k) => model.mediaSlots.find((s) => s.key === k)!).filter(Boolean),
        }))
    : [{ slots: model.mediaSlots }];
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
          {groups.map((g) => (
            <div key={g.title ?? "all"} className="pb-1 last:pb-0">
              {g.title && <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">{g.title}</p>}
              {g.slots.map((slot) => {
                const Icon = SLOT_ICONS[slot.kind];
                const reason = g.switchTo ? null : blocked(slot);
                return (
                  <MenuItem
                    key={slot.key}
                    disabled={reason !== null}
                    onClick={() => {
                      close();
                      onPick(slot);
                    }}
                    hint={reason ?? (g.switchTo ? undefined : `${count(slot.key)}/${slot.max}`)}
                    title={slot.hint}
                  >
                    <Icon size={16} />
                    {slot.label}
                  </MenuItem>
                );
              })}
            </div>
          ))}
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
                    {seed !== null && (
                      <Chip onClick={() => onChange(f.key, null)} aria-label="Revenir à un seed aléatoire">
                        <X size={14} />
                      </Chip>
                    )}
                  </div>
                  <p className={cx("text-[11px] leading-snug", seed !== null ? "text-warn" : "text-faint")}>
                    {seed !== null
                      ? "Seed fixé : toutes tes générations l'utiliseront. Efface-le pour retrouver de la variété."
                      : "Vide : un seed aléatoire est tiré et enregistré dans l'historique pour chaque vidéo."}
                  </p>
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
