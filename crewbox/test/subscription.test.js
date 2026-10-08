import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The subscription engine runs through the Claude Agent SDK (Claude Code). Point it at a fake
// Messages API and check what it sends and how runs, tools and cards behave.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crewbox-sub-'));
process.env.CREWBOX_HOME = HOME;
process.env.CLAUDE_CONFIG_DIR = path.join(HOME, 'claude-config');
delete process.env.ANTHROPIC_API_KEY;

const { boot } = await import('../src/cli.js');
const { callTool } = await import('../src/service.js');
const { q } = await import('../src/db.js');
const { stopScheduler } = await import('../src/automations.js');

const seen = [];
let fake, base;

function textOf(messages) {
  return messages.flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.map((b) => b.text || ''))).join('\n');
}

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/v1/messages')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
      const j = JSON.parse(body);
      seen.push({ headers: req.headers, body: j });
      const results = j.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []));
      const marker = /\/call (\w+) (\{.*?\})(?:\s|$)/.exec(textOf(j.messages));
      let blocks;
      if (marker && !results.length) blocks = [{ type: 'tool_use', id: 'toolu_s1', name: `mcp__crewbox__${marker[1]}`, input: JSON.parse(marker[2]) }];
      else {
        const r = results.at(-1);
        const txt = r ? (typeof r.content === 'string' ? r.content : r.content.map((c) => c.text).join(' ')) : 'hello from your plan';
        blocks = [{ type: 'text', text: `OK: ${txt}` }];
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
      ev({ type: 'message_start', message: { id: `msg_${seen.length}`, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 120, output_tokens: 1 } } });
      blocks.forEach((b, i) => {
        if (b.type === 'text') {
          ev({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
          ev({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } });
        } else {
          ev({ type: 'content_block_start', index: i, content_block: { ...b, input: {} } });
          ev({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
        }
        ev({ type: 'content_block_stop', index: i });
      });
      ev({ type: 'message_delta', delta: { stop_reason: blocks[0].type === 'tool_use' ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 30 } });
      ev({ type: 'message_stop' });
      res.end();
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${fake.address().port}`;
  boot();
});

after(() => {
  stopScheduler();
  fake.close();
  fs.rmSync(HOME, { recursive: true, force: true });
});

async function settle(runId, want = (s) => s !== 'running', ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = q.get('SELECT * FROM runs WHERE id = ?', runId);
    if (want(r.status)) return r;
    if (Date.now() - t0 > ms) throw new Error(`run ${runId} stuck in ${r.status}`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

let agent;

test('a coworker runs on the Claude subscription with Crewbox tools', async () => {
  const conn = await callTool('create_connection', { provider: 'claude-subscription', name: 'My Claude plan', apiKey: 'sk-ant-oat01-plan-token', baseUrl: base });
  assert.equal(conn.connected, true);
  agent = await callTool('create_agent', { name: 'Plan worker', connectionId: conn.id, model: 'claude-sonnet-5-5', selfImprovement: { autoMemory: false } });
  const { runId, sessionId } = await callTool('chat', { agentId: agent.agentId, message: 'note it /call files_write {"path":"plan.md","content":"from my plan"}' });
  const r = await settle(runId);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.provider, 'claude-subscription');
  assert.equal(r.cost_usd, 0, 'included in the plan');
  assert.match(r.output, /Wrote plan\.md/);
  assert.equal(fs.readFileSync(path.join(HOME, 'agents', agent.agentId, 'workspace', 'plan.md'), 'utf8'), 'from my plan');

  const req = seen[0];
  assert.equal(req.headers.authorization, 'Bearer sk-ant-oat01-plan-token');
  assert.equal(req.headers['x-api-key'], undefined);
  assert.match(req.headers['anthropic-beta'], /oauth-2025-04-20/);
  assert.equal(req.body.model, 'claude-sonnet-5-5');
  const names = req.body.tools.map((t) => t.name);
  assert.ok(names.includes('mcp__crewbox__files_write'));
  assert.ok(!names.includes('Bash') && !names.includes('Write'), 'Claude Code built-in tools are off');
  assert.ok(JSON.stringify(req.body.system).includes('Plan worker'), 'the coworker soul is the system prompt');

  const msgs = JSON.parse(q.get('SELECT messages FROM sessions WHERE id = ?', sessionId).messages);
  const use = msgs.find((m) => m.role === 'assistant' && m.content.some((b) => b.type === 'tool_use'));
  assert.equal(use.content.find((b) => b.type === 'tool_use').name, 'files_write', 'the transcript keeps Crewbox tool names');
  assert.ok(q.get('SELECT engine_session FROM sessions WHERE id = ?', sessionId).engine_session);
  assert.equal(q.get('SELECT tool FROM tool_calls WHERE run_id = ?', runId).tool, 'files_write');
});

test('a card pauses the subscription run in place and the answer resumes it', async () => {
  const { runId, sessionId } = await callTool('chat', { agentId: agent.agentId, message: 'ask me /call ask_user {"questions":[{"question":"Which client?","options":["acme","globex"]}]}' });
  await settle(runId, (s) => s === 'waiting');
  const p = (await callTool('list_pauses', { agentId: agent.agentId })).pauses[0];
  assert.equal(p.kind, 'question');
  const s = await callTool('get_session', { sessionId });
  assert.equal(s.pending.pauseId, p.id);
  const ans = await callTool('answer_pause', { pauseId: p.id, answers: { [p.payload.items[0].toolUseId]: { answers: ['globex'] } } });
  assert.equal(ans.runId, runId, 'the same run carries on');
  const r = await settle(runId);
  assert.equal(r.status, 'done', r.error);
  assert.match(r.output, /globex/);
});

test('approval gates hold app writes until the user decides', async () => {
  await callTool('update_agent', { agentId: agent.agentId, approvals: { shell: true } });
  const { runId } = await callTool('chat', { agentId: agent.agentId, message: 'run /call shell_run {"command":"echo gated-ok"}' });
  await settle(runId, (st) => st === 'waiting');
  const p = (await callTool('list_pauses', { agentId: agent.agentId })).pauses[0];
  assert.equal(p.payload.items[0].kind, 'gate');
  await callTool('answer_pause', { pauseId: p.id, answers: { [p.payload.items[0].toolUseId]: { decision: 'once' } } });
  const r = await settle(runId);
  assert.match(r.output, /gated-ok/);
});

test('the next message resumes the same Claude Code session', async () => {
  const before = seen.length;
  const s1 = (await callTool('list_sessions', { agentId: agent.agentId })).sessions.at(-1);
  const { runId } = await callTool('chat', { agentId: agent.agentId, sessionId: s1.id, message: 'and now?' });
  const r = await settle(runId);
  assert.equal(r.status, 'done', r.error);
  const sent = seen.slice(before)[0].body.messages;
  assert.ok(sent.length > 2, 'earlier turns are replayed from the resumed session');
});
