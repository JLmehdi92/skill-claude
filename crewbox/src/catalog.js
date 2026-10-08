import { q } from './db.js';
import { upsertServer, deleteServer, getServer } from './mcp.js';
import { upsertSkill, deleteSkill } from './skills.js';

// The app library. Each app is an MCP server config plus a read-only skill that tells the
// coworker how to use it. Credentials are ${VARIABLE} references filled through the masked form.

const npx = (pkg, ...args) => ({ transport: 'stdio', command: 'npx', args: ['-y', pkg, ...args] });

export const CATALOG = [
  {
    slug: 'github', name: 'GitHub', category: 'Engineering', auth: 'apiKey',
    description: 'Issues, pull requests, repositories and code search.',
    secrets: [{ name: 'GITHUB_TOKEN', label: 'Personal access token', help: 'github.com/settings/tokens' }],
    mcp: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' } },
    skill: 'Use the GitHub tools for anything about repositories, issues and pull requests. Search before creating to avoid duplicates. Never push or merge without an approval.',
  },
  {
    slug: 'notion', name: 'Notion', category: 'Productivity', auth: 'apiKey',
    description: 'Search, read and write Notion pages and databases.',
    secrets: [{ name: 'NOTION_TOKEN', label: 'Internal integration secret', help: 'notion.so/my-integrations — then share the pages with the integration' }],
    mcp: { ...npx('@notionhq/notion-mcp-server'), env: { NOTION_TOKEN: '${NOTION_TOKEN}' } },
    skill: 'Search Notion before writing. Pages are only visible if they were shared with the integration; say so when a search comes back empty.',
  },
  {
    slug: 'slack', name: 'Slack', category: 'Communication', auth: 'apiKey',
    description: 'Read channels, post messages and reply in threads.',
    secrets: [{ name: 'SLACK_BOT_TOKEN', label: 'Bot token (xoxb-…)' }, { name: 'SLACK_TEAM_ID', label: 'Workspace ID (T…)' }],
    mcp: { ...npx('@modelcontextprotocol/server-slack'), env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}', SLACK_TEAM_ID: '${SLACK_TEAM_ID}' } },
    skill: 'Post in the channel the user named. Keep messages short, use threads for follow-ups, and never @channel without an approval.',
  },
  {
    slug: 'stripe', name: 'Stripe', category: 'Finance', auth: 'apiKey',
    description: 'Customers, invoices, payments, refunds and subscriptions.',
    secrets: [{ name: 'STRIPE_SECRET_KEY', label: 'Secret or restricted key', help: 'Prefer a restricted key with only what the job needs' }],
    mcp: npx('@stripe/mcp', '--tools=all', '--api-key=${STRIPE_SECRET_KEY}'),
    skill: 'Read freely. Any refund, cancellation, or charge needs request_approval first, with the amount and the customer in the item detail.',
  },
  {
    slug: 'hubspot', name: 'HubSpot', category: 'Sales', auth: 'apiKey',
    description: 'Contacts, companies, deals and notes in your CRM.',
    secrets: [{ name: 'HUBSPOT_TOKEN', label: 'Private app access token' }],
    mcp: { ...npx('@hubspot/mcp-server'), env: { PRIVATE_APP_ACCESS_TOKEN: '${HUBSPOT_TOKEN}' } },
    skill: 'Look a contact up by email before creating one. Log every touch as a note on the contact.',
  },
  {
    slug: 'airtable', name: 'Airtable', category: 'Productivity', auth: 'apiKey',
    description: 'Read and write records in Airtable bases.',
    secrets: [{ name: 'AIRTABLE_API_KEY', label: 'Personal access token' }],
    mcp: { ...npx('airtable-mcp-server'), env: { AIRTABLE_API_KEY: '${AIRTABLE_API_KEY}' } },
    skill: 'List bases and tables first, then read the schema before writing records.',
  },
  {
    slug: 'linear', name: 'Linear', category: 'Engineering', auth: 'apiKey',
    description: 'Issues, projects and cycles.',
    secrets: [{ name: 'LINEAR_API_KEY', label: 'Personal API key' }],
    mcp: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR_API_KEY}' } },
    skill: 'Search for an existing issue before filing a new one. Use the team the user works in.',
  },
  {
    slug: 'brave-search', name: 'Brave Search', category: 'Research', auth: 'apiKey',
    description: 'Web and local search with a real search API.',
    secrets: [{ name: 'BRAVE_API_KEY', label: 'API key', help: 'brave.com/search/api' }],
    mcp: { ...npx('@modelcontextprotocol/server-brave-search'), env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' } },
    skill: 'Prefer this over the built-in web_search when it is installed: results are more reliable.',
  },
  {
    slug: 'firecrawl', name: 'Firecrawl', category: 'Research', auth: 'apiKey',
    description: 'Scrape, crawl and extract structured data from websites.',
    secrets: [{ name: 'FIRECRAWL_API_KEY', label: 'API key' }],
    mcp: { ...npx('firecrawl-mcp'), env: { FIRECRAWL_API_KEY: '${FIRECRAWL_API_KEY}' } },
    skill: 'Use scrape for one page and crawl only when the user wants a whole site. Store extracted rows in the database.',
  },
  {
    slug: 'google-maps', name: 'Google Maps', category: 'Research', auth: 'apiKey',
    description: 'Places search, details and directions (great for local lead lists).',
    secrets: [{ name: 'GOOGLE_MAPS_API_KEY', label: 'API key' }],
    mcp: { ...npx('@modelcontextprotocol/server-google-maps'), env: { GOOGLE_MAPS_API_KEY: '${GOOGLE_MAPS_API_KEY}' } },
    skill: 'Search places by query and area, then fetch details for phone and website. Deduplicate by place id.',
  },
  {
    slug: 'postgres', name: 'PostgreSQL', category: 'Data', auth: 'apiKey',
    description: 'Read-only SQL on a Postgres database.',
    secrets: [{ name: 'POSTGRES_URL', label: 'Connection URL', help: 'postgres://user:pass@host:5432/db — use a read-only role' }],
    mcp: npx('@modelcontextprotocol/server-postgres', '${POSTGRES_URL}'),
    skill: 'Inspect the schema before querying. Always add a LIMIT.',
  },
  {
    slug: 'browser', name: 'Headless browser', category: 'Research', auth: 'none',
    description: 'Navigate JavaScript-heavy pages, click, fill forms and take screenshots (Puppeteer).',
    secrets: [],
    mcp: npx('@modelcontextprotocol/server-puppeteer'),
    skill: 'Use web_fetch first. Open the browser only for pages that need JavaScript or interaction.',
  },
  {
    slug: 'demo', name: 'MCP demo server', category: 'Developer', auth: 'none',
    description: 'The reference "everything" server: echo, add, sample resources. Good for testing apps.',
    secrets: [],
    mcp: npx('@modelcontextprotocol/server-everything'),
    skill: 'A test server. Use its echo and add tools when asked to test apps.',
  },
];

export const findApp = (slug) => CATALOG.find((a) => a.slug === slug);

export function searchConnectors(query = '') {
  const s = query.toLowerCase();
  return CATALOG.filter((a) => !s || `${a.slug} ${a.name} ${a.category} ${a.description}`.toLowerCase().includes(s))
    .map(({ slug, name, category, description, auth, secrets }) => ({ slug, name, category, description, auth, secrets: secrets.map((x) => x.name) }));
}

export function listAgentConnectors(agentId) {
  return q.all('SELECT slug FROM mcp_servers WHERE agent_id = ? AND connector IS NOT NULL', agentId)
    .map(({ slug }) => getServer(agentId, slug))
    .map((s) => ({ slug: s.connector, name: findApp(s.connector)?.name || s.name, status: s.status, missingSecrets: s.missingSecrets }));
}

export function attachConnector(agentId, slug) {
  const app = findApp(slug);
  if (!app) throw new Error(`No app "${slug}" in the library. Try search_connectors, or register a custom MCP server.`);
  const server = upsertServer(agentId, { slug: app.slug, name: app.name, connector: app.slug, ...app.mcp });
  upsertSkill(agentId, {
    name: `${app.name} app`, slug: `app-${app.slug}`,
    description: `Use when the task involves ${app.name}: ${app.description}`,
    body: `Tools from this app are named \`mcp__${server.slug}__*\`.\n\n${app.skill}`,
  }, { allowReadOnly: true, connector: app.slug });
  return { slug: app.slug, name: app.name, status: server.status, missingSecrets: server.missingSecrets };
}

export function detachConnector(agentId, slug) {
  const s = getServer(agentId, slug.replace(/-/g, '_')) || getServer(agentId, slug);
  if (!s || !s.connector) throw new Error(`App ${slug} is not installed on this coworker.`);
  deleteServer(agentId, s.slug);
  try { deleteSkill(agentId, `app-${s.connector}`, { allowReadOnly: true }); } catch { /* already gone */ }
  return { detached: slug };
}
