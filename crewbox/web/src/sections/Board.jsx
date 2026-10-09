import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, ScrollTrigger } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { t, tn } from '../lib/i18n.js';
import SpotlightCard from '../reactbits/SpotlightCard.jsx';
import SplitText from '../reactbits/SplitText.jsx';
import { Avatar, StatusBadge, Button, Segmented } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { openNewAgent } from '../dialogs/NewAgent.jsx';
import { prompt } from '../dialogs/Prompt.jsx';
import { openInbox, openNotifications } from '../dialogs/Inbox.jsx';
import { openOnboarding } from '../foreman/Onboarding.jsx';
import { openKnowledge } from '../dialogs/Knowledge.jsx';
import { openSettings } from '../dialogs/Settings.jsx';

import IsoBoard from '../board/IsoBoard.jsx';
import { scrollTo } from '../lib/smooth.js';

const VIEW_KEY = 'crewbox.boardView';

function ListView({ spaces, agents, ctx, renameBox, newBox }) {
  const { openAgent, safe, refresh } = ctx;
  const root = useRef(null);
  useGSAP(() => {
    ScrollTrigger.batch('.desk-card', {
      start: 'top 94%', once: true,
      onEnter: (els) => gsap.fromTo(els, { y: 40, opacity: 0, scale: 0.94, rotateX: 12 }, { y: 0, opacity: 1, scale: 1, rotateX: 0, duration: 0.9, ease: 'expo.out', stagger: 0.06, overwrite: true }),
    });
  }, { scope: root, dependencies: [agents.length, spaces.length] });
  return (
    <div className="boxes" ref={root}>
      {spaces.map((s) => {
        const mine = agents.filter((a) => a.space_id === s.id);
        return (
          <div className="box-panel" key={s.id}>
            <div className="box-head">
              <div className="box-title"><Icon name="grid" size={16} /><h3>{s.name}</h3><span className="count">{mine.length}</span></div>
              <div className="row">
                <button className="icon-btn" onClick={() => renameBox(s)} aria-label={t('Rename Box')}><Icon name="edit" size={15} /></button>
                {!mine.length && spaces.length > 1 ? <button className="icon-btn" onClick={safe(async () => { await api('delete_space', { spaceId: s.id }); refresh(); })} aria-label={t('Delete Box')}><Icon name="trash" size={15} /></button> : null}
              </div>
            </div>
            <div className="box-floor">
              {mine.map((a) => (
                <SpotlightCard key={a.id} className={`desk-card ${a.enabled ? '' : 'off'} st-${a.status}`} spotlightColor={a.status === 'waiting' ? 'rgba(251, 191, 36, 0.28)' : 'rgba(167, 139, 250, 0.28)'}
                  onClick={() => openAgent(a.id, a.status === 'waiting' ? 'handle' : 'chat')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openAgent(a.id); }}>
                  <div className="desk-top"><Avatar agent={a} size={52} ring={a.status} /><StatusBadge status={a.status} /></div>
                  <div className="desk-name">{a.name}</div>
                  <div className="desk-handle">@{a.handle}{a.enabled ? '' : ` · ${t('off')}`}</div>
                  {a.description ? <p className="desk-desc">{a.description}</p> : null}
                  <div className="desk-foot"><span>{t('Open')}</span><Icon name="arrow" size={14} /></div>
                </SpotlightCard>
              ))}
              <button className="desk-add" onClick={() => openNewAgent(ctx, s.id)}><span className="plus"><Icon name="plus" size={20} /></span><span>{t('Add a coworker')}</span></button>
            </div>
          </div>
        );
      })}
      <button className="box-new" onClick={newBox}><Icon name="plus" /> {t('New Box')}</button>
    </div>
  );
}

export default function Board() {
  const ctx = useApp();
  const { overview, openAgent, safe, refresh, openModal } = ctx;
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; } });
  const spaces = overview?.spaces || [];
  const agents = overview?.agents || [];
  const choose = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  const newBox = safe(async () => {
    const name = await prompt(openModal, { title: t('New Box'), label: t('A team, a client or a project'), placeholder: t('Sales team') });
    if (name) { await api('create_space', { name }); refresh(); }
  });
  const renameBox = (s) => safe(async () => {
    const name = await prompt(openModal, { title: t('Rename Box'), label: t('Name'), value: s.name });
    if (name) { await api('update_space', { spaceId: s.id, name }); refresh(); }
  })();

  return (
    <section className="section board-section" id="board">
      <header className="section-title row-title">
        <div>
          <span className="kicker">{t('01 · Headquarters')}</span>
          <SplitText text={t('Your crew, live.')} tag="h2" splitType="words" delay={80} from={{ opacity: 0, y: 50 }} to={{ opacity: 1, y: 0 }} textAlign="left" />
          <p className="lede">{t('Every Box is a floor, every coworker a block that lives on it. Watch them work, see who needs you, and click one to talk to it.')}</p>
        </div>
        <div className="row wrap">
          <Segmented value={view} onChange={choose} options={[['board', t('Board view')], ['list', t('List')]]} />
          <Button size="sm" icon="plus" onClick={newBox}>{t('New Box')}</Button>
        </div>
      </header>

      {view === 'board' && overview ? (
        <IsoBoard
          overview={overview}
          onOpen={(a) => openAgent(a.id, a.status === 'waiting' ? 'handle' : 'chat')}
          onAdd={(spaceId) => openNewAgent(ctx, spaceId || undefined)}
          onRename={renameBox}
          onNewBox={newBox}
          onInbox={() => openInbox(ctx)}
          onNotifications={() => openNotifications(ctx)}
          onTemplates={() => scrollTo('#templates')}
          onAsk={() => (overview.foremanId ? openAgent(overview.foremanId, 'chat') : openNewAgent(ctx))}
          onOnboarding={openOnboarding}
          onBrain={() => openKnowledge(ctx)}
          onAutopilot={() => openSettings(openModal, 'autopilot')}
          onList={() => choose('list')}
        />
      ) : (
        <ListView spaces={spaces} agents={agents} ctx={ctx} renameBox={renameBox} newBox={newBox} />
      )}

      {!agents.length && overview ? (
        <div className="board-hint">
          <p>{t('No coworker yet. Describe a job above, or install one that already works.')}</p>
          <Button variant="primary" icon="sparkles" onClick={() => document.querySelector('#templates')?.scrollIntoView({ behavior: 'smooth' })}>{t('Browse templates')}</Button>
        </div>
      ) : null}
      <p className="fine center">{tn('{n} coworker', '{n} coworkers', agents.length)} · {tn('{n} Box', '{n} Boxes', spaces.length)}</p>
    </section>
  );
}
