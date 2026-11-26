// One command for a new (or rebuilt) open world (2026-11-17, the owner: "are these tools useful for more open world maps,
// e.g. London, so next time it's a simple process?"). Runs every step in order and adds the route:
//   1. checks the LIDAR: which Environment Agency 5 km survey squares (e.g. SO96ne) cover the box and which aren't in
//      data/cache/lidar yet; without --wcs it stops and lists them (download DTM + "first return DSM" zips from
//      https://environment.data.gov.uk/survey into <your files folder> then tools/routes/survey-import.mjs;
//      or pass --wcs to fetch the missing tiles through the slow WCS while building, ~1 tile a minute)
//   2. build.mjs (roads, paths, water, buildings, trees; tools/openworld/edits/<id>.json corrections; fixes.json)
//   3. extras.mjs (traffic lights, crossings, shops)   4. bheights.mjs (building heights)   5. dtm-grid.mjs (real ground)
//   6. the routes.json entry if it's new (open world, generated scenery, country, start points from the towns, villages
//      and suburbs in the box, spread out) - restart rideworld.service afterwards
//   node tools/openworld/make.mjs <id> "<name>" <south> <west> <north> <east> [--mask "s,w,n,e;..."] [--start lat,lon]
//        [--wcs] [--skip-build] [--starts N]
// Outside England there is no EA LIDAR: the build still works (heights fall back), but extras / bheights / dtm-grid
// are skipped, and the terrain stays Cesium's.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const [id, name, S, W, N, E] = args;
const flag = (f) => args.includes(f), opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
if (!id || !name || ![S, W, N, E].every((v) => Number.isFinite(+v))) { console.error('usage: make.mjs <id> "<name>" <south> <west> <north> <east> [--mask ...] [--start lat,lon] [--wcs] [--skip-build] [--starts N]'); process.exit(1); }
const box = { s: +S, w: +W, n: +N, e: +E };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const run = (script, extra) => { log('->', script, ...extra); const r = spawnSync(process.execPath, ['--max-old-space-size=6000', path.join(ROOT, 'tools', 'openworld', script), ...extra], { stdio: 'inherit', cwd: ROOT }); if (r.status !== 0) { console.error(script, 'failed'); process.exit(1); } };

// ---- 1. LIDAR coverage: OS grid 5 km squares over the box ----
process.env.LIDAR_CACHE ||= path.join(ROOT, 'data', 'cache', 'lidar');
const { toBNG } = await import('../routes/bristol/lidar.mjs');
const corners = [[box.s, box.w], [box.s, box.e], [box.n, box.w], [box.n, box.e]].map(([la, lo]) => toBNG(la, lo));
const E0 = Math.min(...corners.map((c) => c.E)), E1 = Math.max(...corners.map((c) => c.E)), N0 = Math.min(...corners.map((c) => c.N)), N1 = Math.max(...corners.map((c) => c.N));
const england = E0 > 80000 && E1 < 660000 && N0 > 5000 && N1 < 660000; // (roughly: the EA survey covers England)
// OS grid reference letters for a 100 km square, then the 10 km digits and the 5 km quadrant (sw / se / nw / ne)
const gridRef = (e, n) => {
  const e100 = Math.floor(e / 100000), n100 = Math.floor(n / 100000);
  const l1 = (19 - n100) - ((19 - n100) % 5) + Math.floor((e100 + 10) / 5), l2 = ((19 - n100) * 5) % 25 + (e100 % 5);
  const L = (i) => 'ABCDEFGHJKLMNOPQRSTUVWXYZ'[i];
  const q = (n % 10000 >= 5000 ? 'n' : 's') + (e % 10000 >= 5000 ? 'e' : 'w');
  return L(l1) + L(l2) + Math.floor((e % 100000) / 10000) + Math.floor((n % 100000) / 10000) + q;
};
const need = new Map(); // ref -> missing tile count
for (let e = Math.floor(E0 / 5000) * 5000; e < E1; e += 5000) for (let n = Math.floor(N0 / 5000) * 5000; n < N1; n += 5000) {
  let miss = 0;
  for (let te = e; te < e + 5000; te += 500) for (let tn = n; tn < n + 5000; tn += 500) for (const k of ['dtm', 'dsm']) if (!fs.existsSync(path.join(process.env.LIDAR_CACHE, `${k}-${te / 500}-${tn / 500}.tif`))) miss++;
  need.set(gridRef(e + 1, n + 1), miss);
}
const missing = [...need].filter(([, m]) => m > 0);
log(`LIDAR: ${need.size} survey squares over the box; ${missing.length} not (fully) in the cache${missing.length ? ': ' + missing.map(([r, m]) => `${r} (${m} tiles)`).join(', ') : ''}`);
if (england && missing.length && !flag('--wcs') && !flag('--skip-build')) {
  console.log(`\nDownload these from https://environment.data.gov.uk/survey (LIDAR Composite DTM 1m and First Return DSM 1m, 2022):\n  ${missing.map(([r]) => r).join(' ')}\ninto <your files folder> import them (the import loop in the Bromsgrove notes, or survey-import.mjs dtm|dsm <file.tif>), and run this again. Or add --wcs to fetch them slowly while building.`);
  process.exit(2);
}

// ---- 2-5. the steps ----
const pass = [];
if (opt('--mask')) pass.push('--mask', opt('--mask'));
if (opt('--start')) pass.push('--start', opt('--start'));
if (!flag('--skip-build')) run('build.mjs', [id, name, S, W, N, E, ...pass]);
if (england) { run('extras.mjs', [id]); run('bheights.mjs', [id]); run('landmarks.mjs', [id]); run('dtm-grid.mjs', [id]); } // (landmarks: tools/openworld/landmarks/<id>.json, if any)
else run('extras.mjs', [id]); // (lights, crossings, shops don't need LIDAR)

// ---- 6. the route entry ----
const rf = path.join(ROOT, 'data', 'routes.json'), routes = JSON.parse(fs.readFileSync(rf, 'utf8')), list = Array.isArray(routes) ? routes : Object.values(routes);
const Wd = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world', id + '.json'), 'utf8'));
const km = Math.round(Wd.roads.edges.reduce((t, e) => t + e.pts.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - e.pts[i][0]) * 110540, (p[1] - e.pts[i][1]) * 111320 * Math.cos((p[0] * Math.PI) / 180)), 0), 0) / 1000);
if (!list.find((r) => r.id === id)) {
  // start points: named towns / villages / suburbs, the most important first, at least 1.2 km apart
  const nStarts = +opt('--starts') || 10, picked = [];
  const areas = (Wd.places || []).filter((p) => p[3] === 'area');
  for (const p of areas) if (picked.length < nStarts && !picked.some((q) => Math.hypot((p[0] - q.lat) * 110540, (p[1] - q.lon) * 68000) < 1200)) picked.push({ name: p[2], lat: p[0], lon: p[1] });
  const entry = { id, name, where: '', blurb: `Ride anywhere on ${km} km of roads and paths: pick a start, then choose your way at every junction (↑ ← → or tap), or turn round any time (U).${england ? " Every road's heights from the Environment Agency's laser survey." : ''}`, km, gain: 0, kind: 'server', by: 'admin', added: new Date().toISOString(), trusted: true, camHigh: true, scenery: 'generated', open: true, structures: { at: new Date().toISOString(), list: [] }, starts: picked.length ? picked : [{ name: 'Start', lat: (box.s + box.n) / 2, lon: (box.w + box.e) / 2 }] };
  if (Array.isArray(routes)) routes.push(entry); else routes[id] = entry;
  fs.copyFileSync(rf, rf + '.bak-' + Date.now());
  fs.writeFileSync(rf + '.tmp', JSON.stringify(routes, null, 2), { mode: 0o600 }); fs.renameSync(rf + '.tmp', rf);
  log(`added the route "${name}" (${km} km, ${entry.starts.length} starts: ${entry.starts.map((s) => s.name).join(', ')}); the country is filled in at the next start-up. Restart: sudo systemctl restart rideworld`);
} else log(`route ${id} already exists (${km} km now): its world file is updated; edit its starts in data/routes.json if needed`);
