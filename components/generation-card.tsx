"use client";

import { useRef, useState } from "react";
import { ArrowClockwise, Heart, SpeakerHigh, Warning } from "@phosphor-icons/react";
import { formatEur } from "@/lib/costs";
import { isPending, type Generation } from "@/lib/types";
import { Tally, cx } from "./ui";

const RATIOS: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4 };

const STATUS_LABEL: Record<string, string> = {
  uploading: "Envoi des références",
  queued: "En file d'attente",
  generating: "Génération",
};

export function generationRatio(g: Generation, natural?: number): number {
  return natural ?? RATIOS[String(g.params.aspect_ratio)] ?? 16 / 9;
}

export function GenerationCard({ gen, onOpen, onRetry }: { gen: Generation; onOpen: () => void; onRetry?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [natural, setNatural] = useState<number>();
  // A failure has no frame to show: a square tile instead of an empty 9:16 column.
  const ratio = gen.status === "failed" ? 1 : generationRatio(gen, natural);
  const output = gen.outputs[0];
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cost = gen.costEur !== null ? formatEur(gen.costEur) : isPending(gen.status) ? `≈ ${formatEur(gen.estimatedEur)}` : null;

  return (
    <article
      className="fade-in relative mb-2 break-inside-avoid overflow-hidden rounded-panel border border-line bg-surface sm:mb-3"
      // Playing on hover is a desktop bonus; the caption below is always there.
      onMouseEnter={() => canHover() && video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (!video.current) return;
        video.current.pause();
        video.current.currentTime = 0;
      }}
    >
      {/* No aria-label: the caption, status and cost inside name the button. Outline drawn inside: the card clips overflow. */}
      <button type="button" onClick={onOpen} className="block w-full rounded-panel text-left focus-visible:outline-offset-[-3px]">
        <div className="relative w-full bg-sunken" style={{ aspectRatio: ratio }}>
          {gen.status === "success" && output?.kind === "video" && (
            <video
              ref={video}
              // #t=0.1 makes iOS show the first frame when there is no server thumbnail.
              src={gen.thumbUrl ? output.url : `${output.url}#t=0.1`}
              poster={gen.thumbUrl ?? undefined}
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setNatural(v.videoWidth / v.videoHeight);
              }}
              className="absolute inset-0 size-full object-cover"
            />
          )}
          {gen.status === "success" && output?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={output.url}
              alt=""
              onLoad={(e) => setNatural(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
              className="absolute inset-0 size-full object-cover"
            />
          )}
          {gen.status === "success" && output?.kind === "audio" && (
            // No player inside a button: listening happens in the drawer.
            <div className="absolute inset-0 flex items-center justify-center text-muted">
              <SpeakerHigh size={32} aria-hidden />
            </div>
          )}
          {isPending(gen.status) && <PendingState gen={gen} />}
          {gen.status === "failed" && (
            <div className="absolute inset-0 flex flex-col justify-end gap-1.5 p-3 sm:p-4">
              <Warning size={20} weight="bold" className="text-danger" />
              <p className="line-clamp-3 text-[13px] leading-snug text-muted">{gen.error ?? "La génération a échoué."}</p>
            </div>
          )}
        </div>
        <div className="flex items-baseline gap-2 border-t border-line px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[13px] text-fg">{gen.prompt}</p>
          {cost && <p className="shrink-0 text-xs text-faint">{cost}</p>}
        </div>
      </button>

      {gen.favorite && (
        <span
          className={cx(
            "pointer-events-none absolute top-2 flex size-7 items-center justify-center rounded-full bg-raised text-fg shadow-thumb",
            // Failed cards show Relancer top right.
            gen.status === "failed" ? "left-2" : "right-2",
          )}
        >
          <Heart size={14} weight="fill" aria-hidden />
          <span className="sr-only">Favori</span>
        </span>
      )}

      {gen.status === "failed" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Relancer : ${gen.prompt.slice(0, 40)}`}
          className="pressable absolute top-2 right-2 flex h-11 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-fg shadow-thumb hover:bg-hover sm:h-8 sm:px-3"
        >
          <ArrowClockwise size={14} weight="bold" />
          Relancer
        </button>
      )}
    </article>
  );
}

function PendingState({ gen }: { gen: Generation }) {
  const progress = gen.status === "generating" ? gen.progress : null;
  const shown = progress ?? (gen.status === "queued" ? 8 : 3);
  return (
    <div className="shimmer absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <Tally />
        {STATUS_LABEL[gen.status]}
        {progress !== null && progress !== undefined && <span className="font-normal text-muted">{progress} %</span>}
      </p>
      {gen.error && <p className="mt-1 text-xs text-warn">{gen.error}</p>}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-line">
        <div className="progress-line h-full bg-accent" style={{ transform: `scaleX(${shown / 100})` }} />
      </div>
    </div>
  );
}
