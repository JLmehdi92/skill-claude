import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { t } from '../lib/i18n.js';
import { lockScroll, scrollTo } from '../lib/smooth.js';
import { openSettings } from '../dialogs/Settings.jsx';
import MiniBlock from './MiniBlock.jsx';
import './onboarding.css';

const DAYS = { '1-5': () => t('Mon–Fri'), '*': () => t('every day'), 1: () => t('Mondays'), 2: () => t('Tuesdays'), 3: () => t('Wednesdays'), 4: () => t('Thursdays'), 5: () => t('Fridays'), 6: () => t('Saturdays'), 0: () => t('Sundays') };
/** "30 9 * * 1-5" → "Mon–Fri at 09:30" (falls back to the cron itself). */
export function humanCron(cron) {
  const m = /^(\d{1,2}) ([\d,]+) \* \* (\*|[0-6]|1-5)$/.exec(String(cron || '').trim());
  if (!m) return cron;
  const hours = m[2].split(',').map((h) => `${h.padStart(2, '0')}:${m[1].padStart(2, '0')}`).join(', ');
  return t('{days} at {time}', { days: DAYS[m[3]](), time: hours });
}

function Orb({ size = 96, thinking }) {
  return (
    <span className={`fm-orb ${thinking ? 'thinking' : ''}`} style={{ '--s': `${size}px` }} aria-hidden="true">
      <span className="rb-orb-ball"><span className="rb-orb-visor"><i /><i /></span></span>
    </span>
  );
}

function AppChip({ app }) {
  return (
    <span className="fm-app">
      <img src={`/icons/${app.slug}.png`} alt="" width="16" height="16" loading="lazy" />
      {app.name}
    </span>
  );
}

/** The day of a coworker, played hour by hour. */
function Day({ items, color }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!items?.length) return undefined;
    const h = setInterval(() => setI((n) => (n + 1) % (items.length + 1)), 1400);
    return () => clearInterval(h);
  }, [items]);
  if (!items?.length) return null;
  return (
    <ol className="fm-day" style={{ '--c': color }}>
      {items.map((d, k) => (
        <li key={k} className={k < i ? 'done' : k === i ? 'now' : ''}>
          <time>{d.time}</time><span>{d.text}</span>
        </li>
      ))}
    </ol>
  );
}

function PlanCard({ agent, onRemove, removable }) {
  return (
    <article className="fm-agent" data-testid="plan-agent">
      <header>
        <MiniBlock name={agent.name.split('·')[0].trim()} color={agent.color} />
        <div>
          <h3>{agent.name}</h3>
          <p>{agent.description}</p>
        </div>
        {removable ? <button className="fm-x" onClick={onRemove} aria-label={t('Remove {name}', { name: agent.name })}>×</button> : null}
      </header>
      {agent.apps?.length ? (
        <div className="fm-row"><b>{t('Apps')}</b><div className="fm-apps">{agent.apps.map((a) => <AppChip key={a.slug} app={a} />)}</div></div>
      ) : null}
      {agent.schedules?.length ? (
        <div className="fm-row"><b>{t('Runs')}</b><div>{agent.schedules.map((s) => <span key={s.name} className="fm-sched">{s.name} · {humanCron(s.cron)}</span>)}</div></div>
      ) : null}
      <div className="fm-cols">
        <div>
          <b className="fm-label">{t('Its day')}</b>
          <Day items={agent.day} color={agent.color} />
        </div>
        <div>
          <b className="fm-label">{t('Its first week')}</b>
          <ul className="fm-week">{(agent.firstWeek || []).map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      </div>
      {agent.setup ? <p className="fm-setup"><b>{t('During setup it will ask you:')}</b> {agent.setup}</p> : null}
    </article>
  );
}

export default function Onboarding() {
  const ctx = useApp();
  const { overview, refresh, openAgent, openModal, toast } = ctx;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('site');
  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [pages, setPages] = useState([]);
  const [tools, setTools] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [modelReady, setModelReady] = useState(true);
  const [building, setBuilding] = useState([]);
  const box = useRef(null);

  // Open on a fresh workspace, or when someone asks for it (orb menu, settings).
  useEffect(() => {
    if (!overview) return;
    if (!overview.onboarding?.done && !overview.agents.length) setOpen(true);
  }, [overview?.onboarding?.done, overview?.agents.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const show = () => { setOpen(true); setStep('site'); setPlan(null); setAnalysis(null); setPages([]); setTools([]); };
    window.addEventListener('crewbox:onboarding', show);
    return () => window.removeEventListener('crewbox:onboarding', show);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    lockScroll(true);
    api('onboarding_state').then((s) => setModelReady(s.modelReady)).catch(() => {});
    return () => lockScroll(false);
  }, [open]);
  useEffect(() => { box.current?.scrollTo?.({ top: 0, behavior: 'smooth' }); }, [step]);

  useServerEvents((ev) => {
    if (ev.type !== 'onboarding' || !ev.data) return;
    const d = ev.data;
    if (d.stage === 'page') setPages((p) => (p.some((x) => x.url === d.url) ? p : [...p, d]));
    if (d.stage === 'tools') setTools(d.tools || []);
    if (d.stage === 'building') setBuilding((b) => [...b, d.name]);
  });

  if (!open) return null;

  const fail = (e) => { setError(e.message || String(e)); };
  const analyze = async (e) => {
    e?.preventDefault();
    setError(''); setPages([]); setTools([]); setStep('analyzing');
    try {
      const r = await api('onboarding_analyze', { url });
      setAnalysis(r); setTools(r.tools); setStep('goal');
    } catch (err) { fail(err); setStep('site'); }
  };
  const design = async (g = goal, fb) => {
    if (!g.trim()) return;
    setError(''); setStep('planning');
    try {
      const p = await api('onboarding_plan', { goal: g, feedback: fb || undefined, previous: fb ? plan : undefined });
      setPlan(p); setEditing(false); setFeedback(''); setStep('plan');
    } catch (err) { fail(err); setStep(plan ? 'plan' : 'goal'); }
  };
  const build = async () => {
    setError(''); setBuilding([]); setStep('building');
    try {
      const r = await api('onboarding_build', { plan });
      await refresh();
      setOpen(false);
      setTimeout(() => {
        scrollTo('#board');
        if (r.agents[0]) openAgent(r.agents[0].agentId, 'chat');
      }, 400);
      toast(t('{n} coworkers built. Each one starts its guided setup.', { n: r.agents.length }));
    } catch (err) { fail(err); setStep('plan'); }
  };
  const skip = async () => { await api('onboarding_skip').catch(() => {}); setOpen(false); refresh(); };

  const suggestions = analysis?.suggestedGoals?.length ? analysis.suggestedGoals : [t('Find leads and send them personal cold emails'), t('Answer customer support requests'), t('Get a weekly report of my numbers')];

  return (
    <div className="fm" role="dialog" aria-modal="true" aria-label={t('Set up your team with Foreman')} data-testid="onboarding">
      <div className="fm-scroll" ref={box} data-lenis-prevent>
        <div className="fm-top">
          <span className="fm-steps" aria-hidden="true">{['site', 'goal', 'plan'].map((s, i) => <i key={s} className={['site', 'analyzing'].includes(step) ? (i === 0 ? 'on' : '') : ['goal', 'planning'].includes(step) ? (i <= 1 ? 'on' : '') : 'on'} />)}</span>
          <button className="fm-skip" onClick={skip}>{t('Skip')}</button>
        </div>

        {step === 'site' ? (
          <section className="fm-step fm-center">
            <Orb size={120} />
            <h1>{t("Hi, I'm Foreman.")}</h1>
            <p className="fm-lede">{t('Give me your website: I read it, understand your business, and build you a team of coworkers that fits it.')}</p>
            <form className="fm-url" onSubmit={analyze}>
              <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('your-saas.com')} aria-label={t('Your website')} data-testid="onboarding-url" />
              <button className="fm-go" disabled={!url.trim()} data-testid="onboarding-analyze">{t('Analyze my site')} →</button>
            </form>
            <button className="fm-link" onClick={() => setStep('goal')}>{t("I don't have a website yet")}</button>
            {!modelReady ? (
              <p className="fm-note">{t('Demo mode: with no AI connected, Foreman uses its proven team recipes. Connect your Claude subscription for a plan written for your company.')} <button className="fm-link" onClick={() => openSettings(openModal, 'providers')}>{t('Connect Claude')}</button></p>
            ) : null}
            {error ? <p className="fm-error" role="alert">{error}</p> : null}
          </section>
        ) : null}

        {step === 'analyzing' ? (
          <section className="fm-step fm-center">
            <Orb size={96} thinking />
            <h2>{t('Reading {site}…', { site: url.replace(/^https?:\/\//, '').replace(/\/$/, '') })}</h2>
            <ul className="fm-pages" data-testid="onboarding-pages">
              {pages.map((p) => <li key={p.url}><span className="fm-check">✓</span><span className="fm-page-title">{p.title}</span><code>{new URL(p.url).pathname}</code></li>)}
              <li className="fm-pending"><span className="fm-spin" />{pages.length ? t('Understanding your business…') : t('Opening your site…')}</li>
            </ul>
            {tools.length ? <div className="fm-tools"><b>{t('Tools spotted on your site')}</b><div className="fm-apps">{tools.map((a) => <AppChip key={a.slug} app={a} />)}</div></div> : null}
          </section>
        ) : null}

        {step === 'goal' ? (
          <section className="fm-step">
            {analysis ? (
              <div className="fm-brain" data-testid="onboarding-brain">
                <div className="fm-brain-head"><Orb size={44} /><div><h2>{t('Here is what I understood about {name}', { name: analysis.company })}</h2><p>{t('{n} pages read · saved in the Brain, every coworker reads it', { n: analysis.pagesRead.length })}</p></div></div>
                <div className="fm-brain-grid">
                  {analysis.brain.filter((p) => p.body && p.body.length > 3 && !/^(inconnu|unknown)$/i.test(p.body.trim())).slice(0, 7).map((p) => (
                    <details key={p.slug} className="fm-brain-page" open={p.slug === 'company'}>
                      <summary>{p.title}</summary>
                      <div className="fm-md">{p.body.split('\n').filter(Boolean).slice(0, 12).map((l, i) => <p key={i}>{l.replace(/\*\*/g, '')}</p>)}</div>
                    </details>
                  ))}
                </div>
                {analysis.tools.length ? <div className="fm-tools"><b>{t('Tools spotted on your site')}</b><div className="fm-apps">{analysis.tools.map((a) => <AppChip key={a.slug} app={a} />)}</div></div> : null}
              </div>
            ) : <div className="fm-center"><Orb size={80} /></div>}
            <h2 className="fm-q">{t('What do you want your team to do for you?')}</h2>
            <textarea className="fm-goal" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('e.g. find leads every morning and send them personal cold emails with Resend')} aria-label={t('Your goal')} data-testid="onboarding-goal" />
            <div className="fm-chips">{suggestions.map((s) => <button key={s} onClick={() => setGoal(s)}>{s}</button>)}</div>
            <div className="fm-actions"><button className="fm-go" disabled={!goal.trim()} onClick={() => design()} data-testid="onboarding-design">{t('Design my team')} →</button></div>
            {error ? <p className="fm-error" role="alert">{error}</p> : null}
          </section>
        ) : null}

        {step === 'planning' ? (
          <section className="fm-step fm-center"><Orb size={96} thinking /><h2>{t('Designing your team…')}</h2><p className="fm-lede">{t('Who does what, with which apps, and when.')}</p></section>
        ) : null}

        {step === 'plan' && plan ? (
          <section className="fm-step" data-testid="onboarding-plan">
            <div className="fm-plan-head">
              <span className="fm-kicker">{plan.boxName}</span>
              <h2>{plan.summary}</h2>
              {plan.drafted !== 'model' ? <p className="fm-note">{t('Built from Foreman’s recipes (no AI connected). Connect Claude for a plan written for your company.')}</p> : null}
            </div>
            <div className="fm-agents">
              {plan.agents.map((a, i) => <PlanCard key={a.handle} agent={a} removable={plan.agents.length > 1} onRemove={() => setPlan({ ...plan, agents: plan.agents.filter((_, k) => k !== i) })} />)}
            </div>
            {editing ? (
              <div className="fm-edit">
                <textarea className="fm-goal" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t('What should change? e.g. "only one coworker", "use Gmail instead of Resend"')} aria-label={t('Changes')} />
                <div className="fm-actions"><button className="fm-ghost" onClick={() => setEditing(false)}>{t('Cancel')}</button><button className="fm-go" disabled={!feedback.trim()} onClick={() => design(plan.goal || goal, feedback)}>{t('Redesign')}</button></div>
              </div>
            ) : null}
            <div className="fm-actions sticky">
              {!editing ? <button className="fm-ghost" onClick={() => setEditing(true)}>{t('Change something')}</button> : null}
              <button className="fm-go big" onClick={build} data-testid="onboarding-build">{t('Build my team')} →</button>
            </div>
            {error ? <p className="fm-error" role="alert">{error}</p> : null}
          </section>
        ) : null}

        {step === 'building' ? (
          <section className="fm-step fm-center">
            <Orb size={96} thinking />
            <h2>{t('Building your team…')}</h2>
            <ul className="fm-pages">{building.map((n) => <li key={n}><span className="fm-check">✓</span><span className="fm-page-title">{n}</span></li>)}<li className="fm-pending"><span className="fm-spin" />{t('Skills, schedules and apps…')}</li></ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export const openOnboarding = () => window.dispatchEvent(new Event('crewbox:onboarding'));
