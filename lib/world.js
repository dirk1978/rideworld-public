// The generated world's map data (2026-11-14, the owner: most routes look awful in Google's 3D; "let's go" on a world
// generated from OpenStreetMap on top of Lite scenery). For a route: buildings, woods, single trees and tree rows,
// hedges / walls / fences within ~150 m of the road, from Overpass, cached as data/world/<route id>.json and remade
// when the route's GPX is newer than the cache. The browser builds the 3D from it (public/js/app/world.js).
// Generic client name in the User-Agent: no personal contact details are sent.
const fs = require('fs');
const path = require('path');
const https = require('https');
function gpxPoints(gpx) {
  const out = [];
  for (const m of gpx.matchAll(/<(?:trkpt|rtept)\b[^>]*>/g)) {
    const lat = +(/lat="([-\d.]+)"/.exec(m[0]) || [])[1], lon = +(/lon="([-\d.]+)"/.exec(m[0]) || [])[1];
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
  }
  return out;
}

const DIR = path.join(__dirname, '..', 'data', 'world');
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const RADIUS = 150, R_BARRIER = 60;
const busy = new Map(); // route id -> promise

function post(url, query) {
  return new Promise((resolve, reject) => {
    const body = 'data=' + encodeURIComponent(query);
    const req = https.request(url, { method: 'POST', timeout: 120000, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'RideWorld/1.0 (personal indoor cycling app; world builder)' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`Overpass ${res.statusCode}`));
        try {
          const j = JSON.parse(text);
          if (j.remark && /error|timed out|out of memory/i.test(j.remark)) return reject(new Error('Overpass: ' + j.remark.slice(0, 120)));
          resolve(j);
        } catch { reject(new Error('Overpass: not JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Overpass timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
// An overloaded server can answer 200 with nothing at all (no remark): an empty answer is only believed when every
// server agrees; failures (busy, timeouts) get two more rounds after a pause (2026-11-14: Brighton, Paris, Flanders and
// the Isle of Wight came back empty on the first run, four others timed out)
async function overpass(query) {
  let last, empty = null;
  for (let round = 0; round < 3; round++) {
    for (const s of SERVERS) {
      try { const j = await post(s, query); if ((j.elements || []).length) return j; empty = j; } catch (e) { last = e; }
    }
    if (empty) return empty;
    await new Promise((ok) => setTimeout(ok, 30000));
  }
  throw last;
}

// route points every ~step metres (Overpass `around` follows the polyline through them)
function thin(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    acc += Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
    if (acc >= step) { out.push(b); acc = 0; }
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const ring = (geom) => (geom || []).map((g) => [r6(g.lat), r6(g.lon)]);
const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

async function build(gpx) {
  const pts = thin(gpxPoints(gpx), 60);
  if (pts.length < 2) throw new Error('no route points');
  const out = { v: 1, at: new Date().toISOString(), buildings: [], woods: [], trees: [], rows: [], barriers: [] };
  const seen = new Set();
  // long routes: the polyline in pieces of ~120 points (~7 km), overlapping by one
  for (let k = 0; k < pts.length - 1; k += 119) {
    const piece = pts.slice(k, k + 120), line = piece.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
    const A = (r) => `(around:${r},${line})`;
    const q = `[out:json][timeout:110];(
      way["building"]${A(RADIUS)};
      way["barrier"~"^(hedge|wall|fence|retaining_wall|city_wall)$"]${A(R_BARRIER)};
      way["natural"~"^(wood|scrub|tree_row)$"]${A(RADIUS)};
      way["landuse"~"^(forest|orchard)$"]${A(RADIUS)};
      relation["natural"="wood"]${A(RADIUS)};
      relation["landuse"="forest"]${A(RADIUS)};
      node["natural"="tree"]${A(RADIUS)};
    );out geom qt;`;
    const j = await overpass(q);
    for (const e of j.elements || []) {
      const key = e.type + e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = e.tags || {};
      if (e.type === 'node') { out.trees.push([r6(e.lat), r6(e.lon)]); continue; }
      if (e.type === 'relation') { // multipolygon woods: outer rings
        for (const m of e.members || []) if (m.role === 'outer' && m.geometry?.length > 3) out.woods.push({ t: 'wood', leaf: t.leaf_type || null, pts: ring(m.geometry) });
        continue;
      }
      const g = ring(e.geometry);
      if (g.length < 2) continue;
      if (t.building) {
        if (g.length < 4) continue;
        const lv = num(t['building:levels']), h = num(t.height);
        out.buildings.push({ k: t.building, h: h || (lv ? lv * 3 + 1.5 : null), roof: t['roof:shape'] || null, pts: g });
      } else if (t.barrier) out.barriers.push({ t: t.barrier === 'hedge' ? 'hedge' : t.barrier === 'fence' ? 'fence' : 'wall', pts: g });
      else if (t.natural === 'tree_row') out.rows.push(g);
      else if (g.length > 3) out.woods.push({ t: t.natural === 'scrub' ? 'scrub' : t.landuse === 'orchard' ? 'orchard' : 'wood', leaf: t.leaf_type || null, pts: g });
    }
  }
  // England: every tree from the Environment Agency's LIDAR (tools/routes/canopy.mjs), which maps the ones OSM doesn't
  // (CCCP's lanes are lined with trees that OSM barely has). The browser then uses these instead of filling OSM's woods.
  const all = gpxPoints(gpx);
  if (all.length && all.every((p) => p.lat > 49.8 && p.lat < 55.9 && p.lon > -6.5 && p.lon < 1.9) && !process.env.WORLD_NO_LIDAR) {
    try {
      process.env.LIDAR_CACHE ||= path.join(__dirname, '..', 'data', 'cache', 'lidar');
      fs.mkdirSync(process.env.LIDAR_CACHE, { recursive: true, mode: 0o700 });
      const { canopyTrees } = await import(path.join(__dirname, '..', 'tools', 'routes', 'canopy.mjs'));
      out.lidarTrees = await canopyTrees(thin(all, 20), out.buildings.map((b) => b.pts));
      // hedgerows from the same tiles (cached by now): tools/routes/hedges.mjs, drawn instead of OSM's hedges
      const { hedgeRuns } = await import(path.join(__dirname, '..', 'tools', 'routes', 'hedges.mjs'));
      out.lidarHedges = await hedgeRuns(thin(all, 20), out.buildings.map((b) => b.pts));
    } catch (e) { console.error('world canopy', e.message); }
  } else if (all.length && !process.env.WORLD_NO_LIDAR) {
    // elsewhere: Meta's global canopy height map (tools/routes/metachm.mjs), added to OSM's trees by the browser
    try {
      process.env.META_CACHE ||= path.join(__dirname, '..', 'data', 'cache', 'meta');
      fs.mkdirSync(process.env.META_CACHE, { recursive: true, mode: 0o700 });
      const { metaTrees } = await import(path.join(__dirname, '..', 'tools', 'routes', 'metachm.mjs'));
      out.lidarTrees = await metaTrees(thin(all, 20), out.buildings.map((b) => b.pts));
      out.lidarSource = 'meta';
    } catch (e) { console.error('world meta canopy', e.message); }
  }
  return out;
}

// the cached world for a route (made if missing or older than its GPX); { pending: true } while it's being made
function get(id, gpxFile) {
  const f = path.join(DIR, id + '.json');
  let fresh = false;
  try { fresh = fs.statSync(f).mtimeMs >= fs.statSync(gpxFile).mtimeMs; } catch {}
  if (fresh) return { file: f };
  if (!busy.has(id)) {
    busy.set(id, (async () => {
      try {
        const w = await build(fs.readFileSync(gpxFile, 'utf8'));
        fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
        fs.writeFileSync(f + '.tmp', JSON.stringify(w), { mode: 0o600 });
        fs.renameSync(f + '.tmp', f);
        console.log(`world ${id}: ${w.lidarTrees ? w.lidarTrees.length + ' LIDAR trees, ' : ''}${w.buildings.length} buildings, ${w.woods.length} woods, ${w.trees.length} trees, ${w.rows.length} tree rows, ${w.barriers.length} hedges/walls`);
      } catch (e) {
        console.error('world', id, e.message);
        lastError.set(id, { msg: e.message, at: Date.now() });
      } finally { busy.delete(id); }
    })());
  }
  const err = lastError.get(id);
  return { pending: true, error: err && Date.now() - err.at < 60000 ? err.msg : null };
}
const lastError = new Map();

module.exports = { get, build };
