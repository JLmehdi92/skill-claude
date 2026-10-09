// Reads a company website the way a new hire would: the home page, the sitemap, then the pages
// that say what the company sells and to whom (pricing, features, about, customers, FAQ, blog).
// It also spots the tools the site already runs (Stripe, HubSpot, Intercom, Shopify…) from their
// scripts and links, so the plan can connect the right apps.

const UA = 'Mozilla/5.0 (compatible; CrewboxBot/1.0; +https://github.com/) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|mp4|webm|mp3|wav|css|js|json|xml|txt|woff2?|ttf|eot|avif|dmg|exe)(\?|$)/i;
const PRIORITY = [
  [/\/(careers?|jobs|recrutement|carrieres|login|signin|signup|register|account|cart|checkout|brand|press)(\/|-|$)|legal|privacy|terms|cgu|cgv|mentions-legales|cookies|\/dpa|gdpr|rgpd|refund|acceptable-use/i, -60],
  [/\/(pricing|prix|tarifs?|plans?|abonnements?|offres?)(\/|$)/i, 100],
  [/\/(features?|fonctionnalit|product|produits?|solutions?|platform|plateforme|how-it-works|comment)/i, 80],
  [/\/(about|a-propos|qui-sommes|company|entreprise|team|equipe|mission|story)/i, 70],
  [/\/(customers?|clients?|case-stud|cas-clients?|testimonials?|temoignages?|use-cases?|industries)/i, 65],
  [/\/(faq|help|aide|support|questions)/i, 60],
  [/\/(integrations?|apps|marketplace|partners?)/i, 55],
  [/\/(docs?|documentation|guides?|api)(\/|$)/i, 40],
  [/\/(blog|news|actualites|articles?|resources|ressources)(\/|$)/i, 35],
  [/\/(contact|demo|book|rendez-vous)/i, 30],
];

// Signatures of tools a site runs → library slugs.
const TOOL_SIGNS = [
  [/js\.stripe\.com|checkout\.stripe\.com|buy\.stripe\.com/i, 'stripe'],
  [/js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics|hubspot/i, 'hubspot'],
  [/widget\.intercom\.io|intercomcdn/i, 'intercom'],
  [/cdn\.segment\.com|segment\.io\/analytics/i, 'segment'],
  [/googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/i, 'google-analytics'],
  [/posthog/i, 'posthog'],
  [/cdn\.mxpnl\.com|mixpanel/i, 'mixpanel'],
  [/cdn\.amplitude\.com|amplitude\.com\/libs/i, 'amplitude'],
  [/cdn\.shopify\.com|myshopify\.com/i, 'shopify'],
  [/assets\.website-files\.com|data-wf-site|webflow/i, 'webflow'],
  [/static\.wixstatic\.com|wix\.com/i, 'wix'],
  [/wp-content|wp-includes/i, 'wordpress'],
  [/calendly\.com/i, 'calendly'],
  [/cal\.com\//i, 'cal-com'],
  [/typeform\.com/i, 'typeform'],
  [/tally\.so/i, 'tally'],
  [/list-manage\.com|mailchimp/i, 'mailchimp'],
  [/klaviyo/i, 'klaviyo'],
  [/sibforms\.com|brevo|sendinblue/i, 'brevo'],
  [/cdn\.paddle\.com|paddle\.js/i, 'paddle'],
  [/paypal\.com\/sdk|paypalobjects/i, 'paypal'],
  [/clerk\.accounts|clerk\.com|clerk\.browser/i, 'clerk'],
  [/supabase\.co/i, 'supabase'],
  [/sentry-cdn\.com|browser\.sentry|ingest\.sentry\.io/i, 'sentry'],
  [/connect\.facebook\.net|fbq\(/i, 'meta-ads'],
  [/snap\.licdn\.com|linkedin\.com\/(company|in)\//i, 'linkedin'],
  [/(twitter|x)\.com\/(?!share|intent|home)[A-Za-z0-9_]{2,}/i, 'x'],
  [/youtube\.com\/(@|channel|c\/|embed)/i, 'youtube'],
  [/discord\.(gg|com\/invite)/i, 'discord'],
  [/github\.com\/[A-Za-z0-9-]+/i, 'github'],
  [/producthunt\.com/i, 'producthunt'],
  [/notion\.site|notion\.so/i, 'notion'],
  [/zapier\.com/i, 'zapier'],
  [/crisp\.chat|tawk\.to|freshdesk|freshchat/i, 'freshdesk'],
  [/beehiiv\.com/i, 'beehiiv'],
  [/convertkit|kit\.com/i, 'kit'],
  [/lemlist/i, 'lemlist'],
  [/instantly\.ai/i, 'instantly'],
  [/resend\.com/i, 'resend'],
  [/gohighlevel|leadconnectorhq/i, 'gohighlevel'],
  [/reddit\.com\/r\//i, 'reddit'],
];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', euro: '€' };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const clean = (s) => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Give a website address, e.g. monsite.fr');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (!/\./.test(u.hostname) && u.hostname !== 'localhost') throw new Error(`"${input}" does not look like a website address.`);
  u.hash = '';
  return u.toString();
}

export function parsePage(html, url) {
  const head = /<head[\s\S]*?<\/head>/i.exec(html)?.[0] || '';
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
    const tag = re.exec(head) || re.exec(html);
    return tag ? decode(/content=["']([^"']*)["']/i.exec(tag[0])?.[1] || '').trim() : '';
  };
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || meta('og:title'));
  const description = meta('description') || meta('og:description');
  const lang = /<html[^>]+lang=["']([a-z]{2})/i.exec(html)?.[1] || '';
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: clean(m[2]) })).filter((h) => h.text && h.text.length < 200).slice(0, 40);
  const body = html
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|header|footer|main|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = decode(body.replace(/<[^>]+>/g, ' ')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1).join('\n').slice(0, 9000);
  const links = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)[^"']*["']/gi)) {
    try { const u = new URL(decode(m[1]), url); if (/^https?:$/.test(u.protocol)) { u.hash = ''; links.push(u.toString()); } } catch { /* bad href */ }
  }
  return { url, title, description, lang, headings, text, links: [...new Set(links)] };
}

export function scorePath(u) {
  const p = new URL(u).pathname.toLowerCase();
  let s = 10 - p.split('/').filter(Boolean).length * 3;
  for (const [re, w] of PRIORITY) if (re.test(p)) { s += w; break; }
  return s;
}

/** Tools a page really runs: only scripts, stylesheets, iframes, forms and outgoing links count (not text or logos). */
export function detectTools(html, siteHost = '') {
  const external = (u) => { try { const h = new URL(u, 'https://x.invalid').hostname.replace(/^www\./, ''); return h !== 'x.invalid' && h !== siteHost; } catch { return false; } };
  const sources = [
    ...[...html.matchAll(/<(?:script|link|iframe|form)\b[^>]*(?:src|href|action)=["']([^"']+)["']/gi)].map((m) => m[1]).filter(external),
    // Small inline scripts are tracking snippets; large ones are page data (they mention everything).
    ...[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((c) => c.length < 4000 && !/__next_f|__NEXT_DATA__|__NUXT__/.test(c)),
    ...[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]).filter(external),
    ...[...html.matchAll(/data-wf-site|data-wf-page/gi)].map((m) => m[0]),
  ].join('\n');
  const found = new Set();
  for (const [re, slug] of TOOL_SIGNS) if (re.test(sources)) found.add(slug);
  return [...found];
}

async function get(url, accept = 'text/html,application/xhtml+xml') {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept, 'accept-language': 'fr,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`${res.status} on ${url}`);
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; if (size > 2_500_000) { reader.cancel().catch(() => {}); break; } }
  return { url: res.url || url, type, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
}

async function sitemapUrls(origin, h) {
  const out = [];
  try {
    let xml = (await get(`${origin}/sitemap.xml`, 'application/xml,text/xml,*/*')).text;
    const nested = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
    if (nested.length) xml = (await get(nested.find((u) => /page|post|main|site/i.test(u)) || nested[0], 'application/xml,text/xml,*/*')).text;
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) { const u = decode(m[1]); if (host(u) === h && !SKIP_EXT.test(u)) out.push(u); if (out.length > 400) break; }
  } catch { /* no sitemap */ }
  return out;
}

/**
 * Crawl a site. onPage({ url, title }) is called as each page is read.
 * Returns { url, host, lang, pages: [{ url, title, description, headings, text }], tools, socials }.
 */
export async function crawlSite(input, { maxPages = 18, onPage = () => {}, concurrency = 4 } = {}) {
  const start = normalizeUrl(input);
  const first = await get(start).catch((e) => { throw new Error(`Could not open ${start}: ${e.message}`); });
  const base = new URL(first.url);
  const h = host(first.url);
  const pages = [];
  const tools = new Set();
  const seen = new Set();
  const canon = (u) => { const x = new URL(u); x.search = ''; return x.toString().replace(/\/$/, ''); };
  const take = (raw, url) => {
    const p = parsePage(raw, url);
    detectTools(raw, h).forEach((t) => tools.add(t));
    pages.push(p);
    onPage({ url: p.url, title: p.title || new URL(p.url).pathname, index: pages.length });
    return p;
  };
  seen.add(canon(first.url));
  const home = take(first.text, first.url);
  const candidates = new Map();
  const consider = (u) => {
    if (host(u) !== h || SKIP_EXT.test(u)) return;
    const c = canon(u);
    if (seen.has(c) || candidates.has(c)) return;
    candidates.set(c, scorePath(u));
  };
  home.links.forEach(consider);
  (await sitemapUrls(base.origin, h)).forEach(consider);
  let blog = 0;
  const queue = [...candidates.entries()].sort((a, b) => b[1] - a[1]).filter(([, s]) => s > -20).map(([u]) => u);
  while (pages.length < maxPages && queue.length) {
    const batch = [];
    while (batch.length < concurrency && queue.length && pages.length + batch.length < maxPages) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      if (/\/(blog|news|articles?|actualites)\//i.test(new URL(u).pathname) && ++blog > 2) continue;
      seen.add(u);
      batch.push(u);
    }
    const got = await Promise.all(batch.map((u) => get(u).then((r) => (/html/i.test(r.type) ? r : null)).catch(() => null)));
    for (const r of got) if (r && pages.length < maxPages) take(r.text, r.url);
  }
  const all = pages.flatMap((p) => p.links);
  const socials = {};
  for (const u of all) {
    const m = /^(https?:\/\/(?:www\.)?(linkedin\.com\/company\/[^/?#]+|(?:twitter|x)\.com\/[A-Za-z0-9_]+|instagram\.com\/[^/?#]+|youtube\.com\/(?:@|channel\/|c\/)[^/?#]+|facebook\.com\/[^/?#]+|tiktok\.com\/@[^/?#]+))/i.exec(u);
    if (m) { const k = m[2].split('.')[0].replace('twitter', 'x'); socials[k] ||= m[1]; }
  }
  return {
    url: first.url, host: h, lang: home.lang,
    pages: pages.map(({ links, ...p }) => p),
    tools: [...tools],
    socials,
  };
}
