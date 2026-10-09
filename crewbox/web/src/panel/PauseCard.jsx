import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import BorderGlow from '../reactbits/BorderGlow.jsx';
import { Button, AsyncButton, Input, Field, Toggle } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { t } from '../lib/i18n.js';
import ConnectApp from './ConnectApp.jsx';

const KIND = () => ({
  question: ['question', t('A question for you')],
  approval: ['hand', t('Approval required')],
  connector: ['plug', t('Connect an app')],
  secret: ['key', t('A credential is needed')],
});

function QuestionItem({ item, value, set }) {
  return (item.input.questions || []).map((q, qi) => {
    const cur = value.answers?.[qi];
    const pick = (o) => {
      const answers = [...(value.answers || [])];
      if (q.multiple) { const s = new Set([].concat(cur || [])); s.has(o) ? s.delete(o) : s.add(o); answers[qi] = [...s]; }
      else answers[qi] = o;
      set({ ...value, answers });
    };
    return (
      <div className="pause-q" key={qi}>
        <strong>{q.question}</strong>
        {q.options?.length ? (
          <div className="options">
            {q.options.map((o, oi) => {
              const on = q.multiple ? [].concat(cur || []).includes(o) : cur === o;
              return <button key={o} className={`option ${on ? 'on' : ''}`} onClick={() => pick(o)}><kbd>{oi + 1}</kbd>{o}</button>;
            })}
          </div>
        ) : null}
        <Input placeholder={t('Something else…')} value={typeof cur === 'string' && !q.options?.includes(cur) ? cur : ''} onChange={(e) => { const answers = [...(value.answers || [])]; answers[qi] = e.target.value; set({ ...value, answers }); }} />
      </div>
    );
  });
}

function ApprovalItem({ item, value, set }) {
  const decisions = value.decisions || (item.input.actions || []).map(() => 'decline');
  return (item.input.actions || []).map((act, i) => (
    <div className="pause-q" key={i}>
      <strong>{act.title}</strong>
      {act.detail ? <pre className="detail">{act.detail}</pre> : null}
      <div className="options">
        {['decline', 'approve'].map((d) => (
          <button key={d} className={`option ${decisions[i] === d ? (d === 'approve' ? 'on ok' : 'on bad') : ''}`} onClick={() => { const n = [...decisions]; n[i] = d; set({ ...value, decisions: n }); }}>
            {d === 'approve' ? t('Approve') : t('Decline')}
          </button>
        ))}
      </div>
    </div>
  ));
}

function GateItem({ item, value, set }) {
  const d = value.decision || 'deny';
  return (
    <div className="pause-q">
      <strong>{t('Run')} <code>{item.tool}</code>{item.app ? <span className="muted"> · {item.app}</span> : null}</strong>
      <pre className="detail">{JSON.stringify(item.input, null, 2)}</pre>
      <div className="options">
        {[['once', t('Allow once')], ['session', t('This session')], ['always', t('Always')], ['deny', t('Deny')]].map(([k, l]) => (
          <button key={k} className={`option ${d === k ? (k === 'deny' ? 'on bad' : 'on ok') : ''}`} onClick={() => set({ decision: k })}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function SecretItem({ item, value, set }) {
  return (
    <div className="pause-q">
      <Field label={item.input.label || item.input.name} hint={item.input.reason}>
        <Input type="password" autoComplete="off" placeholder={item.input.name} value={value.value || ''} onChange={(e) => set({ value: e.target.value })} />
      </Field>
      <p className="fine">{t('Stored on this machine as')} <code>{item.input.name}</code>. The coworker never sees the value.</p>
    </div>
  );
}

function ConnectorItem({ item, value, set, agentId }) {
  return (
    <div className="pause-q">
      {item.input.reason ? <p className="muted">{item.input.reason}</p> : null}
      {!value.skip ? <ConnectApp asCard agentId={agentId} slug={item.input.slug} value={value} onChange={(v) => set({ ...v, skip: false })} /> : null}
      <Toggle checked={!!value.skip} onChange={(v) => set({ ...value, skip: v })} label={t('Skip for now')} />
    </div>
  );
}

const ITEMS = { question: QuestionItem, approval: ApprovalItem, gate: GateItem, secret: SecretItem, connector: ConnectorItem };

export default function PauseCard({ pause, onAnswered }) {
  const { safe, refreshSoon } = useApp();
  const [answers, setAnswers] = useState({});
  const kinds = KIND();
  const [icon, title] = kinds[pause.kind] || kinds.question;
  const send = safe(async () => {
    const r = await api('answer_pause', { pauseId: pause.id, answers });
    refreshSoon();
    onAnswered?.(r);
  });
  return (
    <div data-testid="pause-card"><BorderGlow className="pause-card" backgroundColor="#140f1f" borderRadius={22} glowRadius={36} animated colors={['#fbbf24', '#f472b6', '#a78bfa']} glowColor="45 95 70">
      <div className="pause-inner">
        <header className="pause-head"><span className="pause-icon"><Icon name={icon} size={18} /></span><h4>{title}</h4></header>
        {pause.payload.items.map((it) => {
          const C = ITEMS[it.kind];
          return C ? <div className="pause-item" key={it.toolUseId}><C item={it} agentId={pause.agent_id} value={answers[it.toolUseId] || {}} set={(v) => setAnswers((a) => ({ ...a, [it.toolUseId]: v }))} /></div> : null;
        })}
        <div className="row end">
          <Button size="sm" onClick={safe(async () => { await api('cancel_run', { runId: pause.run_id }); refreshSoon(); onAnswered?.(null); })}>{t('Cancel run')}</Button>
          <AsyncButton variant="primary" icon="send" onClick={send}>{t('Send answer')}</AsyncButton>
        </div>
      </div>
    </BorderGlow></div>
  );
}
