"use client";

import { useEffect } from "react";
import { MusicNotes, Plus, UserCircle } from "@phosphor-icons/react";
import { cx, Tally } from "./ui";

export interface MentionOption {
  id: string;
  group: "files" | "characters" | "actions";
  /** What gets inserted, or the action's name ("Ajouter une image"). */
  label: string;
  sub?: string;
  thumb?: { url: string; kind: "image" | "video" | "audio" | "avatar" };
  disabled?: boolean;
  training?: boolean;
}

const GROUPS: { key: MentionOption["group"]; label: string }[] = [
  { key: "files", label: "Fichiers joints" },
  { key: "characters", label: "Personnages" },
  { key: "actions", label: "Ajouter" },
];

/**
 * The "@" suggestions, in the composer's flow just above the prompt (no popover: it would take the
 * focus and close the phone keyboard). The textarea keeps the focus and drives it with aria-activedescendant.
 */
export function MentionMenu({
  id,
  options,
  active,
  noFiles,
  onPick,
  onActive,
}: {
  id: string;
  options: MentionOption[];
  active: number;
  /** No file attached yet: say so before the add actions. */
  noFiles: boolean;
  onPick: (o: MentionOption) => void;
  onActive: (index: number) => void;
}) {
  // The arrows drive the list from the prompt: keep the active row in view.
  const activeId = options[active] ? `${id}-${options[active].id}` : null;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <div className="fade-in mx-2 mt-2 max-h-44 overflow-y-auto overscroll-contain rounded-panel border border-line bg-raised p-1 sm:max-h-64">
      {/* Outside the listbox: only options and groups belong in it. */}
      {noFiles && <p className="px-3 py-2 text-xs text-faint sm:px-2.5">Aucun fichier joint pour l&apos;instant.</p>}
      <div id={id} role="listbox" aria-label="Mentions">
        {GROUPS.map((g) => {
          const items = options.filter((o) => o.group === g.key);
          if (!items.length) return null;
          return (
            <div key={g.key} role="group" aria-label={g.label}>
              {items.map((o) => {
                const index = options.indexOf(o);
                return (
                  <div
                    key={o.id}
                    id={`${id}-${o.id}`}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={o.disabled || undefined}
                    // Keep the focus (and the phone keyboard) in the prompt.
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerMove={() => index !== active && onActive(index)}
                    onClick={() => !o.disabled && onPick(o)}
                    className={cx(
                      "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-item px-2 py-1.5 text-[15px] sm:min-h-10 sm:text-[13px]",
                      index === active ? "bg-accent-soft text-fg" : "text-muted",
                      o.disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <Thumb o={o} />
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className={cx("shrink-0", o.group !== "actions" && "font-medium text-fg")}>{o.label}</span>
                      {o.sub && (
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-faint">
                          {o.training && <Tally />}
                          {o.sub}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Thumb({ o }: { o: MentionOption }) {
  const box = "flex size-8 shrink-0 items-center justify-center overflow-hidden";
  if (o.group === "actions") {
    return (
      <span className={cx(box, "rounded-[4px] border border-dashed border-edge text-muted")}>
        <Plus size={14} weight="bold" />
      </span>
    );
  }
  if (!o.thumb) {
    return (
      <span className={cx(box, "rounded-full bg-sunken text-muted")}>
        <UserCircle size={18} />
      </span>
    );
  }
  if (o.thumb.kind === "audio") {
    return (
      <span className={cx(box, "rounded-[4px] bg-sunken text-muted")}>
        <MusicNotes size={16} />
      </span>
    );
  }
  const round = o.thumb.kind === "avatar" ? "rounded-full" : "rounded-[4px]";
  return (
    <span className={cx(box, round, "bg-sunken outline outline-1 -outline-offset-1 outline-black/10")}>
      {o.thumb.kind === "video" ? (
        <video src={`${o.thumb.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden className="size-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.thumb.url} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}
