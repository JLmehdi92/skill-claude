import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { q, insert } from '../db.js';
import { paths, PUBLIC_URL } from '../config.js';
import { safeJoin, truncate, uid, now, slugify, ToolError } from '../util.js';
import { secretVars, redact } from '../secrets.js';
import * as mem from '../memory.js';
import * as skills from '../skills.js';
import * as sql from '../sqlite-tools.js';
import { upsertSchedule, listSchedules, deleteSchedule, upsertTrigger, listTriggers, deleteTrigger } from '../automations.js';
import { searchConnectors, attachConnector, findApp } from '../catalog.js';
import { upsertServer } from '../mcp.js';
import { updateAgent } from '../agents.js';
import { notify } from '../notifications.js';

// Built-in tools, grouped by capability family. A handler may declare:
//   pause: 'question' | 'approval' | 'connector' | 'secret'  → stops the run and shows a card
//   gate(input, agent) → true when this call needs the user's approval before it runs

const PAGE = 100_000;
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

function folder(agent, scope) {
  if (scope === 'shared') {
    if (!agent.tools.shared) throw new ToolError('The shared folder is not enabled for this coworker.');
    return paths.sharedDir;
  }
  if (!agent.tools.filesystem) throw new ToolError('The filesystem capability is off for this coworker.');
  return paths.agentWorkspace(agent.id);
}

function dbFile(agent, scope) {
  if (scope === 'shared') {
    if (!agent.tools.sharedDb) throw new ToolError('The shared database is not enabled for this coworker.');
    return paths.sharedDb;
  }
  if (!agent.tools.db) throw new ToolError('The private database capability is off for this coworker.');
  return paths.agentDb(agent.id);
}

function listDir(root, rel = '.', depth = 2) {
  const base = safeJoin(root, rel);
  if (!fs.existsSync(base)) throw new ToolError(`No such folder: ${rel}`);
  const out = [];
  const walk = (dir, d) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= 500) return;
      const p = path.join(dir, e.name);
      const r = path.relative(root, p).split(path.sep).join('/');
      if (e.isDirectory()) { out.push(r + '/'); if (d > 1) walk(p, d - 1); }
      else out.push(`${r} (${fs.statSync(p).size} B)`);
    }
  };
  walk(base, depth);
  return out.join('\n') || '(empty)';
}

const SHELL_DENY = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(\/|~|\$HOME|\*)(\s|$)/i, /\bmkfs\b/, /\bdd\s+if=/, /\b(shutdown|reboot|halt|poweroff)\b/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, /\bchmod\s+-R\s+777\s+\//, />\s*\/dev\/sd[a-z]/, /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bsudo\b/, /\bgit\s+push\s+.*--force\b/,
];

function runShell(agent, command, timeoutSec = 120, signal) {
  if (SHELL_DENY.some((re) => re.test(command))) throw new ToolError('This command is on the denylist of destructive commands.');
  const cwd = paths.agentWorkspace(agent.id);
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'cmd' : 'bash', process.platform === 'win32' ? ['/c', command] : ['-lc', command], {
      cwd, env: { ...process.env, ...secretVars(agent.id), CREWBOX_SHARED: paths.sharedDir, HOME: process.env.HOME }, signal,
    });
    let out = '';
    const add = (d) => { if (out.length < 400_000) out += d; };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const t = setTimeout(() => child.kill('SIGKILL'), Math.min(timeoutSec, 900) * 1000);
    child.on('close', (code) => { clearTimeout(t); resolve({ exitCode: code, output: truncate(out, 50_000) }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ exitCode: -1, output: e.message }); });
  });
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

async function fetchWithTimeout(url, opts = {}, ms = 30_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Crewbox/0.1)', ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
}

async function webSearch(query) {
  const res = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && results.length < 10) {
    let url = m[1];
    const u = /uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    results.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3] || '') });
  }
  if (!results.length) return 'No results (the search page may have changed or rate-limited). Install the Brave Search or Firecrawl app for a reliable search API.';
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
}

/**
 * Build the tool definitions and handlers a coworker gets for one run.
 * @param {object} agent agentConfig()
 * @param {object} rt  runtime hooks injected by the runner: runSubtasks, callAgent, listCoworkers
 */
export function builtinTools(agent, rt) {
  const T = agent.tools;
  const SI = agent.selfImprovement;
  const defs = [];
  const handlers = new Map();
  const add = (family, def, handler) => {
    if (family && !T[family]) return;
    defs.push(def);
    handlers.set(def.name, { family, schema: def.input_schema, ...handler });
  };
  const scopes = [T.filesystem && 'own', T.shared && 'shared'].filter(Boolean);
  const scopeProp = { scope: str('"own" = your private workspace (default), "shared" = the folder every coworker shares', { enum: scopes.length ? scopes : ['own'] }) };

  /* ---- files ---- */
  if (scopes.length) {
    add(null, { name: 'files_list', description: 'List files in your workspace or the shared folder.', input_schema: obj({ ...scopeProp, path: str('Folder, relative. Default "."'), depth: { type: 'integer', description: 'Levels to descend (1-5). Default 2' } }) }, {
      run: ({ scope, path: p = '.', depth = 2 }) => listDir(folder(agent, scope), p, Math.min(Math.max(depth, 1), 5)),
    });
    add(null, { name: 'files_read', description: 'Read a text file, 100,000 characters at a time. Follow nextOffset for the next page.', input_schema: obj({ ...scopeProp, path: str('File path, relative'), offset: { type: 'integer' } }, ['path']) }, {
      run: ({ scope, path: p, offset = 0 }) => {
        const f = safeJoin(folder(agent, scope), p);
        if (!fs.existsSync(f)) throw new ToolError(`No such file: ${p}`);
        const text = fs.readFileSync(f, 'utf8');
        const next = offset + PAGE < text.length ? offset + PAGE : null;
        return JSON.stringify({ path: p, content: text.slice(offset, offset + PAGE), offset, nextOffset: next, totalChars: text.length });
      },
    });
    add(null, { name: 'files_write', description: 'Create or overwrite a text file. Deliverables (reports, pages, exports) go here; rows of data go in a database.', input_schema: obj({ ...scopeProp, path: str('File path, relative'), content: str('Full file content') }, ['path', 'content']) }, {
      run: ({ scope, path: p, content }) => {
        const f = safeJoin(folder(agent, scope), p);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
        return `Wrote ${p} (${Buffer.byteLength(content)} bytes).`;
      },
    });
    add(null, { name: 'files_edit', description: 'Replace an exact, unique string in a text file.', input_schema: obj({ ...scopeProp, path: str('File path'), old_string: str('Exact text to replace (must be unique)'), new_string: str('Replacement') }, ['path', 'old_string', 'new_string']) }, {
      run: ({ scope, path: p, old_string, new_string }) => {
        const f = safeJoin(folder(agent, scope), p);
        const text = fs.readFileSync(f, 'utf8');
        const n = text.split(old_string).length - 1;
        if (n !== 1) throw new ToolError(n ? `old_string appears ${n} times; make it unique.` : 'old_string not found.');
        fs.writeFileSync(f, text.replace(old_string, () => new_string));
        return `Edited ${p}.`;
      },
    });
    add(null, { name: 'files_search', description: 'Find files whose name or content contains a text (case-insensitive).', input_schema: obj({ ...scopeProp, text: str('Text to look for'), path: str('Folder to search, default "."') }, ['text']) }, {
      run: ({ scope, text, path: p = '.' }) => {
        const root = folder(agent, scope), hits = [], needle = text.toLowerCase();
        const walk = (dir) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (hits.length >= 100) return;
            const full = path.join(dir, e.name), rel = path.relative(root, full);
            if (e.isDirectory()) { walk(full); continue; }
            if (e.name.toLowerCase().includes(needle)) { hits.push(`${rel} (name)`); continue; }
            if (fs.statSync(full).size > 2_000_000) continue;
            const lines = fs.readFileSync(full, 'utf8').split('\n');
            lines.forEach((l, i) => { if (hits.length < 100 && l.toLowerCase().includes(needle)) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 200)}`); });
          }
        };
        walk(safeJoin(root, p));
        return hits.join('\n') || 'No match.';
      },
    });
    add(null, { name: 'files_delete', description: 'Delete a file or an empty folder.', input_schema: obj({ ...scopeProp, path: str('Path') }, ['path']) }, {
      run: ({ scope, path: p }) => {
        const f = safeJoin(folder(agent, scope), p);
        if (f === folder(agent, scope)) throw new ToolError('Refusing to delete the root folder.');
        fs.rmSync(f, { recursive: false, force: true });
        return `Deleted ${p}.`;
      },
    });
  }

  /* ---- shell ---- */
  add('shell', { name: 'shell_run', description: 'Run a bash command in your workspace folder. Your secrets are available as environment variables ($NAME); never print them. Destructive commands are refused.', input_schema: obj({ command: str('The command'), timeout_sec: { type: 'integer', description: 'Default 120, max 900' } }, ['command']) }, {
    gate: () => agent.approvals.shell,
    run: async ({ command, timeout_sec }, ctx) => {
      const r = await runShell(agent, command, timeout_sec || 120, ctx.signal);
      return `exit ${r.exitCode}\n${r.output}`;
    },
  });

  /* ---- web ---- */
  add('web', { name: 'web_fetch', description: 'Fetch a URL and return its readable text (HTML is converted). 100,000 characters per page; follow nextOffset.', input_schema: obj({ url: str('http(s) URL'), offset: { type: 'integer' }, raw: { type: 'boolean', description: 'Return the raw body instead of readable text' } }, ['url']) }, {
    run: async ({ url, offset = 0, raw }) => {
      if (!/^https?:\/\//i.test(url)) throw new ToolError('Only http(s) URLs.');
      const res = await fetchWithTimeout(url);
      const ct = res.headers.get('content-type') || '';
      let body = await res.text();
      if (!raw && /html/i.test(ct)) body = htmlToText(body);
      const next = offset + PAGE < body.length ? offset + PAGE : null;
      return JSON.stringify({ status: res.status, contentType: ct, content: body.slice(offset, offset + PAGE), offset, nextOffset: next, totalChars: body.length });
    },
  });
  add('web', { name: 'web_search', description: 'Search the web. Returns titles, URLs and snippets; then web_fetch the promising ones.', input_schema: obj({ query: str('Search query') }, ['query']) }, {
    run: ({ query }) => webSearch(query),
  });
  if (T.filesystem) add('web', { name: 'web_download', description: 'Download a URL into your workspace (binary-safe).', input_schema: obj({ url: str('URL'), path: str('Destination path in your workspace') }, ['url', 'path']) }, {
    run: async ({ url, path: p }) => {
      const res = await fetchWithTimeout(url, {}, 120_000);
      if (!res.ok) throw new ToolError(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const f = safeJoin(paths.agentWorkspace(agent.id), p);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, buf);
      return `Saved ${p} (${buf.length} bytes).`;
    },
  });

  /* ---- memory ---- */
  add('memory', { name: 'memory_save', description: 'Write down a durable fact: a preference, a name, a correction, how the work should be done. Not the work itself (rows go in a database).', input_schema: obj({ content: str('One self-contained fact'), tags: { type: 'array', items: { type: 'string' } } }, ['content']) }, {
    run: ({ content, tags }) => JSON.stringify(mem.addMemory(agent.id, content, tags || [])),
  });
  add('memory', { name: 'memory_recall', description: 'Search your memories. Every recall keeps a memory alive longer.', input_schema: obj({ query: str('What you are looking for') }, ['query']) }, {
    run: ({ query }) => JSON.stringify({ memories: mem.recall(agent.id, query).map(({ id, content }) => ({ id, content })) }),
  });
  add('memory', { name: 'memory_update', description: 'Correct a memory by id.', input_schema: obj({ id: str('Memory id'), content: str('New content') }, ['id', 'content']) }, {
    run: ({ id, content }) => JSON.stringify(mem.updateMemory(agent.id, id, content)),
  });
  add('memory', { name: 'memory_delete', description: 'Forget a memory by id.', input_schema: obj({ id: str('Memory id') }, ['id']) }, {
    run: ({ id }) => JSON.stringify(mem.deleteMemory(agent.id, id)),
  });

  /* ---- databases ---- */
  const dbScopes = [T.db && 'own', T.sharedDb && 'shared'].filter(Boolean);
  if (dbScopes.length) {
    const dbScope = { scope: str('"own" = your private SQLite database (default), "shared" = the database every coworker shares', { enum: dbScopes }) };
    add(null, { name: 'db_tables', description: 'List the tables with their columns, row counts and who created them.', input_schema: obj(dbScope) }, {
      run: ({ scope }) => JSON.stringify(sql.listTables(dbFile(agent, scope))),
    });
    add(null, { name: 'db_query', description: 'Run one read-only SELECT (or WITH … SELECT). Use ? placeholders with params.', input_schema: obj({ ...dbScope, sql: str('SELECT statement'), params: { type: 'array', items: {} }, limit: { type: 'integer', description: 'Default 100, max 1000' } }, ['sql']) }, {
      run: ({ scope, sql: s, params, limit }) => JSON.stringify(sql.dbQuery(dbFile(agent, scope), s, params, limit)),
    });
    add(null, { name: 'db_execute', description: 'CREATE/ALTER/DROP tables or INSERT/UPDATE/DELETE rows. Pass sql, or statements for an atomic batch. In the shared database: CREATE TABLE IF NOT EXISTS, never drop or alter a table you did not create, name tables after the domain.', input_schema: obj({ ...dbScope, sql: str('One statement'), params: { type: 'array', items: {} }, statements: { type: 'array', items: { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array', items: {} } }, required: ['sql'] } } }) }, {
      run: (input) => {
        const file = dbFile(agent, input.scope);
        if (input.scope === 'shared') {
          for (const s of input.statements || [{ sql: input.sql }]) {
            const m = /^\s*(drop|alter)\s+table\s+(?:if\s+exists\s+)?["`[]?([\w-]+)/i.exec(s.sql || '');
            if (m) {
              const owner = sql.tableOwner(file, m[2]);
              if (owner && owner !== agent.id && !/add\s+column/i.test(s.sql)) throw new ToolError(`Table ${m[2]} belongs to another coworker; you may only ADD COLUMN to it.`);
            }
          }
        }
        return JSON.stringify(sql.dbExecute(file, input, agent.id));
      },
    });
  }

  /* ---- skills (reading is always on: the index is in your prompt) ---- */
  add(null, { name: 'skill_read', description: 'Open a skill: its full procedure and the list of its reference files. Do this when a task matches a skill description.', input_schema: obj({ slug: str('Skill slug') }, ['slug']) }, {
    run: ({ slug }) => JSON.stringify(skills.getSkill(agent.id, slug)),
  });
  add(null, { name: 'skill_read_file', description: 'Read a reference file of a skill, 100,000 characters at a time, only when the procedure tells you to.', input_schema: obj({ slug: str('Skill slug'), path: str('e.g. references/format.md'), offset: { type: 'integer' } }, ['slug', 'path']) }, {
    run: ({ slug, path: p, offset }) => JSON.stringify(skills.readSkillFile(agent.id, slug, p, offset)),
  });
  add('skills', { name: 'skill_write', description: 'Create or replace one of your skills: a procedure you load on demand. Write the description as a trigger condition ("Use when…"). Keep the body short; push detail into reference files.', input_schema: obj({ name: str('Skill name'), description: str('When to use it'), body: str('The procedure, in markdown'), slug: str('Existing slug, when renaming'), files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }, removeFiles: { type: 'array', items: { type: 'string' } } }, ['name', 'description', 'body']) }, {
    run: (input) => JSON.stringify(skills.upsertSkill(agent.id, input)),
  });
  add('skills', { name: 'skill_delete', description: 'Delete one of your own skills.', input_schema: obj({ slug: str('Skill slug') }, ['slug']) }, {
    run: ({ slug }) => JSON.stringify(skills.deleteSkill(agent.id, slug)),
  });

  /* ---- automations ---- */
  add('schedule', { name: 'schedule_list', description: 'List your scheduled tasks.', input_schema: obj({}) }, { run: () => JSON.stringify(listSchedules(agent.id)) });
  add('schedule', { name: 'schedule_upsert', description: 'Give yourself a recurring task (5-field cron + IANA timezone) or a one-off (runAt ISO date). Omit slug to create; pass it to update. The body is the whole instruction you will receive when it fires, in a fresh session: say where to pick up (memory, database).', input_schema: obj({ slug: str('Existing slug to update'), name: str('Name'), body: str('Instruction'), cron: str('e.g. "0 8 * * 1-5"'), runAt: str('ISO date for a one-off'), timezone: str('e.g. Europe/Paris'), enabled: { type: 'boolean' } }) }, {
    run: (input) => JSON.stringify(upsertSchedule(agent.id, input)),
  });
  add('schedule', { name: 'schedule_delete', description: 'Delete one of your scheduled tasks.', input_schema: obj({ slug: str('Slug') }, ['slug']) }, { run: ({ slug }) => JSON.stringify(deleteSchedule(agent.id, slug)) });
  add('trigger', { name: 'trigger_list', description: 'List your webhook triggers with their URLs. A URL is a credential: give it only to the user.', input_schema: obj({}) }, { run: () => JSON.stringify(listTriggers(agent.id)) });
  add('trigger', { name: 'trigger_upsert', description: 'Give yourself a public webhook URL. Write body as if the event had already happened; the caller payload is appended in a <trigger_payload> block.', input_schema: obj({ slug: str('Existing slug to update'), name: str('Name (also the URL slug)'), body: str('Instruction'), methods: { type: 'array', items: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] } }, enabled: { type: 'boolean' } }) }, {
    run: (input) => JSON.stringify(upsertTrigger(agent.id, input)),
  });
  add('trigger', { name: 'trigger_delete', description: 'Delete one of your triggers.', input_schema: obj({ slug: str('Slug') }, ['slug']) }, { run: ({ slug }) => JSON.stringify(deleteTrigger(agent.id, slug)) });

  /* ---- teamwork ---- */
  add('delegate', { name: 'delegate', description: 'Hand up to 4 independent subtasks to throwaway sub-coworkers that run in parallel and report back. Each gets your files, web and database tools but cannot ask the user anything. Give each a complete, self-contained instruction.', input_schema: obj({ tasks: { type: 'array', maxItems: 4, items: { type: 'object', properties: { instruction: { type: 'string' }, role: { type: 'string', description: 'Optional one-line role for the sub-coworker' } }, required: ['instruction'] } } }, ['tasks']) }, {
    run: async ({ tasks }, ctx) => {
      if (!tasks?.length) throw new ToolError('Pass at least one task.');
      if (tasks.length > 4) throw new ToolError('Up to four sub-coworkers at once.');
      if (ctx.depth >= 2) throw new ToolError('Sub-coworkers cannot delegate further.');
      const results = await rt.runSubtasks(tasks, ctx);
      return results.map((r, i) => `## Subtask ${i + 1}\n${r}`).join('\n\n');
    },
  });
  add('callAgent', { name: 'list_coworkers', description: 'List the other coworkers of the workspace with their @handle and what they do.', input_schema: obj({}) }, {
    run: () => JSON.stringify(rt.listCoworkers(agent.id)),
  });
  add('callAgent', { name: 'call_agent', description: 'Message another coworker by @handle and wait for its answer (up to 10 minutes). Use it to route work to the specialist who owns it.', input_schema: obj({ handle: str('Handle, without @'), message: str('Complete, self-contained request') }, ['handle', 'message']) }, {
    run: ({ handle, message }, ctx) => rt.callAgent(handle.replace(/^@/, ''), message, ctx),
  });

  /* ---- vision ---- */
  if (T.filesystem) add('vision', { name: 'view_image', description: 'Look at an image (png, jpg, gif, webp) from your workspace or the shared folder.', input_schema: obj({ ...scopeProp, path: str('Image path') }, ['path']) }, {
    run: ({ scope, path: p }) => {
      const f = safeJoin(folder(agent, scope), p);
      const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
      if (!['png', 'jpeg', 'gif', 'webp'].includes(ext)) throw new ToolError('Supported: png, jpg, gif, webp.');
      const data = fs.readFileSync(f);
      if (data.length > 5 * 1024 * 1024) throw new ToolError('Image over 5 MB.');
      return { blocks: [{ type: 'image', source: { type: 'base64', media_type: `image/${ext}`, data: data.toString('base64') } }, { type: 'text', text: `Image ${p}` }] };
    },
  });

  /* ---- out-of-band notifications ---- */
  add('notify', { name: 'notify', description: 'Tell the user something without stopping (progress, a result, a warning). Use a pause tool when you need an answer.', input_schema: obj({ kind: str('info, progress, done or error', { enum: ['info', 'progress', 'done', 'error'] }), title: str('Short title'), body: str('Details') }, ['title']) }, {
    run: ({ kind = 'info', title, body }, ctx) => { notify({ agentId: agent.id, runId: ctx.runId, kind, title, body }); return 'Notified.'; },
  });

  /* ---- hub: apps + publishing ---- */
  add('hub', { name: 'apps_search', description: 'Search the app library (Gmail-like services, CRMs, payments, search APIs…).', input_schema: obj({ query: str('Service or need') }) }, {
    run: ({ query }) => JSON.stringify(searchConnectors(query || '')),
  });
  if (T.filesystem) {
    add('hub', { name: 'publish_file', description: 'Publish a file of your workspace at a public URL and get the link. Re-publishing keeps the URL. HTML must inline its CSS and JS.', input_schema: obj({ path: str('File path in your workspace') }, ['path']) }, {
      gate: () => agent.approvals.publish,
      run: ({ path: p }) => {
        const f = safeJoin(paths.agentWorkspace(agent.id), p);
        if (!fs.existsSync(f)) throw new ToolError(`No such file: ${p}`);
        if (fs.statSync(f).size > 25 * 1024 * 1024) throw new ToolError('25 MB per published file.');
        const rel = path.relative(paths.agentWorkspace(agent.id), f).split(path.sep).join('/');
        let row = q.get('SELECT slug FROM published WHERE agent_id = ? AND path = ?', agent.id, rel);
        if (!row) { row = { slug: `${slugify(path.basename(rel, path.extname(rel)))}-${uid().slice(0, 8)}` }; insert('published', { slug: row.slug, agent_id: agent.id, path: rel, created_at: now() }); }
        return `${PUBLIC_URL}/p/${row.slug}`;
      },
    });
    add('hub', { name: 'unpublish_file', description: 'Revoke the public URL of a file.', input_schema: obj({ path: str('File path') }, ['path']) }, {
      run: ({ path: p }) => { q.run('DELETE FROM published WHERE agent_id = ? AND path = ?', agent.id, p); return `Unpublished ${p}.`; },
    });
  }

  /* ---- human in the loop: these stop your turn and show a card ---- */
  add('askUser', { name: 'ask_user', description: 'Ask the user one or more questions in a single card and pause until they answer. Offer suggested answers as options; the user can always type something else.', input_schema: obj({ questions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, multiple: { type: 'boolean', description: 'Allow ticking several options' } }, required: ['question'] } } }, ['questions']) }, {
    pause: 'question',
  });
  add('requestApproval', { name: 'request_approval', description: 'Ask for approval before consequential actions (paying, refunding, emailing a client, deleting data, posting publicly). List each action with its exact detail (recipient, amount, diff). The user approves or declines per item.', input_schema: obj({ actions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title'] } } }, ['actions']) }, {
    pause: 'approval',
  });
  add('suggestService', { name: 'suggest_service', description: 'Ask the user to connect an app from the library that you need (it shows the setup form). Use apps_search to find the slug.', input_schema: obj({ slug: str('App slug'), reason: str('Why you need it') }, ['slug']) }, {
    pause: 'connector',
    validate: ({ slug }) => { if (!findApp(slug)) throw new ToolError(`No app "${slug}". Use apps_search.`); },
  });
  add('requestSecret', { name: 'request_secret', description: 'Ask the user for an API key or password through a masked form. You only learn that the variable was filled, never its value; then reference it as ${NAME} in an MCP config, or $NAME in shell commands. Never ask for a secret in the chat.', input_schema: obj({ name: str('UPPER_SNAKE_CASE variable name'), label: str('What it is, for the user'), reason: str('Why you need it') }, ['name', 'label']) }, {
    pause: 'secret',
    validate: ({ name }) => { if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new ToolError('name must be UPPER_SNAKE_CASE.'); },
  });

  /* ---- self-improvement ---- */
  if (SI.enabled && SI.allowSoulEdit) {
    add(null, { name: 'soul_update', description: 'Rewrite your own system prompt (soul) when the user corrects how you should work in general. Pass the complete new soul.', input_schema: obj({ soul: str('The full new soul, in markdown') }, ['soul']) }, {
      run: ({ soul }) => { updateAgent(agent.id, { soul }); return 'Soul updated. It applies from your next run.'; },
    });
  }
  if (SI.enabled && SI.allowToolInstall) {
    add(null, { name: 'apps_install', description: 'Install an app from the library on yourself. If it needs credentials, follow with suggest_service.', input_schema: obj({ slug: str('App slug') }, ['slug']) }, {
      gate: () => true,
      run: ({ slug }) => JSON.stringify(attachConnector(agent.id, slug)),
    });
    add(null, { name: 'mcp_register', description: 'Register a custom MCP server on yourself (stdio command, or http/sse URL). Reference secrets as ${NAME}. Its tools become available from your next run.', input_schema: obj({ name: str('Name'), transport: str('stdio, http or sse', { enum: ['stdio', 'http', 'sse'] }), command: str('For stdio'), args: { type: 'array', items: { type: 'string' } }, url: str('For http/sse'), headers: { type: 'object', additionalProperties: { type: 'string' } }, env: { type: 'object', additionalProperties: { type: 'string' } } }, ['name', 'transport']) }, {
      gate: () => true,
      run: (input) => JSON.stringify(upsertServer(agent.id, input)),
    });
  }

  return { defs, handlers };
}

/** Minimal JSON-schema check of a tool input: object, required keys, primitive types. */
export function validateInput(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Tool input must be a JSON object.';
  if ('__invalid_json' in input) return 'Tool input was not valid JSON.';
  for (const k of schema?.required || []) if (input[k] === undefined) return `Missing required field "${k}".`;
  for (const [k, v] of Object.entries(input)) {
    const p = schema?.properties?.[k];
    if (!p || v == null) continue;
    const t = p.type;
    const ok = t === 'string' ? typeof v === 'string' : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number'
      : t === 'boolean' ? typeof v === 'boolean' : t === 'array' ? Array.isArray(v) : t === 'object' ? typeof v === 'object' && !Array.isArray(v) : true;
    if (!ok) return `Field "${k}" must be ${t}.`;
    if (p.enum && !p.enum.includes(v)) return `Field "${k}" must be one of ${p.enum.join(', ')}.`;
  }
  return null;
}

export const resultText = (out, agentId) => redact(typeof out === 'string' ? out : JSON.stringify(out), agentId);
