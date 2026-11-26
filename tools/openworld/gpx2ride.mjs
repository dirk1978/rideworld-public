// A pre-plotted open-world route from a GPX (2026-11-20, the owner: "would you like me to make a gpx of a suggested route
// then you can compare?"). Waypoints every ~250 m along the GPX, each on the nearest road that isn't a dead end; the
// satnav's line through them (rides.mjs's own routing) is compared with the GPX: how far it strays, where.
//   node tools/openworld/gpx2ride.mjs <world> <file.gpx> <id> "<name>" ["<blurb>"] [--every 250] [--write]
// --write adds / replaces the ride in tools/openworld/rides/<world>.json; then run rides.mjs <world> --write.
import fs from 'fs';

const args = process.argv.slice(2), flag = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const [world, gpxFile, id, name, blurb = ''] = args.filter((a, i) => !a.startsWith('--') && !['--every'].includes(args[i - 1]));
const EVERY = +flag('--every', 250), WRITE = args.includes('--write');
const ROOT = new URL('../../', import.meta.url).pathname;
// rides.mjs's routing, without running its main part
const src = fs.readFileSync(ROOT + 'tools/openworld/rides.mjs', 'utf8').split('const result = [];')[0].replace("const [id] = process.argv.slice(2)", `const id = ${JSON.stringify(world)}`);
const mod = 'data:text/javascript,' + encodeURIComponent(src.replace(/import\.meta\.url/g, JSON.stringify('file://' + ROOT + 'tools/openworld/rides.mjs')) + '\nexport { snap, leg, E, dist }; export const setOff = (v) => { OFFROAD = v; };');
const { snap, leg, E, dist, setOff } = await import(mod);
const OFF = args.includes('--offroad'); setOff(OFF); // (--offroad: a towpath / trail ride, paths at their own length; written as offroad: true)

const xml = fs.readFileSync(gpxFile, 'utf8');
const G = [...xml.matchAll(/<(?:trkpt|rtept)[^>]*lat="([-0-9.]+)"[^>]*lon="([-0-9.]+)"/g)].map((m) => [+m[1], +m[2]]);
if (G.length < 2) { console.error('no track points in', gpxFile); process.exit(1); }
let GL = 0; for (let k = 1; k < G.length; k++) GL += dist(G[k - 1], G[k]);
const loop = dist(G[0], G.at(-1)) < 150;
// waypoints every EVERY metres along the GPX (and its end unless it's a loop)
const via = [G[0]]; let acc = 0;
for (let k = 1; k < G.length; k++) { acc += dist(G[k - 1], G[k]); if (acc >= EVERY) { via.push(G[k]); acc = 0; } }
if (!loop) via.push(G.at(-1)); else if (dist(via.at(-1), G[0]) < EVERY / 2) via.pop();
const snaps = via.map((p) => snap(p[0], p[1], true, 'coord'));
const pts = []; let dir = null;
const seq = [...snaps, ...(loop ? [snaps[0]] : [])];
for (let k = 1; k < seq.length; k++) { const l = leg(seq[k - 1], seq[k], dir); dir = l.dir; for (const q of k === 1 ? l.pts : l.pts.slice(1)) pts.push(q); }
let RL = 0; for (let k = 1; k < pts.length; k++) RL += dist(pts[k - 1], pts[k]);
// how far the satnav's line strays from the GPX (each of its points to the nearest GPX segment)
const segD = (p, a, b) => { const K = 111320 * Math.cos((p[0] * Math.PI) / 180), ax = (a[1] - p[1]) * K, ay = (a[0] - p[0]) * 110540, bx = (b[1] - p[1]) * K, by = (b[0] - p[0]) * 110540, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(ax + vx * t, ay + vy * t); };
const off = pts.map((p) => { let m = Infinity; for (let k = 1; k < G.length; k++) m = Math.min(m, segD(p, G[k - 1], G[k])); return m; });
const srt = [...off].sort((a, b) => a - b), p95 = srt[Math.floor(srt.length * 0.95)];
const strays = []; let run = null; let rd = 0;
pts.forEach((p, k) => { if (k) rd += dist(pts[k - 1], p); if (off[k] > 40) { if (!run) run = { from: rd, at: p, max: 0 }; run.max = Math.max(run.max, off[k]); run.to = rd; } else if (run) { strays.push(run); run = null; } });
if (run) strays.push(run);
console.log(`${id}: GPX ${(GL / 1000).toFixed(1)} km${loop ? ' (a loop)' : ''}, ${via.length} waypoints; satnav line ${(RL / 1000).toFixed(1)} km; off the GPX: 95% within ${p95.toFixed(0)} m`);
for (const s of strays) console.log(`  strays up to ${Math.round(s.max)} m from ${(s.from / 1000).toFixed(2)} to ${(s.to / 1000).toFixed(2)} km near ${s.at[0].toFixed(5)},${s.at[1].toFixed(5)}`);
if (WRITE) {
  const f = ROOT + `tools/openworld/rides/${world}.json`, R = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entry = { id, name, blurb, loop, via: snaps.map((s) => { const q = E[s.i].pts[s.k]; return [+q[0].toFixed(6), +q[1].toFixed(6)]; }), names: [name], fromGpx: gpxFile.split('/').pop(), ...(OFF ? { offroad: true } : {}) };
  const i = R.findIndex((r) => r.id === id); if (i >= 0) R[i] = entry; else R.push(entry);
  fs.writeFileSync(f, JSON.stringify(R, null, 1)); console.log('written to', f, '(now: node tools/openworld/rides.mjs', world, '--write)');
}
