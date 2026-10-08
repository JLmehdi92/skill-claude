import { useApp } from '../lib/store.jsx';
import { openSettings } from '../dialogs/Settings.jsx';
import CountUp from '../reactbits/CountUp.jsx';
import { money } from '../lib/format.js';
import { t } from '../lib/i18n.js';

export default function Footer() {
  const { overview, openModal } = useApp();
  const u = overview?.usage || { runs: 0, tokens: 0, cost: 0 };
  return (
    <footer className="footer">
      <div className="footer-big">
        <span>{t('Your coworkers used')}</span>
        <b><CountUp to={Number(u.tokens)} separator="," duration={2} /></b>
        <span>{t('tokens in the last 30 days, for {cost}.', { cost: money(u.cost) })}</span>
      </div>
      <div className="footer-row">
        <span>{t('Crewbox · everything runs on this machine')}</span>
        <button className="link-btn" onClick={() => openSettings(openModal, 'api')}>{t('API & MCP endpoint')}</button>
        <span className="muted">Motion: GSAP · Lenis · React Bits</span>
      </div>
    </footer>
  );
}
