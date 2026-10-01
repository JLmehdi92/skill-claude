"use client";

import { useRef, useState } from "react";
import { ArrowClockwise, Heart, Warning } from "@phosphor-icons/react";
import { formatEur } from "@/lib/costs";
import { isPending, type Generation } from "@/lib/types";
import { cx } from "./ui";

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
  const ratio = generationRatio(gen, natural);
  const output = gen.outputs[0];
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  return (
    <article
      className="fade-in group relative mb-3 break-inside-avoid overflow-hidden rounded-[var(--radius-tile)] border border-line bg-surface"
      onMouseEnter={() => canHover() && video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (!video.current) return;
        video.current.pause();
        video.current.currentTime = 0;
      }}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Ouvrir : ${gen.prompt.slice(0, 60)}`}>
        <div className="relative w-full" style={{ aspectRatio: ratio }}>
          {gen.status === "success" && output?.kind === "video" && (
            <video
              ref={video}
              src={output.url}
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
            <div className="absolute inset-0 flex items-center justify-center bg-raised p-4">
              <audio src={output.url} controls className="w-full" />
            </div>
          )}
          {isPending(gen.status) && <PendingState gen={gen} />}
          {gen.status === "failed" && (
            <div className="absolute inset-0 flex flex-col justify-end gap-2 bg-raised p-4">
              <Warning size={20} className="text-danger" />
              <p className="line-clamp-3 text-[13px] leading-snug text-muted">{gen.error ?? "La génération a échoué."}</p>
            </div>
          )}
        </div>
      </button>

      {gen.favorite && (
        <Heart size={16} weight="fill" className="pointer-events-none absolute top-2.5 right-2.5 text-fg drop-shadow" aria-label="Favori" />
      )}

      {gen.status === "failed" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="pressable absolute top-2.5 right-2.5 flex h-7 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-xs text-fg hover:bg-hover"
        >
          <ArrowClockwise size={12} />
          Relancer
        </button>
      )}

      <div
        className={cx(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pt-8 pb-2.5",
          "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100",
          gen.status !== "success" && "hidden",
        )}
      >
        <p className="line-clamp-2 text-[13px] leading-snug text-fg">{gen.prompt}</p>
        <p className="mt-1 text-[11px] text-white/60 tabular-nums">
          {gen.modelLabel}
          {gen.costEur !== null && <> · {formatEur(gen.costEur)}</>}
        </p>
      </div>
    </article>
  );
}

function PendingState({ gen }: { gen: Generation }) {
  const progress = gen.status === "generating" ? gen.progress : null;
  return (
    <div className="shimmer absolute inset-0 flex flex-col justify-end p-4">
      <p className="text-[13px] font-medium text-fg">
        {STATUS_LABEL[gen.status]}
        {progress !== null && progress !== undefined && <span className="text-muted tabular-nums"> {progress} %</span>}
      </p>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-faint">{gen.prompt}</p>
      {gen.error && <p className="mt-1 text-[11px] text-warn">{gen.error}</p>}
      <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-700 ease-[var(--ease-out)]"
          style={{ width: `${progress ?? (gen.status === "queued" ? 8 : 3)}%` }}
        />
      </div>
    </div>
  );
}
