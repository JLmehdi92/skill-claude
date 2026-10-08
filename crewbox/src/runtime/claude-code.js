import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z, fromJSONSchema } from 'zod';
import { getSecret } from '../secrets.js';

// "Claude subscription" engine: the coworker runs through the Claude Agent SDK (the Claude Code
// harness), authenticated with the user's own Claude plan — a long-lived token from
// `claude setup-token`, or the Claude Code login already on this machine. Built-in Claude Code
// tools are switched off; the coworker only gets Crewbox tools, served in-process over MCP.

const PREFIX = 'mcp__crewbox__';

export function sdkEnv(connection) {
  const env = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'crewbox/0.2.0', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  // An API key in the environment would take precedence over the subscription.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const token = connection.secret_name ? getSecret('workspace', connection.secret_name) : null;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  if (connection.base_url) env.ANTHROPIC_BASE_URL = connection.base_url;
  return env;
}

function toShape(schema) {
  const props = schema?.properties || {};
  const required = new Set(schema?.required || []);
  const shape = {};
  for (const [k, v] of Object.entries(props)) {
    let t;
    try { t = fromJSONSchema(v); } catch { t = z.any(); }
    shape[k] = required.has(k) ? t : t.optional();
  }
  return shape;
}

/** Anthropic image blocks → MCP image content. */
function toMcpContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((b) => (b.type === 'image' ? { type: 'image', data: b.source.data, mimeType: b.source.media_type } : { type: 'text', text: b.text ?? JSON.stringify(b) }));
}

/**
 * Run one agent turn (which may take many steps) through Claude Code.
 * @param {object} p
 * @param {Array<{name:string, description:string, schema:object, run:(input:object)=>Promise<{content:any, isError?:boolean}>}>} p.toolset
 */
export async function runClaudeCode({ connection, model, system, prompt, resume, toolset = [], cwd, signal, maxTurns = 60, onInit, onDelta, onAssistant, onToolResults }) {
  const aliases = new Map(); // sdk tool name (without prefix) -> crewbox tool name
  const tools = toolset.map((t, i) => {
    const short = /^[a-zA-Z0-9_-]{1,40}$/.test(t.name) ? t.name : `app${i}_${t.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 40);
    aliases.set(short, t.name);
    return {
      name: short,
      description: t.description,
      inputSchema: toShape(t.schema),
      handler: async (args) => {
        const r = await t.run(args || {});
        return { content: toMcpContent(r.content), isError: !!r.isError };
      },
    };
  });
  const realName = (n) => (n?.startsWith(PREFIX) ? aliases.get(n.slice(PREFIX.length)) || n.slice(PREFIX.length) : n);

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const options = {
    systemPrompt: system,
    tools: [],
    mcpServers: tools.length ? { crewbox: createSdkMcpServer({ name: 'crewbox', version: '0.2.0', tools, alwaysLoad: true }) } : {},
    settingSources: [],
    canUseTool: async () => ({ behavior: 'allow' }), // approvals are enforced inside each Crewbox tool
    model,
    env: sdkEnv(connection),
    cwd,
    maxTurns,
    includePartialMessages: !!onDelta,
    abortController,
    ...(resume ? { resume } : {}),
  };

  const out = { output: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null, sessionId: null, error: null, steps: 0 };
  try {
    for await (const m of query({ prompt, options })) {
      if (m.type === 'system' && m.subtype === 'init') { out.sessionId = m.session_id; onInit?.(m.session_id); continue; }
      if (m.parent_tool_use_id) continue;
      if (m.type === 'stream_event') {
        const e = m.event;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') onDelta?.(e.delta.text);
        continue;
      }
      if (m.type === 'assistant') {
        if (m.error) throw new Error(`Claude: ${m.error}${m.error === 'authentication_failed' ? ' — check the subscription token (claude setup-token)' : ''}`);
        const content = (m.message?.content || []).map((b) => (b.type === 'tool_use' ? { ...b, name: realName(b.name) } : b));
        onAssistant?.({ id: m.message.id, content });
        continue;
      }
      if (m.type === 'user' && Array.isArray(m.message?.content)) {
        const results = m.message.content.filter((b) => b.type === 'tool_result');
        if (results.length) onToolResults?.(results);
        continue;
      }
      if (m.type === 'result') {
        out.steps = m.num_turns || 0;
        const u = m.usage || {};
        const cacheRead = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0;
        out.usage = { input: (u.input_tokens || 0) + cacheRead + cacheWrite, output: u.output_tokens || 0, cacheRead, cacheWrite };
        out.costUsd = m.total_cost_usd ?? null;
        if (m.subtype === 'success') out.output = m.result || '';
        else out.error = m.subtype === 'error_max_turns' ? `Stopped after ${maxTurns} steps without finishing.` : (m.errors || []).join('; ') || m.subtype;
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return out;
}

/** A plain single answer (no tools) — used by the memory review, the builder and connection tests. */
export async function sdkChat(connection, { model, system, messages }) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const prompt = typeof last?.content === 'string' ? last.content : (last?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const r = await runClaudeCode({ connection, model, system, prompt, maxTurns: 1 });
  if (r.error) throw new Error(r.error);
  return { content: [{ type: 'text', text: r.output }], stopReason: 'end_turn', usage: r.usage, model };
}
