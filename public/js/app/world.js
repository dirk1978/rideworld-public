// The generated world (2026-11-14, the owner: Google's 3D makes most routes look awful and is too heavy for laptops; "let's
// go" on a world built from OpenStreetMap on top of Lite scenery). Lite only. The server fetches the route's buildings,
// woods, trees and hedges / walls once (lib/world.js, GET /api/world/<id>); here they become 3D in chunks of CHUNK m of
// route, built from AHEAD m in front of the rider to BEHIND m behind, one chunk at a time, and dropped once passed:
//   trees     woods (and scrub, orchards) filled within 120 m of the road, denser near it; single trees; tree rows.
//             Broadleaf = trunk + round crown, needleleaved = cone; sizes and greens vary.
//   barriers  hedges (1.6 m, green), walls (1.2 m, stone), fences (1.1 m, thin, timber), per segment on the ground.
//   buildings each footprint extruded to its height (tag, else levels, else a guess from its kind and size); small
//             four-cornered houses get a gable roof along their long side, the rest a flat roof slab.
// Ground heights come from the terrain (sampleTerrainMostDetailed, as the survey does in Lite). Nothing within the road
// and its verge: trees > half + 2.5 m from the line, buildings 4 m and never across it, barriers half + 0.8 m.
import { C, route, state, store, toast } from './core.js';
import { viewer, satellite } from './scenery.js';
import { currentInfo } from './setup.js';
import { cleanRoad, layerAppearance } from './cleanroad.js';
import { groundHeight } from './survey.js';
import { paint, paintGround, pavingTex, removePaint } from './paint.js';
import { FlatRoadTerrain } from './flatterrain.js';
import { addWorldLandmarks, clearWorldLandmarks, updateWorldLandmarks } from './landmarks.js';
import { FASCIA_COLOURS, churchTower, looks, pitchedRoofs, setFlavour, styleOf, wallColour, wallGeometry } from './buildings.js';

const CHUNK = 400, AHEAD = 1500, BEHIND = 350, BAND = 120;
export const world = { data: null, forRoute: null, chunks: new Map(), building: false, idx: null, at: 0, gen: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a repeatable 0..1 random from numbers (the same tree is the same tree every time it's built)
function rnd(...a) { let h = 2166136261; for (const x of a) { h ^= Math.round(x * 1000) | 0; h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296; }

export function clearWorld() {
  clearWorldLandmarks();
  if (world.railPrim) { viewer?.scene.primitives.remove(world.railPrim); world.railPrim = null; }
  for (const p of world.waterPrims || []) viewer?.scene.primitives.remove(p); world.waterPrims = [];
  for (const c of world.chunks.values()) { for (const p of c.prims) viewer.scene.primitives.remove(p); for (const e of c.ents || []) viewer.entities.remove(e); }
  world.chunks.clear();
  world.gen++;
}

// at Load scenery (Lite only): fetch the map data in the background; the first time for a route the server needs a
// few minutes, so it waits and tries again (the ride carries on without it meanwhile)
// railway bridges and viaducts (London, 2026-11-17): a deck slab with parapets along each bridge way's elevated stretch
// (land 'rail' entries with `dk`, bheights.mjs: deck top m above datum per point, null on the ground), so roads pass
// under the Waterloo / London Bridge / Blackfriars approaches; one primitive for the whole world
// big water areas (the Thames, the Serpentine; bheights.mjs `lv`): a level textured surface at the water's level, the
// terrain pressed down under it (flatterrain.js basins). The texture repeats every 12 m (the canal's look, wider)
let WATERCANVAS = null;
function waterAreas(Wd, off) {
  for (const p of world.waterPrims || []) viewer.scene.primitives.remove(p); world.waterPrims = [];
  if (!Number.isFinite(off)) return;
  // (the Thames' even brown-green; the 'shire' worlds' rivers a deeper green, 2026-11-21: the Avon at Clopton Bridge read as mud flats)
  const tone = Wd.flavour === 'shire' ? '#46625a' : '#6b6a52';
  if (WATERCANVAS?.tone !== tone) { WATERCANVAS = waterTex(true, tone); WATERCANVAS.tone = tone; }
  // (a river area over a ford is drawn no higher than the ford's water: the Arrow's area at Coughton Ford sat at 49.7 m, a
  // flat sheet 1.3 m over the lane at 48.3, the owner's report 2026-11-24; the ground under it is left as it was)
  const fordLv = (Wd.fords || []).map((f) => ({ lv: Math.min(...f.pts.map((q) => q[2])) + 0.25, pts: f.pts }));
  for (const a of Wd.land || []) {
    if (a.t !== 'water' || !Number.isFinite(a.lv) || a.pts.length < 4) continue;
    let s = 90, n = -90, w = 180, e = -180; for (const [la, lo] of a.pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    const W_m = (e - w) * 111320 * Math.cos((s * Math.PI) / 180), H_m = (n - s) * 110540;
    const m20 = 20 / 110540, drawLv = (A) => { let lv = A.lv; for (const f of fordLv) if (f.pts.some(([la, lo]) => la > s - m20 && la < n + m20 && lo > w - m20 * 1.6 && lo < e + m20 * 1.6)) lv = Math.min(lv, f.lv + 0.15); return lv; }; // (5 cm over the ford water: level with it, they flickered)
    try {
      const geom = new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(a.pts.flatMap(([la, lo]) => [lo, la]))), height: drawLv(a) + off - 0.1, vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat, granularity: C.Math.RADIANS_PER_DEGREE / 50 });
      const look = new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: WATERCANVAS, repeat: new C.Cartesian2(Math.max(1, W_m / 12), Math.max(1, H_m / 12)) }), flat: false, faceForward: true, closed: false, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED });
      world.waterPrims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: geom }), appearance: look, asynchronous: true })));
    } catch (err) { console.warn('water area', err); }
  }
  // fords (extras.mjs W.fords, 2026-11-25, Coughton Ford): a flat water surface 25 cm over the road's lowest point, across
  // the road's width and over the dip only (where the road is below it), so the bike rides into it
  for (const f of Wd.fords || []) {
    const lv = Math.min(...f.pts.map((q) => q[2])) + 0.25, wet = f.pts.filter((q) => q[2] < lv + 0.05);
    if (wet.length < 2) continue;
    // (5 m more water at each end along the road: OSM's ford is often one point, or a short stretch between two)
    const ext = (a2, b2) => { const K = 111320 * Math.cos((a2[0] * Math.PI) / 180), dx = (a2[1] - b2[1]) * K, dy = (a2[0] - b2[0]) * 110540, L = Math.hypot(dx, dy) || 1; return [a2[0] + (dy / L) * 5 / 110540, a2[1] + (dx / L) * 5 / K, a2[2]]; };
    wet.unshift(ext(wet[0], wet[1])); wet.push(ext(wet.at(-1), wet.at(-2)));
    try {
      const geom = new C.CorridorGeometry({ positions: C.Cartesian3.fromDegreesArray(wet.flatMap(([la, lo]) => [lo, la])), width: 8, height: lv + off, vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat, cornerType: C.CornerType.ROUNDED });
      const look = new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: WATERCANVAS, repeat: new C.Cartesian2(2, 1) }), flat: false, faceForward: true, closed: false, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED });
      world.waterPrims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: geom }), appearance: look, asynchronous: true })));
    } catch (err) { console.warn('ford', err); }
  }
}
// the Thames bridges' own colours on their parapets (London 2026-11-17: Westminster's green like the Commons' benches,
// Lambeth's red like the Lords', Blackfriars' red and white, Tower Bridge's blue); others plain stone
const BRIDGE_COLOURS = { 'Westminster Bridge': [0.22, 0.42, 0.3], 'Lambeth Bridge': [0.6, 0.14, 0.13], 'Blackfriars Bridge': [0.62, 0.13, 0.13], 'Tower Bridge': [0.45, 0.66, 0.82], 'Vauxhall Bridge': [0.55, 0.16, 0.13], 'Southwark Bridge': [0.3, 0.45, 0.32], 'Chelsea Bridge': [0.86, 0.86, 0.82], 'Waterloo Bridge': [0.8, 0.79, 0.74], 'London Bridge': [0.7, 0.7, 0.68] };
// bridges whose landmark model draws its own footways and railings (no wall between the road and the pavement): Tower Bridge
const MODEL_PARAPETS = new Set(['Tower Bridge']);
let spanName = null;
function railDecks(Wd, off) {
  if (world.railPrim) { viewer.scene.primitives.remove(world.railPrim); world.railPrim = null; }
  if (!Number.isFinite(off)) return;
  const inst = [], col = (c) => ({ color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(c[0], c[1], c[2], 1)) });
  const box = (frame, dx, dy, dz, sx, sy, sz, c) => inst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(sx, sy, sz), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(dx, dy, dz), new C.Matrix4()), attributes: col(c) }));
  // (roads as a grid of segments, for the piers: none where a street passes under)
  const RG = 0.0003, rgrid = new Map();
  for (const e of Wd.roads?.edges || []) for (let k = 1; k < e.pts.length; k++) { const p = e.pts[k - 1], q = e.pts[k], n = Math.max(1, Math.ceil(Math.hypot((q[0] - p[0]) * 110540, (q[1] - p[1]) * 70000) / 15)), keys = new Set(); for (let m = 0; m <= n; m++) keys.add(Math.floor((p[0] + (q[0] - p[0]) * m / n) / RG) + ',' + Math.floor((p[1] + (q[1] - p[1]) * m / n) / RG)); for (const key of keys) { if (!rgrid.has(key)) rgrid.set(key, []); rgrid.get(key).push([p, q]); } }
  const roadNear = (la, lo, r) => { const K = 111320 * Math.cos((la * Math.PI) / 180), a0 = Math.floor(la / RG), b0 = Math.floor(lo / RG);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [p, q] of rgrid.get((a0 + i) + ',' + (b0 + j)) || []) {
      const ax = (p[1] - lo) * K, ay = (p[0] - la) * 110540, bx = (q[1] - lo) * K, by = (q[0] - la) * 110540, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1)));
      if (Math.hypot(ax + vx * t, ay + vy * t) < r) return true; }
    return false; };
  for (const a of Wd.land || []) {
    if (a.t !== 'rail' || !a.dk) continue;
    for (let k = 1; k < a.pts.length; k++) {
      const h0 = a.dk[k - 1], h1 = a.dk[k]; if (h0 == null || h1 == null) continue;
      const [la0, lo0] = a.pts[k - 1], [la1, lo1] = a.pts[k], cs = Math.cos((la0 * Math.PI) / 180);
      const len = Math.hypot((la1 - la0) * 110540, (lo1 - lo0) * 111320 * cs); if (len < 0.5) continue;
      const brg = Math.atan2((lo1 - lo0) * 111320 * cs, (la1 - la0) * 110540);
      const frame = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees((lo0 + lo1) / 2, (la0 + la1) / 2, (h0 + h1) / 2 + off), new C.HeadingPitchRoll(brg - Math.PI / 2, 0, 0));
      box(frame, 0, 0, -0.95, len + 0.4, 5.2, 1.6, [0.3, 0.28, 0.27]);          // the deck (its top just under the rails)
      for (const s of [-1, 1]) box(frame, 0, s * 2.5, -0.1, len + 0.4, 0.3, 1.3, [0.42, 0.38, 0.35]); // parapets
    }
    // brick piers under the deck every ~9 m down to the ground (bheights.mjs `gd`), as a viaduct's arches: not within 6 m of a
    // road (the streets pass under), not where the deck is under 3.5 m up (2026-11-22, London Bridge's decks floated)
    if (a.gd && a.pts.length > 1) {
      let acc = 0, next = 4;
      for (let k = 1; k < a.pts.length; k++) {
        const [la0, lo0] = a.pts[k - 1], [la1, lo1] = a.pts[k], cs = Math.cos((la0 * Math.PI) / 180);
        const len = Math.hypot((la1 - la0) * 110540, (lo1 - lo0) * 111320 * cs); if (len < 0.1) continue;
        while (next <= acc + len) {
          const t = (next - acc) / len, la = la0 + (la1 - la0) * t, lo = lo0 + (lo1 - lo0) * t;
          const dk = a.dk[k - 1] != null && a.dk[k] != null ? a.dk[k - 1] + (a.dk[k] - a.dk[k - 1]) * t : null, gd = a.gd[k - 1] ?? a.gd[k];
          if (dk != null && gd != null && dk - gd > 3.5 && !roadNear(la, lo, 6)) {
            const brg = Math.atan2((lo1 - lo0) * 111320 * cs, (la1 - la0) * 110540), h = dk - 1.75 - gd + 0.5;
            const frame = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lo, la, gd - 0.5 + h / 2 + off), new C.HeadingPitchRoll(brg - Math.PI / 2, 0, 0));
            box(frame, 0, 0, 0, 2.2, 5.0, h, [0.46, 0.27, 0.2]);
          }
          next += 9;
        }
        acc += len;
      }
    }
  }
  if (!inst.length) return;
  world.railPrim = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: inst, appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true, shadows: C.ShadowMode.ENABLED }));
}
if (typeof window !== 'undefined') window.__rwWorld = () => world; // (tests: frame-cost probes)
export async function loadWorld() {
  clearWorld(); removePaint();
  if (viewer?.terrainProvider instanceof FlatRoadTerrain) viewer.terrainProvider = viewer.terrainProvider.inner; // (the real terrain back)
  world.data = null; world.idx = null; world.forRoute = route;
  if (!state.lite || !route) return;
  const info = currentInfo();
  if (!info) return;
  const gen = world.gen;
  for (let k = 0; k < 45; k++) {
    let res;
    try { res = await fetch('api/world/' + encodeURIComponent(info.id)); } catch { await sleep(10000); continue; }
    if (gen !== world.gen) return;
    if (res.status === 200) { world.data = await res.json(); break; }
    if (res.status !== 202) return;
    if (k === 0) toast('Building the trees and buildings for this route (the first time takes a few minutes): they appear as soon as they are ready.', 8000);
    await sleep(8000);
  }
  if (!world.data || gen !== world.gen) return;
  setFlavour(world.data.flavour); // (London's palette: buildings.js)
  // the trees as a lookup for the camera (camera.js needLift, 2026-11-21: on wooded towpaths the camera saw only canopy):
  // state.treesNear(lat, lon, r) -> [[metres east, metres north, height, crown radius]] of the point
  { const T = world.data.lidarTrees?.length ? world.data.lidarTrees : (world.data.trees || []).map(([la, lo]) => [la, lo, 9, 3]);
    const G = 0.0003, grid = new Map(); for (const t of T) { const k = Math.floor(t[0] / G) + ',' + Math.floor(t[1] / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
    state.treesNear = (lat, lon, r) => { const out = [], kx = 111320 * Math.cos((lat * Math.PI) / 180), n = Math.ceil(r / 30) + 1, a0 = Math.floor(lat / G), b0 = Math.floor(lon / G);
      for (let a = a0 - n; a <= a0 + n; a++) for (let b = b0 - n; b <= b0 + n; b++) for (const t of grid.get(a + ',' + b) || []) { const x = (t[1] - lon) * kx, y = (t[0] - lat) * 110540; if (x * x + y * y < r * r) out.push([x, y, t[2] || 9, t[3] || 3]); }
      return out; }; }
  credits(world.data);
  // shadows: Advanced → Graphics (rw.shadows auto / on / off); auto = gaming graphics only (they halve a GTX 650's frames)
  const sh = store.get('shadows', 'auto');
  setShadows(sh === 'on' || (sh === 'auto' && (state.gpu?.tier ?? 0) >= 3 && state.gpu?.name !== 'mobile'));
  if (world.data.roads) {
    // level ground under every road and its pavements (flatterrain.js), before anything samples the terrain
    if (!(viewer.terrainProvider instanceof FlatRoadTerrain)) {
      // (path bridges and short ones are levelled ground too, as in indexArea)
      const deckLen = (e) => e.pts.slice(1).reduce((t2, q, k) => t2 + Math.hypot((q[0] - e.pts[k][0]) * 110540, (q[1] - e.pts[k][1]) * 68000), 0);
      const roads = world.data.roads.edges.filter((e) => !e.deckModel && !((e.bridge || e.tunnel) && !e.off && deckLen(e) >= 12)) /* (deckModel: a footbridge model over a motorway, footbridges.mjs: no levelled ground under it) */.map((e) => ({ pts: e.pts, hw: (ROADW[e.hw] || 5) / 2 + (/^(residential|living_street|primary|secondary|tertiary|unclassified)/.test(e.hw) ? 1.8 : 0.4) }));
      // the offset from the roads' LIDAR heights to this terrain: median over ~150 road points (flatterrain.js)
      let off = null;
      try {
        const E = world.data.roads.edges.filter((e) => !e.bridge && !e.tunnel), pick = [];
        for (let k = 0; k < 150 && E.length; k++) { const e = E[(k * 7919) % E.length], p = e.pts[Math.floor(e.pts.length / 2)]; if (Number.isFinite(p[2])) pick.push(p); }
        const carts = pick.map((p) => C.Cartographic.fromDegrees(p[1], p[0]));
        await C.sampleTerrainMostDetailed(viewer.terrainProvider, carts);
        const d = carts.map((c, k) => c.height - pick[k][2]).filter(Number.isFinite).sort((a, b) => a - b);
        if (d.length > 20) off = d[d.length >> 1];
      } catch (e) { console.warn('terrain offset', e); }
      world.terrainOff = off; state.owTerrainOff = off ?? NaN;
      // (the canal / river beds: 0.7 m under the water level, as wide as the water; tunnels left alone)
      for (const a of world.data.water || []) if (a.lv && !a.tunnel && !a.bridge && !/tunnel/i.test(a.name || '') && /^(canal|river)$/.test(a.t)) roads.push({ pts: a.pts.map(([la, lo], k) => [la, lo, Number.isFinite(a.lv[k]) ? a.lv[k] - 0.7 : NaN]), hw: (Math.min(12, a.w || 8) * 0.85) / 2 + 0.3 });
      const basins = [...(world.data.land || []).filter((a) => a.t === 'water' && Number.isFinite(a.lv)).map((a) => ({ poly: a.pts, lv: a.lv })), ...(world.data.basins || [])]; // (the Thames: bheights.mjs `lv`; canal bridges' arches: canal.mjs)
      viewer.terrainProvider = new FlatRoadTerrain(viewer.terrainProvider, roads, world.data.roads.box, off, 'api/dtm/' + encodeURIComponent(info.id), basins); // (the real ground: lib/dtm.js)
    }
    indexArea(); if (world.data.land) paintGround(world.data);
    satellite(!paint.layer || !paint.on); // (the photo only where there's no painted ground)
    if (world.data.landmarks?.length) addWorldLandmarks(world.data.landmarks, world.terrainOff, () => gen === world.gen); // (London's landmark models)
    railDecks(world.data, world.terrainOff); waterAreas(world.data, world.terrainOff);
  } else { index(); satellite(true); }
  console.info('world', world.data.buildings.length, 'buildings,', world.data.woods.length, 'woods,', world.data.trees.length, 'trees');
}

// the generated world's sources, credited beside Cesium's / Google's (their licences ask for it): OpenStreetMap (ODbL),
// the Environment Agency's LIDAR (Open Government Licence), Meta / WRI's canopy map (CC BY 4.0)
function credits(W) {
  for (const c of world.credits || []) viewer.creditDisplay.removeStaticCredit(c);
  const list = ['Map data © OpenStreetMap contributors'];
  if ((W.lidarTrees?.length && W.lidarSource !== 'meta') || W.roads || W.lidarHedges) list.push('Contains Environment Agency data © Crown copyright');
  if (W.lidarSource === 'meta') list.push('Tree heights © Meta and World Resources Institute (CC BY 4.0)');
  world.credits = list.map((t) => new C.Credit(t, true));
  for (const c of world.credits) viewer.creditDisplay.addStaticCredit(c);
}

// ---------- local metres, the route as samples, and what lies near which part of it ----------
function index() {
  const p0 = route.at(0), lat0 = p0.lat, lon0 = p0.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const ll = (x, y) => [lat0 + y / ky, lon0 + x / kx];
  const S = [];
  for (let d = 0; d <= route.length; d += 10) { const q = route.at(d); S.push([...xy(q.lat, q.lon), d]); }
  const G = 60, grid = new Map(), key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  S.forEach((s, i) => { const k = key(s[0], s[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  // nearest route point (within ~3 cells, else null)
  const near = (x, y) => {
    const cx = Math.floor(x / G), cy = Math.floor(y / G);
    let best = null;
    for (let r = 0; r <= 3 && !best; r++) {
      for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
        if (r && i > cx - r && i < cx + r && j > cy - r && j < cy + r) continue;
        for (const n of grid.get(`${i},${j}`) || []) { const s = S[n], dd = Math.hypot(s[0] - x, s[1] - y); if (!best || dd < best.dist) best = { dist: dd, d: s[2], n }; }
      }
      if (best && r === 0) { // a neighbour cell may hold a nearer point
        for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) for (const n of grid.get(`${i},${j}`) || []) { const s = S[n], dd = Math.hypot(s[0] - x, s[1] - y); if (dd < best.dist) best = { dist: dd, d: s[2], n }; }
      }
    }
    // refine along the segment either side of the nearest sample
    if (best) for (const m of [best.n - 1, best.n]) {
      const a = S[m], b = S[m + 1];
      if (!a || !b) continue;
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
      const dd = Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y);
      if (dd < best.dist) best = { dist: dd, d: a[2] + (b[2] - a[2]) * t, n: best.n };
    }
    return best;
  };
  const chunkOf = (d) => Math.floor(d / CHUNK);
  const per = new Map(); // chunk -> { trees: [[x, y, kind]], buildings: [b], barriers: [[x1, y1, x2, y2, t]] }
  const bucket = (c) => { if (!per.has(c)) per.set(c, { trees: [], buildings: [], barriers: [] }); return per.get(c); };
  const half = (cleanRoad.width || 4) / 2;
  const W = world.data;
  // England: the LIDAR's trees (lib/world.js), each where it stands, as tall as it is: used instead of OSM's woods, rows
  // and single trees (OSM misses most of them: CCCP's lanes)
  // Abroad the measured trees come from Meta's canopy map (lidarSource 'meta'), which misses many city street trees:
  // there they're added to OSM's (skipping any within 4 m of an OSM tree) instead of replacing them
  const measured = W.lidarTrees?.length ? W.lidarTrees : null, replaceOsm = measured && W.lidarSource !== 'meta';
  if (measured) {
    const osmXY = W.lidarSource === 'meta' ? W.trees.map(([la, lo]) => xy(la, lo)) : [];
    const og = new Map(); for (const [x, y] of osmXY) { const k = `${Math.floor(x / 8)},${Math.floor(y / 8)}`; if (!og.has(k)) og.set(k, []); og.get(k).push([x, y]); }
    const nearOsm = (x, y) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [a, b] of og.get(`${Math.floor(x / 8) + i},${Math.floor(y / 8) + j}`) || []) if (Math.hypot(a - x, b - y) < 4) return true; return false; };
    for (const [la, lo, h, cr] of measured) {
      let [x, y] = xy(la, lo); const n = near(x, y);
      if (!n || n.dist >= BAND || (osmXY.length && nearOsm(x, y))) continue;
      if (n.dist <= half + 1.8) {
        // a big tree's crown over the road (LIDAR finds the crown's top, not the trunk): stand it on the nearer verge
        // instead of leaving it out (CCCP's 22 m landmark tree at the top of Timberhonger Lane, the owner 2026-11-15)
        if (h < 10) continue;
        const a = S[Math.max(0, n.n - 1)], b = S[Math.min(S.length - 1, n.n + 1)], c = S[n.n];
        const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1, side = (tx * (y - c[1]) - ty * (x - c[0])) >= 0 ? 1 : -1;
        const nx = (-ty / L) * side, ny = (tx / L) * side, out = half + 2.5 - n.dist;
        x += nx * out; y += ny * out;
      }
      bucket(chunkOf(n.d)).trees.push([x, y, cr / h < 0.2 ? 'conifer' : 'broad', h, cr]);
    }
  }
  // single trees and tree rows
  if (!replaceOsm) for (const [la, lo] of W.trees) { const [x, y] = xy(la, lo), n = near(x, y); if (n && n.dist > half + 2.5 && n.dist < BAND + 30) bucket(chunkOf(n.d)).trees.push([x, y, 'broad']); }
  if (!replaceOsm) for (const row of W.rows) {
    const P = row.map(([la, lo]) => xy(la, lo));
    for (let i = 1; i < P.length; i++) {
      const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      for (let s = 0; s < L; s += 7) { const t = s / L, x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, n = near(x, y); if (n && n.dist > half + 2.5 && n.dist < BAND + 30) bucket(chunkOf(n.d)).trees.push([x, y, 'broad']); }
    }
  }
  // woods: points on a 7 m lattice across the band along the route, kept where they fall inside a wood (lattice by world
  // position, so bends don't double up), thinning out away from the road
  const woods = W.woods.map((w) => { const P = w.pts.map(([la, lo]) => xy(la, lo)); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { P, x0, y0, x1, y1, kind: w.leaf === 'needleleaved' ? 'conifer' : w.t === 'orchard' ? 'orchard' : w.t === 'scrub' ? 'scrub' : 'broad' }; });
  const inside = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  if (woods.length && !measured) {
    const L = 7, done = new Set();
    for (const s of S) {
      for (let gx = Math.floor((s[0] - BAND) / L); gx <= Math.floor((s[0] + BAND) / L); gx++) for (let gy = Math.floor((s[1] - BAND) / L); gy <= Math.floor((s[1] + BAND) / L); gy++) {
        const k = gx * 100003 + gy;
        if (done.has(k)) continue;
        done.add(k);
        const x = gx * L + (rnd(gx, gy) - 0.5) * L * 0.8, y = gy * L + (rnd(gy, gx, 7) - 0.5) * L * 0.8;
        const w = woods.find((o) => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1 && inside(o.P, x, y));
        if (!w) continue;
        const n = near(x, y);
        if (!n || n.dist < half + 2.5 || n.dist > BAND) continue;
        const keep = n.dist < 40 ? 1 : n.dist < 80 ? 0.55 : 0.3;
        if (rnd(x, y, 3) > keep * (w.kind === 'scrub' ? 0.6 : 1)) continue;
        bucket(chunkOf(n.d)).trees.push([x, y, w.kind]);
      }
    }
  }
  // buildings: by where their middle is; none on or across the road
  for (const b of W.buildings) {
    const P = b.pts.map(([la, lo]) => xy(la, lo));
    if (P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P.pop();
    if (P.length < 3) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of P) { cx += x; cy += y; }
    cx /= P.length; cy /= P.length;
    const n = near(cx, cy);
    if (!n || n.dist > BAND + 40) continue;
    if (P.some(([x, y]) => { const m = near(x, y); return m && m.dist < half + 2; })) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (S.some((s) => s[0] > x0 && s[0] < x1 && s[1] > y0 && s[1] < y1 && inside(P, s[0], s[1]))) continue; // the road runs through it (an arch, a covered way)
    bucket(chunkOf(n.d)).buildings.push({ ...b, P, cx, cy });
  }
  // barriers: segments of up to 15 m, off the road
  // hedges measured by LIDAR (England, lidarHedges, at their own height; only on routes with Edit details → Hedgerows
  // ticked, routes.json hedges: the owner found them blocky) replace OSM's hedges; OSM's walls and fences stay
  const brs = W.lidarHedges && route.opts?.hedges ? [...W.barriers.filter((b) => b.t !== 'hedge'), ...W.lidarHedges] : W.barriers;
  for (const br of brs) {
    const P = br.pts.map(([la, lo]) => xy(la, lo));
    for (let i = 1; i < P.length; i++) {
      const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), n = Math.max(1, Math.ceil(L / 15));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const a = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t0, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t0];
        const b = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t1, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t1];
        const m = near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), ea = near(a[0], a[1]), eb = near(b[0], b[1]);
        if (!m || m.dist < half + 0.8 || m.dist > BAND || (ea && ea.dist < half + 0.5) || (eb && eb.dist < half + 0.5)) continue;
        bucket(chunkOf(m.d)).barriers.push([a[0], a[1], b[0], b[1], br.t, br.h]);
      }
    }
  }
  world.idx = { per, ll, xy };
}

// ---------- open world (openworld.js): the scenery in fixed squares of the map, whatever route is being ridden ----------
// the owner 2026-11-15: choosing a turn redrew everything (the scenery hung off the route), and only the road being ridden
// was drawn. Here every road of the area is drawn (draped on the ground) and trees / buildings / walls are kept off all
// of them; squares of CELL m are built round the rider and dropped far behind, so a new route changes nothing here.
export const OPEN_LIFT = 0.25; // open world roads stand this far over the terrain's heights (it pokes through less)
const CELL = 250, NEAR_R = 650, DROP_R = 950, LABELS = false;
const ROADW = { trunk: 8, trunk_link: 6, primary: 7.5, primary_link: 6, secondary: 7, secondary_link: 6, tertiary: 6.5, tertiary_link: 5.5, unclassified: 5, residential: 5.5, living_street: 4.5, cycleway: 3, track: 3, bridleway: 2.4, path: 1.8, footway: 2 }; // (paths and tracks: build.mjs `off`)
function indexArea() {
  const W = world.data, R = W.roads, lat0 = (R.box.s + R.box.n) / 2, lon0 = (R.box.w + R.box.e) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const ll = (x, y) => [lat0 + y / ky, lon0 + x / kx];
  // road segments in a 20 m grid: nearest road (distance, its half width, the nearest point)
  const G = 20, grid = new Map(), segs = [];
  const roads = R.edges.map((e, ei) => ({ P: e.pts.map(([la, lo]) => xy(la, lo)), hw: (e.w || ROADW[e.hw] || 5) / 2, e: ei })); // (e.w: a road's own width, landmarks.mjs deckWidth: Bidford's single-lane bridge, 2026-11-20)
  // motorways (build.mjs world.motorways, drawn only: 2026-11-21) keep trees off them like any road
  const mroads = (W.motorways || []).map((m) => ({ P: m.pts.map(([la, lo]) => xy(la, lo)), hw: m.w / 2, e: -1, dk: m.bridge ? m.dk : null, br: !!m.bridge, ele: m.ele }));
  for (const r of [...roads, ...mroads]) for (let i = 1; i < r.P.length; i++) {
    const a = r.P[i - 1], b = r.P[i], n = segs.push([a[0], a[1], b[0], b[1], r.hw, r.e >= 0 && R.edges[r.e].off ? 1 : 0]) - 1;
    for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) for (let gy = Math.floor(Math.min(a[1], b[1]) / G); gy <= Math.floor(Math.max(a[1], b[1]) / G); gy++) {
      const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n);
    }
  }
  const nearRoad = (x, y, reach = 12) => {
    let best = null; const R0 = Math.ceil(reach / G), cx = Math.floor(x / G), cy = Math.floor(y / G);
    for (let i = cx - R0; i <= cx + R0; i++) for (let j = cy - R0; j <= cy + R0; j++) for (const n of grid.get(i + ',' + j) || []) {
      const [ax, ay, bx, by, hw, off] = segs[n], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      const px = ax + vx * t, py = ay + vy * t, d = Math.hypot(px - x, py - y);
      if (!best || d - hw < best.d - best.hw) best = { d, hw, px, py, vx, vy, off };
    }
    return best;
  };
  const per = new Map(), cellOf = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  const bucket = (k) => { if (!per.has(k)) per.set(k, { trees: [], buildings: [], barriers: [], roads: [], discs: [], marks: [], places: [], mouths: [], gw: [], kerbs: [], lamps: [], fronts: [], lights: [], zeb: [], beacons: [], gates: [], water: [], locks: [] }); return per.get(k); };
  // trees: never on a road; a big one whose crown top falls on it stands on the verge (as along routes)
  const measured = W.lidarTrees?.length ? W.lidarTrees : null;
  // no tree stands in a canal or river (2026-11-21, the owner: "a few trees in the middle of the canal"): the drawn water's
  // half width + 0.6 m, from the lines with levels (world.js draws those as water)
  const wsegs = [], wgrid = new Map();
  for (const wl of W.water || []) { if (!wl.lv || !/^(canal|river)$/.test(wl.t)) continue; const P = wl.pts.map(([la, lo]) => xy(la, lo)), hw = (Math.min(12, wl.w || 8) * 0.85) / 2 + 0.6;
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = wsegs.push([a[0], a[1], b[0], b[1], hw]) - 1;
      for (let gx = Math.floor((Math.min(a[0], b[0]) - hw) / G); gx <= Math.floor((Math.max(a[0], b[0]) + hw) / G); gx++) for (let gy = Math.floor((Math.min(a[1], b[1]) - hw) / G); gy <= Math.floor((Math.max(a[1], b[1]) + hw) / G); gy++) { const k = gx + ',' + gy; if (!wgrid.has(k)) wgrid.set(k, []); wgrid.get(k).push(n); } } }
  const inWater = (x, y) => { for (const n of wgrid.get(Math.floor(x / G) + ',' + Math.floor(y / G)) || []) { const [ax, ay, bx, by, hw] = wsegs[n], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))); if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < hw) return true; } return false; };
  const addTree = (x0, y0, kind, h, cr) => {
    if (inWater(x0, y0)) return;
    let x = x0, y = y0; const r = nearRoad(x, y);
    // a crown hangs over the road by a metre at most (the owner: "stuff encroaching onto the roads"): trees closer than that
    // stand back to it; small ones right on the road are dropped
    // (off-road paths, 2026-11-21: the crown clears the path altogether: along tree-lined towpaths a metre of overhang
    // from both banks closed over the path, and the camera saw only canopy, the Wilmcote locks)
    const back = r ? r.hw + Math.max(1.8, r.off ? (cr || 2.5) + 0.3 : (cr || 2.5) - 1) : 0;
    if (r && r.d < r.hw + 1.8 && (!h || h < 10)) return;
    if (r && r.d < back) {
      let ux = x - r.px, uy = y - r.py, L = Math.hypot(ux, uy);
      if (L < 0.3) { ux = -r.vy; uy = r.vx; L = Math.hypot(ux, uy) || 1; }
      x = r.px + (ux / L) * back; y = r.py + (uy / L) * back;
      const r2 = nearRoad(x, y); if (r2 && r2.d < r2.hw + 1.5) return;
    }
    if (inWater(x, y)) return; // (nudged off a road into the water)
    bucket(cellOf(x, y)).trees.push(h ? [x, y, kind, h, cr] : [x, y, kind]);
  };
  if (measured) for (const [la, lo, h, cr] of measured) { const [x, y] = xy(la, lo); addTree(x, y, cr / h < 0.2 ? 'conifer' : 'broad', h, cr); }
  else {
    for (const [la, lo] of W.trees) { const [x, y] = xy(la, lo); addTree(x, y, 'broad'); }
    for (const row of W.rows) { const P = row.map(([la, lo]) => xy(la, lo)); for (let i = 1; i < P.length; i++) { const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); for (let s = 0; s < L; s += 7) { const t = s / L; addTree(P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, 'broad'); } } }
    const inside = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    for (const w of W.woods) {
      const P = w.pts.map(([la, lo]) => xy(la, lo)), kind = w.leaf === 'needleleaved' ? 'conifer' : w.t === 'orchard' ? 'orchard' : w.t === 'scrub' ? 'scrub' : 'broad';
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (let gx = Math.floor(x0 / 7); gx <= Math.floor(x1 / 7); gx++) for (let gy = Math.floor(y0 / 7); gy <= Math.floor(y1 / 7); gy++) {
        const x = gx * 7 + (rnd(gx, gy) - 0.5) * 5.6, y = gy * 7 + (rnd(gy, gx, 7) - 0.5) * 5.6;
        if (!inside(P, x, y)) continue;
        const r = nearRoad(x, y, 120); if (!r || r.d > 120) continue;
        if (rnd(x, y, 3) > (r.d < 40 ? 1 : r.d < 80 ? 0.55 : 0.3)) continue;
        addTree(x, y, kind);
      }
    }
  }
  // buildings: none with a road through it
  const inPoly = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], q = P[j]; if ((a[1] > y) !== (q[1] > y) && x < ((q[0] - a[0]) * (y - a[1])) / (q[1] - a[1]) + a[0]) c = !c; } return c; };
  for (const b of W.buildings) {
    const P = b.pts.map(([la, lo]) => xy(la, lo));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
    for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); cx += x / P.length; cy += y / P.length; }
    const r = nearRoad(cx, cy, 10);
    if (r && r.d < r.hw + 1) continue;
    let crossed = false;
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G) && !crossed; gx++) for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G) && !crossed; gy++) for (const n of grid.get(gx + ',' + gy) || []) {
      const [ax, ay, bx, by] = segs[n];
      if ([0, 0.5, 1].some((t) => inPoly(P, ax + (bx - ax) * t, ay + (by - ay) * t))) { crossed = true; break; }
    }
    if (!crossed) bucket(cellOf(cx, cy)).buildings.push({ ...b, P, cx, cy });
  }
  // hedges / walls / fences: pieces of up to 15 m, none touching a road
  for (const br of W.barriers) {
    const P = br.pts.map(([la, lo]) => xy(la, lo));
    for (let i = 1; i < P.length; i++) {
      const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), n = Math.max(1, Math.ceil(L / 15));
      for (let k = 0; k < n; k++) {
        const a = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * (k / n), P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (k / n)], b = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * ((k + 1) / n), P[i - 1][1] + (P[i][1] - P[i - 1][1]) * ((k + 1) / n)];
        if ([a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]].some(([x, y]) => { const r = nearRoad(x, y); return r && r.d < r.hw + 0.6; })) continue;
        bucket(cellOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).barriers.push([a[0], a[1], b[0], b[1], br.t]);
      }
    }
  }
  // Junctions, as real ones (the owner 2026-11-15, with a Street View photo of Finstall Road / St Godwalds Road: no grey
  // blobs): where three or more roads meet, the through road (the best-ranked, straightest pair) carries on with its
  // markings; every other road stops at the through road's edge, with a rounded mouth of plain road (behind the through
  // road) and give-way lines across it. Junctions with no clear through road (roundabout ends, five-ways) keep a patch.
  const RANK = { trunk: 7, primary: 6, secondary: 5, tertiary: 4, unclassified: 3, residential: 3, living_street: 2, cycleway: 1, track: 1, bridleway: 0, path: 0, footway: 0 };
  const rank = (hw) => (RANK[String(hw).replace('_link', '')] || 2) - (/_link$/.test(hw) ? 1 : 0);
  const ends = new Map(), trim = new Map();
  const dirFrom = (P) => { let acc = 0, k = 1; while (k < P.length - 1 && acc + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]) < 8) { acc += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); k++; } const dx = P[k][0] - P[0][0], dy = P[k][1] - P[0][1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  roads.forEach((r, i) => {
    const e = R.edges[i];
    for (const [j, end, D] of [[e.a, 'a', dirFrom(r.P)], [e.b, 'b', dirFrom([...r.P].reverse())]]) { if (!ends.has(j)) ends.set(j, []); ends.get(j).push({ i, end, D, hw: r.hw, rk: rank(e.hw) }); }
  });
  const quad = (A, B, C, D) => [A, B, C, D];
  for (const [j, list] of ends) {
    if (list.length < 3) continue;
    const J = xy(...R.junctions[j]);
    let best = null;
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const dot = list[u].D[0] * list[v].D[0] + list[u].D[1] * list[v].D[1];
      if (dot > -0.5) continue; // not a straight-ish pair
      const score = (list[u].rk + list[v].rk) * 10 - dot * 6;
      if (!best || score > best.score) best = { u, v, score };
    }
    if (!best) { // no through road: every road stops at a patch, as before
      const hw = Math.max(...list.map((q) => q.hw));
      for (const q of list) trim.set(q.i + q.end, hw);
      bucket(cellOf(J[0], J[1])).discs.push([J[0], J[1], hw * 1.45 + 0.4, j]);
      continue;
    }
    const A = list[best.u], B = list[best.v], T0 = [A.D[0] - B.D[0], A.D[1] - B.D[1]], TL = Math.hypot(T0[0], T0[1]) || 1, T = [T0[0] / TL, T0[1] / TL], N = [-T[1], T[0]];
    const hm = Math.max(A.hw, B.hw);
    for (const q of list) {
      if (q === A || q === B) continue;
      const dn = q.D[0] * N[0] + q.D[1] * N[1], sg = Math.sign(dn) || 1, Ns = [N[0] * sg, N[1] * sg];
      const sdist = Math.min(20, (hm + 0.35) / Math.max(0.35, Math.abs(dn)));
      trim.set(q.i + q.end, sdist);
      const E = [J[0] + q.D[0] * sdist, J[1] + q.D[1] * sdist], P = [-q.D[1], q.D[0]], hs = q.hw + 0.3;
      const L = [E[0] + P[0] * hs, E[1] + P[1] * hs], Rr = [E[0] - P[0] * hs, E[1] - P[1] * hs];
      const onEdge = (X) => { const d = (X[0] - J[0]) * Ns[0] + (X[1] - J[1]) * Ns[1] - (hm - 0.2); return [X[0] - Ns[0] * d, X[1] - Ns[1] * d]; };
      const flare = (X) => { const p = onEdge(X), sgn = Math.sign((X[0] - E[0]) * T[0] + (X[1] - E[1]) * T[1]) || 1; return [p[0] + T[0] * sgn * 3.5, p[1] + T[1] * sgn * 3.5]; };
      const c = bucket(cellOf(E[0], E[1]));
      // the mouth: from the side road's end, out to the through road's edge, the corners rounded off (3.5 m)
      const fl = flare(L), fr = flare(Rr), el = onEdge(L), er = onEdge(Rr);
      const mid = (X, Y, Z) => [(X[0] + 2 * Y[0] + Z[0]) / 4, (X[1] + 2 * Y[1] + Z[1]) / 4]; // a point on the curve L -> el -> fl
      c.mouths.push([L, mid(L, el, fl), fl, fr, mid(Rr, er, fr), Rr]);
      // give way: two broken white lines across the side road, 0.3 m apart, just back from the mouth
      for (const back of [0.35, 0.8]) for (let t = -q.hw + 0.25; t + 0.6 <= q.hw - 0.2; t += 0.9) {
        const o = [E[0] - q.D[0] * back, E[1] - q.D[1] * back], a1 = [o[0] + P[0] * t, o[1] + P[1] * t], a2 = [o[0] + P[0] * (t + 0.6), o[1] + P[1] * (t + 0.6)];
        c.gw.push(quad(a1, a2, [a2[0] - q.D[0] * 0.15, a2[1] - q.D[1] * 0.15], [a1[0] - q.D[0] * 0.15, a1[1] - q.D[1] * 0.15]));
      }
    }
  }
  const total = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };
  const sub = (P, a, b) => { // the part of polyline P from a m to (its length - b) m
    const out = [], end = total(P) - b; let acc = 0;
    for (let i = 1; i < P.length && acc < end; i++) {
      const p = P[i - 1], q = P[i], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const lo = Math.max(a, acc), hi = Math.min(acc + L, end);
      if (hi > lo) { const f = (t) => [p[0] + (q[0] - p[0]) * ((t - acc) / L), p[1] + (q[1] - p[1]) * ((t - acc) / L)]; if (!out.length) out.push(f(lo)); out.push(f(hi)); }
      acc += L;
    }
    return out;
  };
  // raised pavements with kerbs (2026-11-16, towards Zwift: a real step up from the road) along town roads, as the painted
  // pavements (paint.js): residential streets, and bigger roads with buildings near. Points every ~4 m with the outward
  // normal, stopping 3 m short of each junction's trim (the painted pavement rounds the corner)
  const bnear = new Set(), bclose = new Set(); for (const b of W.buildings) { const [x, y] = xy(...b.pts[0]); bnear.add(Math.floor(x / 60) + ',' + Math.floor(y / 60)); bclose.add(Math.floor(x / 15) + ',' + Math.floor(y / 15)); }
  const bedge = new Set(); for (const b of W.buildings) for (const q of b.pts) { const [x, y] = xy(...q); bedge.add(Math.floor(x / 3) + ',' + Math.floor(y / 3)); }
  // (outlines replaced by landmark models, landmarks.mjs W.hidden: every 2 m along their walls, so the whole front counts
  // as at the pavement: the Black Cross got a hedge across its front, 2026-11-22)
  for (const P of W.hidden || []) for (let k = 1; k < P.length; k++) { const [x0, y0] = xy(...P[k - 1]), [x1, y1] = xy(...P[k]), n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2)); for (let m = 0; m <= n; m++) { const x = x0 + ((x1 - x0) * m) / n, y = y0 + ((y1 - y0) * m) / n; bedge.add(Math.floor(x / 3) + ',' + Math.floor(y / 3)); bclose.add(Math.floor(x / 15) + ',' + Math.floor(y / 15)); } }
  const flush = (x, y) => [-1, 0, 1].some((i) => [-1, 0, 1].some((j) => bedge.has((Math.floor(x / 3) + i) + ',' + (Math.floor(y / 3) + j)))); // a building right at the pavement (shops): no garden wall
  const houseBy = (x, y) => [-1, 0, 1].some((i) => [-1, 0, 1].some((j) => bclose.has((Math.floor(x / 15) + i) + ',' + (Math.floor(y / 15) + j))));
  const townish = (P) => { let n = 0, hit = 0; P.forEach(([x, y], k) => { if (k % 3) return; n++; if ([-1, 0, 1].some((i) => [-1, 0, 1].some((j) => bnear.has((Math.floor(x / 60) + i) + ',' + (Math.floor(y / 60) + j))))) hit++; }); return n > 0 && hit / n >= 0.5; }; // (as paintcore.js town(): buildings along half the way)
  // nothing of a pavement may stand on another road (the owner 2026-11-16: pavements across side-road mouths, walls and
  // hedges across junctions, a side road's pavement poking into the main road on a Y-junction): every road's segments
  // in a 20 m grid; a kerb / lamp point within another road's half-width + 0.3 m of its line, or a garden wall within
  // + 2.2 m, is left out (its run split there)
  const segG = new Map();
  roads.forEach((r, i) => { const e = R.edges[i]; if (e.bridge || e.tunnel) return; for (let k = 1; k < r.P.length; k++) { const a = r.P[k - 1], b = r.P[k]; for (let gx = Math.floor((Math.min(a[0], b[0]) - 8) / 20); gx <= Math.floor((Math.max(a[0], b[0]) + 8) / 20); gx++) for (let gy = Math.floor((Math.min(a[1], b[1]) - 8) / 20); gy <= Math.floor((Math.max(a[1], b[1]) + 8) / 20); gy++) { const key = gx + ',' + gy; if (!segG.has(key)) segG.set(key, []); segG.get(key).push([a[0], a[1], b[0], b[1], r.hw, i]); } } });
  const onOther = (x, y, i, clear) => { for (const [ax, ay, bx, by, hw, j] of segG.get(Math.floor(x / 20) + ',' + Math.floor(y / 20)) || []) { if (j === i) continue; const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)); if (Math.hypot(x - ax - vx * t, y - ay - vy * t) < hw + clear) return true; } return false; };
  const runsOf = (pts, ok) => { const out = []; let cur = []; for (const p of pts) { if (ok(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } } if (cur.length > 1) out.push(cur); return out; };
  roads.forEach((r, i) => {
    const e = R.edges[i];
    if (e.bridge || e.tunnel || e.rb) return;
    const pave = e.sw ? e.sw === 'y' : /^(residential|living_street)$/.test(e.hw) || (/^(primary|secondary|tertiary|unclassified)/.test(e.hw) && townish(r.P)); // (OSM's sidewalk tag first: build.mjs e.sw)
    if (!pave) return;
    const ta = (trim.get(i + 'a') || 0) + 3, tb = (trim.get(i + 'b') || 0) + 3;
    const C0 = sub(r.P, ta, tb);
    if (C0.length < 2 || total(C0) < 6) return;
    const D = [C0[0]]; for (let k = 1; k < C0.length; k++) { const a = C0[k - 1], b = C0[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4)); for (let m = 1; m <= n; m++) D.push([a[0] + ((b[0] - a[0]) * m) / n, a[1] + ((b[1] - a[1]) * m) / n]); }
    for (const side of [-1, 1]) {
      const all = D.map((p, k) => { const a = D[Math.max(0, k - 1)], b = D[Math.min(D.length - 1, k + 1)], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1, nx = (vy / L) * side, ny = (-vx / L) * side; return [p[0] + nx * r.hw, p[1] + ny * r.hw, nx, ny]; });
      for (const pts of runsOf(all, (q) => !onOther(q[0] + q[2] * 1.85, q[1] + q[3] * 1.85, i, 2.2))) {
      // front garden boundaries along the back of the pavement where there are houses: 7 m of low brick wall or hedge,
      // a 3 m gap (a drive), the kind changing from plot to plot
      { let acc = 0, on = null; const piece = (a, b, n) => { const t = ['brick', 'hedge', 'hedge', 'brick', 'stone'][(Math.abs(Math.round(a[0] * 7 + a[1] * 13)) + n) % 5]; bucket(cellOf(a[0], a[1])).fronts.push([a[0] + a[2] * 1.85, a[1] + a[3] * 1.85, b[0] + b[2] * 1.85, b[1] + b[3] * 1.85, t]); };
        for (let k = 1, n = 0; k < pts.length; k++) {
          const L = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); acc += L;
          const by = houseBy(pts[k][0] + pts[k][2] * 8, pts[k][1] + pts[k][3] * 8) && !flush(pts[k][0] + pts[k][2] * 2.5, pts[k][1] + pts[k][3] * 2.5);
          if (on === null && acc > 3 && by) { on = pts[k - 1]; acc = 0; }
          else if (on && (acc > 7 || !by)) { piece(on, pts[k], n++); on = null; acc = 0; }
        } } }
      for (const pts of runsOf(all, (q) => !onOther(q[0], q[1], i, 0.3) && !onOther(q[0] + q[2] * 1.7, q[1] + q[3] * 1.7, i, 0.3))) {
      // street lamps on the pavement by the kerb, every ~32 m, alternating sides
      if (side === (i % 2 ? 1 : -1)) { let acc = 16; for (let k = 1; k < pts.length; k++) { acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); if (acc >= 32) { acc = 0; const [x, y, nx, ny] = pts[k]; bucket(cellOf(x, y)).lamps.push([x + nx * 0.45, y + ny * 0.45, -nx, -ny]); } } }
      let cur = null, key = null;
      for (let k = 0; k < pts.length; k++) { const c = cellOf(pts[k][0], pts[k][1]); if (c !== key) { if (cur) { cur.push(pts[k]); bucket(key).kerbs.push(cur); } cur = k ? [pts[k - 1], pts[k]] : [pts[k]]; key = c; } else cur.push(pts[k]); }
      if (cur && cur.length > 1) bucket(key).kerbs.push(cur);
      }
    }
  });
  // traffic lights (2026-11-16, the owner: "traffic lights for me in the right places"): OSM's signal nodes (signals.mjs,
  // W.signals) grouped within 30 m; a group by a junction gets a signal on the LEFT of every approach that can be ridden
  // towards it (UK), at the stop line just back from the junction, facing the oncoming traffic, with a stop line across
  // its half of the road; a group away from junctions is a signalled crossing (both directions). Opposite approaches
  // share a phase, crossing ones are half a cycle apart; every junction has its own timing. bucket.lights:
  // [x, y, facing x, facing y, phase]
  if (W.signals?.length) {
    const jXY = R.junctions.map(([la, lo]) => xy(la, lo)), groups = [];
    for (const [la, lo] of W.signals) { const [x, y] = xy(la, lo); const g = groups.find((q) => Math.hypot(q.x - x, q.y - y) < 30); if (g) { g.pts.push([x, y]); g.x = g.pts.reduce((t, p) => t + p[0], 0) / g.pts.length; g.y = g.pts.reduce((t, p) => t + p[1], 0) / g.pts.length; } else groups.push({ x, y, pts: [[x, y]] }); }
    const along = (Q, d) => { let acc = 0; for (let k = 1; k < Q.length; k++) { const L = Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1]); if (acc + L >= d) { const t = (d - acc) / (L || 1); return { x: Q[k - 1][0] + (Q[k][0] - Q[k - 1][0]) * t, y: Q[k - 1][1] + (Q[k][1] - Q[k - 1][1]) * t, ux: (Q[k][0] - Q[k - 1][0]) / (L || 1), uy: (Q[k][1] - Q[k - 1][1]) / (L || 1) }; } acc += L; } return null; };
    const place = (cx, cy, tx, ty, hw, phase) => { // a signal for traffic travelling (tx, ty), its stop line through (cx, cy)
      const lx = -ty, ly = tx; // (left of the direction of travel)
      bucket(cellOf(cx + lx * (hw + 0.6), cy + ly * (hw + 0.6))).lights.push([cx + lx * (hw + 0.6), cy + ly * (hw + 0.6), -tx, -ty, phase]);
      const a1 = [cx - tx * 0.4, cy - ty * 0.4], a2 = [a1[0] + lx * (hw - 0.2), a1[1] + ly * (hw - 0.2)];
      bucket(cellOf(cx, cy)).zeb.push([a1, a2, [a2[0] - tx * 0.3, a2[1] - ty * 0.3], [a1[0] - tx * 0.3, a1[1] - ty * 0.3]]);
    };
    for (const g of groups) {
      const base = (Math.abs(Math.sin(g.x * 12.9898 + g.y * 78.233)) * 43758.5453) % 1; // (this junction's own timing)
      let J = -1, bd = 18; jXY.forEach(([x, y], j) => { const d = Math.min(...g.pts.map((p) => Math.hypot(p[0] - x, p[1] - y))); if (d < bd) { bd = d; J = j; } });
      const inc = J < 0 ? [] : R.edges.map((e, i) => [e, i]).filter(([e]) => (e.a === J || e.b === J) && !e.bridge && !e.tunnel);
      if (inc.length >= 2) {
        const hwMax = Math.max(...inc.map(([, i]) => roads[i].hw));
        let a0 = null;
        for (const [e, i] of inc) {
          const out = e.a === J, can = out ? e.oneway !== 1 : e.oneway !== -1; // (can it be ridden towards the junction?)
          if (!can) continue;
          const Q = out ? roads[i].P : [...roads[i].P].reverse(), at0 = along(Q, Math.max(5, hwMax + 2.5));
          if (!at0) continue;
          const ang = Math.atan2(at0.uy, at0.ux); if (a0 === null) a0 = ang;
          place(at0.x, at0.y, -at0.ux, -at0.uy, roads[i].hw, (base + (Math.abs(Math.sin(ang - a0)) > 0.7 ? 0.5 : 0)) % 1);
        }
      } else { // a signalled crossing: the nearest road, both ways (as its one-way allows)
        let best = null; for (const [ax, ay, bx, by, hw, i] of segG.get(Math.floor(g.x / 20) + ',' + Math.floor(g.y / 20)) || []) { const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((g.x - ax) * vx + (g.y - ay) * vy) / L2)), d = Math.hypot(g.x - ax - vx * t, g.y - ay - vy * t); if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, px: ax + vx * t, py: ay + vy * t, ux: vx / L, uy: vy / L, hw, i }; } }
        if (!best || best.d > 12) continue;
        const e = R.edges[best.i];
        if (e.oneway !== -1) place(best.px - best.ux * 2.5, best.py - best.uy * 2.5, best.ux, best.uy, best.hw, base);
        if (e.oneway !== 1) place(best.px + best.ux * 2.5, best.py + best.uy * 2.5, -best.ux, -best.uy, best.hw, base);
      }
    }
  }
  // road crossings (the owner 2026-11-16): zebras (white stripes along the road across its width, a Belisha beacon on each
  // kerb), signalled crossings (two lines of studs across), other marked ones (studs). bucket.zeb: white quads on the
  // ground, always drawn (with the painted ground too); bucket.beacons: [x, y]
  for (const [la, lo, ty] of W.crossings || []) {
    const [x, y] = xy(la, lo);
    let best = null; for (const [ax, ay, bx, by, hw] of segG.get(Math.floor(x / 20) + ',' + Math.floor(y / 20)) || []) { const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)), d = Math.hypot(x - ax - vx * t, y - ay - vy * t); if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, px: ax + vx * t, py: ay + vy * t, ux: vx / L, uy: vy / L, hw }; } }
    if (!best || best.d > 8) continue;
    const { px, py, ux, uy, hw } = best, nx = -uy, ny = ux, z = bucket(cellOf(px, py)).zeb;
    const rect = (c0, c1, a0, a1) => z.push([[px + nx * c0 + ux * a0, py + ny * c0 + uy * a0], [px + nx * c1 + ux * a0, py + ny * c1 + uy * a0], [px + nx * c1 + ux * a1, py + ny * c1 + uy * a1], [px + nx * c0 + ux * a1, py + ny * c0 + uy * a1]]); // (across c0..c1, along a0..a1)
    if (ty === 'zebra') {
      for (let c = -hw + 0.25; c + 0.5 <= hw - 0.1; c += 1.0) rect(c, c + 0.5, -1.4, 1.4);
      for (const sd of [-1, 1]) bucket(cellOf(px + nx * sd * (hw + 0.5), py + ny * sd * (hw + 0.5))).beacons.push([px + nx * sd * (hw + 0.5), py + ny * sd * (hw + 0.5)]);
    } else for (const a of [-1.6, 1.6]) for (let c = -hw + 0.2; c + 0.2 <= hw - 0.1; c += 0.55) rect(c, c + 0.2, a - 0.1, a + 0.1);
  }
  // canals and rivers as level water (the owner 2026-11-17: painted on the ground the water followed every bump, bridges
  // "imprinted on the water"): each line with its levels (bheights.mjs `lv`), cut into the squares; bucket.water
  // { P: [[x, y, level]], w }. Tunnels (Tardebigge, Shortwood) left out.
  for (const a of W.water || []) {
    if (!a.lv || a.tunnel || a.bridge || /tunnel/i.test(a.name || '') || !/^(canal|river)$/.test(a.t)) continue; // (a.bridge: an aqueduct, its own model)
    const P = a.pts.map(([la, lo], k) => [...xy(la, lo), a.lv[k]]).filter((q) => Number.isFinite(q[2]));
    let cur = null, key = null;
    for (let k = 1; k < P.length; k++) { const c = cellOf((P[k - 1][0] + P[k][0]) / 2, (P[k - 1][1] + P[k][1]) / 2); if (c !== key) { if (cur) bucket(key).water.push(cur); cur = { P: [P[k - 1]], w: Math.min(12, a.w || 8), flight: a.flight ? 1 : 0 }; key = c; } cur.P.push(P[k]); }
    if (cur) bucket(key).water.push(cur);
  }
  // motorways: plain pieces in the squares (no junction trimming: they meet nothing that's ridden)
  for (const r of mroads) {
    // (a motorway bridge: a deck at its surveyed height with parapets, whole, in the square of its middle)
    if (r.dk) { const m = r.P[Math.floor(r.P.length / 2)]; bucket(cellOf(m[0], m[1])).roads.push({ P: r.P, w: r.hw * 2, e: -1, d0: 0, span: true, ele: r.dk, parapet: true, name: 'motorway' }); continue; }
    // (every other piece at its own surveyed heights, in pieces of ~120 m: drawn on the terrain they sank where the ground
    // is lowered for a lane passing under a bridge)
    if (r.ele && !r.br) { for (let k0 = 0; k0 < r.P.length - 1; k0 += 12) { const P = r.P.slice(k0, k0 + 13), ele = r.ele.slice(k0, k0 + 13); if (P.length < 2) continue; const m = P[Math.floor(P.length / 2)]; bucket(cellOf(m[0], m[1])).roads.push({ P, w: r.hw * 2, e: -1, d0: 0, span: true, ele, parapet: false, name: 'motorway' }); } continue; }
    if (r.br) continue; // (a bridge piece with no surveyed deck: left out rather than sunk into the road below)
    let cur = null, key = null, acc = 0;
    for (let k = 1; k < r.P.length; k++) {
      const a = r.P[k - 1], b = r.P[k], c = cellOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (c !== key) { if (cur) bucket(key).roads.push(cur); cur = { P: [a], w: r.hw * 2, e: -1, d0: acc }; key = c; }
      cur.P.push(b); acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (cur) bucket(key).roads.push(cur);
  }
  // every road (trimmed), cut into the squares; each piece shares its end point with the next, and remembers how far
  // along its road it starts (the texture runs on across squares)
  roads.forEach((r, i) => {
    const e = R.edges[i];
    // bridges (and tunnels) whole, in the square of their middle, heights straight between their two ends: the terrain
    // has the railway / river under them (the humpback bridge at Aston Fields dipped into the cutting, the owner)
    // a deck of its own only for road bridges 12 m or longer: a path's bridge or a little one over a brook is just the
    // levelled ground (flatterrain.js carries it at its own height; Drovers Way's 8 m bridleway bridge stood up as a
    // tarmac ramp with a centre line, the owner 2026-11-17)
    const spanLen = r.P.slice(1).reduce((t, q, k) => t + Math.hypot(q[0] - r.P[k][0], q[1] - r.P[k][1]), 0);
    if ((e.bridge || e.tunnel) && !e.off && spanLen >= 12) { const P = r.P, m = P[Math.floor(P.length / 2)]; bucket(cellOf(m[0], m[1])).roads.push({ P, w: r.hw * 2, e: r.e, d0: 0, span: true, ele: e.pts.map((q) => q[2]), parapet: !!e.bridge && !MODEL_PARAPETS.has(e.name), name: e.name }); return; }
    const ta = trim.get(i + 'a') || 0, tb = trim.get(i + 'b') || 0;
    const P = ta || tb ? sub(r.P, ta, tb) : r.P;
    if (P.length < 2) return;
    let cur = null, key = null, acc = ta;
    for (let k = 1; k < P.length; k++) {
      const a = P[k - 1], b = P[k], c = cellOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (c !== key) { if (cur) bucket(key).roads.push(cur); cur = { P: [a], w: r.hw * 2, e: r.e, d0: acc }; key = c; }
      cur.P.push(b);
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (cur) bucket(key).roads.push(cur);
  });
  // named places (labels; build.mjs)
  // (a label sits just over the roof of the building it's in: 6 m up, it was inside the shop's block and hidden)
  for (const [la, lo, name, kind] of W.places || []) { // (what's inside a building styles it: buildings.js; labels are off, the owner found them rubbish)
    if (/^(information|vending|post_box)$/.test(kind)) continue;
    const [x, y] = xy(la, lo), c = per.get(cellOf(x, y));
    const b = c?.buildings.find((q) => inPoly(q.P, x, y));
    if (b && (!b.kind || kind === 'place_of_worship' || kind === 'pub')) b.kind = kind;
    if (LABELS) bucket(cellOf(x, y)).places.push([x, y, name, kind, b ? heightOf(b, areaOf(b.P)) + 1.5 : 4]);
  }
  // named shops, pubs, cafés... (extras.mjs W.shops): their building gets the name and kind for its sign (and its look)
  for (const [la, lo, name, cat] of W.shops || []) {
    const [x, y] = xy(la, lo), c = per.get(cellOf(x, y));
    let b = c?.buildings.find((q) => inPoly(q.P, x, y));
    if (!b && c) { let bd = 12; for (const q of c.buildings) { const d = Math.min(...q.P.map((p) => Math.hypot(p[0] - x, p[1] - y))); if (d < bd) { bd = d; b = q; } } }
    if (!b || b.shop) continue;
    b.shop = { name, cat };
    if (!b.kind || b.kind === 'shop') b.kind = /^(pub|bar)$/.test(cat) ? 'pub' : /^(cafe|restaurant|fast_food|bank|pharmacy|post_office|ice_cream|bakery|butcher|hairdresser|optician|dentist|doctors|veterinary)$/.test(cat) ? cat : 'shop';
  }
  // lock gates (build.mjs W.locks) across the canal: the nearest water line's direction and width; bucket.gates
  if (W.locks?.length && W.water?.length) {
    const wl = W.water.filter((a) => a.t === 'canal' || a.t === 'river').map((a) => ({ P: a.pts.map(([la, lo]) => xy(la, lo)), w: a.w, lv: a.lv })), gates = [];
    // (locks with their own model, canal.mjs: Tardebigge; their code-built gates and chamber stand aside)
    const modelled = (W.canal?.locks || []).filter((k) => (W.landmarks || []).some((m) => m.lock === k.ref)).map((k) => xy((k.up[0] + k.down[0]) / 2, (k.up[1] + k.down[1]) / 2));
    for (const [la, lo] of W.locks) {
      { const [gx, gy] = xy(la, lo); if (modelled.some(([mx, my]) => Math.hypot(gx - mx, gy - my) < 20)) continue; }
      const [x, y] = xy(la, lo); let best = null;
      for (const a of wl) for (let k = 1; k < a.P.length; k++) { const [ax, ay] = a.P[k - 1], [bx, by] = a.P[k], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)), d = Math.hypot(x - ax - vx * t, y - ay - vy * t); if (d < 15 && (!best || d < best.d)) { const L = Math.sqrt(L2); best = { d, px: ax + vx * t, py: ay + vy * t, ux: vx / L, uy: vy / L, w: a.w, lv: a.lv?.[t < 0.5 ? k - 1 : k] }; } }
      if (best) gates.push(best);
    }
    // a lock = two gates 12-45 m apart along the canal: a brick chamber between them (narrow-boat width) and the gate
    // pairs at its ends at the water level (the owner 2026-11-17: "the water and locks need to be drawn a lot better")
    const used = new Set();
    gates.forEach((g, i) => {
      if (used.has(i)) return;
      let mate = -1, bd = 45; gates.forEach((h, j) => { if (j === i || used.has(j)) return; const dx = h.px - g.px, dy = h.py - g.py, d = Math.hypot(dx, dy); if (d > 12 && d < bd && Math.abs((dx * g.ux + dy * g.uy) / d) > 0.8) { bd = d; mate = j; } });
      if (mate >= 0) { used.add(i); used.add(mate); const h = gates[mate], hi = Math.max(g.lv ?? -1e9, h.lv ?? -1e9), lo = Math.min(g.lv ?? 1e9, h.lv ?? 1e9); bucket(cellOf((g.px + h.px) / 2, (g.py + h.py) / 2)).locks.push([g.px, g.py, h.px, h.py, Number.isFinite(hi) ? hi : null, Number.isFinite(lo) ? lo : null, Math.min(12, g.w || 8)]); }
    });
    for (const g of gates) bucket(cellOf(g.px, g.py)).gates.push([g.px, g.py, g.ux, g.uy, 2.6, g.lv ?? null]);
  }
  world.idx = { per, ll, xy, area: true, nearRoad };
  console.info('open world:', per.size, 'squares,', roads.length, 'roads');
}
// a name board's look by what the place is (OSM shop= / amenity=): pubs dark with gold serif lettering, cafés cream,
// restaurants black with white serif, takeaways bright, chemists white with a green cross, banks navy, butchers red...
function signScheme(cat, name) { // (with readable text whatever was picked: dark on light boards, light on dark)
  const sc = signScheme0(cat, name), lum = (hx) => { const n = parseInt(hx.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  if (Math.abs(lum(sc.bg) - lum(sc.fg)) < 0.45) sc.fg = lum(sc.bg) > 0.55 ? '#1a1a1a' : '#ffffff';
  return sc;
}
function signScheme0(cat, name) {
  const h = [...String(name)].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const pick = (a) => a[h % a.length], serif = 'Georgia, "Times New Roman", serif', sans = 'Inter, Arial, sans-serif';
  if (/^(pub|bar)$/.test(cat)) return { bg: pick(['#1d3b2a', '#4a1420', '#1a2440', '#2b2b2b']), fg: '#e8c76a', edge: '#e8c76a', font: serif, weight: '700', upper: false };
  if (/^(cafe|ice_cream|coffee|tea)$/.test(cat)) return { bg: pick(['#f3ead8', '#e7f1ec', '#f6e3e3']), fg: '#5a3b26', edge: '#8a6a4a', font: serif, weight: '700', upper: false, icon: '☕' };
  if (cat === 'restaurant') return { bg: pick(['#151515', '#3b1d14', '#13283a']), fg: '#f4f1ea', edge: '#c9a45a', font: serif, weight: '600', upper: false };
  if (cat === 'fast_food') return { bg: pick(['#c4161c', '#f2b705', '#1f5fae']), fg: '#ffffff', edge: '#ffffff', font: sans, weight: '900', upper: true };
  if (/^(pharmacy|chemist)$/.test(cat)) return { bg: '#ffffff', fg: '#0f7a43', edge: '#19a55a', font: sans, weight: '800', upper: true, icon: 'cross' };
  if (cat === 'bank') return { bg: pick(['#0d2c54', '#1b1b1b', '#7a1212']), fg: '#ffffff', edge: '#d9d9d9', font: sans, weight: '700', upper: true };
  if (/^(butcher|deli)$/.test(cat)) return { bg: '#8c1c13', fg: '#ffffff', edge: '#f2f2f2', font: serif, weight: '700', upper: true };
  if (/^(bakery|confectionery)$/.test(cat)) return { bg: '#f1e2c6', fg: '#6b3e1f', edge: '#6b3e1f', font: serif, weight: '700', upper: false, icon: '🥖' };
  if (/^(hairdresser|beauty|barber|nails|cosmetics)$/.test(cat)) return { bg: pick(['#111111', '#f4f4f4', '#d9a5b3']), fg: pick(['#f4f4f4', '#111111']), edge: '#999999', font: sans, weight: '300', upper: true };
  if (/^(convenience|supermarket|newsagent|alcohol|off_licence)$/.test(cat)) return { bg: pick(['#c8102e', '#00539f', '#007a33', '#ff6b00']), fg: '#ffffff', edge: '#ffffff', font: sans, weight: '800', upper: true };
  if (cat === 'charity' || cat === 'second_hand') return { bg: pick(['#5b2a6e', '#00785a', '#e4002b']), fg: '#ffffff', edge: '#ffffff', font: sans, weight: '700', upper: true };
  if (/^(florist|garden_centre)$/.test(cat)) return { bg: '#e9f2e1', fg: '#2f5d27', edge: '#2f5d27', font: serif, weight: '700', upper: false, icon: '🌷' };
  if (/^(estate_agent|travel_agency|optician|dentist|doctors|veterinary|post_office|library)$/.test(cat)) return { bg: pick(['#ffffff', '#0b3a5b', '#262626']), fg: pick(['#0b3a5b', '#ffffff']), edge: '#7f8c96', font: sans, weight: '700', upper: true };
  if (/^(bicycle)$/.test(cat)) return { bg: '#111111', fg: '#ff5a1f', edge: '#ff5a1f', font: sans, weight: '900', upper: true, icon: '🚲' };
  if (/^(takeaway|fish_and_chips)$/.test(cat)) return { bg: '#0d4c92', fg: '#ffffff', edge: '#ffd200', font: sans, weight: '900', upper: true };
  return { bg: pick(['#1f3f6e', '#8a1c2b', '#20503a', '#2a2a2a', '#b5651d', '#5b2a6e', '#f2f2f2']), fg: '#ffffff', edge: '#e6d8b0', font: pick([sans, serif]), weight: '700', upper: h % 3 !== 0 };
}

// traffic light colours and the cycle (36 s: red, red + amber, green, amber; UK order)
const LIGHT_ON = [new C.Color(1, 0.13, 0.08, 1), new C.Color(1, 0.62, 0.06, 1), new C.Color(0.2, 1, 0.42, 1)];
const LIGHT_OFF = [new C.Color(0.16, 0.05, 0.04, 1), new C.Color(0.17, 0.11, 0.03, 1), new C.Color(0.04, 0.13, 0.07, 1)];
const LIGHT_T = 36;
function lightState(ph) { const t = ((performance.now() / 1000) / LIGHT_T + ph) % 1; return t < 0.42 ? 0 : t < 0.47 ? 1 : t < 0.92 ? 2 : 3; } // 0 red, 1 red+amber, 2 green, 3 amber
const LIT = [[1, 0, 0], [1, 1, 0], [0, 0, 1], [0, 1, 0]];
function animateLights() {
  if (performance.now() - (world.lightAt || 0) < 250) return;
  world.lightAt = performance.now();
  for (const ch of world.chunks.values()) {
    if (!ch.lightPrim?.ready) continue;
    for (const L of ch.lights || []) {
      const st = lightState(L.ph); if (st === L.st) continue; L.st = st;
      for (let k = 0; k < 3; k++) { const a = ch.lightPrim.getGeometryInstanceAttributes(`sig:${L.n}:${k}`); if (a) a.color = C.ColorGeometryInstanceAttribute.toValue(LIT[st][k] ? LIGHT_ON[k] : LIGHT_OFF[k], a.color); }
    }
    for (const B of ch.beacons || []) { // (Belisha beacons flash about once a second)
      const st = ((performance.now() / 1000 + B.ph) % 1.1) < 0.55 ? 1 : 0; if (st === B.st) continue; B.st = st;
      const a = ch.lightPrim.getGeometryInstanceAttributes(`bea:${B.n}`); if (a) a.color = C.ColorGeometryInstanceAttribute.toValue(st ? new C.Color(1, 0.66, 0.1, 1) : LIGHT_OFF[1], a.color);
    }
  }
}

// openworld.js: the roads (edge ids) and junctions the ridden route uses; their road-layer pieces are hidden (the clean
// road with its markings is drawn there, and the layer, pulled to the front, painted over it: the owner, "blanket grey")
export function setRidden(edges, junctions) { world.ridden = { edges, junctions, ver: (world.ridden?.ver || 0) + 1 }; }
function applyRidden(ch) {
  const R = world.ridden;
  if (!R || !ch.parts?.length || ch.ridVer === R.ver) return;
  if (ch.parts.some((q) => q.prim && !q.prim.ready)) return; // (next frame)
  for (const q of ch.parts) {
    const hide = q.e != null ? R.edges.has(q.e) : R.junctions.has(q.j);
    try { const at = q.prim.getGeometryInstanceAttributes(q.id); if (at) at.show = C.ShowGeometryInstanceAttribute.toValue(!hide); } catch { /* not ready */ }
  }
  ch.ridVer = R.ver;
}
function updateArea() {
  animateLights();
  // with the painted ground the roads are painted (flowing junctions, on the ground); the 3D road layer only without it
  const show3d = !paint.layer || !paint.on;
  for (const ch of world.chunks.values()) { applyRidden(ch); for (const pr of ch.roadPrims || []) if (pr && pr.show !== show3d) pr.show = show3d; for (const pr of ch.kerbPrims || []) if (pr.show === show3d) pr.show = !show3d; }
  const q = route.at(state.dist), [x, y] = world.idx.xy(q.lat, q.lon);
  const a = route.at(Math.min(route.length, state.dist + 300)), [ax, ay] = world.idx.xy(a.lat, a.lon);
  // (the ground's LIDAR blocks along the next 600 m, fetched before the terrain asks: flatterrain.js prefetch)
  if (performance.now() - (world.pfAt || 0) > 500 && viewer?.terrainProvider?.prefetch) { world.pfAt = performance.now(); const P = []; for (let s = -50; s <= 600; s += 50) { const p = route.at(Math.max(0, Math.min(route.length, state.dist + s))); P.push([p.lat, p.lon]); } viewer.terrainProvider.prefetch(P); }
  for (const [k, v] of world.chunks) {
    const [i, j] = k.split(',').map(Number);
    if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y) > DROP_R) { for (const p of v.prims) viewer.scene.primitives.remove(p); for (const e of v.ents || []) viewer.entities.remove(e); world.chunks.delete(k); }
  }
  if (world.building) return;
  // the nearest missing square to a point a little ahead of the rider
  let next = null, bd = Infinity;
  const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL), n = Math.ceil(NEAR_R / CELL) + 1;
  for (let i = i0 - n; i <= i0 + n; i++) for (let j = j0 - n; j <= j0 + n; j++) {
    const k = i + ',' + j;
    if (world.chunks.has(k)) continue;
    const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
    if (Math.hypot(cx - x, cy - y) > NEAR_R) continue;
    const d = Math.hypot(cx - (x + ax) / 2, cy - (y + ay) / 2);
    if (d < bd) { bd = d; next = k; }
  }
  if (next === null) return;
  world.building = true;
  buildChunk(next).then((v) => { if (v) world.chunks.set(next, v); }).catch((e) => { console.warn('world square', next, e); world.chunks.set(next, { prims: [] }); })
    .finally(() => { world.building = false; });
}

// ---------- building a chunk ----------
const COL = {
  walls: [[0.62, 0.36, 0.27], [0.58, 0.32, 0.24], [0.84, 0.79, 0.68], [0.78, 0.76, 0.72], [0.9, 0.89, 0.85], [0.68, 0.62, 0.52], [0.74, 0.66, 0.55]],
  big: [[0.7, 0.72, 0.74], [0.62, 0.64, 0.67], [0.8, 0.78, 0.74], [0.55, 0.58, 0.62]],
  roofs: [[0.27, 0.29, 0.33], [0.36, 0.33, 0.32], [0.55, 0.27, 0.19], [0.47, 0.24, 0.17]],
  flat: [[0.38, 0.38, 0.4], [0.45, 0.45, 0.46]],
  leaves: [[0.2, 0.36, 0.14], [0.26, 0.42, 0.16], [0.18, 0.31, 0.13], [0.32, 0.45, 0.2], [0.23, 0.38, 0.19]],
  conifer: [[0.12, 0.25, 0.14], [0.15, 0.29, 0.16], [0.1, 0.22, 0.13]],
  trunk: [0.32, 0.24, 0.17],
  hedge: [0.2, 0.34, 0.15], wall: [0.62, 0.58, 0.52], fence: [0.42, 0.32, 0.22],
};
// foliage textures: clumps of leaves (each leaf a small ellipse, lighter and darker greens, dark gaps between), five
// broadleaf greens and three conifer needle greens; repeated round each crown
let LEAFLOOK = null;
function leafTex([r0, g0, b0], seed, needles) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  let sd = seed * 7919 + 1; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  g.fillStyle = `rgb(${r0 * 0.55 | 0},${g0 * 0.55 | 0},${b0 * 0.55 | 0})`; g.fillRect(0, 0, S, S);
  for (let i = 0; i < (needles ? 1600 : 900); i++) {
    const x = R() * S, y = R() * S, k = 0.7 + R() * 0.55, a = R() * Math.PI;
    g.fillStyle = `rgb(${Math.min(255, r0 * k) | 0},${Math.min(255, g0 * k) | 0},${Math.min(255, b0 * k) | 0})`;
    g.beginPath(); if (needles) { g.ellipse(x, y, 7, 1.6, a, 0, Math.PI * 2); } else { g.ellipse(x, y, 7 + R() * 4, 4 + R() * 2, a, 0, Math.PI * 2); } g.fill();
    for (const [dx, dy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) if ((dx && Math.abs(x + dx - S / 2) < S / 2 + 12) || (dy && Math.abs(y + dy - S / 2) < S / 2 + 12)) { g.beginPath(); g.ellipse(x + dx, y + dy, needles ? 7 : 9, needles ? 1.6 : 5, a, 0, Math.PI * 2); g.fill(); } // (tiles seamlessly)
  }
  return c;
}
function leafLooks() {
  if (LEAFLOOK) return LEAFLOOK;
  const G = [[78, 132, 52], [96, 150, 58], [66, 118, 50], [118, 162, 66], [84, 140, 70], [44, 92, 54], [52, 104, 60], [38, 82, 50]];
  LEAFLOOK = G.map((col, k) => new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: leafTex(col, 30 + k, k >= 5), repeat: new C.Cartesian2(k >= 5 ? 6 : 5, k >= 5 ? 3 : 3) }), flat: false, faceForward: true, closed: true }));
  return LEAFLOOK;
}
// sun shadows (2026-11-16, towards Zwift's look): buildings, trees, walls and lamps cast them onto the ground and each
// other, within 220 m of the camera. Setting rw.shadows: on by default, except on laptop / phone graphics (setShadows)
export const shadowMode = () => (state.shadows ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED);
export function setShadows(on) {
  state.shadows = !!on; globalThis.__rwShadow = state.shadows; // (buildings.js reads it for roofs)
  if (!viewer) return;
  viewer.shadows = state.shadows;
  viewer.terrainShadows = state.shadows ? C.ShadowMode.RECEIVE_ONLY : C.ShadowMode.DISABLED;
  const sm = viewer.scene.shadowMap;
  if (sm) { sm.softShadows = true; sm.size = 2048; sm.maximumDistance = 220; sm.darkness = 0.45; sm.fadingEnabled = true; }
  for (const ch of world.chunks.values()) for (const p of ch.prims || []) if ('shadows' in p) p.shadows = shadowMode();
}
let PAVELOOK = null;
let WATERLOOK = null;
// canal water painted like the roads (the owner 2026-11-17: "some texture on the water like the road would be lovely";
// Cesium's animated water came out flat dark grey): olive-brown with fine wavy ripples and soft sky reflections, one
// repeat = 6 m along x 1 across (st: across 0..1, along / 6 m)
function waterTex(seamless = false, tone = '#6b6a52') { // (seamless: no darkening towards the banks, for big areas tiled both ways: the Thames)
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 0);
  // (seamless, the Thames: an even brown-green; else the canal's, darker under the banks)
  if (seamless) { grd.addColorStop(0, tone); grd.addColorStop(1, tone); } else { grd.addColorStop(0, '#26332c'); grd.addColorStop(0.12, '#3c5048'); grd.addColorStop(0.5, '#4f6863'); grd.addColorStop(0.88, '#3c5048'); grd.addColorStop(1, '#26332c'); } // (2026-11-21: deeper green-blue; the olive-grey read as a tarmac road beside the towpath) // (darker under the banks)
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  let sd = 7; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  // soft reflections of the sky: pale blotches stretched along the canal
  // (drawn wrapped round the tile edges where the texture repeats: the Thames tiled into a visible grid without it)
  for (let i = 0; i < 40; i++) { const x0 = seamless ? R() * 512 : 80 + R() * 352, y0 = R() * 512, rx = 40 + R() * 90, ry = 80 + R() * 200, a = 0.1 + R() * (seamless ? 0.08 : 0.14);
    for (const ox of seamless ? [-512, 0, 512] : [0]) for (const oy of [-512, 0, 512]) { const x = x0 + ox, y = y0 + oy; const r = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); r.addColorStop(0, `rgba(196,206,206,${a})`); r.addColorStop(1, 'rgba(176,186,182,0)'); g.fillStyle = r; g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y); g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2); g.fill(); g.restore(); } }
  // ripples: short wavy strokes across the water, lighter on top, darker under (they wrap top / bottom: the texture repeats)
  for (let i = 0; i < 260; i++) {
    const x = R() * 512, y = R() * 512, len = 14 + R() * 40, amp = 0.6 + R() * 1.4;
    for (const [dy, col] of [[0, `rgba(210,215,205,${0.05 + R() * 0.09})`], [1.5, `rgba(40,40,28,${0.05 + R() * 0.07})`]]) {
      g.strokeStyle = col; g.lineWidth = 1 + R(); g.beginPath();
      for (const ox of seamless ? [-512, 0, 512] : [0]) { g.beginPath(); for (let t = 0; t <= 1.001; t += 0.1) { const px = x - len / 2 + len * t + ox, py = (y + dy + Math.sin(t * Math.PI * 2) * amp + 512) % 512; t ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); }
    }
  }
  return c;
}
const waterLook = () => (WATERLOOK ||= new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: waterTex(), repeat: new C.Cartesian2(1, 1) }), flat: false, faceForward: true, closed: false, translucent: false, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, renderState: { depthTest: { enabled: true }, cull: { enabled: false } } }));
const waterLookOld = () => (new C.MaterialAppearance({ material: C.Material.fromType('Water', { baseWaterColor: new C.Color(0.43, 0.42, 0.33, 1), blendColor: new C.Color(0.36, 0.4, 0.3, 1), normalMap: C.buildModuleUrl('Assets/Textures/waterNormals.jpg'), frequency: 900, animationSpeed: 0.006, amplitude: 1.2, specularIntensity: 0.25, fadeFactor: 1 }), translucent: true, faceForward: true, closed: false, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, renderState: { depthTest: { enabled: true }, cull: { enabled: false } } }));
const pavingLook = (rs) => (PAVELOOK ||= new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: pavingTex(), repeat: new C.Cartesian2(1, 1) }), flat: false, faceForward: true, closed: false, renderState: rs }));
const ROAD_COLOUR = new C.Color(0.47, 0.48, 0.5, 1), MARK_COLOUR = new C.Color(0.88, 0.88, 0.85, 1);
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];
const colour = ([r, g, b], v = 0) => C.ColorGeometryInstanceAttribute.fromColor(new C.Color(Math.min(1, r * (1 + v)), Math.min(1, g * (1 + v)), Math.min(1, b * (1 + v)), 1));
const BIG = /^(apartments|commercial|retail|office|industrial|warehouse|school|hospital|university|college|hotel|public|civic|supermarket|sports_hall|train_station|transportation|church|cathedral)$/;
function heightOf(b, area) {
  if (b.lh) return Math.min(120, b.lh); // (measured: bheights.mjs, the LIDAR's eaves height, 2026-11-17)
  if (b.h) return Math.min(120, b.h);
  const r = rnd(b.cx, b.cy, 11);
  if (/^(garage|garages|shed|carport|hut|kiosk|roof|greenhouse)$/.test(b.k)) return 2.6 + r * 0.8;
  if (/^(house|detached|semidetached_house|terrace|residential|bungalow|farm)$/.test(b.k)) return b.k === 'bungalow' ? 3.6 : 5.4 + r * 0.8; // (two storeys)
  if (/^(apartments)$/.test(b.k)) return 11 + r * 8;
  if (/^(church|cathedral)$/.test(b.k)) return 14 + r * 6;
  if (/^(industrial|warehouse)$/.test(b.k)) return 7 + r * 4;
  if (BIG.test(b.k)) return 9 + r * 6;
  return area < 160 ? 5.4 + r * 0.8 : area < 400 ? 6.5 + r * 2.5 : 9 + r * 5; // (small ones are houses: two storeys)
}
// the minimum-area rectangle round a footprint (rotating calipers over its hull's edges): { P: 4 corners, area, short }
function obb(P) {
  if (P.length < 4) return null;
  const pts = P.slice(0, P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1] ? -1 : undefined);
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) { const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const ar = (u1 - u0) * (v1 - v0);
    if (!best || ar < best.area) best = { area: ar, ux, uy, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uy, u0, u1, v0, v1 } = best, c = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  return { P: [c(u0, v0), c(u1, v0), c(u1, v1), c(u0, v1)], area: best.area, short: Math.min(u1 - u0, v1 - v0) };
}
const hexToRgb = (c) => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
const areaOf = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(a / 2); };

async function buildChunk(c) {
  const job = world.idx.per.get(c), gen = world.gen;
  if (!job) return { prims: [] };
  const { ll } = world.idx, prov = viewer.terrainProvider;
  // ground heights: trees, building corners (lowest is the base), barrier ends
  const carts = [], at = (x, y) => { const [la, lo] = ll(x, y); carts.push(C.Cartographic.fromDegrees(lo, la)); return carts.length - 1; };
  const tI = job.trees.map(([x, y]) => at(x, y));
  const bI = job.buildings.map((b) => b.P.map(([x, y]) => at(x, y)));
  const rI = job.barriers.map(([x1, y1, x2, y2]) => [at(x1, y1), at(x2, y2)]);
  // open world roads: every ~5 m along them, their markings and junction patches
  const dens = (P) => { const out = [P[0]]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5)); for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); } return out; };
  // (a span's ends take the ground 8 m back on the approach road: at the ends themselves the coarse ground dips into the
  // cutting under it, M42 bridge, the owner 2026-11-16)
  const roadI = (job.roads || []).map((r) => ({ w: r.w, e: r.e, d0: r.d0 || 0, span: r.span, parapet: r.parapet, name: r.name, Q: r.span ? r.P.map(([x, y], k, A) => { if (k !== 0 && k !== A.length - 1) return [x, y, -1, r.ele[k]]; const o = A[k === 0 ? 1 : A.length - 2], ux = x - o[0], uy = y - o[1], L = Math.hypot(ux, uy) || 1; return [x, y, at(x + (ux / L) * 8, y + (uy / L) * 8), r.ele[k]]; }) : dens(r.P).map(([x, y]) => [x, y, at(x, y)]) }));
  const markI = (job.marks || []).map((m) => ({ w: m.w, e: m.e, Q: m.P.map(([x, y]) => [x, y, at(x, y)]) }));
  const discI = (job.discs || []).map(([x, y, r, j]) => [x, y, r, at(x, y), j]);
  const kerbI = (job.kerbs || []).map((K) => K.map(([x, y, nx, ny]) => [x, y, nx, ny, at(x, y)]));
  const lampI = (job.lamps || []).map(([x, y, nx, ny]) => [x, y, nx, ny, at(x, y)]);
  const lightI = (job.lights || []).map(([x, y, fx, fy, ph]) => [x, y, fx, fy, ph, at(x, y)]);
  const zebI = (job.zeb || []).map((q) => [q, at((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2)]);
  const beaconI = (job.beacons || []).map(([x, y]) => [x, y, at(x, y)]);
  const gateI = (job.gates || []).map(([x, y, ux, uy, w, lv]) => [x, y, ux, uy, w, at(x, y), lv]);
  const lockI = job.locks || [];
  const waterI = job.water || [];
  const frontI = (job.fronts || []).map(([x1, y1, x2, y2, t]) => [x1, y1, x2, y2, t, at(x1, y1), at(x2, y2)]);
  const placeI = (job.places || []).map(([x, y, name, kind, up]) => [x, y, name, kind, at(x, y), up]);
  const mouthI = (job.mouths || []).map((poly) => poly.map(([x, y]) => [x, y, at(x, y)]));
  const gwI = (job.gw || []).map((q) => { const [cx, cy] = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]; return [q, at(cx, cy)]; });
  if (carts.length) await C.sampleTerrainMostDetailed(prov, carts).catch(() => {});
  if (gen !== world.gen) return null;
  const H = (i) => (Number.isFinite(carts[i].height) ? carts[i].height : null);
  const inst = [], roofs = [];
  const enu = (x, y, h) => { const [la, lo] = ll(x, y); return C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lo, la, h)); };
  // trees (at most 1400 a chunk), Zwift-like (2026-11-16): a broadleaf crown is a main clump with three or four smaller
  // clumps round and on top of it, each in one of five leafy textures (lighter on top), so the crown reads as foliage, not
  // a ball; a conifer is three stacked, narrowing tiers of needles. Trunks plain bark colour.
  const leafI = [[], [], [], [], [], [], [], []]; // 0-4 broadleaf greens, 5-7 conifer
  const LEAFV = C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat;
  job.trees.slice(0, 1400).forEach(([x, y, kind, mh, mcr], i) => {
    const g = H(tI[i]);
    if (g == null) return;
    const r = rnd(x, y), r2 = rnd(y, x, 3), r3 = rnd(x, y, 9);
    const s = mh ? mh / (kind === 'conifer' ? 16 : 7.5) : kind === 'scrub' ? 0.45 : kind === 'orchard' ? 0.5 : 0.75 + r * 0.6;
    const E = enu(x, y, g), at3 = (dx, dy, dz) => C.Matrix4.multiplyByTranslation(E, new C.Cartesian3(dx, dy, dz), new C.Matrix4());
    if (kind === 'conifer') {
      const h = (11 + r * 8) * s, tr = 1.6 * s, R = (2.2 + r) * s, v = 5 + Math.floor(r2 * 3);
      inst.push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: tr, topRadius: 0.16 * s, bottomRadius: 0.24 * s, slices: 6, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(0, 0, tr / 2), attributes: { color: colour(COL.trunk) } }));
      const H2 = h - tr * 0.5;
      [[0, 0.5, 1], [0.3, 0.42, 0.76], [0.55, 0.45, 0.5]].forEach(([z0, hh, rr]) => {
        const L = H2 * hh; leafI[v].push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: L, topRadius: 0, bottomRadius: R * rr, slices: 9, vertexFormat: LEAFV }), modelMatrix: at3(0, 0, tr * 0.5 + H2 * z0 + L / 2) }));
      });
    } else {
      const tr = (2.2 + r * 1.2) * s, rx = (2.6 + r * 1.8) * s, rz = (2.4 + r * 1.6) * s, cz = tr + rz * 0.75, v = Math.floor(r2 * 5);
      inst.push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: tr + rz * 0.6, topRadius: 0.15 * s, bottomRadius: 0.27 * s, slices: 6, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(0, 0, (tr + rz * 0.6) / 2), attributes: { color: colour(COL.trunk) } }));
      const clump = (dx, dy, dz, rr, vv) => leafI[vv % 5].push(new C.GeometryInstance({ geometry: new C.EllipsoidGeometry({ radii: new C.Cartesian3(rr, rr * (0.9 + r3 * 0.2), rr * 0.85), stackPartitions: 6, slicePartitions: 9, vertexFormat: LEAFV }), modelMatrix: at3(dx, dy, dz) }));
      clump(0, 0, cz, rx * 0.82, v); // the main clump
      const n = 3 + (r3 < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) { const a = r * 6.28 + (k * 6.28) / n; clump(Math.cos(a) * rx * 0.5, Math.sin(a) * rx * 0.5, cz - rz * 0.18 + ((k % 2) * rz * 0.25), rx * (0.52 + ((r2 * (k + 1)) % 1) * 0.12), v + 1 + k); }
      clump((r2 - 0.5) * rx * 0.3, (r3 - 0.5) * rx * 0.3, cz + rz * 0.5, rx * 0.5, v + 2 + (r < 0.5 ? 0 : 1)); // the top, catching the light
    }
  });
  // barriers
  job.barriers.forEach(([x1, y1, x2, y2, t, mh], i) => {
    const a = H(rI[i][0]), b = H(rI[i][1]);
    if (a == null || b == null) return;
    const h = mh || (t === 'hedge' ? 1.6 : t === 'fence' ? 1.1 : 1.2), w = t === 'hedge' ? 1.1 : t === 'fence' ? 0.07 : 0.45;
    const [la1, lo1] = ll(x1, y1), [la2, lo2] = ll(x2, y2);
    inst.push(new C.GeometryInstance({ geometry: new C.WallGeometry({ positions: C.Cartesian3.fromDegreesArrayHeights([lo1, la1, a + h, lo2, la2, b + h]), minimumHeights: [a - 0.4, b - 0.4], vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: colour(COL[t] || COL.wall, (rnd(x1, y1) - 0.5) * 0.15) } }));
    if (w > 0.2) { // a hedge or wall has a thickness: a second face, and a top
      const nx = -(y2 - y1), ny = x2 - x1, L = Math.hypot(nx, ny) || 1, ox = (nx / L) * w, oy = (ny / L) * w;
      const [lb1, ob1] = ll(x1 + ox, y1 + oy), [lb2, ob2] = ll(x2 + ox, y2 + oy);
      inst.push(new C.GeometryInstance({ geometry: new C.WallGeometry({ positions: C.Cartesian3.fromDegreesArrayHeights([ob1, lb1, a + h, ob2, lb2, b + h]), minimumHeights: [a - 0.4, b - 0.4], vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: colour(COL[t] || COL.wall, -0.08) } }));
      inst.push(new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArrayHeights([lo1, la1, a + h, lo2, la2, b + h, ob2, lb2, b + h, ob1, lb1, a + h])), perPositionHeight: true, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: colour(COL[t] || COL.wall, 0.1) } }));
      // the two ends closed (open ends let you see straight through a hedge, the owner 2026-11-15)
      for (const [la, lo, lb, ob, g] of [[la1, lo1, lb1, ob1, a], [la2, lo2, lb2, ob2, b]]) inst.push(new C.GeometryInstance({ geometry: new C.WallGeometry({ positions: C.Cartesian3.fromDegreesArrayHeights([lo, la, g + h, ob, lb, g + h]), minimumHeights: [g - 0.4, g - 0.4], vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: colour(COL[t] || COL.wall, -0.04) } }));
    }
  });
  // buildings
  const blds = []; // for the camera's cut-away (cutAway below)
  const styled = {}; // look -> wall instances (buildings.js)
  const signs = []; // shops' name boards (signBoards below)
  job.buildings.forEach((b, i) => {
    const id = `${c}:${i}`, show = () => new C.ShowGeometryInstanceAttribute(true);
    const hs = bI[i].map(H).filter((v) => v != null);
    if (!hs.length) return;
    const base = Math.min(...hs) - 0.3, area = areaOf(b.P), h = heightOf(b, area) + (Math.max(...hs) - Math.min(...hs)), r = rnd(b.cx, b.cy, 5);
    const big = BIG.test(b.k) || area > 600;
    const pos = b.P.map(([x, y]) => { const [la, lo] = ll(x, y); return C.Cartesian3.fromDegrees(lo, la); });
    // a pitched roof on the footprint's best-fitting rectangle when the house nearly fills it (bays, porches and small
    // extensions: most houses have more than four corners in OSM and all came out flat-roofed)
    const ob = obb(b.P), gable = !big && (b.lh ? b.lr - b.lh >= 0.8 : !b.h) && area < 300 && b.roof !== 'flat' && ob && area / ob.area > 0.8 && ob.short < 12; // (measured: pitched where the ridge stands 0.8 m+ over the eaves)
    const RP = gable ? ob.P : null;
    const wallTop = base + h - (gable ? 0 : 0);
    try {
      // walls in the look of what the building is (buildings.js): brick / render houses, shopfronts, pubs, stone churches...
      const style = styleOf({ ...b, area }, r), wids = [];
      // (which wall faces the street: the door goes there; buildings.js)
      const frontOf = world.idx.nearRoad ? (x, y, nx, ny) => { const q = world.idx.nearRoad(x, y, 40); if (!q) return -1; const dx = q.px - x, dy = q.py - y, L = Math.hypot(dx, dy) || 1; return (dx * nx + dy * ny) / L - L / 60; } : null;
      const wg = wallGeometry(b.P, ll, base, wallTop, style, frontOf);
      for (const [look, geom] of Object.entries(wg)) { const wid = id + 'w' + look; (styled[look] ||= []).push(new C.GeometryInstance({ id: wid, geometry: geom, attributes: { show: show() } })); wids.push(wid); }
      if (style.awning && wg.front && wg.front.L > 3 && wallTop - base > 5) { // a shop's awning over the pavement, sloping down and out
        const f = wg.front, L = f.L * 0.85, mx2 = (f.a[0] + f.b[0]) / 2 + f.nx * 0.65, my2 = (f.a[1] + f.b[1]) / 2 + f.ny * 0.65, [ala, alo] = ll(mx2, my2);
        const hc = hexToRgb(b.shop ? signScheme(b.shop.cat, b.shop.name).bg : FASCIA_COLOURS[style.shopIdx % FASCIA_COLOURS.length]); // (a named shop's awning in its sign's colour)
        const fr = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(alo, ala, base + 0.3 + 3.05), new C.HeadingPitchRoll(-Math.atan2(f.b[1] - f.a[1], f.b[0] - f.a[0]), 0, 0.32));
        inst.push(new C.GeometryInstance({ id: id + 'aw', geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L, 1.4, 0.06), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: fr, attributes: { color: colour(hc.map((v) => Math.min(1, v * 1.35))), show: show() } })); wids.push(id + 'aw');
      }
      if (b.shop && wg.front && wg.front.L > 3) signs.push({ f: wg.front, base, top: wallTop, ...b.shop }); // (its name board: below)
      if (style.tower && area > 70) { // a church: a stone tower at one end and a slate spire
        const t = churchTower(b.P, ll, base, wallTop);
        if (t.walls) { (styled.stone ||= []).push(new C.GeometryInstance({ id: id + 't', geometry: t.walls, attributes: { show: show() } })); wids.push(id + 't'); }
        inst.push(new C.GeometryInstance({ id: id + 's', geometry: t.spire.geometry, modelMatrix: t.spire.modelMatrix, attributes: { color: colour([0.33, 0.35, 0.38]), show: show() } })); wids.push(id + 's');
      }
      if (style.chimney && gable) { // a chimney stack on the ridge, near one end
        let [A, B, Cc, D] = RP; const e2 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]); if (e2(A, B) < e2(B, Cc)) [A, B, Cc, D] = [B, Cc, D, A];
        const m1 = [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2], m2 = [(B[0] + Cc[0]) / 2, (B[1] + Cc[1]) / 2], f = 0.18, q = [m1[0] + (m2[0] - m1[0]) * f, m1[1] + (m2[1] - m1[1]) * f];
        const rise = Math.min(4, 0.32 * e2(B, Cc) + 0.3), [qa, qo] = ll(q[0], q[1]);
        inst.push(new C.GeometryInstance({ id: id + 'c', geometry: new C.CylinderGeometry({ length: 2, topRadius: 0.42, bottomRadius: 0.42, slices: 4, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Matrix4.multiplyByTranslation(C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(qo, qa, wallTop + rise - 0.4)), new C.Cartesian3(0, 0, 1), new C.Matrix4()), attributes: { color: colour([0.5, 0.3, 0.24]), show: show() } })); wids.push(id + 'c');
      }
      if (!gable) inst.push(new C.GeometryInstance({ id: id + 'r', geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(pos), height: wallTop, extrudedHeight: wallTop + 0.35, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: colour(pick(COL.flat, r * 3)), show: show() } }));
      else roofs.push({ id: id + 'g', P: RP, top: wallTop, roof: style.roof || 'slate', wall: wallColour(style), rise: b.lh ? Math.min(7, Math.max(0.8, b.lr - b.lh)) : null });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of b.P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      blds.push({ P: b.P, x0, y0, x1, y1, top: wallTop + (style.tower ? 25 : 4), ids: [...wids, ...(gable ? [id + 'g', id + 'ge'] : [id + 'r'])], hidden: false });
    } catch { /* a footprint Cesium can't triangulate */ }
  });
  const prims = [];
  leafI.forEach((gi, k) => { if (gi.length) prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: gi, appearance: leafLooks()[k], asynchronous: true, allowPicking: false, releaseGeometryInstances: true, compressVertices: false, shadows: shadowMode() }))); });
  if (inst.length) prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: inst, appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false }), asynchronous: true, allowPicking: false, releaseGeometryInstances: true, shadows: shadowMode() })));
  if (roofs.length) for (const pr of pitchedRoofs(roofs, ll)) prims.push(viewer.scene.primitives.add(pr));
  // (compressVertices off: texture coordinates run past 1 along walls, which the packing assumes they don't)
  for (const [look, gi] of Object.entries(styled)) prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: gi, appearance: looks()[look], asynchronous: true, allowPicking: false, releaseGeometryInstances: true, compressVertices: false, shadows: shadowMode() })));
  // open world: the area's roads as flat strips a few cm over the terrain heights, pulled towards the camera so the
  // coarse terrain between samples doesn't poke through (draped GroundPrimitives were far too slow: 3 fps in town)
  const parts = []; // { id, e (edge) | j (junction), prim } for hiding what's under the ridden road (setRidden)
  const roadPrims = []; // the 3D road layer, shown only while the painted ground is off (updateArea)
  if (roadI.length) {
    const lift = OPEN_LIFT; // (the rider rides on these in an open world: survey.js groundHeight adds the same there)
    let spanPts = null;
    const strip = (Q, w, d0) => {
      let pts; const slift = Q.some((q) => q[2] < 0) && state.paintOn ? 0.03 : lift; // (a bridge meets the painted road at ground level)
      if (Q.some((q) => q[2] < 0)) { // a span: straight between its two ends' heights
        // open worlds: the deck straight from the bridge's own LIDAR heights + the terrain offset, which is what the roads
        // either side are levelled to (Drover's Way, the owner 2026-11-17: the deck from the ground 8 m along the approach
        // stood up as a ramp where that point fell on a wooded bank)
        const offT = world.terrainOff;
        if (Number.isFinite(offT) && Q.every((q) => Number.isFinite(q[3]))) {
          pts = Q.map((q) => [q[0], q[1], q[3] + offT]);
          if (spanPts) spanPts.push({ pts: pts.slice(), w });
          const ramp = (p, q) => { const vx = p[0] - q[0], vy = p[1] - q[1], L2 = Math.hypot(vx, vy) || 1; return [p[0] + (vx / L2) * 4, p[1] + (vy / L2) * 4, p[2] - 0.3]; };
          pts = [ramp(pts[0], pts[1]), ...pts, ramp(pts[pts.length - 1], pts[pts.length - 2])];
        } else {
        const h0 = H(Q[0][2]), h1 = H(Q[Q.length - 1][2]);
        if (h0 == null || h1 == null) return null;
        let L = 0; const cum = Q.map((q, k) => (k ? (L += Math.hypot(q[0] - Q[k - 1][0], q[1] - Q[k - 1][1])) : 0));
        // straight between the ends' terrain, plus the deck's hump over its own straight line (decks.mjs)
        const e0 = Q[0][3] ?? 0, e1 = Q[Q.length - 1][3] ?? 0;
        pts = Q.map((q, k) => { const t = cum[k] / (L || 1); return [q[0], q[1], h0 + (h1 - h0) * t + ((q[3] ?? 0) - (e0 + (e1 - e0) * t))]; });
        if (spanPts) spanPts.push({ pts: pts.slice(), w, name: spanName }); // (for the parapets: the deck itself)
        // ramps 6 m long at both ends, dipping 0.8 m into the ground: the painted road follows the terrain as drawn, which
        // on an embankment can sit a metre off the finest heights the deck uses (a step showed at Aston Fields)
        const ramp = (p, q) => { const vx = p[0] - q[0], vy = p[1] - q[1], L2 = Math.hypot(vx, vy) || 1; return [p[0] + (vx / L2) * 6, p[1] + (vy / L2) * 6, p[2] - 0.8]; };
        pts = [ramp(pts[0], pts[1]), ...pts, ramp(pts[pts.length - 1], pts[pts.length - 2])];
        } // (the coarse-terrain way: routes other than open worlds)
      } else pts = Q.map(([x, y, i]) => [x, y, H(i)]).filter((q) => q[2] != null);
      const pos = [], nor = [], st = [], idx = [];
      if (pts.length < 2) return null;
      let along = d0;
      pts.forEach((p, i) => {
        if (i) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1, nx = (vy / L) * (w / 2 + 0.3), ny = (-vx / L) * (w / 2 + 0.3);
        for (const [sx, side] of [[0, -1], [1, 1]]) {
          const [la, lo] = ll(p[0] + nx * side, p[1] + ny * side), c = C.Cartesian3.fromDegrees(lo, la, p[2] + slift), up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(c, new C.Cartesian3());
          pos.push(c.x, c.y, c.z); nor.push(up.x, up.y, up.z); st.push(sx, along / 6);
        }
        if (i) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      });
      return new C.Geometry({ attributes: {
        position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
        normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nor) }),
        st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }) },
        indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
    };
    const disc = (x, y, rad, h) => {
      const pos = [], idx = [], put = (px, py) => { const [la, lo] = ll(px, py), c = C.Cartesian3.fromDegrees(lo, la, h + lift - 0.01); pos.push(c.x, c.y, c.z); return pos.length / 3 - 1; };
      const c = put(x, y); let last = null;
      for (let k = 0; k <= 16; k++) { const t = (k / 16) * Math.PI * 2, v = put(x + Math.cos(t) * rad, y + Math.sin(t) * rad); if (last != null) idx.push(c, last, v); last = v; }
      return new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }) }, indices: new Uint16Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
    };
    const roadGi = [], discGi = [], roadP = [], discP = [], spanGi = [];
    const parapets = [];
    roadI.forEach((r, n) => { spanPts = r.parapet ? parapets : null; spanName = r.name; const g = strip(r.Q, r.w, r.d0); spanPts = null; if (!g) return; const id = `${c}:r${n}`; (r.span ? spanGi : roadGi).push(new C.GeometryInstance({ id, geometry: g, attributes: { show: new C.ShowGeometryInstanceAttribute(true) } })); if (!r.span) roadP.push({ id, e: r.e }); });
    discI.forEach(([x, y, rad, i, j], n) => { const h = H(i); if (h == null) return; const id = `${c}:d${n}`; discGi.push(new C.GeometryInstance({ id, geometry: disc(x, y, rad, h), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(ROAD_COLOUR), show: new C.ShowGeometryInstanceAttribute(true) } })); discP.push({ id, j }); });
    const prim = (gi, appearance) => gi.length ? prims[prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: gi, appearance, asynchronous: false, allowPicking: false, compressVertices: false, releaseGeometryInstances: true, shadows: shadowMode() }))) - 1] : null;
    // (the junction patches plain, behind the roads; the roads in the ridden road's own asphalt and markings, behind it)
    const dp = prim(discGi, new C.PerInstanceColorAppearance({ flat: true, translucent: false, renderState: { depthTest: { enabled: true }, polygonOffset: { enabled: true, factor: -3, units: -40 }, cull: { enabled: false } } })); // (behind the roads' -48, in front of the terrain)
    const rp = prim(roadGi, layerAppearance());
    prim(spanGi, layerAppearance()); // bridges and tunnels: always in 3D (the painted ground has the river / railway under them)
    // a bridge's parapets: stone walls 1 m high along both sides of the deck
    const pw = [];
    for (const { pts, w, name } of parapets) for (const side of [-1, 1]) {
      const pc = BRIDGE_COLOURS[name] || [0.62, 0.57, 0.5];
      const P = pts.map((p, k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1, o = side * (w / 2 + 0.25); const [la, lo] = ll(p[0] + (vy / L) * o, p[1] - (vx / L) * o); return [lo, la, p[2] + (state.paintOn ? 0.03 : lift)]; });
      pw.push(new C.GeometryInstance({ geometry: new C.WallGeometry({ positions: C.Cartesian3.fromDegreesArrayHeights(P.flatMap(([lo, la, h]) => [lo, la, h + 1.05])), minimumHeights: P.map((q) => q[2] - 0.15), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(pc[0], pc[1], pc[2], 1)) } }));
    }
    if (pw.length) prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: pw, appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false, faceForward: true }), asynchronous: false, allowPicking: false, shadows: shadowMode() })));
    roadPrims.push(dp, rp);
    // junction mouths (plain road, behind the roads) and give-way lines (in front of them)
    const flat = (polys, col, off, lift2) => {
      const pos = [], idx = [];
      const done = (pr) => { roadPrims.push(pr); return pr; };
      for (const poly of polys) {
        const base = pos.length / 3;
        for (const [x, y, h] of poly) { const [la, lo] = ll(x, y), c = C.Cartesian3.fromDegrees(lo, la, h + lift2); pos.push(c.x, c.y, c.z); }
        for (let k = 1; k + 1 < poly.length; k++) idx.push(base, base + k, base + k + 1);
      }
      if (!idx.length) return;
      prims.push(done(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }) }, indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(col) } }),
        appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false, renderState: { depthTest: { enabled: true }, polygonOffset: { enabled: true, factor: -3, units: off }, cull: { enabled: false } } }), asynchronous: false, allowPicking: false, compressVertices: false, shadows: shadowMode() }))));
    };
    flat(mouthI.map((poly) => poly.map(([x, y, i]) => [x, y, H(i)])).filter((poly) => poly.every((q) => q[2] != null)), ROAD_COLOUR, -40, lift - 0.01);
    flat(gwI.filter(([, i]) => H(i) != null).map(([q, i]) => q.map(([x, y]) => [x, y, H(i)])), MARK_COLOUR, -56, lift + 0.01);
    for (const q of roadP) parts.push({ ...q, prim: rp });
    for (const q of discP) parts.push({ ...q, prim: dp });
  }
  // labels for named places (the owner: "so people can better recognise locations"): small glass tags over pubs, shops,
  // churches..., seen within ~220 m; areas (suburbs, villages) larger and higher, seen from further off
  const ents = [];
  for (const [x, y, name, kind, i, up] of placeI) {
    const h = H(i); if (h == null) continue;
    const area = kind === 'area', [la, lo] = ll(x, y);
    ents.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(lo, la, h + (area ? 40 : up || 4)), label: {
      text: name, font: area ? '800 17px Inter, system-ui, sans-serif' : '700 13px Inter, system-ui, sans-serif', fillColor: C.Color.WHITE,
      showBackground: true, backgroundColor: area ? new C.Color(0.05, 0.07, 0.14, 0.55) : new C.Color(0.05, 0.07, 0.14, 0.72), backgroundPadding: new C.Cartesian2(8, 4),
      verticalOrigin: C.VerticalOrigin.BOTTOM, scaleByDistance: new C.NearFarScalar(40, 1, area ? 1500 : 250, area ? 0.7 : 0.65),
      distanceDisplayCondition: new C.DistanceDisplayCondition(area ? 150 : 0, area ? 2500 : 220) } }));
  }
  // shop, pub and café name boards (the owner 2026-11-16: "subcategories of shops, pubs, restaurants"): the real name on a
  // board along the shopfront's fascia, in a look for its kind (signScheme), all of a square's boards on one canvas
  if (signs.length) {
    const RW = 512, RH = 64, cv = document.createElement('canvas'); cv.width = RW; cv.height = RH * signs.length;
    const g = cv.getContext('2d'), pos = [], st = [], idx = [];
    signs.forEach((sg, n) => {
      const sc = signScheme(sg.cat, sg.name), y0 = n * RH, f = sg.f;
      g.fillStyle = sc.bg; g.fillRect(0, y0, RW, RH);
      g.strokeStyle = sc.edge; g.lineWidth = 4; g.strokeRect(3, y0 + 3, RW - 6, RH - 6);
      const text = sc.upper ? sg.name.toUpperCase() : sg.name;
      let fs = 40; g.font = `${sc.weight} ${fs}px ${sc.font}`; const room = RW - 36 - (sc.icon ? 56 : 0);
      while (g.measureText(text).width > room && fs > 14) { fs -= 2; g.font = `${sc.weight} ${fs}px ${sc.font}`; }
      g.fillStyle = sc.fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, RW / 2 + (sc.icon ? 24 : 0), y0 + RH / 2 + 2);
      if (sc.icon === 'cross') { g.fillStyle = '#19a55a'; g.fillRect(22, y0 + 26, 36, 12); g.fillRect(34, y0 + 14, 12, 36); }
      else if (sc.icon) { g.font = '34px sans-serif'; g.textAlign = 'center'; g.fillText(sc.icon, 40, y0 + RH / 2 + 2); }
      // the board: along the front wall's middle, proud of it, over the shopfront (as long as the frontage allows)
      const L = Math.min(f.L * 0.86, Math.max(3, Math.min(11, text.length * 0.42 + 1.5))), ux = (f.b[0] - f.a[0]) / f.L, uy = (f.b[1] - f.a[1]) / f.L;
      const mx = (f.a[0] + f.b[0]) / 2 + f.nx * 0.14, my = (f.a[1] + f.b[1]) / 2 + f.ny * 0.14, z1 = Math.min(sg.base + 0.3 + 4.02, sg.top - 0.15), z0 = z1 - 0.72; // (single-storey shops: just under the roofline)
      if (sg.top - sg.base < 3.2) return;
      const b0 = pos.length / 3;
      for (const [s1, z] of [[-1, z0], [1, z0], [1, z1], [-1, z1]]) { const [la, lo] = ll(mx + ux * s1 * L / 2, my + uy * s1 * L / 2), c3 = C.Cartesian3.fromDegrees(lo, la, z); pos.push(c3.x, c3.y, c3.z); }
      // (the texture reads left to right as seen from the street: outward normal (nx, ny), so the left end is -u if u x n points up)
      const flip = ux * f.ny - uy * f.nx < 0;
      const v0 = 1 - (y0 + RH) / cv.height, v1 = 1 - y0 / cv.height; // (v runs up the canvas)
      if (flip) st.push(0, v0, 1, v0, 1, v1, 0, v1); else st.push(1, v0, 0, v0, 0, v1, 1, v1);
      idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    });
    if (idx.length) {
      const gm = new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }), st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }) }, indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
      C.GeometryPipeline.computeNormal(gm);
      prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: gm }), appearance: new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: cv }), flat: true, faceForward: true, closed: false, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED, renderState: { cull: { enabled: false } } }), asynchronous: false, allowPicking: false, compressVertices: false, shadows: C.ShadowMode.DISABLED })));
    }
  }
  // street lamps: a dark green post 7 m tall, an arm out over the road and a lamp head
  const lampInst = [];
  for (const [x, y, nx, ny, i] of lampI) {
    const h = H(i); if (h == null) continue;
    const [la, lo] = ll(x, y), base0 = C.Cartesian3.fromDegrees(lo, la, h + 0.13), hpr = new C.HeadingPitchRoll(-Math.atan2(ny, nx), 0, 0);
    const frame = C.Transforms.headingPitchRollToFixedFrame(base0, hpr), col = colour([0.16, 0.2, 0.18]);
    const at3 = (dx, dz) => C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(dx, 0, dz), new C.Matrix4());
    lampInst.push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: 7, topRadius: 0.06, bottomRadius: 0.09, slices: 6, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(0, 3.5), attributes: { color: col } }));
    lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(1.3, 0.08, 0.08), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(0.62, 6.95), attributes: { color: col } }));
    lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(0.55, 0.24, 0.12), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(1.3, 6.9), attributes: { color: colour([0.22, 0.24, 0.24]) } }));
    lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(0.42, 0.18, 0.03), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(1.3, 6.83), attributes: { color: colour([0.98, 0.93, 0.78]) } }));
  }
  // traffic signals: a grey pole 3.4 m, the black head (white-edged backboard) facing the oncoming traffic, and three
  // lamps in their own primitive whose colours cycle (animateLights)
  const lights = [], lampGeo = [];
  lightI.forEach(([x, y, fx, fy, ph, i], n) => {
    const h = H(i); if (h == null) return;
    const [la, lo] = ll(x, y), frame = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lo, la, h + 0.13), new C.HeadingPitchRoll(-Math.atan2(fy, fx), 0, 0));
    const at3 = (dx, dz) => C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(dx, 0, dz), new C.Matrix4());
    const box3 = (w, d, ht, dx, dz, col) => lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(d, w, ht), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(dx, dz), attributes: { color: colour(col) } }));
    lampInst.push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: 3.4, topRadius: 0.055, bottomRadius: 0.065, slices: 8, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: at3(0, 1.7), attributes: { color: colour([0.3, 0.31, 0.32]) } }));
    box3(0.62, 0.03, 1.22, -0.05, 2.75, [0.92, 0.92, 0.9]); // (the backboard's white edge)
    box3(0.54, 0.035, 1.14, -0.04, 2.75, [0.04, 0.04, 0.05]); // (the backboard)
    box3(0.3, 0.26, 0.92, 0.1, 2.75, [0.06, 0.06, 0.07]); // (the head)
    for (const [k, dz] of [[0, 3.04], [1, 2.75], [2, 2.46]]) {
      box3(0.26, 0.06, 0.06, 0.24, dz + 0.12, [0.05, 0.05, 0.06]); // (a hood over each lamp)
      lampGeo.push(new C.GeometryInstance({ id: `sig:${n}:${k}`, geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(0.02, 0.2, 0.2), vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }), modelMatrix: at3(0.235, dz), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(LIGHT_OFF[k]) } }));
    }
    lights.push({ n, ph, st: -1 });
  });
  // Belisha beacons: a black and white banded pole and a flashing amber globe (in the lamps' primitive: ids bea:n)
  const beacons = [];
  beaconI.forEach(([x, y, i], n) => {
    const h = H(i); if (h == null) return;
    const [la, lo] = ll(x, y), frame = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lo, la, h + 0.13));
    for (let k = 0; k < 8; k++) lampInst.push(new C.GeometryInstance({ geometry: new C.CylinderGeometry({ length: 0.3, topRadius: 0.05, bottomRadius: 0.05, slices: 8, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(0, 0, 0.15 + k * 0.3), new C.Matrix4()), attributes: { color: colour(k % 2 ? [0.92, 0.92, 0.9] : [0.05, 0.05, 0.05]) } }));
    lampGeo.push(new C.GeometryInstance({ id: `bea:${n}`, geometry: new C.EllipsoidGeometry({ radii: new C.Cartesian3(0.17, 0.17, 0.17), vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }), modelMatrix: C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(0, 0, 2.6), new C.Matrix4()), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(LIGHT_OFF[1]) } }));
    beacons.push({ n, ph: (x * 0.37 + y * 0.11) % 1, st: -1 });
  });
  // the water: a strip 85% of the mapped width at its level (+ the terrain offset, a few cm under the banks' top), with
  // Cesium's animated water (ripples, the sky's reflection); flatterrain.js lowers the ground under it to a bed
  if (waterI.length && Number.isFinite(world.terrainOff)) {
    const pos = [], st = [], idx = [], off = world.terrainOff - 0.12;
    for (const wp of waterI) {
      const P = wp.P, hw = (wp.w * 0.85) / 2; let along = 0;
      for (let k = 0; k < P.length; k++) {
        const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy) || 1, nx = -vy / L, ny = vx / L;
        if (k) along += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
        for (const sd of [-1, 1]) { const [la, lo] = ll(P[k][0] + nx * hw * sd, P[k][1] + ny * hw * sd), c3 = C.Cartesian3.fromDegrees(lo, la, P[k][2] + off); pos.push(c3.x, c3.y, c3.z); st.push(sd < 0 ? 0 : 1, along / 6); }
        if (k) { const b0 = pos.length / 3 - 4; idx.push(b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2); }
      }
    }
    if (idx.length) {
      const gm = new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }), st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }) }, indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
      C.GeometryPipeline.computeNormal(gm);
      prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: gm }), appearance: waterLook(), asynchronous: false, allowPicking: false, compressVertices: false, shadows: C.ShadowMode.RECEIVE_ONLY })));
    }
  }
  // a lock flight's pounds (canal.mjs `flight`, Tardebigge 2026-11-21): a stone edge along the towpath bank (left of the
  // line, which runs downhill) and reeds in clumps along the offside, at the water's edge
  if (Number.isFinite(world.terrainOff)) for (const wp of waterI) {
    if (!wp.flight || wp.w < 7) continue;
    const P = wp.P, hw = (wp.w * 0.85) / 2, off = world.terrainOff - 0.12;
    for (let k = 1; k < P.length; k++) {
      const a = P[k - 1], b = P[k], vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy); if (L < 0.5) continue;
      const nx = -vy / L, ny = vx / L, hdg = new C.HeadingPitchRoll(-Math.atan2(vy, vx), 0, 0), z = a[2] + off;
      // the towpath edge: dressed stone blocks 35 cm wide, their top 30 cm over the water
      const ex = (a[0] + b[0]) / 2 + nx * (hw + 0.12), ey = (a[1] + b[1]) / 2 + ny * (hw + 0.12), [ela, elo] = ll(ex, ey);
      lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L + 0.05, 0.36, 0.75), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(elo, ela, z - 0.07), hdg), attributes: { color: colour([0.6, 0.58, 0.53], (rnd(ex, ey) - 0.5) * 0.12) } }));
      // reeds on the offside: a clump every 2-5 m (some gaps), three or four blades each, green going to straw at the tips
      // (beds of reeds: runs of 3-9 m with gaps between, a clump every 0.7 m along a run, each clump a dark base and four
      // thin blades leaning out a little, most green, some going to straw)
      for (let s0 = rnd(a[0], b[1]) * 4; s0 < L;) {
        const run = 3 + rnd(s0, a[1]) * 6, gap = 2 + rnd(a[1], s0) * 7;
        for (let s1 = s0; s1 < Math.min(L, s0 + run); s1 += 0.55 + rnd(s1, a[0]) * 0.35) {
          const t = s1 / L, out = hw - 0.1 - rnd(s1, b[0]) * 0.5, cx = a[0] + vx * t - nx * out, cy = a[1] + vy * t - ny * out, [bla, blo] = ll(cx, cy);
          lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(0.45, 0.45, 0.35), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(blo, bla, z + 0.1), new C.HeadingPitchRoll(rnd(cx, 9) * 6, 0, 0)), attributes: { color: colour([0.2, 0.3, 0.12], (rnd(cx, cy, 4) - 0.5) * 0.2) } }));
          for (let r = 0; r < 4; r++) {
            const rx = cx + (rnd(cx, r) - 0.5) * 0.4, ry = cy + (rnd(r, cy) - 0.5) * 0.4, h = 0.9 + rnd(rx, ry) * 1.0, [rla, rlo] = ll(rx, ry);
            const g = rnd(ry, rx); const col = g < 0.55 ? [0.3, 0.44, 0.16] : g < 0.85 ? [0.44, 0.52, 0.22] : [0.68, 0.6, 0.34];
            lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(0.035, 0.05, h), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(rlo, rla, z + h / 2), new C.HeadingPitchRoll(rnd(rx, 3) * 6, (rnd(ry, 5) - 0.5) * 0.35, (rnd(rx, 7) - 0.5) * 0.35)), attributes: { color: colour(col, (rnd(rx, ry, 2) - 0.5) * 0.2) } }));
          }
        }
        s0 += run + gap;
      }
    }
  }
  // lock gates: a pair of timber gates across the chamber (meeting in a shallow V) and a black balance beam with a white
  // end swinging out over each bank
  // lock gates, as the owner's photos (2026-11-17): closed, the two leaves meeting in a shallow V across the chamber, their
  // tops a little over the coping; each leaf's black balance beam reaching out across the bank (at right angles to the
  // canal) at waist height with a white-painted end; black paddle gear on top; grey paving round them. Local x runs
  // along the canal, y across; z = 0 at the water level
  for (const [x, y, ux, uy, w, i, lv] of gateI) {
    const h = Number.isFinite(lv) && Number.isFinite(world.terrainOff) ? lv + world.terrainOff - 0.12 : H(i) == null ? null : H(i) + 0.3; if (h == null) continue;
    const [la, lo] = ll(x, y), frame = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lo, la, h), new C.HeadingPitchRoll(-Math.atan2(uy, ux), 0, 0));
    const box = (dx, dy, dz, sx, sy, sz, yaw, col) => lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(sx, sy, sz), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Matrix4.multiply(C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(dx, dy, dz), new C.Matrix4()), C.Matrix4.fromRotationTranslation(C.Matrix3.fromRotationZ(yaw)), new C.Matrix4()), attributes: { color: colour(col) } }));
    const top = 0.47; // (the coping: 0.35 over the water + the 12 cm the water sits under the banks)
    // each side's balance beam stops 1.2 m short of the nearest road or path crossing the beam's line (the owner 2026-11-17:
    // the towpath-side beam reached across the towpath, "apparently in my way"); local +y (sd = 1) is left of the canal's
    // direction (ux, uy)
    const reach = { '-1': Infinity, 1: Infinity };
    for (const r of roadI) for (let k = 1; k < r.Q.length; k++) {
      const a = r.Q[k - 1], b = r.Q[k], al = (q) => (q[0] - x) * ux + (q[1] - y) * uy, ac = (q) => -(q[0] - x) * uy + (q[1] - y) * ux;
      const a0 = al(a), a1 = al(b); if ((a0 - 0.3) * (a1 - 0.3) > 0) continue;
      const t = a1 === a0 ? 0 : (0.3 - a0) / (a1 - a0), across = ac(a) + (ac(b) - ac(a)) * t, s = across >= 0 ? 1 : -1;
      reach[s] = Math.min(reach[s], Math.abs(across) - (r.w || 2) / 2);
    }
    for (const sd of [-1, 1]) {
      const BL = Math.max(1.2, Math.min(4.6, reach[sd] - w / 2 - 1.2)); // (the beam's length on this side)
      box(0.12 * sd * 0 + 0.15, sd * (w / 4 + 0.02), top - 1.1, 0.28, w / 2 + 0.06, 2.4, -sd * 0.14, [0.2, 0.15, 0.1]); // (a gate leaf, angled into the V)
      box(0.15, sd * (w / 4 + 0.02), top + 0.13, 0.32, w / 2 + 0.06, 0.12, -sd * 0.14, [0.3, 0.23, 0.16]); // (its top rail)
      box(0.3, sd * (w / 2 + BL / 2), top + 0.85, 0.3, BL, 0.3, 0, [0.06, 0.06, 0.06]); // (the balance beam out across the bank)
      box(0.3, sd * (w / 2 + BL - 0.45), top + 0.85, 0.32, 0.9, 0.32, 0, [0.93, 0.93, 0.9]); // (its white end)
      box(0.3, sd * (w / 2 + 0.9), top + 0.42, 0.25, 0.25, 0.6, 0, [0.09, 0.09, 0.09]); // (the post under it)
      box(-0.8, sd * (w / 2 + 0.35), top + 0.45, 0.25, 0.3, 0.7, 0, [0.08, 0.08, 0.08]); // (the paddle gear)
      box(0.2, sd * (w / 2 + BL / 2), top - 0.02, 3.2, BL - 0.2, 0.06, 0, [0.48, 0.47, 0.45]); // (the paving where the beam swings)
      box(0.2, sd * (w / 2 + BL - 0.2), top + 0.0, 3.2, 0.25, 0.08, 0, [0.42, 0.24, 0.2]); // (its brick edge)
    }
  }
  // lock chambers: brick walls from the chamber's edge (1.3 m out: narrow-boat locks) to past the water's edge on both
  // sides, from below the lower pound to a little over the upper one, with pale coping along the inner edge
  if (Number.isFinite(world.terrainOff)) for (const [x1, y1, x2, y2, hi, lo, ww] of lockI) {
    if (hi == null || lo == null) continue;
    const off = world.terrainOff, L = Math.hypot(x2 - x1, y2 - y1) + 1.5, ux = (x2 - x1) / (L - 1.5), uy = (y2 - y1) / (L - 1.5), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const top = hi + off + 0.35, bot = lo + off - 1.6, outer = ww * 0.85 / 2 + 0.6, wid = outer - 1.3;
    for (const sd of [-1, 1]) {
      const cx = mx - uy * sd * (1.3 + wid / 2), cy = my + ux * sd * (1.3 + wid / 2), [la, lo2] = ll(cx, cy);
      const fr = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lo2, la, (top + bot) / 2), new C.HeadingPitchRoll(-Math.atan2(uy, ux), 0, 0));
      // (the owner's photos: a brick wall with stone coping, grass right up to it, not a slab of brick: the bank beyond the
      // wall is a grass-topped block a few cm lower)
      const bx = mx - uy * sd * 1.6, by = my + ux * sd * 1.6, [ba, bo] = ll(bx, by), hdg = new C.HeadingPitchRoll(-Math.atan2(uy, ux), 0, 0);
      lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L, 0.6, top - bot), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(bo, ba, (top + bot) / 2), hdg), attributes: { color: colour([0.56, 0.36, 0.28], (rnd(cx, cy) - 0.5) * 0.1) } }));
      lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L, Math.max(0.3, wid - 0.6), top - 0.06 - bot), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lo2, la, (top - 0.06 + bot) / 2), hdg), attributes: { color: colour([0.42, 0.56, 0.28]) } }));
      void fr;
      const qx = mx - uy * sd * 1.5, qy = my + ux * sd * 1.5, [qa, qo] = ll(qx, qy);
      lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L, 0.45, 0.14), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(qo, qa, top + 0.07), new C.HeadingPitchRoll(-Math.atan2(uy, ux), 0, 0)), attributes: { color: colour([0.82, 0.8, 0.74]) } }));
    }
  }
  // stop lines and crossing markings: white on the ground, with the painted ground too
  { const pos = [], idx = [], lift2 = state.paintOn ? 0.03 : OPEN_LIFT + 0.02;
    for (const [q, i] of zebI) { const h = H(i); if (h == null) continue; const b0 = pos.length / 3; for (const [x, y] of q) { const [la, lo] = ll(x, y), c3 = C.Cartesian3.fromDegrees(lo, la, h + lift2); pos.push(c3.x, c3.y, c3.z); } idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); }
    if (idx.length) prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }) }, indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.93, 0.93, 0.9, 1)) } }),
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false, renderState: { depthTest: { enabled: true }, polygonOffset: { enabled: true, factor: -3, units: -60 }, cull: { enabled: false } } }), asynchronous: false, allowPicking: false, compressVertices: false, shadows: C.ShadowMode.DISABLED }))); }
  let lightPrim = null;
  if (lampGeo.length) { lightPrim = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: lampGeo, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false }), asynchronous: true, allowPicking: false, releaseGeometryInstances: false, shadows: C.ShadowMode.DISABLED })); prims.push(lightPrim); }
  // front garden walls and hedges
  const FRONT = { brick: [0.55, 0.3, 0.24, 0.75, 0.3], hedge: [0.2, 0.36, 0.16, 1.05, 0.65], stone: [0.7, 0.66, 0.58, 0.7, 0.32] };
  for (const [x1, y1, x2, y2, t, i1, i2] of frontI) {
    const h1 = H(i1), h2 = H(i2); if (h1 == null || h2 == null) continue;
    const [r, g, b, ht, th] = FRONT[t], L = Math.hypot(x2 - x1, y2 - y1); if (L < 1) continue;
    const [la, lo] = ll((x1 + x2) / 2, (y1 + y2) / 2), frame = C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(lo, la, Math.min(h1, h2) + 0.13 + ht / 2 - 0.15), new C.HeadingPitchRoll(-Math.atan2(y2 - y1, x2 - x1), 0, 0));
    lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L, th, ht + 0.3 + Math.abs(h1 - h2)), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: frame, attributes: { color: colour([r, g, b], (rnd(x1, y1) - 0.5) * 0.15) } }));
    if (t !== 'hedge') lampInst.push(new C.GeometryInstance({ geometry: C.BoxGeometry.fromDimensions({ dimensions: new C.Cartesian3(L, th + 0.08, 0.07), vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }), modelMatrix: C.Matrix4.multiplyByTranslation(frame, new C.Cartesian3(0, 0, (ht + 0.3 + Math.abs(h1 - h2)) / 2), new C.Matrix4()), attributes: { color: colour([0.82, 0.8, 0.76]) } })); // coping
  }
  if (lampInst.length) prims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: lampInst, appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false }), asynchronous: true, allowPicking: false, releaseGeometryInstances: true, shadows: shadowMode() })));
  // raised pavements: kerb face and top (light concrete), the pavement's paving at +13 cm, its back edge down to the ground
  const kerbPrims = [];
  if (kerbI.length) {
    const UP = 0.13, KW = 0.15, PW = 1.75, lift3 = 0.02;
    const kp = [], kidx = [], pp = [], pst = [], pidx = [];
    const put = (arr, x, y, h) => { const [la, lo] = ll(x, y), c = C.Cartesian3.fromDegrees(lo, la, h); arr.push(c.x, c.y, c.z); return arr.length / 3 - 1; };
    for (const K of kerbI) {
      const pts = K.map(([x, y, nx, ny, i]) => [x, y, nx, ny, H(i)]).filter((q) => q[4] != null);
      if (pts.length < 2) continue;
      let along = 0, prevK = null, prevP = null;
      pts.forEach(([x, y, nx, ny, h], k) => {
        if (k) along += Math.hypot(x - pts[k - 1][0], y - pts[k - 1][1]);
        const t = h + UP + lift3;
        const k0 = put(kp, x, y, h - 0.25), k1 = put(kp, x, y, t), k2 = put(kp, x + nx * KW, y + ny * KW, t); // face bottom, face top, kerb top's back
        const b0 = pp.length / 3; put(pp, x + nx * KW, y + ny * KW, t); put(pp, x + nx * PW, y + ny * PW, t); put(pp, x + nx * PW, y + ny * PW, h - 0.25);
        pst.push(along / 2.4, 0, along / 2.4, (PW - KW) / 2.4, along / 2.4, (PW - KW + 0.38) / 2.4);
        if (prevK) { kidx.push(prevK[0], k0, prevK[1], prevK[1], k0, k1, prevK[1], k1, prevK[2], prevK[2], k1, k2); pidx.push(prevP, b0, prevP + 1, prevP + 1, b0, b0 + 1, prevP + 1, b0 + 1, prevP + 2, prevP + 2, b0 + 1, b0 + 2); }
        prevK = [k0, k1, k2]; prevP = b0;
      });
    }
    const geo = (pos, idx, st) => { const at2 = { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }) }; if (st) at2.st = new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }); const g = new C.Geometry({ attributes: at2, indices: new Uint32Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) }); C.GeometryPipeline.computeNormal(g); return g; };
    const rs = { depthTest: { enabled: true }, cull: { enabled: false }, polygonOffset: { enabled: true, factor: -2, units: -30 } };
    if (kidx.length) kerbPrims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: geo(kp, kidx), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(0.78, 0.77, 0.74, 1)) } }), appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false, faceForward: true, renderState: rs }), asynchronous: false, allowPicking: false, compressVertices: false, shadows: C.ShadowMode.DISABLED })));
    if (pidx.length) kerbPrims.push(viewer.scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: geo(pp, pidx, pst) }), appearance: pavingLook(rs), asynchronous: false, allowPicking: false, compressVertices: false, shadows: C.ShadowMode.DISABLED })));
    prims.push(...kerbPrims);
  }
  for (const pr of kerbPrims) pr.show = !!paint.layer && paint.on; // (with the photo the 3D road layer is 25 cm up: no kerbs)
  for (const pr of roadPrims) if (pr) pr.show = !paint.layer || !paint.on;
  return { prims, blds, parts, ridVer: -1, ents, roadPrims, kerbPrims, lights, beacons, lightPrim };
}

// gable roofs for four-cornered houses: the ridge along the long side, 0.32 x the short side up; flat-shaded faces
function gableRoofs(roofs, ll) {
  const geoms = [];
  for (const { id, P, top, col } of roofs) {
    let [A, B, Cc, D] = P;
    const e = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (e(A, B) < e(B, Cc)) [A, B, Cc, D] = [B, Cc, D, A]; // A-B a long side
    const short = e(B, Cc), rise = Math.min(4, 0.32 * short + 0.3);
    const m1 = [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2], m2 = [(B[0] + Cc[0]) / 2, (B[1] + Cc[1]) / 2];
    const p = (q, h) => { const [la, lo] = ll(q[0], q[1]); return C.Cartesian3.fromDegrees(lo, la, h); };
    const a = p(A, top), b = p(B, top), c = p(Cc, top), d = p(D, top), r1 = p(m1, top + rise), r2 = p(m2, top + rise);
    const tris = [[a, b, r2], [a, r2, r1], [c, d, r1], [c, r1, r2], [d, a, r1], [b, c, r2]];
    const vals = [];
    for (const t of tris) for (const v of t) vals.push(v.x, v.y, v.z);
    const geom = new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(vals) }) },
      indices: new Uint16Array(vals.length / 3).map((_, i) => i), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromPoints([a, b, c, d, r1, r2]) });
    C.GeometryPipeline.computeNormal(geom);
    geoms.push(new C.GeometryInstance({ id, geometry: geom, attributes: { color: colour(col), show: new C.ShowGeometryInstanceAttribute(true) } }));
  }
  return new C.Primitive({ geometryInstances: geoms, appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false, faceForward: true }), asynchronous: false, allowPicking: false, shadows: shadowMode() });
}

// The camera's cut-away (as games do): a building between the camera and the rider, or with the camera inside it or
// within 3 m, is hidden until the view is clear (Bristol's Railway Path runs in a cutting between back gardens; Lite's
// terrain has no cutting, so the camera sat behind a house wall). Per-instance show flags, 5 times a second.
function cutAway() {
  const cam = C.Cartographic.fromCartesian(viewer.camera.positionWC), q = route.at(state.dist);
  const [cx, cy] = world.idx.xy(C.Math.toDegrees(cam.latitude), C.Math.toDegrees(cam.longitude)), [rx, ry] = world.idx.xy(q.lat, q.lon);
  const camH = cam.height, rideH = groundHeight(state.dist);
  const segHit = (P) => { // the camera->rider segment crosses an edge, or the camera is inside / within 3 m
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i], b = P[j];
      if ((a[1] > cy) !== (b[1] > cy) && cx < ((b[0] - a[0]) * (cy - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      const d1 = (bx, by) => (b[0] - a[0]) * (by - a[1]) - (b[1] - a[1]) * (bx - a[0]);
      const d2 = (px, py) => (rx - cx) * (py - cy) - (ry - cy) * (px - cx);
      if ((d1(cx, cy) > 0) !== (d1(rx, ry) > 0) && (d2(a[0], a[1]) > 0) !== (d2(b[0], b[1]) > 0)) return true;
      const vx = b[0] - a[0], vy = b[1] - a[1], t = Math.max(0, Math.min(1, ((cx - a[0]) * vx + (cy - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      if (Math.hypot(a[0] + vx * t - cx, a[1] + vy * t - cy) < 3) return true;
    }
    return inside;
  };
  const x0 = Math.min(cx, rx) - 4, x1 = Math.max(cx, rx) + 4, y0 = Math.min(cy, ry) - 4, y1 = Math.max(cy, ry) + 4;
  for (const ch of world.chunks.values()) {
    for (const b of ch.blds || []) {
      const hit = b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && b.top > Math.min(camH, rideH) - 2 && segHit(b.P);
      if (hit === b.hidden) continue;
      for (const id of b.ids) for (const p of ch.prims) {
        try { const at = p.ready && p.getGeometryInstanceAttributes(id); if (at) at.show = C.ShowGeometryInstanceAttribute.toValue(!hit); } catch { /* not this primitive's */ }
      }
      b.hidden = hit;
    }
    // (trees are never hidden: a cut-away for them made trees pop in and out as they were passed, which looked crazy,
    // the owner 2026-11-15; buildings only)
  }
}

// the open world swapped the route for one that differs only beyond ride metre m (see updateWorld)
export function reindexWorld(m) { world.keepBefore = Math.max(0, m); }

// every frame from main.js: keep the chunks around the rider built (one at a time), drop the ones passed
export function updateWorld() {
  updateWorldLandmarks();
  if (!state.lite || !viewer || !route) return;
  if (world.idx && world.chunks.size && performance.now() - (world.cutAt || 0) > 200) { world.cutAt = performance.now(); cutAway(); }
  if (world.idx?.area) { world.forRoute = route; world.keepBefore = null; updateArea(); return; } // open world: by map square
  if (world.forRoute !== route) { // a turn round or an editor change gave a new route object: the old positions no longer hold
    if (world.data && world.keepBefore != null) {
      // open world (openworld.js): the route only changed beyond keepBefore, so chunks wholly before it stay
      for (const [c, v] of world.chunks) if ((c + 1) * CHUNK > world.keepBefore) { for (const p of v.prims) viewer.scene.primitives.remove(p); world.chunks.delete(c); }
      world.gen++; world.forRoute = route; index();
    } else if (world.data) { clearWorld(); world.forRoute = route; index(); } else world.forRoute = route;
    world.keepBefore = null;
  }
  if (!world.idx || world.building) return;
  const now = performance.now();
  if (now - world.at < 500) return;
  world.at = now;
  const lo = Math.floor(Math.max(0, state.dist - BEHIND) / CHUNK), hi = Math.floor(Math.min(route.length, state.dist + AHEAD) / CHUNK);
  for (const [c, v] of world.chunks) if (c < lo - 1 || c > hi + 1) { for (const p of v.prims) viewer.scene.primitives.remove(p); world.chunks.delete(c); }
  // nearest missing chunk first (ahead before behind)
  const want = [];
  for (let c = Math.floor(state.dist / CHUNK); c <= hi; c++) want.push(c);
  for (let c = Math.floor(state.dist / CHUNK) - 1; c >= lo; c--) want.push(c);
  const next = want.find((c) => !world.chunks.has(c));
  if (next === undefined) return;
  world.building = true;
  buildChunk(next).then((v) => { if (v) world.chunks.set(next, v); }).catch((e) => { console.warn('world chunk', next, e); world.chunks.set(next, { prims: [] }); })
    .finally(() => { world.building = false; });
}
