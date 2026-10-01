"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FilmSlate } from "@phosphor-icons/react";
import { api, STATS_EVENT } from "@/lib/client/api";
import { formatEur } from "@/lib/costs";
import type { AppConfig, Stats } from "@/lib/types";

const LINKS = [
  { href: "/", label: "Créer" },
  { href: "/library", label: "Historique" },
  { href: "/depenses", label: "Dépenses" },
];

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

  const budget = stats?.monthlyBudgetEur ?? null;
  const ratio = budget && stats ? Math.min(stats.month / budget, 1) : 0;
  const over = budget !== null && stats !== null && stats.month >= budget * 0.8;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
          <FilmSlate size={20} weight="fill" className="text-accent" />
          <span className="hidden sm:inline">Higgsfield</span>
          <span className="hidden font-normal text-muted sm:inline">local</span>
        </Link>

        <nav className="flex items-center sm:gap-1" aria-label="Navigation principale">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`pressable rounded-full px-2.5 py-1.5 text-sm sm:px-3 ${active ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {cfg?.mock && (
            <span className="hidden rounded-full border border-warn/30 px-2.5 py-1 text-xs text-warn sm:inline" title="KIE_MOCK=1 : aucun appel réel, aucun crédit dépensé">
              Mode test
            </span>
          )}
          {cfg && !cfg.hasKey && (
            <span className="rounded-full border border-danger/40 px-2.5 py-1 text-xs text-danger" title="Ajoute KIE_API_KEY dans .env.local puis relance le serveur">
              Clé API manquante
            </span>
          )}
          <Link
            href="/depenses"
            className="pressable flex items-center gap-2.5 rounded-full border border-line px-2.5 py-1.5 text-sm hover:border-line-strong sm:px-3"
            aria-label="Dépenses du mois"
          >
            <span className="hidden text-muted sm:inline">Ce mois</span>
            <span className="font-medium tabular-nums">{stats ? formatEur(stats.month) : "..."}</span>
            {budget !== null && (
              <span className="hidden items-center gap-2 sm:flex">
                <span className="h-1 w-14 overflow-hidden rounded-full bg-hover">
                  <span
                    className={`block h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`}
                    style={{ width: `${Math.max(ratio * 100, 2)}%` }}
                  />
                </span>
                <span className="text-xs text-faint tabular-nums">{formatEur(budget)}</span>
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
