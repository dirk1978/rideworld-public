// South Tyrol's LIDAR terrain model (Autonome Provinz Bozen, CC0): 2.5 m DTM over the whole province, from its
// WCS (geoservices9.civis.bz.it, EPSG:25832 = UTM 32N). 1 km tiles cached on disk ($BZ_CACHE).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTiff } from '../bristol/lidar.mjs';
const CACHE = process.env.BZ_CACHE || path.join(os.tmpdir(), 'rideworld-bz');
fs.mkdirSync(CACHE, { recursive: true });
// WGS84 (ETRS89, near enough) -> UTM zone 32N
export function toUTM32(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), k0 = 0.9996, lon0 = (9 * Math.PI) / 180;
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180, N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2), T = Math.tan(la) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(la) ** 2, A = Math.cos(la) * (lo - lon0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * la - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * la)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * la) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * la));
  return { E: k0 * N * (A + ((1 - T + C) * A ** 3) / 6) + 500000, N: k0 * (M + N * Math.tan(la) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24)) };
}
const T = 1000, R = 2.5, tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}-${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const f = path.join(CACHE, `dtm25-${key}.tif`);
  if (!fs.existsSync(f)) {
    const url = `https://geoservices9.civis.bz.it/geoserver/ows?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=p_bz-Elevation__DigitalTerrainModel-2.5m&format=image/tiff&subset=E(${tx * T},${tx * T + T})&subset=N(${ty * T},${ty * T + T})`;
    for (let k = 0; ; k++) {
      const r = await fetch(url);
      if (r.ok && (r.headers.get('content-type') || '').includes('tiff')) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; }
      if (k >= 3) throw new Error(`WCS ${r.status} for ${key}`);
      await new Promise((res) => setTimeout(res, 2000 * (k + 1)));
    }
  }
  const t = readTiff(fs.readFileSync(f));
  tiles.set(key, t);
  return t;
}
// height at a point (bilinear between cell centres); NaN outside the province / no data
export async function dtm(lat, lon) {
  const { E, N } = toUTM32(lat, lon), tx = Math.floor(E / T), ty = Math.floor(N / T), t = await tile(tx, ty);
  const x = (E - tx * T) / R - 0.5, y = (ty * T + T - N) / R - 0.5;
  const x0 = Math.max(0, Math.min(t.w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(t.h - 2, Math.floor(y))), fx = x - x0, fy = y - y0;
  const g = (c, r) => { const v = t.data[r * t.w + c]; return v < -100 || v > 5000 ? NaN : v; };
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
}
