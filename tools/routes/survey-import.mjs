// Bulk LIDAR into the tile cache (2026-11-15): the Environment Agency's survey download page
// (https://environment.data.gov.uk/survey) gives 5 x 5 km GeoTIFFs (float32, LZW, 128 px tiles, 1 m cells,
// e.g. SO96nw_DTM_1m.tif + .tfw). Fetching the same ground through the WCS is ~200 rate-limited requests per square;
// this cuts each file into the 500 m tiles lidar.mjs caches (`dtm-<E/500>-<N/500>.tif`, uncompressed), skipping tiles
// already there.   node tools/routes/survey-import.mjs dtm|dsm <file.tif> [...]   (LIDAR_CACHE, default data/cache/lidar)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CACHE = process.env.LIDAR_CACHE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cache', 'lidar');
const [kind, ...files] = process.argv.slice(2);
if (!/^(dtm|dsm)$/.test(kind || '') || !files.length) { console.error('usage: survey-import.mjs dtm|dsm <file.tif> ...'); process.exit(1); }

// TIFF LZW (MSB-first codes, 256 = clear, 257 = end, code width grows one early)
function lzw(src) {
  const out = []; let dict = [], width = 9, prev = null, bit = 0;
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict[i] = [i]; dict[256] = null; dict[257] = null; width = 9; prev = null; };
  reset();
  const total = src.length * 8;
  while (bit + width <= total) {
    let code = 0;
    for (let k = 0; k < width; k++) { const b = bit + k; code = (code << 1) | ((src[b >> 3] >> (7 - (b & 7))) & 1); }
    bit += width;
    if (code === 257) break;
    if (code === 256) { reset(); continue; }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);
    else break;
    for (const v of entry) out.push(v);
    if (prev) dict.push(prev.concat(entry[0]));
    prev = entry;
    if (dict.length + 1 >= (1 << width) && width < 12) width++;
  }
  return Uint8Array.from(out);
}

function readBig(file) {
  const b = fs.readFileSync(file);
  const le = b.toString('latin1', 0, 2) === 'II', u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = u32(4), n = u16(ifd), tags = {};
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, tag = u16(o), type = u16(o + 2), cnt = u32(o + 4), size = { 3: 2, 4: 4, 12: 8 }[type] || 1;
    const vo = cnt * size > 4 ? u32(o + 8) : o + 8;
    tags[tag] = Array.from({ length: Math.min(cnt, 100000) }, (_, k) => (type === 3 ? u16(vo + k * 2) : type === 4 ? u32(vo + k * 4) : type === 12 ? (le ? b.readDoubleLE(vo + k * 8) : b.readDoubleBE(vo + k * 8)) : b[vo + k]));
  }
  const W = tags[256][0], H = tags[257][0], comp = tags[259]?.[0] ?? 1, pred = tags[317]?.[0] ?? 1;
  if (tags[258][0] !== 32 || !tags[324]) throw new Error('expected 32-bit tiled TIFF');
  if (comp !== 5 && comp !== 1) throw new Error('compression ' + comp);
  if (pred !== 1) throw new Error('predictor ' + pred);
  const tw = tags[322][0], th = tags[323][0], across = Math.ceil(W / tw), offs = tags[324], lens = tags[325];
  const data = new Float32Array(W * H).fill(NaN);
  offs.forEach((off, i) => {
    const raw = comp === 5 ? lzw(b.subarray(off, off + lens[i])) : b.subarray(off, off + lens[i]);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const c0 = (i % across) * tw, r0 = Math.floor(i / across) * th;
    for (let r = 0; r < th && r0 + r < H; r++) for (let c = 0; c < tw && c0 + c < W; c++) { const o = (r * tw + c) * 4; if (o + 4 <= raw.length) data[(r0 + r) * W + c0 + c] = dv.getFloat32(o, le); }
  });
  // top-left corner: the .tfw (cell centres) if there is one, else the GeoTIFF tie point + scale
  let E0, N1;
  const tfw = file.replace(/\.tif$/i, '.tfw');
  if (fs.existsSync(tfw)) { const v = fs.readFileSync(tfw, 'utf8').trim().split(/\s+/).map(Number); E0 = v[4] - v[0] / 2; N1 = v[5] - v[3] / 2; }
  else { const tp = tags[33922], sc = tags[33550]; E0 = tp[3] - tp[0] * sc[0]; N1 = tp[4] + tp[1] * sc[1]; }
  return { W, H, data, E0: Math.round(E0), N1: Math.round(N1) };
}

// a plain 500 x 500 float32 TIFF, one strip (what lidar.mjs readTiff reads)
function writeTile(f, d) {
  const n = 10, ifdAt = 8, dataAt = ifdAt + 2 + n * 12 + 4, buf = Buffer.alloc(dataAt + d.length * 4);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdAt, 4); buf.writeUInt16LE(n, ifdAt);
  const tags = [[256, 3, 500], [257, 3, 500], [258, 3, 32], [259, 3, 1], [262, 3, 1], [273, 4, dataAt], [277, 3, 1], [278, 3, 500], [279, 4, d.length * 4], [339, 3, 3]];
  tags.forEach(([t, ty, v], i) => { const o = ifdAt + 2 + i * 12; buf.writeUInt16LE(t, o); buf.writeUInt16LE(ty, o + 2); buf.writeUInt32LE(1, o + 4); if (ty === 3) buf.writeUInt16LE(v, o + 8); else buf.writeUInt32LE(v, o + 8); });
  for (let i = 0; i < d.length; i++) buf.writeFloatLE(Number.isFinite(d[i]) && d[i] > -1000 ? d[i] : -3.4028234663852886e38, dataAt + i * 4);
  fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f);
}

fs.mkdirSync(CACHE, { recursive: true });
for (const file of files) {
  const t0 = Date.now(), big = readBig(file);
  let made = 0, kept = 0;
  for (let r0 = 0; r0 + 500 <= big.H; r0 += 500) for (let c0 = 0; c0 + 500 <= big.W; c0 += 500) {
    const tx = (big.E0 + c0) / 500, ty = (big.N1 - r0 - 500) / 500;
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error(`${file}: not on the 500 m grid (${big.E0}, ${big.N1})`);
    const f = path.join(CACHE, `${kind}-${tx}-${ty}.tif`);
    if (fs.existsSync(f)) { kept++; continue; }
    const d = new Float32Array(250000);
    for (let r = 0; r < 500; r++) d.set(big.data.subarray((r0 + r) * big.W + c0, (r0 + r) * big.W + c0 + 500), r * 500);
    writeTile(f, d); made++;
  }
  console.log(path.basename(file), `${big.W}x${big.H} at E${big.E0} N${big.N1}:`, made, 'tiles written,', kept, 'already cached,', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
