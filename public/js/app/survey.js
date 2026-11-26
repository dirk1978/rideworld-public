// The road survey: measures the real height of the 3D road ahead, drops bridges overhead, and gives
// groundHeight / roadGrade for the rider, physics and trainer.
import { toRad } from '../route.js';
import { C, median, route, state } from './core.js';
import { remotes } from './riders.js';
import { viewer } from './scenery.js';
import { cleanRoad } from './cleanroad.js';
import { landmarks } from './landmarks.js';
import { tunnels } from './tunnels.js';
import { anchorsFor, earthworks } from './earthworks.js';
// Everything the app draws itself (route line, editor lines, arches, rider, OSM buildings, landmarks, tunnels, earthworks): height measurements and
// camera checks must look straight through these to the real scenery. Missing the editor's own lines once made the
// rider ratchet upwards on every nudge (the survey measured the line floating above the road).
// the steady height of the scenery's surface over a trusted route's file heights: the route's own (Google, routes.json
// googleOffset) or, in Lite, the median of the terrain's first readings (once there are 8)
function guardOffset(sv) {
  if (Number.isFinite(route.opts?.googleOffset) && !state.lite) return route.opts.googleOffset;
  // (not on routes whose guard is switched off: Sa Calobra's road must follow the hairpins; the Lite datum guard ignored
  // that and broke its heights, the owner 2026-11-14)
  // and in Lite only for routes with surveyed file heights (the ones that carry a googleOffset: Brighton, Bristol, CCCP,
  // Blackpool, Isle of Wight); recorded mountain files can drift, and Sa Calobra / Cap must follow the terrain
  if (!state.lite || route.opts?.heightGuard === false || !Number.isFinite(route.opts?.googleOffset)) return NaN;
  if (sv.liteOff == null) { const v = sv.raw.filter(Number.isFinite); if (v.length >= 8) sv.liteOff = median(v); }
  return sv.liteOff ?? NaN;
}
export function ownObjects() {
  return [...viewer.entities.values, state.model, state.buildings, cleanRoad.prim, cleanRoad.cobbles, cleanRoad.apron, ...(cleanRoad.walls || []), ...landmarks.models, ...tunnels.prims, ...earthworks.prims, ...[...remotes.values()].map((r) => r.model)].filter(Boolean);
}

// ---------- road survey: the real height of the 3D road ----------
// The route's elevation comes from satellite terrain data, which is wrong on bridges (it measures the river
// below), in cuttings and on embankments, and is above sea level while the 3D tiles use ellipsoid height.
// On mountains it can be tens of metres out (90 m satellite cells can't separate stacked hairpins).
// So we measure the rendered surface itself, every 10 m, up to 400 m ahead of the rider. Each station takes three
// readings across the road (centre and 1.5 m either side). A road, or a hillside, is smooth even when it slopes
// sideways, so the centre lies on the line between the two sides; a tree, vehicle or wall makes a bump, and those
// stations are skipped. A tree canopy over the road can also be smooth, so readings more than 8 m above the
// level of the last 300 m are rejected too (trees are 15-30 m tall; a bridge climbs gradually and passes).
// The difference from the route's elevation is then median-filtered (removes short spikes) and rate-limited
// to 6 m per 10 m, and groundHeight() = route elevation + that difference.
export const SURVEY_STEP = 10;
const MAX_ROAD = 35; // steepest gradient (%) RideWorld will ride or send to the trainer (Hardknott ~33%)
const MAX_GRADE = 0.4; // steepest the rider's height may change (filterSurvey); the trainer's gradient: roadGrade
// across the road (metres right of the line): the road itself (first three), then the ground beyond the clean road's
// edges at 2.5 and 3.5 m out (4 m and 6 m roads), for the banks that close the gap on hillsides
const SIDES = [-1.5, 0, 1.5, -2.5, 2.5, -3.5, 3.5];
export const SURVEY_AHEAD = 400;
// Measures the next stretch ahead. While riding, 8 stations (80 m) at a time: a 30-station burst (as before
// 2026-10-16) made the frames around it ~45% slower, a visible stutter every ~30 s; small bites keep up just as well.
// While riding: `batch` stations per call, their points measured a few per frame (see sampleSpread): 1 a frame while
// the survey is well ahead, more as the rider catches up. Before the ride (batch 30) everything goes in one go.
export async function surveyAhead(batch = 4) {
  const sv = state.survey;
  if (!viewer || sv.busy) return;
  const nStations = Math.floor(route.length / SURVEY_STEP) + 1;
  const from = Math.max(sv.raw.length, Math.floor(state.dist / SURVEY_STEP));
  if (from < nStations && from * SURVEY_STEP <= state.dist + SURVEY_AHEAD - 100) {
    const lead = from * SURVEY_STEP - state.dist;
    const per = batch > 8 ? Infinity : lead > 250 ? 1 : lead > 150 ? 3 : SIDES.length;
    await surveyStations(from, Math.min(nStations, from + batch), per);
    return;
  }
  // The road ahead is covered. Stretches skipped by a jump or a scrub (stations never measured: undefined, where a
  // measured but rejected reading is NaN) are filled in once the rider is near them, from 120 m behind the rider (as
  // far back as the clean road and the camera reach) forwards. Before 2026-10-20 they were never measured, and
  // scrubbing back into one showed the road on a straight-line guess between distant readings (the owner, Cap on the
  // old laptop).
  const at = Math.floor(state.dist / SURVEY_STEP), hi = Math.min(sv.raw.length, nStations, at + Math.ceil((SURVEY_AHEAD - 100) / SURVEY_STEP));
  let gap = -1;
  for (let i = Math.max(0, at - 12); i < hi && gap < 0; i++) if (sv.raw[i] === undefined) gap = i;
  if (gap < 0) return;
  let end = gap;
  while (end < hi && end - gap < batch && sv.raw[end] === undefined) end++;
  const lead = gap * SURVEY_STEP - state.dist;
  await surveyStations(gap, end, batch > 8 ? Infinity : lead > 150 ? 3 : SIDES.length);
}

// The stretch around d that has been measured without a gap: [from, to] in metres (a jump or scrub leaves unmeasured
// stations until surveyAhead fills them; the clean road may only cut where the road has been measured)
export function measuredAround(d) {
  const raw = state.survey.raw, at = Math.floor(d / SURVEY_STEP);
  if (raw[at] === undefined) return null;
  let a = at, b = at;
  while (a > 0 && raw[a - 1] !== undefined) a--;
  while (b + 1 < raw.length && raw[b + 1] !== undefined) b++;
  return [a * SURVEY_STEP, b * SURVEY_STEP];
}

// Cesium measures each point with its own small render once the finest scenery there has loaded, and all the points
// of one call finish in the same frame: a batch of 8 stations x 7 points froze the picture ~0.5 s every 80 m on Sa
// Calobra's descent (the owner 2026-10-18). Measured `per` points at a time, one bite per frame, the same work is
// spread thin.
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
// One measurement of the scenery's surface at carts (heights set in place). Lite scenery reads the terrain's own data on
// the CPU (no render; scenery.js), Google's tiles need a pick render per point.
export function sampleSurface(carts, exclude) {
  if (state.lite) return C.sampleTerrainMostDetailed(viewer.terrainProvider, carts).catch(() => carts.map((c) => (c.height = undefined, c)));
  return viewer.scene.sampleHeightMostDetailed(carts, exclude);
}
async function sampleSpread(carts, exclude, per) {
  if (state.lite) return sampleSurface(carts); // (cheap: no need to spread it over frames)
  if (per >= carts.length) return viewer.scene.sampleHeightMostDetailed(carts, exclude);
  const out = [];
  for (let k = 0; k < carts.length; k += per) {
    out.push(...(await viewer.scene.sampleHeightMostDetailed(carts.slice(k, k + per), exclude)));
    await nextFrame();
  }
  return out;
}

// Measure stations [from, to) again, e.g. after the route editor has moved the line
export async function resurvey(fromM, toM) {
  const sv = state.survey;
  while (sv.busy) await new Promise((r) => setTimeout(r, 50));
  const nStations = Math.floor(route.length / SURVEY_STEP) + 1;
  const from = Math.max(0, Math.floor(fromM / SURVEY_STEP)), to = Math.min(nStations, Math.ceil(toM / SURVEY_STEP) + 1);
  if (to > from) await surveyStations(from, to);
}

export async function surveyStations(from, to, per = Infinity) {
  const sv = state.survey;
  sv.busy = true;
  try {
    const carts = [];
    for (let i = from; i < to; i++) {
      const d = Math.min(i * SURVEY_STEP, route.length);
      // across the road's own direction here (tangent): heading() looks 8-32 m ahead, which on a hairpin points the
      // sideways readings somewhere else entirely (the banks then missed the hillside)
      const p = route.at(d), h = route.tangent(d);
      const ex = Math.cos(h), ny = -Math.sin(h); // unit vector to the rider's right, in metres east/north
      for (const side of SIDES) {
        carts.push(C.Cartographic.fromDegrees(
          p.lon + (ex * side) / (111320 * Math.cos(toRad(p.lat))), p.lat + (ny * side) / 110540));
      }
    }
    const exclude = ownObjects();
    const res = await sampleSpread(carts, exclude, per);
    const n = SIDES.length;
    for (let i = from; i < to; i++) {
      const [l, c, r] = [0, 1, 2].map((k) => res[(i - from) * n + k].height);
      // the ground just beyond each edge of the clean road, for its banks (cleanroad.js): absolute heights
      sv.edge[i] = [3, 4, 5, 6].map((k) => res[(i - from) * n + k].height ?? NaN);
      // the highest of the three readings on the line, before anything is thrown away: Google's surface over the road
      // (tunnels.js stretches a tunnel to where the mountain over the road really ends)
      const lcr = [l, c, r].filter(Number.isFinite);
      sv.over[i] = lcr.length ? Math.max(...lcr) : NaN;
      let h = NaN;
      if ([l, c, r].every(Number.isFinite)) { if (Math.abs(c - (l + r) / 2) <= 0.6) h = c; } // smooth, maybe sloping
      else if (Number.isFinite(c) && (Number.isFinite(l) || Number.isFinite(r))) {
        const o = Number.isFinite(l) ? l : r;
        if (Math.abs(c - o) <= 1.5) h = c;
      }
      // ...or all seven readings across the road (out to 3.5 m) on one smooth slope: a mountainside road in coarse 3D
      // (a curved 30% hillside fails the three-point test, and those readings were lost, burying the rider)
      // how well the seven readings across the road fit one plane (m): a road is smooth; treetops aren't
      let rms = Infinity;
      if (Number.isFinite(c)) {
        const xs = [], ys = [];
        SIDES.forEach((x, k) => { const y = res[(i - from) * n + k].height; if (Number.isFinite(y)) { xs.push(x); ys.push(y); } });
        if (xs.length >= 6) {
          const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
          const k = xs.reduce((a, x, j) => a + (x - mx) * (ys[j] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
          rms = Math.sqrt(xs.reduce((a, x, j) => a + (ys[j] - (my + k * (x - mx))) ** 2, 0) / xs.length);
        }
      }
      if (!Number.isFinite(h) && rms < 0.5) h = c;
      sv.flat[i] = rms < 0.15;
      sv.raw[i] = h - route.smoothEle(Math.min(i * SURVEY_STEP, route.length));
    }
    // reject canopy: compare each new reading with the accepted level over the previous 300 m
    const batch = [];
    for (let i = from; i < to; i++) if (Number.isFinite(sv.raw[i])) batch.push(sv.raw[i]);
    for (let i = from; i < to; i++) {
      if (!Number.isFinite(sv.raw[i])) continue;
      const back = [];
      for (let j = Math.max(0, i - 30); j < i; j++) if (Number.isFinite(sv.raw[j])) back.push(sv.raw[j]);
      // under a long run of trees there may be fewer than 5 good readings in the last 300 m: then the last good ones
      // within 1 km, and the batch itself only at the start. Comparing a batch with itself let a batch of treetops
      // through, and then the next ones by them (Paris, rue Caulaincourt: the road 10-20 m up in the trees, the owner
      // 2026-10-20); the road's real level showed through gaps at the same offset as before and after the trees
      const ref = median(back.length >= 5 ? back : batch);
      // (that long look-back feeds only the treetop test, which never rejects road that's flat right across, and a
      // route's own tight guard; Cap's 10 m guard keeps the old reference: on Cap 3.0-3.1 mi Google's flat road holds
      // at 180 m while the recording drops 25 m below it, and the long reference threw that real road out)
      const long = [...back];
      if (long.length < 5) { long.length = 0; for (let j = i - 1; j >= Math.max(0, i - 100) && long.length < 5; j--) if (Number.isFinite(sv.raw[j])) long.push(sv.raw[j]); }
      const refLong = long.length >= 5 ? median(long) : ref;
      // ...unless it's flat right across (within 15 cm over 7 m): that's a road, not treetops (Sa Calobra 0.9 mi:
      // a flat road shelf 9 m above the map elevation was thrown out as canopy and the rider dropped through it)
      if (refLong !== null && sv.raw[i] > refLong + 8 && !sv.flat[i]) sv.raw[i] = NaN;
      // A route whose file heights are surveyed, not just recorded (Bristol 2026-10-25: Environment Agency LIDAR,
      // within ~1 m of Google's road on 90% of it): Google's road sits a known, steady height above the file
      // (routes.json googleOffset, metres: 49.7 there, the ellipsoid above Ordnance Datum), so a reading further than
      // heightGuard (default 3.5) from that is trees, a deck over us or a bad patch, whatever the readings around it
      // say (its Railway Path start is under trees from the first metre, so there was nothing good to compare with).
      // Only routes that set googleOffset.
      // Under a mapped bridge the deck can be lower than that guard: on its Railway Path the roads overhead are only
      // 2.5-4.5 m above the path, so their decks passed and the road climbed up onto the main road (the owner 2026-10-26,
      // 1.0 and 1.3 km). There, nothing more than 1.2 m above the file counts.
      // In Lite (Cesium's ~30 m terrain) a trusted route's file is the better height everywhere: the terrain only sets the
      // datum, the median of its first readings' offset, kept to 3.5 m as above (the owner 2026-11-14, Brighton Lite: the road
      // climbed the cliff foot's terrain at 14.6 km and rode up on the Marina's ramps at 12.3 km)
      else if (route.opts?.trusted && Number.isFinite(guardOffset(sv))
        && (Math.abs(sv.raw[i] - guardOffset(sv)) > (typeof route.opts.heightGuard === 'number' ? route.opts.heightGuard : 3.5)
          || (sv.raw[i] - guardOffset(sv) > 1.2 && inZone(i, i, ['under'])))) sv.raw[i] = NaN;
      // a recorded ride's heights are reliable: the 3D may not rise more than 10 m above them (approaching
      // Formentor's tunnel it climbed 70 m up the mountain over the road while the altimeter went gently up; the owner
      // 2026-10-19). Below them, the road follows Google's ground (Cap 1.11 mi: the 3D dips 17 m on a steady 6%
      // climb, and dropping those readings drew the road on a wall): that only until the route is analysed, so an
      // unanalysed tunnel can't pull the road into the valley either
      // The limit upwards is per route (routes.json heightGuard: metres, default 10; false = off). Flanders has 3: flat
      // and accurately recorded, so Google's surface sits at an almost constant height above the file and a reading
      // several metres higher is trees or hedges (46.67 mi: treetops 7-13 m up drew a 12 m hump on a dead-flat road;
      // the owner 2026-10-21). Not for every route: on Cap's mountain mesh 3 m threw out half the readings and moved the
      // road up to 27 m. Sa Calobra has false (Google's road bulges at the hairpins and the road must follow it).
      else if (route.opts?.trusted && route.opts.heightGuard !== false && typeof route.opts.heightGuard === 'number' && refLong !== null && sv.raw[i] - refLong > route.opts.heightGuard) sv.raw[i] = NaN;
      else if (route.opts?.trusted && ref !== null && route.opts.heightGuard !== false && (sv.raw[i] - ref > 10 || (!route.zones && ref - sv.raw[i] > 10))) sv.raw[i] = NaN;
    }
    filterSurvey();
  } catch (e) {
    console.warn('road survey failed', e);
  } finally {
    sv.busy = false;
  }
}

// Something overhead: a run of up to 8 stations (80 m) more than 3.5 m above the road on BOTH sides of it is a
// bridge over the road (we're in the underpass; the 3D model only has the deck) or a tree canopy, not the road.
// Returns a copy with those stations blanked, so the filter below rides the line between the two sides.
// On an analysed route (route.zones, from OpenStreetMap) that's only believed where the route really passes under
// something, and inside tunnels every reading is the mountain above: elsewhere a bulge is Google's coarse mountainside
// (Sa Calobra's hairpins bulge 5-12 m) and is ridden, smoothed (filterSurvey).
const inZone = (a, z, types) => (route.zones || []).some(([f, t, type]) => types.includes(type) && a * SURVEY_STEP <= t && z * SURVEY_STEP >= f);
export function dropOverheads(diffs) {
  // work on real heights: the file's own elevation can rise over a bridge too, hiding the jump in the difference
  const raw = diffs.map((v, i) => v + route.smoothEle(Math.min(i * SURVEY_STEP, route.length)));
  const out = diffs.slice();
  const level = (from, to) => {
    const v = [];
    for (let j = from; j <= to; j++) if (Number.isFinite(raw[j])) v.push(raw[j]);
    return v.length >= 2 ? median(v) : null;
  };
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isFinite(raw[i])) continue;
    const before = level(i - 5, i - 1);
    if (before === null || raw[i] - before <= 3.5) continue;
    // find where it comes back down within 8 stations
    let end = -1;
    for (let k = i; k < Math.min(raw.length, i + 9); k++) {
      if (Number.isFinite(raw[k]) && raw[k] - before <= 3.5) { end = k; break; }
    }
    if (end < 0) continue; // still up after 80 m (or not surveyed yet): a real rise, leave it
    const after = level(end, end + 4);
    if (after === null) continue;
    let all = true;
    for (let k = i; k < end; k++) if (Number.isFinite(raw[k]) && raw[k] - Math.max(before, after) <= 3.5) { all = false; break; }
    if (!all) { i = end - 1; continue; }
    // the bridge's edges slope, so readings just either side are part-way up the deck: drop those too
    let a = i, z = end - 1;
    while (a - 1 >= 0 && a > i - 2 && Number.isFinite(raw[a - 1]) && raw[a - 1] - before > 0.8) a--;
    while (z + 1 < raw.length && z < end + 1 && Number.isFinite(raw[z + 1]) && raw[z + 1] - after > 0.8) z++;
    if (route.zones && !inZone(a, z, ['under', 'tunnel'])) { i = end - 1; continue; } // no bridge here: the road
    for (let k = a; k <= z; k++) out[k] = NaN;
    i = z;
  }
  // in a tunnel the 3D model is the mountain on top
  for (const [f, t, type] of route.zones || []) {
    if (type !== 'tunnel') continue;
    for (let k = Math.ceil(f / SURVEY_STEP); k * SURVEY_STEP <= t && k < out.length; k++) out[k] = NaN;
  }
  return out;
}

export function filterSurvey() {
  const sv = state.survey, raw = dropOverheads(sv.raw);
  // remember where the decks are (real height of each dropped reading) so the camera can stay out of them
  sv.deck = sv.raw.map((v, i) => (Number.isFinite(v) && !Number.isFinite(raw[i]) ? v + route.smoothEle(Math.min(i * SURVEY_STEP, route.length)) : undefined));
  // 1) 5-station median of the good readings
  const med = raw.map((v, i) => {
    if (!Number.isFinite(v)) return NaN;
    const win = [];
    for (let j = i - 2; j <= i + 2; j++) if (Number.isFinite(raw[j])) win.push(raw[j]);
    return median(win);
  });
  // 2) gaps (skipped readings, bridges overhead) get a straight line between the good values either side,
  //    so the rider holds the road's height through an underpass instead of picking up its edges
  const out = [];
  let prevI = -1;
  for (let i = 0; i < med.length; i++) {
    if (Number.isFinite(med[i])) { prevI = i; out[i] = med[i]; continue; }
    let nextI = i + 1;
    while (nextI < med.length && !Number.isFinite(med[nextI])) nextI++;
    if (prevI >= 0 && nextI < med.length) out[i] = med[prevI] + ((med[nextI] - med[prevI]) * (i - prevI)) / (nextI - prevI);
    else if (prevI >= 0) out[i] = med[prevI];
    else if (nextI < med.length) out[i] = med[nextI];
  }
  // 3) no spikes steeper than 40%: halfway between the highest and the lowest 40%-limited profiles through the
  //    readings (a spike is shaved and the dip after it raised by equal amounts). The rider's height follows the 3D
  //    closely so it isn't buried; what the trainer feels is smoothed separately (roadGrade). Was "the correction
  //    changes by at most 6 m per 10 m".
  const ele = (i) => route.smoothEle(Math.min(i * SURVEY_STEP, route.length));
  const s = MAX_GRADE * SURVEY_STEP, abs = out.map((v, i) => (v === undefined ? undefined : v + ele(i)));
  const up = abs.slice(), dn = abs.slice();
  for (const dir of [1, -1]) {
    for (let k = 0; k < abs.length; k++) {
      const i = dir > 0 ? k : abs.length - 1 - k, j = i - dir;
      if (up[i] === undefined || up[j] === undefined) continue;
      up[i] = Math.min(up[i], up[j] + s);
      dn[i] = Math.max(dn[i], dn[j] - s);
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] !== undefined) out[i] = (up[i] + dn[i]) / 2 - ele(i);
  const first = out.findIndex((v) => v !== undefined);
  for (let i = 0; i < first; i++) out[i] = out[first];
  // (a recorded ride, route.opts.trusted, is drawn the same way: on the hillside. Until 2026-10-19 its offset was
  // smoothed over +-300 m to keep the file's shape, which left the road metres off Google's hillside on Formentor.)
  sv.diff = out;
  sv.version++;
}

// Height difference between the 3D road and the route's elevation at distance d
export function surveyDiff(d) {
  const diff = state.survey.diff;
  if (!diff.length) return 0;
  const f = d / SURVEY_STEP, i = Math.floor(f);
  if (i >= diff.length - 1) return diff[diff.length - 1];
  return diff[i] + (diff[i + 1] - diff[i]) * (f - i);
}

// Gradient for the physics, HUD and trainer, in percent. The trend over 500 m: the average of the measured 3D road
// and the route's own elevation where they agree within 5%, else the 3D (bridges, which map elevation dips under,
// and big map-data errors). Plus the 3D's local slope over 80 m, but at most 3% either side of the trend. Mountain
// 3D and map elevation are both lumpy over tens of metres (Sa Calobra: a fifth of the 7% climb read over 12% at
// 80 m); this gives Sa Calobra a 7.1% average and a few short 15% ramps, much like the real climb.
// Where the survey has few good readings here (wooded slopes: canopy thrown away), the route's own gradient.
// (Until 2026-10-17: 40 m slope, falling back to the route whenever they disagreed by over 6%.)
const slopeAt = (d, half, height = groundHeight) => { // least-squares slope over d +- half, in %
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let x = Math.max(0, d - half); x <= Math.min(route.length, d + half); x += SURVEY_STEP) {
    const y = height(x); n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  return n > 2 && den > 0 ? ((n * sxy - sx * sy) / den) * 100 : 0;
};
// cached in 5 m steps (it's asked for every rider every frame), until the survey or the route changes
let gradeCache = new Map(), gradeFor = null;
export function roadGrade(d) {
  const key = Math.round(d / 5), ver = `${state.survey.version}:${state.survey.diff.length}`;
  if (gradeFor?.route !== route || gradeFor.ver !== ver) { gradeCache = new Map(); gradeFor = { route, ver }; }
  let g = gradeCache.get(key);
  if (g === undefined) { g = gradeAt(key * 5); gradeCache.set(key, g); }
  return g;
}
function gradeAt(d) {
  const routeGrade = route.grade(d);
  // a recorded ride (trusted heights): the file's own slope over 80 m. The road is drawn on Google's hillside, lumps
  // and all; the number, the elevation graph and the trainer follow the altimeter (the owner 2026-10-19: "the road more
  // or less follows the terrain but the elevation graph, gradient counter and trainer difficulty don't have the spikes").
  if (route.opts?.trusted) return Math.max(-MAX_ROAD, Math.min(MAX_ROAD, slopeAt(d, 40, (x) => route.smoothEle(x))));
  const sv = state.survey;
  if (!sv.diff.length) return routeGrade;
  const i = Math.round(d / SURVEY_STEP);
  let good = 0;
  for (let k = i - 3; k <= i + 3; k++) if (Number.isFinite(sv.raw[k])) good++;
  if (good < 4) return routeGrade;
  const measured = slopeAt(d, 250), own = slopeAt(d, 250, (x) => route.smoothEle(x));
  const trend = Math.abs(measured - own) <= 5 ? (measured + own) / 2 : measured;
  // short stretches: the 3D's 80 m slope, but at most 3% off the trend, UNLESS the route's own elevation agrees with
  // the 3D over 160 m (within 2%): then it's a real ramp, not lumpy 3D (Hardknott's 30% switchbacks, the owner
  // 2026-10-17). Tested on Sa Calobra's data: steepest 17.5% (was 16.4%), 7.2% average.
  const near3d = slopeAt(d, 80), nearOwn = slopeAt(d, 80, (x) => route.smoothEle(x));
  const local = Math.abs(near3d - nearOwn) <= 2 ? (near3d + nearOwn) / 2 : trend + Math.max(-3, Math.min(3, slopeAt(d, 40) - trend));
  return Math.max(-MAX_ROAD, Math.min(MAX_ROAD, local));
}

// Highest bridge deck over the road between two distances (real height), or null
export function deckBetween(a, b) {
  const deck = state.survey.deck;
  if (!deck) return null;
  let top = null;
  for (let i = Math.max(0, Math.floor(Math.min(a, b) / SURVEY_STEP)); i <= Math.ceil(Math.max(a, b) / SURVEY_STEP) && i < deck.length; i++) {
    if (deck[i] !== undefined) top = Math.max(top ?? -Infinity, deck[i]);
  }
  return top;
}

const rawGround = (d) => route.smoothEle(d) + surveyDiff(d) + route.upOffset(d);
// a 'use my heights' stretch's offset at one end: the median of the survey's offsets over the 30 m outside it (one
// reading at the end itself swung with Google's lumps there, and with it the whole stretch's height, run to run)
// Each end uses the survey's offsets once the survey has measured 30 m past it (so the road meets the road drawn outside
// the stretch without a step); until then earthworks.js's own reading there (the survey's guess at an unmeasured far
// end moved the whole stretch with every batch)
const surveyed = (d) => state.survey.raw.length * SURVEY_STEP > Math.min(route.length, d + 30);
const anchor = (d, dir) => median([0, 10, 20, 30].map((k) => surveyDiff(Math.max(0, Math.min(route.length, d + dir * k)))));
// Height of the road surface at d; on a 'level' correction, a straight line between the stretch's two ends
export function groundHeight(d) {
  for (const [a, b] of route.levels?.() || []) {
    if (d > a && d < b) { const ha = rawGround(a), hb = rawGround(b); return ha + ((hb - ha) * (d - a)) / (b - a); }
  }
  // 'use my heights': the file's own shape, with the offset to Google's scale running straight from one end to the other
  for (const [a, b] of route.mine?.() || []) {
    if (d > a && d < b) { const e = anchorsFor(a, b), oa = surveyed(a) || e?.oa === undefined ? anchor(a, -1) : e.oa, ob = surveyed(b) || e?.ob === undefined ? anchor(b, 1) : e.ob; return route.smoothEle(d) + oa + ((ob - oa) * (d - a)) / (b - a) + route.upOffset(d); }
  }
  // 'hold': the file's shape, the offset from the survey at each end (just outside it) running straight between
  for (const [a, b] of route.holds?.() || []) {
    if (d > a && d < b) { const oa = anchor(a, -1), ob = anchor(b, 1); return route.smoothEle(d) + oa + ((ob - oa) * (d - a)) / (b - a) + route.upOffset(d); }
  }
  // open world: the road's own LIDAR height + the area's terrain offset (world.js), which is what flatterrain.js levels
  // the ground to; on bridges it's the deck, not the railway in the cutting below (the owner 2026-11-16: "cyclist stays at
  // previous road height so disappears underneath")
  if (route.opts?.open && Number.isFinite(state.owTerrainOff)) { const e = route.at(d).ele; if (Number.isFinite(e)) return e + state.owTerrainOff + (state.paintOn ? 0 : 0.25); }
  return rawGround(d) + (route.opts?.open && !state.paintOn ? 0.25 : 0); // (open world: on the 3D road layer, world.js OPEN_LIFT; painted roads lie on the ground)
}
