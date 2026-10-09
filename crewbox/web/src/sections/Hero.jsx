import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import Aurora from '../reactbits/Aurora.jsx';
import SplitText from '../reactbits/SplitText.jsx';
import RotatingText from '../reactbits/RotatingText.jsx';
import ShinyText from '../reactbits/ShinyText.jsx';
import BlurText from '../reactbits/BlurText.jsx';
import CountUp from '../reactbits/CountUp.jsx';
import StarBorder from '../reactbits/StarBorder.jsx';
import Magnet from '../reactbits/Magnet.jsx';
import GradientText from '../reactbits/GradientText.jsx';
import Icon from '../ui/icons.jsx';
import { openSettings } from '../dialogs/Settings.jsx';
import { t, getLang } from '../lib/i18n.js';
import LangSwitch from '../ui/LangSwitch.jsx';

const JOBS = {
  en: ['chase invoices', 'find new leads', 'answer customers', 'write the weekly report', 'watch competitors', 'triage the inbox'],
  fr: ['relancent tes factures', 'trouvent des leads', 'répondent à tes clients', 'écrivent le rapport hebdo', 'surveillent tes concurrents', 'trient ta boîte mail'],
};
const EXAMPLES = {
  en: [
    ['Lead finder', 'Every weekday at 8, find 20 local businesses that match my ideal customer and add them to a leads table.'],
    ['Invoice chaser', 'Every Monday, check unpaid invoices, draft polite reminders and ask me before sending anything.'],
    ['Competitor watch', 'Every morning, check my competitors pricing pages and tell me only when something meaningful changed.'],
    ['Weekly report', 'Every Monday at 9, compile last week numbers from the shared database into a one-page report.'],
  ],
  fr: [
    ['Chasseur de leads', 'Chaque jour de semaine à 8h, trouve 20 entreprises locales qui correspondent à mon client idéal et ajoute-les à une table de leads.'],
    ['Relance factures', 'Chaque lundi, vérifie les factures impayées, rédige des relances polies et demande-moi avant d’envoyer quoi que ce soit.'],
    ['Veille concurrents', 'Chaque matin, regarde les pages de prix de mes concurrents et préviens-moi seulement si quelque chose d’important a changé.'],
    ['Rapport hebdo', 'Chaque lundi à 9h, compile les chiffres de la semaine depuis la base partagée en un rapport d’une page.'],
  ],
};

export default function Hero() {
  const { overview, openAgent, refresh, safe, toast, openModal } = useApp();
  const L = getLang();
  const [job, setJob] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef(null);
  const offline = overview && overview.connections.every((c) => c.provider === 'mock');

  useGSAP(() => {
    // Parallax: the hero copy drifts up and fades while the aurora sinks behind it.
    gsap.to('.hero-inner', { yPercent: -18, opacity: 0.15, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero-aurora', { scale: 1.25, yPercent: 12, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true } });
    gsap.from('.hero-reveal', { y: 24, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.08, delay: 0.5 });
  }, { scope: root });

  const create = safe(async () => {
    if (!job.trim()) { toast(t('Describe the job first')); return; }
    setBusy(true);
    try {
      const r = await api('build_agent', { description: job, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setJob('');
      await refresh();
      openAgent(r.agentId);
      toast(r.drafted === 'model' ? t('{name} wrote its own soul, skills and schedule. Schedules start paused.', { name: r.name }) : t('{name} is ready. Connect an AI provider so coworkers can draft themselves.', { name: r.name }));
    } finally { setBusy(false); }
  });

  const u = overview?.usage || { runs: 0, tokens: 0, cost: 0 };
  const stats = [
    [overview?.agents.length || 0, t('coworkers')],
    [overview?.runningRuns || 0, t('working now')],
    [overview?.pendingPauses || 0, t('waiting for you')],
    [u.runs, t('runs · 30 days')],
  ];

  return (
    <section className="hero" ref={root} id="top">
      <div className="hero-aurora" aria-hidden="true">
        <Aurora colorStops={['#5b2bff', '#22d3ee', '#c084fc']} amplitude={1.1} blend={0.6} speed={0.6} />
      </div>
      <div className="hero-grain" aria-hidden="true" />
      <nav className="hero-nav">
        <a className="brand" href="#top">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs><rect x="3" y="9" width="26" height="18" rx="6" fill="url(#lg)" /><circle cx="12" cy="18" r="3" fill="#07060d" /><circle cx="20" cy="18" r="3" fill="#07060d" /><rect x="13" y="3" width="6" height="7" rx="2" fill="#a78bfa" /></svg>
          <GradientText colors={['#c4b5fd', '#67e8f9', '#f0abfc', '#c4b5fd']} animationSpeed={6} className="brand-word">Crewbox</GradientText>
        </a>
        <div className="row">
          <LangSwitch />
          <button className="chip" onClick={() => openSettings(openModal, 'providers')}>
            <span className={`dot ${offline ? 'amber' : 'green'}`} />
            <ShinyText text={offline ? t('Offline demo · connect your Claude') : t('Running on {name}', { name: overview?.connections.find((c) => c.isDefault)?.name || t('your AI') })} speed={3} color="#cfcae6" shineColor="#ffffff" />
          </button>
        </div>
      </nav>

      <div className="hero-inner">
        <div className="eyebrow hero-reveal">
          <ShinyText text={t('Your AI team · runs on your own machine')} speed={2.6} color="#b9b3d6" shineColor="#ffffff" />
        </div>
        <h1 className="hero-title" aria-label={`${t('Your recurring work,')} ${t('done while you sleep.')}`}>
          <SplitText text={t('Your recurring work,')} tag="span" className="line" delay={28} duration={1.1} from={{ opacity: 0, y: 60, rotateX: -50 }} to={{ opacity: 1, y: 0, rotateX: 0 }} />
          <SplitText text={t('done while you sleep.')} tag="span" className="line accent" delay={28} duration={1.1} from={{ opacity: 0, y: 60, rotateX: -50 }} to={{ opacity: 1, y: 0, rotateX: 0 }} />
        </h1>
        <div className="hero-rotator hero-reveal">
          <span>{t('Coworkers that')}</span>
          <RotatingText texts={JOBS[L] || JOBS.en} mainClassName="rotator" staggerFrom="last" staggerDuration={0.02} splitLevelClassName="rotator-split" rotationInterval={2400} transition={{ type: 'spring', damping: 30, stiffness: 400 }} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '-120%' }} />
        </div>
        <div className="hero-sub">
          <BlurText text={t('Describe a job in your own words. It writes its own prompt, skills and schedule, connects to your tools, and stops to ask you before anything risky.')} delay={45} animateBy="words" direction="bottom" className="hero-sub-text" />
        </div>

        <div className="prompt-bar hero-reveal">
          <textarea
            data-testid="job-input"
            value={job}
            onChange={(e) => setJob(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); }}
            placeholder={t('Find new leads every morning and add them to my list…')}
            rows={2}
            aria-label={t('Describe the job')}
          />
          <Magnet padding={60} magnetStrength={4}>
            <StarBorder as="button" data-testid="create-coworker" className="cta" color="#67e8f9" speed="4s" onClick={create} disabled={busy}>
              <Icon name="sparkles" size={16} /> {busy ? t('Setting itself up…') : t('Create coworker')}
            </StarBorder>
          </Magnet>
        </div>
        <div className="examples hero-reveal">
          {(EXAMPLES[L] || EXAMPLES.en).map(([label, text]) => <button key={label} className="example" onClick={() => setJob(text)}>{label}</button>)}
        </div>

        <div className="stats hero-reveal">
          {stats.map(([n, label]) => (
            <div className="stat" key={label}>
              <b><CountUp to={Number(n)} duration={1.6} separator="," /></b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="scroll-cue" aria-hidden="true"><span /></div>
    </section>
  );
}
