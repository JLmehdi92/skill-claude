// OpenAI-compatible Chat Completions adapter: OpenAI, OpenRouter, Gemini's OpenAI endpoint,
// Ollama, LM Studio, vLLM. Converts the canonical (Anthropic-shaped) transcript both ways.

function toOpenAI(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      const texts = [];
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          const content = typeof b.content === 'string' ? b.content
            : (b.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
          out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'ERROR: ' : '') + content });
        } else if (b.type === 'text') texts.push(b.text);
      }
      if (texts.length) out.push({ role: 'user', content: texts.join('\n') });
    }
  }
  return out;
}

export async function openaiChat({ baseUrl, apiKey, provider, model, system, messages, tools, onText, signal, maxTokens }) {
  const body = {
    model,
    messages: toOpenAI(system, messages),
    stream: true,
    stream_options: { include_usage: true },
    ...(provider === 'ollama' ? {} : { max_completion_tokens: maxTokens }),
    ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
  };
  const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
  if (provider === 'openrouter') Object.assign(headers, { 'x-title': 'Crewbox' });
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 500)}`);

  let text = '', finish = null, usage = { input: 0, output: 0 };
  const calls = new Map();
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.usage) usage = { input: ev.usage.prompt_tokens || 0, output: ev.usage.completion_tokens || 0 };
      const ch = ev.choices?.[0];
      if (!ch) continue;
      if (ch.finish_reason) finish = ch.finish_reason;
      const d = ch.delta || {};
      if (d.content) { text += d.content; onText?.(d.content); }
      for (const tc of d.tool_calls || []) {
        const k = tc.index ?? 0;
        const cur = calls.get(k) || { id: tc.id, name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(k, cur);
      }
    }
  }
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const c of calls.values()) {
    let input = {};
    try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = { __invalid_json: c.args }; }
    content.push({ type: 'tool_use', id: c.id || `call_${Math.random().toString(36).slice(2)}`, name: c.name, input });
  }
  const stopReason = calls.size ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
  return { content, stopReason, usage, model };
}
