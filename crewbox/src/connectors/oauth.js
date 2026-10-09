import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { PUBLIC_URL } from '../config.js';
import { getSecret, setSecret, deleteSecret } from '../secrets.js';
import { token } from '../util.js';

// "Sign in" for apps whose official MCP server uses OAuth (Notion, Linear, Asana, Stripe…).
// Crewbox registers itself as a client (dynamic client registration), opens the vendor's consent
// page, receives the code on /oauth/callback and keeps the tokens on this machine, per coworker,
// in the secret OAUTH_<SLUG>. The MCP SDK refreshes them when they expire.

export const REDIRECT = () => `${PUBLIC_URL}/oauth/callback`;
const pending = new Map(); // state -> { agentId, slug, url, at }
const varName = (slug) => `OAUTH_${String(slug).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

export class CrewboxOAuth {
  constructor(agentId, slug, name) { this.agentId = agentId; this.slug = slug; this.name = name; this.authUrl = null; }
  get redirectUrl() { return REDIRECT(); }
  get clientMetadata() {
    return { client_name: `Crewbox (${this.name || this.slug})`, redirect_uris: [REDIRECT()], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  read() { try { return JSON.parse(getSecret(this.agentId, varName(this.slug)) || '{}'); } catch { return {}; } }
  write(patch) { setSecret(this.agentId, varName(this.slug), JSON.stringify({ ...this.read(), ...patch })); }
  state() {
    const s = token(18);
    pending.set(s, { agentId: this.agentId, slug: this.slug, at: Date.now() });
    return s;
  }
  clientInformation() { return this.read().client; }
  saveClientInformation(client) { this.write({ client }); }
  tokens() { return this.read().tokens; }
  saveTokens(tokens) { this.write({ tokens, connectedAt: new Date().toISOString() }); }
  redirectToAuthorization(url) { this.authUrl = String(url); }
  saveCodeVerifier(verifier) { this.write({ verifier }); }
  codeVerifier() { const v = this.read().verifier; if (!v) throw new Error('No sign-in in progress.'); return v; }
  invalidateCredentials(scope) {
    const d = this.read();
    if (scope === 'all') return deleteSecret(this.agentId, varName(this.slug));
    if (scope === 'tokens') delete d.tokens;
    if (scope === 'client') delete d.client;
    if (scope === 'verifier') delete d.verifier;
    setSecret(this.agentId, varName(this.slug), JSON.stringify(d));
    return undefined;
  }
}

export const hasTokens = (agentId, slug) => {
  try { return !!JSON.parse(getSecret(agentId, varName(slug)) || '{}').tokens; } catch { return false; }
};
export const forget = (agentId, slug) => deleteSecret(agentId, varName(slug));

/* ---- sign-in through the owner's own OAuth app (Google, Microsoft, LinkedIn, Reddit…) ---- */

const readVar = (agentId, slug) => { try { return JSON.parse(getSecret(agentId, varName(slug)) || '{}'); } catch { return {}; } };
const writeVar = (agentId, slug, d) => setSecret(agentId, varName(slug), JSON.stringify(d));

async function tokenRequest(oauth, vars, form) {
  const id = vars[oauth.clientId], secret = vars[oauth.clientSecret];
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'Crewbox/1.0' };
  const body = new URLSearchParams(form);
  if (oauth.tokenAuth === 'basic') headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  else { body.set('client_id', id); body.set('client_secret', secret); }
  // CREWBOX_OAUTH_TOKEN_URL points every app at a test token endpoint.
  const res = await fetch(process.env.CREWBOX_OAUTH_TOKEN_URL || oauth.tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Sign-in refused by the service: ${data.error_description || data.error || res.status}`);
  return { ...data, expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null };
}

export function startAppSignIn(agentId, slug, oauth, vars) {
  if (!vars[oauth.clientId] || !vars[oauth.clientSecret]) throw new Error('Fill in the client ID and secret of your app first.');
  const state = token(18);
  pending.set(state, { agentId, slug, kind: 'app', oauth, at: Date.now() });
  const u = new URL(oauth.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', vars[oauth.clientId]);
  u.searchParams.set('redirect_uri', REDIRECT());
  u.searchParams.set('scope', oauth.scopes);
  u.searchParams.set('state', state);
  for (const [k, val] of Object.entries(oauth.params || {})) u.searchParams.set(k, val);
  return { authorizeUrl: u.toString() };
}

/** A valid access token for an app signed in with the owner's OAuth app (refreshed when needed). */
export async function appAccessToken(agentId, slug, oauth, vars) {
  const d = readVar(agentId, slug);
  if (!d.tokens?.access_token) throw new Error('Not signed in yet: the owner clicks Connect in the Apps tab.');
  if (!d.tokens.expires_at || d.tokens.expires_at - Date.now() > 60_000) return d.tokens.access_token;
  if (!d.tokens.refresh_token) throw new Error('The sign-in expired: the owner signs in again from the Apps tab.');
  const fresh = await tokenRequest(oauth, vars, { grant_type: 'refresh_token', refresh_token: d.tokens.refresh_token });
  writeVar(agentId, slug, { ...d, tokens: { refresh_token: d.tokens.refresh_token, ...fresh } });
  return fresh.access_token;
}

/** Start a sign-in: returns the vendor URL to open, or { connected: true } if tokens already work. */
export async function startSignIn(agentId, slug, name, serverUrl) {
  const p = new CrewboxOAuth(agentId, slug, name);
  const r = await auth(p, { serverUrl });
  if (r === 'AUTHORIZED') return { connected: true };
  if (!p.authUrl) throw new Error('The service did not return a sign-in page.');
  return { authorizeUrl: p.authUrl };
}

/** Finish a sign-in from the callback. */
export async function finishSignIn(state, code, resolveUrl, varsOf) {
  const p0 = pending.get(state);
  if (!p0) throw new Error('This sign-in link expired. Start again from the app.');
  pending.delete(state);
  const { agentId, slug } = p0;
  if (p0.kind === 'app') {
    const tokens = await tokenRequest(p0.oauth, varsOf(agentId), { grant_type: 'authorization_code', code, redirect_uri: REDIRECT() });
    writeVar(agentId, slug, { tokens, connectedAt: new Date().toISOString() });
    return { agentId, slug, name: resolveUrl(agentId, slug).name };
  }
  const { url, name } = resolveUrl(agentId, slug);
  const p = new CrewboxOAuth(agentId, slug, name);
  const r = await auth(p, { serverUrl: url, authorizationCode: code });
  if (r !== 'AUTHORIZED') throw new Error('The service did not accept the sign-in.');
  return { agentId, slug, name };
}

setInterval(() => { for (const [s, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(s); }, 60_000).unref();
