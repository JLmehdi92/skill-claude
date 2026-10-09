import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { paths, PUBLIC_URL } from './config.js';
import { safeJoin, sha256, now, token } from './util.js';
import { bus } from './bus.js';
import { callTool, listTools } from './service.js';
import { fireTrigger, isPassiveVisit, BODY_MAX } from './automations.js';
import { getShare } from './templates.js';
import { agentConfig } from './agents.js';
import { emit } from './bus.js';
import { finishSignIn } from './connectors/oauth.js';
import { findApp } from './catalog.js';
import { getServer } from './mcp.js';
import { secretVars } from './secrets.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
// The UI token proves a request comes from the page this server rendered (blocks CSRF and
// other local pages); it is regenerated on every start.
export const UI_TOKEN = process.env.CREWBOX_UI_TOKEN || token(18);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const mime = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...(isObj ? { 'content-type': 'application/json' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Past the limit, keep draining (so the caller gets a clean 413) but stop buffering.
    req.on('data', (c) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => (size > max ? reject(Object.assign(new Error('Payload too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

const uiAuthorized = (req, url) => (req.headers['x-crewbox-token'] || url.searchParams.get('t')) === UI_TOKEN;

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    try {
      if (p === '/' || p === '/index.html') {
        if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) return send(res, 503, 'The web UI is not built yet: run `npm run build` (npm start does it for you).', { 'content-type': 'text/plain' });
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replace('__CREWBOX_TOKEN__', UI_TOKEN);
        return send(res, 200, html, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      }
      if (p.startsWith('/assets/')) {
        const f = safeJoin(PUBLIC_DIR, p.slice(1));
        if (!fs.existsSync(f)) return send(res, 404, 'Not found');
        return send(res, 200, fs.readFileSync(f), { 'content-type': mime(f), 'cache-control': 'public, max-age=31536000, immutable' });
      }
      if (p.startsWith('/api/t/')) return handleTrigger(req, res, p);
      if (p === '/api/mcp/account') return handleMcp(req, res);
      if (p.startsWith('/p/')) return handlePublished(res, p.slice(3));
      if (p === '/oauth/callback') return handleOAuthCallback(res, url);
      if (p.startsWith('/icons/')) return handleIcon(res, p.slice(7));
      if (p.startsWith('/s/')) {
        const t = getShare(p.slice(3));
        return t ? send(res, 200, t) : send(res, 404, { error: 'Not found' });
      }

      // ---- local UI ----
      if (p.startsWith('/api/')) {
        if (!uiAuthorized(req, url)) return send(res, 401, { error: 'Unauthorized: reload the page.' });
        if (p === '/api/events') return handleEvents(req, res);
        if (p === '/api/download') {
          const agentId = url.searchParams.get('agentId');
          const root = agentId ? paths.agentWorkspace(agentConfig(agentId).id) : paths.sharedDir;
          const f = safeJoin(root, url.searchParams.get('path') || '');
          if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found');
          return send(res, 200, fs.readFileSync(f), { 'content-type': mime(f), 'content-disposition': `${url.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${path.basename(f).replace(/"/g, '')}"` });
        }
        const m = /^\/api\/ui\/([a-z_]+)$/.exec(p);
        if (m && req.method === 'POST') {
          const raw = await readBody(req, 60 * 1024 * 1024);
          const args = raw.length ? JSON.parse(raw.toString('utf8')) : {};
          try {
            return send(res, 200, await callTool(m[1], args));
          } catch (e) {
            return send(res, 400, { error: e.message });
          }
        }
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    }
  });
}

/* ---------- SSE ---------- */

function handleEvents(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const on = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  bus.on('event', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { bus.off('event', on); clearInterval(ping); });
}

/* ---------- published files ---------- */

function handlePublished(res, slug) {
  const row = q.get('SELECT * FROM published WHERE slug = ?', slug);
  if (!row) return send(res, 404, 'Not found');
  const f = safeJoin(paths.agentWorkspace(row.agent_id), row.path);
  if (!fs.existsSync(f)) return send(res, 404, 'Not found');
  // Served exactly as it is; a sandboxing CSP keeps a published page away from this origin.
  return send(res, 200, fs.readFileSync(f), { 'content-type': mime(f), 'content-security-policy': 'sandbox allow-scripts allow-popups allow-forms' });
}

/* ---------- webhook triggers: /api/t/{agentId}/{slug}/{token} ---------- */

async function handleTrigger(req, res, p) {
  const parts = p.split('/').slice(3);
  const notFound = () => send(res, 404, { error: 'Not found' });
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (parts.length !== 3 || parts.some((x) => !x)) return notFound();
  if (req.method === 'HEAD') return send(res, 200, '');
  if (isPassiveVisit(req.headers)) return send(res, 204, '');
  let raw;
  try { raw = await readBody(req); } catch (e) { return e.status === 413 ? send(res, 413, { error: 'Payload too large' }) : notFound(); }
  const [agentId, slug, tokenValue] = parts.map(decodeURIComponent);
  const url = new URL(req.url, 'http://local');
  let r;
  try {
    r = fireTrigger({ agentId, slug, tokenValue, method: req.method, contentType: req.headers['content-type'], raw: raw.toString('utf8'), query: url.search.slice(1) });
  } catch {
    return notFound();
  }
  if (!r) return notFound();
  if (r.notAllowed) return send(res, 405, { error: 'Method not allowed' }, { allow: r.allow });
  return send(res, 202, r);
}

/* ---------- account MCP endpoint (stateless JSON-RPC 2.0 over POST) ---------- */

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

async function handleMcp(req, res) {
  if (req.method !== 'POST') return send(res, 405, 'Only POST is handled.', { allow: 'POST', 'content-type': 'text/plain' });
  const auth = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const key = auth && q.get('SELECT id FROM api_keys WHERE hash = ?', sha256(auth[1]));
  if (!key) return send(res, 401, 'Unauthorized', { 'content-type': 'text/plain' });
  q.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), key.id);

  let msg;
  try { msg = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8')); } catch {
    return send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const batch = Array.isArray(msg);
  const out = [];
  for (const m of batch ? msg : [msg]) {
    if (m.id === undefined) continue; // notifications: accepted, no answer
    out.push(await rpc(m));
  }
  if (!out.length) return send(res, 202, '');
  return send(res, 200, batch ? out : out[0]);
}

async function rpc(m) {
  const reply = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize': {
      const v = m.params?.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(v) ? v : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'crewbox', version: '0.1.0' } });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: listTools({ apiOnly: true }) });
    case 'tools/call': {
      try {
        const r = await callTool(m.params?.name, m.params?.arguments || {}, { apiOnly: true });
        return reply({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true });
      }
    }
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } };
  }
}

export const mcpUrl = () => `${PUBLIC_URL}/api/mcp/account`;

/* ---- app sign-in (OAuth) callback ---- */
async function handleOAuthCallback(res, url) {
  const page = (ok, msg) => send(res, ok ? 200 : 400, `<!doctype html><meta charset="utf-8"><title>Crewbox</title><body style="font:16px system-ui;background:#0a0a0a;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><p style="font-size:40px;margin:0">${ok ? '✓' : '✕'}</p><p>${msg}</p><p style="color:#888">Tu peux fermer cette fenêtre.</p></div><script>try{window.opener&&window.opener.postMessage({type:'crewbox:oauth',ok:${ok}},'*')}catch(e){};setTimeout(()=>window.close(),${ok ? 1200 : 6000})</script>`, { 'content-type': 'text/html; charset=utf-8' });
  const err = url.searchParams.get('error');
  if (err) return page(false, `Connexion refusée : ${String(url.searchParams.get('error_description') || err).replace(/[<>&]/g, '')}`);
  try {
    const r = await finishSignIn(url.searchParams.get('state'), url.searchParams.get('code'), (agentId, slug) => {
      const s = getServer(agentId, slug);
      return { url: s?.url, name: s?.name || slug };
    }, (agentId) => secretVars(agentId));
    emit('agents', { id: r.agentId });
    emit('app_connected', { agentId: r.agentId, slug: r.slug });
    return page(true, `${String(r.name).replace(/[<>&]/g, '')} est connecté.`);
  } catch (e) {
    return page(false, String(e.message).replace(/[<>&]/g, ''));
  }
}

/* ---- app icons: the vendor favicon, cached on this machine, or a letter when offline ---- */
const ICON_DIR = path.join(paths.home, 'icons');
async function handleIcon(res, slug) {
  slug = slug.replace(/\.(png|svg)$/, '').replace(/[^a-z0-9-]/g, '');
  const app = findApp(slug);
  const letter = () => {
    const hue = [...slug].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
    const ch = (app?.name || slug || '?').trim()[0].toUpperCase().replace(/[<>&]/g, '');
    return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="hsl(${hue} 55% 42%)"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${ch}</text></svg>`, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' });
  };
  if (!app?.domain) return letter();
  const file = path.join(ICON_DIR, `${slug}.png`);
  if (fs.existsSync(file)) return send(res, 200, fs.readFileSync(file), { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
  if (process.env.CREWBOX_OFFLINE_ICONS) return letter();
  try {
    const r = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(app.domain)}&sz=64`, { signal: AbortSignal.timeout(6000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || buf.length < 200) return letter();
    fs.mkdirSync(ICON_DIR, { recursive: true });
    fs.writeFileSync(file, buf);
    return send(res, 200, buf, { 'content-type': r.headers.get('content-type') || 'image/png', 'cache-control': 'public, max-age=86400' });
  } catch { return letter(); }
}
