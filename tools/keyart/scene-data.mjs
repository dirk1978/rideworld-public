// Key art (2026-11-24, the owner: "a planet coaster type image" for each open world's card): everything Blender needs to
// stage a box of an open world as a diorama, in metres east / north of the box's centre, heights in the LIDAR datum:
// the ground (lib/dtm.js, every STEP m), the landmark models placed in the world file, the canal / river water with its
// levels, the LIDAR trees and the buildings (footprints + heights). tools/keyart/keyart.py renders it.
//   node tools/keyart/scene-data.mjs <world id> <w> <s> <e> <n> <out.json> [step m, default 3]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url), dtm = require(path.join(ROOT, 'lib', 'dtm.js'));
const [id, w, s, e, n, out, stepArg] = process.argv.slice(2); const B = { w: +w, s: +s, e: +e, n: +n }, STEP = +stepArg || 3;
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world', id + '.json'), 'utf8'));
const lat0 = (B.s + B.n) / 2, lon0 = (B.w + B.e) / 2, K = 111320 * Math.cos((lat0 * Math.PI) / 180);
const X = (la, lo) => [+((lo - lon0) * K).toFixed(2), +((la - lat0) * 110540).toFixed(2)];
const inB = (la, lo, m = 0) => la > B.s - m / 110540 && la < B.n + m / 110540 && lo > B.w - m / K && lo < B.e + m / K;
// the ground: nx x ny heights from the north-west corner, row by row (NaN -> the nearest earlier value)
const nx = Math.round(((B.e - B.w) * K) / STEP) + 1, ny = Math.round(((B.n - B.s) * 110540) / STEP) + 1;
const ground = []; let last = 0;
for (let r = 0; r < ny; r++) {
  const la = B.n - ((B.n - B.s) * r) / (ny - 1), row = dtm.sample(id, B.w, la, B.e, la, Math.max(nx, 2));
  // (sample() lays an n x n grid over the rectangle; a zero-height rectangle gives n rows of the same line: take row 0)
  for (let c = 0; c < nx; c++) { const v = row[c]; if (Number.isFinite(v)) last = v; ground.push(+last.toFixed(2)); }
}
const lms = (W.landmarks || []).filter((L) => inB(L.lat, L.lon, 150)).map((L) => ({ model: L.model, dir: L.dir, xy: X(L.lat, L.lon), heading: L.heading || 0, ground: L.ground }));
const water = [...(W.water || []), ...(W.land || []).filter((a) => a.t === 'water')].filter((a) => a.pts.some(([la, lo]) => inB(la, lo, 50)))
  .map((a) => ({ t: a.t, w: a.w || null, area: !a.w, pts: a.pts.map(([la, lo]) => X(la, lo)), lv: Array.isArray(a.lv) ? a.lv : Number.isFinite(a.lv) ? a.pts.map(() => a.lv) : null }));
const trees = (W.lidarTrees || []).filter(([la, lo]) => inB(la, lo, 30)).map(([la, lo, h, cr]) => [...X(la, lo), +(+h).toFixed(1), +(+(cr || 3)).toFixed(1)]);
const buildings = (W.buildings || []).filter((b) => b.pts.some(([la, lo]) => inB(la, lo, 20))).map((b) => ({ pts: b.pts.map(([la, lo]) => X(la, lo)), lh: b.lh || 5, lr: b.lr || (b.lh || 5) + 2.5, k: b.k }));
const roads = W.roads.edges.filter((ed) => ed.pts.some(([la, lo]) => inB(la, lo, 20))).map((ed) => ({ hw: ed.hw, off: !!ed.off, w: ed.w || null, pts: ed.pts.map(([la, lo, h]) => [...X(la, lo), h]) }));
const res = { id, box: B, origin: [lat0, lon0], step: STEP, nx, ny, size: [+((B.e - B.w) * K).toFixed(1), +((B.n - B.s) * 110540).toFixed(1)], ground, landmarks: lms, water, trees, buildings, roads };
fs.writeFileSync(out, JSON.stringify(res));
console.log(`${id}: ground ${nx} x ${ny}, ${lms.length} landmarks, ${water.length} water, ${trees.length} trees, ${buildings.length} buildings, ${roads.length} roads -> ${out}`);
