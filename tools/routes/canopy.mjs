// Trees from the Environment Agency's LIDAR (2026-11-14, the owner: "a few reports about the trees which could and
// should be there ... the cccp route, most of it is covered and surrounded by trees"; OpenStreetMap maps hardly any of
// them). The EA flies England in two surveys: DTM = the bare ground, DSM = the first surface the laser hits (tree tops,
// roofs, bridges). DSM - DTM is the height of whatever stands there, every metre. Trees are the rough-topped parts of it
// over 2.5 m, outside mapped buildings (roofs and bridges are flat: left out by the roughness test); each crown is a
// local maximum of that height, so every tree comes out where it is, as tall as it is. Used by lib/world.js for routes
// in England; 500 m tiles cached by lidar.mjs (LIDAR_CACHE).
import { tile, toBNG } from './bristol/lidar.mjs';

const T = 500; // tile size (m), as lidar.mjs

// BNG -> WGS84 near a point: Newton steps on toBNG (good to millimetres within a tile)
export function fromBNGNear(lat0, lon0) {
  const J = (lat, lon) => {
    const p = toBNG(lat, lon), a = toBNG(lat + 1e-5, lon), b = toBNG(lat, lon + 1e-5);
    return { p, dEdlat: (a.E - p.E) / 1e-5, dNdlat: (a.N - p.N) / 1e-5, dEdlon: (b.E - p.E) / 1e-5, dNdlon: (b.N - p.N) / 1e-5 };
  };
  const j = J(lat0, lon0), det = j.dEdlat * j.dNdlon - j.dEdlon * j.dNdlat;
  return (E, N) => {
    let lat = lat0, lon = lon0;
    for (let k = 0; k < 3; k++) {
      const p = toBNG(lat, lon), dE = E - p.E, dN = N - p.N;
      lat += (j.dNdlon * dE - j.dEdlon * dN) / det;
      lon += (-j.dNdlat * dE + j.dEdlat * dN) / det;
    }
    return [lat, lon];
  };
}

// route: [{ lat, lon }] (every ~20 m); buildings: [[[lat, lon], ...], ...]; returns [[lat, lon, height, crown radius]]
// (route may also be a list of polylines: an open-world area's road network, 2026-11-15)
export async function canopyTrees(route, buildings = [], { band = 80, near = 25, log = () => {} } = {}) {
  const lines = (Array.isArray(route[0]) ? route : [route]).map((l) => l.map((p) => ({ ...toBNG(p.lat, p.lon), lat: p.lat, lon: p.lon })));
  const R = lines.flat();
  // tiles within the band of the route
  const want = new Map();
  for (const p of R) for (const dx of [-band, 0, band]) for (const dy of [-band, 0, band]) {
    const tx = Math.floor((p.E + dx) / T), ty = Math.floor((p.N + dy) / T), k = `${tx},${ty}`;
    if (!want.has(k)) want.set(k, { tx, ty, near: p });
  }
  // OSM buildings in BNG with their boxes (left out of the canopy, 1.5 m round them)
  const B = buildings.map((pts) => { const q = pts.map(([la, lo]) => toBNG(la, lo)); return { q, e0: Math.min(...q.map((v) => v.E)) - 1.5, e1: Math.max(...q.map((v) => v.E)) + 1.5, n0: Math.min(...q.map((v) => v.N)) - 1.5, n1: Math.max(...q.map((v) => v.N)) + 1.5 }; });
  const inPoly = (q, E, N) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a.N > N) !== (b.N > N) && E < ((b.E - a.E) * (N - a.N)) / (b.N - a.N) + a.E) c = !c; } return c; };
  const out = [];
  let n = 0;
  for (const { tx, ty, near: np } of want.values()) {
    n++;
    let dtm, dsm;
    // one request at a time, a pause between (the EA's server refuses bursts: 429)
    try { dtm = await tile('dtm', tx, ty); await new Promise((r) => setTimeout(r, 800)); dsm = await tile('dsm', tx, ty); } catch (e) { log(`tile ${tx},${ty}: ${e.message}`); continue; }
    const W = dtm.w, H = dtm.h, E0 = tx * T, N1 = ty * T + T; // pixel (c, r) centre = (E0 + c + 0.5, N1 - r - 0.5)
    if (dsm.w !== W || dsm.h !== H) continue;
    // distance to the route on a 5 m grid (route segments near this tile only)
    const segs = [];
    for (const Ln of lines) for (let i = 1; i < Ln.length; i++) { const a = Ln[i - 1], b = Ln[i]; if (Math.max(a.E, b.E) > E0 - band && Math.min(a.E, b.E) < E0 + T + band && Math.max(a.N, b.N) > N1 - T - band && Math.min(a.N, b.N) < N1 + band) segs.push([a, b]); }
    if (!segs.length) continue;
    const G = 5, gw = Math.ceil(W / G), gh = Math.ceil(H / G), gd = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const E = E0 + gx * G + G / 2, N = N1 - gy * G - G / 2;
      let m = Infinity;
      for (const [a, b] of segs) { const vx = b.E - a.E, vy = b.N - a.N, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((E - a.E) * vx + (N - a.N) * vy) / L2)); m = Math.min(m, Math.hypot(a.E + vx * t - E, a.N + vy * t - N)); }
      gd[gy * gw + gx] = m;
    }
    const dist = (c, r) => gd[Math.floor(r / G) * gw + Math.floor(c / G)];
    // canopy height where it's tree-like
    const chm = new Float32Array(W * H).fill(0);
    const bs = B.filter((b) => b.e1 > E0 && b.e0 < E0 + T && b.n1 > N1 - T && b.n0 < N1);
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      if (dist(c, r) > band) continue;
      const i = r * W + c, g = dtm.data[i], s = dsm.data[i];
      if (!(g > -1000 && g < 5000 && s > -1000 && s < 5000)) continue;
      const h = s - g;
      if (h < 2.5 || h > 45) continue;
      // rough top: how far the surface over 3 x 3 strays from the best-fitting PLANE (2026-11-15: the old test, spread
      // about the mean, passed pitched roofs, whose slope alone gives a big spread; terraces came out as rows of trees
      // along their ridges, the owner on Stoke Road). Roof planes fit a plane within centimetres; a ridge line strays,
      // but it's only a pixel or two wide, so the crown test below (canopy round a peak) leaves it out
      let n = 0, sv = 0, sx = 0, sy = 0; const vals = [];
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const v = dsm.data[i + y * W + x]; if (v > -1000 && v < 5000) { vals.push([x, y, v]); n++; sv += v; sx += x * v; sy += y * v; } }
      if (n < 9) continue;
      const a0 = sv / 9, bx = sx / 6, by = sy / 6;
      let r2 = 0; for (const [x, y, v] of vals) r2 += (v - a0 - bx * x - by * y) ** 2;
      if (Math.sqrt(r2 / 9) < 0.25) continue;
      const E = E0 + c + 0.5, N = N1 - r - 0.5;
      if (bs.some((b) => E > b.e0 && E < b.e1 && N > b.n0 && N < b.n1 && inPoly(b.q, E, N))) continue;
      chm[i] = h;
    }
    // crowns: local maxima over a radius growing with height, with enough canopy round them
    const toLL = fromBNGNear(np.lat, np.lon);
    for (let r = 3; r < H - 3; r++) for (let c = 3; c < W - 3; c++) {
      const h = chm[r * W + c];
      if (h < 3.5) continue;
      const rad = Math.max(2, Math.min(5, Math.round(1.5 + 0.12 * h)));
      let top = true, filled = 0, cells = 0;
      for (let y = -rad; y <= rad && top; y++) for (let x = -rad; x <= rad; x++) {
        if (x * x + y * y > rad * rad) continue;
        const rr = r + y, cc = c + x;
        if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
        const v = chm[rr * W + cc];
        cells++; if (v > 0) filled++;
        if (v > h || (v === h && (y < 0 || (y === 0 && x < 0)))) { top = false; break; }
      }
      if (!top || filled < cells * 0.5) continue; // (0.4 until 2026-11-15)
      // away from the road: fewer (the view only needs the woods' edge and their mass beyond)
      const d = dist(c, r);
      const keep = d < near ? 1 : d < 50 ? 0.55 : 0.3;
      const hash = ((tx * 73856093) ^ (ty * 19349663) ^ (c * 83492791) ^ (r * 2654435761)) >>> 0;
      if ((hash % 1000) / 1000 > keep) continue;
      const [lat, lon] = toLL(E0 + c + 0.5, N1 - r - 0.5);
      out.push([+lat.toFixed(6), +lon.toFixed(6), +h.toFixed(1), +Math.max(1.5, Math.min(7, 0.28 * h + 0.8)).toFixed(1)]);
    }
    if (n % 10 === 0) log(`canopy: ${n}/${want.size} tiles, ${out.length} trees`);
  }
  return out;
}
