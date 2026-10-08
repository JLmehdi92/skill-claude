import { q, insert } from './db.js';
import { uid, now } from './util.js';

// Memories fade if nothing uses them; every recall extends their life.
const LIFE_DAYS = 45;
const later = (days = LIFE_DAYS) => new Date(Date.now() + days * 86400_000).toISOString();

export function addMemory(agentId, content, tags = []) {
  const id = uid('mem_');
  insert('memories', { id, agent_id: agentId, content: String(content).trim(), tags: tags.join(','), uses: 0, created_at: now(), expires_at: later() });
  return { id, content };
}

export function updateMemory(agentId, id, content) {
  const r = q.run('UPDATE memories SET content = ?, expires_at = ? WHERE id = ? AND agent_id = ?', content, later(), id, agentId);
  if (!r.changes) throw new Error(`Memory not found: ${id}`);
  return { id, content };
}

export function deleteMemory(agentId, id) {
  q.run('DELETE FROM memories WHERE id = ? AND agent_id = ?', id, agentId);
  return { deleted: id };
}

export const listMemories = (agentId) =>
  q.all('SELECT id, content, tags, uses, created_at, last_used_at, expires_at FROM memories WHERE agent_id = ? AND expires_at > ? ORDER BY COALESCE(last_used_at, created_at) DESC', agentId, now());

const words = (s) => new Set(String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || []);

/** Keyword recall; each hit gets its life extended. */
export function recall(agentId, query, limit = 8) {
  const qw = words(query);
  const scored = listMemories(agentId).map((m) => {
    const mw = words(m.content + ' ' + (m.tags || ''));
    let score = 0;
    for (const w of qw) if (mw.has(w)) score += 1;
    return { m, score: score + Math.min(m.uses, 5) * 0.05 };
  }).filter((x) => x.score >= 1 || !qw.size).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.m);
  touch(scored.map((m) => m.id));
  return scored;
}

function touch(ids) {
  const t = now(), exp = later();
  for (const id of ids) q.run('UPDATE memories SET uses = uses + 1, last_used_at = ?, expires_at = ? WHERE id = ?', t, exp, id);
}

/** The most alive memories go into the system prompt; injecting counts as a light use. */
export function promptMemories(agentId, limit = 25) {
  return q.all('SELECT id, content FROM memories WHERE agent_id = ? AND expires_at > ? ORDER BY uses DESC, COALESCE(last_used_at, created_at) DESC LIMIT ?', agentId, now(), limit);
}

export const sweepMemories = () => q.run('DELETE FROM memories WHERE expires_at <= ?', now());
