import fs from 'node:fs';
import { q, insert, update, tx, getSetting } from './db.js';
import { paths, ensureAgentDirs } from './config.js';
import { uid, now, json, slugify } from './util.js';
import { resolveRunsOn, getConnection, listConnections } from './providers/index.js';
import { listSkills } from './skills.js';
import { closeFileDb } from './sqlite-tools.js';
import { emit } from './bus.js';

export const TOOL_FAMILIES = [
  'filesystem', 'shared', 'shell', 'web', 'memory', 'db', 'sharedDb', 'skills', 'schedule', 'trigger',
  'delegate', 'callAgent', 'vision', 'notify', 'hub', 'askUser', 'requestApproval', 'suggestService', 'requestSecret',
];
export const DEFAULT_TOOLS = Object.fromEntries(TOOL_FAMILIES.map((f) => [f, true]));
export const DEFAULT_SELF = { enabled: true, allowSoulEdit: true, allowToolInstall: true, autoMemory: true };
// Which actions stop for a human before they run (on top of what the coworker asks itself).
export const DEFAULT_APPROVALS = { appWrites: true, shell: false, publish: false };
export const VERBOSITY = ['minimal', 'concise', 'normal', 'detailed'];

/* ---------- Boxes (spaces) ---------- */

export function listSpaces() {
  return q.all('SELECT s.id, s.name, s.color, s.position, s.created_at, (SELECT COUNT(*) FROM agents a WHERE a.space_id = s.id) AS agentCount FROM spaces s ORDER BY s.position, s.created_at')
    .map((s) => ({ id: s.id, name: s.name, color: s.color, agentCount: s.agentCount, createdAt: s.created_at }));
}

export function createSpace({ name, color }) {
  const id = uid('box_');
  const pos = q.get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM spaces').p;
  insert('spaces', { id, name: name || 'New Box', color: color || null, position: pos, created_at: now() });
  emit('spaces', {});
  return listSpaces().find((s) => s.id === id);
}

export function updateSpace(id, { name, color }) {
  update('spaces', { id }, Object.fromEntries(Object.entries({ name, color }).filter(([, v]) => v !== undefined)));
  emit('spaces', {});
  return listSpaces().find((s) => s.id === id);
}

export function deleteSpace(id) {
  const n = q.get('SELECT COUNT(*) AS n FROM agents WHERE space_id = ?', id).n;
  if (n) throw new Error('Move or delete the coworkers of this Box first.');
  q.run('DELETE FROM spaces WHERE id = ?', id);
  emit('spaces', {});
}

export function ensureDefaultSpace() {
  if (!q.get('SELECT id FROM spaces LIMIT 1')) createSpace({ name: getSetting('language', 'fr') === 'en' ? 'Main Box' : 'Box principale' });
}

/* ---------- coworkers ---------- */

function row(id) {
  const r = q.get('SELECT * FROM agents WHERE id = ?', id) || q.get('SELECT * FROM agents WHERE handle = ?', id);
  if (!r) throw new Error(`Agent not found: ${id}`);
  return r;
}

export function agentConfig(id) {
  const r = row(id);
  return {
    ...r,
    tools: { ...DEFAULT_TOOLS, ...json(r.tools, {}) },
    selfImprovement: { ...DEFAULT_SELF, ...json(r.self_improvement, {}) },
    approvals: { ...DEFAULT_APPROVALS, ...json(r.approvals, {}) },
    setup: json(r.setup, null),
    enabled: !!r.enabled,
  };
}

export function summary(r) {
  return {
    id: r.id, name: r.name, handle: r.handle, description: r.description, status: agentStatus(r.id), enabled: !!r.enabled, space_id: r.space_id, avatar: r.avatar, created_at: r.created_at,
    schedules: q.get('SELECT COUNT(*) AS n FROM schedules WHERE agent_id = ? AND enabled = 1', r.id).n,
    triggers: q.get('SELECT COUNT(*) AS n FROM triggers WHERE agent_id = ? AND enabled = 1', r.id).n,
    apps: q.get('SELECT COUNT(*) AS n FROM mcp_servers WHERE agent_id = ? AND enabled = 1', r.id).n,
  };
}

export function agentStatus(id) {
  if (q.get("SELECT 1 FROM pauses WHERE agent_id = ? AND status = 'pending' LIMIT 1", id)) return 'waiting';
  if (q.get("SELECT 1 FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1", id)) return 'running';
  const last = q.get('SELECT status FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1', id);
  return last?.status === 'error' ? 'error' : 'idle';
}

export function listAgents({ spaceId } = {}) {
  const rows = spaceId ? q.all('SELECT * FROM agents WHERE space_id = ? ORDER BY created_at DESC', spaceId) : q.all('SELECT * FROM agents ORDER BY created_at DESC');
  return rows.map(summary);
}

export function getAgent(id) {
  const a = agentConfig(id);
  const runsOn = resolveRunsOn({ connectionId: a.connection_id, model: a.model });
  return {
    id: a.id, handle: a.handle, name: a.name, description: a.description, spaceId: a.space_id, enabled: a.enabled, avatar: a.avatar,
    soul: a.soul, provider: runsOn.provider, model: runsOn.model, verbosity: a.verbosity,
    runsOn: { connectionId: runsOn.connectionId || null, provider: runsOn.provider, model: runsOn.model, followsDefault: runsOn.followsDefault },
    tools: a.tools, selfImprovement: a.selfImprovement, approvals: a.approvals, setup: a.setup,
    mcpServers: q.all('SELECT slug, name, transport, connector, enabled FROM mcp_servers WHERE agent_id = ?', a.id).map((s) => ({ ...s, enabled: !!s.enabled })),
    skills: listSkills(a.id).map(({ slug, name, description, readOnly }) => ({ slug, name, description, ...(readOnly ? { readOnly } : {}) })),
    schedules: q.all('SELECT slug, name, cron, run_at AS runAt, timezone, enabled FROM schedules WHERE agent_id = ?', a.id).map((s) => ({ ...s, enabled: !!s.enabled })),
    triggers: q.all('SELECT slug, name, enabled, fire_count AS fireCount FROM triggers WHERE agent_id = ?', a.id).map((t) => ({ ...t, enabled: !!t.enabled })),
    status: agentStatus(a.id),
    createdAt: a.created_at, updatedAt: a.updated_at,
  };
}

function uniqueHandle(base) {
  let h = slugify(base, '_').slice(0, 40), i = 1;
  while (q.get('SELECT 1 FROM agents WHERE handle = ?', h)) h = `${slugify(base, '_').slice(0, 36)}_${++i}`;
  return h;
}

function resolveConnectionArgs({ connectionId, provider, model }) {
  if (connectionId) {
    const c = getConnection(connectionId);
    if (!c) throw new Error(`Unknown connectionId. Available: ${listConnections().map((x) => `${x.id} (${x.provider})`).join(', ') || 'none'}`);
    if (!c.connected) throw new Error(`Connection ${c.name} is not signed in.`);
    if (model && !c.models.includes(model)) throw new Error(`${c.name} does not serve ${model}. It serves: ${c.models.join(', ')}`);
    return { connection_id: c.id, model: model ?? null };
  }
  if (provider) {
    const list = listConnections().filter((c) => c.provider === provider);
    if (!list.length) throw new Error(`No ${provider} connection. Add one under AI providers.`);
    if (list.length > 1) throw new Error(`Several ${provider} connections, pass connectionId: ${list.map((c) => `${c.id} (${c.name})`).join(', ')}`);
    return resolveConnectionArgs({ connectionId: list[0].id, model });
  }
  if (model === null) return { connection_id: null, model: null };
  if (model) throw new Error('Pass connectionId (or provider) together with model.');
  return {};
}

export function createAgent(args) {
  const { name, soul = '', description = '', spaceId, tools, selfImprovement, approvals, setup, verbosity = 'normal', handle } = args;
  if (!name) throw new Error('name is required.');
  if (!VERBOSITY.includes(verbosity)) throw new Error(`verbosity is one of ${VERBOSITY.join(', ')}`);
  if (setup && (typeof setup.required !== 'boolean' || (setup.required && !setup.prompt))) throw new Error('setup needs a boolean "required", and a "prompt" when required is true.');
  const spaces = listSpaces();
  let space = spaceId;
  if (!space) {
    if (spaces.length !== 1) throw new Error(`Several Boxes, pass spaceId: ${spaces.map((s) => `${s.id} (${s.name})`).join(', ')}`);
    space = spaces[0].id;
  } else if (!spaces.some((s) => s.id === space)) throw new Error(`Unknown spaceId. Boxes: ${spaces.map((s) => `${s.id} (${s.name})`).join(', ')}`);
  const conn = resolveConnectionArgs(args);
  const id = uid('agt_');
  insert('agents', {
    id, space_id: space, name, handle: handle ? uniqueHandle(handle) : uniqueHandle(name), description, soul,
    connection_id: conn.connection_id ?? null, model: conn.model ?? null, verbosity,
    tools: tools || {}, self_improvement: selfImprovement || {}, approvals: approvals || {}, setup: setup || null,
    enabled: 1, avatar: args.avatar || null, created_at: now(), updated_at: now(),
  });
  ensureAgentDirs(id);
  emit('agents', { id });
  return getAgent(id);
}

export function updateAgent(id, args) {
  const a = agentConfig(id);
  const patch = {};
  const updated = [];
  for (const k of ['name', 'description', 'soul', 'avatar']) if (args[k] !== undefined) { patch[k] = args[k]; updated.push(k); }
  if (args.verbosity !== undefined) {
    if (!VERBOSITY.includes(args.verbosity)) throw new Error(`verbosity is one of ${VERBOSITY.join(', ')}`);
    patch.verbosity = args.verbosity; updated.push('verbosity');
  }
  if (args.handle !== undefined && args.handle !== a.handle) {
    const h = slugify(args.handle, '_');
    if (q.get('SELECT 1 FROM agents WHERE handle = ? AND id != ?', h, a.id)) throw new Error(`Handle @${h} is taken.`);
    patch.handle = h; updated.push('handle');
  }
  if (args.spaceId !== undefined) {
    if (!q.get('SELECT 1 FROM spaces WHERE id = ?', args.spaceId)) throw new Error('Unknown spaceId.');
    patch.space_id = args.spaceId; updated.push('spaceId');
  }
  if (args.enabled !== undefined) { patch.enabled = !!args.enabled; updated.push('enabled'); }
  if (args.tools) { patch.tools = { ...a.tools, ...args.tools }; updated.push('tools'); }
  if (args.selfImprovement) { patch.self_improvement = { ...a.selfImprovement, ...args.selfImprovement }; updated.push('selfImprovement'); }
  if (args.approvals) { patch.approvals = { ...a.approvals, ...args.approvals }; updated.push('approvals'); }
  if (args.setup !== undefined) { patch.setup = args.setup; updated.push('setup'); }
  const touchesModel = args.connectionId !== undefined || args.provider !== undefined || args.model !== undefined;
  if (touchesModel) {
    Object.assign(patch, resolveConnectionArgs(args));
    updated.push('model');
  }
  patch.updated_at = now();
  update('agents', { id: a.id }, patch);
  emit('agents', { id: a.id });
  const out = { agentId: a.id, updated };
  if (touchesModel) out.runsOn = getAgent(a.id).runsOn;
  return out;
}

export function deleteAgent(id) {
  const a = row(id);
  tx(() => {
    q.run('DELETE FROM tool_calls WHERE run_id IN (SELECT id FROM runs WHERE agent_id = ?)', a.id);
    for (const t of ['sessions', 'runs', 'memories', 'schedules', 'triggers', 'mcp_servers', 'permissions', 'pauses', 'notifications', 'published']) q.run(`DELETE FROM ${t} WHERE agent_id = ?`, a.id);
    q.run('DELETE FROM secrets WHERE scope = ?', a.id);
    q.run('DELETE FROM agents WHERE id = ?', a.id);
  });
  closeFileDb(paths.agentDb(a.id));
  fs.rmSync(paths.agentDir(a.id), { recursive: true, force: true });
  emit('agents', { id: a.id, deleted: true });
  return { deleted: a.id };
}
