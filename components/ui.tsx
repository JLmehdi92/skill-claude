"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover disabled:bg-raised disabled:text-faint",
  secondary: "border border-line-strong bg-raised text-fg hover:bg-hover disabled:text-faint",
  ghost: "text-muted hover:bg-raised hover:text-fg disabled:text-faint",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-9 px-4 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2" };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "pressable inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap disabled:cursor-not-allowed",
        sizes[size],
        VARIANTS[variant],
        className,
      )}
    />
  );
}

/** Compact control used in the composer toolbar. */
export function Chip({ active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap",
        active ? "border-line-strong bg-hover text-fg" : "border-line bg-raised text-muted hover:text-fg",
        className,
      )}
    />
  );
}

export function Popover({
  trigger,
  children,
  side = "top",
  align = "start",
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: (close: () => void) => ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // Rendered in a portal with fixed positioning so scrollable toolbars do not clip it.
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vertical = side === "top" ? { bottom: window.innerHeight - r.top + 8 } : { top: r.bottom + 8 };
      const horizontal = align === "start" ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) };
      setPos({ position: "fixed", ...vertical, ...horizontal });
    };
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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
  return (
    <div ref={anchor} className="shrink-0">
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            style={{ ...pos, ["--origin" as string]: origin }}
            className={cx(
              "popover-panel z-50 max-h-[70vh] min-w-44 overflow-y-auto rounded-[14px] border border-line-strong bg-raised p-1.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)]",
              className,
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  selected,
  children,
  hint,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; hint?: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "flex w-full items-center justify-between gap-6 rounded-[9px] px-2.5 py-2 text-left text-[13px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        selected ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
        className,
      )}
    >
      <span className="flex items-center gap-2">{children}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
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
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-hover",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 left-0.5 size-4 rounded-full transition-transform duration-200 ease-[var(--ease-out)]",
          checked ? "translate-x-4 bg-on-accent" : "bg-muted",
        )}
      />
    </button>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="popover-panel relative w-full max-w-md rounded-[var(--radius-surface)] border border-line-strong bg-surface p-6 [--origin:center]"
      >
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("rounded border border-line px-1 font-mono text-[10px] text-faint", className)}>{children}</kbd>;
}
