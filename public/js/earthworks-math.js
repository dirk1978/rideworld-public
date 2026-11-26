// Earthworks maths (no Cesium, unit-tested in tests/unit.mjs): where a road whose height we trust (a recording, on a
// 'use my heights' stretch) meets Google's ground beside it. Google's 3D can have false humps and hollows the real
// road doesn't (Cap's last km: a 40 m hollow and a 20 m peak); the road runs level through them, and app/earthworks.js
// builds what a road engineer would: a rock cutting through a hump, an embankment over a hollow, a viaduct over a deep
// one and a tunnel through a deep hump. Distances are metres out from the road's line on one side; heights absolute.

export const CUT_SLOPE = 1.5;   // a cutting's face rises 1.5 m per metre out (about 56 degrees: rock)
export const FILL_SLOPE = 0.65; // an embankment falls 0.65 m per metre out (about 33 degrees: fill)
export const VERGE = 0.8;       // flat verge between the road's edge and the face
export const LEVEL = 0.6;       // ground within this of the road counts as level: no face, just the verge
export const OFFSETS = [4, 6, 8, 10, 12, 15]; // where Google's ground is measured out from the line, each side
export const VIADUCT_DEPTH = 7;  // fill deeper than this under the road on both sides (over 15 m of road): a viaduct
export const TUNNEL_DEPTH = 16;  // ground higher than this over the road on both sides (over 30 m of road): a tunnel
// (a deeper embankment was a huge wedge of fill; a deeper cutting's faces can't meet the ground within 15 m)

// Google's ground at x from readings [[x, h], ...] (x increasing); before the first reading, the first one
export const groundAt = (side, x) => {
  if (x <= side[0][0]) return side[0][1];
  for (let k = 1; k < side.length; k++) {
    const [x0, h0] = side[k - 1], [x1, h1] = side[k];
    if (x <= x1) return h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
  }
  return side[side.length - 1][1];
};

// One side of the road at one station.
//   side: Google's ground [[x, h], ...] (readings that hit nothing left out); edge: x of the road's edge; road: the
//   road's height there. Returns { kind: 'cut' | 'fill' | 'level', x0: where the face starts (after the verge),
//   x: where it meets the ground, top: its height there, cliff: the rest of the way to the ground when it doesn't meet
//   by the last reading (0 when it does) } or null with no readings. An embankment that doesn't reach the ground
//   within the readings (a cliff edge) is a retaining 'wall' straight down from the verge instead.
export function faceMeet(side, edge, road) {
  if (!side || !side.length) return null;
  const x0 = edge + VERGE, g0 = groundAt(side, x0 + 1);
  const kind = g0 > road + LEVEL ? 'cut' : g0 < road - LEVEL ? 'fill' : 'level';
  if (kind === 'level') return { kind, x0, x: x0, top: road, cliff: 0 };
  const face = (x) => (kind === 'cut' ? road + CUT_SLOPE * (x - x0) : road - FILL_SLOPE * (x - x0));
  const past = (x) => (kind === 'cut' ? face(x) >= groundAt(side, x) : face(x) <= groundAt(side, x));
  const far = side[side.length - 1][0];
  let prev = x0;
  for (let x = x0 + 0.5; x <= far + 1e-9; x += 0.5) {
    if (past(x)) {
      // between prev and x: find the crossing (the gap between face and ground changes sign)
      const a = face(prev) - groundAt(side, prev), b = face(x) - groundAt(side, x);
      const t = a === b ? 1 : a / (a - b), xm = prev + (x - prev) * t;
      return { kind, x0, x: xm, top: face(xm), cliff: 0 };
    }
    prev = x;
  }
  if (kind === 'fill') return { kind: 'wall', x0, x: x0, top: groundAt(side, x0 + 1), cliff: 0 };
  return { kind, x0, x: far, top: face(far), cliff: groundAt(side, far) - face(far) };
}

// Runs of stations where the ground at the road (centre readings: Google's surface over the line, minus the road)
// asks for a viaduct (deep below) or a tunnel (deep above): [[fromIndex, toIndex, 'viaduct' | 'tunnel'], ...].
// `step` is the metres between stations; short runs (under minViaduct / minTunnel metres) are left as earthworks.
export function deepRuns(depths, step, minViaduct = 15, minTunnel = 30) {
  const out = [];
  let run = null;
  const kindOf = (v) => (!Number.isFinite(v) ? null : v < -VIADUCT_DEPTH ? 'viaduct' : v > TUNNEL_DEPTH ? 'tunnel' : null);
  const close = (end) => {
    if (run && (end - run[0]) * step >= (run[2] === 'viaduct' ? minViaduct : minTunnel)) out.push([run[0], end, run[2]]);
    run = null;
  };
  depths.forEach((v, i) => {
    const k = kindOf(v);
    if (run && k !== run[2]) close(i - 1);
    if (k && !run) run = [i, i, k];
  });
  close(depths.length - 1);
  return out;
}

// The inside of a tight bend: cross-sections reaching further out than the bend's radius cross their neighbours
// (fins in Cap's hairpins). A face meeting the ground beyond `maxX` stops there; a cutting rises the rest of the way
// as a cliff, an embankment becomes a retaining wall.
export function clampInside(m, side, maxX, road) {
  if (!m || m.kind === 'level' || m.kind === 'wall' || m.x <= maxX) return m;
  if (m.kind === 'fill') return { kind: 'wall', x0: m.x0, x: m.x0, top: groundAt(side, m.x0 + 1), cliff: 0 };
  const top = road + CUT_SLOPE * (maxX - m.x0);
  return { kind: 'cut', x0: m.x0, x: maxX, top, cliff: groundAt(side, maxX) - top };
}

// Median of three along a list (meet points from one station to the next shouldn't zig-zag); nulls kept
export function smooth3(list, key) {
  return list.map((v, i) => {
    if (!v) return v;
    const near = [list[i - 1], v, list[i + 1]].filter((x) => x && x.kind === v.kind).map((x) => x[key]).sort((a, b) => a - b);
    return { ...v, [key]: near[(near.length - 1) >> 1] };
  });
}
