import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useServerEvents } from '../lib/store.jsx';
import { t } from '../lib/i18n.js';
import { Field, Input, Pill } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';

export const METHOD_LABEL = {
  oauth: () => t('Sign in'),
  oauthApp: () => t('Sign in with your app'),
  apiKey: () => t('API key'),
  command: () => t('Local command'),
  none: () => t('Nothing to connect'),
};
const METHOD_HELP = {
  oauth: () => t('You sign in on the service. Crewbox keeps the access on this machine.'),
  oauthApp: () => t('Create a free developer app on the service, paste its ID and secret once, then sign in.'),
  apiKey: () => t('Paste a key from your account. It goes straight to this machine, never to the AI.'),
  command: () => t('Runs the official MCP server on this machine (needs Node.js).'),
  none: () => t('It works right away.'),
};
export const STATUS_LABEL = { active: () => t('connected'), needs_auth: () => t('to sign in'), needs_config: () => t('to configure'), unavailable: () => t('unavailable') };
export const statusTone = (s) => (s === 'active' ? 'ok' : s === 'unavailable' ? '' : 'warn');

export const AppIcon = ({ slug, size = 22 }) => <img className="app-icon" src={`/icons/${slug}.png`} alt="" width={size} height={size} loading="lazy" />;

/** Open the service's consent page in a popup and resolve when this machine has the tokens. */
export function signInPopup(url) {
  const w = 520, h = 720;
  const win = window.open(url, 'crewbox-oauth', `width=${w},height=${h},left=${Math.max(0, (window.screen.width - w) / 2)},top=${Math.max(0, (window.screen.height - h) / 2)}`);
  if (!win) window.location.assign(url);
  return win;
}

/**
 * Connect one app on one coworker: pick a way to connect, fill what it needs, sign in.
 * `asCard` (inside a coworker's request card) collects values instead of saving them: the card's
 * answer carries them, so the coworker resumes knowing the app is ready.
 */
export default function ConnectApp({ agentId, slug, asCard, value = {}, onChange, onDone }) {
  const [app, setApp] = useState(null);
  const [method, setMethod] = useState(value.method ?? null);
  const [vals, setVals] = useState(value.values || {});
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState('');
  const [redirect, setRedirect] = useState('');
  useEffect(() => {
    api('get_connector', { slug }).then((a) => { setApp(a); setMethod((m) => m ?? 0); }).catch((e) => setError(e.message));
    api('oauth_redirect_uri').then((r) => setRedirect(r.redirectUri)).catch(() => {});
  }, [slug]);
  useServerEvents((ev) => { if (ev.type === 'app_connected' && ev.data?.agentId === agentId) { setSignedIn(true); setBusy(false); onDone?.('active'); } });
  useEffect(() => { onChange?.({ ...value, method, values: vals }); }, [method, vals]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="muted small">{error}</p>;
  if (!app) return <div className="loader" />;
  if (!app.methods.length) return <p className="muted small">{t('{name} has no public integration yet. Add its MCP server yourself (Custom MCP).', { name: app.name })}</p>;
  const m = app.methods[method ?? 0];
  const kind = m.kind;
  const needsSignIn = kind === 'oauth' || kind === 'oauthApp';

  const saveSecrets = async () => { for (const s of m.secrets) if (vals[s.name]) await api('set_secret', { agentId, name: s.name, value: vals[s.name] }); };
  const signIn = async () => {
    setBusy(true); setError('');
    try {
      await saveSecrets();
      const r = await api('connect_app', { agentId, slug, method: m.index });
      if (r.authorizeUrl) signInPopup(r.authorizeUrl);
      else if (r.status === 'active') { setSignedIn(true); setBusy(false); onDone?.('active'); }
      else { setBusy(false); setError(r.message || ''); }
    } catch (e) { setBusy(false); setError(e.message); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try {
      await saveSecrets();
      const r = await api('attach_connector', { agentId, slug, method: m.index });
      setBusy(false);
      if (r.status === 'active') onDone?.('active'); else setError(r.message);
    } catch (e) { setBusy(false); setError(e.message); }
  };

  return (
    <div className="connect-app" data-testid="connect-app">
      <div className="connect-head"><AppIcon slug={slug} size={28} /><div><strong>{app.name}</strong><p className="muted small">{app.description}</p></div></div>
      {app.methods.length > 1 ? (
        <div className="method-pick" role="radiogroup" aria-label={t('How to connect')}>
          {app.methods.map((x, i) => (
            <button type="button" key={i} role="radio" aria-checked={(method ?? 0) === i} className={`method ${(method ?? 0) === i ? 'on' : ''}`} onClick={() => setMethod(i)}>
              <b>{METHOD_LABEL[x.kind]()}</b>
              <span>{x.kind === 'apiKey' && x.via === 'api' ? t('REST API · {n} tools', { n: x.tools || '∞' }) : x.official === false ? t('community server') : x.via === 'mcp' ? t('official MCP') : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
      <p className="fine">{METHOD_HELP[kind]()}</p>
      {kind === 'oauthApp' && redirect ? <p className="fine">{t('Redirect URI to register in your app:')} <code className="break">{redirect}</code></p> : null}
      {m.secrets.map((s) => (
        <Field key={s.name} label={s.label} hint={`${s.name}${s.help ? ` · ${s.help}` : ''}`}>
          <Input type="password" autoComplete="off" value={vals[s.name] || ''} onChange={(e) => setVals({ ...vals, [s.name]: e.target.value })} aria-label={s.label} />
        </Field>
      ))}
      {needsSignIn ? (
        <div className="row wrap">
          <button type="button" className="btn primary" disabled={busy} onClick={signIn} data-testid="connect-signin">{busy ? <span className="loader sm" /> : <Icon name="link" size={15} />}{signedIn ? t('Connected') : t('Sign in to {name}', { name: app.name })}</button>
          {signedIn ? <Pill tone="ok">✓ {t('connected')}</Pill> : null}
        </div>
      ) : !asCard ? (
        <div className="row end"><button type="button" className="btn primary" disabled={busy} onClick={save} data-testid="connect-save">{t('Connect')}</button></div>
      ) : null}
      {error ? <p className="error small" role="alert">{error}</p> : null}
    </div>
  );
}
