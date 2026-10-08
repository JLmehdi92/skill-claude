import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { QuadraticBezierLine } from '@react-three/drei';
import { beams } from './activity.js';

const LIFE = 2.8;

function Beam({ from, to, born }) {
  const line = useRef();
  useFrame((_, dt) => {
    if (!line.current) return;
    const age = (Date.now() - born) / 1000;
    line.current.material.dashOffset -= dt * 2.2;
    line.current.material.opacity = Math.max(0, 1 - age / LIFE);
  });
  const mid = [(from[0] + to[0]) / 2, 3 + Math.hypot(from[0] - to[0], from[2] - to[2]) * 0.18, (from[2] + to[2]) / 2];
  return <QuadraticBezierLine ref={line} start={[from[0], 1.1, from[2]]} end={[to[0], 1.1, to[2]]} mid={mid} color="#67e8f9" lineWidth={2.5} dashed dashScale={6} dashSize={0.6} gapSize={0.35} transparent toneMapped={false} />;
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
