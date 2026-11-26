// Bridges drawn by hand (2026-11-23, the owner's report: "this is where the footbridge should be over the road", the A38
// footbridge by Carnforth Road): OSM's footbridge is footways (not ridden), so the ridden path there is a map-editor path
// with ground heights, and it crossed the Bromsgrove Eastern Bypass at road level. A spec in
// tools/openworld/handbridges/<world>.json gives each bridge's line with heights (LIDAR datum) and a model:
//  - the ridden piece named `name` takes those heights (each point of the piece from the spec line, interpolated along
//    it), and is marked deckModel + bridge (world.js leaves the ground under it alone, paint.js draws no path there);
//  - the model is placed as a landmark at `origin`, its z = 0 at `datum` (tools/kit/bromsgrove.py builds it from the
//    same spec, so the path and the model can't disagree).
//   node tools/openworld/handbridges.mjs <world file id> [--cfg id] --write          (rebuild.mjs runs it last)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), id = args[0], WRITE = args.includes('--write');
const CFG = args.includes('--cfg') ? args[args.indexOf('--cfg') + 1] : id.replace(/-next$/, '');
const specF = path.join(ROOT, 'tools', 'openworld', 'handbridges', CFG + '.json');
if (!fs.existsSync(specF)) { console.log('no hand bridges for', CFG); process.exit(0); }
const spec = JSON.parse(fs.readFileSync(specF, 'utf8')).bridges || [];
const wf = path.join(ROOT, 'data', 'world', id + '.json'), W = JSON.parse(fs.readFileSync(wf, 'utf8')), E = W.roads.edges;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
W.landmarks = (W.landmarks || []).filter((L) => !L.handBridge);
for (const b of spec) {
  const S = b.pts, K = kx(S[0][0]);
  const xy = (p) => [(p[1] - S[0][1]) * K, (p[0] - S[0][0]) * 110540];
  // height at a point: projected onto the spec line (nearest segment), interpolated; with its distance off the line
  const hAt = (p) => { const [px, py] = xy(p); let best = null; for (let k = 1; k < S.length; k++) { const [ax, ay] = xy(S[k - 1]), [bx, by] = xy(S[k]), vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / ((vx * vx + vy * vy) || 1))), d = Math.hypot(px - ax - vx * t, py - ay - vy * t); if (!best || d < best.d) best = { d, h: S[k - 1][2] + (S[k][2] - S[k - 1][2]) * t }; } return best; };
  // (by name, or, for an unnamed one, the bridge piece of that kind nearest the spec's `near` point within 15 m)
  const nearD = (e) => Math.min(...e.pts.map((q) => Math.hypot((q[0] - b.near[0]) * 110540, (q[1] - b.near[1]) * K)));
  const pieces = b.near ? E.filter((e) => e.bridge && (!b.hw || e.hw === b.hw) && nearD(e) < 15) : E.filter((e) => e.name === b.name);
  if (!pieces.length) { console.log('!', b.name, 'no ridden piece of that name'); continue; }
  for (const e of pieces) {
    let moved = 0;
    e.pts = e.pts.map((q) => { const r = hAt(q); if (r.d > 6) return q; moved++; return [q[0], q[1], +r.h.toFixed(2)]; });
    e.deckModel = true; e.bridge = true; e.handBridge = b.model;
    console.log(b.name, ': piece of', e.pts.length, 'points,', moved, 'given the bridge heights');
  }
  W.landmarks.push({ model: b.model, dir: b.dir, lat: b.origin[0], lon: b.origin[1], heading: 0, ground: b.datum, near: 1500, handBridge: true, ...(b.title ? { title: b.title, blurb: b.blurb } : {}) });
}
if (WRITE) { fs.writeFileSync(wf, JSON.stringify(W), { mode: 0o600 }); console.log('written', wf); }
