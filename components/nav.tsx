"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, STATS_EVENT } from "@/lib/client/api";
import { formatEur } from "@/lib/costs";
import type { AppConfig, Stats } from "@/lib/types";
import { cx, Tally } from "./ui";

const LINKS = [
  { href: "/", label: "Créer" },
  { href: "/library", label: "Historique" },
  { href: "/depenses", label: "Dépenses" },
];

/** Viewfinder corners and the tally light: the same drawing as app/icon.svg. */
function BrandMark() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-7 shrink-0">
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path
        d="M8 13v-3a2 2 0 0 1 2-2h3M19 8h3a2 2 0 0 1 2 2v3M24 19v3a2 2 0 0 1-2 2h-3M13 24h-3a2 2 0 0 1-2-2v-3"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="stroke-on-accent"
      />
      <circle cx="16" cy="16" r="3.4" className="fill-tally" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [stats, setStats] = useState<Stats | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);

  useEffect(() => {
    const load = () => api.stats().then(setStats).catch(() => {});
    load();
    api.config().then(setCfg).catch(() => {});
    window.addEventListener(STATS_EVENT, load);
    return () => window.removeEventListener(STATS_EVENT, load);
  }, []);

  // Only the studio and history pages poll generations: keep the "en cours" count honest elsewhere too.
  const pending = stats?.pendingCount ?? 0;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") api.stats().then(setStats).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [pending]);

  const budget = stats?.monthlyBudgetEur ?? null;
  const ratio = budget && stats ? Math.min(stats.month / budget, 1) : 0;
  const over = budget !== null && stats !== null && stats.month >= budget * 0.8;
  const activeIndex = LINKS.findIndex((l) => (l.href === "/" ? pathname === "/" : pathname.startsWith(l.href)));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link href="/" aria-label="Higgsfield local, accueil" className="flex shrink-0 items-center gap-2.5 rounded-item">
          <BrandMark />
          <span className="font-wide hidden text-[17px] lg:inline">Higgsfield local</span>
        </Link>

        <nav aria-label="Navigation principale" className="relative grid h-11 min-w-0 flex-1 auto-cols-fr grid-flow-col rounded-control bg-sunken sm:h-10 sm:max-w-[360px] sm:flex-none">
          {activeIndex >= 0 && (
            <span
              aria-hidden
              className="seg-pill pointer-events-none absolute inset-y-0 left-0 p-[3px]"
              style={{ width: `${100 / LINKS.length}%`, transform: `translateX(${activeIndex * 100}%)` }}
            >
              <span className="block size-full rounded-[9px] border border-line bg-raised shadow-thumb" />
            </span>
          )}
          {LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={i === activeIndex ? "page" : undefined}
              className={cx(
                "relative flex items-center justify-center gap-1.5 rounded-control px-1 text-[13px] transition-colors duration-150 min-[380px]:text-sm sm:px-4",
                i === activeIndex ? "font-medium text-fg" : "text-muted hover:text-fg",
              )}
            >
              {l.label}
              {/* Phones: the tally rides on the Créer tab; from sm it gets its own "N en cours" link. */}
              {l.href === "/" && pending > 0 && (
                <span className="flex sm:hidden">
                  <Tally />
                  <span className="sr-only">, {pending} en cours</span>
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {pending > 0 && (
            <Link href="/" className="pressable hidden h-9 items-center gap-2 rounded-full border border-line-strong px-3 text-sm text-fg hover:bg-hover sm:flex">
              <Tally />
              {pending} en cours
            </Link>
          )}
          {cfg?.mock && (
            <span
              className="hidden rounded-full border border-warn/50 px-2.5 py-1 text-xs font-medium text-warn md:inline"
              title="KIE_MOCK=1 : aucun appel réel, aucun crédit dépensé"
            >
              Mode test
            </span>
          )}
          {cfg && !cfg.hasKey && (
            <span className="rounded-full border border-danger/50 px-2.5 py-1 text-xs font-medium text-danger" title="Ajoute KIE_API_KEY dans .env.local puis relance le serveur">
              Clé API manquante
            </span>
          )}
          <Link
            href="/depenses"
            className="pressable flex h-11 items-center gap-2.5 rounded-full px-2 text-sm hover:bg-hover max-[359px]:hidden sm:h-9 sm:border sm:border-line-strong sm:px-3"
            aria-label="Dépenses du mois"
          >
            <span className="hidden text-muted md:inline">Ce mois</span>
            <span className="font-medium">{stats ? formatEur(stats.month) : "..."}</span>
            {budget !== null && (
              <span className="hidden items-center gap-2 md:flex">
                <span className="h-1.5 w-14 overflow-hidden rounded-full bg-chart-track">
                  <span className={cx("block h-full rounded-full", over ? "bg-warn" : "bg-chart")} style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
                </span>
                <span className="text-xs text-faint">{formatEur(budget)}</span>
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
