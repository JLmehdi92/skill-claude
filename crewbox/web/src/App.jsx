import { useEffect } from 'react';
import { AppProvider } from './lib/store.jsx';
import { startSmoothScroll, ScrollTrigger } from './lib/smooth.js';
import ClickSpark from './reactbits/ClickSpark.jsx';
import Hero from './sections/Hero.jsx';
import Board from './sections/Board.jsx';
import Templates from './sections/Templates.jsx';
import HowItWorks from './sections/HowItWorks.jsx';
import Footer from './sections/Footer.jsx';
import DockNav from './sections/DockNav.jsx';
import AgentPanel from './panel/AgentPanel.jsx';
import Onboarding from './foreman/Onboarding.jsx';
import { Modals, Toasts } from './ui/Overlays.jsx';

export default function App() {
  useEffect(() => {
    const stop = startSmoothScroll();
    // Layout shifts as data arrives; keep ScrollTrigger positions honest.
    const ro = new ResizeObserver(() => ScrollTrigger.refresh());
    ro.observe(document.body);
    return () => { ro.disconnect(); stop(); };
  }, []);
  return (
    <AppProvider>
      <ClickSpark sparkColor="#c4b5fd" sparkSize={9} sparkRadius={18} sparkCount={9} duration={420}>
        <main className="page">
          <Hero />
          <Board />
          <Templates />
          <HowItWorks />
          <Footer />
        </main>
      </ClickSpark>
      <DockNav />
      <AgentPanel />
      <Onboarding />
      <Modals />
      <Toasts />
    </AppProvider>
  );
}
