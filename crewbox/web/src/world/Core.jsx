import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { CORE } from './layout.js';
import { anchorRef } from './anchors.js';
import { makeOrbMaterial, glowTexture, heartbeat } from './shaders.js';

const VIOLET = new THREE.Color('#a78bfa');
const CYAN = new THREE.Color('#67e8f9');
const AMBER = new THREE.Color('#fbbf24');

/** You: the core every coworker reports to. A gyroscope of light that turns amber when someone waits for you. */
export default function Core({ waiting, working, onOpen }) {
  const rings = useRef([]);
  const halo = useRef();
  const mat = useMemo(() => makeOrbMaterial({ seed: 7, hue: 255, shift: 70, sat: 70 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const u = mat.uniforms;
    const k = 1 - Math.exp(-dt * 3);
    const beat = waiting ? heartbeat(t, 1.6) : 0;
    u.uTime.value = t;
    u.uPhase.value += dt * (working ? 0.7 : 0.25);
    u.uAmp.value = THREE.MathUtils.lerp(u.uAmp.value, working ? 0.16 : 0.1, k);
    u.uFreq.value = 1.3;
    u.uBeat.value = beat * 0.07;
    u.uTint.value.copy(AMBER);
    u.uTintMix.value = THREE.MathUtils.lerp(u.uTintMix.value, waiting ? 0.45 : 0, k);
    u.uBright.value = 1.3;
    const target = waiting ? AMBER : working ? CYAN : VIOLET;
    rings.current.forEach((r, i) => {
      if (!r) return;
      r.rotation.x += dt * (0.25 + i * 0.12) * (working ? 2.2 : 1);
      r.rotation.y += dt * (0.18 - i * 0.07) * (working ? 2.2 : 1);
      r.material.color.lerp(target, k);
      r.scale.setScalar(1 + beat * 0.06);
    });
    halo.current.material.color.lerp(target, k);
    halo.current.material.opacity = 0.35 + beat * 0.3;
  });
  return (
    <group position={CORE}>
      <mesh material={mat} scale={0.55}>
        <icosahedronGeometry args={[1, 24]} />
      </mesh>
      <mesh scale={0.2}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshBasicMaterial color={[2.2, 2.1, 2.6]} toneMapped={false} />
      </mesh>
      {[1.0, 1.25, 1.5].map((r, i) => (
        <mesh key={r} ref={(el) => { rings.current[i] = el; }} rotation={[i * 0.9, i * 0.5, 0]}>
          <torusGeometry args={[r, 0.012, 8, 128]} />
          <meshBasicMaterial color="#a78bfa" toneMapped={false} transparent opacity={0.85} />
        </mesh>
      ))}
      <sprite ref={halo} scale={4.2}>
        <spriteMaterial map={glowTexture()} color="#a78bfa" transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </sprite>
      <Sparkles count={40} scale={[3.4, 3.4, 3.4]} size={2} speed={0.4} color="#c4b5fd" />
      <mesh
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}
      >
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <group ref={anchorRef('core')} position={[0, 2.1, 0]} />
    </group>
  );
}
