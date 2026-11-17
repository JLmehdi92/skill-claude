"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  CircleNotch,
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
import { newId } from "@/lib/client/id";
import { creditsToEur, formatCredits, formatEur } from "@/lib/costs";
import { kindOfFile } from "@/lib/models/media";
import { getMode, inferMode, MODELS, summarizeMedia, validateRequest } from "@/lib/models/registry";
import type { Field, MediaKind, MediaSlot, ModelDefinition, ModelMode, Params } from "@/lib/models/types";
import { PRESETS, getPreset } from "@/lib/presets/registry";
import { PRESET_CATEGORY_LABELS, type Preset, type PresetCategory } from "@/lib/presets/types";
import { enhancePrompt } from "@/lib/prompt-enhancer";
import type { Generation } from "@/lib/types";
import { Button, Chip, ChipCaret, cx, fieldClass, Kbd, MenuItem, Modal, ModalActions, onRadioArrows, Popover, Segmented, Stepper, Switch } from "./ui";

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

/**
 * Reads a video/audio duration in the browser. iOS Safari may never fire loadedmetadata for a
 * detached element, so this gives up after a few seconds (the server measures again with ffprobe).
 */
function measureDuration(file: File, kind: MediaKind): Promise<number | undefined> {
  if (kind !== "video" && kind !== "audio") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (v?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(undefined), 5000);
    el.preload = "metadata";
    el.muted = true;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
    el.load();
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
  // "Lancée" confirmation on the button for a moment after a successful submit.
  const [launched, setLaunched] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetConflict | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [enhanceEnabled, setEnhanceEnabled] = useState(false);
  const [showEnhanced, setShowEnhanced] = useState(false);
  // Announces a model switch (also said by the toast when files were removed).
  const [announce, setAnnounce] = useState("");
  const say = (text: string) => {
    // Cleared first so the same text twice in a row is announced again.
    setAnnounce("");
    requestAnimationFrame(() => setAnnounce(text));
  };
  // Only one "Annuler" is ever live: a newer change, a removal or a remix makes the older undo stale.
  const undoToast = useRef<string | number | undefined>(undefined);
  const dropUndo = () => {
    if (undoToast.current !== undefined) toast.dismiss(undoToast.current);
    undoToast.current = undefined;
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<MediaSlot | null>(null);

  const set = useCallback((key: string, value: unknown) => {
    setParams((p) => ({ ...p, [key]: value }));
    setServerErrors([]);
  }, []);

  // Caret position to restore once an inserted tag is in the DOM.
  const pendingCaret = useRef<number | null>(null);
  // Layout effect: runs right after the commit, before the next keystroke can land at the old caret.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || pendingCaret.current === null) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [params.prompt]);

  // Keep the textarea sized to its content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.32)}px`;
  }, [params.prompt]);

  const metas = useMemo(() => attachments.map((a) => ({ slot: a.slot, size: a.file.size, duration: a.duration })), [attachments]);
  const media = useMemo(() => summarizeMedia(metas), [metas]);
  // Presets and "Enrichir" only shape prompt-driven models. A model without prompt gets "" (the text stays for later).
  const promptDriven = model.promptUse === undefined;
  const sentPrompt = useMemo(() => {
    if (model.promptUse === "none") return "";
    if (!promptDriven) return String(params.prompt);
    const presets = selectedPresets.map(getPreset).filter((p): p is Preset => p !== undefined);
    return enhancePrompt(String(params.prompt), { presets, enhance: enhanceEnabled });
  }, [model.promptUse, promptDriven, params.prompt, selectedPresets, enhanceEnabled]);
  const sent = useMemo(() => ({ ...params, prompt: sentPrompt }), [params, sentPrompt]);
  const check = useMemo(() => validateRequest(model, sent, metas), [model, sent, metas]);
  const estimate = useMemo(() => model.estimate(sent, media), [model, sent, media]);
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
    dropUndo();
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
      undoToast.current = toast(`Mode ${next.label}`, {
        // Long enough to read and reach "Annuler".
        duration: 10_000,
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

  /**
   * Switches model. Files move to the new model's slot of the same kind when there is room;
   * the others are taken out, with an "Annuler" toast that puts everything back.
   */
  const switchModel = (id: string) => {
    const next = MODELS.find((m) => m.id === id);
    if (!next || next.id === model.id) return;
    dropUndo();
    const prevModel = model;
    const prevParams = params;
    const before = attachmentsRef.current;
    const kindOf = (key: string) => next.mediaSlots.find((s) => s.key === key)?.kind;
    // With modes, the first one that takes these files (Wan: Référence), else the remembered one.
    const nextMode = next.modes
      ? ((before.length ? next.modes.find((m) => before.some((a) => m.slots.some((k) => kindOf(k) === a.kind))) : undefined) ?? getMode(next, savedMode(next)))
      : undefined;
    const open = nextMode ? nextMode.slots : next.mediaSlots.map((s) => s.key);
    const kept: Attachment[] = [];
    const removed: Attachment[] = [];
    for (const a of before) {
      const slot = next.mediaSlots.find(
        (s) => open.includes(s.key) && s.kind === a.kind && a.file.size <= s.maxBytes && kept.filter((k) => k.slot === s.key).length < s.max,
      );
      if (slot) kept.push({ ...a, slot: slot.key });
      else removed.push(a);
    }
    const nsfw = next.fields.some((f) => f.key === "nsfw_checker") ? { nsfw_checker: nsfwDefault } : {};
    setModel(next);
    setParams({ ...next.defaults, ...nsfw, prompt: prevParams.prompt, mode: nextMode?.id });
    rememberMode(nextMode?.id);
    commitAttachments(kept);
    setServerErrors([]);
    setTriedSubmit(false);

    // The toast already says it when files were removed.
    if (!removed.length) return say(`Modèle : ${next.label}`);
    let restored = false;
    const n = removed.length;
    undoToast.current = toast(`Modèle ${next.label}`, {
      duration: 10_000,
      description: `${n} fichier${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""} : pas accepté${n > 1 ? "s" : ""} par ce modèle.`,
      action: {
        label: "Annuler",
        onClick: () => {
          restored = true;
          undoToast.current = undefined;
          // Kept files are copies sharing the originals' URLs: revoke only files added since.
          const restoredUrls = new Set(before.map((a) => a.url));
          attachmentsRef.current.filter((a) => !restoredUrls.has(a.url)).forEach((a) => URL.revokeObjectURL(a.url));
          setModel(prevModel);
          setParams(prevParams);
          rememberMode(prevParams.mode as string | undefined);
          commitAttachments(before);
          say(`Modèle : ${prevModel.label}`);
        },
      },
      onDismiss: () => !restored && removed.forEach((a) => URL.revokeObjectURL(a.url)),
      onAutoClose: () => !restored && removed.forEach((a) => URL.revokeObjectURL(a.url)),
    });
  };

  /** Never fails silently: any unexpected error ends up in a toast. */
  const addFiles = async (files: File[], forcedSlot?: MediaSlot) => {
    try {
      await addFilesUnsafe(files, forcedSlot);
    } catch (err) {
      console.error(err);
      toast.error("Impossible d'ajouter le fichier.", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const addFilesUnsafe = async (files: File[], forcedSlot?: MediaSlot) => {
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
      accepted.push({ id: newId(), slot: slot.key, file, url: URL.createObjectURL(file), kind, duration });
    }
    if (accepted.length) {
      commitAttachments([...attachmentsRef.current, ...accepted]);
      setServerErrors([]);
    }
  };

  const removeAttachment = (id: string) => {
    // The removed file's URL may be shared with an undo snapshot.
    dropUndo();
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
    pendingCaret.current = start + insert.length;
    set("prompt", before + insert + prompt.slice(end));
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
        setLaunched(true);
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

  useEffect(() => {
    if (!launched) return;
    const t = setTimeout(() => setLaunched(false), 1200);
    return () => clearTimeout(t);
  }, [launched]);

  // Cmd/Ctrl+Enter submits from anywhere, "/" focuses the prompt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      } else if (
        e.key === "/" &&
        textareaRef.current &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof Element && e.target.closest("[role=dialog]"))
      ) {
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
      dropUndo();
      setModel(def);
      // The saved prompt already includes any presets: applying them again would double them.
      setSelectedPresets([]);
      setEnhanceEnabled(false);
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
          restored.push({ id: newId(), slot: input.slot, file, url: URL.createObjectURL(file), kind: input.kind, duration: input.duration });
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
      // An example prompt is useless on a model without prompt: back to the first prompt-driven one.
      if (model.promptUse === "none") switchModel(MODELS[0].id);
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
  const keyframes = mode?.id === "keyframes";
  const frameSlots = keyframes ? mode.slots.map((k) => slotByKey(k)!).filter(Boolean) : model.tiles ? model.mediaSlots : [];
  const promptLength = model.promptUse === "none" ? 0 : String(params.prompt).length;
  const buttonState = submitting ? "sending" : launched ? "launched" : "idle";
  const estimateLabel =
    estimate.perSecond !== undefined
      ? `${formatEur(creditsToEur(estimate.perSecond, usdEurRate))}/s`
      : `${estimate.upperBound ? "≤ " : "≈ "}${formatEur(estimateEur)}`;

  return (
    <>
      {dragging && (
        <div className="fade-in pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-canvas/85 p-6">
          <div className="rounded-sheet border-2 border-dashed border-accent bg-surface px-10 py-8 text-center">
            <p className="font-wide text-xl">Dépose tes références</p>
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
          className="pointer-events-auto mx-auto max-h-[85dvh] max-w-[880px] overflow-y-auto overscroll-contain rounded-sheet border border-line-strong bg-surface shadow-float transition-[border-color] duration-200 focus-within:border-accent/50"
        >
          {model.modes && mode && (
            <div className="flex flex-col gap-1.5 px-2 pt-2 sm:flex-row sm:items-center sm:gap-3">
              <Segmented
                label="Mode de génération"
                options={model.modes.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
                value={mode.id}
                onChange={(id) => switchMode(id)}
                className="sm:w-[22rem] sm:shrink-0"
              />
              <p className="px-2 text-xs leading-snug text-faint sm:min-w-0 sm:px-0">{mode.hint}</p>
            </div>
          )}

          {frameSlots.length > 0 && (
            <ul className="flex gap-2 px-3 pt-3 pb-1" aria-label={keyframes ? "Images clés" : "Fichiers d'entrée"}>
              {frameSlots.map((slot) => {
                const a = attachments.find((x) => x.slot === slot.key);
                const needsFirst = keyframes && slot.key !== frameSlots[0].key && !attachments.some((x) => x.slot === frameSlots[0].key);
                return a ? (
                  <AttachmentThumb
                    key={a.id}
                    attachment={a}
                    wide
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
                      aria-label={slot.addLabel ?? `Ajouter l'${slot.label.toLowerCase()}`}
                      className="pressable flex w-[88px] flex-col items-center overflow-hidden rounded-control border border-dashed border-edge bg-raised text-muted hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex size-16 items-center justify-center">
                        <Plus size={18} />
                      </span>
                      <span className="w-full border-t border-dashed border-line-strong px-1 py-1 text-center text-xs">
                        {slot.shortLabel ?? slot.label}
                        {keyframes && slot.key !== frameSlots[0].key && <span className="block text-[11px] text-faint">option</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {frameSlots.length === 0 && attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3.5 pb-1" aria-label="Références jointes">
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

          {model.promptUse === "none" ? (
            <p className="px-4 pt-3 pb-2 text-[15px] leading-relaxed text-muted">{model.placeholder}</p>
          ) : (
            <>
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
                placeholder={mode?.placeholder ?? model.placeholder ?? "Décris ta scène. Cite tes références avec @Image1, @Video1..."}
                className="block max-h-[28vh] min-h-[64px] w-full resize-none bg-transparent px-4 pt-3 pb-2 text-base leading-relaxed text-fg placeholder:text-faint focus:outline-none sm:max-h-[32vh]"
              />
            </>
          )}

          {visibleErrors.length > 0 && (
            <ul className="space-y-0.5 px-4 pb-2 text-sm text-danger" role="alert">
              {visibleErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {/* Presets row */}
          {promptDriven && selectedPresets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-1">
              {selectedPresets.map((id) => {
                const p = getPreset(id);
                if (!p) return null;
                return (
                  <Chip key={id} className="gap-1 pr-1">
                    <span>{p.label}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPresets((prev) => prev.filter((x) => x !== id))}
                      className="flex size-6 items-center justify-center rounded-full hover:bg-hover"
                      aria-label={`Retirer ${p.label}`}
                    >
                      <X size={12} />
                    </button>
                  </Chip>
                );
              })}
            </div>
          )}

          {/* Enhanced prompt preview */}
          {promptDriven && showEnhanced && sentPrompt && (selectedPresets.length > 0 || enhanceEnabled) && (
            <div className="mx-3 mb-2 rounded-item border border-line bg-sunken p-2.5 text-xs leading-relaxed text-muted">
              <p className="mb-1 font-medium text-faint">Prompt envoyé :</p>
              <p>{sentPrompt}</p>
            </div>
          )}

          {/* Settings wrap onto their own rows: nothing hides in a strip that scrolls. */}
          <div className="flex flex-col gap-2 border-t border-line p-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-1.5 sm:min-w-0 sm:flex-1">
              {frameSlots.length === 0 && <AddMenu model={model} mode={mode} attachments={attachments} params={params} onPick={pickSlot} />}
              <ModelMenu model={model} onSelect={switchModel} />
              {promptDriven && (
                <PresetMenu selected={selectedPresets} onToggle={(id) => setSelectedPresets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))} />
              )}
              {promptDriven && (
                <Chip
                  onClick={() => setEnhanceEnabled((v) => !v)}
                  aria-pressed={enhanceEnabled}
                  className={enhanceEnabled ? "border-accent/40 bg-accent-soft text-accent" : ""}
                >
                  <Sparkle size={14} weight={enhanceEnabled ? "fill" : "regular"} />
                  Enrichir
                </Chip>
              )}
              {promptDriven && (selectedPresets.length > 0 || enhanceEnabled) && (
                <Chip
                  onClick={() => setShowEnhanced((v) => !v)}
                  aria-pressed={showEnhanced}
                  className={showEnhanced ? "border-accent/40 text-accent" : ""}
                >
                  Aperçu
                </Chip>
              )}
              {mainFields.map((f) => (
                <FieldControl key={f.key} field={f} value={params[f.key]} onChange={(v) => set(f.key, v)} />
              ))}
              {advancedFields.length > 0 && <AdvancedMenu fields={advancedFields} params={params} onChange={set} />}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
              <div className="pl-2 leading-tight sm:pl-0 sm:text-right" title={`1 crédit = 0,005 $. Taux USD/EUR : ${usdEurRate.toFixed(4)}`}>
                <div className="font-wide text-base">
                  <span key={estimateLabel} className="tick">
                    {estimateLabel}
                  </span>
                </div>
                <div className="text-xs text-faint">
                  {estimate.perSecond !== undefined ? "selon la durée de la vidéo" : formatCredits(estimate.credits)}
                </div>
              </div>
              {/* Three visual states in one cell (repos, envoi, lancée); the accessible name stays "Générer". */}
              <Button type="submit" variant="primary" aria-label="Générer" aria-busy={submitting} className="min-w-40 sm:min-w-36">
                <span className="grid items-center justify-items-center [&>*]:col-start-1 [&>*]:row-start-1">
                  <span className="swap flex items-center gap-2" data-on={buttonState === "idle"}>
                    Générer
                    <Kbd className="hidden border-on-accent/30 text-on-accent/80 sm:inline">⌘↵</Kbd>
                  </span>
                  <span className="swap flex items-center gap-2" data-on={buttonState === "sending"}>
                    <CircleNotch size={16} weight="bold" className="animate-spin motion-reduce:animate-none" />
                    Envoi
                  </span>
                  <span className="swap flex items-center gap-2" data-on={buttonState === "launched"}>
                    <Check size={16} weight="bold" />
                    Lancée
                  </span>
                </span>
              </Button>
            </div>
          </div>
          {promptLength > model.promptMaxLength * 0.9 && (
            <p className="px-4 pb-2 text-right text-xs text-faint">
              {promptLength} / {model.promptMaxLength}
            </p>
          )}
        </form>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>

      {/* Visually hidden rather than display:none: iOS opens the picker more reliably this way. */}
      <input
        ref={fileInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
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
              Ce mois-ci : <span className="text-fg">{formatEur(budget.spentEur)}</span> engagés sur{" "}
              <span className="text-fg">{formatEur(budget.monthlyBudgetEur)}</span>. Cette génération coûterait{" "}
              <span className="text-fg">{formatEur(budget.estimateEur)}</span> de plus.
            </p>
            <ModalActions>
              <Button onClick={() => setBudget(null)}>Annuler</Button>
              <Button variant="primary" onClick={() => void submit(true)} disabled={submitting}>
                Lancer quand même
              </Button>
            </ModalActions>
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
  wide,
}: {
  attachment: Attachment;
  label: string;
  isTag: boolean;
  /** Input tiles carry a word ("Personnage") that must not be cut. */
  wide?: boolean;
  onInsert: () => void;
  onRemove: () => void;
}) {
  const Icon = SLOT_ICONS[a.kind];
  return (
    <li className="fade-in relative shrink-0">
      <button
        type="button"
        onClick={onInsert}
        disabled={!isTag}
        title={isTag ? `Insérer ${label} dans le prompt` : a.file.name}
        aria-label={isTag ? `Insérer ${label} dans le prompt` : `${label} : ${a.file.name}`}
        className={cx("pressable block overflow-hidden rounded-control border border-line-strong bg-raised", wide ? "w-[88px]" : "w-[72px]")}
      >
        <div className="flex h-16 items-center justify-center bg-sunken">
          {a.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt="" className="size-full object-cover outline outline-1 -outline-offset-1 outline-black/10" />
          ) : a.kind === "video" ? (
            <span className="relative block size-full">
              {/* Shown when the browser cannot paint a frame; a decoded frame covers it. */}
              <Icon size={22} className="absolute inset-0 m-auto text-muted" />
              <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="relative size-full object-cover" />
            </span>
          ) : (
            <Icon size={22} className="text-muted" />
          )}
        </div>
        <span className={cx("block border-t border-line px-1.5 py-1 text-center text-xs", isTag ? "font-medium text-accent" : "text-muted")}>
          {label}
          {a.duration !== undefined && <span className="font-normal text-faint"> {Math.round(a.duration)} s</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${a.file.name}`}
        // 22px dot, 44px hit area through the pseudo-element.
        className="pressable absolute -top-2 -right-2 flex size-[22px] items-center justify-center rounded-full border border-line-strong bg-raised text-muted shadow-thumb after:absolute after:-inset-[11px] after:content-[''] hover:text-fg"
      >
        <X size={11} weight="bold" />
      </button>
    </li>
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
      label="Ajouter une référence"
      trigger={({ open, toggle, id }) => (
        <Chip onClick={toggle} active={open} aria-expanded={open} aria-controls={id} aria-label="Ajouter une référence" icon>
          <Plus size={16} weight="bold" />
        </Chip>
      )}
    >
      {(close) => (
        <div className="w-full sm:w-64">
          {groups.map((g) => (
            <div key={g.title ?? "all"} className="pb-1 last:pb-0">
              {g.title && <p className="px-3 pt-2 pb-1 text-xs text-faint sm:px-2.5">{g.title}</p>}
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
                    <Icon size={18} />
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

function PresetMenu({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  const categories = ["camera", "style", "motion", "effect"] as PresetCategory[];
  return (
    <Popover
      label="Préréglages"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open} aria-expanded={open} aria-label={`Préréglages${selected.length ? ` (${selected.length})` : ""}`}>
          <SlidersHorizontal size={15} />
          <span className="font-medium text-fg">Préréglages</span>
          {selected.length > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-on-accent">{selected.length}</span>
          )}
          <ChipCaret />
        </Chip>
      )}
    >
      {() => (
        <div className="max-h-[60vh] w-full overflow-y-auto sm:w-80" role="group" aria-label="Préréglages">
          {categories.map((cat) => {
            const items = PRESETS.filter((p) => p.category === cat);
            return (
              <div key={cat} role="group" aria-labelledby={`preset-cat-${cat}`}>
                <p id={`preset-cat-${cat}`} className="px-3 pt-2.5 pb-1 text-xs font-medium text-faint sm:px-2.5">
                  {PRESET_CATEGORY_LABELS[cat]}
                </p>
                {items.map((p) => (
                  <MenuItem key={p.id} multi selected={selected.includes(p.id)} onClick={() => onToggle(p.id)} className="items-start">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-fg">{p.label}</span>
                      <span className="text-xs leading-snug text-faint">{p.description}</span>
                    </span>
                  </MenuItem>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function ModelMenu({ model, onSelect }: { model: ModelDefinition; onSelect: (id: string) => void }) {
  const groups = [...new Set(MODELS.map((m) => m.group ?? ""))];
  return (
    <Popover
      label="Modèle"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open} aria-expanded={open} aria-label={`Modèle : ${model.label}`}>
          <Sparkle size={15} weight="fill" className="text-accent" />
          <span className="font-medium text-fg">{model.label}</span>
          <ChipCaret />
        </Chip>
      )}
    >
      {(close) => (
        <div className="w-full sm:w-80" role="radiogroup" aria-label="Modèle" onKeyDown={onRadioArrows}>
          {groups.map((g, i) => (
            <div key={g} role="group" aria-labelledby={`model-group-${i}`} className="pb-1 last:pb-0">
              <p id={`model-group-${i}`} className="px-3 pt-2 pb-1 text-xs text-faint sm:px-2.5">
                {g}
              </p>
              {MODELS.filter((m) => (m.group ?? "") === g).map((m) => (
                <MenuItem
                  key={m.id}
                  selected={m.id === model.id}
                  onClick={() => {
                    close();
                    onSelect(m.id);
                  }}
                  className="items-start"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-fg">
                      {m.label} <span className="text-faint">{m.vendor}</span>
                    </span>
                    <span className="text-xs leading-snug text-faint">{m.description}</span>
                  </span>
                </MenuItem>
              ))}
            </div>
          ))}
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
        <Icon key={String(on)} size={15} className="check-in" />
        {field.label}
      </Chip>
    );
  }
  if (field.type === "select") {
    const current = field.options.find((o) => o.value === value);
    const Icon = field.key === "aspect_ratio" ? CornersOut : null;
    return (
      <Popover
        label={field.label}
        trigger={({ open, toggle }) => (
          <Chip onClick={toggle} active={open} aria-expanded={open} aria-label={`${field.label} : ${current?.label}`}>
            {Icon && <Icon size={15} />}
            {current?.label ?? field.label}
            <ChipCaret />
          </Chip>
        )}
      >
        {(close) => (
          <div className="w-full sm:w-44" role="radiogroup" aria-label={field.label} onKeyDown={onRadioArrows}>
            <p aria-hidden className="px-3 pt-2 pb-1 text-xs text-faint sm:px-2.5">
              {field.label}
            </p>
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
    // Auto has no number: the stepper starts from 5 s, as the old slider did.
    const base = v === -1 ? 5 : v;
    return (
      <Popover
        label="Durée de la vidéo"
        trigger={({ open, toggle }) => (
          <Chip onClick={toggle} active={open} aria-expanded={open} aria-label={`Durée : ${v === -1 ? "auto" : `${v} secondes`}`}>
            <Clock size={15} />
            {v === -1 ? "Auto" : `${v} s`}
            <ChipCaret />
          </Chip>
        )}
      >
        {() => (
          <div className="w-full p-1 sm:w-64">
            <p className="px-1 pb-2 text-xs text-faint">Durée de la vidéo</p>
            <div className="grid grid-cols-4 gap-1.5 sm:gap-1" role="radiogroup" aria-label="Durée de la vidéo" onKeyDown={onRadioArrows}>
              {DURATION_PRESETS.filter((d) => d === -1 || (d >= field.min && d <= field.max)).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={d === v}
                  tabIndex={d === v ? 0 : -1}
                  onClick={() => onChange(d)}
                  className={cx(
                    "pressable h-11 rounded-control text-sm sm:h-9 sm:rounded-item sm:text-[13px]",
                    d === v ? "bg-accent font-medium text-on-accent" : "bg-sunken text-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  {d === -1 ? "Auto" : `${d} s`}
                </button>
              ))}
            </div>
            <p className="mt-3 px-1 pb-1.5 text-xs text-faint">Précis, à la seconde</p>
            <Stepper
              value={base}
              display={v === -1 ? "Auto" : `${v} secondes`}
              min={field.min}
              max={field.max}
              onChange={(n) => onChange(n)}
              less="Une seconde de moins"
              more="Une seconde de plus"
            />
            {field.allowAuto && <p className="px-1 pt-2 text-xs leading-snug text-faint">Auto : le modèle choisit, facturé jusqu&apos;à 30 s.</p>}
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
      label="Réglages avancés"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open || changed} aria-expanded={open} aria-label="Réglages avancés">
          <SlidersHorizontal size={15} />
          Avancé
          {changed && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
        </Chip>
      )}
    >
      {() => (
        <div className="w-full space-y-5 p-2 sm:w-80">
          {fields.map((f) => {
            if (f.type === "seed") {
              const seed = params[f.key] as number | null;
              return (
                <div key={f.key} className="space-y-1.5">
                  <label htmlFor="seed" className="text-sm font-medium text-fg">
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
                      className={cx(fieldClass, "min-w-0 flex-1")}
                    />
                    <Button size="icon" onClick={() => onChange(f.key, Math.floor(Math.random() * 2_147_483_647))} aria-label="Seed au hasard">
                      <DiceFive size={18} />
                    </Button>
                    {seed !== null && (
                      <Button size="icon" onClick={() => onChange(f.key, null)} aria-label="Revenir à un seed aléatoire">
                        <X size={16} />
                      </Button>
                    )}
                  </div>
                  <p className={cx("text-xs leading-snug", seed !== null ? "text-warn" : "text-faint")}>
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
                    <p className="text-sm font-medium text-fg">{f.label}</p>
                    {f.hint && <p className="mt-0.5 text-xs leading-snug text-faint">{f.hint}</p>}
                  </div>
                  <Switch checked={params[f.key] === true} onChange={(v) => onChange(f.key, v)} label={f.label} />
                </div>
              );
            }
            if (f.type === "links") {
              const links = params[f.key] as string[];
              return (
                <div key={f.key} className="space-y-1.5">
                  <label htmlFor={`link-${f.key}`} className="text-sm font-medium text-fg">
                    {f.label}
                  </label>
                  <input
                    id={`link-${f.key}`}
                    type="url"
                    value={links[0] ?? ""}
                    placeholder="https://"
                    onChange={(e) => onChange(f.key, e.target.value.trim() ? [e.target.value.trim()] : [])}
                    className={fieldClass}
                  />
                  {f.hint && <p className="text-xs leading-snug text-faint">{f.hint}</p>}
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
