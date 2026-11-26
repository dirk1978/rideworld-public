// GPX route: parsing, distance along route, interpolated position, smoothed gradient and heading.

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return Math.atan2(y, x); // radians, clockwise from north
}

// Routing services and GPS traces leave artefacts that look awful when you ride them in 3D: short
// out-and-back stubs (a dart into a car park or onto a pavement and back) and sideways jogs.
// Resample every 2 m, cut out any stretch that comes back within 6 m of where it was 20-300 m earlier *by
// retracing its own steps* (a stub), then smooth the line (Gaussian, sigma 5 m) so corners become a natural
// riding line. Genuine loops that come back a different way (a flyover that passes under itself, a turning loop,
// a roundabout) are kept: route elevation can't tell a flyover from a junction, so shape is the safer test.
// True if the second half of a stretch runs back along the first half (an out-and-back), not round a loop
function isStub(seg) {
  const half = Math.floor(seg.length / 2);
  const out = seg.slice(0, half + 1), back = seg.slice(half);
  let near = 0;
  for (const b of back) if (out.some((a) => Math.hypot(a.x - b.x, a.y - b.y) < 8)) near++;
  return near >= back.length * 0.8;
}

// keepDense (routes brought back with Replace GPX): stretches whose source points are <= 6 m apart have already been
// smoothed once (RideWorld's export). Smoothing them normally again pulled tight bends in by up to 1.6 m, and not
// smoothing them at all kept RideWithGPS's rounding (6 decimals = ~10 cm steps), which made the rider rock side to
// side (the owner, 2026-10-16). So they get a non-shrinking smoothing instead, 2G - G(G): it removes small zigzags but
// keeps the shape of real bends. Sparse stretches (e.g. redrawn in RideWithGPS, with sharp corners) are smoothed as
// normal.
export function cleanPoints(points, { keepDense = false, keepStubs = false } = {}) {
  const o = points[0];
  const kx = 111320 * Math.cos(toRad(o.lat)), ky = 110540;
  const xy = points.map((p) => ({ x: (p.lon - o.lon) * kx, y: (p.lat - o.lat) * ky, ele: p.ele }));

  const STEP = 2;
  const res = [{ ...xy[0], seg: xy.length > 1 ? Math.hypot(xy[1].x - xy[0].x, xy[1].y - xy[0].y) : 0 }];
  let carry = 0;
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = STEP - carry;
    while (d <= seg) {
      const t = d / seg;
      res.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ele: a.ele + (b.ele - a.ele) * t, seg });
      d += STEP;
    }
    carry = seg - (d - STEP);
  }
  const last = xy[xy.length - 1];
  if (Math.hypot(last.x - res[res.length - 1].x, last.y - res[res.length - 1].y) > 0.5) res.push(last);

  const out = [];
  for (const q of res) {
    const n = out.length;
    // (keepStubs: an open world's route really does go in and back out of a road with a loop at its end, or round a
    // block; cutting it shortened the route behind the planner's back: endless rebuilds, 1 fps, "stuck in Breme Park")
    if (!keepStubs) for (let k = n - 10; k >= Math.max(0, n - 150); k--) {
      if (Math.hypot(out[k].x - q.x, out[k].y - q.y) < 6 && isStub(out.slice(k).concat(q))) { out.length = k + 1; break; }
    }
    out.push(q);
  }

  // Gaussian smoothing with a given sigma (metres)
  const smoother = (sigmaM) => {
    const sigma = sigmaM / STEP, half = Math.ceil(sigma * 2.5);
    const w = [...Array(half * 2 + 1)].map((_, i) => Math.exp(-((i - half) ** 2) / (2 * sigma * sigma)));
    return (arr) => arr.map((q, i) => {
      if (i === 0 || i === arr.length - 1) return q; // keep the exact start and finish
      let sx = 0, sy = 0, sw = 0;
      for (let j = -half; j <= half; j++) {
        const p = arr[i + j];
        if (!p) continue;
        sx += p.x * w[j + half]; sy += p.y * w[j + half]; sw += w[j + half];
      }
      return { x: sx / sw, y: sy / sw, ele: q.ele };
    });
  };
  const g = smoother(5)(out);
  let sm = g;
  if (keepDense) {
    // 1 where the source was sparse (normal smoothing), 0 where dense, eased over ~25 m. Dense stretches get
    // 2G - G(G) with a narrow 2.5 m sigma: enough to iron out ~10 cm rounding, while city corners keep their shape
    // (with 5 m, Westminster's 90-degree turns came back up to 0.8 m off and the route 16 m shorter)
    const sparse = out.map((p) => (p.seg <= 6 ? 0 : 1));
    const reach = Math.ceil(12 / STEP);
    const amount = sparse.map((_, i) => {
      let s = 0, sw = 0;
      for (let j = -reach; j <= reach; j++) if (i + j >= 0 && i + j < sparse.length) { s += sparse[i + j]; sw++; }
      return Math.min(1, (s / sw) * 2);
    });
    const narrow = smoother(2.5), g1 = narrow(out), g2 = narrow(g1);
    sm = g.map((p, i) => {
      const f = amount[i], tx = 2 * g1[i].x - g2[i].x, ty = 2 * g1[i].y - g2[i].y;
      return { x: p.x * f + tx * (1 - f), y: p.y * f + ty * (1 - f), ele: p.ele };
    });
  }
  return sm.map((p) => ({ lat: o.lat + p.y / ky, lon: o.lon + p.x / kx, ele: p.ele }));
}

// Hand corrections stored with a suggested route (made in the route editor, or by hand): over a stretch
// { from, to } in km along the cleaned route, shift the line sideways { right } in metres (negative = left)
// and/or raise the rider { up } in metres (negative = lower). Eased in and out over 15 m so nothing kinks.
const EASE_M = 15;
export function easeWeight(dM, a) {
  const from = a.from * 1000, to = a.to * 1000;
  if (dM <= from - EASE_M || dM >= to + EASE_M) return 0;
  return dM < from ? (dM - (from - EASE_M)) / EASE_M : dM > to ? ((to + EASE_M) - dM) / EASE_M : 1;
}
// Straighten: { from, to, straight: true } replaces the line between those two points (km along the cleaned
// route) with a straight one, taking out kinks a routing service or drawing put in. Heights blend evenly between
// the two ends (the road survey then follows the real surface).
export function applyStraighten(pts, adjust) {
  const S = (adjust || []).filter((a) => a.straight).sort((a, b) => a.from - b.from);
  if (!S.length) return pts;
  const kx = 111320 * Math.cos(toRad(pts[0].lat)), ky = 110540;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i].lon - pts[i - 1].lon) * kx, (pts[i].lat - pts[i - 1].lat) * ky));
  const at = (d) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const a = pts[i - 1], b = pts[i], t = Math.max(0, Math.min(1, (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t };
  };
  const out = [];
  let i = 0;
  for (const s of S) {
    const from = Math.max(0, s.from * 1000), to = Math.min(cum[cum.length - 1], s.to * 1000);
    if (to - from < 2) continue;
    while (i < pts.length && cum[i] < from) out.push(pts[i++]);
    const A = at(from), B = at(to);
    const len = Math.hypot((B.lon - A.lon) * kx, (B.lat - A.lat) * ky), n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      // keepEle (Route Studio's): the old stretch's rise and fall at the same share of the way, not a straight ramp
      // (the owner 2026-11-14: Brighton's Marina dip went flat after smoothing)
      out.push({ lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (B.lon - A.lon) * t, ele: s.keepEle ? at(from + (to - from) * t).ele : A.ele + (B.ele - A.ele) * t });
    }
    while (i < pts.length && cum[i] <= to) i++;
  }
  while (i < pts.length) out.push(pts[i++]);
  return out;
}

export function applyAdjustments(pts, adjust) {
  if (!adjust?.length) return pts;
  const kx = 111320 * Math.cos(toRad(pts[0].lat)), ky = 110540;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i].lon - pts[i - 1].lon) * kx, (pts[i].lat - pts[i - 1].lat) * ky));
  return pts.map((p, i) => {
    let off = 0;
    for (const a of adjust) if (a.right) off += a.right * easeWeight(cum[i], a);
    if (!off) return p;
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
    const ex = (b.lon - a.lon) * kx, ny = (b.lat - a.lat) * ky, len = Math.hypot(ex, ny) || 1;
    // right of travel = (north, -east) rotated: (ny, -ex)
    return { ...p, lon: p.lon + ((ny / len) * off) / kx, lat: p.lat + ((-ex / len) * off) / ky };
  });
}

function trimTo(pts, finishKm) {
  if (!(finishKm > 0)) return pts;
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    if (d + seg >= finishKm * 1000) {
      const t = (finishKm * 1000 - d) / seg, a = pts[i - 1], b = pts[i];
      return [...pts.slice(0, i), { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t }];
    }
    d += seg;
  }
  return pts;
}

// Start the route later (a route correction): drop everything before startKm
function trimStart(pts, startKm) {
  if (!(startKm > 0)) return pts;
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    if (d + seg >= startKm * 1000) {
      const t = (startKm * 1000 - d) / seg, a = pts[i - 1], b = pts[i];
      return [{ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t }, ...pts.slice(i)];
    }
    d += seg;
  }
  return pts;
}

// Corrections apply in the order they were made, each to the result of the ones before: a straighten made after
// some sideways shifts straightens the shifted line (and those earlier shifts can't bend it again), while a shift
// made after a straighten moves the straight line. Runs of plain shifts are applied together.
// Road centring (the route editor's "Find the road", app/roadfinder.js): OpenStreetMap's line can sit several metres
// off the road in Google's imagery (Sa Calobra: 5-11 m in places). centre = { step, dx: [...], dy: [...] }: how far
// to slide the route east and north (m) at 0, step, 2*step... m along the cleaned route, blended in between and
// applied before the editor's own corrections. A slide keeps a hairpin's shape (moving each point sideways folded
// them up). The slide changes by at most 0.5 m per 10 m, so the line can't fold.
export function applyCentre(pts, centre) {
  const X = centre?.dx, Y = centre?.dy;
  if (!Array.isArray(X) || !Array.isArray(Y) || !X.length || !(centre.step > 0)) return pts;
  const kx = 111320 * Math.cos(toRad(pts[0].lat)), ky = 110540;
  const lerp = (A, d) => { const f = d / centre.step, i = Math.floor(f); if (i >= A.length - 1) return A[A.length - 1] || 0; if (i < 0) return A[0] || 0; return (A[i] || 0) + ((A[i + 1] || 0) - (A[i] || 0)) * (f - i); };
  let cum = 0;
  return pts.map((p, i) => {
    if (i) cum += Math.hypot((p.lon - pts[i - 1].lon) * kx, (p.lat - pts[i - 1].lat) * ky);
    return { ...p, lon: p.lon + lerp(X, cum) / kx, lat: p.lat + lerp(Y, cum) / ky };
  });
}

// Route Studio (2026-11-14, the owner: "a mad banging route editor ... like building a coaster in rollercoaster tycoon";
// public/js/studio.js). Two more hand corrections, applied in order with the rest:
//   bend: { from, to, bend: true }: the stretch becomes one smooth curve (a cubic Hermite) leaving the line at `from`
//         in the direction it was going there and joining it at `to` in its direction there, so no kink at either
//         end: takes out chicanes and turns a lumpy long corner into one lean. Heights blend evenly, as straighten.
//         `tension` (0.3-1.6, default 1) = how long the curve holds each end's direction.
//   move: { from, to, dx, dy }: the line around the middle of the stretch is pulled dx m east and dy m north, the pull
//         easing off smoothly (a cosine) to nothing at both ends: dragging the track.
function cumOf(pts, kx, ky) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i].lon - pts[i - 1].lon) * kx, (pts[i].lat - pts[i - 1].lat) * ky));
  return cum;
}
function pointAt(pts, cum, d) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], t = Math.max(0, Math.min(1, (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1)));
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t };
}
export function applyBend(pts, a) {
  const kx = 111320 * Math.cos(toRad(pts[0].lat)), ky = 110540, cum = cumOf(pts, kx, ky), L = cum[cum.length - 1];
  const from = Math.max(0, a.from * 1000), to = Math.min(L, a.to * 1000);
  if (to - from < 6) return pts;
  const A = pointAt(pts, cum, from), B = pointAt(pts, cum, to);
  const dirAt = (d0, d1) => { const p = pointAt(pts, cum, Math.max(0, d0)), q = pointAt(pts, cum, Math.min(L, d1)); const x = (q.lon - p.lon) * kx, y = (q.lat - p.lat) * ky, n = Math.hypot(x, y) || 1; return [x / n, y / n]; };
  const t0 = dirAt(from - 8, from), t1 = dirAt(to, to + 8);
  const ax = 0, ay = 0, bx = (B.lon - A.lon) * kx, by = (B.lat - A.lat) * ky, chord = Math.hypot(bx, by);
  const k = chord * Math.max(0.3, Math.min(1.6, a.tension || 1));
  const m0 = [t0[0] * k, t0[1] * k], m1 = [t1[0] * k, t1[1] * k];
  const H = (t) => { const t2 = t * t, t3 = t2 * t; const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2; return [h00 * ax + h10 * m0[0] + h01 * bx + h11 * m1[0], h00 * ay + h10 * m0[1] + h01 * by + h11 * m1[1]]; };
  const n = Math.max(4, Math.round(chord / 1.5));
  const curve = [];
  for (let j = 0; j <= n; j++) { const t = j / n, [x, y] = H(t); curve.push({ lat: A.lat + y / ky, lon: A.lon + x / kx, ele: a.keepEle ? pointAt(pts, cum, from + (to - from) * t).ele : A.ele + (B.ele - A.ele) * t }); }
  let i = 0;
  const out = [];
  while (i < pts.length && cum[i] < from) out.push(pts[i++]);
  out.push(...curve);
  while (i < pts.length && cum[i] <= to) i++;
  while (i < pts.length) out.push(pts[i++]);
  return out;
}
export function applyMove(pts, a) {
  const kx = 111320 * Math.cos(toRad(pts[0].lat)), ky = 110540, cum = cumOf(pts, kx, ky);
  const from = a.from * 1000, to = a.to * 1000, mid = (from + to) / 2, half = (to - from) / 2;
  if (!(half > 0)) return pts;
  return pts.map((p, i) => {
    const u = Math.abs(cum[i] - mid) / half;
    if (u >= 1) return p;
    const w = 0.5 * (1 + Math.cos(Math.PI * u));
    return { ...p, lon: p.lon + ((a.dx || 0) * w) / kx, lat: p.lat + ((a.dy || 0) * w) / ky };
  });
}

export function applyCorrections(pts, adjust) {
  if (!adjust?.length) return pts;
  let out = pts, run = [];
  const flush = () => { if (run.length) { out = applyAdjustments(out, run); run = []; } };
  for (const a of adjust) {
    if (a.straight) { flush(); out = applyStraighten(out, [a]); }
    else if (a.bend) { flush(); out = applyBend(out, a); }
    else if (a.dx || a.dy) { flush(); out = applyMove(out, a); }
    else if (a.right) run.push(a);
  }
  flush();
  return out;
}

export class Route {
  // finishKm / startKm: end the route early / start it later (route corrections stored with suggested routes).
  // Corrections, finish and start are all in km along the full cleaned route; the ride itself measures from the
  // (possibly later) start, so convert with km(d) / m(km).
  // opts.keepDense: see cleanPoints (set for routes replaced with an edited export)
  // opts.skipKm: the rider chose to start this far in (setup's "Start at"; see withSkip). Added to the route's own
  // start, so km(d) / m(km) and everything stored in full-route km carry on working.
  // opts.pieces: a highlights route ([{ from, to, name }], full-route km, in riding order): only those stretches are
  // ridden, with a fade and a jump between them (app/pieces.js). The route runs from the first piece's start to the
  // last one's end; this.pieces holds them in ride metres, and toV() / fromV() convert between ride metres and the
  // distance actually ridden (the gaps left out). With skipKm, the skip is counted along the pieces.
  constructor(name, points, adjust = null, finishKm = null, startKm = null, opts = {}) {
    this.name = name;
    this.opts = opts;
    this.source = points;          // kept so the route editor can rebuild with new corrections
    this.adjust = adjust || [];
    this.baseStartKm = startKm; this.baseFinishKm = finishKm; // the route's own trims (what withAdjust / withSkip rebuild from)
    let pieces = Array.isArray(opts.pieces) && opts.pieces.length
      ? opts.pieces.map((p) => (Array.isArray(p) ? { from: +p[0], to: +p[1] } : { ...p, from: +p.from, to: +p.to })).filter((p) => p.to > p.from + 0.05)
      : null;
    const skip = Math.max(0, +opts.skipKm || 0);
    const natural = pieces ? pieces[0].from : (startKm > 0 ? startKm : 0);
    if (pieces) {
      let left = skip; // drop whole pieces, then start part-way into the one the skip lands in (at least 200 m left of it)
      while (pieces.length > 1 && left >= pieces[0].to - pieces[0].from - 0.2) { left -= pieces[0].to - pieces[0].from; pieces.shift(); }
      if (left > 0) pieces[0] = { ...pieces[0], from: Math.min(pieces[0].from + left, pieces[0].to - 0.2) };
      startKm = pieces[0].from; finishKm = pieces[pieces.length - 1].to;
    } else if (skip > 0) {
      startKm = (startKm > 0 ? startKm : 0) + skip;
      if (finishKm > 0) startKm = Math.min(startKm, finishKm - 0.2);
    }
    this.finishKm = finishKm;
    this.startKm = startKm > 0 && !(finishKm > 0 && startKm >= finishKm) ? startKm : null;
    this.startM = (this.startKm || 0) * 1000;
    // drop duplicate consecutive points
    const pts = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (!last || haversine(last, p) > 0.5) pts.push(p);
    }
    if (pts.length < 2) throw new Error('Route needs at least two distinct points');
    this.hasElevation = pts.every((p) => Number.isFinite(p.ele));
    if (!this.hasElevation) pts.forEach((p) => (p.ele = 0));

    const full = applyCorrections(applyCentre(cleanPoints(pts, opts), opts.centre), adjust);
    this.fullPts = full; // (the whole corrected line, before start / finish trims: Route Studio works on it)
    // how much cleaning shortened the file (cut retraced stubs, smoothed corners): the route analyser's distances
    // are along the file, so they're scaled by this to find each structure (Montjuïc laps: ~190 m a lap, so by the
    // fourth lap the hint was 580 m out and its underpass was missed)
    const pathLen = (a) => { let L = 0; for (let i = 1; i < a.length; i++) L += haversine(a[i - 1], a[i]); return L; };
    this.fileScale = pathLen(full) / Math.max(1, pathLen(pts));
    if (this.startKm && this.startKm * 1000 > pathLen(full) - 200) { // skipped past the end: keep the last 200 m
      this.startKm = Math.max(0, pathLen(full) / 1000 - 0.2); this.startM = this.startKm * 1000;
    }
    this.pts = trimStart(trimTo(full, finishKm), this.startKm);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + haversine(this.pts[i - 1], this.pts[i]));
    this.length = this.cum[this.cum.length - 1];
    // how much later than everyone else this ride starts (multiplayer positions are sent as if from the usual start)
    this.shiftM = ((this.startKm || 0) - natural) * 1000;
    this.skipKm = skip;
    this.pieces = pieces && pieces.length > 1 ? pieces.map((p, i) => ({
      name: p.name || '', a: i ? Math.max(0, this.m(p.from)) : 0, b: i === pieces.length - 1 ? this.length : Math.min(this.length, this.m(p.to)),
    })) : null;
    this.buildProfile();
  }

  // The same route started skipKm further in (setup's "Start at")
  withSkip(skipKm) {
    const r = new Route(this.name, this.source.map((p) => ({ ...p })), this.adjust, this.baseFinishKm, this.baseStartKm, { ...this.opts, skipKm });
    r.name = this.name;
    return r;
  }

  // Highlights routes: ride metres <-> distance ridden (the gaps between pieces left out). Plain routes: the same.
  get rideLength() { return this.pieces ? this.pieces.reduce((s, p) => s + p.b - p.a, 0) : this.length; }
  toV(d) {
    if (!this.pieces) return d;
    let v = 0;
    for (const p of this.pieces) { if (d < p.a) return v; if (d <= p.b) return v + d - p.a; v += p.b - p.a; }
    return v;
  }
  fromV(v) {
    if (!this.pieces) return v;
    for (const p of this.pieces) { if (v <= p.b - p.a) return p.a + Math.max(0, v); v -= p.b - p.a; }
    return this.length;
  }
  // the piece d is in (or the next one, in a gap), and its index
  pieceAt(d) {
    if (!this.pieces) return null;
    const i = this.pieces.findIndex((p) => d < p.b - 0.01);
    return i < 0 ? { i: this.pieces.length - 1, p: this.pieces[this.pieces.length - 1] } : { i, p: this.pieces[i] };
  }

  // The same road ridden the other way (turning round at the end with a workout still going). Built from the
  // finished points, so corrections, start and finish trims stay as they are; 'level', 'mine' and 'up' corrections are
  // mirrored. Reversing it again gives back the original.
  reversed() {
    if (this.reversedOf) return this.reversedOf;
    const L = this.length, r = Object.create(Route.prototype);
    Object.assign(r, this);
    r.pts = this.pts.slice().reverse();
    r.cum = this.cum.slice().reverse().map((c) => L - c);
    r.startKm = null; r.startM = 0; r.finishKm = null;
    r.pieces = this.pieces && this.pieces.map((p) => ({ ...p, a: L - p.b, b: L - p.a })).reverse();
    const lv = this.levels().map(([a, b]) => [L - b, L - a]), mn = this.mine().map(([a, b]) => [L - b, L - a]), hd = this.holds().map(([a, b]) => [L - b, L - a]);
    r.levels = () => lv;
    r.mine = () => mn;
    r.holds = () => hd;
    r.upOffset = (d) => this.upOffset(L - d);
    r.reversedOf = this;
    // ridden the other way, a gallery's open side swaps
    const flip = (k) => (k?.open ? { ...k, open: k.open === 'left' ? 'right' : 'left' } : k);
    r._zones = this.zones && this.zones.map(([a, b, t, k]) => [L - b, L - a, t, flip(k)]);
    r._cobbles = this.cobbles.map(([a, b]) => [L - b, L - a]);
    r.buildProfile();
    return r;
  }

  // A spot given by the server's analysers (lat/lon, and km along the uploaded GPX as a hint) in ride metres, or null:
  // every pass within 25 m of it (each pass's closest point), then the one nearest the expected distance, so a road
  // that crosses itself maps each crossing to the right pass. wide: if nothing near the hint, the whole route (names on
  // a route ridden the other way).
  locate(lat, lon, km, wide = false) {
    const kx = 111320 * Math.cos(toRad(lat)), hint = km * 1000 * (this.fileScale || 1) - this.startM, passes = [];
    const scan = (from, to) => {
      let run = null;
      for (let d = Math.max(0, from); d <= Math.min(this.length, to); d += 2) {
        const p = this.at(d), e = Math.hypot((p.lon - lon) * kx, (p.lat - lat) * 110540);
        if (e < 25) { if (!run || e < run.e) run = { d, e }; } else if (run) { passes.push(run); run = null; }
      }
      if (run) passes.push(run);
    };
    scan(hint - 400, hint + 400);
    if (!passes.length && wide) scan(0, this.length);
    passes.sort((a, b) => Math.abs(a.d - hint) - Math.abs(b.d - hint));
    return passes.length ? passes[0].d : null;
  }

  // Where the route passes under a bridge or through a tunnel, in ride metres: [[from, to, 'under' | 'tunnel']], or
  // null when the route hasn't been analysed (opts.structures from the server's route analyser, lib/structures.js:
  // positions by lat/lon with the km along the uploaded GPX as a hint, so a road that crosses itself, like Sa
  // Calobra's knot, maps each crossing to the right pass). The survey uses it to tell real bridges from Google's
  // bulging mountainsides.
  get zones() {
    if (this._zones !== undefined) return this._zones;
    const list = this.opts?.structures;
    if (!Array.isArray(list)) return (this._zones = null);
    const find = (lat, lon, km) => this.locate(lat, lon, km);
    const out = [];
    this._cobbles = [];
    for (const s of list) {
      const a = find(s.lat, s.lon, s.km);
      if (a === null) continue;
      if (s.type === 'bridge') continue; // the route on a bridge: for the route pipeline's heights, not a zone
      if (s.type === 'cobbles') { // not a zone: drawn as cobbles by the clean road (cobbles below)
        const b = find(s.latEnd, s.lonEnd, s.kmEnd ?? s.km);
        if (b !== null) this._cobbles.push([Math.min(a, b), Math.max(a, b)]);
        continue;
      }
      if (s.type === 'tunnel') {
        const b = find(s.latEnd, s.lonEnd, s.kmEnd ?? s.km);
        // the 4th element carries the tunnel kit's settings (tunnelkit.js: style, width, height, open side) if any
        const kit = s.style || s.width || s.height ? { style: s.style, width: s.width, height: s.height, open: s.open } : null;
        if (b !== null) out.push([Math.max(0, Math.min(a, b) - 15), Math.min(this.length, Math.max(a, b) + 15), 'tunnel', kit]);
      } else out.push([Math.max(0, a - 30), Math.min(this.length, a + 30), 'under']);
    }
    return (this._zones = out);
  }

  // Cobbled stretches in ride metres ([[from, to]]; [] when none or not analysed), from the analyser's OSM surfaces
  get cobbles() {
    if (this._cobbles === undefined) this.zones; // eslint-disable-line no-unused-expressions
    return this._cobbles || [];
  }

  // Same route with a different set of corrections (route editor preview)
  withAdjust(adjust) {
    const r = new Route(this.name, this.source.map((p) => ({ ...p })), adjust, this.baseFinishKm, this.baseStartKm, this.opts);
    r.name = this.name;
    return r;
  }

  // The route as it is ridden (corrections, start and finish built in) as a GPX track, to rework elsewhere
  // (e.g. RideWithGPS) and bring back with "Replace GPX". Every point (2 m apart; 5 m on routes over 60 km, to stay
  // under the 8 MB upload limit).
  toGpx() {
    const step = this.length > 60000 ? 5 : 0, x = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const out = [];
    let last = -Infinity;
    this.pts.forEach((p, i) => {
      if (this.cum[i] - last < step && i !== this.pts.length - 1) return;
      last = this.cum[i];
      out.push(`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${this.hasElevation ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`);
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RideWorld" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${x(this.name)}</name><desc>Exported from RideWorld with its route corrections applied</desc></metadata>
<trk><name>${x(this.name)}</name><trkseg>
${out.join('\n')}
</trkseg></trk>
</gpx>
`;
  }

  // How sharply the route bends at d (radians per metre, + = turning right), for the rider's lean. Measured over
  // 10 m chords: 5 m ones magnified ~10 cm wiggles (RideWithGPS rounds to 6 decimals) into constant rocking, while
  // the lean's timing through corners is within 0.2 s of the 5 m version (measured on Westminster's corners).
  curvature(d, chord = 10) {
    const bear = (a, b) => Math.atan2((b.lon - a.lon) * Math.cos(toRad(a.lat)), b.lat - a.lat);
    const p0 = this.at(d - chord), p1 = this.at(d), p2 = this.at(d + chord);
    const dh = bear(p1, p2) - bear(p0, p1);
    return Math.atan2(Math.sin(dh), Math.cos(dh)) / chord;
  }

  // Ride distance (metres from our start) <-> stored km (along the full route)
  km(d) { return +((d + this.startM) / 1000).toFixed(3); }
  m(km) { return km * 1000 - this.startM; }

  // 'level' corrections as [from, to] in ride metres
  levels() {
    return this.adjust.filter((a) => a.level).map((a) => [Math.max(0, this.m(a.from)), Math.min(this.length, this.m(a.to))]).filter(([a, b]) => b - a > 1);
  }
  // 'use my heights' corrections as [from, to] in ride metres: the road there follows the file's heights, not
  // Google's 3D (survey.js groundHeight), where Google's model is wrong (Cap's last km: a 40 m hollow and a peak)
  mine() {
    return this.adjust.filter((a) => a.mine).map((a) => [Math.max(0, this.m(a.from)), Math.min(this.length, this.m(a.to))]).filter(([a, b]) => b - a > 1);
  }
  // 'hold' corrections as [from, to] in ride metres (2026-10-28, Flanders): the drawn road there keeps the file's own
  // shape, lifted onto Google's road by the survey at the two ends; trees between can't lift it. Unlike 'use my
  // heights' nothing is built (no cuttings), and unlike 'level' the trainer's heights aren't touched.
  holds() {
    return this.adjust.filter((a) => a.hold).map((a) => [Math.max(0, this.m(a.from)), Math.min(this.length, this.m(a.to))]).filter(([a, b]) => b - a > 1);
  }

  // Extra height from 'up' corrections at distance d (metres)
  upOffset(d) {
    let up = 0;
    for (const a of this.adjust) if (a.up) up += a.up * easeWeight(d + this.startM, a);
    return up;
  }

  static fromGpx(text, name = 'Route', adjust = null, finishKm = null, startKm = null, opts = {}) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Not a valid GPX file');
    let nodes = [...doc.getElementsByTagName('trkpt')];
    if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];
    if (!nodes.length) throw new Error('No track or route points in GPX');
    const title = doc.getElementsByTagName('name')[0]?.textContent?.trim() || name;
    const points = nodes.map((n) => {
      const ele = n.getElementsByTagName('ele')[0];
      return { lat: parseFloat(n.getAttribute('lat')), lon: parseFloat(n.getAttribute('lon')), ele: ele ? parseFloat(ele.textContent) : NaN };
    });
    return new Route(title, points, adjust, finishKm, startKm, opts);
  }

  // Resample elevation every 10 m and smooth it, so GPS noise doesn't make the trainer lurch.
  buildProfile() {
    const step = 10;
    const n = Math.max(2, Math.ceil(this.length / step) + 1);
    const raw = [];
    for (let i = 0; i < n; i++) raw.push(this.at(Math.min(i * step, this.length)).ele);
    // 'level' corrections: a straight line between the stretch's two ends (the map elevation dips into a valley the
    // road actually bridges, say), before the usual smoothing so the joins blend in
    for (const [a, b] of this.levels()) {
      const ea = this.at(a).ele, eb = this.at(b).ele;
      for (let i = Math.ceil(a / step); i * step <= b && i < n; i++) raw[i] = ea + ((eb - ea) * (i * step - a)) / (b - a);
    }
    const win = 8; // ±80 m: map elevation has small bumps that no road really has, and the trainer would feel them
    const smooth = raw.map((_, i) => {
      let s = 0, c = 0;
      for (let j = i - win; j <= i + win; j++) if (j >= 0 && j < n) { s += raw[j]; c++; }
      return s / c;
    });
    this.profileStep = step;
    this.profile = smooth;
    let gain = 0;
    const ridden = (m) => !this.pieces || this.pieces.some((p) => m >= p.a && m <= p.b); // highlights: only the pieces count
    for (let i = 1; i < n; i++) if (smooth[i] > smooth[i - 1] && ridden(i * step) && ridden((i - 1) * step)) gain += smooth[i] - smooth[i - 1];
    this.gain = gain;
  }

  index(d) {
    d = Math.max(0, Math.min(d, this.length));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Raw interpolated point at distance d (metres)
  at(d) {
    d = Math.max(0, Math.min(d, this.length));
    const i = this.index(d);
    const a = this.pts[i], b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = Math.min(1, (d - this.cum[i]) / seg);
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele + (b.ele - a.ele) * t };
  }

  smoothEle(d) {
    const f = Math.max(0, Math.min(d, this.length)) / this.profileStep;
    const i = Math.min(Math.floor(f), this.profile.length - 2);
    const t = f - i;
    return this.profile[i] * (1 - t) + this.profile[i + 1] * t;
  }

  // Gradient in percent around distance d
  grade(d) {
    if (!this.hasElevation) return 0;
    const h = 20;
    const d0 = Math.max(0, d - h), d1 = Math.min(this.length, d + h);
    if (d1 - d0 < 1) return 0;
    return ((this.smoothEle(d1) - this.smoothEle(d0)) / (d1 - d0)) * 100;
  }

  // The road's direction right at d (radians, 4 m either side): for "sideways" (lanes, the clean road's edges).
  // heading() looks 8-32 m ahead, which is right for the camera but tilted the clean road across bends.
  tangent(d) {
    const a = this.at(Math.max(0, d - 4)), b = this.at(Math.min(this.length, d + 4));
    return a.lat === b.lat && a.lon === b.lon ? this.heading(d) : bearing(a, b);
  }

  // Heading (radians) looking ahead, averaged over a few points so the camera doesn't twitch on corners
  heading(d) {
    let x = 0, y = 0;
    for (const ahead of [8, 16, 24, 32]) {
      const a = this.at(d), b = this.at(Math.min(this.length, d + ahead));
      if (a.lat === b.lat && a.lon === b.lon) continue;
      const br = bearing(a, b);
      x += Math.cos(br); y += Math.sin(br);
    }
    if (x === 0 && y === 0) {
      const a = this.at(Math.max(0, d - 10)), b = this.at(d);
      return bearing(a, b);
    }
    return Math.atan2(y, x);
  }
}

export { toDeg, toRad };
