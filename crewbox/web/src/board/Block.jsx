import { memo, useId } from 'react';
import { BW, BH, DEPTH, roundedRhombus, roundedHalfWidth, shade } from './iso.js';

const ERROR = '#e05a5a';
const HW = roundedHalfWidth(BW);
const TOP = roundedRhombus(BW, BH, undefined, 0, -DEPTH);
const BOTTOM = roundedRhombus(BW, BH, undefined, 0, 0);
const BODY = `${BOTTOM}M${-HW},${-DEPTH}H${HW}V0H${-HW}Z`;
const SHADOW = roundedRhombus(BW * 1.18, BH * 1.18, undefined, 0, 1.5);
// The left face, as a plane: (u along the edge, v down) -> board.
const FACE = `matrix(1,0.5,0,1,${-BW / 2},${-DEPTH})`;
const EYES = [0.36 * (BW / 2), 0.6 * (BW / 2)];
const EYE_V = 0.55 * DEPTH;
const EYE_R = 0.29 * DEPTH;

let ctx;
/** Text width in board units, for the name pill. */
function measure(text, size) {
  ctx ||= document.createElement('canvas').getContext('2d');
  ctx.font = `500 ${size * 10}px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif`;
  return ctx.measureText(text).width / 10;
}
const FONT = 5.1;
const PAD = 9;
const MAX_LABEL = BW * 0.95;
function fit(name) {
  if (measure(name, FONT) + PAD <= MAX_LABEL) return name;
  let s = name;
  while (s.length > 3 && measure(`${s}…`, FONT) + PAD > MAX_LABEL) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function Eyes({ status, color }) {
  if (status === 'error') {
    const [a, b] = EYES;
    const x = (cx) => <path d={`M${cx - 1.7},${EYE_V - 1.7}l3.4,3.4m0,-3.4l-3.4,3.4`} />;
    return (
      <g transform={FACE}>
        <rect x={a - 4.4} y={EYE_V - 3.5} width={b - a + 8.8} height={7} rx={3.5} fill="#16161b" stroke="rgba(255,255,255,0.16)" strokeWidth={0.5} />
        <g stroke="#fff" strokeWidth={1.25} strokeLinecap="round" className="rb-x">{x(a)}{x(b)}</g>
        <path d={`M${(a + b) / 2 - 1.8},${DEPTH - 0.6}q1.8,-1.6 3.6,0`} fill="none" stroke="#fff" strokeWidth={0.8} strokeLinecap="round" opacity={0.85} />
      </g>
    );
  }
  if (status === 'off') {
    return (
      <g transform={FACE} fill="rgba(255,255,255,0.16)">
        {EYES.map((u) => <rect key={u} x={u - 2.3} y={EYE_V - 0.6} width={4.6} height={1.2} rx={0.6} transform={`rotate(24 ${u} ${EYE_V})`} />)}
      </g>
    );
  }
  if (status === 'sleep') {
    // Asleep until its next scheduled task: eyes closed, softly glowing in its colour; it peeks now and then.
    const glow = shade(color, 0.55);
    return (
      <g transform={FACE}>
        <g className="rb-eyes-closed" fill={glow} filter="url(#rb-eye-glow)">
          {EYES.map((u) => <rect key={u} x={u - 2.4} y={EYE_V - 0.75} width={4.8} height={1.5} rx={0.75} />)}
        </g>
        <g className="rb-eyes-peek">
          {EYES.map((u) => <g key={u}><circle cx={u} cy={EYE_V} r={EYE_R} fill="#f4f5f8" /><circle cx={u + 0.5} cy={EYE_V + 0.4} r={EYE_R * 0.5} fill="#16161b" /></g>)}
        </g>
      </g>
    );
  }
  // Awake: ready (it blinks), working (pupils dart around) or waiting for you (looking up).
  return (
    <g transform={FACE}>
      <g className={`rb-eyes-open ${status === 'running' ? 'rb-look' : ''}`}>
        {EYES.map((u) => (
          <g key={u}>
            <circle cx={u} cy={EYE_V} r={EYE_R} fill="#f4f5f8" stroke="rgba(0,0,0,0.35)" strokeWidth={0.3} />
            <circle className="rb-pupil" cx={u + 0.5} cy={EYE_V + (status === 'waiting' ? -0.7 : 0.4)} r={EYE_R * 0.5} fill="#16161b" />
          </g>
        ))}
      </g>
    </g>
  );
}

function Lock() {
  return (
    <g transform={`translate(-4.4,${-DEPTH - BH / 2 - 11.5}) scale(0.37)`} fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </g>
  );
}

/**
 * A coworker on the board: a rounded isometric block in its colour, its name on top and its eyes on
 * the front face. Awake and blinking when ready, asleep with glowing eyes until its next scheduled
 * task, hopping with darting eyes while it works, looking up under a bubble when it needs you, red
 * with crossed eyes on error, a dim ghost with a lock when switched off.
 */
function Block({ agent, color, status, at, index, pulse, thought, onOpen }) {
  const id = useId().replace(/:/g, '');
  const off = status === 'off';
  const err = status === 'error';
  const top = err ? ERROR : color;
  const name = fit(agent.name);
  const lw = measure(name, FONT) + PAD;
  const open = () => onOpen(agent);
  return (
    <g
      className={`rb-block st-${status}`}
      transform={`translate(${at[0].toFixed(2)},${at[1].toFixed(2)})`}
      data-agent={agent.id}
      role="button"
      tabIndex={0}
      aria-label={agent.name}
      onClick={(e) => { if (!e.currentTarget.closest('svg')?.dataset.dragged) open(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      style={{ '--delay': `${Math.min(index, 12) * 70}ms` }}
    >
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={shade(top, err ? 0.04 : 0.07)} />
          <stop offset="1" stopColor={shade(top, err ? -0.08 : -0.05)} />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={err ? '#c43a3a' : '#2b2d33'} />
          <stop offset="1" stopColor={err ? '#701818' : '#141519'} />
        </linearGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="rb-in">
        {!off ? <path d={SHADOW} fill={top} opacity={err ? 0.5 : 0.42} filter="url(#rb-glow)" className="rb-shadow" /> : null}
        {status === 'running' ? <ellipse className="rb-orbit" cx={0} cy={0} rx={BW * 0.74} ry={BW * 0.37} fill="none" stroke={shade(color, 0.35)} strokeWidth={0.9} strokeDasharray="5 4" /> : null}
        {status === 'waiting' ? <path className="rb-wait-ring" d={roundedRhombus(BW * 1.15, BH * 1.15)} fill="none" stroke="#fbbf24" strokeWidth={1} /> : null}
        {pulse ? <path key={pulse.n} className={`rb-ripple ${pulse.error ? 'bad' : ''}`} d={roundedRhombus(BW, BH)} fill="none" stroke={pulse.error ? '#f87171' : shade(color, 0.45)} strokeWidth={1.2} /> : null}

        <g className="rb-lift">
          <g className="rb-hop">
            <g opacity={off ? 0.5 : 1}>
              <path d={BODY} fill={off ? 'rgba(46,42,48,0.75)' : `url(#s${id})`} />
              <path d={BOTTOM} fill="none" stroke={off ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.1)'} strokeWidth={0.5} />
              <path d={TOP} fill={off ? 'rgba(92,86,92,0.8)' : `url(#t${id})`} stroke={off ? 'rgba(255,255,255,0.14)' : `url(#r${id})`} strokeWidth={off ? 0.6 : 1} />
              {pulse ? <path key={`f${pulse.n}`} className="rb-flash" d={TOP} fill="#fff" /> : null}
            </g>
            <Eyes status={status} color={color} />
            <g className="rb-name">
              <rect x={-lw / 2} y={-DEPTH - 4.2} width={lw} height={8.4} rx={2.4} fill={off ? 'rgba(20,18,22,0.6)' : shade(top, -0.68)} fillOpacity={off ? 1 : 0.86} stroke={off ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.13)'} strokeWidth={0.4} />
              <text x={0} y={-DEPTH + 1.8} textAnchor="middle" fontSize={FONT} fontWeight={500} fill={off ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.93)'}>{name}</text>
            </g>
          </g>
        </g>

        {off ? <Lock /> : null}
        {status === 'waiting' ? (
          <g className="rb-bubble" transform={`translate(0,${-DEPTH - BH / 2 - 11})`}><g>
            <path d="M-6.2,-6.2h12.4a2.8,2.8 0 0 1 2.8,2.8v5.6a2.8,2.8 0 0 1 -2.8,2.8h-4.2l-2,2.6l-2,-2.6h-4.2a2.8,2.8 0 0 1 -2.8,-2.8v-5.6a2.8,2.8 0 0 1 2.8,-2.8z" fill="#fbbf24" />
            <text x={0} y={2.6} textAnchor="middle" fontSize={8} fontWeight={800} fill="#1a1200">!</text>
          </g></g>
        ) : null}
        {thought ? (
          <g className="rb-thought" transform={`translate(0,${-DEPTH - BH / 2 - 10})`}>
            <rect x={-(measure(thought, 5.2) + 8) / 2} y={-4.6} width={measure(thought, 5.2) + 8} height={9.2} rx={4.6} fill="rgba(10,10,16,0.82)" stroke={shade(color, 0.3)} strokeWidth={0.5} />
            <text x={0} y={1.9} textAnchor="middle" fontSize={5.2} fill="rgba(255,255,255,0.9)">{thought}</text>
          </g>
        ) : null}
      </g>
    </g>
  );
}

export default memo(Block);
