// Experimental "clean road": Google's 3D model is at its worst on the road itself (parked cars melted into blobs,
// bins, odd lumps). This cuts the model out in a strip along the route around the rider (Cesium clipping polygons)
// and lays our own plain road surface there at the measured road height, slightly wider than the cut, with a bank
// down each side to wherever Google's ground is just beyond the cut (up a hillside, down a drop), tucked under the
// model's cut edge so no gap shows. Without the banks, the uphill side of a hillside road showed a gap into the
// hollow inside of Google's model (the owner, 2026-10-17).
// The cut only covers stretches the road survey has already measured (clipped areas can't be measured: Cesium
// removes them when drawing), from 120 m behind the rider to 260 m ahead (the survey runs up to 400 m ahead), and
// is off while the route editor is open (it re-measures the road). K toggles it during a ride to compare.
import { $, C, median, route, state, store, toast } from './core.js';
import { viewer } from './scenery.js';
import { groundHeight, measuredAround, SURVEY_STEP } from './survey.js';
import { tunnels } from './tunnels.js';
import { earthworks, inSite } from './earthworks.js';
import { landmarks } from './landmarks.js';
import { ed } from './editor.js';
import { remotes } from './riders.js';
import { flatLook, kitCanvas, scale as kitScale } from './tunnelkit.js';

const BEHIND = 120, AHEAD = 260, STEP = 2, REBUILD = 40;
const EXTRA = 30; // metres of road laid beyond the start and the finish
export const cleanRoad = { prim: null, at: -1e9, version: -1, width: 4, chosen: 4, busyUntil: 0 }; // width: as laid now; chosen: the setting
// Busy road (4+ other riders within 60 m, Zwift-style crowds): widen to at least BUSY_W, and keep it for 30 s after
// the bunch thins out so the road doesn't keep changing. Riders keep inside it (laneLimit).
const BUSY_W = 6;
export const laneLimit = () => (state.cleanRoad ? Math.max(0.6, cleanRoad.width / 2 - 0.45) : 2.2);
function widthForCrowd() {
  const near = [...remotes.values()].filter((r) => !r.ghost && Math.abs(r.dist - state.dist) < 60).length;
  const now = performance.now();
  if (near >= 4) cleanRoad.busyUntil = now + 30000;
  const want = now < cleanRoad.busyUntil ? Math.max(cleanRoad.chosen, BUSY_W) : cleanRoad.chosen;
  if (want !== cleanRoad.width) {
    cleanRoad.width = want;
    texture = null; appearance = null; cobbleTex = null; cobbleLook = null; // drawn to the road's width
    cleanRoad.at = -1e9;
  }
}

let texture = null;
function asphalt() {
  if (texture) return texture;
  // one tile = the road's width (plus the 30 cm tucked under each edge) by 6 m along
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#7a7d83'; g.fillRect(0, 0, c.width, c.height); // close to Google's sunlit road grey
  for (let i = 0; i < 9000; i++) { // grain
    const v = 95 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  const edge = g.createLinearGradient(0, 0, c.width, 0); // a little darker at the edges, like kerb shadow
  edge.addColorStop(0, 'rgba(0,0,0,.28)'); edge.addColorStop(0.08, 'rgba(0,0,0,0)'); edge.addColorStop(0.92, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,.28)');
  g.fillStyle = edge; g.fillRect(0, 0, c.width, c.height);
  const px = (m) => (m / (cleanRoad.width + 0.6)) * c.width; // metres across -> pixels (30 cm tucked under each side)
  // edge lines like an American highway (the owner): solid light grey, 12 cm wide, 20 cm in from each edge, with the
  // shoulder outside them a touch lighter
  const edgeIn = px(0.3 + 0.2), edgeW = Math.max(3, px(0.12));
  g.fillStyle = 'rgba(205,207,210,0.18)';
  g.fillRect(0, 0, edgeIn, c.height); g.fillRect(c.width - edgeIn, 0, edgeIn, c.height);
  g.fillStyle = 'rgba(214,216,218,0.9)';
  g.fillRect(edgeIn, 0, edgeW, c.height); g.fillRect(c.width - edgeIn - edgeW, 0, edgeW, c.height);
  // dashed white centre line: 2 m dash, 4 m gap, about 10 cm wide (the owner: "we've laid this road for you")
  const lineW = Math.max(4, Math.round(px(0.1)));
  g.fillStyle = 'rgba(242,242,236,0.92)';
  g.fillRect(c.width / 2 - lineW / 2, 0, lineW, Math.round(c.height / 3));
  for (let i = 0; i < 400; i++) { // wear on the paint
    g.fillStyle = `rgba(110,112,116,${Math.random() * 0.35})`;
    g.fillRect(c.width / 2 - lineW / 2 + Math.random() * lineW, Math.random() * (c.height / 3), 1.5, 1.5);
  }
  return (texture = c);
}

// Cobbles (setts), for the stretches OSM tags as cobbled (route.cobbles; the owner 2026-10-21: "draw the clean road as
// cobbles there"). Rows of rounded grey-brown stones about 14 x 11 cm with dark sandy joints, each a slightly
// different shade, the middle a little smoother and paler where the wheels go. No markings. Same tile as the asphalt:
// the road's width across by 6 m along.
let cobbleTex = null, cobbleLook = null;
function cobbleTexture() {
  if (cobbleTex) return cobbleTex;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 640;
  const g = c.getContext('2d');
  const W = cleanRoad.width + 0.6, pxX = c.width / W, pxY = c.height / 6; // pixels per metre across / along
  g.fillStyle = '#4a4740'; g.fillRect(0, 0, c.width, c.height); // the joints
  const rowH = 0.11 * pxY;
  for (let row = 0, y = 0; y < c.height; row++, y += rowH) {
    const w0 = 0.14 * pxX, shift = (row % 2) * w0 * 0.5 + (Math.random() - 0.5) * w0 * 0.3;
    for (let x = -w0 + shift; x < c.width; ) {
      const w = w0 * (0.8 + Math.random() * 0.45), gap = 1.6, h = rowH - gap;
      const across = (x + w / 2) / c.width, wheel = Math.exp(-(((across - 0.5) / 0.22) ** 2)); // worn smoother mid-road
      const v = 112 + Math.random() * 38 + wheel * 14, warm = Math.random() * 12;
      g.fillStyle = `rgb(${v + warm},${v + warm * 0.6},${v - 6})`;
      const r = Math.min(w, h) * 0.32;
      g.beginPath(); g.roundRect(x + gap / 2, y + gap / 2, w - gap, h, r); g.fill();
      // a highlight on top and a shade underneath, so each stone looks domed
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + gap / 2 + r * 0.5, y + gap / 2 + 1, Math.max(1, w - gap - r), Math.max(1, h * 0.25));
      g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + gap / 2 + r * 0.3, y + gap / 2 + h * 0.72, Math.max(1, w - gap - r * 0.6), Math.max(1, h * 0.25));
      x += w;
    }
  }
  for (let i = 0; i < 5000; i++) { // grit
    const v = 60 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.15 + Math.random() * 0.2})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1);
  }
  const edge = g.createLinearGradient(0, 0, c.width, 0); // darker at the edges, like the asphalt
  edge.addColorStop(0, 'rgba(0,0,0,.3)'); edge.addColorStop(0.07, 'rgba(0,0,0,0)'); edge.addColorStop(0.93, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,.3)');
  g.fillStyle = edge; g.fillRect(0, 0, c.width, c.height);
  return (cobbleTex = c);
}
function cobbleAppearance() {
  if (!cobbleLook) setTimeout(applyTint);
  return (cobbleLook ||= new C.MaterialAppearance({
    material: C.Material.fromType('Image', { image: cobbleTexture(), repeat: new C.Cartesian2(1, 1) }),
    flat: true, faceForward: true, closed: false,
    renderState: ROAD_FIRST,
  }));
}

// One appearance for every rebuild of the strip: a new material per rebuild loads its texture afresh and draws plain
// white for a frame first (the white flash every 40 m). Removing a Primitive doesn't destroy its appearance.
// (pulled towards the camera so it always wins over the open world's road layer and the terrain where they overlap:
// the layer sits a few cm over the terrain, and it painted over the ridden road's markings, the owner 2026-11-15)
const ROAD_FIRST = { depthTest: { enabled: true }, depthMask: true, cull: { enabled: false }, polygonOffset: { enabled: true, factor: -1, units: -16 } };
let appearance = null;
// the open world's road layer (world.js): the same asphalt and markings as the ridden road, but drawn behind it
let layerLook = null;
export function layerAppearance() {
  return (layerLook ||= new C.MaterialAppearance({ material: roadAppearance().material, flat: true, faceForward: true, closed: false,
    renderState: { ...ROAD_FIRST, polygonOffset: { enabled: true, factor: -3, units: -48 } } })); // (well in front of the coarse terrain, which poked through)
}
export function roadAppearance() {
  if (!appearance) setTimeout(applyTint);
  return (appearance ||= new C.MaterialAppearance({
    material: C.Material.fromType('Image', { image: asphalt(), repeat: new C.Cartesian2(1, 1) }),
    flat: true, faceForward: true, closed: false,
    renderState: ROAD_FIRST,
  }));
}

// The banks: earth and rock, a little darker at the foot
let bankTexture = null, bankLook = null;
function bankAppearance() {
  if (!bankTexture) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = 128; c.height = 256;
    g.fillStyle = '#6f6c60'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 2600; i++) {
      const v = 70 + Math.random() * 70;
      g.fillStyle = `rgba(${v + 8},${v + 6},${v - 4},${0.25 + Math.random() * 0.35})`;
      g.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    const foot = g.createLinearGradient(0, 0, c.width, 0);
    foot.addColorStop(0, 'rgba(30,30,28,0.45)'); foot.addColorStop(0.35, 'rgba(30,30,28,0)');
    g.fillStyle = foot; g.fillRect(0, 0, c.width, c.height);
    bankTexture = c;
  }
  return (bankLook ||= new C.MaterialAppearance({
    material: C.Material.fromType('Image', { image: bankTexture, repeat: new C.Cartesian2(1, 1) }),
    flat: true, faceForward: true, closed: false,
  }));
}

// The ground apron (see updateCleanRoad): the banks' earth without their dark foot (repeated across the apron every
// 4 m it ploughed it into stripes), tinted with them
let apronLook = null;
function apronAppearance() {
  if (!apronLook) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = 128; c.height = 128;
    g.fillStyle = '#6f6c60'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 1300; i++) {
      const v = 70 + Math.random() * 70;
      g.fillStyle = `rgba(${v + 8},${v + 6},${v - 4},${0.25 + Math.random() * 0.35})`;
      g.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    apronLook = new C.MaterialAppearance({
      material: C.Material.fromType('Image', { image: c, repeat: new C.Cartesian2(1, 1) }),
      flat: true, faceForward: true, closed: false,
    });
    applySideTint();
  }
  return apronLook;
}

// Google's ground just beyond the cut on one side (-1 left, +1 right) at d, absolute height, or null. The reading
// just outside the cut (2.5 m out for a 4 m road, 3.5 m for a wider one), then
// the median over 30 m so one tree or parked van doesn't raise a bank, blended between stations (stepping from one
// station's value to the next made a saw-toothed bank top). None under a bridge or in a tunnel (route.zones): the
// "ground" beside the road there is the deck or the mountain overhead.
// an 'under' zone where the bridge overhead is the route itself (Sa Calobra's bowtie): there the banks may rise to
// the deck, standing in for the bridge's abutments (with none, the lower road's cut showed black walls into space)
const ownBridges = new WeakMap();
function underOwnRoad(f, t) {
  let m = ownBridges.get(route); if (!m) ownBridges.set(route, (m = new Map()));
  const key = f + ':' + t;
  if (!m.has(key)) {
    const mid = route.at((f + t) / 2), kx = 111320 * Math.cos((mid.lat * Math.PI) / 180);
    let own = false;
    for (let e = 0; e <= route.length && !own; e += 5) if (Math.abs(e - (f + t) / 2) > 40) { const q = route.at(e); own = Math.hypot((q.lat - mid.lat) * 110540, (q.lon - mid.lon) * kx) < 8; }
    m.set(key, own);
  }
  return m.get(key);
}

function edgeGround(d, side) {
  if ((route.zones || []).some(([f, t, type]) => d >= f && d <= t && !(type === 'under' && underOwnRoad(f, t)))) return null;
  if (tunnels.list.some(([f, t]) => d >= f - 3 && d <= t + 3)) return null; // in a 3D tunnel stretched past OSM's (tunnels.js)
  if (inSite(d)) return null; // earthworks.js builds the sides there
  const f = d / SURVEY_STEP, i0 = Math.floor(f), a = edgeAt(i0, side), b = edgeAt(i0 + 1, side);
  // on a 'use my heights' stretch, a missing reading borrows the nearest one within 60 m: there the road cuts
  // through Google's false humps, and without a reading the bank was a 1.5 m skirt with black above it (Cap 10.6 mi)
  if (a === null && b === null && (route.mine?.() || []).some(([x, y]) => d >= x && d <= y)) {
    for (let k = 1; k <= 6; k++) { const e = edgeAt(i0 - k, side) ?? edgeAt(i0 + 1 + k, side); if (e !== null) return e; }
  }
  if (a === null || b === null) return a ?? b;
  return a + (b - a) * (f - i0);
}
// Side walls (routes.json `sideWalls`: [[fromKm, toKm, 'hedge' | 'brick' | 'concrete' | 'rock']], full-route km, set by hand): where the road
// runs between trees or walls, the cut slices Google's canopy / walls open and the banks (a slope up to the ground just
// beyond the cut, smoothed over 30 m) left black and dark-blue gaps above them (Bristol's Railway Path, the owner
// 2026-10-26: "cutting into a lot of vegetation so there are plenty of black empty spaces where the grey walls aren't
// covering"). There the bank is a flat verge and a wall stands at its outer edge, up to the HIGHEST reading within
// 20 m either side (+40 cm), at most 18 m, carried through stretches with no readings (under bridges).
const SIDE = { hedge: 'hedge', brick: 'wallbrick', concrete: 'concrete', rock: 'rock' };
function sideWallAt(d) {
  if (tunnels.list.some(([f, t]) => d >= f - 1 && d <= t + 1)) return null; // the tunnel has its own walls
  // (Lite: no Google canopy to cover, so plain banks, the generated world bringing real hedges (world.js); a hand-placed
  // wall shows in Lite only when its entry says so, a 4th element 'lite': CCCP's M5 underpass approaches, 2026-11-14)
  const w = (route.opts?.sideWalls || []).find(([a, b, , mode]) => (!state.lite || mode === 'lite') && d >= route.m(a) && d <= route.m(b));
  return w ? SIDE[w[2]] || 'hedge' : null;
}
function rawEdge(i, side) {
  const e = state.survey.edge[i];
  if (!e) return NaN;
  const a = side < 0 ? e[0] : e[1], b = side < 0 ? e[2] : e[3];
  return Math.max(Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : -Infinity);
}
const wallTops = new Map(); // side -> last top used (carried over gaps)
// (2026-10-27: a median and a 5 m cap for rock walls, against "the fill in walls are poking up everywhere", opened
// black slots above hairpins on the Alpe, where the tall walls had been hiding the clean road's cut through the hill:
// the owner "it was pretty much perfect and now suddenly there are quite a few problems". Back as it was.)
function wallTop(d, side) {
  const f = d / SURVEY_STEP, i0 = Math.floor(f);
  const top = (i) => { let m = -Infinity; for (let k = i - 2; k <= i + 2; k++) m = Math.max(m, rawEdge(k, side)); return m; };
  let a = top(i0), b = top(i0 + 1);
  if (!Number.isFinite(a)) a = b; if (!Number.isFinite(b)) b = a;
  if (!Number.isFinite(a)) return wallTops.get(side) ?? null;
  const v = a + (b - a) * (f - i0);
  wallTops.set(side, v);
  return v;
}

function edgeAt(i, side) {
  const edge = state.survey.edge;
  const at = (i) => {
    const e = edge[i];
    if (!e) return NaN;
    const a = side < 0 ? e[0] : e[1], b = side < 0 ? e[2] : e[3];
    const near = cleanRoad.width / 2 <= 2.25 ? a : b;
    return Number.isFinite(near) ? near : Number.isFinite(a) ? a : b;
  };
  const near = [];
  for (let k = i - 1; k <= i + 1; k++) if (Number.isFinite(at(k))) near.push(at(k));
  return near.length >= 2 ? median(near) : null;
}

const enabled = () => state.cleanRoad && !state.vpNoClean && state.tileset && !ed.on && C.ClippingPolygonCollection?.isSupported(viewer.scene);

function clear() {
  if (cleanRoad.prim) { viewer.scene.primitives.remove(cleanRoad.prim); cleanRoad.prim = null; }
  if (cleanRoad.cobbles) { viewer.scene.primitives.remove(cleanRoad.cobbles); cleanRoad.cobbles = null; }
  if (cleanRoad.banks) { viewer.scene.primitives.remove(cleanRoad.banks); cleanRoad.banks = null; }
  if (cleanRoad.apron) { viewer.scene.primitives.remove(cleanRoad.apron); cleanRoad.apron = null; }
  for (const p of cleanRoad.walls || []) viewer.scene.primitives.remove(p);
  cleanRoad.walls = [];
  // only our own cuts: the landmarks' clips (landmarks.js) stay
  for (const p of cleanRoad.polys || []) if (state.tileset?.clippingPolygons?.contains(p)) state.tileset.clippingPolygons.remove(p);
  cleanRoad.polys = [];
  cleanRoad.at = -1e9;
}

// lon/lat of the point `side` metres right of the route at d
// (beyond either end of the route the road carries straight on, so the start line isn't the edge of the world:
// the owner's rider was half buried in the hillside behind Sa Calobra's start)
function offset(d, side) {
  const end = Math.max(0, Math.min(route.length, d)), e = d - end;
  const p = route.at(end), h = route.tangent(end), kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  return [p.lon + (Math.sin(h) * e + Math.cos(h) * side) / kx, p.lat + (Math.cos(h) * e - Math.sin(h) * side) / 110540];
}
// the road's height, carried on at the same slope beyond either end
function roadHeight(d) {
  if (d >= 0 && d <= route.length) return groundHeight(d);
  const end = d < 0 ? 0 : route.length, back = d < 0 ? Math.min(route.length, 10) : Math.max(0, route.length - 10);
  const slope = (groundHeight(end) - groundHeight(back)) / ((end - back) || 1);
  return groundHeight(end) + slope * (d - end);
}

// every frame; rebuilds the strip every 40 m (or when the survey has measured more)
// [earlier, later] distances where the route's line between `from` and `to` crosses an earlier part of itself more
// than 30 m back along the route; checked on 5 m chords
function selfCrossings(from, to) {
  const step = 5, pts = [];
  for (let d = Math.max(0, from); d <= Math.min(route.length, to); d += step) { const p = route.at(d); pts.push([d, p.lon * Math.cos((p.lat * Math.PI) / 180), p.lat]); }
  const out = [];
  const cross = (p, q, r, s) => { const d = (q[1] - p[1]) * (s[2] - r[2]) - (q[2] - p[2]) * (s[1] - r[1]); if (!d) return false;
    const t = ((r[1] - p[1]) * (s[2] - r[2]) - (r[2] - p[2]) * (s[1] - r[1])) / d, u = ((r[1] - p[1]) * (q[2] - p[2]) - (r[2] - p[2]) * (q[1] - p[1])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  for (let j = 1; j < pts.length; j++) for (let i = 1; i < j && pts[j][0] - pts[i][0] > 30; i++) {
    if (cross(pts[i - 1], pts[i], pts[j - 1], pts[j])) { out.push([pts[i][0] - step / 2, pts[j][0] - step / 2]); break; }
  }
  return out;
}

// Tint (setting "Match the scenery's road colour", rw.roadTint; the owner 2026-10-21: "sometimes the clean road looks
// really out of place"). Every 2 s, right after a frame is drawn, 16 tiny patches of Google's road just beyond our
// road's edges 15-50 m ahead are copied off the screen; greyish ones (roads, not grass, sky or cars) give a median
// colour, and the road's texture is multiplied towards it, eased, so the markings and texture stay. Off: plain.
const TEX_GREY = [118, 121, 127]; // the asphalt texture's average colour, as drawn (flat shaded)
let tint = [1, 1, 1], tintAt = 0, tintBusy = false, patch = null;
const tintOn = () => store.get('roadTint', '1') === '1'; // on by default since 2026-10-21 (the owner: "amazing")
function applyTint() {
  const c = tintOn() ? new C.Color(tint[0], tint[1], tint[2], 1) : C.Color.WHITE;
  for (const look of [appearance, cobbleLook]) if (look) look.material.uniforms.color = c;
}
function sampleTint() {
  if (tintBusy || !tintOn() || performance.now() - tintAt < 2000) return;
  tintAt = performance.now(); tintBusy = true;
  const sc = viewer.scene, half = cleanRoad.width / 2, pts = [];
  for (const a of [15, 25, 35, 50]) for (const x of [-(half + 2.6), -(half + 1.6), half + 1.6, half + 2.6]) {
    const dd = state.dist + a; if (dd > route.length) continue;
    const [lon, lat] = offset(dd, x);
    pts.push(C.Cartesian3.fromDegrees(lon, lat, roadHeight(dd) + 0.1));
  }
  const off = sc.postRender.addEventListener(() => {
    off(); tintBusy = false;
    const cv = viewer.canvas;
    patch ||= document.createElement('canvas'); patch.width = 3 * 16; patch.height = 3;
    const g = patch.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, patch.width, patch.height);
    let k = 0;
    for (const p of pts) {
      const s = C.SceneTransforms.worldToDrawingBufferCoordinates(sc, p);
      if (!s || s.x < 2 || s.y < 2 || s.x > cv.width - 3 || s.y > cv.height - 3) continue;
      g.drawImage(cv, Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3, k * 3, 0, 3, 3); k++;
    }
    if (k < 4) return;
    const px = g.getImageData(0, 0, k * 3, 3).data, cols = [];
    for (let i = 0; i < px.length; i += 4) {
      const [r, gg, b] = [px[i], px[i + 1], px[i + 2]], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), m = (r + gg + b) / 3;
      if (px[i + 3] && mx - mn <= 30 && m >= 40 && m <= 225) cols.push([r, gg, b]);
    }
    if (cols.length < 12) return; // too few road-coloured pixels: keep the tint we have
    const med = [0, 1, 2].map((c) => cols.map((x) => x[c]).sort((a, b) => a - b)[cols.length >> 1]);
    const want = med.map((v, c) => 1 + (Math.min(1.6, Math.max(0.55, v / TEX_GREY[c])) - 1) * 0.85);
    tint = tint.map((v, c) => v + (want[c] - v) * 0.35);
    applyTint();
  });
}

// Banks and hedges take the scenery's colours too (the owner 2026-10-26: "the colours always stick out too much and don't
// blend in"): with the road tint, every 2 s (staggered by 1 s), pixels just beyond each bank's top (Google's ground
// beside the road) and just above each hedge's top (the trees behind it) 15-50 m ahead are read off the screen; sky
// (bright blue-white) and near-black are left out; the median colour against each texture's own average sets its
// multiplier, eased, 85% of the way, clamped 0.45-1.8. Brick walls keep their own colour.
const sideTint = { bank: [1, 1, 1], hedge: [1, 1, 1], rock: [1, 1, 1] }, texAvg = {};
let sideAt = 1000, sideBusy = false, sidePatch = null;
function averageOf(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, a = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) a[c] += d[i + c];
  return a.map((v) => v / (d.length / 4));
}
function applySideTint() {
  const on = tintOn();
  if (bankLook) bankLook.material.uniforms.color = on ? new C.Color(...sideTint.bank, 1) : C.Color.WHITE;
  if (apronLook) apronLook.material.uniforms.color = on ? new C.Color(...sideTint.bank, 1) : C.Color.WHITE;
  for (const k of ['hedge', 'rock']) flatLook(k).material.uniforms.color = on ? new C.Color(...sideTint[k], 1) : C.Color.WHITE;
}
function sampleSides() {
  if (sideBusy || !tintOn() || performance.now() - sideAt < 2000) return;
  sideAt = performance.now(); sideBusy = true;
  texAvg.bank ||= averageOf(bankTexture || (bankAppearance(), bankTexture));
  texAvg.hedge ||= averageOf(kitCanvas('hedge'));
  texAvg.rock ||= averageOf(kitCanvas('rock'));
  const sc = viewer.scene, half = cleanRoad.width / 2, pts = { bank: [], hedge: [], rock: [] };
  for (const a of [15, 25, 35, 50]) for (const side of [-1, 1]) {
    const dd = state.dist + a; if (dd > route.length) continue;
    const kind = sideWallAt(dd), tinted = kind === 'hedge' || kind === 'rock', hgt = roadHeight(dd), wall = tinted ? wallTop(dd, side) : null;
    for (const out of [1.5, 3]) {
      if (wall !== null && wall - hgt > 1.2) { const [lon, lat] = offset(dd, side * (half + out)); pts[kind].push(C.Cartesian3.fromDegrees(lon, lat, wall + 0.8 + out / 2)); }
      else { const e = edgeGround(dd, side); if (e === null) continue; const [lon, lat] = offset(dd, side * (half + 1 + out)); pts.bank.push(C.Cartesian3.fromDegrees(lon, lat, e + 0.2)); }
    }
  }
  wallTops.clear();
  const off = sc.postRender.addEventListener(() => {
    off(); sideBusy = false;
    const cv = viewer.canvas;
    sidePatch ||= document.createElement('canvas'); sidePatch.width = 3 * 32; sidePatch.height = 3;
    const g = sidePatch.getContext('2d', { willReadFrequently: true });
    for (const kind of ['bank', 'hedge', 'rock']) {
      g.clearRect(0, 0, sidePatch.width, 3);
      let k = 0;
      for (const p of pts[kind]) {
        const s = C.SceneTransforms.worldToDrawingBufferCoordinates(sc, p);
        if (!s || s.x < 2 || s.y < 2 || s.x > cv.width - 3 || s.y > cv.height - 3 || k >= 32) continue;
        g.drawImage(cv, Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3, k * 3, 0, 3, 3); k++;
      }
      if (k < 4) continue;
      const px = g.getImageData(0, 0, k * 3, 3).data, cols = [];
      for (let i = 0; i < px.length; i += 4) {
        const [r, gg, b] = [px[i], px[i + 1], px[i + 2]], m = (r + gg + b) / 3;
        const sky = b > r + 25 && b > gg + 5 && m > 120; // sky over the trees
        if (px[i + 3] && m >= 25 && !sky) cols.push([r, gg, b]);
      }
      if (cols.length < 12) continue;
      const med = [0, 1, 2].map((c) => cols.map((x) => x[c]).sort((a, b) => a - b)[cols.length >> 1]);
      const want = med.map((v, c) => 1 + (Math.min(1.8, Math.max(0.45, v / Math.max(1, texAvg[kind][c]))) - 1) * 0.85);
      sideTint[kind] = sideTint[kind].map((v, c) => v + (want[c] - v) * 0.35);
    }
    applySideTint();
  });
}

export function updateCleanRoad() {
  if (!viewer || !route) return;
  // (open worlds: none at all; the rider rides on the area's drawn roads, world.js, and a choice changes nothing drawn.
  // the owner 2026-11-15: "why can't you just draw every road ... and have the rider navigate around these predrawn roads")
  if (!enabled() || route.opts?.open) { if (cleanRoad.prim || cleanRoad.polys?.length) clear(); return; }
  sampleTint();
  sampleSides();
  widthForCrowd();
  const measured = state.survey.raw.length * SURVEY_STEP - 30;
  if (Math.abs(state.dist - cleanRoad.at) < REBUILD && cleanRoad.version === state.survey.version) return;
  cleanRoad.at = state.dist;
  cleanRoad.version = state.survey.version;
  // only over road measured without a gap around the rider: after a scrub back into a skipped stretch, nothing until
  // surveyAhead has measured it (Google's own road shows meanwhile), then from the start of the measured run
  const run = measuredAround(state.dist);
  if (!run) { if (cleanRoad.prim || cleanRoad.polys?.length) clear(); return; }
  const surveyedAll = run[0] === 0 && run[1] + SURVEY_STEP >= route.length;
  // (no road past the finish when a landmark stands there: it ran on past the Formentor café)
  const endExtra = landmarks.list.some((L) => { const p = route.at(route.length); return Math.hypot((p.lon - L.lon) * 85000, (p.lat - L.lat) * 110540) < 80; }) ? 0 : EXTRA;
  const from = Math.max(-EXTRA, state.dist - BEHIND, run[0] > 0 ? run[0] + 10 : -EXTRA), to = Math.min(route.length + (surveyedAll ? endExtra : 0), state.dist + AHEAD, state.roadEnd ?? Infinity, surveyedAll ? Infinity : Math.min(measured, run[1] - 30)); // (roadEnd: the open world's next junction, openworld.js)
  if (to - from < 20) { clear(); return; }
  const half = cleanRoad.width / 2;
  // the cut: a ring up one side and back down the other. Not inside a 3D tunnel (tunnels.js) beyond 8 m from its
  // portals: the tube is the inside, and the mountain over it stays whole (the cut showed as a black slot across it)
  let spans = [[from, to]];
  // Clipping polygons cut everything above the road too: under a high bridge that sliced a gap through its deck (the owner
  // 2026-10-26: "why is there a gap in Clifton bridge here?", the Portway under the Suspension Bridge, 70 m up). So
  // the cut stops for 16 m under any mapped bridge more than 10 m over the road (Google's own road shows there).
  // (Not in Lite: the terrain has no decks, only humps where the map's heights include a junction, and the rule left them
  // standing across the road as walls: the owner's reports at Bristol's Cumberland Basin, 2026-11-14)
  const highDecks = state.lite ? [] : (route.zones || []).filter(([f, t, type]) => type === 'under' && [-8, 0, 8].some((k) => (state.survey.over?.[Math.round(((f + t) / 2 + k) / SURVEY_STEP)] ?? -Infinity) - groundHeight((f + t) / 2) > 10)).map(([f, t]) => [(f + t) / 2 - 8, (f + t) / 2 + 8]);
  // (Lite: the coarse terrain dips through a tube's roof, so it's cut all the way: Brighton Marina 2026-11-14)
  const holes = [...(state.lite ? [] : tunnels.list.map(([f, t]) => [f + 8, t - 8])), ...earthworks.viaducts.map(([a, b]) => [a - 5, b + 5]), ...highDecks]; // a viaduct stands over Google's ground: nothing to cut under it (earthworks.js clips any cutting beside its ends)
  for (const [f, t] of holes) spans = spans.flatMap(([a, b]) => (f >= b || t <= a ? [[a, b]] : [[a, f], [t, b]].filter(([x, y]) => y - x > 2)));
  // Where the road crosses over itself inside the cut (Sa Calobra's bowtie), one ring up one side and back down the
  // other crosses itself too, and Cesium then clipped whole areas around the crossing: a wide black gap into space
  // (the owner 2026-10-21). Split each span just before its second pass, so every piece is a simple ring (they overlap
  // at the crossing, which is fine). (Leaving the crossing uncut instead let Google's lumpy road cover ours.)
  for (const [, d2] of selfCrossings(from, to)) { const c = d2 - half - 1; spans = spans.flatMap(([a, b]) => (c > a + 2 && c < b - 2 ? [[a, c + 0.5], [c, b]] : [[a, b]])); }
  if (!state.tileset.clippingPolygons) state.tileset.clippingPolygons = new C.ClippingPolygonCollection();
  for (const p of cleanRoad.polys || []) state.tileset.clippingPolygons.remove(p);
  cleanRoad.polys = spans.map(([a, b]) => {
    const left = [], right = [];
    for (let d = a; d <= b; d += STEP) { left.push(offset(d, -half)); right.push(offset(d, half)); }
    left.push(offset(b, -half)); right.push(offset(b, half));
    return new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray([...left, ...right.reverse()].flat()) });
  });
  for (const p of cleanRoad.polys) state.tileset.clippingPolygons.add(p);
  // the surface (30 cm wider than the cut each side) and, outside it, a bank each side out to 0.8 m beyond the cut,
  // its outer edge 80 cm out and 15 cm above Google's ground there, so it meets the model's cut edge instead of
  // stopping short of it (black gaps on hairpins, the owner 2026-10-17) (up to 15 m up or down; with no
  // reading, a plain 1.5 m skirt down as before)
  const pos = [], st = [], idx = [], cidx = [], bpos = [], bst = [], bidx = [], wpos = [], wst = [], widx = {};
  // the ground apron (the owner 2026-10-27, Central Park and under the West Side Highway: "a lot of nether regions showing
  // through. Are we not able to put a default base underneath shaded as an average of the surrounding colours?"):
  // Google's model is one skin over everything, so where trees, a deck or a viaduct stand over the road nothing is
  // modelled beneath them, and looking out from under them showed black. On a side covered like that (Google's surface
  // over 3 m above the road, or no reading under a bridge) a floor in the banks' colours (tinted from the scenery
  // around, sampleSides) runs from the bank's edge down to road level and out to 40 m. Never where the ground beside
  // is at or below the road (open ground, valleys): no shelves over real scenery. Against a real hillside it's inside
  // the hill, out of sight.
  const apos = [], ast = [], aidx = [], aOn = [];
  const APRON = 40;
  const wallOn = []; // per row: [left style | null, right style | null]
  wallTops.clear();
  const cob = route.cobbles, cobbled = (d) => cob.some(([a, b]) => d >= a && d <= b);
  const put = (arr, d, side, h) => { const [lon, lat] = offset(d, side); const c = C.Cartesian3.fromDegrees(lon, lat, h); arr.push(c.x, c.y, c.z); };
  let row = 0;
  const mine = route.mine?.() || [];
  // which rows have a side wall, decided first so that a short break between two walls can be bridged: a rock wall
  // went off for a few metres wherever the uphill test dipped, and the gap between the two pieces showed the cut through
  // the hill (the owner 2026-10-27, Alpe 4.44 km: "gaps here because it's 2 separate walls?")
  const wallRows = [];
  for (let d = from; d <= to + 0.01; d += STEP) {
    const hgt = roadHeight(d) + 0.03;
    wallRows.push([-1, 1].map((side) => {
      const sw = sideWallAt(d), wt = sw ? wallTop(d, side) : null;
      // a rock wall only on the uphill side (where the ground just beyond the cut, not trees, rises over the road):
      // on the Alpe's downhill side it hid the valley
      const uphill = sw !== 'rock' || (edgeGround(d, side) ?? -Infinity) - hgt > 1.2;
      return sw && uphill && wt !== null && wt - hgt > 1.2 ? { sw, wt } : null;
    }));
  }
  const GAP = Math.round(15 / STEP); // breaks up to 15 m, between walls of the same kind, the top running straight across
  for (const k of [0, 1]) {
    let last = -1;
    for (let r = 0; r < wallRows.length; r++) {
      const w = wallRows[r][k];
      if (!w) continue;
      if (last >= 0 && r - last > 1 && r - last <= GAP + 1 && wallRows[last][k].sw === w.sw) {
        for (let j = last + 1; j < r; j++) wallRows[j][k] = { sw: w.sw, wt: wallRows[last][k].wt + ((w.wt - wallRows[last][k].wt) * (j - last)) / (r - last) };
      }
      last = r;
    }
  }
  for (let d = from; d <= to + 0.01; d += STEP, row++) {
    const hgt = roadHeight(d) + 0.03;
    put(pos, d, -half - 0.3, hgt); put(pos, d, half + 0.3, hgt);
    st.push(0, d / 6, 1, d / 6); // texture repeats every 6 m along
    const walls = [null, null];
    for (const side of [-1, 1]) {
      const wr = wallRows[row]?.[side < 0 ? 0 : 1], sw = wr?.sw, wt = wr?.wt;
      if (wr) { // a side wall: flat verge, then the wall at its outer edge
        const top = Math.min(hgt + 18, wt + 0.4), [su, sv] = kitScale(sw);
        put(bpos, d, side * (half + 0.3), hgt); put(bpos, d, side * (half + 0.8), hgt);
        bst.push(0, d / 4, 1, d / 4);
        put(wpos, d, side * (half + 0.8), hgt - 0.3); put(wpos, d, side * (half + 0.8), top);
        wst.push(d / su, -0.3 / sv, d / su, (top - hgt) / sv);
        walls[side < 0 ? 0 : 1] = sw;
        put(apos, d, side * (half + 0.8), hgt); put(apos, d, side * (half + 0.8), hgt); put(apos, d, side * (half + 0.8), hgt); // (no apron: the wall stands there)
        ast.push(0, 0, 0, 0, 0, 0);
        continue;
      }
      put(wpos, d, side * (half + 0.8), hgt); put(wpos, d, side * (half + 0.8), hgt); wst.push(0, 0, 0, 0); // (no wall)
      const e = edgeGround(d, side);
      // per route (Edit details): 1 m keeps town banks out of trees (the owner, Barca). Up to 60 m on a 'use my heights'
      // stretch: the road there runs through Google's false humps and over its false hollows, and the cutting's walls
      // were black where the hump rose more than 15 m (Cap's last km)
      const cap = mine.some(([a, b]) => d >= a && d <= b) ? 60 : (route.opts?.bankMax ?? 15);
      const outer = e === null ? hgt - Math.min(1.5, cap) : Math.max(hgt - cap, Math.min(hgt + cap, e + 0.15));
      const out = e === null ? half + 0.3 : half + 0.8;
      put(bpos, d, side * (half + 0.3), hgt); put(bpos, d, side * out, outer);
      bst.push(0, d / 4, 1, d / 4);
      // (through underpasses too, hidden behind their walls: kept 3 m clear of them, the corners of their mouths
      // showed black on the CCCP TT; but kept out of a mountain tunnel, whose portal can stand over a valley)
      // Beside the road, only where the route's banks are kept low (bankMax ≤ 3: towns and trees, e.g. Central Park's
      // 1): with the usual banks the bank itself rises to the scenery, and on a mountainside "something 3 m over the
      // road beside it" is the hill or the next hairpin's leg, where the apron stood out over the valley as a flat ledge
      // (the owner 2026-10-27, Alpe d'Huez 2.25 km)
      const covered = e === null ? !tunnels.list.some(([f, t, meta]) => meta?.kit?.style !== 'underpass' && d >= f - 3 && d <= t + 3)
        : (route.opts?.bankMax ?? 15) <= 3 && e - hgt > 3;
      put(apos, d, side * out, outer); put(apos, d, side * (out + 3), hgt - 0.15); put(apos, d, side * (half + (e === null ? 12 : APRON)), hgt - 0.3); // (12 m under a bridge: no reading says what's out there, the Portway's river)
      ast.push(0, d / 4, 0.75, d / 4, APRON / 4, d / 4);
      (aOn[row] ||= [])[side < 0 ? 0 : 1] = covered;
    }
    // inside an earthworks stretch the road is laid by earthworks.js, the whole stretch at once (only the part near the
    // rider was laid here, and the stretch's clip showed the rest as a black slot from across a hairpin)
    if (row && !(inSite(d) && inSite(d - STEP))) {
      const a = (row - 1) * 2, b = row * 2;
      (cobbled(d - STEP / 2) ? cidx : idx).push(a, b, a + 1, a + 1, b, b + 1);
      for (let k = 0; k < 2; k++) {
        const p = (row - 1) * 4 + k * 2, q = row * 4 + k * 2;
        bidx.push(p, q, p + 1, p + 1, q, q + 1);
        const sw = walls[k];
        if (sw && wallOn[row - 1]?.[k] === sw) (widx[sw] ||= []).push(p, q, p + 1, p + 1, q, q + 1);
        // the apron where this row and the last are both covered on this side (3 vertices a side a row)
        if (aOn[row]?.[k] && aOn[row - 1]?.[k]) {
          const u = ((row - 1) * 2 + k) * 3, v = (row * 2 + k) * 3;
          aidx.push(u, v, u + 1, u + 1, v, v + 1, u + 1, v + 1, u + 2, u + 2, v + 1, v + 2);
        }
      }
    }
    wallOn[row] = walls;
  }
  if (!idx.length && !cidx.length) { // all of it inside an earthworks stretch
    if (cleanRoad.cobbles) viewer.scene.primitives.remove(cleanRoad.cobbles);
    cleanRoad.cobbles = null;
    if (cleanRoad.prim) viewer.scene.primitives.remove(cleanRoad.prim);
    if (cleanRoad.banks) viewer.scene.primitives.remove(cleanRoad.banks);
    if (cleanRoad.apron) viewer.scene.primitives.remove(cleanRoad.apron);
    for (const p of cleanRoad.walls || []) viewer.scene.primitives.remove(p);
    cleanRoad.prim = null; cleanRoad.banks = null; cleanRoad.apron = null; cleanRoad.walls = [];
    return;
  }
  const banks = new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({
      attributes: {
        position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(bpos) }),
        st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(bst) }),
      },
      indices: new Uint32Array(bidx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(bpos),
    }) }),
    appearance: bankAppearance(), asynchronous: false, compressVertices: false,
  });
  // the surface: asphalt and, on cobbled stretches, cobbles (same vertices, separate triangles and look)
  const surface = (indices, look) => (indices.length ? new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({
      attributes: {
        position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
        st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
      },
      indices: new Uint32Array(indices),
      primitiveType: C.PrimitiveType.TRIANGLES,
      boundingSphere: C.BoundingSphere.fromVertices(pos),
    }) }),
    appearance: look,
    asynchronous: false, // swapped in the same frame, so it never flickers
    // Cesium packs texture coordinates into one number assuming 0..1; ours run along the road (d / 6 m), so packed
    // they overflowed into the across-the-road value and the markings slid sideways the further you rode (the owner:
    // the left edge line "swaps to the right", worse further on; also "drags left after 2 miles" on day one)
    compressVertices: false,
  }) : null);
  const prim = surface(idx, roadAppearance()), cobbles = surface(cidx, cobbleAppearance());
  // the side walls: same vertices for every style, a primitive per style
  const sideWalls = Object.entries(widx).map(([kind, ix]) => new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({
      attributes: {
        position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(wpos) }),
        st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(wst) }),
      },
      indices: new Uint32Array(ix), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(wpos),
    }) }),
    appearance: flatLook(kind), asynchronous: false, compressVertices: false,
  }));
  const apron = aidx.length ? new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({
      attributes: {
        position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(apos) }),
        st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(ast) }),
      },
      indices: new Uint32Array(aidx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(apos),
    }) }),
    appearance: apronAppearance(), asynchronous: false, compressVertices: false,
  }) : null;
  for (const p of [prim, cobbles, banks, apron, ...sideWalls]) if (p) viewer.scene.primitives.add(p);
  for (const p of [cleanRoad.prim, cleanRoad.cobbles, cleanRoad.banks, cleanRoad.apron, ...(cleanRoad.walls || [])]) if (p) viewer.scene.primitives.remove(p);
  cleanRoad.apron = apron;
  cleanRoad.prim = prim;
  cleanRoad.cobbles = cobbles;
  cleanRoad.banks = banks;
  cleanRoad.walls = sideWalls;
}

// start-up: the setting, the width, and K during a ride
export async function initCleanRoad() {
  state.cleanRoad = store.get('cleanRoad2', '1') === '1'; // on by default since 2026-10-17 (new key, so everyone starts with it on once)
  cleanRoad.width = cleanRoad.chosen = +store.get('cleanRoadWidth', '4') || 4;
  $('cfg-clean').checked = state.cleanRoad;
  $('cfg-clean-w').value = cleanRoad.width;
  $('cfg-clean').addEventListener('change', () => { state.cleanRoad = $('cfg-clean').checked; store.set('cleanRoad2', state.cleanRoad ? '1' : '0'); });
  // (guarded: a page opened before this setting existed has no checkbox, and a throw here stopped the whole setup screen)
  if ($('cfg-tint')) {
    $('cfg-tint').checked = tintOn();
    $('cfg-tint').addEventListener('change', () => { store.set('roadTint', $('cfg-tint').checked ? '1' : '0'); tintAt = 0; applyTint(); applySideTint(); });
  }
  $('cfg-clean-w').addEventListener('change', () => {
    cleanRoad.width = cleanRoad.chosen = Math.max(2, Math.min(10, +$('cfg-clean-w').value || 4));
    store.set('cleanRoadWidth', String(cleanRoad.chosen));
    texture = null; appearance = null; // the centre line's width depends on the road's
    cleanRoad.at = -1e9; // rebuild at the new width
  });
  window.addEventListener('keydown', (e) => {
    if ((e.key !== 'k' && e.key !== 'K') || !viewer || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    state.cleanRoad = !state.cleanRoad;
    $('cfg-clean').checked = state.cleanRoad;
    store.set('cleanRoad2', state.cleanRoad ? '1' : '0');
    cleanRoad.at = -1e9;
    toast(`Clean road ${state.cleanRoad ? 'on' : 'off'} (K)`, 2000);
  });
}
