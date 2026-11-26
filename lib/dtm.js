// The real ground for open worlds (2026-11-17): serves pieces of data/world/<id>.dtm (tools/openworld/dtm-grid.mjs: the
// EA LIDAR ground model every 2 m, cm above Ordnance Datum) as n x n Float32 heights in metres over a lat/lon rectangle,
// row 0 the north edge, NaN where there's no survey. flatterrain.js builds its terrain tiles from these. The grid is
// read once per file version (~80 MB for Bromsgrove).
const fs = require('fs');
const path = require('path');

const cache = new Map(); // id -> { mtime, h, data }
function load(id) {
  const f = path.join(__dirname, '..', 'data', 'world', id + '.dtm');
  let st; try { st = fs.statSync(f); } catch { return null; }
  const c = cache.get(id);
  if (c && c.mtime === st.mtimeMs) return c;
  const buf = fs.readFileSync(f), h = JSON.parse(buf.subarray(0, 256).toString().trim());
  const data = new Uint16Array(buf.buffer.slice(buf.byteOffset + 256, buf.byteOffset + buf.length));
  const o = { mtime: st.mtimeMs, h, data };
  cache.set(id, o);
  return o;
}

function sample(id, w, s, e, n, N) {
  const g = load(id);
  if (!g) return null;
  const { h, data } = g, out = new Float32Array(N * N);
  for (let r = 0; r < N; r++) {
    const fy = (h.n - (n - ((n - s) * r) / (N - 1))) / h.dLat, y0 = Math.floor(fy), ty = fy - y0;
    for (let c = 0; c < N; c++) {
      const fx = (w + ((e - w) * c) / (N - 1) - h.w) / h.dLon, x0 = Math.floor(fx), tx = fx - x0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= h.nx || y0 + 1 >= h.ny) { out[r * N + c] = NaN; continue; }
      const i = y0 * h.nx + x0, a = data[i], b = data[i + 1], cc = data[i + h.nx], d = data[i + h.nx + 1];
      if (a === 65535 || b === 65535 || cc === 65535 || d === 65535) { out[r * N + c] = NaN; continue; }
      out[r * N + c] = ((a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty) / 100 - (h.base || 0); // (v2 files: stored above -base m)
    }
  }
  return out;
}

module.exports = { sample, has: (id) => !!load(id) };
