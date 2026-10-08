import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { gsap } from 'gsap';
import { layoutWorld } from './layout.js';
import Island from './Island.jsx';
import Beams from './Beams.jsx';
import { startActivity, subscribeTicker, getTicker } from './activity.js';
import { t, tn } from '../lib/i18n.js';
import { labelRef, projectLabels } from './anchors.js';
import { hueOf, initials } from '../lib/format.js';
import Icon from '../ui/icons.jsx';

const isNight = () => { const h = new Date().getHours(); return h < 7 || h >= 20; };

function Rig({ controls, size }) {
  const { camera } = useThree();
  useEffect(() => {
    const d = Math.max(12, size * 1.15);
    camera.position.set(d * 0.78, d * 0.72, d * 0.78);
    camera.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
  }, [camera, size, controls]);
  return null;
}

/** Ctrl/⌘ + wheel (or a pinch) zooms; a plain wheel keeps scrolling the page. */
function WheelZoom({ controls }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const target = controls.current?.target;
      if (!target) return;
      const dir = camera.position.clone().sub(target);
      const len = Math.min(70, Math.max(5, dir.length() * (1 + Math.sign(e.deltaY) * 0.12)));
      camera.position.copy(target.clone().add(dir.setLength(len)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [camera, gl, controls]);
  return null;
}

function Projector() {
  useFrame(({ camera, size }) => projectLabels(camera, size), 1);
  return null;
}

function Scene({ world, night, onSelect, onHover, controls }) {
  const positions = world.bots;
  const bg = night ? '#05040b' : '#0a1020';
  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, world.size * 1.4, world.size * 4]} />
      <ambientLight intensity={night ? 0.35 : 0.6} />
      <hemisphereLight args={[night ? '#6d5efc' : '#9bd7ff', '#0b0817', night ? 0.6 : 0.9]} />
      <directionalLight position={[8, 14, 6]} intensity={night ? 0.9 : 1.6} color={night ? '#c7c2ff' : '#ffffff'} castShadow />
      <Stars radius={90} depth={50} count={night ? 4000 : 1800} factor={3.2} saturation={0.4} fade speed={0.6} />
      <gridHelper args={[200, 100, '#1d1838', '#120f24']} position-y={-4} />
      {world.islands.map((isl) => <Island key={isl.space.id} island={isl} onSelect={onSelect} onHover={onHover} />)}
      <Projector />
      <Beams positions={positions} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} enableZoom={false} minPolarAngle={0.35} maxPolarAngle={1.25} autoRotate autoRotateSpeed={0.35} />
      <WheelZoom controls={controls} />
      <Rig controls={controls} size={world.size} />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.95} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

function Ticker({ agents }) {
  const items = useSyncExternalStore(subscribeTicker, getTicker);
  const name = (id) => agents.find((a) => a.id === id)?.name || '…';
  const line = (it) => ({
    tool: [`🔧`, t('{a} used {tool}', { a: name(it.agentId), tool: it.text })],
    error: [`⚠`, t('{a} hit an error in {tool}', { a: name(it.agentId), tool: it.text })],
    beam: [`🤝`, t('{a} is asking {b}', { a: name(it.agentId), b: name(it.to) })],
    running: [`⚡`, t('{a} started working', { a: name(it.agentId) })],
    done: [`✓`, t('{a} finished', { a: name(it.agentId) })],
    waiting: [`✋`, t('{a} needs you', { a: name(it.agentId) })],
  }[it.kind] || ['•', it.kind]);
  if (!items.length) return <div className="ticker idle"><span className="ticker-dot" />{t('Live activity shows up here as your crew works.')}</div>;
  return (
    <div className="ticker" aria-live="polite" data-testid="ticker">
      <span className="ticker-dot live" />
      {items.slice(0, 4).map((it) => { const [i, s] = line(it); return <span key={it.id} className={`tick k-${it.kind}`}><b>{i}</b>{s}</span>; })}
    </div>
  );
}

const STATUS_TEXT = { idle: 'Ready', running: 'Working', waiting: 'Needs you', error: 'Error', off: 'Switched off' };

/** DOM labels positioned over the scene by the projector (no drei <Html>: plain React nodes). */
function Labels({ world, agents, hoverId, showNames, onPick, onAdd, onRename }) {
  const hovered = agents.find((a) => a.id === hoverId);
  const st = (a) => (a.enabled ? a.status : 'off');
  return (
    <div className="world-labels">
      {world.islands.map((isl) => (
        <div key={`isl:${isl.space.id}`} ref={labelRef(`isl:${isl.space.id}`)} className="label-anchor">
          <div className="island-tag" style={{ '--h': isl.hue }}>
            <span className="island-dot" />
            <strong>{isl.space.name}</strong>
            <span className="island-count">{tn('{n} coworker', '{n} coworkers', isl.agents.length)}</span>
            <button onClick={() => onRename(isl.space)} aria-label={t('Rename Box')}>✎</button>
          </div>
        </div>
      ))}
      {world.islands.map((isl) => (
        <div key={`add:${isl.space.id}`} ref={labelRef(`add:${isl.space.id}`)} className="label-anchor">
          <button className="add-slot" onClick={() => onAdd(isl.space.id)} aria-label={t('Add a coworker')}>+</button>
        </div>
      ))}
      {agents.map((a) => (
        <div key={`bot:${a.id}`} ref={labelRef(`bot:${a.id}:label`)} className={`label-anchor ${showNames || st(a) === 'waiting' ? '' : 'names-off'}`}>
          <button className={`bot-label st-${st(a)}`} onClick={() => onPick(a)} data-agent={a.id}>
            {st(a) === 'waiting' ? <i className="bot-alert">!</i> : null}
            {a.name}
          </button>
        </div>
      ))}
      {hovered ? (
        <div key={`card:${hovered.id}`} ref={labelRef(`bot:${hovered.id}:top`)} className="label-anchor no-pointer">
          <div className="bot-card">
            <div className="bot-card-head">
              <span className="bot-card-orb" style={{ '--h': hueOf(hovered.handle || hovered.name) }}>{initials(hovered.name)}</span>
              <div><strong>{hovered.name}</strong><span>@{hovered.handle}</span></div>
            </div>
            <span className={`bot-card-status st-${st(hovered)}`}>{t(STATUS_TEXT[st(hovered)])}</span>
            {hovered.description ? <p>{hovered.description}</p> : null}
            <em>{t('Click to open')}</em>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function World({ overview, onOpen, onAdd, onRename }) {
  const controls = useRef();
  const wrap = useRef();
  const [night] = useState(isNight);
  const [labels, setLabels] = useState(true);
  const [hoverId, setHoverId] = useState(null);
  useEffect(() => { startActivity(); }, []);
  const world = useMemo(() => layoutWorld(overview.spaces, overview.agents), [overview.spaces, overview.agents]);

  const flyTo = (pos, done) => {
    const c = controls.current;
    if (!c) return done?.();
    c.autoRotate = false;
    const cam = c.object;
    gsap.to(c.target, { x: pos[0], y: 0.6, z: pos[2], duration: 0.9, ease: 'power3.inOut', onUpdate: () => c.update() });
    gsap.to(cam.position, { x: pos[0] + 4.2, y: 4.2, z: pos[2] + 4.2, duration: 0.9, ease: 'power3.inOut', onComplete: done });
  };
  const select = (agent, pos) => flyTo(pos, () => onOpen(agent));
  const zoom = (k) => {
    const c = controls.current; if (!c) return;
    const dir = c.object.position.clone().sub(c.target);
    const len = Math.min(70, Math.max(5, dir.length() * k));
    gsap.to(c.object.position, { ...c.target.clone().add(dir.setLength(len)), duration: 0.5, ease: 'power2.out' });
  };
  const recenter = () => {
    const c = controls.current; if (!c) return;
    const d = Math.max(12, world.size * 1.15);
    gsap.to(c.target, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power3.inOut', onUpdate: () => c.update() });
    gsap.to(c.object.position, { x: d * 0.78, y: d * 0.72, z: d * 0.78, duration: 0.8, ease: 'power3.inOut', onComplete: () => { c.autoRotate = true; } });
  };
  const working = overview.agents.filter((a) => a.status === 'running').length;
  const waiting = overview.agents.filter((a) => a.status === 'waiting').length;

  return (
    <div className="world" ref={wrap} data-testid="world">
      <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 32, near: 0.1, far: 400 }} gl={{ antialias: true, powerPreference: 'high-performance' }} onPointerMissed={() => { document.body.style.cursor = ''; }}>
        <Suspense fallback={null}>
          <Scene world={world} night={night} onSelect={select} onHover={setHoverId} controls={controls} />
        </Suspense>
      </Canvas>

      <Labels world={world} agents={overview.agents} hoverId={hoverId} showNames={labels} onPick={(a) => { const p = world.bots.get(a.id); if (p) select(a, p); else onOpen(a); }} onAdd={onAdd} onRename={onRename} />
      <div className="world-hud top-left">
        <span className="hud-chip"><span className={`dot ${working ? 'pulse' : 'green'}`} />{t('{n} working', { n: working })}</span>
        {waiting ? <span className="hud-chip warn"><span className="dot amber" />{t('{n} waiting for you', { n: waiting })}</span> : null}
        <span className="hud-chip ghost">{night ? t('🌙 Night shift — your crew keeps watch') : t('☀︎ Day shift')}</span>
      </div>
      <div className="world-hud top-right">
        <button className="hud-btn" onClick={() => zoom(0.8)} aria-label={t('Zoom in')}><Icon name="plus" /></button>
        <button className="hud-btn" onClick={() => zoom(1.25)} aria-label={t('Zoom out')}><span className="minus" /></button>
        <button className="hud-btn" onClick={recenter} aria-label={t('Recenter')}><Icon name="grid" /></button>
        <button className={`hud-btn ${labels ? 'on' : ''}`} onClick={() => setLabels((v) => !v)} aria-label={t('Names')}><span className="hud-txt">Aa</span></button>
      </div>
      <div className="world-hint">{t('Drag to turn · right-drag to move · Ctrl/⌘ + wheel to zoom · click a coworker')}</div>
      <Ticker agents={overview.agents} />
    </div>
  );
}
