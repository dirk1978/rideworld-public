// Heights out of a tiled GeoTIFF on a web server, fetching only the parts needed (HTTP Range): the header, the
// tile index entries and the 256x256 tiles a route passes over. Used for Wales's 1 m terrain model (one 48 GB
// cloud-optimised file) and Scotland's LIDAR tiles (welsh.mjs, scotland.mjs). Classic TIFF and BigTIFF, float32 or
// 16-bit, uncompressed, deflate or LZW, no predictor or horizontal predictor. Tiles are kept on disk ($COG_CACHE).
//   const t = await openTiff(url); t.value(x, y)   (x, y in the file's projected coordinates; NaN outside / no data)
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

const CACHE = process.env.COG_CACHE || path.join(os.tmpdir(), 'rideworld-cog');
fs.mkdirSync(CACHE, { recursive: true });
const opened = new Map();

async function range(url, from, len) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + len - 1}` } });
      if (r.status === 206 || r.status === 200) { const b = Buffer.from(await r.arrayBuffer()); return r.status === 200 ? b.subarray(from, from + len) : b; }
      if (r.status === 404 || r.status === 403) throw Object.assign(new Error(`${r.status} ${url}`), { fatal: true });
      throw new Error(`${r.status} ${url}`);
    } catch (e) { if (e.fatal || k >= 4) throw e; await new Promise((ok) => setTimeout(ok, 1500 * (k + 1))); }
  }
}

// LZW as TIFF writes it (MSB-first codes, 9-12 bits, early change)
function lzw(src, size) {
  const out = Buffer.alloc(size);
  let o = 0, bit = 0, width = 9, dict = [], prev = null;
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict[i] = [i]; dict[256] = dict[257] = null; width = 9; };
  const code = () => { let v = 0; for (let i = 0; i < width; i++) { const b = src[(bit >> 3)]; v = (v << 1) | ((b >> (7 - (bit & 7))) & 1); bit++; } return v; };
  reset();
  while ((bit + width) <= src.length * 8 && o < size) {
    const c = code();
    if (c === 257) break;
    if (c === 256) { reset(); prev = null; continue; }
    let entry;
    if (c < dict.length && dict[c]) entry = dict[c];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    for (const v of entry) { if (o < size) out[o++] = v; }
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

export async function openTiff(url) {
  if (opened.has(url)) return opened.get(url);
  const p = (async () => {
    const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16), dir = path.join(CACHE, id);
    fs.mkdirSync(dir, { recursive: true });
    const hf = path.join(dir, 'head.bin');
    let head;
    if (fs.existsSync(hf)) head = fs.readFileSync(hf);
    else { head = await range(url, 0, 65536); fs.writeFileSync(hf, head); }
    const le = head[0] === 0x49, u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    const u64 = (b, o) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)), f64 = (b, o) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));
    const big = u16(head, 2) === 43;
    const ifd = big ? u64(head, 8) : u32(head, 4);
    const n = big ? u64(head, ifd) : u16(head, ifd), tags = {};
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8 };
    for (let i = 0; i < n; i++) {
      const e = ifd + (big ? 8 : 2) + i * (big ? 20 : 12), tag = u16(head, e), type = u16(head, e + 2), count = big ? u64(head, e + 4) : u32(head, e + 4);
      const vo = e + (big ? 12 : 8), inline = SZ[type] * count <= (big ? 8 : 4);
      tags[tag] = { type, count, at: inline ? vo : (big ? u64(head, vo) : u32(head, vo)), inline };
    }
    const scalar = (t) => { const g = tags[t]; if (!g) return undefined; return g.type === 3 ? u16(head, g.at) : g.type === 16 ? u64(head, g.at) : u32(head, g.at); };
    const doubles = (t) => { const g = tags[t]; const out = []; for (let i = 0; i < g.count; i++) out.push(f64(head, g.at + i * 8)); return out; };
    const W = scalar(256), H = scalar(257), TW = scalar(322), TH = scalar(323), comp = scalar(259) || 1, pred = scalar(317) || 1, fmt = scalar(339) || 1, bits = scalar(258);
    if (!TW) throw new Error('not a tiled TIFF: ' + url);
    const [sx, sy] = doubles(33550), tie = doubles(33922), x0 = tie[3] - tie[0] * sx, y0 = tie[4] + tie[1] * sy;
    let nodata = NaN;
    if (tags[42113]) nodata = parseFloat(head.toString('latin1', tags[42113].at, tags[42113].at + tags[42113].count).replace(/\0.*$/, ''));
    const across = Math.ceil(W / TW), offT = tags[324], cntT = tags[325], offSz = offT.type === 16 ? 8 : 4, cntSz = cntT.type === 16 ? 8 : cntT.type === 3 ? 2 : 4;
    const entry = async (g, sz, i) => {
      if (g.inline) return sz === 8 ? u64(head, g.at + i * 8) : u32(head, g.at + i * 4);
      const at = g.at + i * sz;
      const b = at + sz <= head.length ? head.subarray(at, at + sz) : await range(url, at, sz);
      return sz === 8 ? u64(b, 0) : sz === 2 ? u16(b, 0) : u32(b, 0);
    };
    const tiles = new Map();
    const tile = (tx, ty) => {
      const key = `${tx}-${ty}`;
      if (!tiles.has(key)) tiles.set(key, (async () => {
        const f = path.join(dir, key + '.bin');
        let raw;
        if (fs.existsSync(f)) raw = fs.readFileSync(f);
        else {
          const i = ty * across + tx, off = await entry(offT, offSz, i), cnt = await entry(cntT, cntSz, i);
          if (!off || !cnt) raw = Buffer.alloc(0);
          else {
            const z = await range(url, off, cnt), size = TW * TH * (bits / 8);
            raw = comp === 1 ? z : comp === 8 || comp === 32946 ? zlib.inflateSync(z) : comp === 5 ? lzw(z, size) : null;
            if (!raw) throw new Error(`TIFF compression ${comp} not supported`);
          }
          fs.writeFileSync(f, raw);
        }
        if (!raw.length) return null;
        const v = new Float32Array(TW * TH);
        const rd = bits === 32 ? (fmt === 3 ? (o) => (le ? raw.readFloatLE(o) : raw.readFloatBE(o)) : (o) => (le ? raw.readInt32LE(o) : raw.readInt32BE(o)))
          : fmt === 2 ? (o) => (le ? raw.readInt16LE(o) : raw.readInt16BE(o)) : (o) => u16(raw, o);
        for (let k = 0; k < TW * TH; k++) v[k] = rd(k * (bits / 8));
        if (pred === 2) for (let r = 0; r < TH; r++) for (let c = 1; c < TW; c++) v[r * TW + c] += v[r * TW + c - 1];
        return v;
      })());
      return tiles.get(key);
    };
    // bilinear between the 4 nearest cells (cell centres), any of them missing -> nearest valid
    const cell = async (c, r) => {
      if (c < 0 || r < 0 || c >= W || r >= H) return NaN;
      const t = await tile(Math.floor(c / TW), Math.floor(r / TH));
      if (!t) return NaN;
      const v = t[(r % TH) * TW + (c % TW)];
      return v === nodata || !Number.isFinite(v) || v < -1000 ? NaN : v;
    };
    const value = async (x, y) => {
      const fc = (x - x0) / sx - 0.5, fr = (y0 - y) / sy - 0.5, c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, ty = fr - r;
      const q = [await cell(c, r), await cell(c + 1, r), await cell(c, r + 1), await cell(c + 1, r + 1)];
      if (q.every(Number.isFinite)) return (q[0] * (1 - tx) + q[1] * tx) * (1 - ty) + (q[2] * (1 - tx) + q[3] * tx) * ty;
      const near = q[(ty > 0.5 ? 2 : 0) + (tx > 0.5 ? 1 : 0)];
      return Number.isFinite(near) ? near : (q.find(Number.isFinite) ?? NaN);
    };
    return { value, bbox: [x0, y0 - H * sy, x0 + W * sx, y0], res: sx };
  })();
  opened.set(url, p);
  p.catch(() => opened.delete(url));
  return p;
}
