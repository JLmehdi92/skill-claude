import { getSetting, setSetting } from '../db.js';
import { emit } from '../bus.js';
import { resolveRunsOn, chat } from '../providers/index.js';
import { listSpaces, createSpace, updateSpace, createAgent, updateAgent, listAgents, agentConfig } from '../agents.js';
import { upsertSkill } from '../skills.js';
import { upsertSchedule } from '../automations.js';
import { attachConnector, findApp, CATALOG, listAgentConnectors } from '../catalog.js';
import { listTemplates, getTemplate } from '../templates.js';
import * as brain from '../brain.js';
import { crawlSite } from './crawl.js';
import { pickRecipes } from './recipes.js';

// Foreman: reads your website, writes the Brain, designs a team for the goal you give it, and
// builds it (coworkers, skills, schedules, apps, guided setup). With a model it writes everything
// for your company; without one it falls back on proven recipes and a heuristic profile.

const PALETTE = ['#2a5ddf', '#cc43ae', '#16a37a', '#e8892b', '#7c4dff', '#0ea5c6', '#d9a514', '#5b6cff'];
const lang = () => (getSetting('language', 'fr') === 'en' ? 'en' : 'fr');
const T = (fr, en) => (lang() === 'en' ? en : fr);

export const state = () => getSetting('onboarding', { done: false });
const save = (patch) => { const s = { ...state(), ...patch, updatedAt: new Date().toISOString() }; setSetting('onboarding', s); return s; };
const progress = (data) => emit('onboarding', data);

function model() {
  const r = resolveRunsOn();
  return r.connection && r.provider !== 'mock' ? r : null;
}

async function askJson(runsOn, system, user, maxTokens = 12000) {
  const r = await chat(runsOn.connection, { model: runsOn.model, system, messages: [{ role: 'user', content: user }], tools: [], effort: 'medium', maxTokens });
  const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The model did not answer with JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

/* ---------------- 1. website → Brain ---------------- */

const PROFILE_SYSTEM = (l) => `You are Foreman, the onboarding assistant of Crewbox, a platform of autonomous AI coworkers for small companies.
You just read the owner's website. Write what every coworker must know about the company. Be concrete and faithful to the pages: quote prices and names exactly, and write "unknown" rather than guessing.
Answer ONLY with JSON, every string in ${l === 'fr' ? 'French' : 'English'}:
{
  "company": { "name": "", "tagline": "", "whatItDoes": "3-5 sentences", "businessModel": "", "stage": "" },
  "offer": { "products": [{ "name": "", "description": "", "price": "" }], "pricing": "plans and prices as written on the site", "trial": "" },
  "customers": { "icp": "who buys, as precisely as possible", "segments": [""], "painPoints": [""], "proof": ["customer names, numbers, testimonials found"] },
  "brand": { "tone": "", "language": "", "doSay": [""], "dontSay": [""], "sample": "one sentence in the brand's voice" },
  "market": { "competitors": [""], "positioning": "", "differentiators": [""] },
  "growth": { "channels": ["where customers come from today"], "opportunities": ["concrete ideas an AI team could run"] },
  "suggestedGoals": ["4 to 6 goals for an AI team, each a short sentence starting with a verb, e.g. 'Find leads and send them personal cold emails'"]
}`;

const bullet = (arr) => (arr || []).filter(Boolean).map((x) => `- ${x}`).join('\n');

function profileToPages(p, site) {
  const u = T('inconnu', 'unknown');
  const pages = [
    { slug: 'company', title: T('Entreprise', 'Company'), body: [`**${p.company?.name || site.host}**${p.company?.tagline ? ` — ${p.company.tagline}` : ''}`, p.company?.whatItDoes, p.company?.businessModel && `${T('Modèle', 'Model')} : ${p.company.businessModel}`, p.company?.stage && `${T('À propos', 'About')} : ${p.company.stage}`, `${T('Site', 'Website')} : ${site.url}`].filter(Boolean).join('\n\n') },
    { slug: 'offer', title: T('Offre et tarifs', 'Offer and pricing'), body: [(p.offer?.products || []).map((x) => `- **${x.name}**${x.price ? ` (${x.price})` : ''} : ${x.description || ''}`).join('\n'), p.offer?.pricing && `${T('Tarifs', 'Pricing')} : ${p.offer.pricing}`, p.offer?.trial && `${T('Essai', 'Trial')} : ${p.offer.trial}`].filter(Boolean).join('\n\n') || u },
    { slug: 'customers', title: T('Clients cibles', 'Ideal customers'), body: [p.customers?.icp && `**ICP** : ${p.customers.icp}`, p.customers?.segments?.length && `${T('Segments', 'Segments')} :\n${bullet(p.customers.segments)}`, p.customers?.painPoints?.length && `${T('Problèmes résolus', 'Pains we solve')} :\n${bullet(p.customers.painPoints)}`, p.customers?.proof?.length && `${T('Preuves', 'Proof')} :\n${bullet(p.customers.proof)}`].filter(Boolean).join('\n\n') || u },
    { slug: 'brand', title: T('Ton et marque', 'Voice and brand'), body: [p.brand?.tone && `${T('Ton', 'Tone')} : ${p.brand.tone}`, p.brand?.language && `${T('Langue', 'Language')} : ${p.brand.language}`, p.brand?.doSay?.length && `${T('À dire', 'Say')} :\n${bullet(p.brand.doSay)}`, p.brand?.dontSay?.length && `${T('À éviter', 'Avoid')} :\n${bullet(p.brand.dontSay)}`, p.brand?.sample && `${T('Exemple', 'Sample')} : « ${p.brand.sample} »`].filter(Boolean).join('\n\n') || u },
    { slug: 'market', title: T('Marché et concurrents', 'Market and competitors'), body: [p.market?.positioning && `${T('Positionnement', 'Positioning')} : ${p.market.positioning}`, p.market?.competitors?.length && `${T('Concurrents', 'Competitors')} :\n${bullet(p.market.competitors)}`, p.market?.differentiators?.length && `${T('Différences', 'Differentiators')} :\n${bullet(p.market.differentiators)}`].filter(Boolean).join('\n\n') || u },
    { slug: 'growth', title: T('Croissance', 'Growth'), body: [p.growth?.channels?.length && `${T('Canaux actuels', 'Current channels')} :\n${bullet(p.growth.channels)}`, p.growth?.opportunities?.length && `${T('Opportunités', 'Opportunities')} :\n${bullet(p.growth.opportunities)}`].filter(Boolean).join('\n\n') || u },
  ];
  return pages;
}

function toolsPage(site) {
  const names = site.tools.map((s) => findApp(s)?.name || s);
  const socials = Object.entries(site.socials || {}).map(([k, v]) => `- ${k} : ${v}`).join('\n');
  return { slug: 'tools', title: T('Outils et présence en ligne', 'Tools and online presence'), body: [names.length ? `${T('Outils repérés sur le site', 'Tools spotted on the website')} :\n${bullet(names)}` : T('Aucun outil repéré sur le site.', 'No tool spotted on the website.'), socials && `${T('Réseaux', 'Social accounts')} :\n${socials}`].filter(Boolean).join('\n\n') };
}

function heuristicProfile(site) {
  const home = site.pages[0] || {};
  const name = (home.title || site.host).split(/\s[|–—-]\s|\s?\|\s?/)[0].trim() || site.host;
  const clean = (x) => (x || '').replace(/\s+/g, ' ').trim();
  // A page's text without the headings it opens with.
  const body = (p) => (p.headings || []).reduce((txt, h) => (txt.startsWith(clean(h.text)) ? txt.slice(clean(h.text).length).trim() : txt), clean(p.text));
  const homeHeads = (home.headings || []).map((h) => clean(h.text)).filter((h) => h && h !== home.description);
  // Prices: the sentences of the pricing pages that carry an amount, not the whole page.
  const priced = site.pages.filter((p) => /pric|tarif|prix|plans?\b|abonnement/i.test(p.url));
  const amounts = [...new Set(priced.flatMap((p) => body(p).split(/(?<=[.!?\n])\s+/)).map(clean).filter((l) => /\d\s?(€|\$|£|eur|usd)|(€|\$|£)\s?\d|gratuit|free/i.test(l) && l.length < 220))].slice(0, 8);
  // Who it is for: headings and sentences that say so ("pour les …", "for …", "built for …").
  const audience = [...new Set(site.pages.flatMap((p) => [...(p.headings || []).map((h) => h.text), ...(p.text || '').split(/(?<=[.!?])\s+/)]).map(clean)
    .filter((l) => /^(pour|for|built for|conçu pour|idéal pour|made for)\b|\b(destiné|dedicated) (aux|to)\b/i.test(l) && l.length < 160))].slice(0, 4);
  const about = site.pages.find((p) => /about|a-propos|qui-sommes|equipe|team|mission/i.test(p.url));
  return {
    company: {
      name,
      tagline: clean(home.description) || homeHeads[0] || '',
      whatItDoes: homeHeads.slice(0, 3).join(' · '),
      stage: about ? body(about).split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : '',
    },
    offer: { pricing: amounts.join('\n') },
    customers: { icp: audience[0] || T('À préciser avec toi.', 'To refine with you.'), segments: audience.slice(1) },
    brand: { language: site.lang || '', sample: homeHeads[0] || '' },
    market: {},
    growth: { channels: Object.keys(site.socials || {}) },
    suggestedGoals: [
      T('Trouver des leads et leur envoyer des emails de prospection', 'Find leads and send them personal cold emails'),
      T('Répondre aux demandes du support client', 'Answer customer support requests'),
      T('Écrire des articles pour le SEO', 'Write articles for SEO'),
      T('Publier sur LinkedIn chaque semaine', 'Post on LinkedIn every week'),
      T('Recevoir un rapport hebdo de mes chiffres', 'Get a weekly report of my numbers'),
    ],
  };
}

export async function analyzeWebsite({ url }) {
  save({ step: 'analyzing', url });
  progress({ stage: 'start', url });
  const site = await crawlSite(url, { maxPages: 18, onPage: (p) => progress({ stage: 'page', ...p }) });
  progress({ stage: 'tools', tools: site.tools.map((s) => ({ slug: s, name: findApp(s)?.name || s })) });
  progress({ stage: 'thinking' });
  const runsOn = model();
  let profile, drafted = 'heuristic';
  if (runsOn) {
    const corpus = site.pages.map((p) => `=== ${p.url}\nTITLE: ${p.title}\nDESCRIPTION: ${p.description}\nHEADINGS: ${p.headings.map((h) => h.text).join(' | ')}\n${p.text.slice(0, 4500)}`).join('\n\n').slice(0, 60_000);
    try { profile = await askJson(runsOn, PROFILE_SYSTEM(lang()), `Website: ${site.url}\nTools spotted: ${site.tools.join(', ') || 'none'}\n\n${corpus}`); drafted = 'model'; }
    catch (e) { progress({ stage: 'warning', message: e.message }); }
  }
  profile ||= heuristicProfile(site);
  const pages = [...profileToPages(profile, site), toolsPage(site)];
  pages.forEach((p, i) => brain.upsertPage({ ...p, source: 'website', position: i }));
  const out = {
    url: site.url, host: site.host, drafted,
    company: profile.company?.name || site.host,
    pagesRead: site.pages.map((p) => ({ url: p.url, title: p.title })),
    tools: site.tools.map((s) => ({ slug: s, name: findApp(s)?.name || s })),
    suggestedGoals: (profile.suggestedGoals || []).slice(0, 6),
    brain: brain.listPages().map(({ slug, title, body }) => ({ slug, title, body })),
  };
  save({ step: 'goal', url: site.url, company: out.company, tools: site.tools, suggestedGoals: out.suggestedGoals });
  progress({ stage: 'done' });
  return out;
}

/* ---------------- 2. goal → plan ---------------- */

function candidateTemplates(goal) {
  const words = String(goal).toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length > 3);
  return listTemplates().map((t) => {
    const hay = `${t.name} ${t.description} ${(t.tags || []).join(' ')} ${t.agents.map((a) => `${a.name} ${a.apps.join(' ')}`).join(' ')}`.toLowerCase();
    return { t, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
  }).filter((x) => x.score).sort((a, b) => b.score - a.score).slice(0, 10).map(({ t }) => t);
}

const PLAN_SYSTEM = (l, catalogList, templates) => `You are Foreman, who designs and builds teams of autonomous AI coworkers in Crewbox for a small company.
Each coworker: a soul (its system prompt), skills (procedures), scheduled tasks (cron), apps (connectors from the library), a private SQLite database plus a database shared with the team, memory, web access, and it stops for the owner's approval before anything consequential (sending emails, paying, deleting, publishing). Coworkers hand work to each other with @handle and the shared database.
Design the smallest team (1 to 4 coworkers) that achieves the owner's goal for THIS company (use the Brain). Prefer specialists that pass work along (e.g. one finds leads into a shared table, another writes and sends the emails).
Answer ONLY with JSON, visible strings (name, description, setup, firstWeek, day text, boxName, summary, schedule names) in ${l === 'fr' ? 'French' : 'English'}, souls and skills in English:
{
  "boxName": "short team name",
  "summary": "2 sentences: what the team will do",
  "agents": [{
    "name": "First name · Role",
    "handle": "short_snake_case",
    "description": "one sentence",
    "color": "#hex from ${PALETTE.join(' ')}",
    "template": "slug of a template below to start from, or null",
    "soul": "markdown, 200-450 words: who it is, what it owns (tables, outputs), step-by-step how it works, who it hands work to (@handle), what needs approval, what it must never do",
    "skills": [{ "name": "", "description": "Use when …", "body": "numbered procedure" }],
    "schedules": [{ "name": "", "cron": "5-field cron", "timezone": "IANA", "body": "instruction the coworker receives when it fires" }],
    "connectors": ["slugs from the library below, only what the job needs"],
    "setup": "what it will ask the owner during its guided setup",
    "firstWeek": ["3 concrete deliverables of the first week"],
    "day": [{ "time": "HH:MM", "text": "what it does at that time on a typical day" }]
  }]
}
Library (slug: name): ${catalogList}
Templates you may start from: ${templates || 'none'}`;

function recipePlan(goal) {
  const l = lang();
  const agents = pickRecipes(goal).flatMap((r) => r.agents).slice(0, 4).map((a) => ({
    name: a.name[l], handle: a.handle || a.key.replace(/-/g, '_'), description: a.description[l], color: a.color, template: null,
    soul: a.soul, skills: a.skills, schedules: a.schedules.map((s) => ({ ...s, name: s.name[l] })), connectors: a.connectors,
    setup: a.setup[l], firstWeek: a.firstWeek.map((x) => x[l]), day: a.day.map(([time, text]) => ({ time, text: text[l] })),
  }));
  return { boxName: T('Mon équipe', 'My team'), summary: T(`Une équipe de ${agents.length} coworker${agents.length > 1 ? 's' : ''} pour : ${goal}`, `A team of ${agents.length} coworker${agents.length > 1 ? 's' : ''} to: ${goal}`), agents };
}

function cleanPlan(plan) {
  const used = new Set(listAgents().map((a) => a.handle));
  plan.agents = (plan.agents || []).slice(0, 4).map((a, i) => {
    let handle = String(a.handle || a.name || `coworker_${i + 1}`).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || `coworker_${i + 1}`;
    while (used.has(handle)) handle = `${handle}_${i + 2}`;
    used.add(handle);
    const connectors = [...new Set((a.connectors || []).filter((s) => findApp(s)))];
    return {
      ...a, handle,
      color: PALETTE.includes(a.color) ? a.color : PALETTE[i % PALETTE.length],
      template: a.template && getTemplate(a.template) ? a.template : null,
      skills: (a.skills || []).filter((s) => s?.name && s?.body).slice(0, 4),
      schedules: (a.schedules || []).filter((s) => s?.cron && s?.body).slice(0, 3),
      connectors,
      apps: connectors.map((s) => ({ slug: s, name: findApp(s).name, auth: findApp(s).methods?.[0]?.kind || findApp(s).auth })),
      firstWeek: (a.firstWeek || []).slice(0, 4),
      day: (a.day || []).filter((d) => /^\d{1,2}:\d{2}$/.test(d.time)).slice(0, 6),
    };
  });
  if (!plan.agents.length) throw new Error('The plan has no coworker.');
  return plan;
}

export async function makePlan({ goal, feedback, previous }) {
  if (!goal?.trim()) throw new Error(T('Dis-moi ce que tu veux que ton équipe fasse.', 'Tell me what you want your team to do.'));
  save({ step: 'planning', goal });
  progress({ stage: 'planning' });
  const runsOn = model();
  let plan, drafted = 'recipes';
  if (runsOn) {
    const catalogList = CATALOG.map((a) => `${a.slug}: ${a.name}`).join(', ');
    const templates = candidateTemplates(goal).map((t) => `${t.slug} (${t.name}: ${t.description}; agents ${t.agents.map((a) => a.name).join(', ')}; apps ${[...new Set(t.agents.flatMap((a) => a.apps))].join(', ')})`).join('\n');
    const user = [`Goal of the owner: ${goal}`, `## The Brain\n${brain.brainPrompt() || 'empty'}`, previous && `## Previous plan\n${JSON.stringify(previous).slice(0, 12_000)}`, feedback && `## Owner's feedback on it\n${feedback}`].filter(Boolean).join('\n\n');
    try { plan = await askJson(runsOn, PLAN_SYSTEM(lang(), catalogList, templates), user, 16000); drafted = 'model'; }
    catch (e) { progress({ stage: 'warning', message: e.message }); }
  }
  plan = cleanPlan(plan || recipePlan(goal));
  plan.drafted = drafted;
  plan.goal = goal;
  save({ step: 'plan', goal, plan });
  progress({ stage: 'planned' });
  return plan;
}

/* ---------------- 3. plan → team ---------------- */

function setupPrompt(a, agentId) {
  const apps = listAgentConnectors(agentId);
  const pending = apps.filter((x) => x.status !== 'active');
  return [
    `Guided setup. Foreman just built you for the owner's company (read the Brain) with this job: ${a.description}`,
    'Set yourself up now, in this conversation, one step at a time, and keep each message short:',
    pending.length
      ? `1. Apps: ${pending.map((x) => `${x.name} (${x.slug}, ${x.status})`).join(', ')}. For each, raise suggest_service with its slug so the owner connects it in a masked form or with a sign-in. Never ask for a key in the chat.`
      : '1. Your apps are connected: check they answer with one harmless read call.',
    `2. Ask the owner, in ONE ask_user card, only what the Brain does not already say. Topics: ${a.setup || 'what you need to do the job well'}.`,
    '3. Do one small, safe test that changes nothing outside (no email sent, nothing published or paid) and show the result.',
    `4. When the owner is happy, switch on your scheduled tasks${a.schedules?.length ? ` (${a.schedules.map((s) => s.name).join(', ')})` : ''} with schedule_upsert (enabled: true) and say when you will run next.`,
    'Save what you learn about preferences in memory, and procedures in your skills.',
  ].join('\n');
}

export function buildTeam({ plan, startSetup }) {
  if (!plan?.agents?.length) throw new Error('No plan to build.');
  save({ step: 'building' });
  // The first team lands in the default Box; it takes the team's name if it is still empty.
  const spaces = listSpaces();
  let space = spaces.find((s) => !s.agentCount) || null;
  if (space && spaces.length === 1) updateSpace(space.id, { name: plan.boxName || space.name });
  if (!space) space = createSpace({ name: plan.boxName || T('Nouvelle équipe', 'New team') });
  const built = [];
  for (const a of plan.agents) {
    progress({ stage: 'building', name: a.name });
    const tpl = a.template ? getTemplate(a.template) : null;
    const from = tpl?.agents?.[0];
    const agent = createAgent({ name: a.name, handle: a.handle, description: a.description, soul: a.soul || from?.soul || '', spaceId: space.id, color: a.color, setup: { required: true, prompt: 'pending' } });
    for (const s of [...(a.skills || []), ...(from?.skills || [])]) { try { upsertSkill(agent.id, s); } catch { /* duplicate or malformed */ } }
    for (const s of a.schedules || []) { try { upsertSchedule(agent.id, { name: s.name, cron: s.cron, timezone: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, body: s.body, enabled: false }); } catch { /* bad cron */ } }
    const apps = (a.connectors || []).map((slug) => { try { return attachConnector(agent.id, slug); } catch (e) { return { slug, error: e.message }; } });
    const cfg = agentConfig(agent.id);
    const prompt = setupPrompt(a, agent.id);
    updateAgent(agent.id, { setup: { required: true, prompt } }); // written once the apps are attached
    built.push({ agentId: agent.id, name: cfg.name, handle: cfg.handle, color: a.color, apps, setupPrompt: prompt });
  }
  // Guided setups start once every coworker exists, so they can name each other.
  for (const b of built) {
    if (!startSetup) break;
    try { b.setupSessionId = startSetup({ agentId: b.agentId, input: b.setupPrompt, trigger: 'chat', sessionKind: 'chat', sessionTitle: T('Configuration guidée', 'Guided setup') }).sessionId; }
    catch { /* no AI provider yet: the owner starts it from the chat */ }
  }
  save({ done: true, step: 'done', builtAt: new Date().toISOString(), spaceId: space.id, built: built.map(({ agentId, name }) => ({ agentId, name })) });
  progress({ stage: 'built', agents: built.map(({ agentId, name }) => ({ agentId, name })) });
  return { spaceId: space.id, agents: built.map(({ setupPrompt: _p, ...b }) => b) };
}

export const skip = () => save({ done: true, step: 'skipped' });
export const restart = () => save({ done: false, step: 'site' });
