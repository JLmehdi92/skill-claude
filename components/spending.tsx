"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DownloadSimple, PencilSimple } from "@phosphor-icons/react";
import { api, notifyStatsChanged, STATS_EVENT } from "@/lib/client/api";
import { formatEur } from "@/lib/costs";
import type { Generation, SpendBucket, Stats } from "@/lib/types";
import { Button, cx } from "./ui";

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const parseDay = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
};

export function Spending() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [ledger, setLedger] = useState<Generation[]>([]);
  const [balance, setBalance] = useState<{ credits: number; eur: number } | null | "error">(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message));
    api
      .list({ limit: 25 })
      .then((r) => setLedger(r.items.filter((g) => g.costEur !== null || g.status !== "failed")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    api.credits().then(setBalance).catch(() => setBalance("error"));
    window.addEventListener(STATS_EVENT, load);
    return () => window.removeEventListener(STATS_EVENT, load);
  }, [load]);

  if (error) return <main className="mx-auto max-w-6xl px-4 pt-10 text-sm text-danger sm:px-6">{error}</main>;
  if (!stats) {
    return (
      <main className="mx-auto max-w-6xl px-4 pt-10 sm:px-6" aria-busy="true">
        <div className="shimmer h-10 w-48 rounded-full" />
        <div className="shimmer mt-8 h-40 rounded-[var(--radius-surface)]" />
        <div className="shimmer mt-4 h-72 rounded-[var(--radius-surface)]" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dépenses</h1>
          <p className="mt-1 text-sm text-muted">En euros, au taux BCE figé le jour de chaque génération.</p>
        </div>
        <a href="/api/export?format=csv" className="pressable inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 text-[13px] font-medium hover:bg-hover">
          <DownloadSimple size={14} />
          Export CSV
        </a>
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-6">
          <p className="text-sm text-muted">Ce mois-ci</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight md:text-6xl">{formatEur(stats.month)}</p>
          <BudgetMeter stats={stats} onSaved={() => { load(); notifyStatsChanged(); }} />
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-surface)] border border-line bg-line">
          <Tile label="Aujourd'hui" value={formatEur(stats.today)} />
          <Tile label="Cette semaine" value={formatEur(stats.week)} />
          <Tile label="Depuis le début" value={formatEur(stats.total)} sub={`${stats.successCount} réussie${stats.successCount > 1 ? "s" : ""}, ${stats.failedCount} échouée${stats.failedCount > 1 ? "s" : ""}`} />
          <Tile
            label="En cours"
            value={stats.pendingCount ? `≈ ${formatEur(stats.pendingEur)}` : formatEur(0)}
            sub={stats.pendingCount ? `${stats.pendingCount} génération${stats.pendingCount > 1 ? "s" : ""}, estimation` : "Rien en cours"}
          />
        </dl>
      </section>

      <section className="mt-4 rounded-[var(--radius-surface)] border border-line bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-medium">Dépenses par jour</h2>
          <p className="text-xs text-faint">30 derniers jours</p>
        </div>
        <DailyChart daily={stats.daily} />
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <Breakdown title="Par modèle" buckets={stats.byModel} />
        <Breakdown title="Par type" buckets={stats.byCategory} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-6">
          <h2 className="text-base font-medium">Solde kie.ai</h2>
          {balance === null && <div className="shimmer mt-4 h-9 w-32 rounded-full" />}
          {balance === "error" && <p className="mt-3 text-sm leading-relaxed text-muted">Solde indisponible. Vérifie ta clé API et ta connexion.</p>}
          {balance && balance !== "error" && (
            <>
              <p className="mt-3 text-3xl font-semibold tracking-tight">{new Intl.NumberFormat("fr-FR").format(balance.credits)} crédits</p>
              <p className="mt-1 text-sm text-muted">Environ {formatEur(balance.eur)} restants</p>
            </>
          )}
          <p className="mt-4 text-xs leading-relaxed text-faint">
            1 crédit = 0,005 $. Taux du jour : 1 $ = {stats.usdEurRate.toFixed(4).replace(".", ",")} €
            {stats.rateSource === "fallback" ? " (taux de secours, BCE injoignable)" : ""}.
          </p>
        </div>
        <Ledger items={ledger} />
      </section>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface p-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      {sub && <dd className="mt-1 text-xs text-faint">{sub}</dd>}
    </div>
  );
}

function BudgetMeter({ stats, onSaved }: { stats: Stats; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(stats.monthlyBudgetEur ? String(stats.monthlyBudgetEur) : "");
  const budget = stats.monthlyBudgetEur;
  const ratio = budget ? stats.month / budget : 0;
  const level = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warn" : "ok";

  const save = async () => {
    const n = Number(value.replace(",", "."));
    try {
      await api.setBudget(value.trim() && n > 0 ? n : null);
      toast.success(value.trim() && n > 0 ? "Budget enregistré" : "Budget retiré");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (editing) {
    return (
      <form
        className="mt-6 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="budget" className="text-sm text-muted">
            Budget mensuel (€)
          </label>
          <input
            id="budget"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="Aucun"
            className="h-9 w-36 rounded-full border border-line-strong bg-canvas px-4 text-sm tabular-nums placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
        <Button type="submit" variant="primary">
          Enregistrer
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
        <p className="w-full text-xs text-faint">Une confirmation sera demandée avant toute génération qui dépasse ce montant. Laisse vide pour aucun budget.</p>
      </form>
    );
  }

  return (
    <div className="mt-6">
      {budget ? (
        <>
          <div className="flex items-baseline justify-between text-sm">
            <span className={cx(level === "ok" ? "text-muted" : level === "warn" ? "text-warn" : "text-danger")}>
              {level === "danger" ? "Budget dépassé" : level === "warn" ? "Plus de 80 % du budget" : `${Math.round(ratio * 100)} % du budget`}
            </span>
            <span className="text-muted tabular-nums">
              {formatEur(stats.month)} / {formatEur(budget)}
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-chart-track"
            role="meter"
            aria-label="Budget mensuel consommé"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={stats.month}
          >
            <div
              className={cx("h-full rounded-full", level === "ok" ? "bg-chart-hover" : level === "warn" ? "bg-warn" : "bg-danger")}
              style={{ width: `${Math.min(ratio, 1) * 100}%` }}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Aucun budget mensuel défini.</p>
      )}
      <button type="button" onClick={() => setEditing(true)} className="pressable mt-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-muted hover:bg-raised hover:text-fg">
        <PencilSimple size={13} />
        {budget ? "Modifier le budget" : "Définir un budget"}
      </button>
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function DailyChart({ daily }: { daily: Stats["daily"] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 220;
  const pad = { top: 16, right: 8, bottom: 26, left: 48 };
  const innerW = Math.max(width - pad.left - pad.right, 100);
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...daily.map((d) => d.eur)));
  const ticks = [0, max / 2, max];
  const band = innerW / daily.length;
  const barW = Math.min(24, Math.max(band - 2, 2));
  const peak = daily.reduce((best, d, i) => (d.eur > daily[best].eur ? i : best), 0);
  const empty = daily.every((d) => d.eur === 0);
  const x = (i: number) => pad.left + i * band + (band - barW) / 2;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const active = hover !== null ? daily[hover] : null;

  return (
    <div className="mt-4">
      <div ref={wrap} className="relative">
        <svg width={width} height={height} role="img" aria-label="Dépenses quotidiennes sur 30 jours" className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[11px] tabular-nums">
                {formatEur(t)}
              </text>
            </g>
          ))}
          {daily.map((d, i) => {
            const h = Math.max((d.eur / max) * innerH, d.eur > 0 ? 2 : 0);
            const r = Math.min(4, h);
            const bx = x(i);
            const by = pad.top + innerH - h;
            return (
              <g key={d.date}>
                {h > 0 && (
                  <path
                    d={`M${bx},${by + h} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${by + h} Z`}
                    fill={hover === i ? "var(--color-chart-hover)" : "var(--color-chart)"}
                  />
                )}
                <rect
                  x={pad.left + i * band}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${longDayFmt.format(parseDay(d.date))} : ${formatEur(d.eur)}, ${d.count} génération${d.count > 1 ? "s" : ""}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
          {!empty && daily[peak].eur > 0 && hover === null && (
            <text x={x(peak) + barW / 2} y={y(daily[peak].eur) - 6} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">
              {formatEur(daily[peak].eur)}
            </text>
          )}
          {daily.map((d, i) =>
            i % Math.ceil(daily.length / Math.max(Math.floor(innerW / 70), 2)) === 0 || i === daily.length - 1 ? (
              <text key={d.date} x={x(i) + barW / 2} y={height - 6} textAnchor="middle" className="fill-faint text-[11px]">
                {i === daily.length - 1 ? "Auj." : dayFmt.format(parseDay(d.date))}
              </text>
            ) : null,
          )}
        </svg>
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[10px] border border-line-strong bg-raised px-3 py-2 shadow-lg"
            style={{ left: Math.min(Math.max(x(hover) + barW / 2, 70), width - 70), top: Math.max(y(active.eur) - 64, 0) }}
          >
            <p className="text-sm font-semibold tabular-nums">{formatEur(active.eur)}</p>
            <p className="text-xs whitespace-nowrap text-muted">
              {longDayFmt.format(parseDay(active.date))}, {active.count} génération{active.count > 1 ? "s" : ""}
            </p>
          </div>
        )}
        {empty && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-faint">Aucune dépense sur cette période</p>}
      </div>
      <button type="button" onClick={() => setTable((t) => !t)} className="mt-3 text-xs text-muted underline-offset-4 hover:text-fg hover:underline">
        {table ? "Masquer le tableau" : "Voir en tableau"}
      </button>
      {table && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="py-1.5 font-normal">Jour</th>
              <th className="py-1.5 text-right font-normal">Générations</th>
              <th className="py-1.5 text-right font-normal">Dépense</th>
            </tr>
          </thead>
          <tbody>
            {[...daily].reverse().filter((d) => d.count > 0).map((d) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1.5 text-muted">{longDayFmt.format(parseDay(d.date))}</td>
                <td className="py-1.5 text-right text-muted tabular-nums">{d.count}</td>
                <td className="py-1.5 text-right tabular-nums">{formatEur(d.eur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Breakdown({ title, buckets }: { title: string; buckets: SpendBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.eur), 0);
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-6">
      <h2 className="text-base font-medium">{title}</h2>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-faint">Pas encore de dépense.</p>
      ) : (
        <ul className="mt-4 space-y-3.5">
          {buckets.map((b) => (
            <li key={b.key} title={`${b.label} : ${formatEur(b.eur)}, ${b.count} génération${b.count > 1 ? "s" : ""}`}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-fg">{b.label}</span>
                <span className="tabular-nums">
                  {formatEur(b.eur)} <span className="text-xs text-faint">{b.count}×</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5">
                <div className="h-full rounded-r-[4px] bg-chart" style={{ width: `${max ? Math.max((b.eur / max) * 100, 1) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ledger({ items }: { items: Generation[] }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium">Dernières générations</h2>
        <Link href="/library" className="text-xs text-muted hover:text-fg">
          Tout l&apos;historique
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-faint">Aucune génération pour l&apos;instant.</p>
      ) : (
        <table className="mt-3 w-full table-fixed text-sm">
          <colgroup>
            <col className="w-32" />
            <col />
            <col className="w-24" />
          </colgroup>
          <thead className="sr-only">
            <tr>
              <th>Date</th>
              <th>Prompt</th>
              <th>Coût</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id} className="border-t border-line first:border-t-0">
                <td className="py-2 text-xs text-faint tabular-nums">{dateTimeFmt.format(g.createdAt)}</td>
                <td className="truncate py-2 pr-4 text-muted" title={g.prompt}>
                  <span className="text-fg">{g.modelLabel}</span> {g.prompt}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {g.costEur !== null ? formatEur(g.costEur) : <span className="text-faint">≈ {formatEur(g.estimatedEur)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
