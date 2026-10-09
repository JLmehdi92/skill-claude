import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ChromaticAberration, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { layoutWorld, CORE } from './layout.js';
import { sweepTexture } from './shaders.js';
import Nebula from './Nebula.jsx';
import Core from './Core.jsx';
import Synapses from './Synapses.jsx';
import Beams from './Beams.jsx';
import { startActivity, subscribeTicker, getTicker } from './activity.js';
import { t, tn } from '../lib/i18n.js';
import { labelRef, projectLabels } from './anchors.js';
import { hueOf, initials } from '../lib/format.js';
import Icon from '../ui/icons.jsx';

const isNight = () => { const h = new Date().getHours(); return h < 7 || h >= 20; };
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const FOV = 34;
const touch = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
/** Camera home: far enough for the whole constellation to fit the frame, whatever its shape (phones are tall). */
const home = (size, aspect = 1.6) => {
  const fitWide = (size * 1.05) / (Math.tan(((FOV / 2) * Math.PI) / 180) * Math.min(aspect, 1.6));
  const d = Math.max(13, size * 1.6, fitWide * 0.95);
  return [d * 0.72, d * 0.5, d * 0.72];
};
const TARGET = [0, 0.9, 0];

function Rig({ controls, size }) {
  const { camera, size: view } = useThree();
  const aspect = view.width / Math.max(1, view.height);
  useEffect(() => {
    camera.position.set(...home(size, aspect));
    camera.lookAt(...TARGET);
    controls.current?.target.set(...TARGET);
  }, [camera, size, controls, aspect]);
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

/** Fog follows the camera distance, so zooming out (or a phone's far camera) never drowns the scene. */
function FogRig({ controls }) {
  useFrame(({ camera, scene }) => {
    const target = controls.current?.target;
    if (!scene.fog || !target) return;
    const d = camera.position.distanceTo(target);
    scene.fog.near = d * 1.1;
    scene.fog.far = d * 3.2;
  });
  return null;
}

/** A radar of concentric rings far below, with a slow sweep: the floor of the constellation. */
function Radar({ size }) {
  const sweep = useRef();
  const grid = useMemo(() => {
    const g = new THREE.PolarGridHelper(size * 2.2, 24, 10, 128, '#2a2050', '#17122e');
    g.material.transparent = true;
    g.material.opacity = 0.5;
    return g;
  }, [size]);
  useFrame((_, dt) => { if (sweep.current) sweep.current.rotation.z -= dt * 0.35; });
  return (
    <group position-y={-1.2}>
      <primitive object={grid} />
      <mesh ref={sweep} rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[size * 2.2, 96]} />
        <meshBasicMaterial map={sweepTexture()} color="#8b6cff" transparent opacity={0.13} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Scene({ world, night, agents, focusId, waiting, working, onSelect, onHover, onCore, controls, still, pinch }) {
  const bg = night ? '#04030a' : '#070b18';
  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, world.size * 2, world.size * 5.5]} />
      <Stars radius={110} depth={60} count={night ? 5000 : 2600} factor={3.4} saturation={0.5} fade speed={0.5} />
      <Radar size={world.size} />
      <Core waiting={waiting} working={working} onOpen={onCore} />
      {world.clusters.map((c) => <Nebula key={c.space.id} cluster={c} focusId={focusId} onSelect={onSelect} onHover={onHover} />)}
      <Synapses agents={agents} positions={world.bots} focusId={focusId} />
      <Beams positions={world.bots} />
      <Projector />
      <FogRig controls={controls} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} enableZoom={pinch} minPolarAngle={0.3} maxPolarAngle={1.32} autoRotate={!still} autoRotateSpeed={0.3} target={TARGET} />
      <WheelZoom controls={controls} />
      <Rig controls={controls} size={world.size} />
      <EffectComposer multisampling={4}>
        <Bloom intensity={1.1} luminanceThreshold={0.55} luminanceSmoothing={0.25} mipmapBlur />
        <ChromaticAberration offset={[0.0004, 0.0006]} radialModulation modulationOffset={0.35} />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.18} />
        <Vignette eskil={false} offset={0.22} darkness={0.8} />
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
const THOUGHT_MS = 9000;

/** DOM labels positioned over the scene by the projector (no drei <Html>: plain React nodes). */
function Labels({ world, agents, hoverId, showNames, waiting, onPick, onAdd, onRename, onCore }) {
  const items = useSyncExternalStore(subscribeTicker, getTicker);
  const hovered = agents.find((a) => a.id === hoverId);
  const st = (a) => (a.enabled ? a.status : 'off');
  // What each working coworker is doing right now: its latest tool call.
  const thought = (a) => {
    if (st(a) !== 'running') return null;
    const it = items.find((x) => x.agentId === a.id && (x.kind === 'tool' || x.kind === 'beam') && Date.now() - x.at < THOUGHT_MS);
    if (!it) return t('thinking…');
    return it.kind === 'beam' ? t('asking {b}', { b: agents.find((b) => b.id === it.to)?.name || '…' }) : it.text;
  };
  return (
    <div className="world-labels">
      <div ref={labelRef('core')} className="label-anchor">
        <button className={`core-tag ${waiting ? 'warn' : ''}`} onClick={onCore} data-testid="core">
          <span className="core-glyph" />
          <strong>{t('You')}</strong>
          <span>{waiting ? tn('{n} is waiting for you', '{n} waiting for you', waiting) : t('All good')}</span>
        </button>
      </div>
      {world.clusters.map((c) => (
        <div key={`isl:${c.space.id}`} ref={labelRef(`isl:${c.space.id}`)} className="label-anchor">
          <div className="island-tag" style={{ '--h': c.hue }}>
            <span className="island-dot" />
            <strong>{c.space.name}</strong>
            <span className="island-count">{tn('{n} coworker', '{n} coworkers', c.agents.length)}</span>
            <button onClick={() => onRename(c.space)} aria-label={t('Rename Box')}>✎</button>
          </div>
        </div>
      ))}
      {world.clusters.map((c) => (
        <div key={`add:${c.space.id}`} ref={labelRef(`add:${c.space.id}`)} className="label-anchor">
          <button className="add-slot" onClick={() => onAdd(c.space.id)} aria-label={t('Add a coworker')}>+</button>
        </div>
      ))}
      {agents.map((a) => {
        const th = thought(a);
        return (
          <div key={`bot:${a.id}`} ref={labelRef(`bot:${a.id}:label`)} className={`label-anchor ${showNames || st(a) === 'waiting' || th ? '' : 'names-off'}`}>
            <button className={`bot-label st-${st(a)}`} onClick={() => onPick(a)} data-agent={a.id}>
              {st(a) === 'waiting' ? <i className="bot-alert">!</i> : <i className={`bot-dot st-${st(a)}`} />}
              {a.name}
            </button>
            {th ? <span className="bot-thought">{th}</span> : null}
          </div>
        );
      })}
      {hovered ? (
        <div key={`card:${hovered.id}`} ref={labelRef(`bot:${hovered.id}:top`)} className="label-anchor no-pointer">
          <div className="bot-card">
            <div className="bot-card-head">
              <span className="bot-card-orb" style={{ '--h': hueOf(hovered.handle || hovered.name) }}>{initials(hovered.name)}</span>
              <div><strong>{hovered.name}</strong><span>@{hovered.handle}</span></div>
            </div>
            <span className={`bot-card-status st-${st(hovered)}`}>{t(STATUS_TEXT[st(hovered)])}</span>
            {hovered.description ? <p>{hovered.description}</p> : null}
            <div className="bot-card-meta">
              <span><i className="m-moon" />{tn('{n} schedule', '{n} schedules', hovered.schedules || 0)}</span>
              <span><i className="m-shard" />{tn('{n} app', '{n} apps', hovered.apps || 0)}</span>
              {hovered.triggers ? <span><i className="m-trig" />{tn('{n} trigger', '{n} triggers', hovered.triggers)}</span> : null}
            </div>
            <em>{t('Click to open')}</em>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ onClose }) {
  const rows = [
    ['lg-idle', t('Calm, breathing'), t('ready')],
    ['lg-run', t('Boiling, spinning, fed by the core'), t('working')],
    ['lg-wait', t('Heartbeat and a signal of light; amber packets fly to you'), t('needs you')],
    ['lg-err', t('Glitching red slices'), t('error')],
    ['lg-off', t('Frozen obsidian'), t('switched off')],
  ];
  return (
    <div className="world-legend" role="dialog" aria-label={t('How to read the constellation')}>
      <div className="row between"><strong>{t('How to read the constellation')}</strong><button className="link-btn" onClick={onClose} aria-label={t('Close')}>✕</button></div>
      <p>{t('You are the core. Every Box is a nebula, every coworker a living entity with its own shape.')}</p>
      <ul>
        {rows.map(([c, d, s]) => <li key={c}><i className={`lg ${c}`} /><b>{s}</b><span>{d}</span></li>)}
        <li><i className="lg lg-moon" /><b>{t('moons')}</b><span>{t('its scheduled tasks')}</span></li>
        <li><i className="lg lg-shard" /><b>{t('shards')}</b><span>{t('its connected apps')}</span></li>
        <li><i className="lg lg-wave" /><b>{t('shockwave')}</b><span>{t('a tool call, live')}</span></li>
        <li><i className="lg lg-comet" /><b>{t('comet')}</b><span>{t('a coworker asking another one')}</span></li>
      </ul>
    </div>
  );
}

export default function World({ overview, onOpen, onAdd, onRename, onInbox }) {
  const controls = useRef();
  const [night] = useState(isNight);
  const [still] = useState(reducedMotion);
  const [pinch] = useState(touch);
  const [labels, setLabels] = useState(true);
  const [legend, setLegend] = useState(false);
  const [hoverId, setHoverId] = useState(null);
  useEffect(() => { startActivity(); }, []);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  const world = useMemo(() => layoutWorld(overview.spaces, overview.agents), [overview.spaces, overview.agents]);

  const flyTo = (pos, done) => {
    const c = controls.current;
    if (!c) return done?.();
    c.autoRotate = false;
    const cam = c.object;
    // Come in from the side facing the core, slightly above.
    const out = new THREE.Vector3(pos[0] - CORE[0], 0, pos[2] - CORE[2]).normalize();
    gsap.to(c.target, { x: pos[0], y: pos[1], z: pos[2], duration: 1, ease: 'power3.inOut', onUpdate: () => c.update() });
    gsap.to(cam.position, { x: pos[0] + out.x * 4.6, y: pos[1] + 2.4, z: pos[2] + out.z * 4.6, duration: 1, ease: 'power3.inOut', onComplete: done });
  };
  const select = (agent, pos) => flyTo(pos, () => onOpen(agent));
  const zoom = (k) => {
    const c = controls.current; if (!c) return;
    const dir = c.object.position.clone().sub(c.target);
    const len = Math.min(140, Math.max(5, dir.length() * k));
    gsap.to(c.object.position, { ...c.target.clone().add(dir.setLength(len)), duration: 0.5, ease: 'power2.out' });
  };
  const recenter = () => {
    const c = controls.current; if (!c) return;
    const [x, y, z] = home(world.size, c.object.aspect);
    gsap.to(c.target, { x: TARGET[0], y: TARGET[1], z: TARGET[2], duration: 0.9, ease: 'power3.inOut', onUpdate: () => c.update() });
    gsap.to(c.object.position, { x, y, z, duration: 0.9, ease: 'power3.inOut', onComplete: () => { c.autoRotate = !still; } });
  };
  const working = overview.agents.filter((a) => a.enabled && a.status === 'running').length;
  const waiting = overview.agents.filter((a) => a.enabled && a.status === 'waiting').length;

  return (
    <div className="world" data-testid="world">
      <Canvas dpr={[1, 1.75]} camera={{ fov: FOV, near: 0.1, far: 500 }} gl={{ antialias: false, powerPreference: 'high-performance' }} onPointerMissed={() => { document.body.style.cursor = ''; }}>
        <Suspense fallback={null}>
          <Scene world={world} night={night} agents={overview.agents} focusId={hoverId} waiting={waiting} working={working} onSelect={select} onHover={setHoverId} onCore={onInbox} controls={controls} still={still} pinch={pinch} />
        </Suspense>
      </Canvas>

      <Labels world={world} agents={overview.agents} hoverId={hoverId} showNames={labels} waiting={waiting} onPick={(a) => { const p = world.bots.get(a.id); if (p) select(a, p); else onOpen(a); }} onAdd={onAdd} onRename={onRename} onCore={onInbox} />
      <div className="world-hud top-left">
        <span className="hud-chip"><span className={`dot ${working ? 'pulse' : 'green'}`} />{t('{n} working', { n: working })}</span>
        {waiting ? <button className="hud-chip warn" onClick={onInbox}><span className="dot amber" />{tn('{n} is waiting for you', '{n} waiting for you', waiting)}</button> : null}
        <span className="hud-chip ghost">{night ? t('🌙 Night shift — your crew keeps watch') : t('☀︎ Day shift')}</span>
      </div>
      <div className="world-hud top-right">
        <button className="hud-btn" onClick={() => zoom(0.8)} aria-label={t('Zoom in')}><Icon name="plus" /></button>
        <button className="hud-btn" onClick={() => zoom(1.25)} aria-label={t('Zoom out')}><span className="minus" /></button>
        <button className="hud-btn" onClick={recenter} aria-label={t('Recenter')}><Icon name="grid" /></button>
        <button className={`hud-btn ${labels ? 'on' : ''}`} onClick={() => setLabels((v) => !v)} aria-label={t('Names')}><span className="hud-txt">Aa</span></button>
        <button className={`hud-btn ${legend ? 'on' : ''}`} onClick={() => setLegend((v) => !v)} aria-label={t('Legend')} data-testid="legend-btn"><span className="hud-txt">?</span></button>
      </div>
      {legend ? <Legend onClose={() => setLegend(false)} /> : null}
      <div className="world-hint">{t('Drag to turn · right-drag to move · Ctrl/⌘ + wheel to zoom · click a coworker, or the core to see what waits for you')}</div>
      <Ticker agents={overview.agents} />
    </div>
  );
}
