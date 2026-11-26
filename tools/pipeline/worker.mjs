// The route pipeline's worker (the owner 2026-10-27: "after creating or uploading a route, could it go into a processing
// queue where it is subject to the same analysis and improvements that you do every time I upload a file?").
// Runs as its own service (rideworld-pipeline.service: it needs Playwright and the graphics card, which the web server's
// sandbox keeps out). The web server (lib/pipeline.js) queues a job file data/pipeline/<route id>.json; this picks the
// oldest queued one, works through the steps below, writing its progress into the job file as it goes (the route card
// shows it), and leaves the results in the job (and a new GPX next to it). Only the web server writes routes.json: it
// applies a finished job's results.
//   node tools/pipeline/worker.mjs            (loops; one job at a time)
//   node tools/pipeline/worker.mjs --once ID  (runs one route's job now, for testing)
import fs from 'fs';
import path from 'path';
import { bridgeSpans, densify, gradients, reheight, sourceFor, SOURCES } from '../routes/heights.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = process.env.RW_DATA || path.join(ROOT, 'data');
const JOBS = path.join(DATA, 'pipeline');
process.env.LIDAR_CACHE ||= path.join(DATA, 'cache', 'lidar');
process.env.BZ_CACHE ||= path.join(DATA, 'cache', 'bz');
process.env.COG_CACHE ||= path.join(DATA, 'cache', 'cog'); // Wales's and Scotland's survey tiles
const { Route } = await import(path.join(ROOT, 'public/js/route.js'));
const { lidar } = await import(path.join(ROOT, 'tools/routes/bristol/lidar.mjs'));


const writeJob = (job) => { const f = path.join(JOBS, job.routeId + '.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(job, null, 1), { mode: 0o600 }); fs.renameSync(f + '.tmp', f); };
const readRoutes = () => JSON.parse(fs.readFileSync(path.join(DATA, 'routes.json'), 'utf8'));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const k = Math.PI / 180;

function parseGpx(gpx) {
  const pts = [], re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = re.exec(gpx))) {
    const lat = +(m[2].match(/lat="([^"]+)"/) || [])[1], lon = +(m[2].match(/lon="([^"]+)"/) || [])[1];
    const ele = +((m[4] || '').match(/<ele>([^<]+)<\/ele>/) || [])[1], time = ((m[4] || '').match(/<time>([^<]+)<\/time>/) || [])[1];
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null, time: time ? Date.parse(time) : null });
  }
  return pts;
}
const toGpx = (name, pts) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RideWorld route pipeline" xmlns="http://www.topografix.com/GPX/1/1">\n <trk><name>${String(name).replace(/[<&>]/g, '')}</name><trkseg>\n`
  + pts.map((p) => `  <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}${p.time ? `<time>${new Date(p.time).toISOString()}</time>` : ''}</trkpt>`).join('\n')
  + '\n </trkseg></trk>\n</gpx>\n';
const dist = (a, b) => Math.hypot((b.lon - a.lon) * k * Math.cos(a.lat * k) * 6371000, (b.lat - a.lat) * k * 6371000);

// ---------- the steps ----------
async function run(job) {
  const step = (key) => job.steps.find((s) => s.key === key);
  const begin = (key) => { const s = step(key); s.status = 'running'; s.started = new Date().toISOString(); job.step = key; job.progress = 0; writeJob(job); };
  const end = (key, status, note) => { const s = step(key); s.status = status; if (note) s.note = note; job.progress = 0; writeJob(job); };
  const say = (t) => job.summary.push(t), look = (t) => job.attention.push(t);
  const res = job.result;
  const r = readRoutes().find((x) => x.id === job.routeId);
  if (!r) throw new Error('the route was deleted');
  const gpx = fs.readFileSync(path.join(DATA, 'routes', r.id + '.gpx'), 'utf8');

  begin('read');
  let pts = parseGpx(gpx);
  const recorded = pts.filter((p) => p.time && p.ele != null).length >= pts.length * 0.9 && pts.length >= 50;
  end('read', 'done', `${pts.length} points, ${recorded ? 'a recorded ride' : 'a drawn route'}`);

  begin('tidy');
  if (recorded) {
    // stops: points that moved under 1 m/s from the last kept point (feed stations, junctions): kinks and loops
    const kept = [pts[0]];
    for (const p of pts.slice(1)) { const q = kept[kept.length - 1]; const dt = (p.time - q.time) / 1000; if (dt <= 0 || dist(q, p) / dt >= 1 || dist(q, p) > 15) kept.push(p); }
    const n = pts.length - kept.length;
    pts = kept;
    end('tidy', n ? 'done' : 'skipped', n ? `${n} stationary points taken out` : 'no stops in it');
    if (n) res.changedLine = true;
  } else end('tidy', 'skipped', 'not a recorded ride');

  begin('source');
  const source = await sourceFor(pts);
  end('source', source ? 'done' : 'skipped', source ? SOURCES[source].label : 'no survey covers this route yet (Great Britain, France, Switzerland, South Tyrol and the USA so far): the heights stay as they are');
  res.heightSource = source;

  // the web server analyses every new route for bridges and tunnels (OpenStreetMap) as it's added: wait for an analysis
  // at least as new as this job (up to 10 min; a job run again on an old route takes the analysis it has). Re-heighting
  // needs it (the bridges the route rides over), and so do the underpasses.
  let st = null;
  for (let i = 0; i < 120; i++) {
    const s2 = readRoutes().find((x) => x.id === job.routeId)?.structures;
    if (s2?.list && (job.reason === 'again' || !s2.at || Date.parse(s2.at) >= Date.parse(job.created) - 120000)) { st = s2; break; }
    if (i === 0) { job.step = 'heights'; step('heights').note = 'waiting for the bridge and tunnel analysis'; writeJob(job); }
    await sleep(5000);
  }
  delete step('heights').note;

  // a drawn line has points only at bends and junctions (~27 m apart from BRouter): one every 5 m, so the survey is
  // read all along the road (and across bridges)
  if (source && !recorded) { pts = densify(pts, 5); res.changedLine = true; }
  let d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + dist(pts[i - 1], pts[i]));
  let z = pts.map((p) => p.ele);
  begin('heights');
  if (source) {
    const bridges = bridgeSpans(pts, st?.list, d);
    const out = await reheight(pts, source, 'auto', (f) => { job.progress = f; writeJob(job); }, { bridges });
    // how far the device's own heights were from the survey (barometers drift with the weather)
    if (recorded) {
      const diffs = pts.map((p, i) => p.ele - out.raw[i]).filter(Number.isFinite), q = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
      const n4 = Math.floor(diffs.length / 4), first = q(diffs.slice(0, n4)), last = q(diffs.slice(-n4));
      res.drift = { first: +first.toFixed(1), last: +last.toFixed(1) };
      if (Math.abs(last - first) > 4 || Math.abs(first) > 6) say(`Your device's heights were ${first > 0 ? '+' : ''}${first.toFixed(0)} m from the survey at the start and ${last > 0 ? '+' : ''}${last.toFixed(0)} m at the end (barometers drift with the weather): the survey's are used.`);
      else say('Your device agreed with the survey to within a few metres.');
    }
    z = out.z;
    pts.forEach((p, i) => { p.ele = z[i]; });
    const g = gradients(d, z);
    res.gpx = true;
    res.trusted = true;
    end('heights', 'done', `steepest 500 m ${(g.m500 * 100).toFixed(1)}%, steepest 50 m ${(g.m50 * 100).toFixed(1)}% (limited to ${Math.round(out.maxGrade * 100)}%)${bridges.length ? `; carried across ${bridges.length} bridge${bridges.length > 1 ? 's' : ''}` : ''}${st ? '' : '; no bridge analysis yet'}`);
    say(`Heights from the ${SOURCES[source].label}; trusted, so the trainer uses them.`);
  } else if (recorded) {
    res.gpx = !!res.changedLine;
    end('heights', 'skipped', "kept your device's heights (no survey here)");
  } else {
    res.gpx = !!res.changedLine;
    end('heights', 'skipped', 'kept the map heights (no survey here)');
    look('No height survey covers this route, so its gradients come from map heights: they can be several % out on hairpins.');
  }
  if (res.gpx) fs.writeFileSync(path.join(JOBS, r.id + '.gpx'), toGpx(r.name, pts), { mode: 0o600 });

  // bridges overhead: Google's height at each crossing tells how high its deck is (each one: a 22 m access road and a
  // 10 m parkway deck 40 m apart are different things, New York 15.9 km)
  const unders = (st?.list || []).filter((x) => x.type === 'under').sort((a, b) => a.km - b.km);
  begin('google');
  let tops = [];
  if (source) {
    try {
      const off = await googleOffset(pts, (f) => { job.progress = f; writeJob(job); }, unders.map((x) => [x.lat, x.lon]));
      if (off.offset !== null) {
        res.googleOffset = off.offset;
        tops = off.tops.map((t) => (t === null ? null : t - off.offset));
        // lined with trees or buildings on a lowland route: low banks (else the clean road's banks rise to the treetops
        // in grey walls, as under Central Park's trees; Barcelona's streets have 0.5 by hand). Mountain roads keep
        // theirs: there the ground beside really does rise.
        const span = Math.max(...pts.map((q) => q.ele)) - Math.min(...pts.map((q) => q.ele));
        if (off.sides > 0.25 && span < 300 && r.banks == null) { res.banks = 1; say(`Low banks: ${Math.round(off.sides * 100)}% of the road has trees or buildings over its edges.`); }
        end('google', 'done', `Google's road ${Math.abs(off.offset)} m ${off.offset >= 0 ? 'above' : 'below'} the survey (${off.n} spots agree within ${off.spread} m)`);
        say("The drawn road is held to the survey's heights, out of trees and hedges.");
      } else end('google', 'skipped', `Google's 3D too uneven here (${off.n} readings, ${off.spread} m spread): the drawn road follows it`);
    } catch (e) { end('google', 'failed', e.message); }
  } else end('google', 'skipped', 'needs survey heights');

  begin('bridges');
  if (!st?.list) end('bridges', 'failed', 'the OpenStreetMap analysis hasn\'t finished (it retries hourly); press Process again later');
  else {
    // only low bridges (decks 2.5-12 m over the road) get an underpass: the clean road leaves high decks alone. The
    // deck's height: Google's model there over the road's survey height (any country; the George Washington Bridge
    // read 61-63 m over the Greenway, its real clearance ~65 m), else the EA's surface model (England). Low crossings
    // within 40 m make one underpass.
    const lows = [];
    let unknown = 0;
    for (const [n, x] of unders.entries()) {
      let deck = NaN;
      if (Number.isFinite(tops[n])) { let best = null; for (let i = 0; i < pts.length; i++) { const e = dist(pts[i], x); if (!best || e < best.e) best = { e, i }; } deck = tops[n] - z[best.i]; }
      else if (source === 'ea') { const [dsm, dtm] = [await lidar('dsm', x.lat, x.lon), await lidar('dtm', x.lat, x.lon)]; deck = dsm - dtm; }
      if (!Number.isFinite(deck)) { unknown++; continue; }
      if (deck >= 2.5 && deck <= 12) lows.push({ ...x, deck });
    }
    const groups = [];
    for (const x of lows) { const g = groups[groups.length - 1]; if (g && x.km - g[g.length - 1].km < 0.04) g.push(x); else groups.push([x]); }
    // ends 12 m beyond the first and last crossing along the line, found by position (the ride finds a tunnel by
    // lat/lon): a lone crossing's tube was 6 m once tunnels.js trims its padding (under the 10 m it builds), and with no
    // margin an underpass was shorter than the embankment over it (CCCP, 2026-10-27)
    const along = (u, m) => {
      let i = 0, best = Infinity;
      pts.forEach((q, j) => { const e = dist(q, u); if (e < best) { best = e; i = j; } });
      for (let gone = 0, sg = Math.sign(m); gone < Math.abs(m) && pts[i + sg]; i += sg) gone += dist(pts[i], pts[i + sg]);
      return pts[i];
    };
    const add = groups.map((g) => {
      const a = g[0], b = g[g.length - 1], s0 = along(a, -12), s1 = along(b, 12); // (12 m beyond each end: CCCP 0.47 km)
      return { type: 'tunnel', km: +(a.km - 0.012).toFixed(4), kmEnd: +(b.km + 0.012).toFixed(4), lat: +s0.lat.toFixed(6), lon: +s0.lon.toFixed(6), latEnd: +s1.lat.toFixed(6), lonEnd: +s1.lon.toFixed(6),
        name: `Underpass at ${a.km.toFixed(2)} km`, hand: 'pipeline', style: 'underpass', deck: +Math.min(...g.map((q) => q.deck)).toFixed(1) };
    });
    res.underpasses = add;
    const tunnels = st.list.filter((x) => x.type === 'tunnel' && x.hand !== 'pipeline').length;
    if (add.length) say(`${add.length} underpass${add.length > 1 ? 'es' : ''} built where the route goes under low bridges.`);
    if (unknown) look(`${unknown} crossing${unknown > 1 ? 's' : ''} under a bridge couldn't be measured: worth a look for dark gaps.`);
    end('bridges', 'done', `${unders.length} crossings under bridges, ${add.length} underpasses, ${tunnels} tunnels`);
  }

  begin('climbs');
  {
    const g = climbs(d, z);
    // ride km on the cleaned route, by position (the browser's Route cleans and smooths the line)
    const route = new Route(r.name, pts.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele })), r.adjust, r.finish, r.start, { centre: r.centre });
    const kmAt = (i) => { const p = pts[i]; let best = null; for (let m = 0; m <= route.length; m += 10) { const q = route.at(m), e = dist(p, q); if (!best || e < best.e) best = { e, m }; } return +(best.m / 1000).toFixed(3); };
    const hp = hairpins(route);
    res.climbs = g.map((c, n) => ({ name: `Climb ${n + 1}: ${(c.len / 1000).toFixed(1)} km at ${(c.avg * 100).toFixed(1)}%`, from: kmAt(c.i0), to: kmAt(c.i1), kind: 'climb' }));
    res.hairpins = hp.length;
    if (res.climbs.length) say(`${res.climbs.length} climb${res.climbs.length > 1 ? 's' : ''} timed as segments${(r.segments || []).length ? ' (yours kept)' : ''}.`);
    if (hp.length >= 6) look(`${hp.length} hairpins: ask Claude to number them as segments, as on the Alpe and the Stelvio.`);
    end('climbs', 'done', `${res.climbs.length} climbs, ${hp.length} hairpins`);
  }

  begin('walls');
  {
    const span = Math.max(...z.filter(Number.isFinite)) - Math.min(...z.filter(Number.isFinite)), g = gradients(d, z);
    if (span > 300 && g.m500 > 0.06 && !(r.sideWalls || []).length) { res.sideWalls = [[0, +(d[d.length - 1] / 1000 + 0.1).toFixed(2), 'rock']]; say('Rock walls on the uphill side, as on the mountain routes.'); }
    end('walls', 'done', res.sideWalls ? 'rock walls on the uphill side' : 'none needed');
  }
}

// climbs: from every dip (turning points of the profile, ignoring wiggles under 3 m), climbs that
// gain 20 m+ over 250 m+ at 3%+ on average, without dropping more than a quarter of its gain (or 10 m) on the way
// up; scored gain^2 / length (as climb categories are: steep and long counts most) and taken best first, without
// overlapping. Up to 12, in route order. (The first version followed each rise to the highest point before a 10 m
// drop, so New York's Greenway-to-bridge ramp, 56 m at 4.7%, merged into a 20 km drift to 9W's top at 0.8% and was
// thrown away.)
export function climbs(d, z) {
  const ext = [0];
  let dir = 0;
  for (let i = 1; i < z.length; i++) {
    const last = ext[ext.length - 1], dz = z[i] - z[last];
    if (dir >= 0 && z[i] >= z[last]) { if (dir === 1) ext[ext.length - 1] = i; else if (dz >= 3) { ext.push(i); dir = 1; } }
    else if (dir <= 0 && z[i] <= z[last]) { if (dir === -1) ext[ext.length - 1] = i; else if (-dz >= 3) { ext.push(i); dir = -1; } }
    else if (Math.abs(dz) >= 3) { ext.push(i); dir = dz > 0 ? 1 : -1; }
  }
  const lows = ext.filter((i, n) => n === 0 || z[i] < z[ext[n - 1]]);
  // from each dip, the end (anywhere, not only a crest: the bridge ramp eases onto the deck and drifts on up) with
  // the best score
  const cand = [];
  for (const a of lows) {
    let peak = z[a], worst = 0, best = null;
    for (let i = a + 1; i < z.length && d[i] - d[a] < 30000; i++) {
      if (z[i] > peak) peak = z[i];
      worst = Math.max(worst, peak - z[i]);
      if (z[i] < z[a] || worst > Math.max(10, (peak - z[a]) / 4)) break;
      if (z[i] < peak) continue;
      const gain = z[i] - z[a], len = d[i] - d[a];
      if (gain >= 20 && len >= 250 && gain / len >= 0.03 && (!best || (gain * gain) / len > best.score)) best = { i0: a, i1: i, gain, len, avg: gain / len, score: (gain * gain) / len };
    }
    // ...and its start moved up to where the climbing begins (a dip on a long flat: the Greenway before the ramp)
    if (best) for (let i = best.i0 + 1; i < best.i1; i++) { const gain = z[best.i1] - z[i], len = d[best.i1] - d[i]; if (gain >= 20 && len >= 250 && (gain * gain) / len > best.score) Object.assign(best, { i0: i, gain, len, avg: gain / len, score: (gain * gain) / len }); }
    if (best) cand.push(best);
  }
  const out = [];
  for (const c of cand.sort((x, y) => y.score - x.score)) if (out.length < 12 && !out.some((o) => c.i0 < o.i1 && o.i0 < c.i1)) out.push(c);
  return out.sort((x, y) => x.i0 - y.i0);
}
function hairpins(route) {
  const hp = [];
  for (let m = 30; m < route.length - 30; m += 5) {
    let a = route.tangent(m + 30) - route.tangent(m - 30); a = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI;
    if (a < 150) continue;
    const last = hp[hp.length - 1];
    if (last && m - last.m < 45) { if (a > last.t) Object.assign(last, { m, t: a }); } else hp.push({ m, t: a });
  }
  return hp;
}

// Google's road height above the survey: the scenery opened headless (Cesium, the site's Google key), heights sampled
// along the route; kept only if they agree (most of them within 2.5 m)
// extra: [[lat, lon]] whose Google heights come back too (decks over the route: how high they are above it)
export async function googleOffset(pts, onProgress = () => {}, extra = []) {
  const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright/index.mjs');
  const key = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).google;
  if (!key) throw new Error('no Google key');
  const every = Math.max(1, Math.floor(pts.length / 60)), sample = pts.filter((_, i) => i % every === 0).slice(0, 60);
  const b = await chromium.launch({ args: ['--use-angle=gl-egl', '--disable-gpu-sandbox', '--no-sandbox', '--ignore-gpu-blocklist'] });
  try {
    const p = await (await b.newContext({ viewport: { width: 640, height: 400 }, extraHTTPHeaders: { Referer: 'https://rideworld.example.org/' } })).newPage();
    await p.setContent(`<html><head><script>window.CESIUM_BASE_URL='https://cdn.jsdelivr.net/npm/cesium@1.146.0/Build/Cesium/';</script><script src="https://cdn.jsdelivr.net/npm/cesium@1.146.0/Build/Cesium/Cesium.js"></script></head><body style="margin:0"><div id="g" style="width:640px;height:400px"></div></body></html>`);
    await p.waitForFunction(() => window.Cesium, null, { timeout: 60000 });
    const heights = [];
    await p.evaluate(async (key) => {
      const C = window.Cesium;
      window.v = new C.Viewer('g', { baseLayer: false, globe: false, skyBox: false, skyAtmosphere: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false, fullscreenButton: false });
      window.v.scene.primitives.add(await C.createGooglePhotorealistic3DTileset({ key, onlyUsingWithGoogleGeocoder: true }));
    }, key);
    // each point, and 4.5 m either side of the road (trees or buildings over its edges: see `sides`)
    const side = [];
    for (let i = 0; i < sample.length; i += 5) {
      const part = sample.slice(i, i + 5), q3 = [];
      for (const q of part) {
        const n = pts.indexOf(q), a = pts[Math.max(0, n - 2)], b = pts[Math.min(pts.length - 1, n + 2)];
        const ex = (b.lon - a.lon) * Math.cos(q.lat * k), ny = b.lat - a.lat, L = Math.hypot(ex, ny) || 1;
        q3.push([q.lat, q.lon], ...[-4.5, 4.5].map((o) => [q.lat + ((-ex / L) * o) / 110540, q.lon + ((ny / L) * o) / (111320 * Math.cos(q.lat * k))]));
      }
      const h = await p.evaluate(async (part) => {
        const C = window.Cesium, out = await window.v.scene.sampleHeightMostDetailed(part.map(([la, lo]) => C.Cartographic.fromDegrees(lo, la)));
        return out.map((c) => (c && Number.isFinite(c.height) ? c.height : null));
      }, q3);
      part.forEach((q, j) => { const c = h[j * 3]; if (c !== null && q.ele != null) { heights.push(c - q.ele); side.push([c - q.ele, h[j * 3 + 1], h[j * 3 + 2], q.ele]); } });
      onProgress(Math.min(1, (i + 5) / sample.length));
    }
    // the extra points: the highest reading within 3 m (a deck is narrow; one reading can fall through a gap)
    const tops = [];
    for (const [la, lo] of extra) {
      const ring = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].map(([dn, de]) => [la + dn / 110540, lo + de / (111320 * Math.cos(la * k))]);
      const h = await p.evaluate(async (part) => {
        const C = window.Cesium, out = await window.v.scene.sampleHeightMostDetailed(part.map(([a, o]) => C.Cartographic.fromDegrees(o, a)));
        return out.map((c) => (c && Number.isFinite(c.height) ? c.height : null));
      }, ring);
      const ok = h.filter((v) => v !== null);
      tops.push(ok.length ? Math.max(...ok) : null);
    }
    heights.sort((a, c) => a - c);
    if (heights.length < 10) return { offset: null, n: heights.length, spread: '?', tops };
    // the road: the lowest cluster (trees and hedges read higher); its median, and how tightly the rest agree
    const lowQ = heights[Math.floor(heights.length * 0.25)];
    const near = heights.filter((v) => Math.abs(v - lowQ) <= 2.5), med = near[near.length >> 1];
    const spread = +(near[near.length - 1] - near[0]).toFixed(1);
    // sides: the share of points with something 4 m+ over the road just beyond one edge (trees, walls, buildings)
    const sides = side.length ? side.filter(([, l, r, e]) => [l, r].some((v) => v !== null && v - med - e > 4)).length / side.length : 0;
    return { offset: near.length >= heights.length * 0.5 ? +med.toFixed(1) : null, n: heights.length, spread, tops, sides: +sides.toFixed(2) };
  } finally { await b.close(); }
}

// ---------- the loop ----------
async function work(job) {
  job.state = 'running'; job.startedAt = new Date().toISOString(); job.result = {}; job.summary = []; job.attention = [];
  writeJob(job);
  try { await run(job); job.state = 'done'; }
  catch (e) { job.state = 'failed'; job.error = e.message; console.error('pipeline', job.routeId, e); }
  job.step = null; job.finishedAt = new Date().toISOString();
  writeJob(job);
}

if (process.argv[1] && process.argv[1].endsWith('worker.mjs')) {
  fs.mkdirSync(JOBS, { recursive: true, mode: 0o700 });
  const once = process.argv.indexOf('--once');
  if (once > 0) { const job = JSON.parse(fs.readFileSync(path.join(JOBS, process.argv[once + 1] + '.json'), 'utf8')); await work(job); console.log(JSON.stringify(job, null, 1)); process.exit(0); }
  console.log('route pipeline worker: watching', JOBS);
  // a job left 'running' by a crash or restart goes back in the queue
  for (const f of fs.readdirSync(JOBS).filter((x) => x.endsWith('.json'))) {
    const job = JSON.parse(fs.readFileSync(path.join(JOBS, f), 'utf8'));
    if (job.state === 'running') { job.state = 'queued'; writeJob(job); }
  }
  for (;;) {
    const queued = fs.readdirSync(JOBS).filter((x) => x.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, f), 'utf8')); } catch { return null; } })
      .filter((j) => j?.state === 'queued').sort((a, b) => a.created.localeCompare(b.created));
    if (queued.length) await work(queued[0]); else await sleep(3000);
  }
}
