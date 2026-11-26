// Re-height a route's GPX from a survey-grade ground model, keeping the line (the Alpe's method, made general):
//   node reheight.mjs <source> <in.gpx> <out.gpx> [maxGrade]
// source: 'ign' (France, IGN RGE ALTI 1 m), 'bz' (South Tyrol, 2.5 m LIDAR DTM; stelvio/dtm.mjs) or 'ea' (England,
// Environment Agency 1 m LIDAR; bristol/lidar.mjs).
// Each point: the median of 5 readings across the road (-3..3 m); then by distance a 50 m running median (takes out
// the line straying onto the hillside on hairpins), a rate limit (maxGrade, default 15%, from each end, averaged:
// OSM's line runs a few metres off the road on steep slopes) and a Gaussian (sigma 12 m). Prints the gradient summary.
import fs from 'fs';
const [source, src, out, maxGrade = '0.15'] = process.argv.slice(2);
const SAMPLERS = {
  ign: async (pts) => {
    const z = [];
    for (let i = 0; i < pts.length; i += 100) {
      const part = pts.slice(i, i + 100);
      const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?resource=ign_rge_alti_wld&delimiter=|&zonly=true&lon=${part.map((q) => q[1].toFixed(7)).join('|')}&lat=${part.map((q) => q[0].toFixed(7)).join('|')}`;
      for (let k = 0; ; k++) { try { const j = await (await fetch(url)).json(); z.push(...j.elevations.map(Number)); break; } catch (e) { if (k > 4) throw e; await new Promise((ok) => setTimeout(ok, 2000)); } }
    }
    return z;
  },
  ea: async (pts) => { const { lidar } = await import('./bristol/lidar.mjs'); const z = []; for (const [la, lo] of pts) z.push(await lidar('dtm', la, lo)); return z; },
  bz: async (pts) => { const { dtm } = await import('./stelvio/dtm.mjs'); const z = []; for (const [la, lo] of pts) z.push(await dtm(la, lo)); return z; },
};
let s = fs.readFileSync(src, 'utf8');
const re = /<trkpt (lon|lat)="([\d.-]+)" (lon|lat)="([\d.-]+)">\s*<ele>([\d.-]+)<\/ele>/g; // (one line or several)
const pts = [...s.matchAll(re)].map((m) => { const o = { m: m[0], ele: +m[5] }; o[m[1]] = +m[2]; o[m[3]] = +m[4]; return o; });
const k = Math.PI / 180;
const cross = pts.flatMap((p, i) => {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = (b.lon - a.lon) * Math.cos(p.lat * k), dy = b.lat - a.lat, L = Math.hypot(dx, dy) || 1;
  return [-3, -1.5, 0, 1.5, 3].map((o) => [p.lat + ((-dx / L) * o) / 110540, p.lon + ((dy / L) * o) / (111320 * Math.cos(p.lat * k))]);
});
const z = await SAMPLERS[source](cross);
const med = (a) => { const b = a.filter((v) => Number.isFinite(v) && v > -100).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
let dd = 0;
pts.forEach((p, i) => { p.raw = med(z.slice(i * 5, i * 5 + 5)); if (i) dd += Math.hypot((p.lon - pts[i - 1].lon) * k * Math.cos(p.lat * k) * 6371000, (p.lat - pts[i - 1].lat) * k * 6371000); p.d = dd; });
pts.forEach((p) => { if (!Number.isFinite(p.raw)) p.raw = p.ele; }); // outside the model: keep what was there
const m1 = pts.map((p) => med(pts.filter((q) => Math.abs(q.d - p.d) <= 25).map((q) => q.raw)));
const G = +maxGrade, lim = (order) => { const o = m1.slice(); for (let n = 1; n < order.length; n++) { const i = order[n], j = order[n - 1], g = Math.abs(pts[i].d - pts[j].d) * G; o[i] = Math.min(o[j] + g, Math.max(o[j] - g, m1[i])); } return o; };
const idx = pts.map((_, i) => i), fw = lim(idx), bw = lim(idx.slice().reverse()), m2 = m1.map((_, i) => (fw[i] + bw[i]) / 2);
pts.forEach((p) => { let sw = 0, sv = 0; pts.forEach((q, j) => { const x = q.d - p.d; if (Math.abs(x) <= 36) { const w = Math.exp(-(x * x) / 288); sw += w; sv += w * m2[j]; } }); p.z = sv / sw; });
for (const p of [...pts].reverse()) { const i = s.lastIndexOf(p.m); s = s.slice(0, i) + p.m.replace(/<ele>[\d.-]+<\/ele>/, `<ele>${p.z.toFixed(1)}</ele>`) + s.slice(i + p.m.length); }
fs.writeFileSync(out, s);
const zAt = (x, key) => { const i = pts.findIndex((p) => p.d >= x); if (i <= 0) return pts[0][key]; const t = (x - pts[i - 1].d) / (pts[i].d - pts[i - 1].d || 1); return pts[i - 1][key] + (pts[i][key] - pts[i - 1][key]) * t; };
for (const [key, label] of [['ele', 'before'], ['raw', 'model, raw'], ['z', 'model, smoothed']]) {
  let m50 = 0, at = 0, m500 = 0;
  for (let x = 0; x + 50 <= dd; x += 10) { const g = (zAt(x + 50, key) - zAt(x, key)) / 50; if (g > m50) { m50 = g; at = x; } }
  for (let x = 0; x + 500 <= dd; x += 50) m500 = Math.max(m500, (zAt(x + 500, key) - zAt(x, key)) / 500);
  console.log(`${label}: ${(dd / 1000).toFixed(2)} km, ${zAt(0, key).toFixed(0)} -> ${zAt(dd, key).toFixed(0)} m, average ${(((zAt(dd, key) - zAt(0, key)) / dd) * 100).toFixed(1)}%, steepest 50 m ${(m50 * 100).toFixed(1)}% at ${(at / 1000).toFixed(2)} km, steepest 500 m ${(m500 * 100).toFixed(1)}%`);
}
