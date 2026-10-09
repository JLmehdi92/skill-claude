import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Onboarding end to end without an AI model: a company website on a local server, Foreman reads
// it into the Brain, plans a team from recipes, builds it; then the outreach coworker sends an
// email through the Resend API connector (a fake Resend), a Google app signs in through the
// owner's OAuth app (a fake token endpoint), and Autopilot stays out of the way without a model.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crewbox-foreman-'));
process.env.CREWBOX_HOME = HOME;
process.env.CREWBOX_PORT = '0';
process.env.CREWBOX_OFFLINE_ICONS = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

const SITE = {
  '/': `<!doctype html><html lang="fr"><head><title>Facturo | Relances de factures automatiques</title><meta name="description" content="Facturo relance vos factures impayées pour les agences et les freelances.">
    <script src="https://js.stripe.com/v3/"></script><script src="//js.hs-scripts.com/123.js"></script></head>
    <body><h1>Vos factures payées à temps</h1><h2>Pour les agences de 5 à 50 personnes</h2><a href="/tarifs">Tarifs</a> <a href="/a-propos">À propos</a> <a href="/mentions-legales">Mentions</a>
    <a href="https://www.linkedin.com/company/facturo">LinkedIn</a></body></html>`,
  '/tarifs': '<html><head><title>Tarifs | Facturo</title></head><body><h1>Tarifs</h1><p>Solo 19 € par mois. Équipe 49 € par mois. Essai gratuit 14 jours.</p></body></html>',
  '/a-propos': '<html><head><title>À propos | Facturo</title></head><body><h1>Notre mission</h1><p>Fondé à Lyon en 2024 par deux anciens DAF.</p></body></html>',
  '/fonctionnalites': '<html><head><title>Fonctionnalités | Facturo</title></head><body><h2>Relances intelligentes</h2><p>Emails de relance au bon moment.</p></body></html>',
  '/mentions-legales': '<html><head><title>Mentions</title></head><body>Mentions légales</body></html>',
};
const resendCalls = [];
let site, resend, tokens, siteUrl, server, base;
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });

const { boot } = await import('../src/cli.js');
const { callTool: call } = await import('../src/service.js');
const { createServer } = await import('../src/server.js');
const { q } = await import('../src/db.js');
const { stopScheduler } = await import('../src/automations.js');
const { setSecret } = await import('../src/secrets.js');

async function runDone(runId, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const r = q.get('SELECT * FROM runs WHERE id = ?', runId);
    if (r.status !== 'running') return r;
    if (Date.now() - t0 > ms) throw new Error(`run ${runId} still running`);
    await new Promise((res) => setTimeout(res, 20));
  }
}

before(async () => {
  site = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<urlset><url><loc>${siteUrl}/fonctionnalites</loc></url></urlset>`); }
    if (!SITE[p]) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE[p]);
  });
  resend = http.createServer(async (req, res) => {
    const body = await readBody(req);
    resendCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url === '/emails' ? JSON.stringify({ id: 'em_123' }) : JSON.stringify({ data: [{ id: 'dom_1', name: 'facturo.fr', status: 'verified' }] }));
  });
  tokens = http.createServer(async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(form.get('code') === 'good-code' ? { access_token: 'ya29.test', refresh_token: 'r1', expires_in: 3600 } : { error: 'invalid_grant' }));
  });
  siteUrl = await listen(site);
  process.env.CREWBOX_API_BASE_RESEND = await listen(resend);
  process.env.CREWBOX_OAUTH_TOKEN_URL = `${await listen(tokens)}/token`;
  process.env.CREWBOX_API_BASE_GOOGLE_SEARCH_CONSOLE = process.env.CREWBOX_API_BASE_RESEND;
  boot();
  server = createServer();
  base = await listen(server);
});

after(() => { stopScheduler(); for (const s of [site, resend, tokens, server]) s.close(); });

let plan, built;

test('Foreman reads the website into the Brain and spots the tools it runs', async () => {
  const r = await call('onboarding_analyze', { url: siteUrl });
  assert.equal(r.company, 'Facturo');
  const read = r.pagesRead.map((p) => new URL(p.url).pathname);
  for (const p of ['/', '/tarifs', '/a-propos', '/fonctionnalites']) assert.ok(read.includes(p), `read ${p}`);
  assert.ok(read.indexOf('/tarifs') < read.indexOf('/mentions-legales') || !read.includes('/mentions-legales'), 'pricing before legal pages');
  assert.deepEqual(r.tools.map((t) => t.slug).sort(), ['hubspot', 'linkedin', 'stripe']);
  const { pages } = await call('list_brain', {});
  assert.ok(pages.find((p) => p.slug === 'offer').body.includes('49 €'), 'pricing in the Brain');
  assert.ok(r.suggestedGoals.length >= 3);
  assert.equal((await call('onboarding_state', {})).step, 'goal');
});

test('Foreman plans a lead-generation team with Resend for outreach', async () => {
  plan = await call('onboarding_plan', { goal: 'Trouver des leads et leur envoyer des emails de prospection' });
  assert.equal(plan.drafted, 'recipes');
  assert.equal(plan.agents.length, 2);
  const outreach = plan.agents.find((a) => a.handle === 'outreach');
  assert.deepEqual(outreach.connectors, ['resend']);
  assert.ok(outreach.day.length >= 3 && outreach.firstWeek.length >= 2);
});

test('Foreman builds the team: coworkers, skills, paused schedules, apps waiting for keys', async () => {
  built = await call('onboarding_build', {});
  assert.equal(built.agents.length, 2);
  const ov = await call('overview', {});
  assert.equal(ov.onboarding.done, true);
  assert.ok(ov.foremanId, 'the assistant exists');
  assert.ok(!ov.agents.some((a) => a.id === ov.foremanId), 'the assistant is not on the board');
  assert.equal(ov.spaces[0].name, 'Mon équipe');
  const outreach = built.agents.find((a) => a.handle === 'outreach');
  assert.equal(outreach.apps[0].status, 'needs_config');
  const sched = q.all('SELECT enabled FROM schedules WHERE agent_id = ?', outreach.agentId);
  assert.ok(sched.length && sched.every((s) => !s.enabled), 'schedules wait for the setup');
  const brainInPrompt = (await import('../src/runtime/prompt.js')).buildSystemPrompt((await import('../src/agents.js')).agentConfig(outreach.agentId));
  assert.match(brainInPrompt, /## Your company \(the Brain\)[\s\S]*Facturo/);
});

test('a second team gets its own Box when the first one is taken', async () => {
  const support = await call('onboarding_plan', { goal: 'Répondre aux demandes du support client' });
  const second = await call('onboarding_build', { plan: support });
  assert.notEqual(second.spaceId, built.spaceId);
  const spaces = (await call('list_spaces', {})).spaces;
  assert.equal(spaces.find((x) => x.id === second.spaceId).agentCount, second.agents.length);
  // A coworker created without a Box joins the main one.
  const solo = await call('create_agent', { name: 'Solo' });
  assert.equal((await call('get_agent', { agentId: solo.agentId })).spaceId, spaces[0].id);
});

test('the outreach coworker sends an email with the Resend connector, after approval', async () => {
  const outreach = built.agents.find((a) => a.handle === 'outreach');
  setSecret(outreach.agentId, 'RESEND_API_KEY', 're_test_key_123');
  const st = await call('list_agent_connectors', { agentId: outreach.agentId });
  assert.equal(st.connectors[0].status, 'active');
  const email = { from: 'Oscar <oscar@facturo.fr>', to: 'lea@agence.fr', subject: 'vos relances', text: 'Bonjour Léa…' };
  const { runId, sessionId } = await call('chat', { agentId: outreach.agentId, message: `/tool mcp__resend__send_email ${JSON.stringify(email)}` });
  const r = await runDone(runId);
  assert.equal(r.status, 'waiting', 'sending waits for an approval');
  const [p] = (await call('list_pauses', { agentId: outreach.agentId })).pauses;
  assert.equal(resendCalls.length, 0, 'nothing sent before approval');
  await runDone((await call('answer_pause', { pauseId: p.id, answers: { [p.payload.items[0].toolUseId]: { decision: 'once' } } })).runId);
  const sent = resendCalls.find((c) => c.url === '/emails');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.auth, 'Bearer re_test_key_123');
  assert.deepEqual(sent.body, email);
  const msgs = JSON.parse(q.get('SELECT messages FROM sessions WHERE id = ?', sessionId).messages);
  assert.match(JSON.stringify(msgs), /em_123/);
  assert.doesNotMatch(JSON.stringify(msgs), /re_test_key_123/, 'the key never reaches the conversation');
});

test('a Google app signs in through the owner OAuth app and calls its API with the token', async () => {
  const agentId = built.agents[0].agentId;
  let r = await call('attach_connector', { agentId, slug: 'google-search-console' });
  assert.equal(r.status, 'needs_config');
  setSecret(agentId, 'GOOGLE_CLIENT_ID', 'cid.apps.googleusercontent.com');
  setSecret(agentId, 'GOOGLE_CLIENT_SECRET', 'gsecret');
  r = await call('connect_app', { agentId, slug: 'google-search-console' });
  assert.equal(r.status, 'needs_auth');
  const u = new URL(r.authorizeUrl);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.match(u.searchParams.get('redirect_uri'), /\/oauth\/callback$/);
  const bad = await fetch(`${base}/oauth/callback?state=nope&code=x`);
  assert.equal(bad.status, 400);
  const ok = await fetch(`${base}/oauth/callback?state=${u.searchParams.get('state')}&code=good-code`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /connecté/);
  const st = (await call('list_agent_connectors', { agentId })).connectors.find((c) => c.slug === 'google-search-console');
  assert.equal(st.status, 'active');
  const { routes } = await (await import('../src/mcp.js')).agentMcpTools(agentId);
  const route = routes.get('mcp__google_search_console__request');
  const out = await (await import('../src/mcp.js')).callMcpTool(route, { method: 'GET', path: '/webmasters/v3/sites' });
  assert.equal(out.isError, false);
  assert.equal(resendCalls.at(-1).auth, 'Bearer ya29.test');
});

test('the library holds every Rerun app with a way to connect', async () => {
  const all = await call('list_connectors', { limit: 200 });
  assert.ok(all.total >= 207);
  const resend = await call('get_connector', { slug: 'resend' });
  assert.deepEqual(resend.methods.map((m) => m.kind), ['apiKey', 'oauth', 'command']);
  assert.equal(resend.methods[0].tools, 24);
  assert.equal((await call('search_connectors', { query: 'send emails' })).connectors[0].slug, 'resend');
  const icon = await fetch(`${base}/icons/resend.png`);
  assert.equal(icon.status, 200);
});

test('Brain proposals wait for the owner; Autopilot leaves cards alone without a model', async () => {
  const agentId = built.agents[0].agentId;
  await runDone((await call('chat', { agentId, message: '/tool brain_propose {"title":"Concurrents","body":"- Payfit","reason":"vu sur LinkedIn"}' })).runId);
  let b = await call('list_brain', {});
  assert.equal(b.proposals.length, 1);
  assert.ok(!b.pages.some((p) => p.title === 'Concurrents'));
  await call('decide_brain_proposal', { proposalId: b.proposals[0].id, accept: true });
  b = await call('list_brain', {});
  assert.ok(b.pages.some((p) => p.title === 'Concurrents'));

  await call('set_autopilot', { enabled: true, rules: ['Approve emails to new leads'] });
  const { runId } = await call('chat', { agentId, message: '/tool ask_user {"questions":[{"question":"On y va ?"}]}' });
  assert.equal((await runDone(runId)).status, 'waiting');
  await new Promise((r) => setTimeout(r, 300));
  const ap = await call('get_autopilot', {});
  assert.equal(ap.log[0].decision, 'escalate');
  assert.match(ap.log[0].reason, /No AI model/);
  assert.equal((await call('list_pauses', { agentId })).pauses.length, 1, 'the card still waits for the owner');
});

test('Autopilot answers an approval that a rule covers, with a model, and logs why', async () => {
  const seenSystem = [];
  const claude = http.createServer(async (req, res) => {
    const j = JSON.parse(await readBody(req));
    seenSystem.push(String(j.system?.[0]?.text || j.system || ''));
    const ids = [...JSON.stringify(j.messages).matchAll(/\\"id\\": \\"(toolu_[^\\"]+)\\"/g)].map((m) => m[1]);
    const text = JSON.stringify({ items: ids.map((id) => ({ id, decision: 'approve', perAction: ['approve'], rule: 'Approve emails to new leads', reason: 'A new lead, as the rule says.' })) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
    ev({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
    ev({ type: 'content_block_stop', index: 0 });
    ev({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
    ev({ type: 'message_stop' });
    res.end();
  });
  const claudeUrl = await listen(claude);
  try {
    const mock = (await call('list_ai_connections', {})).connections.find((c) => c.provider === 'mock');
    const conn = await call('create_connection', { provider: 'anthropic', name: 'Claude', apiKey: 'sk-ant-test', baseUrl: claudeUrl });
    await call('set_default_model', { connectionId: conn.connectionId || conn.id, model: 'claude-opus-5-5' });
    const agentId = built.agents.find((a) => a.handle === 'outreach').agentId;
    await call('update_agent', { agentId, connectionId: mock.id, model: mock.models?.[0] || 'mock-1' });
    const { runId } = await call('chat', { agentId, message: '/tool request_approval {"actions":[{"title":"Send the first email to lea@agence.fr","detail":"New lead from the morning batch"}]}' });
    await runDone(runId);
    const t0 = Date.now();
    while ((await call('list_pauses', { agentId })).pauses.length && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    assert.equal((await call('list_pauses', { agentId })).pauses.length, 0, 'Autopilot answered the card');
    const log = (await call('get_autopilot', {})).log;
    assert.equal(log[0].decision, 'answered');
    assert.match(log[0].reason, /Approve emails to new leads/);
    assert.ok(seenSystem.some((s) => /You are Autopilot/.test(s)));
    const p = q.get("SELECT answer FROM pauses WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1", agentId);
    assert.match(p.answer, /approve/);
  } finally { claude.close(); }
});
