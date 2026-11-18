"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Plus } from "@phosphor-icons/react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Text fields: 16px everywhere (no iOS zoom), 44px tall on phones, 3:1 boundary. */
export const fieldClass =
  "h-11 w-full rounded-control border border-edge bg-raised px-3.5 text-base text-fg placeholder:text-faint focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-9";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-sunken disabled:text-faint",
  secondary: "border border-line-strong bg-raised text-fg hover:bg-hover disabled:text-faint",
  ghost: "text-muted hover:bg-hover hover:text-fg disabled:text-faint",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

const SIZES = {
  sm: "h-11 gap-1.5 px-3.5 text-sm sm:h-8 sm:px-3 sm:text-[13px]",
  md: "h-11 gap-2 px-4 text-[15px] sm:h-9 sm:text-sm",
  icon: "size-11 sm:size-9",
};

/** Button look, also for links styled as buttons (downloads, exports). */
export const buttonClass = (variant: Variant = "secondary", size: keyof typeof SIZES = "md") =>
  cx(
    "pressable inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap disabled:cursor-not-allowed",
    SIZES[size],
    VARIANTS[variant],
  );

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <button type="button" {...props} className={cx(buttonClass(variant, size), className)} />;
}

/** Compact control used in the composer toolbar and filters. */
export function Chip({ active, icon, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      data-open={active || undefined}
      className={cx(
        "pressable group/chip inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border text-sm whitespace-nowrap sm:h-9 sm:text-[13px]",
        icon ? "w-11 sm:w-9" : "px-3",
        active ? "border-accent bg-accent-soft text-fg" : "border-line-strong bg-raised text-muted hover:bg-hover hover:text-fg",
        className,
      )}
    />
  );
}

/** Caret for chips that open a menu: turns over while the menu is open. */
export function ChipCaret() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition-transform duration-200 ease-[var(--ease-out)] group-data-open/chip:rotate-180 motion-reduce:transition-none">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The tally light: red dot that marks anything rolling. */
export function Tally({ className }: { className?: string }) {
  return <span aria-hidden className={cx("tally inline-block size-2 shrink-0 rounded-full bg-tally", className)} />;
}

/**
 * Exclusive choice with a sliding pill. Equal columns, so the pill moves by translateX(index * 100%)
 * with no measuring. Roving tabindex, arrows move the selection.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (delta: number) => {
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("relative grid h-11 auto-cols-fr grid-flow-col rounded-control bg-sunken sm:h-9", className)}
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
      <span
        aria-hidden
        className="seg-pill pointer-events-none absolute inset-y-0 left-0 p-[3px]"
        style={{ width: `${100 / options.length}%`, transform: `translateX(${index * 100}%)` }}
      >
        <span className="block size-full rounded-[9px] border border-line bg-raised shadow-thumb" />
      </span>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative px-1.5 text-sm whitespace-nowrap transition-colors duration-150 sm:px-3 sm:text-[13px]",
            i === index ? "font-medium text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Popover({
  trigger,
  children,
  side = "top",
  align = "start",
  label,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  /** Accessible name of the panel. */
  label: string;
  children: (close: () => void) => ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const [sheet, setSheet] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // Rendered in a portal with fixed positioning so nothing clips it.
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      // Phones: full-width sheet on the bottom edge, above the home indicator.
      if (window.innerWidth < 640) {
        setSheet(true);
        setPos({ position: "fixed", left: 8, right: 8, bottom: "max(8px, env(safe-area-inset-bottom))" });
        return;
      }
      setSheet(false);
      const vertical = side === "top" ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 };
      const horizontal = align === "start" ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) };
      setPos({ position: "fixed", ...vertical, ...horizontal });
    };
    place();
    panel.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The sheet scrim closes on click instead, so the tap does not fall through to what lies under it.
      if (t === scrim.current) return;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      anchor.current?.querySelector<HTMLElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, side, align]);

  const origin = `${side === "top" ? "bottom" : "top"} ${align === "start" ? "left" : "right"}`;
  // Picking an item unmounts the panel: give focus back to the trigger instead of losing it to <body>.
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus) anchor.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [refocus]);
  const close = () => {
    setOpen(false);
    setRefocus((n) => n + 1);
  };
  return (
    <div ref={anchor} className="shrink-0">
      {trigger({
        open,
        toggle: () => {
          // Decided before the first paint so the panel enters with the right animation.
          setSheet(window.innerWidth < 640);
          setOpen((o) => !o);
        },
        id,
      })}
      {open &&
        createPortal(
          <>
            {sheet && <div ref={scrim} aria-hidden className="fade-in fixed inset-0 z-50 bg-scrim" onClick={() => setOpen(false)} />}
            <div
              ref={panel}
              id={id}
              role="dialog"
              aria-label={label}
              aria-modal={sheet || undefined}
              tabIndex={-1}
              // Tabbing out of the panel closes it (it lives at the end of <body>, away from its trigger).
              onBlur={(e) => {
                const to = e.relatedTarget as Node | null;
                if (to && !e.currentTarget.contains(to) && !anchor.current?.contains(to)) setOpen(false);
              }}
              style={{ ...pos, ["--origin" as string]: origin }}
              className={cx(
                "z-50 max-h-[70dvh] min-w-44 overflow-y-auto overscroll-contain border border-line-strong bg-raised shadow-float outline-none",
                // Concentric: sheet 20 with 8px inset holds 12px items; menu 12 with 4px inset holds 8px items.
                sheet ? "sheet-panel rounded-sheet p-2" : "popover-panel rounded-control p-1",
                className,
              )}
            >
              {children(close)}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

/**
 * Call before removing an item whose focused [data-remove] button is about to unmount: focus moves to the
 * same place in the closest [data-removable] list (next X, else previous), else to `fallback`.
 * Does nothing when focus is elsewhere (a tap on iOS does not focus the button).
 */
export function keepFocusOnRemove(fallback?: () => HTMLElement | null | undefined) {
  const active = document.activeElement as HTMLElement | null;
  const list = active?.matches("[data-remove]") ? active.closest<HTMLElement>("[data-removable]") : null;
  if (!active || !list) return;
  const index = [...list.querySelectorAll("[data-remove]")].indexOf(active);
  requestAnimationFrame(() => {
    const xs = list.isConnected ? [...list.querySelectorAll<HTMLElement>("[data-remove]")] : [];
    (xs[Math.min(index, xs.length - 1)] ?? fallback?.())?.focus();
  });
}

/** Arrow keys move focus between the radios of a group (put it on the role="radiogroup" element). */
export function onRadioArrows(e: React.KeyboardEvent<HTMLElement>) {
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (!step) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]:not(:disabled)")];
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i === -1) return;
  e.preventDefault();
  radios[(i + step + radios.length) % radios.length].focus();
}

export function MenuItem({
  selected,
  children,
  hint,
  className,
  multi,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; hint?: ReactNode; multi?: boolean }) {
  // A choice (selected is set) is a radio: only the chosen one is a Tab stop, arrows move between them.
  // With multi, it is a checkbox: each one is a Tab stop.
  const choice = selected === undefined ? {} : multi ? { role: "checkbox", "aria-checked": selected } : { role: "radio", "aria-checked": selected, tabIndex: selected ? 0 : -1 };
  return (
    <button
      type="button"
      {...choice}
      {...props}
      className={cx(
        "flex min-h-12 w-full items-center justify-between gap-6 rounded-control px-3 py-2 text-left text-[15px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 sm:rounded-item sm:px-2.5 sm:text-[13px]",
        selected ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover hover:text-fg",
        className,
      )}
    >
      <span className="flex items-center gap-2.5">{children}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
      {selected && <Check size={16} weight="bold" aria-hidden className="check-in shrink-0 text-accent" />}
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      // 44px touch target around a 40x24 track.
      className="group/switch -m-2.5 shrink-0 p-2.5"
    >
      <span
        className={cx(
          "relative flex h-6 w-10 items-center rounded-full border transition-colors duration-200",
          checked ? "border-accent bg-accent" : "border-edge bg-sunken",
        )}
      >
        <span
          className={cx(
            "absolute left-0.5 size-[18px] rounded-full shadow-thumb transition-transform duration-200 ease-[var(--ease-out)] group-active/switch:scale-x-115 motion-reduce:transition-none",
            checked ? "translate-x-4 bg-on-accent origin-right" : "bg-edge origin-left",
          )}
        />
      </span>
    </button>
  );
}

/** Number with minus / plus buttons; the value slides up or down with the direction. */
export function Stepper({
  value,
  display,
  min,
  max,
  onChange,
  less,
  more,
}: {
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
  less: string;
  more: string;
}) {
  const [dir, setDir] = useState<1 | -1>(1);
  const step = (d: 1 | -1) => {
    if ((d < 0 && value <= min) || (d > 0 && value >= max)) return;
    setDir(d);
    onChange(Math.min(max, Math.max(min, value + d)));
  };
  const btn =
    "pressable flex size-11 items-center justify-center rounded-control border border-line-strong bg-raised text-fg hover:bg-hover aria-disabled:cursor-not-allowed aria-disabled:text-faint aria-disabled:opacity-60";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} onClick={() => step(-1)} aria-disabled={value <= min} aria-label={less}>
        <Minus size={16} weight="bold" />
      </button>
      <output aria-live="polite" className="flex h-11 min-w-0 flex-1 items-center justify-center overflow-hidden text-base font-medium">
        <span key={display} className="tick" style={{ ["--rise" as string]: dir }}>
          {display}
        </span>
      </output>
      <button type="button" className={btn} onClick={() => step(1)} aria-disabled={value >= max} aria-label={more}>
        <Plus size={16} weight="bold" />
      </button>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the effect (callers pass inline arrows).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    // Children use data-autofocus, not autoFocus: autoFocus would steal focus before we can remember the trigger.
    const before = document.activeElement as HTMLElement | null;
    (box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !box.current) return;
      // Keep Tab inside the dialog.
      const items = box.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex='0']");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4">
      <div className="fade-in absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="sheet-panel relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-sheet border border-line-strong bg-raised p-5 shadow-float outline-none sm:p-6"
      >
        <h2 className="font-wide text-xl">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Modal buttons: stacked full width on phones (main action on top), in a row from sm. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{children}</div>;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("rounded-[5px] border px-1 font-mono text-[11px] leading-4", className)}>{children}</kbd>;
}
