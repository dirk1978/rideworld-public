// LIDAR heights (Environment Agency composite 1 m, DTM = bare ground, DSM = first return incl. bridges) for WGS84
// points. Tiles of 500 m are fetched from the EA's WCS and cached on disk. WGS84 -> OSGB36 by the standard Helmert
// transformation (a few metres at most), then Transverse Mercator to British National Grid.
import fs from 'fs';
import os from 'os';
import path from 'path';
const CACHE = process.env.LIDAR_CACHE || path.join(os.tmpdir(), 'rideworld-lidar');
fs.mkdirSync(CACHE, { recursive: true });
const SRC = {
  dtm: ['lidar-composite-digital-terrain-model-dtm-1m', '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'],
  dsm: ['lidar-composite-digital-surface-model-first-return-dsm-1m', 'df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m'],
};
const rad = Math.PI / 180;
export function toBNG(lat, lon) {
  // WGS84 ellipsoid -> cartesian
  const a1 = 6378137, b1 = 6356752.3142, e1 = 1 - (b1 * b1) / (a1 * a1);
  const φ = lat * rad, λ = lon * rad, sφ = Math.sin(φ), cφ = Math.cos(φ);
  const ν1 = a1 / Math.sqrt(1 - e1 * sφ * sφ);
  const x1 = ν1 * cφ * Math.cos(λ), y1 = ν1 * cφ * Math.sin(λ), z1 = (1 - e1) * ν1 * sφ;
  // Helmert WGS84 -> OSGB36
  const tx = -446.448, ty = 125.157, tz = -542.06, s = 20.4894e-6, rx = (-0.1502 / 3600) * rad, ry = (-0.247 / 3600) * rad, rz = (-0.8421 / 3600) * rad;
  const x2 = tx + x1 * (1 + s) - y1 * rz + z1 * ry, y2 = ty + x1 * rz + y1 * (1 + s) - z1 * rx, z2 = tz - x1 * ry + y1 * rx + z1 * (1 + s);
  // cartesian -> Airy 1830 lat/lon
  const a = 6377563.396, b = 6356256.909, e2 = 1 - (b * b) / (a * a), p = Math.hypot(x2, y2);
  let φ2 = Math.atan2(z2, p * (1 - e2)), φp;
  do { φp = φ2; const ν = a / Math.sqrt(1 - e2 * Math.sin(φ2) ** 2); φ2 = Math.atan2(z2 + e2 * ν * Math.sin(φ2), p); } while (Math.abs(φ2 - φp) > 1e-12);
  const λ2 = Math.atan2(y2, x2);
  // Transverse Mercator (OS National Grid)
  const F0 = 0.9996012717, φ0 = 49 * rad, λ0 = -2 * rad, N0 = -100000, E0 = 400000, n = (a - b) / (a + b);
  const sinφ = Math.sin(φ2), cosφ = Math.cos(φ2), tanφ = Math.tan(φ2);
  const ν = a * F0 / Math.sqrt(1 - e2 * sinφ * sinφ), ρ = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinφ * sinφ, 1.5), η2 = ν / ρ - 1;
  const dφ = φ2 - φ0, sφs = φ2 + φ0;
  const M = b * F0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dφ - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dφ) * Math.cos(sφs)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dφ) * Math.cos(2 * sφs) - (35 / 24) * n ** 3 * Math.sin(3 * dφ) * Math.cos(3 * sφs));
  const I = M + N0, II = (ν / 2) * sinφ * cosφ, III = (ν / 24) * sinφ * cosφ ** 3 * (5 - tanφ ** 2 + 9 * η2), IIIA = (ν / 720) * sinφ * cosφ ** 5 * (61 - 58 * tanφ ** 2 + tanφ ** 4);
  const IV = ν * cosφ, V = (ν / 6) * cosφ ** 3 * (ν / ρ - tanφ ** 2), VI = (ν / 120) * cosφ ** 5 * (5 - 18 * tanφ ** 2 + tanφ ** 4 + 14 * η2 - 58 * tanφ ** 2 * η2);
  const dλ = λ2 - λ0;
  return { E: E0 + IV * dλ + V * dλ ** 3 + VI * dλ ** 5, N: I + II * dλ ** 2 + III * dλ ** 4 + IIIA * dλ ** 6 };
}
// minimal TIFF reader: one IFD, uncompressed float32 strips (what the EA's WCS sends)
export function readTiff(buf) {
  const le = buf.toString('latin1', 0, 2) === 'II', u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = u32(4), n = u16(ifd), tags = {};
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, tag = u16(o), type = u16(o + 2), cnt = u32(o + 4);
    const size = { 3: 2, 4: 4 }[type] || 4, vo = cnt * size > 4 ? u32(o + 8) : o + 8;
    tags[tag] = Array.from({ length: cnt }, (_, k) => (type === 3 ? u16(vo + k * 2) : u32(vo + k * 4)));
  }
  const w = tags[256][0], h = tags[257][0];
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('compressed tiff');
  const data = new Float32Array(w * h).fill(NaN), rd = (o) => (le ? buf.readFloatLE(o) : buf.readFloatBE(o));
  if (tags[324]) { // tiled
    const tw = tags[322][0], th = tags[323][0], across = Math.ceil(w / tw), offs = tags[324];
    offs.forEach((off, i) => {
      const c0 = (i % across) * tw, r0 = Math.floor(i / across) * th;
      for (let r = 0; r < th && r0 + r < h; r++) for (let c = 0; c < tw && c0 + c < w; c++) data[(r0 + r) * w + c0 + c] = rd(off + (r * tw + c) * 4);
    });
  } else {
    const offs = tags[273], rps = tags[278]?.[0] ?? h;
    for (let r = 0; r < h; r++) {
      const base = offs[Math.floor(r / rps)] + (r % rps) * w * 4;
      for (let c = 0; c < w; c++) data[r * w + c] = rd(base + c * 4);
    }
  }
  return { w, h, data };
}
const T = 500, tiles = new Map();
export async function tile(kind, tx, ty) {
  const key = `${kind}-${tx}-${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const f = path.join(CACHE, key + '.tif');
  if (!fs.existsSync(f)) {
    const [svc, cov] = SRC[kind];
    const url = `https://environment.data.gov.uk/spatialdata/${svc}/wcs?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=${cov}&format=image/tiff&subset=E(${tx * T},${tx * T + T})&subset=N(${ty * T},${ty * T + T})`;
    for (let k = 0; ; k++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) }).catch((e) => ({ ok: false, status: 'timeout', headers: new Map(), text: async () => e.message })); // (a request hung for 10 min, 2026-11-14)
      if (r.ok && (r.headers.get('content-type') || '').includes('tiff')) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; }
      if (k >= 5) throw new Error(`WCS ${r.status} for ${key}`);
      // (2026-11-14: the EA's server answers 429 when asked too fast, and 504 when busy: back right off)
      await new Promise((res) => setTimeout(res, (r.status === 429 ? 30000 : 4000) * (k + 1)));
    }
  }
  const t = readTiff(fs.readFileSync(f));
  tiles.set(key, t);
  return t;
}
// height at a BNG point (bilinear between the 1 m cell centres); NaN where there's no data
export async function heightAt(kind, E, N) {
  const tx = Math.floor(E / T), ty = Math.floor(N / T), t = await tile(kind, tx, ty);
  const x = E - tx * T - 0.5, y = (ty * T + T) - N - 0.5; // row 0 is the north edge
  const x0 = Math.max(0, Math.min(t.w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(t.h - 2, Math.floor(y))), fx = x - x0, fy = y - y0;
  const g = (c, r) => { const v = t.data[r * t.w + c]; return v < -1000 || v > 5000 ? NaN : v; };
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
}
export const lidar = async (kind, lat, lon) => { const { E, N } = toBNG(lat, lon); return heightAt(kind, E, N); };
