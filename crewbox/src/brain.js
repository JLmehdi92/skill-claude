import { q, insert, update, openDb } from './db.js';
import { uid, now, slugify, truncate } from './util.js';
import { emit } from './bus.js';
import { notify } from './notifications.js';

// The Brain: where the company lives. Pages about what you do (offer, customers, tone, tools…),
// written by the onboarding from your website and by you. Every coworker reads it before it
// works. A coworker that learns something worth keeping sends a proposal; nothing changes until
// the owner accepts it.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brain_pages (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', source TEXT,
  position INTEGER DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brain_proposals (
  id TEXT PRIMARY KEY, agent_id TEXT, page_slug TEXT, title TEXT NOT NULL, body TEXT NOT NULL,
  reason TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT
);`;
let ready = false;
const db = () => { if (!ready) { openDb().exec(SCHEMA); ready = true; } };

const FULL_LIMIT = 14_000; // below this, every page goes into the prompt in full

export function listPages() {
  db();
  return q.all('SELECT slug, title, body, source, updated_at AS updatedAt FROM brain_pages ORDER BY position, updated_at');
}

export function getPage(slug) {
  db();
  const p = q.get('SELECT slug, title, body, source, updated_at AS updatedAt FROM brain_pages WHERE slug = ?', slug);
  if (!p) throw new Error(`No Brain page "${slug}". Pages: ${listPages().map((x) => x.slug).join(', ') || 'none yet'}`);
  return p;
}

export function upsertPage({ slug, title, body = '', source = 'owner', position }) {
  db();
  if (!title?.trim()) throw new Error('A Brain page needs a title.');
  const s = slugify(slug || title);
  const exists = q.get('SELECT slug FROM brain_pages WHERE slug = ?', s);
  if (exists) update('brain_pages', { slug: s }, { title: title.trim(), body: String(body), source, updated_at: now(), ...(position !== undefined ? { position } : {}) });
  else insert('brain_pages', { slug: s, title: title.trim(), body: String(body), source, position: position ?? (q.get('SELECT COUNT(*) AS n FROM brain_pages').n), updated_at: now() });
  emit('brain', { slug: s });
  return getPage(s);
}

export function deletePage(slug) {
  db();
  q.run('DELETE FROM brain_pages WHERE slug = ?', slug);
  emit('brain', { slug });
  return { deleted: slug };
}

/** The Brain as it goes into every system prompt. */
export function brainPrompt() {
  const pages = listPages().filter((p) => p.body.trim());
  if (!pages.length) return '';
  const total = pages.reduce((n, p) => n + p.body.length, 0);
  if (total <= FULL_LIMIT) return pages.map((p) => `### ${p.title}\n${p.body.trim()}`).join('\n\n');
  return `${pages.map((p) => `### ${p.title} [${p.slug}]\n${truncate(p.body.trim(), 700)}`).join('\n\n')}\n\nThese are excerpts: open a page in full with brain_read.`;
}

export function propose(agentId, { slug, title, body, reason }) {
  db();
  if (!title || !body) throw new Error('A proposal needs a title and the full new text of the page.');
  const id = uid('brp_');
  // An existing page is replaced; a new slug names the page the proposal creates.
  insert('brain_proposals', { id, agent_id: agentId, page_slug: slug ? slugify(slug) : null, title, body, reason: reason || '', status: 'pending', created_at: now() });
  const a = agentId ? q.get('SELECT name FROM agents WHERE id = ?', agentId) : null;
  notify({ agentId, kind: 'brain', title: `${a?.name || 'A coworker'} proposes a Brain update: ${title}`, body: reason || '' });
  emit('brain', { proposal: id });
  return { proposalId: id, status: 'pending', note: 'The owner decides. Nothing changes in the Brain until they accept it.' };
}

export function listProposals({ status = 'pending' } = {}) {
  db();
  return q.all(`SELECT p.*, a.name AS agent_name FROM brain_proposals p LEFT JOIN agents a ON a.id = p.agent_id ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.created_at DESC`, ...(status ? [status] : []));
}

export function decideProposal(id, accept) {
  db();
  const p = q.get('SELECT * FROM brain_proposals WHERE id = ?', id);
  if (!p) throw new Error('Proposal not found.');
  if (p.status !== 'pending') throw new Error(`This proposal was already ${p.status}.`);
  if (accept) upsertPage({ slug: p.page_slug || undefined, title: p.title, body: p.body, source: `agent:${p.agent_id}` });
  update('brain_proposals', { id }, { status: accept ? 'accepted' : 'rejected', decided_at: now() });
  emit('brain', { proposal: id });
  return { id, status: accept ? 'accepted' : 'rejected' };
}
