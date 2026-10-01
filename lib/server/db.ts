import "server-only";
// Built into Node (>= 22.13): no native module to compile, so nothing can crash on install (better-sqlite3 did on Windows).
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export type GenerationStatus = "uploading" | "queued" | "generating" | "success" | "failed";

export interface GenerationRow {
  id: string;
  model: string;
  model_label: string;
  category: string;
  kie_task_id: string | null;
  status: GenerationStatus;
  prompt: string;
  params_json: string;
  inputs_json: string;
  kie_input_json: string | null;
  result_urls_json: string | null;
  outputs_json: string | null;
  thumb_path: string | null;
  estimated_credits: number;
  credits: number | null;
  cost_usd: number | null;
  cost_eur: number | null;
  usd_eur_rate: number;
  error: string | null;
  progress: number | null;
  favorite: number;
  created_at: number;
  completed_at: number | null;
  deleted_at: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  model_label TEXT NOT NULL,
  category TEXT NOT NULL,
  kie_task_id TEXT,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  params_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '[]',
  kie_input_json TEXT,
  result_urls_json TEXT,
  outputs_json TEXT,
  thumb_path TEXT,
  estimated_credits REAL NOT NULL DEFAULT 0,
  credits REAL,
  cost_usd REAL,
  cost_eur REAL,
  usd_eur_rate REAL NOT NULL,
  error TEXT,
  progress INTEGER,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS generations_created ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS generations_status ON generations(status);
CREATE UNIQUE INDEX IF NOT EXISTS generations_task ON generations(kie_task_id) WHERE kie_task_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as { __hfDb?: DatabaseSync; __hfDbPath?: string };

export function db(): DatabaseSync {
  const file = path.join(config.storageDir, "higgsfield-local.sqlite");
  if (globalForDb.__hfDb && globalForDb.__hfDbPath === file) return globalForDb.__hfDb;
  fs.mkdirSync(config.storageDir, { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  conn.exec(SCHEMA);
  migrate(conn);
  globalForDb.__hfDb = conn;
  globalForDb.__hfDbPath = file;
  return conn;
}

/** Loads node:sqlite without its one-time "experimental feature" warning, which reads like an error in the terminal. */
function loadSqlite(): typeof import("node:sqlite") {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes("SQLite is an experimental feature")) return;
    (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const mod = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!mod) throw new Error("SQLite intégré introuvable : installe Node.js 24 LTS (ou 22.13 minimum) depuis https://nodejs.org.");
    return mod;
  } finally {
    process.emitWarning = emit;
  }
}

/** Additive migrations for databases created by earlier versions. */
function migrate(conn: DatabaseSync) {
  const cols = new Set((conn.prepare("PRAGMA table_info(generations)").all() as unknown as { name: string }[]).map((c) => c.name));
  if (!cols.has("deleted_at")) conn.exec("ALTER TABLE generations ADD COLUMN deleted_at INTEGER");
}

export function getSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as unknown as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) db().prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
