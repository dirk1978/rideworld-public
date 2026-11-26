// Earthworks (2026-10-19, the owner: "it definitely won't be the last time"): on every 'use my heights' stretch (route.mine(),
// marked in the route editor) the road follows the recording, not Google's 3D, because Google's model there has humps
// and hollows the real road doesn't. The clean road alone cut a vertical-walled gorge through each hump. Here the
// road gets what a road engineer would build (maths in ../earthworks-math.js):
//   - a verge, then a rock CUTTING face climbing at 1.5:1 until it meets Google's ground, with Google's false surface
//     clipped away back to that line
//   - an EMBANKMENT falling at 1:1.5 from the verge down to Google's ground, or a retaining WALL straight down where
//     it wouldn't reach it within 15 m (a cliff edge)
//   - a VIADUCT (deck, parapets, piers) where the ground is over 7 m below the road on both sides for 15 m or more
//   - a TUNNEL where it's over 16 m above on both sides for 30 m or more (handed to tunnels.js: tube and portals)
// Google's ground is measured 4-15 m out each side (OFFSETS), once, as the rider comes within 1.5 km, before any of
// our clipping; everything is rebuilt when the survey refines the road's heights (as tunnels.js does).
import { C, route, state } from './core.js';
import { viewer } from './scenery.js';
import { cleanRoad, roadAppearance } from './cleanroad.js';
import { SURVEY_STEP, groundHeight, ownObjects, sampleSurface } from './survey.js';
import { faceMeet, deepRuns, smooth3, clampInside, OFFSETS, CUT_SLOPE, FILL_SLOPE, VERGE } from '../earthworks-math.js';

export const earthworks = { sites: [], prims: [], polys: [], tubes: [], viaducts: [], forRoute: null, built: null, checked: 0 };
const NEAR = 1500;      // measure and clip within this many metres of a site (any clip costs the GPU on every tile)
const ROW = 5;          // metres between cross-sections
const COLOURS = { verge: '#8e8a7b', cut: '#a69882', fill: '#7f7b5d', cliff: '#8c8170', wall: '#a19a8c', deck: '#b9b5ab', coping: '#e2ddd0' };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// lon/lat `side` metres right of the route at d (along the road's own direction there)
function offset(d, side) {
  const p = route.at(d), h = route.tangent(d), kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  return [p.lon + (Math.cos(h) * side) / kx, p.lat - (Math.sin(h) * side) / 110540];
}
const at = (d, x, h) => { const [lon, lat] = offset(d, x); return C.Cartesian3.fromDegrees(lon, lat, h); };
const inRuns = (runs, d) => runs.some(([a, b]) => d >= a && d <= b);
// the offsets (Google's height minus the file's) at each end of the 'use my heights' stretch [a, b], once measured
export function anchorsFor(a, b) {
  const s = earthworks.sites.find((x) => x.measured && Math.abs(x.a - a) < 1 && Math.abs(x.b - b) < 1);
  return s && { oa: s.oa, ob: s.ob };
}
export const inSite = (d) => earthworks.sites.some((s) => s.built && d >= s.x0 && d <= s.x1);

// ---------- measuring Google's ground beside the road ----------
async function measure(site) {
  site.measuring = true;
  const ds = [];
  for (let d = site.ma; d <= site.mb + 0.01; d += SURVEY_STEP) ds.push(Math.min(d, site.mb));
  const carts = [];
  for (const d of ds) for (const sgn of [-1, 1]) for (const x of OFFSETS) { const [lon, lat] = offset(d, sgn * x); carts.push(C.Cartographic.fromDegrees(lon, lat)); }
  // and Google's surface on the road's line for 30 m outside each end: the stretch's own height hangs off these
  // (survey.js groundHeight), measured now rather than waiting for the survey, whose guess at the far end moved the
  // whole stretch with every batch until it got there (23 rebuilds riding through Cap's)
  const ends = [];
  for (const [d0, dir] of [[site.a, -1], [site.b, 1]]) for (let k = 0; k <= 3; k++) {
    const d = Math.max(0, Math.min(route.length, d0 + dir * k * SURVEY_STEP));
    for (const x of [-1.5, 0, 1.5]) { const [lon, lat] = offset(d, x); carts.push(C.Cartographic.fromDegrees(lon, lat)); ends.push({ end: dir < 0 ? 'oa' : 'ob', d }); }
  }
  const exclude = ownObjects(), res = [];
  // a few points a frame: Cesium measures each with its own render (see survey.js sampleSpread)
  for (let k = 0; k < carts.length; k += 8) {
    res.push(...(await sampleSurface(carts.slice(k, k + 8), exclude)));
    await nextFrame();
    if (earthworks.forRoute !== route) return; // the route changed while measuring
  }
  const n = OFFSETS.length, base = ds.length * 2 * n, offs = { oa: [], ob: [] };
  ends.forEach((e, k) => { const h = res[base + k]?.height; if (Number.isFinite(h)) offs[e.end].push(h - route.smoothEle(e.d)); });
  const med = (v) => { const s = v.slice().sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : undefined; };
  site.oa = med(offs.oa); site.ob = med(offs.ob);
  site.stations = ds.map((d, i) => {
    const side = (s) => OFFSETS.map((x, k) => [x, res[i * 2 * n + s * n + k]?.height]).filter(([, h]) => Number.isFinite(h));
    return { d, left: side(0), right: side(1) };
  });
  site.measuring = false;
  site.measured = true;
}

// Google's ground at d on one side, between the two stations either side (readings at the same offsets)
function sideAt(site, d, key) {
  const st = site.stations, f = (d - site.ma) / SURVEY_STEP, i = Math.max(0, Math.min(st.length - 2, Math.floor(f))), t = Math.max(0, Math.min(1, f - i));
  const A = st[i][key], B = st[i + 1]?.[key] || A;
  const out = [];
  for (const x of OFFSETS) {
    const a = A.find((p) => p[0] === x), b = B.find((p) => p[0] === x);
    if (a && b) out.push([x, a[1] + (b[1] - a[1]) * t]);
    else if (a || b) out.push([x, (a || b)[1]]);
  }
  return out;
}

// ---------- building ----------
// a quad as two triangles, each vertex with the quad's normal (flat, faceted) and texture coordinates `uv`
// ([u, v] per corner, metres-ish; the textures repeat every unit)
function quad(arr, v0, v1, v2, v3, uv = null) {
  const n = C.Cartesian3.normalize(C.Cartesian3.cross(C.Cartesian3.subtract(v1, v0, new C.Cartesian3()), C.Cartesian3.subtract(v3, v0, new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
  if (!Number.isFinite(n.x)) return;
  const vs = [v0, v1, v2, v3], order = [0, 1, 2, 0, 2, 3];
  for (const k of order) { const v = vs[k]; arr.pos.push(v.x, v.y, v.z); arr.nrm.push(n.x, n.y, n.z); arr.st.push(...(uv ? uv[k] : [0, 0])); }
}
const bucket = () => ({ pos: [], nrm: [], st: [] });
function geometry(b, textured) {
  const positions = new Float64Array(b.pos);
  const attributes = {
    position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
    normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(b.nrm) }),
  };
  if (textured) attributes.st = new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(b.st) });
  return new C.Geometry({ attributes, primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(positions) });
}
function primitive(b, colour) {
  return new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: geometry(b, false), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(colour)) } }),
    appearance: new C.PerInstanceColorAppearance({ flat: false, faceForward: true, translucent: false, closed: false }),
    asynchronous: false, compressVertices: false,
  });
}

// Textures drawn once on canvases (like the clean road's asphalt): pale limestone with strata for cuttings, dry scrub
// for embankments, gravel verges, block-built retaining walls. Game-style, picked to sit with Mallorca's hillsides.
const looks = {};
function texture(kind) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), W = (c.width = 256), H = (c.height = 256);
  const speckle = (n, f) => { for (let i = 0; i < n; i++) { g.fillStyle = f(); g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 3); } };
  if (kind === 'rock') {
    g.fillStyle = '#b4a891'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 10 + Math.random() * 18) { g.fillStyle = `rgba(70,60,48,${0.12 + Math.random() * 0.18})`; g.fillRect(0, y, W, 1 + Math.random() * 3); } // strata
    speckle(5000, () => { const v = 120 + Math.random() * 80; return `rgba(${v + 10},${v + 4},${v - 10},0.35)`; });
    speckle(220, () => `rgba(78,92,62,${0.35 + Math.random() * 0.4})`); // tufts of scrub in the cracks
  } else if (kind === 'scrub') {
    g.fillStyle = '#8f8866'; g.fillRect(0, 0, W, H);
    speckle(6000, () => { const v = 100 + Math.random() * 60; return `rgba(${v + 15},${v + 10},${v - 15},0.4)`; });
    speckle(900, () => `rgba(${60 + Math.random() * 25},${80 + Math.random() * 25},${50 + Math.random() * 15},0.75)`);
  } else if (kind === 'gravel') {
    g.fillStyle = '#9c978b'; g.fillRect(0, 0, W, H);
    speckle(9000, () => { const v = 110 + Math.random() * 90; return `rgba(${v},${v - 2},${v - 8},0.45)`; });
  } else { // stone blocks
    g.fillStyle = '#a39b8c'; g.fillRect(0, 0, W, H);
    speckle(4000, () => { const v = 120 + Math.random() * 70; return `rgba(${v},${v - 4},${v - 12},0.35)`; });
    g.fillStyle = 'rgba(60,55,48,0.55)';
    for (let r = 0; r < 4; r++) { g.fillRect(0, r * 64, W, 3); for (let k = 0; k < 4; k++) g.fillRect(((k * 64 + (r % 2) * 32) % W), r * 64, 3, 64); }
  }
  return c;
}
function textured(b, kind) {
  const look = (looks[kind] ||= new C.MaterialAppearance({
    material: C.Material.fromType('Image', { image: texture(kind), repeat: new C.Cartesian2(1, 1) }),
    flat: false, faceForward: true, closed: false,
  }));
  return new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: geometry(b, true) }), appearance: look, asynchronous: false, compressVertices: false });
}

function build() {
  clear(false);
  const half = (cleanRoad.width || 4) / 2, edge = half + 0.3;
  const B = { verge: bucket(), cut: bucket(), fill: bucket(), cliff: bucket(), wall: bucket(), deck: bucket(), parapet: bucket(), coping: bucket() };
  // a parapet along d0 -> d1 on one side (sgn), its outer face at x out from the line, standing on h0 / h1: stone 0.85 m
  // with a coping slab 15 cm thick overhanging 8 cm each side (viaducts, and retaining walls along a drop)
  const parapet = (d0, d1, h0, h1, sgn, x) => {
    const xi = x - 0.3, P = (d, xx, h) => at(d, sgn * xx, h), uv = (d, z) => [d / 3, z / 3];
    quad(B.parapet, P(d0, x, h0), P(d1, x, h1), P(d1, x, h1 + 0.85), P(d0, x, h0 + 0.85), [uv(d0, 0), uv(d1, 0), uv(d1, 0.85), uv(d0, 0.85)]);
    quad(B.parapet, P(d0, xi, h0), P(d1, xi, h1), P(d1, xi, h1 + 0.85), P(d0, xi, h0 + 0.85), [uv(d0, 0), uv(d1, 0), uv(d1, 0.85), uv(d0, 0.85)]);
    const xo = x + 0.08, xn = xi - 0.08;
    quad(B.coping, P(d0, xn, h0 + 1.0), P(d1, xn, h1 + 1.0), P(d1, xo, h1 + 1.0), P(d0, xo, h0 + 1.0));
    quad(B.coping, P(d0, xo, h0 + 0.85), P(d1, xo, h1 + 0.85), P(d1, xo, h1 + 1.0), P(d0, xo, h0 + 1.0));
    quad(B.coping, P(d0, xn, h0 + 0.85), P(d1, xn, h1 + 0.85), P(d1, xn, h1 + 1.0), P(d0, xn, h0 + 1.0));
    quad(B.coping, P(d0, xn, h0 + 0.85), P(d1, xn, h1 + 0.85), P(d1, xo, h1 + 0.85), P(d0, xo, h0 + 0.85));
  };
  const piers = [], rings = [];
  earthworks.tubes = []; earthworks.viaducts = [];
  for (const site of earthworks.sites) {
    if (!site.measured) continue;
    // the stretch grows outwards (up to the 150 m measured each side) while Google's surface stays over 3 m above the
    // road: the survey drops readings far above a recorded ride's road, and the clean road cut a gorge up to the stretch
    // (on our own readings 4 m out each side: the survey's on the line are often gone, cut away with the road)
    const above = (d) => {
      const s = site.stations[Math.round((d - site.ma) / SURVEY_STEP)];
      const gl = s?.left.find((p) => p[0] === OFFSETS[0])?.[1], gr = s?.right.find((p) => p[0] === OFFSETS[0])?.[1];
      return Number.isFinite(gl) && Number.isFinite(gr) ? Math.min(gl, gr) - groundHeight(d) : null;
    };
    const grow = (from, dir, limit) => {
      let end = from, gap = 0;
      for (let d = from + dir * SURVEY_STEP; dir < 0 ? d >= limit : d <= limit; d += dir * SURVEY_STEP) {
        const o = above(d);
        if (o === null) { if (++gap > 2) break; continue; }
        if (o < 3) break;
        end = d; gap = 0;
      }
      return end;
    };
    site.x0 = grow(site.a, -1, site.ma); site.x1 = grow(site.b, 1, site.mb);
    // deep runs, by station: both sides well below the road -> viaduct, both well above -> tunnel
    const depths = site.stations.map((s) => {
      if (s.d < site.x0 || s.d > site.x1) return NaN; // only within the (grown) stretch
      const gl = s.left.find((p) => p[0] === OFFSETS[0])?.[1], gr = s.right.find((p) => p[0] === OFFSETS[0])?.[1], road = groundHeight(s.d);
      if (!Number.isFinite(gl) || !Number.isFinite(gr)) return NaN;
      return gl > road && gr > road ? Math.min(gl, gr) - road : gl < road && gr < road ? Math.max(gl, gr) - road : 0;
    });
    const runs = deepRuns(depths, SURVEY_STEP).map(([i, j, k]) => [site.stations[i].d - SURVEY_STEP / 2, site.stations[j].d + SURVEY_STEP / 2, k]);
    const tubes = runs.filter((r) => r[2] === 'tunnel'), viaducts = runs.filter((r) => r[2] === 'viaduct');
    // each tunnel's portals sized to the cutting they stand in: as tall as the ground over the road there, as wide as
    // the cutting's faces reach (a mountain portal, 8 m tall, sat in a 16 m cutting with Google's surface round it)
    const portalAt = (d) => {
      const s = site.stations[Math.max(0, Math.min(site.stations.length - 1, Math.round((d - site.ma) / SURVEY_STEP)))];
      const g = [s.left, s.right].map((side) => side.find((p) => p[0] === OFFSETS[0])?.[1]).filter(Number.isFinite);
      const depth = g.length ? Math.min(...g) - groundHeight(d) : 0;
      return { top: Math.min(25, Math.max(8, depth + 2)), R: Math.min(16, edge + VERGE + Math.max(0, depth) / CUT_SLOPE + 1) };
    };
    earthworks.tubes.push(...tubes.map(([a, b]) => { const A = portalAt(a), B = portalAt(b); return [a, b, { top: [A.top, B.top], R: [A.R, B.R] }]; }));
    earthworks.viaducts.push(...viaducts.map(([a, b]) => [a, b]));
    // the cross-sections: one every ROW metres, meet points smoothed between neighbours
    const rows = [];
    for (let d = site.x0; d <= site.x1 + 0.01; d += ROW) {
      const road = groundHeight(d) + 0.03, left = sideAt(site, d, 'left'), right = sideAt(site, d, 'right');
      let L = faceMeet(left, edge, road), R = faceMeet(right, edge, road);
      // the inside of a bend: no further out than 80% of its radius (heading grows clockwise: a right-hand bend's
      // inside is the right side)
      let turn = route.tangent(Math.min(route.length, d + 4)) - route.tangent(Math.max(0, d - 4));
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (Math.abs(turn) > 1e-3) {
        const maxX = Math.max(edge + VERGE + 0.5, 0.8 * (8 / Math.abs(turn)));
        if (turn > 0) R = clampInside(R, right, maxX, road); else L = clampInside(L, left, maxX, road);
      }
      rows.push({ d, road, L, R });
    }
    earthworks.debugRows = rows; // (for diagnosing: the cross-sections of the last build)
    for (const key of ['L', 'R']) {
      const sm = smooth3(rows.map((r) => r[key]), 'x');
      rows.forEach((r, i) => {
        const m = sm[i];
        if (!m || m.cliff) return;
        r[key] = { ...m, top: m.kind === 'cut' ? r.road + CUT_SLOPE * (m.x - m.x0) : m.kind === 'fill' ? r.road - FILL_SLOPE * (m.x - m.x0) : r.road };
      });
    }
    const core = (d) => viaducts.some(([va, vb]) => d > va + 10 && d < vb - 10);
    const inside = (runs, d) => runs.some(([a, b]) => d > a && d < b);
    // the faces, side by side, row to row
    for (let i = 1; i < rows.length; i++) {
      const r0 = rows[i - 1], r1 = rows[i];
      if (inside(tubes, r0.d) || inside(tubes, r1.d)) continue; // (up to the portals, not into the tunnel)
      // a viaduct's middle (over 10 m from either end) has neither faces nor clip: it stands over Google's ground.
      // Its ends are ordinary earthworks that the deck overlaps (where the ground beside rises again).
      if (core(r0.d) || core(r1.d)) continue;
      for (const [key, sgn] of [['L', -1], ['R', 1]]) {
        const m0 = r0[key], m1 = r1[key];
        if (!m0 || !m1) continue;
        const P = (r, m) => {
          const ditch = m.kind === 'cut' ? -0.15 : 0;
          let pts;
          if (m.kind === 'wall') pts = [[edge, r.road], [m.x0, r.road], [m.x0, m.top - 0.5], [m.x0, m.top - 0.5]];
          else {
            pts = [[edge, r.road], [m.x0, r.road + ditch], [m.x, m.top]];
            if (m.kind === 'fill') pts.push([m.x + 0.8, m.top - FILL_SLOPE * 0.8]); // tucked under Google's ground
            else if (m.cliff) pts.push([m.x, m.top + m.cliff + (m.cliff > 0 ? 0.5 : -0.5)]);
            else pts.push([m.x, m.top]);
          }
          return pts.map(([x, h]) => ({ v: at(r.d, sgn * x, h), x, h, d: r.d }));
        };
        const a = P(r0, m0), b = P(r1, m1);
        // texture coordinates: along the road, and across (verge) or up and out (faces), about 4-6 m a repeat
        const uvA = (p) => [p.d / 6, p.x / 3], uvF = (p) => [p.d / 5, (p.h + p.x) / 5];
        const Q = (bk, i, j, uv) => quad(bk, a[i].v, b[i].v, b[j].v, a[j].v, [uv(a[i]), uv(b[i]), uv(b[j]), uv(a[j])]);
        Q(B.verge, 0, 1, uvA);
        Q(m0.kind === 'wall' ? B.wall : m0.kind === 'fill' ? B.fill : B.cut, 1, 2, uvF);
        Q(m0.kind === 'fill' ? B.fill : B.cliff, 2, 3, uvF);
        // a retaining wall along a drop gets a parapet on top, like a viaduct's
        if (m0.kind === 'wall' && m1.kind === 'wall') parapet(r0.d, r1.d, r0.road, r1.road, sgn, m0.x0);
      }
    }
    // the clip: Google's false surface removed back to where each cutting face meets its ground (0.4 m short, so
    // Google's edge covers the face's top edge); in spans between any tunnels (tunnels.js clips its own)
    // Three kinds of piece: 'band' (across the road, out to each side's cutting), and on a viaduct only 'L' / 'R' side
    // strips where a side needs a cutting: under a deck Google's ground stays (clipped, it showed black from the side).
    const spans = { band: [], L: [], R: [] };
    const flush = (k) => { if (spans[k].length > 1) rings.push({ kind: k, span: spans[k] }); spans[k] = []; };
    const add = (k, s) => {
      spans[k].push(s);
      // short pieces, overlapping by a row: one long ring folded over itself round the hairpins and clipped stray
      // ground (a black ribbon along Google's road beside ours)
      if (spans[k].length >= 10) { flush(k); spans[k].push(s); }
    };
    for (const r of rows) {
      // tunnels clip their own; a viaduct's middle stands over the ground
      if (inside(tubes, r.d) || core(r.d)) { flush('band'); flush('L'); flush('R'); continue; }
      // the clip's width eases in over the site's first and last 20 m: cut off square, Google's inside showed black
      const ease = Math.max(0, Math.min(1, (r.d - site.x0) / 20, (site.x1 - r.d) / 20));
      const out = (m) => (m && m.kind === 'cut' ? half + ease * Math.max(0, (m.cliff ? m.x - 0.2 : m.x - 0.4) - half) : half);
      const s = { d: r.d, l: out(r.L), r: out(r.R) };
      if (viaducts.some(([va, vb]) => r.d >= va - 5 && r.d <= vb + 5)) {
        flush('band');
        if (s.l > half + 0.2) add('L', s); else flush('L');
        if (s.r > half + 0.2) add('R', s); else flush('R');
      } else { flush('L'); flush('R'); add('band', s); }
    }
    flush('band'); flush('L'); flush('R');
    // viaducts: a deck under the road, parapets each side, a pier every ~25 m down to the hollow's floor
    for (const [va0, vb0] of viaducts) {
      const va = Math.max(site.x0, va0 - 5), vb = Math.min(site.x1, vb0 + 5); // the deck overlaps the earthworks at each end
      const n = Math.max(2, Math.ceil((vb - va) / 2));
      for (let k = 1; k <= n; k++) {
        const d0 = va + ((vb - va) * (k - 1)) / n, d1 = va + ((vb - va) * k) / n, h0 = groundHeight(d0), h1 = groundHeight(d1), w = half + 0.6;
        for (const sgn of [-1, 1]) {
          quad(B.deck, at(d0, sgn * w, h0), at(d1, sgn * w, h1), at(d1, sgn * w, h1 - 1.4), at(d0, sgn * w, h0 - 1.4)); // deck side (fascia)
          parapet(d0, d1, h0, h1, sgn, w);
        }
        quad(B.deck, at(d0, -w, h0 - 1.4), at(d1, -w, h1 - 1.4), at(d1, w, h1 - 1.4), at(d0, w, h0 - 1.4)); // soffit
      }
      // piers: tools/kit/pier.py (45 m tall, origin at the top of its cap: the ground hides the rest)
      for (let d = va0 + 8; d < vb0 - 4; d += 25) piers.push({ d, top: groundHeight(d) - 1.4 });
    }
  }
  const TEX = { verge: 'gravel', cut: 'rock', cliff: 'rock', fill: 'scrub', wall: 'stone', parapet: 'stone' };
  for (const [k, b] of Object.entries(B)) if (b.pos.length) earthworks.prims.push(viewer.scene.primitives.add(TEX[k] ? textured(b, TEX[k]) : primitive(b, COLOURS[k])));
  // the road itself, the whole stretch (the clean road leaves it out here): as the clean road lays it, so they join
  for (const site of earthworks.sites) {
    if (!site.measured) continue;
    const pos = [], st = [], idx = [];
    let n = 0;
    for (let d = site.x0; d <= site.x1 + 0.01; d += 2, n++) {
      const h = groundHeight(d) + 0.03;
      for (const x of [-edge, edge]) { const v = at(d, x, h); pos.push(v.x, v.y, v.z); }
      st.push(0, d / 6, 1, d / 6);
      if (n) { const a = (n - 1) * 2, b = n * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    if (idx.length) {
      const positions = new Float64Array(pos);
      earthworks.prims.push(viewer.scene.primitives.add(new C.Primitive({
        geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({
          attributes: {
            position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
            st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
          },
          indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(positions),
        }) }),
        appearance: roadAppearance(), asynchronous: false, compressVertices: false,
      })));
    }
  }
  const gen = earthworks.gen;
  for (const { d, top } of piers) {
    const p = route.at(d);
    C.Model.fromGltfAsync({ url: 'models/kit/pier.glb', forwardAxis: C.Axis.X,
      modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(p.lon, p.lat, top), new C.HeadingPitchRoll(route.tangent(d), 0, 0)) })
      .then((m) => { if (earthworks.gen !== gen) { m.destroy(); return; } earthworks.prims.push(viewer.scene.primitives.add(m)); })
      .catch((e) => console.warn('viaduct pier', e));
  }
  earthworks.polys = rings.map(({ kind, span }) => {
    const [inner, outer] = kind === 'band' ? [(s) => -s.l, (s) => s.r] : kind === 'L' ? [() => -half, (s) => -s.l] : [() => half, (s) => s.r];
    const a = span.map((s) => offset(s.d, inner(s))), b = span.map((s) => offset(s.d, outer(s))).reverse();
    return new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray([...a, ...b].flat()) });
  });
  for (const s of earthworks.sites) s.built = s.measured;
  cleanRoad.at = -1e9; // the clean road re-cuts now: no slot under a viaduct, no banks where the faces are
}

function clear(all = true) {
  for (const p of earthworks.prims) viewer?.scene.primitives.remove(p);
  const coll = state.tileset?.clippingPolygons;
  for (const p of earthworks.polys) if (coll?.contains(p)) coll.remove(p);
  earthworks.prims = []; earthworks.polys = []; earthworks.gen = (earthworks.gen || 0) + 1; // (models still loading from the last build are dropped)
  if (all) { earthworks.sites = []; earthworks.tubes = []; earthworks.viaducts = []; earthworks.built = null; }
}

// The road heights the build used (every 20 m over each measured range) and the road's width: rebuilt when the width
// changes or any height moves by over half a metre. (Comparing heights rounded to 30 cm rebuilt every 25-35 m while
// riding through, as small survey refinements tipped a rounding.)
const heightsNow = () => earthworks.sites.filter((s) => s.measured).flatMap((s) => {
  const v = [];
  for (let d = s.ma; d <= s.mb; d += 20) v.push(groundHeight(d));
  return v;
});
const changed = () => {
  const now = heightsNow(), was = earthworks.built;
  if (!was || was.width !== cleanRoad.width || was.h.length !== now.length) return true;
  return now.some((h, i) => Math.abs(h - was.h[i]) > 0.5);
};

// every frame (cheap unless something changed)
export function updateEarthworks() {
  if (!viewer || !route) return;
  if (earthworks.forRoute !== route) {
    clear(true);
    earthworks.forRoute = route;
    earthworks.sites = (route.mine?.() || []).map(([a, b]) => ({ a, b, ma: Math.max(0, a - 150), mb: Math.min(route.length, b + 150), x0: a, x1: b, measured: false, measuring: false, built: false }));
  }
  if (!earthworks.sites.length) return;
  // (not in open worlds: their bridges use 'my heights' for the deck's shape, with nothing to cut or build)
  const on = !route.opts?.open && state.cleanRoad && state.tileset && C.ClippingPolygonCollection?.isSupported(viewer.scene);
  if (!on) { if (earthworks.prims.length || earthworks.polys.length) { clear(false); earthworks.built = null; for (const s of earthworks.sites) s.built = false; } return; }
  // measure a site as we come within NEAR of it (one at a time)
  const near = (s) => state.dist > s.a - NEAR && state.dist < s.b + NEAR;
  if (!earthworks.sites.some((s) => s.measuring)) {
    const next = earthworks.sites.find((s) => !s.measured && near(s));
    if (next) measure(next).catch((e) => { console.warn('earthworks', e); next.measuring = false; next.measured = false; });
  }
  const now = performance.now();
  if (now - earthworks.checked > 1000) {
    earthworks.checked = now;
    // (at most one rebuild every 4 s: the margins' heights settle as the survey passes through them)
    if (earthworks.sites.some((s) => s.measured) && now - (earthworks.builtAt || -1e9) > 4000 && changed()) {
      earthworks.builtAt = now;
      const t0 = performance.now();
      build(); earthworks.built = { width: cleanRoad.width, h: heightsNow() };
      earthworks.builds = (earthworks.builds || 0) + 1; earthworks.buildMs = Math.round(performance.now() - t0); // (diagnosing)
    }
  }
  // the clips only near a site
  const coll = state.tileset.clippingPolygons || (state.tileset.clippingPolygons = new C.ClippingPolygonCollection());
  const close = earthworks.sites.some(near);
  for (const p of earthworks.polys) {
    if (close && !coll.contains(p)) coll.add(p);
    else if (!close && coll.contains(p)) coll.remove(p);
  }
}
