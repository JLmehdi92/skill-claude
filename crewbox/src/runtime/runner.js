import { q, insert, update } from '../db.js';
import { uid, now, json, ToolError, truncate } from '../util.js';
import { agentConfig, listAgents } from '../agents.js';
import { resolveRunsOn, chat, costUsd } from '../providers/index.js';
import { agentMcpTools, callMcpTool } from '../mcp.js';
import { setSecret } from '../secrets.js';
import { attachConnector, findApp } from '../catalog.js';
import { notify } from '../notifications.js';
import { emit } from '../bus.js';
import { builtinTools, validateInput, resultText } from './tools.js';
import { buildSystemPrompt, subSystemPrompt } from './prompt.js';
import { reviewMemories } from './review.js';
import { runClaudeCode } from './claude-code.js';
import { paths } from '../config.js';

const MAX_STEPS = 60;
const controllers = new Map(); // runId -> AbortController
const sessionQueues = new Map(); // sessionId -> Promise (one run at a time per session)
const runDone = new Map(); // runId -> Promise of the finished run
const waiters = new Map(); // pauseId -> { resolve, reject } for runs that wait in-process (subscription engine)
const pauseChains = new Map(); // runId -> Promise, so one run shows one card at a time

/* ---------- sessions ---------- */

export function createSession(agentId, { kind = 'chat', title = null } = {}) {
  const id = uid('ses_');
  insert('sessions', { id, agent_id: agentId, title, kind, messages: [], state: null, allowed_tools: [], created_at: now(), updated_at: now() });
  return id;
}

const loadSession = (id) => {
  const s = q.get('SELECT * FROM sessions WHERE id = ?', id);
  if (!s) throw new Error(`Session not found: ${id}`);
  return { ...s, messages: json(s.messages, []), state: json(s.state, null), allowed_tools: json(s.allowed_tools, []) };
};

function saveMessages(sessionId, messages, extra = {}) {
  update('sessions', { id: sessionId }, { messages, updated_at: now(), ...extra });
}

/* ---------- starting runs ---------- */

/**
 * Start a run in the background. Returns immediately with ids and a `done` promise.
 * input === null means "continue" (used after a pause is answered).
 */
export function startRun({ agentId, input, sessionId, trigger = 'chat', sessionKind, sessionTitle, connectionId, model, depth = 0 }) {
  const agent = agentConfig(agentId);
  if (!agent.enabled) throw new Error(`@${agent.handle} is switched off.`);
  const sid = sessionId || createSession(agent.id, { kind: sessionKind || trigger.split(':')[0], title: sessionTitle || (typeof input === 'string' ? input.slice(0, 80) : null) });
  const runId = uid('run_');
  insert('runs', { id: runId, agent_id: agent.id, session_id: sid, status: 'running', trigger, steps: 0, started_at: now() });
  emit('run', { id: runId, agentId: agent.id, sessionId: sid, status: 'running' });
  emit('agents', { id: agent.id });
  const prev = sessionQueues.get(sid) || Promise.resolve();
  const done = prev.catch(() => {}).then(() => executeRun({ runId, agentId: agent.id, sessionId: sid, input, trigger, connectionId, model, depth }));
  sessionQueues.set(sid, done);
  runDone.set(runId, done);
  done.finally(() => { if (sessionQueues.get(sid) === done) sessionQueues.delete(sid); runDone.delete(runId); pauseChains.delete(runId); });
  return { runId, sessionId: sid, done };
}

export function cancelRun(runId) {
  const r = q.get('SELECT * FROM runs WHERE id = ?', runId);
  if (!r) throw new Error('Run not found');
  controllers.get(runId)?.abort();
  if (r.status === 'waiting') {
    const p = q.get("SELECT id FROM pauses WHERE run_id = ? AND status = 'pending'", runId);
    if (p) closePauseWith(p.id, { cancelled: true });
    finishRun(runId, { status: 'cancelled' });
  }
  return { cancelled: runId };
}

/* ---------- the loop ---------- */

async function executeRun({ runId, agentId, sessionId, input, trigger, connectionId, model, depth }) {
  const ctl = new AbortController();
  controllers.set(runId, ctl);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let steps = 0, provider = null, runModel = null;
  try {
    const agent = agentConfig(agentId);
    const runsOn = connectionId || model ? resolveRunsOn({ connectionId, model }) : resolveRunsOn({ connectionId: agent.connection_id, model: agent.model });
    if (!runsOn.connection) throw new Error('No AI provider is configured. Add one under AI providers (an API key, a local model, or the offline demo).');
    provider = runsOn.provider; runModel = runsOn.model;
    update('runs', { id: runId }, { provider, model: runModel });

    const session = loadSession(sessionId);
    const messages = session.messages;
    if (input != null) {
      messages.push({ role: 'user', content: closeDanglingToolUses(messages, input) });
      saveMessages(sessionId, messages);
      emit('message', { sessionId, agentId, message: messages.at(-1) });
    }

    const rt = runtimeHooks(agent, runsOn, usage);
    const { defs, handlers } = builtinTools(agent, rt);
    const mcp = await agentMcpTools(agent.id);
    const tools = [...defs, ...mcp.tools];
    const system = buildSystemPrompt(agent, { trigger, mcpErrors: mcp.errors, depth });

    if (provider === 'claude-subscription') {
      const r = await executeClaudeCode({ runId, agent, runsOn, sessionId, input, system, defs, handlers, mcp, ctl, trigger, depth });
      if (r.error) throw new Error(r.error);
      Object.assign(usage, r.usage);
      const out = finishRun(runId, { status: 'done', output: r.output, usage, provider, model: runModel, steps: r.steps });
      afterRun(agent, sessionId, trigger, runsOn);
      return out;
    }

    for (;;) {
      if (ctl.signal.aborted) throw new CancelledError();
      if (steps >= MAX_STEPS) throw new Error(`Stopped after ${MAX_STEPS} steps without finishing.`);
      const resp = await chat(runsOn.connection, {
        model: runModel, system, messages: messages.map(({ role, content }) => ({ role, content })), tools, signal: ctl.signal,
        onText: (text) => emit('delta', { runId, sessionId, agentId, text }),
      });
      steps++;
      addUsage(usage, resp.usage);
      messages.push({ role: 'assistant', content: resp.content });
      saveMessages(sessionId, messages);
      update('runs', { id: runId }, { steps, input_tokens: usage.input, output_tokens: usage.output });
      emit('message', { sessionId, agentId, runId, message: messages.at(-1) });

      const uses = resp.content.filter((b) => b.type === 'tool_use');
      if (resp.stopReason === 'refusal') {
        return finishRun(runId, { status: 'done', output: lastText(resp.content) || 'The model declined this request.', usage, provider, model: runModel, steps });
      }
      if (!uses.length) {
        const out = finishRun(runId, { status: 'done', output: lastText(resp.content), usage, provider, model: runModel, steps });
        afterRun(agent, sessionId, trigger, runsOn);
        return out;
      }
      if (resp.stopReason === 'max_tokens') throw new Error('A tool call was cut off by the output limit.');

      const ctx = { agent, runId, sessionId, step: steps, depth, signal: ctl.signal, trigger };
      const outcome = await handleToolUses(uses, { handlers, routes: mcp.routes, agent, session: loadSession(sessionId), ctx });
      if (outcome.pause) {
        saveMessages(sessionId, messages, { state: { pending: { pauseId: outcome.pause.id, results: outcome.results, items: outcome.pause.items } } });
        return finishRun(runId, { status: 'waiting', output: lastText(resp.content) || outcome.pause.summary, usage, provider, model: runModel, steps });
      }
      messages.push({ role: 'user', content: outcome.results });
      saveMessages(sessionId, messages);
      emit('message', { sessionId, agentId, runId, message: messages.at(-1) });
    }
  } catch (err) {
    if (err instanceof CancelledError || ctl.signal.aborted) {
      repairTranscript(sessionId, 'Cancelled by the user.');
      return finishRun(runId, { status: 'cancelled', usage, provider, model: runModel, steps });
    }
    repairTranscript(sessionId, `Run failed: ${err.message}`);
    const r = finishRun(runId, { status: 'error', error: err.message, usage, provider, model: runModel, steps });
    if (trigger !== 'chat') notify({ agentId, runId, kind: 'error', title: `${agentConfig(agentId).name}: ${trigger} failed`, body: err.message });
    return r;
  } finally {
    controllers.delete(runId);
  }
}

class CancelledError extends Error {}

function addUsage(u, x) {
  u.input += x.input || 0; u.output += x.output || 0; u.cacheRead += x.cacheRead || 0; u.cacheWrite += x.cacheWrite || 0;
}

const lastText = (content) => (Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() : String(content || ''));

function finishRun(runId, { status, output = null, error = null, usage, provider, model, steps }) {
  const patch = { status, finished_at: status === 'running' ? null : now() };
  if (output != null) patch.output = output;
  if (error != null) patch.error = error;
  if (usage) {
    patch.input_tokens = usage.input; patch.output_tokens = usage.output;
    patch.cost_usd = provider ? costUsd(provider, model, usage) : null;
  }
  if (steps != null) patch.steps = steps;
  update('runs', { id: runId }, patch);
  const run = q.get('SELECT * FROM runs WHERE id = ?', runId);
  emit('run', { id: runId, agentId: run.agent_id, sessionId: run.session_id, status });
  emit('agents', { id: run.agent_id });
  return run;
}

/** If the transcript ends with unanswered tool_use blocks, answer them so the next turn is valid. */
function closeDanglingToolUses(messages, input) {
  const last = messages.at(-1);
  const dangling = last?.role === 'assistant' && Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_use') : [];
  if (!dangling.length) return input;
  return [
    ...dangling.map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: 'Not run: the user sent a new message instead.', is_error: true })),
    { type: 'text', text: typeof input === 'string' ? input : JSON.stringify(input) },
  ];
}

function repairTranscript(sessionId, note) {
  const s = loadSession(sessionId);
  const last = s.messages.at(-1);
  if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use') && !s.state?.pending) {
    s.messages.push({ role: 'user', content: last.content.filter((b) => b.type === 'tool_use').map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: note, is_error: true })) });
    saveMessages(sessionId, s.messages);
  }
}

/* ---------- tools ---------- */

function isAllowed(agentId, session, tool) {
  return session.allowed_tools.includes(tool) || !!q.get("SELECT 1 FROM permissions WHERE agent_id = ? AND tool = ? AND decision = 'always'", agentId, tool);
}

async function handleToolUses(uses, { handlers, routes, agent, session, ctx }) {
  const results = [];
  const pauseItems = [];
  const runnable = [];
  for (const tu of uses) {
    const h = handlers.get(tu.name);
    const route = routes.get(tu.name);
    if (!h && !route) { results.push(errorResult(tu, `Unknown tool ${tu.name}.`)); continue; }
    if (h?.pause) {
      try { h.validate?.(tu.input || {}); } catch (e) { results.push(errorResult(tu, e.message)); continue; }
      pauseItems.push({ toolUseId: tu.id, tool: tu.name, kind: h.pause, input: tu.input || {} });
      continue;
    }
    const needsGate = h ? h.gate?.(tu.input) : agent.approvals.appWrites && !route.readOnly;
    if (needsGate && !isAllowed(agent.id, session, tu.name)) {
      pauseItems.push({ toolUseId: tu.id, tool: tu.name, kind: 'gate', input: tu.input || {}, app: route ? route.row.name : null });
      continue;
    }
    runnable.push(tu);
  }
  const ran = await Promise.all(runnable.map((tu) => runOne(tu, { handlers, routes, agent, ctx })));
  results.push(...ran);
  // Keep tool_result order aligned with tool_use order.
  const order = new Map(uses.map((u, i) => [u.id, i]));
  results.sort((a, b) => order.get(a.tool_use_id) - order.get(b.tool_use_id));
  if (!pauseItems.length) return { results };
  return { results, pause: createPause(agent, ctx, pauseItems) };
}

const errorResult = (tu, message) => ({ type: 'tool_result', tool_use_id: tu.id, content: message, is_error: true });

async function runOne(tu, { handlers, routes, agent, ctx }) {
  const started = Date.now();
  const h = handlers.get(tu.name);
  let content, isError = false;
  try {
    if (h) {
      const bad = validateInput(h.schema, tu.input);
      if (bad) throw new ToolError(bad);
      const out = await h.run(tu.input || {}, ctx);
      content = out && typeof out === 'object' && out.blocks ? out.blocks : resultText(out, agent.id);
    } else {
      const r = await callMcpTool(routes.get(tu.name), tu.input);
      content = resultText(r.text, agent.id);
      isError = r.isError;
    }
  } catch (e) {
    content = resultText(e.message, agent.id);
    isError = true;
  }
  if (typeof content === 'string') content = truncate(content, 120_000);
  q.run('INSERT INTO tool_calls(run_id, step, tool, input, result, is_error, duration_ms, created_at) VALUES(?,?,?,?,?,?,?,?)',
    ctx.runId, ctx.step, tu.name, JSON.stringify(tu.input ?? {}), typeof content === 'string' ? content : '[image]', isError ? 1 : 0, Date.now() - started, now());
  emit('tool', { runId: ctx.runId, agentId: agent.id, tool: tu.name, isError });
  return { type: 'tool_result', tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) };
}

/* ---------- subscription engine (Claude Code) ---------- */

function flattenTranscript(messages, max = 24) {
  return messages.slice(-max).map((m) => {
    const t = typeof m.content === 'string' ? m.content
      : m.content.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? `[used ${b.name}]` : '')).filter(Boolean).join(' ');
    return `${m.role}: ${t.slice(0, 1500)}`;
  }).join('\n');
}

async function executeClaudeCode({ runId, agent, runsOn, sessionId, input, system, defs, handlers, mcp, ctl, trigger, depth }) {
  const ses = loadSession(sessionId);
  let prompt = typeof input === 'string' ? input : input == null ? 'Continue.' : JSON.stringify(input);
  // A conversation that started on another engine: give Claude Code the gist of it once.
  if (!ses.engine_session && ses.messages.length > 1) prompt = `Earlier in this conversation:\n${flattenTranscript(ses.messages.slice(0, -1))}\n\nNow:\n${prompt}`;
  const ctx = { agent, runId, sessionId, step: 0, depth, signal: ctl.signal, trigger };
  const wrap = (d) => ({ name: d.name, description: d.description, schema: d.input_schema, run: (inp) => sdkTool({ name: d.name, input: inp }, { handlers, routes: mcp.routes, agent, ctx }) });
  const append = (fn) => {
    const s = loadSession(sessionId);
    fn(s.messages);
    saveMessages(sessionId, s.messages);
    emit('message', { sessionId, agentId: agent.id, runId, message: s.messages.at(-1) });
  };
  return runClaudeCode({
    connection: runsOn.connection, model: runsOn.model, system, prompt, resume: ses.engine_session || undefined,
    toolset: [...defs, ...mcp.tools].map(wrap), cwd: paths.agentWorkspace(agent.id), signal: ctl.signal, maxTurns: MAX_STEPS,
    onInit: (sid) => update('sessions', { id: sessionId }, { engine_session: sid }),
    onDelta: (text) => emit('delta', { runId, sessionId, agentId: agent.id, text }),
    onAssistant: ({ id, content }) => append((msgs) => {
      const last = msgs.at(-1);
      if (last?.role === 'assistant' && last._id === id) last.content.push(...content);
      else {
        msgs.push({ role: 'assistant', _id: id, content: [...content] });
        ctx.step++;
        update('runs', { id: runId }, { steps: ctx.step });
      }
    }),
    onToolResults: (results) => append((msgs) => msgs.push({ role: 'user', content: results })),
  });
}

/** One tool call from the subscription engine: same approvals and cards as the API engine. */
async function sdkTool(tu, { handlers, routes, agent, ctx }) {
  const h = handlers.get(tu.name);
  const route = routes.get(tu.name);
  if (!h && !route) return { content: `Unknown tool ${tu.name}.`, isError: true };
  const session = loadSession(ctx.sessionId);
  if (h?.pause) {
    try { h.validate?.(tu.input || {}); } catch (e) { return { content: e.message, isError: true }; }
    const item = { toolUseId: uid('sdk_'), tool: tu.name, kind: h.pause, input: tu.input || {} };
    const answers = await awaitAnswer(agent, ctx, item);
    const a = answers.freeText != null ? { freeText: answers.freeText } : answers[item.toolUseId] || {};
    const res = await resolveItem(item, a, agent, session, ctx, () => null);
    return { content: res.content, isError: !!res.is_error };
  }
  const needsGate = h ? h.gate?.(tu.input) : agent.approvals.appWrites && !route.readOnly;
  if (needsGate && !isAllowed(agent.id, session, tu.name)) {
    const item = { toolUseId: uid('sdk_'), tool: tu.name, kind: 'gate', input: tu.input || {}, app: route ? route.row.name : null };
    const answers = await awaitAnswer(agent, ctx, item);
    if (answers.freeText != null) return { content: `The user did not approve ${tu.name} and wrote instead: ${answers.freeText}`, isError: true };
    const d = answers[item.toolUseId]?.decision || 'deny';
    if (d === 'deny') return { content: `The user denied ${tu.name}. Do not retry it; continue without it or ask what to do instead.`, isError: true };
    if (d === 'session') { const s = loadSession(ctx.sessionId); s.allowed_tools.push(tu.name); update('sessions', { id: s.id }, { allowed_tools: s.allowed_tools }); }
    if (d === 'always') q.run("INSERT OR REPLACE INTO permissions(agent_id, tool, decision) VALUES(?, ?, 'always')", agent.id, tu.name);
  }
  const r = await runOne({ id: uid('call_'), name: tu.name, input: tu.input }, { handlers, routes, agent, ctx });
  return { content: r.content, isError: !!r.is_error };
}

/** Show a card and wait (in-process) for the answer. Cards of one run are shown one at a time. */
function awaitAnswer(agent, ctx, item) {
  const prev = pauseChains.get(ctx.runId) || Promise.resolve();
  const p = prev.then(async () => {
    if (ctx.signal.aborted) throw new CancelledError();
    const pause = createPause(agent, ctx, [item]);
    update('sessions', { id: ctx.sessionId }, { state: { pending: { pauseId: pause.id, engine: 'sdk', results: [], items: [item] } } });
    update('runs', { id: ctx.runId }, { status: 'waiting', output: pause.summary });
    emit('run', { id: ctx.runId, agentId: agent.id, sessionId: ctx.sessionId, status: 'waiting' });
    emit('agents', { id: agent.id });
    try {
      return await new Promise((resolve, reject) => {
        waiters.set(pause.id, { resolve, reject });
        ctx.signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
      });
    } finally {
      waiters.delete(pause.id);
      if (!ctx.signal.aborted) {
        update('runs', { id: ctx.runId }, { status: 'running' });
        emit('run', { id: ctx.runId, agentId: agent.id, sessionId: ctx.sessionId, status: 'running' });
      }
    }
  });
  pauseChains.set(ctx.runId, p.catch(() => {}));
  return p;
}

/* ---------- pauses (human in the loop) ---------- */

const PAUSE_TITLES = { question: 'has a question', approval: 'needs your approval', connector: 'needs an app connected', secret: 'needs a credential', gate: 'needs your approval' };

function createPause(agent, ctx, items) {
  // One card per turn: everything the coworker needs is batched together.
  const kinds = new Set(items.map((i) => (i.kind === 'gate' ? 'approval' : i.kind)));
  const kind = kinds.size === 1 ? [...kinds][0] : 'question';
  for (const it of items) {
    if (it.kind === 'connector') {
      const app = findApp(it.input.slug);
      it.app = { slug: app.slug, name: app.name, description: app.description, secrets: app.secrets };
    }
  }
  const id = uid('pse_');
  insert('pauses', { id, agent_id: agent.id, session_id: ctx.sessionId, run_id: ctx.runId, kind, payload: { items }, status: 'pending', created_at: now() });
  const summary = `${agent.name} ${PAUSE_TITLES[items[0].kind]}.`;
  notify({ agentId: agent.id, runId: ctx.runId, pauseId: id, kind: kind === 'secret' ? 'secret' : kind, title: summary, body: describeItems(items) });
  emit('pause', { id, agentId: agent.id, sessionId: ctx.sessionId });
  return { id, items, summary };
}

function describeItems(items) {
  return items.map((it) => {
    if (it.kind === 'question') return (it.input.questions || []).map((x) => x.question).join(' / ');
    if (it.kind === 'approval') return (it.input.actions || []).map((a) => a.title).join(' / ');
    if (it.kind === 'gate') return `Run ${it.tool}`;
    if (it.kind === 'connector') return `Connect ${it.app?.name || it.input.slug}`;
    if (it.kind === 'secret') return `Provide ${it.input.label || it.input.name}`;
    return it.kind;
  }).join('\n');
}

export function listPauses({ agentId, status = 'pending' } = {}) {
  const rows = agentId ? q.all('SELECT * FROM pauses WHERE agent_id = ? AND status = ? ORDER BY created_at DESC', agentId, status) : q.all('SELECT * FROM pauses WHERE status = ? ORDER BY created_at DESC', status);
  return rows.map((p) => ({ ...p, payload: json(p.payload, {}), answer: json(p.answer, null) }));
}

/**
 * Answer a pause card and resume the coworker.
 * answers: { [toolUseId]: ... } per item, or { freeText } when the user typed something else instead.
 *   question → { answers: [string | string[]] }     approval → { decisions: ['approve'|'decline'] }
 *   gate     → { decision: 'once'|'session'|'always'|'deny' }
 *   secret   → { value } (never shown to the model)   connector → { values: {VAR: value} } or { skip: true }
 */
export async function answerPause(pauseId, answers = {}) {
  const p = q.get('SELECT * FROM pauses WHERE id = ?', pauseId);
  if (!p) throw new Error('Pause not found');
  if (p.status !== 'pending') throw new Error('This card was already answered.');
  const agent = agentConfig(p.agent_id);
  const session = loadSession(p.session_id);
  const pending = session.state?.pending;
  if (!pending || pending.pauseId !== pauseId) throw new Error('This card no longer matches its conversation.');

  const ctx = { agent, runId: p.run_id, sessionId: p.session_id, step: 0, depth: 0, signal: new AbortController().signal, trigger: 'resume' };
  const run = q.get('SELECT trigger FROM runs WHERE id = ?', p.run_id);

  if (pending.engine === 'sdk') {
    update('pauses', { id: pauseId }, { status: 'answered', answer: redactAnswer(answers), answered_at: now() });
    q.run('UPDATE notifications SET read = 1 WHERE pause_id = ?', pauseId);
    update('sessions', { id: p.session_id }, { state: null });
    emit('pause', { id: pauseId, answered: true, agentId: agent.id });
    const w = waiters.get(pauseId);
    if (w) { w.resolve(answers); return { runId: p.run_id, sessionId: p.session_id, done: runDone.get(p.run_id) || Promise.resolve() }; }
    // The app restarted while the card was open: close the old run and carry the answer into a new one.
    const notes = [];
    for (const it of pending.items) {
      const a = answers.freeText != null ? { freeText: answers.freeText } : answers[it.toolUseId] || {};
      if (it.kind === 'gate') notes.push(`${it.tool}: ${a.freeText ?? a.decision ?? 'deny'} (not run yet)`);
      else notes.push((await resolveItem(it, a, agent, session, ctx, () => null)).content);
    }
    finishRun(p.run_id, { status: 'done', output: 'Answered after a restart; continued in a new run.' });
    return startRun({ agentId: agent.id, sessionId: p.session_id, input: `Your earlier card was answered while the app was restarting:\n${notes.join('\n')}`, trigger: run?.trigger || 'chat' });
  }
  const newResults = [];
  let rt = null;
  for (const it of pending.items) {
    const a = answers.freeText != null ? { freeText: answers.freeText } : answers[it.toolUseId] || {};
    newResults.push(await resolveItem(it, a, agent, session, ctx, () => (rt ||= toolkit(agent))));
  }
  const order = new Map();
  const assistant = [...session.messages].reverse().find((m) => m.role === 'assistant');
  (assistant?.content || []).filter((b) => b.type === 'tool_use').forEach((b, i) => order.set(b.id, i));
  const results = [...pending.results, ...newResults].sort((x, y) => (order.get(x.tool_use_id) ?? 0) - (order.get(y.tool_use_id) ?? 0));

  update('pauses', { id: pauseId }, { status: 'answered', answer: redactAnswer(answers), answered_at: now() });
  q.run('UPDATE notifications SET read = 1 WHERE pause_id = ?', pauseId);
  session.messages.push({ role: 'user', content: results });
  saveMessages(p.session_id, session.messages, { state: null });
  emit('message', { sessionId: p.session_id, agentId: agent.id, message: session.messages.at(-1) });
  emit('pause', { id: pauseId, answered: true, agentId: agent.id });
  if (answers.freeText != null && answers.continue === false) return { resumed: false };
  return startRun({ agentId: agent.id, sessionId: p.session_id, input: null, trigger: run?.trigger || 'chat' });
}

function redactAnswer(answers) {
  const copy = JSON.parse(JSON.stringify(answers));
  for (const v of Object.values(copy)) {
    if (v && typeof v === 'object') {
      if ('value' in v) v.value = '[secret]';
      if (v.values) for (const k of Object.keys(v.values)) v.values[k] = '[secret]';
    }
  }
  return copy;
}

function toolkit(agent) {
  return { tools: builtinTools(agent, runtimeHooks(agent, resolveRunsOn({ connectionId: agent.connection_id, model: agent.model }), { input: 0, output: 0 })), mcp: null };
}

async function resolveItem(it, a, agent, session, ctx, getKit) {
  const result = (content, isError = false) => ({ type: 'tool_result', tool_use_id: it.toolUseId, content, ...(isError ? { is_error: true } : {}) });
  if (a.cancelled) return result('The user cancelled the run.', true);
  if (a.freeText != null && it.kind !== 'question') {
    return result(`The user did not use the card and wrote instead: ${a.freeText}${it.kind === 'gate' || it.kind === 'approval' ? '\n(Treat this as not approved unless they clearly said yes.)' : ''}`, it.kind === 'gate');
  }
  switch (it.kind) {
    case 'question': {
      if (a.freeText != null) return result(`The user answered in their own words: ${a.freeText}`);
      const qs = it.input.questions || [];
      return result(qs.map((x, i) => `Q: ${x.question}\nA: ${[].concat(a.answers?.[i] ?? '(skipped)').join(', ')}`).join('\n\n'));
    }
    case 'approval': {
      const acts = it.input.actions || [];
      return result(acts.map((x, i) => `${x.title}: ${a.decisions?.[i] === 'approve' ? 'APPROVED' : 'DECLINED'}`).join('\n'));
    }
    case 'gate': {
      const d = a.decision || 'deny';
      if (d === 'deny') return result(`The user denied ${it.tool}. Do not retry it; continue without it or ask what to do instead.`, true);
      if (d === 'session') { session.allowed_tools.push(it.tool); update('sessions', { id: session.id }, { allowed_tools: session.allowed_tools }); }
      if (d === 'always') q.run("INSERT OR REPLACE INTO permissions(agent_id, tool, decision) VALUES(?, ?, 'always')", agent.id, it.tool);
      const kit = getKit();
      if (kit.tools.handlers.has(it.tool)) return runOne({ id: it.toolUseId, name: it.tool, input: it.input }, { handlers: kit.tools.handlers, routes: new Map(), agent, ctx });
      kit.mcp ||= await agentMcpTools(agent.id);
      return runOne({ id: it.toolUseId, name: it.tool, input: it.input }, { handlers: new Map(), routes: kit.mcp.routes, agent, ctx });
    }
    case 'secret': {
      if (!a.value) return result(`The user did not provide ${it.input.name}.`, true);
      setSecret(agent.id, it.input.name, a.value);
      return result(`${it.input.name} is saved on this machine. Reference it as \${${it.input.name}} in an MCP config, or $${it.input.name} in a shell command. You will never see its value.`);
    }
    case 'connector': {
      if (a.skip) return result(`The user skipped connecting ${it.input.slug}.`, true);
      for (const [k, v] of Object.entries(a.values || {})) if (v) setSecret(agent.id, k, v);
      const st = attachConnector(agent.id, it.input.slug);
      return result(st.status === 'active'
        ? `${st.name} is connected. Its tools (mcp__${it.input.slug.replace(/-/g, '_')}__*) are available from your next step.`
        : `${st.name} is installed but still needs: ${st.missingSecrets.join(', ')}.`, st.status !== 'active');
    }
    default: return result('Unsupported card.', true);
  }
}

function closePauseWith(pauseId, answers) {
  const p = q.get('SELECT * FROM pauses WHERE id = ?', pauseId);
  const session = loadSession(p.session_id);
  const pending = session.state?.pending;
  update('pauses', { id: pauseId }, { status: 'answered', answer: answers, answered_at: now() });
  q.run('UPDATE notifications SET read = 1 WHERE pause_id = ?', pauseId);
  if (pending?.pauseId === pauseId && pending.engine === 'sdk') update('sessions', { id: p.session_id }, { state: null });
  else if (pending?.pauseId === pauseId) {
    const results = [...pending.results, ...pending.items.map((it) => ({ type: 'tool_result', tool_use_id: it.toolUseId, content: 'Cancelled by the user.', is_error: true }))];
    session.messages.push({ role: 'user', content: results });
    saveMessages(p.session_id, session.messages, { state: null });
  }
}

/* ---------- sending messages ---------- */

/** A chat message. If the session waits on a card, the message answers it ("type something else"). */
export async function sendMessage({ agentId, message, sessionId, trigger = 'chat' }) {
  if (sessionId) {
    const s = loadSession(sessionId);
    if (s.agent_id !== agentConfig(agentId).id) throw new Error('This session belongs to another coworker.');
    const pending = s.state?.pending;
    if (pending) return answerPause(pending.pauseId, { freeText: message });
  }
  return startRun({ agentId, input: message, sessionId, trigger });
}

export async function waitForRun(handle, waitSeconds = 120) {
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r(null), Math.min(Math.max(waitSeconds, 1), 600) * 1000); });
  const res = await Promise.race([handle.done.then(() => true), timeout]);
  clearTimeout(timer);
  return res;
}

/* ---------- teamwork hooks ---------- */

function runtimeHooks(agent, runsOn, usage) {
  return {
    listCoworkers: (selfId) => listAgents().filter((a) => a.id !== selfId).map(({ handle, name, description, status, enabled }) => ({ handle, name, description, status, enabled })),

    callAgent: async (handle, message, ctx) => {
      const target = q.get('SELECT id, enabled, name FROM agents WHERE handle = ?', handle);
      if (!target) throw new ToolError(`No coworker @${handle}. Use list_coworkers.`);
      if (!target.enabled) throw new ToolError(`@${handle} is switched off and refuses calls.`);
      if (ctx.depth >= 3) throw new ToolError('Call chain too deep.');
      emit('beam', { from: agent.id, to: target.id, agentId: agent.id });
      const h = startRun({ agentId: target.id, input: `Message from @${agent.handle} (${agent.name}):\n\n${message}`, trigger: `agent:${agent.handle}`, sessionKind: 'agent', sessionTitle: `from @${agent.handle}`, depth: ctx.depth + 1 });
      const finished = await waitForRun(h, 600);
      const r = q.get('SELECT status, output, error FROM runs WHERE id = ?', h.runId);
      if (!finished) return `@${handle} is still working (run ${h.runId}). Check back later or carry on.`;
      if (r.status === 'waiting') return `@${handle} paused to ask the user something: ${r.output || ''}`;
      if (r.status !== 'done') return `@${handle} failed: ${r.error || r.status}`;
      return `@${handle} answered:\n${r.output || '(no text)'}`;
    },

    runSubtasks: async (tasks, ctx) => {
      if (runsOn.provider === 'claude-subscription') {
        const subAgent = { ...agent, tools: { ...agent.tools, askUser: false, requestApproval: false, suggestService: false, requestSecret: false, delegate: false, callAgent: false, schedule: false, trigger: false, skills: false, hub: false }, selfImprovement: { ...agent.selfImprovement, enabled: false } };
        return Promise.all(tasks.map(async (t) => {
          const { defs, handlers } = builtinTools(subAgent, runtimeHooks(subAgent, runsOn, usage));
          const toolset = defs.filter((d) => !handlers.get(d.name).gate?.({})).map((d) => ({
            name: d.name, description: d.description, schema: d.input_schema,
            run: async (inp) => { const r = await runOne({ id: uid('call_'), name: d.name, input: inp }, { handlers, routes: new Map(), agent: subAgent, ctx: { ...ctx, depth: ctx.depth + 1 } }); return { content: r.content, isError: !!r.is_error }; },
          }));
          const r = await runClaudeCode({ connection: runsOn.connection, model: runsOn.model, system: subSystemPrompt(agent, t.role), prompt: t.instruction, toolset, cwd: paths.agentWorkspace(agent.id), signal: ctx.signal, maxTurns: 25 });
          addUsage(usage, r.usage);
          return r.error ? `Failed: ${r.error}` : r.output || '(no answer)';
        }));
      }
      const subAgent = { ...agent, tools: { ...agent.tools, askUser: false, requestApproval: false, suggestService: false, requestSecret: false, delegate: false, callAgent: false, schedule: false, trigger: false, skills: false, hub: false }, selfImprovement: { ...agent.selfImprovement, enabled: false } };
      return Promise.all(tasks.map(async (t) => {
        const { defs, handlers } = builtinTools(subAgent, runtimeHooks(subAgent, runsOn, usage));
        const msgs = [{ role: 'user', content: t.instruction }];
        const system = subSystemPrompt(agent, t.role);
        for (let i = 0; i < 25; i++) {
          if (ctx.signal.aborted) return 'Cancelled.';
          const resp = await chat(runsOn.connection, { model: runsOn.model, system, messages: msgs, tools: defs, signal: ctx.signal, effort: 'medium' });
          addUsage(usage, resp.usage);
          msgs.push({ role: 'assistant', content: resp.content });
          const uses = resp.content.filter((b) => b.type === 'tool_use');
          if (!uses.length || resp.stopReason === 'refusal') return lastText(resp.content) || '(no answer)';
          const results = await Promise.all(uses.map((tu) => {
            const h = handlers.get(tu.name);
            if (!h || h.gate?.(tu.input)) return errorResult(tu, 'Not available to a sub-coworker.');
            return runOne(tu, { handlers, routes: new Map(), agent: subAgent, ctx: { ...ctx, depth: ctx.depth + 1 } });
          }));
          msgs.push({ role: 'user', content: results });
        }
        return 'The sub-coworker ran out of steps.';
      }));
    },
  };
}

/* ---------- after a run ---------- */

function afterRun(agent, sessionId, trigger, runsOn) {
  const si = agent.selfImprovement;
  if (trigger === 'chat' && si.enabled && si.autoMemory && runsOn.provider !== 'mock') {
    reviewMemories(agent, loadSession(sessionId).messages, runsOn).catch((e) => console.error(`memory review: ${e.message}`));
  }
  if (trigger.startsWith('schedule:') || trigger.startsWith('trigger:')) {
    const r = q.get("SELECT id, output FROM runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1", sessionId);
    notify({ agentId: agent.id, runId: r?.id, kind: 'done', title: `${agent.name} finished ${trigger}`, body: (r?.output || '').slice(0, 500) });
  }
}

/** Recover runs left "running" by a crash or restart. */
export function recoverRuns() {
  for (const r of q.all("SELECT id, session_id FROM runs WHERE status = 'running'")) {
    repairTranscript(r.session_id, 'Interrupted: the app restarted.');
    update('runs', { id: r.id }, { status: 'error', error: 'Interrupted: the app restarted.', finished_at: now() });
  }
}
