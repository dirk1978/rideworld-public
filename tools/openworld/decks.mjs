// Bridge decks for an open world (2026-11-15, the owner: "there's a canal here with a humpback bridge", "please can I have
// the nice real bridge here?"): the ground model (DTM) has the canal / railway under a bridge, so build.mjs made bridges
// straight between their ends. The first-return surface (DSM) has the deck itself: sampled along each bridge, cleaned
// (median of 5, at most 1.2 m above / 0.5 m below the straight line, shaped as a smooth hump), and written back into the
// edge's heights (the trainer and the drawn road then rise over the hump). Tunnels stay straight.
//   node tools/openworld/decks.mjs <world id>      (data/world/<id>.json; LIDAR tiles from data/cache/lidar)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { heightAt, toBNG } = await import('../routes/bristol/lidar.mjs');

export async function addDecks(world, log = () => {}) {
  let n = 0;
  for (const e of world.roads.edges) {
    if (!e.bridge || e.pts.length < 3) continue;
    const P = e.pts, h0 = P[0][2], h1 = P[P.length - 1][2];
    let L = 0; const cum = P.map((p, k) => (k ? (L += Math.hypot((p[0] - P[k - 1][0]) * 110540, (p[1] - P[k - 1][1]) * 68000)) : 0));
    const chord = cum.map((c) => h0 + ((h1 - h0) * c) / (L || 1));
    const dsm = [];
    for (const [la, lo] of P) { const { E, N } = toBNG(la, lo); let v = NaN; try { v = await heightAt('dsm', E, N); } catch {} dsm.push(Number.isFinite(v) ? v : NaN); }
    // the deck's rise over the straight line, median-filtered, clamped (trees and parapets read high)
    const rise = dsm.map((v, k) => (Number.isFinite(v) ? v - chord[k] : 0));
    const med = rise.map((_, k) => { const w = rise.slice(Math.max(0, k - 2), k + 3).sort((a, b) => a - b); return w[w.length >> 1]; });
    const peak = Math.max(0, Math.min(1.2, Math.max(...med)));
    if (peak < 0.2) continue;
    // a smooth hump (sine) of that height: the deck reading is noisy, the shape of a humpback bridge isn't
    e.pts = P.map((p, k) => [p[0], p[1], +(chord[k] + peak * Math.sin((Math.PI * cum[k]) / (L || 1))).toFixed(2)]);
    e.hump = +peak.toFixed(2);
    n++;
  }
  log(`decks: ${n} humped bridges`);
  return n;
}

if (process.argv[1] && process.argv[1].endsWith('decks.mjs')) {
  const id = process.argv[2];
  const f = path.join(ROOT, 'data', 'world', id + '.json'), w = JSON.parse(fs.readFileSync(f, 'utf8'));
  await addDecks(w, console.log);
  fs.writeFileSync(f + '.tmp', JSON.stringify(w), { mode: 0o600 }); fs.renameSync(f + '.tmp', f);
  console.log('written', f);
}
