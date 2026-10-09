import { onServerEvent } from '../lib/api.js';

// Live activity for the board: the last tool call of each coworker (it flashes and ripples) and
// arcs between coworkers when one calls another. A tiny store the board subscribes to.
export const pulses = new Map();   // agentId -> { at, tool, n }
export const beams = [];           // { id, from, to, at }
const subs = new Set();
let version = 0;
let seq = 0;
const bump = () => { version++; subs.forEach((f) => f()); };

let started = false;
export function startActivity() {
  if (started) return;
  started = true;
  onServerEvent(({ type, data }) => {
    if (!data) return;
    if (type === 'tool') {
      const prev = pulses.get(data.agentId);
      pulses.set(data.agentId, { at: Date.now(), tool: data.tool, error: !!data.isError, n: (prev?.n || 0) + 1 });
      bump();
    }
    if (type === 'beam') {
      const id = ++seq;
      beams.push({ id, from: data.from, to: data.to, at: Date.now() });
      bump();
      setTimeout(() => { const i = beams.findIndex((x) => x.id === id); if (i >= 0) beams.splice(i, 1); bump(); }, 2800);
    }
  });
}

export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const getVersion = () => version;
