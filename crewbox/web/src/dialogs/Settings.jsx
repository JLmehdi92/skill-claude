import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { ago } from '../lib/format.js';
import { Button, AsyncButton, Field, Input, Select, Segmented, SectionHead, Empty, Pill } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { confirmDialog, prompt } from './Prompt.jsx';
import { t } from '../lib/i18n.js';
import { AutopilotPanel } from './Autopilot.jsx';

function ConnectionEditor({ conn, cat, done }) {
  const { safe, refresh } = useApp();
  const [f, setF] = useState({ provider: conn?.provider || 'claude-subscription', name: conn?.name || '', apiKey: '', baseUrl: conn?.baseUrl || '', models: conn?.models?.join(', ') || 'claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5' });
  const p = cat.providers[f.provider];
  const setProvider = (provider) => setF({ ...f, provider, baseUrl: cat.providers[provider].defaultBase || '', models: provider === 'anthropic' ? cat.anthropicModels.map((m) => m.id).join(', ') : provider === 'claude-subscription' ? 'claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5' : '' });
  return (
    <div className="stack">
      <Field label={t('Provider')}><Select value={f.provider} disabled={!!conn} onChange={(e) => setProvider(e.target.value)}>{Object.entries(cat.providers).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
      <Field label={t('Name')}><Input value={f.name} placeholder={p.label} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      {f.provider === 'claude-subscription' ? (
        <div className="callout stack-sm">
          <strong>{t('Use your Claude plan')}</strong>
          <span>{t('Your coworkers run through Claude Code with your Pro or Max subscription: no API key, usage counts against your plan.')}</span>
          <span>{t('On this machine, run this once in a terminal and paste the token below:')}</span>
          <code className="code-inline">claude setup-token</code>
          <span className="fine">{t('Already logged in to Claude Code here? You can leave the token empty.')}</span>
        </div>
      ) : null}
      {p.needsKey || f.provider === 'claude-subscription' ? <Field label={f.provider === 'claude-subscription' ? t('Subscription token') : t('API key')} hint={t('stays on this machine')}><Input type="password" autoComplete="off" value={f.apiKey} placeholder={conn?.connected && f.provider !== 'claude-subscription' ? '•••••• ' + t('(unchanged)') : f.provider === 'claude-subscription' ? 'sk-ant-oat01-…' : 'sk-…'} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></Field> : null}
      {p.defaultBase ? <Field label={t('Base URL')} hint={t('OpenAI-compatible: Ollama, LM Studio, vLLM, OpenRouter…')}><Input className="input mono" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></Field> : null}
      <Field label={t('Models')} hint={t('comma-separated ids')}><Input className="input mono" value={f.models} onChange={(e) => setF({ ...f, models: e.target.value })} /></Field>
      <div className="row end"><Button variant="primary" onClick={safe(async () => {
        const args = { name: f.name || undefined, apiKey: f.apiKey || undefined, baseUrl: f.baseUrl || undefined, models: f.models.split(',').map((s) => s.trim()).filter(Boolean) };
        if (conn) await api('update_connection', { connectionId: conn.id, ...args }); else await api('create_connection', { provider: f.provider, ...args });
        await refresh(); done();
      })}>{t('Save')}</Button></div>
    </div>
  );
}

function Providers() {
  const { safe, toast, openModal, refresh } = useApp();
  const [data, setData] = useState(null);
  const load = useCallback(async () => setData({ ...(await api('list_ai_connections')), cat: await api('providers_catalog') }), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const edit = (conn) => openModal({ title: conn ? t('Edit {name}', { name: conn.name }) : t('Add an AI provider'), render: (close) => <ConnectionEditor conn={conn} cat={data.cat} done={() => { close(); load(); }} /> });
  return (
    <div className="stack">
      <p className="muted">{t('What your coworkers think with. Each one follows the workspace default unless you pin a model for it.')}</p>
      {data.connections.map((c) => (
        <div className={`card-row conn ${c.isDefault ? 'is-default' : ''}`} key={c.id}>
          <div className="row between wrap">
            <div className="row"><strong>{c.name}</strong><Pill>{t(data.cat.providers[c.provider]?.label || c.provider)}</Pill><Pill tone={c.connected ? 'ok' : 'warn'}>{c.connected ? t('connected') : t('needs key')}</Pill></div>
            <div className="row">
              <AsyncButton size="sm" onClick={async () => { try { const r = await api('test_connection', { connectionId: c.id }); toast(`OK · ${r.model}: ${r.reply}`); } catch (e) { toast(e.message, true); } }}>{t('Test')}</AsyncButton>
              <Button size="sm" icon="edit" onClick={() => edit(c)} />
              <Button size="sm" variant="danger" icon="trash" onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Remove {name}', { name: c.name }), text: t('Coworkers pinned to it go back to the default.'), danger: true, confirmLabel: t('Remove') })) { await api('delete_connection', { connectionId: c.id }); load(); refresh(); } })} />
            </div>
          </div>
          <div className="options">
            <span className="muted small">{t('Default model:')}</span>
            {c.models.map((m) => <button key={m} className={`option ${c.isDefault && data.default?.model === m ? 'on' : ''}`} onClick={safe(async () => { await api('set_default_model', { connectionId: c.id, model: m }); load(); refresh(); })}>{m}</button>)}
          </div>
        </div>
      ))}
      <div className="row"><Button variant="primary" icon="plus" onClick={() => edit(null)}>{t('Add a provider')}</Button></div>
    </div>
  );
}

function ApiKeys() {
  const { safe, openModal } = useApp();
  const [keys, setKeys] = useState(null);
  const load = useCallback(async () => setKeys((await api('list_api_keys')).keys), []);
  useEffect(() => { load(); }, [load]);
  const endpoint = `${location.origin}/api/mcp/account`;
  const create = safe(async () => {
    const name = await prompt(openModal, { title: t('New API key'), label: t('Name'), value: 'Claude Code' });
    if (!name) return;
    const { key } = await api('create_api_key', { name });
    load();
    openModal({ title: t('Your new API key'), wide: true, render: () => (
      <div className="stack">
        <p className="callout">{t('Copy it now: it is shown once and reaches every coworker of this workspace.')}</p>
        <pre className="code-block select-all">{key}</pre>
        <p>{t('Connect Claude Code:')}</p>
        <pre className="code-block">{`claude mcp add --transport http crewbox ${endpoint} --header "Authorization: Bearer ${key}"`}</pre>
        <p>{t('Or call it with curl:')}</p>
        <pre className="code-block">{`curl -s ${endpoint} -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}'`}</pre>
      </div>
    ) });
  });
  if (!keys) return null;
  return (
    <div className="stack">
      <p className="muted">{t('One MCP endpoint to build and drive your coworkers from Claude Code, Codex, Cursor or a script. JSON-RPC 2.0 over POST, the same tool names as the Rerun API.')}</p>
      <div className="kv"><span>{t('Endpoint')}</span><code>{endpoint}</code><span>{t('Webhooks')}</span><code>{`${location.origin}/api/t/{agentId}/{slug}/{token}`}</code></div>
      <SectionHead title={t('API keys')}><Button variant="primary" size="sm" icon="plus" onClick={create}>{t('New key')}</Button></SectionHead>
      {!keys.length ? <Empty icon="key">{t('No key yet.')}</Empty> : null}
      {keys.map((k) => (
        <div className="file-row" key={k.id}><Icon name="key" size={15} /><strong className="grow">{k.name}</strong><code>{k.prefix}…</code><span className="muted small">used {ago(k.last_used_at)}</span><Button size="sm" variant="danger" onClick={safe(async () => { await api('revoke_api_key', { id: k.id }); load(); })}>{t('Revoke')}</Button></div>
      ))}
    </div>
  );
}

function WorkspaceSecrets() {
  const { safe } = useApp();
  const [list, setList] = useState(null);
  const [f, setF] = useState({ name: '', value: '' });
  const load = useCallback(async () => setList((await api('list_secrets', {})).secrets), []);
  useEffect(() => { load(); }, [load]);
  if (!list) return null;
  return (
    <div className="stack">
      <p className="muted">{t('Shared by every coworker; a coworker\'s own variable with the same name wins.')} <code>{'${NAME}'}</code> in MCP configs, <code>$NAME</code> in shell.</p>
      <form className="row" onSubmit={safe(async (e) => { e.preventDefault(); await api('set_secret', { name: f.name.trim(), value: f.value }); setF({ name: '', value: '' }); load(); })}>
        <Input className="input mono" placeholder={t('VARIABLE_NAME')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input type="password" autoComplete="off" placeholder={t('value')} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        <Button variant="primary" type="submit">{t('Save')}</Button>
      </form>
      {list.map((s) => <div className="file-row" key={s.name}><Icon name="key" size={15} /><code className="grow">{s.name}</code><span className="muted small">{ago(s.updated_at)}</span><button className="icon-btn" onClick={safe(async () => { await api('delete_secret', { name: s.name }); load(); })} aria-label={t('Delete')}><Icon name="trash" size={14} /></button></div>)}
    </div>
  );
}

function SettingsBody({ initial }) {
  const [tab, setTab] = useState(initial || 'providers');
  return (
    <div className="stack">
      <Segmented value={tab} onChange={setTab} options={[['providers', t('AI providers')], ['autopilot', t('Autopilot')], ['api', t('API & MCP')], ['secrets', t('Workspace secrets')]]} />
      {tab === 'providers' ? <Providers /> : tab === 'autopilot' ? <AutopilotPanel /> : tab === 'api' ? <ApiKeys /> : <WorkspaceSecrets />}
    </div>
  );
}

export const openSettings = (openModal, tab) => openModal({ title: t('Settings'), wide: true, render: () => <SettingsBody initial={tab} /> });
