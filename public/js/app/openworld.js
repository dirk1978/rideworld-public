// Open world (2026-11-15, the owner: "make them a quadrant ... Bromsgrove ... the rider can decide where to go, like
// zwift"). A route with `open: true` carries its area's road network in its world file (tools/openworld/build.mjs:
// world.roads = { junctions: [[lat, lon]], edges: [{ a, b, name, hw, oneway, pts: [[lat, lon, ele]] }], start }).
// The ride itself is an ordinary Route made from the roads chosen so far plus the way ahead: always the straightest
// road on, ~4 km in front. Coming up to a junction a panel shows the ways on (← / → or tap to choose); choosing
// rebuilds the route from that junction on. The part already ridden is kept exactly as it was, so distance, the survey
// and the generated world before the junction stay valid; only what lies beyond is measured / built again.
// Dead ends were pruned from the network when it was built, so there's always a way on (no turning round).
import { $, C, bike, route, setRoute, state, store, toast } from './core.js';
import { viewer } from './scenery.js';
import { Route } from '../route.js';
import { world, reindexWorld, setRidden } from './world.js';
import { cleanRoad } from './cleanroad.js';
import { SURVEY_STEP, groundHeight, resurvey } from './survey.js';

const AHEAD = 4000, EXTEND_AT = 2500, SHOW_AT = 180, FULL_MS = 3000; // (the strip shows from 180 m; full for 3 s, then shrinks to the chosen way: the owner, it "stays around too long and blocks the view")
// base: path metres at the route's start (a U-turn starts the route part-way along its first road, after `prefix`)
export const ow = { debug: {}, on: false, g: null, path: [], cum: [], picks: new Map(), shown: null, base: 0, prefix: [], startAlong: 0 };

const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx(a[0]));
const bearing = (p, q) => Math.atan2((q[1] - p[1]) * Math.cos((p[0] * Math.PI) / 180), q[0] - p[0]);
// A step { i, rev } rides edge i (backwards if rev). A step with `u` (the end of a dead end, 2026-11-17) starts with a
// U-turn at the tip: a half circle to the right ahead of the tip (radius 2.5 m), then easing back onto the road 12 m on
const uCache = new Map();
function uturnPts(s) {
  const key = s.i + ':' + s.rev; if (uCache.has(key)) return uCache.get(key);
  const e = ow.g.edges[s.i], P = s.rev ? [...e.pts].reverse() : e.pts, T = P[0], K = kx(T[0]);
  const b = bearing(T, P[Math.min(P.length - 1, 1)]) + Math.PI, fwd = [Math.cos(b), Math.sin(b)], right = [-Math.sin(b), Math.cos(b)]; // ([north, east] metres: the way in)
  const at = (f, r) => [T[0] + (fwd[0] * f + right[0] * r) / 110540, T[1] + (fwd[1] * f + right[1] * r) / K, T[2]];
  const R = 2.5, out = [];
  for (let n = 0; n <= 14; n++) { const th = (n / 14) * Math.PI; out.push(at(R * Math.sin(th), R * (1 - Math.cos(th)))); }
  let acc = 0, k = 1; while (k < P.length - 1 && acc + dist(P[k - 1], P[k]) < 12) { acc += dist(P[k - 1], P[k]); k++; }
  const end = out.at(-1), Q = P[k];
  for (let n = 1; n < 6; n++) { const t = n / 6; out.push([end[0] + (Q[0] - end[0]) * t, end[1] + (Q[1] - end[1]) * t, end[2] + (Q[2] - end[2]) * t]); }
  const pts = [...out, ...P.slice(k)]; uCache.set(key, pts); return pts;
}
const ptsOf = (s) => { if (s.u) return uturnPts(s); const p = ow.g.edges[s.i].pts; return s.rev ? [...p].reverse() : p; };
const endOf = (s) => (s.rev ? ow.g.edges[s.i].a : ow.g.edges[s.i].b);
const lenOf = (s) => { const p = s.u ? uturnPts(s) : ow.g.edges[s.i].pts; let L = 0; for (let k = 1; k < p.length; k++) L += dist(p[k - 1], p[k]); return L; };

function graph(roads) {
  const out = new Map();
  roads.edges.forEach((e, i) => {
    if (e.oneway !== -1) (out.get(e.a) || out.set(e.a, []).get(e.a)).push({ i, rev: false });
    if (e.oneway !== 1) (out.get(e.b) || out.set(e.b, []).get(e.b)).push({ i, rev: true });
  });
  // dead ends (build.mjs `dead`): the steps that lead further INTO one (away from the rest of the network), so the
  // default way on never wanders down a cul-de-sac (the rider or the satnav can still choose one)
  const touchesLive = new Set(); roads.edges.forEach((e) => { if (!e.dead) { touchesLive.add(e.a); touchesLive.add(e.b); } });
  const depth = new Map([...touchesLive].map((n) => [n, 0])), q = [...touchesLive], adj = new Map();
  roads.edges.forEach((e) => { if (!e.dead) return; (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); });
  while (q.length) { const v = q.shift(); for (const w of adj.get(v) || []) if (!depth.has(w)) { depth.set(w, depth.get(v) + 1); q.push(w); } }
  const inward = new Set(); roads.edges.forEach((e, i) => { if (!e.dead) return; const da = depth.get(e.a) ?? 0, db = depth.get(e.b) ?? 0; if (db >= da) inward.add(i + ':false'); if (da >= db) inward.add(i + ':true'); });
  uCache.clear();
  return { ...roads, out, inward };
}

// A road's direction measured ~35 m along it (from its start, or back from its end): the first 30 m of a road that
// wiggles at the junction made "straight on" read as a turn (the owner, Fox Lane)
function dirFrom(q, D = 35) { let acc = 0, k = 1; while (k < q.length - 1 && acc + dist(q[k - 1], q[k]) < D) { acc += dist(q[k - 1], q[k]); k++; } return bearing(q[0], q[k]); }
const turnOf = (inB, b) => Math.atan2(Math.sin(b - inB), Math.cos(b - inB));
const isRb = (st) => !!ow.g.edges[st.i].rb;
// the ways on from the end of step s, left to right: { steps: [{ i, rev }...], i / rev (the road it leaves on), turn
// (radians, + = right), name }. A roundabout is one junction (the owner: "the right turn is still taking me left, just
// around the roundabout"): its ways are its exits, each reached by riding round it, and its turn is the exit's real
// direction against the way in.
function waysOn(s) {
  const P = ptsOf(s), inB = dirFrom([...P].reverse()) + Math.PI, out = [];
  for (const o of (ow.g.out.get(endOf(s)) || []).filter((o) => o.i !== s.i)) {
    if (!isRb(o)) { out.push({ steps: [{ i: o.i, rev: o.rev }], i: o.i, rev: o.rev, turn: turnOf(inB, dirFrom(ptsOf(o))), name: ow.g.edges[o.i].name }); continue; }
    // round the roundabout, collecting its exits in order
    const via = [{ i: o.i, rev: o.rev }], seen = new Set([o.i]);
    let cur = o;
    for (let n = 0; n < 24; n++) {
      const j = endOf(cur), outs = (ow.g.out.get(j) || []).filter((q) => q.i !== cur.i);
      for (const x of outs) if (!isRb(x) && x.i !== s.i) out.push({ steps: [...via, { i: x.i, rev: x.rev }], i: x.i, rev: x.rev, turn: turnOf(inB, dirFrom(ptsOf(x))), name: ow.g.edges[x.i].name, rb: true });
      const nxt = outs.find((x) => isRb(x) && !seen.has(x.i));
      if (!nxt) break;
      via.push({ i: nxt.i, rev: nxt.rev }); seen.add(nxt.i); cur = nxt;
    }
  }
  // one way per road left on (a roundabout can reach the same exit twice)
  const uniq = new Map(); for (const w of out) { const k = w.i + ':' + w.rev; if (!uniq.has(k) || uniq.get(k).steps.length > w.steps.length) uniq.set(k, w); }
  // a roundabout's exits come round it from left to right (clockwise, UK), so their turns must rise in that order: an exit
  // more than half way round read as a sharp LEFT (atan2 wraps at 180 degrees) and sat first in the list (the owner
  // 2026-11-18: "you have to press left to go eventually right around a roundabout")
  const rbW = [...uniq.values()].filter((w) => w.rb).sort((x, y) => x.steps.length - y.steps.length);
  for (let n = 1; n < rbW.length; n++) while (rbW[n].turn < rbW[n - 1].turn) rbW[n].turn += 2 * Math.PI;
  return [...uniq.values()].sort((x, y) => x.turn - y.turn);
}
ow.debug.waysOn = (st) => waysOn(st);
if (typeof window !== 'undefined') window.__ow = ow; // (tests)
ow.debug.stagger = (st) => stagger(waysOn(st)); // (tests)
// does the path from step k follow way w?
const follows = (w, k) => w.steps.every((st, n) => ow.path[k + n] && ow.path[k + n].i === st.i && ow.path[k + n].rev === st.rev);
// The default way on (the owner: "longer stretches on main roads, keep going straight by default"): the same road if it
// carries on, else the straightest, favouring bigger roads, never a road ridden in the last few km
const RANK = { trunk: 6, primary: 6, secondary: 5, tertiary: 4, unclassified: 3, residential: 2, living_street: 1 };
const rankOf = (i) => (ow.g.edges[i].off ? 0 : RANK[String(ow.g.edges[i].hw).replace('_link', '')] || 2); // (paths and tracks: only by choice)
// a step's cost to the satnav: as its distances (navDistances: cycle routes count a little shorter, paths and tracks
// longer). bestWay must cost the ways on the same way, or between two lanes where the discount tips it the rider went
// round and round (Coalash / Copyholt Lane, 2026-11-18)
// (on a pre-plotted route, tracks and paths count much longer, as tools/openworld/rides.mjs plans them: the owner's routes are
// for road bikes; the satnav otherwise keeps its usual weights)
// Free satnav (no pre-plotted route), Quiet (default; Advanced setting rw.navPref 'direct' = the old way, 2026-11-22, the
// list's "better autorouting"): main roads count longer (trunk 2x, A roads 1.4x, B roads 1.15x), lanes a little shorter,
// cycle routes 0.88x, footways 2.5x, unpaved paths 2x, and leaving the road you're on at a junction costs 80 m (navStates). Tested offline on 40 trips
// between Bromsgrove places: trunk / A-road share 18% -> 3%, turns 13.7 -> 13.3 a trip, 3% longer (worst 21%)
const QUIET_W = { trunk: 2.0, trunk_link: 2.0, primary: 1.4, primary_link: 1.4, secondary: 1.15, secondary_link: 1.15, unclassified: 0.95, living_street: 1.1, service: 1.2 };
const quietNav = () => !ow.ride && store.get('navPref', 'quiet') !== 'direct';
const navW = (i) => { const x = ow.g.edges[i]; if (ow.ride?.offroad) return x.cyc ? 0.92 : 1; if (quietNav()) return (x.cyc ? 0.88 : 1) * (x.off ? (x.hw === 'footway' ? 2.5 : x.surf === 'paved' ? 1.15 : 2.0) : QUIET_W[x.hw] ?? 1); return (x.cyc ? 0.92 : 1) * (x.off ? (x.surf === 'paved' ? (ow.ride ? 1.4 : 1.15) : (ow.ride ? 4 : 1.6)) : 1); }; // (an `offroad` route, the Tardebigge towpath: paths at their own length, as rides.mjs)
const navLen = (st) => lenOf(st) * navW(st.i);
function bestWay(ways, from, nav = nav) {
  if (nav) { // satnav: the way with the least road left to the destination (shortest-path distances, setNav)
    let best = null, bc = Infinity;
    for (const w of ways) {
      // (a way onto the destination's own road costs only the distance along it to the spot, not to its far end)
      let c = 0, done = false, prev = from;
      for (const st of w.steps) { if (nav.after && prev) c += turnCost(prev.i, st.i, startOf(st)); prev = st; if (st.i === nav.road && ow.g.edges[st.i].oneway !== (st.rev ? 1 : -1)) { c += (st.rev ? nav.L - nav.along : nav.along) * navW(st.i); done = true; break; } c += navLen(st); }
      if (!done) c += nav.after ? nav.after(w.steps.at(-1)).c : nav.dist[endOf(w.steps.at(-1))];
      if (c < bc) { bc = c; best = w; }
    }
    if (best && Number.isFinite(bc)) return best;
  }
  const name = ow.g.edges[from.i].name, rk = rankOf(from.i), recent = new Set(ow.path.slice(-60).map((q) => q.i));
  let best = null, bs = Infinity;
  for (const w of ways) {
    // (+ roads on mapped cycle routes, build.mjs `cyc`: where riders ride, the owner's "check strava/heatmaps": Strava's
    // heatmap isn't open data; the National / regional Cycle Network routes in OSM are)
    const cyc = ow.g.edges[w.i].cyc ? (ow.g.edges[from.i].cyc ? 0.5 : 0.3) : 0;
    const sc = Math.abs(w.turn) * 1.2 - (name && w.name === name ? 0.9 : 0) - (rankOf(w.i) - rk) * 0.18 - (rankOf(w.i) >= 4 ? 0.2 : 0) - cyc + (recent.has(w.i) ? 4 : 0) + (ow.g.inward?.has(w.i + ':' + w.rev) ? 8 : 0); // (+8: not down a dead end by default)
    if (sc < bs) { bs = sc; best = w; }
  }
  return best;
}

// ---- following a pre-plotted ride's own line (2026-11-24, the owner: "the routing in open world needs a huge rethink ...
// 'give it some hints and it'll probably find the right way' isn't working"). Rides were waypoints every ~300 m with the
// satnav routing between them, and its idea of the best way often wasn't the line on the maps (measured over Stratford's
// 13 rides: 0.5 to 65 km of each more than 20 m off its line). Now the ride carries its line (rides.mjs `line`) and at
// every junction the way whose first 45 m lies on it, going forwards along it, is taken: nothing is routed. Only off the
// line (a way the rider chose) does the waypoint satnav steer back to it; distance left is measured along the line.
function lineOf(R) {
  if (!R?.line) return null;
  const P = []; let i = 0, la = 0, lo = 0; const s = R.line;
  const nx = () => { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < s.length) { la += nx(); lo += nx(); P.push([la / 1e5, lo / 1e5]); }
  if (P.length < 2) return null;
  const lat0 = P[0][0], lon0 = P[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), X = P.map(([a, b]) => [(b - lon0) * kx, (a - lat0) * 110540]), cum = [0];
  for (let k = 1; k < X.length; k++) cum.push(cum[k - 1] + Math.hypot(X[k][0] - X[k - 1][0], X[k][1] - X[k - 1][1]));
  // where the line doubles back on itself (a climb ridden up and back, a visit down a lane): the ride turns round there
  const turns = [];
  for (let k = 1; k < X.length - 1; k++) { const ax = X[k][0] - X[k - 1][0], ay = X[k][1] - X[k - 1][1], bx = X[k + 1][0] - X[k][0], by = X[k + 1][1] - X[k][1], c = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1); if (c < -0.94) turns.push(cum[k]); }
  return { X, cum, total: cum.at(-1), kx, lat0, lon0, turns };
}
// the nearest point of the line to (lat, lon), looking only between s0 and s1 metres along it: { d, s }
function lineProj(L, la, lo, s0, s1, first = 8) { // (first: the earliest stretch within this many metres wins over a closer one later, where the line passes the same road twice)
  const x = (lo - L.lon0) * L.kx, y = (la - L.lat0) * 110540, C = L.cum;
  let a = 1, b = C.length - 1; { let lo2 = 0, hi = C.length - 1; while (lo2 < hi) { const m = (lo2 + hi) >> 1; if (C[m] < s0) lo2 = m + 1; else hi = m; } a = Math.max(1, lo2); }
  let best = { d: Infinity, s: Math.max(0, s0) };
  for (let k = a; k < C.length && C[k - 1] <= s1; k++) {
    const [ax, ay] = L.X[k - 1], [bx, by] = L.X[k], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / ((vx * vx + vy * vy) || 1))), d = Math.hypot(x - ax - vx * t, y - ay - vy * t);
    if (d < best.d) best = { d, s: C[k - 1] + (C[k] - C[k - 1]) * t };
    if (first && best.d < first) { // (close enough here: take the best of this stretch, not a later pass)
      for (let k2 = k + 1; k2 < Math.min(C.length, k + 4); k2++) { const [ax2, ay2] = L.X[k2 - 1], [bx2, by2] = L.X[k2], vx2 = bx2 - ax2, vy2 = by2 - ay2, t2 = Math.max(0, Math.min(1, ((x - ax2) * vx2 + (y - ay2) * vy2) / ((vx2 * vx2 + vy2 * vy2) || 1))), d2 = Math.hypot(x - ax2 - vx2 * t2, y - ay2 - vy2 * t2); if (d2 < best.d) best = { d: d2, s: C[k2 - 1] + (C[k2] - C[k2 - 1]) * t2 }; }
      return best;
    }
  }
  return best;
}
// the way out of a junction that keeps to the line (or null: none does, off the line)
function lineWay(ways) {
  const L = ow.rl, s0 = ow.extS ?? 0; let best = null;
  for (const w of ways) {
    let acc = 0, n = 0, dev = 0, sEnd = s0, prev = null, gone = false;
    for (const st of w.steps) {
      for (const q of ptsOf(st)) {
        if (prev) acc += dist(prev, q); prev = q;
        if (acc < 3) continue;
        const r = lineProj(L, q[0], q[1], s0 - 15, s0 + acc + 120); dev += r.d; n++; sEnd = r.s;
        if (acc > 45) { gone = true; break; }
      }
      if (gone) break;
    }
    if (!n) continue;
    const m = dev / n;
    if (sEnd > s0 + 2 && m < 12 && (!best || m < best.m)) best = { w, m };
  }
  return best?.w || null;
}

// off the line (no way out of here keeps to it): the way that comes nearest the line a little further on, so the path
// works its way back to it locally (the waypoint satnav wandered off for kilometres from here)
function rejoinWay(ways) {
  const L = ow.rl, s0 = ow.extS ?? 0; let best = null;
  for (const w of ways) {
    let acc = 0, prev = null, bd = Infinity, bs = s0;
    for (const st of w.steps) { for (const q of ptsOf(st)) { if (prev) acc += dist(prev, q); prev = q; if (acc > 150) break; const r = lineProj(L, q[0], q[1], s0 - 30, s0 + 1500, 0); if (r.d < bd) { bd = r.d; bs = r.s; } } if (acc > 150) break; }
    const c = bd + Math.max(0, s0 - bs) * 0.5; // (nearest the line, not going back along it)
    if (!best || c < best.c) best = { w, c, bd };
  }
  return best?.w || null; // (measured: handing over to the waypoint satnav when far off made it worse, Battersea 0.5 -> 5 km off)
}

// cumulative raw length at the start of each step
function recum() { ow.cum = [0]; for (const s of ow.path) ow.cum.push(ow.cum.at(-1) + lenOf(s)); }
// on a pre-plotted route the path ahead steers for the NEXT waypoint once it has reached the current one's road
// (2026-11-21, the owner: "2 weird detours showing right away" on the close map: an imported route has a waypoint every
// 200 m, and the look-ahead past one looped round the block back to it); the satnav itself still moves on as the rider
// reaches each (satnav.js)
function navFor(t) {
  if (!ow.ride || t === ow.ride.next) return ow.nav;
  ow.navCache ||= new Map(); const key = (ow.ride.id || ow.ride.name) + ':' + t;
  if (!ow.navCache.has(key)) { const v = ow.ride.via[t], r = v && navDistances(v.lat, v.lon); ow.navCache.set(key, r ? { name: v.name, lat: v.lat, lon: v.lon, ...r } : null); }
  return ow.navCache.get(key) || ow.nav;
}
function extendTo(len) {
  let nav = ow.nav;
  if (ow.ride && ow.nav) {
    if (ow.extRide !== ow.ride || ow.path.length < (ow.extN || 0) || (ow.extT ?? -1) < ow.ride.next) { ow.extRide = ow.ride; ow.extT = ow.ride.next; }
    nav = navFor(ow.extT);
  }
  // (on a ride with a line: where the path planned so far ends, along the line; re-found if the path was cut back)
  const endPt = () => { const q = ptsOf(ow.path.at(-1)); return q.at(-1); };
  if (ow.rl) { if (ow.extRL !== ow.rl || ow.path.length < (ow.extN || 0) || ow.extS == null) { ow.extRL = ow.rl; const e = endPt(), h = ow.rlS ?? 0; ow.extS = lineProj(ow.rl, e[0], e[1], h - 300, h + 3000).s; } }
  while (ow.cum.at(-1) < len && ow.path.length < 5000) {
    const s = ow.path.at(-1), k = ow.path.length, ways = waysOn(s);
    // a ride's plan (rides.mjs seq): the next planned road, exactly: a turn round where it turns round, else the way
    // whose roads are the next ones planned (a roundabout's included). Nothing is guessed.
    if (ow.seq && !ow.picks.get(k)) {
      let q = s.q;
      if (q == null) { for (let m = ow.seqLast; m < Math.min(ow.seq.length, ow.seqLast + 600); m++) if (ow.seq[m].i === s.i && ow.seq[m].rev === s.rev) { q = m + 1; break; } } // (back on the plan after the rider's own way)
      if (q != null && q < ow.seq.length) {
        ow.seqLast = q; const want = ow.seq[q];
        if (want.i === s.i && want.rev !== s.rev) { const st = { i: s.i, rev: want.rev, u: true, q: q + 1 }; ow.path.push(st); ow.cum.push(ow.cum.at(-1) + lenOf(st)); continue; }
        const w = ways.find((x) => x.steps.every((st, j) => ow.seq[q + j] && ow.seq[q + j].i === st.i && ow.seq[q + j].rev === st.rev));
        if (w) { w.steps.forEach((st, j) => { ow.path.push({ i: st.i, rev: st.rev, q: q + j + 1 }); ow.cum.push(ow.cum.at(-1) + lenOf(st)); }); continue; }
      } else if (q != null && q >= ow.seq.length) { /* the plan's end: ride on as the world's default way does */ }
    }
    // the end of a dead end: turn round there (2026-11-17), back along the same road
    if (!ways.length) { if (s.u) break; const st = { i: s.i, rev: !s.rev, u: true }; ow.path.push(st); ow.cum.push(ow.cum.at(-1) + lenOf(st)); continue; }
    const pick = ow.picks.get(k);
    let lw = ow.rl && !pick ? lineWay(ways) : null;
    // (the line turns round just behind here, at a spot mid-road or this junction: turn round, and go on from the turn)
    if (ow.rl && !pick && !lw && !s.u) {
      const tu = ow.rl.turns.find((t) => t > ow.extS - 40 && t < ow.extS + 60);
      if (tu != null) { const st = { i: s.i, rev: !s.rev, u: true }; ow.path.push(st); ow.cum.push(ow.cum.at(-1) + lenOf(st)); const e = endPt(), r = lineProj(ow.rl, e[0], e[1], tu, tu + lenOf(st) + 200); ow.extS = r.d < 40 ? r.s : tu; continue; } // (the turn-round step runs back down the whole road: where its end is on the line's way back)
    }
    const nxt = (pick && ways.find((w) => w.i === pick.i && w.rev === pick.rev)) || lw || (ow.rl && !pick ? rejoinWay(ways) : null) || bestWay(ways, s, nav);
    let wl = 0; for (const st of nxt.steps) { ow.path.push({ i: st.i, rev: st.rev }); ow.cum.push(ow.cum.at(-1) + lenOf(st)); wl += lenOf(st); }
    if (ow.rl) {
      const e = endPt(); let r = lineProj(ow.rl, e[0], e[1], ow.extS - 20, ow.extS + wl + 200);
      if (r.d >= 30) { const r2 = lineProj(ow.rl, e[0], e[1], ow.extS - 50, ow.extS + 8000); if (r2.d < 15) r = r2; } // (back on the line further along, after the satnav brought the path back to it)
      if (r.d < 30) ow.extS = r.s;
    }
    if (ow.ride && nav && ow.extT < ow.ride.via.length - 1 && nxt.steps.some((st) => st.i === nav.road)) { ow.extT++; nav = navFor(ow.extT); }
  }
  ow.extN = ow.path.length;
}

// the part of polyline q from `a` metres along it
function tail(q, a) {
  if (!(a > 0)) return q;
  let acc = 0;
  for (let i = 1; i < q.length; i++) {
    const L = dist(q[i - 1], q[i]);
    if (acc + L >= a) { const t = (a - acc) / (L || 1), p = q[i - 1], n = q[i]; return [[p[0] + (n[0] - p[0]) * t, p[1] + (n[1] - p[1]) * t, p[2] + (n[2] - p[2]) * t], ...q.slice(i)]; }
    acc += L;
  }
  return q.slice(-2);
}
function makeRoute() {
  const pts = [...ow.prefix];
  ow.path.forEach((s, k) => { const q = k === 0 ? tail(ptsOf(s), ow.startAlong) : ptsOf(s); for (const p of k ? q.slice(1) : q) pts.push(p); });
  const gpx = `<gpx><trk><trkseg>${pts.map(([la, lo, h]) => `<trkpt lat="${la}" lon="${lo}"><ele>${h}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  // bridges and tunnels on the way: 'use my heights' corrections (as the route editor's): the file's shape over them
  // (a humpback bridge's hump, decks.mjs) between the ends, like the drawn road (world.js), not down into the cutting
  const spans = [];
  // (a bridge the route starts on or within 35 m of, after a jump or a turn round, gets no correction: 'level' ran
  // straight from a start measured out over the river, 7 m under Westminster Bridge's deck (London 2026-11-17); without
  // one, groundHeight's open-world branch takes the deck's own height)
  // (city worlds, London: none at all. A bridge in several pieces anchored each piece's offset 30 m past its ends, on the
  // next piece over the river: the rider sank 10 m across Tower Bridge. The open-world branch of groundHeight already
  // takes each piece's own deck height there; Bromsgrove keeps these corrections as they were)
  // (bridgeRuns, 2026-11-20: worlds whose bridges sit on their surveyed decks, build.mjs: the deck heights are right, so the
  // ride follows them as in the city worlds; the old span corrections re-anchored them to the ground 30 m off and stepped)
  const cityWorld = !!world.data?.flavour || !!world.data?.build?.bridgeRuns;
  ow.path.forEach((st, k) => { const e = ow.g.edges[st.i]; if (!cityWorld && (e.bridge || e.tunnel) && ow.cum[k] - ow.base >= 35) spans.push({ from: Math.max(0, ow.cum[k] - ow.base - 3) / 1000, to: (ow.cum[k + 1] - ow.base + 3) / 1000, [ow.cum[k] - ow.base < 35 ? 'level' : 'mine']: true, // ('my heights' needs 30 m of road before it to anchor to: at the start, straight)
       note: 'open world span: the file\'s deck shape (decks.mjs) between the ends' }); });
  const r = Route.fromGpx(gpx, route.name, spans.length ? spans : null, null, null, { ...route.opts, keepStubs: true, keepDense: true }); // (keepDense: a U-turn's arc, metres apart, keeps its shape)
  r.name = route.name; r.msg = route.msg;
  return r;
}
// ride metres <-> raw path metres (cleaning shortens corners a little)
const toRide = (raw) => raw * (route.fileScale || 1);

// swap in the route rebuilt from the path, keeping everything before ride metre `fromM`
// The clean road (the ridden road, cleanroad.js) runs only to the next junction with a choice (state.roadEnd), so a new
// choice changes nothing drawn (the owner: "the road ... swaps when pressing left or right"); beyond it the road layer
// (world.js, the same asphalt and markings) shows every way on. The layer's pieces under the clean road are hidden.
function tellRidden() { // (nothing is hidden or cut any more: the drawn roads are the road; kept as the hook)
  setRidden(new Set(), new Set());
  state.roadEnd = null;
  ow.riddenK = nextJunction()?.k ?? -1;
}
function rebuild(fromM) {
  const keep = state.dist;
  setRoute(makeRoute());
  tellRidden();
  state.dist = keep;
  const sv = state.survey;
  // the road is the same up to ~15 m before the junction (smoothing reaches that far): keep what's measured to there and
  // measure the new road at once (in Lite that's the terrain, off the main thread), so the clean road carries straight on
  if (sv?.raw) { const cut = Math.max(0, Math.floor((fromM - 15) / SURVEY_STEP)); if (sv.raw.length > cut) sv.raw.length = cut; if (sv.edge && sv.edge.length > cut) sv.edge.length = cut; }
  if (fromM > 0 && fromM < route.length) resurvey(Math.max(0, fromM - 15), Math.min(route.length, fromM + 400)).then(() => { cleanRoad.at = -1e9; });
  cleanRoad.at = -1e9; state.lineAt = -1e9;
  reindexWorld(fromM - 120);
}

// ---------- satnav (2026-11-16, the owner: "find a place during a ride, then the route will auto take you there") ----------
// One shortest-path search outwards from the destination over the whole network, backwards along every road it can be
// ridden on (one-way streets respected): ow.nav.dist[j] = metres from junction j to the destination. bestWay then takes,
// at every junction, the way with the least left; a different turn by hand just carries on from wherever that leads.
// The destination is a point on its nearest road: both ends of that road start the search with the distance along it.
const startOf = (s) => (s.rev ? ow.g.edges[s.i].b : ow.g.edges[s.i].a);
// a change of road at a real junction (3+ ways), for the quiet satnav: 80 m; along the same named road: nothing
function turnCost(i0, i1, j) {
  if (!quietNav() || i0 === i1) return 0;
  if (!ow.g.deg) { ow.g.deg = new Int32Array(ow.g.junctions.length); for (const e of ow.g.edges) { ow.g.deg[e.a]++; ow.g.deg[e.b]++; } }
  if (ow.g.deg[j] < 3) return 0;
  const a = ow.g.edges[i0].name, b = ow.g.edges[i1].name; return a && a === b ? 0 : 80;
}
// the quiet satnav's search: over road pieces ridden one way or the other (state i*2 + rev), so turns can cost; C = cost from
// the start of a piece to the destination, M = real metres along that best way (the panel shows metres, not cost)
function navStates(best) {
  const E = ow.g.edges, nJ = ow.g.junctions.length, N = E.length * 2;
  if (!ow.g.len) ow.g.len = E.map((_, i) => lenOf({ i, rev: false }));
  if (!ow.g.endAt) { ow.g.endAt = Array.from({ length: nJ }, () => []); E.forEach((e, i) => { if (e.oneway !== -1) ow.g.endAt[e.b].push(i * 2); if (e.oneway !== 1) ow.g.endAt[e.a].push(i * 2 + 1); }); }
  const C = new Float64Array(N).fill(Infinity), M = new Float64Array(N).fill(Infinity), e0 = E[best.i], L0 = ow.g.len[best.i], w0 = navW(best.i);
  const heap = []; const push = (d, j) => { heap.push([d, j]); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  if (e0.oneway !== -1) { C[best.i * 2] = best.along * w0; M[best.i * 2] = best.along; push(C[best.i * 2], best.i * 2); }
  if (e0.oneway !== 1) { C[best.i * 2 + 1] = (L0 - best.along) * w0; M[best.i * 2 + 1] = L0 - best.along; push(C[best.i * 2 + 1], best.i * 2 + 1); }
  while (heap.length) {
    const [c, z] = pop(); if (c > C[z]) continue;
    const zi = z >> 1, sj = z & 1 ? E[zi].b : E[zi].a;
    for (const y of ow.g.endAt[sj]) { const yi = y >> 1; if (yi === zi) continue; const c2 = c + ow.g.len[yi] * navW(yi) + turnCost(yi, zi, sj); if (c2 < C[y]) { C[y] = c2; M[y] = M[z] + ow.g.len[yi]; push(c2, y); } }
  }
  // what's left after riding step s: the best way on from its end junction (its turn cost included)
  const after = (st) => { const j = endOf(st); let bc = Infinity, bm = Infinity; for (const o of ow.g.out.get(j) || []) { if (o.i === st.i) continue; const z = o.i * 2 + (o.rev ? 1 : 0), c = C[z] + turnCost(st.i, o.i, j); if (c < bc) { bc = c; bm = M[z]; } } return { c: bc, m: bm }; };
  // (per junction too, for the code that asks by junction)
  const dist = new Float64Array(nJ).fill(Infinity), metres = new Float64Array(nJ).fill(Infinity);
  for (const [j, outs] of ow.g.out) for (const o of outs) { const z = o.i * 2 + (o.rev ? 1 : 0); if (C[z] < dist[j]) { dist[j] = C[z]; metres[j] = M[z]; } }
  return { dist, metres, after };
}
function navDistances(lat, lon) {
  const E = ow.g.edges, nJ = ow.g.junctions.length;
  // the nearest road and how far along it the point is
  let best = null;
  E.forEach((e, i) => { if (e.bridge || e.tunnel || (ow.ride && !ow.ride.offroad && e.off)) return; let acc = 0; for (let k = 0; k < e.pts.length; k++) { if (k) acc += dist(e.pts[k - 1], e.pts[k]); const d = dist(e.pts[k], [lat, lon]); if (!best || d < best.d) best = { d, i, along: acc, pt: e.pts[k] }; } }); // (on a route: roads only, as rides.mjs snaps its waypoints)
  if (!best) return null;
  const e = E[best.i], L = lenOf({ i: best.i, rev: false });
  if (quietNav()) return { ...navStates(best), road: best.i, off: best.d, pt: best.pt, along: best.along, L };
  const D = new Float64Array(nJ).fill(Infinity);
  if (e.oneway !== -1) D[e.a] = Math.min(D[e.a], best.along * navW(best.i)); // (ride a -> b to reach it)
  if (e.oneway !== 1) D[e.b] = Math.min(D[e.b], (L - best.along) * navW(best.i));
  // backwards adjacency: for every way a road can be ridden from j0 to j1, j1 -> j0 with its length (paths and tracks
  // count longer: the satnav keeps to roads unless a path saves a lot)
  if (ow.g.back && ow.g.backRide !== (ow.ride ? (ow.ride.offroad ? 2 : 1) : 0)) ow.g.back = null; // (the weights differ on a route)
  if (!ow.g.back) { ow.g.backRide = ow.ride ? (ow.ride.offroad ? 2 : 1) : 0; ow.g.back = Array.from({ length: nJ }, () => []); E.forEach((x, i) => { const Lx = navLen({ i, rev: false }); if (x.oneway !== -1) ow.g.back[x.b].push([x.a, Lx]); if (x.oneway !== 1) ow.g.back[x.a].push([x.b, Lx]); }); }
  // Dijkstra with a small binary heap
  const heap = []; const push = (d, j) => { heap.push([d, j]); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  D.forEach((d, j) => { if (Number.isFinite(d)) push(d, j); });
  while (heap.length) { const [d, j] = pop(); if (d > D[j]) continue; for (const [k, L2] of ow.g.back[j]) if (d + L2 < D[k]) { D[k] = d + L2; push(D[k], k); } }
  return { dist: D, road: best.i, off: best.d, pt: best.pt, along: best.along, L }; // (pt: the spot on the road nearest the place: arriving there)
}
// where the rider is on the path: step index and raw metres along the path
function here() { const raw = state.dist / (route.fileScale || 1) + ow.base; let k = ow.cum.findIndex((c, n) => n + 1 < ow.cum.length && raw < ow.cum[n + 1]); if (k < 0) k = ow.path.length - 1; return { k, raw }; }
// re-plan everything after the step the rider is on (or the one after, if its end is too close to turn)
function replan() {
  const { k, raw } = here();
  let cut = k + 1; if (ow.cum[cut] - raw < 25 && cut < ow.path.length) cut++;
  for (const key of [...ow.picks.keys()]) if (key >= cut) ow.picks.delete(key);
  ow.path.length = cut; ow.cum.length = cut + 1;
  extendTo(ow.cum[cut] + AHEAD);
  rebuild(toRide(ow.cum[cut] - ow.base));
  draw(true);
}
// Jump (the owner 2026-11-17: "a jump feature, so the rider can move to anywhere they like ... drop closest to the picked
// spot"): the ride carries on from the rideable point nearest (lat, lon): the road there, starting at its junction
// nearest the spot, heading the way that leads past it; distance and time carry on (distBase), the survey is measured
// afresh and the camera cuts there. Returns the road's name (or null).
export function jumpTo(lat, lon, edge = null) { // (edge: start on that road piece, at its first point: the bridge ride test)
  if (!ow.on) return null;
  let best = null;
  if (edge != null && ow.g.edges[edge]) best = { d: 0, i: edge, k: 0 };
  else ow.g.edges.forEach((e, i) => { for (let k = 0; k < e.pts.length; k++) { const d = dist(e.pts[k], [lat, lon]); if (!best || d < best.d) best = { d, i, k }; } });
  if (!best) return null;
  const e = ow.g.edges[best.i], fromA = best.k <= e.pts.length / 2;
  // ride the road towards the spot from its nearer end, if that way is allowed; else from the other end
  let step = fromA && e.oneway !== -1 ? { i: best.i, rev: false } : !fromA && e.oneway !== 1 ? { i: best.i, rev: true } : e.oneway !== -1 ? { i: best.i, rev: false } : { i: best.i, rev: true };
  ow.path = [step]; ow.picks = new Map(); ow.shown = null; ow.prefix = [];
  // start a little before the spot along the road (so the first frames show it), not at the far junction
  const P = ptsOf(step); let along = 0, acc = 0, bd = Infinity; for (let k = 0; k < P.length; k++) { if (k) acc += dist(P[k - 1], P[k]); const d = dist(P[k], [lat, lon]); if (d < bd) { bd = d; along = acc; } }
  ow.startAlong = Math.max(0, Math.min(lenOf(step) - 5, along - 20)); ow.base = ow.startAlong;
  recum(); extendTo(ow.startAlong + AHEAD);
  const before = state.dist;
  setRoute(makeRoute());
  tellRidden();
  state.distBase += before; state.dist = 0; state.lean = 0;
  const sv = state.survey;
  for (const key of ['raw', 'diff', 'edge', 'flat', 'over', 'deck']) if (Array.isArray(sv[key])) sv[key] = [];
  sv.version = (sv.version || 0) + 1;
  resurvey(0, Math.min(route.length, 500)).then(() => { state.lineAt = -1e9; });
  reindexWorld(-1e9);
  state.lastCut = true; state.heading = route.heading(0); // (the camera cuts there, facing along the road)
  if (ow.nav) { const n = ow.nav; ow.nav = null; setNav(n); } // (a satnav destination stays: re-routed from here)
  draw(true);
  return e.name || e.hw;
}
ow.debug.extend = (L) => extendTo(L); ow.debug.pts = (s) => ptsOf(s); ow.debug.len = (s) => lenOf(s); ow.debug.jumpTo = (a, b, i) => jumpTo(a, b, i); // (tests)
export function setNav(place) {
  if (!ow.on) return false;
  const r = navDistances(place.lat, place.lon);
  if (!r) return false;
  ow.nav = { ...place, ...r, at: performance.now() };
  replan();
  return true;
}
// the surface under the wheels (off-road edges carry `surf`, build.mjs): 'road', 'paved', 'gravel', 'dirt', 'grass'
// how far from the middle to keep (model.js keepOffset): by the width of the road at ride metre d (paths: none)
const KEEP_HW = { trunk: 4, trunk_link: 3, primary: 3.75, primary_link: 3, secondary: 3.5, secondary_link: 3, tertiary: 3.25, tertiary_link: 2.75, unclassified: 2.5, residential: 2.75, living_street: 2.25 };
export function keepWidth(d) {
  if (!ow.on || !ow.path.length) return 1.0;
  const raw = d / (route.fileScale || 1) + ow.base; let k = ow.cum.findIndex((c, n) => n + 1 < ow.cum.length && raw < ow.cum[n + 1]); if (k < 0) k = ow.path.length - 1;
  const e = ow.g.edges[ow.path[k]?.i]; if (!e || e.off) return 0;
  const hw = e.w ? e.w / 2 : KEEP_HW[e.hw] || 2.5; return Math.max(0, Math.min(1.3, hw - 1.4)); // (e.w: a narrow bridge keeps the rider in the middle)
}
export function surfaceNow() { if (!ow.on || !ow.path.length) return 'road'; const { k } = here(), e = ow.g.edges[ow.path[k]?.i]; return e?.off ? e.surf || 'dirt' : 'road'; }
export function clearNav() { ow.ride = null; ow.rl = null; if (!ow.nav) return; ow.nav = null; if (ow.on) replan(); }
// a pre-plotted route's progress (2026-11-20, the owner: "the elevation graph and map only show the current segment and not the
// whole ride"): { R, total, done } in metres, from what's left to the next stop plus the legs after it (hud.js draws the
// route's own outline and profile with it)
export function rideProgress() {
  const R = ow.on && ow.ride; if (!R) return null;
  const s = navStatus(); if (!s) return null;
  if (ow.rl) { // (along the line: where the rider is on it; held while off it)
    const p = route.at(state.dist), h = ow.rlS ?? 0, r = lineProj(ow.rl, p.lat, p.lon, h - 100, h + 500);
    if (r.d < 40) ow.rlS = r.s;
    return { R, total: ow.rl.total, done: Math.max(0, Math.min(ow.rl.total, ow.rlS ?? 0)) };
  }
  const total = R.km * 1000, rest = (R.legKm || []).slice(R.next).reduce((t, x) => t + x * 1000, 0);
  return { R, total, done: Math.max(0, Math.min(total, total - (s.left + rest))) };
}
// for the panel: metres left, whether turning round would be quicker, arrived
export function navStatus() {
  if (!ow.nav || !ow.on) return null;
  const { k, raw } = here(), s = ow.path[k];
  const nv = ow.nav, back = { i: s.i, rev: !s.rev };
  const ahead = (ow.cum[k + 1] - raw) + (nv.after ? nv.after(s).c : nv.dist[endOf(s)]);
  const startJ = s.rev ? ow.g.edges[s.i].b : ow.g.edges[s.i].a, backOK = ow.g.edges[s.i].oneway ? false : true;
  const behind = (raw - ow.cum[k]) + (nv.after ? nv.after(back).c : nv.dist[startJ]);
  const aheadM = nv.after ? (ow.cum[k + 1] - raw) + nv.after(s).m : ahead; // (the quiet satnav: real metres for the panel)
  const p = route.at(state.dist), near = dist([p.lat, p.lon], [ow.nav.pt[0], ow.nav.pt[1]]);
  let left = aheadM;
  if (s.i === ow.nav.road) left = Math.min(left, near);
  // arrived: within 30 m, or came within 60 m and is now going away again (a waypoint clipped at a corner, 2026-11-18)
  ow.nav.minNear = Math.min(ow.nav.minNear ?? Infinity, near);
  const passed = ow.nav.minNear < 60 && near > ow.nav.minNear + 25;
  // (turning round only means something once well along this road: just past a junction, "behind" is only another way on)
  return { name: ow.nav.name, left: Number.isFinite(left) ? left : near, turn: !ow.ride && backOK && raw - ow.cum[k] > 40 && behind + 150 < ahead, arrived: near < 30 || passed }; /* (turn: not on a pre-plotted route, which loops back past places by design, the owner 2026-11-20) */
}

// at Load scenery, once the world file (with its roads) is in
export function startOpenWorld(start = null) {
  ow.on = false; state.keepWidth = null; // (other routes: 1 m from the middle, model.js keepOffset)
  if (!route?.opts?.open || !world.data?.roads) return false;
  ow.forData = world.data;
  ow.g = graph(world.data.roads);
  ow.picks = new Map(); ow.shown = null; ow.nav = null; ow.g.back = null;
  // the card's route starts at the area's start junction: begin on its first road
  // the card's GPX (build.mjs) is the start junction's first road, then always the straightest way on: the same walk,
  // so the rebuilt route matches it and what's been measured / built along it so far stays
  // a chosen start (setup.js openStart): the nearest junction with a way out
  let j0 = ow.g.start ?? 0;
  if (start) { let bd = Infinity; ow.g.junctions.forEach((ll, j) => { if (!ow.g.out.has(j)) return; const d = dist(ll, [start.lat, start.lon]); if (d < bd) { bd = d; j0 = j; } }); }
  // a pre-plotted route (setup.js openStart, tools/openworld/rides.mjs): the satnav takes the rider through its waypoints
  // in turn (satnav.js moves it on at each); the first road is the one that leads towards the second waypoint
  ow.ride = null; ow.rl = null; ow.rlS = 0; ow.extS = null; ow.seq = null;
  let first = (ow.g.out.get(j0) || [])[0], startStep = null;
  if (start?.ride && start.ride.via?.length > 1) {
    const v = start.ride.via[1]; ow.ride = { ...start.ride, next: 1 }; ow.rl = lineOf(start.ride); ow.rlS = 0;
    // the plan itself (rides.mjs seq: the roads and directions in order), when it was made on this very world file
    ow.seq = start.ride.seq && start.ride.worldAt === `${world.data.at}|${world.data.roads.edges.length}` ? start.ride.seq.map((v) => ({ i: Math.abs(v) - 1, rev: v < 0 })) : null; ow.seqLast = 0; /* (not London yet: its dual carriageways and one-way systems measured worse, 26 -> 44 km off over 14 rides, mostly 20-40 m beside the line) */ ow.extS = null; ow.rideDone = false; state.noStartArch = false; const n = navDistances(v.lat, v.lon); // (ride first: its weights)
    if (!n) ow.ride = null;
    if (n) {
      ow.nav = { name: v.name, lat: v.lat, lon: v.lon, ...n, at: performance.now() };
      // start AT the first waypoint (its road, part-way along, as rides.mjs plans it), facing the cheaper way to the next:
      // starting at the nearest junction set off the wrong way and looped back (+0.8 km on Shakespeare's Stratford)
      const v0 = start.ride.via[0]; let sp = null;
      ow.g.edges.forEach((e, i) => { if (e.off || e.bridge || e.tunnel) return; let acc = 0; for (let k = 0; k < e.pts.length; k++) { if (k) acc += dist(e.pts[k - 1], e.pts[k]); const d = dist(e.pts[k], [v0.lat, v0.lon]); if (!sp || d < sp.d) sp = { d, i, along: acc }; } });
      // (a ride with a line: start on the road under the line's start, the way the line goes (a dual carriageway's other
      // side, or a one-way street, set off the wrong way: London's King's Cross ride, 2026-11-24))
      if (ow.seq) { const f = ow.seq[0]; startStep = { st: { i: f.i, rev: f.rev, q: 1 }, c: 0, along: start.ride.startAlong || 0 }; }
      if (!startStep && ow.rl) {
        const L0 = ow.rl, q0 = [L0.lat0, L0.lon0]; let k1 = 1; while (k1 < L0.X.length - 1 && L0.cum[k1] < 20) k1++;
        const lx = L0.X[k1][0] - L0.X[0][0], ly = L0.X[k1][1] - L0.X[0][1], ll = Math.hypot(lx, ly) || 1; let bestS = null;
        ow.g.edges.forEach((e, i) => { if (e.bridge || e.tunnel || (!ow.ride.offroad && e.off)) return; let acc = 0; for (let k = 0; k < e.pts.length; k++) { if (k) acc += dist(e.pts[k - 1], e.pts[k]); const d = dist(e.pts[k], q0); if (d > 25) continue;
          const a2 = e.pts[Math.max(0, k - 1)], b2 = e.pts[Math.min(e.pts.length - 1, k + 1)], ex = (b2[1] - a2[1]) * L0.kx, ey = (b2[0] - a2[0]) * 110540, el = Math.hypot(ex, ey) || 1, c = (ex * lx + ey * ly) / (el * ll);
          for (const rev of [false, true]) { if (e.oneway === (rev ? 1 : -1)) continue; const cc = rev ? -c : c; if (cc < 0.5) continue;
            // (and still on the line 30 m on along it: a road crossing the start the same way isn't the start, the towpath under it is)
            let a3 = 0, q3 = e.pts[k]; for (let m = k; rev ? m > 0 : m < e.pts.length - 1; m += rev ? -1 : 1) { const nq = e.pts[m + (rev ? -1 : 1)]; a3 += dist(q3, nq); q3 = nq; if (a3 >= 30) break; }
            const d30 = lineProj(L0, q3[0], q3[1], 0, 200, 0).d; if (d30 > 12) continue;
            const sc = d + d30 * 2 + (1 - cc) * 30; if (!bestS || sc < bestS.sc) bestS = { sc, i, rev, along: acc }; } } });
        if (bestS) { const Lb = lenOf({ i: bestS.i, rev: false }); startStep = { st: { i: bestS.i, rev: bestS.rev }, c: 0, along: bestS.rev ? Lb - bestS.along : bestS.along }; }
      }
      if (!startStep && sp && sp.d < 60) {
        const e = ow.g.edges[sp.i], L = lenOf({ i: sp.i, rev: false }), w = navW(sp.i), opts = [];
        if (e.oneway !== -1) opts.push({ st: { i: sp.i, rev: false }, c: (L - sp.along) * w + n.dist[e.b], along: sp.along });
        if (e.oneway !== 1) opts.push({ st: { i: sp.i, rev: true }, c: sp.along * w + n.dist[e.a], along: L - sp.along });
        opts.sort((a, b) => a.c - b.c);
        // (a ride with a line sets off along it: the way whose point 30 m on is further along the line)
        if (ow.rl && opts.length > 1) {
          const at = (o) => { let acc = 0, prev = null; for (const q of o.st.rev ? [...e.pts].reverse() : e.pts) { if (prev) acc += dist(prev, q); prev = q; if (acc >= Math.min(L, (o.st.rev ? L - sp.along : sp.along) + 30)) return lineProj(ow.rl, q[0], q[1], 0, 400).s; } return 0; };
          opts.sort((a, b) => at(b) - at(a));
        }
        if (opts.length && Number.isFinite(opts[0].c)) startStep = opts[0];
      }
      if (!startStep) { let bc = Infinity; for (const o of ow.g.out.get(j0) || []) { const c = navLen(o) + n.dist[endOf(o)]; if (c < bc) { bc = c; first = o; } } }
    }
  }
  if (startStep) { ow.path = [startStep.st]; ow.prefix = []; ow.startAlong = Math.max(0, Math.min(lenOf(startStep.st) - 5, startStep.along)); ow.base = ow.startAlong; }
  else {
  if (!first) return false;
  ow.path = [first]; ow.base = 0; ow.prefix = []; ow.startAlong = 0;
  }
  recum(); extendTo(AHEAD);
  const oldLen = route.length;
  rebuild(0); // (the default way on no longer matches the card's walk: measure it all; main.js starts the survey after this)
  ow.on = true; state.keepWidth = keepWidth;
  toast(ow.ride ? `🧭 ${ow.ride.name}: the satnav takes you round (${ow.ride.km} km). First stop: ${ow.ride.via[1].name}.` : '🗺 Open world: ride where you like. Coming up to a junction, choose the way with ← / → (or tap).', 9000);
  return true;
}

// the next junction ahead with a real choice: { k (step index after it), atM (ride metres), ways }
function nextJunction() {
  const raw = state.dist / (route.fileScale || 1) + ow.base;
  for (let k = 1; k < ow.path.length; k++) {
    if (ow.cum[k] < raw - 5) continue;
    if (ow.cum[k] - raw > SHOW_AT + 200) return null;
    if (isRb(ow.path[k - 1])) continue; // (on a roundabout: its exit was chosen at the way in)
    const ways = waysOn(ow.path[k - 1]);
    if (ways.length >= 2) return { k, atM: toRide(ow.cum[k] - ow.base), ways: stagger(ways) };
  }
  return null;
}

// a staggered crossroads (the owner 2026-11-17: "road options left and right here but I only get left and straight on until
// I pass the 1st one"): when the way straight on reaches another junction within 70 m, that junction's ways are offered
// now too (reached through it), instead of the straight-on way itself; their turns count from the way in
function stagger(ways, depth = 0, used = 0) {
  // (every way, not just straight on, the owner 2026-11-17: the 12 m link from Sugarbrook Lane down to the towpath reached its
  // left / right choice too late to take it: within 15 m a choice is refused)
  if (depth > 2 || ways.some((w) => w.rb)) return ways;
  const out = [];
  for (const w of ways) {
    const L = w.steps.reduce((t, st) => t + lenOf(st), 0), next = used + L <= 70 ? waysOn(w.steps.at(-1)) : [];
    if (next.length < 2 || next.some((x) => x.rb)) { out.push(w); continue; }
    for (const x of stagger(next.map((x) => ({ ...x, turn: w.turn + x.turn })), depth + 1, used + L)) out.push({ ...x, steps: [...w.steps, ...x.steps] });
  }
  // one per road left on (the same far road can be reached two ways round a short loop: keep the shorter)
  const uniq = new Map(); for (const w of out) { const k = w.i + ':' + w.rev; if (!uniq.has(k) || uniq.get(k).steps.length > w.steps.length) uniq.set(k, w); }
  return [...uniq.values()].sort((x, y) => x.turn - y.turn);
}
export function choose(dir) { // -1 = one way more to the left, +1 = to the right, or a way's index
  const j = ow.shown;
  if (!j) return;
  ow.fullAt = performance.now();
  const cur = j.ways.findIndex((w) => follows(w, j.k));
  const n = typeof dir === 'object' ? dir.n : Math.max(0, Math.min(j.ways.length - 1, cur + dir));
  if (n === cur || n < 0) return;
  if (j.atM - state.dist < 15) return; // too late: already turning
  const w = j.ways[n];
  ow.picks.set(j.k, { i: w.i, rev: w.rev });
  for (const k of [...ow.picks.keys()]) if (k > j.k) ow.picks.delete(k);
  ow.path.length = j.k; ow.cum.length = j.k + 1;
  for (const st of w.steps) { ow.path.push({ i: st.i, rev: st.rev }); ow.cum.push(ow.cum.at(-1) + lenOf(st)); }
  extendTo(ow.cum[j.k] + AHEAD);
  rebuild(j.atM);
  draw(true);
}

const ARROWS = (t) => (t < -2.2 ? '⮌' : t < -0.9 ? '⬅' : t < -0.3 ? '⬉' : t <= 0.3 ? '⬆' : t <= 0.9 ? '⬈' : t <= 2.2 ? '➡' : '⮎');
// The junction sign (the owner 2026-11-15: "a neon glass style flashing sign on the turn ... showing which way we're
// going", road names above the arrows; then "it's in the air where you can't see it ... laying down on the road"):
// painted on the road from 32 m to 8 m before the junction, across the clean road, stretched along it like real road
// markings (the low camera squashes it back), an arrow per way on, pointing the way the road goes, the chosen one lit
// and pulsing; ↑ / ← / → change it. Phones and tablets also get the panel (#ow-choice) to tap.
const NEON = '#ff3d9a';
function signCanvas(j) {
  const cur = ow.path[j.k], n = j.ways.length, W = 512, H = 1024, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  rr(14, 14, W - 28, H - 28, 40); g.fillStyle = 'rgba(14,18,34,0.55)'; g.fill(); // smoked glass
  g.save(); g.shadowColor = NEON; g.shadowBlur = 30; g.lineWidth = 12; g.strokeStyle = NEON; g.stroke(); g.restore();
  const col = (W - 50) / n;
  j.ways.forEach((w, i) => {
    const on = w.i === cur.i && w.rev === cur.rev, cx = 25 + col * (i + 0.5);
    // the name, near the far end (seen above the arrow)
    let name = w.name || (Math.abs(w.turn) < 0.3 ? 'Straight on' : w.turn < 0 ? 'Left' : 'Right');
    const fs = n > 2 ? 34 : 44;
    g.font = `800 ${fs}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const words = name.split(' '), lines = [];
    for (const wd of words) { const last = lines.at(-1); if (last && g.measureText(last + ' ' + wd).width < col - 16) lines[lines.length - 1] = last + ' ' + wd; else lines.push(wd); }
    lines.slice(0, 3).forEach((ln, k) => {
      while (g.measureText(ln).width > col - 12 && ln.length > 3) ln = ln.slice(0, -2) + '…';
      g.save(); g.fillStyle = on ? '#ffffff' : 'rgba(225,230,245,0.6)'; if (on) { g.shadowColor = NEON; g.shadowBlur = 18; }
      g.fillText(ln, cx, 120 + k * (fs + 8)); g.restore();
    });
    // the arrow, turned the way the road goes
    g.save(); g.translate(cx, 640); g.rotate(Math.max(-2.6, Math.min(2.6, w.turn))); g.scale(Math.min(1.5, col / 150), 1.6);
    g.beginPath(); g.moveTo(0, -150); g.lineTo(62, -60); g.lineTo(24, -60); g.lineTo(24, 150); g.lineTo(-24, 150); g.lineTo(-24, -60); g.lineTo(-62, -60); g.closePath();
    if (on) { g.shadowColor = NEON; g.shadowBlur = 40; g.fillStyle = '#ff6fbc'; g.fill(); g.shadowBlur = 0; g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke(); }
    else { g.fillStyle = 'rgba(210,216,232,0.25)'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(225,230,245,0.5)'; g.stroke(); }
    g.restore();
  });
  return cv;
}
function drawSign(j, force) {
  if (!viewer) return;
  const remove = () => { if (ow.sign) { viewer.scene.primitives.remove(ow.sign); ow.sign = null; } ow.signKey = null; ow.signMat = null; };
  if (!j) { remove(); return; }
  const cur = ow.path[j.k], key = `${j.k}:${cur.i}:${cur.rev}:${Math.round(j.atM)}`;
  if (!force && key === ow.signKey) return;
  remove();
  ow.signKey = key;
  const half = Math.max(1.5, (cleanRoad.width || 4) / 2 - 0.35), d0 = Math.max(0, j.atM - 32), d1 = Math.max(d0 + 4, j.atM - 8), N = 8;
  const pos = [], st = [], nor = [], idx = [];
  for (let k = 0; k <= N; k++) {
    const d = d0 + ((d1 - d0) * k) / N, p = route.at(d), h = (Number.isFinite(groundHeight(d)) ? groundHeight(d) : 0) + 0.1, t = route.tangent(d);
    const ex = Math.cos(t), ny = -Math.sin(t), kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
    for (const side of [-1, 1]) {
      const c = C.Cartesian3.fromDegrees(p.lon + (ex * side * half) / kx, p.lat + (ny * side * half) / 110540, h), up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(c, new C.Cartesian3());
      pos.push(c.x, c.y, c.z); nor.push(up.x, up.y, up.z); st.push(side < 0 ? 0 : 1, k / N);
    }
    if (k) { const b = (k - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const geom = new C.Geometry({ attributes: {
    position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
    normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nor) }),
    st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }) },
    indices: new Uint16Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
  const material = C.Material.fromType('Image', { image: signCanvas(j), color: new C.Color(1, 1, 1, 1) });
  ow.signMat = material;
  ow.sign = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: geom }), asynchronous: false, allowPicking: false, compressVertices: false, shadows: C.ShadowMode.DISABLED,
    appearance: new C.MaterialAppearance({ material, flat: true, translucent: true, closed: false, faceForward: true, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, renderState: { polygonOffset: { enabled: true, factor: -2, units: -40 }, depthMask: false, cull: { enabled: false } } }) }));
}
const touch = () => matchMedia('(pointer: coarse)').matches;

// The junction card (2026-11-18, replaces the strip of arrows; the owner: "the arrows point in all random directions ... the
// turn mechanism is really difficult and needs a rethink"). A little map of the junction as it really is, drawn from the
// roads themselves like a car satnav: the road you're on comes in from the bottom, every way on is drawn along its own
// first ~40 m (round the roundabout and on, for a roundabout's exits), the one you'll take bright with an arrowhead, the
// others grey, roads you can't go down (one-way the other way) grey and dashed with a no-entry sign. Beside it the road
// you'll be on and the distance. ← / → (or tapping a road on the little map) changes it; ↑ = the straightest.
// Minor junctions (carrying straight on along the same road, past side roads no bigger than yours) get a small faint
// card only; the full card is for turns, roundabouts, a road changing, a bigger road joining, or a choice you made.
// Pressing ← / → before a card shows picks for the next junction within 380 m (it then shows from there).
const MINOR_R = 3; // (a way onto an unclassified road or bigger counts as a real choice)
function wayLine(w) { // the way's points from the junction, up to ~40 m into its last road (max 150 m)
  const pts = []; let acc = 0;
  const lens = w.steps.map(lenOf), lim = Math.min(150, lens.slice(0, -1).reduce((t, x) => t + x, 0) + (w.rb ? 25 : 40)); // (roundabouts: shorter, so the ring itself shows bigger)
  for (const st of w.steps) { const q = ptsOf(st); for (let k = pts.length ? 1 : 0; k < q.length; k++) { if (pts.length) acc += dist(pts.at(-1), q[k]); pts.push(q[k]); if (acc > lim) return pts; } }
  return pts;
}
function diagram(j, curW, minor) {
  const inStep = ow.path[j.k - 1], P = ptsOf(inStep), J = P.at(-1), K = kx(J[0]);
  const inB = dirFrom([...P].reverse()) + Math.PI, c = Math.cos(inB), sn = Math.sin(inB);
  const loc = (q) => { const n = (q[0] - J[0]) * 110540, e = (q[1] - J[1]) * K; return [e * c - n * sn, -(n * c + e * sn)]; }; // (screen x right, y down; travel = up)
  const lines = j.ways.map((w) => wayLine(w).map(loc));
  // the road in: its last 40 m
  const back = []; { let acc = 0; for (let k = P.length - 1; k >= 0; k--) { if (back.length) acc += dist(P[k + 1], P[k]); back.push(loc(P[k])); if (acc > 40) break; } }
  // roads at this junction you can't go down (one-way towards you), not the road in
  const jn = endOf(inStep), noEntry = [];
  ow.g.edges.forEach((e, i) => { if (i === inStep.i) return; if (e.a === jn && e.oneway === -1) noEntry.push(e.pts); else if (e.b === jn && e.oneway === 1) noEntry.push([...e.pts].reverse()); });
  const ne = noEntry.map((q) => { const out = [q[0]]; let acc = 0; for (let k = 1; k < q.length && acc < 30; k++) { acc += dist(q[k - 1], q[k]); out.push(q[k]); } return out.map(loc); });
  let ext = 25; for (const L of [...lines, back, ...ne]) for (const [x, y] of L) ext = Math.max(ext, Math.hypot(x, y));
  const S = 46 / ext, f = (L) => L.map(([x, y]) => `${(x * S).toFixed(1)},${(y * S + 8).toFixed(1)}`).join(' ');
  const cur = j.ways.indexOf(curW);
  let svg = `<svg class="ow-map" viewBox="-60 -60 120 120"><circle r="58" class="ow-disc"/>`;
  for (const L of ow.ride ? [] : ne) { if (L.length < 2) continue; const [x, y] = L.at(-1); svg += `<polyline points="${f(L)}" class="ow-noentry"/><g transform="translate(${(x * S).toFixed(1)},${(y * S + 8).toFixed(1)})"><circle r="5.5" class="ow-ne-c"/><rect x="-3.4" y="-1.1" width="6.8" height="2.2" fill="#fff"/></g>`; }
  svg += `<polyline points="${f(back)}" class="ow-in"/>`;
  if (!ow.ride) lines.forEach((L, n) => { if (n !== cur) svg += `<polyline points="${f(L)}" class="ow-other"/>`; });
  if (lines[cur]) { const L = lines[cur]; svg += `<polyline points="${f([...back].reverse().concat(L))}" class="ow-go-case"/><polyline points="${f([...back].reverse().concat(L))}" class="ow-go"/>`;
    const [x1, y1] = L.at(-1), [x0, y0] = L.at(-2) || [0, 0], a = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    svg += `<g transform="translate(${(x1 * S).toFixed(1)},${(y1 * S + 8).toFixed(1)}) rotate(${a.toFixed(0)})"><path d="M7 0 L-5 -7 L-2 0 L-5 7 Z" class="ow-head-arrow"/></g>`; }
  if (!minor && !ow.ride) lines.forEach((L, n) => { if (n !== cur) svg += `<polyline points="${f(L)}" class="ow-hit" data-n="${n}"/>`; }); // (wide, invisible: tap a road)
  return svg + '</svg>';
}
function isMinor(j, curW) {
  if (ow.picks.has(j.k) || curW.rb) return false;
  let sI = 0; j.ways.forEach((x, k) => { if (Math.abs(x.turn) < Math.abs(j.ways[sI].turn)) sI = k; });
  if (j.ways[sI] !== curW || Math.abs(curW.turn) > 0.6) return false; // (turning)
  const inE = ow.g.edges[ow.path[j.k - 1].i];
  if (inE.name && curW.name && curW.name !== inE.name) return false; // (the road changes)
  const rIn = rankOf(ow.path[j.k - 1].i);
  return !j.ways.some((w) => w !== curW && rankOf(w.i) >= Math.max(MINOR_R, rIn)); // (nothing as big as this road joins)
}
function draw(force) {
  drawSign(null); // (the 3D sign is retired)
  const box = $('ow-choice');
  if (!box) return;
  const j = ow.shown;
  if (!j) { box.hidden = true; box.dataset.key = ''; return; }
  const curW = j.ways.find((w) => follows(w, j.k)) || j.ways[0], key = `${j.k}:${curW.i}:${curW.rev}`;
  const m = `${Math.max(0, Math.round((j.atM - state.dist) / 10) * 10)} m`;
  if (!force && box.dataset.key === key) { $('ow-dist').textContent = m; return; }
  box.dataset.key = key;
  box.hidden = false;
  const minor = isMinor(j, curW);
  box.classList.toggle('mini', minor);
  let sI = 0; j.ways.forEach((x, k) => { if (Math.abs(x.turn) < Math.abs(j.ways[sI].turn)) sI = k; });
  const t = curW === j.ways[sI] && Math.abs(curW.turn) < 0.6 ? 0 : curW.turn;
  // (on a pre-plotted route: a card only where the route turns, and only its own way drawn; the owner 2026-11-21: "not show
  // the turns we're not going to take")
  if (ow.ride && (minor || (t === 0 && !curW.rb))) { box.hidden = true; return; }
  const what = curW.rb ? `${['1st', '2nd', '3rd', '4th', '5th', '6th'][j.ways.filter((w) => w.rb).indexOf(curW)] || 'next'} exit` : t === 0 ? 'Straight on' : Math.abs(t) > 2.3 ? (t < 0 ? 'Sharp left' : 'Sharp right') : Math.abs(t) < 1.1 ? (t < 0 ? 'Bear left' : 'Bear right') : t < 0 ? 'Turn left' : 'Turn right';
  box.innerHTML = `${diagram(j, curW, minor)}<div class="ow-txt"><div class="ow-what">${what}</div><div class="ow-road"></div><div class="ow-head"><b id="ow-dist">${m}</b>${j.ways.length > 1 && !ow.ride ? `<span class="ow-keys">${ow.nav ? '🧭 · ' : ''}← → ${j.ways.length} ways</span>` : ''}</div></div>`;
  box.querySelector('.ow-road').textContent = curW.name || (ow.g.edges[curW.i].off ? 'path' : '');
  box.querySelectorAll('.ow-hit').forEach((el) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); choose({ n: +el.dataset.n }); }));
}

// Turn round anywhere (the owner 2026-11-15): the road the rider is on, the other way, from where they are. A new route
// (the road from its far junction, back past the rider, then on as usual); distance carries on through distBase, as at
// the end of a normal route (turnaround.js). One-way streets too: a rider can always turn round.
export function turnRound() {
  if (!ow.on) return;
  const fs = route.fileScale || 1, raw = state.dist / fs + ow.base;
  let k = ow.cum.findIndex((c, n) => n + 1 < ow.cum.length && raw < ow.cum[n + 1]);
  if (k < 0) k = ow.path.length - 1;
  const s = ow.path[k], back = { i: s.i, rev: !s.rev }, Lb = lenOf(back), atBack = Math.max(0, Math.min(Lb, Lb - (raw - ow.cum[k])));
  // a U-turn (the owner 2026-11-15: "a smooth U turn"): a half circle across the road to the right (UK), then easing back
  // onto the road the other way 15 m on; the bike slows to turning speed
  // fitted to the road: drift 1.2 m left over 8 m, a half circle to the right just inside the far edge (radius from the
  // road's width, at least 2 m), then ease back to the middle (a wider circle ran off a lane onto the verge)
  const HW = { trunk: 4, primary: 3.75, secondary: 3.5, tertiary: 3.25, unclassified: 2.5, residential: 2.75, living_street: 2.25 };
  const hw = HW[String(ow.g.edges[back.i].hw).replace('_link', '')] || 2.5, R = Math.max(2, (hw - 0.5 + 1.2) / 2 + 0.3);
  const p = route.at(state.dist), h = route.tangent(state.dist), kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const fwd = [Math.sin(h), Math.cos(h)], right = [Math.cos(h), -Math.sin(h)];
  const q0 = tail(ptsOf(back), atBack)[0], ele = q0[2];
  const at = (f, r) => [p.lat + (fwd[1] * f + right[1] * r) / 110540, p.lon + (fwd[0] * f + right[0] * r) / kx, ele];
  const prefix = [];
  for (let n = 0; n <= 8; n++) prefix.push(at(n, -1.2 * (1 - Math.cos((n / 8) * Math.PI)) / 2)); // the drift left
  for (let n = 1; n <= 16; n++) { const th = (n / 16) * Math.PI; prefix.push(at(8 + R * Math.sin(th), -1.2 + R * (1 - Math.cos(th)))); }
  const atQ = Math.min(Lb, atBack + 15), Q = tail(ptsOf(back), atQ)[0], end = prefix[prefix.length - 1];
  for (let n = 1; n < 8; n++) { const t = n / 8; prefix.push([end[0] + (Q[0] - end[0]) * t, end[1] + (Q[1] - end[1]) * t, ele]); } // (dense, so it keeps its line)
  let plen = 0; for (let n = 1; n < prefix.length; n++) plen += dist(prefix[n - 1], prefix[n]); plen += dist(prefix[prefix.length - 1], Q);
  ow.path = [back]; ow.picks = new Map(); ow.shown = null; ow.prefix = prefix; ow.startAlong = atQ; ow.base = atQ - plen;
  recum(); extendTo(atQ + AHEAD);
  const before = state.dist;
  setRoute(makeRoute());
  tellRidden();
  state.distBase += before;
  state.dist = 0;
  state.lean = 0;
  bike.v = Math.min(bike.v, 5); // (about 18 km/h through the turn)
  const sv = state.survey;
  for (const key of ['raw', 'diff', 'edge', 'flat', 'over', 'deck']) if (Array.isArray(sv[key])) sv[key] = [];
  sv.version = (sv.version || 0) + 1;
  resurvey(0, Math.min(route.length, 500)).then(() => { state.lineAt = -1e9; });
  draw(true);
}

// every frame from main.js
export function updateOpenWorld() {
  if (ow.signMat) ow.signMat.uniforms.color.alpha = 0.72 + 0.28 * Math.sin(performance.now() / 170);
  const ub = $('btn-uturn'); if (ub) ub.classList.toggle('hidden', !ow.on);
  if (route?.opts?.open && world.data?.roads && ow.forData !== world.data) { ow.forData = world.data; startOpenWorld(); }
  if (!route?.opts?.open && state.roadEnd != null) state.roadEnd = null;
  if (ow.on) { const j = nextJunction(); if ((j ? j.k : -1) !== ow.riddenK) tellRidden(); }
  if (!ow.on || !route?.opts?.open) { if (ow.shown) { ow.shown = null; draw(); } return; }
  // keep ~4 km of road ahead
  // keep ~4 km of road ahead (at most once every 2 s, and only if the path really grew: a runaway here rebuilt the route
  // every frame)
  if (route.length - state.dist < EXTEND_AT && performance.now() - (ow.extAt || 0) > 2000) {
    ow.extAt = performance.now();
    const from = route.length, before = ow.path.length;
    extendTo(ow.cum.at(-1) + AHEAD);
    if (ow.path.length > before) rebuild(from - 30);
  }
  const j = nextJunction();
  if (j && (j.atM - state.dist <= SHOW_AT || ow.early === j.k) && j.atM - state.dist > -5) { if (!ow.shown || ow.shown.k !== j.k) { ow.shown = j; draw(true); } else { ow.shown = j; draw(); } }
  else if (ow.shown) { ow.shown = null; draw(); }
}

export function initOpenWorld() {
  $('btn-uturn')?.addEventListener('click', () => turnRound());
  document.addEventListener('keydown', (e) => {
    if (ow.on && (e.key === 'u' || e.key === 'U') && !e.target.closest?.('input, textarea, select, dialog[open]')) { turnRound(); e.preventDefault(); return; }
    if (!ow.on || e.target.closest?.('input, textarea, select, dialog[open]')) return;
    if (document.body.classList.contains('editing')) return;
    if (!ow.shown && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { const j = nextJunction(); if (j && j.atM - state.dist > 15) { ow.early = j.k; ow.shown = j; draw(true); } }
    if (!ow.shown) return;
    if (e.key === 'ArrowUp') { const w = ow.shown.ways; let n = 0; w.forEach((x, k) => { if (Math.abs(x.turn) < Math.abs(w[n].turn)) n = k; }); choose({ n }); e.preventDefault(); e.stopImmediatePropagation(); } // (the simulator's ↑ waits while a sign is up)
    else if (e.key === 'ArrowLeft') { choose(-1); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'ArrowRight') { choose(1); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}
