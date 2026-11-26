// Usage: node tools/routes/straighten-from-osm.mjs ROUTE_ID osm-roads.json (Overpass "way[highway] (bbox); out geom tags;").
// Writes straight-ROUTE_ID.json (proposed Straighten corrections, only those moving the line <= 3 m) and prints what
// each would move. Review, then add them to the route with routes.setCorrections. Paris done 2026-10-21 (36 stretches).
// Straighten corrections from OSM: where the route runs along a straight OSM segment (>= 60 m between nodes), the
// road is straight there. Prints proposed corrections and their effect; doesn't save. node straight.mjs ROUTE_ID osm.json
import fs from 'fs';
import { Route } from './public/js/route.js';
const [id, osmFile] = process.argv.slice(2);
const gpx = fs.readFileSync(`./data/routes/${id}.gpx`, 'utf8');
const pts = [...gpx.matchAll(/<(?:trkpt|rtept) lat="([-\d.]+)" lon="([-\d.]+)"[^>]*>\s*<ele>([-\d.]+)/g)].map((m) => ({ lat: +m[1], lon: +m[2], ele: +m[3] }));
const entry = (JSON.parse(fs.readFileSync('./data/routes.json')).routes || JSON.parse(fs.readFileSync('./data/routes.json'))).find((x) => x.id === id);
const base = new Route('x', pts.map((p) => ({ ...p })), entry.adjust || null, entry.finish, entry.start, { centre: entry.centre });
const lat0 = pts[0].lat, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540, P = (la, lo) => [lo * kx, la * ky];
const osm = JSON.parse(fs.readFileSync(osmFile));
// straight lines: consecutive segments of a way joined while they stay in line (every node within 0.8 m of the chord)
const segs = [];
for (const w of osm.elements) {
  const g = (w.geometry || []).map((q) => P(q.lat, q.lon));
  let i = 0;
  while (i < g.length - 1) {
    let j = i + 1;
    const inLine = (i, j) => { const a = g[i], b = g[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) return false; for (let k = i + 1; k < j; k++) { const n = Math.abs(((g[k][0] - a[0]) * (b[1] - a[1]) - (g[k][1] - a[1]) * (b[0] - a[0])) / L); if (n > 0.8) return false; } return true; };
    while (j + 1 < g.length && inLine(i, j + 1)) j++;
    const a = g[i], b = g[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L >= 60) segs.push({ a, b, L, name: w.tags?.name || w.tags?.highway });
    i = j;
  }
}
// route samples every 2 m
const S = []; for (let d = 0; d <= base.length; d += 2) { const p = base.at(d); S.push({ d, xy: P(p.lat, p.lon), h: base.heading ? 0 : 0 }); }
const props = [];
for (const s of segs) {
  const ux = (s.b[0] - s.a[0]) / s.L, uy = (s.b[1] - s.a[1]) / s.L;
  let run = null; const runs = [];
  for (let i = 1; i < S.length; i++) {
    const [x, y] = S[i].xy, t = (x - s.a[0]) * ux + (y - s.a[1]) * uy, n = -(x - s.a[0]) * uy + (y - s.a[1]) * ux;
    const dx = S[i].xy[0] - S[i - 1].xy[0], dy = S[i].xy[1] - S[i - 1].xy[1], par = Math.abs((dx * ux + dy * uy) / (Math.hypot(dx, dy) || 1));
    const on = t > 10 && t < s.L - 10 && Math.abs(n) < 8 && par > 0.97;
    if (on) { if (run && S[i].d - run.b <= 6) run.b = S[i].d; else { run = { a: S[i].d, b: S[i].d }; runs.push(run); } }
  }
  for (const r of runs) if (r.b - r.a >= 50) props.push({ from: r.a, to: r.b, name: s.name });
}
props.sort((p, q) => p.from - q.from);
// merge overlapping / touching (same straight carried on by the next segment if collinear is fine too)
// join neighbouring stretches (overlapping, or within 40 m) when the route between their far ends stays within 1 m of
// one straight line: OSM splits a straight avenue into a way per block
const dev = (a, b) => { const A = base.at(a), B = base.at(b), ax = A.lon * kx, ay = A.lat * ky, bx = B.lon * kx - ax, by = B.lat * ky - ay, L = Math.hypot(bx, by); let mx = 0; for (let d = a; d <= b; d += 2) { const q = base.at(d); mx = Math.max(mx, Math.abs(((q.lon * kx - ax) * by - (q.lat * ky - ay) * bx) / L)); } return mx; };
const merged = []; for (const p of props) { const m = merged.at(-1); if (m && p.from <= m.to + 40 && (p.from <= m.to + 4 || dev(m.from, Math.max(m.to, p.to)) < 3)) { m.to = Math.max(m.to, p.to); } else merged.push({ ...p }); }
// effect: how far the straight line is from the current line, and the waver removed
const km = (d) => +((d + (base.startM || 0)) / 1000).toFixed(4);
const adjust = [...(entry.adjust || []), ...merged.map((m) => ({ from: km(m.from), to: km(m.to), straight: true, note: 'straight road (OSM): ' + m.name }))];
const after = new Route('x', pts.map((p) => ({ ...p })), adjust, entry.finish, entry.start, { centre: entry.centre });
// sideways distance from a point of the old line to the new line (nearest point within +-30 m of the same distance)
const gap = (d) => { const a = base.at(d); let best = 1e9; for (let e = Math.max(0, d - 30); e <= Math.min(after.length, d + 30); e += 0.5) { const q = after.at(e); best = Math.min(best, Math.hypot((a.lon - q.lon) * kx, (a.lat - q.lat) * ky)); } return best; };
let worst = 0, total = 0;
for (const m of merged) { let mx = 0; for (let d = m.from; d <= m.to; d += 2) mx = Math.max(mx, gap(d)); m.moved = mx; worst = Math.max(worst, mx); total += m.to - m.from; }
let outside = 0; for (let d = 0; d <= base.length; d += 4) { if (merged.some((m) => d >= m.from - 20 && d <= m.to + 20)) continue; outside = Math.max(outside, gap(d)); }
console.log(id, merged.length, 'straight stretches,', (total / 1000).toFixed(1), 'km of', (base.length / 1000).toFixed(1), '| line moved: worst', worst.toFixed(1), 'm | anywhere else', outside.toFixed(2), 'm | length', base.length.toFixed(0), '->', after.length.toFixed(0));
for (const m of merged) console.log('  ', (m.from / 1000).toFixed(2), '-', (m.to / 1000).toFixed(2), 'km', Math.round(m.to - m.from) + ' m', 'moved up to', m.moved.toFixed(1), 'm', m.name);
fs.writeFileSync(`straight-${id}.json`, JSON.stringify(merged.filter((m) => m.moved <= 3).map((m) => ({ from: km(m.from), to: km(m.to), straight: true, note: 'straight road (OSM): ' + m.name }))));
