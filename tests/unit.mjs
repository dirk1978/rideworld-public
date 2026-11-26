// Fast checks of the maths, no browser: node tests/unit.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Bike, routeTime } from '../public/js/physics.js';
import { draftFrom, draftFor } from '../public/js/draft.js';
import { pacerWatts, Pacer, Ghost } from '../public/js/pacers.js';
import { Route, cleanPoints } from '../public/js/route.js';
import { parseLink } from '../public/js/music.js';
import { parseZwo, workoutAt, totalTime, BUILT_IN } from '../public/js/workout.js';
import { fecTargetPower } from '../public/js/ant.js';
import { cpsCadence, ftmsTargetPower, parseCsc, steadyCadence } from '../public/js/ble.js';
import { toFit, toFitCourse } from '../public/js/fit.js';
import { readFit, samplesToGpx, samplesToTcx } from '../public/js/formats.js';
import { findBand, fitSlide } from '../public/js/roadband.js';
import { applyCentre } from '../public/js/route.js';
import { faceMeet, deepRuns, smooth3, clampInside, CUT_SLOPE, FILL_SLOPE, VERGE } from '../public/js/earthworks-math.js';

const here = fileURLToPath(new URL('.', import.meta.url));
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const R = 6371008.8, rad = Math.PI / 180;
const dist = (a, b) => Math.hypot((b.lon - a.lon) * rad * Math.cos(a.lat * rad), (b.lat - a.lat) * rad) * R;
const steady = (watts, grade, draft = 0) => { const b = new Bike(); b.draft = draft; for (let i = 0; i < 4000; i++) b.step(watts, grade, 0.05); return b.v * 3.6; };

// physics
check('200 W on the flat is about 31-35 km/h', near(steady(200, 0), 33.5, 2.5), `${steady(200, 0).toFixed(1)} km/h`);
check('200 W up 5% is about 13-17 km/h', near(steady(200, 5), 15, 2), `${steady(200, 5).toFixed(1)} km/h`);
check('a 30% draft makes 200 W faster', steady(200, 0, 0.3) > steady(200, 0) + 2, `${steady(200, 0, 0.3).toFixed(1)} km/h`);

const steadyB = new Bike();
check('steady speed agrees with riding it out (200 W, flat and 5%)', near(steadyB.steadySpeed(200, 0) * 3.6, steady(200, 0), 0.3) && near(steadyB.steadySpeed(200, 5) * 3.6, steady(200, 5), 0.3), `${(steadyB.steadySpeed(200, 0) * 3.6).toFixed(1)} / ${(steadyB.steadySpeed(200, 5) * 3.6).toFixed(1)} km/h`);

// drafting
check('right on a wheel saves about 35%', near(draftFrom(1.8, 0), 0.35, 0.01));
check('the draft fades with the gap', draftFrom(4, 0) < draftFrom(2.3, 0) && draftFrom(14, 0) === 0);
check('no draft 1.2 m to the side', draftFrom(2.3, 1.2) < 1e-9);
check('no draft when alongside', draftFrom(0.5, 0) === 0);
const line = draftFor({ id: 'me', dist: 0, side: 0 }, [{ id: 'a', dist: 2.3, side: 0 }, { id: 'b', dist: 4.6, side: 0 }, { id: 'c', dist: 6.9, side: 0 }]);
check('a line of riders adds up, capped at 50%', line.draft > draftFrom(2.3, 0) && line.draft <= 0.5 && line.leader.id === 'a', `${(line.draft * 100).toFixed(0)}%`);

// pacers and ghosts
check('pacer: set power on the flat', pacerWatts(200, 0) === 200);
check('pacer: 20% off downhill, 10% on uphill', near(pacerWatts(200, -5), 160, 0.01) && near(pacerWatts(200, 5), 220, 0.01));
check('pacer: no step at small gradients', pacerWatts(200, 0.4) === 200 && pacerWatts(200, 1) > 200 && pacerWatts(200, 1) < 220);
{ // route times: 10 km flat at a steady 165 W, and a climb taking longer than the same distance flat
  const b = new Bike(), flat = routeTime(b, () => 0, 0, 10000, () => 165), climb = routeTime(b, () => 7, 0, 10000, (g) => pacerWatts(165, g));
  check('route time: flat matches the steady speed', near(flat, 10000 / b.steadySpeed(165, 0), 0.5) && climb > 2.5 * flat, `${(flat / 60).toFixed(1)} vs ${(climb / 60).toFixed(1)} min`);
}
const pacer = new Pacer(0, 250, {});
for (let i = 0; i < 600; i++) pacer.step(0.05, 0, 1e9, 1e9);
check('a pacer moves at its power', near(pacer.v * 3.6, steady(250, 0), 3), `${(pacer.v * 3.6).toFixed(1)} km/h after 30 s`);
const ghost = new Ghost({ id: 'x', samples: [8, 16, 24, 32, 40, 48, 56, 64, 72, 80], time: 10 }, 'test');
check('a ghost replays its distances', ghost.distAt(0) === 0 && near(ghost.distAt(2.5), 20, 1e-9) && ghost.distAt(99) === 80);

// routes: built from a seed route (Westminster sights, 5.4 km of BRouter GPX)
const gpx = fs.readFileSync(here + '../seed-routes/westminster.gpx', 'utf8');
// GPX attributes can come in either order (BRouter writes lon first)
const parsePts = (text) => [...text.matchAll(/<trkpt([^>]*)>\s*(?:<ele>([^<]+)<\/ele>)?/g)].map((m) => ({
  lat: +/lat="([^"]+)"/.exec(m[1])[1], lon: +/lon="([^"]+)"/.exec(m[1])[1], ele: +(m[2] || 0) }));
const pts = parsePts(gpx);
const route = new Route('Westminster', pts.map((p) => ({ ...p })));
check('route builds with a sensible length', route.length > 3500 && route.length < 5500, `${route.length.toFixed(0)} m`);
const cleaned = cleanPoints(pts);
check('cleaned points are about 2 m apart', near(dist(cleaned[100], cleaned[101]), 2, 0.3));
const shifted = new Route('B', pts.map((p) => ({ ...p })), [{ from: 2, to: 2.2, right: 2 }]);
const mid = 2100, a = route.at(mid), b = shifted.at(mid);
check('a +2 m correction moves the line 2 m', near(dist(a, b), 2, 0.15), `${dist(a, b).toFixed(2)} m`);
const trimmed = new Route('B', pts.map((p) => ({ ...p })), null, 3.5, 0.5);
check('start and finish trims', near(trimmed.length, 3000, 30) && trimmed.km(0) === 0.5 && near(trimmed.m(0.6), 100, 1e-9), `${trimmed.length.toFixed(0)} m`);
// "Start at": the skip adds to the route's own start; trims and km conversions still in full-route km
const skipped = trimmed.withSkip(1);
check('start at: a 1 km skip starts 1 km after the route\'s own start', near(skipped.startKm, 1.5, 1e-9) && near(skipped.length, 2000, 30) && near(skipped.shiftM, 1000, 1e-6) && skipped.km(0) === 1.5,
  `start ${skipped.startKm} km, ${skipped.length.toFixed(0)} m`);
check('start at: a skip past the finish leaves the last 200 m', near(trimmed.withSkip(50).length, 200, 5), `${trimmed.withSkip(50).length.toFixed(0)} m`);
check('start at: the editor\'s rebuild keeps the route\'s own trims', skipped.withAdjust([]).startKm === 1.5 && trimmed.withAdjust([]).startKm === 0.5);
// highlights: pieces ridden one after another; toV / fromV map ride metres to distance ridden
const hl = new Route('H', pts.map((p) => ({ ...p })), null, null, null, { pieces: [{ from: 0.5, to: 1.0, name: 'A' }, { from: 2.0, to: 2.4, name: 'B' }, { from: 3.0, to: 3.3, name: 'C' }] });
check('highlights: starts at the first piece, ends at the last, rides only the pieces', hl.startKm === 0.5 && near(hl.length, 2800, 30) && near(hl.rideLength, 1200, 2),
  `${hl.length.toFixed(0)} m long, ${hl.rideLength.toFixed(0)} m ridden`);
check('highlights: distance ridden <-> ride metres', near(hl.fromV(600), 1600, 1) && near(hl.toV(1600), 600, 1) && near(hl.toV(1200), 500, 1) && hl.pieceAt(2600).p.name === 'C');
const hls = hl.withSkip(0.6); // 500 m of A, then 100 m into B (a skip leaving under 200 m of a piece moves on to the next)
check('highlights: a skip drops whole pieces, then starts part-way into the next', hls.pieces.length === 2 && near(hls.startKm, 2.1, 1e-9) && near(hls.rideLength, 600, 2), `${hls.pieces.length} pieces from ${hls.startKm} km`);
const hlr = hl.reversed();
check('highlights: turning round mirrors the pieces', hlr.pieces[0].name === 'C' && near(hlr.rideLength, hl.rideLength, 1e-6) && near(hlr.pieces[0].a, 0, 1));
const straight = new Route('B', pts.map((p) => ({ ...p })), [{ from: 1, to: 1.1, straight: true }]);
const s0 = straight.at(straight.m(1)), s1 = straight.at(straight.m(1.1)), sm = straight.at(straight.m(1.05));
const offLine = Math.abs(((s1.lon - s0.lon) * (sm.lat - s0.lat) - (s1.lat - s0.lat) * (sm.lon - s0.lon)) * Math.cos(s0.lat * rad)) / Math.hypot((s1.lon - s0.lon) * Math.cos(s0.lat * rad), s1.lat - s0.lat) * rad * R;
check('a straightened stretch is straight', offLine < 0.1, `${offLine.toFixed(3)} m off`);

// 'level': the height over a stretch becomes a straight line between its ends. A made-up straight road at 100 m
// with a 10 m dip at 1.0-1.2 km (like map elevation dropping into a valley the road bridges)
const flat = [];
for (let m = 0; m <= 3000; m += 5) flat.push({ lat: 52 + m / 111200, lon: -4, ele: m > 1000 && m < 1200 ? 90 : 100 });
const lvl = new Route('L', flat.map((p) => ({ ...p })), [{ from: 0.95, to: 1.25, level: true }]);
const dip = new Route('L', flat.map((p) => ({ ...p })));
check('a level correction takes out a dip', Math.abs(lvl.smoothEle(1100) - 100) < 0.5 && dip.smoothEle(1100) < 95 && lvl.levels().length === 1,
  `${lvl.smoothEle(1100).toFixed(1)} m levelled, ${dip.smoothEle(1100).toFixed(1)} m without`);

// export -> re-import (Replace GPX) rides the same line
const corrected = new Route('B', pts.map((p) => ({ ...p })), [{ from: 1.5, to: 1.7, right: 2 }, { from: 3, to: 3.06, right: -2 }], 3.8);
const exported = corrected.toGpx();
const back = parsePts(exported);
const again = new Route('B', back, null, null, null, { keepDense: true });
let worst = 0;
for (let d = 0; d < corrected.length; d += 25) { const p = corrected.at(d); let best = 1e9; for (let e = Math.max(0, d - 40); e <= Math.min(again.length, d + 40); e += 0.5) best = Math.min(best, dist(p, again.at(e))); worst = Math.max(worst, best); }
check('export then replace rides the same line', worst < 0.5 && near(again.length, corrected.length, corrected.length * 0.002), `worst ${worst.toFixed(2)} m, ${again.length.toFixed(0)} vs ${corrected.length.toFixed(0)} m`);
// RideWithGPS rounds to 6 decimals: a replaced route must not make the rider rock. Simulates the lean as the ride
// does (route.curvature 0.3 s ahead, eased dt*7) at 32 km/h and counts how often it swings from side to side.
function leanFlipsPerKm(r, v = 9) {
  const dt = 1 / 60, out = [];
  let L = 0;
  for (let d = 0; d < r.length - 12; d += v * dt) {
    const target = Math.max(-0.4, Math.min(0.4, Math.atan((v * v * r.curvature(d + v * 0.3)) / 9.81)));
    L += (target - L) * Math.min(1, dt * 7);
    out.push(L);
  }
  const w = Math.round(3 / dt); let s = 0, flips = 0, prev = 0; const q = [];
  for (let i = 0; i < out.length; i++) {
    q.push(out[i]); s += out[i]; if (q.length > w) s -= q.shift();
    if (i >= w) { const rr = out[i - (w >> 1)] - s / q.length, sg = Math.abs(rr) > 0.5 * rad ? Math.sign(rr) : 0; if (sg && sg !== prev) { flips++; prev = sg; } }
  }
  return flips / (r.length / 1000);
}
const rounded = back.map((p) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: p.ele }));
const rr = new Route('B', rounded, null, null, null, { keepDense: true });
const fRounded = leanFlipsPerKm(rr), fOriginal = leanFlipsPerKm(corrected);
check('a 6-decimal (RideWithGPS) file rides as calmly as the original', fRounded < fOriginal * 1.6 + 5, `${fRounded.toFixed(0)} vs ${fOriginal.toFixed(0)} lean swings per km`);

// workouts (.zwo) and ERG
const zwo = parseZwo(fs.readFileSync(here + 'fixtures/sample.zwo', 'utf8'));
check('a .zwo file is read (intervals expanded)', zwo.name === 'Test 2x2' && zwo.steps.length === 8 && totalTime(zwo.steps) === 120 + 2 * 90 + 90 + 60 + 120, `${zwo.steps.length} steps, ${totalTime(zwo.steps)} s`);
check('warm-up ramps from low to high', near(workoutAt(zwo.steps, 0).target, 0.4, 1e-9) && near(workoutAt(zwo.steps, 60).target, 0.55, 1e-9));
const on1 = workoutAt(zwo.steps, 130);
check('interval targets, repeats and cadence', near(on1.target, 1.1, 1e-9) && on1.step.rep[0] === 1 && on1.step.cadence === 95 && near(workoutAt(zwo.steps, 185).target, 0.5, 1e-9));
check('free ride has no target, the end is done', workoutAt(zwo.steps, 420).target === null && workoutAt(zwo.steps, 1e5).done);
check('built-in workouts are sensible', BUILT_IN.every((w) => w.steps.length > 2 && totalTime(w.steps) >= 1800 && totalTime(w.steps) <= 7500 && w.steps.every((s) => s.dur > 0 && (s.max || s.free || (s.from > 0 && s.from < 2 && s.to > 0 && s.to < 2)))), BUILT_IN.map((w) => Math.round(totalTime(w.steps) / 60) + ' min').join(', '));
let bad = null; try { parseZwo('<html>nope</html>'); } catch (e) { bad = e.message; }
check('a non-workout file is refused', /no <workout>/.test(bad || ''));
check('ERG over ANT+: FE-C page 49 in 0.25 W units', JSON.stringify(fecTargetPower(250)) === JSON.stringify([0x31, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe8, 0x03]));
check('ERG over Bluetooth: FTMS Set Target Power', JSON.stringify(ftmsTargetPower(250)) === JSON.stringify([0x05, 0xfa, 0x00]) && JSON.stringify(ftmsTargetPower(300)) === JSON.stringify([0x05, 0x2c, 0x01]));
{
  // Kickr Core over FTMS: zeros while power carries on are held for up to 5 s (it goes quiet for ~3 s about once a
  // minute); a real stop (no power, or zeros > 5 s) shows 0
  const st = {}, seq = [[80, 200, 0], [0, 200, 250], [81, 200, 500], [0, 200, 750], [0, 200, 1500], [0, 200, 3400], [0, 200, 5600], [82, 200, 6000], [0, 0, 6250]];
  const got = seq.map(([c, p, t]) => steadyCadence(c, p, t, st));
  check('Bluetooth cadence: zeros held up to 5 s while power comes, real stops shown', JSON.stringify(got) === JSON.stringify([80, 80, 81, 81, 81, 81, 0, 82, 0]), JSON.stringify(got));
}

// music links
check('YouTube Music playlist link', parseLink('https://music.youtube.com/playlist?list=PLabc123')?.list === 'PLabc123');
check('youtu.be song link', parseLink('https://youtu.be/dQw4w9WgXcQ')?.video === 'dQw4w9WgXcQ');
check('other sites are refused', parseLink('https://open.spotify.com/playlist/abc') === null && parseLink('not a link') === null);

// file formats
{
  const t0 = Date.UTC(2026, 9, 17, 7, 0, 0);
  const samples = Array.from({ length: 30 }, (_, i) => ({ time: new Date(t0 + i * 1000), lat: 53.08 + i * 1e-4, lon: -4.05 - i * 1e-4, ele: 120 + i * 0.4,
    distance: i * 9.5, speed: 9.5, power: 200 + i, hr: i ? 140 + i : 0, cadence: 88 }));
  const back = readFit(toFit(samples, { name: 'Test' }));
  const b = back[12];
  check('FIT ride reads back: 30 records', back.length === 30, `${back.length}`);
  check('FIT ride reads back: position, height, distance, power, heart rate', near(b.lat, 53.0812, 1e-6) && near(b.lon, -4.0512, 1e-6) && near(b.ele, 124.8, 0.2)
    && near(b.distance, 114, 0.01) && b.power === 212 && b.hr === 152 && b.cadence === 88 && b.time.getTime() === t0 + 12000, JSON.stringify(b));
  check('FIT ride: missing heart rate stays missing', back[0].hr === null);
  const course = readFit(toFitCourse(samples.map(({ lat, lon, ele }) => ({ lat, lon, ele }))));
  check('FIT course reads back with distances', course.length === 30 && near(course[29].lat, 53.0829, 1e-6) && course[29].distance > 300 && course[29].distance < 450, `${course[29]?.distance}`);
  const gpx = samplesToGpx(samples, 'Test & ride'), tcx = samplesToTcx(samples, 'Test');
  check('GPX ride export has power, heart rate and cadence', (gpx.match(/<trkpt /g) || []).length === 30 && gpx.includes('<power>229</power>') && gpx.includes('<gpxtpx:hr>169</gpxtpx:hr>') && gpx.includes('Test &amp; ride'));
  check('TCX ride export has every point and the distance', (tcx.match(/<Trackpoint>/g) || []).length === 30 && tcx.includes('<DistanceMeters>275.5</DistanceMeters>'));
}

// turning round: the reversed route is the same road the other way
{
  const pts = Array.from({ length: 200 }, (_, i) => ({ lat: 53 + i * 9e-5, lon: -4 + Math.sin(i / 20) * 2e-4, ele: 100 + i * 0.3 }));
  const r = new Route('Turn', pts), back = r.reversed(), L = r.length;
  const a = r.at(700), b = back.at(L - 700);
  check('reversed route: same length, same place at mirrored distances', near(back.length, L, 1e-6) && near(a.lat, b.lat, 1e-9) && near(a.lon, b.lon, 1e-9));
  check('reversed route: gradient flips', near(back.grade(L - 700), -r.grade(700), 0.3), `${r.grade(700).toFixed(2)} / ${back.grade(L - 700).toFixed(2)}`);
  check('reversing twice gives the original back', back.reversed() === r);
}

// route analyser zones: a loop that crosses itself (like Sa Calobra's knot) maps each crossing to its own pass
{
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ lat: 39.80 + i * 1e-5, lon: 2.80, ele: 100 });                    // north 111 m
  for (let a = 0; a <= 270; a += 5) pts.push({ lat: 39.801 + 2.7e-4 * Math.sin((a * Math.PI) / 180), lon: 2.80 + 3.5e-4 * (1 - Math.cos((a * Math.PI) / 180)), ele: 100 });
  for (let i = 1; i <= 100; i++) pts.push({ lat: 39.801 - 2.7e-4 + 0, lon: 2.80 + 3.5e-4 - i * 1e-5, ele: 100 }); // back west
  const plain = new Route('Knot', pts.map((p) => ({ ...p })));
  // find where the path passes the same spot twice, as the server would report it
  let cross = null;
  for (let d1 = 0; d1 < plain.length && !cross; d1 += 2) for (let d2 = d1 + 150; d2 < plain.length; d2 += 2) {
    const a = plain.at(d1), b = plain.at(d2);
    if (Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 85000) < 2) { cross = { d1, d2, ...a }; break; }
  }
  if (!cross) check('knot test route crosses itself', false);
  else {
    const r = new Route('Knot', pts.map((p) => ({ ...p })), null, null, null, { structures: [
      { type: 'under', km: cross.d2 / 1000, lat: cross.lat, lon: cross.lon }, { type: 'under', km: cross.d1 / 1000, lat: cross.lat, lon: cross.lon }] });
    const z = r.zones.map(([f, t]) => (f + t) / 2).sort((a, b) => a - b);
    check('route analyser: a self-crossing maps to each pass', z.length === 2 && near(z[0], cross.d1, 30) && near(z[1], cross.d2, 30), JSON.stringify(r.zones.map((x) => x.map((v) => (typeof v === 'number' ? Math.round(v) : v)))));
    const back = r.reversed(), L = r.length;
    check('route analyser: zones mirror when turning round', near(back.zones[0][0], L - r.zones[0][1], 0.01));
    check('route analyser: not analysed means no zones', new Route('x', pts.map((p) => ({ ...p }))).zones === null);
  }
}

// finding the road in imagery (route editor "Find the road")
{
  const fx = (n) => JSON.parse(fs.readFileSync(`${here}/fixtures/${n}.json`, 'utf8'));
  const down = findBand(fx('calobra-road-4651')), up = findBand(fx('calobra-road-15209')), dark = findBand(fx('calobra-road-shadow'));
  check('road finder: Sa Calobra 2.89 mi going down, road ~5.5 m right', near(down.centre, 5.5, 1) && down.contrast > 0.15, JSON.stringify(down));
  check('road finder: same spot coming up, road ~5.3 m left', near(up.centre, -5.3, 1) && up.contrast > 0.15, JSON.stringify(up));
  check('road finder: in deep shadow it says it can\'t tell', dark.contrast < 0.15, JSON.stringify(dark));
  // synthetic: a plain grey 6 m band centred 3 m left of the line, on speckled green
  const rows = Array.from({ length: 9 }, (_, r) => Array.from({ length: 129 }, (_, i) => {
    const x = -16 + i * 0.25;
    if (x > -6 && x < 0) return [150, 150, 148];
    const v = ((i * 37 + r * 91) % 50);
    return [70 + v, 110 + v, 60 + v / 2];
  }));
  const b = findBand(rows);
  check('road finder: synthetic road 3 m left found', near(b.centre, -3, 0.5) && near(b.width, 6, 1), JSON.stringify(b));
  // a hairpin whose map is slid 5 m east of the real road: readings are how far right the road looks; near the apex
  // some catch the other leg instead (what folded the owner's hairpins)
  const hp = new Route('Hairpin', [
    ...Array.from({ length: 30 }, (_, i) => ({ lat: 39.8 + i * 2e-5 * 9, lon: 2.8, ele: 0 })),
    ...Array.from({ length: 19 }, (_, k) => { const a = (k * 10 * Math.PI) / 180; return { lat: 39.8 + 29 * 1.8e-4 + 1.2e-4 * Math.sin(a), lon: 2.8 + 1.56e-4 * (1 - Math.cos(a)), ele: 0 }; }),
    ...Array.from({ length: 30 }, (_, i) => ({ lat: 39.8 + 29 * 1.8e-4 - i * 1.8e-4, lon: 2.8 + 3.12e-4, ele: 0 })),
  ]);
  const N = Math.floor(hp.length / 10) + 1, right = [], radius = [], found = [];
  for (let i = 0; i < N; i++) {
    const h = hp.tangent(i * 10), k = Math.abs(hp.curvature(i * 10));
    right.push([Math.cos(h), -Math.sin(h)]); radius.push(k > 1e-6 ? 1 / k : Infinity);
    const truth = -5 * Math.cos(h); // road is 5 m WEST of the line: right . (-5, 0)
    found.push({ centre: radius[i] < 40 && i % 2 ? truth + 25 : truth + Math.sin(i) * 0.4, contrast: 0.3 });
  }
  found[3] = { centre: NaN, contrast: 0.3 }; found[5] = null; right[7] = [NaN, NaN]; // broken readings are skipped
  const sl = fitSlide(found, right, radius, 10);
  check('road finder: broken readings don\'t spoil the slide', sl.dx.every(Number.isFinite) && sl.dy.every(Number.isFinite));
  const worst = Math.max(...sl.dx.map((x, i) => Math.hypot(x + 5, sl.dy[i])));
  check('road finder: a hairpin\'s slide is found from both legs, other-leg readings ignored', worst < 1.5, `worst ${worst.toFixed(2)} m off`);
  const before = hp.pts.map((p) => ({ ...p })), after = applyCentre(before, { step: 10, dx: sl.dx, dy: sl.dy });
  let fold = 0;
  for (let i = 2; i < after.length; i++) {
    const v1 = [after[i - 1].lon - after[i - 2].lon, after[i - 1].lat - after[i - 2].lat], v2 = [after[i].lon - after[i - 1].lon, after[i].lat - after[i - 1].lat];
    const u1 = [before[i - 1].lon - before[i - 2].lon, before[i - 1].lat - before[i - 2].lat], u2 = [before[i].lon - before[i - 1].lon, before[i].lat - before[i - 1].lat];
    const turn = (a, b) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    if (Math.abs(turn(v1, v2) - turn(u1, u2)) > 0.3) fold++;
  }
  check('road finder: the slid hairpin keeps its shape (no folding)', fold === 0, `${fold} kinks`);
  // centring slides the line: 4 m east
  const pts = Array.from({ length: 50 }, (_, i) => ({ lat: 39.8 + i * 1e-4, lon: 2.8, ele: 0 }));
  const moved = applyCentre(pts, { step: 10, dx: new Array(60).fill(4), dy: new Array(60).fill(0) });
  const east = (moved[20].lon - pts[20].lon) * 111320 * Math.cos(39.8 * Math.PI / 180);
  check('road centring: a 4 m east slide moves the line 4 m east', near(east, 4, 0.05), `${east.toFixed(2)} m`);
}

// earthworks (Cap's last km: the road through Google's false hump and over its false hollow)
{
  const flat = (h) => [4, 6, 8, 10, 12, 15].map((x) => [x, h]);
  const lvl = faceMeet(flat(100.3), 2.3, 100);
  check('earthworks: ground level with the road needs no face', lvl.kind === 'level' && lvl.cliff === 0, lvl.kind);
  // ground 6 m above the road: the face starts after the verge and climbs at CUT_SLOPE until it reaches 106 m
  const cut = faceMeet(flat(106), 2.3, 100), wantX = 2.3 + VERGE + 6 / CUT_SLOPE;
  check('earthworks: a 6 m hump gives a cutting meeting the ground', cut.kind === 'cut' && near(cut.x, wantX, 0.05) && near(cut.top, 106, 0.05) && cut.cliff === 0, `x ${cut.x.toFixed(2)} (want ${wantX.toFixed(2)})`);
  const fill = faceMeet(flat(96), 2.3, 100), wantF = 2.3 + VERGE + 4 / FILL_SLOPE;
  check('earthworks: a 4 m hollow gives an embankment meeting the ground', fill.kind === 'fill' && near(fill.x, wantF, 0.05) && near(fill.top, 96, 0.05), `x ${fill.x.toFixed(2)} (want ${wantF.toFixed(2)})`);
  // a slope rising away from the road: meets where face and ground cross
  const slope = faceMeet([[4, 102], [6, 104], [8, 106], [10, 108], [12, 110], [15, 113]], 2.3, 100);
  check('earthworks: a cutting into a hillside meets the slope', slope.kind === 'cut' && slope.cliff === 0 && near(slope.top, 100 + CUT_SLOPE * (slope.x - 3.1), 0.01) && slope.x > 4 && slope.x < 15, `meets at ${slope.x.toFixed(1)} m`);
  const deep = faceMeet(flat(140), 2.3, 100);
  check('earthworks: too deep to meet within 15 m leaves a cliff to the ground', deep.kind === 'cut' && near(deep.x, 15, 1e-9) && near(deep.top + deep.cliff, 140, 1e-6), `cliff ${deep.cliff.toFixed(1)} m`);
  check('earthworks: no readings, no face', faceMeet([], 2.3, 100) === null);
  const ledge = faceMeet(flat(80), 2.3, 100);
  check('earthworks: a drop too deep to fill within 15 m gets a retaining wall at the verge', ledge.kind === 'wall' && near(ledge.x, 3.1, 1e-9) && near(ledge.top, 80, 1e-9), ledge.kind);
  const runs = deepRuns([0, -5, -14, -15, -16, -14, -3, 0, 25, 30, 28, 26, 24, 0, 30, 0], 10);
  check('earthworks: a deep hollow is a viaduct, a deep hump a tunnel, short ones neither', JSON.stringify(runs) === JSON.stringify([[2, 5, 'viaduct'], [8, 12, 'tunnel']]), JSON.stringify(runs));
  const hill = [4, 6, 8, 10, 12, 15].map((x) => [x, 100 + x * 1.2]);
  const tight = clampInside(faceMeet(hill, 2.3, 100), hill, 6, 100);
  check('earthworks: on the inside of a tight bend a cutting stops at the limit and rises as a cliff', tight.x === 6 && tight.cliff > 0 && near(tight.top + tight.cliff, 107.2, 1e-6), `x ${tight.x}, cliff ${tight.cliff.toFixed(1)}`);
  const sm = smooth3([{ kind: 'cut', x: 5 }, { kind: 'cut', x: 9 }, { kind: 'cut', x: 5.5 }, { kind: 'fill', x: 20 }], 'x');
  check('earthworks: meet points are smoothed between stations of the same kind', sm[1].x === 5.5 && sm[3].x === 20, sm.map((v) => v.x).join(','));
}

{
  // recorded rides (times moving forward, heights) are trusted for the trainer; drawn routes aren't
  const { createRequire } = await import('module');
  const { recorded } = createRequire(import.meta.url)('../lib/routes.js');
  const gpx = (pts) => `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
  const t0 = Date.parse('2023-04-28T10:00:00Z');
  const ride = Array.from({ length: 120 }, (_, i) => `<trkpt lat="39.8${i}" lon="2.8"><ele>${100 + i}</ele><time>${new Date(t0 + i * 1000).toISOString()}</time></trkpt>`);
  const drawn = Array.from({ length: 120 }, (_, i) => `<trkpt lat="39.8${i}" lon="2.8"><ele>${100 + i}</ele></trkpt>`);
  const stamped = Array.from({ length: 120 }, (_, i) => `<trkpt lat="39.8${i}" lon="2.8"><ele>${100 + i}</ele><time>2026-06-20T15:01:39Z</time></trkpt>`);
  check('routes: a recorded ride (times moving forward) counts as recorded', recorded(gpx(ride)) === true);
  check('routes: a drawn route (no times) does not', recorded(gpx(drawn)) === false);
  check('routes: one time stamped on every point (a planner export) does not', recorded(gpx(stamped)) === false);
}

{ // a crank cadence sensor (Cycling Speed & Cadence): cadence from new revolutions; repeats between them change nothing
  const m = (revs, time, wheel = false) => { const b = new DataView(new ArrayBuffer(wheel ? 11 : 5)); b.setUint8(0, wheel ? 3 : 2); const o = wheel ? 7 : 1; b.setUint16(o, revs, true); b.setUint16(o + 2, time, true); return b; };
  let st = parseCsc(m(100, 1000));
  check('csc: the first message only sets the counters', st.cadence === undefined && st.crankRevs === 100);
  st = parseCsc(m(101, 1000 + 683), st); // one rev in 683/1024 s = 90 rpm
  check('csc: one revolution in 0.667 s is 90 rpm', Math.abs(st.cadence - 90) < 0.2);
  const again = parseCsc(m(101, 1000 + 683), st);
  check('csc: the same pair repeated is "same", not 0', again.same === true);
  st = parseCsc(m(65535, 65000), { crankRevs: 65534, crankTime: 64317 });
  check('csc: counters wrapping round still give a cadence', Math.abs(st.cadence - 90) < 0.2);
  st = parseCsc(m(5, 2048, true), { crankRevs: 4, crankTime: 1024 });
  check('csc: with wheel data in front, the crank fields are read past it (60 rpm)', Math.abs(st.cadence - 60) < 0.2);
}

{ // Cycling Power cadence between revolutions (the owner's ride 2026-10-27: 60 one-second zeros, power steady)
  const st = {};
  check('cps cadence: a revolution sets it', cpsCadence({ cadence: 86 }, st, 0) === 86);
  check('cps cadence: the same crank pair again (no new revolution) keeps it', cpsCadence({ cadenceIdle: true }, st, 300) === 86);
  check('cps cadence: still 1.5 s on', cpsCadence({ cadenceIdle: true }, st, 1500) === 86);
  check('cps cadence: 2.5 s without a revolution is a stop', cpsCadence({ cadenceIdle: true }, st, 2600) === 0);
  check('cps cadence: nothing yet is 0', cpsCadence({}, {}, 0) === 0);
}

// ---------- the virtual coach's numbers (coach-math.js, 2026-10-29) ----------
{
  const M = await import('../public/js/coach-math.js');
  const steadyP = Array(3600).fill(200);
  check('NP of a steady hour is the power', Math.abs(M.normalizedPower(steadyP) - 200) < 0.01);
  const L = M.rideLoad(M.rideNumbers({ p: steadyP, h: Array(3600).fill(140) }), 200, 185);
  check('an hour at FTP is 100 TSS, IF 1', L.tss === 100 && L.IF === 1, JSON.stringify(L));
  const alt = Array.from({ length: 3600 }, (_, i) => (Math.floor(i / 60) % 2 ? 0 : 400));
  check('on/off minutes: NP well above the average', M.normalizedPower(alt) > 300 && M.rideNumbers({ p: alt, h: [] }).avgPower === 200);
  check('best 5 min of a ride', M.bestAvg([...Array(600).fill(100), ...Array(300).fill(300), ...Array(600).fill(100)], 300) === 300);
  const sec = M.toSeconds([{ time: 0, power: 100 }, { time: 3000, power: 200 }, { time: 600000, power: 50 }]);
  check('toSeconds fills short gaps and drops pauses', sec.p.join() === '100,200,200,200,50', sec.p.join());
  // 42 days of 100 TSS from nothing: fitness 1 - (41/42)^42 of the way = ~63
  const days = Array.from({ length: 42 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(), tss: 100 }));
  const s = M.fitnessSeries(days, new Date(Date.UTC(2026, 0, 42)));
  check('fitness after 42 days of 100 TSS is ~64', Math.abs(s.at(-1).ctl - 63.6) < 1, s.at(-1).ctl.toFixed(1));
  check('fatigue after a week of it is ~66', Math.abs(s[6].atl - 66) < 2, s[6].atl.toFixed(1));
  check('form negative while building', s.at(-1).tsb < 0);
  check('FTP estimate from 20 minutes', M.ftpEstimate({ 1200: 300 }).ftp === 285);
  const cp = M.criticalPower({ 180: 400, 300: 350, 720: 300, 1200: 285 });
  check('critical power fit is sensible', cp && cp.cp > 250 && cp.cp < 290 && cp.wPrime > 10000 && cp.wPrime < 30000, JSON.stringify(cp));
  check('W′ balance falls above CP and recovers below', M.wbalStep(20000, 350, 250, 20000, 10) === 19000 && M.wbalStep(10000, 150, 250, 20000, 60) > 10000);
  check('VO2max (ACSM) for 300 W at 75 kg', Math.abs(M.vo2max(300, 75) - 50.2) < 0.1);
  check('fitness age: 54.4 is 25, 45.65 is 50', M.fitnessAge(54.4, 'm') <= 25 && Math.abs(M.fitnessAge(45.65, 'm') - 50) <= 1);
  check('power profile: 4 W/kg FTP (men) is Good', M.profileLevel(4, 'ftp', 'm').level === 'Good', M.profileLevel(4, 'ftp', 'm').level);
  const z = M.zoneSeconds({ 10: 60, 20: 60, 28: 60 }, 200); // 105 W, 205 W, 285 W
  check('zones from the power histogram', z[0] === 60 && z[3] === 60 && z[5] === 60, z.join());
  check('very tired: recovery suggested', M.suggestWorkout({ tsb: -35, rides: [{ date: new Date(0), IF: 0.7 }] }).id === 'recovery');
  const r = M.suggestRoutes([{ id: 'flat', name: 'Flat', km: 20, gain: 40 }, { id: 'hill', name: 'Hill', km: 20, gain: 600 }], { tsb: 0, recentMperKm: 20, typicalKm: 20 });
  check('lots of climbing lately: the flat route first', r[0].id === 'flat', r.map((x) => x.id).join());
}

// ---------- ramp test (2026-10-30) ----------
{
  const { BUILT_IN: B, rampFailed, rampFtp, workoutAt: at } = await import('../public/js/workout.js');
  const ramp = B.find((w) => w.id === 'ramptest');
  check('ramp test: 1-minute steps rising 6% of FTP', ramp && ramp.steps[1].from === 0.5 && Math.abs(ramp.steps[2].from - 0.56) < 1e-9 && ramp.steps[1].dur === 60);
  const step8 = { ...at(ramp.steps, 300 + 7 * 60 + 30).step, target: 0.92 * 250 };
  const hold = Array(15).fill({ power: 228 }), fade = Array(15).fill({ power: 150 });
  check('ramp test: holding the target carries on', !rampFailed(step8, hold));
  check('ramp test: falling off ends it', rampFailed(step8, fade));
  check('ramp test: not in the first steps', !rampFailed({ ...at(ramp.steps, 330).step, target: 125 }, fade));
  check('ramp test: FTP is 75% of the best minute', rampFtp(320) === 240);
}

// ---------- training plans (2026-10-30) ----------
{
  const P = await import('../public/js/plans.js');
  const { BUILT_IN: B, totalTime: tt } = await import('../public/js/workout.js');
  const WK = Object.fromEntries(B.map((w) => [w.id, { name: w.name, secs: tt(w.steps) }]));
  check('every plan session is a real workout or a ride', P.PLANS.every((p) => p.sessions.length === p.weeks && p.sessions.every((w) => w.length === 3 && w.every((x) => typeof x === 'object' ? x.ride > 0 : !!WK[x]))));
  const mine = { id: 'ftp-builder', start: '2026-11-02', days: [1, 3, 6] }; // Tue, Thu, Sun from Mon 2 Nov
  const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h);
  let S = P.schedule(mine, [], WK, at(2026, 11, 3));
  check('plan: dates on the chosen days', S.list[0].date === '2026-11-03' && S.list[1].date === '2026-11-05' && S.list[2].date === '2026-11-08' && S.list[3].date === '2026-11-10', S.list.slice(0, 4).map((x) => x.date).join());
  check('plan: today is the ramp test', S.today?.id === 'ramptest' && S.week === 1);
  // the ramp test ridden on Tuesday; Thursday missed; Saturday a plain 100-min ride (counts for Sunday's 90-min ride? no: before its day)
  const rides = [{ date: at(2026, 11, 3).toISOString(), workout: 'Ramp test', secs: 1200 }, { date: at(2026, 11, 8).toISOString(), workout: null, secs: 6000 }];
  S = P.schedule(mine, rides, WK, at(2026, 11, 9));
  check('plan: done / missed / done', S.list[0].status === 'done' && S.list[1].status === 'missed' && S.list[2].status === 'done', S.list.slice(0, 3).map((x) => x.status).join());
  S = P.schedule(mine, rides, WK, at(2026, 11, 6));
  check('plan: a session missed yesterday is offered today', S.catchUp?.key === '1.2' && !S.today);
  S = P.schedule({ ...mine, moved: { '1.2': '2026-11-06' } }, rides, WK, at(2026, 11, 6));
  check('plan: moved to today', S.today?.key === '1.2');
  S = P.schedule({ ...mine, swaps: { '1.2': 'recovery' } }, rides, WK, at(2026, 11, 5));
  check('plan: swapped for recovery', S.today?.id === 'recovery' && S.today.swapped);
  S = P.schedule({ ...mine, at: at(2026, 11, 6, 9).toISOString() }, [], WK, at(2026, 11, 6));
  check('plan: started mid-week, earlier sessions skipped (not missed or offered)', S.list[0].status === 'skipped' && S.list[1].status === 'skipped' && !S.catchUp && S.total === 16);
  check('plan: next Monday', P.nextMonday(at(2026, 10, 30)) === '2026-11-02' && P.nextMonday(at(2026, 11, 2, 9)) === '2026-11-02');
}

// ---------- workout builder blocks (2026-10-30) ----------
{
  const Wk = await import('../public/js/workout.js');
  const blocks = [{ type: 'warmup', dur: 600, from: 0.45, to: 0.75 }, { type: 'steady', dur: 300, power: 0.9, cadence: 95 }, { type: 'intervals', reps: 4, on: 120, off: 60, onPower: 1.15, offPower: 0.5 },
    { type: 'free', dur: 300 }, { type: 'max', dur: 30 }, { type: 'cooldown', dur: 300, from: 0.6, to: 0.4 }];
  const steps = Wk.blocksToSteps(blocks), back = Wk.parseZwo(Wk.toZwo('Test & <one>', 'A "test"', blocks));
  const sig = (st) => st.map((x) => [x.type, x.dur, x.from ?? '-', x.to ?? '-', x.cadence ?? '-', x.rep ? x.rep.join('/') : ''].join(':')).join('|');
  check('builder: blocks -> .zwo -> steps round trip', sig(back.steps) === sig(steps) && back.name === 'Test & <one>', sig(back.steps).slice(0, 120));
  check('builder: steps -> blocks gives the intervals back as one block', JSON.stringify(Wk.blocksFromSteps(steps).map((b) => b.type)) === JSON.stringify(blocks.map((b) => b.type)) && Wk.blocksFromSteps(steps)[2].reps === 4);
  const ss = Wk.BUILT_IN.find((w) => w.id === 'sweetspot');
  check('builder: a built-in edits as blocks', sig(Wk.blocksToSteps(Wk.blocksFromSteps(ss.steps))) === sig(ss.steps));
}

// ---------- heart-rate sessions (2026-10-30) ----------
{
  const { hrStep } = await import('../public/js/workout.js');
  check('HR hold: low heart rate adds watts, at most 6', hrStep(150, 120, 135) === 156 && hrStep(150, 132, 135) === 152.4);
  check('HR hold: high heart rate takes watts off', hrStep(150, 145, 135) === 144);
  check('HR hold: within 2 bpm leaves it alone', hrStep(150, 134, 135) === 150 && hrStep(150, 137, 135) === 150);
  // a simple heart: HR follows 64 + 0.33 W with a 40 s lag; 30 min settles near the target without hunting
  let w = 130, hr = 90; const goal = 130, seen = [];
  for (let t = 0; t < 1800; t += 15) { for (let k = 0; k < 15; k++) hr += (64 + 0.33 * w - hr) / 40; w = hrStep(w, hr, goal); if (t > 900) seen.push(hr); }
  check('HR hold: settles within 3 bpm of the target', Math.max(...seen) - goal < 3 && goal - Math.min(...seen) < 3, `${Math.min(...seen).toFixed(1)}-${Math.max(...seen).toFixed(1)}`);
}

// ---------- heart rate against power (2026-11-03) ----------
{
  const M = await import('../public/js/coach-math.js');
  // a made-up rider: HR = 60 + 0.4 W at steady state, lagging 40 s; 10 min steps from 120 to 240 W
  const p = [], h = []; let hr = 90;
  for (let s = 0; s < 4800; s++) { const w = 120 + 30 * Math.min(4, Math.floor(s / 960)); p.push(w); hr += (60 + 0.4 * w - hr) / 40; h.push(Math.round(hr)); }
  const pairs = M.hrPairs(p, h), f = M.fitLine(pairs);
  check('HR vs power: steady minutes found and the line recovered', pairs.length > 30 && Math.abs(f.b - 0.4) < 0.03 && f.r2 > 0.95, `${pairs.length} pairs, b ${f.b.toFixed(3)}, r2 ${f.r2.toFixed(3)}`);
  const af = M.aerobicFit([{ date: new Date().toISOString(), hrp: pairs }], 180);
  check('HR vs power: power at max heart rate', Math.abs(af.map - 300) < 15 && Math.abs(af.powerAt(140) - 200) < 10, `map ${af.map}, at 140 ${af.powerAt(140)}`);
  check('VO2max from 300 W MAP at 83 kg (Hawley & Noakes) is ~46.5', Math.abs(M.vo2FromMap(300, 83) - 46.5) < 0.2);
  // recovery: 3 min hard then easy, HR falling 1 beat every 2 s
  const p2 = [...Array(600).fill(150), ...Array(180).fill(300), ...Array(200).fill(80)], h2 = [...Array(600).fill(120), ...Array(180).fill(170), ...Array.from({ length: 200 }, (_, i) => 170 - Math.floor(i / 2))];
  check('HR recovery after a hard effort', M.hrRecovery(p2, h2) === 30, String(M.hrRecovery(p2, h2)));
}

// ---------- fitness signals from ordinary riding (2026-11-26) ----------
{
  const M = await import('../public/js/coach-math.js');
  // a made-up rider whose heart rate settles at 60 + 0.4 W below 200 W and keeps climbing 3 bpm/min above it
  const ride = (blocks) => { const p = [], h = []; let hr = 90; p.push(...Array(300).fill(100)); h.push(...Array(300).fill(95));
    for (const w of blocks) for (let s = -180; s < 480; s++) { if (s < 0) { p.push(110); hr += (104 - hr) / 25; h.push(Math.round(hr)); continue; } p.push(w); const goal = 60 + 0.4 * w + (w > 200 ? (s / 60) * 3 : 0); hr += (goal - hr) / 25; h.push(Math.round(hr)); }
    return { p, h }; };
  const r = ride([150, 170, 190, 215, 230, 180]), b = M.steadyBlocks(r.p, r.h);
  check('steady blocks: six found, settling below 200 W and climbing above', b.length === 6 && b.filter(([w, s]) => w < 200).every(([, s]) => s < 1) && b.filter(([w]) => w > 200).every(([, s]) => s > 2), JSON.stringify(b));
  const T = M.thresholdFromBlocks(b);
  check('threshold from steady blocks: between 190 and 215 W', T && T.w > 190 && T.w < 215, JSON.stringify(T));
  check('threshold: nothing without blocks above it', M.thresholdFromBlocks(b.filter(([w]) => w < 200)) === null);
  const day = 86400000, now = Date.now();
  const R = M.recoveryAtPower([{ w: 230, drop: 30, date: now - 3 * day }, { w: 232, drop: 34, date: now - 5 * day }, { w: 228, drop: 24, date: now - 40 * day }, { w: 300, drop: 40, date: now - 2 * day }], 220, now);
  check('recovery at power: same band compared, 4 weeks vs before', R.compared.length === 1 && R.compared[0].band === 1 && R.compared[0].now === 34 && R.compared[0].before === 24, JSON.stringify(R.compared));
  const bp = [...Array(600).fill(120), ...Array(1200).fill(160), ...Array(300).fill(100)], bh = [...Array(600).fill(110), ...Array.from({ length: 1200 }, (_, i) => 125 + Math.round(i / 240)), ...Array(300).fill(110)];
  const B = M.benchAnalysis(bp, bh);
  check('benchmark: 160 W, last 5 min heart rate, small drift', B && B.w === 160 && B.hr === 129 && B.drift > 0 && B.drift < 5, JSON.stringify(B));
  check('benchmark: not ridden as written -> null', M.benchAnalysis([...Array(600).fill(120), ...Array(600).fill(160), ...Array(600).fill(250)], bh) === null);
  check('capacity: a moderate build at CTL 40', M.capacity(40, -5).tss === 7 * (40 + 30) && M.capacity(40, -5, [-1]).rate === 3 && M.capacity(40, 0, [1]).rate === 7 && M.capacity(40, -40).kind === 'rest');
  const sw = M.suggestWorkout({ tsb: -5, rides: [{ IF: 0.7, date: new Date(now - 3 * day) }, {}, {}], response: -1, worse: ['-5 W at 140 bpm'] });
  check('coach: a worse heart-rate signal means an easy day', sw.id === 'endurance' && sw.why.includes('-5 W'), JSON.stringify(sw));
  const sb = M.suggestWorkout({ tsb: 0, rides: [{ IF: 0.7, date: new Date(now - 3 * day) }, {}, {}] });
  check('coach: no benchmark yet -> suggests one', sb.id === 'benchmark');
}

// ramp test heart rate (coach-math rampAnalysis): a made-up test at FTP 200, falling off 30 s into step 12
{
  const M = await import('../public/js/coach-math.js');
  const p = [], h = [];
  for (let t = 0; t < 300; t++) { p.push(90); h.push(100); }
  for (let k = 1; k <= 12; k++) for (let i = 0; i < 60; i++) { const w = 200 * (0.5 + 0.06 * (k - 1)); p.push(k === 12 && i >= 30 ? 60 : w); h.push(Math.round(60 + 0.35 * w + (i / 60) * 3)); }
  for (let t = 0; t < 300; t++) { p.push(80); h.push(Math.round(144 - Math.min(60, t) * 0.5)); }
  const r = M.rampAnalysis(p, h, 200);
  check('ramp: 11 full steps', r && r.steps.length === 11, JSON.stringify(r?.steps?.length));
  check('ramp: held 30 s of the last step', r.held === 30, String(r.held));
  check('ramp: slope ~0.35 bpm/W, no bend', Math.abs(r.slope - 0.35) < 0.03 && !r.bend, `${r.slope} ${JSON.stringify(r.bend)}`);
  check('ramp: best minute and FTP', r.best60 > 220 && r.ftp === Math.round(r.best60 * 0.75), `${r.best60} ${r.ftp}`);
  check('ramp: recovery measured', r.hrr60 >= 14, String(r.hrr60));
}

// Route Studio corrections (route.js applyBend / applyMove)
{
  const R = await import('../public/js/route.js');
  // a zig-zag line north: 0..400 m with a 6 m chicane at 180-220 m
  const pts = [];
  for (let y = 0; y <= 400; y += 2) { const x = y > 180 && y < 200 ? 6 * (y - 180) / 20 : y >= 200 && y < 220 ? 6 * (220 - y) / 20 : 0; pts.push({ lat: 51 + y / 110540, lon: -2 + x / (111320 * Math.cos(51 * Math.PI / 180)), ele: 10 }); }
  const kx = 111320 * Math.cos(51 * Math.PI / 180), X = (p) => (p.lon + 2) * kx;
  const b = R.applyBend(pts, { from: 0.15, to: 0.25 });
  check('smooth bend takes out the chicane', Math.max(...b.map((p) => Math.abs(X(p)))) < 0.2, String(Math.max(...b.map((p) => Math.abs(X(p))))));
  check('smooth bend keeps the ends', Math.abs(b[0].lat - pts[0].lat) < 1e-9 && Math.abs(b[b.length - 1].lat - pts[pts.length - 1].lat) < 1e-9);
  const m = R.applyMove(pts, { from: 0.0, to: 0.4, dx: 5, dy: 0 });
  const mid = m[100], edge = m[0];
  check('drag moves the middle fully and the ends not at all', Math.abs(X(mid) - X(pts[100]) - 5) < 0.05 && Math.abs(X(edge) - X(pts[0])) < 1e-6, `${(X(mid) - X(pts[100])).toFixed(2)}`);
  const c = R.applyCorrections(pts, [{ from: 0.15, to: 0.25, bend: true }, { from: 0, to: 0.4, dx: 2 }]);
  check('studio corrections apply in order', c.length > 10 && Math.abs(X(c[Math.floor(c.length / 2)]) - 2) < 0.2);
}

// standing (public/js/stance.js)
{
  const { stanceStep } = await import('../public/js/stance.js');
  const run = (s, o, secs) => { let on = false; for (let t = 0; t < secs; t += 0.1) on = stanceStep(s, { dt: 0.1, riding: true, ftp: 250, ...o }); return on; };
  const s = {};
  check('seated on the flat', !run(s, { watts: 200, cadence: 90, grade: 0.01 }, 10));
  check('stands to sprint', run(s, { watts: 500, cadence: 100, grade: 0 }, 1.5));
  check('sits after the sprint', !run(s, { watts: 200, cadence: 90, grade: 0 }, 2));
  const c = {};
  check('stands on a steep climb at low cadence', run(c, { watts: 260, cadence: 65, grade: 0.1 }, 3));
  check('sits again within ~25 s on a long climb', !run(c, { watts: 260, cadence: 65, grade: 0.1 }, 23));
  check('not while freewheeling', !run({}, { watts: 600, cadence: 0, grade: 0.1 }, 5));
}

// jersey designs (public/js/kit.js): the strings the server lets through, and parsing
{
  const K = await import('../public/js/kit.js');
  const mpRe = /^[a-z0-9]+:(#[0-9a-f]{6},?){0,4}(;img=[a-z0-9_.-]+;fit=(full|logo))?$/i; // lib/multiplayer.js
  for (const [, d] of K.PRESETS) check('preset ' + d + ' valid', K.validDesign(d) && mpRe.test(d) && K.parseDesign(d).id === d.split(':')[0]);
  const p = K.parseDesign('hoops:#112233,#ffffff;img=admin-0123456789ab.png;fit=full');
  check('design with a picture', p.id === 'hoops' && p.c[0] === '#112233' && p.img === 'admin-0123456789ab.png' && p.fit === 'full');
  check('design round trip', K.designString(p) === 'hoops:#112233,#ffffff;img=admin-0123456789ab.png;fit=full', K.designString(p));
  check('bad picture name dropped', K.parseDesign('plain:#000000;img=../x.png;fit=full').img === null);
  check('unknown design falls back to plain', K.parseDesign('nope:#123456').id === 'plain');
  check('script in a design rejected', !K.validDesign('plain:#000000"><script>'));
}

// virtual gears (public/js/gears.js): the slope sent so the trainer feels like the road in that gear
{
  const Gm = await import('../public/js/gears.js');
  const o = { v: 8, mass: 84, cda: 0.32 };
  check('gear 12 sends the slope unchanged', [-4, 0, 3.7, 12].every((g) => Gm.gearedGrade(g, 12, o) === g));
  const flat = [1, 6, 12, 18, 24].map((n) => Gm.gearedGrade(0, n, o));
  check('harder gears push back harder on the flat', flat.every((v, i) => i === 0 || v > flat[i - 1]), flat.map((v) => v.toFixed(2)).join(' '));
  check('easiest gear on a 10% climb feels easier', Gm.gearedGrade(10, 1, o) < 10, Gm.gearedGrade(10, 1, o).toFixed(1));
  // the trainer's power at its own speed v with the sent slope = the road's power at the geared speed f v
  const G = 9.80665, aero = (v) => 0.5 * 1.225 * o.cda * v * v, crr = 0.004;
  for (const [g, n] of [[0, 18], [5, 6], [-3, 22], [8, 15]]) {
    const f = Gm.gearFactor(n), st = Gm.gearedGrade(g, n, o) / 100;
    const pTrainer = (o.mass * G * (st + crr) + aero(o.v)) * o.v, pRoad = (o.mass * G * (g / 100 + crr) + aero(f * o.v)) * f * o.v;
    if (st * 100 > -10 && st * 100 < 25) check(`gear ${n} on ${g}%: trainer power = road power`, near(pTrainer, pRoad, 0.5), `${pTrainer.toFixed(1)} vs ${pRoad.toFixed(1)} W`);
  }
  check('slope clamped to what trainers take', Gm.gearedGrade(20, 24, { ...o, v: 15 }) === 25 && Gm.gearedGrade(-40, 2, o) === -10);
  check('24 gears, the middle is the reference', Gm.GEARS.length === 24 && Gm.gearFactor(Gm.REF_GEAR) === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
