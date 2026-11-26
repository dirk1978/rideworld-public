// Check every bridge in an open world (2026-11-20, the owner: "bridges in all 3 worlds ... need to be perfect, no sinking,
// correct heights, all checked"). For each bridge piece in the world file (roads and rideable paths):
//   step   the height jump where it meets the next piece at each end (the rider would hop or drop)
//   slope  the steepest 10 m on it, and dips (a point well below both neighbours: a sag in the deck)
//   dsm    the deck against the LIDAR first-return surface along it (the survey sees the deck itself): far below it =
//          the deck is drawn sunk; far above = floating (trees over a bridge read high: only the median is used)
//   under  the ground under the middle (DTM): a long bridge whose deck sits at the ground under it was drawn at the
//          level of what it crosses (a road or the river) instead of on its deck
//   node tools/openworld/bridgecheck.mjs <world id> [--all]     (default: only the pieces that fail a check)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const id = process.argv[2], ALL = process.argv.includes('--all');
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { toBNG, heightAt } = await import('../routes/bristol/lidar.mjs');
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world', id + '.json'), 'utf8'));
const E = W.roads.edges;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx(a[0]));
const len = (e) => { let L = 0; for (let k = 1; k < e.pts.length; k++) L += dist(e.pts[k - 1], e.pts[k]); return L; };
const H = async (kind, p) => { const { E: x, N } = toBNG(p[0], p[1]); try { const h = await heightAt(kind, x, N); return Number.isFinite(h) && h > -100 && h < 2000 ? h : null; } catch { return null; } };
const ends = new Map(); E.forEach((e, i) => { for (const [j, q] of [[e.a, e.pts[0]], [e.b, e.pts.at(-1)]]) (ends.get(j) || ends.set(j, []).get(j)).push({ i, h: q[2] }); });
const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const rows = [];
for (const [i, e] of E.entries()) {
  if (!e.bridge) continue;
  const L = len(e), P = e.pts, issues = [];
  // steps at the ends
  let step = 0;
  for (const [j, q] of [[e.a, P[0]], [e.b, P.at(-1)]]) for (const o of ends.get(j) || []) if (o.i !== i && !E[o.i].off === !e.off) step = Math.max(step, Math.abs(o.h - q[2]));
  if (step > 0.4) issues.push(`step ${step.toFixed(1)} m at an end`);
  // slopes and dips (over >= 8 m chords)
  let steep = 0, dip = 0;
  for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) { const dd = dist(P[a], P[b]); if (dd >= 8 && dd <= 14) steep = Math.max(steep, Math.abs(P[b][2] - P[a][2]) / dd * 100); }
  for (let k = 1; k < P.length - 1; k++) dip = Math.max(dip, Math.min(P[k - 1][2], P[k + 1][2]) - P[k][2]);
  if (steep > (e.off ? 16 : 12)) issues.push(`slope ${steep.toFixed(0)}%`);
  if (dip > 0.5) issues.push(`sag ${dip.toFixed(1)} m`);
  // against the survey (bridges of 12 m and more: shorter ones are drawn as ordinary road)
  let dsmOff = null, under = null;
  if (L >= 12) {
    const inner = P.filter((_, k) => k > 0 && k < P.length - 1);
    const S = inner.length ? inner : [P[P.length >> 1]];
    const ds = [], dt = [];
    let trees = 0;
    for (const [n, q] of S.entries()) {
      // (as build.mjs: the survey counts only where it's flat across the deck, within 1.2 m of the middle: else trees)
      const i0 = P.indexOf(q), a = P[Math.max(0, i0 - 1)], b = P[Math.min(P.length - 1, i0 + 1)], K = kx(q[0]);
      const tn = [(b[0] - a[0]) * 110540, (b[1] - a[1]) * K], tl = Math.hypot(...tn) || 1, nm = [-tn[1] / tl, tn[0] / tl];
      const ac = []; for (const r of [-1.2, 0, 1.2]) { const v = await H('dsm', [q[0] + (nm[0] * r) / 110540, q[1] + (nm[1] * r) / K]); if (v != null) ac.push(v); }
      const g = await H('dtm', q); if (g != null) dt.push(q[2] - g);
      const rd = [...ac].sort((x, y) => x - y); if (rd.length >= 2 && rd[1] - rd[0] < 0.6) ds.push(rd[0] - q[2]); else trees++; // (as build.mjs)
    }
    if (trees > S.length / 2) issues.length === 0 && (rows.treeNote = (rows.treeNote || 0) + 1);
    dsmOff = med(ds); under = med(dt);
    if (dsmOff != null && dsmOff > 1.5) issues.push(`deck ${dsmOff.toFixed(1)} m below the surveyed deck`);
    if (dsmOff != null && dsmOff < -1.5) issues.push(`deck ${(-dsmOff).toFixed(1)} m above the surveyed surface`);
    if (under != null && under < 1.0 && L >= 20 && dsmOff != null && dsmOff > 1.5) issues.push(`deck only ${under.toFixed(1)} m over the ground under it`);
  }
  // (an aqueduct's towpath is at canal level by design: the survey sees the valley beside the narrow trough)
  if ((W.landmarks || []).some((m) => /edstone|wootton|aqueduct/.test(m.model) && P.some((q) => dist(q, [m.lat, m.lon]) < 100))) issues.length = 0;
  if (issues.length || ALL) rows.push({ i, name: e.name || e.hw, hw: e.hw, L: Math.round(L), at: P[P.length >> 1].slice(0, 2).map((v) => +v.toFixed(5)), h: `${P[0][2]}..${P.at(-1)[2]}`, dsmOff, under, issues });
}
const n = E.filter((e) => e.bridge).length;
console.log(`${id}: ${n} bridge pieces, ${rows.filter((r) => r.issues.length).length} with problems`);
for (const r of rows) console.log(`  #${r.i} ${r.name} (${r.hw}, ${r.L} m) at ${r.at.join(',')} heights ${r.h}${r.dsmOff != null ? ` survey ${r.dsmOff > 0 ? '+' : ''}${r.dsmOff.toFixed(1)}` : ''}${r.under != null ? ` over ground ${r.under.toFixed(1)}` : ''}: ${r.issues.join('; ') || 'ok'}`);
