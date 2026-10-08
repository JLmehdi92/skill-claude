import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, ScrollTrigger } from '../lib/smooth.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import GlareHover from '../reactbits/GlareHover.jsx';
import SplitText from '../reactbits/SplitText.jsx';
import { Select, AsyncButton, Pill } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { installFromLink } from '../dialogs/TemplatesDialog.jsx';

const CAT_ICON = { Finance: 'db', Sales: 'bolt', 'Customer support': 'chat', Marketing: 'sparkles', Operations: 'pulse', Research: 'brain' };

export default function Templates() {
  const ctx = useApp();
  const { overview, openAgent, refresh, toast } = ctx;
  const [templates, setTemplates] = useState([]);
  const [box, setBox] = useState('');
  const root = useRef(null);
  useEffect(() => { api('list_templates').then((r) => setTemplates(r.templates)).catch(() => {}); }, []);
  useEffect(() => { if (!box && overview?.spaces[0]) setBox(overview.spaces[0].id); }, [overview, box]);

  useGSAP(() => {
    if (!templates.length) return;
    ScrollTrigger.batch('.tpl-card', {
      start: 'top 90%', once: true,
      onEnter: (els) => gsap.fromTo(els, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.09 }),
    });
  }, { scope: root, dependencies: [templates.length] });

  const install = async (t) => {
    const r = await api('install_template', { slug: t.slug, spaceId: box });
    await refresh();
    toast(`Installed ${r.installed.map((x) => x.name).join(', ')}`);
    openAgent(r.installed[0].agentId);
  };

  return (
    <section className="section" id="templates" ref={root}>
      <header className="section-title">
        <span className="kicker">02 · Templates</span>
        <SplitText text="Start from a coworker that already works." tag="h2" splitType="words" delay={60} from={{ opacity: 0, y: 50 }} to={{ opacity: 1, y: 0 }} textAlign="left" />
        <div className="row wrap">
          <span className="muted">Install into</span>
          <div style={{ width: 200 }}><Select value={box} onChange={(e) => setBox(e.target.value)}>{overview?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <button className="link-btn" onClick={() => installFromLink(ctx, box)}><Icon name="link" size={14} /> Install from a share link</button>
        </div>
      </header>
      <div className="tpl-grid">
        {templates.map((t) => (
          <GlareHover key={t.slug} className="tpl-card" width="100%" height="100%" background="rgba(255,255,255,0.025)" borderColor="rgba(255,255,255,0.08)" borderRadius="22px" glareColor="#c4b5fd" glareOpacity={0.25} glareSize={300}>
            <div className="tpl-inner">
              <div className="row between">
                <span className="tpl-icon"><Icon name={CAT_ICON[t.category] || 'sparkles'} size={18} /></span>
                <Pill>{t.category}</Pill>
              </div>
              <h4>{t.name}</h4>
              <p className="muted">{t.description}</p>
              <div className="tpl-crew">
                {t.agents.map((a) => (
                  <div key={a.name} className="tpl-agent">
                    <strong>{a.name}</strong>
                    <span>{[a.schedules ? `${a.schedules} schedule${a.schedules > 1 ? 's' : ''}` : null, a.skills ? `${a.skills} skill${a.skills > 1 ? 's' : ''}` : null, ...a.connectors].filter(Boolean).join(' · ') || 'chat'}</span>
                  </div>
                ))}
              </div>
              <AsyncButton variant="primary" size="sm" icon="plus" onClick={() => install(t)}>Install</AsyncButton>
            </div>
          </GlareHover>
        ))}
      </div>
    </section>
  );
}
