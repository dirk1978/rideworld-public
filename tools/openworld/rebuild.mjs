// Rebuild an open world after map-editor changes (2026-11-17): build.mjs into <id>-next with the world's own box / mask /
// start (world.build), its edits (data/world/<id>.edits.json), its LIDAR trees kept and the map answers from the cache
// (minutes, not an hour), then extras.mjs and bheights.mjs on it, then it replaces <id>'s world file and card GPX (the
// old ones kept as .prev). Progress in data/world/<id>.rebuild.json { state: running | done | failed, at, step, log }.
// Started by the server (POST /api/mapedits/<id>/rebuild) or by hand:  node tools/openworld/rebuild.mjs <id>
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const id = process.argv[2];
if (!/^[a-z0-9-]{1,60}$/.test(id || '')) { console.error('usage: rebuild.mjs <world id>'); process.exit(1); }
const D = path.join(ROOT, 'data', 'world'), sf = path.join(D, id + '.rebuild.json'), lines = [];
const status = (state, step) => fs.writeFileSync(sf, JSON.stringify({ state, step, at: new Date().toISOString(), pid: process.pid, log: lines.slice(-40) }), { mode: 0o600 }); // (pid: the server spots a rebuild killed by a restart)
const run = (script, args, step) => {
  status('running', step);
  const r = spawnSync(process.execPath, ['--max-old-space-size=6000', path.join(ROOT, 'tools', 'openworld', script), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const l of `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter(Boolean)) if (!/overpass https/.test(l)) lines.push(l.slice(0, 200));
  if (r.status !== 0) { status('failed', step); process.exit(1); }
};
try {
  const W = JSON.parse(fs.readFileSync(path.join(D, id + '.json'), 'utf8')), b = W.build;
  if (!b?.box) throw new Error('no build settings in the world file (build it once with build.mjs first)');
  const next = id + '-next';
  run('build.mjs', [next, b.name || id, b.box.s, b.box.w, b.box.n, b.box.e, ...(b.mask ? ['--mask', b.mask] : []), ...(b.start ? ['--start', b.start] : []), '--edits', id, '--keep-trees', id, '--cached'], 'roads and buildings');
  run('extras.mjs', [next, '--edits', id], 'traffic lights, crossings, shops');
  run('bheights.mjs', [next], 'building heights');
  run('landmarks.mjs', [next, id], 'landmark models');
  { const o = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'openworld', 'options', id + '.json'), 'utf8')); if (o.canal) run('canal.mjs', [next, '--cfg', id, '--write'], 'canal locks and pounds'); if (o.footbridges) run('footbridges.mjs', [next, '--cfg', id, '--write'], 'footbridges over motorways'); }
  if (fs.existsSync(path.join(ROOT, 'tools', 'openworld', 'handbridges', id + '.json'))) run('handbridges.mjs', [next, '--cfg', id, '--write'], 'hand-drawn bridges'); // (after landmarks: it adds its own)
  status('running', 'swapping in');
  for (const [dir, ext] of [[D, '.json'], [path.join(ROOT, 'data', 'routes'), '.gpx']]) {
    const cur = path.join(dir, id + ext), nw = path.join(dir, next + ext);
    if (fs.existsSync(cur)) fs.copyFileSync(cur, cur + '.prev');
    fs.renameSync(nw, cur);
  }
  fs.utimesSync(path.join(D, id + '.json'), new Date(), new Date()); // (newer than the GPX: lib/world.js keeps it)
  // (the pre-plotted rides' plans are road numbers in THIS world file: re-plan them, routes.json kept first as .prev-rides)
  if (fs.existsSync(path.join(ROOT, 'tools', 'openworld', 'rides', id + '.json'))) { fs.copyFileSync(path.join(ROOT, 'data', 'routes.json'), path.join(ROOT, 'data', 'routes.json.prev-rides')); run('rides.mjs', [id, '--write'], 'pre-plotted rides re-planned'); }
  lines.push('swapped in');
  status('done', 'done');
} catch (e) { lines.push(String(e.message || e)); status('failed', 'error'); process.exit(1); }
