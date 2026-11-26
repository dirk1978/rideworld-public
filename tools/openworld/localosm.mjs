// Answer the world builders' Overpass queries from a local OSM extract instead of the Overpass API (2026-11-17: Overpass
// was "at capacity, request queue full" for hours while building London). Set OW_OSM=<file.opl> for build.mjs /
// extras.mjs. Make the file from a Geofabrik extract (download.geofabrik.de) with osmium-tool:
//   osmium extract -b W,S,E,N --strategy smart -O -o box.osm.pbf region-latest.osm.pbf
//   osmium add-locations-to-ways -O -f opl,locations_on_ways=true -o box.opl box.osm.pbf
// Understands the subset the builders use: [out:json] settings; statements node|way|relation with tag filters
// ["k"] ["k"="v"] ["k"!="v"] ["k"~"re"] ["k"!~"re"] and a (s,w,n,e) box, alone or in a ( ...; ); union; outputs
// `out body;>;out skel qt;`, `out body qt;`, `out geom qt;`, `out center tags qt;`. A way is in the box if any of its
// points is; a relation if any member way's point or member node is.
import fs from 'fs';

let DB = null, DBFILE = null;
const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function tagsOf(field) {
  if (!field) return undefined;
  const t = {};
  for (const kv of field.split(',')) { const i = kv.indexOf('='); if (i > 0) t[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1)); }
  return t;
}
function load(file) {
  if (DB && DBFILE === file) return DB;
  const nodes = [], ways = [], rels = [], wayById = new Map(), nodeById = new Map();
  const text = fs.readFileSync(file, 'utf8');
  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos); if (end < 0) end = text.length;
    const line = text.slice(pos, end); pos = end + 1;
    if (!line) continue;
    const kind = line[0], parts = line.split(' '), id = +parts[0].slice(1);
    let T = null, X = null, Y = null, N = null, M = null;
    for (const p of parts) { const c = p[0]; if (c === 'T') T = p.slice(1); else if (c === 'x') X = p.slice(1); else if (c === 'y') Y = p.slice(1); else if (c === 'N') N = p.slice(1); else if (c === 'M') M = p.slice(1); }
    if (kind === 'n') {
      if (!T || !X) continue; // (untagged nodes: their positions travel inside the ways)
      const n = { id, lat: +Y, lon: +X, tags: tagsOf(T) }; nodes.push(n); nodeById.set(id, n);
    } else if (kind === 'w') {
      const ids = [], geom = [];
      if (N) for (const s of N.split(',')) { const xi = s.indexOf('x'), yi = s.indexOf('y'); ids.push(+s.slice(1, xi)); geom.push([+s.slice(yi + 1), +s.slice(xi + 1, yi)]); }
      if (geom.some((g) => !Number.isFinite(g[0]))) continue;
      const w = { id, tags: tagsOf(T), ids, geom }; ways.push(w); wayById.set(id, w);
    } else if (kind === 'r') {
      const members = [];
      if (M) for (const s of M.split(',')) { const at = s.indexOf('@'); members.push({ type: s[0] === 'n' ? 'node' : s[0] === 'w' ? 'way' : 'relation', ref: +s.slice(1, at), role: unesc(s.slice(at + 1)) }); }
      rels.push({ id, tags: tagsOf(T), members });
    }
  }
  DB = { nodes, ways, rels, wayById, nodeById }; DBFILE = file;
  return DB;
}

function filterFn(fs_) {
  const tests = [];
  for (const m of fs_.matchAll(/\["([^"]+)"(?:(=|!=|~|!~)"([^"]*)")?\]/g)) {
    const [, k, op, v] = m;
    if (!op) tests.push((t) => t && k in t);
    else if (op === '=') tests.push((t) => t && t[k] === v);
    else if (op === '!=') tests.push((t) => !t || t[k] !== v);
    else { const re = new RegExp(v); tests.push(op === '~' ? (t) => t && k in t && re.test(t[k]) : (t) => !t || !(k in t) || !re.test(t[k])); }
  }
  return (t) => tests.every((f) => f(t));
}
const inB = (b, lat, lon) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];

export function query(q, file) {
  const db = load(file);
  const body = q.replace(/^\s*(\[[^\]]*\])+\s*;/, '');
  const outAt = body.search(/\bout\b/), stmts = body.slice(0, outAt), out = body.slice(outAt);
  const found = { node: new Map(), way: new Map(), relation: new Map() };
  for (const m of stmts.matchAll(/(node|way|relation)((?:\[[^\]]*\])*)\(([^)]*)\)/g)) {
    const [, type, filt, bb] = m, b = bb.split(',').map(Number), ok = filterFn(filt);
    if (type === 'node') { for (const n of db.nodes) if (ok(n.tags) && inB(b, n.lat, n.lon)) found.node.set(n.id, n); }
    else if (type === 'way') { for (const w of db.ways) if (ok(w.tags) && w.geom.some((g) => inB(b, g[0], g[1]))) found.way.set(w.id, w); }
    else for (const r of db.rels) {
      if (!ok(r.tags)) continue;
      const hit = r.members.some((mm) => mm.type === 'way' ? db.wayById.get(mm.ref)?.geom.some((g) => inB(b, g[0], g[1])) : mm.type === 'node' ? (() => { const n = db.nodeById.get(mm.ref); return n && inB(b, n.lat, n.lon); })() : false);
      if (hit) found.relation.set(r.id, r);
    }
  }
  const elements = [];
  const geomOf = (w) => w.geom.map(([lat, lon]) => ({ lat, lon }));
  const bounds = (w) => { let s = 90, n = -90, we = 180, e = -180; for (const [la, lo] of w.geom) { s = Math.min(s, la); n = Math.max(n, la); we = Math.min(we, lo); e = Math.max(e, lo); } return { minlat: s, minlon: we, maxlat: n, maxlon: e }; };
  if (/out\s+geom/.test(out)) {
    for (const n of found.node.values()) elements.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon, tags: n.tags });
    for (const w of found.way.values()) elements.push({ type: 'way', id: w.id, bounds: bounds(w), nodes: w.ids, geometry: geomOf(w), tags: w.tags });
    for (const r of found.relation.values()) elements.push({ type: 'relation', id: r.id, members: r.members.map((mm) => { const w = mm.type === 'way' ? db.wayById.get(mm.ref) : null; const n = mm.type === 'node' ? db.nodeById.get(mm.ref) : null; return { ...mm, ...(w ? { geometry: geomOf(w) } : {}), ...(n ? { lat: n.lat, lon: n.lon } : {}) }; }), tags: r.tags });
  } else if (/out\s+center/.test(out)) {
    for (const n of found.node.values()) elements.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon, tags: n.tags });
    for (const w of found.way.values()) { const b = bounds(w); elements.push({ type: 'way', id: w.id, center: { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 }, tags: w.tags }); }
    for (const r of found.relation.values()) elements.push({ type: 'relation', id: r.id, tags: r.tags });
  } else {
    for (const n of found.node.values()) elements.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon, tags: n.tags });
    for (const w of found.way.values()) elements.push({ type: 'way', id: w.id, nodes: w.ids, tags: w.tags });
    for (const r of found.relation.values()) elements.push({ type: 'relation', id: r.id, members: r.members, tags: r.tags });
    if (/>\s*;/.test(out)) { // (the ways' nodes, positions only)
      const seen = new Set(found.node.keys());
      for (const w of found.way.values()) w.ids.forEach((id, k) => { if (!seen.has(id)) { seen.add(id); elements.push({ type: 'node', id, lat: w.geom[k][0], lon: w.geom[k][1] }); } });
    }
  }
  return { version: 0.6, generator: 'RideWorld localosm', elements };
}
