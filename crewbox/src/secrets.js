import { q } from './db.js';
import { now } from './util.js';

// Values live only in the local database and are never sent to a model.
// Scope is 'workspace' or an agent id; an agent sees workspace secrets overlaid by its own.

export function setSecret(scope, name, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Secret names are UPPER_SNAKE_CASE, e.g. STRIPE_API_KEY');
  q.run(
    'INSERT INTO secrets(scope, name, value, updated_at) VALUES(?,?,?,?) ON CONFLICT(scope, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    scope, name, String(value), now(),
  );
}

export const deleteSecret = (scope, name) => q.run('DELETE FROM secrets WHERE scope = ? AND name = ?', scope, name);

export const listSecretNames = (scope) =>
  q.all('SELECT name, updated_at FROM secrets WHERE scope = ? ORDER BY name', scope);

export function secretVars(agentId) {
  const vars = {};
  for (const r of q.all("SELECT name, value FROM secrets WHERE scope = 'workspace'")) vars[r.name] = r.value;
  if (agentId) for (const r of q.all('SELECT name, value FROM secrets WHERE scope = ?', agentId)) vars[r.name] = r.value;
  return vars;
}

export const getSecret = (scope, name) => q.get('SELECT value FROM secrets WHERE scope = ? AND name = ?', scope, name)?.value ?? null;

/** Remove every known secret value from text before it reaches a model or a log. */
export function redact(text, agentId) {
  let s = String(text ?? '');
  for (const v of Object.values(secretVars(agentId))) if (v && v.length >= 6) s = s.split(v).join('[secret]');
  return s;
}
