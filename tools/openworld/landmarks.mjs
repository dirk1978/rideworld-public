// Landmark models into an open world (2026-11-17, London): reads tools/openworld/landmarks/<id>.json (see its note),
// writes world.landmarks = [{ model, lat, lon, heading, ground }] (ground: the file's datum, LIDAR DTM at the point, or
// the deck height for a bridge) and removes the generated buildings the models replace. The browser (landmarks.js
// addWorldLandmarks) places each at ground + the terrain offset.
//   node tools/openworld/landmarks.mjs <world id> [<config id>]      (run after bheights.mjs; make.mjs / rebuild.mjs do)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [id, cfgId = id.replace(/-next$/, '')] = process.argv.slice(2);
const cfgFile = path.join(ROOT, 'tools', 'openworld', 'landmarks', cfgId + '.json');
if (!fs.existsSync(cfgFile)) { console.log('no landmarks for', cfgId); process.exit(0); }
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const wf = path.join(ROOT, 'data', 'world', id + '.json'), W = JSON.parse(fs.readFileSync(wf, 'utf8'));
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { toBNG, heightAt } = await import('../routes/bristol/lidar.mjs');

const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx(a[0]));
const bearing = (a, b) => ((Math.atan2((b[1] - a[1]) * kx(a[0]), (b[0] - a[0]) * 110540) * 180) / Math.PI + 360) % 360;
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const centroid = (poly) => [poly.reduce((t, p) => t + p[0], 0) / poly.length, poly.reduce((t, p) => t + p[1], 0) / poly.length];
const containing = (pt) => W.buildings.filter((b) => inside(pt, b.pts)).sort((a, b) => a.pts.length - b.pts.length);
// the heading that squares a model to a footprint: the bearing of its longest side, folded into 0..90
function footHeading(b) {
  let best = 0, bl = 0;
  for (let k = 1; k < b.pts.length; k++) { const L = dist(b.pts[k - 1], b.pts[k]); if (L > bl) { bl = L; best = bearing(b.pts[k - 1], b.pts[k]); } }
  return ((best % 90) + 90) % 90;
}
// the stretch of a named road nearest a point (or the whole road's middle): { at: [lat, lon, ele], heading }
function onRoad(name, pt, bridge) {
  const E = W.roads.edges.filter((e) => e.name === name && (!bridge || e.bridge));
  if (!E.length) return null;
  if (!pt) { // a bridge: the middle of the whole run of bridge pieces with that name (the build splits it at junctions),
    // on the deck; heading from one end to the other
    const P = E.flatMap((e) => e.pts); let a = P[0], b = P[0], far = -1;
    for (const p of P) { const d = dist(p, P[0]); if (d > far) { far = d; a = p; } }
    far = -1; for (const p of P) { const d = dist(p, a); if (d > far) { far = d; b = p; } }
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; let near = P[0]; for (const p of P) if (dist(p, mid) < dist(near, mid)) near = p;
    return { at: [mid[0], mid[1], near[2]], heading: bearing(a, b), len: far };
  }
  let best = null;
  for (const e of E) for (let k = 1; k < e.pts.length; k++) { const d = dist(e.pts[k], pt); if (!best || d < best.d) best = { d, heading: bearing(e.pts[k - 1], e.pts[k]), at: e.pts[k] }; }
  return best;
}

const out = [], drop = new Set();
for (const L of cfg.landmarks) {
  let lat = L.lat, lon = L.lon, heading = typeof L.heading === 'number' ? L.heading : 0, ground = null;
  if (L.road) {
    const r = onRoad(L.road, L.bridge ? null : [lat, lon], L.bridge);
    if (!r) { console.log('!', L.model, 'road not found:', L.road); continue; }
    heading = r.heading; if (L.bridge) { [lat, lon, ground] = r.at; console.log(L.model, 'deck', r.len.toFixed(0), 'm long'); }
  }
  const foot = containing([lat, lon]);
  if (L.heading === 'auto') { if (foot.length) heading = footHeading(foot[0]); else console.log('!', L.model, 'no footprint for auto heading'); }
  // level: 'canal' = at the water surface of the nearest canal / river line with levels (not an aqueduct itself): an
  // aqueduct's model has its origin on the water, which world.js draws at lv - 0.12 (+ the terrain offset)
  if (ground == null && L.level === 'canal') { let best = null; for (const a of W.water || []) { if (!a.lv || a.bridge) continue; a.pts.forEach((q, k) => { if (!Number.isFinite(a.lv[k])) return; const d = dist(q, [lat, lon]); if (!best || d < best.d) best = { d, lv: a.lv[k] }; }); } if (best) ground = best.lv - 0.12; else console.log('!', L.model, 'no canal level near'); }
  if (ground == null && typeof L.ground === 'number') ground = L.ground; // (given: a bridge model built on the deck's own heights, Bidford)
  if (ground == null) { const { E, N } = toBNG(lat, lon); try { ground = await heightAt('dtm', E, N); } catch (e) { console.log('!', L.model, 'no ground height', e.message); continue; } }
  // the buildings it replaces
  if (L.hide === 'footprint') { for (const p of [[lat, lon], ...(L.hideAt || [])]) for (const b of containing(p)) drop.add(b); }
  else if (typeof L.hide === 'number') W.buildings.forEach((b) => { if (dist(centroid(b.pts), [lat, lon]) < L.hide) drop.add(b); });
  if (L.hideAt && L.hide !== 'footprint') for (const p of L.hideAt) for (const b of containing(p)) drop.add(b);
  // a bridge's real width for the drawn deck (Bidford's single lane, 2026-11-20): every bridge piece of that road
  if (L.deckWidth && L.deckRoad) { let n = 0; for (const e of W.roads.edges) if (e.name === L.deckRoad && e.bridge) { e.w = L.deckWidth; n++; } console.log(L.model, 'deck width', L.deckWidth, 'on', n, 'pieces'); }
  out.push({ model: L.model, dir: L.dir || 'london', lat: +lat.toFixed(7), lon: +lon.toFixed(7), heading: +heading.toFixed(1), ground: +ground.toFixed(2), ...(L.near ? { near: L.near } : {}), ...(L.title ? { title: L.title } : {}), ...(L.blurb ? { blurb: L.blurb } : {}) }); // (title / blurb: the open worlds' landmark fly-by, landmarks.js flybyCamera) // (near: its own load radius, landmarks.js)
  console.log(L.model.padEnd(18), lat.toFixed(5), lon.toFixed(5), 'heading', heading.toFixed(0), 'ground', ground.toFixed(1), 'footprint', foot.length ? 'yes' : 'no');
}
// (the outlines a landmark replaces are kept, not drawn: world.js still counts them as buildings at the pavement, so no
// garden wall or hedge is generated across a pub's front, 2026-11-22 the Black Cross)
W.hidden = [...drop].map((b) => b.pts);
W.buildings = W.buildings.filter((b) => !drop.has(b));
W.landmarks = out;
// the world's building palette and named façades (buildings.js styleOf: b.st)
if (cfg.flavour) W.flavour = cfg.flavour;
let styled = 0; for (const st of cfg.styles || []) for (const p of st.at) for (const b of containing(p)) { b.st = st.style; styled++; }
if (cfg.styles) console.log('façades styled', styled);
fs.writeFileSync(wf, JSON.stringify(W), { mode: 0o600 });
console.log('landmarks', out.length, '; generated buildings removed', drop.size);
