import { useApp } from '../lib/store.jsx';
import Dock from '../reactbits/Dock.jsx';
import Icon from '../ui/icons.jsx';
import { scrollTo } from '../lib/smooth.js';
import { openNewAgent } from '../dialogs/NewAgent.jsx';
import { openInbox, openNotifications } from '../dialogs/Inbox.jsx';
import { openKnowledge } from '../dialogs/Knowledge.jsx';
import { openSettings } from '../dialogs/Settings.jsx';
import { t } from '../lib/i18n.js';

export default function DockNav() {
  const ctx = useApp();
  const { overview, openModal } = ctx;
  const items = [
    { icon: <Icon name="home" size={22} />, label: t('Home'), onClick: () => scrollTo('#top') },
    { icon: <Icon name="grid" size={22} />, label: t('Board'), onClick: () => scrollTo('#board') },
    { icon: <Icon name="sparkles" size={22} />, label: t('Templates'), onClick: () => scrollTo('#templates') },
    { separator: true },
    { icon: <Icon name="inbox" size={22} />, label: t('To handle'), badge: overview?.pendingPauses || undefined, onClick: () => openInbox(ctx) },
    { icon: <Icon name="bell" size={22} />, label: t('Notifications'), badge: overview?.unread || undefined, onClick: () => openNotifications(ctx) },
    { icon: <Icon name="book" size={22} />, label: t('Knowledge base'), onClick: () => openKnowledge(ctx) },
    { icon: <Icon name="gear" size={22} />, label: t('Settings'), onClick: () => openSettings(openModal) },
    { separator: true },
    { icon: <Icon name="plus" size={22} />, label: t('New coworker'), className: 'dock-accent', onClick: () => openNewAgent(ctx) },
  ];
  return (
    <div className="dock-wrap">
      <Dock items={items} baseItemSize={46} magnification={68} panelHeight={64} accentColor="#a78bfa" badgeColor="#f59e0b" />
    </div>
  );
}
