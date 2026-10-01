import type { NextRequest } from "next/server";
import { db, type GenerationRow } from "@/lib/server/db";
import { toDto } from "@/lib/server/generations";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

/** GET /api/export?format=json (full history backup) or format=csv (spending ledger, Excel FR friendly). */
export function GET(req: NextRequest) {
  const rows = db().prepare("SELECT * FROM generations ORDER BY created_at DESC").all() as unknown as GenerationRow[];
  const stamp = new Date().toISOString().slice(0, 10);

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const header = ["date", "modele", "type", "statut", "credits", "cout_usd", "cout_eur", "taux_usd_eur", "prompt", "kie_task_id"];
    const lines = rows.map((r) =>
      [
        new Date(r.created_at).toLocaleString("fr-FR"),
        r.model_label,
        r.category,
        r.status,
        num(r.credits),
        num(r.cost_usd),
        num(r.cost_eur),
        num(r.usd_eur_rate),
        r.prompt,
        r.kie_task_id,
      ]
        .map(csvCell)
        .join(";"),
    );
    // BOM so Excel opens accents correctly.
    return new Response("﻿" + [header.join(";"), ...lines].join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="depenses-higgsfield-local-${stamp}.csv"`,
      },
    });
  }

  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), generations: rows.map(toDto) }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="historique-higgsfield-local-${stamp}.json"`,
    },
  });
}
