// Isometric board geometry. Everything is in world units: one floor cell is CW wide and CH tall
// (2:1 isometric). A Box is an 8×8-cell tile, tiles sit on a 9-cell pitch (one cell of gap), and
// coworkers stand on a 2-cell lattice inside their tile (4×4 places).
export const CW = 40;
export const CH = 20;
const MIN_SIDE = 8;

// Block (a coworker), measured on the reference board.
export const CORNER = 0.5;        // rounding of the corners, as a share of an edge
export const BW = (CW * 1.456) / (1 - CORNER / 4); // top face, so that the visible width is 1.456 cells
export const BH = BW / 2;
export const DEPTH = CW * 0.29;   // thickness of the block

export const iso = (i, j) => [((i - j) * CW) / 2, ((i + j) * CH) / 2];

/** Board colours a coworker can wear. Red is kept for errors. */
export const COLORS = ['#2a5ddf', '#cc43ae', '#7c4dff', '#16a37a', '#e8892b', '#0ea5c6', '#d9a514', '#5b6cff', '#e0559b', '#3fa34d'];
export function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const colorOf = (agent) => agent.color || COLORS[hashOf(agent.handle || agent.name) % COLORS.length];

/** Mix a hex colour with white (k > 0) or black (k < 0). */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A rhombus with rounded corners, centred on (cx, cy). */
export function roundedRhombus(w, h, k = CORNER, cx = 0, cy = 0) {
  const P = [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let d = '';
  for (let n = 0; n < 4; n++) {
    const prev = P[(n + 3) % 4], cur = P[n], next = P[(n + 1) % 4];
    const a = lerp(cur, prev, k / 2), b = lerp(cur, next, k / 2);
    d += `${n ? 'L' : 'M'}${a[0].toFixed(2)},${a[1].toFixed(2)}Q${cur[0].toFixed(2)},${cur[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`;
  }
  return `${d}Z`;
}
/** Leftmost x of a rounded rhombus of width w (the apex of the rounded left corner). */
export const roundedHalfWidth = (w, k = CORNER) => w / 2 - (w / 2) * (k / 2) * 0.5;

const ORDER = (() => {
  // Tile places by distance from the centre; ties keep a fixed reading order, so adding a Box
  // never moves the others.
  const cells = [];
  for (let I = -6; I <= 6; I++) for (let J = -6; J <= 6; J++) {
    const [x, y] = iso(I, J);
    cells.push({ I, J, d: Math.hypot(x, y * 2), x, y });
  }
  return cells.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
})();

export function layoutBoard(spaces, agents) {
  const bySpace = new Map(spaces.map((s) => [s.id, []]));
  // Oldest first: a new coworker takes the next free place, the others stay put.
  for (const a of [...agents].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) bySpace.get(a.space_id)?.push(a);
  const most = Math.max(0, ...[...bySpace.values()].map((l) => l.length + 1));
  const side = Math.max(MIN_SIDE, 2 * Math.ceil(Math.sqrt(most)));
  const pitch = side + 1;
  const per = side / 2;
  const blocks = new Map();
  const tiles = spaces.map((space, n) => {
    const { I, J } = ORDER[n];
    const i0 = I * pitch, j0 = J * pitch;
    const corner = (i, j) => iso(i0 + i, j0 + j);
    const top = corner(0, 0), right = corner(side, 0), bottom = corner(side, side), left = corner(0, side);
    const slot = (k) => { const a = k % per, b = Math.floor(k / per); return iso(i0 + 2 * a + 1, j0 + 2 * b + 1); };
    const list = bySpace.get(space.id) || [];
    list.forEach((a, k) => blocks.set(a.id, { agent: a, at: slot(k), tile: space.id, index: k }));
    return { space, top, right, bottom, left, center: corner(side / 2, side / 2), agents: list, next: list.length < per * per ? slot(list.length) : null };
  });
  const xs = tiles.flatMap((t) => [t.left[0], t.right[0]]);
  const ys = tiles.flatMap((t) => [t.top[1], t.bottom[1]]);
  const bbox = tiles.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - BH - DEPTH, y1: Math.max(...ys) } : { x0: -100, x1: 100, y0: -50, y1: 50 };
  return { tiles, blocks, bbox, side };
}
