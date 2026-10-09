import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { CORE } from './layout.js';
import { hueOf } from '../lib/format.js';

const PACKETS = 4;

/**
 * The link between a coworker and you. Faint at rest; while it works, energy flows from the core
 * to it; when it needs you, amber packets travel to the core.
 */
function Synapse({ from, hue, status, focus }) {
  const packets = useRef([]);
  const curve = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...CORE);
    const m = a.clone().lerp(b, 0.5);
    m.y += 1.4 + a.distanceTo(b) * 0.14;
    return new THREE.QuadraticBezierCurve3(a, m, b);
  }, [from]);
  const points = useMemo(() => curve.getPoints(48), [curve]);
  const flow = status === 'waiting' ? 1 : status === 'running' ? -1 : 0;
  const color = status === 'waiting' ? '#fbbf24' : status === 'running' ? '#67e8f9' : `hsl(${hue}, 80%, 70%)`;
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    packets.current.forEach((m, i) => {
      if (!m) return;
      m.visible = !!flow && focus !== false;
      if (!m.visible) return;
      const s = (t * (flow > 0 ? 0.38 : 0.55) + i / PACKETS) % 1;
      curve.getPoint(flow > 0 ? s : 1 - s, p);
      m.position.copy(p);
      m.scale.setScalar(0.6 + Math.sin(s * Math.PI) * 0.8);
    });
  });
  if (status === 'off') return null;
  const opacity = (status === 'waiting' ? 0.55 : status === 'running' ? 0.32 : 0.09) * (focus === true ? 2 : focus === false ? 0.3 : 1);
  return (
    <group>
      <Line points={points} color={color} lineWidth={status === 'idle' || status === 'error' ? 1 : 1.6} transparent opacity={Math.min(1, opacity)} toneMapped={false} depthWrite={false} />
      {Array.from({ length: PACKETS }, (_, i) => (
        <mesh key={i} ref={(el) => { packets.current[i] = el; }} visible={false}>
          <sphereGeometry args={[0.05, 10, 10]} />
          <meshBasicMaterial color={status === 'waiting' ? [3, 2, 0.4] : [0.8, 2.6, 3]} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export default function Synapses({ agents, positions, focusId }) {
  return agents.map((a) => {
    const pos = positions.get(a.id);
    if (!pos) return null;
    return <Synapse key={a.id} from={pos} hue={hueOf(a.handle || a.name)} status={a.enabled ? a.status : 'off'} focus={focusId ? focusId === a.id : null} />;
  });
}
