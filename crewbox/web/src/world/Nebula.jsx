import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Entity from './Entity.jsx';
import { anchorRef } from './anchors.js';
import { glowTexture } from './shaders.js';

/** A Box: a slowly turning two-armed nebula of dust, its coworkers floating above it, and a ghost seed to add one. */
export default function Nebula({ cluster, focusId, onSelect, onHover }) {
  const dust = useRef();
  const ghost = useRef();
  const R = cluster.radius;
  const color = useMemo(() => new THREE.Color(`hsl(${cluster.hue}, 90%, 62%)`), [cluster.hue]);
  const geometry = useMemo(() => {
    const n = Math.min(700, 260 + cluster.agents.length * 60);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = R * 1.05 * Math.pow(Math.random(), 0.65);
      const a = (i % 2) * Math.PI + r * 1.35 + (Math.random() - 0.5) * (0.5 + r * 0.25);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.4 * (1 - r / (R * 1.1)) + 0.05;
      pos[i * 3 + 2] = Math.sin(a) * r;
      c.setHSL(((cluster.hue + (Math.random() - 0.5) * 50 + 360) % 360) / 360, 0.85, 0.5 + Math.random() * 0.3);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, [R, cluster.hue, cluster.agents.length]);

  useFrame((state, dt) => {
    if (dust.current) dust.current.rotation.y += dt * 0.04;
    if (ghost.current) { ghost.current.rotation.y += dt * 0.6; ghost.current.rotation.x += dt * 0.25; }
  });
  const add = cluster.slots[cluster.slots.length - 1];
  const focusOf = (id) => (focusId ? focusId === id : null);
  return (
    <group position={[cluster.x, 0, cluster.z]}>
      <points ref={dust} geometry={geometry}>
        <pointsMaterial map={glowTexture()} size={0.22} sizeAttenuation vertexColors transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </points>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <planeGeometry args={[R * 2.8, R * 2.8]} />
        <meshBasicMaterial map={glowTexture()} color={color} transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[R - 0.015, R + 0.015, 128]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false} depthWrite={false} />
      </mesh>

      {cluster.agents.map((a, i) => {
        const p = cluster.slots[i];
        return <Entity key={a.id} agent={a} position={p} focus={focusOf(a.id)} onHover={onHover} onSelect={(agent) => onSelect(agent, [cluster.x + p[0], p[1], cluster.z + p[2]])} />;
      })}

      {/* the seed of the next coworker */}
      <group position={add}>
        <mesh ref={ghost}>
          <icosahedronGeometry args={[0.32, 1]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.35} toneMapped={false} />
        </mesh>
        <group ref={anchorRef(`add:${cluster.space.id}`)} />
      </group>

      <group ref={anchorRef(`isl:${cluster.space.id}`)} position={[0, 2.9, 0]} />
    </group>
  );
}
