// The tunnel kit (the owner 2026-10-26: "a tunnel maker tool that is a nice high quality tunnel which you can call with the
// size you want and then they're all consistent"). One call builds a whole tunnel along the route between two ride
// distances, in one of three styles, at any size:
//   'bore'    a mountain tunnel: tiled walls, a sprayed-concrete arch with ring joints, lamps and cable trays along
//             both sides, a stone portal (models/kit/portal.glb) at each end. The default.
//   'rail'    a railway underbridge: blue-brick walls, a dark deck with steel cross girders, bulkhead lamps, a brick
//             abutment + plate girder portal (models/kit/portal-rail.glb) at each end. Short tunnels under tracks.
//   'gallery' a covered way open on one side (a rock-fall shelter): concrete wall on the closed side, a roof slab, and
//             square columns with a low parapet along the open side.
//   'underpass' a road or path under a modern road (flyovers, Bristol's Brunel Way): board-marked concrete walls, a
//             concrete deck with beams across it, lamps, and a concrete headwall with a fascia beam at each end.
// All but 'bore' also clear Google's scenery across the tube's whole width for its whole length (spec.polys): under a
// bridge Google has its own road and the deck's underside there, which covered our road (dark blue) and poked blue
// shards through the walls (the owner 2026-10-26). A bored tunnel keeps the mountain whole over it (a cut showed as a
// black slot across it from outside).
// makeTunnel({ f, t, style, width, height, open, top, wide }, prims, alive) adds its primitives to `prims` (portal models
// load in the background and join it unless alive() says the tunnels were rebuilt meanwhile) and leaves the cuts in
// front of its portals in spec.polys (tunnels.js adds them to Google's tileset while the clean road is on, nearby). f / t are ride metres; width is the inside width (wall to wall),
// height the clear height (crown of the arch, or the underside of the deck / roof); both default to the clean road's
// width plus a walkway each side, and the style's usual height. top / wide: [entrance, exit] heights and half-widths
// the portal's backing face must reach (to cover the slot the clean road cuts into Google's scenery above it).
// Everything is drawn here (textures on canvases) or loaded from the kit's models, so every tunnel on every route looks
// alike. The road through it is the clean road's (cleanroad.js); the kerbs and walkways start at its edges.
import { C, route } from './core.js';
import { viewer } from './scenery.js';
import { cleanRoad } from './cleanroad.js';
import { groundHeight } from './survey.js';

const STEP = 2;  // metres between rings along the tube
// the sizes the portal models were built for (tools/kit/portal.py, portal_rail.py): half-width and wall / clear height
// wing: where each wing wall's inner face starts (x out from the centre, y along: + into the tunnel) and where it ends,
// for the forecourt cut in front of the portal
export const MODEL = {
  bore: { W: 3.4, wall: 3.2, url: 'models/kit/portal.glb', wing: [[7.0, 0.2], [10.75, -6.3]] },
  rail: { W: 3.4, H: 4.6, url: 'models/kit/portal-rail.glb', wing: [[7.1, 0.3], [10.6, -5.76]] },
};

// lon/lat `side` metres right of the route at d, and a point there `y` m above the road
function offset(d, side) {
  const p = route.at(d), h = route.tangent(d), kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  return [p.lon + (Math.cos(h) * side) / kx, p.lat - (Math.sin(h) * side) / 110540];
}
const at = (d, x, y) => { const [lon, lat] = offset(d, x); return C.Cartesian3.fromDegrees(lon, lat, groundHeight(d) + y); };

// ---------- textures (drawn once) ----------
const tex = {};
function canvas(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c; }
const speckle = (g, S, n, f) => { for (let i = 0; i < n; i++) { g.fillStyle = f(); g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
// each texture: [canvas, metres per repeat across (u, along the tunnel), metres per repeat up (v, round the profile)]
const TEXTURES = {
  // glazed cream tiles, 15 cm, grey grout, a little grime towards the bottom
  tiles: () => [canvas(256, (g, S) => {
    // (first version: 15 cm tiles with dark grout read as graph paper from the chase camera; now 20 x 10 cm, soft grout,
    // a little road grime)
    g.fillStyle = '#c9c2b0'; g.fillRect(0, 0, S, S);
    const nx = 6, ny = 12, w = S / nx, h = S / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const v = 208 + Math.random() * 14; g.fillStyle = `rgb(${v},${v - 5},${v - 18})`; g.fillRect(i * w + 1, j * h + 1, w - 2, h - 2); }
    speckle(g, S, 1200, () => 'rgba(90,85,75,0.12)');
  }), 1.2, 1.2],
  // sprayed concrete: grey with blotches; a ring joint (dark line) once per repeat along the tunnel
  lining: () => [canvas(256, (g, S) => {
    g.fillStyle = '#8d8a84'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) { const v = 120 + Math.random() * 40; g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.25)`; g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 8 + Math.random() * 30, 0, 7); g.fill(); }
    speckle(g, S, 3000, () => { const v = 100 + Math.random() * 70; return `rgba(${v},${v},${v - 4},0.3)`; });
    g.fillStyle = 'rgba(40,40,38,0.75)'; g.fillRect(0, 0, 3, S);
  }), 6, 3],
  // walkway paving slabs, 60 cm
  paving: () => [canvas(128, (g, S) => {
    g.fillStyle = '#a19e96'; g.fillRect(0, 0, S, S);
    speckle(g, S, 1500, () => { const v = 130 + Math.random() * 60; return `rgba(${v},${v},${v - 5},0.4)`; });
    g.fillStyle = 'rgba(70,68,62,0.8)'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S); g.fillRect(S / 2, 0, 2, S);
  }), 1.2, 0.6],
  kerb: () => [canvas(64, (g, S) => { g.fillStyle = '#c9c6bd'; g.fillRect(0, 0, S, S); speckle(g, S, 300, () => 'rgba(120,118,110,0.4)'); g.fillStyle = 'rgba(80,78,70,0.7)'; g.fillRect(0, 0, 2, S); }), 1, 0.3],
  // blue-grey engineering brick, English bond, cream mortar, darker towards the bottom (soot and road spray)
  brick: () => [canvas(256, (g, S) => {
    g.fillStyle = '#9a9488'; g.fillRect(0, 0, S, S);
    const rows = 16, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const n = r % 2 ? 8 : 4, w = S / n, off = r % 4 === 3 ? w / 2 : 0;
      for (let c = -1; c <= n; c++) {
        const k = 0.85 + Math.random() * 0.3 - (Math.random() < 0.08 ? 0.25 : 0);
        g.fillStyle = `rgb(${Math.round(112 * k)},${Math.round(64 * k)},${Math.round(52 * k)})`;
        g.fillRect(c * w + off + 1.5, r * rh + 1.5, w - 3, rh - 3);
      }
    }
    const grad = g.createLinearGradient(0, 0, 0, S); grad.addColorStop(0, 'rgba(20,18,16,0.35)'); grad.addColorStop(0.5, 'rgba(20,18,16,0)'); g.fillStyle = grad; g.fillRect(0, 0, S, S);
  }), 1.5, 1.2],
  // underside of the deck: dark planks along the bridge with rust stains
  soffit: () => [canvas(128, (g, S) => {
    g.fillStyle = '#3c3a37'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) { g.fillStyle = `rgba(0,0,0,0.35)`; g.fillRect(0, y, S, 2); }
    for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(110,60,30,${0.15 + Math.random() * 0.2})`; g.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 6, 10 + Math.random() * 30); }
  }), 2, 2],
  // board-marked concrete: pale, horizontal board lines every 15 cm, a few stains
  concrete: () => [canvas(256, (g, S) => {
    g.fillStyle = '#b8b5ad'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += S / 16) { g.fillStyle = `rgba(80,78,72,${0.18 + Math.random() * 0.12})`; g.fillRect(0, y, S, 1.5); }
    speckle(g, S, 2500, () => { const v = 140 + Math.random() * 60; return `rgba(${v},${v},${v - 6},0.3)`; });
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(70,70,60,0.12)'; g.fillRect(Math.random() * S, 0, 4 + Math.random() * 10, S * (0.3 + Math.random() * 0.7)); }
  }), 2.4, 2.4],
  // a thick hedge / wall of trees (the clean road's side walls, cleanroad.js): dark leaf clusters over shadow
  hedge: () => [canvas(256, (g, S) => {
    // (drawn flat, unlit: the first version's bright leaves read as a lawn stood on end; now mostly shadow with darker,
    // varied leaf clusters, a few lit ones and some twiggy brown)
    g.fillStyle = '#141d10'; g.fillRect(0, 0, S, S);
    const blob = (x, y, r, col) => { g.fillStyle = col; for (const dx of [-S, 0, S]) { g.beginPath(); g.arc(x + dx, y, r, 0, 7); g.fill(); } };
    for (let i = 0; i < 1100; i++) {
      const k = Math.random();
      blob(Math.random() * S, Math.random() * S, 3 + Math.random() * 8, `rgba(${Math.round(28 + k * 34)},${Math.round(44 + k * 44)},${Math.round(20 + k * 16)},${0.6 + Math.random() * 0.35})`);
    }
    for (let i = 0; i < 220; i++) blob(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, `rgba(${90 + Math.random() * 40},${110 + Math.random() * 40},${50 + Math.random() * 20},0.55)`); // leaves in the light
    for (let i = 0; i < 160; i++) blob(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, `rgba(${70 + Math.random() * 25},${55 + Math.random() * 20},${35 + Math.random() * 10},0.45)`); // brown
    for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(5,8,4,0.55)'; g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 6, 2 + Math.random() * 6); }
  }), 3, 3],
  // a mountain road's cut rock face (side walls on hillside routes: the Alpe's hairpins), grey limestone with strata
  rock: () => [canvas(256, (g, S) => {
    g.fillStyle = '#9a958a'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 8 + Math.random() * 16) { g.fillStyle = `rgba(55,50,44,${0.12 + Math.random() * 0.2})`; g.fillRect(0, y, S, 1 + Math.random() * 3); }
    speckle(g, S, 5000, () => { const v = 110 + Math.random() * 80; return `rgba(${v + 6},${v + 3},${v - 6},0.35)`; });
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(40,36,30,0.25)'; g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 10 + Math.random() * 40); } // cracks
    speckle(g, S, 300, () => `rgba(70,88,55,${0.3 + Math.random() * 0.4})`); // tufts of green
  }), 4, 4],
  // red Bristol brick in English bond for a town wall beside the road (side walls), a little grime at the foot
  wallbrick: () => [canvas(256, (g, S) => {
    g.fillStyle = '#a29a8c'; g.fillRect(0, 0, S, S);
    const rows = 16, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const n = r % 2 ? 8 : 4, w = S / n, off = r % 4 === 3 ? w / 2 : 0;
      for (let c = -1; c <= n; c++) {
        const k = 0.82 + Math.random() * 0.3 - (Math.random() < 0.07 ? 0.22 : 0);
        g.fillStyle = `rgb(${Math.round(150 * k)},${Math.round(84 * k)},${Math.round(62 * k)})`;
        g.fillRect(c * w + off + 1.5, r * rh + 1.5, w - 3, rh - 3);
      }
    }
    const grad = g.createLinearGradient(0, 0, 0, S); grad.addColorStop(0, 'rgba(25,22,18,0.3)'); grad.addColorStop(0.4, 'rgba(25,22,18,0)'); g.fillStyle = grad; g.fillRect(0, 0, S, S);
  }), 1.5, 1.2],
  // the headwall's coursed limestone (as portal.glb), for the backing face over / beside the portal
  stone: () => [canvas(256, (g, S) => {
    g.fillStyle = '#c7b89a'; g.fillRect(0, 0, S, S);
    const rows = 6, rh = S / rows;
    for (let r = 0; r < rows; r++) for (let c = -1; c < 4; c++) { const k = 0.9 + Math.random() * 0.18; g.fillStyle = `rgb(${Math.round(203 * k)},${Math.round(186 * k)},${Math.round(153 * k)})`; g.fillRect(c * S / 3 + (r % 2 ? S / 6 : 0) + 2, r * rh + 2, S / 3 - 4, rh - 4); }
    speckle(g, S, 2000, () => 'rgba(110,100,85,0.25)');
  }), 3, 3],
};
const looks = {};
function look(kind) {
  if (looks[kind]) return looks[kind];
  const [image] = (tex[kind] ||= TEXTURES[kind]());
  return (looks[kind] = new C.MaterialAppearance({ material: C.Material.fromType('Image', { image, repeat: new C.Cartesian2(1, 1) }), flat: false, faceForward: true, closed: false }));
}
export const scale = (kind) => (tex[kind] ||= TEXTURES[kind]()).slice(1);
export const kitCanvas = (kind) => (tex[kind] ||= TEXTURES[kind]())[0];
// the same textures unlit-flat (no normals needed), for other modules' surfaces (cleanroad.js side walls)
const flats = {};
export function flatLook(kind) {
  if (flats[kind]) return flats[kind];
  const [image] = (tex[kind] ||= TEXTURES[kind]());
  return (flats[kind] = new C.MaterialAppearance({ material: C.Material.fromType('Image', { image, repeat: new C.Cartesian2(1, 1) }), flat: true, faceForward: true, closed: false }));
}

// ---------- geometry ----------
const bucket = () => ({ pos: [], nrm: [], st: [], idx: [] });
function toGeometry(b, textured) {
  const positions = new Float64Array(b.pos);
  const attributes = {
    position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
    normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(b.nrm) }),
  };
  if (textured) attributes.st = new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(b.st) });
  return new C.Geometry({ attributes, indices: new Uint32Array(b.idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(positions) });
}
const texturedPrim = (b, kind) => new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: toGeometry(b, true) }), appearance: look(kind), asynchronous: false, compressVertices: false });
const colourPrim = (b, colour, flat = false) => new C.Primitive({
  geometryInstances: new C.GeometryInstance({ geometry: toGeometry(b, false), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(colour)) } }),
  appearance: new C.PerInstanceColorAppearance({ flat, faceForward: !flat, translucent: false, closed: false }), asynchronous: false, compressVertices: false,
});

// a strip swept along f..t through the profile points pts ([x, y], in order round the tube), normals towards the axis
// (`cx`, `cy`: the axis point in the cross-section); texture u along the tunnel, v round the profile, in metres
function sweep(b, f, t, pts, kind, cx = 0, cy = 2) {
  const [su, sv] = kind ? scale(kind) : [1, 1], n = pts.length, base0 = b.pos.length / 3;
  const len = [0]; for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  let rows = 0;
  for (let d = f; ; d = Math.min(t, d + STEP), rows++) {
    const axis = at(d, cx, cy);
    for (let i = 0; i < n; i++) {
      const v = at(d, pts[i][0], pts[i][1]);
      const nn = C.Cartesian3.normalize(C.Cartesian3.subtract(axis, v, new C.Cartesian3()), new C.Cartesian3());
      b.pos.push(v.x, v.y, v.z); b.nrm.push(nn.x, nn.y, nn.z); b.st.push((d - f) / su, len[i] / sv);
    }
    if (rows) for (let i = 0; i < n - 1; i++) { const a = base0 + (rows - 1) * n + i, c = base0 + rows * n + i; b.idx.push(a, c, a + 1, a + 1, c, c + 1); }
    if (d >= t) break;
  }
}

// a box at ride distance d: x0..x1 across, y0..y1 up, `len` metres along the road, centred on d (flat-coloured)
function box(b, d, x0, x1, y0, y1, len) {
  const c = [];
  for (const dd of [d - len / 2, d + len / 2]) for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) c.push(at(dd, x, y));
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  const mid = at(d, (x0 + x1) / 2, (y0 + y1) / 2);
  for (const [p, q, r, s] of faces) {
    const base = b.pos.length / 3, fc = C.Cartesian3.multiplyByScalar(C.Cartesian3.add(C.Cartesian3.add(c[p], c[q], new C.Cartesian3()), C.Cartesian3.add(c[r], c[s], new C.Cartesian3()), new C.Cartesian3()), 0.25, new C.Cartesian3());
    const nn = C.Cartesian3.normalize(C.Cartesian3.subtract(fc, mid, new C.Cartesian3()), new C.Cartesian3());
    for (const k of [p, q, r, s]) { b.pos.push(c[k].x, c[k].y, c[k].z); b.nrm.push(nn.x, nn.y, nn.z); }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// the backing face behind a portal: a wall across the road at d from -R to R and up to `top`, with the tube's opening
// (`openTop(x)`: the opening's height at x, 0 outside it) left open; textured in metres; facing back along the route
// (dir +1, an entrance) or forward (-1, an exit)
function backing(b, d, R, top, openTop, kind) {
  const [su, sv] = scale(kind), N = 48;
  const along = C.Cartesian3.normalize(C.Cartesian3.subtract(at(d + 1, 0, 0), at(d, 0, 0), new C.Cartesian3()), new C.Cartesian3());
  for (let i = 0; i < N; i++) {
    const x0 = -R + (2 * R * i) / N, x1 = -R + (2 * R * (i + 1)) / N, y0a = openTop(x0), y0b = openTop(x1);
    if (Math.min(y0a, y0b) >= top) continue;
    const vs = [[x0, y0a], [x1, y0b], [x1, top], [x0, top]], base = b.pos.length / 3;
    for (const [x, y] of vs) { const v = at(d, x, y); b.pos.push(v.x, v.y, v.z); b.nrm.push(along.x, along.y, along.z); b.st.push((x + R) / su, y / sv); }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// a kit model at d, facing down the road (dir +1, an entrance) or up it (-1, an exit), scaled from the size it was
// built for; added to `prims` when loaded unless `alive()` says the tunnels were rebuilt meanwhile
function model(url, d, dir, sx, sz, prims, alive) {
  const p = route.at(d);
  const frame = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(p.lon, p.lat, groundHeight(d)), new C.HeadingPitchRoll(route.tangent(d) + (dir > 0 ? 0 : Math.PI), 0, 0));
  const m4 = C.Matrix4.multiply(frame, C.Matrix4.fromScale(new C.Cartesian3(sx, 1, sz)), new C.Matrix4());
  C.Model.fromGltfAsync({ url, forwardAxis: C.Axis.X, modelMatrix: m4 }).then((m) => {
    if (!alive()) { m.destroy(); return; }
    prims.push(viewer.scene.primitives.add(m));
  }).catch((e) => console.warn('tunnel kit model', url, e));
}

// a point in a portal's own frame: x across (right +), y along the road (+ into the tunnel), z up from the road at the
// portal; dir +1 at an entrance, -1 at an exit (the frame turned round). Straight off the road's direction at d.
function framePoint(d, dir, x, y) {
  const p = route.at(d), h = route.tangent(d), kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const fx = Math.sin(h) * dir, fy = Math.cos(h) * dir, rx = Math.cos(h) * dir, ry = -Math.sin(h) * dir; // forward, right (east, north)
  return [p.lon + (fx * y + rx * x) / kx, p.lat + (fy * y + ry * x) / 110540];
}

// The forecourt in front of a portal: Google's own copy of the bridge abutments / rock face stands in front of the
// portal model and hid it (Bristol's Kingsland Road, 2026-10-26: only the girder's top showed between blue blobs). Cut
// Google's scenery away between the wing walls (the cut's edges run inside the walls, so they hide it), from just
// inside the face out to the wings' ends, and lay paving there at road level. Returns the cut (a ClippingPolygon).
function forecourt(b, d, dir, wing, sx, rw) {
  const [[x0, y0], [x1, y1]] = wing, grow = 0.25;
  const ring = [[-(x0 * sx + grow), 1.5], [x0 * sx + grow, 1.5], [x0 * sx + grow, y0], [x1 * sx + grow, y1], [-(x1 * sx + grow), y1], [-(x0 * sx + grow), y0]];
  const [su, sv] = scale('paving');
  for (const sgn of [-1, 1]) { // ground from the kerb out to the wing, both sides (the clean road is the middle)
    const q = [[sgn * rw, 1.5], [sgn * (x0 * sx), 1.5], [sgn * (x1 * sx), y1], [sgn * rw, y1]], base = b.pos.length / 3;
    for (const [x, y] of q) {
      const [lon, lat] = framePoint(d, dir, x, y), v = C.Cartesian3.fromDegrees(lon, lat, groundHeight(d + y * dir) + 0.12);
      b.pos.push(v.x, v.y, v.z); const up = C.Cartesian3.normalize(v, new C.Cartesian3()); b.nrm.push(up.x, up.y, up.z); b.st.push(x / su, y / sv);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray(ring.flatMap(([x, y]) => framePoint(d, dir, x, y))) });
}

const LAMP = '#ffe7b0', STEEL = '#3e5249', CABLE = '#3a3a3a';

// the whole tunnel: returns the list its primitives go into (models join it as they load)
export function makeTunnel(spec, prims = [], alive = () => true) {
  const { f, t } = spec, style = ['rail', 'gallery', 'underpass'].includes(spec.style) ? spec.style : 'bore';
  const rw = (cleanRoad.width || 4) / 2 + 0.25;                    // kerb line: just outside the clean road's edge
  const W = spec.width ? Math.max(rw + 0.6, spec.width / 2) : rw + 1.15; // wall: a walkway beyond the kerb
  const B = {}, get = (k) => (B[k] ||= bucket());
  spec.polys = [];
  const kerbWalk = (sgn) => {
    sweep(get('kerb'), f, t, [[sgn * rw, -0.1], [sgn * rw, 0.15]], 'kerb', 0, 2);
    sweep(get('paving'), f, t, [[sgn * rw, 0.15], [sgn * W, 0.15]], 'paving', 0, 2);
  };
  let openTop, models = [];
  if (style === 'bore') {
    const crown = spec.height || MODEL.bore.wall + 0.75 * W, wall = Math.max(2.2, crown - 0.75 * W), rise = crown - wall;
    for (const sgn of [-1, 1]) {
      kerbWalk(sgn);
      sweep(get('tiles'), f, t, [[sgn * W, 0.15], [sgn * W, wall]], 'tiles', 0, wall);
      // a cable tray and the lamps along each side, just under the arch's springing
      sweep(get('cable'), f, t, [[sgn * (W - 0.02), wall - 0.55], [sgn * (W - 0.22), wall - 0.55], [sgn * (W - 0.22), wall - 0.45]], null, 0, wall);
      for (let d = f + 4 + (sgn > 0 ? 3 : 0); d < t - 2; d += 6) box(get('lamp'), d, sgn * (W - 0.12), sgn * (W - 0.32), wall + 0.15, wall + 0.32, 1.3);
    }
    const arch = []; for (let k = 0; k <= 24; k++) { const a = Math.PI - (Math.PI * k) / 24; arch.push([W * Math.cos(a), wall + rise * Math.sin(a)]); }
    sweep(get('lining'), f, t, arch, 'lining', 0, wall);
    openTop = (x) => (Math.abs(x) >= W ? 0 : wall + rise * Math.sqrt(Math.max(0, 1 - (x / W) ** 2)));
    const m = MODEL.bore;
    models = [[m.url, W / m.W, crown / (m.wall + 0.75 * m.W)]];
    spec.backing = 'stone';
  } else if (style === 'rail') {
    const H = spec.height || MODEL.rail.H;
    for (const sgn of [-1, 1]) {
      kerbWalk(sgn);
      sweep(get('brick'), f, t, [[sgn * W, 0.15], [sgn * W, H]], 'brick', 0, H / 2);
      for (let d = f + 5 + (sgn > 0 ? 4 : 0); d < t - 3; d += 8) box(get('lamp'), d, sgn * (W - 0.06), sgn * (W - 0.22), 2.9, 3.15, 0.4);
    }
    sweep(get('soffit'), f, t, [[-W, H], [W, H]], 'soffit', 0, 0);
    for (let d = f + 0.8; d < t - 0.5; d += 1.6) box(get('steel'), d, -W, W, H - 0.42, H, 0.22);
    openTop = (x) => (Math.abs(x) >= W ? 0 : H);
    const m = MODEL.rail;
    models = [[m.url, W / m.W, H / m.H]];
    spec.backing = 'brick';
  } else if (style === 'underpass') {
    const H = spec.height || 4.4;
    for (const sgn of [-1, 1]) {
      kerbWalk(sgn);
      sweep(get('concrete'), f, t, [[sgn * W, 0.15], [sgn * W, H]], 'concrete', 0, H / 2);
      for (let d = f + 4 + (sgn > 0 ? 3 : 0); d < t - 2; d += 7) box(get('lamp'), d, sgn * (W - 0.06), sgn * (W - 0.2), 3.0, 3.2, 0.9);
    }
    sweep(get('concrete'), f, t, [[-W, H], [W, H]], 'concrete', 0, 0);
    for (let d = f + 1.2; d < t - 0.8; d += 2.4) box(get('beam'), d, -W, W, H - 0.55, H, 0.6);
    openTop = (x) => (Math.abs(x) >= W ? 0 : H);
    spec.backing = 'concrete';
    // the ends: a fascia beam across the opening and the headwall around it, always (no portal model)
    spec.top = (spec.top || [0, 0]).map((v) => Math.max(v, H + 1.3));
    for (const [d, dir] of [[f, 1], [t, -1]]) box(get('beam'), d + 0.4 * dir, -(W + 0.6), W + 0.6, H - 0.1, H + 1.1, 0.8);
  } else { // gallery: closed on one side, columns on the open side ('left' or 'right' of the direction of travel)
    const H = spec.height || 5.2, os = spec.open === 'right' ? 1 : -1, cs = -os;
    kerbWalk(cs); kerbWalk(os);
    sweep(get('concrete'), f, t, [[cs * W, 0.15], [cs * W, H]], 'concrete', 0, H / 2);
    sweep(get('concrete'), f, t, [[cs * W, H], [os * (W + 0.3), H]], 'concrete', 0, 0);                   // roof
    sweep(get('concrete'), f, t, [[os * (W + 0.3), H], [os * (W + 0.3), H - 0.7], [os * (W - 0.1), H - 0.7]], 'concrete', 0, H / 2); // edge beam
    sweep(get('concrete'), f, t, [[os * W, 0.15], [os * W, 1.0], [os * (W + 0.25), 1.0], [os * (W + 0.25), 0.15]], 'concrete', 0, 0.5); // parapet
    for (let d = f + 1; d <= t - 0.5; d += 5) box(get('column'), d, os * (W - 0.05), os * (W + 0.5), 0.15, H - 0.6, 0.55);
    for (let d = f + 5; d < t - 3; d += 10) box(get('lamp'), d, -0.4, 0.4, H - 0.12, H - 0.02, 0.4);
    openTop = (x) => (Math.abs(x) >= W + 0.3 ? 0 : H);
    spec.backing = 'concrete';
  }

  // portals: the style's model at each end, scaled to this tube, with a backing face 1.3 m behind it that reaches as
  // high / wide as the rock or embankment the clean road cut through (top / wide from tunnels.js); a gallery's end is
  // just its roof's edge and the closed wall
  for (const [d, dir, k] of [[f, 1, 0], [t, -1, 1]]) {
    const top = spec.top?.[k] ?? 0, R = Math.max(W + 4, spec.wide?.[k] || 0);
    if (top > openTop(0) + 0.2) backing(get('back'), d + 1.3 * dir, R, top, openTop, spec.backing);
    for (const [url, sx, sz] of models) model(url, d, dir, sx, sz, prims, alive);
    if (MODEL[style]) spec.polys.push(forecourt(get('paving'), d, dir, MODEL[style].wing, models[0][1], rw));
  }

  if (style !== 'bore') {
    const left = [], right = [];
    for (let d = f - 1.5; ; d = Math.min(t + 1.5, d + 4)) { left.push(offset(d, -(W + 0.4))); right.push(offset(d, W + 0.4)); if (d >= t + 1.5) break; }
    spec.polys.push(new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray([...left, ...right.reverse()].flat()) }));
  }
  for (const [k, b] of Object.entries(B)) {
    if (!b.pos.length) continue;
    if (k === 'lamp') prims.push(viewer.scene.primitives.add(colourPrim(b, LAMP, true)));
    else if (k === 'steel') prims.push(viewer.scene.primitives.add(colourPrim(b, STEEL)));
    else if (k === 'cable') prims.push(viewer.scene.primitives.add(colourPrim(b, CABLE)));
    else if (k === 'column' || k === 'beam') prims.push(viewer.scene.primitives.add(colourPrim(b, '#aeaba3')));
    else prims.push(viewer.scene.primitives.add(texturedPrim(b, k === 'back' ? spec.backing : k)));
  }
  return prims;
}
