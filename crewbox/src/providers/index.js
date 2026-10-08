import Anthropic from '@anthropic-ai/sdk';
import { q, insert, getSetting, setSetting } from '../db.js';
import { getSecret, setSecret } from '../secrets.js';
import { uid, now, json } from '../util.js';
import { mockChat } from './mock.js';
import { openaiChat } from './openai.js';

// Every coworker runs on an AI connection: a provider + credentials + the models it serves.
// The canonical transcript format is the Anthropic Messages shape (content blocks), so Claude
// sessions replay their blocks unchanged; other providers get a converted copy.

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', needsKey: true, defaultBase: null },
  openai: { label: 'OpenAI', needsKey: true, defaultBase: 'https://api.openai.com/v1' },
  openrouter: { label: 'OpenRouter', needsKey: true, defaultBase: 'https://openrouter.ai/api/v1' },
  google: { label: 'Google Gemini (OpenAI-compatible)', needsKey: true, defaultBase: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  ollama: { label: 'Local model (Ollama / LM Studio / vLLM)', needsKey: false, defaultBase: 'http://127.0.0.1:11434/v1' },
  mock: { label: 'Offline demo (no AI)', needsKey: false, defaultBase: null },
};

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', power: 5, context: 1_000_000, in: 4, out: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', power: 4, context: 1_000_000, in: 2, out: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', power: 3, context: 1_000_000, in: 0.1, out: 0.5 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', power: 5, context: 1_000_000, in: 10, out: 50 },
];

const DEFAULT_MODELS = {
  anthropic: ANTHROPIC_MODELS.map((m) => m.id),
  openai: ['gpt-5', 'gpt-5-mini'],
  openrouter: ['anthropic/claude-sonnet-5.5', 'openai/gpt-5-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  ollama: ['llama3.1', 'qwen2.5'],
  mock: ['mock-1'],
};

export function priceFor(provider, model) {
  if (provider !== 'anthropic') return null;
  return ANTHROPIC_MODELS.find((m) => m.id === model) || null;
}

export function costUsd(provider, model, usage) {
  const p = priceFor(provider, model);
  if (!p) return provider === 'mock' || provider === 'ollama' ? 0 : null;
  const cached = usage.cacheRead || 0, written = usage.cacheWrite || 0;
  return ((usage.input - cached - written) * p.in + cached * p.in * 0.1 + written * p.in * 1.25 + usage.output * p.out) / 1e6;
}

/* ---------- connections ---------- */

const secretName = (id) => `AI_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

function view(c) {
  if (!c) return null;
  const def = getSetting('defaultModel');
  return {
    id: c.id, name: c.name, provider: c.provider, baseUrl: c.base_url, models: json(c.models, []),
    connected: !PROVIDERS[c.provider]?.needsKey || !!getSecret('workspace', c.secret_name),
    isDefault: def?.connectionId === c.id,
  };
}

export const listConnections = () => q.all('SELECT * FROM connections ORDER BY created_at').map(view);
export const getConnection = (id) => view(q.get('SELECT * FROM connections WHERE id = ?', id));

export function createConnection({ name, provider, baseUrl, apiKey, models }) {
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider "${provider}". One of: ${Object.keys(PROVIDERS).join(', ')}`);
  const id = uid('conn_');
  const sn = secretName(id);
  insert('connections', {
    id, name: name || PROVIDERS[provider].label, provider, base_url: baseUrl || PROVIDERS[provider].defaultBase,
    secret_name: sn, models: models?.length ? models : DEFAULT_MODELS[provider], created_at: now(),
  });
  if (apiKey) setSecret('workspace', sn, apiKey);
  if (!getSetting('defaultModel')) setSetting('defaultModel', { connectionId: id, model: (models?.[0]) || DEFAULT_MODELS[provider][0] });
  return getConnection(id);
}

export function updateConnection(id, { name, baseUrl, apiKey, models }) {
  const c = q.get('SELECT * FROM connections WHERE id = ?', id);
  if (!c) throw new Error('Connection not found');
  if (name !== undefined) q.run('UPDATE connections SET name = ? WHERE id = ?', name, id);
  if (baseUrl !== undefined) q.run('UPDATE connections SET base_url = ? WHERE id = ?', baseUrl, id);
  if (models !== undefined) q.run('UPDATE connections SET models = ? WHERE id = ?', JSON.stringify(models), id);
  if (apiKey) setSecret('workspace', c.secret_name, apiKey);
  return getConnection(id);
}

export function deleteConnection(id) {
  const c = q.get('SELECT * FROM connections WHERE id = ?', id);
  if (!c) return;
  q.run('DELETE FROM connections WHERE id = ?', id);
  q.run("DELETE FROM secrets WHERE scope = 'workspace' AND name = ?", c.secret_name);
  q.run('UPDATE agents SET connection_id = NULL, model = NULL WHERE connection_id = ?', id);
  if (getSetting('defaultModel')?.connectionId === id) {
    const next = q.get('SELECT * FROM connections ORDER BY created_at LIMIT 1');
    setSetting('defaultModel', next ? { connectionId: next.id, model: json(next.models, [])[0] } : null);
  }
}

export function setDefaultModel(connectionId, model) {
  const c = getConnection(connectionId);
  if (!c) throw new Error(`Unknown connection ${connectionId}. Available: ${listConnections().map((x) => x.id).join(', ') || 'none'}`);
  if (model && !c.models.includes(model)) throw new Error(`${c.name} does not serve ${model}. It serves: ${c.models.join(', ')}`);
  setSetting('defaultModel', { connectionId, model: model || c.models[0] });
  return getSetting('defaultModel');
}

/** Resolve what an agent (or a schedule/trigger override) runs on. */
export function resolveRunsOn({ connectionId, model } = {}) {
  const def = getSetting('defaultModel');
  const followsDefault = !connectionId && !model;
  const cid = connectionId || def?.connectionId;
  const c = cid && q.get('SELECT * FROM connections WHERE id = ?', cid);
  if (!c) return { connection: null, provider: null, model: null, followsDefault };
  const m = model || (connectionId && connectionId !== def?.connectionId ? json(c.models, [])[0] : def?.model) || json(c.models, [])[0];
  return { connection: c, connectionId: c.id, provider: c.provider, model: m, followsDefault };
}

/* ---------- chat ---------- */

const EFFORT_RE = /opus-4-[5-9]|opus-5|fable|mythos|sonnet-4-6|sonnet-5|haiku-5/;
const FALLBACK_RE = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

/**
 * One model turn.
 * @returns {Promise<{content: object[], stopReason: string, usage: {input:number, output:number, cacheRead?:number, cacheWrite?:number}, model: string}>}
 */
export async function chat(connection, { model, system, messages, tools, onText, signal, effort = 'high', maxTokens = 32000 }) {
  const apiKey = connection.secret_name ? getSecret('workspace', connection.secret_name) : null;
  switch (connection.provider) {
    case 'mock':
      return mockChat({ model, system, messages, tools, onText });
    case 'anthropic':
      if (!apiKey) throw new Error(`The connection "${connection.name}" has no API key. Add it under AI providers.`);
      return anthropicChat({ apiKey, baseURL: connection.base_url || undefined, model, system, messages, tools, onText, signal, effort, maxTokens });
    default:
      if (PROVIDERS[connection.provider]?.needsKey && !apiKey) throw new Error(`The connection "${connection.name}" has no API key. Add it under AI providers.`);
      return openaiChat({ baseUrl: connection.base_url, apiKey, provider: connection.provider, model, system, messages, tools, onText, signal, maxTokens });
  }
}

const clients = new Map();
function anthropicClient(apiKey, baseURL) {
  const k = `${baseURL || ''}|${apiKey}`;
  if (!clients.has(k)) clients.set(k, new Anthropic({ apiKey, baseURL }));
  return clients.get(k);
}

async function anthropicChat({ apiKey, baseURL, model, system, messages, tools, onText, signal, effort, maxTokens }) {
  const client = anthropicClient(apiKey, baseURL);
  const params = {
    model,
    max_tokens: maxTokens,
    // Stable prefix first (tools → system), so prompt caching can reuse it across steps.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    ...(tools?.length ? { tools: tools.map((t) => ({ ...t, eager_input_streaming: true })) } : {}),
    ...(EFFORT_RE.test(model) ? { output_config: { effort } } : {}),
  };
  const useFallback = FALLBACK_RE.test(model);
  let jsonRetries = 0;
  for (;;) {
    let msg;
    try {
      const stream = useFallback
        ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
        : client.messages.stream(params, { signal });
      if (onText) stream.on('text', onText);
      msg = await stream.finalMessage();
    } catch (err) {
      // A tool input that could not be parsed at all: re-issue the turn. API errors propagate.
      if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }
    const u = msg.usage || {};
    const cacheRead = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0;
    return {
      content: msg.content,
      stopReason: msg.stop_reason,
      model: msg.model || model,
      usage: { input: (u.input_tokens || 0) + cacheRead + cacheWrite, output: u.output_tokens || 0, cacheRead, cacheWrite },
    };
  }
}

export async function testConnection(id) {
  const c = q.get('SELECT * FROM connections WHERE id = ?', id);
  if (!c) throw new Error('Connection not found');
  const model = json(c.models, [])[0];
  const r = await chat(c, { model, system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'ping' }], tools: [], effort: 'low', maxTokens: 64 });
  return { ok: true, model: r.model, reply: r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').slice(0, 200) };
}
