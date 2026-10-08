import crypto from 'node:crypto';
import path from 'node:path';

export const now = () => new Date().toISOString();
export const uid = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function slugify(s, sep = '-') {
  const out = String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
  return out.slice(0, 60) || 'item';
}

export const json = (v, fallback = null) => {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

/** Resolve `rel` inside `root`; throw if it escapes (`..`, absolute paths, symlink tricks are checked lexically). */
export function safeJoin(root, rel = '.') {
  const target = path.resolve(root, String(rel).replace(/^[/\\]+/, ''));
  const r = path.relative(root, target);
  if (r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r)) {
    throw new Error(`Path escapes its folder: ${rel}`);
  }
  return target;
}

export class ToolError extends Error {}

export function truncate(s, max) {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}

/** Replace ${VAR} with values from `vars`; unknown vars are left untouched. */
export function interpolate(value, vars) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (m, k) => (k in vars ? vars[k] : m));
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, vars)]));
  return value;
}

export function missingVars(value, vars) {
  const found = new Set();
  JSON.stringify(value ?? '').replace(/\$\{([A-Z0-9_]+)\}/gi, (m, k) => { if (!(k in vars)) found.add(k); return m; });
  return [...found];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
