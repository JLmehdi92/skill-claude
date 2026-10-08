import { useApp } from '../lib/store.jsx';
import { openSettings } from '../dialogs/Settings.jsx';
import CountUp from '../reactbits/CountUp.jsx';
import { money } from '../lib/format.js';

export default function Footer() {
  const { overview, openModal } = useApp();
  const u = overview?.usage || { runs: 0, tokens: 0, cost: 0 };
  return (
    <footer className="footer">
      <div className="footer-big">
        <span>Your coworkers used</span>
        <b><CountUp to={Number(u.tokens)} separator="," duration={2} /></b>
        <span>tokens in the last 30 days, for {money(u.cost)}.</span>
      </div>
      <div className="footer-row">
        <span>Crewbox · everything runs on this machine</span>
        <button className="link-btn" onClick={() => openSettings(openModal, 'api')}>API &amp; MCP endpoint</button>
        <span className="muted">Motion: GSAP · Lenis · React Bits</span>
      </div>
    </footer>
  );
}
