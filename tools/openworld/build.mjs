// Open world areas (2026-11-15, the owner: "make them a quadrant ... Bromsgrove ... the rider can decide where to go, like
// zwift"). Builds one area's data: the road network from OpenStreetMap (roads a bike may ride, split at junctions,
// dead ends pruned so there's always a way on, one-way streets kept one-way), heights every ~10 m along every road from
// the Environment Agency's 1 m LIDAR ground model (bridges straight between their ends), and the generated world for
// the whole square (buildings, woods, hedges/walls, LIDAR trees within 100 m of a road).
// Writes data/world/<id>.json (the usual world file + `roads`) and data/routes/<id>.gpx (a first loop, for the card),
// and adds / updates the routes.json entry (open: true). The browser does the rest (public/js/app/openworld.js).
//   node tools/openworld/build.mjs <id> "<name>" <south> <west> <north> <east> [--start lat,lon] [--no-trees]
//     [--edits <id>] [--keep-trees <id>] [--cached]   (map editor rebuilds: another world's corrections, its LIDAR
//     trees kept instead of measured again, map answers from the cache however old)
//     [--mask "s,w,n,e;s,w,n,e"]   (2026-11-16: only these rectangles inside the box, e.g. where there's LIDAR: roads,
//     buildings, land and trees outside them are left out; the map queries go in ~4 km tiles of the mask)
// Overpass gets a generic client name; LIDAR tiles are cached in data/cache/lidar.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { heightAt, toBNG } = await import('../routes/bristol/lidar.mjs');
const { canopyTrees } = await import('../routes/canopy.mjs');

const args = process.argv.slice(2);
const [id, name, S, W, N, E] = args;
const box = { s: +S, w: +W, n: +N, e: +E };
if (!id || !Number.isFinite(box.s + box.w + box.n + box.e)) { console.error('usage: build.mjs <id> "<name>" <south> <west> <north> <east> [--start lat,lon] [--no-trees]'); process.exit(1); }
const flag = (f) => args.includes(f);
const startArg = args[args.indexOf('--start') + 1];
// local corrections to OSM (tools/openworld/fixes.json)
const FIXES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'openworld', 'fixes.json'), 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// per-world build options (tools/openworld/options/<id>.json; a rebuild's <id>-next reads <id>'s): London's additions are
// switched on there only, so other worlds build exactly as before (the owner's rule, 2026-11-17)
const OPT = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'openworld', 'options', String(process.argv[2] || '').replace(/-next$/, '') + '.json'), 'utf8')); } catch { return {}; } })();
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// answers are kept in data/cache/overpass (by the query's hash, for a day), so a restarted build doesn't fetch again
const OCACHE = path.join(ROOT, 'data', 'cache', 'overpass');
async function overpass(q, { rounds = 8 } = {}) {
  if (process.env.OW_OSM) return (await import('./localosm.mjs')).query(q, process.env.OW_OSM); // (a local extract instead of the API)
  const key = (await import('crypto')).createHash('sha1').update(q).digest('hex'), cf = path.join(OCACHE, key + '.json');
  try { if (flag('--cached') || Date.now() - fs.statSync(cf).mtimeMs < 86400000) return JSON.parse(fs.readFileSync(cf, 'utf8')); } catch {}
  const j = await overpassFetch(q, rounds);
  try { fs.mkdirSync(OCACHE, { recursive: true, mode: 0o700 }); fs.writeFileSync(cf, JSON.stringify(j), { mode: 0o600 }); } catch {}
  return j;
}
async function overpassFetch(q, rounds) {
  let last;
  for (let round = 0; round < rounds; round++) {
    for (const s of SERVERS) {
      try {
        const r = await fetch(s, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RideWorld/1.0 (personal indoor cycling app; world builder)' }, signal: AbortSignal.timeout(200000) });
        if (!r.ok) throw new Error(`${s} ${r.status}`);
        const j = await r.json();
        if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 100));
        if ((j.elements || []).length) return j;
        last = new Error('empty');
      } catch (e) { last = e; log('overpass', e.message); }
    }
    await new Promise((ok) => setTimeout(ok, 30000));
  }
  throw last;
}
const maskArg = args.includes('--mask') ? args[args.indexOf('--mask') + 1] : null;
const MASK = maskArg ? maskArg.split(';').map((r) => { const [s, w, n, e] = r.split(',').map(Number); return { s, w, n, e }; }) : [box];
const inBox = (lat, lon) => lat >= box.s && lat <= box.n && lon >= box.w && lon <= box.e && MASK.some((m) => lat >= m.s && lat <= m.n && lon >= m.w && lon <= m.e);
// the query tiles: each mask rectangle cut into pieces of at most ~4 km (OW_TILE_KM: smaller for dense cities: central
// London's 4 km tiles timed out on every server, 2026-11-17)
const TILES = [], TK = (+process.env.OW_TILE_KM || 4) / 4;
for (const m of MASK) { const ni = Math.max(1, Math.ceil((m.n - m.s) / (0.036 * TK))), nj = Math.max(1, Math.ceil((m.e - m.w) / (0.06 * TK))); for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) TILES.push(`${(m.s + ((m.n - m.s) * i) / ni).toFixed(5)},${(m.w + ((m.e - m.w) * j) / nj).toFixed(5)},${(m.s + ((m.n - m.s) * (i + 1)) / ni).toFixed(5)},${(m.w + ((m.e - m.w) * (j + 1)) / nj).toFixed(5)}`); }
log('query tiles', TILES.length);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));

// ---------- roads ----------
const HW = 'trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|cycleway|track|bridleway|path|footway';
// off-road (2026-11-17, the owner's list item 3): cycle paths, tracks, bridleways, and paths / footways a bike may use (the
// canal towpath among them); `off` on their edges with the surface `surf` (paved / gravel / dirt / grass)
const OFF = /^(cycleway|track|bridleway|path|footway)$/;
const bikeOK = (t) => /^(yes|designated|permissive|gap)$/.test(t.bicycle || ''); // ('gap': a short footway between bikeable ones, below)
const rideable = (t) => !OFF.test(t.highway) || t.highway === 'cycleway' || t.highway === 'bridleway' || (t.highway === 'track' && !/^(no|private)$/.test(t.access || '')) || ((t.highway === 'path' || t.highway === 'footway') && bikeOK(t) && t.footway !== 'sidewalk');
const surfOf = (t) => { const s = t.surface || ''; if (/^(asphalt|paved|concrete|paving_stones|sett|chipseal|metal)/.test(s)) return 'paved'; if (/^(gravel|fine_gravel|compacted|pebblestone|unpaved)$/.test(s)) return 'gravel'; if (/^(grass|grass_paver)$/.test(s)) return 'grass'; if (/^(dirt|ground|earth|mud|sand|woodchips)$/.test(s)) return 'dirt'; if (t.highway === 'cycleway') return 'paved'; if (t.highway === 'track') return /^grade1$/.test(t.tracktype || '') ? 'paved' : /^grade[23]$/.test(t.tracktype || '') ? 'gravel' : 'dirt'; return t.highway === 'bridleway' || t.highway === 'path' ? 'dirt' : 'paved'; };
log('roads');
const rj = { elements: [] };
{ const seen = new Set();
  // (OPT.bikeAccess, 2026-11-18: also ways closed to traffic but open to bikes, access=no + bicycle=yes: Bidford's old
  // bridge in the Stratford world was missing. Per world, so other worlds build exactly as before)
  const bikeQ = (tb) => (OPT.bikeAccess ? `way["highway"~"^(${HW})$"]["area"!="yes"]["access"~"^(no|private)$"]["bicycle"~"^(yes|designated|permissive)$"](${tb});` : '');
  for (const tb of TILES) { const part = await overpass(`[out:json][timeout:180];(way["highway"~"^(${HW})$"]["area"!="yes"]["access"!~"^(no|private)$"]["bicycle"!="no"](${tb});${bikeQ(tb)});out body;>;out skel qt;`); for (const e of part.elements) { const k = e.type + e.id; if (!seen.has(k)) { seen.add(k); rj.elements.push(e); } } log('roads tile', tb, part.elements.length); }
  // (OPT.serviceIn, 2026-11-22, the owner: Bromsgrove station's "car park opened up"): service roads and car park aisles inside
  // the listed boxes [s, w, n, e] become roads (not driveways, nothing private; one-way aisles stay one-way)
  for (const b of OPT.serviceIn || []) { const part = await overpass(`[out:json][timeout:120];way["highway"="service"]["service"!="driveway"]["area"!="yes"]["access"!~"^(no|private)$"](${b.join(',')});out body;>;out skel qt;`); let n = 0; for (const e of part.elements) { const k = e.type + e.id; if (!seen.has(k)) { seen.add(k); rj.elements.push(e); if (e.type === 'way') n++; } } log('service roads in', b.join(','), n); } }
const nodeLL = new Map();
for (const e of rj.elements) if (e.type === 'node') nodeLL.set(e.id, [e.lat, e.lon]);
// cycle routes (2026-11-16): ways in OSM bicycle route relations (National / regional / local Cycle Network) get
// `cyc` on their edges; openworld.js prefers them a little when choosing the default way on
const cycWays = new Set();
try { const cj = await overpass(`[out:json][timeout:120];relation["route"="bicycle"](${box.s},${box.w},${box.n},${box.e});out body qt;`, { rounds: 1 }); for (const r of cj.elements) for (const m of r.members || []) if (m.type === 'way') cycWays.add(m.ref); } catch (e) { log('cycle routes: none (', e.message, ')'); }
log('cycle-route ways', cycWays.size);
const ways = rj.elements.filter((e) => e.type === 'way');
// gaps (2026-11-17, the owner: "what's stopping the towpath?"): short footways (<= 400 m) that link bikeable paths (or a
// bikeable path to a road) count as bikeable: the towpath was broken in nine places by a few metres of plain footway
// under bridges and round locks, and each break made the stretches either side dead ends, pruned away (0.8 of 8.3 km left)
{
  const okNodes = new Set(), roadNodes = new Set();
  for (const w of ways) { const t = w.tags || {}; if (!rideable(t)) continue; for (const n of w.nodes) (OFF.test(t.highway) ? okNodes : roadNodes).add(n); }
  let gaps = 0;
  for (const w of ways) {
    const t = w.tags || {};
    if (rideable(t) || !/^(footway|path)$/.test(t.highway) || /^(no|dismount)$/.test(t.bicycle || '') || t.footway === 'sidewalk') continue;
    const a = w.nodes[0], b = w.nodes.at(-1), ok = (n) => okNodes.has(n) || roadNodes.has(n);
    if (!ok(a) || !ok(b) || !(okNodes.has(a) || okNodes.has(b))) continue;
    let L = 0; for (let i = 1; i < w.nodes.length; i++) { const p0 = nodeLL.get(w.nodes[i - 1]), p1 = nodeLL.get(w.nodes[i]); if (p0 && p1) L += dist(p0, p1); }
    if (L > 400) continue;
    w.tags = { ...t, bicycle: 'gap' }; gaps++;
  }
  log('footway gaps bridged', gaps);
}
// split each way into the runs that lie inside the box
const runs = [];
for (const w of ways) {
  const t = w.tags || {};
  let cur = [];
  const flush = () => { if (cur.length >= 2) runs.push({ nodes: cur, t, id: w.id, cyc: cycWays.has(w.id) }); cur = []; };
  if (!rideable(t)) continue;
  for (const id of w.nodes) { const ll = nodeLL.get(id); if (ll && inBox(...ll)) cur.push(id); else flush(); }
  flush();
}
// paths that end near a road but don't meet it in OSM (a towpath reaches the road up steps or a footpath at a bridge):
// a short link (<= 30 m) from the path's loose end to the nearest road node, so it isn't pruned as a dead end
{
  const endsUse = new Map(); for (const r of runs) for (const id of [r.nodes[0], r.nodes.at(-1)]) endsUse.set(id, (endsUse.get(id) || 0) + 1);
  const shared = new Set(); { const seen = new Set(); for (const r of runs) for (const id of r.nodes) { if (seen.has(id)) shared.add(id); seen.add(id); } }
  const G = 0.0004, grid = new Map(); for (const r of runs) if (!OFF.test(r.t.highway)) for (const id of r.nodes) { const [la, lo] = nodeLL.get(id), k = Math.floor(la / G) + ',' + Math.floor(lo / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); }
  let links = 0;
  for (const r of [...runs]) {
    if (!OFF.test(r.t.highway)) continue;
    for (const id of [r.nodes[0], r.nodes.at(-1)]) {
      if (shared.has(id)) continue; // (already meets something)
      const [la, lo] = nodeLL.get(id); let best = null;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of grid.get((Math.floor(la / G) + a) + ',' + (Math.floor(lo / G) + b)) || []) { const d = dist([la, lo], nodeLL.get(q)); if (d < 30 && (!best || d < best.d)) best = { d, q }; }
      if (best) { runs.push({ nodes: [id, best.q], t: { ...r.t, name: r.t.name || '' }, id: r.id, cyc: r.cyc }); shared.add(id); links++; }
    }
  }
  log('path links to roads', links);
}
// OSM's pavement tags (2026-11-24, the owner: "a lot of pavements on country lanes that don't have them"): 'y' when the way
// has one (both / left / right / yes, or 'separate': mapped as its own footway, which isn't drawn, so the road still shows
// one), 'n' when it says none; undefined = not tagged (world.js / paintcore.js then guess from the buildings along it)
const sidewalkOf = (t) => {
  const v = t.sidewalk || t['sidewalk:both'] || null, l = t['sidewalk:left'], r = t['sidewalk:right'];
  if (/^(both|left|right|yes|separate)$/.test(v || '') || /^(yes|separate)$/.test(l || '') || /^(yes|separate)$/.test(r || '')) return 'y';
  if (/^(no|none)$/.test(v || '') || (/^no$/.test(l || '') && /^no$/.test(r || ''))) return 'n';
  return undefined;
};
let EDITS = null;
// the owner's corrections (tools/openworld/edits/<id>.json, 2026-11-17): paths he rides that OSM lacks (from his FIT files,
// later the map editor). Each is a run of new nodes (negative ids), its ends joined to the nearest road node within 40 m.
{
  const eid = args.includes('--edits') ? args[args.indexOf('--edits') + 1] : id; // (--edits <id>: another world's corrections, for a test build)
  // (the map editor's file in data/world wins; else the one kept in the repository)
  let E = null; for (const f of [path.join(ROOT, 'data', 'world', eid + '.edits.json'), path.join(ROOT, 'tools', 'openworld', 'edits', eid + '.json')]) { try { E = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch {} }
  EDITS = E;
  if (E?.paths?.length) {
    const G = 0.0005, grid = new Map(); for (const r of runs) for (const nid of r.nodes) { const [la, lo] = nodeLL.get(nid), k = Math.floor(la / G) + ',' + Math.floor(lo / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(nid); }
    const nearest = (ll) => { let best = null; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of grid.get((Math.floor(ll[0] / G) + a) + ',' + (Math.floor(ll[1] / G) + b)) || []) { const d = dist(ll, nodeLL.get(q)); if (d < 40 && (!best || d < best.d)) best = { d, q }; } return best?.q; };
    let nid = -1, added = 0;
    for (const pth of E.paths) {
      const ids = pth.pts.filter(([la, lo]) => inBox(la, lo)).map(([la, lo]) => { const k = nid--; nodeLL.set(k, [la, lo]); return k; });
      if (ids.length < 2) continue;
      const a = nearest(nodeLL.get(ids[0])), b = nearest(nodeLL.get(ids.at(-1)));
      runs.push({ nodes: [...(a ? [a] : []), ...ids, ...(b ? [b] : [])], t: pth.surf === 'road' ? { highway: 'unclassified', name: pth.name || '' } : { highway: 'path', bicycle: 'yes', surface: pth.surf || 'gravel', name: pth.name || '' }, id: 0, cyc: false }); // ('road': a proper street, drawn in the editor)
      added++;
    }
    log('edits: paths added', added);
  }
}
// junctions: nodes used by more than one run, or a run's ends
const use = new Map();
for (const r of runs) r.nodes.forEach((id, i) => use.set(id, (use.get(id) || 0) + (i === 0 || i === r.nodes.length - 1 ? 2 : 1)));
const jIndex = new Map(), J = [];
const jOf = (id) => { if (!jIndex.has(id)) { jIndex.set(id, J.length); J.push({ id, ll: nodeLL.get(id) }); } return jIndex.get(id); };
let edges = [];
for (const r of runs) {
  const t = r.t;
  const oneway = FIXES.twoWay?.[r.id] ? 0 : t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular' ? 1 : t.oneway === '-1' ? -1 : 0;
  let start = 0;
  for (let i = 1; i < r.nodes.length; i++) {
    if (i === r.nodes.length - 1 || use.get(r.nodes[i]) >= 2) {
      const ids = r.nodes.slice(start, i + 1);
      edges.push({ a: jOf(ids[0]), b: jOf(ids.at(-1)), ids, name: t.name || t.ref || '', ref: t.ref || '', hw: t.highway, oneway, bridge: !!(t.bridge && t.bridge !== 'no') || !!FIXES.bridge?.[r.id] || !!FIXES.ramp?.[r.id] /* FIXES.bridge: OSM ways that are really bridges but untagged */, ramp: FIXES.ramp?.[r.id] ? true : undefined, wid: r.id, tunnel: !!(t.tunnel && t.tunnel !== 'no'), rb: t.junction === 'roundabout', cyc: r.cyc, off: OFF.test(t.highway) || undefined, surf: OFF.test(t.highway) ? surfOf(t) : undefined, sw: sidewalkOf(t) });
      start = i;
    }
  }
}
log('runs', runs.length, 'edges', edges.length, 'junctions', J.length);
// the editor's removals and one-way changes: each mark picks the nearest edge within 10 m
if (EDITS?.remove?.length || EDITS?.oneway?.length || EDITS?.straight?.length) {
  // (distance to each edge's segments: OSM nodes sit only at bends and junctions, a mark mid-way along a straight was
  // tens of metres from any node)
  const kx = 111320 * Math.cos((((box.s + box.n) / 2) * Math.PI) / 180), ky = 110540;
  const segD = (ll, a, b) => { const ax = (a[1] - ll[1]) * kx, ay = (a[0] - ll[0]) * ky, bx = (b[1] - ll[1]) * kx, by = (b[0] - ll[0]) * ky, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(ax + vx * t, ay + vy * t); };
  const near = (ll, ok = () => true) => { let best = null; edges.forEach((e, i) => { if (!ok(e)) return; for (let k = 1; k < e.ids.length; k++) { const d = segD(ll, nodeLL.get(e.ids[k - 1]), nodeLL.get(e.ids[k])); if (d < 10 && (!best || d < best.d)) best = { d, i }; } }); return best?.i; };
  const drop = new Set();
  // (a removal names what was clicked, e.name || e.hw: it takes the nearest piece of THAT name / kind, so a path removed
  // beside a road can't take the road with it: 2026-11-21, a footpath behind a cul-de-sac removed the cul-de-sac)
  for (const m of EDITS.remove || []) { const i = m.note ? near(m.at, (e) => (e.name || e.hw) === m.note) : near(m.at); if (i != null) drop.add(i); } // (nothing of that name / kind there now: nothing removed)
  for (const m of EDITS.oneway || []) { const i = near(m.at); if (i == null) continue; const e = edges[i]; if (m.mode === 'two') e.oneway = 0; else if (m.toward) { const a = nodeLL.get(e.ids[0]), b = nodeLL.get(e.ids.at(-1)); e.oneway = dist(m.toward, b) < dist(m.toward, a) ? 1 : -1; } }
  // (straight: a piece kept but drawn straight between its two ends, its in-between points dropped: the island loops at
  // Tower Bridge's ends, made one two-way road that flows on from the bridge, 2026-11-22)
  for (const m of EDITS.straight || []) { const i = m.note ? near(m.at, (e) => (e.name || e.hw) === m.note) : near(m.at); if (i != null && edges[i].ids.length > 2) edges[i].ids = [edges[i].ids[0], edges[i].ids.at(-1)]; }
  edges = edges.filter((_, i) => !drop.has(i));
  log('edits: removed', drop.size, 'of', (EDITS.remove || []).length, '; one-way changes', (EDITS.oneway || []).length);
}
// dead ends (the owner 2026-11-17: the station road, a real 100 m cul-de-sac, was missing): they used to be pruned so a
// rider always had a way on. Now the ride turns round at the end of one by itself (openworld.js), so real ones stay:
// roads 25 m+ and off-road paths 150 m+ (shorter stubs are mapping scraps: gap links, driveways), marked `dead` (the
// edges the old pruning would have removed) so the ride only goes down one when the rider picks it or the satnav does
{
  const lenE = (e) => { let L = 0; for (let k = 1; k < e.ids.length; k++) { const p = nodeLL.get(e.ids[k - 1]), q = nodeLL.get(e.ids[k]); L += Math.hypot((p[0] - q[0]) * 110540, (p[1] - q[1]) * 111320 * Math.cos((p[0] * Math.PI) / 180)); } return L; };
  const prune = (list, keep) => { for (;;) {
    const deg = new Map();
    for (const e of list) { if (e.a === e.b) continue; deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    const before = list.length;
    list = list.filter((e) => e.a !== e.b && ((deg.get(e.a) > 1 && deg.get(e.b) > 1) || keep(e)));
    if (list.length === before) return list;
  } };
  const live = new Set(prune(edges, () => false));
  edges = prune(edges, (e) => !live.has(e) && lenE(e) >= (OFF.test(e.hw) ? 150 : 25));
  let nd = 0; for (const e of edges) if (!live.has(e)) { e.dead = true; nd++; }
  log('dead ends kept', nd, 'edges (the ride turns round at their ends)');
}
// largest connected piece only
{
  const adj = new Map();
  for (const e of edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
  const comp = new Map(); let best = null, bestN = 0;
  for (const s of adj.keys()) {
    if (comp.has(s)) continue;
    const q = [s]; comp.set(s, s); let n = 0;
    while (q.length) { const v = q.pop(); n++; for (const w of adj.get(v)) if (!comp.has(w)) { comp.set(w, s); q.push(w); } }
    if (n > bestN) { bestN = n; best = s; }
  }
  edges = edges.filter((e) => comp.get(e.a) === best);
}
log('after pruning', edges.length, 'edges');

// ---------- heights: every ~10 m along each edge from the LIDAR ground model ----------
const dtm = async (lat, lon) => { const { E, N } = toBNG(lat, lon); try { const h = await heightAt('dtm', E, N); return Number.isFinite(h) && h > -100 && h < 2000 ? h : null; } catch { return null; } };
let done = 0, total = 0;
for (const e of edges) {
  const P = e.ids.map((id) => nodeLL.get(id));
  const pts = [P[0]];
  for (let i = 1; i < P.length; i++) { const L = dist(P[i - 1], P[i]), n = Math.ceil(L / 10); for (let k = 1; k <= n; k++) pts.push([P[i - 1][0] + ((P[i][0] - P[i - 1][0]) * k) / n, P[i - 1][1] + ((P[i][1] - P[i - 1][1]) * k) / n]); }
  e.pts = pts; total += pts.length;
}
log('height points', total);
for (const e of edges) {
  const h = [];
  for (const p of e.pts) h.push(await dtm(p[0], p[1]));
  // fill gaps; bridges and tunnels: straight between the ends (the ground model has the valley / the hill)
  const ok = h.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (!ok.length) h.fill(0);
  for (let i = 0; i < h.length; i++) if (h[i] == null) { const a = [...ok].reverse().find(([k]) => k < i), b = ok.find(([k]) => k > i); h[i] = a && b ? a[1] + ((b[1] - a[1]) * (i - a[0])) / (b[0] - a[0]) : (a || b)[1]; }
  if ((e.bridge || e.tunnel) && h.length > 2) { const a = h[0], b = h.at(-1); for (let i = 0; i < h.length; i++) h[i] = a + ((b - a) * i) / (h.length - 1); }
  // light smoothing (3-point median, then mean): kerbs and LIDAR noise
  const m = h.map((v, i) => [h[Math.max(0, i - 1)], v, h[Math.min(h.length - 1, i + 1)]].sort((x, y) => x - y)[1]);
  e.pts = e.pts.map((p, i) => [r6(p[0]), r6(p[1]), +((m[Math.max(0, i - 1)] + m[i] + m[Math.min(m.length - 1, i + 1)]) / 3).toFixed(1)]);
  if (++done % 200 === 0) log('heights', done, '/', edges.length);
}
// big bridges (London 2026-11-17: the Thames bridges came out at river level): "straight between the ends" assumes the
// ends are on land, but a bridge mapped in pieces (Tower Bridge: side spans, bascules) has ends out on its piers, where
// the ground model reads the water. Where the first-return surface (DSM: the deck) stands more than 2.5 m over that
// straight line along most of a piece, the deck follows the DSM instead: points every 10 m, the lowest of three readings
// 2 m apart (vehicles, lamp posts), a 5-point median, held to the ground height at ends that meet a road on land.
// Small bridges (Bromsgrove's humpbacks: < 1.2 m) never reach the threshold and stay as they were.
const dsmAt = async (lat, lon) => { const { E, N } = toBNG(lat, lon); try { const h = await heightAt('dsm', E, N); return Number.isFinite(h) && h > -100 && h < 2000 ? h : null; } catch { return null; } };
// ---- whole bridges on their surveyed decks (OPT.bridgeRuns, 2026-11-20, the owner: "bridges in all 3 worlds ... need to be
// perfect, no sinking, correct heights, all checked"). Replaces the piece-by-piece pass below for the worlds that set it:
// every bridge piece (roads and paths, any length) is read against the survey; pieces meeting at a junction agree on one
// height; ends on land are held to the land. Per piece: points every 5 m; at each, the first-return surface (DSM) across
// the deck (centre and both sides inside the parapets) and 2 m either way along; a point is DECK when the readings across
// agree within 1.2 m (a deck is flat across, tree canopy isn't), its height the lowest reading. A piece is RAISED when
// most of its points are deck standing over 2 m above the ground under them (DTM); raised pieces follow the deck (median
// of 5, gaps filled); others (low bridges over streams, humpbacks) keep their heights. Pieces that aren't raised but sit
// between raised ones (short footbridge pieces, links under 12 m) run straight between their neighbours. Then every
// junction of bridge pieces gets one height (land: the land's; else the mean of the raised pieces' ends, else of all),
// eased into each piece over up to 15 m. bridgecheck.mjs checks the result.
if (OPT.bridgeRuns) {
  const RW = { trunk: 8, trunk_link: 6, primary: 7.5, primary_link: 6, secondary: 7, secondary_link: 6, tertiary: 6.5, tertiary_link: 5.5, unclassified: 5, residential: 5.5, living_street: 4.5, cycleway: 3, track: 3, bridleway: 2.4, path: 1.8, footway: 2 };
  const dtmAt = async (lat, lon) => { const { E, N } = toBNG(lat, lon); try { const h = await heightAt('dtm', E, N); return Number.isFinite(h) && h > -100 && h < 2000 ? h : null; } catch { return null; } };
  const landJ = new Set(); for (const e of edges) if (!e.bridge && !e.tunnel) { landJ.add(e.a); landJ.add(e.b); }
  const B = edges.filter((e) => e.bridge && e.pts.length >= 2);
  let nRaised = 0, nTrees = 0;
  for (const e of B) {
    const P = [e.pts[0]];
    for (let k = 1; k < e.pts.length; k++) { const a = e.pts[k - 1], b = e.pts[k], L = dist(a, b), n = Math.max(1, Math.ceil(L / 5)); for (let j = 1; j <= n; j++) { const t = j / n; P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } }
    const half = Math.max(0.4, Math.min(1.2, (RW[e.hw] || 5) / 2 - 0.7)), K = 111320 * Math.cos((P[0][0] * Math.PI) / 180); // (within 1.2 m of the middle: on narrow old bridges, Bidford and Clopton, the full width reached the parapets)
    const deck = [], gnd = [];
    for (let k = 0; k < P.length; k++) {
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
      const ux = (b[0] - a[0]) * 110540, uy = (b[1] - a[1]) * K, L = Math.hypot(ux, uy) || 1, tn = [ux / L, uy / L], nm = [-tn[1], tn[0]]; // ([north, east] metres)
      const at = (f, r) => [P[k][0] + (tn[0] * f + nm[0] * r) / 110540, P[k][1] + (tn[1] * f + nm[1] * r) / K];
      const across = []; for (const r of [-half, 0, half]) { const v = await dsmAt(...at(0, r)); if (v != null) across.push(v); }
      const along = []; for (const f of [-2, 2]) { const v = await dsmAt(...at(f, 0)); if (v != null) along.push(v); }
      const g = await dtmAt(P[k][0], P[k][1]); gnd.push(g);
      // (deck: the two lowest readings agree within 0.6 m; one reading caught on a parapet or girder doesn't spoil it:
      // Tower Bridge's bascules had one side on the ironwork; tree canopy hardly ever gives two equal lowest readings)
      const rd = [...across, ...along].sort((x, y) => x - y);
      if (rd.length >= 2 && rd[1] - rd[0] < 0.6) deck.push(rd[0]); else deck.push(null);
    }
    const raisedPts = deck.filter((v, k) => v != null && gnd[k] != null && v - gnd[k] > 2.0).length;
    const treesPts = deck.filter((v) => v == null).length;
    // (FIXES.decks: a bridge known to be raised where trees and parapets break up the survey: follow the survey's centre
    // anyway; 'low': keep its heights)
    const fix = String(FIXES.decks?.[e.wid] ?? '').split(':')[0].trim(); // (entries read 'raised: why' / 'low: why')
    if (fix === 'raised') for (let k = 0; k < P.length; k++) if (deck[k] == null) { const c = await dsmAt(P[k][0], P[k][1]); deck[k] = c; }
    if (fix !== 'low' && (fix === 'raised' || raisedPts >= Math.max(1, 0.5 * P.length))) {
      for (let k = 0; k < deck.length; k++) if (deck[k] == null) { let a = k, b = k; while (a >= 0 && deck[a] == null) a--; while (b < deck.length && deck[b] == null) b++; deck[k] = a >= 0 && b < deck.length ? deck[a] + ((deck[b] - deck[a]) * (k - a)) / (b - a) : a >= 0 ? deck[a] : deck[b]; }
      // (median of 9, ~40 m: a 3-point spike where a span meets a tower, Tower Bridge's south span, went through a median of 5)
      const md = deck.map((_, k) => { const w = deck.slice(Math.max(0, k - 4), k + 5).sort((x, y) => x - y); return w[w.length >> 1]; });
      e.pts = P.map((p, k) => [r6(p[0]), r6(p[1]), +md[k].toFixed(2)]); e.raised = true; nRaised++;
    } else { e.pts = P.map((p) => [r6(p[0]), r6(p[1]), +p[2].toFixed(2)]); if (treesPts > 0.5 * P.length) nTrees++; }
  }
  // FIXES.decks 'low' pieces that join up (Harrow Road under the Westway: the survey can't see the road at all there) run
  // as one even slope between the open road at their ends: each point's height is the ends' heights weighted by how far
  // along the group it is from each (2026-11-20; it dropped 5.3 m in one 30 m piece)
  { const isLow = (f) => String(FIXES.decks?.[f.wid] ?? '').split(':')[0].trim() === 'low';
    const lows = B.filter(isLow), seen = new Set();
    const lenOf = (f) => { let L = 0; for (let k = 1; k < f.pts.length; k++) L += dist(f.pts[k - 1], f.pts[k]); return L; };
    for (const s0 of lows) {
      if (seen.has(s0)) continue;
      const grp = [s0]; seen.add(s0);
      for (let n = 0; n < grp.length; n++) for (const f of lows) if (!seen.has(f) && [f.a, f.b].some((j) => j === grp[n].a || j === grp[n].b)) { seen.add(f); grp.push(f); }
      const js = new Set(grp.flatMap((f) => [f.a, f.b]));
      const ends = [...js].filter((j) => edges.some((x) => !grp.includes(x) && !x.off && (x.a === j || x.b === j)));
      if (ends.length < 2) continue;
      const hEnd = (j) => { const hs = edges.filter((x) => !grp.includes(x) && !x.off && (x.a === j || x.b === j)).map((x) => (x.a === j ? x.pts[0][2] : x.pts.at(-1)[2])); return hs.reduce((t, v) => t + v, 0) / hs.length; };
      // distance from each end to every junction of the group (Dijkstra over the group's pieces)
      const dFrom = ends.map((j0) => { const D = new Map([[j0, 0]]), Q = [j0]; while (Q.length) { Q.sort((x, y) => D.get(x) - D.get(y)); const j = Q.shift(); for (const f of grp) { const o = f.a === j ? f.b : f.b === j ? f.a : null; if (o == null) continue; const nd = D.get(j) + lenOf(f); if (nd < (D.get(o) ?? Infinity)) { D.set(o, nd); Q.push(o); } } } return D; });
      const H = ends.map(hEnd);
      for (const f of grp) {
        const cum = [0]; for (let k = 1; k < f.pts.length; k++) cum.push(cum[k - 1] + dist(f.pts[k - 1], f.pts[k])); const L = cum.at(-1) || 1;
        f.pts = f.pts.map((p, k) => { let wt = 0, sum = 0; for (let n = 0; n < ends.length; n++) { const d = Math.min((dFrom[n].get(f.a) ?? 1e9) + cum[k], (dFrom[n].get(f.b) ?? 1e9) + L - cum[k]); if (d < 0.5) return [p[0], p[1], +H[n].toFixed(2)]; wt += 1 / d; sum += H[n] / d; } return [p[0], p[1], +(sum / wt).toFixed(2)]; });
        f.raised = true;
      }
      log('low deck group', grp[0].name, grp.length, 'pieces, ends', H.map((h) => h.toFixed(1)).join(' / '));
    }
  }
  // not raised, between raised pieces (or a raised piece and another bridge piece): straight between them
  const endOf = (f, j) => (f.a === j ? f.pts[0][2] : f.b === j ? f.pts.at(-1)[2] : null);
  const at = new Map(); for (const e of B) for (const j of [e.a, e.b]) (at.get(j) || at.set(j, []).get(j)).push(e);
  for (let pass = 0; pass < 3; pass++) for (const e of B) {
    if (e.raised) continue;
    const side = (j) => { if (landJ.has(j)) return null; const r = (at.get(j) || []).filter((f) => f !== e && f.raised); return r.length ? r.reduce((t, f) => t + endOf(f, j), 0) / r.length : null; };
    const ha = side(e.a), hb = side(e.b);
    if (ha == null && hb == null) continue;
    const hA = ha ?? e.pts[0][2], hB = hb ?? e.pts.at(-1)[2];
    if (Math.max(Math.abs(hA - e.pts[0][2]), Math.abs(hB - e.pts.at(-1)[2])) < 1.0) continue;
    const cum = [0]; for (let k = 1; k < e.pts.length; k++) cum.push(cum[k - 1] + dist(e.pts[k - 1], e.pts[k])); const L = cum.at(-1) || 1;
    e.pts = e.pts.map((p, k) => [p[0], p[1], +(hA + ((hB - hA) * cum[k]) / L).toFixed(2)]); e.raised = true;
  }
  // one height at every junction of bridge pieces, eased in over up to 15 m
  const target = new Map();
  for (const [j, list] of at) {
    const ends = list.map((f) => ({ f, h: endOf(f, j) }));
    let t;
    // (at land too, the bridge keeps its deck's height and the road onto it ramps to meet it, the "bridge ends" pass below:
    // holding a raised end down to the land squeezed the climb onto short bridges, 20%+)
    { const r = ends.filter((x) => x.f.raised); const use = r.length ? r : ends; t = use.length > 1 || !landJ.has(j) ? use.reduce((x, y) => x + y.h, 0) / use.length : null; }
    if (t != null) target.set(j, t);
  }
  let nEased = 0;
  for (const e of B) {
    const cum = [0]; for (let k = 1; k < e.pts.length; k++) cum.push(cum[k - 1] + dist(e.pts[k - 1], e.pts[k])); const L = cum.at(-1) || 1, span = Math.min(15, L / 2);
    const dA = target.has(e.a) ? target.get(e.a) - e.pts[0][2] : 0, dB = target.has(e.b) ? target.get(e.b) - e.pts.at(-1)[2] : 0;
    if (Math.abs(dA) < 0.01 && Math.abs(dB) < 0.01) continue;
    e.pts = e.pts.map((p, k) => { const ea = cum[k] < span ? 1 - cum[k] / span : 0, eb = L - cum[k] < span ? 1 - (L - cum[k]) / span : 0, sa = ea * ea * (3 - 2 * ea), sb = eb * eb * (3 - 2 * eb); return [p[0], p[1], +(p[2] + dA * sa + dB * sb).toFixed(1)]; });
    nEased++;
  }
  for (const e of B) { if (e.raised) e.deck = true; delete e.raised; }
  log('bridges: raised on their surveyed decks', nRaised, '; ends joined', nEased, '; mostly under trees', nTrees, 'of', B.length);
}
if (!OPT.bridgeRuns && (OPT.city || OPT.dsmDecks?.length)) { // (city worlds: every big bridge; others: only the reported ones, OPT.dsmDecks)
  const landEnd = new Set(); for (const e of edges) if (!e.bridge && !e.tunnel) { landEnd.add(e.a); landEnd.add(e.b); }
  let nDeck = 0;
  for (const e of edges) {
    if (!e.bridge) continue; // (cycle tracks and footways on a bridge too: Westminster's and Lambeth's sat on the water)
    if (!OPT.city && !OPT.dsmDecks.some((f) => e.pts.some((q) => dist(q, f.at) < 40))) continue;
    // densify to <= 10 m
    const P = [e.pts[0]];
    for (let k = 1; k < e.pts.length; k++) { const a = e.pts[k - 1], b = e.pts[k], L = dist(a, b), n = Math.ceil(L / 10); for (let j = 1; j <= n; j++) { const t = j / n; P.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } }
    const ds = [];
    for (let k = 0; k < P.length; k++) {
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], L = dist(a, b) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, vals = [];
      for (const s of [-2, 0, 2]) { const v = await dsmAt(P[k][0] + ux * s, P[k][1] + uy * s); if (v != null) vals.push(v); }
      ds.push(vals.length ? Math.min(...vals) : null);
    }
    const ok = ds.filter((v, k) => v != null && v - P[k][2] > 2.5).length;
    if (ok < Math.max(2, 0.6 * P.length)) continue;
    // fill gaps, median of 5
    for (let k = 0; k < ds.length; k++) if (ds[k] == null) { let a = k, b = k; while (a >= 0 && ds[a] == null) a--; while (b < ds.length && ds[b] == null) b++; ds[k] = a >= 0 && b < ds.length ? ds[a] + ((ds[b] - ds[a]) * (k - a)) / (b - a) : a >= 0 ? ds[a] : ds[b] ?? P[k][2]; }
    const med = ds.map((_, k) => { const w = ds.slice(Math.max(0, k - 2), k + 3).sort((x, y) => x - y); return w[w.length >> 1]; });
    // held to the ground at ends on land, eased over 15 m
    const cum = [0]; for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + dist(P[k - 1], P[k])); const Lt = cum.at(-1);
    // (an end is held to the ground only where the deck really meets it: a footway joining out over the river made
    // Westminster Bridge dive to the water at a 'land' end)
    const hA = landEnd.has(e.a) && ds[0] - P[0][2] < 2.5 ? P[0][2] : null, hB = landEnd.has(e.b) && ds.at(-1) - P.at(-1)[2] < 2.5 ? P.at(-1)[2] : null;
    e.pts = P.map((p, k) => {
      let h = med[k];
      if (hA != null && cum[k] < 15) { const t = cum[k] / 15, w = t * t * (3 - 2 * t); h = hA + (h - hA) * w; }
      if (hB != null && Lt - cum[k] < 15) { const t = (Lt - cum[k]) / 15, w = t * t * (3 - 2 * t); h = hB + (h - hB) * w; }
      return [r6(p[0]), r6(p[1]), +h.toFixed(1)];
    });
    e.deck = true; nDeck++;
  }
  log('big bridges on their decks (DSM):', nDeck);
}
// FIXES.ramp (2026-11-20): a way that runs straight between its neighbours' end heights (and counts as bridge, so the deck
// is drawn and ridden): a short approach the surface model can't see as a deck (Westminster Bridge's west end)
{ const endH = (j, self) => { let h = null; for (const x of edges) { if (x === self || x.off) continue; const q = x.a === j ? x.pts[0] : x.b === j ? x.pts.at(-1) : null; if (q && (h == null || q[2] > h)) h = q[2]; } return h; };
  for (const e of edges) { if (!e.ramp) continue; const hA = endH(e.a, e), hB = endH(e.b, e); if (hA == null || hB == null) continue;
    const cum = [0]; for (let k = 1; k < e.pts.length; k++) cum.push(cum[k - 1] + dist(e.pts[k - 1], e.pts[k])); const L = cum.at(-1) || 1;
    e.pts = e.pts.map((p, k) => [p[0], p[1], +(hA + (hB - hA) * cum[k] / L).toFixed(1)]); e.deck = true; delete e.ramp; log('ramp', e.name, hA, '->', hB); } }
// (city worlds) a short piece of road between two bridge pieces, well below both (the road through Tower Bridge's towers
// is untagged in OSM and took the river's level, 3 m, between 13 m decks; the surface model there is the tower), runs
// straight between the two bridges' end heights and counts as bridge
if (OPT.city) {
  const endH = (f, j) => (f.a === j ? f.pts[0][2] : f.b === j ? f.pts.at(-1)[2] : null);
  let nS = 0;
  for (const e of edges) {
    if (e.bridge || e.pts.length < 2) continue; // (tunnels too: the road through each tower is tagged a building passage)
    let L = 0; for (let k = 1; k < e.pts.length; k++) L += dist(e.pts[k - 1], e.pts[k]); if (L > 60) continue;
    const fa = edges.find((f) => f !== e && f.bridge && endH(f, e.a) != null), fb = edges.find((f) => f !== e && f.bridge && endH(f, e.b) != null);
    if (!fa || !fb) continue;
    const ha = endH(fa, e.a), hb = endH(fb, e.b);
    if (Math.min(ha, hb) - Math.max(...e.pts.map((q) => q[2])) < 2) continue;
    let acc = 0; e.pts = e.pts.map((q, k) => { if (k) acc += dist(e.pts[k - 1], q); return [q[0], q[1], +(ha + ((hb - ha) * acc) / (L || 1)).toFixed(1)]; });
    e.bridge = true; e.tunnel = false; nS++;
  }
  log('road pieces between bridges lifted:', nS);
}
// bridge ends: the edges meeting a bridge take its end heights (the ground model dips at abutments)
const jH = new Map(), jName = new Map();
for (const e of edges) if (e.bridge || e.tunnel) { jH.set(e.a, e.pts[0][2]); jH.set(e.b, e.pts.at(-1)[2]); if (e.name) { jName.set(e.a, e.name); jName.set(e.b, e.name); } }
// (OPT.bridgeRuns, 2026-11-20) the road off a bridge end ramps over a DISTANCE that suits the height to make up (10 m a
// metre, 20-80 m), carrying on along the next pieces where the first is short: Southwark Bridge ended at an 8 m link that
// dropped 3.5 m, and point-by-point ramps on short pieces left steps of 1-3 m at London's bridge ends. The road keeps its
// own shape, shifted by the difference fading out along the ramp.
if (OPT.bridgeRuns) {
  const deg = new Map(); for (const e of edges) if (!e.bridge && !e.tunnel) for (const j of [e.a, e.b]) deg.set(j, (deg.get(j) || 0) + 1);
  const touched = new Map(); const touch = (e, j) => (touched.get(e) || touched.set(e, new Set()).get(e)).add(j);
  const passedAll = []; // (junctions ramps went through: matched again once every ramp is done)
  for (const [j0, target] of jH) for (const e0 of edges) {
    // (each road piece ramps from EVERY bridge end it meets, once per end: skipping a piece already ramped from another
    // bridge left Lambeth Bridge's cycle track dropping 3.4 m and Harrow Road's 19 m, 2026-11-20)
    if (e0.bridge || e0.tunnel || (e0.a !== j0 && e0.b !== j0) || touched.has(e0) && touched.get(e0).has(j0)) continue;
    const startH = e0.a === j0 ? e0.pts[0][2] : e0.pts.at(-1)[2], drop = target - startH;
    // (no early skip when the join already matches: the abutment bump beyond it still needs smoothing)
    let D = 80; // (chain gathered up to the longest ramp; its length is settled below)
    // the chain of road pieces from the bridge end: [edge, forward?]
    const chain = [], passed = []; let e = e0, j = j0, acc = 0;
    while (e && acc < D && chain.length < 8) {
      const fwd = e.a === j; chain.push([e, fwd]); touch(e, j);
      let L = 0; for (let k = 1; k < e.pts.length; k++) L += dist(e.pts[k - 1], e.pts[k]); acc += L;
      const jn = fwd ? e.b : e.a;
      if (acc >= D || jH.has(jn)) break;
      if (deg.get(jn) !== 2) {
        // (OPT.rampThrough, 2026-11-22) a junction within 20 m of the deck: the ramp carries on along the same road
        // (same kind, same name ignoring spaces) and the other roads there follow the junction's new height. Stopping at
        // it squeezed the ramp into those metres and left the junction at the road's own height, below its neighbours:
        // Whettybridge Road dropped 3 m in 10 m onto a 1.6 m step; the far ends of five London bridges 0.6-1 m
        // (a list: only ramps from those bridges, by name: London, where the general rule disturbed dense junctions)
        const rt = Array.isArray(OPT.rampThrough) ? OPT.rampThrough.includes(jName.get(j0)) : OPT.rampThrough;
        if (!rt || acc >= 20) break;
        // ('steep': only where the ramp squeezed into these metres would be steeper than 10%: London's dense junctions
        // took every other change badly, slopes of 30-116% where three roads meet within a few metres)
        if (OPT.rampThrough === 'steep' && Math.abs(target - (fwd ? e.pts.at(-1) : e.pts[0])[2]) / Math.max(1, acc) < 0.1) break;
        const legs = edges.filter((f) => f !== e && !f.bridge && !f.tunnel && (f.a === jn || f.b === jn)), nm = (x) => (x || '').toLowerCase().replace(/[^a-z]/g, '');
        const nx = legs.find((f) => f.hw === e.hw && nm(f.name) === nm(e.name)) || legs.find((f) => f.hw === e.hw) || (legs.length === 1 ? legs[0] : null);
        if (!nx) break;
        passed.push({ j: jn, legs: legs.filter((f) => f !== nx) }); e = nx; j = jn; continue;
      }
      e = edges.find((f) => f !== e && !f.bridge && !f.tunnel && (f.a === jn || f.b === jn)); j = jn;
    }
    // the road's own height s metres along the chain
    const hAt = (sW) => { let sA = 0; for (const [f, fwd] of chain) { const P = fwd ? f.pts : [...f.pts].reverse(); for (let k = 0; k < P.length; k++) { if (k) sA += dist(P[k - 1], P[k]); if (sA >= sW - 0.01) return P[k][2]; } } const [f, fwd] = chain.at(-1); return (fwd ? f.pts.at(-1) : f.pts[0])[2]; };
    // ramp length: 10 m for every metre between the deck and the road where the ramp ends (20-80 m), settled over a few
    // rounds; from the mismatch at the join alone, a join that matched got the shortest ramp even where the road falls
    // away just beyond it (a Bromsgrove bridleway: 8 m down in 18 m off the deck; Whettybridge Road 3 m in 10 m)
    D = Math.max(20, Math.min(80, Math.abs(drop) * 10));
    for (let it = 0; it < 4; it++) D = Math.max(20, Math.min(80, Math.max(Math.abs(drop), Math.abs(target - hAt(Math.min(D, acc)))) * 10));
    const Dused = Math.min(D, acc), hD = hAt(Dused);
    // from the deck's end height to the road's height Dused on, eased, ignoring the road's own heights in between: the
    // ground model has the abutment walls in it, a 1.5-2.7 m bump just off Bromsgrove's bridges (2026-11-20)
    let s0 = 0;
    for (const [f, fwd] of chain) {
      const P = fwd ? f.pts : [...f.pts].reverse(); let sAcc = s0;
      const Q = P.map((q, k) => { if (k) sAcc += dist(P[k - 1], q); if (sAcc > Dused) return q; const t = Math.min(1, sAcc / (Dused || 1)), sm = t * t * (3 - 2 * t); return [q[0], q[1], +(target + (hD - target) * sm).toFixed(1)]; });
      f.pts = fwd ? Q : Q.reverse(); s0 = sAcc;
    }
    for (const { j: jn } of passed) passedAll.push({ j: jn, on: chain.filter(([f]) => f.a === jn || f.b === jn).map(([f]) => f) });
    if (OPT.rampThrough === true && chain.length) { const [f, fwd] = chain.at(-1), jl = fwd ? f.b : f.a; if (!jH.has(jl)) passedAll.push({ j: jl, on: [], end: true }); }
  }
  // the other roads at each junction a ramp passed through: shifted to the ramp's height there, fading out over 20 m
  // (after every ramp: two bridges' ramps through one junction left its roads at three heights, West Works Way)
  // (where a ramp only ENDS at a junction, its roads take their middle height: a ramp from another bridge had moved
  // some of them, West Works Way's junction with the River Rea Trail 0.8 m apart; junctions passed through come first)
  const thru = new Set(passedAll.filter((x) => !x.end).map((x) => x.j)), doneJ = new Set();
  for (const { j: jn, on, end } of [...passedAll.filter((x) => !x.end), ...passedAll.filter((x) => x.end)]) {
    if (end && (thru.has(jn) || doneJ.has(jn))) continue; doneJ.add(jn);
    { const legs = edges.filter((f) => !f.bridge && !f.tunnel && (f.a === jn || f.b === jn)); // (all of them, the ramps' own too: a second ramp through the junction may have moved one)
      const hs = legs.map((f) => (f.a === jn ? f.pts[0] : f.pts.at(-1))[2]).sort((x, y) => x - y); if (!hs.length) continue;
      const hj = on.length ? on.reduce((t, f) => t + (f.a === jn ? f.pts[0] : f.pts.at(-1))[2], 0) / on.length : hs[hs.length >> 1];
      for (const g of legs) {
        const fwd = g.a === jn, P = fwd ? g.pts : [...g.pts].reverse(), dz = hj - P[0][2]; if (Math.abs(dz) < 0.05) continue;
        // (the fade ends within the piece: a 2 m link's far end, at the next junction, moved with it)
        let Lg = 0; for (let k = 1; k < P.length; k++) Lg += dist(P[k - 1], P[k]); const F = Math.min(20, Lg);
        let sA = 0; const Q = P.map((q, k) => { if (k) sA += dist(P[k - 1], q); if (sA >= F) return q; const t = sA / (F || 1), sm = 1 - t * t * (3 - 2 * t); return [q[0], q[1], +(q[2] + dz * sm).toFixed(1)]; });
        g.pts = fwd ? Q : Q.reverse();
      }
    }
  }
}
// FIXES.fill (2026-11-20): a pit in the ground model at one spot: road points within r metres of [lat, lon] that sit below
// h are raised towards it, fully at the centre and fading out to r (south end of Lambeth Bridge: a junction 3 m below
// every road round it, where three 3-6 m links from the bridge ends dropped into it). Only the listed spots change.
for (const f of FIXES.fill || []) {
  let n = 0;
  for (const e of edges) { if (e.bridge || e.tunnel) continue; let ch = false;
    e.pts = e.pts.map((q) => { const dd = dist(q, [f.lat, f.lon]); if (dd >= f.r || q[2] >= f.h) return q; const t = 1 - dd / f.r, w = t * t * (3 - 2 * t); ch = true; return [q[0], q[1], +(q[2] + (f.h - q[2]) * w).toFixed(2)]; });
    if (ch) n++; }
  log('fill', f.note || '', n, 'pieces');
}
for (const e of edges) if (!e.bridge && !e.tunnel && !OPT.bridgeRuns) {
  for (const [end, idx] of [[e.a, 0], [e.b, e.pts.length - 1]]) if (jH.has(end)) {
    const target = jH.get(end), d0 = e.pts[idx][2] - target;
    if (OPT.city && e.pts.length > 2) {
      // (city worlds: a straight ramp from the last point left alone to the bridge's end height; adding the end's error
      // over 6 points pushed the points before a two-point dip into a 3 m hump: Tower Bridge Approach, London 2026-11-17)
      const n = Math.min(6, e.pts.length - 1), base = e.pts[idx === 0 ? n : e.pts.length - 1 - n][2];
      for (let k = 0; k < n; k++) { const i = idx === 0 ? k : e.pts.length - 1 - k; e.pts[i][2] = +(target + ((base - target) * k) / n).toFixed(1); }
    } else for (let k = 0; k < Math.min(6, e.pts.length); k++) { const i = idx === 0 ? k : e.pts.length - 1 - k; e.pts[i][2] = +(e.pts[i][2] - d0 * (1 - k / 6)).toFixed(1); }
  }
}
// junction table: only the junctions still used
const usedJ = [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort((x, y) => x - y), remap = new Map(usedJ.map((j, i) => [j, i]));
const roads = {
  box,
  junctions: usedJ.map((j) => J[j].ll.map(r6)),
  edges: edges.map((e) => ({ a: remap.get(e.a), b: remap.get(e.b), name: e.name, hw: e.hw, oneway: e.oneway || undefined, bridge: e.bridge || undefined, tunnel: e.tunnel || undefined, rb: e.rb || undefined, cyc: e.cyc || undefined, off: e.off || undefined, surf: e.surf || undefined, sw: e.sw || undefined, dead: e.dead || undefined, pts: e.pts })),
};
const km = edges.reduce((s, e) => s + e.pts.slice(1).reduce((t, p, i) => t + dist(e.pts[i], p), 0), 0);
log('roads:', roads.edges.length, 'edges,', (km / 1000).toFixed(0), 'km');

// ---------- the generated world for the square ----------
log('world');
// (in four quarters: the whole square in one query timed out on every server, 2026-11-15)
const worldQ = (bb) => `[out:json][timeout:180];(
  way["building"](${bb});${OPT.city ? ` relation["building"](${bb});` : ''}
  way["barrier"~"^(hedge|wall|fence|retaining_wall|city_wall)$"](${bb});
  way["natural"~"^(wood|scrub|tree_row)$"](${bb});
  way["landuse"~"^(forest|orchard)$"](${bb});
  relation["natural"="wood"](${bb});
  relation["landuse"="forest"](${bb});
  node["natural"="tree"](${bb});
  node["name"]["amenity"](${bb}); node["name"]["shop"](${bb}); node["name"]["tourism"](${bb});
  way["name"]["amenity"](${bb}); way["name"]["shop"](${bb}); way["name"]["leisure"~"^(park|sports_centre|stadium|golf_course|nature_reserve)$"](${bb});
  node["place"~"^(town|suburb|village|hamlet|neighbourhood|quarter)$"](${bb});
  way["landuse"](${bb}); relation["landuse"](${bb});
  way["leisure"~"^(park|pitch|golf_course|playground|garden|common|nature_reserve|recreation_ground|sports_centre|track)$"](${bb});
  way["natural"~"^(water|grassland|heath|wetland|scrub|wood)$"](${bb}); relation["natural"~"^(water|wood)$"](${bb});
  way["amenity"~"^(parking|school|hospital|grave_yard|college|university)$"](${bb});
  way["waterway"="riverbank"](${bb}); way["railway"="rail"](${bb});
  way["waterway"~"^(canal|river|stream)$"](${bb}); node["waterway"="lock_gate"](${bb});
);out geom qt;`;
const quarters = MASK.length === 1 && TILES.length <= 4 ? (() => { const q = [], ms = (box.s + box.n) / 2, mw = (box.w + box.e) / 2; for (const [s0, n0] of [[box.s, ms], [ms, box.n]]) for (const [w0, e0] of [[box.w, mw], [mw, box.e]]) q.push(`${s0},${w0},${n0},${e0}`); return q; })() : TILES;
const wj = { elements: [] }, seenEl = new Set();
for (const qb of quarters) { const part = await overpass(worldQ(qb)); for (const e of part.elements) { const k = e.type + e.id; if (!seenEl.has(k)) { seenEl.add(k); wj.elements.push(e); } } log('world quarter', qb, part.elements.length); }
const ring = (g) => (g || []).map((p) => [r6(p.lat), r6(p.lon)]);
// a multipolygon's outer rings: its outer member ways joined end to end (OSM splits a big outline into many ways; each
// piece used to be taken as a polygon of its own: the Thames came out as dozens of wedges; London 2026-11-17)
function outerRings(rel) {
  const segs = (rel.members || []).filter((m) => (m.role === 'outer' || m.role === '') && m.geometry?.length > 1).map((m) => ring(m.geometry));
  const key = (p) => p[0] + ',' + p[1], out = [];
  while (segs.length) {
    let cur = segs.shift().slice();
    for (let guard = 0; guard < 5000 && key(cur[0]) !== key(cur.at(-1)); guard++) {
      const end = key(cur.at(-1)), i = segs.findIndex((s) => key(s[0]) === end || key(s.at(-1)) === end);
      if (i < 0) break;
      const s = segs.splice(i, 1)[0]; cur = cur.concat((key(s[0]) === end ? s : s.slice().reverse()).slice(1));
    }
    if (cur.length > 3) out.push(cur);
  }
  return out;
}
const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const world = { v: 1, at: new Date().toISOString(), area: id, buildings: [], woods: [], trees: [], rows: [], barriers: [], places: [], land: [] };
// named places for labels on buildings (2026-11-15, the owner: "small labels for places ... so people can better recognise
// locations"): pubs, shops, churches, schools, parks...; [lat, lon, name, kind]; areas (suburbs, villages) as kind 'area'
const SKIP = /^(parking|parking_space|bench|waste_basket|bicycle_parking|telephone|post_box|recycling|vending_machine|atm|toilets|charging_station|grit_bin|shelter|clock|drinking_water|waste_disposal|motorcycle_parking|hunting_stand|letter_box|fountain|bbq|give_box|parcel_locker)$/;
const seenPlace = new Set();
const addPlace = (lat, lon, t) => {
  const kind = t.place ? 'area' : t.amenity || t.shop && 'shop' || t.tourism || t.leisure;
  if (!t.name || !kind || SKIP.test(kind)) return;
  const k = t.name + Math.round(lat * 2000) + Math.round(lon * 2000);
  if (seenPlace.has(k)) return; seenPlace.add(k);
  world.places.push([r6(lat), r6(lon), t.name.slice(0, 40), kind]);
};
// a river line that runs inside a mapped water area (the Thames: a 250 m wide multipolygon with its centre line) isn't
// drawn as a narrow strip as well (2026-11-17, London); the area is the river
let waterAreas = null;
function inWaterArea(geom) {
  if (!waterAreas) { waterAreas = []; for (const e of wj.elements) { const t = e.tags || {}; if (!(t.natural === 'water' || t.waterway === 'riverbank')) continue; if (e.type === 'way' && e.geometry?.length > 3) waterAreas.push(e.geometry.map((q) => [q.lat, q.lon])); if (e.type === 'relation') for (const g of outerRings(e)) waterAreas.push(g); } }
  const pip = (pt, poly) => { let c = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [ya, xa] = poly[a], [yb, xb] = poly[b]; if ((ya > pt[0]) !== (yb > pt[0]) && pt[1] < ((xb - xa) * (pt[0] - ya)) / (yb - ya) + xa) c = !c; } return c; };
  const mids = [geom[geom.length >> 1], geom[geom.length >> 2], geom[(geom.length * 3) >> 2]].map((q) => [q.lat, q.lon]);
  return mids.filter((m) => waterAreas.some((poly) => pip(m, poly))).length >= 2;
}
// land areas for the painted ground (2026-11-15, the owner: a fully artificial world instead of the satellite photo):
// { t: kind, pts: [[lat, lon]] } outer rings; railways as lines (t 'rail')
const LAND = (t) => t.natural === 'water' || t.waterway === 'riverbank' ? 'water' : t.landuse === 'reservoir' || t.landuse === 'basin' ? 'water'
  : t.natural === 'wood' || t.landuse === 'forest' ? 'wood' : t.natural === 'scrub' || t.natural === 'heath' ? 'scrub' : t.natural === 'wetland' ? 'wetland'
  : t.landuse === 'farmland' ? 'farmland' : t.landuse === 'meadow' || t.natural === 'grassland' || t.landuse === 'grass' || t.landuse === 'village_green' || t.leisure === 'common' ? 'grass'
  : t.landuse === 'orchard' || t.landuse === 'vineyard' ? 'orchard' : t.landuse === 'allotments' ? 'allotments' : t.landuse === 'cemetery' || t.amenity === 'grave_yard' ? 'cemetery'
  : t.leisure === 'pitch' || t.leisure === 'track' ? 'pitch' : t.leisure === 'golf_course' ? 'golf' : t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'recreation_ground' || t.landuse === 'recreation_ground' || t.leisure === 'nature_reserve' ? 'park'
  : t.leisure === 'playground' ? 'playground' : t.amenity === 'parking' ? 'parking'
  : t.landuse === 'residential' ? 'residential' : /^(retail|commercial)$/.test(t.landuse) ? 'retail' : /^(industrial|railway|quarry|landfill|brownfield|construction)$/.test(t.landuse) ? 'industrial'
  : /^(school|hospital|college|university)$/.test(t.amenity) || t.leisure === 'sports_centre' ? 'civic' : null;
const centreOf = (e) => e.type === 'node' ? [e.lat, e.lon] : e.geometry?.length ? [e.geometry.reduce((a, p) => a + p.lat, 0) / e.geometry.length, e.geometry.reduce((a, p) => a + p.lon, 0) / e.geometry.length] : e.bounds ? [(e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2] : null;
for (const e of wj.elements) {
  const t = e.tags || {};
  if (maskArg && e.type !== 'relation') { const lin = e.type === 'way' && (t.waterway || t.railway || t.barrier); if (lin ? !(e.geometry || []).some((q) => inBox(q.lat, q.lon)) : (() => { const c = centreOf(e); return !c || !inBox(c[0], c[1]); })()) continue; } // (outside the mask; a canal / railway / wall is kept if any of it is inside: by its middle, long canal ways went missing)
  if (t.railway === 'rail' && e.type === 'way' && e.geometry?.length > 1) world.land.push({ t: 'rail', pts: ring(e.geometry), bridge: ((OPT.city || OPT.railDecks) && t.bridge && t.bridge !== 'no') || undefined }); // (bridge: a 3D deck over what's below, bheights.mjs `dk`, London 2026-11-17; railDecks: Bromsgrove 2026-11-21)
  // canals, rivers and streams as lines (painted water, width w m) and lock gates (2026-11-17: the Worcester & Birmingham
  // Canal and the Tardebigge flight)
  if (/^(canal|river|stream)$/.test(t.waterway) && e.type === 'way' && e.geometry?.length > 1) { if (OPT.city && t.waterway === 'river' && inWaterArea(e.geometry)) continue; world.water ||= []; world.water.push({ t: t.waterway, w: num(t.width) || (t.waterway === 'canal' ? 9 : t.waterway === 'river' ? 8 : 2.5), name: t.name || '', tunnel: !!(t.tunnel && t.tunnel !== 'no') || undefined, bridge: (OPT.city && !!t.bridge && t.bridge !== 'no') || undefined /* an aqueduct (city worlds): no water strip or bed across the valley, the landmark model carries it */, pts: ring(e.geometry) }); continue; }
  if (t.waterway === 'lock_gate' && e.type === 'node') { world.locks ||= []; world.locks.push([r6(e.lat), r6(e.lon)]); continue; }
  const lk = LAND(t);
  if (lk) {
    if (e.type === 'way' && e.geometry?.length > 3) world.land.push({ t: lk, pts: ring(e.geometry) });
    else if (e.type === 'relation') { if (OPT.city) for (const g of outerRings(e)) world.land.push({ t: lk, pts: g }); else for (const m of e.members || []) if (m.role === 'outer' && m.geometry?.length > 3) world.land.push({ t: lk, pts: ring(m.geometry) }); } // (the old way, piece by piece, for worlds without the city option)
  }
  if (t.name && (t.amenity || t.shop || t.tourism || t.leisure || t.place)) {
    if (e.type === 'node') addPlace(e.lat, e.lon, t);
    else if (e.geometry?.length) { const g = e.geometry; addPlace(g.reduce((a, p) => a + p.lat, 0) / g.length, g.reduce((a, p) => a + p.lon, 0) / g.length, t); }
    if (!t.building && !(t.natural || t.landuse)) continue; // (just a place; a named building or wood carries on below)
  }
  if (e.type === 'node') { if (t.natural === 'tree') world.trees.push([r6(e.lat), r6(e.lon)]); continue; }
  if (e.type === 'relation' && !OPT.city) { for (const m of e.members || []) if (m.role === 'outer' && m.geometry?.length > 3) world.woods.push({ t: 'wood', leaf: t.leaf_type || null, pts: ring(m.geometry) }); continue; } // (as before, for worlds without the city option)
  if (e.type === 'relation') {
    // building multipolygons (the Palace of Westminster, the Abbey, Buckingham Palace...: London 2026-11-17; inner
    // courtyards are roofed over), woods; anything else (water, land use) is done above, never a wood
    if (t.building) { for (const g of outerRings(e)) { const lv = num(t['building:levels']), h = num(t.height); world.buildings.push({ k: t.building, h: h || (lv ? lv * 3 + 1.5 : null), roof: t['roof:shape'] || null, pts: g }); } }
    else if (t.natural === 'wood' || t.landuse === 'forest') for (const g of outerRings(e)) world.woods.push({ t: 'wood', leaf: t.leaf_type || null, pts: g });
    continue;
  }
  const g = ring(e.geometry);
  if (g.length < 2) continue;
  if (t.building) { if (g.length < 4) continue; const lv = num(t['building:levels']), h = num(t.height); world.buildings.push({ k: t.building, h: h || (lv ? lv * 3 + 1.5 : null), roof: t['roof:shape'] || null, pts: g }); }
  else if (t.barrier) world.barriers.push({ t: t.barrier === 'hedge' ? 'hedge' : t.barrier === 'fence' ? 'fence' : 'wall', pts: g });
  else if (t.natural === 'tree_row') world.rows.push(g);
  else if (g.length > 3) world.woods.push({ t: t.natural === 'scrub' ? 'scrub' : t.landuse === 'orchard' ? 'orchard' : 'wood', leaf: t.leaf_type || null, pts: g });
}
for (const w of EDITS?.walls || []) if (w.pts?.length > 1) world.barriers.push({ t: w.t === 'hedge' ? 'hedge' : w.t === 'fence' ? 'fence' : 'wall', pts: w.pts.map(([la, lo]) => [r6(la), r6(lo)]) }); // (the editor's walls and hedges)
log('world:', world.buildings.length, 'buildings', world.woods.length, 'woods', world.trees.length, 'trees', world.places.length, 'places', world.land.length, 'land areas');
const keepT = args.includes('--keep-trees') ? args[args.indexOf('--keep-trees') + 1] : null;
if (keepT) { try { const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world', keepT + '.json'), 'utf8')); world.lidarTrees = old.lidarTrees || []; world.lidarAt = old.lidarAt; log('LIDAR trees kept from', keepT, world.lidarTrees.length); } catch (e) { log('keep-trees:', e.message); } }
if (!flag('--no-trees') && !keepT) {
  log('LIDAR trees');
  const lines = roads.edges.map((e) => e.pts.filter((_, i) => i % 2 === 0 || i === e.pts.length - 1).map(([lat, lon]) => ({ lat, lon })));
  world.lidarTrees = await canopyTrees(lines, world.buildings.map((b) => b.pts), { band: 100, log: (m) => log(m) });
  // the same tree seen from two roads' bands only once
  const seen = new Set();
  world.lidarTrees = world.lidarTrees.filter(([la, lo]) => { const k = `${Math.round(la * 1e5)},${Math.round(lo * 1e5)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  world.lidarAt = new Date().toISOString();
  log('LIDAR trees:', world.lidarTrees.length);
}
// the editor's tree removals (a spot and a radius: trees the 2022 survey saw that have gone, or bushes taken for trees)
if (EDITS?.trees?.length) { const gone = (la, lo) => EDITS.trees.some((t) => dist([la, lo], t.at) < (t.r || 8)); const n0 = (world.lidarTrees || []).length + world.trees.length; world.lidarTrees = (world.lidarTrees || []).filter(([la, lo]) => !gone(la, lo)); world.trees = world.trees.filter(([la, lo]) => !gone(la, lo)); log('edits: trees removed', n0 - world.lidarTrees.length - world.trees.length); }
// no survey "trees" on bridges or open water (London 2026-11-17): the surface model over a deck (10 m above the river)
// or a railway viaduct reads like canopy, so rows of trees stood along Westminster Bridge
if (OPT.city && world.lidarTrees?.length) {
  const G2 = 0.0003, gridB = new Map(), segsB = [];
  const addLine = (pts, half) => { for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k], n = segsB.push([a, b, half]) - 1; for (let gx = Math.floor(Math.min(a[1], b[1]) / G2) - 1; gx <= Math.floor(Math.max(a[1], b[1]) / G2) + 1; gx++) for (let gy = Math.floor(Math.min(a[0], b[0]) / G2) - 1; gy <= Math.floor(Math.max(a[0], b[0]) / G2) + 1; gy++) { const kk = gx + ',' + gy; if (!gridB.has(kk)) gridB.set(kk, []); gridB.get(kk).push(n); } } };
  for (const e of roads.edges) if (e.bridge) addLine(e.pts, 9);
  for (const a of world.land) if (a.t === 'rail' && a.bridge) addLine(a.pts, 7);
  const segD = (p, a, b) => { const kx = 111320 * Math.cos((p[0] * Math.PI) / 180), ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * 110540, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * 110540, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(ax + vx * t, ay + vy * t); };
  const water = world.land.filter((a) => a.t === 'water' && a.pts.length > 3).map((a) => { let s = 90, n = -90, w = 180, e = -180; for (const [la, lo] of a.pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); } return { P: a.pts, s, n, w, e }; });
  const pip = (pt, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [yi, xi] = P[i], [yj, xj] = P[j]; if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const n0 = world.lidarTrees.length;
  world.lidarTrees = world.lidarTrees.filter((t) => {
    const p = [t[0], t[1]];
    for (const i of gridB.get(Math.floor(p[1] / G2) + ',' + Math.floor(p[0] / G2)) || []) { const [a, b, half] = segsB[i]; if (segD(p, a, b) < half) return false; }
    for (const w of water) if (p[0] > w.s && p[0] < w.n && p[1] > w.w && p[1] < w.e && pip(p, w.P)) return false;
    return true;
  });
  log('survey trees on bridges / water dropped:', n0 - world.lidarTrees.length);
}
world.roads = roads;
// motorways and their slip roads (2026-11-21, the owner: "there's no motorway shown for the M5 or M42 (or slipways) when
// crossing over them"): drawn only, never part of the network (no riding on them); each carriageway as mapped, its own
// width by lanes; bridge pieces left out (drawn at the ground's height they'd sink into the road under them)
{ const mw = [], seen = new Set();
  for (const tb of TILES) { let j; try { j = await overpass(`[out:json][timeout:120];way["highway"~"^(motorway|motorway_link)$"](${tb});out geom qt;`); } catch (e) { log('motorways', e.message); continue; }
    for (const w of j.elements || []) { if (w.type !== 'way' || seen.has(w.id) || !w.geometry || w.tags?.tunnel && w.tags.tunnel !== 'no') continue; seen.add(w.id); const br = !!(w.tags?.bridge && w.tags.bridge !== 'no');
      const link = w.tags.highway === 'motorway_link', lanes = +w.tags.lanes || (link ? 1 : 3);
      let cur = []; const flush = () => { if (cur.length >= 2) mw.push({ pts: cur, w: +(lanes * 3.65 + (link ? 2.5 : 4.5)).toFixed(1), link: link || undefined, ref: w.tags.ref || '', bridge: br || undefined }); cur = []; }; // (bridge: a deck at the surveyed height, bheights.mjs dk)
      for (const g of w.geometry) { if (inBox(g.lat, g.lon)) cur.push([r6(g.lat), r6(g.lon)]); else flush(); } flush(); } }
  world.motorways = mw; log('motorway pieces', mw.length);
}
world.build = { name, box, mask: maskArg, start: startArg, ...(OPT.bridgeRuns ? { bridgeRuns: true } : {}) }; // (so the map editor can rebuild it: rebuild.mjs)

// ---------- a first loop for the route card: from the start, always the straightest way on, ~8 km ----------
const adj = new Map();
roads.edges.forEach((e, i) => { if (e.oneway !== -1) (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ i, rev: false }); if (e.oneway !== 1) (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ i, rev: true }); });
const start = startArg ? startArg.split(',').map(Number) : [(box.s + box.n) / 2, (box.w + box.e) / 2];
let j0 = 0, bd = Infinity;
roads.junctions.forEach((ll, i) => { const d = dist(ll, start); if (d < bd && adj.has(i)) { bd = d; j0 = i; } });
const walk = [], card = [];
let at = j0, prev = null, len = 0;
const bearing = (p, q) => Math.atan2((q[1] - p[1]) * Math.cos((p[0] * Math.PI) / 180), q[0] - p[0]);
while (len < 8000 && walk.length < 400) {
  const opts = (adj.get(at) || []).filter((o) => !prev || o.i !== prev.i);
  if (!opts.length) break;
  let pick = opts[0];
  if (prev) {
    const pe = roads.edges[prev.i].pts, inB = prev.rev ? bearing(pe[1], pe[0]) : bearing(pe.at(-2), pe.at(-1));
    let bestT = Infinity;
    for (const o of opts) { const p = roads.edges[o.i].pts, ob = o.rev ? bearing(p.at(-1), p.at(-2)) : bearing(p[0], p[1]); const tn = Math.abs(Math.atan2(Math.sin(ob - inB), Math.cos(ob - inB))); if (tn < bestT) { bestT = tn; pick = o; } }
  }
  const p = roads.edges[pick.i].pts, seq = pick.rev ? [...p].reverse() : p;
  for (const q of walk.length ? seq.slice(1) : seq) card.push(q);
  len += seq.slice(1).reduce((t, q, k) => t + dist(seq[k], q), 0);
  walk.push(pick); prev = pick; at = pick.rev ? roads.edges[pick.i].a : roads.edges[pick.i].b;
}
world.roads.start = j0;
const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RideWorld open world" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>\n${card.map(([la, lo, h]) => `<trkpt lat="${la}" lon="${lo}"><ele>${h}</ele></trkpt>`).join('\n')}\n</trkseg></trk></gpx>\n`;

// ---------- write ----------
const D = path.join(ROOT, 'data');
fs.writeFileSync(path.join(D, 'routes', id + '.gpx'), gpx, { mode: 0o600 });
const wf = path.join(D, 'world', id + '.json');
fs.writeFileSync(wf + '.tmp', JSON.stringify(world), { mode: 0o600 }); fs.renameSync(wf + '.tmp', wf); // after the GPX: newer, so lib/world.js keeps it
const require = createRequire(import.meta.url);
const routes = require(path.join(ROOT, 'lib', 'routes.js'));
log('written', wf, (fs.statSync(wf).size / 1e6).toFixed(1), 'MB; card loop', (len / 1000).toFixed(1), 'km');
console.log(JSON.stringify({ id, gpx: path.join(D, 'routes', id + '.gpx'), exports: Object.keys(routes) }));
