// Real building heights for an open world (2026-11-17, the owner's list item 2): the LIDAR surface model (first return) minus
// the ground model, sampled every metre inside each building's footprint (1 m in from its walls, so gardens, pavements
// and the neighbours don't count): the 25th percentile is taken as the eaves (wall height) and the 98th as the ridge. Written into data/world/<id>.json as each building's `lh` (eaves, m) and
// `lr` (ridge, m); world.js uses them for the walls and the pitched roof's rise (flat when the two are within 0.8 m).
//   node tools/openworld/bheights.mjs <id>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { heightAt, toBNG } = await import('../routes/bristol/lidar.mjs');
const id = process.argv[2];
if (!id) { console.error('usage: bheights.mjs <world id>'); process.exit(1); }
const wf = path.join(ROOT, 'data', 'world', id + '.json');
const W = JSON.parse(fs.readFileSync(wf, 'utf8'));
const OPT = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'openworld', 'options', id.replace(/-next$/, '') + '.json'), 'utf8')); } catch { return {}; } })(); // (per-world options: build.mjs)
const inPoly = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const edgeDist = (P, x, y) => { let d = Infinity; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, ay] = P[j], [bx, by] = P[i], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1))); d = Math.min(d, Math.hypot(x - ax - vx * t, y - ay - vy * t)); } return d; };
const pct = (a, q) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * q)))];
// the world box in British National Grid metres: samples outside it would fetch LIDAR tiles one by one from the slow WCS
// (the Thames multipolygon runs far beyond central London; 2026-11-17)
const BX = (() => { const b = W.build?.box || W.roads?.box; if (!b) return null; const c = [[b.s, b.w], [b.s, b.e], [b.n, b.w], [b.n, b.e]].map(([la, lo]) => toBNG(la, lo)); return { e0: Math.min(...c.map((q) => q.E)), e1: Math.max(...c.map((q) => q.E)), n0: Math.min(...c.map((q) => q.N)), n1: Math.max(...c.map((q) => q.N)) }; })();
const inBX = (E, N) => !OPT.city || !BX || (E >= BX.e0 && E <= BX.e1 && N >= BX.n0 && N <= BX.n1); // (city worlds only: others as before)
let done = 0, set = 0; const t0 = Date.now();
for (const b of W.buildings) {
  const P = b.pts.map(([la, lo]) => { const { E, N } = toBNG(la, lo); return [E, N]; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const hs = [];
  for (let x = Math.floor(x0) + 0.5; x < x1; x += 1) for (let y = Math.floor(y0) + 0.5; y < y1; y += 1) {
    if (!inPoly(P, x, y) || edgeDist(P, x, y) < 1) continue;
    try { const s = await heightAt('dsm', x, y), g = await heightAt('dtm', x, y); if (Number.isFinite(s) && Number.isFinite(g)) hs.push(s - g); } catch {}
  }
  delete b.lh; delete b.lr;
  if (hs.length >= 4) {
    hs.sort((a, c) => a - c);
    // eaves = the 25th percentile (the lowest readings include gaps and ground: a first try from the 5th gave 2 m houses),
    // ridge = the 98th (the 92nd left a typical house's roof 1.7 m high; real ones are ~3 m)
    const eaves = pct(hs, 0.25), ridge = pct(hs, 0.98);
    if (eaves > 1.8 && eaves < 80) { b.lh = +eaves.toFixed(1); b.lr = +Math.max(eaves, Math.min(ridge, eaves + 9)).toFixed(1); set++; }
  }
  if (++done % 3000 === 0) console.log(done, '/', W.buildings.length, 'buildings,', set, 'measured,', ((Date.now() - t0) / 1000).toFixed(0), 's');
}
// water levels for canals and rivers (2026-11-17, the owner: "the water and locks need to be drawn a lot better"): the
// ground model along the centre line (LIDAR reads the water surface), a running median over 60 m so each pound comes
// out level and the steps fall at the locks; `lv` per point (m above Ordnance Datum), world.js draws the water there
let wl = 0;
for (const a of W.water || []) {
  if (!/^(canal|river)$/.test(a.t)) continue;
  const raw = [], cum = [0];
  for (let k = 0; k < a.pts.length; k++) { const [la, lo] = a.pts[k], { E, N } = toBNG(la, lo); let h; try { h = inBX(E, N) ? await heightAt('dtm', E, N) : NaN; } catch { h = NaN; } raw.push(Number.isFinite(h) ? h : NaN); if (k) cum.push(cum[k - 1] + Math.hypot((la - a.pts[k - 1][0]) * 110540, (lo - a.pts[k - 1][1]) * 68000)); }
  a.lv = raw.map((_, k) => { const win = raw.filter((v, j) => Number.isFinite(v) && Math.abs(cum[j] - cum[k]) <= 30).sort((x, y) => x - y); return win.length ? +win[Math.floor(win.length * 0.2)].toFixed(2) : null; }); // (the 20th percentile: bridges and boats only ever read higher)
  wl++;
}
console.log('water levels for', wl, 'canal / river lines');
// railway bridges and viaducts (London, 2026-11-17): the deck's top along the line from the surface model (first
// return: the ballast / track; trains and overhead masts are filtered by a low percentile over +-10 m), only where it
// stands 3 m+ over the ground (`dk` per point, m above Ordnance Datum, null where it's ground); world.js draws decks
let rb = 0;
for (const a of W.land || []) {
  if (!(OPT.city || OPT.railDecks) || a.t !== 'rail' || !a.bridge) continue; // (railDecks: the owner 2026-11-21, "there should be a railway line over a tunnel here")
  const raw = [], gr = [], cum = [0];
  for (let k = 0; k < a.pts.length; k++) {
    const [la, lo] = a.pts[k], { E, N } = toBNG(la, lo); let s = NaN, g = NaN;
    if (inBX(E, N)) try { s = await heightAt('dsm', E, N); g = await heightAt('dtm', E, N); } catch {}
    raw.push(s); gr.push(g);
    if (k) { const [pa, po] = a.pts[k - 1]; cum.push(cum[k - 1] + Math.hypot((la - pa) * 110540, (lo - po) * 69000)); }
  }
  // (railDecks worlds: the ground under a short railway bridge is the road passing under it, not the embankment the
  // ground model keeps either side: Sugarbrook Lane at Stoke Pound passes 5.4 m under the line, the DTM read 0-3 m)
  if (OPT.railDecks && W.roads?.edges) {
    const K = 111320 * Math.cos((a.pts[0][0] * Math.PI) / 180), X = (p) => [p[1] * K, p[0] * 110540];
    const cross = (p1, p2, p3, p4) => { const [ax, ay] = X(p1), [bx, by] = X(p2), [cx, cy] = X(p3), [dx, dy] = X(p4), den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (!den) return null; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den; return t >= -0.5 && t <= 1.5 && u >= 0 && u <= 1 ? u : null; };
    let low = Infinity;
    for (const e of W.roads.edges) for (let j = 1; j < e.pts.length; j++) for (let k = 1; k < a.pts.length; k++) { const u = cross(a.pts[k - 1], a.pts[k], e.pts[j - 1], e.pts[j]); if (u != null) low = Math.min(low, e.pts[j - 1][2] + (e.pts[j][2] - e.pts[j - 1][2]) * u); }
    if (Number.isFinite(low)) for (let k = 0; k < gr.length; k++) gr[k] = Math.min(Number.isFinite(gr[k]) ? gr[k] : low, low);
  }
  a.dk = raw.map((_, k) => { const win = raw.filter((v, j) => Number.isFinite(v) && Math.abs(cum[j] - cum[k]) <= 10).sort((x, y) => x - y); const d = win.length ? win[Math.floor(win.length * 0.3)] : NaN; return Number.isFinite(d) && Number.isFinite(gr[k]) && d - gr[k] > 3 ? +d.toFixed(2) : null; });
  // (the ground under each point too: world.js stands brick piers on it under a long viaduct, 2026-11-22: London Bridge's
  // decks hung in the air, the owner "something floating in the sky")
  if (a.dk.some((v) => v != null)) { rb++; a.gd = gr.map((v) => (Number.isFinite(v) ? +v.toFixed(2) : null)); } else { delete a.dk; delete a.gd; }
}
console.log('railway bridges with decks', rb);
// motorway bridges (2026-11-21): the deck's top from the surface model (low percentile over +-10 m, lorries filtered),
// `dk` per point; world.js draws them as spans with parapets (others are drawn on the ground)
let mb = 0;
for (const m of W.motorways || []) {
  if (!m.bridge) continue;
  const raw = [], cum = [0];
  for (let k = 0; k < m.pts.length; k++) { const [la, lo] = m.pts[k], { E, N } = toBNG(la, lo); let v = NaN; if (inBX(E, N)) try { v = await heightAt('dsm', E, N); } catch {} raw.push(v); if (k) { const [pa, po] = m.pts[k - 1]; cum.push(cum[k - 1] + Math.hypot((la - pa) * 110540, (lo - po) * 69000)); } }
  m.dk = raw.map((_, k) => { const win = raw.filter((v, j) => Number.isFinite(v) && Math.abs(cum[j] - cum[k]) <= 10).sort((x, y) => x - y); return win.length ? +win[Math.floor(win.length * 0.3)].toFixed(2) : null; });
  if (m.dk.some((v) => v == null)) delete m.dk; else mb++;
}
console.log('motorway bridges with decks', mb);
// every motorway piece its own heights (2026-11-21, the owner: "slip roads on the kidderminster road?": drawn on the terrain,
// the carriageways either side of a bridge sank to the lane under it, where the ground is lowered for the lane): points
// every 10 m, `ele` from the ground model (bridges: their deck)
let md = 0;
for (const m of W.motorways || []) {
  const P = [m.pts[0]], D = m.dk ? [m.dk[0]] : null;
  for (let k = 1; k < m.pts.length; k++) {
    const [a1, b1] = m.pts[k - 1], [a2, b2] = m.pts[k], L = Math.hypot((a2 - a1) * 110540, (b2 - b1) * 69000), n = Math.max(1, Math.ceil(L / 10));
    for (let j = 1; j <= n; j++) { P.push([+(a1 + ((a2 - a1) * j) / n).toFixed(6), +(b1 + ((b2 - b1) * j) / n).toFixed(6)]); if (D) D.push(+(m.dk[k - 1] + ((m.dk[k] - m.dk[k - 1]) * j) / n).toFixed(2)); }
  }
  if (D) { m.pts = P; m.dk = D; m.ele = D; md++; continue; }
  const ele = [];
  for (const [la, lo] of P) { const { E, N } = toBNG(la, lo); let v = NaN; if (inBX(E, N)) try { v = await heightAt('dtm', E, N); } catch {} ele.push(Number.isFinite(v) ? +v.toFixed(2) : null); }
  if (ele.some((v) => v == null)) continue;
  m.pts = P; m.ele = ele; md++;
}
console.log('motorway pieces with heights', md);
// big water areas (the Thames, the Serpentine, docks; London 2026-11-17): a level surface. The ground model over open
// water is the surface at survey time; sampled on a 12 m grid inside the area (3 m+ from its edge, so walls and banks
// don't count), the median is the level (`lv`, m above datum, with `lvSpread` = 10th-90th spread for checking)
let wa = 0;
for (const a of W.land || []) {
  if (!OPT.city || a.t !== 'water' || a.pts.length < 4) continue;
  const P = a.pts.map(([la, lo]) => { const { E, N } = toBNG(la, lo); return [E, N]; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if ((x1 - x0) * (y1 - y0) < 4000) continue; // (ponds: painted is fine)
  const step = Math.max(12, Math.sqrt(((x1 - x0) * (y1 - y0)) / 3000)), hs = [];
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
    if (!inBX(x, y) || !inPoly(P, x, y) || edgeDist(P, x, y) < 3) continue;
    try { const g = await heightAt('dtm', x, y); if (Number.isFinite(g)) hs.push(g); } catch {}
  }
  if (hs.length < 8) continue;
  hs.sort((p, q) => p - q);
  a.lv = +pct(hs, 0.5).toFixed(2); a.lvSpread = +(pct(hs, 0.9) - pct(hs, 0.1)).toFixed(2); wa++;
}
console.log('water areas levelled', wa);
fs.writeFileSync(wf + '.tmp', JSON.stringify(W), { mode: 0o600 }); fs.renameSync(wf + '.tmp', wf);
console.log(`written ${wf}: ${set} of ${W.buildings.length} buildings measured, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
