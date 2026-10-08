import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Edges } from '@react-three/drei';
import * as THREE from 'three';
import Bot from './Bot.jsx';
import { anchorRef } from './anchors.js';

/** A Box: a floating slab with a glowing rim, a faint grid floor, its coworkers and an "add" slot. */
export default function Island({ island, onSelect, onHover }) {
  const g = useRef();
  const seed = useMemo(() => Math.random() * 10, []);
  const color = useMemo(() => new THREE.Color(`hsl(${island.hue}, 85%, 62%)`), [island.hue]);
  const grid = useMemo(() => {
    const size = Math.max(island.w, island.d);
    const gh = new THREE.GridHelper(size, Math.round(size / 0.475), color, color);
    gh.material.transparent = true;
    gh.material.opacity = 0.09;
    gh.scale.set(island.w / size, 1, island.d / size);
    return gh;
  }, [island.w, island.d, color]);
  useFrame((state) => {
    if (g.current) g.current.position.y = Math.sin(state.clock.elapsedTime * 0.5 + seed) * 0.06;
  });
  const add = island.slots[island.slots.length - 1];
  return (
    <group position={[island.x, 0, island.z]}>
      <group ref={g}>
        <RoundedBox args={[island.w, 0.36, island.d]} radius={0.14} smoothness={4} position-y={-0.18} receiveShadow>
          <meshStandardMaterial color="#110d20" metalness={0.55} roughness={0.38} />
          <Edges threshold={20} color={color} toneMapped={false} />
        </RoundedBox>
        <primitive object={grid} position-y={0.005} />
        {/* glow under the island */}
        <mesh rotation-x={-Math.PI / 2} position-y={-0.5}>
          <planeGeometry args={[island.w * 1.4, island.d * 1.4]} />
          <meshBasicMaterial color={color} transparent opacity={0.07} depthWrite={false} />
        </mesh>
        <pointLight position={[0, -1.2, 0]} color={color} intensity={6} distance={6} />

        {island.agents.map((a, i) => (
          <Bot key={a.id} agent={a} position={[island.slots[i][0], 0, island.slots[i][1]]} onHover={onHover} onSelect={(agent) => onSelect(agent, [island.x + island.slots[i][0], 0, island.z + island.slots[i][1]])} />
        ))}

        {/* "add a coworker" slot */}
        <group position={[add[0], 0.02, add[1]]}>
          <mesh rotation-x={-Math.PI / 2}>
            <planeGeometry args={[1.1, 1.1]} />
            <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} />
          </mesh>
          <lineSegments rotation-x={-Math.PI / 2}>
            <edgesGeometry args={[new THREE.PlaneGeometry(1.1, 1.1)]} />
            <lineDashedMaterial color={color} dashSize={0.08} gapSize={0.06} transparent opacity={0.6} />
          </lineSegments>
<group ref={anchorRef(`add:${island.space.id}`)} position-y={0.1} />
        </group>

<group ref={anchorRef(`isl:${island.space.id}`)} position={[-island.w / 2, 1.9, -island.d / 2]} />
      </group>
    </group>
  );
}
