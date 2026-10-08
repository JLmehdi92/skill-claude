import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, ScrollTrigger } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import SpotlightCard from '../reactbits/SpotlightCard.jsx';
import SplitText from '../reactbits/SplitText.jsx';
import { Avatar, StatusBadge, Button } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { openNewAgent } from '../dialogs/NewAgent.jsx';
import { prompt } from '../dialogs/Prompt.jsx';

export default function Board() {
  const ctx = useApp();
  const { overview, openAgent, safe, refresh, openModal } = ctx;
  const root = useRef(null);
  const spaces = overview?.spaces || [];
  const agents = overview?.agents || [];

  useGSAP(() => {
    ScrollTrigger.batch('.desk-card', {
      start: 'top 92%',
      once: true,
      onEnter: (els) => gsap.fromTo(els, { y: 40, opacity: 0, scale: 0.94, rotateX: 12 }, { y: 0, opacity: 1, scale: 1, rotateX: 0, duration: 0.9, ease: 'expo.out', stagger: 0.07, overwrite: true }),
    });
    gsap.utils.toArray('.box-panel').forEach((el) => {
      gsap.from(el, { y: 60, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
    });
  }, { scope: root, dependencies: [agents.length, spaces.length], revertOnUpdate: false });

  const newBox = safe(async () => {
    const name = await prompt(openModal, { title: 'New Box', label: 'A team, a client or a project', placeholder: 'Sales team' });
    if (name) { await api('create_space', { name }); refresh(); }
  });
  const renameBox = (s) => safe(async () => {
    const name = await prompt(openModal, { title: 'Rename Box', label: 'Name', value: s.name });
    if (name) { await api('update_space', { spaceId: s.id, name }); refresh(); }
  })();

  return (
    <section className="section" id="board" ref={root}>
      <header className="section-title">
        <span className="kicker">01 · The board</span>
        <SplitText text="Your crew, at work." tag="h2" splitType="words" delay={80} from={{ opacity: 0, y: 50 }} to={{ opacity: 1, y: 0 }} textAlign="left" />
        <p className="lede">Boxes group coworkers by team, client or project. Click a coworker to talk to it, see what it did, and teach it.</p>
      </header>

      <div className="boxes">
        {spaces.map((s) => {
          const mine = agents.filter((a) => a.space_id === s.id);
          return (
            <div className="box-panel" key={s.id}>
              <div className="box-head">
                <div className="box-title">
                  <Icon name="grid" size={16} />
                  <h3>{s.name}</h3>
                  <span className="count">{mine.length}</span>
                </div>
                <div className="row">
                  <button className="icon-btn" onClick={() => renameBox(s)} aria-label="Rename Box"><Icon name="edit" size={15} /></button>
                  {!mine.length && spaces.length > 1 ? <button className="icon-btn" onClick={safe(async () => { await api('delete_space', { spaceId: s.id }); refresh(); })} aria-label="Delete Box"><Icon name="trash" size={15} /></button> : null}
                </div>
              </div>
              <div className="box-floor">
                {mine.map((a) => (
                  <SpotlightCard
                    key={a.id}
                    className={`desk-card ${a.enabled ? '' : 'off'} st-${a.status}`}
                    spotlightColor={a.status === 'waiting' ? 'rgba(251, 191, 36, 0.28)' : 'rgba(167, 139, 250, 0.28)'}
                    onClick={() => openAgent(a.id, a.status === 'waiting' ? 'handle' : 'chat')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') openAgent(a.id); }}
                  >
                    <div className="desk-top">
                      <Avatar agent={a} size={52} ring={a.status} />
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="desk-name">{a.name}</div>
                    <div className="desk-handle">@{a.handle}{a.enabled ? '' : ' · off'}</div>
                    {a.description ? <p className="desk-desc">{a.description}</p> : null}
                    <div className="desk-foot"><span>Open</span><Icon name="arrow" size={14} /></div>
                  </SpotlightCard>
                ))}
                <button className="desk-add" onClick={() => openNewAgent(ctx, s.id)}>
                  <span className="plus"><Icon name="plus" size={20} /></span>
                  <span>Add a coworker</span>
                </button>
              </div>
            </div>
          );
        })}
        <button className="box-new" onClick={newBox}><Icon name="plus" /> New Box</button>
      </div>
      {!agents.length && overview ? (
        <div className="board-hint">
          <p>No coworker yet. Describe a job above, or install one that already works.</p>
          <Button variant="primary" icon="sparkles" onClick={() => document.querySelector('#templates')?.scrollIntoView({ behavior: 'smooth' })}>Browse templates</Button>
        </div>
      ) : null}
    </section>
  );
}
