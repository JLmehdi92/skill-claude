import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { ago } from '../lib/format.js';
import { Avatar, Button, Empty, Pill } from '../ui/kit.jsx';
import PauseCard from '../panel/PauseCard.jsx';
import AnimatedContent from '../reactbits/AnimatedContent.jsx';
import { t } from '../lib/i18n.js';

const TONE = { error: 'bad', done: 'ok', question: 'warn', approval: 'warn', connector: 'warn', secret: 'warn', progress: 'run' };

export function NotificationList({ list, onOpen }) {
  const { openAgent } = useApp();
  if (!list.length) return <Empty icon="bell">{t('No notifications.')}</Empty>;
  return (
    <div className="notif-list">
      {list.map((n) => (
        <div className={`notif ${n.read ? 'read' : ''}`} key={n.id}>
          <Pill tone={TONE[n.kind] || ''}>{n.kind}</Pill>
          <div className="grow">
            <strong>{n.title}</strong>
            {n.body ? <p className="muted small pre">{n.body}</p> : null}
          </div>
          <div className="notif-side">
            <span className="muted small">{ago(n.created_at)}</span>
            {n.agent_id && n.agent_name ? <button className="link-btn" onClick={() => { onOpen?.(); openAgent(n.agent_id, n.pause_id ? 'handle' : 'runs'); }}>{t('Open {name}', { name: n.agent_name })}</button> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function InboxBody({ close }) {
  const { overview, openAgent } = useApp();
  const [pauses, setPauses] = useState(null);
  const load = () => api('list_pauses', {}).then((r) => setPauses(r.pauses));
  useEffect(() => { load(); }, []);
  useServerEvents((ev) => { if (ev.type === 'pause') load(); });
  if (!pauses) return null;
  if (!pauses.length) return <Empty icon="check">{t('Nothing is waiting for you. Your crew is on it.')}</Empty>;
  const agents = new Map(overview?.agents.map((a) => [a.id, a]));
  return (
    <div className="stack">
      {pauses.map((p, i) => {
        const a = agents.get(p.agent_id) || { name: '?', handle: '?' };
        return (
          <AnimatedContent key={p.id} distance={40} delay={i * 0.06} duration={0.6}>
            <div className="inbox-item">
              <div className="row">
                <Avatar agent={a} size={30} />
                <strong>{a.name}</strong><span className="muted small">{ago(p.created_at)}</span>
                <span className="grow" />
                <button className="link-btn" onClick={() => { close(); openAgent(p.agent_id, 'chat'); }}>{t('Open conversation')}</button>
              </div>
              <PauseCard pause={p} onAnswered={load} />
            </div>
          </AnimatedContent>
        );
      })}
    </div>
  );
}

export const openInbox = (ctx) => ctx.openModal({ title: t('To handle'), wide: true, render: (close) => <InboxBody close={close} /> });

function NotificationsBody({ close }) {
  const { refresh, safe } = useApp();
  const [list, setList] = useState(null);
  const load = () => api('list_notifications', {}).then((r) => setList(r.notifications));
  useEffect(() => { load(); }, []);
  if (!list) return null;
  return (
    <div className="stack">
      <div className="row end"><Button size="sm" icon="check" onClick={safe(async () => { await api('mark_notifications_read', { ids: 'all' }); load(); refresh(); })}>{t('Mark all read')}</Button></div>
      <NotificationList list={list} onOpen={close} />
    </div>
  );
}

export const openNotifications = (ctx) => ctx.openModal({ title: t('Notifications'), wide: true, render: (close) => <NotificationsBody close={close} /> });
