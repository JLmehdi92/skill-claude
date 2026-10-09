import * as THREE from 'three';

// Stable 32-bit hash of a string: gives every coworker its own "personality" (shape, colours, tilt).
export function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Ashima 3D simplex noise.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERTEX = /* glsl */ `
uniform float uTime, uPhase, uAmp, uFreq, uGlitch, uSeed, uBeat;
varying vec3 vN; varying vec3 vV; varying float vNoise;
${NOISE}
void main(){
  vec3 p = position;
  float n = snoise(p * uFreq + vec3(uPhase + uSeed));
  float n2 = snoise(p * uFreq * 1.7 - vec3(uPhase * 1.3) + uSeed * 1.7) * 0.3;
  p += normal * ((n + n2) * uAmp + uBeat);
  // Error: horizontal slices jump sideways.
  float slice = floor(p.y * 9.0 + floor(uTime * 14.0));
  float h = fract(sin(slice * 91.7 + uSeed) * 43758.5453);
  p.x += step(0.8, h) * (h - 0.9) * uGlitch * 1.6;
  vNoise = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vV = normalize(-mv.xyz);
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uA, uB, uTint; uniform float uTime, uTintMix, uBright, uDim, uFlash;
varying vec3 vN; varying vec3 vV; varying float vNoise;
vec3 pal(float t){ return vec3(0.55) + vec3(0.45) * cos(6.28318 * (vec3(t) + vec3(0.0, 0.33, 0.67))); }
void main(){
  float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.0);
  vec3 base = mix(uA, uB, smoothstep(-0.6, 0.8, vNoise));
  vec3 irid = pal(f * 0.9 + vNoise * 0.3 + uTime * 0.04);
  vec3 col = base * 0.22 + irid * f * 1.1 + base * f * 1.25 + vec3(pow(f, 6.0)) * 0.6;
  col = mix(col, uTint * (0.55 + f * 1.5), uTintMix);
  col = col * uBright + uFlash;
  float a = clamp(0.16 + f * 1.05, 0.0, 1.0);
  col *= mix(1.0, 0.3, uDim);
  a *= mix(1.0, 0.5, uDim);
  gl_FragColor = vec4(col, a);
}`;

/** The living, iridescent shell of a coworker (or of the core). */
export function makeOrbMaterial({ seed = 0, hue = 262, shift = 50, sat = 90 }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uPhase: { value: 0 }, uAmp: { value: 0.08 }, uFreq: { value: 1.5 }, uGlitch: { value: 0 },
      uSeed: { value: seed }, uBeat: { value: 0 }, uTintMix: { value: 0 }, uBright: { value: 1 }, uDim: { value: 0 }, uFlash: { value: 0 },
      uA: { value: new THREE.Color(`hsl(${hue}, ${sat}%, 60%)`) },
      uB: { value: new THREE.Color(`hsl(${(hue + shift) % 360}, ${sat}%, 58%)`) },
      uTint: { value: new THREE.Color('#fbbf24') },
    },
  });
}

const canvasTexture = (draw, w = 128, h = 128) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

let glow, pillar, sweep;
/** Radar sweep: a conic fade that trails behind a bright edge. */
export const sweepTexture = () => sweep || (sweep = canvasTexture((g, w, h) => {
  const grd = g.createConicGradient(0, w / 2, h / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.004, 'rgba(255,255,255,0.22)');
  grd.addColorStop(0.035, 'rgba(255,255,255,0.08)');
  grd.addColorStop(0.09, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const fade = g.createRadialGradient(w / 2, h / 2, w * 0.05, w / 2, h / 2, w / 2);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.75, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade; g.fillRect(0, 0, w, h);
}, 512, 512));
/** Soft round glow, for halos, dust and the nebulae. */
export const glowTexture = () => glow || (glow = canvasTexture((g) => {
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
}));
/** Vertical fade, for the signal a waiting coworker sends up. */
export const pillarTexture = () => pillar || (pillar = canvasTexture((g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0.95)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}, 4, 128));

/** Double-beat heart rhythm, 0..1. */
export function heartbeat(t, period = 1.25) {
  const p = (t % period) / period;
  return Math.exp(-((p - 0.08) ** 2) / 0.0016) + 0.6 * Math.exp(-((p - 0.26) ** 2) / 0.0016);
}
