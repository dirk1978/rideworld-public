import { devices } from './devices.js';
import { initGears, shift, slopeFor, updateGears } from './app/gearsui.js';
import { toFit } from './fit.js';
import { music, sound, startSound, rideSound } from './app/audio.js';
import { nextCam, placeCamera, placeMe, resetFree, startView } from './app/camera.js';
import { preparePacersAndGhosts } from './app/company.js';
import { $, U, bike, download, fmtDist, fmtTime, kg, recorder, rideDist, route, setRoute, state, store, toast } from './app/core.js';
import { ed, editorKey, openEditor } from './app/editor.js';
import { dropIn } from './app/groups.js';
import { drawProfile, finishRide, setupGauges, showEndBox, takeScreenshot, updateHud, updateMinimap } from './app/hud.js';
import { initCoach, renderCoach, updateCoach } from './app/coach.js';
import { initRcInvite, rcTipAtStart } from './app/rcinvite.js';
import { rideLogCsv } from './app/rides.js';
import { initAnalysis } from './app/analysis.js';
import { initGoals } from './app/goals.js';
import { initKit } from './app/kitui.js';
import { initScreen } from './app/screen.js';
import { bandFactor, giveChapeau, mp, remotes, updateDrafts, updateMultiplayer } from './app/riders.js';
import { adaptResolution, buildViewer, finishAt, updateArches, updateLine, viewer, waitForScenery } from './app/scenery.js';
import { loadRiderModel, roadPoint } from './app/model.js';
import { setStance, stanceStep } from './stance.js';
import { sendTrainerSetup, sensorNames } from './app/setup.js';
import { groundHeight, roadGrade, surveyAhead } from './app/survey.js';
import * as Audio from './app/audio.js';
import * as Camera from './app/camera.js';
import * as Company from './app/company.js';
import * as Core from './app/core.js';
import * as Editor from './app/editor.js';
import * as Groups from './app/groups.js';
import * as Hud from './app/hud.js';
import * as Riders from './app/riders.js';
import * as Scenery from './app/scenery.js';
import * as Setup from './app/setup.js';
import * as Segments from './app/segments.js';
import * as CleanRoad from './app/cleanroad.js';
import * as Workouts from './app/workouts.js';
import * as Rides from './app/rides.js';
import * as Shots from './app/shots.js';
import * as Remote from './app/remote.js';
import * as RoadFinder from './app/roadfinder.js';
import { startRemote } from './app/remote.js';
import { startTabCapture, updateShots } from './app/shots.js';
import { saveRide } from './app/rides.js';
import { startWorkout, updateWorkout, wo } from './app/workouts.js';
import { cleanRoad, updateCleanRoad } from './app/cleanroad.js';
import { loadLandmarks, updateLandmarks } from './app/landmarks.js';
import { updateTunnels } from './app/tunnels.js';
import { loadWorld, updateWorld, world } from './app/world.js';
import { initOpenWorld, startOpenWorld, updateOpenWorld, surfaceNow } from './app/openworld.js';
import { initSatnav, updateSatnav } from './app/satnav.js';
import { initPaint } from './app/paint.js';
import { initClips } from './app/clips.js';
import { initKitPreview } from './app/kitpreview.js';
import { updateEarthworks } from './app/earthworks.js';
import { initTouchMenu } from './app/touchmenu.js';
import { initUi, launch, launchDone } from './app/ui.js';
import { updateNames } from './app/names.js';
import { initReport, openReport } from './app/report.js';
import { initTabIcon } from './app/tabicon.js';
import { loadBoards, updateSegments } from './app/segments.js';
import { turnAround } from './app/turnaround.js';
import { initTrip, updateTrip } from './app/trip.js';
import { holdAtJoin, updatePieces } from './app/pieces.js';
import { samplesToGpx } from './formats.js';


// At the start of a real ride: what's connected, said plainly (2026-11-14: a rider's watch never connected and they only
// found out by going back to the setup screen), and a line for the server log about the machine (GPU, quality, frame
// rate a minute in), so "the graphics were bad" can be looked into.
function rideStartInfo() {
  const sim = $('cfg-sim').checked, n = sensorNames();
  if (!sim) {
    const got = [n.trainer && `${n.trainer} (trainer)`, n.power && n.power !== n.trainer && `${n.power} (power)`, n.hr && `${n.hr} (heart rate)`].filter(Boolean);
    toast(`${got.length ? 'Riding with ' + got.join(', ') + '.' : 'No sensors connected.'}${n.hr ? '' : ' No heart rate: tap "No HR" at the bottom to add your strap or watch.'}`, 9000);
  }
  const line = (extra) => fetch('api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'ride-info', msg: `${route?.name || '?'} sim=${sim} gpu=${state.gpu?.renderer || '?'} tier=${state.gpu?.name ?? state.gpu?.tier ?? '?'} dpr=${devicePixelRatio} ${innerWidth}x${innerHeight} sensors=${JSON.stringify(n)} ${extra}` }) }).catch(() => {});
  line('start');
  setTimeout(() => {
    const perf = $('perf')?.textContent || '';
    line(`after 60 s: ${perf}${state.lite ? ' (lite)' : ''}`);
    // still slow in photo-real 3D a minute in: say the generated-world routes run smoother (the Scenery type choice is
    // hidden since 2026-11-15: routes set their own scenery), once a browser
    if (!state.lite && (parseFloat(perf) || 99) < 18 && store.get('liteHint', '') !== '1') {
      store.set('liteHint', '1');
      toast('This computer is finding the photo-real 3D hard going. Routes in the generated world (CCCP, Bristol, Bromsgrove...) run much more smoothly.', 12000);
    }
  }, 60000);
}

// ---------- simulator: a believable cadence and heart rate ----------
// Cadence drifts around ~88 rpm, drops a little on climbs and rises on descents, and is 0 until you ride.
// Heart rate chases a target set by power (about 65 + 0.33 bpm per watt), rising over ~25 s and falling
// over ~40 s like a real heart, with a slow drift and a little beat-to-beat noise.
function simulateRider(dt, grade) {
  const pedalling = state.riding && state.simWatts > 0;
  state.simWobble += dt * (Math.random() - 0.5) * 6;            // random walk, rpm
  state.simWobble *= 1 - dt * 0.15;                              // pulled back towards 0
  const climb = Math.max(-6, Math.min(14, grade));
  const cadTarget = pedalling ? Math.max(58, 88 - climb * 1.6 + state.simWobble + Math.sin(state.elapsed / 23) * 2) : 0;
  state.simCad += (cadTarget - state.simCad) * Math.min(1, dt * (pedalling ? 1.5 : 3));
  if (!pedalling && state.simCad < 1) state.simCad = 0;

  const effort = state.riding ? state.simWatts : 0;
  const hrTarget = Math.min(192, 64 + effort * 0.33 + state.elapsed / 120); // + slow cardiac drift
  const tau = hrTarget > state.simHr ? 25 : 40;
  state.simHr += (hrTarget - state.simHr) * Math.min(1, dt / tau) + (Math.random() - 0.5) * dt * 4;
}

// ---------- ride loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const sim = $('cfg-sim').checked;
  if (sim && state.riding) state.simUsed = true; // a simulated ride: never kept in My rides, as a ghost or on Strava
  updateWorkout(now); // the target for now (and the simulator's power, which follows it)
  const watts = sim ? state.simWatts : devices.power;
  // 3-second average for the power dial (trainers report spiky instantaneous power); the ride file keeps the
  // real 1 Hz values, and speed comes from the physics, which already smooths through the bike's inertia
  state.pHist.push([now, watts]);
  while (state.pHist.length && now - state.pHist[0][0] > 3000) state.pHist.shift();
  const watts3s = state.pHist.reduce((a, x) => a + x[1], 0) / state.pHist.length;
  const grade = roadGrade(state.dist);
  if (sim) simulateRider(dt, grade);
  const hr = devices.hrConnected ? devices.hr : (sim ? Math.round(state.simHr) : 0);
  // start the ride when the rider starts pedalling (a second over 30 W or 20 rpm); the button still works, a group
  // ride still waits for the host, and after a Pause it stays paused until resumed
  if (!sim && !state.riding && !state.finished && state.elapsed === 0 && !$('btn-ride').disabled) {
    state.pedalT = devices.power > 30 || devices.cadence > 20 ? (state.pedalT || 0) + dt : 0;
    if (state.pedalT > 1) { $('btn-ride').click(); toast('Off you go!', 2500); }
  }
  const cadence = sim ? Math.round(state.simCad) : Math.round(devices.cadence);
  state.crank += (cadence / 60) * dt; // revolutions
  setStance(state.model, stanceStep(state.stance ||= {}, { watts: watts3s, ftp: +$('cfg-ftp').value || 250, grade, cadence, dt, riding: state.riding && !state.finished }));

  updateDrafts(dt);
  if (state.riding) {
    const v = bike.step(watts, grade, dt);
    // group rides: elastic band (the physics speed, trainer and recorded power are untouched; only how far we move)
    state.band = bandFactor();
    const before = state.dist;
    state.dist = Math.min(route.length, state.dist + v * state.band * dt);
    state.dist = holdAtJoin(before, state.dist); // highlights routes: the change-over between pieces (app/pieces.js)
    state.elapsed += dt;
    // Look ~1.5 s ahead: the trainer takes a moment to change resistance after each 1 Hz update.
    // ERG (workouts): the trainer holds the target power; otherwise it feels the road
    if (state.woErg) devices.setTargetPower(state.woTarget);
    else devices.setGrade(slopeFor(roadGrade(state.dist + bike.v * 1.5) * (+$('cfg-diff').value / 100))); // (slopeFor: virtual gears, app/gearsui.js; unchanged when they're off)
    state.sampleAcc += dt;
    if (state.sampleAcc >= 1) {
      state.sampleAcc -= 1;
      const p = route.at(state.dist);
      // (pos and base: where on the route, and which time along it, for the heart-rate line on the elevation graph)
      recorder.add({ lat: p.lat, lon: p.lon, ele: route.smoothEle(state.dist), distance: rideDist(), pos: state.dist, base: state.distBase, speed: bike.v * (state.band || 1), power: watts, hr, cadence,
        // for the ride log (diagnosing the trainer): what we told it, and what the road was doing
        log: { grade: +grade.toFixed(2), sentGrade: devices.sentGrade, ergTarget: devices.ergTarget, woTarget: state.woTarget ?? null,
          draft: +(state.draft || 0).toFixed(3), band: +(state.band || 1).toFixed(3), trainerSpeed: devices.powerSource?.speed ?? null, sim,
          // which device the cadence came from (Bluetooth name, or ANT+), for cadence dropouts
          cadFrom: devices.cadenceSource?.name || (devices.cadenceSource ? 'ANT+' : null) } });
      $('btn-save').disabled = false;
      $('btn-save-fit').disabled = false;
      $('btn-save-gpx').disabled = false;
    }
    if (state.dist >= finishAt() && !state.finished) {
      // Zwift style (the owner 2026-10-26: "the stop is very abrupt"): a solo rider turns straight round and keeps riding
      // (after this frame, so segments see the finish first), and a box asks: Keep riding, or Finish. A group ride
      // finishes at the line.
      if (!mp.group) { state.turnDue = true; state.endDue = true; }
      else finishRide();
    }
  }
  // after the line: no more power, brake gently to a stop
  if (state.finished && bike.v > 0.05) {
    bike.v = Math.max(0, bike.v - dt * 1.8);
    state.dist = Math.min(route.length, state.dist + bike.v * dt);
  }
  updatePieces(dt);
  updateArches();
  updateSegments(watts, dt);
  updateTrip(watts, dt);
  updateCoach(watts, dt, cadence);
  $('btn-clean').classList.toggle('on', !!state.cleanRoad);
  $('btn-finish').classList.toggle('hidden', !(state.elapsed > 0) || !!state.finished); // a definite true/false: toggle(x, undefined) flips it every frame
  if (state.turnDue) { state.turnDue = false; turnAround(!state.endDue); }
  if (state.endDue) { state.endDue = false; showEndBox(); }
  updateCleanRoad();
  updateLandmarks();
  updateEarthworks(); // before the tunnels: a deep cutting is handed to them as a tunnel
  updateTunnels();
  updateOpenWorld(); // open world: junction choices, the road ahead (app/openworld.js)
  updateSatnav(); // the satnav panel (app/satnav.js)
  updateGears(); // the gear pill shows while riding with virtual gears on
  { // rolling resistance from the surface (open worlds: paths and tracks; physics and the trainer)
    const crr = { road: 0.004, paved: 0.0045, gravel: 0.0085, dirt: 0.012, grass: 0.015 }[surfaceNow()] || 0.004;
    if (bike.crr !== crr) { bike.crr = crr; devices.setCrr?.(crr === 0.004 ? null : crr); }
  }
  updateWorld(); // Lite: the generated trees, hedges and buildings around the rider (app/world.js)
  updateNames(); // road and place names as they're reached
  updateShots();
  // pacers ride while we do (and stop when we pause)
  if (state.riding || state.finished) for (const p of state.pacers || []) if (state.riding || p.v > 0) p.step(dt, roadGrade(p.dist), finishAt(), route.length);
  updateMultiplayer(now, dt, watts, cadence);

  surveyAhead();
  if (!state.camHold) placeCamera(dt); // the road finder (roadfinder.js) flies the camera itself
  else placeMe(dt);
  updateLine();
  adaptResolution(now);
  // (2026-11-23, power) the settings screen over a paused ride hides the 3D: draw it 10 times a second, not 60, and
  // keep the quality controller from reading that as a slow machine
  { const idle = document.body.classList.contains('midride'); if (idle !== !!state.renderIdle && viewer) { state.renderIdle = idle; viewer.targetFrameRate = idle ? 10 : undefined; if (state.quality) state.quality.idle = idle; } }
  updateMinimap(now);
  rideSound(bike.v * ((state.riding && state.band) || 1), cadence, watts, world.data, surfaceNow()); // (app/audio.js)
  updateHud(sim ? watts : watts3s, hr, cadence, grade, dt); // the simulator's watts are exact: no lag on ↑/↓
  if (Math.floor(now / 250) !== state.lastProfileDraw) { state.lastProfileDraw = Math.floor(now / 250); drawProfile(); } // 4 a second: the other riders' dots move on it
  requestAnimationFrame(loop);
}
// ---------- start-up, in the original order ----------

await Core.initSettingsFields();
await Setup.initRiderSettings();
await Camera.initCamera();

// ?debug in the address exposes internals for diagnosing (window.__rw)
if (new URLSearchParams(location.search).has('debug')) {
  window.__rw = { state, get viewer() { return viewer; }, get route() { return route; }, get ed() { return ed; }, get mp() { return mp; }, get remotes() { return remotes; }, get sound() { return sound; }, get music() { return music; }, get recorder() { return recorder; }, get cleanRoad() { return cleanRoad; }, get devices() { return devices; }, bikeV: () => bike.v, groundHeight: (d) => groundHeight(d), roadGradeAt: (d) => roadGrade(d),
    setBikeV: (v) => { bike.v = v; }, roadPointAt: (d, side, lift) => roadPoint(d, side, lift) }; // (the trailer director)
}
await Setup.initSetupScreen();

// ---------- scenery ----------
// Go ride (real sensors) or Simulator (↑ / ↓ set the power): the same start, cfg-sim (hidden) says which
async function go(sim) {
  $('cfg-sim').checked = sim;
  state.loading = true;
  $('btn-go-sim').disabled = true;
  startSound(); // browsers only allow sound after a click: this one
  keepAwake(); // phones and tablets: no screen sleep while riding (no one touches the screen while pedalling)
  startTabCapture(); // ride photos of the whole screen: Chrome asks to share this tab (also needs the click)
  $('btn-go').disabled = true;
  $('btn-go').textContent = 'Loading scenery…';
  launch(0);
  try {
    // "Start at" on the setup screen: the same route, started further in (not in group rides: everyone starts together)
    const skip = Setup.skipKm();
    if (skip > 0 && !mp.group) setRoute(route.withSkip(skip));
    await buildViewer();
    await loadLandmarks(); // our own buildings on this route (the Formentor lighthouse on Cap)
    // Lite: the route's map data for the generated world, in the background; an open world needs it first (its road
    // network makes the route, from the chosen start: openworld.js)
    if (route.opts?.open) { await loadWorld(); startOpenWorld(Setup.openStart()); } else loadWorld();
    resetFree();
    await preparePacersAndGhosts();
    await loadBoards();
    startWorkout();
    startRemote(); // the phone remote (/rc) can drive this ride now
    bike.riderKg = kg.rider;
    bike.bikeKg = kg.bike;
    bike.cda = +$('cfg-cda').value;
    sendTrainerSetup();
    devices.setGrade(0);
    // Behind the setup screen: point the camera at the start and wait until Google has sent the full-detail
    // scenery there, then measure the road. Otherwise the ride opens on coarse, still-loading ground that can sit
    // metres above or below the real road, and the rider looks like it floats or sinks until it sharpens.
    placeCamera(0, true);
    $('btn-go').textContent = 'Loading the scenery at the start…';
    launch(1);
    await waitForScenery(20000);
    $('btn-go').textContent = 'Measuring the road…';
    launch(2);
    for (let attempt = 0; attempt < 3; attempt++) {
      await surveyAhead(30); // the first 300 m, so the rider starts on the road
      const first = state.survey.raw.slice(0, 10);
      if (first.filter(Number.isFinite).length >= 5) break;
      state.survey.raw.length = 0; // patchy: tiles were still arriving; measure again
      await new Promise((r) => setTimeout(r, 1500));
    }
    startView(); // the view chosen on the setup screen (or the slideshow, whose 30 s start now)
    placeCamera(0, true);
    $('setup').classList.add('hidden');
    launchDone();
    rcTipAtStart(); // the phone remote: say so a few seconds into the ride (until a phone connects)
    rideStartInfo();
    ['hud', 'profile-wrap', 'controls'].forEach((id) => $(id).classList.remove('hidden'));
    $('sim-hint').classList.toggle('hidden', !$('cfg-sim').checked);
    setupGauges();
    drawProfile();
    dropIn();
    toast($('cfg-sim').checked ? 'Press ↑ (or Start ride) to set off.' : 'Start pedalling to set off.', 6000);
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    launchDone(false);
    toast('Scenery failed to load: ' + e.message, 8000);
    state.loading = false;
    Setup.updateGo();
  }
}
$('btn-go').addEventListener('click', () => go(false));
$('btn-go-sim').addEventListener('click', () => go(true));
await Hud.initHud();

// ---------- controls ----------
$('btn-ride').addEventListener('click', () => {
  state.riding = !state.riding;
  $('btn-ride').textContent = state.riding ? 'Pause' : 'Resume';
  if (!state.riding) devices.setGrade(0);
});
await Camera.initCameraControls();
// FIT is marked as a virtual ride, so Strava files it as a "Virtual Ride" (TCX can only say "Biking")
$('btn-save-fit').addEventListener('click', () => {
  try {
    download(toFit(recorder.samples, { name: route.name, elapsed: state.elapsed }), 'application/vnd.ant.fit', 'fit');
    toast('Saved the .fit file.', 4000);
  } catch (e) { toast('Could not save: ' + e.message); }
});
$('btn-save').addEventListener('click', () => download(recorder.toTcx(route.name), 'application/vnd.garmin.tcx+xml', 'tcx'));
$('btn-save-gpx').addEventListener('click', () => download(samplesToGpx(recorder.samples, route.name), 'application/gpx+xml', 'gpx'));
// Ride log: one row a second of what the trainer reported and what we sent it, for diagnosing hardware
$('btn-log').addEventListener('click', () => download(rideLogCsv(), 'text/csv', 'csv'));

// ⚙ Settings during a ride: pause, show the setup screen over the ride (only what can change mid-ride: the route,
// scenery keys, workout, pacers and group rides are set before a ride), then Resume carries on where you were.
// After a finish it's the way back to the start screen (keeping a ride of a minute or more in My rides).
const settings = { wasRiding: false, kit: '' };
const kitNow = () => ['cfg-jersey', 'cfg-shorts', 'cfg-frame', 'cfg-helmet'].map((id) => $(id)?.value).join();
// Esc and 🏁 Finish open the same screen (the owner 2026-10-29: "the 2 things should be combined"): Resume, or Finish for
// the summary (save, Strava), with the ride so far in its bar. No confirm box any more.
function openPanel() {
  if (state.finished || document.body.classList.contains('midride')) return;
  const s = recorder.samples, pw = s.filter((x) => x.power != null), avg = pw.length ? Math.round(pw.reduce((t, x) => t + x.power, 0) / pw.length) : 0;
  $('midride-stats').textContent = state.elapsed > 0 ? `${fmtDist(rideDist())} · ${fmtTime(state.elapsed)}${avg ? ` · ${avg} W average` : ''}` : '';
  $('btn-endride').classList.toggle('hidden', !(state.elapsed > 0));
  settings.wasRiding = state.riding;
  settings.kit = kitNow();
  state.riding = false;
  document.body.classList.add('midride');
  $('midride-bar').classList.remove('hidden');
  $('setup').classList.remove('hidden');
  $('setup').scrollTop = 0;
  renderCoach(); // (the Coach section adds this ride)
}
$('btn-menu').addEventListener('click', async () => {
  if (state.finished) {
    if (recorder.samples.length >= 60 && !state.simUsed) { toast('Keeping this ride in My rides…', 3000); await saveRide(true); }
    location.reload();
    return;
  }
  openPanel();
});
$('btn-resume').addEventListener('click', async () => {
  // what the settings change: weights, drag, trainer setup, dials (FTP, max HR, units), the rider's kit
  bike.riderKg = kg.rider; bike.bikeKg = kg.bike; bike.cda = +$('cfg-cda').value;
  sendTrainerSetup();
  setupGauges(); drawProfile();
  if (kitNow() !== settings.kit && state.model) { viewer.scene.primitives.remove(state.model); await loadRiderModel(); }
  $('setup').classList.add('hidden');
  $('midride-bar').classList.add('hidden');
  document.body.classList.remove('midride');
  state.riding = settings.wasRiding;
  toast(state.riding ? 'Carrying on.' : 'Press Start ride (or pedal) to carry on.', 3000);
});
$('btn-endride').addEventListener('click', () => {
  $('setup').classList.add('hidden'); $('midride-bar').classList.add('hidden'); document.body.classList.remove('midride');
  if (state.elapsed > 0) finishRide(); else location.reload();
});
// 🎬 Film mode (F): every overlay, the route line, the rider dot and name tags hidden, for screen-recording a video.
// Google's small credit line stays (faintly): published footage must keep it. F again (or Esc) brings it all back.
function toggleFilm(on = !state.film) {
  state.film = on;
  document.body.classList.toggle('film', on);
  if (on) $('dock-menu').classList.add('hidden');
}
$('btn-film').addEventListener('click', () => toggleFilm(true));

// the ⋯ menu: ride files, the ride log, keys
$('btn-more').addEventListener('click', (e) => { e.stopPropagation(); $('dock-menu').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#dock-menu')) $('dock-menu').classList.add('hidden'); });
$('btn-clean').addEventListener('click', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })));
window.addEventListener('keydown', (e) => {
  if ($('dlg-report').open || document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select, [contenteditable]')) return; // typing (the report's note, the satnav search: the owner typed "rose hill" and E opened the route editor)
  if (ed.on && editorKey(e)) return;
  // Esc: out of film mode; else the ride panel (settings, Resume, Finish), and Esc again resumes
  if (e.key === 'Escape' && viewer && !ed.on && !document.querySelector('dialog[open]')) {
    if (state.film) toggleFilm(false);
    else if (document.body.classList.contains('midride')) $('btn-resume').click();
    else if (!state.finished) openPanel();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  if (!typing && viewer) {
    if (e.key === 'f' || e.key === 'F') { toggleFilm(); return; }
    if (e.key === 'm' || e.key === 'M') { music.toggle(); return; }
    if (e.key === 'n' || e.key === 'N') { music.next(); return; }
    if (e.key === 'h' || e.key === 'H') { giveChapeau(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); openReport(); return; }
    if (e.key === '-' || e.key === '_') { $('wo-easier').click(); return; } // workout intensity
    if (e.key === '=' || e.key === '+') { $('wo-harder').click(); return; }
  }
  if ((e.key === 'e' || e.key === 'E') && !$('btn-edit').classList.contains('hidden')) { openEditor(); return; }
  if ((e.key === '[' || e.key === ']') && !ed.on) { shift(e.key === ']' ? 1 : -1); return; } // virtual gears (app/gearsui.js; the route editor has its own [ ])
  // simulator power: W / S (2026-11-15: ↑ also picks the way at open-world junctions), or ↑ / ↓ as before
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    if (wo.steps && !wo.done) wo.simAdj += 10; // in a workout the simulator follows the target; ↑/↓ nudge it
    else state.simWatts = Math.min(1500, state.simWatts + 10);
    // simulator: the first ↑ is "starting to pedal"
    if (viewer && $('cfg-sim').checked && !state.riding && !state.finished && state.elapsed === 0 && !$('btn-ride').disabled) $('btn-ride').click();
  }
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { if (wo.steps && !wo.done) wo.simAdj -= 10; else state.simWatts = Math.max(0, state.simWatts - 10); }
  else if (e.key === 'c' || e.key === 'C') nextCam();
  else if ((e.key === 'p' || e.key === 'P') && viewer) takeScreenshot();
  else if ((e.key === 'j' || e.key === 'J') && $('cfg-sim').checked && route && viewer) {
    // Simulator only: jump to a distance, for checking a spot on a route without riding there
    const u = U();
    const at = parseFloat(prompt(`Jump to which ${u.distUnit}? (0 to ${(route.length / u.dist).toFixed(1)})`, (state.dist / u.dist).toFixed(2)));
    if (Number.isFinite(at)) { state.dist = Math.max(0, Math.min(route.length - 1, at * u.dist)); bike.v = 0; placeCamera(0, true); toast(`Jumped to ${at.toFixed(2)} ${u.distUnit}`); }
  }
  else if (e.key === ' ' && !$('controls').classList.contains('hidden')) { e.preventDefault(); $('btn-ride').click(); }
});
window.addEventListener('resize', () => route && drawProfile());
await Setup.initAccountAndStrava();
await Scenery.initQualityControls();
await Hud.initScreenshots();
await Editor.initEditor();
await Riders.initRiders();
await Groups.initGroups();
await Audio.initAudio();
await Company.initCompany();
await Riders.initDrafting();
await Segments.initSegments();
await CleanRoad.initCleanRoad();
await Workouts.initWorkouts();
await initCoach(); // the virtual coach (after the routes and workouts it suggests from)
initRcInvite(); // the phone remote's card, dialog and ride-start pop-up
initAnalysis(); // the ride analysis panel
initGoals(); // the weekly goal, streak and milestones (sidebar)
initKit(); // the kit picker: jersey designs, colours, your own picture
initScreen(); // which overlays show over the ride (per device)
await Rides.initRides();
await Shots.initShots();
await Remote.initRemote();
await initReport();
await (await import('./app/recover.js')).initRecover();
(await import('./app/landmarks.js')).initFlyby(); // Advanced → Landmark fly-bys // after a lost WebGL context: reload and carry on at the same spot
await initTouchMenu(); // phones and tablets: big ride buttons and the ☰ sheet
initUi(); // the setup screen's sidebar, "Your route" and slider fills
await initTabIcon(); // the tab's icon and title show power and speed during a ride
await RoadFinder.initRoadFinder();
await initTrip();
initOpenWorld(); // ← / → choose the way at open-world junctions
initSatnav(); // 🧭 Go to… (/): find a place, the junctions take you there
initGears(); // virtual gears (Advanced; app/gearsui.js)
initPaint(); // open worlds: painted ground or the satellite photo (G)
initClips(); // ride clips: V or the remote
initKitPreview(); // the live rider preview on the setup screen
// Finish ride, any time once riding (Zwift style): the summary, then save / Strava
$('btn-finish').addEventListener('click', () => openPanel());

// Screen Wake Lock: a phone or tablet would dim and sleep after its timeout while the rider only pedals, and a
// sleeping page stops drawing and can drop Bluetooth. Taken at Load scenery (needs a click), taken again whenever the
// page comes back into view (the browser releases it when hidden). Quietly does nothing where unsupported.
let wakeLock = null;
async function keepAwake() {
  try { if (navigator.wakeLock && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (viewer && document.visibilityState === 'visible') keepAwake(); });
