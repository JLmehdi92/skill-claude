export const TOKEN = document.querySelector('meta[name="crewbox-token"]')?.content || 'dev';

export async function api(name, args = {}) {
  const res = await fetch(`/api/ui/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-crewbox-token': TOKEN },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const listeners = new Set();
let source;
/** Subscribe to the server event stream (one shared EventSource). */
export function onServerEvent(fn) {
  listeners.add(fn);
  if (!source) {
    source = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`);
    source.onmessage = (e) => { const ev = JSON.parse(e.data); for (const l of listeners) l(ev); };
  }
  return () => listeners.delete(fn);
}

export const downloadUrl = (path, agentId, inline) =>
  `/api/download?t=${encodeURIComponent(TOKEN)}&path=${encodeURIComponent(path)}${agentId ? `&agentId=${agentId}` : ''}${inline ? '&inline=1' : ''}`;
