import fs from 'node:fs';
import path from 'node:path';
import { q, insert } from './db.js';
import { paths } from './config.js';
import { uid, now, json, safeJoin, sha256, token } from './util.js';
import * as agents from './agents.js';
import * as providers from './providers/index.js';
import * as skills from './skills.js';
import * as auto from './automations.js';
import * as catalog from './catalog.js';
import * as mcp from './mcp.js';
import * as mem from './memory.js';
import * as sql from './sqlite-tools.js';
import * as tpl from './templates.js';
import * as notif from './notifications.js';
import { setSecret, deleteSecret, listSecretNames } from './secrets.js';
import { sendMessage, startRun, waitForRun, cancelRun, answerPause, listPauses, createSession } from './runtime/runner.js';
import { buildFromDescription } from './builder.js';

// One registry of operations. `api: true` ones are exposed on the account MCP endpoint
// (same names and shapes as the Rerun API); the UI can call all of them locally.

const tools = new Map();

/** spec: { field: 'type' | 'type!' (required) | ['type!', 'description'] } */
function schema(spec = {}) {
  const properties = {}, required = [];
  for (const [k, v] of Object.entries(spec)) {
    const [t, desc] = Array.isArray(v) ? v : [v];
    const req = t.endsWith('!');
    const type = t.replace('!', '');
    properties[k] = type === 'any' ? {} : type.endsWith('[]') ? { type: 'array', items: type === 'any[]' ? {} : { type: type.slice(0, -2) } } : { type };
    if (desc) properties[k].description = desc;
    if (req) required.push(k);
  }
  return { type: 'object', properties, required };
}

function def(name, { api = false, confirm = false, description, input, run }) {
  tools.set(name, { name, api, confirm, description, inputSchema: schema(input), run });
}

export function listTools({ apiOnly = false } = {}) {
  return [...tools.values()].filter((t) => !apiOnly || t.api).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(name, args = {}, { apiOnly = false } = {}) {
  const t = tools.get(name);
  if (!t || (apiOnly && !t.api)) throw new Error(`Unknown tool ${name}.`);
  for (const k of t.inputSchema.required) if (args[k] === undefined || args[k] === null) throw new Error(`Missing required argument "${k}".`);
  if (t.confirm && args.confirm !== true) throw new Error(`${name} is destructive. Call it again with "confirm": true once the account owner has agreed.`);
  return t.run(args);
}

const agentIdOf = (args) => agents.agentConfig(args.agentId).id;

const runView = (r, withOutput = true) => r && ({
  runId: r.id, agentId: r.agent_id, status: r.status, sessionId: r.session_id, provider: r.provider, model: r.model, trigger: r.trigger,
  steps: r.steps, inputTokens: r.input_tokens, outputTokens: r.output_tokens, totalTokens: (r.input_tokens || 0) + (r.output_tokens || 0),
  costUsd: r.status === 'running' ? null : r.cost_usd, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error,
  ...(withOutput ? { output: r.output } : {}),
});

/* ================= Coworkers ================= */

def('list_spaces', { api: true, description: 'Lists the Boxes of the workspace with how many coworkers each one holds.', run: () => ({ spaces: agents.listSpaces() }) });
def('list_agents', { api: true, description: 'Lists the coworkers of the workspace, newest first.', input: { spaceId: 'string' }, run: (a) => ({ agents: agents.listAgents(a) }) });
def('get_agent', { api: true, description: 'The full picture of one coworker. Read this before changing anything.', input: { agentId: 'string!' }, run: (a) => agents.getAgent(a.agentId) });
def('create_agent', {
  api: true, description: 'Creates a coworker and places it on the board.',
  input: { name: 'string!', soul: 'string', description: 'string', spaceId: 'string', connectors: 'string[]', connectionId: 'string', provider: 'string', model: 'string', verbosity: 'string', tools: 'object', selfImprovement: 'object', approvals: 'object', setup: 'object', handle: 'string' },
  run: (a) => {
    const ag = agents.createAgent(a);
    const connectors = (a.connectors || []).map((s) => catalog.attachConnector(ag.id, s)).map(({ slug, name, status }) => ({ slug, name, status }));
    return { agentId: ag.id, name: ag.name, handle: ag.handle, spaceId: ag.spaceId, active: true, connectors };
  },
});
def('update_agent', {
  api: true, description: 'Updates a coworker. Only what you pass changes.',
  input: { agentId: 'string!', name: 'string', handle: 'string', spaceId: 'string', soul: 'string', description: 'string', connectionId: 'string', provider: 'string', model: 'any', verbosity: 'string', tools: 'object', selfImprovement: 'object', approvals: 'object', setup: 'any', enabled: 'boolean', avatar: 'string' },
  run: (a) => { const r = agents.updateAgent(a.agentId, a); if (a.enabled !== undefined || a.spaceId !== undefined) auto.rearmAgent(r.agentId); return r; },
});
def('delete_agent', { api: true, confirm: true, description: 'Permanently deletes a coworker with its skills, scheduled tasks, memory and files.', input: { agentId: 'string!', confirm: 'boolean!' }, run: (a) => { const id = agentIdOf(a); for (const s of auto.listSchedules(id)) auto.deleteSchedule(id, s.slug); return agents.deleteAgent(id); } });
def('list_ai_connections', {
  api: true, description: 'Lists the AI connections every coworker runs on.',
  run: () => ({ connections: providers.listConnections(), default: (() => { const r = providers.resolveRunsOn(); return r.connection ? { connectionId: r.connectionId, model: r.model } : null; })() }),
});
def('set_default_model', { api: true, description: 'Sets the workspace default connection and model.', input: { connectionId: 'string!', model: 'string!' }, run: (a) => providers.setDefaultModel(a.connectionId, a.model) });

/* ================= Skills ================= */

def('list_skills', { api: true, description: 'Lists the skills of a coworker.', input: { agentId: 'string!' }, run: (a) => ({ skills: skills.listSkills(agentIdOf(a)) }) });
def('get_skill', { api: true, description: 'Reads one skill in full (body and reference file list).', input: { agentId: 'string!', slug: 'string!' }, run: (a) => skills.getSkill(agentIdOf(a), a.slug) });
def('read_skill_file', { api: true, description: 'Reads one 100,000-character page of a skill reference file.', input: { agentId: 'string!', slug: 'string!', path: 'string!', offset: 'integer' }, run: (a) => skills.readSkillFile(agentIdOf(a), a.slug, a.path, a.offset) });
def('upsert_skill', { api: true, description: 'Creates a skill, or replaces the one with the same name, atomically.', input: { agentId: 'string!', name: 'string!', body: 'string!', description: 'string', slug: 'string', files: 'object[]', removeFiles: 'string[]' }, run: (a) => skills.upsertSkill(agentIdOf(a), a) });
def('delete_skill', { api: true, confirm: true, description: 'Deletes a skill and its reference files.', input: { agentId: 'string!', slug: 'string!', confirm: 'boolean!' }, run: (a) => skills.deleteSkill(agentIdOf(a), a.slug) });

/* ================= Scheduled tasks ================= */

def('list_schedules', { api: true, description: 'Lists a coworker scheduled tasks in full.', input: { agentId: 'string!' }, run: (a) => ({ schedules: auto.listSchedules(a.agentId) }) });
def('upsert_schedule', { api: true, description: 'Creates a scheduled task, or updates it when slug is given.', input: { agentId: 'string!', slug: 'string', name: 'string', body: 'string', cron: 'string', runAt: 'string', timezone: 'string', description: 'string', enabled: 'boolean', connectionId: 'string', model: 'any' }, run: (a) => auto.upsertSchedule(a.agentId, a) });
def('run_schedule_now', { api: true, description: 'Fires a scheduled task immediately. Works on a disabled task and leaves its schedule alone.', input: { agentId: 'string!', slug: 'string!' }, run: (a) => auto.runScheduleNow(a.agentId, a.slug) });
def('delete_schedule', { api: true, confirm: true, description: 'Deletes a scheduled task.', input: { agentId: 'string!', slug: 'string!', confirm: 'boolean!' }, run: (a) => auto.deleteSchedule(a.agentId, a.slug) });

/* ================= Triggers ================= */

def('list_triggers', { api: true, description: 'Lists a coworker triggers with their URLs. Every URL is a credential.', input: { agentId: 'string!' }, run: (a) => ({ triggers: auto.listTriggers(a.agentId) }) });
def('upsert_trigger', { api: true, description: 'Creates a trigger, or updates it when slug is given.', input: { agentId: 'string!', slug: 'string', name: 'string', body: 'string', methods: 'string[]', description: 'string', enabled: 'boolean', connectionId: 'string', model: 'any' }, run: (a) => auto.upsertTrigger(a.agentId, a) });
def('test_trigger', { api: true, description: 'Fires a trigger with a sample payload. A real fire, not a dry run.', input: { agentId: 'string!', slug: 'string!', body: 'any', method: 'string', query: 'string', contentType: 'string' }, run: (a) => auto.testTrigger(a.agentId, a.slug, a) });
def('rotate_trigger_token', { api: true, description: 'Issues a new secret for a trigger; the previous URL stops working at once.', input: { agentId: 'string!', slug: 'string!' }, run: (a) => auto.rotateTriggerToken(a.agentId, a.slug) });
def('delete_trigger', { api: true, confirm: true, description: 'Deletes a trigger. Its URL stops working at once.', input: { agentId: 'string!', slug: 'string!', confirm: 'boolean!' }, run: (a) => auto.deleteTrigger(a.agentId, a.slug) });

/* ================= Messages and runs ================= */

def('send_message', {
  api: true, description: 'Talks to a coworker and waits for its answer (default 120 s, max 600 s). Returns status "running" with a runId if it is still working.',
  input: { agentId: 'string!', message: 'string!', sessionId: 'string', waitSeconds: 'number' },
  run: async (a) => {
    const h = await sendMessage({ agentId: a.agentId, message: a.message, sessionId: a.sessionId, trigger: a._trigger || 'api' });
    if (!h.done) return h;
    const finished = await waitForRun(h, a.waitSeconds ?? 120);
    const r = runView(q.get('SELECT * FROM runs WHERE id = ?', h.runId));
    return finished ? r : { ...r, status: 'running', note: 'Still working. Poll get_run with this runId.' };
  },
});
def('list_runs', {
  api: true, description: 'Recent executions of a coworker, newest first.', input: { agentId: 'string!', limit: 'number' },
  run: (a) => ({ runs: q.all('SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?', agentIdOf(a), Math.min(a.limit || 20, 200)).map((r) => runView(r, false)) }),
});
def('get_run', {
  api: true, description: 'One execution in full, optionally with every tool call.', input: { agentId: 'string!', runId: 'string!', includeToolCalls: 'boolean' },
  run: (a) => {
    const r = q.get('SELECT * FROM runs WHERE id = ? AND agent_id = ?', a.runId, agentIdOf(a));
    if (!r) throw new Error('Run not found');
    const out = runView(r);
    if (a.includeToolCalls) out.toolCalls = q.all('SELECT step, tool, input, result, is_error, duration_ms FROM tool_calls WHERE run_id = ? ORDER BY id', r.id).map((t) => ({ step: t.step, tool: t.tool, input: t.input, result: t.result, isError: !!t.is_error, durationMs: t.duration_ms }));
    return out;
  },
});

/* ================= Databases ================= */

def('list_tables', { api: true, description: 'Structure of the coworker private database.', input: { agentId: 'string!' }, run: (a) => ({ tables: sql.listTables(paths.agentDb(agentIdOf(a))) }) });
def('db_query', { api: true, description: 'Read-only SELECT on the coworker private database.', input: { agentId: 'string!', sql: 'string!', params: 'any[]', limit: 'number' }, run: (a) => sql.dbQuery(paths.agentDb(agentIdOf(a)), a.sql, a.params, a.limit) });
def('db_execute', { api: true, description: 'Writes to the coworker private database (sql, or statements atomically).', input: { agentId: 'string!', sql: 'string', params: 'any[]', statements: 'object[]' }, run: (a) => sql.dbExecute(paths.agentDb(agentIdOf(a)), a, 'api') });
const anySpace = (a) => { if (!agents.listSpaces().some((s) => s.id === a.spaceId)) throw new Error('Unknown spaceId.'); };
def('list_space_tables', { api: true, description: 'Structure of the shared database.', input: { spaceId: 'string!' }, run: (a) => { anySpace(a); return { tables: sql.listTables(paths.sharedDb) }; } });
def('space_db_query', { api: true, description: 'Read-only SELECT on the shared database.', input: { spaceId: 'string!', sql: 'string!', params: 'any[]', limit: 'number' }, run: (a) => { anySpace(a); return sql.dbQuery(paths.sharedDb, a.sql, a.params, a.limit); } });
def('space_db_execute', { api: true, description: 'Writes to the shared database. Every coworker sees it immediately.', input: { spaceId: 'string!', sql: 'string', params: 'any[]', statements: 'object[]' }, run: (a) => { anySpace(a); return sql.dbExecute(paths.sharedDb, a, 'api'); } });
def('drop_rows', {
  description: 'UI: delete selected rows by rowid, or drop a table.', input: { agentId: 'string', table: 'string!', rowids: 'number[]', dropTable: 'boolean' },
  run: (a) => {
    const file = a.agentId ? paths.agentDb(agentIdOf(a)) : paths.sharedDb;
    const t = `"${a.table.replace(/"/g, '""')}"`;
    if (a.dropTable) return sql.dbExecute(file, { sql: `DROP TABLE ${t}` });
    return sql.dbExecute(file, { statements: (a.rowids || []).map((id) => ({ sql: `DELETE FROM ${t} WHERE rowid = ?`, params: [id] })) });
  },
});

/* ================= Apps ================= */

def('search_connectors', { api: true, description: 'Searches the app library.', input: { query: 'string' }, run: (a) => ({ connectors: catalog.searchConnectors(a.query) }) });
def('list_connectors', { api: true, description: 'Lists every app in the library.', run: () => ({ connectors: catalog.searchConnectors('') }) });
def('list_agent_connectors', { api: true, description: 'Apps installed on a coworker with their status.', input: { agentId: 'string!' }, run: (a) => ({ connectors: catalog.listAgentConnectors(agentIdOf(a)) }) });
def('attach_connector', { api: true, description: 'Declares an app on a coworker. Credentials are filled in the app, never through the API.', input: { agentId: 'string!', slug: 'string!' }, run: (a) => catalog.attachConnector(agentIdOf(a), a.slug) });
def('detach_connector', { api: true, confirm: true, description: 'Removes an app and its skill from a coworker.', input: { agentId: 'string!', slug: 'string!', confirm: 'boolean!' }, run: (a) => catalog.detachConnector(agentIdOf(a), a.slug) });

/* ================= Share links ================= */

def('create_agent_share', { api: true, description: 'Creates a link that hands one coworker (prompt, skills, schedules, app declarations) to someone else.', input: { agentId: 'string!' }, run: (a) => tpl.createShare(agentIdOf(a)) });
def('list_agent_shares', { api: true, description: 'Lists share links.', input: { agentId: 'string' }, run: (a) => ({ shares: tpl.listShares(a.agentId && agentIdOf(a)) }) });
def('revoke_agent_share', { api: true, confirm: true, description: 'Revokes a share link.', input: { token: 'string!', confirm: 'boolean!' }, run: (a) => tpl.revokeShare(a.token) });

/* ================= UI-only operations ================= */

def('create_space', { description: 'Create a Box.', input: { name: 'string!', color: 'string' }, run: (a) => agents.createSpace(a) });
def('update_space', { description: 'Rename a Box.', input: { spaceId: 'string!', name: 'string', color: 'string' }, run: (a) => agents.updateSpace(a.spaceId, a) });
def('delete_space', { description: 'Delete an empty Box.', input: { spaceId: 'string!' }, run: (a) => { agents.deleteSpace(a.spaceId); return { deleted: a.spaceId }; } });
def('build_agent', { description: 'Create a coworker from a plain description of its job.', input: { description: 'string!', spaceId: 'string', timezone: 'string' }, run: (a) => buildFromDescription(a) });

def('providers_catalog', { description: 'Known providers and Claude models.', run: () => ({ providers: providers.PROVIDERS, anthropicModels: providers.ANTHROPIC_MODELS }) });
def('create_connection', { description: 'Add an AI connection.', input: { name: 'string', provider: 'string!', baseUrl: 'string', apiKey: 'string', models: 'string[]' }, run: (a) => providers.createConnection(a) });
def('update_connection', { description: 'Edit an AI connection.', input: { connectionId: 'string!', name: 'string', baseUrl: 'string', apiKey: 'string', models: 'string[]' }, run: (a) => providers.updateConnection(a.connectionId, a) });
def('delete_connection', { description: 'Remove an AI connection.', input: { connectionId: 'string!' }, run: (a) => { providers.deleteConnection(a.connectionId); return { deleted: a.connectionId }; } });
def('test_connection', { description: 'Ping a connection.', input: { connectionId: 'string!' }, run: (a) => providers.testConnection(a.connectionId) });

def('list_sessions', {
  description: 'Conversation threads of a coworker.', input: { agentId: 'string!' },
  run: (a) => ({ sessions: q.all('SELECT id, title, kind, created_at, updated_at, state IS NOT NULL AS waiting FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 100', agentIdOf(a)) }),
});
def('get_session', {
  description: 'One conversation with its messages.', input: { sessionId: 'string!' },
  run: (a) => {
    const s = q.get('SELECT * FROM sessions WHERE id = ?', a.sessionId);
    if (!s) throw new Error('Session not found');
    const runs = q.all('SELECT * FROM runs WHERE session_id = ? ORDER BY started_at', s.id).map((r) => runView(r, false));
    return { id: s.id, agentId: s.agent_id, title: s.title, kind: s.kind, messages: stripImages(json(s.messages, [])), pending: json(s.state, null)?.pending || null, runs };
  },
});
def('new_session', { description: 'Start an empty chat thread.', input: { agentId: 'string!' }, run: (a) => ({ sessionId: createSession(agentIdOf(a), { kind: 'chat', title: 'New conversation' }) }) });
def('delete_session', { description: 'Delete a conversation.', input: { sessionId: 'string!' }, run: (a) => { q.run('DELETE FROM sessions WHERE id = ?', a.sessionId); return { deleted: a.sessionId }; } });
def('chat', {
  description: 'Send a chat message (returns at once; follow progress over the event stream).', input: { agentId: 'string!', message: 'string!', sessionId: 'string' },
  run: async (a) => { const h = await sendMessage({ agentId: a.agentId, message: a.message, sessionId: a.sessionId, trigger: 'chat' }); return { runId: h.runId, sessionId: h.sessionId }; },
});
def('cancel_run', { description: 'Cancel a running or waiting run.', input: { runId: 'string!' }, run: (a) => cancelRun(a.runId) });
def('list_pauses', { description: 'Cards waiting for you.', input: { agentId: 'string' }, run: (a) => ({ pauses: listPauses({ agentId: a.agentId && agentIdOf(a) }) }) });
def('answer_pause', { description: 'Answer a card and resume the coworker.', input: { pauseId: 'string!', answers: 'object!' }, run: async (a) => { const h = await answerPause(a.pauseId, a.answers); return { runId: h.runId, sessionId: h.sessionId }; } });
def('list_notifications', { description: 'Workspace notifications.', input: { agentId: 'string', unreadOnly: 'boolean' }, run: (a) => ({ notifications: notif.listNotifications(a) }) });
def('mark_notifications_read', { description: 'Mark notifications read.', input: { ids: 'any' }, run: (a) => { notif.markRead(a.ids || 'all'); return { ok: true }; } });

def('list_memories', { description: 'Memories of a coworker.', input: { agentId: 'string!' }, run: (a) => ({ memories: mem.listMemories(agentIdOf(a)) }) });
def('add_memory', { description: 'Add a memory.', input: { agentId: 'string!', content: 'string!' }, run: (a) => mem.addMemory(agentIdOf(a), a.content, ['user']) });
def('update_memory', { description: 'Edit a memory.', input: { agentId: 'string!', id: 'string!', content: 'string!' }, run: (a) => mem.updateMemory(agentIdOf(a), a.id, a.content) });
def('delete_memory', { description: 'Delete a memory.', input: { agentId: 'string!', id: 'string!' }, run: (a) => mem.deleteMemory(agentIdOf(a), a.id) });

def('list_mcp_servers', { description: 'Custom MCP servers and apps of a coworker.', input: { agentId: 'string!' }, run: (a) => ({ servers: mcp.listServers(agentIdOf(a)) }) });
def('upsert_mcp_server', { description: 'Register an MCP server on a coworker.', input: { agentId: 'string!', slug: 'string', name: 'string!', transport: 'string!', command: 'string', args: 'string[]', url: 'string', headers: 'object', env: 'object', enabled: 'boolean' }, run: (a) => mcp.upsertServer(agentIdOf(a), a) });
def('delete_mcp_server', { description: 'Remove an MCP server.', input: { agentId: 'string!', slug: 'string!' }, run: (a) => mcp.deleteServer(agentIdOf(a), a.slug) });
def('probe_mcp_server', { description: 'Connect to an MCP server and list its tools.', input: { agentId: 'string!', slug: 'string!' }, run: (a) => mcp.probeServer(agentIdOf(a), a.slug) });
def('list_permissions', { description: 'Tools a coworker may run without asking.', input: { agentId: 'string!' }, run: (a) => ({ permissions: q.all('SELECT tool, decision FROM permissions WHERE agent_id = ?', agentIdOf(a)) }) });
def('revoke_permission', { description: 'Make a tool ask again.', input: { agentId: 'string!', tool: 'string!' }, run: (a) => { q.run('DELETE FROM permissions WHERE agent_id = ? AND tool = ?', agentIdOf(a), a.tool); return { ok: true }; } });

def('list_secrets', { description: 'Names (never values) of the secrets of a coworker or the workspace.', input: { agentId: 'string' }, run: (a) => ({ secrets: listSecretNames(a.agentId ? agentIdOf(a) : 'workspace').filter((s) => !s.name.startsWith('AI_KEY_')) }) });
def('set_secret', { description: 'Store a secret on this machine.', input: { agentId: 'string', name: 'string!', value: 'string!' }, run: (a) => { setSecret(a.agentId ? agentIdOf(a) : 'workspace', a.name, a.value); return { saved: a.name }; } });
def('delete_secret', { description: 'Delete a secret.', input: { agentId: 'string', name: 'string!' }, run: (a) => { deleteSecret(a.agentId ? agentIdOf(a) : 'workspace', a.name); return { deleted: a.name }; } });

const filesRoot = (a) => (a.agentId ? paths.agentWorkspace(agentIdOf(a)) : paths.sharedDir);
def('list_files', {
  description: 'Files of a coworker workspace (agentId) or of the shared folder.', input: { agentId: 'string', path: 'string' },
  run: (a) => {
    const dir = safeJoin(filesRoot(a), a.path || '.');
    if (!fs.existsSync(dir)) return { files: [] };
    const published = new Map(a.agentId ? q.all('SELECT slug, path FROM published WHERE agent_id = ?', agentIdOf(a)).map((p) => [p.path, p.slug]) : []);
    return {
      files: fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
        const rel = path.relative(filesRoot(a), path.join(dir, e.name)).split(path.sep).join('/');
        const st = fs.statSync(path.join(dir, e.name));
        return { name: e.name, path: rel, dir: e.isDirectory(), size: st.size, modified: st.mtime.toISOString(), published: published.get(rel) || null };
      }).sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name)),
    };
  },
});
def('read_file', {
  description: 'Read a text file (first 500 KB).', input: { agentId: 'string', path: 'string!' },
  run: (a) => { const f = safeJoin(filesRoot(a), a.path); const buf = fs.readFileSync(f); return { path: a.path, size: buf.length, content: buf.subarray(0, 500_000).toString('utf8') }; },
});
def('write_file', {
  description: 'Write a file (text, or base64 with encoding "base64").', input: { agentId: 'string', path: 'string!', content: 'string!', encoding: 'string' },
  run: (a) => { const f = safeJoin(filesRoot(a), a.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, a.encoding === 'base64' ? Buffer.from(a.content, 'base64') : a.content); return { written: a.path }; },
});
def('delete_file', { description: 'Delete a file or folder.', input: { agentId: 'string', path: 'string!' }, run: (a) => { const root = filesRoot(a); const f = safeJoin(root, a.path); if (f === root) throw new Error('Refusing to delete the root.'); fs.rmSync(f, { recursive: true, force: true }); return { deleted: a.path }; } });
def('shared_tables', { description: 'Structure of the shared database (UI).', run: () => ({ tables: sql.listTables(paths.sharedDb) }) });
def('browse_table', {
  description: 'Rows of a table with paging, sorting and search.', input: { agentId: 'string', table: 'string!', offset: 'number', limit: 'number', sort: 'string', desc: 'boolean', search: 'string' },
  run: (a) => {
    const file = a.agentId ? paths.agentDb(agentIdOf(a)) : paths.sharedDb;
    const table = sql.listTables(file).find((t) => t.name === a.table);
    if (!table) throw new Error('Table not found');
    const qi = (s) => `"${s.replace(/"/g, '""')}"`;
    const cols = table.columns.map((c) => c.name);
    const where = a.search ? `WHERE ${cols.map((c) => `CAST(${qi(c)} AS TEXT) LIKE ?`).join(' OR ')}` : '';
    const params = a.search ? cols.map(() => `%${a.search}%`) : [];
    const order = a.sort && cols.includes(a.sort) ? `ORDER BY ${qi(a.sort)} ${a.desc ? 'DESC' : 'ASC'}` : 'ORDER BY rowid DESC';
    const limit = Math.min(a.limit || 50, 1000), offset = a.offset || 0;
    const rows = sql.dbQuery(file, `SELECT rowid AS _rowid, * FROM ${qi(a.table)} ${where} ${order} LIMIT ${limit} OFFSET ${offset}`, params, limit).rows;
    const total = sql.dbQuery(file, `SELECT COUNT(*) AS n FROM ${qi(a.table)} ${where}`, params).rows[0].n;
    return { table, rows, total };
  },
});

def('list_templates', { description: 'Templates available to install.', run: () => ({ templates: tpl.listTemplates() }) });
def('install_template', { description: 'Install a template into a Box.', input: { slug: 'string', template: 'object', spaceId: 'string' }, run: (a) => tpl.installTemplate(a.template || a.slug, a) });
def('export_template', { description: 'Capture coworkers as a template (no memories, no secrets).', input: { agentIds: 'string[]!', name: 'string', description: 'string', category: 'string', save: 'boolean' }, run: (a) => { const t = tpl.exportTemplate(a.agentIds, a); if (a.save) tpl.saveTemplate(t); return t; } });

def('list_api_keys', { description: 'API keys for the account MCP endpoint.', run: () => ({ keys: q.all('SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC') }) });
def('create_api_key', {
  description: 'Create an API key. The full key is shown once.', input: { name: 'string!' },
  run: (a) => { const key = `ck_${token(24)}`; insert('api_keys', { id: uid('key_'), name: a.name, prefix: key.slice(0, 7), hash: sha256(key), created_at: now() }); return { key }; },
});
def('revoke_api_key', { description: 'Revoke an API key.', input: { id: 'string!' }, run: (a) => { q.run('DELETE FROM api_keys WHERE id = ?', a.id); return { revoked: a.id }; } });

def('overview', {
  description: 'Board data in one call.',
  run: () => ({
    spaces: agents.listSpaces(), agents: agents.listAgents(), connections: providers.listConnections(),
    pendingPauses: q.get("SELECT COUNT(*) AS n FROM pauses WHERE status = 'pending'").n,
    unread: q.get('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').n,
    runningRuns: q.get("SELECT COUNT(*) AS n FROM runs WHERE status = 'running'").n,
    usage: q.get("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM runs WHERE started_at > ?", new Date(Date.now() - 30 * 86400_000).toISOString()),
  }),
});

function stripImages(messages) {
  return messages.map((m) => (Array.isArray(m.content) ? {
    ...m,
    content: m.content.map((b) => (b.type === 'tool_result' && Array.isArray(b.content)
      ? { ...b, content: b.content.map((c) => (c.type === 'image' ? { type: 'text', text: '[image]' } : c)) } : b)),
  } : m));
}

export { startRun };
