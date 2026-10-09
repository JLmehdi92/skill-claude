import { truncate } from '../util.js';

// API connectors: a service's REST API described as operations, served to the coworker as tools
// exactly like an MCP server's. Credentials are ${VARIABLE} headers resolved on this machine.
//
// An operation: { name, description, method, path: '/emails/{id}', params: { id: {type,description} },
// required: ['id'], query: ['limit'], body: true|'array'|false, readOnly }. A connector that sets
// `generic` also gets one `request` tool for every endpoint the operations do not cover.

const MAX_OUT = 60_000;

/** Base URL, overridable per connector for tests and self-hosted instances: CREWBOX_API_BASE_<SLUG>. */
export function apiBase(slug, base) {
  return (process.env[`CREWBOX_API_BASE_${String(slug).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || base || '').replace(/\/$/, '');
}

export function apiTools(spec) {
  const tools = (spec.ops || []).map((op) => ({
    name: op.name,
    description: op.description,
    annotations: { readOnlyHint: op.readOnly ?? op.method === 'GET' },
    inputSchema: { type: 'object', properties: op.params || {}, required: op.required || [], additionalProperties: !!op.body },
  }));
  if (spec.generic) {
    tools.push({
      name: 'request',
      description: `Call any endpoint of the ${spec.name || 'service'} API (base ${spec.baseUrl}). Read the API docs (${spec.docs || 'the vendor docs'}) for paths and fields. Authentication is added for you.`,
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          path: { type: 'string', description: 'Path after the base URL, e.g. /v1/contacts' },
          query: { type: 'object', description: 'Query string parameters' },
          body: { description: 'JSON body for POST, PUT and PATCH' },
        },
        required: ['method', 'path'],
      },
    });
  }
  return tools;
}

/** Call one operation. `cfg` is the resolved config: { url (base), headers, spec }. */
export async function callApi(cfg, name, input = {}) {
  const spec = cfg.spec || {};
  let method, path, query = {}, body;
  if (name === 'request' && spec.generic) {
    method = String(input.method || 'GET').toUpperCase();
    path = String(input.path || '/');
    if (/^https?:/i.test(path)) throw new Error('Pass a path, not a full URL: the base URL is fixed for this app.');
    query = input.query || {};
    body = input.body;
  } else {
    const op = (spec.ops || []).find((o) => o.name === name);
    if (!op) throw new Error(`Unknown operation ${name}`);
    method = op.method;
    const args = { ...input };
    path = op.path.replace(/\{(\w+)\}/g, (m, k) => {
      if (args[k] === undefined || args[k] === '') throw new Error(`${k} is required`);
      const v = encodeURIComponent(String(args[k]));
      delete args[k];
      return v;
    });
    for (const k of op.query || []) if (args[k] !== undefined) { query[k] = args[k]; delete args[k]; }
    if (op.body === 'array') body = args.items;
    else if (op.body) body = op.bodyKey ? args[op.bodyKey] : args;
  }
  const url = new URL(cfg.url + (path.startsWith('/') ? path : `/${path}`));
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, v] of Object.entries(cfg.query || {})) url.searchParams.set(k, v);
  const headers = { accept: 'application/json', 'user-agent': 'Crewbox/1.0', ...cfg.headers };
  // Basic auth secrets are stored as "user:password"; encode them here.
  for (const [k, val] of Object.entries(headers)) {
    const m = /^Basic (.+)$/.exec(String(val));
    if (m && m[1].includes(':')) headers[k] = `Basic ${Buffer.from(m[1]).toString('base64')}`;
  }
  const init = { method, headers, signal: AbortSignal.timeout(60_000) };
  if (body !== undefined && method !== 'GET' && method !== 'DELETE') { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(url, init);
  const text = await res.text();
  let out = text;
  try { out = JSON.stringify(JSON.parse(text), null, 1); } catch { /* not JSON */ }
  const head = `${method} ${url.pathname} → ${res.status}`;
  return { text: truncate(`${head}\n${out}`, MAX_OUT), isError: !res.ok };
}
