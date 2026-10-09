import { createRequire } from 'node:module';
import { q } from './db.js';
import { upsertServer, deleteServer, getServer } from './mcp.js';
import { upsertSkill, deleteSkill } from './skills.js';
import { SPECS } from './connectors/specs.js';

// The app library: the 207 services of rerun.build (researched and probed, see
// data/connectors-research.json and scripts/build-catalog.mjs) plus a few Crewbox extras.
// An app offers one or more ways to connect, best first:
//   oauth     sign in to the vendor's official MCP server (Crewbox registers itself, tokens stay here)
//   oauthApp  sign in through your own developer app (Google, Microsoft, LinkedIn, Reddit…)
//   apiKey    a key in a masked form, used by the vendor's MCP server or by its REST API
//   command   the vendor's MCP server run locally with npx
//   none      nothing to connect
// Installing one on a coworker gives it the tools plus a read-only skill on how to use them.

const require = createRequire(import.meta.url);
const LIBRARY = require('./catalog-library.json');

const npx = (pkg, ...args) => ({ transport: 'stdio', command: 'npx', args: ['-y', pkg, ...args] });
const v = (n) => '${' + n + '}';

// Sign-in with the owner's own OAuth app, for services whose official integration is OAuth only.
const GOOGLE = (scopes, baseUrl, docs) => ({
  kind: 'oauthApp', via: 'api',
  secrets: [{ name: 'GOOGLE_CLIENT_ID', label: 'OAuth client ID', help: 'console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web), redirect URI shown below' }, { name: 'GOOGLE_CLIENT_SECRET', label: 'OAuth client secret' }],
  api: { baseUrl, docs },
  oauth: { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes, clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET', params: { access_type: 'offline', prompt: 'consent' } },
});
const MICROSOFT = (scopes) => ({
  kind: 'oauthApp', via: 'api',
  secrets: [{ name: 'MICROSOFT_CLIENT_ID', label: 'Application (client) ID', help: 'entra.microsoft.com → App registrations → New (Web), redirect URI shown below' }, { name: 'MICROSOFT_CLIENT_SECRET', label: 'Client secret' }],
  api: { baseUrl: 'https://graph.microsoft.com/v1.0', docs: 'https://learn.microsoft.com/graph/api/overview' },
  oauth: { authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes, clientId: 'MICROSOFT_CLIENT_ID', clientSecret: 'MICROSOFT_CLIENT_SECRET' },
});
const OAUTH_APPS = {
  'google-analytics': GOOGLE('https://www.googleapis.com/auth/analytics.readonly', 'https://analyticsdata.googleapis.com', 'https://developers.google.com/analytics/devguides/reporting/data/v1/rest'),
  'google-search-console': GOOGLE('https://www.googleapis.com/auth/webmasters.readonly', 'https://searchconsole.googleapis.com', 'https://developers.google.com/webmaster-tools/v1/api_reference_index'),
  'google-tasks': GOOGLE('https://www.googleapis.com/auth/tasks', 'https://tasks.googleapis.com/tasks/v1', 'https://developers.google.com/tasks/reference/rest'),
  'google-meet': GOOGLE('https://www.googleapis.com/auth/meetings.space.created https://www.googleapis.com/auth/meetings.space.readonly', 'https://meet.googleapis.com/v2', 'https://developers.google.com/meet/api/reference/rest'),
  'google-photos': GOOGLE('https://www.googleapis.com/auth/photoslibrary.appendonly https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata', 'https://photoslibrary.googleapis.com/v1', 'https://developers.google.com/photos/library/reference/rest'),
  youtube: GOOGLE('https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/youtube/v3', 'https://developers.google.com/youtube/v3/docs'),
  microsoft: MICROSOFT('offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite.All'),
  outlook: MICROSOFT('offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Contacts.ReadWrite'),
  linkedin: {
    kind: 'oauthApp', via: 'api',
    secrets: [{ name: 'LINKEDIN_CLIENT_ID', label: 'Client ID', help: 'linkedin.com/developers → your app → Auth (add the redirect URI shown below, products: Sign In + Share on LinkedIn)' }, { name: 'LINKEDIN_CLIENT_SECRET', label: 'Client secret' }],
    api: { baseUrl: 'https://api.linkedin.com', docs: 'https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin', headers: { 'LinkedIn-Version': '202509', 'X-Restli-Protocol-Version': '2.0.0' } },
    oauth: { authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken', scopes: 'openid profile email w_member_social', clientId: 'LINKEDIN_CLIENT_ID', clientSecret: 'LINKEDIN_CLIENT_SECRET' },
  },
  reddit: {
    kind: 'oauthApp', via: 'api',
    secrets: [{ name: 'REDDIT_CLIENT_ID', label: 'App client ID', help: 'reddit.com/prefs/apps → create a "web app" with the redirect URI shown below' }, { name: 'REDDIT_CLIENT_SECRET', label: 'App secret' }],
    api: { baseUrl: 'https://oauth.reddit.com', docs: 'https://www.reddit.com/dev/api' },
    oauth: { authorizeUrl: 'https://www.reddit.com/api/v1/authorize', tokenUrl: 'https://www.reddit.com/api/v1/access_token', scopes: 'identity read submit history', clientId: 'REDDIT_CLIENT_ID', clientSecret: 'REDDIT_CLIENT_SECRET', tokenAuth: 'basic', params: { duration: 'permanent' } },
  },
};

// Which way to connect is offered first, when it differs from the library order.
const PREFERRED = { resend: 'apiKey', apollo: 'apiKey' };

// Usage notes for apps where a generic sentence is not enough.
const SKILLS = {
  github: 'Search before creating to avoid duplicates. Never push or merge without an approval.',
  notion: 'Search Notion before writing. Pages are only visible if they were shared with the integration; say so when a search comes back empty.',
  slack: 'Post in the channel the user named. Keep messages short, use threads for follow-ups, and never @channel without an approval.',
  stripe: 'Read freely. Any refund, cancellation, or charge needs request_approval first, with the amount and the customer in the item detail.',
  hubspot: 'Look a contact up by email before creating one. Log every touch as a note on the contact.',
  airtable: 'List bases and tables first, then read the schema before writing records.',
  linear: 'Search for an existing issue before filing a new one. Use the team the user works in.',
  firecrawl: 'Use scrape for one page and crawl only when the user wants a whole site. Store extracted rows in the database.',
  'google-maps': 'Search places by query and area, then fetch details for phone and website. Deduplicate by place id.',
  apify: 'Search for an Actor that fits the site, check its input schema, run it with a small limit first, and store the rows in the database.',
  gmail: 'Search before reading whole threads. Draft first; sending to a client or a prospect needs an approval unless the owner set an Autopilot rule.',
  instantly: 'Add leads to a campaign only after the owner approved the list and the copy.',
  lemlist: 'Add leads to a campaign only after the owner approved the list and the copy.',
};

// Crewbox extras that are not in Rerun's list.
const EXTRAS = [
  { slug: 'brave-search', name: 'Brave Search', category: 'data', description: 'Web and local search with a real search API.', domain: 'brave.com', methods: [{ kind: 'command', official: true, secrets: [{ name: 'BRAVE_API_KEY', label: 'API key', help: 'brave.com/search/api' }], mcp: { ...npx('@brave/brave-search-mcp-server'), env: { BRAVE_API_KEY: v('BRAVE_API_KEY') } } }], skill: 'Prefer this over the built-in web_search when it is installed: results are more reliable.' },
  { slug: 'postgres', name: 'PostgreSQL', category: 'data', description: 'Read-only SQL on a Postgres database.', domain: 'postgresql.org', methods: [{ kind: 'command', secrets: [{ name: 'POSTGRES_URL', label: 'Connection URL', help: 'postgres://user:pass@host:5432/db — use a read-only role' }], mcp: npx('@modelcontextprotocol/server-postgres', v('POSTGRES_URL')) }], skill: 'Inspect the schema before querying. Always add a LIMIT.' },
  { slug: 'browser', name: 'Headless browser', category: 'dev', description: 'Navigate JavaScript-heavy pages, click, fill forms and take screenshots (Playwright).', domain: 'playwright.dev', methods: [{ kind: 'command', official: true, secrets: [], mcp: npx('@playwright/mcp', '--headless') }], skill: 'Use web_fetch first. Open the browser only for pages that need JavaScript or interaction.' },
  { slug: 'demo', name: 'MCP demo server', category: 'dev', description: 'The reference "everything" server: echo, add, sample resources. Good for testing apps.', domain: 'modelcontextprotocol.io', methods: [{ kind: 'command', official: true, secrets: [], mcp: npx('@modelcontextprotocol/server-everything') }], skill: 'A test server. Use its echo and add tools when asked to test apps.' },
];

function build(entry) {
  const methods = [...(entry.methods || [])];
  if (OAUTH_APPS[entry.slug]) methods.splice(methods.findIndex((m) => m.kind === 'command') >= 0 ? methods.findIndex((m) => m.kind === 'command') : methods.length, 0, OAUTH_APPS[entry.slug]);
  const spec = SPECS[entry.slug];
  for (const m of methods) if (m.via === 'api' && spec) m.api = { ...m.api, ops: spec.ops, docs: spec.docs || m.api.docs };
  const pref = PREFERRED[entry.slug];
  if (pref) methods.sort((a, b) => (b.kind === pref) - (a.kind === pref));
  const primary = methods[0];
  return {
    ...entry,
    methods,
    auth: primary?.kind || 'unavailable',
    secrets: primary?.secrets || [],
    skill: [spec?.skill, SKILLS[entry.slug], entry.skill].filter(Boolean).join('\n\n'),
  };
}

export const CATALOG = [...LIBRARY, ...EXTRAS].map(build);
export const findApp = (slug) => CATALOG.find((a) => a.slug === slug);

/** Status an app would have right after being declared with its first way to connect. */
const predicted = (a) => (!a.methods.length ? 'unavailable' : a.auth === 'none' || (a.auth === 'command' && !a.secrets.length) ? 'active' : a.auth === 'oauth' || a.auth === 'oauthApp' ? 'needs_auth' : 'needs_config');

const view = (a) => ({
  slug: a.slug, name: a.name, category: a.category, description: a.description, summary: a.description, domain: a.domain,
  auth: a.auth, authMethods: a.methods.map((m) => m.kind), secrets: a.secrets.map((x) => x.name),
  setup: predicted(a), setupReason: a.methods.length ? `Connect with ${a.auth}` : 'No public integration: add your own MCP server.',
});

export function searchConnectors(query = '', { category } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return CATALOG
    .filter((a) => !category || a.category === category)
    .map((a) => {
      const hay = `${a.slug} ${a.name} ${a.category} ${a.description}`.toLowerCase();
      const score = words.reduce((n, w) => n + (a.name.toLowerCase().includes(w) ? 5 : 0) + (hay.includes(w) ? 1 : 0), 0);
      return { a, score };
    })
    .filter((x) => !words.length || x.score)
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name))
    .map(({ a }) => view(a));
}

export function listConnectorsPage({ category, limit = 60, offset = 0 } = {}) {
  const all = CATALOG.filter((a) => !category || a.category === category).sort((x, y) => x.name.localeCompare(y.name));
  return { total: all.length, connectors: all.slice(offset, offset + Math.min(200, limit)).map(view) };
}

/** The detailed card of an app: every way to connect, with what each one needs. */
export function appDetails(slug) {
  const a = findApp(slug);
  if (!a) throw new Error(`No app "${slug}".`);
  return {
    ...view(a), docs: a.docs || null,
    methods: a.methods.map((m, i) => ({
      index: i, kind: m.kind, via: m.via || null, official: m.official ?? null,
      secrets: m.secrets || [],
      target: m.mcp ? (m.mcp.transport === 'stdio' ? `${m.mcp.command} ${m.mcp.args.join(' ')}` : m.mcp.url) : m.api?.baseUrl,
      tools: m.api?.ops?.length || null,
    })),
  };
}

export function listAgentConnectors(agentId) {
  return q.all('SELECT slug FROM mcp_servers WHERE agent_id = ? AND connector IS NOT NULL', agentId)
    .map(({ slug }) => getServer(agentId, slug))
    .map((s) => ({ slug: s.connector, name: findApp(s.connector)?.name || s.name, status: s.status, auth: s.auth, method: s.spec?.method || null, missingSecrets: s.missingSecrets }));
}

function serverConfig(a, m) {
  if (m.mcp) return { ...m.mcp, auth: m.kind === 'oauth' ? 'oauth' : null, spec: { method: m.kind } };
  if (m.api) {
    return {
      transport: 'api', url: m.api.baseUrl, headers: m.api.headers || {}, auth: m.kind === 'oauthApp' ? 'oauthApp' : null,
      spec: { method: m.kind, name: a.name, docs: m.api.docs || a.docs, ops: m.api.ops || [], generic: true, authQuery: m.api.authQuery || undefined, oauth: m.oauth || undefined },
    };
  }
  throw new Error(`${a.name} has no way to connect.`);
}

/** Declare an app on a coworker. `method` picks a way to connect (its index or kind); default: the first. */
export function attachConnector(agentId, slug, { method } = {}) {
  const app = findApp(slug);
  if (!app) throw new Error(`No app "${slug}" in the library. Try search_connectors, or register a custom MCP server.`);
  if (!app.methods.length) throw new Error(`${app.name} has no public integration yet. Register its MCP server yourself (Custom MCP), or ask for it.`);
  const current = getServer(agentId, slug.replace(/-/g, '_'));
  const m = typeof method === 'number' ? app.methods[method]
    : method ? app.methods.find((x) => x.kind === method)
      : app.methods.find((x) => x.kind === current?.spec?.method) || app.methods[0];
  if (!m) throw new Error(`${app.name} has no "${method}" way to connect. Options: ${app.methods.map((x) => x.kind).join(', ')}.`);
  const server = upsertServer(agentId, { slug: app.slug, name: app.name, connector: app.slug, ...serverConfig(app, m) });
  const generic = m.api ? `\n\nThe \`mcp__${server.slug}__request\` tool reaches any endpoint of ${m.api.baseUrl}${m.api.docs ? ` (reference: ${m.api.docs})` : ''}; authentication is added for you.` : '';
  upsertSkill(agentId, {
    name: `${app.name} app`, slug: `app-${app.slug}`,
    description: `Use when the task involves ${app.name}: ${app.description}`,
    body: `Tools from this app are named \`mcp__${server.slug}__*\`. ${app.description}${generic}\n\n${app.skill || 'Read before you write. Anything that sends, publishes, pays or deletes goes through an approval.'}`,
  }, { allowReadOnly: true, connector: app.slug });
  return { slug: app.slug, name: app.name, status: server.status, method: m.kind, authMethods: app.methods.map((x) => x.kind), missingSecrets: server.missingSecrets, message: server.status === 'active' ? `${app.name} is connected.` : server.status === 'needs_auth' ? `${app.name} waits for the owner to sign in from the Apps tab.` : `${app.name} waits for: ${server.missingSecrets.join(', ')}.` };
}

export function detachConnector(agentId, slug) {
  const s = getServer(agentId, slug.replace(/-/g, '_')) || getServer(agentId, slug);
  if (!s || !s.connector) throw new Error(`App ${slug} is not installed on this coworker.`);
  deleteServer(agentId, s.slug);
  try { deleteSkill(agentId, `app-${s.connector}`, { allowReadOnly: true }); } catch { /* already gone */ }
  return { detached: slug };
}
