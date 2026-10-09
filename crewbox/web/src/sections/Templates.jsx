import { useEffect, useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { t, tn } from '../lib/i18n.js';
import GlareHover from '../reactbits/GlareHover.jsx';
import SplitText from '../reactbits/SplitText.jsx';
import { Select, AsyncButton, Pill, Input } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { installFromLink } from '../dialogs/TemplatesDialog.jsx';

export const CATEGORIES = {
  sales: ['Sales', 'bolt'], ecommerce: ['E-commerce', 'db'], productivity: ['Productivity', 'check'], agencies: ['Agencies', 'sparkles'],
  'real-estate': ['Real estate', 'home'], creators: ['Creators', 'play'], legal: ['Legal & compliance', 'book'], recruiting: ['Recruiting', 'link'],
  saas: ['SaaS', 'pulse'], finance: ['Finance', 'db'], marketing: ['Marketing', 'sparkles'], 'customer support': ['Customer support', 'chat'],
  operations: ['Operations', 'sliders'], research: ['Research', 'brain'], other: ['Other', 'grid'],
};
const catLabel = (c) => t(CATEGORIES[String(c).toLowerCase()]?.[0] || c);
const catIcon = (c) => CATEGORIES[String(c).toLowerCase()]?.[1] || 'sparkles';
const PAGE = 12;

export default function Templates() {
  const ctx = useApp();
  const { overview, openAgent, refresh, toast } = ctx;
  const [templates, setTemplates] = useState([]);
  const [box, setBox] = useState('');
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [catalog, setCatalog] = useState(new Set());
  const root = useRef(null);
  useEffect(() => {
    api('list_templates').then((r) => setTemplates(r.templates)).catch(() => {});
    api('list_connectors').then((r) => setCatalog(new Set(r.connectors.map((c) => c.slug)))).catch(() => {});
  }, []);
  useEffect(() => { if (!box && overview?.spaces[0]) setBox(overview.spaces[0].id); }, [overview, box]);

  const cats = useMemo(() => {
    const counts = {};
    for (const tp of templates) counts[String(tp.category).toLowerCase()] = (counts[String(tp.category).toLowerCase()] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [templates]);
  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    return templates.filter((tp) => (cat === 'all' || String(tp.category).toLowerCase() === cat)
      && (!s || `${tp.name} ${tp.description} ${(tp.tags || []).join(' ')} ${tp.agents.map((a) => `${a.name} ${a.apps.join(' ')}`).join(' ')}`.toLowerCase().includes(s)));
  }, [templates, cat, query]);
  useEffect(() => { setShown(PAGE); }, [cat, query]);

  useGSAP(() => {
    const cards = root.current?.querySelectorAll('.tpl-card');
    if (!cards?.length) return;
    gsap.fromTo(cards, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.04, overwrite: true });
  }, { scope: root, dependencies: [cat, query, shown, templates.length] });

  const install = async (tp) => {
    const r = await api('install_template', { slug: tp.slug, spaceId: box });
    await refresh();
    const setup = r.installed.find((x) => x.setupSessionId);
    toast(setup ? t('{names} installed. Guided setup started: answer its questions.', { names: r.installed.map((x) => x.name).join(', ') }) : t('Installed {names}', { names: r.installed.map((x) => x.name).join(', ') }));
    openAgent(r.installed[0].agentId);
  };

  return (
    <section className="section" id="templates" ref={root}>
      <header className="section-title">
        <span className="kicker">{t('02 · Templates')}</span>
        <SplitText text={t('Start from a coworker that already works.')} tag="h2" splitType="words" delay={60} from={{ opacity: 0, y: 50 }} to={{ opacity: 1, y: 0 }} textAlign="left" />
        <p className="lede">{t('{n} ready-made coworkers, including the full public library of rerun.build. Each one comes with its soul, its skills, its schedule and a guided setup.', { n: templates.length })}</p>
      </header>

      <div className="tpl-toolbar">
        <div className="tpl-search"><Icon name="sparkles" size={16} /><Input aria-label={t('Search templates')} placeholder={t('Search: invoices, leads, Shopify, SEO…')} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="row wrap">
          <span className="muted small">{t('Install into')}</span>
          <div style={{ width: 180 }}><Select aria-label={t('Install into')} value={box} onChange={(e) => setBox(e.target.value)}>{overview?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <button className="link-btn" onClick={() => installFromLink(ctx, box)}><Icon name="link" size={14} /> {t('Share link')}</button>
        </div>
      </div>
      <div className="cat-chips" role="group" aria-label={t('Categories')}>
        <button className={`cat-chip ${cat === 'all' ? 'on' : ''}`} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>{t('All')} <b>{templates.length}</b></button>
        {cats.map(([c, n]) => <button key={c} className={`cat-chip ${cat === c ? 'on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}><Icon name={catIcon(c)} size={13} />{catLabel(c)} <b>{n}</b></button>)}
      </div>

      <div className="tpl-grid" data-testid="template-grid">
        {filtered.slice(0, shown).map((tp) => {
          const apps = [...new Set(tp.agents.flatMap((a) => a.apps))];
          return (
            <GlareHover key={tp.slug} className="tpl-card" width="100%" height="100%" background="rgba(255,255,255,0.025)" borderColor="rgba(255,255,255,0.08)" borderRadius="22px" glareColor="#c4b5fd" glareOpacity={0.22} glareSize={300}>
              <div className="tpl-inner">
                <div className="row between">
                  <span className="tpl-icon"><Icon name={catIcon(tp.category)} size={18} /></span>
                  <div className="row">
                    {tp.origin === 'rerun' ? <Pill tone="run" title={tp.from?.url}>rerun.build</Pill> : tp.origin === 'local' ? <Pill>{t('yours')}</Pill> : <Pill tone="ok">Crewbox</Pill>}
                    <Pill>{catLabel(tp.category)}</Pill>
                  </div>
                </div>
                <h4>{tp.name}</h4>
                <p className="muted clamp-3">{tp.description}</p>
                <div className="tpl-crew">
                  {tp.agents.map((a) => (
                    <div key={a.name} className="tpl-agent">
                      <strong>{a.name}</strong>
                      <span>{[tn('{n} skill', '{n} skills', a.skills), a.schedules ? tn('{n} schedule', '{n} schedules', a.schedules) : null, a.setup ? t('guided setup') : null].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}
                </div>
                {apps.length ? (
                  <div className="app-chips">
                    {apps.map((s) => <span key={s} className={`app-chip ${catalog.has(s) ? 'in' : 'out'}`} title={catalog.has(s) ? t('In the app library') : t('Connect it with a custom MCP server')}>{s}</span>)}
                  </div>
                ) : <span className="fine">{t('No app needed')}</span>}
                <div className="row between tpl-foot">
                  <span className="fine">{tp.setupMinutes ? t('{n} min setup', { n: tp.setupMinutes }) : ''}{tp.from?.creator ? ` · ${tp.from.creator}` : ''}</span>
                  <AsyncButton variant="primary" size="sm" icon="plus" onClick={() => install(tp)}>{t('Install')}</AsyncButton>
                </div>
              </div>
            </GlareHover>
          );
        })}
      </div>
      {!filtered.length ? <p className="muted center">{t('No template matches.')}</p> : null}
      {shown < filtered.length ? (
        <div className="row center-row"><button className="more-btn" onClick={() => setShown((n) => n + PAGE * 2)}>{t('Show more')} <b>{filtered.length - shown}</b></button></div>
      ) : null}
    </section>
  );
}
