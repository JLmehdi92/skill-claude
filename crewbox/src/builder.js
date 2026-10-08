import { resolveRunsOn, chat } from './providers/index.js';
import { createAgent } from './agents.js';
import { upsertSkill } from './skills.js';
import { upsertSchedule } from './automations.js';
import { attachConnector, CATALOG } from './catalog.js';

// "Describe the job in your own words. It sets itself up."
// One model call drafts the coworker: name, soul, skills, schedules and the apps it needs.

const SYSTEM = `You design AI coworkers: autonomous agents that do one recurring job for a small business.
From the user's description, return ONLY a JSON object:
{
  "name": "Short human name + role, e.g. 'Margo · Invoice Chasing'",
  "description": "One line: what this coworker is for",
  "soul": "Markdown system prompt, second person: who it is, what it owns, how it works (steps, tone), what it hands to someone else, the non-negotiable rules (approvals before paying/emailing clients/deleting). 150-400 words.",
  "skills": [{"name": "...", "description": "Use when ...", "body": "numbered procedure"}],
  "schedules": [{"name": "...", "body": "instruction it receives when the task fires", "cron": "5-field cron", "timezone": "IANA tz"}],
  "connectors": ["app slugs from the list below that the job clearly needs"]
}
Keep skills to 0-3 and schedules to 0-2. Only add a schedule if the description implies a rhythm.
Available app slugs: ${CATALOG.map((a) => `${a.slug} (${a.name})`).join(', ')}.`;

function heuristic(description) {
  const words = description.trim().split(/\s+/).slice(0, 4).join(' ');
  const daily = /every (day|morning)|daily|chaque (jour|matin)|tous les (jours|matins)/i.test(description);
  const weekly = /every (week|monday)|weekly|chaque semaine|tous les lundis|hebdo/i.test(description);
  return {
    name: words.charAt(0).toUpperCase() + words.slice(1),
    description: description.slice(0, 140),
    soul: `# Your job\n${description}\n\n# How you work\n- Do the job end to end with your tools, then report what you did in a few lines.\n- Keep structured results in your database.\n- Ask before anything consequential (payments, emails to clients, deletions).\n- When the user corrects you, remember it.`,
    skills: [],
    schedules: daily ? [{ name: 'Daily run', body: description, cron: '0 8 * * *' }] : weekly ? [{ name: 'Weekly run', body: description, cron: '0 9 * * 1' }] : [],
    connectors: [],
  };
}

export async function draftFromDescription(description) {
  const runsOn = resolveRunsOn();
  if (!runsOn.connection || runsOn.provider === 'mock') return { draft: heuristic(description), drafted: 'heuristic' };
  const r = await chat(runsOn.connection, { model: runsOn.model, system: SYSTEM, messages: [{ role: 'user', content: description }], tools: [], effort: 'medium', maxTokens: 8000 });
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  try { return { draft: JSON.parse(m[0]), drafted: 'model' }; } catch { return { draft: heuristic(description), drafted: 'heuristic' }; }
}

export async function buildFromDescription({ description, spaceId, timezone }) {
  if (!description?.trim()) throw new Error('Describe the job first.');
  const { draft, drafted } = await draftFromDescription(description);
  const agent = createAgent({ name: draft.name || 'New coworker', description: draft.description || '', soul: draft.soul || '', spaceId });
  for (const s of (draft.skills || []).slice(0, 5)) { try { upsertSkill(agent.id, s); } catch { /* skip malformed */ } }
  for (const s of (draft.schedules || []).slice(0, 3)) {
    try { upsertSchedule(agent.id, { name: s.name, body: s.body, cron: s.cron, timezone: s.timezone || timezone, enabled: false }); } catch { /* skip */ }
  }
  const connectors = (draft.connectors || []).filter((c) => CATALOG.some((a) => a.slug === c)).map((c) => attachConnector(agent.id, c));
  return { agentId: agent.id, name: agent.name, handle: agent.handle, drafted, connectors };
}
