import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { pulses } from './activity.js';
import { hueOf } from '../lib/format.js';
import { anchorRef } from './anchors.js';
import { makeOrbMaterial, glowTexture, pillarTexture, hashOf, heartbeat } from './shaders.js';

// How the shell behaves in each state. Values are eased toward, never snapped.
export const MOODS = {
  idle: { amp: 0.07, freq: 1.5, speed: 0.22, glitch: 0, tint: 0, bright: 1, spin: 0.15, core: 1 },
  running: { amp: 0.2, freq: 2.1, speed: 1.0, glitch: 0, tint: 0, bright: 1.45, spin: 0.9, core: 2.2 },
  waiting: { amp: 0.05, freq: 1.4, speed: 0.3, glitch: 0, tint: 0.6, bright: 1.15, spin: 0.08, core: 1.5 },
  error: { amp: 0.16, freq: 3.2, speed: 0.6, glitch: 0.32, tint: 0.65, bright: 1.1, spin: 0.3, core: 1.2 },
  off: { amp: 0.015, freq: 1.2, speed: 0.04, glitch: 0, tint: 0.9, bright: 0.5, spin: 0.02, core: 0 },
};
const TINT = { waiting: '#fbbf24', error: '#ff4040', off: '#24202f' };
const AMBER = new THREE.Color('#fbbf24');
const RED = new THREE.Color('#ff4d4d');

/**
 * A coworker as a living entity: an iridescent liquid shell around a bright core. Its shape is its
 * own (seeded by its handle); its behaviour is its state: calm breathing when ready, boiling and
 * spinning while it works, a heartbeat and a signal of light when it needs you, glitching slices on
 * error, frozen obsidian when switched off. Moons are its scheduled tasks, shards its apps, and every
 * tool call sends a shockwave.
 */
export default function Entity({ agent, position, focus, onSelect, onHover }) {
  const float = useRef();
  const shell = useRef();
  const coreMat = useRef();
  const halo = useRef();
  const shock = useRef();
  const moons = useRef();
  const shards = useRef();
  const pillar = useRef();
  const ring = useRef();
  const status = agent.enabled ? agent.status : 'off';
  const persona = useMemo(() => {
    const h = hashOf(agent.handle || agent.name);
    return { seed: (h % 1000) / 13, freqK: 0.8 + ((h >>> 3) % 50) / 100, hue: hueOf(agent.handle || agent.name), shift: 30 + ((h >>> 7) % 70), tilt: (((h >>> 11) % 100) / 100) * Math.PI };
  }, [agent.handle, agent.name]);
  const mat = useMemo(() => makeOrbMaterial(persona), [persona]);
  useEffect(() => () => mat.dispose(), [mat]);
  const own = useMemo(() => new THREE.Color(`hsl(${persona.hue}, 95%, 72%)`), [persona.hue]);
  const tint = useMemo(() => new THREE.Color(TINT[status] || '#ffffff'), [status]);
  const coreTarget = useMemo(() => (status === 'waiting' ? AMBER : status === 'error' ? RED : status === 'running' ? new THREE.Color('#e6fbff') : own), [status, own]);
  const schedules = Math.min(agent.schedules || 0, 4);
  const apps = Math.min(agent.apps || 0, 5);
  const hover = useRef(false);
  const coreCol = useMemo(() => own.clone(), [own]);
  const coreLevel = useRef(1);

  useFrame((state, dt) => {
    const u = mat.uniforms;
    const m = MOODS[status] || MOODS.idle;
    const k = 1 - Math.exp(-dt * 3);
    const time = state.clock.elapsedTime;
    const lerp = THREE.MathUtils.lerp;
    u.uTime.value = time;
    u.uPhase.value += dt * m.speed;
    u.uAmp.value = lerp(u.uAmp.value, m.amp, k);
    u.uFreq.value = lerp(u.uFreq.value, m.freq * persona.freqK, k);
    u.uGlitch.value = lerp(u.uGlitch.value, m.glitch, k);
    u.uTintMix.value = lerp(u.uTintMix.value, m.tint, k);
    u.uBright.value = lerp(u.uBright.value, m.bright + (hover.current ? 0.25 : 0), k);
    u.uTint.value.lerp(tint, k);
    u.uDim.value = lerp(u.uDim.value, focus === false ? 1 : 0, 1 - Math.exp(-dt * 6));
    const beat = status === 'waiting' ? heartbeat(time + persona.seed) : 0;
    u.uBeat.value = beat * 0.09;
    // A tool call: flash and shockwave.
    const since = (Date.now() - (pulses.get(agent.id) || 0)) / 1000;
    u.uFlash.value = since < 0.5 ? (1 - since / 0.5) * 0.8 : 0;
    if (shock.current) {
      const on = since < 1.1;
      shock.current.visible = on;
      if (on) { shock.current.scale.setScalar(0.7 + since * 2.4); shock.current.material.opacity = (1 - since / 1.1) * 0.9; }
    }

    shell.current.rotation.y += dt * m.spin;
    shell.current.rotation.x = Math.sin(time * 0.3 + persona.seed) * 0.3;
    const g = float.current;
    g.position.y = Math.sin(time * 0.8 + persona.seed) * (status === 'off' ? 0.01 : 0.09) + (hover.current ? 0.18 : 0);
    if (status === 'error') g.position.x = Math.sin(time * 50) * 0.02 * (Math.sin(time * 3) > 0.5 ? 1 : 0);
    const s = lerp(g.scale.x, hover.current ? 1.12 : 1, 0.15);
    g.scale.setScalar(s);

    coreCol.lerp(coreTarget, k);
    coreLevel.current = lerp(coreLevel.current, m.core * (1 + beat * 0.8) * (focus === false ? 0.35 : 1), k);
    coreMat.current.color.copy(coreCol).multiplyScalar(coreLevel.current);
    halo.current.material.color.lerp(status === 'off' ? tint : coreTarget, k);
    halo.current.material.opacity = lerp(halo.current.material.opacity, status === 'off' ? 0.04 : (0.24 + beat * 0.35 + (status === 'running' ? 0.12 + Math.sin(time * 9) * 0.06 : 0)) * (focus === false ? 0.3 : 1), k);
    halo.current.scale.setScalar(2 + beat * 0.6 + (status === 'running' ? 0.4 : 0));

    if (moons.current) moons.current.rotation.y += dt * 0.7;
    if (ring.current) {
      ring.current.rotation.z += dt * m.spin * 0.8;
      ring.current.material.color.lerp(status === 'off' ? tint : coreTarget, k);
      ring.current.material.opacity = status === 'off' ? 0.15 : (focus === false ? 0.2 : 0.7);
    }
    if (shards.current) { shards.current.rotation.y -= dt * (status === 'running' ? 1.6 : 0.4); shards.current.children.forEach((c, i) => { c.rotation.x += dt * (1 + i * 0.3); c.rotation.z += dt; }); }
    if (pillar.current) pillar.current.material.opacity = 0.35 + beat * 0.5;
  });

  const select = (e) => { e.stopPropagation(); onSelect(agent, position); };
  return (
    <group position={position}>
      <group ref={float}>
        <mesh ref={shell} material={mat} scale={0.52}>
          <icosahedronGeometry args={[1, 20]} />
        </mesh>
        <group rotation={[1.15 + persona.tilt * 0.15, persona.tilt, 0.2]}>
          <mesh ref={ring}>
            <torusGeometry args={[0.8, 0.008, 6, 128]} />
            <meshBasicMaterial color={own} toneMapped={false} transparent opacity={0.7} />
          </mesh>
        </group>
        <mesh scale={0.12}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial ref={coreMat} color={own} toneMapped={false} />
        </mesh>
        <sprite ref={halo} scale={2}>
          <spriteMaterial map={glowTexture()} color={own} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </sprite>
        <mesh ref={shock} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.5, 0.56, 64]} />
          <meshBasicMaterial color="#a5f3fc" transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {schedules ? (
          <group rotation={[0.5 + persona.tilt * 0.2, 0, 0.35]}>
            <group ref={moons}>
              {Array.from({ length: schedules }, (_, i) => (
                <mesh key={i} position={[Math.cos((i / schedules) * Math.PI * 2) * 0.88, 0, Math.sin((i / schedules) * Math.PI * 2) * 0.88]}>
                  <sphereGeometry args={[0.05, 12, 12]} />
                  <meshBasicMaterial color="#d8ccff" toneMapped={false} />
                </mesh>
              ))}
            </group>
          </group>
        ) : null}
        {apps ? (
          <group rotation={[-0.55, 0, persona.tilt * 0.25 - 0.2]}>
            <group ref={shards}>
              {Array.from({ length: apps }, (_, i) => (
                <mesh key={i} position={[Math.cos((i / apps) * Math.PI * 2 + 0.6) * 1.08, 0, Math.sin((i / apps) * Math.PI * 2 + 0.6) * 1.08]}>
                  <tetrahedronGeometry args={[0.075, 0]} />
                  <meshBasicMaterial color="#67e8f9" toneMapped={false} />
                </mesh>
              ))}
            </group>
          </group>
        ) : null}
        {/* generous invisible hit target */}
        <mesh
          onClick={select}
          onPointerOver={(e) => { e.stopPropagation(); hover.current = true; onHover?.(agent.id); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { hover.current = false; onHover?.(null); document.body.style.cursor = ''; }}
        >
          <sphereGeometry args={[0.78, 16, 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>

      {status === 'waiting' ? (
        <mesh ref={pillar} position-y={3.6}>
          <cylinderGeometry args={[0.035, 0.16, 6.4, 16, 1, true]} />
          <meshBasicMaterial map={pillarTexture()} color="#fbbf24" transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ) : null}
      {/* its light on the nebula below */}
      <mesh rotation-x={-Math.PI / 2} position-y={-position[1] + 0.03}>
        <planeGeometry args={[1.8, 1.8]} />
        <meshBasicMaterial map={glowTexture()} color={status === 'waiting' ? '#fbbf24' : own} transparent opacity={status === 'off' ? 0.05 : 0.22} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>

      <group ref={anchorRef(`bot:${agent.id}:label`)} position={[0, -0.92, 0]} />
      <group ref={anchorRef(`bot:${agent.id}:top`)} position={[0, 1.55, 0]} />
    </group>
  );
}
