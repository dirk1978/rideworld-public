// Street details for an open world (2026-11-16, the owner: "traffic lights for me in the right places", "also road
// crossings and maybe some subcategories of shops, pubs, restaurants"). From OpenStreetMap, inside the world's box (in
// ~4 km tiles, answers cached in data/cache/overpass like build.mjs), written into data/world/<id>.json:
//   signals:   [[lat, lon, kind]]  highway=traffic_signals ('j') or crossing=traffic_signals / crossing:signals=yes ('x')
//   crossings: [[lat, lon, type]]  highway=crossing: 'zebra' (Belisha beacons), 'signals' (pelican / puffin / toucan
//                                  studs), 'marked'
//   shops:     [[lat, lon, name, cat]] named shops, pubs, cafés, restaurants, takeaways, banks, chemists... (cat = the
//                                  shop= or amenity= value), for their signs (world.js)
// Signals and crossings only within 15 m of one of the world's roads. world.js draws them.
//   node tools/openworld/extras.mjs <id>
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const id = process.argv[2];
if (!id) { console.error('usage: extras.mjs <world id>'); process.exit(1); }
const wf = path.join(ROOT, 'data', 'world', id + '.json');
const W = JSON.parse(fs.readFileSync(wf, 'utf8'));
const box = W.roads.box;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OCACHE = path.join(ROOT, 'data', 'cache', 'overpass');
async function overpass(q) {
  if (process.env.OW_OSM) return (await import('./localosm.mjs')).query(q, process.env.OW_OSM); // (a local extract instead of the API)
  const cf = path.join(OCACHE, crypto.createHash('sha1').update(q).digest('hex') + '.json');
  try { if (Date.now() - fs.statSync(cf).mtimeMs < 86400000) return JSON.parse(fs.readFileSync(cf, 'utf8')); } catch {}
  let last;
  for (let round = 0; round < 8; round++) {
    for (const s of SERVERS) {
      try {
        const r = await fetch(s, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RideWorld/1.0 (personal indoor cycling app; world builder)' }, signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error(`${s} ${r.status}`);
        const j = await r.json();
        if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 100));
        fs.mkdirSync(OCACHE, { recursive: true, mode: 0o700 }); fs.writeFileSync(cf, JSON.stringify(j), { mode: 0o600 });
        return j;
      } catch (e) { last = e; log('overpass', e.message); }
    }
    await new Promise((ok) => setTimeout(ok, 30000));
  }
  throw last;
}
const tiles = [];
{ const ni = Math.ceil((box.n - box.s) / 0.036), nj = Math.ceil((box.e - box.w) / 0.06); for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) tiles.push([box.s + ((box.n - box.s) * i) / ni, box.w + ((box.e - box.w) * j) / nj, box.s + ((box.n - box.s) * (i + 1)) / ni, box.w + ((box.e - box.w) * (j + 1)) / nj].map((v) => v.toFixed(5)).join(',')); }
const nodes = new Map();
for (const t of tiles) {
  const j = await overpass(`[out:json][timeout:90];(node["highway"="traffic_signals"](${t});node["crossing"="traffic_signals"](${t});node["crossing:signals"="yes"](${t}););out body qt;`);
  for (const e of j.elements) nodes.set(e.id, e);
  log('tile', t, j.elements.length);
}
// near one of the world's roads (the mask: no roads, no lights)
const kx = 111320 * Math.cos((((box.s + box.n) / 2) * Math.PI) / 180), ky = 110540, grid = new Map();
for (const e of W.roads.edges) for (const p of e.pts) { const k = Math.floor(p[0] * ky / 20) + ',' + Math.floor(p[1] * kx / 20); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
const near = (lat, lon) => { const gy = Math.floor(lat * ky / 20), gx = Math.floor(lon * kx / 20); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of grid.get((gy + a) + ',' + (gx + b)) || []) if (Math.hypot((p[0] - lat) * ky, (p[1] - lon) * kx) < 15) return true; return false; };
W.signals = [...nodes.values()].filter((n) => near(n.lat, n.lon)).map((n) => [+n.lat.toFixed(6), +n.lon.toFixed(6), n.tags?.highway === 'traffic_signals' ? 'j' : 'x']);
// crossings
const cross = new Map();
for (const t of tiles) { const j = await overpass(`[out:json][timeout:90];node["highway"="crossing"](${t});out body qt;`); for (const e of j.elements) cross.set(e.id, e); log('crossings tile', t, j.elements.length); }
const ctype = (t) => { const c = t.crossing || '', r = t.crossing_ref || ''; if (r === 'zebra' || c === 'zebra') return 'zebra'; if (/^(pelican|puffin|toucan|pegasus)$/.test(r) || c === 'traffic_signals' || t['crossing:signals'] === 'yes') return 'signals'; if (c === 'marked' || t['crossing:markings'] && t['crossing:markings'] !== 'no') return 'marked'; return null; };
W.crossings = [...cross.values()].map((n) => [n, ctype(n.tags || {})]).filter(([n, ty]) => ty && near(n.lat, n.lon)).map(([n, ty]) => [+n.lat.toFixed(6), +n.lon.toFixed(6), ty]);
// named shops, pubs, restaurants... (nodes, and buildings / areas by their centre)
const shops = new Map();
const AM = 'pub|bar|cafe|restaurant|fast_food|bank|pharmacy|post_office|ice_cream|bureau_de_change|dentist|doctors|veterinary|library';
for (const t of tiles) {
  const j = await overpass(`[out:json][timeout:90];(node["shop"]["name"](${t});way["shop"]["name"](${t});node["amenity"~"^(${AM})$"]["name"](${t});way["amenity"~"^(${AM})$"]["name"](${t}););out center tags qt;`);
  for (const e of j.elements) { const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon; if (lat == null) continue; const tg = e.tags || {}; shops.set(e.type + e.id, [+lat.toFixed(6), +lon.toFixed(6), String(tg.name).slice(0, 40), tg.amenity && new RegExp(`^(${AM})$`).test(tg.amenity) ? tg.amenity : tg.shop]); }
  log('shops tile', t, j.elements.length);
}
W.shops = [...shops.values()].filter(([la, lo]) => la >= box.s && la <= box.n && lo >= box.w && lo <= box.e);
// the map editor's shops and pubs (data/world/<id or --edits id>.edits.json `shops`): added, replacing any OSM one within 8 m
{
  const eid = process.argv.includes('--edits') ? process.argv[process.argv.indexOf('--edits') + 1] : id;
  let E = null; for (const f of [path.join(ROOT, 'data', 'world', eid + '.edits.json'), path.join(ROOT, 'tools', 'openworld', 'edits', eid + '.json')]) { try { E = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch {} }
  for (const s of E?.shops || []) { W.shops = W.shops.filter(([la, lo]) => Math.hypot((la - s.at[0]) * ky, (lo - s.at[1]) * kx) > 8); W.shops.push([s.at[0], s.at[1], String(s.name).slice(0, 40), s.cat || 'shop']); }
  if (E?.shops?.length) log('edits: shops', E.shops.length);
}
// fords (2026-11-25, the owner at Coughton Ford: "the water should cover the road and allow the bike to go into the water a
// bit"): OSM ford ways (the stretch as mapped) and ford nodes on a road (8 m of that road either side), with the road's own
// heights; world.js lays water over the dip
{ const fm = new Map();
  for (const t of tiles) { const j = await overpass(`[out:json][timeout:90];(node["ford"="yes"](${t});way["ford"="yes"]["highway"](${t}););out geom qt;`); for (const e of j.elements) fm.set(e.type + e.id, e); }
  const KX = (la) => 111320 * Math.cos((la * Math.PI) / 180), dd = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * KX(a[0]));
  const nearestRoad = (la, lo) => { let best = null; W.roads.edges.forEach((e, i) => e.pts.forEach((q, k) => { const d = dd(q, [la, lo]); if (!best || d < best.d) best = { d, i, k }; })); return best; };
  W.fords = [];
  for (const e of fm.values()) {
    let pts;
    if (e.type === 'way') pts = (e.geometry || []).map((g) => [g.lat, g.lon]);
    else { const r = nearestRoad(e.lat, e.lon); if (!r || r.d > 12) continue; const P = W.roads.edges[r.i].pts; pts = []; let a = 0; for (let k = r.k; k >= 0 && a <= 8; k--) { pts.unshift(P[k]); if (k) a += dd(P[k], P[k - 1]); } a = 0; for (let k = r.k + 1; k < P.length && a <= 8; k++) { a += dd(P[k], P[k - 1]); pts.push(P[k]); } }
    if (!pts || pts.length < 2 || !near(pts[0][0], pts[0][1])) continue;
    // each point's height: the nearest road point's (the ridden road's own heights)
    const H = pts.map(([la, lo]) => { const r = nearestRoad(la, lo); return r && r.d < 15 ? W.roads.edges[r.i].pts[r.k][2] : null; });
    if (H.some((h) => h == null)) continue;
    W.fords.push({ pts: pts.map(([la, lo], k) => [+la.toFixed(6), +lo.toFixed(6), +H[k].toFixed(2)]), name: e.tags?.name || '' });
  }
  log('fords:', W.fords.length);
}
fs.writeFileSync(wf + '.tmp', JSON.stringify(W), { mode: 0o600 }); fs.renameSync(wf + '.tmp', wf);
log('signals:', W.signals.length, 'crossings:', W.crossings.length, 'shops:', W.shops.length, '; written', wf);
