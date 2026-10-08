import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { pulses } from './activity.js';
import { hueOf } from '../lib/format.js';
import { anchorRef } from './anchors.js';

const STATUS_COLOR = { idle: '#34d399', running: '#60a5fa', waiting: '#fbbf24', error: '#f87171' };

/**
 * A coworker: a little robot with a visor. Its eyes follow the pointer and blink; its body tells
 * what it is doing (breathing, hopping with a holo ring, an amber beacon, a red glitch).
 */
export default function Bot({ agent, position, onSelect, onHover }) {
  const root = useRef();
  const body = useRef();
  const eyes = useRef();
  const ring = useRef();
  const beacon = useRef();
  const ripple = useRef();
  const antenna = useRef();
  const sats = useRef();
  const [hover, setHoverState] = useState(false);
  const setHover = (h) => { setHoverState(h); onHover?.(h ? agent.id : null); };
  const seed = useMemo(() => Math.random() * 100, []);
  const blink = useRef({ next: 1 + Math.random() * 4, until: 0 });
  const status = agent.enabled ? agent.status : 'off';
  const hue = hueOf(agent.handle || agent.name);
  const base = useMemo(() => new THREE.Color(`hsl(${hue}, 72%, 58%)`), [hue]);
  const statusColor = STATUS_COLOR[status] || '#666';
  const schedules = Math.min(agent.schedules || 0, 3);

  useFrame((state, dt) => {
    const time = state.clock.elapsedTime + seed;
    const g = root.current;
    if (!g) return;
    // Body motion per status.
    let y = Math.sin(time * 1.6) * 0.04, rotZ = 0, sx = 1;
    if (status === 'running') { y = Math.abs(Math.sin(time * 6)) * 0.22; sx = 1 + Math.sin(time * 12) * 0.03; }
    if (status === 'waiting') { y = 0.08 + Math.sin(time * 2.4) * 0.06; rotZ = Math.sin(time * 1.2) * 0.06; }
    if (status === 'error') { rotZ = Math.sin(time * 40) * 0.03 * (Math.sin(time * 3) > 0.6 ? 1 : 0); }
    if (status === 'off') y = 0;
    const lift = hover ? 0.25 : 0;
    body.current.position.y = THREE.MathUtils.lerp(body.current.position.y, 0.55 + y + lift, 0.2);
    body.current.rotation.z = rotZ;
    body.current.scale.set(sx, 2 - sx, sx);
    const s = THREE.MathUtils.lerp(g.scale.x, hover ? 1.08 : 1, 0.15);
    g.scale.setScalar(s);

    // A tool call makes it flash and pop.
    const since = (Date.now() - (pulses.get(agent.id) || 0)) / 1000;
    const flash = since < 0.6 ? 1 - since / 0.6 : 0;
    const mat = body.current.children[0]?.material;
    if (mat) mat.emissiveIntensity = (status === 'running' ? 0.55 + Math.sin(time * 8) * 0.15 : status === 'off' ? 0 : 0.18) + flash * 1.4;

    // Eyes look at the pointer; blink now and then; closed when switched off.
    const e = eyes.current;
    e.position.x = THREE.MathUtils.lerp(e.position.x, state.pointer.x * 0.05, 0.1);
    e.position.y = THREE.MathUtils.lerp(e.position.y, 0.06 + state.pointer.y * 0.035, 0.1);
    const b = blink.current;
    if (time > b.next) { b.until = time + 0.12; b.next = time + 2 + Math.random() * 5; }
    const closed = status === 'off' || time < b.until;
    e.scale.y = THREE.MathUtils.lerp(e.scale.y, closed ? 0.12 : status === 'waiting' ? 1.25 : 1, 0.4);

    if (ring.current) { ring.current.rotation.z += dt * 2.4; ring.current.rotation.x = Math.PI / 2 + Math.sin(time * 2) * 0.25; }
    if (beacon.current) beacon.current.position.y = 1.75 + Math.sin(time * 3) * 0.08;
    if (ripple.current) { const k = (time * 0.8) % 1; ripple.current.scale.setScalar(0.6 + k * 1.6); ripple.current.material.opacity = 0.6 * (1 - k); }
    if (antenna.current) antenna.current.material.emissiveIntensity = 1.2 + Math.sin(time * (status === 'running' ? 10 : 2)) * 0.6;
    if (sats.current) sats.current.rotation.y += dt * 0.9;
  });

  const select = (e) => { e.stopPropagation(); onSelect(agent, position); };
  return (
    <group ref={root} position={position}>
      {/* contact shadow */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
        <circleGeometry args={[0.55, 32]} />
        <meshBasicMaterial color="#000" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      {status === 'waiting' ? (
        <mesh ref={ripple} rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.55, 0.62, 48]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.6} toneMapped={false} depthWrite={false} />
        </mesh>
      ) : null}

      <group
        ref={body}
        position-y={0.55}
        onClick={select}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      >
        <RoundedBox args={[0.9, 0.8, 0.86]} radius={0.2} smoothness={5} castShadow>
          <meshStandardMaterial color={status === 'off' ? '#3a3748' : base} emissive={status === 'error' ? '#ff3b3b' : base} emissiveIntensity={0.2} roughness={0.35} metalness={0.15} />
        </RoundedBox>
        {/* visor */}
        <RoundedBox args={[0.7, 0.38, 0.06]} radius={0.08} position={[0, 0.04, 0.43]}>
          <meshStandardMaterial color="#0a0717" roughness={0.15} metalness={0.6} />
        </RoundedBox>
        <group ref={eyes} position={[0, 0.06, 0.47]}>
          {[-0.15, 0.15].map((x) => (
            <mesh key={x} position-x={x}>
              <capsuleGeometry args={[0.055, 0.06, 6, 12]} />
              <meshStandardMaterial color="#ffffff" emissive={status === 'error' ? '#ff5a5a' : status === 'waiting' ? '#ffd166' : '#c8f6ff'} emissiveIntensity={2.2} toneMapped={false} />
            </mesh>
          ))}
        </group>
        {/* antenna */}
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.22, 8]} />
          <meshStandardMaterial color="#2a2540" />
        </mesh>
        <mesh ref={antenna} position={[0, 0.64, 0]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
        {status === 'running' ? (
          <mesh ref={ring}>
            <torusGeometry args={[0.72, 0.018, 8, 64]} />
            <meshStandardMaterial color="#67e8f9" emissive="#67e8f9" emissiveIntensity={2} toneMapped={false} transparent opacity={0.85} />
          </mesh>
        ) : null}
      </group>

      {status === 'running' ? <Sparkles count={18} scale={[1.4, 1.6, 1.4]} position-y={0.9} size={2.4} speed={0.9} color="#93c5fd" /> : null}

      {status === 'waiting' ? (
        <mesh ref={beacon} position-y={1.75}>
          <octahedronGeometry args={[0.13, 0]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      ) : null}

      {/* one satellite per scheduled task */}
      {schedules ? (
        <group ref={sats} position-y={0.6}>
          {Array.from({ length: schedules }, (_, i) => (
            <mesh key={i} position={[Math.cos((i / schedules) * Math.PI * 2) * 0.85, 0.25 * (i % 2 ? 1 : -1), Math.sin((i / schedules) * Math.PI * 2) * 0.85]}>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshStandardMaterial color="#c4b5fd" emissive="#c4b5fd" emissiveIntensity={2} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ) : null}

      <group ref={anchorRef(`bot:${agent.id}:label`)} position={[0, -0.02, 0.8]} />
      <group ref={anchorRef(`bot:${agent.id}:top`)} position={[0, 2.35, 0]} />
    </group>
  );
}
