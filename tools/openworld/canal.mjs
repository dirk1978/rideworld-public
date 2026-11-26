// Canal lock flights (2026-11-21, the owner: "really work hard on these Tardebigge locks ... the longest lock flight in the
// country"). From OpenStreetMap's lock ways (lock=yes + lock_ref: a way from gate to gate, its first node the UPPER
// gate) and the canal's centre line, chained into one line: each lock's gates, each pound's water level (the LIDAR DTM
// along the pound's middle, median, then forced to step DOWN at every lock), the towpath side.
//   node tools/openworld/canal.mjs <world id> [--osm data/cache/osm/x.opl] [--box s,w,n,e] [--write]
// writes world.canal = { locks: [{ ref, name, up: [lat, lon], down: [lat, lon], hi, lo, tow: 'left'|'right' }], pounds:
// [{ from: [lat, lon], to: [lat, lon], lv }], line: [[lat, lon, s]] } (levels in the world's datum: metres above OD)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2), id = args[0], flag = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write'), CFG = flag('--cfg', id.replace(/-next$/, ''));
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { toBNG, heightAt } = await import('../routes/bristol/lidar.mjs');
const L = await import('./localosm.mjs');
const wf = path.join(ROOT, 'data', 'world', id + '.json'), W = JSON.parse(fs.readFileSync(wf, 'utf8'));
const opt = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'openworld', 'options', CFG + '.json'), 'utf8'));
const OSM = flag('--osm', opt.canal?.osm || 'data/cache/osm/bromsgrove.opl');
const box = (flag('--box') || opt.canal?.box?.join(',') || '').split(',').map(Number);
if (box.length !== 4) { console.error('no --box (or options canal.box)'); process.exit(1); }
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180), dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx(a[0]));
const q = await L.query(`[out:json];way["waterway"="canal"](${box.join(',')});out geom qt;`, path.join(ROOT, OSM));
const ways = q.elements.filter((w) => w.geometry && !w.tags?.tunnel && w.tags?.usage !== 'spillway').map((w) => ({ id: w.id, t: w.tags || {}, ids: w.nodes, g: w.geometry.map((p) => [p.lat, p.lon]) }));
// chain the ways into lines by shared end nodes, then keep the longest
const byEnd = new Map(); for (const w of ways) for (const n of [w.ids[0], w.ids.at(-1)]) (byEnd.get(n) || byEnd.set(n, []).get(n)).push(w);
const used = new Set(), lines = [];
for (const w0 of ways) {
  if (used.has(w0)) continue; used.add(w0);
  let ids = [...w0.ids], g = [...w0.g];
  for (const dir of [1, -1]) for (;;) {
    const end = dir === 1 ? ids.at(-1) : ids[0];
    const nx = (byEnd.get(end) || []).find((w) => !used.has(w) && (w.ids[0] === end || w.ids.at(-1) === end) && (byEnd.get(end) || []).length <= 2);
    if (!nx) break; used.add(nx);
    let ni = nx.ids, ng = nx.g; if ((dir === 1 && ni[0] !== end) || (dir === -1 && ni.at(-1) !== end)) { ni = [...ni].reverse(); ng = [...ng].reverse(); }
    if (dir === 1) { ids.push(...ni.slice(1)); g.push(...ng.slice(1)); } else { ids = [...ni.slice(0, -1), ...ids]; g = [...ng.slice(0, -1), ...g]; }
  }
  lines.push({ ids, g });
}
const len = (g) => g.slice(1).reduce((s, p, i) => s + dist(p, g[i]), 0);
lines.sort((a, b) => len(b.g) - len(a.g));
const line = lines[0]; const S = [0]; for (let i = 1; i < line.g.length; i++) S.push(S[i - 1] + dist(line.g[i - 1], line.g[i]));
const sOf = (p) => { let best = null; for (let i = 1; i < line.g.length; i++) { const a = line.g[i - 1], b = line.g[i], K = kx(a[0]), vx = (b[1] - a[1]) * K, vy = (b[0] - a[0]) * 110540, wx = (p[1] - a[1]) * K, wy = (p[0] - a[0]) * 110540, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)), d = Math.hypot(wx - vx * t, wy - vy * t); if (!best || d < best.d) best = { d, s: S[i - 1] + Math.sqrt(L2) * t }; } return best; };
const at = (s) => { let i = S.findIndex((v) => v >= s); if (i <= 0) return line.g[i < 0 ? line.g.length - 1 : 0]; const t = (s - S[i - 1]) / (S[i] - S[i - 1] || 1), a = line.g[i - 1], b = line.g[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
// locks: the lock ways' end nodes; first node = upper gate
const locks = ways.filter((w) => w.t.lock === 'yes' && w.g.length >= 2).map((w) => { const up = w.g[0], down = w.g.at(-1), su = sOf(up), sd = sOf(down); return { ref: w.t.lock_ref || '', name: w.t.lock_name || '', up, down, sUp: su.s, sDown: sd.s, off: Math.max(su.d, sd.d), tow: w.t.towpath || 'left' }; }).filter((k) => k.off < 15);
// orient the line so s increases DOWNHILL (from upper gate to lower gate on most locks)
const downhill = locks.filter((k) => k.sDown > k.sUp).length >= locks.length / 2;
if (!downhill) { line.g.reverse(); for (let i = 0; i < S.length; i++) S[i] = S.at(-1) - S[i]; S.reverse(); for (const k of locks) { k.sUp = S.at(-1) - k.sUp; k.sDown = S.at(-1) - k.sDown; } }
locks.sort((a, b) => a.sUp - b.sUp);
// pounds: between one lock's lower gate and the next lock's upper gate (and the ends of the line)
const DTM = async (p) => { const { E, N } = toBNG(p[0], p[1]); try { const h = await heightAt('dtm', E, N); return Number.isFinite(h) && h > -50 ? h : null; } catch { return null; } };
const pounds = []; const edges = [0, ...locks.flatMap((k) => [k.sUp, k.sDown]), S.at(-1)];
for (let i = 0; i < edges.length; i += 2) {
  const a = edges[i], b = edges[i + 1], hs = [];
  for (let s = a + 6; s <= b - 6; s += 3) { const v = await DTM(at(s)); if (v != null) hs.push(v); }
  if (hs.length < 3) for (let s = a; s <= b; s += 1) { const v = await DTM(at(s)); if (v != null) hs.push(v); }
  hs.sort((x, y) => x - y);
  pounds.push({ a, b, lv: hs.length ? hs[Math.floor(hs.length * 0.3)] : null, n: hs.length });
}
// each lock steps down: the pound below is lower than the pound above by 0.8-4 m (if not, the median's off: fill from
// the neighbours' typical fall)
const falls = []; for (let i = 0; i < locks.length; i++) { const u = pounds[i].lv, d = pounds[i + 1].lv; if (u != null && d != null) falls.push(u - d); }
const typ = falls.filter((f) => f > 0.8 && f < 4).sort((a, b) => a - b)[Math.floor(falls.length / 2)] || 2.2;
for (let i = 0; i < locks.length; i++) { const u = pounds[i], d = pounds[i + 1]; if (u.lv == null) u.lv = d.lv + typ; if (d.lv == null || u.lv - d.lv < 0.8 || u.lv - d.lv > 4) d.lv = u.lv - typ; }
for (let i = 0; i < locks.length; i++) { locks[i].hi = +pounds[i].lv.toFixed(2); locks[i].lo = +pounds[i + 1].lv.toFixed(2); }
console.log(`${id}: canal line ${(S.at(-1) / 1000).toFixed(2)} km, ${locks.length} locks, typical fall ${typ.toFixed(2)} m`);
for (const [i, k] of locks.entries()) console.log(`  lock ${k.ref.padStart(3)} ${k.name.padEnd(20)} ${(k.sUp / 1000).toFixed(3)} km  ${k.hi.toFixed(2)} -> ${k.lo.toFixed(2)}  fall ${(k.hi - k.lo).toFixed(2)}  pound below ${(pounds[i + 1].b - pounds[i + 1].a).toFixed(0)} m`);
console.log('  top pound', pounds[0].lv?.toFixed(2), 'bottom pound', pounds.at(-1).lv?.toFixed(2));
// ---- the lock models' spec (tools/kit/canal.py builds them) and their placement ----
const MODELDIR = path.join(ROOT, 'public', 'models', 'canal', CFG);
const bearing = (a, b) => Math.atan2((b[0] - a[0]) * 110540, (b[1] - a[1]) * kx(a[0])); // (anticlockwise from east)
// how far a gate's beams may reach on each side: the nearest road or path crossing the gate's line (the owner 2026-11-17, on
// the old locks: the towpath-side beam reached across the towpath, "apparently in my way")
const reach = (g, k) => {
  const K = kx(g[0]), ex = (k.down[1] - k.up[1]) * K, ey = (k.down[0] - k.up[0]) * 110540, L = Math.hypot(ex, ey), ux = ex / L, uy = ey / L, nx = -uy, ny = ux;
  const r = { left: 9, right: 9 };
  for (const e of W.roads.edges) for (let i = 1; i < e.pts.length; i++) {
    const a = e.pts[i - 1], b = e.pts[i], ax = (a[1] - g[1]) * K, ay = (a[0] - g[0]) * 110540, bx = (b[1] - g[1]) * K, by = (b[0] - g[0]) * 110540;
    const aa = ax * ux + ay * uy, ab = bx * ux + by * uy; if ((aa - 0) * (ab - 0) > 0 && Math.min(Math.abs(aa), Math.abs(ab)) > 1.5) continue;
    const t = ab === aa ? 0.5 : Math.max(0, Math.min(1, -aa / (ab - aa))), cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t, across = cx * nx + cy * ny;
    const hw = (e.off ? 2.0 : 5.0) / 2; if (Math.abs(across) < 1.2) continue; // (the lock's own crossing: none should be this close)
    const side = across > 0 ? 'left' : 'right'; r[side] = Math.min(r[side], Math.abs(across) - hw);
  }
  return r;
};
const spec = locks.map((k) => { const ru = reach(k.up, k), rd = reach(k.down, k); return { ref: k.ref, name: k.name, len: +dist(k.up, k.down).toFixed(2), fall: +(k.hi - k.lo).toFixed(2), tow: k.tow, reach: { up: { left: +ru.left.toFixed(2), right: +ru.right.toFixed(2) }, down: { left: +rd.left.toFixed(2), right: +rd.right.toFixed(2) } } }; });
// canal bridges along the flight: every road (not path) crossing the line between the flight's ends; for each, the road's
// deck heights across the canal (relative to the pound), the canal's direction there and where the towpath runs, for a
// brick arch model (tools/kit/canal.py bridge-<n>.glb) under the drawn road
const sA = Math.max(0, locks[0].sUp - 400), sB = Math.min(S.at(-1), locks.at(-1).sDown + 400);
const bridges = [];
{ const segX = (p1, p2, p3, p4) => { const K = kx(p1[0]), X = (p) => [(p[1] - p1[1]) * K, (p[0] - p1[0]) * 110540], [ax, ay] = X(p1), [bx, by] = X(p2), [cx, cy] = X(p3), [dx, dy] = X(p4), den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (!den) return null; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null; };
  const lvAt = (sv) => pounds.find((p) => sv >= p.a && sv <= p.b)?.lv;
  const lockNear = (sv) => locks.some((k) => sv > k.sUp - 6 && sv < k.sDown + 6);
  W.roads.edges.forEach((e, ei) => {
    if ((e.off && e.hw !== 'track') || e.tunnel || /^(motorway|trunk|primary)/.test(e.hw)) return; // (big roads keep their own modern decks: Stratford's A46 / A3400, 2026-11-21)
    for (let i = 1; i < e.pts.length; i++) for (let j = 1; j < line.g.length; j++) {
      const t = segX(line.g[j - 1], line.g[j], e.pts[i - 1], e.pts[i]); if (t == null) continue;
      const sv = S[j - 1] + (S[j] - S[j - 1]) * t; if (sv < sA || sv > sB || lockNear(sv) || bridges.some((b) => Math.abs(b.s - sv) < 8)) continue;
      const lv = lvAt(sv); if (lv == null) continue;
      const p = at(sv), q = at(sv + 2), K = kx(p[0]), cx = (q[1] - p[1]) * K, cy = (q[0] - p[0]) * 110540, cl = Math.hypot(cx, cy), ux = cx / cl, uy = cy / cl, nx = -uy, ny = ux;
      const loc = (g) => { const X = (g[1] - p[1]) * K, Y = (g[0] - p[0]) * 110540; return [X * ux + Y * uy, X * nx + Y * ny]; };
      const deck = e.pts.map((g) => { const [u, v] = loc(g); return [+v.toFixed(2), +(g[2] - lv).toFixed(2), +u.toFixed(2)]; }).sort((a, b) => a[0] - b[0]);
      const k0 = locks.find((k) => k.sUp > sv) || locks.at(-1), tow = k0.tow === 'left' ? 1 : -1;
      // the towpath's offset across the canal at the bridge (the nearest path on the towpath side within 10 m)
      let towOff = 3.2;
      for (const f of W.roads.edges) { if (!f.off || f === e) continue; for (const g of f.pts) { const [u, v] = loc(g); if (Math.abs(u) < 12 && v * tow > 1.5 && v * tow < 9) towOff = Math.min(towOff === 3.2 ? 9 : towOff, v * tow); } }
      if (towOff > 8) towOff = 3.2;
      // the towpath's own height under the bridge (path points within 8 m along the canal), over the pound
      const tz = []; for (const f of W.roads.edges) { if (!f.off || f === e) continue; for (const g of f.pts) { const [u, v] = loc(g); if (Math.abs(u) < 5 && v * tow > 1.5 && v * tow < 9) tz.push(g[2] - lv); } }
      tz.sort((a, b) => a - b); const towZ = tz.length ? Math.max(0.3, Math.min(1.6, tz[0])) : 0.6; // (the lowest point under it: by a lock's tail the path climbs away within metres, Grimley Lane)
      // (a road BELOW the pound passes under the canal, an aqueduct or culvert: Salters Lane at Stratford; not a bridge)
      { const mid = deck.filter((d) => Math.abs(d[0]) < 7); if (mid.length && Math.min(...mid.map((d) => d[1])) < 0.5) { console.log('  (road under the canal, skipped:', e.name || e.hw, ')'); continue; } }
      bridges.push({ n: bridges.length + 1, name: e.name || e.hw, s: +sv.toFixed(1), lat: +p[0].toFixed(7), lon: +p[1].toFixed(7), heading: +(-Math.atan2(uy, ux) * 180 / Math.PI).toFixed(2), lv, road: (e.w || { trunk: 8, primary: 7.5, secondary: 7, tertiary: 6.5, unclassified: 5, residential: 5.5, track: 3, service: 3.5 }[e.hw] || 5), deck, tow, towOff: +towOff.toFixed(2), towZ: +towZ.toFixed(2), skew: +Math.abs(Math.atan2(deck.at(-1)[2] - deck[0][2], deck.at(-1)[0] - deck[0][0]) * 180 / Math.PI).toFixed(1) });
    }
  });
  // humpback: a road crossing the flight rises to 3.5 m over the pound across the canal and towpath (the towpath passes
  // under every bridge; the survey's road heights there ran as low as 1.8 m), eased in over 25 m each way along every
  // road point near it (shared junction points rise together, so nothing steps)
  if (WRITE) for (const b of bridges) {
    // (3.5 m over the water, and the arch's crown over the towpath 2.5 m above the path: the owner 2026-11-21, "so small that you
    // essentially cycle through the solid bridge"; crown = deck - 0.77 m of road, fill and arch ring)
    const need = Math.max(3.5, (b.towZ ?? 0.6) + 2.5 + 0.77 + 0.15), low = Math.min(...b.deck.filter((d) => Math.abs(d[0]) < 7).map((d) => d[1]));
    const dz = Math.min(2.5, need - low); if (!(dz > 0.05)) continue; // (never more than 2.5 m)
    const c = [b.lat, b.lon];
    for (const e of W.roads.edges) { if (e.off && e.hw !== 'track') continue; for (const q of e.pts) { const d = dist(q, c); if (d >= 25) continue; const t = d < 7 ? 1 : (25 - d) / 18, w = t * t * (3 - 2 * t); q[2] = +(q[2] + dz * w).toFixed(2); } }
    for (const d of b.deck) { const dd = Math.hypot(d[0], d[2]); const t = dd < 7 ? 1 : dd < 25 ? (25 - dd) / 18 : 0; d[1] = +(d[1] + dz * t * t * (3 - 2 * t)).toFixed(2); }
    b.raised = +dz.toFixed(2);
  }
  console.log('canal bridges:', bridges.map((b) => `${b.name} @${b.s} m (tow ${b.towOff} m, skew ${b.skew}${b.raised ? ', raised ' + b.raised + ' m' : ''})`).join('; '));
}
console.log('beam reach (m from the centre line, up gate L/R, down gate L/R):', spec.map((x) => `${x.ref}:${x.reach.up.left}/${x.reach.up.right},${x.reach.down.left}/${x.reach.down.right}`).join(' '));
const specFile = path.join(ROOT, 'tools', 'kit', `canal-${CFG}.json`);
fs.writeFileSync(specFile, JSON.stringify(spec, null, 1)); fs.writeFileSync(specFile.replace('.json', '-bridges.json'), JSON.stringify(bridges, null, 1));
console.log('lock spec for tools/kit/canal.py:', specFile, '(build: LOCKS=' + path.relative(ROOT, specFile) + ' /snap/bin/blender -b --python tools/kit/canal.py -- ' + path.relative(ROOT, MODELDIR) + ')');
// ---- the canal's water along the flight, rebuilt: level pounds, and narrow chamber water (at the lower pound's level:
// the chambers stand empty) stepping down exactly at the gates; a 3.5 m "neck" each side of a lock (the wing walls)
const runs = []; // [s0, s1, w, lv]
let cur = sA;
for (const [i, k] of locks.entries()) {
  const up = pounds[i].lv, lo = k.lo;
  // (the pound's water and the bed pressed under it, flatterrain, narrow in steps into the lock so they never reach under
  // its wing walls and swing quadrants: 9 m, 7 m from 8 m out, 4.2 m between the wing walls, 2.6 m in the chamber)
  if (k.sUp - 8 > cur) runs.push([cur, k.sUp - 8, 9, up]);
  if (k.sUp - 4.1 > cur) runs.push([Math.max(cur, k.sUp - 8), k.sUp - 4.1, 7, up]);
  runs.push([Math.max(cur, k.sUp - 4.1), k.sUp, 4.2, up]);
  runs.push([k.sUp, k.sDown, 2.6, up]); // (the chambers stand full, at the upper level: the owner 2026-11-21)
  runs.push([k.sDown, k.sDown + 4.6, 4.2, lo]);
  runs.push([k.sDown + 4.6, k.sDown + 9, 7, lo]);
  cur = k.sDown + 9;
}
if (sB > cur) runs.push([cur, sB, 9, pounds.at(-1).lv]);
const linePts = (s0, s1) => { const out = [at(s0)]; for (let i = 0; i < S.length; i++) if (S[i] > s0 + 0.5 && S[i] < s1 - 0.5) out.push(line.g[i]); for (let s = Math.ceil(s0 / 6) * 6; s < s1; s += 6) {} out.push(at(s1)); return out; };
if (WRITE) {
  const r6 = (v) => +v.toFixed(6);
  W.canal = { locks: locks.map((k) => ({ ref: k.ref, name: k.name, up: k.up.map(r6), down: k.down.map(r6), hi: k.hi, lo: k.lo, tow: k.tow, s: +k.sUp.toFixed(1) })),
    pounds: pounds.map((p) => ({ from: at(p.a).map(r6), to: at(p.b).map(r6), a: +p.a.toFixed(1), b: +p.b.toFixed(1), lv: +p.lv.toFixed(2) })),
    line: line.g.map((p, i) => [r6(p[0]), r6(p[1]), +S[i].toFixed(1)]) };
  // the old canal water lines along the flight go (each point within 12 m of the line between sA and sB)
  const near = (p) => { const b = sOf(p); return b.d < 12 && b.s > sA - 5 && b.s < sB + 5; };
  const n0 = W.water.length;
  W.water = W.water.filter((w) => !(w.t === 'canal' && w.pts.filter(near).length >= w.pts.length / 2));
  const name = ways.find((w) => w.t.name)?.t.name || 'canal';
  for (const [s0, s1, w, lv] of runs) { if (s1 - s0 < 0.3) continue; const pts = linePts(s0, s1).map((p) => [r6(p[0]), r6(p[1])]); W.water.push({ t: 'canal', w, name, pts, lv: pts.map(() => +lv.toFixed(2)), flight: true }); }
  console.log('canal water lines:', n0, '->', W.water.length, '(', runs.length, 'flight pieces )');
  // the lock models as landmarks (only those built), each loaded within 700 m of the rider
  W.landmarks = (W.landmarks || []).filter((m) => !m.lock);
  let nm = 0;
  for (const k of locks) {
    if (!fs.existsSync(path.join(MODELDIR, `lock-${k.ref}.glb`))) continue;
    const mid = [(k.up[0] + k.down[0]) / 2, (k.up[1] + k.down[1]) / 2];
    W.landmarks.push({ model: `lock-${k.ref}`, dir: `canal/${CFG}`, lat: r6(mid[0]), lon: r6(mid[1]), heading: +(-bearing(k.up, k.down) * 180 / Math.PI).toFixed(2), ground: k.lo, near: 700, lock: k.ref });
    nm++;
  }
  console.log('lock models placed:', nm, 'of', locks.length);
  // moored narrowboats (tools/kit/narrowboat.py, 4 liveries): opt.canal.moorings [{ lock, above, from, n, gap }]: a line
  // of boats on the towpath side, starting `from` m above the lock's upper gate (or below its lower gate)
  let nb = 0;
  for (const m of opt.canal?.moorings || []) {
    const k = locks.find((x) => x.ref === String(m.lock)); if (!k) continue;
    const pi = locks.indexOf(k) + (m.above ? 0 : 1), P0 = pounds[pi]; if (!P0) continue;
    for (let j = 0; j < (m.n || 1); j++) {
      const sc = m.above ? k.sUp - m.from - j * (m.gap || 21) : k.sDown + m.from + j * (m.gap || 21);
      if (sc < P0.a + 10 || sc > P0.b - 10) continue;
      const p = at(sc), q = at(sc + 1), K = kx(p[0]), ex = (q[1] - p[1]) * K, ey = (q[0] - p[0]) * 110540, L = Math.hypot(ex, ey) || 1;
      const side = k.tow === 'left' ? 1 : -1, off = 2.6 * side, nx = -ey / L, ny = ex / L;
      const lat = p[0] + (ny * off) / 110540, lon = p[1] + (nx * off) / K;
      const hd = -Math.atan2(ey, ex) * 180 / Math.PI + ((j + nb) % 2 ? 180 : 0); // (bows both ways)
      W.landmarks.push({ model: `boat-${((nb * 7 + j * 3) % 4) + 1}`, dir: 'canal/boats', lat: r6(lat), lon: r6(lon), heading: +hd.toFixed(1), ground: +(P0.lv - 0.12).toFixed(2), near: 900, lock: 'boat' });
    }
    nb++;
  }
  for (const b of bridges) if (fs.existsSync(path.join(MODELDIR, `bridge-${b.n}.glb`))) W.landmarks.push({ model: `bridge-${b.n}`, dir: `canal/${CFG}`, lat: b.lat, lon: b.lon, heading: b.heading, ground: b.lv, near: 900, lock: 'bridge' });
  console.log('canal bridges placed:', W.landmarks.filter((x) => x.lock === 'bridge').length);
  // the ground inside each bridge's arch on the towpath side pressed down to the towpath (world.js passes W.basins to
  // flatterrain.js, which presses ground to 1 m under a basin's lv): the ground model rose there towards the lane's
  // embankment, a steep bank right beside the path under the arch (2026-11-22, London Lane)
  W.basins = (W.basins || []).filter((x) => !x.canalBridge);
  for (const b of bridges) {
    const h = (b.heading * Math.PI) / 180, sh = Math.sin(h), ch = Math.cos(h), K = 111320 * Math.cos((b.lat * Math.PI) / 180), sg = b.tow < 0 ? -1 : 1;
    const over = Math.min(b.towOff, 4.5) + 3.6 + 0.3;
    const ll = (off, cn) => { const x = off * sh + cn * ch, y = off * ch - cn * sh; return [r6(b.lat + y / 110540), r6(b.lon + x / K)]; };
    // the towpath's own height under the bridge (the off-road pieces inside the opening): the ground goes down to that
    const zs = [];
    for (const e of W.roads.edges) { if (!e.off) continue; for (const q of e.pts) { const x = (q[1] - b.lon) * K, y = (q[0] - b.lat) * 110540, off = (x * sh + y * ch) * sg, cn = x * ch - y * sh; if (off > 1.5 && off < over && Math.abs(cn) < 5) zs.push(q[2]); } }
    if (!zs.length) continue;
    zs.sort((x, y) => x - y); const zp = zs[zs.length >> 1];
    W.basins.push({ poly: [ll(sg * 2.3, -5), ll(sg * over, -5), ll(sg * over, 5), ll(sg * 2.3, 5)], lv: +(zp + 1.0).toFixed(2), canalBridge: b.n });
  }
  console.log('bridge arches pressed to the towpath:', W.basins.filter((x) => x.canalBridge).length);
  console.log('narrowboats moored:', W.landmarks.filter((x) => x.lock === 'boat').length);
  fs.writeFileSync(wf, JSON.stringify(W)); console.log('written world.canal to', wf);
}
