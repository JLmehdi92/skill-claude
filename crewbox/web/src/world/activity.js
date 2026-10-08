import { onServerEvent } from '../lib/api.js';

// Live activity for the world: tool pulses per coworker, beams between coworkers, and a ticker.
export const pulses = new Map();   // agentId -> timestamp of the last tool call
export const beams = [];           // { id, from, to, at }
let ticker = [];
const subs = new Set();
let seq = 0;
const push = (item) => {
  ticker = [{ id: ++seq, at: Date.now(), ...item }, ...ticker].slice(0, 8);
  subs.forEach((f) => f());
};

let started = false;
export function startActivity() {
  if (started) return;
  started = true;
  const lastStatus = new Map();
  onServerEvent(({ type, data }) => {
    if (!data) return;
    if (type === 'tool') { pulses.set(data.agentId, Date.now()); push({ kind: data.isError ? 'error' : 'tool', agentId: data.agentId, text: data.tool }); }
    if (type === 'beam') { beams.push({ id: ++seq, from: data.from, to: data.to, at: Date.now() }); push({ kind: 'beam', agentId: data.from, to: data.to }); }
    if (type === 'run' && data.status && lastStatus.get(data.id) !== data.status) {
      lastStatus.set(data.id, data.status);
      if (['done', 'error', 'waiting', 'running'].includes(data.status)) push({ kind: data.status, agentId: data.agentId });
    }
  });
}

export const subscribeTicker = (f) => { subs.add(f); return () => subs.delete(f); };
export const getTicker = () => ticker;
