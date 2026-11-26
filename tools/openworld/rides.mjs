// Pre-plotted routes in an open world (2026-11-18, the owner: "in the 3 open worlds, instead of start positions, can we
// have about 10 each pre-plotted routes with a variety of flat or elevation, taking in landmarks?").
//
// A ride is a list of waypoints (`via`: place names from the world's own list, street names, landmark model names, or
// [lat, lon]); in the ride the satnav takes the rider through them in turn (openworld.js setRide), so a ride survives
// map edits and rebuilds. This tool works out the roads between them exactly as the satnav will (same snapping, same
// one-way rules, same costs: paths and tracks count longer) and writes each ride's distance, climbing, steepest bit,
// off-road share, outline and the landmarks / places it passes into routes.json (`rides` on the open world's entry).
//
//   node tools/openworld/rides.mjs <world id>           check and print (nothing written)
//   node tools/openworld/rides.mjs <world id> --write   also write routes.json (a backup is kept first by the caller)
// Spec: tools/openworld/rides/<world id>.json  [{ id, name, blurb, via: [...], loop?: true }]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [id] = process.argv.slice(2), WRITE = process.argv.includes('--write'), DUMP = process.argv.includes('--dump');
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world', id + '.json'), 'utf8'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'openworld', 'rides', id + '.json'), 'utf8'));
const E = W.roads.edges, nJ = W.roads.junctions.length;

const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx(a[0]));
const lenOf = (e) => { let L = 0; for (let k = 1; k < e.pts.length; k++) L += dist(e.pts[k - 1], e.pts[k]); return L; };
const LEN = E.map(lenOf);
let OFFROAD = false; // (a ride with `offroad: true`, e.g. the Tardebigge towpath: paths at their own length and waypoints snap to them; openworld.js navW does the same)
const cost = (i) => LEN[i] * (E[i].cyc ? 0.92 : 1) * (E[i].off && !OFFROAD ? (E[i].surf === 'paved' ? 1.4 : 4) : 1); // (= openworld.js navW on a route: tracks count 4x)
const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// names -> points: the world's places, every street (middle of its longest piece), landmarks by model
const NAMES = [];
for (const [lat, lon, name, kind] of W.places || []) NAMES.push({ n: norm(name), name, lat, lon, kind });
{ const by = new Map(); E.forEach((e) => { if (e.name && (!by.has(e.name) || by.get(e.name).pts.length < e.pts.length)) by.set(e.name, e); }); for (const [name, e] of by) { const p = e.pts[e.pts.length >> 1]; NAMES.push({ n: norm(name), name, lat: p[0], lon: p[1], kind: 'street' }); } }
for (const L of W.landmarks || []) NAMES.push({ n: norm(L.model.replace(/_/g, ' ')), name: L.model, lat: L.lat, lon: L.lon, kind: 'landmark' });
function resolve(v, prev) {
  if (Array.isArray(v)) return { name: `${v[0]},${v[1]}`, lat: v[0], lon: v[1] };
  const q = norm(String(v).replace(/^street:/, '')), streetOnly = String(v).startsWith('street:');
  let c = NAMES.filter((x) => x.n === q && (!streetOnly || x.kind === 'street'));
  if (!c.length) c = NAMES.filter((x) => x.n.includes(q) && (!streetOnly || x.kind === 'street'));
  if (!c.length) throw new Error(`no place called "${v}"`);
  if (prev) c.sort((a, b) => dist([a.lat, a.lon], [prev.lat, prev.lon]) - dist([b.lat, b.lon], [prev.lat, prev.lon]));
  return c[0];
}
// the nearest point on a road (not a bridge or tunnel: as the satnav)
// (scored, for waypoints given by a place's NAME: a village's point sits among houses, and the nearest road was often a
// cul-de-sac: the ride went in and reversed out, Romsley / Waverley Crescent 2026-11-20. So: the best through road within
// 250 m, bigger roads preferred, dead ends never)
const RANKP = { trunk: 0, primary: 0, secondary: 0, tertiary: 30, unclassified: 70, residential: 260, living_street: 300 };
function snap(lat, lon, roadsOnly = true, scored = false) {
  if (OFFROAD) { roadsOnly = false; scored = false; }
  if (scored) {
    let best = null;
    // (coordinates, scored === 'coord': the nearest road that isn't a dead end, within 120 m: London Bridge's north end
    // snapped to Swan Lane, the Angel to Torrens Street)
    const R0 = scored === 'coord' ? 120 : 400;
    E.forEach((e, i) => { if (e.bridge || e.tunnel || e.off || e.dead || e.rb) return; const pen = scored === 'coord' ? 0 : RANKP[String(e.hw).replace('_link', '')] ?? 80; let acc = 0;
      for (let k = 0; k < e.pts.length; k++) { if (k) acc += dist(e.pts[k - 1], e.pts[k]); const d = dist(e.pts[k], [lat, lon]); if (d > R0) continue; const sc = d + pen; if (!best || sc < best.sc) best = { sc, d, i, k, along: acc }; } });
    if (best) return best;
  } // (roads first: a waypoint by the canal took the towpath; written back as the via, so the satnav snaps the same)
  let best = null;
  E.forEach((e, i) => { if (e.bridge || e.tunnel || (roadsOnly && e.off)) return; let acc = 0; for (let k = 0; k < e.pts.length; k++) { if (k) acc += dist(e.pts[k - 1], e.pts[k]); const d = dist(e.pts[k], [lat, lon]); if (!best || d < best.d) best = { d, i, k, along: acc }; } });
  return best;
}
// forward Dijkstra from a snapped point to another; returns the polyline [lat, lon, ele] and the edges used
const out = Array.from({ length: nJ }, () => []);
E.forEach((e, i) => { if (e.oneway !== -1) out[e.a].push([e.b, i, false]); if (e.oneway !== 1) out[e.b].push([e.a, i, true]); });
// the planned line itself (2026-11-24, the owner: "the routing in open world needs a huge rethink ... 'give it some hints and
// it'll probably find the right way' isn't working"): the ride follows THIS at every junction (openworld.js lineWay), so
// nothing is routed while riding. Points within 1 m of a straight run dropped (Douglas-Peucker), Google polyline encoded.
function simplify(P, tol) {
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const K = 111320 * Math.cos((P[0][0] * Math.PI) / 180), X = (p) => [p[1] * K, p[0] * 110540];
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); const [ax, ay] = X(P[a]), [bx, by] = X(P[b]), vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-9;
    let worst = -1, wd = 0;
    for (let k = a + 1; k < b; k++) { const [px, py] = X(P[k]), t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)), d = Math.hypot(px - ax - vx * t, py - ay - vy * t); if (d > wd) { wd = d; worst = k; } }
    if (worst > 0 && wd > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return P.filter((_, k) => keep[k]);
}
function encodeLine(P) {
  let out = '', pla = 0, plo = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
  for (const [la, lo] of P) { const a = Math.round(la * 1e5), o = Math.round(lo * 1e5); enc(a - pla); enc(o - plo); pla = a; plo = o; }
  return out;
}
function leg(A, B, dir = null) { // dir: arriving direction at A ('ab' / 'ba'): a rider can't turn round mid-road at a waypoint (Marlcliff's dead-end lane, 2026-11-20)
  const D = new Float64Array(nJ).fill(Infinity), prev = new Array(nJ), heap = [];
  const push = (d, j) => { heap.push([d, j]); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const eA = E[A.i], fA = A.along / LEN[A.i];
  if (eA.oneway !== -1 && dir !== 'ba') { D[eA.b] = cost(A.i) * (1 - fA); prev[eA.b] = { start: true, rev: false }; push(D[eA.b], eA.b); }
  if (eA.oneway !== 1 && dir !== 'ab' && cost(A.i) * fA < D[eA.a]) { D[eA.a] = cost(A.i) * fA; prev[eA.a] = { start: true, rev: true }; push(D[eA.a], eA.a); }
  while (heap.length) { const [d, j] = pop(); if (d > D[j]) continue; for (const [k, i, rev] of out[j]) { const nd = d + cost(i); if (nd < D[k]) { D[k] = nd; prev[k] = { i, rev, from: j }; push(nd, k); } } }
  const eB = E[B.i], fB = B.along / LEN[B.i];
  let end = null;
  if (eB.oneway !== -1 && D[eB.a] + cost(B.i) * fB < (end?.c ?? Infinity)) end = { c: D[eB.a] + cost(B.i) * fB, j: eB.a, rev: false };
  if (eB.oneway !== 1 && D[eB.b] + cost(B.i) * (1 - fB) < (end?.c ?? Infinity)) end = { c: D[eB.b] + cost(B.i) * (1 - fB), j: eB.b, rev: true };
  if (A.i === B.i && ((B.along >= A.along && eA.oneway !== -1 && dir !== 'ba') || (B.along < A.along && eA.oneway !== 1 && dir !== 'ab'))) end = { same: true, dir: B.along >= A.along ? 'ab' : 'ba' };
  if (!end) throw new Error('no way between them');
  const part = (i, from, to) => { const P = E[i].pts; return from <= to ? P.slice(from, to + 1) : P.slice(to, from + 1).reverse(); };
  if (end.same) { const P = part(A.i, A.k, B.k); return { pts: P, pe: P.map(() => A.i), edges: [A.i], dir: end.dir, seq: [[A.i, end.dir === 'ba']] }; }
  const steps = []; for (let j = end.j; !prev[j].start; j = prev[j].from) steps.unshift(prev[j]);
  const first = prev[steps.length ? steps[0].from : end.j];
  let pts = first.rev ? part(A.i, A.k, 0) : part(A.i, A.k, E[A.i].pts.length - 1), pe = pts.map(() => A.i);
  const edges = [A.i];
  for (const s of steps) { const P = part(s.i, s.rev ? E[s.i].pts.length - 1 : 0, s.rev ? 0 : E[s.i].pts.length - 1).slice(1); pts = pts.concat(P); pe = pe.concat(P.map(() => s.i)); edges.push(s.i); }
  { const P = part(B.i, end.rev ? E[B.i].pts.length - 1 : 0, B.k).slice(1); pts = pts.concat(P); pe = pe.concat(P.map(() => B.i)); } edges.push(B.i);
  return { pts, pe, edges, dir: end.rev ? 'ba' : 'ab', seq: [[A.i, !!first.rev], ...steps.map((st) => [st.i, !!st.rev]), [B.i, !!end.rev]] };
}

const result = [];
for (const r of SPEC) {
  OFFROAD = !!r.offroad;
  let prev = null; const via = [];
  for (const v of r.via) { const p = resolve(v, prev); via.push(p); prev = p; }
  if (r.loop) via.push(via[0]);
  const snaps = via.map((p, k) => snap(p.lat, p.lon, true, typeof (r.via[k % r.via.length]) === 'string' ? 'name' : 'coord'));
  via.forEach((p, k) => { const q = E[snaps[k].i].pts[snaps[k].k]; p.lat = q[0]; p.lon = q[1]; }); // (the via is now the road point itself)
  let pts = [], legs = [], edges = [];
  let dir = null;
  for (let k = 1; k < snaps.length; k++) { let l; try { l = leg(snaps[k - 1], snaps[k], dir); } catch { l = leg(snaps[k - 1], snaps[k]); } dir = l.dir; legs.push(l); pts = pts.length ? pts.concat(l.pts.slice(1)) : l.pts; edges.push(...l.edges); }
  // THE PLAN (2026-11-24, the owner: "surely the routes should follow exactly? If they don't ... the method of sticking to the
  // route is wrong"): the exact sequence of roads and directions the legs above found, which the game follows road by road
  // (openworld.js), so nothing is guessed while riding. Consecutive pieces of the same road the same way are one step.
  // Out-and-back spurs to a waypoint (road X then road X backwards, Alcester's 180 m down Coughton Fields Lane and back,
  // mid-road) are cut when they go 350 m out or less and don't end at a dead end; longer ones (Kenelm repeats) stay, and
  // the game turns round at their end. The line (maps, distance left) is drawn from the plan itself.
  const deg = new Map(); for (const e of E) for (const x of [e.a, e.b]) deg.set(x, (deg.get(x) || 0) + 1);
  let seq = [];
  for (const l of legs) for (const st of l.seq) { const t = seq.at(-1); if (t && t[0] === st[0] && t[1] === st[1]) continue; seq.push(st); }
  { const out = []; let cut = 0, cutM = 0;
    for (let k = 0; k < seq.length; k++) {
      const x = seq[k], t = out.at(-1);
      if (t && t[0] === x[0] && t[1] !== x[1] && out.length > 1) {
        // the mirror: how many steps back the way out the way back retraces
        let m = 1; while (out.length - 1 - m >= 1 && k + m < seq.length && seq[k + m][0] === out[out.length - 1 - m][0] && seq[k + m][1] !== out[out.length - 1 - m][1]) m++;
        const tipJ = t[1] ? E[t[0]].a : E[t[0]].b, oneWay = out.slice(out.length - m).reduce((acc, q) => acc + LEN[q[0]], 0);
        if (oneWay <= 350 && deg.get(tipJ) !== 1) { out.length -= m; k += m - 1; cut++; cutM += oneWay; continue; }
      }
      out.push(x);
    }
    if (cut) console.log(`  ${r.id}: ${cut} out-and-back spur(s) cut (${Math.round(cutM)} m out)`);
    seq = out;
  }
  // the line from the plan: the first road from the start waypoint, the last to the finish
  { const S0 = snaps[0], S1 = snaps.at(-1), part2 = (i, from, to) => { const P = E[i].pts; return from <= to ? P.slice(from, to + 1) : P.slice(to, from + 1).reverse(); };
    pts = [];
    seq.forEach(([i, rev], k) => {
      const n = E[i].pts.length - 1;
      let from = rev ? n : 0, to = rev ? 0 : n;
      if (k === 0 && i === S0.i) from = S0.k;
      if (k === seq.length - 1 && i === S1.i) to = S1.k;
      const P = part2(i, from, to); pts = pts.length ? pts.concat(P.slice(1)) : P;
    });
    edges = seq.map((q) => q[0]);
  }
  const startAlong = (() => { const S0 = snaps[0], [i, rev] = seq[0]; if (i !== S0.i) return 0; let a2 = 0; const P = E[i].pts; for (let q = 1; q <= S0.k; q++) a2 += dist(P[q - 1], P[q]); return +(rev ? LEN[i] - a2 : a2).toFixed(1); })();
  // length, off-road share, climbing (heights smoothed over ~60 m), steepest 200 m
  let L = 0, off = 0; const cum = [0];
  for (let k = 1; k < pts.length; k++) { L += dist(pts[k - 1], pts[k]); cum.push(L); }
  for (const i of new Set(edges)) if (E[i].off) off += LEN[i];
  const step = 20, prof = []; for (let d = 0, k = 0; d <= L; d += step) { while (k < cum.length - 2 && cum[k + 1] < d) k++; const t = (d - cum[k]) / ((cum[k + 1] - cum[k]) || 1); prof.push(pts[k][2] + (pts[k + 1]?.[2] - pts[k][2]) * t); }
  const sm = prof.map((_, k) => { let s = 0, n = 0; for (let j = Math.max(0, k - 1); j <= Math.min(prof.length - 1, k + 1); j++) { s += prof[j]; n++; } return s / n; });
  let gain = 0; for (let k = 1; k < sm.length; k++) if (sm[k] > sm[k - 1]) gain += sm[k] - sm[k - 1];
  let steep = 0; for (let k = 10; k < sm.length; k++) steep = Math.max(steep, (sm[k] - sm[k - 10]) / (10 * step) * 100);
  // landmarks and named places within 60 m of the line
  const near = (lat, lon, R) => { for (let k = 0; k < pts.length; k += 3) if (dist(pts[k], [lat, lon]) < R) return true; return false; };
  const lms = (W.landmarks || []).filter((m) => near(m.lat, m.lon, 150)).map((m) => m.model);
  const placesPassed = [...new Set((W.places || []).filter(([la, lo, , kind]) => kind === 'area' && near(la, lo, 250)).map((x) => x[2]))];
  const shape = []; for (let k = 0; k < 120; k++) { const p = pts[Math.round((k / 119) * (pts.length - 1))]; shape.push([+p[0].toFixed(5), +p[1].toFixed(5)]); }
  const prof60 = []; for (let k = 0; k < 200; k++) prof60.push(Math.round(sm[Math.round((k / 199) * (sm.length - 1))] * 10) / 10); // (200 points: the whole ride's graph in the ride, hud.js)
  const legKm = legs.map((l) => { let s = 0; for (let k = 1; k < l.pts.length; k++) s += dist(l.pts[k - 1], l.pts[k]); return +(s / 1000).toFixed(2); });
  const kind = gain / (L / 1000) > 14 ? 'hilly' : gain / (L / 1000) > 7 ? 'rolling' : 'flat';
  // dense waypoints along the planned line (2026-11-22, the owner in London: the route "was supposed to go over parliament
  // bridge but it slipped it completely", and the map showed a route he wasn't on): with stops ~2 km apart the satnav
  // found its own way between them. A waypoint every ~300 m of the line as planned here (named after the next real stop,
  // which the satnav shows), never on a bridge, tunnel, roundabout or dead end (the satnav snaps waypoints to roads, not
  // bridges: one on Westminster Bridge would land on the Embankment), so the ride follows the line on the map.
  const dense = [], denseKm = [];
  { const named = via.map((p, k) => ({ name: r.names?.[k % r.via.length] || p.name, lat: +(+p.lat).toFixed(6), lon: +(+p.lon).toFixed(6) }));
    dense.push(named[0]);
    legs.forEach((l, k) => {
      let acc = 0, since = 0;
      for (let j = 1; j < l.pts.length - 1; j++) {
        const dd = dist(l.pts[j - 1], l.pts[j]); acc += dd; since += dd;
        const e = E[l.pe[j]], left = (() => { let t = 0; for (let q = j + 1; q < l.pts.length; q++) t += dist(l.pts[q - 1], l.pts[q]); return t; })();
        if (since >= 300 && left > 120 && !e.bridge && !e.tunnel && !e.rb && !e.dead) { dense.push({ name: named[k + 1].name, lat: +l.pts[j][0].toFixed(6), lon: +l.pts[j][1].toFixed(6) }); denseKm.push(+(since / 1000).toFixed(3)); since = 0; }
      }
      dense.push(named[k + 1]); denseKm.push(+(since + dist(l.pts.at(-2) || l.pts[0], l.pts.at(-1)) / 1000 * 0).toFixed(3));
    }); }
  // (the last leg piece of each named stop: since counted up to the second-last point; add the final step)
  { let k = 0; legs.forEach((l) => { let since = 0, acc = 0; for (let j = 1; j < l.pts.length; j++) { since += dist(l.pts[j - 1], l.pts[j]); const isLast = j === l.pts.length - 1; const e = E[l.pe[j]]; if (!isLast) { const left = (() => { let t = 0; for (let q = j + 1; q < l.pts.length; q++) t += dist(l.pts[q - 1], l.pts[q]); return t; })(); if (since >= 300 && left > 120 && !e.bridge && !e.tunnel && !e.rb && !e.dead) { denseKm[k++] = +(since / 1000).toFixed(3); since = 0; } } else denseKm[k++] = +(since / 1000).toFixed(3); } }); }
  // (waypoints on a cut spur dropped; each kept one's leg length measured along the line)
  { const kept = [], at = []; let k0 = 0;
    const onLine = (v) => { let best = Infinity, bk = k0; for (let k = k0; k < Math.min(pts.length, k0 + 4000); k++) { const d = dist(pts[k], [v.lat, v.lon]); if (d < best) { best = d; bk = k; } } return { d: best, k: bk }; };
    dense.forEach((v, n) => { const o = onLine(v); if (o.d < 25 || n === 0 || n === dense.length - 1) { kept.push(v); at.push(cum0(o.k)); k0 = o.k; } });
    function cum0(k) { let t = 0; for (let q = 1; q <= k; q++) t += dist(pts[q - 1], pts[q]); return t; }
    if (kept.length !== dense.length) { dense.splice(0, dense.length, ...kept); denseKm.splice(0, denseKm.length, ...at.slice(1).map((v, n) => +((v - at[n]) / 1000).toFixed(3))); }
  }
  result.push({ id: r.id, name: r.name, blurb: r.blurb, loop: !!r.loop, ...(r.offroad ? { offroad: true } : {}), kind, km: +(L / 1000).toFixed(1), gain: Math.round(gain), steep: +steep.toFixed(1), offKm: +(off / 1000).toFixed(1),
    via: dense, legKm: denseKm, stops: via.map((p, k) => r.names?.[k % r.via.length] || p.name), shape, profile: prof60, passes: lms, line: encodeLine(simplify(pts, 1.0)), seq: seq.map(([i, rev]) => (rev ? -(i + 1) : i + 1)), startAlong, worldAt: W.at + '|' + E.length });
  if (DUMP) { const x = result.at(-1); console.log('DUMP', x.id, 'via', x.via.length, 'legKm', x.legKm.length, 'sum', x.legKm.reduce((t, v) => t + v, 0).toFixed(2), 'km', x.km, 'bridge/tunnel vias', x.via.filter((v) => { let b = null, bd = 1e9; E.forEach((e) => { for (const q of e.pts) { const d = dist(q, [v.lat, v.lon]); if (d < bd) { bd = d; b = e; } } }); return b && (b.bridge || b.tunnel); }).length); }
  const snapWarn = snaps.map((s, k) => (s.d > 80 ? `${via[k].name} is ${Math.round(s.d)} m from a road` : '')).filter(Boolean);
  snaps.forEach((s, k) => { if (E[s.i].dead && k > 0 && k < snaps.length - 1) snapWarn.push(`${r.names?.[k] || via[k].name} is on a dead end (${E[s.i].name || E[s.i].hw}): the ride goes in and back out`); }); // (Romsley: Waverley Crescent, the owner 2026-11-20)
  legKm.forEach((km, k) => { const crow = dist([via[k].lat, via[k].lon], [via[k + 1].lat, via[k + 1].lon]) / 1000; if (km > 2 && km > crow * 1.9) snapWarn.push(`leg ${via[k].name} > ${via[k + 1].name} is ${km} km for ${crow.toFixed(1)} km as the crow flies`); }); // (a missing link: Bidford's old bridge, 2026-11-18)
  console.log(`${r.id.padEnd(22)} ${String((L / 1000).toFixed(1)).padStart(5)} km ${String(Math.round(gain)).padStart(4)} m up  steepest ${steep.toFixed(1)}%  off-road ${(off / 1000).toFixed(1)} km  ${kind}  ${lms.length ? 'landmarks: ' + lms.join(', ') : ''}${snapWarn.length ? '  !! ' + snapWarn.join('; ') : ''}`);
  if (process.argv.includes('--legs')) console.log(`${''.padEnd(22)} legs km: ${legKm.join(' / ')}`);
  console.log(`${''.padEnd(22)} via: ${via.map((p) => p.name).join(' > ')}   places: ${placesPassed.slice(0, 12).join(', ')}`);
}
if (WRITE) {
  const rf = path.join(ROOT, 'data', 'routes.json'), R = JSON.parse(fs.readFileSync(rf, 'utf8')), list = Array.isArray(R) ? R : R.routes || Object.values(R);
  const entry = list.find((x) => x.id === id); if (!entry) throw new Error('no route ' + id);
  entry.rides = result.map(({ passes, ...r }) => r);
  fs.writeFileSync(rf + '.tmp', JSON.stringify(R, null, 2), { mode: 0o600 }); fs.renameSync(rf + '.tmp', rf); // (as lib/routes.js writeList)
  console.log('written:', result.length, 'rides into', id);
}
