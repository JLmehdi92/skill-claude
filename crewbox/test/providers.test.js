import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crewbox-prov-'));
process.env.CREWBOX_HOME = HOME;
const { boot } = await import('../src/cli.js');
const { callTool } = await import('../src/service.js');
const { q } = await import('../src/db.js');
const { stopScheduler } = await import('../src/automations.js');
const { closeAll } = await import('../src/mcp.js');

const seen = [];
let fake, fakeUrl;

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

const anthropicTurn = (model, blocks, stop) => [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 400 } } },
  ...blocks.flatMap((b, i) => b.type === 'text'
    ? [{ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } }, { type: 'content_block_stop', index: i }]
    : [{ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }, { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }, { type: 'content_block_stop', index: i }]),
  { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 200 } },
  { type: 'message_stop' },
];

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      seen.push({ url: req.url, headers: req.headers, body: json });
      if (req.url.startsWith('/v1/messages')) {
        const hasResult = json.messages.at(-1).content?.some?.((b) => b.type === 'tool_result');
        return sse(res, hasResult
          ? anthropicTurn(json.model, [{ type: 'text', text: 'All done.' }], 'end_turn')
          : anthropicTurn(json.model, [{ type: 'text', text: 'Writing it.' }, { type: 'tool_use', id: 'toolu_1', name: 'files_write', input: { path: 'note.md', content: 'from claude' } }], 'tool_use'));
      }
      if (req.url === '/oai/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const hasTool = json.messages.some((m) => m.role === 'tool');
        const chunks = hasTool
          ? [{ choices: [{ index: 0, delta: { content: 'Local model done.' } }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]
          : [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'memory_save', arguments: '{"content":' } }] } }] },
            { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"likes tea"}' } }] } }] },
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }];
        for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  boot();
});

after(async () => {
  stopScheduler();
  await closeAll();
  fake.close();
  fs.rmSync(HOME, { recursive: true, force: true });
});

async function runDone(runId) {
  for (let i = 0; i < 500; i++) {
    const r = q.get('SELECT * FROM runs WHERE id = ?', runId);
    if (r.status !== 'running') return r;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('timeout');
}

test('Claude through the official SDK: tool loop, fallbacks, effort, caching, cost', async () => {
  const conn = await callTool('create_connection', { provider: 'anthropic', name: 'Claude', apiKey: 'sk-ant-test', baseUrl: fakeUrl });
  const a = await callTool('create_agent', { name: 'Claude worker', connectionId: conn.id, model: 'claude-opus-5-5' });
  const { runId } = await callTool('chat', { agentId: a.agentId, message: 'write a note' });
  const r = await runDone(runId);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.output, 'All done.');
  assert.equal(r.provider, 'anthropic');
  assert.equal(fs.readFileSync(path.join(HOME, 'agents', a.agentId, 'workspace', 'note.md'), 'utf8'), 'from claude');
  // (the autoMemory review that follows a chat is a separate request without tools)
  const req = seen.filter((s) => s.url.startsWith('/v1/messages') && s.body.tools);
  assert.equal(req.length, 2);
  const first = req[0];
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.match(first.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(first.body.output_config.effort, 'high');
  assert.equal(first.body.system[0].cache_control.type, 'ephemeral');
  assert.ok(first.body.tools.every((t) => t.eager_input_streaming === true));
  assert.equal(first.headers['x-api-key'], 'sk-ant-test');
  // the second request replays the assistant turn unchanged, then the tool_result
  assert.equal(req[1].body.messages[1].content[1].type, 'tool_use');
  assert.equal(req[1].body.messages[2].content[0].type, 'tool_result');
  // input_tokens excludes cache reads: 2 turns × (1000 uncached + 400 cached in, 200 out) at $4/$20 per MTok, cache reads at 10%
  const expected = 2 * ((1000 * 4 + 400 * 0.4 + 200 * 20) / 1e6);
  assert.equal(r.input_tokens, 2800);
  assert.ok(Math.abs(r.cost_usd - expected) < 1e-9, `${r.cost_usd} vs ${expected}`);
});

test('OpenAI-compatible local model: streamed tool calls are reassembled', async () => {
  const conn = await callTool('create_connection', { provider: 'ollama', name: 'Local', baseUrl: `${fakeUrl}/oai`, models: ['qwen2.5'] });
  const a = await callTool('create_agent', { name: 'Local worker', connectionId: conn.id, model: 'qwen2.5' });
  const { runId } = await callTool('chat', { agentId: a.agentId, message: 'remember I like tea' });
  const r = await runDone(runId);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.output, 'Local model done.');
  assert.equal((await callTool('list_memories', { agentId: a.agentId })).memories[0].content, 'likes tea');
  const second = seen.filter((s) => s.url === '/oai/chat/completions')[1].body;
  assert.equal(second.messages[0].role, 'system');
  assert.equal(second.messages.at(-1).role, 'tool');
  assert.equal(second.messages.at(-1).tool_call_id, 'call_1');
});

test('MCP apps: secrets resolve at connect time, write tools wait for approval', async () => {
  const mock = (await callTool('list_ai_connections')).connections.find((c) => c.provider === 'mock');
  const a = await callTool('create_agent', { name: 'App user', connectionId: mock.id });
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-server.js');
  const s = await callTool('upsert_mcp_server', { agentId: a.agentId, name: 'Fixture', transport: 'stdio', command: process.execPath, args: [server], env: { FIXTURE_TOKEN: '${FIXTURE_TOKEN}' } });
  assert.equal(s.status, 'needs_config');
  await callTool('set_secret', { agentId: a.agentId, name: 'FIXTURE_TOKEN', value: 'tok-123456' });
  assert.deepEqual((await callTool('probe_mcp_server', { agentId: a.agentId, slug: 'fixture' })).tools.map((t) => t.name), ['get_weather', 'send_email']);

  let { runId, sessionId } = await callTool('chat', { agentId: a.agentId, message: '/tool mcp__fixture__get_weather {"city": "Paris"}' });
  let r = await runDone(runId);
  assert.equal(r.status, 'done', r.error);
  assert.match(r.output, /Sunny in Paris \(token \[secret\]\)/, 'read-only tool ran at once, and the secret was redacted');

  ({ runId } = await callTool('chat', { agentId: a.agentId, sessionId, message: '/tool mcp__fixture__send_email {"to": "billing@acme.com"}' }));
  r = await runDone(runId);
  assert.equal(r.status, 'waiting');
  const p = (await callTool('list_pauses', { agentId: a.agentId })).pauses[0];
  assert.equal(p.payload.items[0].kind, 'gate');
  assert.equal(p.payload.items[0].app, 'Fixture');
  const res = await callTool('answer_pause', { pauseId: p.id, answers: { [p.payload.items[0].toolUseId]: { decision: 'session' } } });
  r = await runDone(res.runId);
  assert.match(r.output, /Email sent to billing@acme.com/);
  ({ runId } = await callTool('chat', { agentId: a.agentId, sessionId, message: '/tool mcp__fixture__send_email {"to": "ops@acme.com"}' }));
  assert.equal((await runDone(runId)).status, 'done', '"This session" allows it for the rest of the conversation');
  ({ runId } = await callTool('chat', { agentId: a.agentId, message: '/tool mcp__fixture__send_email {"to": "x@acme.com"}' }));
  assert.equal((await runDone(runId)).status, 'waiting', 'but a new conversation asks again');
});
