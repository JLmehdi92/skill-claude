import { chat } from '../providers/index.js';
import { addMemory, updateMemory, deleteMemory, listMemories } from '../memory.js';

// autoMemory: after a conversation, the coworker reviews it and may store, update or delete memories.

function flatten(messages, max = 30) {
  return messages.slice(-max).map((m) => {
    const text = typeof m.content === 'string' ? m.content
      : m.content.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? `[called ${b.name}]` : b.type === 'tool_result' ? '[tool result]' : '')).filter(Boolean).join(' ');
    return `${m.role.toUpperCase()}: ${text.slice(0, 2000)}`;
  }).join('\n');
}

export async function reviewMemories(agent, messages, runsOn) {
  const existing = listMemories(agent.id).slice(0, 60);
  const system = 'You maintain the long-term memory of an AI coworker. Memories are durable facts about the user, their business and how they want the work done (preferences, names, corrections, rules of thumb). Never store the work product itself, secrets, or one-off details. Reply with JSON only.';
  const prompt = `Coworker: ${agent.name}\n\nExisting memories:\n${existing.map((m) => `[${m.id}] ${m.content}`).join('\n') || '(none)'}\n\nConversation:\n${flatten(messages)}\n\nReturn {"add": [string], "update": [{"id": string, "content": string}], "delete": [string]} with only what this conversation clearly establishes or corrects. Empty lists are the usual answer.`;
  const r = await chat(runsOn.connection, { model: runsOn.model, system, messages: [{ role: 'user', content: prompt }], tools: [], effort: 'low', maxTokens: 2000 });
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return;
  let ops;
  try { ops = JSON.parse(m[0]); } catch { return; }
  for (const c of (ops.add || []).slice(0, 5)) if (typeof c === 'string' && c.trim()) addMemory(agent.id, c, ['auto']);
  for (const u of (ops.update || []).slice(0, 5)) { try { updateMemory(agent.id, u.id, u.content); } catch { /* gone */ } }
  for (const id of (ops.delete || []).slice(0, 5)) deleteMemory(agent.id, id);
}
