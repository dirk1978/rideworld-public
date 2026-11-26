// Trees outside England, from Meta / WRI's global canopy height map (2026-11-14, the owner: "any option for non uk
// routes?"): tree height in whole metres, ~1.2 m pixels, made from satellite imagery, free on AWS
// (dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/<quadkey at zoom 9>.tif, Web Mercator, 65536 x 65536,
// one deflated row per strip). Only the rows a route's corridor crosses are fetched (HTTP Range) and cached
// (META_CACHE); then crowns are found as in canopy.mjs (local maxima, mapped buildings left out). For lib/world.js.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const BASE = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/';
const CACHE = process.env.META_CACHE || path.join(os.tmpdir(), 'rideworld-meta');
const R = 6378137, HALF = Math.PI * R;
const quadkey = (x, y, z) => { let q = ''; for (let i = z; i > 0; i--) { let d = 0; const m = 1 << (i - 1); if (x & m) d++; if (y & m) d += 2; q += d; } return q; };
const merc = (lat, lon) => [(lon * HALF) / 180, Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * R];
const unmerc = (x, y) => [(Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90, (x / HALF) * 180];

async function range(url, from, len) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + len - 1}` } });
      if (r.status === 206) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404 || r.status === 403) throw Object.assign(new Error(`${r.status} ${url}`), { fatal: true });
      throw new Error(`${r.status}`);
    } catch (e) { if (e.fatal || k >= 5) throw e; await new Promise((ok) => setTimeout(ok, 2000 * (k + 1))); }
  }
}

// one z9 file: header (strip offsets / sizes, georeference), then rows on demand
const files = new Map();
async function open(qk) {
  if (files.has(qk)) return files.get(qk);
  const job = (async () => {
    const url = BASE + qk + '.tif', dir = path.join(CACHE, qk);
    fs.mkdirSync(dir, { recursive: true });
    const hf = path.join(dir, 'header.bin');
    const head = fs.existsSync(hf) ? fs.readFileSync(hf) : await range(url, 0, 1049400);
    if (!fs.existsSync(hf)) fs.writeFileSync(hf, head);
    const u16 = (o) => head.readUInt16LE(o), u64 = (o) => Number(head.readBigUInt64LE(o));
    const ifd = u64(8), n = u64(ifd), tags = {};
    for (let i = 0; i < n; i++) { const o = ifd + 8 + i * 20; tags[u16(o)] = { type: u16(o + 2), cnt: u64(o + 4), at: o + 12 }; }
    const W = Number(head.readUInt32LE(tags[256].at)), H = Number(head.readUInt32LE(tags[257].at));
    const offAt = u64(tags[273].at), cntAt = u64(tags[279].at);
    const offs = (r) => u64(offAt + r * 8), lens = (r) => u64(cntAt + r * 8);
    const scale = [head.readDoubleLE(u64(tags[33550].at)), head.readDoubleLE(u64(tags[33550].at) + 8)];
    const tp = u64(tags[33922].at), X0 = head.readDoubleLE(tp + 24), Y0 = head.readDoubleLE(tp + 32);
    const pred = tags[317] ? u16(tags[317].at) : 1;
    return { url, dir, W, H, offs, lens, scale, X0, Y0, pred, rows: new Map() };
  })();
  files.set(qk, job);
  return job;
}
// rows r0..r1 (inclusive) of a file, decoded (Uint8Array per row), fetched in runs of contiguous strips
async function rows(f, r0, r1) {
  const need = [];
  for (let r = r0; r <= r1; r++) if (!f.rows.has(r)) need.push(r);
  for (let i = 0; i < need.length;) {
    let j = i;
    while (j + 1 < need.length && need[j + 1] === need[j] + 1 && f.offs(need[j + 1]) === f.offs(need[j]) + f.lens(need[j]) && j - i < 400) j++;
    const a = need[i], b = need[j], cf = path.join(f.dir, `r${a}-${b}.bin`);
    const from = f.offs(a), len = f.offs(b) + f.lens(b) - from;
    const buf = fs.existsSync(cf) ? fs.readFileSync(cf) : await range(f.url, from, len);
    if (!fs.existsSync(cf)) fs.writeFileSync(cf, buf);
    for (let r = a; r <= b; r++) {
      const o = f.offs(r) - from, raw = zlib.inflateSync(buf.subarray(o, o + f.lens(r)));
      const row = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
      if (f.pred === 2) for (let c = 1; c < row.length; c++) row[c] = (row[c] + row[c - 1]) & 255;
      f.rows.set(r, row);
    }
    i = j + 1;
  }
  return (r) => f.rows.get(r);
}

// route: [{ lat, lon }] (~every 20 m); buildings: [[[lat, lon], ...]]; -> [[lat, lon, height, crown radius]]
export async function metaTrees(route, buildings = [], { band = 80, near = 25, log = () => {} } = {}) {
  const Z = 9, n = 2 ** Z, lat0 = route[0].lat, k = Math.cos((lat0 * Math.PI) / 180); // mercator metres -> ground metres
  const M = route.map((p) => merc(p.lat, p.lon));
  const bandM = band / k;
  const out = [];
  // which z9 files, and the corridor's rows in each, in blocks of 512 rows
  const files2 = new Map();
  for (const [x, y] of M) for (const dx of [-bandM, bandM]) for (const dy of [-bandM, bandM]) {
    const tx = Math.floor(((x + dx + HALF) / (2 * HALF)) * n), ty = Math.floor(((HALF - (y + dy)) / (2 * HALF)) * n), q = quadkey(tx, ty, Z);
    if (!files2.has(q)) files2.set(q, true);
  }
  const B = buildings.map((pts) => { const q = pts.map(([la, lo]) => merc(la, lo)); return { q, x0: Math.min(...q.map((v) => v[0])) - 1.5 / k, x1: Math.max(...q.map((v) => v[0])) + 1.5 / k, y0: Math.min(...q.map((v) => v[1])) - 1.5 / k, y1: Math.max(...q.map((v) => v[1])) + 1.5 / k }; });
  const inPoly = (q, x, y) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  for (const qk of files2.keys()) {
    let f;
    try { f = await open(qk); } catch (e) { log(`${qk}: ${e.message}`); continue; }
    const px = f.scale[0], py = f.scale[1];
    const col = (x) => Math.floor((x - f.X0) / px), row = (y) => Math.floor((f.Y0 - y) / py);
    // the corridor in this file, block by block (512 rows) so memory stays small
    const pts = M.filter(([x, y]) => col(x) > -200 && col(x) < f.W + 200 && row(y) > -200 && row(y) < f.H + 200);
    if (!pts.length) continue;
    const BL = 512, blocks = new Set();
    for (const [x, y] of pts) for (const dy of [-bandM, 0, bandM]) { const r = row(y + dy); if (r >= 0 && r < f.H) blocks.add(Math.floor(r / BL)); }
    for (const blk of [...blocks].sort((a, b) => a - b)) {
      const r0 = Math.max(0, blk * BL - 8), r1 = Math.min(f.H - 1, blk * BL + BL + 7);
      const segs = [];
      for (let i = 1; i < M.length; i++) { const a = M[i - 1], b = M[i]; const ra = row(a[1]), rb = row(b[1]); if (Math.max(ra, rb) >= r0 - bandM / py && Math.min(ra, rb) <= r1 + bandM / py) segs.push([a, b]); }
      if (!segs.length) continue;
      const c0 = Math.max(0, Math.min(...segs.flatMap(([a, b]) => [col(a[0]), col(b[0])])) - Math.ceil(bandM / px) - 8);
      const c1 = Math.min(f.W - 1, Math.max(...segs.flatMap(([a, b]) => [col(a[0]), col(b[0])])) + Math.ceil(bandM / px) + 8);
      if (c1 - c0 < 8) continue; // (the route only grazes this file's edge here: segments from beside it pushed the columns past it)
      const get = await rows(f, r0, r1);
      const w = c1 - c0 + 1, h = r1 - r0 + 1, chm = new Float32Array(w * h);
      // distance to the route (ground metres) on a 6-pixel grid
      const G = 6, gw = Math.ceil(w / G), gh = Math.ceil(h / G), gd = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        const x = f.X0 + (c0 + gx * G + G / 2) * px, y = f.Y0 - (r0 + gy * G + G / 2) * py;
        let m = Infinity;
        for (const [a, b] of segs) { const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2)); m = Math.min(m, Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y)); }
        gd[gy * gw + gx] = m * k;
      }
      const dist = (c, r) => gd[Math.floor(r / G) * gw + Math.floor(c / G)];
      const bs = B.filter((b) => b.x1 > f.X0 + c0 * px && b.x0 < f.X0 + c1 * px && b.y1 > f.Y0 - r1 * py && b.y0 < f.Y0 - r0 * py);
      for (let r = 0; r < h; r++) {
        const src = get(r0 + r);
        if (!src) continue;
        for (let c = 0; c < w; c++) {
          const v = src[c0 + c];
          if (v < 3 || v > 60 || dist(c, r) > band) continue;
          const x = f.X0 + (c0 + c + 0.5) * px, y = f.Y0 - (r0 + r + 0.5) * py;
          if (bs.length && bs.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && inPoly(b.q, x, y))) continue;
          chm[r * w + c] = v;
        }
      }
      // crowns: local maxima over a radius growing with height (in pixels of ~px*k m), canopy round them
      const gpx = px * k;
      for (let r = 8; r < h - 8; r++) {
        if (r0 + r < blk * BL || r0 + r >= blk * BL + BL) continue; // (each row's crowns from its own block only)
        for (let c = 3; c < w - 3; c++) {
          const hh = chm[r * w + c];
          if (hh < 4) continue;
          const rad = Math.max(2, Math.min(5, Math.round((1.5 + 0.12 * hh) / gpx)));
          let top = true, filled = 0, cells = 0;
          for (let y = -rad; y <= rad && top; y++) for (let x = -rad; x <= rad; x++) {
            if (x * x + y * y > rad * rad) continue;
            const v = chm[(r + y) * w + c + x] || 0;
            cells++; if (v > 0) filled++;
            if (v > hh || (v === hh && (y < 0 || (y === 0 && x < 0)))) { top = false; break; }
          }
          if (!top || filled < cells * 0.4) continue;
          const d = dist(c, r), keep = d < near ? 1 : d < 50 ? 0.55 : 0.3;
          const hash = ((c0 + c) * 83492791 ^ (r0 + r) * 2654435761) >>> 0;
          if ((hash % 1000) / 1000 > keep) continue;
          const [la, lo] = unmerc(f.X0 + (c0 + c + 0.5) * px, f.Y0 - (r0 + r + 0.5) * py);
          out.push([+la.toFixed(6), +lo.toFixed(6), hh, +Math.max(1.5, Math.min(7, 0.28 * hh + 0.8)).toFixed(1)]);
        }
      }
      for (let r = r0; r <= r1; r++) f.rows.delete(r); // (memory)
      log(`${qk} block ${blk}: ${out.length} trees so far`);
    }
  }
  return out;
}

// canopy height (m) at points, for checking alignment: [[lat, lon]] -> [h]
export async function sample(points) {
  const out = [];
  for (const [lat, lon] of points) {
    const [x, y] = merc(lat, lon), n = 2 ** 9;
    const tx = Math.floor(((x + HALF) / (2 * HALF)) * n), ty = Math.floor(((HALF - y) / (2 * HALF)) * n);
    const f = await open(quadkey(tx, ty, 9)), c = Math.floor((x - f.X0) / f.scale[0]), r = Math.floor((f.Y0 - y) / f.scale[1]);
    const get = await rows(f, r, r);
    out.push(get(r)?.[c] ?? NaN);
  }
  return out;
}
