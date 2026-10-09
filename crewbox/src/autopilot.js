import { q, insert, openDb, getSetting, setSetting } from './db.js';
import { bus, emit } from './bus.js';
import { uid, now, json, truncate } from './util.js';
import { notify } from './notifications.js';
import { resolveRunsOn, chat } from './providers/index.js';
import { brainPrompt } from './brain.js';
import { redact } from './secrets.js';

// Autopilot answers your coworkers within your rules. When a coworker stops on a card (a question,
// an approval, a gated tool), Autopilot reads the owner's rules — plain sentences such as "approve
// cold emails to new leads, at most 30 a day" — and answers only what a rule clearly covers. Anything
// else, and every credential or app connection, waits for the owner as usual. Every decision is logged.

const SCHEMA = `CREATE TABLE IF NOT EXISTS autopilot_log (
  id TEXT PRIMARY KEY, pause_id TEXT, agent_id TEXT, decision TEXT NOT NULL, reason TEXT, detail TEXT, created_at TEXT NOT NULL
);`;
let ready = false;
const db = () => { if (!ready) { openDb().exec(SCHEMA); ready = true; } };

export const settings = () => ({ enabled: false, rules: [], ...getSetting('autopilot', {}) });
export function save({ enabled, rules }) {
  const s = settings();
  const next = { ...s, ...(enabled !== undefined ? { enabled: !!enabled } : {}), ...(rules ? { rules: rules.map((r) => String(r).trim()).filter(Boolean).slice(0, 40) } : {}) };
  setSetting('autopilot', next);
  emit('autopilot', next);
  return next;
}
export function log(limit = 50) {
  db();
  return q.all('SELECT l.*, a.name AS agent_name FROM autopilot_log l LEFT JOIN agents a ON a.id = l.agent_id ORDER BY l.created_at DESC LIMIT ?', limit).map((r) => ({ ...r, detail: json(r.detail, null) }));
}
function record(pause, decision, reason, detail = null) {
  db();
  insert('autopilot_log', { id: uid('apl_'), pause_id: pause.id, agent_id: pause.agent_id, decision, reason: String(reason || '').slice(0, 1000), detail, created_at: now() });
  emit('autopilot', { pauseId: pause.id, decision });
}

const SYSTEM = `You are Autopilot, the owner's delegate in Crewbox. A coworker (an AI agent) stopped and asks the owner something.
Decide each item ONLY if one of the owner's rules clearly covers it. When in doubt, or when no rule applies, the decision is "escalate": the owner answers it.
Never approve paying, refunding, deleting data or anything irreversible unless a rule explicitly says so.
Answer ONLY with JSON: {"items":[{"id":"<item id>","decision":"approve"|"decline"|"answer"|"escalate","answers":["one per question, only for decision answer"],"perAction":["approve"|"decline", one per action, only for approvals],"rule":"the rule you applied","reason":"one short sentence"}]}`;

function describe(it) {
  if (it.kind === 'question') return { id: it.toolUseId, kind: 'question', questions: (it.input.questions || []).map((x) => ({ question: x.question, options: x.options || [] })) };
  if (it.kind === 'approval') return { id: it.toolUseId, kind: 'approval', actions: (it.input.actions || []).map((x) => ({ title: x.title, detail: truncate(x.detail || '', 3000) })) };
  if (it.kind === 'gate') return { id: it.toolUseId, kind: 'tool', tool: it.tool, input: truncate(JSON.stringify(it.input || {}), 3000) };
  return null;
}

function toAnswer(it, d) {
  if (it.kind === 'question') return { answers: (it.input.questions || []).map((_, i) => d.answers?.[i] ?? '') };
  if (it.kind === 'approval') {
    const n = (it.input.actions || []).length;
    return { decisions: Array.from({ length: n }, (_, i) => d.perAction?.[i] || (d.decision === 'decline' ? 'decline' : 'approve')) };
  }
  if (it.kind === 'gate') return { decision: d.decision === 'decline' ? 'deny' : 'once' };
  return null;
}

/** Look at one pending card. Answers it when the rules cover every item; otherwise leaves it to the owner. */
export async function consider(pauseId, { answer } = {}) {
  const s = settings();
  if (!s.enabled || !s.rules.length) return { skipped: 'off' };
  const pause = q.get("SELECT * FROM pauses WHERE id = ? AND status = 'pending'", pauseId);
  if (!pause) return { skipped: 'gone' };
  const items = json(pause.payload, {}).items || [];
  if (items.some((it) => it.kind === 'secret' || it.kind === 'connector')) { record(pause, 'escalate', 'Credentials and app connections always wait for the owner.'); return { escalated: true }; }
  const runsOn = resolveRunsOn();
  if (!runsOn.connection || runsOn.provider === 'mock') { record(pause, 'escalate', 'No AI model connected: Autopilot cannot judge this card.'); return { escalated: true }; }
  const agent = q.get('SELECT name, handle, description FROM agents WHERE id = ?', pause.agent_id);
  const user = [
    `## Owner's rules\n${s.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    `## The company\n${truncate(brainPrompt() || 'unknown', 4000)}`,
    `## Coworker\n${agent?.name} (@${agent?.handle}): ${agent?.description || ''}`,
    `## Items to decide\n${redact(JSON.stringify(items.map(describe).filter(Boolean), null, 1), pause.agent_id)}`,
  ].join('\n\n');
  let out;
  try {
    const r = await chat(runsOn.connection, { model: runsOn.model, system: SYSTEM, messages: [{ role: 'user', content: user }], tools: [], effort: 'low', maxTokens: 2000 });
    const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch (e) { record(pause, 'escalate', `Autopilot could not decide: ${e.message}`); return { escalated: true }; }
  const decisions = new Map((out.items || []).map((d) => [d.id, d]));
  if (items.some((it) => !decisions.get(it.toolUseId) || decisions.get(it.toolUseId).decision === 'escalate')) {
    const why = (out.items || []).find((d) => d.decision === 'escalate')?.reason || 'No rule covers it.';
    record(pause, 'escalate', why, decisions.size ? [...decisions.values()] : null);
    return { escalated: true, reason: why };
  }
  const answers = Object.fromEntries(items.map((it) => [it.toolUseId, toAnswer(it, decisions.get(it.toolUseId))]));
  const summary = [...decisions.values()].map((d) => `${d.decision}${d.rule ? ` — ${d.rule}` : ''}`).join('; ');
  record(pause, 'answered', summary, [...decisions.values()]);
  notify({ agentId: pause.agent_id, kind: 'autopilot', title: `Autopilot answered ${agent?.name || 'a coworker'}`, body: [...decisions.values()].map((d) => `${d.decision}: ${d.reason || ''} (${d.rule || 'rule'})`).join('\n') });
  // The runner is imported lazily: it imports half the app, and Autopilot must stay light.
  const resume = answer || (await import('./runtime/runner.js')).answerPause;
  // The card may be a few milliseconds ahead of its conversation being saved: retry briefly.
  for (let i = 0; ; i++) {
    try { await resume(pauseId, answers); break; }
    catch (e) { if (i >= 20 || !/no longer matches/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  return { answered: true, answers };
}

// Every new card goes past Autopilot first (it does nothing while it is off).
bus.on('event', ({ type, data }) => {
  if (type !== 'pause' || !data?.id || data.answered) return;
  if (!settings().enabled) return;
  setTimeout(() => consider(data.id).catch(() => {}), 50);
});
