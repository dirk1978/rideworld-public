// Path bridges over motorways (2026-11-21, the owner: the bridleway off Bumble Hole Lane "has none of the thick bushes
// around it, and there's a proper metal bridge over the motorway"). Off-road bridge pieces that cross a motorway
// (world.motorways, build.mjs) are joined into bridges; each gets `deckModel` on its pieces (world.js then leaves the ground
// under it alone and paint.js draws no path across the motorway), a steel footbridge model built along its own line and
// heights (tools/kit/footbridge.py, spec tools/kit/footbridges-<id>.json), and hedges both sides of its approaches.
//   node tools/openworld/footbridges.mjs <world> [--cfg id] [--write]       (rebuild.mjs runs it when options footbridges)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), id = args[0], WRITE = args.includes('--write');
const CFG = args.includes('--cfg') ? args[args.indexOf('--cfg') + 1] : id.replace(/-next$/, '');
const wf = path.join(ROOT, 'data', 'world', id + '.json'), W = JSON.parse(fs.readFileSync(wf, 'utf8')), E = W.roads.edges;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180), dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx(a[0]));
const segX = (p1, p2, p3, p4) => { const K = kx(p1[0]), X = (p) => [(p[1] - p1[1]) * K, (p[0] - p1[0]) * 110540], [ax, ay] = X(p1), [bx, by] = X(p2), [cx, cy] = X(p3), [dx, dy] = X(p4), den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (!den) return false; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
const crosses = (e) => (W.motorways || []).some((m) => { for (let k = 1; k < e.pts.length; k++) for (let j = 1; j < m.pts.length; j++) if (segX(e.pts[k - 1], e.pts[k], m.pts[j - 1], m.pts[j])) return true; return false; });
// bridge pieces over a motorway, then their neighbouring bridge pieces (one bridge in two OSM ways)
const sel = new Set(); E.forEach((e, i) => { if (e.off && e.bridge && crosses(e)) sel.add(i); });
for (let more = true; more;) { more = false; E.forEach((e, i) => { if (sel.has(i) || !e.off || !e.bridge) return; for (const j of sel) if ([E[j].a, E[j].b].some((x) => x === e.a || x === e.b)) { sel.add(i); more = true; break; } }); }
// group into chains and order each into one line
const groups = []; const left = new Set(sel);
while (left.size) {
  const g = [left.values().next().value]; left.delete(g[0]);
  for (let n = 0; n < g.length; n++) for (const j of [...left]) if ([E[j].a, E[j].b].some((x) => x === E[g[n]].a || x === E[g[n]].b)) { g.push(j); left.delete(j); }
  // ordered points: start at an end that only one piece of the group touches
  const deg = new Map(); for (const i of g) for (const x of [E[i].a, E[i].b]) deg.set(x, (deg.get(x) || 0) + 1);
  let j0 = [...deg].find(([, c]) => c === 1)?.[0] ?? E[g[0]].a, pts = [], used = new Set();
  for (;;) { const i = g.find((x) => !used.has(x) && (E[x].a === j0 || E[x].b === j0)); if (i == null) break; used.add(i); const P = E[i].a === j0 ? E[i].pts : [...E[i].pts].reverse(); pts.push(...(pts.length ? P.slice(1) : P)); j0 = E[i].a === j0 ? E[i].b : E[i].a; }
  groups.push({ edges: g, pts });
}
// a footbridge is straight (OSM's line wiggled by a metre or two over the M5): every point of the group onto the line
// between its two ends, heights kept; the ridden pieces move with it (only with --write)
for (const g of groups) {
  const A = g.pts[0], B = g.pts.at(-1), K = kx(A[0]), bx = (B[1] - A[1]) * K, by = (B[0] - A[0]) * 110540, L2 = bx * bx + by * by || 1;
  const onto = (q) => { const t = Math.max(0, Math.min(1, (((q[1] - A[1]) * K) * bx + ((q[0] - A[0]) * 110540) * by) / L2)); return [+(A[0] + (B[0] - A[0]) * t).toFixed(7), +(A[1] + (B[1] - A[1]) * t).toFixed(7), q[2]]; };
  g.pts = g.pts.map(onto);
  if (WRITE) for (const i of g.edges) E[i].pts = E[i].pts.map(onto);
}
const spec = groups.map((g, n) => {
  const mid = g.pts[Math.floor(g.pts.length / 2)], K = kx(mid[0]);
  let L = 0; for (let k = 1; k < g.pts.length; k++) L += dist(g.pts[k - 1], g.pts[k]);
  // where along the bridge a pier may stand: not over a carriageway (motorway half width + 1.5 m); the model puts piers
  // at the ends and in the gaps between carriageways (the central reservation)
  const S = [0]; for (let k = 1; k < g.pts.length; k++) S.push(S[k - 1] + dist(g.pts[k - 1], g.pts[k]));
  const atS = (sv) => { let k = S.findIndex((v) => v >= sv); if (k < 1) k = 1; const t = (sv - S[k - 1]) / ((S[k] - S[k - 1]) || 1); return [g.pts[k - 1][0] + (g.pts[k][0] - g.pts[k - 1][0]) * t, g.pts[k - 1][1] + (g.pts[k][1] - g.pts[k - 1][1]) * t]; };
  const segD = (p, a, b) => { const K2 = kx(p[0]), ax = (a[1] - p[1]) * K2, ay = (a[0] - p[0]) * 110540, bx = (b[1] - p[1]) * K2, by = (b[0] - p[0]) * 110540, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(ax + vx * t, ay + vy * t); };
  const blocked = []; for (let sv = 0; sv <= S.at(-1); sv += 0.5) { const p = atS(sv); blocked.push((W.motorways || []).some((m) => { for (let j = 1; j < m.pts.length; j++) if (segD(p, m.pts[j - 1], m.pts[j]) < m.w / 2 - 0.3) return true; return false; })); }
  const piers = []; for (let k = 1; k < blocked.length - 1; k++) if (!blocked[k] && blocked[k - 1]) { let e2 = k; while (e2 < blocked.length && !blocked[e2]) e2++; if (e2 < blocked.length && e2 - k >= 2) piers.push(+(((k + e2 - 1) / 2) * 0.5).toFixed(1)); }
  return { n: n + 1, piers, lat: +mid[0].toFixed(7), lon: +mid[1].toFixed(7), ground: +mid[2].toFixed(2), len: +L.toFixed(1), surf: E[g.edges[0]].surf || 'gravel', hw: E[g.edges[0]].hw,
    pts: g.pts.map((q) => [+((q[1] - mid[1]) * K).toFixed(2), +((q[0] - mid[0]) * 110540).toFixed(2), +(q[2] - mid[2]).toFixed(2)]), edges: g.edges };
});
for (const b of spec) console.log(`footbridge ${b.n}: ${b.hw} ${b.len} m over the motorway at ${b.lat},${b.lon} (${b.edges.length} pieces)`);
const specFile = path.join(ROOT, 'tools', 'kit', `footbridges-${CFG}.json`);
fs.writeFileSync(specFile, JSON.stringify(spec.map(({ edges, ...b }) => b), null, 1));
if (WRITE) {
  for (const b of spec) for (const i of b.edges) E[i].deckModel = true;
  // hedges: both sides of the approaches, 2.4 m out, along the path pieces that lead onto each bridge (up to 140 m each)
  W.barriers = (W.barriers || []).filter((x) => !x.footbridge);
  for (const b of spec) {
    const ends = new Set(b.edges.flatMap((i) => [E[i].a, E[i].b]));
    // (each approach followed along its path pieces through simple joins for up to 140 m: the pieces by a bridge are short)
    const deg = new Map(); for (const e of E) for (const x of [e.a, e.b]) deg.set(x, (deg.get(x) || 0) + 1);
    for (const [j0, e0] of E.entries()) {
      if (b.edges.includes(j0) || !e0.off) continue;
      let jn = ends.has(e0.a) ? e0.a : ends.has(e0.b) ? e0.b : null; if (jn == null) continue;
      const out = []; let e = e0, ei = j0, acc = 0;
      while (e && acc < 140) {
        const P = e.a === jn ? e.pts : [...e.pts].reverse();
        for (let k = out.length ? 1 : 0; k < P.length && acc < 140; k++) { if (out.length) acc += dist(out.at(-1), P[k]); out.push(P[k]); }
        jn = e.a === jn ? e.b : e.a; if (deg.get(jn) !== 2) break;
        const ni = E.findIndex((f, fi) => fi !== ei && f.off && (f.a === jn || f.b === jn)); if (ni < 0) break; e = E[ni]; ei = ni;
      }
      if (out.length < 2) continue;
      for (const sd of [-1, 1]) {
        const side = out.map((q, k) => { const a = out[Math.max(0, k - 1)], c = out[Math.min(out.length - 1, k + 1)], K = kx(q[0]), ex = (c[1] - a[1]) * K, ey = (c[0] - a[0]) * 110540, l = Math.hypot(ex, ey) || 1; return [+(q[0] + (ex / l) * sd * 2.4 / 110540).toFixed(6), +(q[1] - (ey / l) * sd * 2.4 / K).toFixed(6)]; });
        W.barriers.push({ t: 'hedge', pts: side, footbridge: b.n });
      }
    }
  }
  const MD = path.join(ROOT, 'public', 'models', 'footbridges', CFG);
  W.landmarks = (W.landmarks || []).filter((m) => m.lock !== 'footbridge');
  for (const b of spec) if (fs.existsSync(path.join(MD, `footbridge-${b.n}.glb`))) W.landmarks.push({ model: `footbridge-${b.n}`, dir: `footbridges/${CFG}`, lat: b.lat, lon: b.lon, heading: 0, ground: b.ground, near: 1500, lock: 'footbridge' });
  console.log('footbridges placed:', W.landmarks.filter((m) => m.lock === 'footbridge').length, '; hedges', W.barriers.filter((x) => x.footbridge).length);
  fs.writeFileSync(wf, JSON.stringify(W));
}
