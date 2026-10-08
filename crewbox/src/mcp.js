import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { q, insert, update } from './db.js';
import { paths } from './config.js';
import { secretVars } from './secrets.js';
import { uid, now, json, slugify, interpolate, missingVars, sha256 } from './util.js';

// Apps are MCP servers attached to one coworker. ${VAR} in a config resolves from the
// coworker's secrets at connect time, on this machine; the stored config keeps only names.

const pool = new Map(); // serverId -> { key, client, tools, lastUsed }
const IDLE_MS = 10 * 60_000;

function serverView(r) {
  const cfg = { command: r.command, args: json(r.args, []), url: r.url, headers: json(r.headers, {}), env: json(r.env, {}) };
  const missing = missingVars(cfg, secretVars(r.agent_id));
  return {
    id: r.id, slug: r.slug, name: r.name, transport: r.transport, ...cfg, connector: r.connector,
    enabled: !!r.enabled, status: missing.length ? 'needs_config' : 'active', missingSecrets: missing,
  };
}

export const listServers = (agentId) => q.all('SELECT * FROM mcp_servers WHERE agent_id = ? ORDER BY created_at', agentId).map(serverView);
export const getServer = (agentId, slug) => {
  const r = q.get('SELECT * FROM mcp_servers WHERE agent_id = ? AND slug = ?', agentId, slug);
  return r ? serverView(r) : null;
};

export function upsertServer(agentId, { slug, name, transport, command, args, url, headers, env, connector = null, enabled = true }) {
  if (!['stdio', 'http', 'sse'].includes(transport)) throw new Error('transport is one of stdio, http, sse');
  if (transport === 'stdio' && !command) throw new Error('A stdio server needs a command.');
  if (transport !== 'stdio' && !url) throw new Error('An http/sse server needs a url.');
  const s = slugify(slug || name, '_');
  const existing = q.get('SELECT id FROM mcp_servers WHERE agent_id = ? AND slug = ?', agentId, s);
  const row = { name: name || s, transport, command: command || null, args: args || [], url: url || null, headers: headers || {}, env: env || {}, connector, enabled };
  if (existing) { update('mcp_servers', { id: existing.id }, row); closeServer(existing.id); }
  else insert('mcp_servers', { id: uid('mcp_'), agent_id: agentId, slug: s, ...row, created_at: now() });
  return getServer(agentId, s);
}

export function deleteServer(agentId, slug) {
  const r = q.get('SELECT id FROM mcp_servers WHERE agent_id = ? AND slug = ?', agentId, slug);
  if (!r) throw new Error(`MCP server not found: ${slug}`);
  closeServer(r.id);
  q.run('DELETE FROM mcp_servers WHERE id = ?', r.id);
  return { deleted: slug };
}

async function connect(row) {
  const vars = secretVars(row.agent_id);
  const cfg = interpolate({ command: row.command, args: json(row.args, []), url: row.url, headers: json(row.headers, {}), env: json(row.env, {}) }, vars);
  const key = sha256(JSON.stringify([row.transport, cfg]));
  const cached = pool.get(row.id);
  if (cached?.key === key) { cached.lastUsed = Date.now(); return cached; }
  if (cached) await closeServer(row.id);

  let transport;
  if (row.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: cfg.command, args: cfg.args, env: { ...getDefaultEnvironment(), ...cfg.env },
      cwd: paths.agentWorkspace(row.agent_id), stderr: 'ignore',
    });
  } else if (row.transport === 'sse') {
    transport = new SSEClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });
  } else {
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });
  }
  const client = new Client({ name: 'crewbox', version: '0.1.0' });
  await withTimeout(client.connect(transport), 30_000, `Connecting to ${row.name} timed out`);
  const { tools } = await withTimeout(client.listTools(), 30_000, `Listing tools of ${row.name} timed out`);
  const entry = { key, client, tools, lastUsed: Date.now() };
  pool.set(row.id, entry);
  return entry;
}

export async function closeServer(id) {
  const e = pool.get(id);
  pool.delete(id);
  if (e) await e.client.close().catch(() => {});
}

export async function closeAll() { await Promise.all([...pool.keys()].map(closeServer)); }

setInterval(() => {
  for (const [id, e] of pool) if (Date.now() - e.lastUsed > IDLE_MS) closeServer(id);
}, 60_000).unref();

const toolName = (slug, name) => `mcp__${slug}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
const READ_ONLY_NAME = /^(get|list|search|read|fetch|query|find|describe|lookup|retrieve|count|view|show)[_-]?/i;

/**
 * Tools of every active MCP server of a coworker, as model tool definitions.
 * Servers that fail to start are reported in `errors` instead of breaking the run.
 */
export async function agentMcpTools(agentId) {
  const rows = q.all('SELECT * FROM mcp_servers WHERE agent_id = ? AND enabled = 1', agentId);
  const tools = [], errors = [], routes = new Map();
  await Promise.all(rows.map(async (row) => {
    const v = serverView(row);
    if (v.status !== 'active') { errors.push(`${row.name}: needs config (missing ${v.missingSecrets.join(', ')})`); return; }
    try {
      const e = await connect(row);
      for (const t of e.tools) {
        const name = toolName(row.slug, t.name);
        routes.set(name, { serverId: row.id, row, tool: t.name, readOnly: !!t.annotations?.readOnlyHint || READ_ONLY_NAME.test(t.name) });
        tools.push({
          name,
          description: `[${row.name}] ${t.description || t.name}`.slice(0, 1024),
          input_schema: t.inputSchema?.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        });
      }
    } catch (err) {
      errors.push(`${row.name}: ${err.message}`);
    }
  }));
  return { tools, errors, routes };
}

export async function callMcpTool(route, input) {
  const e = await connect(route.row);
  const res = await withTimeout(e.client.callTool({ name: route.tool, arguments: input || {} }), 120_000, `${route.tool} timed out`);
  const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? JSON.stringify(c.resource) : `[${c.type}]`)).join('\n');
  return { text: text || JSON.stringify(res.structuredContent ?? {}), isError: !!res.isError };
}

export async function probeServer(agentId, slug) {
  const r = q.get('SELECT * FROM mcp_servers WHERE agent_id = ? AND slug = ?', agentId, slug);
  if (!r) throw new Error(`MCP server not found: ${slug}`);
  const e = await connect(r);
  return { slug, tools: e.tools.map((t) => ({ name: t.name, description: t.description })) };
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}
