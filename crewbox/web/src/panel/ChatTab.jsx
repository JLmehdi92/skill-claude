import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { md, ago, money } from '../lib/format.js';
import { Select, Button } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import PauseCard from './PauseCard.jsx';
import BlurText from '../reactbits/BlurText.jsx';
import { t } from '../lib/i18n.js';

const KIND_ICON = { chat: 'chat', schedule: 'clock', trigger: 'bolt', agent: 'link', api: 'plug' };
const SUGGESTIONS = () => [t('What can you do for me?'), t('Set up your first scheduled task'), t('Show me what you remember')];

function summarize(input) {
  const v = input && (input.path || input.url || input.query || input.command || input.sql || input.handle || input.name || input.title || input.slug || input.city);
  return v ? String(v).slice(0, 60) : '';
}

function Messages({ session, streaming, running }) {
  const results = new Map();
  for (const m of session.messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
  const items = [];
  session.messages.forEach((m, i) => {
    if (m.role === 'user') {
      const texts = typeof m.content === 'string' ? [m.content] : m.content.filter((b) => b.type === 'text').map((b) => b.text);
      texts.forEach((t, j) => items.push(<div key={`${i}-${j}`} className={`msg user ${session.kind !== 'chat' && i === 0 ? 'auto' : ''}`}>{t}</div>));
      return;
    }
    const parts = (m.content || []).map((b, j) => {
      if (b.type === 'text' && b.text.trim()) return <div key={j} className="bubble md" dangerouslySetInnerHTML={{ __html: md(b.text) }} />;
      if (b.type !== 'tool_use') return null;
      const r = results.get(b.id);
      const text = r ? (typeof r.content === 'string' ? r.content : r.content.map((c) => c.text || `[${c.type}]`).join('\n')) : '';
      return (
        <details key={j} className={`tool ${r ? (r.is_error ? 'err' : 'ok') : 'pending'}`}>
          <summary><span className="tool-state" /> <code>{b.name}</code><span className="muted">{summarize(b.input)}</span></summary>
          <div className="tool-io">
            <span className="muted">{t('Input')}</span><pre>{JSON.stringify(b.input, null, 2)}</pre>
            <span className="muted">{t('Result')}</span><pre>{r ? text : 'waiting…'}</pre>
          </div>
        </details>
      );
    }).filter(Boolean);
    if (parts.length) items.push(<div key={i} className="msg assistant">{parts}</div>);
  });
  if (running) items.push(<div key="stream" className="msg assistant"><div className="bubble md typing" dangerouslySetInnerHTML={{ __html: md(streaming || '') }} /></div>);
  return items;
}

export default function ChatTab({ agent, initialSession }) {
  const { overview, safe, toast } = useApp();
  const [sessions, setSessions] = useState([]);
  const [sid, setSid] = useState(initialSession || null);
  const [session, setSession] = useState(null);
  const [pause, setPause] = useState(null);
  const [streaming, setStreaming] = useState('');
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const seen = useRef(0);
  const timer = useRef();

  const loadSessions = useCallback(async (pick) => {
    const r = await api('list_sessions', { agentId: agent.id });
    setSessions(r.sessions);
    setSid((cur) => pick || cur || r.sessions.find((s) => s.kind === 'chat')?.id || r.sessions[0]?.id || null);
  }, [agent.id]);

  // Events can arrive before the HTTP answer that tells us the session id: always read the
  // current id from a ref, and drop answers for a session we have since left.
  const sidRef = useRef(sid);
  sidRef.current = sid;
  const loadSession = useCallback(async () => {
    const want = sidRef.current;
    if (!want) { setSession(null); setPause(null); return; }
    const s = await api('get_session', { sessionId: want });
    let p = null;
    if (s.pending) p = (await api('list_pauses', { agentId: agent.id })).pauses.find((x) => x.id === s.pending.pauseId) || null;
    if (sidRef.current !== want) return;
    setSession(s);
    setPause(p);
  }, [agent.id]);

  useEffect(() => { seen.current = 0; loadSessions(); }, [loadSessions]);
  useEffect(() => { seen.current = 0; setStreaming(''); loadSession().catch(() => {}); }, [loadSession, sid]);

  useServerEvents((ev) => {
    const d = ev.data || {};
    if (d.agentId && d.agentId !== agent.id) return;
    if (ev.type === 'delta' && d.sessionId === sidRef.current) setStreaming((s) => s + d.text);
    if (ev.type === 'message' && d.sessionId === sidRef.current && d.message?.role === 'assistant') setStreaming('');
    if (['message', 'run', 'pause', 'tool'].includes(ev.type)) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { loadSession().catch(() => {}); if (ev.type === 'run') loadSessions(); }, 150);
    }
  });

  const last = session?.runs.at(-1);
  const running = last?.status === 'running';

  // Animate only the messages that just arrived, then keep the view pinned to the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nodes = el.querySelectorAll('.msg');
    const fresh = [...nodes].slice(seen.current).filter((n) => !n.querySelector('.typing'));
    if (seen.current && fresh.length) gsap.from(fresh, { y: 18, opacity: 0, scale: 0.98, duration: 0.5, ease: 'expo.out', stagger: 0.05 });
    seen.current = [...nodes].filter((n) => !n.querySelector('.typing')).length;
    el.scrollTop = el.scrollHeight;
  }, [session, streaming, pause]);

  const send = safe(async (text = draft) => {
    if (!text.trim()) return;
    setDraft('');
    const r = await api('chat', { agentId: agent.id, message: text, sessionId: sid || undefined });
    setStreaming('');
    if (r.sessionId !== sid) { sidRef.current = r.sessionId; setSid(r.sessionId); loadSessions(r.sessionId); } else loadSession();
  });

  const model = agent.runsOn.followsDefault ? '' : `${agent.runsOn.connectionId}|${agent.runsOn.model}`;
  const setModel = safe(async (v) => {
    const [connectionId, m] = v ? v.split('|') : [];
    await api('update_agent', v ? { agentId: agent.id, connectionId, model: m } : { agentId: agent.id, model: null });
    toast(t('Model updated'));
  });

  return (
    <div className="chat">
      <div className="chat-bar">
        {sessions.length ? (
          <Select value={sid || ''} onChange={(e) => setSid(e.target.value)} aria-label={t('Conversation')}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{`${s.title || 'Conversation'} · ${s.kind} · ${ago(s.updated_at)}`}</option>)}
          </Select>
        ) : <span className="muted grow">{t('No conversation yet')}</span>}
        <Button size="sm" icon="plus" onClick={safe(async () => { const r = await api('new_session', { agentId: agent.id }); loadSessions(r.sessionId); setSid(r.sessionId); })}>{t('New')}</Button>
        <Select value={model} onChange={(e) => setModel(e.target.value)} aria-label={t('Model')} className="model-select">
          <option value="">{t('Default ({model})', { model: agent.runsOn.followsDefault ? agent.runsOn.model : t('workspace') })}</option>
          {overview?.connections.flatMap((c) => c.models.map((m) => <option key={`${c.id}|${m}`} value={`${c.id}|${m}`}>{c.name} — {m}</option>))}
        </Select>
      </div>

      <div className="messages" ref={scroller} data-lenis-prevent>
        {session && session.messages.length ? <Messages session={session} streaming={streaming} running={running} /> : (
          <div className="chat-empty">
            <BlurText text={t('Give {name} a job.', { name: agent.name })} className="chat-empty-title" delay={60} animateBy="words" />
            <div className="suggestions">{SUGGESTIONS().map((s) => <button key={s} className="example" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {pause ? <PauseCard pause={pause} onAnswered={() => loadSession()} /> : null}
      </div>

      <div className="composer">
        <textarea
          data-testid="composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={pause ? t('Answer the card, or type your reply here…') : t('Message {name}…', { name: agent.name })}
          rows={1}
          aria-label={t('Message')}
        />
        {running ? <button className="send stop" onClick={safe(() => api('cancel_run', { runId: last.runId }))} aria-label={t('Stop')}><Icon name="stop" /></button>
          : <button className="send" onClick={() => send()} aria-label={t('Send')} disabled={!draft.trim()}><Icon name="send" /></button>}
      </div>
      {last ? (
        <div className="run-meta">
          <span className={`dot ${running ? 'pulse' : last.status === 'error' ? 'red' : last.status === 'waiting' ? 'amber' : 'green'}`} />
          {last.status} · {last.steps} steps · {(last.totalTokens || 0).toLocaleString()} tokens{last.costUsd != null ? ` · ${money(last.costUsd)}` : ''}{last.error ? ` · ${last.error}` : ''}
        </div>
      ) : null}
    </div>
  );
}
