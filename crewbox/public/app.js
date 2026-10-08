// Crewbox UI — vanilla JS, no build step. Everything goes through POST /api/ui/<operation>.
const TOKEN = document.querySelector('meta[name="crewbox-token"]').content;

async function api(name, args = {}) {
  const res = await fetch(`/api/ui/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewbox-token': TOKEN }, body: JSON.stringify(args) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/* ---------------- tiny DOM helpers ---------------- */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // only ever used with md() output, which escapes first
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const $ = (s, r = document) => r.querySelector(s);
const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

function toast(msg, err = false) {
  const t = h('div', { class: `toast${err ? ' err' : ''}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 6000 : 3000);
}
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Minimal markdown: escapes HTML first, then formats. */
function md(src) {
  const blocks = [];
  let s = esc(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, code) => { blocks.push(`<pre><code>${code}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = [];
  let list = null;
  for (const line of s.split('\n')) {
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) { if (!list) { list = []; } list.push(`<li>${li[1]}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (hm) out.push(`<h${hm[1].length + 2}>${hm[2]}</h${hm[1].length + 2}>`);
    else if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

const COLORS = ['#6d5efc', '#ef6c4a', '#12a46b', '#2f7cf6', '#d64592', '#d98a00', '#0f9fb0', '#8b5cf6'];
const colorOf = (s) => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (name) => String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const avatar = (a, cls = '') => h('div', { class: `avatar ${cls}`, style: { background: colorOf(a.handle || a.name) } }, initials(a.name));
const ago = (iso) => {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
const STATUS_LABEL = { running: 'working', waiting: 'needs you', error: 'error', idle: 'ready' };

/* ---------------- modal ---------------- */

function modal(title, body, { wide = false, onClose } = {}) {
  const root = $('#modal-root');
  const close = () => { back.remove(); onClose?.(); };
  const back = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, title), h('button', { class: 'ghost', onclick: close, 'aria-label': 'Close' }, '✕')),
      body));
  root.append(back);
  return close;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const m = $('#modal-root').lastElementChild;
  if (m) m.remove(); else if (!$('#panel').hidden) closePanel();
});

/* ---------------- state ---------------- */

const state = { overview: null, agentId: null, tab: 'chat', sessionId: null, streaming: '', streamRun: null };

/* ---------------- board ---------------- */

async function loadBoard() {
  state.overview = await api('overview');
  renderBoard();
  const pc = $('#pending-count'), uc = $('#unread-count');
  pc.hidden = !state.overview.pendingPauses; pc.textContent = state.overview.pendingPauses;
  uc.hidden = !state.overview.unread; uc.textContent = state.overview.unread;
}

function renderBoard() {
  const { spaces, agents, connections } = state.overview;
  const board = clear($('#board'));
  if (!agents.length) {
    board.append(h('div', { class: 'empty-board' },
      h('h1', {}, 'Get your recurring work done by AI coworkers'),
      h('p', { class: 'muted' }, 'Describe a job in your own words, install a template, and connect your tools. Everything runs on this machine.'),
      connections.every((c) => c.provider === 'mock') ? h('p', { class: 'callout' }, 'You are on the offline demo provider. Add a Claude API key or a local model under ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openSettings('providers'); } }, 'Settings → AI providers'), ' to get real work done.') : null,
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } },
        h('button', { class: 'primary', onclick: () => openNewAgent() }, 'Describe a job'),
        h('button', { onclick: () => openTemplates() }, 'Browse templates'))));
  }
  for (const s of spaces) {
    const mine = agents.filter((a) => a.space_id === s.id);
    board.append(h('section', { class: 'box' },
      h('div', { class: 'box-head' },
        h('h2', {}, s.name), h('span', { class: 'pill' }, `${mine.length} coworker${mine.length === 1 ? '' : 's'}`),
        h('button', { class: 'ghost small', title: 'Rename', onclick: safe(async () => { const n = prompt('Box name', s.name); if (n) { await api('update_space', { spaceId: s.id, name: n }); loadBoard(); } }) }, '✎'),
        !mine.length && spaces.length > 1 ? h('button', { class: 'ghost small danger', title: 'Delete Box', onclick: safe(async () => { await api('delete_space', { spaceId: s.id }); loadBoard(); }) }, '🗑') : null),
      h('div', { class: 'box-floor' },
        mine.map((a) => h('div', { class: `desk${a.enabled ? '' : ' off'}`, tabindex: 0, onclick: () => openAgent(a.id), onkeydown: (e) => { if (e.key === 'Enter') openAgent(a.id); }, title: a.description || '' },
          h('span', { class: 'status pill' }, h('span', { class: `dot ${a.status}` }), STATUS_LABEL[a.status] || a.status),
          avatar(a), h('div', { class: 'name' }, a.name), h('div', { class: 'handle' }, `@${a.handle}`))),
        h('div', { class: 'desk add', tabindex: 0, onclick: () => openNewAgent(s.id) }, '+ Add coworker'))));
  }
  board.append(h('section', { class: 'box', style: { borderStyle: 'dashed', boxShadow: 'none', background: 'transparent' } },
    h('div', { class: 'empty-board', style: { padding: '30px' } },
      h('button', { onclick: safe(async () => { const n = prompt('Name of the new Box (a team, a client, a project)'); if (n) { await api('create_space', { name: n }); loadBoard(); } }) }, '+ New Box'))));
  const u = state.overview.usage;
  board.append(h('div', { class: 'muted', style: { gridColumn: '1 / -1', fontSize: '12px', textAlign: 'center' } },
    `Last 30 days: ${u.runs} runs · ${Number(u.tokens).toLocaleString()} tokens · $${Number(u.cost).toFixed(2)}`));
}

/* ---------------- new coworker ---------------- */

function openNewAgent(spaceId) {
  const spaces = state.overview.spaces;
  let mode = 'describe';
  const body = h('div');
  const spaceSel = h('select', {}, spaces.map((s) => h('option', { value: s.id, selected: s.id === spaceId }, s.name)));
  const render = () => {
    clear(body);
    body.append(h('div', { class: 'seg', style: { margin: '6px 0 10px' } },
      ['describe', 'blank'].map((m) => h('button', { class: mode === m ? 'active' : '', onclick: () => { mode = m; render(); } }, m === 'describe' ? 'Describe the job' : 'Start blank'))));
    if (mode === 'describe') {
      const ta = h('textarea', { placeholder: 'e.g. Every morning, find 20 SaaS companies in France that just started hiring salespeople and add them to my leads table.', rows: 5 });
      const btn = h('button', { class: 'primary', onclick: safe(async () => {
        btn.disabled = true; btn.textContent = 'Setting itself up…';
        try {
          const r = await api('build_agent', { description: ta.value, spaceId: spaceSel.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
          close(); await loadBoard(); openAgent(r.agentId);
          toast(r.drafted === 'model' ? `${r.name} wrote its own soul, skills and schedule (schedules start paused).` : `${r.name} created. Connect an AI provider to let coworkers draft themselves.`);
        } finally { btn.disabled = false; btn.textContent = 'Create coworker'; }
      }) }, 'Create coworker');
      body.append(h('label', {}, 'What is the job? ', h('span', { class: 'hint' }, 'Describe it in your own words; it writes its own prompt, skills and schedule.')), ta,
        h('label', {}, 'Box'), spaceSel, h('div', { class: 'row end', style: { marginTop: '14px' } }, btn));
      setTimeout(() => ta.focus());
    } else {
      const name = h('input', { placeholder: 'Margo · Invoice Chasing' });
      const desc = h('input', { placeholder: 'One line on what it is for' });
      const soul = h('textarea', { class: 'code', placeholder: '# Who you are\n…\n# How you work\n…\n# Rules\n…' });
      body.append(h('label', {}, 'Name'), name, h('label', {}, 'Description'), desc, h('label', {}, 'Soul (system prompt, markdown)'), soul, h('label', {}, 'Box'), spaceSel,
        h('div', { class: 'row end', style: { marginTop: '14px' } }, h('button', { class: 'primary', onclick: safe(async () => {
          const r = await api('create_agent', { name: name.value, description: desc.value, soul: soul.value, spaceId: spaceSel.value });
          close(); await loadBoard(); openAgent(r.agentId);
        }) }, 'Create')));
    }
  };
  const close = modal('New coworker', body);
  render();
}

/* ---------------- coworker panel ---------------- */

const TABS = [['chat', 'Chat'], ['handle', 'To handle'], ['skills', 'Skills'], ['automations', 'Automations'], ['apps', 'Apps'], ['memory', 'Memory'], ['data', 'Database'], ['files', 'Files'], ['runs', 'Runs'], ['settings', 'Settings']];

async function openAgent(id, tab) {
  if (state.agentId !== id) { state.sessionId = null; state.streaming = ''; }
  state.agentId = id;
  state.tab = tab || (state.agentId === id && state.tab) || 'chat';
  $('#panel').hidden = false;
  await renderPanel();
}

function closePanel() { $('#panel').hidden = true; state.agentId = null; }

async function renderPanel() {
  const a = await api('get_agent', { agentId: state.agentId });
  state.agent = a;
  const panel = clear($('#panel'));
  const pendingN = (await api('list_pauses', { agentId: a.id })).pauses.length;
  panel.append(
    h('div', { class: 'panel-head' }, avatar(a),
      h('div', { class: 'grow' }, h('h2', {}, a.name), h('div', { class: 'muted' }, `@${a.handle} · `, h('span', { class: 'pill' }, h('span', { class: `dot ${a.status}` }), STATUS_LABEL[a.status]), ' · ', a.runsOn.model || 'no model')),
      h('button', { class: 'ghost', onclick: closePanel, 'aria-label': 'Close panel' }, '✕')),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label]) => h('button', { class: state.tab === k ? 'active' : '', role: 'tab', onclick: () => { state.tab = k; renderPanel(); } }, label, k === 'handle' && pendingN ? h('span', { class: 'badge', style: { marginLeft: '4px' } }, pendingN) : null))),
  );
  const body = h('div', { class: `panel-body${state.tab === 'chat' ? ' chat' : ''}` });
  panel.append(body);
  await (VIEWS[state.tab] || VIEWS.chat)(body, a);
}

/* ---- chat ---- */

const VIEWS = {};

VIEWS.chat = async (body, a) => {
  const { sessions } = await api('list_sessions', { agentId: a.id });
  if (!state.sessionId && sessions.length) state.sessionId = sessions.find((s) => s.kind === 'chat')?.id || sessions[0].id;
  const conns = state.overview.connections;
  const modelSel = h('select', { title: 'Model for this coworker' },
    h('option', { value: '' }, `Workspace default${a.runsOn.followsDefault ? ` (${a.runsOn.model || 'none'})` : ''}`),
    conns.flatMap((c) => c.models.map((m) => h('option', { value: `${c.id}|${m}`, selected: !a.runsOn.followsDefault && a.runsOn.connectionId === c.id && a.runsOn.model === m }, `${c.name} — ${m}`))));
  modelSel.onchange = safe(async () => {
    const [connectionId, model] = modelSel.value ? modelSel.value.split('|') : [];
    await api('update_agent', modelSel.value ? { agentId: a.id, connectionId, model } : { agentId: a.id, model: null });
    toast('Model updated');
  });
  const sessSel = h('select', { onchange: () => { state.sessionId = sessSel.value; renderPanel(); } },
    sessions.map((s) => h('option', { value: s.id, selected: s.id === state.sessionId }, `${s.kind === 'chat' ? '💬' : s.kind === 'schedule' ? '⏰' : s.kind === 'trigger' ? '⚡' : s.kind === 'agent' ? '🤝' : '🔌'} ${s.title || 'Conversation'} · ${ago(s.updated_at)}`)));
  body.append(h('div', { class: 'chat-bar' }, sessions.length ? sessSel : h('span', { class: 'muted grow' }, 'No conversation yet'),
    h('button', { class: 'small', onclick: safe(async () => { state.sessionId = (await api('new_session', { agentId: a.id })).sessionId; renderPanel(); }) }, '+ New'),
    h('span', { class: 'grow' }), modelSel));
  const msgs = h('div', { class: 'messages', id: 'messages' });
  const cardSlot = h('div', { id: 'card-slot' });
  const ta = h('textarea', { placeholder: `Message ${a.name}…  (Enter to send, Shift+Enter for a new line)`, rows: 2, value: state.draft || '', oninput: () => { state.draft = ta.value; } });
  const meta = h('span', { class: 'run-meta', id: 'run-meta' });
  const stopBtn = h('button', { class: 'small', id: 'stop-btn', hidden: true, onclick: safe(async () => { if (state.streamRun) await api('cancel_run', { runId: state.streamRun }); }) }, 'Stop');
  const send = safe(async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; state.draft = '';
    msgs.append(h('div', { class: 'msg user' }, text));
    msgs.scrollTop = msgs.scrollHeight;
    const r = await api('chat', { agentId: a.id, message: text, sessionId: state.sessionId || undefined });
    state.sessionId = r.sessionId; state.streamRun = r.runId; state.streaming = '';
    stopBtn.hidden = false;
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  body.append(msgs, cardSlot, h('div', { class: 'composer' }, ta, h('div', { class: 'list' }, h('button', { class: 'primary', onclick: send }, 'Send'), stopBtn)), h('div', { style: { padding: '0 14px 8px' } }, meta));
  await renderSession();
  ta.focus();
};

async function renderSession() {
  const msgs = $('#messages');
  if (!msgs) return;
  const slot = $('#card-slot');
  if (!state.sessionId) {
    clear(msgs).append(h('div', { class: 'muted', style: { margin: 'auto', textAlign: 'center' } }, h('p', {}, `Give ${state.agent.name} a job.`), h('p', {}, 'Try: “What can you do for me?”')));
    clear(slot);
    return;
  }
  const s = await api('get_session', { sessionId: state.sessionId });
  clear(msgs);
  const results = new Map();
  for (const m of s.messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
  for (const m of s.messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') msgs.append(h('div', { class: `msg user${s.kind !== 'chat' && m === s.messages[0] ? ' auto' : ''}` }, m.content));
      else for (const b of m.content) if (b.type === 'text') msgs.append(h('div', { class: 'msg user' }, b.text));
      continue;
    }
    const wrap = h('div', { class: 'msg assistant' });
    for (const b of m.content || []) {
      if (b.type === 'text' && b.text.trim()) wrap.append(h('div', { class: 'bubble', html: md(b.text) }));
      if (b.type === 'tool_use') {
        const r = results.get(b.id);
        const rText = r ? (typeof r.content === 'string' ? r.content : r.content.map((c) => c.text || `[${c.type}]`).join('\n')) : '…';
        wrap.append(h('details', { class: `tool${r?.is_error ? ' err' : ''}` },
          h('summary', {}, r ? (r.is_error ? '⚠' : '✓') : '⏳', ' ', h('span', { class: 'mono' }, b.name), h('span', { class: 'muted' }, ' ', summarizeInput(b.input))),
          h('div', { class: 'io' }, h('div', { class: 'muted' }, 'Input'), h('pre', { class: 'mono' }, JSON.stringify(b.input, null, 2)), h('div', { class: 'muted' }, 'Result'), h('pre', { class: 'mono' }, rText))));
      }
    }
    if (wrap.childNodes.length) msgs.append(wrap);
  }
  const live = s.runs.at(-1);
  if (live?.status === 'running') {
    state.streamRun = live.runId;
    msgs.append(h('div', { class: 'msg assistant', id: 'stream' }, h('div', { class: 'bubble typing', html: md(state.streaming || '') })));
  }
  const stop = $('#stop-btn'); if (stop) stop.hidden = live?.status !== 'running';
  const meta = $('#run-meta');
  if (meta && live) meta.textContent = `Last run: ${live.status} · ${live.steps} steps · ${(live.totalTokens || 0).toLocaleString()} tokens${live.costUsd != null ? ` · $${Number(live.costUsd).toFixed(4)}` : ''}${live.error ? ` · ${live.error}` : ''}`;
  clear(slot);
  if (s.pending) {
    const { pauses } = await api('list_pauses', { agentId: state.agentId });
    const p = pauses.find((x) => x.id === s.pending.pauseId);
    if (p) slot.append(pauseCard(p));
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function summarizeInput(input) {
  const v = input && (input.path || input.url || input.query || input.command || input.sql || input.handle || input.name || input.title || input.slug);
  return v ? String(v).slice(0, 70) : '';
}

/* ---- human-in-the-loop card ---- */

function pauseCard(p, { onDone } = {}) {
  const answers = {};
  const items = p.payload.items;
  const card = h('div', { class: 'card' }, h('h3', {}, { question: '❓ A question', approval: '✋ Approval required', connector: '🔗 Connect an app', secret: '🔑 A credential is needed' }[p.kind] || 'Needs you'));
  for (const it of items) {
    const a = (answers[it.toolUseId] = {});
    const box = h('div', { class: 'item' });
    if (it.kind === 'question') {
      a.answers = [];
      (it.input.questions || []).forEach((q, qi) => {
        const other = h('input', { placeholder: 'Something else…', oninput: () => { a.answers[qi] = other.value; opts.querySelectorAll('button').forEach((b) => b.classList.remove('sel')); } });
        const opts = h('div', { class: 'options' }, (q.options || []).map((o) => h('button', { class: 'small', onclick: (e) => {
          if (q.multiple) { e.target.classList.toggle('sel'); a.answers[qi] = [...opts.querySelectorAll('.sel')].map((b) => b.textContent); }
          else { opts.querySelectorAll('button').forEach((b) => b.classList.remove('sel')); e.target.classList.add('sel'); a.answers[qi] = o; }
        } }, o)));
        box.append(h('div', {}, h('strong', {}, q.question)), opts, other);
      });
    } else if (it.kind === 'approval') {
      a.decisions = [];
      (it.input.actions || []).forEach((act, ai) => {
        a.decisions[ai] = 'decline';
        const yes = h('button', { class: 'small', onclick: () => { a.decisions[ai] = 'approve'; yes.classList.add('sel'); no.classList.remove('sel'); } }, 'Approve');
        const no = h('button', { class: 'small sel', onclick: () => { a.decisions[ai] = 'decline'; no.classList.add('sel'); yes.classList.remove('sel'); } }, 'Decline');
        box.append(h('div', {}, h('strong', {}, act.title)), act.detail ? h('pre', {}, act.detail) : null, h('div', { class: 'options' }, no, yes));
      });
    } else if (it.kind === 'gate') {
      a.decision = 'deny';
      const btns = ['once', 'session', 'always', 'deny'].map((d) => h('button', { class: `small${d === 'deny' ? ' sel' : ''}`, onclick: (e) => { a.decision = d; btns.forEach((b) => b.classList.remove('sel')); e.target.classList.add('sel'); } }, { once: 'Allow once', session: 'This session', always: 'Always', deny: 'Deny' }[d]));
      box.append(h('div', {}, h('strong', {}, `Run `, h('span', { class: 'mono' }, it.tool)), it.app ? h('span', { class: 'muted' }, ` (${it.app})`) : null), h('pre', {}, JSON.stringify(it.input, null, 2)), h('div', { class: 'options' }, btns));
    } else if (it.kind === 'secret') {
      const inp = h('input', { type: 'password', autocomplete: 'off', placeholder: it.input.name, oninput: () => { a.value = inp.value; } });
      box.append(h('div', {}, h('strong', {}, it.input.label || it.input.name)), it.input.reason ? h('div', { class: 'muted' }, it.input.reason) : null, inp,
        h('div', { class: 'muted', style: { fontSize: '12px' } }, `Stored on this machine as ${it.input.name}. The coworker never sees the value.`));
    } else if (it.kind === 'connector') {
      a.values = {};
      box.append(h('div', {}, h('strong', {}, it.app?.name || it.input.slug), ' — ', h('span', { class: 'muted' }, it.app?.description || '')), it.input.reason ? h('div', {}, it.input.reason) : null,
        (it.app?.secrets || []).map((sx) => h('div', {}, h('label', {}, sx.label, ' ', h('span', { class: 'hint' }, `${sx.name}${sx.help ? ` · ${sx.help}` : ''}`)), h('input', { type: 'password', autocomplete: 'off', oninput: (e) => { a.values[sx.name] = e.target.value; } }))),
        h('label', { class: 'toggle', style: { marginTop: '8px' } }, h('input', { type: 'checkbox', onchange: (e) => { a.skip = e.target.checked; } }), 'Skip for now'));
    }
    card.append(box);
  }
  card.append(h('div', { class: 'row end' },
    h('button', { class: 'small', onclick: safe(async () => { await api('cancel_run', { runId: p.run_id }); onDone?.(); refreshPanelSoon(); }) }, 'Cancel run'),
    h('button', { class: 'primary', onclick: safe(async (e) => {
      e.target.disabled = true;
      const r = await api('answer_pause', { pauseId: p.id, answers });
      state.sessionId = r.sessionId; state.streamRun = r.runId; state.streaming = '';
      onDone?.(); refreshPanelSoon(); loadBoard();
    }) }, 'Send answer')));
  return card;
}

/* ---- to handle ---- */

VIEWS.handle = async (body, a) => {
  const { pauses } = await api('list_pauses', { agentId: a.id });
  const { notifications } = await api('list_notifications', { agentId: a.id });
  body.append(h('div', { class: 'section-title' }, h('h3', {}, 'Waiting for you')));
  if (!pauses.length) body.append(h('p', { class: 'muted' }, 'Nothing is waiting for you.'));
  for (const p of pauses) body.append(h('div', { class: 'muted', style: { fontSize: '12px', marginLeft: '14px' } }, ago(p.created_at), ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); state.sessionId = p.session_id; state.tab = 'chat'; renderPanel(); } }, 'open conversation')), pauseCard(p, { onDone: () => renderPanel() }));
  body.append(h('div', { class: 'section-title', style: { marginTop: '18px' } }, h('h3', {}, 'Notifications')));
  body.append(notifList(notifications));
};

function notifList(list) {
  if (!list.length) return h('p', { class: 'muted' }, 'No notifications.');
  return h('div', { class: 'list' }, list.map((n) => h('div', { class: 'item-row', style: { opacity: n.read ? 0.65 : 1 } },
    h('div', { class: 'row' }, h('span', { class: `pill ${n.kind === 'error' ? 'err' : n.kind === 'done' ? 'ok' : ['question', 'approval', 'connector', 'secret'].includes(n.kind) ? 'warn' : ''}` }, n.kind), h('h4', { class: 'grow' }, n.title), h('span', { class: 'meta' }, ago(n.created_at))),
    n.body ? h('div', { class: 'meta', style: { whiteSpace: 'pre-wrap' } }, n.body) : null,
    n.agent_id && n.agent_name ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); openAgent(n.agent_id, n.pause_id ? 'handle' : 'runs'); } }, `Open ${n.agent_name}`) : null)));
}

/* ---- skills ---- */

VIEWS.skills = async (body, a) => {
  const { skills } = await api('list_skills', { agentId: a.id });
  body.append(h('div', { class: 'section-title' }, h('h3', {}, 'Skills'), h('button', { class: 'small primary', onclick: () => editSkill(a) }, '+ New skill')),
    h('p', { class: 'muted' }, 'Procedures the coworker opens only when a task matches the description. Only the one-line index is always in its context.'));
  if (!skills.length) body.append(h('p', { class: 'muted' }, 'No skills yet. Ask the coworker to “remember this procedure as a skill”, or write one.'));
  body.append(h('div', { class: 'list' }, skills.map((s) => h('div', { class: 'item-row' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, s.name, ' ', h('span', { class: 'muted mono' }, s.slug)), s.readOnly ? h('span', { class: 'pill' }, `app: ${s.connector}`) : null,
      h('button', { class: 'small', onclick: () => editSkill(a, s.slug) }, s.readOnly ? 'View' : 'Edit'),
      s.readOnly ? null : h('button', { class: 'small danger', onclick: safe(async () => { if (confirm(`Delete skill ${s.name}?`)) { await api('delete_skill', { agentId: a.id, slug: s.slug, confirm: true }); renderPanel(); } }) }, 'Delete')),
    h('div', { class: 'meta' }, s.description), s.files.length ? h('div', { class: 'meta mono' }, s.files.map((f) => f.path).join(' · ')) : null))));
};

async function editSkill(a, slug) {
  const s = slug ? await api('get_skill', { agentId: a.id, slug }) : { name: '', description: '', body: '', files: [] };
  const name = h('input', { value: s.name, disabled: s.readOnly });
  const desc = h('input', { value: s.description, placeholder: 'Use when …', disabled: s.readOnly });
  const bodyTa = h('textarea', { class: 'code', value: s.body, disabled: s.readOnly });
  const files = await Promise.all(s.files.map(async (f) => ({ path: f.path, content: (await api('read_skill_file', { agentId: a.id, slug, path: f.path })).content })));
  const fileBox = h('div', { class: 'list' });
  const renderFiles = () => { clear(fileBox); files.forEach((f, i) => fileBox.append(h('div', { class: 'item-row' }, h('div', { class: 'row' }, h('input', { value: f.path, disabled: s.readOnly, oninput: (e) => { f.path = e.target.value; } }), s.readOnly ? null : h('button', { class: 'small danger', onclick: () => { files.splice(i, 1); renderFiles(); } }, 'Remove')), h('textarea', { class: 'code', style: { minHeight: '100px' }, value: f.content, disabled: s.readOnly, oninput: (e) => { f.content = e.target.value; } })))); };
  renderFiles();
  const original = new Set(s.files.map((f) => f.path));
  const close = modal(slug ? `Skill · ${s.name}` : 'New skill', h('div', {},
    h('label', {}, 'Name'), name, h('label', {}, 'Description ', h('span', { class: 'hint' }, 'a trigger condition: what makes the coworker open it')), desc,
    h('label', {}, 'Procedure (SKILL.md body)'), bodyTa,
    h('div', { class: 'section-title', style: { marginTop: '12px' } }, h('h3', {}, 'Reference files'), s.readOnly ? null : h('button', { class: 'small', onclick: () => { files.push({ path: `references/file-${files.length + 1}.md`, content: '' }); renderFiles(); } }, '+ File')),
    fileBox,
    s.readOnly ? h('p', { class: 'callout' }, 'This skill belongs to an app and is read-only. Write a skill of your own next to it to change behaviour.') :
      h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: safe(async () => {
        const removeFiles = [...original].filter((p) => !files.some((f) => f.path === p));
        await api('upsert_skill', { agentId: a.id, slug, name: name.value, description: desc.value, body: bodyTa.value, files, removeFiles });
        close(); renderPanel(); toast('Skill saved');
      }) }, 'Save'))), { wide: true });
}

/* ---- automations ---- */

VIEWS.automations = async (body, a) => {
  const [{ schedules }, { triggers }] = await Promise.all([api('list_schedules', { agentId: a.id }), api('list_triggers', { agentId: a.id })]);
  body.append(h('div', { class: 'section-title' }, h('h3', {}, 'Scheduled tasks'), h('button', { class: 'small primary', onclick: () => editSchedule(a) }, '+ Schedule')),
    h('p', { class: 'muted' }, 'A cron (or a date) plus an instruction. Each run opens its own session; memory and databases carry over.'));
  body.append(h('div', { class: 'list' }, schedules.length ? schedules.map((s) => h('div', { class: 'item-row' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, s.name), h('span', { class: `pill ${s.enabled ? 'ok' : ''}` }, s.enabled ? 'on' : 'paused'),
      h('button', { class: 'small', onclick: safe(async () => { const r = await api('run_schedule_now', { agentId: a.id, slug: s.slug }); toast('Fired'); state.sessionId = r.sessionId; state.tab = 'chat'; renderPanel(); }) }, 'Run now'),
      h('button', { class: 'small', onclick: safe(async () => { await api('upsert_schedule', { agentId: a.id, slug: s.slug, enabled: !s.enabled }); renderPanel(); }) }, s.enabled ? 'Pause' : 'Enable'),
      h('button', { class: 'small', onclick: () => editSchedule(a, s) }, 'Edit'),
      h('button', { class: 'small danger', onclick: safe(async () => { if (confirm('Delete this scheduled task?')) { await api('delete_schedule', { agentId: a.id, slug: s.slug, confirm: true }); renderPanel(); } }) }, 'Delete')),
    h('div', { class: 'meta mono' }, s.cron ? `${s.cron}${s.timezone ? ` · ${s.timezone}` : ''}` : `once at ${s.runAt}`, s.nextRunAt ? ` · next ${new Date(s.nextRunAt).toLocaleString()}` : '', s.lastRunAt ? ` · last ${ago(s.lastRunAt)}` : ''),
    h('div', { class: 'meta' }, s.body))) : h('p', { class: 'muted' }, 'No scheduled task.')));

  body.append(h('div', { class: 'section-title', style: { marginTop: '20px' } }, h('h3', {}, 'Webhook triggers'), h('button', { class: 'small primary', onclick: () => editTrigger(a) }, '+ Trigger')),
    h('p', { class: 'muted' }, 'A public URL that starts a run. The URL is the credential: keep it secret, rotate it if it leaks.'));
  body.append(h('div', { class: 'list' }, triggers.length ? triggers.map((t) => h('div', { class: 'item-row' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, t.name), h('span', { class: `pill ${t.enabled ? 'ok' : ''}` }, t.enabled ? 'on' : 'off'), h('span', { class: 'pill' }, t.methods.join(' ')),
      h('button', { class: 'small', onclick: safe(async () => { await navigator.clipboard.writeText(t.url); toast('URL copied'); }) }, 'Copy URL'),
      h('button', { class: 'small', onclick: safe(async () => { const payload = prompt('Test payload (JSON)', '{"event":"test"}'); if (payload == null) return; let b; try { b = JSON.parse(payload); } catch { b = payload; } const r = await api('test_trigger', { agentId: a.id, slug: t.slug, body: b }); state.sessionId = r.sessionId; state.tab = 'chat'; renderPanel(); }) }, 'Test'),
      h('button', { class: 'small', onclick: safe(async () => { await api('upsert_trigger', { agentId: a.id, slug: t.slug, enabled: !t.enabled }); renderPanel(); }) }, t.enabled ? 'Disable' : 'Enable'),
      h('button', { class: 'small', onclick: safe(async () => { if (confirm('Rotate? The current URL stops working immediately.')) { await api('rotate_trigger_token', { agentId: a.id, slug: t.slug }); renderPanel(); } }) }, 'Rotate'),
      h('button', { class: 'small danger', onclick: safe(async () => { if (confirm('Delete this trigger?')) { await api('delete_trigger', { agentId: a.id, slug: t.slug, confirm: true }); renderPanel(); } }) }, 'Delete')),
    h('div', { class: 'meta mono' }, `fired ${t.fireCount}×${t.lastFiredAt ? ` · last ${ago(t.lastFiredAt)}` : ''}`),
    h('details', {}, h('summary', { class: 'meta' }, 'Show URL'), h('div', { class: 'mono', style: { wordBreak: 'break-all' } }, t.url)),
    h('div', { class: 'meta' }, t.body))) : h('p', { class: 'muted' }, 'No trigger.')));
};

function editSchedule(a, s = {}) {
  const name = h('input', { value: s.name || '', disabled: !!s.slug && false });
  const bodyTa = h('textarea', { value: s.body || '', placeholder: 'What the coworker does when it fires, as if you were talking to it.' });
  const kind = h('select', {}, h('option', { value: 'cron', selected: !s.runAt }, 'Recurring (cron)'), h('option', { value: 'once', selected: !!s.runAt }, 'Once, at a date'));
  const cron = h('input', { value: s.cron || '0 9 * * 1', class: 'mono' });
  const runAt = h('input', { type: 'datetime-local', value: s.runAt ? s.runAt.slice(0, 16) : '' });
  const tz = h('input', { value: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone });
  const enabled = h('input', { type: 'checkbox', checked: s.enabled ?? true });
  const presets = h('div', { class: 'options row' }, [['Every weekday 8:00', '0 8 * * 1-5'], ['Every Monday 9:00', '0 9 * * 1'], ['Every hour', '0 * * * *'], ['Every day 7:00', '0 7 * * *']].map(([l, c]) => h('button', { class: 'small', onclick: () => { cron.value = c; } }, l)));
  const sync = () => { cron.parentElement.hidden = kind.value !== 'cron'; runAt.parentElement.hidden = kind.value === 'cron'; };
  kind.onchange = sync;
  const close = modal(s.slug ? `Edit · ${s.name}` : 'New scheduled task', h('div', {},
    h('label', {}, 'Name'), name, h('label', {}, 'Instruction'), bodyTa, h('label', {}, 'When'), kind,
    h('div', {}, h('label', {}, 'Cron ', h('span', { class: 'hint' }, 'minute hour day month weekday')), cron, presets),
    h('div', {}, h('label', {}, 'Date and time'), runAt),
    h('label', {}, 'Timezone (IANA)'), tz, h('label', { class: 'toggle', style: { marginTop: '10px' } }, enabled, 'Enabled'),
    h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: safe(async () => {
      const args = { agentId: a.id, name: name.value, body: bodyTa.value, timezone: tz.value || undefined, enabled: enabled.checked };
      if (s.slug) args.slug = s.slug;
      if (kind.value === 'cron') args.cron = cron.value; else args.runAt = new Date(runAt.value).toISOString();
      await api('upsert_schedule', args); close(); renderPanel(); toast('Saved');
    }) }, 'Save'))));
  sync();
}

function editTrigger(a, t = {}) {
  const name = h('input', { value: t.name || '', placeholder: 'Stripe payment' });
  const bodyTa = h('textarea', { value: t.body || '', placeholder: 'A Stripe payment event arrives. Record it in the payments table and tell me if it is over 500.' });
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', value: m, checked: (t.methods || ['POST']).includes(m) }), m));
  const close = modal('New webhook trigger', h('div', {},
    h('label', {}, 'Name ', h('span', { class: 'hint' }, 'the URL is built from it; it cannot be renamed later')), name,
    h('label', {}, 'Instruction ', h('span', { class: 'hint' }, 'write it as if the event had already happened; the payload is appended')), bodyTa,
    h('label', {}, 'Accepted methods'), h('div', { class: 'toggle-grid' }, methods),
    h('p', { class: 'muted' }, 'Accepting GET means a link preview could fire it. Keep POST unless the caller cannot send it.'),
    h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: safe(async () => {
      await api('upsert_trigger', { agentId: a.id, name: name.value, body: bodyTa.value, methods: methods.map((l) => l.firstChild).filter((c) => c.checked).map((c) => c.value) });
      close(); renderPanel();
    }) }, 'Create'))));
}

/* ---- apps ---- */

VIEWS.apps = async (body, a) => {
  const [{ connectors }, { servers }, { secrets }, { permissions }] = await Promise.all([
    api('search_connectors', { query: '' }), api('list_mcp_servers', { agentId: a.id }), api('list_secrets', { agentId: a.id }), api('list_permissions', { agentId: a.id })]);
  const installed = new Map(servers.filter((s) => s.connector).map((s) => [s.connector, s]));
  body.append(h('div', { class: 'section-title' }, h('h3', {}, 'Installed')));
  if (!servers.length) body.append(h('p', { class: 'muted' }, 'No app yet. Install one below, or ask the coworker: it can search the library and raise a setup card.'));
  body.append(h('div', { class: 'list' }, servers.map((s) => h('div', { class: 'item-row' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, s.name, ' ', h('span', { class: 'muted mono' }, s.transport)),
      h('span', { class: `pill ${s.status === 'active' ? 'ok' : 'warn'}` }, s.status),
      h('button', { class: 'small', onclick: safe(async () => { const r = await api('probe_mcp_server', { agentId: a.id, slug: s.slug }); modal(`${s.name} · tools`, h('div', { class: 'list' }, r.tools.map((t) => h('div', { class: 'item-row' }, h('h4', { class: 'mono' }, t.name), h('div', { class: 'meta' }, t.description || ''))))); }) }, 'Test'),
      s.missingSecrets.length ? h('button', { class: 'small primary', onclick: () => fillSecrets(a, s.missingSecrets) }, 'Connect') : null,
      h('button', { class: 'small danger', onclick: safe(async () => { if (!confirm(`Remove ${s.name}?`)) return; if (s.connector) await api('detach_connector', { agentId: a.id, slug: s.connector, confirm: true }); else await api('delete_mcp_server', { agentId: a.id, slug: s.slug }); renderPanel(); }) }, 'Remove')),
    h('div', { class: 'meta mono' }, s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url),
    s.missingSecrets.length ? h('div', { class: 'meta' }, `Needs: ${s.missingSecrets.join(', ')}`) : null))));

  body.append(h('div', { class: 'section-title', style: { marginTop: '18px' } }, h('h3', {}, 'Library'), h('button', { class: 'small', onclick: () => editMcp(a) }, '+ Custom MCP server')));
  body.append(h('div', { class: 'tpl-grid' }, connectors.map((c) => h('div', { class: 'tpl' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, c.name), h('span', { class: 'pill' }, c.category)),
    h('div', { class: 'meta muted' }, c.description),
    h('div', { class: 'row end' }, installed.has(c.slug) ? h('span', { class: 'pill ok' }, 'installed') : h('button', { class: 'small primary', onclick: safe(async () => {
      const r = await api('attach_connector', { agentId: a.id, slug: c.slug });
      if (r.missingSecrets?.length) fillSecrets(a, r.missingSecrets, c.name); else toast(`${c.name} connected`);
      renderPanel();
    }) }, 'Install'))))));

  body.append(h('div', { class: 'section-title', style: { marginTop: '18px' } }, h('h3', {}, 'Credentials of this coworker'), h('button', { class: 'small', onclick: () => fillSecrets(a, []) }, '+ Variable')));
  body.append(h('p', { class: 'muted' }, 'Values stay on this machine and never reach the model. Reference them as ${NAME} in MCP configs and $NAME in shell commands.'));
  body.append(h('div', { class: 'list' }, secrets.map((s) => h('div', { class: 'item-row row' }, h('span', { class: 'mono grow' }, s.name), h('span', { class: 'meta' }, ago(s.updated_at)), h('button', { class: 'small danger', onclick: safe(async () => { await api('delete_secret', { agentId: a.id, name: s.name }); renderPanel(); }) }, 'Delete')))));
  if (permissions.length) {
    body.append(h('div', { class: 'section-title', style: { marginTop: '18px' } }, h('h3', {}, 'Always allowed')));
    body.append(h('div', { class: 'list' }, permissions.map((p) => h('div', { class: 'item-row row' }, h('span', { class: 'mono grow' }, p.tool), h('button', { class: 'small', onclick: safe(async () => { await api('revoke_permission', { agentId: a.id, tool: p.tool }); renderPanel(); }) }, 'Ask again')))));
  }
};

function fillSecrets(a, names, title) {
  const rows = (names.length ? names : ['']).map((n) => ({ name: h('input', { value: n, class: 'mono', placeholder: 'VARIABLE_NAME', disabled: !!n }), value: h('input', { type: 'password', autocomplete: 'off' }) }));
  const close = modal(title ? `Connect ${title}` : 'Credentials', h('div', {},
    rows.map((r) => h('div', {}, h('label', {}, 'Name'), r.name, h('label', {}, 'Value'), r.value)),
    h('p', { class: 'muted' }, 'Stored on this machine only. The coworker learns that the variable exists, never its value.'),
    h('div', { class: 'row end' }, h('button', { class: 'primary', onclick: safe(async () => {
      for (const r of rows) if (r.name.value && r.value.value) await api('set_secret', { agentId: a.id, name: r.name.value.trim(), value: r.value.value });
      close(); renderPanel(); toast('Saved');
    }) }, 'Save'))));
}

function editMcp(a) {
  const name = h('input', { placeholder: 'My server' });
  const transport = h('select', {}, ['stdio', 'http', 'sse'].map((t) => h('option', { value: t }, t)));
  const command = h('input', { placeholder: 'npx', class: 'mono' });
  const args = h('input', { placeholder: '-y @scope/mcp-server --flag', class: 'mono' });
  const url = h('input', { placeholder: 'https://example.com/mcp', class: 'mono' });
  const headers = h('textarea', { class: 'mono', placeholder: '{"Authorization": "Bearer ${MY_TOKEN}"}', style: { minHeight: '60px' } });
  const env = h('textarea', { class: 'mono', placeholder: '{"API_KEY": "${MY_API_KEY}"}', style: { minHeight: '60px' } });
  const close = modal('Custom MCP server', h('div', {},
    h('p', { class: 'muted' }, 'Anything that speaks the Model Context Protocol works. Reference credentials as ${NAME}; set their values under Credentials.'),
    h('label', {}, 'Name'), name, h('label', {}, 'Transport'), transport,
    h('label', {}, 'Command (stdio)'), command, h('label', {}, 'Arguments (stdio, space-separated)'), args,
    h('label', {}, 'URL (http / sse)'), url, h('label', {}, 'Headers (JSON)'), headers, h('label', {}, 'Environment (JSON, stdio)'), env,
    h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: safe(async () => {
      await api('upsert_mcp_server', { agentId: a.id, name: name.value, transport: transport.value, command: command.value || undefined, args: args.value.trim() ? args.value.trim().split(/\s+/) : [], url: url.value || undefined, headers: headers.value ? JSON.parse(headers.value) : {}, env: env.value ? JSON.parse(env.value) : {} });
      close(); renderPanel();
    }) }, 'Register'))));
}

/* ---- memory ---- */

VIEWS.memory = async (body, a) => {
  const { memories } = await api('list_memories', { agentId: a.id });
  const input = h('input', { placeholder: 'A fact it should always know, e.g. “Never email clients before 9am.”' });
  body.append(h('p', { class: 'muted' }, 'Durable facts the coworker recalls. Unused memories fade; every recall extends their life.'),
    h('div', { class: 'row' }, input, h('button', { class: 'primary', onclick: safe(async () => { if (input.value.trim()) { await api('add_memory', { agentId: a.id, content: input.value }); renderPanel(); } }) }, 'Add')),
    h('div', { class: 'list', style: { marginTop: '12px' } }, memories.length ? memories.map((m) => h('div', { class: 'item-row' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, m.content),
        h('button', { class: 'small', onclick: safe(async () => { const c = prompt('Edit memory', m.content); if (c) { await api('update_memory', { agentId: a.id, id: m.id, content: c }); renderPanel(); } }) }, 'Edit'),
        h('button', { class: 'small danger', onclick: safe(async () => { await api('delete_memory', { agentId: a.id, id: m.id }); renderPanel(); }) }, 'Forget')),
      h('div', { class: 'meta' }, `used ${m.uses}× · ${m.tags ? `${m.tags} · ` : ''}fades ${new Date(m.expires_at).toLocaleDateString()}`))) : h('p', { class: 'muted' }, 'Nothing remembered yet.')));
};

/* ---- database ---- */

VIEWS.data = async (body, a) => dbBrowser(body, { agentId: a.id });

async function dbBrowser(body, scope) {
  const { tables } = scope.agentId ? await api('list_tables', scope) : await api('shared_tables');
  if (!tables.length) { body.append(h('p', { class: 'muted' }, 'No table yet. Coworkers create tables as they work (leads, invoices, tickets…).')); return; }
  let current = tables[0].name, sort = null, desc = false, offset = 0, search = '';
  const holder = h('div');
  const sel = h('select', { onchange: () => { current = sel.value; offset = 0; sort = null; draw(); } }, tables.map((t) => h('option', { value: t.name }, `${t.name} (${t.rows})${t.createdBy ? ` · by ${t.createdBy.startsWith('agt_') ? (state.overview.agents.find((x) => x.id === t.createdBy)?.name || 'a coworker') : t.createdBy}` : ''}`)));
  const searchIn = h('input', { placeholder: 'Search…', oninput: () => { search = searchIn.value; offset = 0; draw(); } });
  const draw = safe(async () => {
    const r = await api('browse_table', { ...scope, table: current, offset, limit: 50, sort, desc, search });
    const cols = r.table.columns.map((c) => c.name);
    const picked = new Set();
    clear(holder).append(
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), cols.map((c) => h('th', { onclick: () => { desc = sort === c ? !desc : false; sort = c; draw(); } }, c, sort === c ? (desc ? ' ↓' : ' ↑') : '')))),
        h('tbody', {}, r.rows.map((row) => h('tr', {}, h('td', {}, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? picked.add(row._rowid) : picked.delete(row._rowid)) })), cols.map((c) => h('td', { title: String(row[c] ?? '') }, String(row[c] ?? '')))))))),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('span', { class: 'muted grow' }, `${r.total} rows`),
        h('button', { class: 'small', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - 50); draw(); } }, '‹ Prev'),
        h('button', { class: 'small', disabled: offset + 50 >= r.total, onclick: () => { offset += 50; draw(); } }, 'Next ›'),
        h('button', { class: 'small', onclick: () => exportRows(current, cols, r.rows, 'csv') }, 'Export CSV'),
        h('button', { class: 'small', onclick: () => exportRows(current, cols, r.rows, 'json') }, 'Export JSON'),
        h('button', { class: 'small danger', onclick: safe(async () => { if (!picked.size || !confirm(`Delete ${picked.size} rows?`)) return; await api('drop_rows', { ...scope, table: current, rowids: [...picked] }); draw(); }) }, 'Delete selected'),
        h('button', { class: 'small danger', onclick: safe(async () => { if (confirm(`Drop the whole table ${current}?`)) { await api('drop_rows', { ...scope, table: current, dropTable: true }); body.innerHTML = ''; dbBrowser(body, scope); } }) }, 'Drop table')));
  });
  body.append(h('div', { class: 'row', style: { marginBottom: '10px' } }, sel, searchIn), holder);
  draw();
}

function exportRows(name, cols, rows, fmt) {
  const data = fmt === 'json' ? JSON.stringify(rows.map(({ _rowid, ...r }) => r), null, 2)
    : [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: fmt === 'json' ? 'application/json' : 'text/csv' })), download: `${name}.${fmt}` });
  a.click();
}

/* ---- files ---- */

VIEWS.files = async (body, a) => fileBrowser(body, { agentId: a.id });

async function fileBrowser(body, scope, dir = '') {
  clear(body);
  const { files } = await api('list_files', { ...scope, path: dir || '.' });
  const upload = h('input', { type: 'file', multiple: true, hidden: true, onchange: safe(async () => {
    for (const f of upload.files) {
      const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
      await api('write_file', { ...scope, path: `${dir ? dir + '/' : ''}${f.name}`, content: b64, encoding: 'base64' });
    }
    fileBrowser(body, scope, dir); toast('Uploaded');
  }) });
  const crumbs = ['', ...dir.split('/').filter(Boolean)];
  body.append(h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('div', { class: 'grow mono' }, crumbs.map((c, i) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); fileBrowser(body, scope, crumbs.slice(1, i + 1).join('/')); } }, i === 0 ? (scope.agentId ? 'workspace' : 'shared') : c, ' / '))),
    upload, h('button', { class: 'small primary', onclick: () => upload.click() }, 'Upload')),
    h('p', { class: 'muted' }, scope.agentId ? 'Drop files here to give the coworker something to work on. Deliverables it produces land here too.' : 'Every coworker reads and writes this folder: it is how they hand files to each other.'));
  if (!files.length) body.append(h('p', { class: 'muted' }, 'Empty.'));
  const dl = (f, inline) => `/api/download?t=${encodeURIComponent(TOKEN)}&path=${encodeURIComponent(f.path)}${scope.agentId ? `&agentId=${scope.agentId}` : ''}${inline ? '&inline=1' : ''}`;
  body.append(h('div', { class: 'list' }, files.map((f) => h('div', { class: 'item-row row' },
    h('span', {}, f.dir ? '📁' : '📄'),
    f.dir ? h('a', { href: '#', class: 'grow', onclick: (e) => { e.preventDefault(); fileBrowser(body, scope, f.path); } }, f.name) : h('a', { href: dl(f, true), target: '_blank', class: 'grow' }, f.name),
    f.published ? h('a', { class: 'pill ok', href: `/p/${f.published}`, target: '_blank' }, 'public link') : null,
    f.dir ? null : h('span', { class: 'meta' }, `${(f.size / 1024).toFixed(1)} KB · ${ago(f.modified)}`),
    f.dir ? null : h('a', { href: dl(f), class: 'small' }, 'Download'),
    h('button', { class: 'small danger', onclick: safe(async () => { if (confirm(`Delete ${f.name}?`)) { await api('delete_file', { ...scope, path: f.path }); fileBrowser(body, scope, dir); } }) }, 'Delete')))));
}

/* ---- runs ---- */

VIEWS.runs = async (body, a) => {
  const { runs } = await api('list_runs', { agentId: a.id, limit: 50 });
  const total = runs.reduce((s, r) => s + (r.costUsd || 0), 0);
  body.append(h('div', { class: 'stat-row', style: { marginBottom: '12px' } },
    h('div', { class: 'stat' }, h('b', {}, runs.length), 'recent runs'),
    h('div', { class: 'stat' }, h('b', {}, runs.filter((r) => r.status === 'error').length), 'errors'),
    h('div', { class: 'stat' }, h('b', {}, runs.reduce((s, r) => s + r.totalTokens, 0).toLocaleString()), 'tokens'),
    h('div', { class: 'stat' }, h('b', {}, `$${total.toFixed(3)}`), 'model cost')));
  body.append(h('div', { class: 'list' }, runs.map((r) => h('details', { class: 'item-row' },
    h('summary', { class: 'row', style: { cursor: 'pointer' } },
      h('span', { class: `pill ${r.status === 'done' ? 'ok' : r.status === 'error' ? 'err' : r.status === 'running' ? 'run' : 'warn'}` }, r.status),
      h('span', { class: 'mono grow' }, r.trigger), h('span', { class: 'meta' }, `${r.steps} steps · ${r.totalTokens.toLocaleString()} tok${r.costUsd != null ? ` · $${r.costUsd.toFixed(4)}` : ''} · ${ago(r.startedAt)}`)),
    h('div', { 'data-run': r.runId }, r.error ? h('div', { class: 'pill err' }, r.error) : null),
    h('div', { class: 'row end' },
      h('button', { class: 'small', onclick: safe(async (e) => {
        const full = await api('get_run', { agentId: a.id, runId: r.runId, includeToolCalls: true });
        e.target.replaceWith(h('div', { style: { width: '100%' } },
          full.output ? h('div', { class: 'bubble', html: md(full.output) }) : null,
          full.toolCalls.map((t) => h('details', { class: `tool${t.isError ? ' err' : ''}` }, h('summary', {}, `#${t.step} `, h('span', { class: 'mono' }, t.tool), h('span', { class: 'muted' }, ` ${t.durationMs} ms`)), h('div', { class: 'io' }, h('pre', { class: 'mono' }, t.input), h('pre', { class: 'mono' }, t.result))))));
      }) }, 'Show steps'),
      h('button', { class: 'small', onclick: () => { state.sessionId = r.sessionId; state.tab = 'chat'; renderPanel(); } }, 'Open conversation'))))));
};

/* ---- settings ---- */

VIEWS.settings = async (body, a) => {
  const { spaces } = state.overview;
  const name = h('input', { value: a.name });
  const handle = h('input', { value: a.handle, class: 'mono' });
  const desc = h('input', { value: a.description || '' });
  const soul = h('textarea', { class: 'code', value: a.soul || '' });
  const verbosity = h('select', {}, ['minimal', 'concise', 'normal', 'detailed'].map((v) => h('option', { value: v, selected: a.verbosity === v }, v)));
  const space = h('select', {}, spaces.map((s) => h('option', { value: s.id, selected: s.id === a.spaceId }, s.name)));
  const toggles = (obj) => Object.entries(obj).map(([k, v]) => { const cb = h('input', { type: 'checkbox', checked: v, 'data-k': k }); return h('label', { class: 'toggle' }, cb, k); });
  const tools = h('div', { class: 'toggle-grid' }, toggles(a.tools));
  const self = h('div', { class: 'toggle-grid' }, toggles(a.selfImprovement));
  const appr = h('div', { class: 'toggle-grid' }, toggles(a.approvals));
  const read = (el) => Object.fromEntries([...el.querySelectorAll('input')].map((i) => [i.dataset.k, i.checked]));
  body.append(
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Name'), name), h('div', { class: 'grow' }, h('label', {}, 'Handle ', h('span', { class: 'hint' }, 'others call it @handle; renaming does not change it')), handle)),
    h('label', {}, 'Description'), desc,
    h('label', {}, 'Soul ', h('span', { class: 'hint' }, 'the system prompt: who it is, what it owns, how it works, what it must never do')), soul,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Answer length'), verbosity), h('div', { class: 'grow' }, h('label', {}, 'Box'), space)),
    h('label', {}, 'Capabilities'), tools,
    h('label', {}, 'Ask me before ', h('span', { class: 'hint' }, 'appWrites = any app tool that is not read-only')), appr,
    h('label', {}, 'Self-improvement'), self,
    h('div', { class: 'row end', style: { marginTop: '14px' } },
      h('button', { class: a.enabled ? '' : 'primary', onclick: safe(async () => { await api('update_agent', { agentId: a.id, enabled: !a.enabled }); renderPanel(); loadBoard(); }) }, a.enabled ? 'Switch off' : 'Switch on'),
      h('button', { onclick: safe(async () => { const t = await api('export_template', { agentIds: [a.id], save: true }); toast(`Saved as local template "${t.name}"`); }) }, 'Save as template'),
      h('button', { onclick: safe(async () => { const s = await api('create_agent_share', { agentId: a.id }); await navigator.clipboard.writeText(location.origin + s.path).catch(() => {}); toast(`Share link copied: ${s.path}`); }) }, 'Share link'),
      h('button', { class: 'danger', onclick: safe(async () => { if (prompt(`Type ${a.handle} to delete this coworker, its skills, memory, files and history.`) === a.handle) { await api('delete_agent', { agentId: a.id, confirm: true }); closePanel(); loadBoard(); } }) }, 'Delete'),
      h('button', { class: 'primary', onclick: safe(async () => {
        await api('update_agent', { agentId: a.id, name: name.value, handle: handle.value, description: desc.value, soul: soul.value, verbosity: verbosity.value, spaceId: space.value, tools: read(tools), selfImprovement: read(self), approvals: read(appr) });
        toast('Saved'); renderPanel(); loadBoard();
      }) }, 'Save')));
};

/* ---------------- workspace dialogs ---------------- */

async function openInbox() {
  const { pauses } = await api('list_pauses', {});
  const agents = new Map(state.overview.agents.map((a) => [a.id, a]));
  const body = h('div', {}, pauses.length ? pauses.map((p) => h('div', {}, h('div', { class: 'row', style: { margin: '10px 14px 0' } }, avatar(agents.get(p.agent_id) || { name: '?' }, 'sm'), h('strong', {}, agents.get(p.agent_id)?.name), h('span', { class: 'muted' }, ago(p.created_at))), pauseCard(p, { onDone: () => { close(); openInbox(); } }))) : h('p', { class: 'muted' }, 'Nothing is waiting for you. 🎉'));
  const close = modal('To handle', body, { wide: true });
}

async function openNotifications() {
  const { notifications } = await api('list_notifications', {});
  modal('Notifications', h('div', {}, h('div', { class: 'row end' }, h('button', { class: 'small', onclick: safe(async () => { await api('mark_notifications_read', { ids: 'all' }); loadBoard(); }) }, 'Mark all read')), notifList(notifications)), { wide: true });
}

async function openTemplates() {
  const { templates } = await api('list_templates');
  const spaces = state.overview.spaces;
  const sel = h('select', {}, spaces.map((s) => h('option', { value: s.id }, s.name)));
  const close = modal('Templates', h('div', {},
    h('p', { class: 'muted' }, 'Start from coworkers that already work. Schedules arrive paused: test with “Run now”, then enable them.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, h('span', {}, 'Install into'), h('div', { style: { width: '220px' } }, sel),
      h('button', { class: 'small', onclick: safe(async () => { const link = prompt('Paste a share link (…/s/<token>) or template JSON URL'); if (!link) return; const t = await (await fetch(link)).json(); const r = await api('install_template', { template: t, spaceId: sel.value }); close(); await loadBoard(); openAgent(r.installed[0].agentId); }) }, 'Install from link')),
    h('div', { class: 'tpl-grid' }, templates.map((t) => h('div', { class: 'tpl' },
      h('div', { class: 'row' }, h('h4', { class: 'grow' }, t.name), h('span', { class: 'pill' }, t.category)),
      h('div', { class: 'muted' }, t.description),
      h('div', { class: 'meta muted', style: { fontSize: '12px' } }, t.agents.map((a) => `${a.name}${a.connectors.length ? ` · apps: ${a.connectors.join(', ')}` : ''}`).join(' — ')),
      h('div', { class: 'row end' }, h('button', { class: 'small primary', onclick: safe(async () => {
        const r = await api('install_template', { slug: t.slug, spaceId: sel.value });
        close(); await loadBoard(); openAgent(r.installed[0].agentId);
        toast(`Installed ${r.installed.map((x) => x.name).join(', ')}`);
      }) }, 'Install'))))) ), { wide: true });
}

async function openKnowledge() {
  let tab = 'files';
  const body = h('div');
  const draw = () => {
    clear(body).append(h('div', { class: 'seg', style: { marginBottom: '12px' } }, [['files', 'Shared folder'], ['db', 'Shared database']].map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; draw(); } }, l))));
    const inner = h('div'); body.append(inner);
    if (tab === 'files') fileBrowser(inner, {}); else dbBrowser(inner, {});
  };
  modal('Knowledge base', body, { wide: true });
  draw();
}

async function openSettings(initial = 'providers') {
  let tab = initial;
  const body = h('div');
  const draw = safe(async () => {
    clear(body).append(h('div', { class: 'seg', style: { marginBottom: '12px' } }, [['providers', 'AI providers'], ['api', 'API & MCP'], ['secrets', 'Workspace secrets']].map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; draw(); } }, l))));
    if (tab === 'providers') await providersView(body, draw);
    if (tab === 'api') await apiView(body, draw);
    if (tab === 'secrets') await workspaceSecrets(body, draw);
  });
  modal('Settings', body, { wide: true, onClose: loadBoard });
  draw();
}

async function providersView(body, redraw) {
  const [{ connections, default: def }, cat] = await Promise.all([api('list_ai_connections'), api('providers_catalog')]);
  body.append(h('p', { class: 'muted' }, 'What your coworkers think with. Each coworker follows the workspace default unless you pick a model for it. Keys stay on this machine.'));
  body.append(h('div', { class: 'list' }, connections.map((c) => h('div', { class: 'item-row' },
    h('div', { class: 'row' }, h('h4', { class: 'grow' }, c.name, ' ', h('span', { class: 'pill' }, cat.providers[c.provider]?.label || c.provider)),
      h('span', { class: `pill ${c.connected ? 'ok' : 'warn'}` }, c.connected ? 'connected' : 'needs key'),
      c.isDefault ? h('span', { class: 'pill ok' }, `default · ${def?.model}`) : null,
      h('button', { class: 'small', onclick: safe(async () => { const r = await api('test_connection', { connectionId: c.id }); toast(`OK · ${r.model}: ${r.reply}`); }) }, 'Test'),
      h('button', { class: 'small', onclick: () => editConnection(c, cat, redraw) }, 'Edit'),
      h('button', { class: 'small danger', onclick: safe(async () => { if (confirm(`Remove ${c.name}?`)) { await api('delete_connection', { connectionId: c.id }); redraw(); } }) }, 'Remove')),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'meta' }, 'Default model:'),
      ...c.models.map((m) => h('button', { class: `small${c.isDefault && def?.model === m ? ' primary' : ''}`, onclick: safe(async () => { await api('set_default_model', { connectionId: c.id, model: m }); redraw(); }) }, m)))))));
  body.append(h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: () => editConnection(null, cat, redraw) }, '+ Add a provider')));
}

function editConnection(c, cat, redraw) {
  const provider = h('select', { disabled: !!c }, Object.entries(cat.providers).map(([k, p]) => h('option', { value: k, selected: c?.provider === k }, p.label)));
  const name = h('input', { value: c?.name || '' });
  const key = h('input', { type: 'password', autocomplete: 'off', placeholder: c?.connected ? '•••••• (unchanged)' : 'API key' });
  const base = h('input', { value: c?.baseUrl || '', class: 'mono' });
  const models = h('input', { value: c?.models?.join(', ') || '', class: 'mono' });
  const sync = () => {
    const p = cat.providers[provider.value];
    if (!c) { base.value = p.defaultBase || ''; models.value = provider.value === 'anthropic' ? cat.anthropicModels.map((m) => m.id).join(', ') : ''; name.placeholder = p.label; }
    key.parentElement.hidden = !p.needsKey; base.parentElement.hidden = !p.defaultBase;
  };
  provider.onchange = sync;
  const close = modal(c ? `Edit ${c.name}` : 'Add an AI provider', h('div', {},
    h('label', {}, 'Provider'), provider, h('label', {}, 'Name'), name,
    h('div', {}, h('label', {}, 'API key'), key),
    h('div', {}, h('label', {}, 'Base URL ', h('span', { class: 'hint' }, 'OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, OpenRouter, a router of your own')), base),
    h('label', {}, 'Models ', h('span', { class: 'hint' }, 'comma-separated ids this connection serves')), models,
    h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: safe(async () => {
      const args = { name: name.value || undefined, apiKey: key.value || undefined, baseUrl: base.value || undefined, models: models.value.split(',').map((s) => s.trim()).filter(Boolean) };
      if (c) await api('update_connection', { connectionId: c.id, ...args }); else await api('create_connection', { provider: provider.value, ...args });
      close(); redraw(); await loadBoard();
    }) }, 'Save'))));
  sync();
}

async function apiView(body, redraw) {
  const { keys } = await api('list_api_keys');
  const endpoint = `${location.origin}/api/mcp/account`;
  body.append(h('p', {}, 'One MCP endpoint to build and drive your coworkers from Claude Code, Codex, Cursor or a script (JSON-RPC 2.0 over POST, same tool names as the Rerun API).'),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Endpoint'), h('span', { class: 'mono' }, endpoint), h('span', { class: 'muted' }, 'Webhooks'), h('span', { class: 'mono' }, `${location.origin}/api/t/{agentId}/{slug}/{token}`)),
    h('div', { class: 'section-title', style: { marginTop: '14px' } }, h('h3', {}, 'API keys'), h('button', { class: 'small primary', onclick: safe(async () => {
      const n = prompt('Key name', 'Claude Code'); if (!n) return;
      const { key } = await api('create_api_key', { name: n });
      modal('Your new API key', h('div', {}, h('p', {}, 'Copy it now: it will not be shown again. It reaches every coworker of this workspace.'),
        h('pre', { class: 'mono', style: { userSelect: 'all', wordBreak: 'break-all', whiteSpace: 'pre-wrap' } }, key),
        h('p', {}, 'Connect Claude Code:'),
        h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } }, `claude mcp add --transport http crewbox ${endpoint} --header "Authorization: Bearer ${key}"`),
        h('p', {}, 'Or with curl:'),
        h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap' } }, `curl -s ${endpoint} -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}'`)));
      redraw();
    }) }, '+ New key')),
    h('div', { class: 'list' }, keys.length ? keys.map((k) => h('div', { class: 'item-row row' }, h('strong', { class: 'grow' }, k.name), h('span', { class: 'mono' }, `${k.prefix}…`), h('span', { class: 'meta' }, `created ${ago(k.created_at)} · used ${ago(k.last_used_at)}`), h('button', { class: 'small danger', onclick: safe(async () => { await api('revoke_api_key', { id: k.id }); redraw(); }) }, 'Revoke'))) : h('p', { class: 'muted' }, 'No key yet.')));
}

async function workspaceSecrets(body, redraw) {
  const { secrets } = await api('list_secrets', {});
  const n = h('input', { class: 'mono', placeholder: 'VARIABLE_NAME' });
  const v = h('input', { type: 'password', autocomplete: 'off', placeholder: 'value' });
  body.append(h('p', { class: 'muted' }, 'Shared by every coworker (a coworker\'s own variable with the same name wins). Reference as ${NAME} in MCP configs, $NAME in shell.'),
    h('div', { class: 'row' }, n, v, h('button', { class: 'primary', onclick: safe(async () => { await api('set_secret', { name: n.value.trim(), value: v.value }); redraw(); }) }, 'Save')),
    h('div', { class: 'list', style: { marginTop: '10px' } }, secrets.map((s) => h('div', { class: 'item-row row' }, h('span', { class: 'mono grow' }, s.name), h('span', { class: 'meta' }, ago(s.updated_at)), h('button', { class: 'small danger', onclick: safe(async () => { await api('delete_secret', { name: s.name }); redraw(); }) }, 'Delete')))));
}

/* ---------------- live updates ---------------- */

let boardTimer, panelTimer;
const refreshBoardSoon = () => { clearTimeout(boardTimer); boardTimer = setTimeout(() => loadBoard().catch(() => {}), 250); };
function refreshPanelSoon(full = false) {
  clearTimeout(panelTimer);
  panelTimer = setTimeout(() => {
    if ($('#panel').hidden) return;
    if (state.tab === 'chat' && $('#messages') && !full) renderSession().catch(() => {});
    else if (state.tab === 'chat') { if (!$('#modal-root').childElementCount) renderPanel().catch(() => {}); }
    else if (!['settings', 'skills'].includes(state.tab) && !$('#modal-root').childElementCount) renderPanel().catch(() => {});
  }, 200);
}

function connectEvents() {
  const es = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`);
  es.onmessage = (e) => {
    const { type, data } = JSON.parse(e.data);
    if (['agents', 'spaces', 'notification', 'pause', 'run'].includes(type)) refreshBoardSoon();
    if (!state.agentId || (data.agentId && data.agentId !== state.agentId)) return;
    if (type === 'delta' && data.sessionId === state.sessionId) {
      state.streaming += data.text;
      const st = $('#stream .bubble');
      if (st) { st.innerHTML = md(state.streaming); const m = $('#messages'); m.scrollTop = m.scrollHeight; }
      else refreshPanelSoon();
    }
    if (type === 'message' && data.sessionId === state.sessionId) {
      if (data.message?.role === 'assistant') state.streaming = '';
      refreshPanelSoon();
    }
    if (type === 'tool') refreshPanelSoon();
    if (type === 'run' || type === 'pause') refreshPanelSoon(true);
    if (type === 'run' && data.status !== 'running' && data.sessionId === state.sessionId) state.streaming = '';
  };
}

/* ---------------- boot ---------------- */

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  ({ inbox: openInbox, notifications: openNotifications, templates: openTemplates, knowledge: openKnowledge, settings: () => openSettings(), 'new-agent': () => openNewAgent() })[action]?.();
});

const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`);
new ResizeObserver(syncTopbar).observe($('.topbar'));
syncTopbar();

loadBoard().then(connectEvents).catch((e) => toast(e.message, true));
