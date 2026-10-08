// Offline provider: no network, deterministic. Useful to try the app without a key and in tests.
//   "/tool <name> <json>"            → calls that tool
//   "/tools [[name, json], ...]"     → calls several tools in parallel
//   anything else                    → a short echo reply
let n = 0;

const lastUser = (messages) => [...messages].reverse().find((m) => m.role === 'user');

export async function mockChat({ messages, tools, onText }) {
  const last = lastUser(messages);
  let content;
  if (last && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
    const results = last.content.filter((b) => b.type === 'tool_result');
    const summary = results.map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))).join(' | ');
    content = [{ type: 'text', text: `(mock) Done. Tool results: ${summary.slice(0, 600)}` }];
  } else {
    const text = typeof last?.content === 'string' ? last.content
      : (last?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const multi = /\/tools\s+(\[[\s\S]*\])\s*$/.exec(text || '');
    const one = /\/tool\s+([a-z_][\w]*)\s*([\s\S]*)$/i.exec(text || '');
    const names = new Set((tools || []).map((t) => t.name));
    if (multi) {
      content = JSON.parse(multi[1]).map(([name, input]) => ({ type: 'tool_use', id: `toolu_mock_${++n}`, name, input: input || {} }));
    } else if (one && names.has(one[1])) {
      content = [{ type: 'tool_use', id: `toolu_mock_${++n}`, name: one[1], input: one[2].trim() ? JSON.parse(one[2]) : {} }];
    } else if (one) {
      content = [{ type: 'text', text: `(mock) I don't have a tool named ${one[1]}.` }];
    } else {
      content = [{ type: 'text', text: `(mock) Got it: "${(text || '').slice(0, 200)}". Connect a real AI provider to get actual work done.` }];
    }
  }
  for (const b of content) if (b.type === 'text') onText?.(b.text);
  const stopReason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  const chars = JSON.stringify(messages).length;
  return { content, stopReason, usage: { input: Math.ceil(chars / 4), output: Math.ceil(JSON.stringify(content).length / 4) }, model: 'mock-1' };
}
