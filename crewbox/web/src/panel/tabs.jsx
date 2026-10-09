import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { ago, md, money } from '../lib/format.js';
import { Button, AsyncButton, Field, Input, Textarea, Select, Toggle, SectionHead, Empty, Pill } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import PauseCard from './PauseCard.jsx';
import { DbBrowser, FileBrowser } from './browsers.jsx';
import { confirmDialog, prompt } from '../dialogs/Prompt.jsx';
import SpotlightCard from '../reactbits/SpotlightCard.jsx';
import CountUp from '../reactbits/CountUp.jsx';
import { NotificationList } from '../dialogs/Inbox.jsx';
import { t } from '../lib/i18n.js';
import { COLORS } from '../board/iso.js';

/** Load data for a tab and reload it on matching server events. */
function useLoad(fn, deps, events = ['agents', 'run', 'pause']) {
  const [data, setData] = useState(null);
  const load = useCallback(() => fn().then(setData).catch(() => {}), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useServerEvents((ev) => { if (events.includes(ev.type)) load(); });
  return [data, load];
}

/* ---------------- To handle ---------------- */

export function HandleTab({ agent }) {
  const [data] = useLoad(async () => ({ ...(await api('list_pauses', { agentId: agent.id })), ...(await api('list_notifications', { agentId: agent.id })) }), [agent.id], ['pause', 'run', 'notification']);
  if (!data) return null;
  return (
    <div className="stack">
      <SectionHead title={t('Waiting for you')} sub={t('Cards your coworker raised. Nothing is skipped because nobody was watching.')} />
      {data.pauses.length ? data.pauses.map((p) => <PauseCard key={p.id} pause={p} />) : <Empty icon="check">{t('Nothing is waiting for you.')}</Empty>}
      <SectionHead title={t('Notifications')} />
      <NotificationList list={data.notifications} />
    </div>
  );
}

/* ---------------- Skills ---------------- */

function SkillEditor({ agent, slug, close }) {
  const { safe, toast } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => {
    (async () => {
      if (!slug) { setS({ name: '', description: '', body: '', files: [] }); return; }
      const sk = await api('get_skill', { agentId: agent.id, slug });
      const files = await Promise.all(sk.files.map(async (f) => ({ path: f.path, content: (await api('read_skill_file', { agentId: agent.id, slug, path: f.path })).content })));
      setS({ ...sk, files, original: sk.files.map((f) => f.path) });
    })().catch((e) => toast(e.message, true));
  }, [agent.id, slug, toast]);
  if (!s) return null;
  const ro = !!s.readOnly;
  const set = (k, v) => setS({ ...s, [k]: v });
  const save = safe(async () => {
    const removeFiles = (s.original || []).filter((p) => !s.files.some((f) => f.path === p));
    await api('upsert_skill', { agentId: agent.id, slug, name: s.name, description: s.description, body: s.body, files: s.files, removeFiles });
    toast(t('Skill saved')); close();
  });
  return (
    <div className="stack">
      <Field label={t('Name')}><Input value={s.name} disabled={ro} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label={t('Description')} hint={t('a trigger condition: “Use when…”')}><Input value={s.description} disabled={ro} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label={t('Procedure')} hint={t('SKILL.md body')}><Textarea code rows={10} value={s.body} disabled={ro} onChange={(e) => set('body', e.target.value)} /></Field>
      <SectionHead title={t('Reference files')} sub={t('Loaded only when the procedure points at them.')}>
        {ro ? null : <Button size="sm" icon="plus" onClick={() => set('files', [...s.files, { path: `references/file-${s.files.length + 1}.md`, content: '' }])}>{t('File')}</Button>}
      </SectionHead>
      {s.files.map((f, i) => (
        <div className="card-row" key={i}>
          <div className="row"><Input value={f.path} disabled={ro} onChange={(e) => set('files', s.files.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} />{ro ? null : <Button size="sm" variant="danger" icon="trash" onClick={() => set('files', s.files.filter((_, j) => j !== i))} />}</div>
          <Textarea code rows={5} value={f.content} disabled={ro} onChange={(e) => set('files', s.files.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))} />
        </div>
      ))}
      {ro ? <p className="callout">{t('This skill belongs to the app')} <b>{s.connector}</b> and is read-only. Write a skill of your own next to it.</p> : <div className="row end"><Button variant="primary" onClick={save}>{t('Save skill')}</Button></div>}
    </div>
  );
}

export function SkillsTab({ agent }) {
  const { openModal, safe } = useApp();
  const [data, load] = useLoad(() => api('list_skills', { agentId: agent.id }), [agent.id], ['agents']);
  const edit = (slug) => openModal({ title: slug ? t('Skill') : t('New skill'), wide: true, onClose: load, render: (close) => <SkillEditor agent={agent} slug={slug} close={() => { close(); load(); }} /> });
  return (
    <div className="stack">
      <SectionHead title={t('Skills')} sub={t('Procedures it opens only when a task matches the description. Only the one-line index stays in its context.')}>
        <Button variant="primary" size="sm" icon="plus" onClick={() => edit()}>{t('New skill')}</Button>
      </SectionHead>
      {data && !data.skills.length ? <Empty icon="book">{t('No skill yet. Tell the coworker “remember this procedure as a skill”, or write one.')}</Empty> : null}
      <div className="card-grid">
        {data?.skills.map((s) => (
          <SpotlightCard key={s.slug} className="mini-card" spotlightColor="rgba(103, 232, 249, 0.2)" onClick={() => edit(s.slug)}>
            <div className="row between"><strong>{s.name}</strong>{s.readOnly ? <Pill>app · {s.connector}</Pill> : null}</div>
            <p className="muted small">{s.description}</p>
            <div className="row between">
              <code className="muted small">{s.slug}{s.files.length ? ` · ${s.files.length} file${s.files.length > 1 ? 's' : ''}` : ''}</code>
              {s.readOnly ? null : <button className="icon-btn" aria-label={t('Delete')} onClick={safe(async (e) => { e.stopPropagation(); if (await confirmDialog(openModal, { title: t('Delete skill'), text: t('Delete {name}?', { name: s.name }), danger: true, confirmLabel: t('Delete') })) { await api('delete_skill', { agentId: agent.id, slug: s.slug, confirm: true }); load(); } })}><Icon name="trash" size={14} /></button>}
            </div>
          </SpotlightCard>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Automations ---------------- */

const PRESETS = () => [[t('Weekdays 8:00'), '0 8 * * 1-5'], [t('Mondays 9:00'), '0 9 * * 1'], [t('Every hour'), '0 * * * *'], [t('Daily 7:00'), '0 7 * * *']];

function ScheduleEditor({ agent, s = {}, close }) {
  const { safe, toast } = useApp();
  const [f, setF] = useState({ name: s.name || '', body: s.body || '', kind: s.runAt ? 'once' : 'cron', cron: s.cron || '0 9 * * 1', runAt: s.runAt ? s.runAt.slice(0, 16) : '', timezone: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: s.enabled ?? true });
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = safe(async () => {
    const args = { agentId: agent.id, name: f.name, body: f.body, timezone: f.timezone || undefined, enabled: f.enabled, ...(s.slug ? { slug: s.slug } : {}) };
    if (f.kind === 'cron') args.cron = f.cron; else args.runAt = new Date(f.runAt).toISOString();
    await api('upsert_schedule', args); toast(t('Saved')); close();
  });
  return (
    <div className="stack">
      <Field label={t('Name')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('Monday chase')} /></Field>
      <Field label={t('Instruction')} hint={t('the whole prompt of that run')}><Textarea rows={4} value={f.body} onChange={(e) => set('body', e.target.value)} /></Field>
      <Field label={t('When')}><Select value={f.kind} disabled={!!s.slug} onChange={(e) => set('kind', e.target.value)}><option value="cron">{t('Recurring (cron)')}</option><option value="once">{t('Once, at a date')}</option></Select></Field>
      {f.kind === 'cron' ? (
        <Field label={t('Cron')} hint={t('minute hour day month weekday')}>
          <Input className="input mono" value={f.cron} onChange={(e) => set('cron', e.target.value)} />
          <div className="options">{PRESETS().map(([l, c]) => <button key={c} type="button" className={`option ${f.cron === c ? 'on' : ''}`} onClick={() => set('cron', c)}>{l}</button>)}</div>
        </Field>
      ) : <Field label={t('Date and time')}><Input type="datetime-local" value={f.runAt} onChange={(e) => set('runAt', e.target.value)} /></Field>}
      <Field label={t('Timezone')} hint={t('IANA')}><Input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
      <Toggle checked={f.enabled} onChange={(v) => set('enabled', v)} label={t('Enabled')} />
      <div className="row end"><Button variant="primary" onClick={save}>{t('Save')}</Button></div>
    </div>
  );
}

function TriggerEditor({ agent, close }) {
  const { safe } = useApp();
  const [f, setF] = useState({ name: '', body: '', methods: ['POST'] });
  return (
    <div className="stack">
      <Field label={t('Name')} hint={t('the URL is built from it and cannot be renamed later')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('Stripe payment')} /></Field>
      <Field label={t('Instruction')} hint={t('write it as if the event had already happened')}><Textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={t('A Stripe payment event arrives. Record it in the payments table and tell me if it is over 500.')} /></Field>
      <Field label={t('Accepted methods')}>
        <div className="options">{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <button key={m} type="button" className={`option ${f.methods.includes(m) ? 'on' : ''}`} onClick={() => setF({ ...f, methods: f.methods.includes(m) ? f.methods.filter((x) => x !== m) : [...f.methods, m] })}>{m}</button>)}</div>
      </Field>
      <p className="fine">{t('Accepting GET means a link preview could fire it. Keep POST unless the caller cannot send it.')}</p>
      <div className="row end"><Button variant="primary" onClick={safe(async () => { await api('upsert_trigger', { agentId: agent.id, ...f }); close(); })}>{t('Create trigger')}</Button></div>
    </div>
  );
}

export function AutomationsTab({ agent, openChat }) {
  const { openModal, safe, toast } = useApp();
  const [data, load] = useLoad(async () => ({ ...(await api('list_schedules', { agentId: agent.id })), ...(await api('list_triggers', { agentId: agent.id })) }), [agent.id], ['agents', 'run']);
  const editSchedule = (s) => openModal({ title: s ? t('Edit · {name}', { name: s.name }) : t('New scheduled task'), onClose: load, render: (close) => <ScheduleEditor agent={agent} s={s} close={() => { close(); load(); }} /> });
  if (!data) return null;
  return (
    <div className="stack">
      <SectionHead title={t('Scheduled tasks')} sub={t('A cron or a date, plus an instruction. Each run opens its own session; memory and databases carry over.')}>
        <Button variant="primary" size="sm" icon="plus" onClick={() => editSchedule()}>{t('Schedule')}</Button>
      </SectionHead>
      {!data.schedules.length ? <Empty icon="clock">{t('No scheduled task.')}</Empty> : null}
      {data.schedules.map((s) => (
        <div className="card-row" key={s.slug}>
          <div className="row between wrap">
            <div className="row"><Icon name="clock" size={16} /><strong>{s.name}</strong><Pill tone={s.enabled ? 'ok' : ''}>{s.enabled ? t('on') : t('paused')}</Pill></div>
            <div className="row">
              <AsyncButton size="sm" icon="play" onClick={async () => { const r = await api('run_schedule_now', { agentId: agent.id, slug: s.slug }); toast(t('Fired')); openChat(r.sessionId); }}>{t('Run now')}</AsyncButton>
              <Button size="sm" onClick={safe(async () => { await api('upsert_schedule', { agentId: agent.id, slug: s.slug, enabled: !s.enabled }); load(); })}>{s.enabled ? t('Pause') : t('Enable')}</Button>
              <Button size="sm" icon="edit" onClick={() => editSchedule(s)} />
              <Button size="sm" variant="danger" icon="trash" onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Delete scheduled task'), text: s.name, danger: true, confirmLabel: t('Delete') })) { await api('delete_schedule', { agentId: agent.id, slug: s.slug, confirm: true }); load(); } })} />
            </div>
          </div>
          <code className="muted small">{s.cron ? `${s.cron}${s.timezone ? ` · ${s.timezone}` : ''}` : `once at ${s.runAt}`}{s.nextRunAt ? ` · next ${new Date(s.nextRunAt).toLocaleString()}` : ''}{s.lastRunAt ? ` · last ${ago(s.lastRunAt)}` : ''}</code>
          <p className="muted">{s.body}</p>
        </div>
      ))}

      <SectionHead title={t('Webhook triggers')} sub={t('A public URL that starts a run. The URL is the credential: keep it secret, rotate it if it leaks.')}>
        <Button variant="primary" size="sm" icon="plus" onClick={() => openModal({ title: t('New webhook trigger'), onClose: load, render: (close) => <TriggerEditor agent={agent} close={() => { close(); load(); }} /> })}>{t('Trigger')}</Button>
      </SectionHead>
      {!data.triggers.length ? <Empty icon="bolt">{t('No trigger.')}</Empty> : null}
      {data.triggers.map((tr) => (
        <div className="card-row" key={tr.slug}>
          <div className="row between wrap">
            <div className="row"><Icon name="bolt" size={16} /><strong>{tr.name}</strong><Pill tone={tr.enabled ? 'ok' : ''}>{tr.enabled ? t('on') : t('off')}</Pill><Pill>{tr.methods.join(' ')}</Pill></div>
            <div className="row">
              <Button size="sm" icon="copy" onClick={safe(async () => { await navigator.clipboard.writeText(tr.url); toast(t('URL copied')); })}>{t('URL')}</Button>
              <Button size="sm" icon="play" onClick={safe(async () => {
                const payload = await prompt(openModal, { title: t('Test the trigger'), label: t('Payload (JSON or text). This is a real fire.'), value: '{"event": "test"}', multiline: true, confirmLabel: t('Fire') });
                if (payload == null) return;
                let body; try { body = JSON.parse(payload); } catch { body = payload; }
                const r = await api('test_trigger', { agentId: agent.id, slug: tr.slug, body }); openChat(r.sessionId);
              })}>{t('Test')}</Button>
              <Button size="sm" onClick={safe(async () => { await api('upsert_trigger', { agentId: agent.id, slug: tr.slug, enabled: !tr.enabled }); load(); })}>{tr.enabled ? t('Disable') : t('Enable')}</Button>
              <Button size="sm" onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Rotate the URL'), text: t('The current URL stops working immediately; update every service using it.'), confirmLabel: t('Rotate') })) { await api('rotate_trigger_token', { agentId: agent.id, slug: tr.slug }); load(); } })}>{t('Rotate')}</Button>
              <Button size="sm" variant="danger" icon="trash" onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Delete trigger'), text: tr.name, danger: true, confirmLabel: t('Delete') })) { await api('delete_trigger', { agentId: agent.id, slug: tr.slug, confirm: true }); load(); } })} />
            </div>
          </div>
          <code className="muted small">fired {tr.fireCount}×{tr.lastFiredAt ? ` · last ${ago(tr.lastFiredAt)}` : ''}</code>
          <details><summary className="muted small">{t('Show URL')}</summary><code className="break small">{tr.url}</code></details>
          <p className="muted">{tr.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Apps ---------------- */

function SecretsEditor({ agent, names, close }) {
  const { safe, toast } = useApp();
  const [rows, setRows] = useState((names.length ? names : ['']).map((n) => ({ name: n, value: '', fixed: !!n })));
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <Input className="input mono" placeholder={t('VARIABLE_NAME')} value={r.name} disabled={r.fixed} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input type="password" autoComplete="off" placeholder={t('value')} value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
        </div>
      ))}
      <p className="fine">{t('Stored on this machine only. The coworker learns that the variable exists, never its value.')}</p>
      <div className="row end"><Button variant="primary" onClick={safe(async () => { for (const r of rows) if (r.name && r.value) await api('set_secret', { agentId: agent.id, name: r.name.trim(), value: r.value }); toast(t('Saved')); close(); })}>{t('Save')}</Button></div>
    </div>
  );
}

function McpEditor({ agent, close }) {
  const { safe } = useApp();
  const [f, setF] = useState({ name: '', transport: 'stdio', command: '', args: '', url: '', headers: '', env: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      <p className="fine">{t('Anything that speaks the Model Context Protocol works. Reference credentials as')} <code>{'${NAME}'}</code> and set their values under Credentials.</p>
      <div className="row"><Field label={t('Name')}><Input value={f.name} onChange={set('name')} /></Field><Field label={t('Transport')}><Select value={f.transport} onChange={set('transport')}><option>stdio</option><option>http</option><option>sse</option></Select></Field></div>
      {f.transport === 'stdio' ? (
        <>
          <Field label={t('Command')}><Input className="input mono" value={f.command} onChange={set('command')} placeholder={t('npx')} /></Field>
          <Field label={t('Arguments')} hint={t('space-separated')}><Input className="input mono" value={f.args} onChange={set('args')} placeholder={t('-y @scope/mcp-server')} /></Field>
          <Field label={t('Environment')} hint={t('JSON')}><Textarea code rows={3} value={f.env} onChange={set('env')} placeholder='{"API_KEY": "${MY_API_KEY}"}' /></Field>
        </>
      ) : (
        <>
          <Field label={t('URL')}><Input className="input mono" value={f.url} onChange={set('url')} placeholder={t('https://example.com/mcp')} /></Field>
          <Field label={t('Headers')} hint={t('JSON')}><Textarea code rows={3} value={f.headers} onChange={set('headers')} placeholder='{"Authorization": "Bearer ${MY_TOKEN}"}' /></Field>
        </>
      )}
      <div className="row end"><Button variant="primary" onClick={safe(async () => {
        await api('upsert_mcp_server', { agentId: agent.id, name: f.name, transport: f.transport, command: f.command || undefined, args: f.args.trim() ? f.args.trim().split(/\s+/) : [], url: f.url || undefined, headers: f.headers ? JSON.parse(f.headers) : {}, env: f.env ? JSON.parse(f.env) : {} });
        close();
      })}>{t('Register')}</Button></div>
    </div>
  );
}

export function AppsTab({ agent }) {
  const { openModal, safe, toast } = useApp();
  const [data, load] = useLoad(async () => ({
    ...(await api('search_connectors', { query: '' })), ...(await api('list_mcp_servers', { agentId: agent.id })),
    ...(await api('list_secrets', { agentId: agent.id })), ...(await api('list_permissions', { agentId: agent.id })),
  }), [agent.id], ['agents']);
  const [query, setQuery] = useState('');
  const secrets = (names, title) => openModal({ title: title ? t('Connect {name}', { name: title }) : t('Credentials'), onClose: load, render: (close) => <SecretsEditor agent={agent} names={names} close={() => { close(); load(); }} /> });
  if (!data) return null;
  const installed = new Set(data.servers.map((s) => s.connector).filter(Boolean));
  const lib = data.connectors.filter((c) => `${c.name} ${c.category} ${c.description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="stack">
      <SectionHead title={t('Installed')} sub={t('Each app is an MCP server plus a skill on how to use it.')} />
      {!data.servers.length ? <Empty icon="plug">{t('No app yet. Install one below, or ask the coworker: it searches the library and raises a setup card.')}</Empty> : null}
      {data.servers.map((s) => (
        <div className="card-row" key={s.slug}>
          <div className="row between wrap">
            <div className="row"><Icon name="plug" size={16} /><strong>{s.name}</strong><Pill tone={s.status === 'active' ? 'ok' : 'warn'}>{t(s.status)}</Pill></div>
            <div className="row">
              <AsyncButton size="sm" onClick={async () => { const r = await api('probe_mcp_server', { agentId: agent.id, slug: s.slug }); openModal({ title: t('{name} · {n} tools', { name: s.name, n: r.tools.length }), render: () => <div className="stack">{r.tools.map((x) => <div className="card-row" key={x.name}><code>{x.name}</code><p className="muted small">{x.description}</p></div>)}</div> }); }}>{t('Test')}</AsyncButton>
              {s.missingSecrets.length ? <Button size="sm" variant="primary" icon="key" onClick={() => secrets(s.missingSecrets, s.name)}>{t('Connect')}</Button> : null}
              <Button size="sm" variant="danger" icon="trash" onClick={safe(async () => { if (!(await confirmDialog(openModal, { title: t('Remove {name}', { name: s.name }), text: t('Its tools and skill go away with it.'), danger: true, confirmLabel: t('Remove') }))) return; if (s.connector) await api('detach_connector', { agentId: agent.id, slug: s.connector, confirm: true }); else await api('delete_mcp_server', { agentId: agent.id, slug: s.slug }); load(); })} />
            </div>
          </div>
          <code className="muted small break">{s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}</code>
        </div>
      ))}

      <SectionHead title={t('Library')}>
        <div style={{ width: 200 }}><Input placeholder={t('Search apps…')} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <Button size="sm" icon="plus" onClick={() => openModal({ title: t('Custom MCP server'), onClose: load, render: (close) => <McpEditor agent={agent} close={() => { close(); load(); }} /> })}>{t('Custom MCP')}</Button>
      </SectionHead>
      <div className="card-grid">
        {lib.map((c) => (
          <SpotlightCard key={c.slug} className="mini-card" spotlightColor="rgba(167, 139, 250, 0.22)">
            <div className="row between"><strong>{c.name}</strong><Pill>{c.category}</Pill></div>
            <p className="muted small">{c.description}</p>
            <div className="row end">
              {installed.has(c.slug) ? <Pill tone="ok">{t('installed')}</Pill> : <AsyncButton size="sm" variant="primary" onClick={async () => { const r = await api('attach_connector', { agentId: agent.id, slug: c.slug }); if (r.missingSecrets?.length) secrets(r.missingSecrets, c.name); else toast(t('{name} connected', { name: c.name })); load(); }}>{t('Install')}</AsyncButton>}
            </div>
          </SpotlightCard>
        ))}
      </div>

      <SectionHead title={t('Credentials')} sub="Values stay on this machine and never reach the model. ${NAME} in MCP configs, $NAME in shell.">
        <Button size="sm" icon="plus" onClick={() => secrets([])}>{t('Variable')}</Button>
      </SectionHead>
      {data.secrets.map((s) => (
        <div className="file-row" key={s.name}><Icon name="key" size={15} /><code className="grow">{s.name}</code><span className="muted small">{ago(s.updated_at)}</span><button className="icon-btn" aria-label={t('Delete')} onClick={safe(async () => { await api('delete_secret', { agentId: agent.id, name: s.name }); load(); })}><Icon name="trash" size={14} /></button></div>
      ))}
      {data.permissions.length ? <SectionHead title={t('Always allowed')} sub={t('Tools that run without asking.')} /> : null}
      {data.permissions.map((p) => (
        <div className="file-row" key={p.tool}><Icon name="check" size={15} /><code className="grow">{p.tool}</code><Button size="sm" onClick={safe(async () => { await api('revoke_permission', { agentId: agent.id, tool: p.tool }); load(); })}>{t('Ask again')}</Button></div>
      ))}
    </div>
  );
}

/* ---------------- Memory ---------------- */

export function MemoryTab({ agent }) {
  const { safe, openModal } = useApp();
  const [data, load] = useLoad(() => api('list_memories', { agentId: agent.id }), [agent.id], ['run']);
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <SectionHead title={t('Memory')} sub={t('Durable facts it recalls. Unused memories fade; every recall extends their life.')} />
      <form className="row" onSubmit={safe(async (e) => { e.preventDefault(); if (!text.trim()) return; await api('add_memory', { agentId: agent.id, content: text }); setText(''); load(); })}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('“Never email clients before 9am.”')} />
        <Button variant="primary" type="submit" icon="plus">{t('Add')}</Button>
      </form>
      {data && !data.memories.length ? <Empty icon="brain">{t('Nothing remembered yet. Correct it once and it remembers.')}</Empty> : null}
      <div className="memory-list">
        {data?.memories.map((m) => {
          const life = Math.max(0.05, Math.min(1, (Date.parse(m.expires_at) - Date.now()) / (45 * 86400_000)));
          return (
            <div className="memory" key={m.id}>
              <p>{m.content}</p>
              <div className="row between">
                <span className="life" title={`fades ${new Date(m.expires_at).toLocaleDateString()}`}><i style={{ width: `${life * 100}%` }} /></span>
                <span className="muted small">used {m.uses}×{m.tags ? ` · ${m.tags}` : ''}</span>
                <div className="row">
                  <button className="icon-btn" aria-label={t('Edit')} onClick={safe(async () => { const c = await prompt(openModal, { title: t('Edit memory'), label: t('Memory'), value: m.content, multiline: true }); if (c) { await api('update_memory', { agentId: agent.id, id: m.id, content: c }); load(); } })}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" aria-label={t('Forget')} onClick={safe(async () => { await api('delete_memory', { agentId: agent.id, id: m.id }); load(); })}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Data / Files ---------------- */

export const DataTab = ({ agent }) => <DbBrowser agentId={agent.id} />;
export const FilesTab = ({ agent }) => <FileBrowser agentId={agent.id} />;

/* ---------------- Runs ---------------- */

function RunSteps({ agent, runId }) {
  const [run, setRun] = useState(null);
  useEffect(() => { api('get_run', { agentId: agent.id, runId, includeToolCalls: true }).then(setRun).catch(() => {}); }, [agent.id, runId]);
  if (!run) return <p className="muted small">{t('Loading…')}</p>;
  return (
    <div className="stack">
      {run.output ? <div className="bubble md" dangerouslySetInnerHTML={{ __html: md(run.output) }} /> : null}
      {run.toolCalls.map((tc, i) => (
        <details key={i} className={`tool ${tc.isError ? 'err' : 'ok'}`}>
          <summary><span className="tool-state" /> <span className="muted">#{tc.step}</span> <code>{tc.tool}</code><span className="muted">{tc.durationMs} ms</span></summary>
          <div className="tool-io"><pre>{tc.input}</pre><pre>{tc.result}</pre></div>
        </details>
      ))}
    </div>
  );
}

export function RunsTab({ agent, openChat }) {
  const [data] = useLoad(() => api('list_runs', { agentId: agent.id, limit: 50 }), [agent.id], ['run']);
  const [open, setOpen] = useState(null);
  if (!data) return null;
  const runs = data.runs;
  const cost = runs.reduce((s, r) => s + (r.costUsd || 0), 0);
  return (
    <div className="stack">
      <div className="kpis">
        {[[runs.length, 'recent runs'], [runs.filter((r) => r.status === 'error').length, 'errors'], [runs.reduce((s, r) => s + r.totalTokens, 0), 'tokens']].map(([n, l]) => <div className="kpi" key={l}><b><CountUp to={n} separator="," duration={1.2} /></b><span>{l}</span></div>)}
        <div className="kpi"><b>{money(cost)}</b><span>model cost</span></div>
      </div>
      {!runs.length ? <Empty icon="pulse">{t('No run yet.')}</Empty> : null}
      <div className="timeline">
        {runs.map((r) => (
          <div className={`tl-item st-${r.status}`} key={r.runId}>
            <span className="tl-dot" />
            <div className="tl-body">
              <button className="tl-head" onClick={() => setOpen(open === r.runId ? null : r.runId)}>
                <code>{r.trigger}</code>
                <Pill tone={r.status === 'done' ? 'ok' : r.status === 'error' ? 'bad' : r.status === 'running' ? 'run' : 'warn'}>{t(r.status)}</Pill>
                <span className="muted small grow right">{r.steps} steps · {r.totalTokens.toLocaleString()} tok{r.costUsd != null ? ` · ${money(r.costUsd)}` : ''} · {ago(r.startedAt)}</span>
              </button>
              {r.error ? <p className="bad small">{r.error}</p> : null}
              {open === r.runId ? <><RunSteps agent={agent} runId={r.runId} /><Button size="sm" icon="chat" onClick={() => openChat(r.sessionId)}>{t('Open conversation')}</Button></> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */

export function SettingsTab({ agent }) {
  const ctx = useApp();
  const { overview, safe, toast, refresh, openModal, closeAgent } = ctx;
  const [f, setF] = useState({ name: agent.name, handle: agent.handle, description: agent.description || '', soul: agent.soul || '', verbosity: agent.verbosity, spaceId: agent.spaceId, color: agent.color || null, tools: agent.tools, selfImprovement: agent.selfImprovement, approvals: agent.approvals });
  const set = (k, v) => setF({ ...f, [k]: v });
  const flags = (key) => (
    <div className="flag-grid">{Object.entries(f[key]).map(([k, v]) => <Toggle key={k} checked={v} label={k} onChange={(val) => set(key, { ...f[key], [k]: val })} />)}</div>
  );
  return (
    <div className="stack">
      <div className="row">
        <Field label={t('Name')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('Handle')} hint={t('others call it @handle')}><Input className="input mono" value={f.handle} onChange={(e) => set('handle', e.target.value)} /></Field>
      </div>
      <Field label={t('Description')}><Input value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label={t('Soul')} hint={t('who it is, what it owns, how it works, what it must never do')}><Textarea code rows={12} value={f.soul} onChange={(e) => set('soul', e.target.value)} /></Field>
      <div className="row">
        <Field label={t('Answer length')}><Select value={f.verbosity} onChange={(e) => set('verbosity', e.target.value)}>{['minimal', 'concise', 'normal', 'detailed'].map((v) => <option key={v}>{v}</option>)}</Select></Field>
        <Field label={t('Box')}><Select value={f.spaceId} onChange={(e) => set('spaceId', e.target.value)}>{overview?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      </div>
      <Field label={t('Colour on the board')}>
        <div className="swatches" role="radiogroup" aria-label={t('Colour on the board')}>
          <button type="button" role="radio" aria-checked={!f.color} className={`swatch auto ${f.color ? '' : 'on'}`} onClick={() => set('color', null)}>{t('Auto')}</button>
          {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} className={`swatch ${f.color === c ? 'on' : ''}`} style={{ '--c': c }} onClick={() => set('color', c)} />)}
        </div>
      </Field>
      <SectionHead title={t('Capabilities')} sub={t('Families of tools. Turn off what it has no business doing.')} />
      {flags('tools')}
      <SectionHead title={t('Ask me before')} sub={t('appWrites = any app tool that is not read-only.')} />
      {flags('approvals')}
      <SectionHead title={t('Self-improvement')} />
      {flags('selfImprovement')}
      <div className="row end wrap sticky-actions">
        <Button onClick={safe(async () => { await api('update_agent', { agentId: agent.id, enabled: !agent.enabled }); refresh(); })}>{agent.enabled ? t('Switch off') : t('Switch on')}</Button>
        <Button icon="book" onClick={safe(async () => { const tpl = await api('export_template', { agentIds: [agent.id], save: true }); toast(t('Saved as local template “{name}”', { name: tpl.name })); })}>{t('Save as template')}</Button>
        <Button icon="link" onClick={safe(async () => { const s = await api('create_agent_share', { agentId: agent.id }); await navigator.clipboard.writeText(location.origin + s.path).catch(() => {}); toast(t('Share link copied: {path}', { path: s.path })); })}>{t('Share link')}</Button>
        <Button variant="danger" icon="trash" onClick={safe(async () => {
          if (!(await confirmDialog(openModal, { title: t('Delete {name}', { name: agent.name }), text: t('Its skills, memory, files, schedules and history are deleted for good.'), typeToConfirm: agent.handle, danger: true, confirmLabel: t('Delete') }))) return;
          await api('delete_agent', { agentId: agent.id, confirm: true }); closeAgent(); refresh();
        })}>{t('Delete')}</Button>
        <Button variant="primary" icon="check" onClick={safe(async () => { await api('update_agent', { agentId: agent.id, ...f }); toast(t('Saved')); refresh(); })}>{t('Save')}</Button>
      </div>
    </div>
  );
}
