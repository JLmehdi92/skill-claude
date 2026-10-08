// Places Boxes as floating islands on a grid, and coworkers on slots of their island.
export const SLOT = 1.9;          // distance between two coworkers
export const ISLAND_Y = 0;        // top of an island
const GAP = 2.6;                  // space between islands

const HUES = [262, 190, 330, 150, 25, 210, 280, 45];
export const islandHue = (i) => HUES[i % HUES.length];

export function layoutWorld(spaces, agents) {
  const islands = spaces.map((space, i) => {
    const mine = agents.filter((a) => a.space_id === space.id);
    const slots = mine.length + 1; // the last slot hosts "add a coworker"
    const cols = Math.max(2, Math.ceil(Math.sqrt(slots)));
    const rows = Math.max(1, Math.ceil(slots / cols));
    return { space, agents: mine, cols, rows, w: cols * SLOT + 1.2, d: rows * SLOT + 1.2, hue: islandHue(i) };
  });
  const gcols = Math.max(1, Math.ceil(Math.sqrt(islands.length)));
  const colW = [], rowD = [];
  islands.forEach((isl, i) => {
    const c = i % gcols, r = Math.floor(i / gcols);
    colW[c] = Math.max(colW[c] || 0, isl.w);
    rowD[r] = Math.max(rowD[r] || 0, isl.d);
  });
  const totalW = colW.reduce((a, b) => a + b, 0) + GAP * (colW.length - 1);
  const totalD = rowD.reduce((a, b) => a + b, 0) + GAP * (rowD.length - 1);
  const bots = new Map();
  islands.forEach((isl, i) => {
    const c = i % gcols, r = Math.floor(i / gcols);
    const x0 = -totalW / 2 + colW.slice(0, c).reduce((a, b) => a + b, 0) + GAP * c + colW[c] / 2;
    const z0 = -totalD / 2 + rowD.slice(0, r).reduce((a, b) => a + b, 0) + GAP * r + rowD[r] / 2;
    isl.x = x0; isl.z = z0;
    isl.slots = [];
    for (let k = 0; k < isl.agents.length + 1; k++) {
      const col = k % isl.cols, row = Math.floor(k / isl.cols);
      const lx = (col - (isl.cols - 1) / 2) * SLOT;
      const lz = (row - (isl.rows - 1) / 2) * SLOT;
      isl.slots.push([lx, lz]);
      if (k < isl.agents.length) bots.set(isl.agents[k].id, [x0 + lx, ISLAND_Y, z0 + lz]);
    }
  });
  return { islands, bots, size: Math.max(totalW, totalD, 8) };
}
