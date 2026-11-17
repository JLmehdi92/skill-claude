"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleNotch, Plus, X } from "@phosphor-icons/react";
import { api, ApiError } from "@/lib/client/api";
import { measureDuration } from "@/lib/client/media";
import type { Motion } from "@/lib/types";
import { Button, Modal, ModalActions } from "./ui";

const label = (m: Motion) => m.name.replace(/\.(mp4|mov)$/i, "");
const seconds = (m: Motion) => `${Math.round(m.duration)} s`;

/** Reusable motion videos for "Copier un mouvement". Picking one hands it to the composer and closes. */
export function MotionGallery({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (m: Motion) => void }) {
  const [motions, setMotions] = useState<Motion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const load = () =>
    api
      .motions()
      .then((list) => {
        setMotions(list);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    if (open) void load();
  }, [open]);

  const upload = async (file: File) => {
    if (!file.type.startsWith("video/")) return void toast.error("Ce fichier n'est pas une vidéo.");
    // Busy from the start: measuring can take a few seconds, a second pick must not start a parallel upload.
    setUploading(true);
    try {
      const duration = await measureDuration(file, "video");
      // Unknown here (iOS sometimes): the server measures again with ffprobe.
      if (duration !== undefined && (duration < 3 || duration > 30.05)) {
        return void toast.error("La vidéo doit durer entre 3 et 30 s.", { description: `Celle-ci dure ${Math.round(duration)} s.` });
      }
      const form = new FormData();
      form.set("file", file, file.name);
      if (duration !== undefined) form.set("duration", String(duration));
      const m = await api.addMotion(form);
      setMotions((prev) => [m, ...(prev ?? [])]);
      toast.success("Vidéo ajoutée à la galerie");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.errors[0] : "Envoi impossible. Réessaie.");
    } finally {
      setUploading(false);
    }
  };

  // Immediate, without "Annuler": a toast action is out of reach behind the open dialog, and re-adding a video is easy.
  const remove = async (m: Motion, index: number) => {
    const current = motions ?? [];
    setMotions(current.filter((x) => x.id !== m.id));
    // The focused X disappears: move focus to the next card's X, else the previous one, else "Ajouter une vidéo".
    requestAnimationFrame(() => {
      const xs = list.current?.querySelectorAll<HTMLElement>("[data-remove]");
      (xs?.[Math.min(index, xs.length - 1)] ?? list.current?.querySelector<HTMLElement>("button"))?.focus();
    });
    try {
      await api.removeMotion(m.id);
      toast("Mouvement retiré", { description: label(m) });
    } catch {
      setMotions((now) => (now?.some((x) => x.id === m.id) ? now : [...(now ?? []), m].sort((a, b) => b.createdAt - a.createdAt)));
      toast.error("Suppression impossible.", { description: label(m) });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Galerie de mouvements">
      <ul ref={list} className="grid grid-cols-2 gap-2">
        <li>
          <button
            type="button"
            // aria-disabled, not disabled: focus stays on the button while it sends.
            onClick={() => !uploading && input.current?.click()}
            aria-disabled={uploading}
            aria-busy={uploading}
            className="pressable flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-control border border-dashed border-edge bg-sunken text-muted hover:border-accent hover:text-fg aria-disabled:cursor-wait"
          >
            {uploading ? <CircleNotch size={20} className="animate-spin motion-reduce:animate-none" /> : <Plus size={20} />}
            <span className="text-sm font-medium">{uploading ? "Envoi…" : "Ajouter une vidéo"}</span>
            <span className="text-xs text-faint">3 à 30 s</span>
          </button>
        </li>
        {motions === null && !failed && (
          <>
            <li className="sr-only" role="status">
              Chargement…
            </li>
            {[0, 1, 2].map((i) => (
              <li key={i} aria-hidden className="shimmer aspect-[3/4] rounded-control" />
            ))}
          </>
        )}
        {motions?.map((m, i) => (
          <li key={m.id} className="fade-in relative">
            <button
              type="button"
              onClick={() => onPick(m)}
              aria-label={`Choisir ${label(m)}, ${seconds(m)}`}
              className="pressable block w-full overflow-hidden rounded-control border border-line-strong bg-raised text-left"
            >
              {m.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumbUrl} alt="" loading="lazy" className="aspect-[3/4] w-full bg-sunken object-cover" />
              ) : (
                // No poster (ffmpeg missing): the first frame of the video itself.
                <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden className="aspect-[3/4] w-full bg-sunken object-cover" />
              )}
              <span className="flex items-baseline gap-2 border-t border-line px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg">{label(m)}</span>
                <span className="shrink-0 text-faint tabular-nums">{seconds(m)}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void remove(m, i)}
              data-remove
              aria-label={`Retirer ${label(m)} de la galerie`}
              // 28px dot, 44px hit area through the pseudo-element.
              className="pressable absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full border border-line-strong bg-raised text-muted shadow-thumb after:absolute after:-inset-2 after:content-[''] hover:text-fg"
            >
              <X size={12} weight="bold" />
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-danger" role="alert">
          Impossible de charger la galerie.
          <Button size="sm" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      )}
      {motions?.length === 0 && (
        <p className="mt-3 text-sm leading-snug text-muted">
          Garde ici les vidéos de mouvement que tu réutilises. Ajoute-en une depuis l&apos;appareil ou depuis le détail d&apos;une génération réussie.
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choisir une vidéo"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <ModalActions>
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </ModalActions>
    </Modal>
  );
}
