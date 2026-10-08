import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '../lib/smooth.js';
import Icon from '../ui/icons.jsx';

const STEPS = [
  ['sparkles', 'Give it a job', 'Describe the work in your own words. The coworker writes its own soul, its skills and its schedule.', ['Chase invoices · every Monday', 'Reply to leads · on every new email', 'Find 20 new leads · every day, 8:00']],
  ['plug', 'Connect your tools and your AI', 'Any MCP server, one click for the apps in the library. Claude, OpenAI, OpenRouter or a local model.', ['Stripe · active', 'Notion · active', 'Slack · needs a token']],
  ['hand', 'It works, and stops to ask', 'Runs on a cron or a webhook. Before paying, emailing a client or deleting, it shows you a card and waits.', ['07:00 · Sorted the inbox', '07:09 · Chased 2 invoices', '07:12 · Approval: refund $230?']],
];

/** Pinned storytelling: the section sticks while each step slides in, scrubbed by the scroll. */
export default function HowItWorks() {
  const root = useRef(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top top', end: '+=1800', scrub: 0.8, pin: '.how-stage' } });
      tl.to('.how-progress i', { scaleX: 1, ease: 'none', duration: STEPS.length }, 0);
      STEPS.forEach((_, i) => {
        if (i > 0) tl.to(`.how-step:nth-child(${i})`, { opacity: 0.18, scale: 0.94, filter: 'blur(3px)', duration: 0.5 }, i - 0.2);
        tl.fromTo(`.how-step:nth-child(${i + 1})`, { opacity: 0, y: 80 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, i === 0 ? 0 : i - 0.1);
        tl.fromTo(`.how-step:nth-child(${i + 1}) .how-line`, { x: -30, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.12, duration: 0.4 }, (i === 0 ? 0 : i - 0.1) + 0.2);
      });
    });
    mm.add('(max-width: 899px), (prefers-reduced-motion: reduce)', () => {
      gsap.utils.toArray('.how-step').forEach((el) => gsap.from(el, { y: 40, opacity: 0, duration: 0.8, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
    });
    return () => mm.revert();
  }, { scope: root });

  return (
    <section className="how" ref={root} id="how">
      <div className="how-stage">
        <header className="section-title">
          <span className="kicker">03 · How it works</span>
          <h2>From a sentence to a coworker that runs on its own.</h2>
        </header>
        <div className="how-progress" aria-hidden="true"><i /></div>
        <div className="how-steps">
          {STEPS.map(([icon, title, text, lines], i) => (
            <article className="how-step" key={title}>
              <span className="how-num">0{i + 1}</span>
              <span className="how-icon"><Icon name={icon} size={20} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <ul>{lines.map((l) => <li className="how-line" key={l}>{l}</li>)}</ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
