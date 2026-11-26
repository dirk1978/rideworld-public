// Victoria Ground's real slope for tools/kit/bromsgrove.py victoria_ground (2026-11-22, the owner: "the pitch is notoriously
// sloping"): the Environment Agency ground model (DTM) on a 9 x 6 grid over the pitch, metres above the ground at the
// landmark's point (landmarks.mjs places the model's z = 0 there). Writes tools/kit/vg-heights.json.
//   node tools/kit/vg-heights.mjs
import fs from 'fs';
process.env.LIDAR_CACHE ||= './data/cache/lidar';
const { toBNG, heightAt } = await import('../routes/bristol/lidar.mjs');
const la = 52.3396307, lo = -2.05641995, K = 111320 * Math.cos((la * Math.PI) / 180);
const A = [-52.3, -21.5], B = [-1.6, 58.4], D = [1.4, -58.3];
const H = async (x, y) => { const { E, N } = toBNG(la + y / 110540, lo + x / K); return heightAt('dtm', E, N); };
const h0 = await H(0, 0), NU = 9, NV = 6, grid = [];
for (let i = 0; i < NU; i++) { const row = []; for (let j = 0; j < NV; j++) { const s = i / (NU - 1), t = j / (NV - 1); row.push(+((await H(A[0] + (B[0] - A[0]) * s + (D[0] - A[0]) * t, A[1] + (B[1] - A[1]) * s + (D[1] - A[1]) * t)) - h0).toFixed(2)); } grid.push(row); }
fs.writeFileSync(new URL('./vg-heights.json', import.meta.url), JSON.stringify({ nu: NU, nv: NV, grid }));
console.log('ground at the point', h0.toFixed(2), 'grid (u rows from the south-west end):'); for (const r of grid) console.log(r.join(' '));
