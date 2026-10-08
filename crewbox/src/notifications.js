import { q, insert } from './db.js';
import { uid, now } from './util.js';
import { emit } from './bus.js';

// Kinds: info, progress, done, error (out of band) and question, approval, connector, secret (raised by pauses).

export function notify({ agentId = null, runId = null, pauseId = null, kind = 'info', title, body = '' }) {
  const id = uid('ntf_');
  insert('notifications', { id, agent_id: agentId, run_id: runId, pause_id: pauseId, kind, title: String(title).slice(0, 300), body: String(body || '').slice(0, 4000), read: 0, created_at: now() });
  const n = q.get('SELECT * FROM notifications WHERE id = ?', id);
  emit('notification', n);
  return n;
}

export function listNotifications({ agentId, unreadOnly, limit = 100 } = {}) {
  const where = [], p = [];
  if (agentId) { where.push('agent_id = ?'); p.push(agentId); }
  if (unreadOnly) where.push('read = 0');
  return q.all(`SELECT n.*, a.name AS agent_name FROM notifications n LEFT JOIN agents a ON a.id = n.agent_id ${where.length ? 'WHERE ' + where.map((w) => 'n.' + w).join(' AND ') : ''} ORDER BY n.created_at DESC LIMIT ?`, ...p, limit);
}

export function markRead(ids) {
  if (ids === 'all') q.run('UPDATE notifications SET read = 1');
  else for (const id of ids || []) q.run('UPDATE notifications SET read = 1 WHERE id = ?', id);
  emit('notification', { read: true });
}
