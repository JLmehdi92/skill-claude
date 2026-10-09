// The constellation: you are the core at the centre; every Box is a nebula orbiting it, and its
// coworkers float above the nebula on a golden-angle spiral (it stays balanced at any size).
export const CORE = [0, 1.4, 0];
export const STEP = 1.35;         // spacing of the spiral
const GAP = 1.8;                  // space between two nebulae
const GOLDEN = 2.39996;

const HUES = [262, 190, 320, 150, 28, 212, 285, 48];
export const boxHue = (i) => HUES[i % HUES.length];

export function layoutWorld(spaces, agents) {
  const clusters = spaces.map((space, i) => {
    const mine = agents.filter((a) => a.space_id === space.id);
    const n = mine.length + 1; // the last slot hosts "add a coworker"
    return { space, agents: mine, n, hue: boxHue(i), radius: STEP * Math.sqrt(n) + 0.9 };
  });
  const maxR = Math.max(0, ...clusters.map((c) => c.radius));
  const arc = clusters.reduce((s, c) => s + c.radius * 2 + GAP, 0);
  const ring = Math.max(maxR + 3.4, arc / (2 * Math.PI));
  const bots = new Map();
  // Spread the nebulae around the camera axis (the camera looks from +x, +z): a single one sits in
  // front of the core, two sit left and right, more fan out from there.
  const VIEW = Math.PI / 4;
  const first = clusters.length ? ((clusters[0].radius * 2 + GAP) / arc) * Math.PI * 2 : 0;
  let angle = clusters.length === 1 ? VIEW - Math.PI : VIEW - first;
  clusters.forEach((c, i) => {
    const share = ((c.radius * 2 + GAP) / arc) * Math.PI * 2;
    const a = angle + share / 2;
    angle += share;
    c.x = Math.cos(a) * ring;
    c.z = Math.sin(a) * ring;
    c.slots = [];
    for (let j = 0; j < c.n; j++) {
      const r = c.n === 1 ? 0 : STEP * Math.sqrt(j + 0.5);
      const t = j * GOLDEN + i;
      const p = [Math.cos(t) * r, 1.15 + Math.sin(j * 1.7 + i) * 0.3, Math.sin(t) * r];
      c.slots.push(p);
      if (j < c.agents.length) bots.set(c.agents[j].id, [c.x + p[0], p[1], c.z + p[2]]);
    }
  });
  return { clusters, bots, size: ring + maxR };
}
