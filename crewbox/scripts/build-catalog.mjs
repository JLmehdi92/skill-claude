// Builds src/catalog-library.json (the app library) from data/connectors-research.json: Rerun's
// 207 services, each researched and probed (official remote MCP servers, npm MCP packages, REST
// APIs). Run: node scripts/build-catalog.mjs
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const { connectors } = JSON.parse(fs.readFileSync(new URL('data/connectors-research.json', root), 'utf8'));
const UP = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const v = (name) => '${' + name + '}';

// Header values that are not "Bearer <key>" (from each vendor's docs, see the research notes).
const API_HEADERS = {
  assemblyai: (k) => ({ Authorization: v(k) }),
  deepgram: (k) => ({ Authorization: `Token ${v(k)}` }),
  discord: (k) => ({ Authorization: `Bot ${v(k)}` }),
  fal: (k) => ({ Authorization: `Key ${v(k)}` }),
  higgsfield: (k) => ({ Authorization: `Key ${v(k)}` }),
  klaviyo: (k) => ({ Authorization: `Klaviyo-API-Key ${v(k)}`, revision: '2025-10-15' }),
  linear: (k) => ({ Authorization: v(k) }),
  make: (k) => ({ Authorization: `Token ${v(k)}` }),
  monday: (k) => ({ Authorization: v(k) }),
  ringover: (k) => ({ Authorization: v(k) }),
  sourcegraph: (k) => ({ Authorization: `token ${v(k)}` }),
  clickup: (k) => ({ Authorization: v(k) }),
  pagerduty: (k) => ({ Authorization: `Token token=${v(k)}` }),
  pandadoc: (k) => ({ Authorization: `API-Key ${v(k)}` }),
  wix: (k) => ({ Authorization: v(k) }),
  postiz: (k) => ({ Authorization: v(k) }),
  algolia: (k) => ({ 'X-Algolia-API-Key': v(k), 'X-Algolia-Application-Id': v('ALGOLIA_APP_ID') }),
  godaddy: (k) => ({ Authorization: `sso-key ${v(k)}` }),
};
const EXTRA_SECRETS = { algolia: [{ name: 'ALGOLIA_APP_ID', label: 'Application ID' }] };
const BASIC_LABEL = {
  amplitude: 'API key:Secret key', atlassian: 'email:API token', jira: 'email:API token', dataforseo: 'login:password', freshdesk: 'API key:X',
  gong: 'Access key:Access key secret', kaggle: 'username:key', lemlist: ':API key (empty user)', mailchimp: 'anystring:API key', mixpanel: 'service account user:secret',
  razorpay: 'key_id:key_secret', wordpress: 'username:application password', cloudinary: 'API key:API secret', factset: 'username-serial:API key', godaddy: 'key:secret',
};
// Remote MCP servers that take a key instead of OAuth.
const MCP_KEY = {
  affonso: (k) => ({ Authorization: `Bearer ${v(k)}` }),
  brevo: (k) => ({ Authorization: `Bearer ${v(k)}` }),
  'browser-use': (k) => ({ 'X-Browser-Use-API-Key': v(k) }),
  'google-maps': (k) => ({ 'X-Goog-Api-Key': v(k) }),
  perplexity: (k) => ({ Authorization: `Bearer ${v(k)}` }),
  postiz: (k) => ({ Authorization: v(k) }),
  razorpay: (k) => ({ Authorization: `Basic ${v(k)}` }),
  render: (k) => ({ Authorization: `Bearer ${v(k)}` }),
  similarweb: (k) => ({ 'api-key': v(k) }),
  smartsheet: (k) => ({ Authorization: `Bearer ${v(k)}` }),
};

const transportOf = (url) => (/\/sse\/?(\?|$)/.test(url) ? 'sse' : 'http');
const secretFor = (r, env) => (env.toUpperCase().startsWith(UP(r.slug).split('_')[0]) ? env.toUpperCase() : `${UP(r.slug)}_${UP(env)}`);

function domainOf(r) {
  const urls = [r.api?.docs, r.api?.baseUrl, r.remoteMcp?.url].filter(Boolean);
  const bad = /github\.com|readme\.io|gitbook|apidog|postman\.com|mintlify|notion\.site|rapidapi|swaggerhub|stoplight/;
  for (const u of urls) {
    try {
      const h = new URL(u).hostname;
      if (bad.test(h) && r.slug !== 'postman' && r.slug !== 'github') continue;
      const parts = h.split('.');
      const two = parts.slice(-2).join('.');
      return /^(co|com|ac|gov)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join('.') : two;
    } catch { /* skip */ }
  }
  return null;
}

function methods(r) {
  const out = [];
  const m = r.remoteMcp;
  const a = r.api;
  const keyName = a?.envVar || `${UP(r.slug)}_API_KEY`;
  const keySecret = { name: keyName, label: a?.keyLabel || 'API key', help: a?.keyHelp || '' };
  if (r.slug === 'zapier' && m) {
    out.push({ kind: 'apiKey', via: 'mcp', label: 'MCP URL', secrets: [{ name: 'ZAPIER_MCP_URL', label: 'Your Zapier MCP server URL', help: 'mcp.zapier.com → your server → Connect' }], mcp: { transport: 'http', url: v('ZAPIER_MCP_URL') } });
  } else if (m?.auth === 'oauth') {
    out.push({ kind: 'oauth', mcp: { transport: transportOf(m.url), url: m.url } });
  } else if (m?.auth === 'bearer' || MCP_KEY[r.slug]) {
    const headers = (MCP_KEY[r.slug] || ((k) => ({ Authorization: `Bearer ${v(k)}` })))(keyName);
    out.push({ kind: 'apiKey', via: 'mcp', secrets: [BASIC_LABEL[r.slug] && /Basic/.test(JSON.stringify(headers)) ? { ...keySecret, label: BASIC_LABEL[r.slug] } : keySecret], mcp: { transport: transportOf(m.url), url: m.url, headers } });
  } else if (m?.auth === 'none') {
    out.push({ kind: 'none', mcp: { transport: transportOf(m.url), url: m.url } });
  }
  if (a && a.auth && a.auth !== 'oauth') {
    let baseUrl = a.baseUrl || '';
    const secrets = [];
    if (!baseUrl || /[<{]/.test(baseUrl)) { secrets.push({ name: `${UP(r.slug)}_BASE_URL`, label: 'API base URL of your account', help: a.docs || '' }); baseUrl = v(`${UP(r.slug)}_BASE_URL`); }
    let headers = {}, authQuery;
    if (a.auth === 'basic') { headers = { Authorization: `Basic ${v(keyName)}` }; secrets.push({ ...keySecret, label: BASIC_LABEL[r.slug] || 'username:password' }); }
    else if (a.auth === 'query') { authQuery = { [a.header || 'api_key']: v(keyName) }; secrets.push(keySecret); }
    else if (API_HEADERS[r.slug]) { headers = API_HEADERS[r.slug](keyName); secrets.push(keySecret); }
    else if (a.auth === 'header' && a.header && !/^authorization$/i.test(a.header)) { headers = { [a.header]: v(keyName) }; secrets.push(keySecret); }
    else { headers = { Authorization: `Bearer ${v(keyName)}` }; secrets.push(keySecret); }
    secrets.push(...(EXTRA_SECRETS[r.slug] || []));
    if (!(r.slug === 'ifttt')) out.push({ kind: 'apiKey', via: 'api', secrets, api: { baseUrl, headers, ...(authQuery ? { authQuery } : {}), docs: a.docs || null } });
  }
  const n = r.npm;
  if (n?.package && n.env !== undefined) {
    const envMap = {}, secrets = [];
    for (const e of n.env || []) {
      if (/^(SANDBOX|PADDLE_ENVIRONMENT|PAYPAL_ENVIRONMENT|MCP_MODEL_ID|MCP_TOPIC_NAME)$/i.test(e)) continue;
      const s = secretFor(r, e);
      envMap[e] = v(s);
      secrets.push({ name: s, label: e === n.env[0] ? (a?.keyLabel || 'API key') : e.replace(/_/g, ' ').toLowerCase() });
    }
    const args = ['-y', n.package, ...(n.args || []).filter((x) => x !== '-y' && !x.startsWith(n.package.split('@latest')[0]) && x !== n.package)]
      .map((x) => x.replace(/<([A-Za-z_]+)>/g, (mm, name) => {
        const s = /^(token|ref)$/i.test(name) ? `${UP(r.slug)}_${name === 'ref' ? 'PROJECT_REF' : 'API_TOKEN'}` : secretFor(r, name);
        if (!secrets.some((x2) => x2.name === s)) secrets.push({ name: s, label: name === 'ref' ? 'Project ref' : (a?.keyLabel || 'API key') });
        return v(s);
      }));
    if (r.slug === 'monday') { delete envMap.monday_token; }
    if (r.slug !== 'outlook') out.push({ kind: 'command', official: !!n.official, secrets, mcp: { transport: 'stdio', command: 'npx', args, env: envMap } });
  }
  return out;
}

const library = connectors.map((r) => ({
  slug: r.slug,
  name: r.name,
  category: r.category,
  description: r.summary,
  domain: domainOf(r),
  docs: r.api?.docs || null,
  methods: methods(r),
  notes: r.notes || '',
}));
fs.writeFileSync(new URL('src/catalog-library.json', root), JSON.stringify(library, null, 1));
const count = (k) => library.filter((x) => x.methods.some((m) => m.kind === k)).length;
console.log(`${library.length} apps · oauth ${count('oauth')} · apiKey ${count('apiKey')} · command ${count('command')} · none ${count('none')} · without method ${library.filter((x) => !x.methods.length).map((x) => x.slug).join(', ')}`);
