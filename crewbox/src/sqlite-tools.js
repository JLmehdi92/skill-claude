import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Private (per coworker) and shared SQLite databases, as exposed to coworkers and the API.

const handles = new Map();

export function openFileDb(file) {
  let d = handles.get(file);
  if (!d) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    d = new DatabaseSync(file);
    d.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    d.exec("CREATE TABLE IF NOT EXISTS _crewbox_owners (tbl TEXT PRIMARY KEY, owner TEXT, created_at TEXT)");
    handles.set(file, d);
  }
  return d;
}

export function closeFileDb(file) {
  const d = handles.get(file);
  if (d) { d.close(); handles.delete(file); }
}

export function closeAllFileDbs() { for (const f of [...handles.keys()]) closeFileDb(f); }

const READ_RE = /^\s*(with\b[\s\S]*\bselect\b|select\b|pragma\s+table_info|explain\b)/i;

export function listTables(file) {
  const d = openFileDb(file);
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_crewbox_owners' ORDER BY name").all();
  return tables.map(({ name }) => {
    const cols = d.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all();
    const owner = d.prepare('SELECT owner FROM _crewbox_owners WHERE tbl = ?').get(name)?.owner ?? null;
    const count = d.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n;
    return {
      name, rows: count, createdBy: owner,
      columns: cols.map((c) => ({ name: c.name, type: c.type, primaryKey: !!c.pk, notNull: !!c.notnull })),
    };
  });
}

export function dbQuery(file, sql, params = [], limit = 100) {
  if (!READ_RE.test(sql) || /;\s*\S/.test(sql.trim().replace(/;\s*$/, ''))) {
    throw new Error('db_query runs a single read-only SELECT (or WITH … SELECT). Use db_execute to write.');
  }
  limit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const d = openFileDb(file);
  const stmt = d.prepare(sql);
  const rows = [];
  for (const row of stmt.iterate(...(params || []))) {
    rows.push({ ...row });
    if (rows.length > limit) break;
  }
  const truncated = rows.length > limit;
  return { rows: rows.slice(0, limit), rowCount: Math.min(rows.length, limit), truncated };
}

export function dbExecute(file, { sql, params, statements }, owner = null) {
  const list = statements?.length ? statements : sql ? [{ sql, params }] : null;
  if (!list) throw new Error('Pass either sql or statements.');
  const d = openFileDb(file);
  const results = [];
  d.exec('BEGIN');
  try {
    for (const s of list) {
      const r = d.prepare(s.sql).run(...(s.params || []));
      results.push({ changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) });
      const m = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?["`[]?([\w-]+)/i.exec(s.sql);
      if (m) d.prepare('INSERT OR IGNORE INTO _crewbox_owners(tbl, owner, created_at) VALUES(?,?,?)').run(m[1], owner, new Date().toISOString());
      const dm = /^\s*drop\s+table\s+(?:if\s+exists\s+)?["`[]?([\w-]+)/i.exec(s.sql);
      if (dm) d.prepare('DELETE FROM _crewbox_owners WHERE tbl = ?').run(dm[1]);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, results };
}

export function tableOwner(file, table) {
  return openFileDb(file).prepare('SELECT owner FROM _crewbox_owners WHERE tbl = ?').get(table)?.owner ?? null;
}
