import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, getSetting, setSetting } from './db.js';
import { paths } from './config.js';
import { createAgent, agentConfig, listSpaces } from './agents.js';
import { upsertSkill, listSkills, getSkill, readSkillFile } from './skills.js';
import { upsertSchedule, upsertTrigger } from './automations.js';
import { attachConnector, listAgentConnectors } from './catalog.js';
import { safeJoin, token, now } from './util.js';

// A template packages coworkers: prompts, skills, scheduled tasks, triggers, app declarations
// and starter files. Never memories, credentials or database rows.

const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const USER_DIR = () => path.join(paths.home, 'templates');

function readDir(dir, origin) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return { ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), origin }; } catch { return null; }
  }).filter(Boolean);
}

const allTemplates = () => [...readDir(BUILTIN_DIR, 'builtin'), ...readDir(path.join(BUILTIN_DIR, 'rerun'), 'rerun'), ...readDir(USER_DIR(), 'local')];

export function listTemplates() {
  return allTemplates().map((t) => ({
    slug: t.slug, name: t.name, description: t.description, category: t.category || 'other', tags: t.tags || [], setupMinutes: t.setupMinutes ?? null,
    origin: t.origin === 'builtin' ? 'crewbox' : t.origin, from: t.source?.site ? t.source : null,
    agents: t.agents.map((a) => ({ name: a.name, description: a.description, connectors: a.connectors || [], apps: a.apps || a.connectors || [], schedules: (a.schedules || []).length, skills: (a.skills || []).length, setup: !!a.setup?.required })),
  }));
}

export function getTemplate(slug) {
  const t = allTemplates().find((x) => x.slug === slug);
  if (!t) throw new Error(`Template not found: ${slug}`);
  return t;
}

export function installTemplate(tpl, { spaceId, startSetup } = {}) {
  if (typeof tpl === 'string') tpl = getTemplate(tpl);
  const space = spaceId || (listSpaces().length === 1 ? listSpaces()[0].id : null);
  if (!space) throw new Error('Pick the Box to install into (spaceId).');
  const created = [];
  for (const a of tpl.agents) {
    const agent = createAgent({
      name: a.name, handle: a.handle, description: a.description, soul: a.soul, spaceId: space, verbosity: a.verbosity,
      tools: a.tools, selfImprovement: a.selfImprovement, approvals: a.approvals, setup: a.setup,
    });
    for (const s of a.skills || []) upsertSkill(agent.id, s);
    for (const f of a.files || []) {
      const p = safeJoin(paths.agentWorkspace(agent.id), f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.content);
    }
    const connectors = (a.connectors || []).map((slug) => { try { return attachConnector(agent.id, slug); } catch (e) { return { slug, error: e.message }; } });
    // Schedules arrive disabled until the user has checked the coworker works.
    for (const s of a.schedules || []) upsertSchedule(agent.id, { ...s, enabled: s.enabled ?? false });
    for (const t of a.triggers || []) upsertTrigger(agent.id, t);
    created.push({ agentId: agent.id, name: agent.name, handle: agent.handle, connectors, setup: !!a.setup?.required });
  }
  // Guided setup: coworkers that need it start by interviewing the owner in their own conversation.
  if (startSetup) {
    for (const c of created.filter((x) => x.setup)) {
      const a = agentConfig(c.agentId);
      try {
        const h = startSetup({ agentId: a.id, input: a.setup.prompt, trigger: 'chat', sessionKind: 'chat', sessionTitle: 'Guided setup' });
        c.setupSessionId = h.sessionId;
      } catch { /* no AI provider yet: the owner can start it from the chat */ }
    }
  }
  return { template: tpl.slug, installed: created };
}

/** Capture working coworkers as a template (no memories, no secret values). */
export function exportTemplate(agentIds, { name, description, category, slug } = {}) {
  const agents = agentIds.map((id) => {
    const a = agentConfig(id);
    const skills = listSkills(a.id).filter((s) => !s.readOnly).map((s) => {
      const full = getSkill(a.id, s.slug);
      return { name: full.name, description: full.description, body: full.body, slug: s.slug, files: full.files.map((f) => ({ path: f.path, content: readSkillFile(a.id, s.slug, f.path).content })) };
    });
    return {
      name: a.name, handle: a.handle, description: a.description, soul: a.soul, verbosity: a.verbosity,
      tools: a.tools, selfImprovement: a.selfImprovement, approvals: a.approvals, setup: a.setup,
      skills,
      schedules: q.all('SELECT name, description, body, cron, run_at AS runAt, timezone FROM schedules WHERE agent_id = ?', a.id).map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v != null))),
      triggers: q.all('SELECT name, description, body, methods FROM triggers WHERE agent_id = ?', a.id).map((t) => ({ ...t, methods: JSON.parse(t.methods) })),
      connectors: listAgentConnectors(a.id).map((c) => c.slug),
    };
  });
  const tpl = { slug: slug || `custom-${Date.now()}`, name: name || agents.map((a) => a.name).join(' + '), description: description || '', category: category || 'Custom', agents };
  return tpl;
}

export function saveTemplate(tpl) {
  fs.mkdirSync(USER_DIR(), { recursive: true });
  fs.writeFileSync(path.join(USER_DIR(), `${tpl.slug}.json`), JSON.stringify(tpl, null, 2));
  return { saved: tpl.slug };
}

/* ---------- share links: one coworker, by link, without a marketplace ---------- */

export function createShare(agentId) {
  const tpl = exportTemplate([agentId]);
  const t = token(18);
  const shares = getSetting('shares', {});
  shares[t] = { agentId: agentConfig(agentId).id, createdAt: now(), template: tpl };
  setSetting('shares', shares);
  return { token: t, path: `/s/${t}` };
}

export function listShares(agentId) {
  const shares = getSetting('shares', {});
  return Object.entries(shares).filter(([, s]) => !agentId || s.agentId === agentId).map(([t, s]) => ({ token: t, path: `/s/${t}`, agentId: s.agentId, createdAt: s.createdAt }));
}

export function revokeShare(tokenValue) {
  const shares = getSetting('shares', {});
  if (!shares[tokenValue]) throw new Error('Share link not found.');
  delete shares[tokenValue];
  setSetting('shares', shares);
  return { revoked: tokenValue };
}

export const getShare = (t) => getSetting('shares', {})[t]?.template || null;
