// Road and place names along a route (the owner 2026-10-27: "could the current road or area moving into be displayed
// when approaching and fade out? Like if I'm joining Clattercut Lane, display it as I turn into it. Same as areas.
// Into Timberhonger or Hartlebury"), from OpenStreetMap:
//   roads:  where the route turns onto a named road (or a numbered one with no name): runs of 120 m or more along one
//           road, matched every 10 m to the nearest road within 10 m running the same way (gaps up to 40 m bridged)
//   places: hamlets, villages, towns, cities and suburbs the route goes through, announced where it reaches their edge
//           (a rough radius per kind before the closest point), each name once per 3 km
// Result, kept with the route: { at, roads: [{ km, lat, lon, name, ref? }], places: [{ km, lat, lon, name, kind }] }
// km along the uploaded GPX, lat/lon pinning it down (the ride maps them like the structures: Route.locate).
const { gpxPoints, overpass } = require('./structures');

const SKIP = /^(steps|corridor|platform|elevator|proposed|construction|bus_stop|raceway)$/;
const RADIUS = { city: 2000, town: 900, suburb: 500, village: 400, quarter: 400, neighbourhood: 250, hamlet: 200 };

async function analyse(gpx) {
  const pts = gpxPoints(gpx);
  if (pts.length < 2) throw new Error('No track in the route');
  const lat0 = pts[0].lat, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111195;
  const P = (p) => [p.lon * kx, p.lat * ky], xy = pts.map(P);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  // the query's line: a point every ~80 m (Overpass "around" a polyline)
  const line = [];
  for (let i = 0, last = -Infinity; i < pts.length; i++) if (cum[i] - last >= 80 || i === pts.length - 1) { line.push(`${pts[i].lat.toFixed(5)},${pts[i].lon.toFixed(5)}`); last = cum[i]; }
  const ll = line.join(',');
  const q = `[out:json][timeout:120];(way(around:15,${ll})["highway"]["name"];way(around:15,${ll})["highway"]["ref"];);out geom tags;node(around:2000,${ll})["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood)$"]["name"];out;`;
  const osm = await overpass(q);
  const ways = [], places = [];
  for (const e of osm.elements || []) {
    if (e.type === 'node') places.push(e);
    else if (e.type === 'way' && e.geometry?.length > 1 && !SKIP.test(e.tags?.highway || '')) ways.push({ tags: e.tags || {}, xy: e.geometry.filter(Boolean).map(P) });
  }

  // ---------- roads: a grid of the ways' segments (50 m cells), then every 10 m along the route ----------
  const CELL = 50, grid = new Map(), key = (cx, cy) => cx * 100003 + cy;
  ways.forEach((w, wi) => {
    for (let k = 0; k < w.xy.length - 1; k++) {
      const [ax, ay] = w.xy[k], [bx, by] = w.xy[k + 1];
      for (let cx = Math.floor(Math.min(ax, bx) / CELL) - 1; cx <= Math.floor(Math.max(ax, bx) / CELL) + 1; cx++)
        for (let cy = Math.floor(Math.min(ay, by) / CELL) - 1; cy <= Math.floor(Math.max(ay, by) / CELL) + 1; cy++) {
          const kk = key(cx, cy); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push([wi, k]);
        }
    }
  });
  const label = (t) => t.name || t.ref || null;
  const samples = []; // [d, label, wayIndex]
  for (let i = 0; i < xy.length - 1; i++) {
    const sl = cum[i + 1] - cum[i];
    if (sl < 0.01) continue;
    const rx = (xy[i + 1][0] - xy[i][0]) / sl, ry = (xy[i + 1][1] - xy[i][1]) / sl;
    for (let s = 0; s < sl; s += 10) {
      const t = s / sl, q2 = [xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t];
      let best = null;
      for (const [wi, k] of grid.get(key(Math.floor(q2[0] / CELL), Math.floor(q2[1] / CELL))) || []) {
        const [ax, ay] = ways[wi].xy[k], [bx, by] = ways[wi].xy[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        if (!L2) continue;
        const u = Math.max(0, Math.min(1, ((q2[0] - ax) * dx + (q2[1] - ay) * dy) / L2));
        const dist = Math.hypot(q2[0] - ax - u * dx, q2[1] - ay - u * dy);
        if (dist > 10 || Math.abs((rx * dx + ry * dy) / Math.sqrt(L2)) < 0.8) continue;
        if (!best || dist < best.dist) best = { dist, wi };
      }
      samples.push([cum[i] + s, best ? label(ways[best.wi].tags) : null, best?.wi, i, t]);
    }
  }
  // runs of one label, bridging unnamed gaps up to 40 m; kept from 120 m (the first run from any length)
  const runs = [];
  for (const [d, lab, wi, i, t] of samples) {
    const r = runs[runs.length - 1];
    if (!lab) continue;
    if (r && r.label === lab && d - r.end <= 40) { r.end = d; continue; }
    runs.push({ label: lab, start: d, end: d, wi, i, t });
  }
  const roads = [];
  for (const r of runs.filter((x, n) => x.end - x.start >= 120 || n === 0)) {
    if (roads.length && roads[roads.length - 1].label === r.label) continue; // (back on the same road after a short one)
    const tags = ways[r.wi].tags, a = pts[r.i], b = pts[r.i + 1];
    roads.push({ label: r.label, km: +(r.start / 1000).toFixed(3), lat: +(a.lat + (b.lat - a.lat) * r.t).toFixed(6), lon: +(a.lon + (b.lon - a.lon) * r.t).toFixed(6),
      name: tags.name || tags.ref, ref: tags.name && tags.ref ? tags.ref : undefined });
  }

  // ---------- places: through it (closest point within its radius), announced a radius before ----------
  const out = [];
  for (const n of places) {
    const kind = n.tags.place, R = RADIUS[kind] || 300, p = P(n);
    let bi = 0, bd = Infinity;
    for (let i = 0; i < xy.length; i++) { const dd = Math.hypot(xy[i][0] - p[0], xy[i][1] - p[1]); if (dd < bd) { bd = dd; bi = i; } }
    if (bd > R) continue;
    const at = Math.max(0, cum[bi] - Math.sqrt(R * R - bd * bd) * 0.8);
    let j = bi; while (j > 0 && cum[j] > at) j--;
    out.push({ km: +(at / 1000).toFixed(3), lat: +pts[j].lat.toFixed(6), lon: +pts[j].lon.toFixed(6), name: n.tags.name, kind });
  }
  out.sort((a, b) => a.km - b.km);
  const placesOut = out.filter((p, k) => !out.slice(0, k).some((q3) => q3.name === p.name && p.km - q3.km < 3));
  return { at: new Date().toISOString(), roads: roads.map(({ label, ...r }) => r), places: placesOut };
}

module.exports = { analyse };
