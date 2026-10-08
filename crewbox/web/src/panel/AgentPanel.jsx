import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap, lockScroll } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { Avatar, StatusBadge } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import DecryptedText from '../reactbits/DecryptedText.jsx';
import ChatTab from './ChatTab.jsx';
import { HandleTab, SkillsTab, AutomationsTab, AppsTab, MemoryTab, DataTab, FilesTab, RunsTab, SettingsTab } from './tabs.jsx';
import { t } from '../lib/i18n.js';

const TABS = () => [
  ['chat', t('Chat'), 'chat'], ['handle', t('To handle'), 'inbox'], ['skills', t('Skills'), 'book'], ['automations', t('Automations'), 'clock'],
  ['apps', t('Apps'), 'plug'], ['memory', t('Memory'), 'brain'], ['data', t('Database'), 'db'], ['files', t('Files'), 'folder'], ['runs', t('Runs'), 'pulse'], ['settings', t('Settings'), 'sliders'],
];

export default function AgentPanel() {
  const { agentId, tab, setTab, closeAgent } = useApp();
  const [agent, setAgent] = useState(null);
  const [pending, setPending] = useState(0);
  const [chatSession, setChatSession] = useState(0);
  const drawer = useRef(null);
  const back = useRef(null);
  const tabsRef = useRef(null);
  const ink = useRef(null);
  const body = useRef(null);
  const open = !!agentId;

  const load = useCallback(async () => {
    if (!agentId) return;
    try {
      const [a, p] = await Promise.all([api('get_agent', { agentId }), api('list_pauses', { agentId })]);
      setAgent(a); setPending(p.pauses.length);
    } catch { closeAgent(); }
  }, [agentId, closeAgent]);
  useEffect(() => { setAgent(null); load(); }, [load]);
  useServerEvents((ev) => { if (['agents', 'run', 'pause'].includes(ev.type) && (ev.data?.agentId === agentId || ev.data?.id === agentId)) load(); });

  useEffect(() => { if (!open) return undefined; lockScroll(true); return () => lockScroll(false); }, [open]);
  useLayoutEffect(() => {
    if (!open || !drawer.current) return;
    gsap.fromTo(back.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    gsap.fromTo(drawer.current, { xPercent: 100 }, { xPercent: 0, duration: 0.7, ease: 'expo.out' });
  }, [open, agent === null]);

  const close = () => {
    gsap.to(drawer.current, { xPercent: 100, duration: 0.45, ease: 'power3.in' });
    gsap.to(back.current, { opacity: 0, duration: 0.4, onComplete: closeAgent });
  };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-back')) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The ink bar glides to the active tab; the content fades up.
  useLayoutEffect(() => {
    const btn = tabsRef.current?.querySelector(`[data-tab="${tab}"]`);
    if (btn && ink.current) gsap.to(ink.current, { x: btn.offsetLeft, width: btn.offsetWidth, duration: 0.5, ease: 'expo.out' });
    if (body.current) gsap.fromTo(body.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab, agent?.id]);

  if (!open) return null;
  const openChat = (sessionId) => { setChatSession(sessionId); setTab('chat'); };
  const View = { chat: ChatTab, handle: HandleTab, skills: SkillsTab, automations: AutomationsTab, apps: AppsTab, memory: MemoryTab, data: DataTab, files: FilesTab, runs: RunsTab, settings: SettingsTab }[tab] || ChatTab;

  return (
    <div className="panel-layer">
      <div className="panel-back" ref={back} onClick={close} />
      <aside className="panel" data-testid="agent-panel" ref={drawer} aria-label={t('Coworker')} data-lenis-prevent>
        {agent ? (
          <>
            <header className="panel-head">
              <Avatar agent={agent} size={56} ring={agent.status} />
              <div className="grow">
                <h2><DecryptedText key={agent.id} text={agent.name} animateOn="view" speed={35} maxIterations={12} sequential revealDirection="start" /></h2>
                <div className="row wrap">
                  <span className="muted">@{agent.handle}</span>
                  <StatusBadge status={agent.status} />
                  <span className="chip-sm"><Icon name="sparkles" size={12} />{agent.runsOn.model || 'no model'}</span>
                  {!agent.enabled ? <span className="chip-sm warn">switched off</span> : null}
                </div>
              </div>
              <button className="icon-btn lg" onClick={close} aria-label={t('Close')}><Icon name="close" /></button>
            </header>
            <nav className="tabs" ref={tabsRef} role="tablist">
              <span className="tab-ink" ref={ink} />
              {TABS().map(([k, label, icon]) => (
                <button key={k} data-tab={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                  <Icon name={icon} size={15} />{label}{k === 'handle' && pending ? <span className="badge">{pending}</span> : null}
                </button>
              ))}
            </nav>
            <div className={`panel-body ${tab === 'chat' ? 'is-chat' : ''}`} ref={body}>
              <View key={`${agent.id}-${tab}-${tab === 'chat' ? chatSession : ''}`} agent={agent} openChat={openChat} initialSession={chatSession} />
            </div>
          </>
        ) : <div className="panel-loading"><span className="loader" /></div>}
      </aside>
    </div>
  );
}
