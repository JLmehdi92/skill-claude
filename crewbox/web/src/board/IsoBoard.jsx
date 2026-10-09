import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { gsap } from 'gsap';
import { CW, CH, BH, DEPTH, iso, layoutBoard, colorOf, roundedRhombus, BW } from './iso.js';
import Block from './Block.jsx';
import { startActivity, subscribe, getVersion, pulses, beams } from './activity.js';
import { t } from '../lib/i18n.js';
import { BellIcon, RocketIcon, PlusIcon, MinusIcon, SearchIcon, FitIcon, UpDownIcon, Logo } from './icons.jsx';
import './board.css';

const MIN_S = 0.2, MAX_S = 5;
const FLOOR = 44; // half-size of the floor grid, in cells
const THOUGHT_MS = 8000;
const HINT_KEY = 'crewbox.boardHint';
/** The gesture hint shows once, on touch screens. */
const firstTouchVisit = () => {
  try {
    if (!window.matchMedia('(pointer: coarse)').matches || localStorage.getItem(HINT_KEY)) return false;
    localStorage.setItem(HINT_KEY, '1');
    return true;
  } catch { return false; }
};

/** The floor: an isometric grid that fades away from the board. */
function Floor({ cx, cy }) {
  const d = useMemo(() => {
    // Lattice point nearest to the centre of the board.
    const i0 = Math.round(cy / CH + cx / CW), j0 = Math.round(cy / CH - cx / CW);
    let p = '';
    for (let k = -FLOOR; k <= FLOOR; k++) {
      const [ax, ay] = iso(i0 + k, j0 - FLOOR), [bx, by] = iso(i0 + k, j0 + FLOOR);
      const [cx2, cy2] = iso(i0 - FLOOR, j0 + k), [dx, dy] = iso(i0 + FLOOR, j0 + k);
      p += `M${ax},${ay}L${bx},${by}M${cx2},${cy2}L${dx},${dy}`;
    }
    return p;
  }, [cx, cy]);
  return (
    <g mask="url(#rb-floor-fade)">
      <path d={d} stroke="rgba(255,255,255,0.068)" strokeWidth={1.6} fill="none" />
    </g>
  );
}

function Tile({ tile, onRename, onAdd }) {
  const { top, right, bottom, left, space, next } = tile;
  return (
    <g className="rb-tile" data-box={space.id}>
      <path className="rb-tile-floor" d={`M${top}L${right}L${bottom}L${left}Z`} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.38)" strokeWidth={1.7} />
      <text
        className="rb-tile-name"
        transform={`translate(${left[0] + 4.5},${left[1] - 8}) skewY(-26.565)`}
        fontSize={12.5} fontWeight={700} fontStyle="italic" fill="url(#rb-label)"
        role="button" tabIndex={0} aria-label={`${t('Rename Box')} ${space.name}`}
        onClick={() => onRename(space)} onKeyDown={(e) => { if (e.key === 'Enter') onRename(space); }}
      >{space.name}</text>
      {next ? (
        <g className="rb-add" transform={`translate(${next[0]},${next[1]})`} role="button" tabIndex={0} aria-label={`${t('Add a coworker')} · ${space.name}`}
          onClick={() => onAdd(space.id)} onKeyDown={(e) => { if (e.key === 'Enter') onAdd(space.id); }}>
          <path d={roundedRhombus(BW, BH)} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.35)" strokeWidth={0.8} strokeDasharray="3 2.5" />
          <path d="M-4,0h8M0,-2v4" transform="scale(1,1)" stroke="rgba(255,255,255,0.7)" strokeWidth={1.1} strokeLinecap="round" />
        </g>
      ) : null}
    </g>
  );
}

function Beam({ from, to }) {
  const a = [from[0], from[1] - DEPTH - 2], b = [to[0], to[1] - DEPTH - 2];
  const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 30 - Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.18];
  return <path className="rb-beam" d={`M${a}Q${mid} ${b}`} fill="none" stroke="#a5b4fc" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="5 5" />;
}

function useActivity() {
  return useSyncExternalStore(subscribe, getVersion);
}

export default function IsoBoard({ overview, onOpen, onAdd, onRename, onNewBox, onInbox, onNotifications, onTemplates, onAsk, onList, onOnboarding, onBrain, onAutopilot }) {
  const wrap = useRef(null);
  const svg = useRef(null);
  const camEl = useRef(null);
  const cam = useRef({ x: 0, y: 0, s: 1 });
  const moved = useRef(false);
  const [menu, setMenu] = useState(null); // 'boxes' | 'search' | null
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState(firstTouchVisit);
  useActivity();
  useEffect(() => { startActivity(); }, []);
  // Measure a classic (non-overlay) scrollbar, so the full-bleed board stops at the visible edge.
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--rb-sbw', `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // While the board fills the screen it is the app: its own HUD replaces the page dock.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => document.body.classList.toggle('rb-immersive', e.intersectionRatio > 0.6), { threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => { io.disconnect(); document.body.classList.remove('rb-immersive'); };
  }, []);
  const agents = overview.agents;
  // Repaint every second while someone works, so what it is doing stays current.
  const [, tick] = useState(0);
  const busy = agents.some((a) => a.enabled && a.status === 'running');
  useEffect(() => {
    if (!busy) return undefined;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [busy]);
  const board = useMemo(() => layoutBoard(overview.spaces, agents), [overview.spaces, agents]);
  const cx = (board.bbox.x0 + board.bbox.x1) / 2, cy = (board.bbox.y0 + board.bbox.y1) / 2;

  const apply = useCallback(() => {
    const { x, y, s } = cam.current;
    camEl.current?.setAttribute('transform', `translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${s.toFixed(4)})`);
  }, []);
  const fitView = useCallback(() => {
    const el = wrap.current;
    if (!el) return null;
    const W = el.clientWidth, H = el.clientHeight;
    const bw = board.bbox.x1 - board.bbox.x0, bh = board.bbox.y1 - board.bbox.y0;
    const s = Math.min(MAX_S, Math.max(MIN_S, Math.min((W * 0.91) / bw, (H * 0.56) / bh, 2.4)));
    return { s, x: W * 0.515 - cx * s, y: H * 0.458 - cy * s };
  }, [board, cx, cy]);
  const animateTo = useCallback((to, duration = 0.8, done) => {
    gsap.to(cam.current, { ...to, duration, ease: 'power3.inOut', onUpdate: apply, onComplete: done, overwrite: true });
  }, [apply]);

  useLayoutEffect(() => {
    const f = fitView();
    if (f && !moved.current) { gsap.killTweensOf(cam.current); Object.assign(cam.current, f); apply(); }
  }, [fitView, apply]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => { if (!moved.current) { const f = fitView(); if (f) { gsap.killTweensOf(cam.current); Object.assign(cam.current, f); apply(); } } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView, apply]);

  // Pan with one pointer, pinch with two, Ctrl/⌘ + wheel (or a trackpad pinch) to zoom.
  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const pts = new Map();
    let start = null;
    const zoomAt = (px, py, k) => {
      const c = cam.current;
      const s = Math.min(MAX_S, Math.max(MIN_S, c.s * k));
      const r = el.getBoundingClientRect();
      const mx = px - r.left, my = py - r.top;
      c.x = mx - ((mx - c.x) * s) / c.s; c.y = my - ((my - c.y) * s) / c.s; c.s = s;
      moved.current = true;
      apply();
    };
    const down = (e) => {
      if (e.button > 0) return;
      gsap.killTweensOf(cam.current);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY, dist: 0 };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; start.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      setHint(false);
    };
    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (pts.size === 1) {
        start.dist += Math.abs(dx) + Math.abs(dy);
        if (start.dist > 5) {
          if (!el.dataset.dragged) { el.dataset.dragged = '1'; try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
          cam.current.x += dx; cam.current.y += dy; moved.current = true; apply();
        }
      } else if (pts.size === 2) {
        el.dataset.dragged = '1';
        const before = [...pts.values()];
        const mid0 = [(before[0].x + before[1].x) / 2, (before[0].y + before[1].y) / 2];
        p.x = e.clientX; p.y = e.clientY;
        const after = [...pts.values()];
        const mid1 = [(after[0].x + after[1].x) / 2, (after[0].y + after[1].y) / 2];
        const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y) || 1;
        const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y) || 1;
        cam.current.x += mid1[0] - mid0[0]; cam.current.y += mid1[1] - mid0[1];
        zoomAt(mid1[0], mid1[1], d1 / d0);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
    };
    const up = (e) => {
      pts.delete(e.pointerId);
      if (!pts.size) setTimeout(() => { delete el.dataset.dragged; }, 0);
    };
    const wheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30 ? 0.012 : 0.0025)));
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [apply]);

  const zoomBy = (k) => {
    const el = wrap.current; const c = cam.current;
    const s = Math.min(MAX_S, Math.max(MIN_S, c.s * k));
    const mx = el.clientWidth / 2, my = el.clientHeight / 2;
    moved.current = true;
    animateTo({ s, x: mx - ((mx - c.x) * s) / c.s, y: my - ((my - c.y) * s) / c.s }, 0.35);
  };
  const recenter = () => { moved.current = false; const f = fitView(); if (f) animateTo(f, 0.7); };
  const focusPoint = (p, s, done) => {
    const el = wrap.current;
    const ts = Math.max(cam.current.s, s);
    moved.current = true;
    animateTo({ s: ts, x: el.clientWidth / 2 - p[0] * ts, y: el.clientHeight * 0.45 - p[1] * ts }, 0.7, done);
  };
  const openAgent = (a) => {
    const b = board.blocks.get(a.id);
    setMenu(null);
    if (!b) return onOpen(a);
    focusPoint([b.at[0], b.at[1] - DEPTH], 2.2, () => onOpen(a));
  };
  const openRef = useRef(openAgent);
  openRef.current = openAgent;
  const onBlockOpen = useCallback((a) => openRef.current(a), []);
  const flyToBox = (tile) => { setMenu(null); focusPoint(tile.center, 1.6); };

  // Moods, as on Rerun's board: amber at work, cyan when waiting for you, red on error, asleep when
  // off; a coworker whose apps are not connected yet is a ghost with a lock.
  const status = (a) => (!a.enabled ? 'off' : a.status === 'idle' && a.appsPending ? 'locked' : a.status);
  const total = agents.length;
  const working = agents.filter((a) => a.enabled && a.status === 'running').length;
  const unread = overview.unread || 0;
  const now = Date.now();
  const sorted = [...board.blocks.values()].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  const found = query.trim() ? agents.filter((a) => `${a.name} ${a.handle} ${a.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())) : agents;
  const ring = 2 * Math.PI * 9;

  return (
    <div className="rb-board" ref={wrap} data-testid="board">
      <svg ref={svg} className="rb-svg" role="application" aria-label={t('Board')}>
        <defs>
          <filter id="rb-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" /></filter>
          <filter id="rb-eye-glow" x="-100%" y="-200%" width="300%" height="500%"><feGaussianBlur stdDeviation="0.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <linearGradient id="rb-label" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4a4a4a" /><stop offset="1" stopColor="#787878" /></linearGradient>
          <radialGradient id="rb-floor-grad" cx={cx} cy={cy} r={FLOOR * CW * 0.42} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.35" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.45" />
          </radialGradient>
          <mask id="rb-floor-fade" maskUnits="userSpaceOnUse" x={cx - FLOOR * CW * 1.2} y={cy - FLOOR * CH * 1.2} width={FLOOR * CW * 2.4} height={FLOOR * CH * 2.4}>
            <rect x={cx - FLOOR * CW * 1.2} y={cy - FLOOR * CH * 1.2} width={FLOOR * CW * 2.4} height={FLOOR * CH * 2.4} fill="url(#rb-floor-grad)" />
          </mask>
        </defs>
        <g ref={camEl}>
          <Floor cx={cx} cy={cy} />
          {board.tiles.map((tile) => <Tile key={tile.space.id} tile={tile} onRename={onRename} onAdd={onAdd} />)}
          {sorted.map(({ agent, at, index }) => {
            const p = pulses.get(agent.id);
            const st = status(agent);
            const fresh = p && now - p.at < THOUGHT_MS;
            return (
              <Block key={agent.id} agent={agent} color={colorOf(agent)} status={st} at={at} index={index} waitingCards={agent.waitingCards}
                pulse={p && now - p.at < 1500 ? p : null}
                thought={st === 'running' ? (fresh ? p.tool : t('thinking…')) : null}
                onOpen={onBlockOpen} />
            );
          })}
          {beams.map((b) => {
            const from = board.blocks.get(b.from)?.at, to = board.blocks.get(b.to)?.at;
            return from && to ? <Beam key={b.id} from={from} to={to} /> : null;
          })}
        </g>
      </svg>

      {/* top */}
      <div className="rb-hud rb-top-left">
        <div className="rb-menu-wrap">
          <button className="rb-pill rb-workspace" onClick={() => setMenu(menu === 'boxes' ? null : 'boxes')} aria-expanded={menu === 'boxes'} aria-haspopup="menu" data-testid="rb-workspace">
            <Logo />
            <span>Crewbox</span>
            <UpDownIcon />
          </button>
          {menu === 'boxes' ? (
            <div className="rb-menu" role="menu">
              <div className="rb-menu-title">{t('Boxes')}</div>
              {board.tiles.map((tile) => (
                <button key={tile.space.id} role="menuitem" onClick={() => flyToBox(tile)}>
                  <span className="rb-menu-dot" />{tile.space.name}<em>{tile.agents.length}</em>
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={() => { setMenu(null); onNewBox(); }}><PlusIcon size={15} />{t('New Box')}</button>
              <button role="menuitem" onClick={() => { setMenu(null); onList(); }}>{t('List view')}</button>
              <hr />
              {onBrain ? <button role="menuitem" onClick={() => { setMenu(null); onBrain(); }}>{t('Brain')}{overview.brainProposals ? <em>{overview.brainProposals}</em> : null}</button> : null}
              {onAutopilot ? <button role="menuitem" onClick={() => { setMenu(null); onAutopilot(); }}>{t('Autopilot')}<em>{overview.autopilot ? t('on') : t('off')}</em></button> : null}
              {onOnboarding ? <button role="menuitem" onClick={() => { setMenu(null); onOnboarding(); }}>{t('Set up a team with Foreman')}</button> : null}
            </div>
          ) : null}
        </div>
        <button className="rb-pill rb-light" onClick={onTemplates} data-testid="rb-templates"><RocketIcon /><span>{t('Templates')}</span></button>
      </div>
      <div className="rb-hud rb-zoom">
        <button onClick={() => zoomBy(1.3)} aria-label={t('Zoom in')}><PlusIcon /></button>
        <button onClick={() => zoomBy(1 / 1.3)} aria-label={t('Zoom out')}><MinusIcon /></button>
        <span className="rb-sep" />
        <button onClick={recenter} aria-label={t('Recenter')}><FitIcon /></button>
      </div>

      {/* bottom */}
      <div className="rb-hud rb-bottom-left">
        <button className="rb-round" onClick={onNotifications} aria-label={t('Notifications')} data-testid="rb-bell">
          <BellIcon />{unread ? <i className="rb-dot" /> : null}
        </button>
        <button className={`rb-pill rb-progress ${working ? 'spin' : ''}`} onClick={overview.pendingPauses ? onInbox : () => { const a = agents.find((x) => x.enabled && x.status === 'running'); if (a) openAgent(a); }}
          aria-label={t('{a} of {b} coworkers working', { a: working, b: total })} data-testid="rb-progress">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="9" fill="none" stroke="#25223a" strokeWidth="2.6" />
            {working ? <circle className="rb-progress-arc" cx="11" cy="11" r="9" fill="none" stroke="url(#rb-arc)" strokeWidth="2.6" strokeLinecap="round"
              strokeDasharray={`${Math.max(working / total, 0.08) * ring} ${ring}`} transform="rotate(-90 11 11)" /> : null}
            <defs><linearGradient id="rb-arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c6cff" /><stop offset="1" stopColor="#4f46e5" /></linearGradient></defs>
          </svg>
          <span>{working}/{total}</span>
          {overview.pendingPauses ? <i className="rb-dot amber" /> : null}
        </button>
        <div className="rb-pill rb-actions">
          <button onClick={() => onAdd(null)} aria-label={t('New coworker')} data-testid="rb-add"><PlusIcon /></button>
          <div className="rb-menu-wrap">
            <button onClick={() => { setMenu(menu === 'search' ? null : 'search'); setQuery(''); }} aria-label={t('Search coworkers')} aria-expanded={menu === 'search'} data-testid="rb-search"><SearchIcon /></button>
            {menu === 'search' ? (
              <div className="rb-menu rb-search" role="dialog" aria-label={t('Search coworkers')}>
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Find a coworker…')} aria-label={t('Find a coworker…')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) openAgent(found[0]); if (e.key === 'Escape') setMenu(null); }} />
                <div className="rb-search-list" data-lenis-prevent>
                  {found.slice(0, 8).map((a) => (
                    <button key={a.id} onClick={() => openAgent(a)}>
                      <span className="rb-swatch" style={{ background: status(a) === 'error' ? '#e06161' : status(a) === 'off' ? '#3a363c' : colorOf(a) }} />
                      <span className="rb-search-name">{a.name}</span>
                      <em>@{a.handle}</em>
                    </button>
                  ))}
                  {!found.length ? <p>{t('No coworker matches.')}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <button className="rb-orb" onClick={onAsk} aria-label={t('Ask Foreman, your assistant')} title={t('Ask Foreman, your assistant')} data-testid="rb-orb">
        <span className="rb-orb-ball"><span className="rb-orb-visor"><i /><i /></span></span>
      </button>

      {hint ? <div className="rb-hint">{t('Drag to move · pinch to zoom · tap a coworker')}</div> : null}
      {menu ? <div className="rb-scrim" onClick={() => setMenu(null)} /> : null}
    </div>
  );
}
