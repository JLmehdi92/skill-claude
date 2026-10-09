import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { QuadraticBezierLine } from '@react-three/drei';
import * as THREE from 'three';
import { beams } from './activity.js';

const LIFE = 2.8;

/** A comet from one coworker to another: a bright head racing along a fading arc. */
function Beam({ from, to, born }) {
  const line = useRef();
  const head = useRef();
  const mid = useMemo(() => [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 1.6 + Math.hypot(from[0] - to[0], from[2] - to[2]) * 0.2, (from[2] + to[2]) / 2], [from, to]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(new THREE.Vector3(...from), new THREE.Vector3(...mid), new THREE.Vector3(...to)), [from, to, mid]);
  useFrame((_, dt) => {
    const age = (Date.now() - born) / 1000;
    if (line.current) {
      line.current.material.dashOffset -= dt * 2.2;
      line.current.material.opacity = Math.max(0, 1 - age / LIFE);
    }
    if (head.current) {
      head.current.visible = age < 1.1;
      curve.getPoint(Math.min(1, age / 1.1), head.current.position);
    }
  });
  return (
    <group>
      <QuadraticBezierLine ref={line} start={from} end={to} mid={mid} color="#67e8f9" lineWidth={2.2} dashed dashScale={6} dashSize={0.6} gapSize={0.35} transparent toneMapped={false} />
      <mesh ref={head}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshBasicMaterial color={[1.5, 3, 3.4]} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Arcs of light when a coworker calls another one. */
export default function Beams({ positions }) {
  const [, force] = useState(0);
  const seen = useRef(0);
  useFrame(() => {
    const now = Date.now();
    for (let i = beams.length - 1; i >= 0; i--) if (now - beams[i].at > LIFE * 1000) beams.splice(i, 1);
    const sig = beams.reduce((n, b) => n + b.id, 0);
    if (sig !== seen.current) { seen.current = sig; force((x) => x + 1); }
  });
  return beams.map((b) => {
    const from = positions.get(b.from), to = positions.get(b.to);
    return from && to ? <Beam key={b.id} from={from} to={to} born={b.at} /> : null;
  });
}
