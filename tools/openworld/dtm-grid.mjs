// The real ground for an open world (2026-11-17, the owner: the first of "real ground shape, building heights..."): the
// Environment Agency LIDAR ground model (DTM, from data/cache/lidar: survey-import.mjs / the WCS) resampled onto a
// lat/lon grid every 2 m over the world's box, heights in centimetres above Ordnance Datum as Uint16 (65535 = no data).
// Written to data/world/<id>.dtm: a 256-byte JSON header (box, nx, ny), then the rows from the north edge. lib/dtm.js
// serves pieces of it (GET /api/dtm/<id>) and flatterrain.js builds the terrain tiles from them.
//   node tools/openworld/dtm-grid.mjs <id> [step metres, default 2]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { heightAt, toBNG } = await import('../routes/bristol/lidar.mjs');
const [id, stepArg] = process.argv.slice(2);
if (!id) { console.error('usage: dtm-grid.mjs <world id> [step m]'); process.exit(1); }
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world', id + '.json'), 'utf8'));
const box = W.roads.box, step = +stepArg || 2;
const dLat = step / 110540, dLon = step / (111320 * Math.cos((((box.s + box.n) / 2) * Math.PI) / 180));
const nx = Math.ceil((box.e - box.w) / dLon) + 1, ny = Math.ceil((box.n - box.s) / dLat) + 1;
console.log(`grid ${nx} x ${ny} (${((nx * ny * 2) / 1e6).toFixed(0)} MB)`);
const out = new Uint16Array(nx * ny), BASE = 100; // (stored as cm above -100 m: heights -100..555 m)
let missing = 0; const t0 = Date.now();
for (let r = 0; r < ny; r++) {
  const lat = box.n - r * dLat;
  // (British National Grid exactly every 32 samples, straight between: over 64 m the projection is flat to well under a cm)
  let prev = null;
  for (let c = 0; c < nx; c += 32) {
    const c1 = Math.min(nx - 1, c + 32), A = prev || toBNG(lat, box.w + c * dLon), B = toBNG(lat, box.w + c1 * dLon); prev = B;
    for (let k = c; k < c1 || (k === c1 && c1 === nx - 1); k++) {
      const t = c1 === c ? 0 : (k - c) / (c1 - c), E = A.E + (B.E - A.E) * t, N = A.N + (B.N - A.N) * t;
      let h; try { h = await heightAt('dtm', E, N); } catch { h = NaN; }
      if (Number.isFinite(h) && h > -BASE && h < 655 - BASE) out[r * nx + k] = Math.round((h + BASE) * 100); else { out[r * nx + k] = 65535; missing++; } // (+BASE: London's foreshore is below datum; unsigned cm wrapped to ~650 m walls)
      if (k === c1) break;
    }
  }
  if (r % 500 === 0) console.log(`row ${r} / ${ny}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const head = Buffer.alloc(256, 0x20); head.write(JSON.stringify({ v: 2, s: box.s, w: box.w, n: box.n, e: box.e, nx, ny, dLat, dLon, step, unit: 'cm ODN', base: BASE, nodata: 65535 }));
const f = path.join(ROOT, 'data', 'world', id + '.dtm');
fs.writeFileSync(f + '.tmp', Buffer.concat([head, Buffer.from(out.buffer)]), { mode: 0o600 }); fs.renameSync(f + '.tmp', f);
console.log(`written ${f}: ${(fs.statSync(f).size / 1e6).toFixed(0)} MB, ${((missing / (nx * ny)) * 100).toFixed(1)}% without data, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
