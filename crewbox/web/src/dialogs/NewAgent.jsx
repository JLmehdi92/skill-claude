import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Button, Field, Input, Textarea, Select, Segmented } from '../ui/kit.jsx';
import StarBorder from '../reactbits/StarBorder.jsx';
import Icon from '../ui/icons.jsx';
import { t } from '../lib/i18n.js';

function NewAgentBody({ spaceId, close }) {
  const { overview, refresh, openAgent, toast, safe } = useApp();
  const [mode, setMode] = useState('describe');
  const [space, setSpace] = useState(spaceId || overview?.spaces[0]?.id);
  const [job, setJob] = useState('');
  const [f, setF] = useState({ name: '', description: '', soul: '' });
  const [busy, setBusy] = useState(false);

  const build = safe(async () => {
    setBusy(true);
    try {
      const r = await api('build_agent', { description: job, spaceId: space, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      close(); await refresh(); openAgent(r.agentId);
      toast(r.drafted === 'model' ? `${r.name} set itself up. Schedules start paused.` : `${r.name} created.`);
    } finally { setBusy(false); }
  });
  const blank = safe(async () => {
    const r = await api('create_agent', { ...f, spaceId: space });
    close(); await refresh(); openAgent(r.agentId);
  });

  return (
    <div className="stack">
      <Segmented value={mode} onChange={setMode} options={[['describe', t('Describe the job')], ['blank', t('Start blank')]]} />
      {mode === 'describe' ? (
        <>
          <Field label={t('What is the job?')} hint={t('in your own words — it writes its own prompt, skills and schedule')}>
            <Textarea autoFocus rows={5} value={job} onChange={(e) => setJob(e.target.value)} placeholder={t('Every morning, find 20 SaaS companies in France that just started hiring salespeople and add them to my leads table.')} />
          </Field>
          <Field label={t('Box')}><Select value={space} onChange={(e) => setSpace(e.target.value)}>{overview?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <div className="row end">
            <StarBorder as="button" className="cta sm" color="#67e8f9" speed="4s" onClick={build} disabled={busy || !job.trim()}>
              <Icon name="sparkles" size={15} /> {busy ? t('Setting itself up…') : t('Create coworker')}
            </StarBorder>
          </div>
        </>
      ) : (
        <>
          <Field label={t('Name')}><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Margo · Invoice Chasing')} /></Field>
          <Field label={t('Description')}><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t('One line on what it is for')} /></Field>
          <Field label={t('Soul')} hint={t('the system prompt, in markdown')}><Textarea code rows={10} value={f.soul} onChange={(e) => setF({ ...f, soul: e.target.value })} placeholder={'# Who you are\n…\n# How you work\n…\n# Rules\n…'} /></Field>
          <Field label={t('Box')}><Select value={space} onChange={(e) => setSpace(e.target.value)}>{overview?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <div className="row end"><Button variant="primary" onClick={blank} disabled={!f.name.trim()}>{t('Create')}</Button></div>
        </>
      )}
    </div>
  );
}

export function openNewAgent(ctx, spaceId) {
  ctx.openModal({ title: t('New coworker'), render: (close) => <NewAgentBody spaceId={spaceId} close={close} /> });
}
