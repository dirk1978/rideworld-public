// Survey-grade heights for a route's points (the method used by hand on the Alpe, Stelvio, Hardknott, Mad March Hare
// and CCCP TT routes, as a module for reheight.mjs and the route pipeline, tools/pipeline/worker.mjs).
//   sourceFor(points) -> 'ea' | 'wales' | 'scot' | 'ign' | 'bz' | 'ch' | 'us' | null   (which model covers the route;
//   null = none we can use)
//   reheight(points, source, maxGrade) -> { z: [..], raw: [..], d: [..], maxGrade }   (points: [{ lat, lon, ele }];
//   maxGrade 'auto': 1.7 x the road's own steepest 500 m, 15-35%: Hardknott keeps its 30% ramps, the Stelvio's hairpin
//   artefacts don't get through)
// Each point: the median of 5 readings across the road (-3..3 m); then by distance a 50 m running median (the line
// straying onto the hillside on hairpins), a rate limit (maxGrade, from each end, averaged: OSM's line runs a few
// metres off the road on steep slopes) and a Gaussian (sigma 12 m).
const k = Math.PI / 180;

// Great Britain: England's, Wales's and Scotland's surveys, each falling back to the others point by point (a route
// over the border, the Wye valley or the Cheviots, stays on survey heights throughout)
const GB = {
  ea: async (E, N) => { const { heightAt } = await import('./bristol/lidar.mjs'); return heightAt('dtm', E, N); },
  wales: async (E, N) => { const { openTiff } = await import('./cogtiff.mjs'); return (await openTiff(WALES)).value(E, N); },
  scot: async (E, N) => { const { scotDtm } = await import('./scotland/dtm.mjs'); return scotDtm(E, N); },
};
// Wales: Welsh Government / NRW 1 m terrain model 2020-23 (DataMapWales), one cloud-optimised GeoTIFF in British grid
const WALES = 'https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_32bit_cog.tif';
const gb = (first) => async (pts) => {
  const { toBNG } = await import('./bristol/lidar.mjs');
  const order = [first, ...Object.keys(GB).filter((x) => x !== first)], z = [];
  for (const [la, lo] of pts) {
    const { E, N } = toBNG(la, lo);
    let v = NaN;
    for (const s of order) { try { v = await GB[s](E, N); } catch (e) { v = NaN; } if (Number.isFinite(v) && v > -100) break; }
    z.push(v);
  }
  return z;
};

// Switzerland: WGS84 -> LV95 (swisstopo's approximate formulas, ~1 m)
function toLV95(lat, lon) {
  const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
  return [2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3,
    1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3];
}
const retry = async (fn) => { for (let t = 0; ; t++) { try { return await fn(); } catch (e) { if (t > 4) throw e; await new Promise((ok) => setTimeout(ok, 2000 * (t + 1))); } } };

export const SOURCES = {
  // England: Environment Agency 1 m LIDAR (bristol/lidar.mjs; NaN outside England)
  ea: { label: 'Environment Agency laser survey (1 m)', sample: gb('ea') },
  wales: { label: 'Welsh Government laser survey (1 m)', sample: gb('wales') },
  scot: { label: 'Scottish laser survey (50 cm-1 m)', sample: gb('scot') },
  // France: IGN RGE ALTI 1 m (Géoplateforme altimetry; -99999 outside France)
  ign: { label: 'IGN RGE ALTI (1 m)', sample: async (pts) => {
    const z = [];
    for (let i = 0; i < pts.length; i += 100) {
      const part = pts.slice(i, i + 100);
      const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?resource=ign_rge_alti_wld&delimiter=|&zonly=true&lon=${part.map((q) => q[1].toFixed(7)).join('|')}&lat=${part.map((q) => q[0].toFixed(7)).join('|')}`;
      z.push(...await retry(async () => (await (await fetch(url)).json()).elevations.map(Number)));
    }
    return z;
  } },
  // South Tyrol: the province's 2.5 m LIDAR DTM (stelvio/dtm.mjs)
  bz: { label: 'South Tyrol laser survey (2.5 m)', sample: async (pts) => { const { dtm } = await import('./stelvio/dtm.mjs'); const z = []; for (const [la, lo] of pts) z.push(await dtm(la, lo)); return z; } },
  // Switzerland: swisstopo swissALTI3D (2 m) through its profile service: a line through up to 100 points (its request
  // line may be 4 KB at most: 150 was too long), a height
  // returned at each (plus some between, ignored); matched back by position
  ch: { label: 'swisstopo swissALTI3D (2 m)', sample: async (pts) => {
    const z = [];
    for (let i = 0; i < pts.length; i += 100) {
      const part = pts.slice(i, i + 100).map(([la, lo]) => toLV95(la, lo).map((v) => +v.toFixed(1)));
      if (part.length === 1) part.push([part[0][0] + 0.01, part[0][1]]);
      const geom = encodeURIComponent(JSON.stringify({ type: 'LineString', coordinates: part }));
      const out = await retry(async () => { const r = await fetch(`https://api3.geo.admin.ch/rest/services/profile.json?geom=${geom}&sr=2056&distinct_points=true&nb_points=${part.length}`); if (!r.ok) throw new Error('swisstopo ' + r.status); return r.json(); });
      let j = 0;
      for (const [e, n] of part.slice(0, Math.min(100, pts.length - i))) {
        while (j < out.length && Math.hypot(out[j].easting - e, out[j].northing - n) > 0.08) j++;
        z.push(j < out.length && out[j].alts?.DTM2 != null ? out[j].alts.DTM2 : NaN);
      }
    }
    return z;
  } },
  // USA: USGS 3D Elevation Program, best available (1 m LIDAR over most of the country), 100 points per request
  us: { label: 'USGS 3DEP laser survey (1 m)', sample: async (pts) => {
    const z = [];
    for (let i = 0; i < pts.length; i += 100) {
      const part = pts.slice(i, i + 100);
      const body = new URLSearchParams({ geometry: JSON.stringify({ points: part.map(([la, lo]) => [lo, la]), spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', f: 'json' });
      const j = await retry(async () => { const r = await fetch('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples', { method: 'POST', body }); const x = await r.json(); if (!x.samples) throw new Error('USGS ' + JSON.stringify(x).slice(0, 80)); return x; });
      const byId = new Map(j.samples.map((s) => [s.locationId, parseFloat(s.value)]));
      part.forEach((_, k) => z.push(byId.has(k) && Number.isFinite(byId.get(k)) ? byId.get(k) : NaN));
    }
    return z;
  } },
};

// which model covers most of the route: rough boxes first, then a sample of points must come back with heights
const BOXES = { ea: [49.8, 55.9, -6.5, 1.9], wales: [51.3, 53.5, -5.4, -2.6], scot: [54.6, 61, -8.7, -0.7], ign: [41.3, 51.2, -5.3, 9.7], bz: [46.2, 47.1, 10.38, 12.5], ch: [45.8, 47.85, 5.9, 10.5], us: [24.4, 49.5, -125, -66.8] };
export async function sourceFor(points) {
  const sample = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 12)) === 0).slice(0, 12).map((p) => [p.lat, p.lon]);
  // finest / smallest first; Great Britain: the country most of the sample is in names it (each falls back to the others)
  for (const s of ['bz', 'ch', 'wales', 'scot', 'ea', 'ign', 'us']) {
    const [a, b, c, d] = BOXES[s];
    if (!sample.every(([la, lo]) => la >= a && la <= b && lo >= c && lo <= d)) continue;
    try {
      if (s === 'wales' || s === 'scot' || s === 'ea') {
        // name it after the country with most of the sample
        const own = [];
        for (const q of sample) { const { toBNG } = await import('./bristol/lidar.mjs'); const { E, N } = toBNG(q[0], q[1]); own.push(Number.isFinite(await GB[s](E, N).catch(() => NaN))); }
        if (own.filter(Boolean).length < sample.length / 2) continue;
      }
      const z = await SOURCES[s].sample(sample);
      if (z.filter((v) => Number.isFinite(v) && v > -100).length >= sample.length * 0.9) return s;
    } catch (e) { console.warn('height source', s, e.message); }
  }
  return null;
}

const med = (a) => { const b = a.filter((v) => Number.isFinite(v) && v > -100).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

// Bridges the route rides along (lib/structures.js 'bridge' entries), as spans of point indices [i0, i1], merged
// where they touch (a bridge in several OSM pieces). Each end is pinned to the point nearest its lat/lon, searched
// near its km (a route can pass the same spot twice).
export function bridgeSpans(points, list, d) {
  const near = (lat, lon, km) => {
    let best = -1, be = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (Math.abs(d[i] / 1000 - km) > 0.4) continue;
      const e = Math.hypot((points[i].lon - lon) * k * Math.cos(lat * k) * 6371000, (points[i].lat - lat) * k * 6371000);
      if (e < be) { be = e; best = i; }
    }
    return be < 30 ? best : -1;
  };
  const spans = [];
  for (const b of (list || []).filter((x) => x.type === 'bridge' && (x.kmEnd - x.km) * 1000 >= 15)) {
    const a = near(b.lat, b.lon, b.km), z = near(b.latEnd, b.lonEnd, b.kmEnd);
    if (a >= 0 && z > a) spans.push([a, z]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const sp of spans) { const l = out[out.length - 1]; if (l && d[sp[0]] - d[l[1]] < 20) l[1] = Math.max(l[1], sp[1]); else out.push([...sp]); }
  return out;
}

// opts.bridges: spans from bridgeSpans(); inside each the survey's ground (the river, the road below) is replaced by a
// straight line between the road just before and just after it (survey terrain models take bridges out)
export async function reheight(points, source, maxGrade = 0.15, onProgress = () => {}, opts = {}) {
  const cross = points.flatMap((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = (b.lon - a.lon) * Math.cos(p.lat * k), dy = b.lat - a.lat, L = Math.hypot(dx, dy) || 1;
    return [-3, -1.5, 0, 1.5, 3].map((o) => [p.lat + ((-dx / L) * o) / 110540, p.lon + ((dy / L) * o) / (111320 * Math.cos(p.lat * k))]);
  });
  const z = [];
  for (let i = 0; i < cross.length; i += 500) { z.push(...await SOURCES[source].sample(cross.slice(i, i + 500))); onProgress(Math.min(1, (i + 500) / cross.length)); }
  const d = [0];
  for (let i = 1; i < points.length; i++) d.push(d[i - 1] + Math.hypot((points[i].lon - points[i - 1].lon) * k * Math.cos(points[i].lat * k) * 6371000, (points[i].lat - points[i - 1].lat) * k * 6371000));
  const raw = points.map((p, i) => { const v = med(z.slice(i * 5, i * 5 + 5)); return Number.isFinite(v) ? v : p.ele; }); // outside the model: as it was
  // bridges: the ends from the median of the readings within 15 m outside each end
  for (const [a, b] of opts.bridges || []) {
    const before = [], after = [];
    for (let i = a; i >= 0 && d[a] - d[i] <= 15; i--) before.push(raw[i]);
    for (let i = b; i < points.length && d[i] - d[b] <= 15; i++) after.push(raw[i]);
    const za = med(before), zb = med(after);
    if (!Number.isFinite(za) || !Number.isFinite(zb)) continue;
    for (let i = a; i <= b; i++) raw[i] = za + (zb - za) * ((d[i] - d[a]) / ((d[b] - d[a]) || 1));
  }
  // running median over 50 m (two pointers: points are in order of distance)
  const m1 = [];
  for (let i = 0, lo = 0, hi = 0; i < points.length; i++) {
    while (d[lo] < d[i] - 25) lo++;
    while (hi + 1 < points.length && d[hi + 1] <= d[i] + 25) hi++;
    m1.push(med(raw.slice(lo, hi + 1)));
  }
  if (maxGrade === 'auto') maxGrade = Math.max(0.15, Math.min(0.35, 1.7 * gradients(d, m1).m500));
  const lim = (order) => { const o = m1.slice(); for (let n = 1; n < order.length; n++) { const i = order[n], j = order[n - 1], g = Math.abs(d[i] - d[j]) * maxGrade; o[i] = Math.min(o[j] + g, Math.max(o[j] - g, m1[i])); } return o; };
  const idx = points.map((_, i) => i), fw = lim(idx), bw = lim(idx.slice().reverse()), m2 = m1.map((_, i) => (fw[i] + bw[i]) / 2);
  const out = [];
  for (let i = 0, lo = 0, hi = 0; i < points.length; i++) {
    while (d[lo] < d[i] - 36) lo++;
    while (hi + 1 < points.length && d[hi + 1] <= d[i] + 36) hi++;
    let sw = 0, sv = 0;
    for (let j = lo; j <= hi; j++) { const x = d[j] - d[i], w = Math.exp(-(x * x) / 288); sw += w; sv += w * m2[j]; }
    out.push(sv / sw);
  }
  return { z: out, raw, d, maxGrade };
}

// steepest gradients of a height series over a distance series
export function gradients(d, z) {
  const at = (x) => { let i = d.findIndex((v) => v >= x); if (i <= 0) return z[0]; const t = (x - d[i - 1]) / (d[i] - d[i - 1] || 1); return z[i - 1] + (z[i] - z[i - 1]) * t; };
  const L = d[d.length - 1]; let m50 = 0, m500 = 0;
  for (let x = 0; x + 50 <= L; x += 10) m50 = Math.max(m50, (at(x + 50) - at(x)) / 50);
  for (let x = 0; x + 500 <= L; x += 50) m500 = Math.max(m500, (at(x + 500) - at(x)) / 500);
  return { m50, m500 };
}

// a drawn route's line with a point at least every `step` metres (BRouter and the planner put points only at
// junctions and bends: ~27 m apart on average, a handful across the George Washington Bridge)
export function densify(points, step = 5) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], L = Math.hypot((b.lon - a.lon) * k * Math.cos(a.lat * k) * 6371000, (b.lat - a.lat) * k * 6371000), n = Math.ceil(L / step);
    for (let j = 1; j < n; j++) { const t = j / n; out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele: a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * t : a.ele }); }
    out.push(b);
  }
  return out;
}
