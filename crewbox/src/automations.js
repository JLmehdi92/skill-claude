import { Cron } from 'croner';
import { q, insert, update } from './db.js';
import { uid, now, slugify, token as newToken } from './util.js';
import { PUBLIC_URL } from './config.js';
import { agentConfig } from './agents.js';
import { getConnection } from './providers/index.js';
import { startRun } from './runtime/runner.js';
import { emit } from './bus.js';

/* ---------- scheduled tasks ---------- */

const jobs = new Map(); // schedule id -> Cron

function scheduleView(s) {
  return {
    slug: s.slug, name: s.name, description: s.description, body: s.body, cron: s.cron, runAt: s.run_at, timezone: s.timezone,
    connectionId: s.connection_id, model: s.model, enabled: !!s.enabled, lastRunAt: s.last_run_at, lastRunId: s.last_run_id,
    nextRunAt: jobs.get(s.id)?.nextRun()?.toISOString() ?? null,
  };
}

export const listSchedules = (agentId) => q.all('SELECT * FROM schedules WHERE agent_id = ? ORDER BY created_at', agentConfig(agentId).id).map(scheduleView);

function validateCron(cron, timezone) {
  try { new Cron(cron, { timezone: timezone || undefined, paused: true }).stop(); } catch (e) { throw new Error(`Invalid cron "${cron}": ${e.message}`); }
  if (cron.trim().split(/\s+/).length !== 5) throw new Error('Use a standard 5-field cron, e.g. "0 9 * * 1".');
}

function checkModel(connectionId, model) {
  if (model && !connectionId) throw new Error('Pass connectionId together with model.');
  if (connectionId) {
    const c = getConnection(connectionId);
    if (!c) throw new Error('Unknown connectionId.');
    if (model && !c.models.includes(model)) throw new Error(`${c.name} does not serve ${model}.`);
  }
}

export function upsertSchedule(agentId, args) {
  const a = agentConfig(agentId);
  const { slug, name, body, cron, runAt, timezone, description, enabled, connectionId, model } = args;
  if (timezone) { try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error(`Unknown IANA timezone "${timezone}".`); } }
  if (cron) validateCron(cron, timezone);
  if (runAt && Number.isNaN(Date.parse(runAt))) throw new Error('runAt must be an ISO date.');
  checkModel(connectionId, model);

  if (slug) {
    const s = q.get('SELECT * FROM schedules WHERE agent_id = ? AND slug = ?', a.id, slug);
    if (!s) throw new Error(`Scheduled task not found: ${slug}`);
    if (s.cron && runAt) throw new Error('An update cannot turn a recurring task into a one-off: delete and recreate it.');
    if (cron === null || cron === '') throw new Error('An update can change a cron but cannot clear it.');
    const patch = {};
    for (const [k, v] of Object.entries({ name, body, cron, run_at: runAt, timezone, description, enabled, connection_id: connectionId, model })) if (v !== undefined) patch[k] = v;
    if (model === null) { patch.model = null; patch.connection_id = null; }
    update('schedules', { id: s.id }, patch);
    armSchedule(s.id);
    emit('agent', { id: a.id });
    return scheduleView(q.get('SELECT * FROM schedules WHERE id = ?', s.id));
  }
  if (!name || !body) throw new Error('name and body are required when creating.');
  if (!cron && !runAt) throw new Error('Pass a cron, or runAt for a one-off.');
  let base = slugify(name), s2 = base, i = 1;
  while (q.get('SELECT 1 FROM schedules WHERE agent_id = ? AND slug = ?', a.id, s2)) s2 = `${base}-${++i}`;
  const id = uid('sch_');
  insert('schedules', {
    id, agent_id: a.id, slug: s2, name, description: description || null, body, cron: cron || null, run_at: runAt || null,
    timezone: timezone || null, connection_id: connectionId || null, model: model || null, enabled: enabled ?? true, created_at: now(),
  });
  armSchedule(id);
  emit('agent', { id: a.id });
  return scheduleView(q.get('SELECT * FROM schedules WHERE id = ?', id));
}

export function deleteSchedule(agentId, slug) {
  const s = q.get('SELECT * FROM schedules WHERE agent_id = ? AND slug = ?', agentConfig(agentId).id, slug);
  if (!s) throw new Error(`Scheduled task not found: ${slug}`);
  jobs.get(s.id)?.stop(); jobs.delete(s.id);
  q.run('DELETE FROM schedules WHERE id = ?', s.id);
  return { deleted: slug };
}

/** Fire now: works on a disabled task and leaves its schedule and last-run date alone. */
export function runScheduleNow(agentId, slug) {
  const s = q.get('SELECT * FROM schedules WHERE agent_id = ? AND slug = ?', agentConfig(agentId).id, slug);
  if (!s) throw new Error(`Scheduled task not found: ${slug}`);
  const { runId, sessionId } = fireSchedule(s, { manual: true });
  return { runId, sessionId };
}

function fireSchedule(s, { manual = false } = {}) {
  const r = startRun({
    agentId: s.agent_id, input: s.body, trigger: `schedule:${s.slug}`, sessionKind: 'schedule', sessionTitle: `schedule: ${s.slug}`,
    connectionId: s.connection_id, model: s.model,
  });
  if (!manual) {
    q.run('UPDATE schedules SET last_run_at = ?, last_run_id = ? WHERE id = ?', now(), r.runId, s.id);
    if (s.run_at) { q.run('UPDATE schedules SET enabled = 0 WHERE id = ?', s.id); jobs.get(s.id)?.stop(); jobs.delete(s.id); }
  }
  return r;
}

export function armSchedule(id) {
  jobs.get(id)?.stop(); jobs.delete(id);
  const s = q.get('SELECT s.*, a.enabled AS agent_enabled FROM schedules s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?', id);
  if (!s || !s.enabled || !s.agent_enabled) return;
  const pattern = s.cron || new Date(s.run_at);
  if (!s.cron && new Date(s.run_at) <= new Date()) {
    // A one-off whose time passed while the app was off fires once at startup.
    if (!s.last_run_at) fireSchedule(s);
    return;
  }
  const job = new Cron(pattern, { timezone: s.timezone || undefined, protect: true }, () => {
    const cur = q.get('SELECT * FROM schedules WHERE id = ?', id);
    if (cur?.enabled) fireSchedule(cur);
  });
  jobs.set(id, job);
}

export function startScheduler() {
  for (const { id } of q.all('SELECT id FROM schedules WHERE enabled = 1')) {
    try { armSchedule(id); } catch (e) { console.error(`schedule ${id}: ${e.message}`); }
  }
}

export function stopScheduler() { for (const j of jobs.values()) j.stop(); jobs.clear(); }

export function rearmAgent(agentId) {
  for (const { id } of q.all('SELECT id FROM schedules WHERE agent_id = ?', agentId)) armSchedule(id);
}

/* ---------- webhook triggers ---------- */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const triggerUrl = (t) => `${PUBLIC_URL}/api/t/${t.agent_id}/${t.slug}/${t.token}`;

function triggerView(t, withUrl = true) {
  return {
    slug: t.slug, name: t.name, description: t.description, body: t.body, methods: JSON.parse(t.methods), enabled: !!t.enabled,
    connectionId: t.connection_id, model: t.model, fireCount: t.fire_count, lastFiredAt: t.last_fired_at,
    ...(withUrl ? { url: triggerUrl(t) } : {}),
  };
}

export const listTriggers = (agentId) => q.all('SELECT * FROM triggers WHERE agent_id = ? ORDER BY created_at', agentConfig(agentId).id).map((t) => triggerView(t));

export function upsertTrigger(agentId, args) {
  const a = agentConfig(agentId);
  const { slug, name, body, methods, description, enabled, connectionId, model } = args;
  if (methods && (!methods.length || methods.some((m) => !METHODS.includes(String(m).toUpperCase())))) throw new Error(`methods are among ${METHODS.join(', ')}`);
  checkModel(connectionId, model);
  if (slug) {
    const t = q.get('SELECT * FROM triggers WHERE agent_id = ? AND slug = ?', a.id, slug);
    if (!t) throw new Error(`Trigger not found: ${slug}`);
    if (name && slugify(name) !== t.slug) throw new Error('A trigger cannot be renamed: its URL is built from the slug. Delete and recreate it.');
    const patch = {};
    for (const [k, v] of Object.entries({ name, body, description, enabled, connection_id: connectionId, model })) if (v !== undefined) patch[k] = v;
    if (methods) patch.methods = methods.map((m) => m.toUpperCase());
    if (model === null) { patch.model = null; patch.connection_id = null; }
    update('triggers', { id: t.id }, patch);
    return triggerView(q.get('SELECT * FROM triggers WHERE id = ?', t.id));
  }
  if (!name || !body) throw new Error('name and body are required when creating.');
  const s = slugify(name);
  if (q.get('SELECT 1 FROM triggers WHERE agent_id = ? AND slug = ?', a.id, s)) throw new Error(`A trigger named ${s} already exists.`);
  const id = uid('trg_');
  insert('triggers', {
    id, agent_id: a.id, slug: s, name, description: description || null, body, methods: (methods || ['POST']).map((m) => m.toUpperCase()),
    token: newToken(24), connection_id: connectionId || null, model: model || null, enabled: enabled ?? true, created_at: now(),
  });
  emit('agent', { id: a.id });
  return triggerView(q.get('SELECT * FROM triggers WHERE id = ?', id));
}

export function rotateTriggerToken(agentId, slug) {
  const t = q.get('SELECT * FROM triggers WHERE agent_id = ? AND slug = ?', agentConfig(agentId).id, slug);
  if (!t) throw new Error(`Trigger not found: ${slug}`);
  q.run('UPDATE triggers SET token = ? WHERE id = ?', newToken(24), t.id);
  return { slug, url: triggerUrl(q.get('SELECT * FROM triggers WHERE id = ?', t.id)) };
}

export function deleteTrigger(agentId, slug) {
  const r = q.run('DELETE FROM triggers WHERE agent_id = ? AND slug = ?', agentConfig(agentId).id, slug);
  if (!r.changes) throw new Error(`Trigger not found: ${slug}`);
  return { deleted: slug };
}

const PAYLOAD_MAX = 64 * 1024;
export const BODY_MAX = 1024 * 1024;

export function triggerPrompt(t, { method, contentType, raw, query }) {
  let text = raw || '';
  if (/json/i.test(contentType || '') || /^\s*[[{]/.test(text)) {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
  }
  if (query) text = `${text ? text + '\n' : ''}?${query}`;
  const bytes = Buffer.byteLength(raw || '');
  if (text.length > PAYLOAD_MAX) text = text.slice(0, PAYLOAD_MAX) + '\n…[truncated at 64 KB]';
  // Escape any closing tag so a caller cannot end the block early and inject instructions.
  text = text.replace(/<\/(\s*trigger_payload)/gi, '<\\/$1');
  const attrs = `trigger="${t.slug}" method="${method}" received="${now()}" content-type="${(contentType || 'none').replace(/"/g, '')}" bytes="${bytes}"`;
  return `${t.body}\n\n<trigger_payload ${attrs}>\n${text}\n</trigger_payload>`;
}

/** Fire a trigger. Returns null for anything that must look like a 404. */
export function fireTrigger({ agentId, slug, tokenValue, method, contentType, raw, query, skipToken = false }) {
  const t = q.get('SELECT t.*, a.enabled AS agent_enabled FROM triggers t JOIN agents a ON a.id = t.agent_id WHERE t.agent_id = ? AND t.slug = ?', agentId, slug);
  if (!t || !t.enabled || !t.agent_enabled) return null;
  if (!skipToken && t.token !== tokenValue) return null;
  const methods = JSON.parse(t.methods);
  if (!methods.includes(method)) return { notAllowed: true, allow: methods.join(', ') };
  const r = startRun({
    agentId, input: triggerPrompt(t, { method, contentType, raw, query }), trigger: `trigger:${t.slug}`,
    sessionKind: 'trigger', sessionTitle: `trigger: ${t.slug}`, connectionId: t.connection_id, model: t.model,
  });
  q.run('UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = ? WHERE id = ?', now(), t.id);
  return { runId: r.runId, sessionId: r.sessionId, trigger: t.slug };
}

export function testTrigger(agentId, slug, { body, method, query, contentType } = {}) {
  const a = agentConfig(agentId);
  const t = q.get('SELECT * FROM triggers WHERE agent_id = ? AND slug = ?', a.id, slug);
  if (!t) throw new Error(`Trigger not found: ${slug}`);
  if (!t.enabled) throw new Error('This trigger is disabled: enable it first (a disabled trigger answers like a missing one).');
  const m = (method || JSON.parse(t.methods)[0]).toUpperCase();
  if (!JSON.parse(t.methods).includes(m)) throw new Error(`This trigger does not accept ${m}. It accepts ${JSON.parse(t.methods).join(', ')}.`);
  const raw = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  if (Buffer.byteLength(raw) > BODY_MAX) throw new Error('Payload over 1 MB.');
  const r = fireTrigger({ agentId: a.id, slug, method: m, contentType: contentType || (typeof body === 'object' ? 'application/json' : 'text/plain'), raw, query, skipToken: true });
  if (!r) throw new Error('The trigger refused the call.');
  return r;
}

const PREVIEWERS = /slackbot|discordbot|twitterbot|whatsapp|telegrambot|facebookexternalhit|linkedinbot|skypeuripreview|raycast|embedly|iframely|redditbot|applebot|googlebot|bingbot|vkshare|pinterest/i;
export function isPassiveVisit(headers) {
  const purpose = `${headers['purpose'] || ''} ${headers['sec-purpose'] || ''} ${headers['x-purpose'] || ''} ${headers['x-moz'] || ''}`;
  return PREVIEWERS.test(headers['user-agent'] || '') || /prefetch|preview/i.test(purpose);
}
