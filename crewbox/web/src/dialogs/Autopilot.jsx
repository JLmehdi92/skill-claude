import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { t } from '../lib/i18n.js';
import { Button, Input, Toggle, SectionHead, Pill, Empty } from '../ui/kit.jsx';
import { ago } from '../lib/format.js';

const EXAMPLES = () => [
  t('Approve cold emails to new leads, at most 30 a day.'),
  t('Approve replies to customers that only answer a question from the FAQ.'),
  t('Never approve a refund, a payment or a deletion.'),
];

/** Autopilot: plain-sentence rules that answer the coworkers' cards for you. */
export function AutopilotPanel() {
  const { safe, toast } = useApp();
  const [data, setData] = useState(null);
  const [rules, setRules] = useState([]);
  const load = useCallback(() => api('get_autopilot').then((d) => { setData(d); setRules(d.rules.length ? d.rules : ['']); }), []);
  useEffect(() => { load(); }, [load]);
  useServerEvents((ev) => { if (ev.type === 'autopilot') api('get_autopilot').then(setData); });
  if (!data) return null;
  const saveRules = safe(async () => { await api('set_autopilot', { rules: rules.filter((r) => r.trim()) }); toast(t('Saved')); load(); });
  return (
    <div className="stack" data-testid="autopilot">
      <div className="row between wrap">
        <p className="muted grow">{t('Autopilot answers your coworkers within your rules: when a card is covered by one of them, it decides for you and tells you why. Everything else, and every credential, still waits for you.')}</p>
        <Toggle checked={data.enabled} label={data.enabled ? t('On') : t('Off')} onChange={safe(async (v) => { await api('set_autopilot', { enabled: v }); load(); })} />
      </div>
      <SectionHead title={t('Your rules')} sub={t('Plain sentences. Autopilot only acts when a rule clearly covers the card.')} />
      <div className="ap-rules">
        {rules.map((r, i) => (
          <div className="ap-rule" key={i}>
            <Input value={r} placeholder={EXAMPLES()[i % 3]} aria-label={t('Rule {n}', { n: i + 1 })} onChange={(e) => setRules(rules.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="icon-btn" aria-label={t('Delete')} onClick={() => setRules(rules.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div className="row between wrap">
          <Button size="sm" icon="plus" onClick={() => setRules([...rules, ''])}>{t('Add a rule')}</Button>
          <Button size="sm" variant="primary" icon="check" onClick={saveRules}>{t('Save rules')}</Button>
        </div>
      </div>
      <SectionHead title={t('Recent decisions')} />
      {!data.log.length ? <Empty icon="check">{t('No decision yet.')}</Empty> : (
        <div className="ap-log">
          {data.log.map((l) => (
            <div className="ap-entry" key={l.id}>
              <Pill tone={l.decision === 'answered' ? 'ok' : ''}>{l.decision === 'answered' ? t('answered') : t('left to you')}</Pill>
              <div><strong>{l.agent_name || ''}</strong> <span className="muted">{l.reason}</span></div>
              <span className="muted small">{ago(l.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
