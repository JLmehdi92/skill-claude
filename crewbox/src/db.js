import { DatabaseSync } from 'node:sqlite';
import { paths, ensureDirs } from './config.js';
import { json } from './util.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, position INTEGER DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT,
  secret_name TEXT, models TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, handle TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '', soul TEXT DEFAULT '', connection_id TEXT, model TEXT,
  verbosity TEXT DEFAULT 'normal', tools TEXT, self_improvement TEXT, approvals TEXT, setup TEXT,
  enabled INTEGER DEFAULT 1, avatar TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT, kind TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]', state TEXT, allowed_tools TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_agent ON sessions(agent_id, updated_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL,
  trigger TEXT NOT NULL, provider TEXT, model TEXT, steps INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cost_usd REAL,
  started_at TEXT NOT NULL, finished_at TEXT, error TEXT, output TEXT
);
CREATE INDEX IF NOT EXISTS runs_agent ON runs(agent_id, started_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step INTEGER, tool TEXT,
  input TEXT, result TEXT, is_error INTEGER DEFAULT 0, duration_ms INTEGER, created_at TEXT
);
CREATE INDEX IF NOT EXISTS tool_calls_run ON tool_calls(run_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, content TEXT NOT NULL, tags TEXT,
  uses INTEGER DEFAULT 0, created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, body TEXT NOT NULL, cron TEXT, run_at TEXT, timezone TEXT,
  connection_id TEXT, model TEXT, enabled INTEGER DEFAULT 1, last_run_at TEXT, last_run_id TEXT,
  created_at TEXT NOT NULL, UNIQUE(agent_id, slug)
);

CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, body TEXT NOT NULL, methods TEXT NOT NULL, token TEXT NOT NULL,
  connection_id TEXT, model TEXT, enabled INTEGER DEFAULT 1, fire_count INTEGER DEFAULT 0,
  last_fired_at TEXT, created_at TEXT NOT NULL, UNIQUE(agent_id, slug)
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
  transport TEXT NOT NULL, command TEXT, args TEXT, url TEXT, headers TEXT, env TEXT,
  connector TEXT, enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(agent_id, slug)
);

CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, name)
);

CREATE TABLE IF NOT EXISTS permissions (
  agent_id TEXT NOT NULL, tool TEXT NOT NULL, decision TEXT NOT NULL, PRIMARY KEY (agent_id, tool)
);

CREATE TABLE IF NOT EXISTS pauses (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL,
  kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', answer TEXT,
  created_at TEXT NOT NULL, answered_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, agent_id TEXT, run_id TEXT, pause_id TEXT, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS published (
  slug TEXT PRIMARY KEY, agent_id TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(agent_id, path)
);
`;

let db;

export function openDb() {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(paths.db);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Additive migrations for databases created by earlier versions.
  for (const sql of ['ALTER TABLE sessions ADD COLUMN engine_session TEXT', 'ALTER TABLE agents ADD COLUMN color TEXT', 'ALTER TABLE mcp_servers ADD COLUMN spec TEXT', 'ALTER TABLE mcp_servers ADD COLUMN auth TEXT']) {
    try { db.exec(sql); } catch { /* already applied */ }
  }
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = undefined; }
}

const plain = (row) => (row ? { ...row } : row);

export const q = {
  get: (sql, ...p) => plain(openDb().prepare(sql).get(...p)),
  all: (sql, ...p) => openDb().prepare(sql).all(...p).map(plain),
  run: (sql, ...p) => openDb().prepare(sql).run(...p),
};

export function tx(fn) {
  const d = openDb();
  d.exec('BEGIN');
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

export function getSetting(key, fallback = null) {
  const r = q.get('SELECT value FROM settings WHERE key = ?', key);
  return r ? json(r.value, fallback) : fallback;
}

export function setSetting(key, value) {
  q.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

/** Insert a row from a plain object. */
export function insert(table, obj) {
  const keys = Object.keys(obj);
  q.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => toSql(obj[k])));
}

export function update(table, where, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const wk = Object.keys(where);
  q.run(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${wk.map((k) => `${k} = ?`).join(' AND ')}`,
    ...keys.map((k) => toSql(obj[k])), ...wk.map((k) => where[k]),
  );
}

function toSql(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
