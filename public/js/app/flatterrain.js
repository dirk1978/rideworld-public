// Roads on level ground (2026-11-16, the owner: "is there anything that can be done to stop the edges from curving up and
// being bumpy?"). The open world's roads are painted onto Cesium's terrain, which is coarse: across a road it rises,
// dips and steps, and the road follows it. This wraps the terrain provider: inside the open world's box every tile is
// rebuilt as a 65 x 65 height grid (resampled from the deepest real tile above it, so down to ~0.4 m spacing near the
// camera) and, across every road and its pavements, made level at the road's centre height (averaged along the road
// over 8 m), easing back to the natural ground over 2.5 m beyond. Outside the box the real tiles pass straight through.
// The rider's survey, the trees and the buildings all sample this same ground, so everything sits on the levelled road.
// Since 2026-11-16 the road's height is its own LIDAR height (the open world's road points, Ordnance Datum) plus one
// offset for the area (`off`, the ellipsoid above the datum as this terrain has it: median over many road points), not
// the coarse terrain's: that climbed 4 m in 8 m beside a bridge where the road doesn't (steps where decks met roads,
// the owner: "a bit of polish needed on some bridges and junctions"). Where the coarse ground is far above or below the
// road it eases back over a longer distance (2.5 m + 1.5 m per metre of difference, at most 12 m).
// Since 2026-11-17 the ground itself is the real one where the open world has a LIDAR ground model (dtmUrl: lib/dtm.js,
// every 2 m): each tile's grid takes it (+ off) wherever the survey has data, so fields, banks, cuttings and the hills
// have their real shape; elsewhere (and while the piece is coming) the coarse terrain as before.
import { C } from './core.js';

const N = 65, PAD = 8, M = N + 2 * PAD; // the grid, and a margin round it (centre heights just outside the tile)
const BLK = 128, BLOCK_LEVEL = 16; // (dtm blocks: cells a side = 256 m, the most lib/dtm.js serves in one piece (n <= 129); the first level cut from them)
const MAXL = 18; // our deepest level inside the box (~0.7 m spacing; 19 cost 5 fps on the GTX 650)

function inPolyDeg(P, lat, lon) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [yi, xi] = P[i], [yj, xj] = P[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; }
export class FlatRoadTerrain {
  // roads: [{ pts: [[lat, lon, ele]], hw (half width to level, m) }]; box { s, w, n, e }; off: terrain height - LIDAR height
  // basins: [{ poly: [[lat, lon]], lv (LIDAR datum) }]: big water areas (the Thames), pressed down 1 m under their level
  // so the 3D water surface (world.js) never has ground poking through it (London 2026-11-17)
  constructor(inner, roads, box, off = null, dtmUrl = null, basins = []) {
    this.inner = inner; this.box = box; this.off = off; this.dtmUrl = dtmUrl;
    // the LIDAR grid's layout (tools/openworld/dtm-grid.mjs: every 2 m from the box's north-west corner), so the near
    // tiles can be cut from 512 m blocks fetched on its own nodes (see dtmBlock)
    this.g0 = { w: box.w, n: box.n, dLat: 2 / 110540, dLon: 2 / (111320 * Math.cos((((box.s + box.n) / 2) * Math.PI) / 180)) };
    this.blocks = new Map();
    this.basins = (off == null ? [] : basins).map((b) => { let s = 90, n = -90, w = 180, e = -180; for (const [la, lo] of b.poly) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); } return { poly: b.poly, h: b.lv + off - 1.0, s, n, w, e }; });
    this.tilingScheme = inner.tilingScheme; this.credit = inner.credit; this.errorEvent = inner.errorEvent;
    this.hasWaterMask = false; this.hasVertexNormals = false; this.ready = true;
    // road segments in degrees, gridded (cell 0.0004 deg, ~30-45 m)
    this.k = Math.cos((((box.s + box.n) / 2) * Math.PI) / 180); this.mlat = 110540; this.mlon = 111320 * this.k;
    this.cell = 0.0004; this.grid = new Map(); this.segs = [];
    for (const r of roads) for (let i = 1; i < r.pts.length; i++) {
      const [a0, a1, ea] = r.pts[i - 1], [b0, b1, eb] = r.pts[i], n = this.segs.push([a0, a1, b0, b1, r.hw, ea, eb]) - 1, reach = (r.hw + 13) / this.mlat;
      for (let gx = Math.floor((Math.min(a1, b1) - reach) / this.cell); gx <= Math.floor((Math.max(a1, b1) + reach) / this.cell); gx++)
        for (let gy = Math.floor((Math.min(a0, b0) - reach) / this.cell); gy <= Math.floor((Math.max(a0, b0) + reach) / this.cell); gy++) {
          const key = gx + ',' + gy; if (!this.grid.has(key)) this.grid.set(key, []); this.grid.get(key).push(n);
        }
    }
    const self = this;
    this.availability = {
      computeMaximumLevelAtPosition(pos) { return self.inBoxDeg(C.Math.toDegrees(pos.latitude), C.Math.toDegrees(pos.longitude)) ? MAXL : inner.availability.computeMaximumLevelAtPosition(pos); },
      isTileAvailable(level, x, y) { return self.getTileDataAvailable(x, y, level); },
      computeChildMaskForTile(level, x, y) { return self.tileInBox(x, y, level + 1) && level < MAXL ? 15 : inner.availability.computeChildMaskForTile(level, x, y); },
      computeBestAvailableLevelOverRectangle(rect) { return inner.availability.computeBestAvailableLevelOverRectangle(rect); },
    };
  }
  inBoxDeg(lat, lon) { const b = this.box; return lat > b.s && lat < b.n && lon > b.w && lon < b.e; }
  tileInBox(x, y, level) { const r = this.tilingScheme.tileXYToRectangle(x, y, level), b = this.box; return C.Math.toDegrees(r.north) > b.s && C.Math.toDegrees(r.south) < b.n && C.Math.toDegrees(r.east) > b.w && C.Math.toDegrees(r.west) < b.e; }
  getLevelMaximumGeometricError(level) { return this.inner.getLevelMaximumGeometricError(level); }
  loadTileDataAvailability() { return undefined; }
  getTileDataAvailable(x, y, level) { if (this.tileInBox(x, y, level)) return level <= MAXL; return this.inner.getTileDataAvailable(x, y, level); }

  requestTileGeometry(x, y, level, request) {
    if (!this.tileInBox(x, y, level) || level < 12) return this.inner.requestTileGeometry(x, y, level, request);
    // the deepest real tile containing this one
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level), mid = C.Rectangle.center(rect);
    let L = Math.min(level, this.inner.availability.computeMaximumLevelAtPosition(mid));
    let ax = x, ay = y; for (let l = level; l > L; l--) { ax >>= 1; ay >>= 1; }
    while (L > 0 && !this.inner.getTileDataAvailable(ax, ay, L)) { ax >>= 1; ay >>= 1; L--; }
    // near tiles where the LIDAR covers the whole grid (and its margin): built from that alone, no wait for the coarse
    // terrain from the cloud (~200 ms a tile, and every one of its values would be overwritten anyway)
    if (this.dtmUrl && this.off != null && level >= BLOCK_LEVEL) {
      const dLon0 = (rect.east - rect.west) / (N - 1), dLat0 = (rect.north - rect.south) / (N - 1);
      return this.localDtm(rect, dLon0, dLat0).catch(() => null).then((real) => {
        if (real && !real.some((v) => v !== v)) return this.build(null, null, rect, level, real);
        return this.innerTile(ax, ay, L).then((data) => this.build(data, this.tilingScheme.tileXYToRectangle(ax, ay, L), rect, level, real));
      });
    }
    const p = this.inner.requestTileGeometry(ax, ay, L, request);
    if (!p) return undefined; // (throttled: Cesium asks again)
    // the real ground for this tile's grid (with its margin), fetched alongside the coarse tile
    const dLon = (rect.east - rect.west) / (N - 1), dLat = (rect.north - rect.south) / (N - 1);
    const g = this.dtmUrl && this.off != null && level >= BLOCK_LEVEL ? this.localDtm(rect, dLon, dLat).catch(() => null)
      : this.dtmUrl && this.off != null && level >= 13 ? fetch(`${this.dtmUrl}?n=${M}&r=${[rect.west - PAD * dLon, rect.south - PAD * dLat, rect.east + PAD * dLon, rect.north + PAD * dLat].map((v) => C.Math.toDegrees(v).toFixed(7)).join(',')}`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b && b.byteLength === M * M * 4 ? new Float32Array(b) : null)).catch(() => null) : Promise.resolve(null);
    return Promise.all([p, g]).then(([data, real]) => this.build(data, this.tilingScheme.tileXYToRectangle(ax, ay, L), rect, level, real));
  }

  // ---- the real ground in blocks (2026-11-23, the owner: the road "drawing late or staying blurred for too long") ----
  // Each terrain tile used to fetch its own 81 x 81 piece: the server answers in 0.4 ms, but hundreds of tiny requests
  // queued (median 293 ms, 10% over 524 ms, riding London) and Cesium refines a level at a time, so the near road took
  // 3-5 s to sharpen. Near tiles (level 16+, a few hundred metres) are now cut here from 128 x 128-cell blocks (256 m)
  // whose samples fall exactly on the grid's nodes, with the server's own bilinear sum, so the heights are the same as
  // before (to float rounding); blocks along the road ahead are fetched early (prefetch, from world.js). The coarse
  // distant tiles keep their single requests (a level-13 tile would need 36 blocks).
  // the coarse terrain's tile, once: levels 16-18 all fall back on the same deeper real tile
  innerTile(x, y, L) {
    const key = L + '/' + x + '/' + y; this.inner_ ||= new Map();
    let p = this.inner_.get(key);
    if (!p) {
      p = new Promise((ok, fail) => { const go = () => { const q = this.inner.requestTileGeometry(x, y, L); if (q) q.then(ok, fail); else setTimeout(go, 50); }; go(); }); // (undefined = throttled: try again shortly)
      p.catch(() => this.inner_.delete(key));
      this.inner_.set(key, p);
      while (this.inner_.size > 200) this.inner_.delete(this.inner_.keys().next().value);
    }
    return p;
  }
  dtmBlock(bi, bj) {
    const key = bi + ',' + bj; let b = this.blocks.get(key);
    if (b) { this.blocks.delete(key); this.blocks.set(key, b); return b; }
    const { w, n, dLat, dLon } = this.g0, x0 = w + bi * BLK * dLon, y1 = n - bj * BLK * dLat;
    b = fetch(`${this.dtmUrl}?n=${BLK + 1}&r=${[x0, y1 - BLK * dLat, x0 + BLK * dLon, y1].join(',')}`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => (buf ? new Float32Array(buf) : null));
    b.catch(() => this.blocks.delete(key));
    this.blocks.set(key, b);
    while (this.blocks.size > 96) this.blocks.delete(this.blocks.keys().next().value);
    return b;
  }
  prefetch(points) { // [[lat, lon]]: the blocks within ~150 m of each (the road ahead)
    if (!this.dtmUrl || this.off == null) return;
    const { w, n, dLat, dLon } = this.g0, seen = new Set();
    for (const [la, lo] of points) for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const bi = Math.floor(((lo + ox * 150 / this.mlon) - w) / dLon / BLK), bj = Math.floor((n - (la + oy * 150 / this.mlat)) / dLat / BLK), k = bi + ',' + bj;
      if (bi < 0 || bj < 0 || seen.has(k)) continue; seen.add(k); this.dtmBlock(bi, bj);
    }
  }
  // the same M x M sample lib/dtm.js would send for this tile (+ margin), from the blocks
  async localDtm(rect, dLonT, dLatT) {
    const D = C.Math.toDegrees, w = D(rect.west - PAD * dLonT), s = D(rect.south - PAD * dLatT), e = D(rect.east + PAD * dLonT), n = D(rect.north + PAD * dLatT);
    const g = this.g0, bx0 = Math.floor((w - g.w) / g.dLon / BLK), bx1 = Math.floor(((e - g.w) / g.dLon + 1) / BLK), by0 = Math.floor((g.n - n) / g.dLat / BLK), by1 = Math.floor(((g.n - s) / g.dLat + 1) / BLK);
    if (bx1 < 0 || by1 < 0 || (bx1 - bx0 + 1) * (by1 - by0 + 1) > 9) throw new Error('outside');
    const B = new Map();
    await Promise.all([...Array((bx1 - bx0 + 1) * (by1 - by0 + 1)).keys()].map(async (k) => { const bi = bx0 + (k % (bx1 - bx0 + 1)), bj = by0 + Math.floor(k / (bx1 - bx0 + 1)); B.set(bi + ',' + bj, bi < 0 || bj < 0 ? null : await this.dtmBlock(bi, bj)); }));
    const node = (ix, iy) => { const a = B.get(Math.floor(ix / BLK) + ',' + Math.floor(iy / BLK)); return a ? a[(iy - Math.floor(iy / BLK) * BLK) * (BLK + 1) + (ix - Math.floor(ix / BLK) * BLK)] : NaN; };
    const out = new Float32Array(M * M);
    for (let r = 0; r < M; r++) {
      const fy = (g.n - (n - ((n - s) * r) / (M - 1))) / g.dLat, y0 = Math.floor(fy), ty = fy - y0;
      for (let c = 0; c < M; c++) {
        const fx = (w + ((e - w) * c) / (M - 1) - g.w) / g.dLon, x0 = Math.floor(fx), tx = fx - x0;
        if (x0 < 0 || y0 < 0) { out[r * M + c] = NaN; continue; }
        const a = node(x0, y0), b = node(x0 + 1, y0), cc = node(x0, y0 + 1), d = node(x0 + 1, y0 + 1);
        out[r * M + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty; // (NaN if any is: no survey, as the server)
      }
    }
    return out;
  }

  // rasterise the real tile's triangles onto an M x M grid over our tile (plus margin), level the roads, keep N x N
  build(data, srcRect, rect, level, real = null) {
    const qv = data?._quantizedVertices, idx = data?._indices, hmin = data?._minimumHeight, hmax = data?._maximumHeight; // (data null: all from the LIDAR)
    const dLon = (rect.east - rect.west) / (N - 1), dLat = (rect.north - rect.south) / (N - 1);
    const west = rect.west - PAD * dLon, north = rect.north + PAD * dLat;
    const H = new Float32Array(M * M).fill(NaN);
    if (qv && idx) {
      const n = qv.length / 3, sw = srcRect.east - srcRect.west, sh = srcRect.north - srcRect.south;
      const gx = new Float64Array(n), gy = new Float64Array(n), gh = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const lon = srcRect.west + (qv[i] / 32767) * sw, lat = srcRect.south + (qv[n + i] / 32767) * sh;
        gx[i] = (lon - west) / dLon; gy[i] = (north - lat) / dLat; gh[i] = hmin + (qv[2 * n + i] / 32767) * (hmax - hmin);
      }
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const x0 = Math.max(0, Math.ceil(Math.min(gx[a], gx[b], gx[c]))), x1 = Math.min(M - 1, Math.floor(Math.max(gx[a], gx[b], gx[c])));
        const y0 = Math.max(0, Math.ceil(Math.min(gy[a], gy[b], gy[c]))), y1 = Math.min(M - 1, Math.floor(Math.max(gy[a], gy[b], gy[c])));
        if (x0 > x1 || y0 > y1) continue;
        const den = (gy[b] - gy[c]) * (gx[a] - gx[c]) + (gx[c] - gx[b]) * (gy[a] - gy[c]);
        if (Math.abs(den) < 1e-12) continue;
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
          const l1 = ((gy[b] - gy[c]) * (px - gx[c]) + (gx[c] - gx[b]) * (py - gy[c])) / den, l2 = ((gy[c] - gy[a]) * (px - gx[c]) + (gx[a] - gx[c]) * (py - gy[c])) / den, l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          H[py * M + px] = l1 * gh[a] + l2 * gh[b] + l3 * gh[c];
        }
      }
    }
    // gaps (the margin beyond the real tile): nearest filled value along the row, then the column
    for (let r = 0; r < M; r++) { let last = NaN; for (let c = 0; c < M; c++) { const v = H[r * M + c]; if (v === v) last = v; else if (last === last) H[r * M + c] = last; } last = NaN; for (let c = M - 1; c >= 0; c--) { const v = H[r * M + c]; if (v === v) last = v; else if (last === last) H[r * M + c] = last; } }
    for (let c = 0; c < M; c++) { let last = NaN; for (let r = 0; r < M; r++) { const v = H[r * M + c]; if (v === v) last = v; else if (last === last) H[r * M + c] = last; } last = NaN; for (let r = M - 1; r >= 0; r--) { const v = H[r * M + c]; if (v === v) last = v; else if (last === last) H[r * M + c] = last; } }
    // the real ground (LIDAR, + the area's offset) wherever the survey has it; its rows run from the north edge like H's
    if (real) for (let i = 0; i < M * M; i++) { const v = real[i]; if (v === v) H[i] = v + this.off; }
    const at = (lon, lat) => { // bilinear in the grid (radians in)
      const fx = Math.max(0, Math.min(M - 1.001, (lon - west) / dLon)), fy = Math.max(0, Math.min(M - 1.001, (north - lat) / dLat)), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
      const v = (i, j) => H[j * M + i]; return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty;
    };
    // level the roads (at levels where the grid is fine enough to see it: ~2.5 m spacing or better)
    const out = new Float32Array(N * N);
    // big water basins (London): per row, where the row crosses each basin's outline (scanline), so the inside test per
    // sample is a few comparisons; a point-in-polygon per sample against the Thames' 3,761 points took 75% of the CPU
    const tileBas = [];
    if (this.basins.length) {
      const tS = C.Math.toDegrees(rect.south), tN = C.Math.toDegrees(rect.north), tW = C.Math.toDegrees(rect.west), tE = C.Math.toDegrees(rect.east);
      for (const b of this.basins) {
        if (b.n < tS || b.s > tN || b.e < tW || b.w > tE) continue;
        const rows = [];
        for (let r = 0; r < N; r++) {
          const lat = C.Math.toDegrees(rect.north - r * dLat), xs = [];
          if (lat > b.s && lat < b.n) for (let i = 0, j = b.poly.length - 1; i < b.poly.length; j = i++) { const [yi, xi] = b.poly[i], [yj, xj] = b.poly[j]; if ((yi > lat) !== (yj > lat)) xs.push(xi + ((xj - xi) * (lat - yi)) / (yj - yi)); }
          rows.push(xs.sort((p, q) => p - q));
        }
        tileBas.push({ h: b.h, rows });
      }
    }
    const spacing = dLat * (180 / Math.PI) * this.mlat;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const lon = rect.west + c * dLon, lat = rect.north - r * dLat; let h = H[(r + PAD) * M + c + PAD];
      if (spacing < 3) {
        const dlon = C.Math.toDegrees(lon), dlat = C.Math.toDegrees(lat), list = this.grid.get(Math.floor(dlon / this.cell) + ',' + Math.floor(dlat / this.cell));
        if (list) {
          let best = null;
          for (const sI of list) {
            const [a0, a1, b0, b1, hw, ea, eb] = this.segs[sI], ax = (a1 - dlon) * this.mlon, ay = (a0 - dlat) * this.mlat, bx = (b1 - dlon) * this.mlon, by = (b0 - dlat) * this.mlat;
            const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)), px = ax + vx * t, py = ay + vy * t, d = Math.hypot(px, py) - hw;
            if (d < 12 && (!best || d < best.d)) { const L = Math.sqrt(L2); best = { d, px, py, ux: vx / L, uy: vy / L, e: Number.isFinite(ea) && Number.isFinite(eb) ? ea + (eb - ea) * t : null }; }
          }
          if (best) {
            // the road's height here: its LIDAR height + the area's offset (else the ground at its centre over 8 m)
            let hc;
            if (best.e != null && this.off != null) hc = best.e + this.off;
            else { hc = 0; for (const s of [-4, 0, 4]) hc += at(C.Math.toRadians(dlon + (best.px + best.ux * s) / this.mlon), C.Math.toRadians(dlat + (best.py + best.uy * s) / this.mlat)); hc /= 3; }
            const ease = Math.min(12, 2.5 + 1.5 * Math.abs(h - hc));
            if (best.d < ease) { const t = best.d <= 0 ? 0 : best.d / ease, w = t * t * (3 - 2 * t); h = hc + (h - hc) * w; }
          }
        }
      }
      if (tileBas.length) { const dlon = C.Math.toDegrees(lon); for (const b of tileBas) { if (h <= b.h) continue; const xs = b.rows[r]; let k = 0; while (k < xs.length && xs[k] < dlon) k++; if (k % 2) h = b.h; } }
      out[r * N + c] = h;
    }
    let mn = Infinity, mx = -Infinity; for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
    return new C.HeightmapTerrainData({ buffer: out, width: N, height: N, childTileMask: level < MAXL ? 15 : 0, structure: { heightScale: 1, heightOffset: 0, elementsPerHeight: 1, stride: 1, elementMultiplier: 256, isBigEndian: false, lowestEncodedHeight: mn - 1, highestEncodedHeight: mx + 1 } });
  }
}
