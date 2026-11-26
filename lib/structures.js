// Route analyser: where a route passes UNDER something (a bridge, a covered way) or THROUGH a tunnel, from
// OpenStreetMap (Overpass API). The ride's road survey needs it: Google's 3D model of a mountainside is a smoothed
// slope that can bulge 5-12 m above the real road at hairpins (Sa Calobra), which the survey used to mistake for a
// bridge overhead and ignore, burying the rider. With this list the survey only looks for something overhead where
// there really is something, and follows the 3D everywhere else.
// Result, kept with the route: { at, list: [{ type: 'under' | 'tunnel' | 'cobbles' | 'bridge', km, kmEnd?, lat, lon, latEnd?, lonEnd?, name? }] }
// ('bridge': the route rides ALONG a bridge; the route pipeline carries the road's height across it, because survey
// terrain models have bridges taken out: the George Washington Bridge read as the river, -0.6 m)
// km = distance along the GPX as uploaded; lat/lon pin it down (the ride maps it onto its cleaned route).
const https = require('https');

// the main Overpass server, then a mirror (the public ones are busy at times)
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const ON = 7;        // a bridge within this many metres of the route, running alongside it, is one the route is on
const IN = 4;        // a tunnel within this many metres, along most of its length, is one the route goes through
const IN_GAP = 10;   // ...or this many along a long gap between the file's points (over 50 m): GPS gives up in a tunnel
                     // (the owner's Formentor recording jumps 207 m straight through it). Not 10 m everywhere: that put
                     // Brighton and Barca "in" tunnels under the streets they ride along
// tunnels a ride can go through: roads and cycleways (not footways, building passages, railways, streams)
const ROADS = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|cycleway|track)(_link)?$/;
const PAD = 0.002;
const COBBLES = /^(sett|cobblestone|unhewn_cobblestone|cobblestone:flattened)$/;   // degrees around the route's box to search

// GPX text -> [{ lat, lon }]
function gpxPoints(gpx) {
  const out = [];
  for (const m of gpx.matchAll(/<(?:trkpt|rtept)\b[^>]*>/g)) {
    const lat = +(/lat="([-\d.]+)"/.exec(m[0]) || [])[1], lon = +(/lon="([-\d.]+)"/.exec(m[0]) || [])[1];
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
  }
  return out;
}

async function overpass(query) {
  let last, empty = null;
  for (const url of SERVERS) {
    try {
      const j = await overpassAt(url, query);
      // an empty answer is believed only if no other server has anything: Cap's analysis on 2026-10-19 came back
      // empty with no remark, missing the Formentor tunnel (the road was then drawn on a wall at 1.11 mi)
      if ((j.elements || []).length) return j;
      empty = j;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 3000)); }
  }
  if (empty) return empty;
  throw last;
}
function overpassAt(url, query) {
  const body = 'data=' + encodeURIComponent(query);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', timeout: 90000, headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'RideWorld route analyser (https://rideworld.example.org)' } }, (res) => {
      let out = '';
      res.on('data', (d) => (out += d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`OpenStreetMap lookup failed (${res.statusCode})`));
        let j;
        try { j = JSON.parse(out); } catch { return reject(new Error('OpenStreetMap sent something unreadable')); }
        // an overloaded server answers 200 with no elements and a remark ("runtime error: Query timed out ..."):
        // that's a failure, not "no bridges or tunnels" (Cap2's Formentor tunnel was missed that way, 2026-10-19)
        if (j.remark && /error|timed out|timeout|out of memory|abort/i.test(j.remark)) return reject(new Error('OpenStreetMap was too busy: ' + String(j.remark).slice(0, 80)));
        resolve(j);
      });
    });
    req.on('timeout', () => req.destroy(new Error('OpenStreetMap lookup timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// flat metres around a reference latitude (fine over a route's few km)
function projector(lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return (p) => [p.lon * kx, p.lat * ky];
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
}
function intersect([ax, ay], [bx, by], [cx, cy], [dx, dy]) {
  const r = [bx - ax, by - ay], s = [dx - cx, dy - cy], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s[1] - (cy - ay) * s[0]) / den, u = ((cx - ax) * r[1] - (cy - ay) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

async function analyse(gpx) {
  const pts = gpxPoints(gpx);
  if (pts.length < 2) throw new Error('No track in the route');
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  const bbox = [Math.min(...lats) - PAD, Math.min(...lons) - PAD, Math.max(...lats) + PAD, Math.max(...lons) + PAD].join(',');
  // bridges and covered ways (things that can be over the route) and tunnels (the route can be in one); not
  // culverts or footway tunnels under the road
  // ...and cobbled roads (sett / cobblestone surfaces), so the clean road can be drawn as cobbles there (the owner
  // 2026-10-21: the Koppenberg, Paterberg and Oude Kwaremont are all tagged sett in OSM)
  const q = `[out:json][timeout:60];(way["bridge"](${bbox});way["tunnel"](${bbox});way["covered"="yes"](${bbox});way["highway"]["surface"~"^(sett|cobblestone|unhewn_cobblestone|cobblestone:flattened)$"](${bbox}););out geom tags;`;
  const osm = await overpass(q);
  const P = projector(pts[0].lat), xy = pts.map(P);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const at = (i, t) => cum[i] + (cum[i + 1] - cum[i]) * t;
  const ptAt = (i, t) => ({ lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lon: pts[i].lon + (pts[i + 1].lon - pts[i].lon) * t });
  const list = [], cobbleWays = [];

  for (const way of osm.elements || []) {
    const g = (way.geometry || []).filter(Boolean);
    if (g.length < 2) continue;
    const tags = way.tags || {}, wxy = g.map(P);
    if (COBBLES.test(tags.surface || '') && !tags.bridge && !tags.tunnel) { cobbleWays.push(wxy); continue; }
    if (tags.bridge === 'no' || tags.tunnel === 'no') continue;
    const isTunnel = !!tags.tunnel && !tags.bridge;
    if (isTunnel && (tags.tunnel !== 'yes' || !ROADS.test(tags.highway || ''))) continue; // not one we could ride through
    if (!isTunnel && !tags.bridge && !(tags.covered === 'yes' && +(tags.layer || 0) >= 1)) continue; // covered at ground level
    // stretches of the route that run along this way (the route is ON it: on a bridge, in a tunnel)
    const onAt = []; // route point indices close to the way
    const near = isTunnel ? IN : ON;
    for (let i = 0; i < xy.length; i++) {
      let best = Infinity;
      for (let k = 0; k < wxy.length - 1; k++) best = Math.min(best, segDist(xy[i], wxy[k], wxy[k + 1]).d);
      if (best < near) onAt.push(i);
    }
    const runs = [];
    for (const i of onAt) { const r = runs[runs.length - 1]; if (r && i - r[1] <= 2) r[1] = i; else runs.push([i, i]); }
    // really along it, not just crossing: longer than 8 m AND running roughly parallel to the way (within ~32 deg).
    // Without the direction test, a dense file (points every 2 m) crossing under a footbridge stays within ON metres
    // of it for ~14 m and counted as riding ON it, so the bridge was dropped (the owner's Barca, 2026-10-18).
    const parallel = ([a, b]) => {
      const rx = xy[b][0] - xy[a][0], ry = xy[b][1] - xy[a][1], rl = Math.hypot(rx, ry);
      if (rl < 1) return true;
      const m = xy[(a + b) >> 1];
      let best = null;
      for (let k = 0; k < wxy.length - 1; k++) { const d = segDist(m, wxy[k], wxy[k + 1]).d; if (!best || d < best.d) best = { d, k }; }
      const wx = wxy[best.k + 1][0] - wxy[best.k][0], wy = wxy[best.k + 1][1] - wxy[best.k][1], wl = Math.hypot(wx, wy) || 1;
      return Math.abs((rx * wx + ry * wy) / (rl * wl)) > 0.85;
    };
    const onRuns = runs.filter(([a, b]) => cum[b] - cum[a] > 8 && (isTunnel || parallel([a, b])));
    if (isTunnel) {
      // through it only if we run along most of it (not a footpath tunnel beside or under the road). Checked every
      // 5 m along the route, not just at its points: a recording has few or none inside a tunnel
      let wayLen = 0;
      for (let k = 1; k < wxy.length; k++) wayLen += Math.hypot(wxy[k][0] - wxy[k - 1][0], wxy[k][1] - wxy[k - 1][1]);
      const inside = [];
      for (let i = 0; i < xy.length - 1; i++) {
        const n = Math.max(1, Math.ceil((cum[i + 1] - cum[i]) / 5)), tol = cum[i + 1] - cum[i] > 50 ? IN_GAP : IN;
        for (let j = 0; j < n; j++) {
          const t = j / n, q = [xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t];
          let best = Infinity;
          for (let k = 0; k < wxy.length - 1; k++) best = Math.min(best, segDist(q, wxy[k], wxy[k + 1]).d);
          const r = inside[inside.length - 1], d = at(i, t);
          if (best >= tol) continue;
          if (r && d - r.b.d <= 12) r.b = { d, i, t }; else inside.push({ a: { d, i, t }, b: { d, i, t } });
        }
      }
      for (const { a, b } of inside) if (b.d - a.d >= 0.6 * wayLen) {
        const pa = ptAt(a.i, a.t), pb = ptAt(b.i, b.t);
        list.push({ type: 'tunnel', km: +(a.d / 1000).toFixed(4), kmEnd: +(b.d / 1000).toFixed(4),
          lat: pa.lat, lon: pa.lon, latEnd: pb.lat, lonEnd: pb.lon, name: tags.name || undefined });
      }
      continue;
    }
    // bridges the route rides along (roads, cycleways, paths): every 5 m along the route, within ON metres of the way
    // and running parallel to it; runs merged across 12 m gaps, kept from 15 m long
    if (tags.bridge && /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|cycleway|track|path|footway|bridleway|pedestrian)(_link)?$/.test(tags.highway || '')) {
      const runs2 = [];
      for (let i = 0; i < xy.length - 1; i++) {
        const sl = cum[i + 1] - cum[i];
        if (sl < 0.01) continue;
        const rx = (xy[i + 1][0] - xy[i][0]) / sl, ry = (xy[i + 1][1] - xy[i][1]) / sl, n = Math.max(1, Math.ceil(sl / 5));
        for (let j = 0; j < n; j++) {
          const t = j / n, q = [xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t];
          let best = null;
          for (let k = 0; k < wxy.length - 1; k++) { const d = segDist(q, wxy[k], wxy[k + 1]).d; if (!best || d < best.d) best = { d, k }; }
          if (best.d >= ON) continue;
          const wx = wxy[best.k + 1][0] - wxy[best.k][0], wy = wxy[best.k + 1][1] - wxy[best.k][1], wl = Math.hypot(wx, wy) || 1;
          if (Math.abs((rx * wx + ry * wy) / wl) < 0.85) continue;
          const d = at(i, t), r = runs2[runs2.length - 1];
          if (r && d - r.b.d <= 12) r.b = { d, i, t }; else runs2.push({ a: { d, i, t }, b: { d, i, t } });
        }
      }
      for (const { a, b } of runs2) if (b.d - a.d >= 15) {
        const pa = ptAt(a.i, a.t), pb = ptAt(b.i, b.t);
        list.push({ type: 'bridge', km: +(a.d / 1000).toFixed(4), kmEnd: +(b.d / 1000).toFixed(4), lat: pa.lat, lon: pa.lon, latEnd: pb.lat, lonEnd: pb.lon, name: tags.name || undefined });
      }
    }
    // bridges / covered ways: where the route crosses under them (not where it's riding on them)
    for (let i = 0; i < xy.length - 1; i++) {
      for (let k = 0; k < wxy.length - 1; k++) {
        const t = intersect(xy[i], xy[i + 1], wxy[k], wxy[k + 1]);
        if (t === null) continue;
        const d = at(i, t);
        if (onRuns.some(([a, b]) => d >= cum[a] - 10 && d <= cum[b] + 10)) continue; // that's us on the bridge
        // ...or riding along it where it's split into pieces: a bridge overhead crosses the route at an angle, a piece
        // of the way we're on meets it end to end, running the same way (the GWB's North Walk, ~60 short pieces, read
        // as 60 bridges overhead, 2026-10-27)
        const rx = xy[i + 1][0] - xy[i][0], ry = xy[i + 1][1] - xy[i][1], wx = wxy[k + 1][0] - wxy[k][0], wy = wxy[k + 1][1] - wxy[k][1];
        if (Math.abs(rx * wx + ry * wy) / ((Math.hypot(rx, ry) * Math.hypot(wx, wy)) || 1) > 0.9) continue;
        const p = ptAt(i, t);
        list.push({ type: 'under', km: +(d / 1000).toFixed(4), lat: p.lat, lon: p.lon, name: tags.name || undefined,
          what: tags.highway || tags.railway || tags.waterway || (tags.covered ? 'covered' : 'bridge') });
      }
    }
  }
  // cobbled stretches: every 5 m along the route, within 5 m of a cobbled way; runs merged across gaps of up to 25 m
  // (junctions, a short asphalt patch), kept from 30 m long
  if (cobbleWays.length) {
    const runs = [];
    for (let i = 0; i < xy.length - 1; i++) {
      const n = Math.max(1, Math.ceil((cum[i + 1] - cum[i]) / 5));
      for (let j = 0; j < n; j++) {
        const t = j / n, q = [xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t];
        let on = false;
        for (const w of cobbleWays) { for (let k = 0; k < w.length - 1 && !on; k++) on = segDist(q, w[k], w[k + 1]).d < 5; if (on) break; }
        if (!on) continue;
        const dd = at(i, t), r = runs[runs.length - 1];
        if (r && dd - r.b.d <= 25) r.b = { d: dd, i, t }; else runs.push({ a: { d: dd, i, t }, b: { d: dd, i, t } });
      }
    }
    for (const { a, b } of runs) if (b.d - a.d >= 30) {
      const pa = ptAt(a.i, a.t), pb = ptAt(b.i, b.t);
      list.push({ type: 'cobbles', km: +(a.d / 1000).toFixed(4), kmEnd: +(b.d / 1000).toFixed(4), lat: pa.lat, lon: pa.lon, latEnd: pb.lat, lonEnd: pb.lon });
    }
  }
  list.sort((a, b) => a.km - b.km);
  return { at: new Date().toISOString(), source: 'OpenStreetMap', list };
}

module.exports = { analyse, gpxPoints, overpass };
