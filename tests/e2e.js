// End-to-end checks in headless Chromium against the running server (https://localhost:8443 unless RW_URL is
// set). Run on the test server: node tests/e2e.js   (add --real to use real Google tiles; slower)
// Uses throwaway accounts (created and deleted here) and a throwaway copy of a seed route, so real riders' routes,
// ghosts and settings are never touched. Drop-in is off and group rides are private, so nobody sees the test riders.
// Playwright comes from PLAYWRIGHT_PATH, default playwright (not a project dep).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.join(__dirname, '..');
const URL = process.env.RW_URL || 'https://localhost:8443';
const REAL = process.argv.includes('--real');
const USERS = ['e2e-one', 'e2e-two'];
const accounts = () => { delete require.cache[require.resolve(path.join(ROOT, 'lib/accounts'))]; return require(path.join(ROOT, 'lib/accounts')); };

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const step = async (name, fn) => {
  try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`); }
  await closeAll();
};

const passwords = {};
function makeUsers() {
  for (const u of USERS) {
    try { accounts().deleteUser(u); } catch {}
    const out = execFileSync('node', [path.join(ROOT, 'tools/adduser.js'), u, '--name', `Test ${u.slice(4)}`], { encoding: 'utf8' });
    passwords[u] = /Password: (\S+)/.exec(out)[1];
  }
}
function cleanUp() {
  const routes = require(path.join(ROOT, 'lib/routes'));
  const segments = require(path.join(ROOT, 'lib/segments'));
  for (const r of routes.list().filter((x) => USERS.includes(x.by))) { routes.remove(r.id, { admin: true, username: 'e2e' }); segments.removeRoute(r.id); }
  for (const u of USERS) {
    try { accounts().deleteUser(u); } catch {}
    fs.rmSync(path.join(ROOT, 'data/ghosts', `${u}.json`), { force: true });
    fs.rmSync(path.join(ROOT, 'data/workouts', `${u}.json`), { force: true });
    fs.rmSync(path.join(ROOT, 'data/rides', u), { recursive: true, force: true });
  }
}

const EMPTY_TILESET = { asset: { version: '1.0' }, geometricError: 0, root: { boundingVolume: { sphere: [0, 0, 0, 1] }, geometricError: 0 } };
// world: the scenery type (scenery.js); 'full' unless a step says so: software rendering would pick Lite by itself
async function open(browser, user, { route = 'alpe-dhuez', viewport = { width: 1280, height: 760 }, world = 'full' } = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport, acceptDownloads: true });
  open.contexts.push(ctx);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  if (!REAL) await p.route(/googleapis\.com/, (r) => r.fulfill({ json: EMPTY_TILESET }));
  await p.addInitScript(([id, w]) => { try { localStorage.setItem('rw.suggested', id); localStorage.setItem('rw.routeTab', 'suggest'); localStorage.setItem('rw.dropin', '0'); localStorage.setItem('rw.cleanRoad2', '0'); localStorage.setItem('rw.world', w); } catch {} }, [route, world]); // clean road (on by default) starts off: the steps below toggle it
  await p.goto(URL + '/login.html?next=%2F%3Fdebug');
  await p.fill('#username', user); await p.fill('#password', passwords[user]); await p.click('#login button[type=submit]');
  await p.waitForSelector('#me:not(:empty)', { timeout: 30000 });
  await p.waitForTimeout(1200);
  return p;
}
open.contexts = [];
// close every page from the last step: each one keeps rendering 3D in software and starves the next
async function closeAll() { for (const c of open.contexts.splice(0)) await c.close().catch(() => {}); }
const api = (p, url, method = 'GET', body) => p.evaluate(async ([url, method, body]) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}, [url, method, body]);
async function loadRide(p) {
  await p.uncheck('#mp-dropin');
  await p.waitForSelector('#btn-go-sim:not([disabled])');
  await p.click('#btn-go-sim');
  await p.waitForSelector('#hud:not(.hidden)', { timeout: REAL ? 240000 : 120000 });
}
const rw = (p, fn, arg) => p.evaluate(fn, arg);

(async () => {
  cleanUp();
  makeUsers();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---------- setup screen ----------
    let p = await open(browser, USERS[0]);
    await step('setup screen', async () => {
      check('setup screen loads without errors', p.errors.length === 0, p.errors.join('; '));
      for (const id of ['#cfg-quality', '#cfg-target', '#cfg-music', '#bot-add', '#ghost-list', '#mp-groups', '#btn-go', '#btn-go-sim', '#btn-advanced'])
        check(`setup has ${id}`, await p.$(id) !== null);
      check('Go ride needs sensors, Simulator doesn\'t', await p.evaluate(() => document.getElementById('btn-go').disabled && /trainer|route/i.test(document.getElementById('btn-go').textContent)));
      // trainer difficulty lives in ⚙ Advanced now, with a way back to 50%
      await p.click('#btn-advanced'); await p.waitForSelector('#dlg-advanced[open]');
      await p.fill('#cfg-diff', '90'); await p.dispatchEvent('#cfg-diff', 'input');
      await p.click('#diff-reset');
      check('Advanced: difficulty back to 50%', (await p.inputValue('#cfg-diff')) === '50' && (await p.textContent('#cfg-diff-val')) === '50%');
      await p.click('#close-advanced');
      check('detail defaults to Auto, priority to Sharp', (await p.inputValue('#cfg-quality')) === 'auto' && (await p.inputValue('#cfg-target')) === 'sharp');
      await p.fill('#cfg-music', 'https://music.youtube.com/playlist?list=PLtest123'); await p.dispatchEvent('#cfg-music', 'input');
      await p.waitForFunction(() => document.getElementById('music-check').textContent.includes('✓'), null, { timeout: 15000 }).catch(() => {});
      check('music link is recognised', (await p.textContent('#music-check')).includes('Playlist'));
      check('…and kept as a recent one', (await p.$$('#music-recent button')).length === 0 && (await p.evaluate(() => (localStorage.getItem('rw.musicRecent') || '').includes('PLtest123'))));
      await p.click('#music-clear');
      check('✕ clears it, and the recent one is offered', (await p.inputValue('#cfg-music')) === '' && (await p.$$('#music-recent button')).length === 1);
    });

    // ---------- pacers saved to the account ----------
    await step('pacers', async () => {
      p = await open(browser, USERS[0]);
      await p.click('#bot-add'); await p.click('#bot-add');
      await p.fill('[data-bot="0"]', '150'); await p.dispatchEvent('[data-bot="0"]', 'change');
      await p.fill('[data-bot="1"]', '260'); await p.dispatchEvent('[data-bot="1"]', 'change');
      await p.waitForTimeout(800);
      await p.reload(); await p.waitForSelector('#me:not(:empty)'); await p.waitForTimeout(1200);
      check('pacers are kept in the account', (await p.inputValue('#cfg-bots')) === '[{"w":150},{"w":260}]', await p.inputValue('#cfg-bots'));
      check('page still loads with pacers saved', p.errors.length === 0, p.errors.join('; '));
    });

    // ---------- a simulator ride ----------
    await step('ride', async () => {
      p = await open(browser, USERS[0]);
      await loadRide(p);
      check('ride screen shows', await p.isVisible('#g-power') && await p.isVisible('#minimap'));
      check('a hint says how to start', /↑|pedalling/.test(await p.textContent('#toast')));
      await p.keyboard.press('ArrowUp');
      await p.waitForTimeout(1500);
      check('the first ↑ starts the ride', await rw(p, () => window.__rw.state.riding));
      await p.waitForTimeout(12000);
      const s = await rw(p, () => ({ d: window.__rw.state.dist, pacers: window.__rw.state.pacers.map((x) => x.dist), pill: document.getElementById('perf').textContent }));
      check('we move', s.d > 2, `${s.d.toFixed(1)} m`);
      check('pacers ride at their own pace', s.pacers[1] > s.pacers[0], s.pacers.map((x) => x.toFixed(1)).join(' / '));
      check('frame-rate pill reports detail', /fps · \d+% res · /.test(s.pill), s.pill);
      // camera: a ride opens on the Default view (setup "View at the start"); C steps through the views and, after
      // the last, starts the slideshow, which moves on every 30 s; C again keeps the current view
      const cam0 = await p.textContent('#cam-name');
      const nViews = await p.evaluate(async () => (await import('/js/app/camera.js')).CAMS.length);
      for (let k = 0; k < nViews; k++) await p.keyboard.press('c');
      await p.waitForTimeout(300);
      const show0 = await p.textContent('#cam-name');
      await rw(p, () => { window.__rw.state.slideAt = performance.now() - 31000; });
      await p.waitForTimeout(1500);
      const show1 = await p.textContent('#cam-name');
      await p.keyboard.press('c'); await p.waitForTimeout(300);
      const show2 = await p.textContent('#cam-name');
      check('rides open on Default; after the last view C starts the slideshow, which moves on; C stops it', cam0 === 'Default' && show0 === '▶ Default' && show1 === '▶ Chase' && show2 === 'Chase', [cam0, show0, show1, show2].join(' → '));
      check('route line drawn (clean road off)', await rw(p, () => window.__rw.state.line.show && window.__rw.state.linePts.length > 10));
      await p.keyboard.press('k'); await p.waitForTimeout(2500);
      check('clean road on: line hidden, road laid', await rw(p, () => !window.__rw.state.line.show && window.__rw.state.tileset.clippingPolygons?.length === 1));
      await p.keyboard.press('k'); await p.waitForTimeout(1500);
      check('rider list shows the pacers', (await p.textContent('#mp-panel')).includes('Pacer 260 W'));
      await p.click('#btn-more'); // ride files and the log live in the dock's ⋯ menu
      const dlLog = p.waitForEvent('download'); await p.click('#btn-log');
      const logText = fs.readFileSync(await (await dlLog).path(), 'utf8').trim().split('\n');
      check('ride log downloads (one row a second)', logText[0].startsWith('time_s,distance_m,power_w') && logText.length >= 3, `${logText.length - 1} rows`);
      await p.keyboard.press('h'); await p.waitForTimeout(3500);
      check('a pacer returns a chapeau', /Chapeau from Pacer/.test(await p.textContent('#toast')), await p.textContent('#toast'));
      // drafting: put the faster pacer 3 m ahead of us on our line
      await rw(p, () => { const w = window.__rw, s = w.state, f = s.pacers[1]; s.simWatts = 260; f.dist = s.dist + 3.2; f.bike.v = w.bikeV(); s.pacers[0].dist = s.dist - 30; });
      // wait for it (slow with real tiles: a frame every couple of seconds)
      await p.waitForFunction(() => window.__rw.state.draft > 0.15, null, { timeout: REAL ? 120000 : 30000 }).catch(() => {});
      await p.waitForTimeout(1000);
      const dr = await rw(p, () => ({ draft: window.__rw.state.draft, pill: document.getElementById('draft').classList.contains('on'), streaks: window.__rw.viewer.entities.values.filter((e) => e.polyline && e.show && e.polyline.material instanceof Cesium.PolylineGlowMaterialProperty).length }));
      check('drafting behind a pacer', dr.draft > 0.15, `${(dr.draft * 100).toFixed(0)}%`);
      check('draft readout and slipstream show', dr.pill && dr.streaks >= 5, `${dr.streaks} streaks`);
      // finish (sim jump) with two minutes of samples (long enough to be kept, were it not the simulator)
      await rw(p, () => { const w = window.__rw; w.recorder.samples.length = 0; for (let i = 1; i <= 120; i++) w.recorder.samples.push({ distance: i * 8, power: 200, speed: 8, lat: 0, lon: 0, ele: 0, cadence: 85, time: new Date() }); w.state.elapsed = 120; w.state.dist = w.route.length - 45; });
      // the end of the route (Zwift style): a solo rider turns straight round and keeps riding; a box offers Keep riding / Finish
      const boxed = await p.waitForSelector('#end-box:not(.hidden)', { timeout: 120000 }).then(() => true, () => false);
      check('the end of the route turns round without stopping and asks', boxed && (await rw(p, () => window.__rw.state.riding && window.__rw.state.legs === 1)));
      check('Keep riding counts down from 20', /Keep riding \((20|19|18)\)/.test(await p.textContent('#end-keep')), await p.textContent('#end-keep'));
      await p.click('#end-keep');
      check('"Keep riding" closes the box and carries on', await p.isHidden('#end-box') && (await rw(p, () => window.__rw.state.riding)));
      await p.waitForTimeout(1500);
      check('ETA and climbing show', /\d/.test(await p.textContent('#m-eta')) && /↓/.test(await p.textContent('#m-climb-label')), `${await p.textContent('#m-eta')} | ${await p.textContent('#m-climb-label')}`);
      // Esc opens the ride panel (settings + Resume / Finish & save); Esc again resumes
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      check('Esc opens the ride panel, paused, with the ride so far', await p.isVisible('#midride-bar') && !(await rw(p, () => window.__rw.state.riding)) && /W average/.test(await p.textContent('#midride-stats')), await p.textContent('#midride-stats'));
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      check('Esc again resumes', await p.isHidden('#midride-bar') && (await rw(p, () => window.__rw.state.riding)));
      await p.click('#btn-finish'); await p.waitForTimeout(500);
      check('Finish opens the same panel (no confirm box)', await p.isVisible('#btn-endride'));
      await p.click('#btn-endride');
      await p.waitForSelector('#finish-panel:not(.hidden)', { timeout: 120000 });
      await p.waitForTimeout(2500);
      check('finish panel shows', (await p.textContent('#finish-stats')).includes('Average power'));
      // a simulator ride leaves nothing behind (the owner 2026-10-18): no ghost, nothing in My rides, no Strava
      await p.waitForTimeout(2000);
      const simGhosts = (await api(p, 'api/ghosts/alpe-dhuez')).ghosts || [];
      const simRides = (await api(p, 'api/rides')).rides || [];
      check('a simulator ride is not kept (no ghost, not in My rides)', simGhosts.length === 0 && simRides.length === 0, `${simGhosts.length} ghosts, ${simRides.length} rides`);
      check('the summary says why, and offers no Strava upload', /Simulator ride/.test(await p.textContent('#finish-strava-msg')) && await p.isHidden('#finish-strava'));
      const refused = await p.evaluate(async () => (await fetch('api/ghosts/alpe-dhuez', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time: 60, length: 1000, sim: true, samples: [1, 2, 3] }) })).status);
      check('the server refuses simulator ghosts too', refused === 400, String(refused));
      // a real ride, posted as the browser would after riding with a trainer: kept as a ghost and in My rides
      const realId = await p.evaluate(async () => {
        const { toFit } = await import('/js/fit.js');
        const samples = Array.from({ length: 120 }, (_, i) => ({ distance: (i + 1) * 8, power: 200, speed: 8, lat: 50.8, lon: -0.1, ele: 5, cadence: 85, hr: 130, time: new Date(Date.now() - (120 - i) * 1000) }));
        const fit = toFit(samples, { name: 'Brighton Rocks', elapsed: 120 });
        let bin = ''; for (const b of fit) bin += String.fromCharCode(b);
        const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
        await post('api/ghosts/alpe-dhuez', { time: 120, length: window.__rw.route.length, sim: false, samples: samples.map((x) => x.distance) });
        const r = await post('api/rides', { summary: { name: "Alpe d'Huez", routeId: 'alpe-dhuez', time: 120, distance: 960, avgPower: 200, sim: false, finished: true }, fit: btoa(bin) });
        return r.ride?.id;
      });
      const ghosts = (await api(p, 'api/ghosts/alpe-dhuez')).ghosts || [];
      check('a real ride is kept as a ghost', ghosts.length === 1 && !ghosts[0].sim, JSON.stringify(ghosts.map((g) => g.time)));
      const kept = (await api(p, 'api/rides')).rides || [];
      check('a real ride is kept in My rides', kept.length === 1 && kept[0].id === realId && !kept[0].sim && kept[0].time >= 120, JSON.stringify(kept.map((r) => [r.name, r.time, r.distance])));
      const fitHead = await p.evaluate(async (id) => { const b = new Uint8Array(await (await fetch(`api/rides/${id}.fit`)).arrayBuffer()); return String.fromCharCode(...b.slice(8, 12)); }, kept[0]?.id);
      check('its .fit downloads', fitHead === '.FIT', fitHead);
      check('no errors while riding', p.errors.length === 0, p.errors.join('; '));
    });

    // ---------- riding against the ghost ----------
    await step('ghost', async () => {
      p = await open(browser, USERS[0]);
      await p.waitForFunction(() => document.getElementById('rides-list').textContent.includes("Alpe d'Huez"), null, { timeout: 15000 }).catch(() => {});
      check('setup screen lists the ride', (await p.textContent('#rides-list')).includes("Alpe d'Huez"));
      await p.waitForSelector('[data-ghost]', { timeout: 15000 });
      await p.locator('[data-ghost]').first().check();
      await loadRide(p);
      await p.keyboard.press('ArrowUp'); await p.waitForTimeout(8000);
      const g = await rw(p, () => { const w = window.__rw, gh = w.state.ghosts[0]; return { n: w.state.ghosts.length, d: gh ? gh.distAt(w.state.elapsed) : -1, t: w.state.elapsed, alpha: [...w.remotes.values()].find((r) => r.ghost)?.model?.color?.alpha }; });
      check('the ghost rides along', g.n === 1 && Math.abs(g.d - g.t * 8) < 1, `${g.d.toFixed(1)} m at ${g.t.toFixed(1)} s`);
      check('the ghost is see-through', g.alpha > 0 && g.alpha < 1, String(g.alpha));
    });

    // ---------- route editor and export / replace on a throwaway route ----------
    await step('editor', async () => {
      p = await open(browser, USERS[0]);
      const gpx = fs.readFileSync(path.join(ROOT, 'seed-routes/westminster.gpx'), 'utf8');
      const made = await api(p, 'api/routes', 'POST', { name: 'E2E copy', gpx });
      const id = made.route.id;
      p = await open(browser, USERS[0], { route: id });
      await loadRide(p);
      await rw(p, () => { window.__rw.state.dist = 1000; });
      await p.waitForTimeout(1500);
      await p.keyboard.press('e'); await p.waitForTimeout(1500);
      check('editor opens on your own route', await rw(p, () => window.__rw.ed.on));
      await p.keyboard.press('k'); await p.waitForTimeout(2000); // clean road on: the line still shows in the editor
      check('route line shows in the editor even with clean road on', await rw(p, () => window.__rw.state.line.show));
      await p.keyboard.press('k');
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600); await p.keyboard.press('ArrowRight');
      await p.waitForTimeout(1500); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
      const info = (await api(p, 'api/routes')).routes.find((r) => r.id === id);
      check('a correction is saved', info.adjust?.length === 1 && info.adjust[0].right === 1, JSON.stringify(info.adjust));
      // route details: bank height and the high camera are saved per route
      await api(p, 'api/routes/' + id, 'PATCH', { name: 'E2E copy', banks: '1', camHigh: true });
      const det = (await api(p, 'api/routes')).routes.find((r) => r.id === id);
      check('route details keep the bank height and the high camera', det.banks === 1 && det.camHigh === true, JSON.stringify({ banks: det.banks, camHigh: det.camHigh }));
      // export, then replace the route with its own export
      p = await open(browser, USERS[0], { route: id });
      const dl = p.waitForEvent('download'); await p.selectOption(`[data-export="${id}"]`, 'gpx'); const d = await dl;
      const file = path.join(require('os').tmpdir(), `e2e-${process.pid}.gpx`);
      await d.saveAs(file);
      check('export has the correction built in', fs.readFileSync(file, 'utf8').includes('RideWorld') && (await p.textContent('#toast')).includes('1 correction'));
      const fc = p.waitForEvent('filechooser'); await p.click(`[data-replace="${id}"]`); await (await fc).setFiles(file);
      await p.waitForTimeout(2500);
      const after = (await api(p, 'api/routes')).routes.find((r) => r.id === id);
      check('replace keeps the route, clears corrections', !after.adjust && after.presmoothed && after.previousCorrections?.adjust?.length === 1);
      fs.rmSync(file, { force: true });
    });

    // ---------- a segment: coming up, live timer, result, leaderboard ----------
    await step('segments', async () => {
      p = await open(browser, USERS[0]);
      const gpx = fs.readFileSync(path.join(ROOT, 'seed-routes/westminster.gpx'), 'utf8');
      const id = (await api(p, 'api/routes', 'POST', { name: 'E2E segments', gpx })).route.id;
      const put = await api(p, `api/routes/${id}/segments`, 'PUT', { segments: [{ name: 'E2E sprint', from: 1.0, to: 1.06, kind: 'sprint' }] });
      check('a segment is saved on the route', put.route?.segments?.[0]?.name === 'E2E sprint', JSON.stringify(put));
      p = await open(browser, USERS[0], { route: id });
      await p.waitForFunction(() => document.getElementById('seg-list').textContent.includes('E2E sprint'), null, { timeout: 15000 }).catch(() => {});
      check('setup lists the segment', (await p.textContent('#seg-list')).includes('E2E sprint'));
      await loadRide(p);
      await rw(p, () => { window.__rw.state.dist = 960; window.__rw.state.simWatts = 400; });
      await p.waitForTimeout(1500);
      check('a heads-up as it comes up', /E2E sprint.*in /.test(await p.textContent('#seg-live')), await p.textContent('#seg-live'));
      await p.keyboard.press('ArrowUp'); // set off
      await p.waitForFunction(() => /to go/.test(document.getElementById('seg-live').textContent), null, { timeout: 90000 });
      check('a live timer on the segment', /E2E sprint/.test(await p.textContent('#seg-live')));
      check('arches at the segment', await rw(p, () => Object.keys(window.__rw.state.arches).filter((k) => k.startsWith('seg:')).length) >= 1);
      await p.waitForFunction(() => /first time/.test(document.getElementById('seg-live').textContent), null, { timeout: 120000 });
      check('the result at the end', /E2E sprint .* first time \(sim\)/.test(await p.textContent('#seg-live')), await p.textContent('#seg-live'));
      const b = (await api(p, `api/segments/${id}`)).boards;
      const seg = put.route.segments[0].id;
      check('the time is kept (as a simulator effort, not on the leaderboard)', b[seg]?.bestSim?.time > 2 && !b[seg].best && b[seg].riders === 0, JSON.stringify(b[seg] && { sim: b[seg].bestSim?.time, riders: b[seg].riders }));
      check('no errors on the segment', p.errors.length === 0, p.errors.join('; '));
    });

    // ---------- a workout: pick, ride (the simulator follows the target), skip; import a .zwo ----------
    await step('workout', async () => {
      p = await open(browser, USERS[0]);
      const fc = p.waitForEvent('filechooser'); await p.click('#wo-import'); await (await fc).setFiles(path.join(__dirname, 'fixtures/sample.zwo'));
      await p.waitForTimeout(2000);
      check('a .zwo is imported and selected', (await p.$eval('#cfg-workout', (s) => s.selectedOptions[0]?.textContent)) === 'Test 2x2' && /TSS/.test(await p.textContent('#wo-info')), await p.textContent('#wo-info'));
      await p.selectOption('#cfg-workout', 'b:vo2'); await p.fill('#cfg-ftp', '200'); await p.dispatchEvent('#cfg-ftp', 'change');
      await loadRide(p);
      check('the workout panel shows', await p.isVisible('#wo-panel') && (await p.textContent('#wo-name')) === 'VO2 max 5 × 4');
      await p.keyboard.press('ArrowUp'); await p.waitForTimeout(4000);
      const a = await rw(p, () => ({ target: window.__rw.state.woTarget, sim: window.__rw.state.simWatts, erg: window.__rw.state.woErg, marker: getComputedStyle(document.querySelector('#g-power .g-target')).display }));
      check('warm-up target from FTP, the simulator follows it', a.target >= 90 && a.target <= 100 && Math.abs(a.sim - a.target - 10) <= 1, JSON.stringify(a));
      check('ERG is on and the dial shows the target', a.erg === true && a.marker !== 'none');
      await p.click('#wo-skip'); await p.waitForTimeout(1500);
      const b = await rw(p, () => window.__rw.state.woTarget);
      check('skip goes to the first effort (115% of 200 W)', b === 230, String(b));
      check('the panel shows target and time left', /230 W .* left · 1\/5/.test(await p.textContent('#wo-now')), await p.textContent('#wo-now'));
      // tidy: delete the imported workout
      const mineList = (await api(p, 'api/workouts')).workouts;
      for (const w of mineList) await api(p, `api/workouts/${w.id}`, 'DELETE');
      check('no errors in the workout', p.errors.length === 0, p.errors.join('; '));
    });

    // ---------- Lite scenery: terrain + imagery, the road cut into the globe, heights read from the terrain ----------
    await step('lite scenery', async () => {
      p = await open(browser, USERS[0], { world: 'lite' });
      await loadRide(p);
      await p.keyboard.press('ArrowUp'); await p.waitForTimeout(4000);
      const s = await rw(p, () => { const st = window.__rw.state, raw = st.survey?.raw || []; return { lite: !!st.lite, globe: st.tileset === window.__rw.viewer.scene.globe, clips: st.tileset?.clippingPolygons?.length || 0, measured: raw.filter(Number.isFinite).length, of: raw.length, road: !!st.cleanRoad }; });
      check('Lite scenery: globe in place of the tiles', s.lite && s.globe, JSON.stringify(s));
      check('Lite scenery: road heights read from the terrain', s.measured >= 10 && s.measured >= s.of * 0.8, `${s.measured}/${s.of}`);
      check('Lite scenery: the road laid and cut into the ground', s.road && s.clips >= 1, JSON.stringify(s));
      check('no errors in Lite', p.errors.length === 0, p.errors.join('; '));
    });

    // ---------- a private group ride with two browsers ----------
    await step('group ride', async () => {
      const a = await open(browser, USERS[0]), b = await open(browser, USERS[1]);
      // group rides live in the server's memory for 4 h: clear any left by an earlier run, then join the new one by id
      for (const g of ((await api(a, 'api/groups')).groups || []).filter((x) => x.name === 'E2E group')) await api(a, `api/groups/${g.id}`, 'DELETE');
      await a.fill('#mp-name', 'E2E group'); await a.click('#mp-create'); await a.waitForTimeout(1200);
      const gid = ((await api(a, 'api/groups')).groups || []).find((x) => x.name === 'E2E group')?.id;
      await b.waitForTimeout(5500);
      await b.click(`#mp-groups [data-join="${gid}"]`); await b.waitForTimeout(1200);
      await loadRide(a); await loadRide(b); // one at a time: two at once is too slow for software rendering
      await a.waitForTimeout(2500);
      check('members wait for the host', await b.isDisabled('#btn-ride') && /waiting for/.test(await b.textContent('#mp-lobby-text')));
      await a.click('#mp-start');
      for (const x of [a, b]) await x.waitForFunction(() => window.__rw.state.riding, null, { timeout: REAL ? 90000 : 30000 }).catch(() => {});
      const ra = await rw(a, () => ({ riding: window.__rw.state.riding, others: [...window.__rw.remotes.keys()] }));
      const rb = await rw(b, () => window.__rw.state.riding);
      check('the host starts everyone', ra.riding && rb);
      if (!(ra.riding && rb)) for (const [n, x] of [['host', a], ['member', b]]) console.log(`      ${n}:`, JSON.stringify(await rw(x, () => { const m = window.__rw.mp; return { room: m.room, want: m.wantRoom, ws: m.ws?.readyState, group: m.group && { status: m.group.status, riders: m.group.riders, host: m.group.host }, riders: [...m.riders.keys()], lobby: document.getElementById('mp-lobby-text').textContent, start: !document.getElementById('mp-start').classList.contains('hidden') }; })));
      check('riders see each other', ra.others.includes(USERS[1]), ra.others.join(','));
      await b.locator('#mp-panel [data-id]').first().dispatchEvent('pointerdown');
      const got = await a.waitForFunction(() => /Chapeau from Test two/.test(document.getElementById('toast').textContent), null, { timeout: 6000 }).then(() => true, () => false);
      check('a chapeau reaches the other rider', got, await a.textContent('#toast'));
      check('no errors in the group ride', a.errors.length + b.errors.length === 0, a.errors.concat(b.errors).join('; '));
      const groups = (await api(a, 'api/groups')).groups.filter((g) => g.name === 'E2E group');
      for (const g of groups) await api(a, `api/groups/${g.id}`, 'DELETE');
    });
  } finally {
    await browser.close();
    cleanUp();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
