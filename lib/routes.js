// Suggested routes: GPX files in data/routes/ plus a list in data/routes.json.
// On first start the list is seeded with the routes in seed-routes/.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const DIR = path.join(DATA, 'routes');
const LIST = path.join(DATA, 'routes.json');
const SEED = path.join(__dirname, '..', 'seed-routes');
const MAX_BYTES = 8 * 1024 * 1024;

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Distance and climbing, worked out on the server so the list is trustworthy
// A ride recorded on a head unit or phone (a time on nearly every point, moving forward over at least a minute, with
// heights) rather than a route drawn on a map (no times, or one time stamped on every point). Recorded heights are
// trusted for the trainer (the owner 2026-10-21): a barometric altimeter beats both a map's terrain model and Google's
// 3D; drawn routes take their heights from a coarse terrain model and stay on the blend with Google's 3D.
function recorded(gpx) {
  const re = /<trkpt\b[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m, n = 0, timed = 0, ele = 0, forward = 0, prev = null, first = null, last = null;
  while ((m = re.exec(gpx))) {
    n++;
    if (/<ele>\s*-?[\d.]+/.test(m[1])) ele++;
    const t = Date.parse((m[1].match(/<time>([^<]+)<\/time>/) || [])[1]);
    if (!Number.isFinite(t)) continue;
    timed++;
    if (prev !== null && t > prev) forward++;
    if (first === null) first = t;
    prev = t; last = t;
  }
  return n >= 50 && timed >= 0.9 * n && ele >= 0.9 * n && forward >= 0.5 * n && last - first >= 60000;
}

function summarise(gpx) {
  const pts = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = re.exec(gpx))) {
    const lat = parseFloat((m[2].match(/lat="([^"]+)"/) || [])[1]);
    const lon = parseFloat((m[2].match(/lon="([^"]+)"/) || [])[1]);
    const ele = parseFloat(((m[4] || '').match(/<ele>([^<]+)<\/ele>/) || [])[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon, ele });
  }
  if (pts.length < 2) return null;
  let km = 0, gain = 0, smooth = null;
  for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1], pts[i]) / 1000;
  for (const p of pts) {
    if (!Number.isFinite(p.ele)) continue;
    if (smooth === null) { smooth = p.ele; continue; }
    const next = smooth + (p.ele - smooth) * 0.3; // light smoothing so GPS noise doesn't count as climbing
    if (next > smooth) gain += next - smooth;
    smooth = next;
  }
  const name = (gpx.match(/<name>([^<]{1,100})<\/name>/) || [])[1];
  return { km: +km.toFixed(1), gain: Math.round(gain), points: pts.length, start: pts[0], name, profile: profile(pts), shape: shapeOf(pts) };
}

// The route's outline for the thumbnail on its card: 100 points evenly spaced along the track, [lat, lon] to ~1 m
function shapeOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const L = cum[cum.length - 1], out = [];
  if (!(L > 0)) return null;
  for (let k = 0, i = 0; k < 100; k++) {
    const d = (L * k) / 99;
    while (i < pts.length - 2 && cum[i + 1] < d) i++;
    const t = Math.max(0, Math.min(1, (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1)));
    out.push([+(pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t).toFixed(5), +(pts[i].lon + (pts[i + 1].lon - pts[i].lon) * t).toFixed(5)]);
  }
  return out;
}

// Gradient (%) of every 100 m, for the route cards' time estimate (null without elevation). Heights are read off
// every 100 m along the track and smoothed over +-100 m, like the ride's own elevation smoothing.
const STEP = 100;
function profile(pts) {
  const withEle = pts.filter((p) => Number.isFinite(p.ele));
  if (withEle.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < withEle.length; i++) cum.push(cum[i - 1] + haversine(withEle[i - 1], withEle[i]));
  const L = cum[cum.length - 1], ele = [];
  for (let d = 0, i = 0; d <= L + STEP - 1e-6; d += STEP) {
    const x = Math.min(d, L);
    while (i < cum.length - 2 && cum[i + 1] < x) i++;
    const f = cum[i + 1] > cum[i] ? (x - cum[i]) / (cum[i + 1] - cum[i]) : 0;
    ele.push(withEle[i].ele + (withEle[i + 1].ele - withEle[i].ele) * Math.max(0, Math.min(1, f)));
  }
  const sm = ele.map((_, i) => (ele[Math.max(0, i - 1)] + ele[i] + ele[Math.min(ele.length - 1, i + 1)]) / 3);
  const grade = [];
  for (let i = 0; i < sm.length - 1; i++) grade.push(+Math.max(-35, Math.min(35, (sm[i + 1] - sm[i]) / STEP * 100)).toFixed(1));
  return { step: STEP, grade };
}

// Routes saved before profiles (gradients for the time estimate) or shapes (card thumbnail) existed get them at start-up
function addProfiles() {
  const l = readList();
  if (!l) return;
  let changed = false;
  for (const r of l) {
    if (r.profile !== undefined && r.shape !== undefined) continue;
    try { const s = summarise(fs.readFileSync(path.join(DIR, r.id + '.gpx'), 'utf8')); r.profile = s?.profile ?? null; r.shape = s?.shape ?? null; changed = true; } catch {}
  }
  if (changed) writeList(l);
}

function readList() {
  try { return JSON.parse(fs.readFileSync(LIST, 'utf8')); } catch { return null; }
}
function writeList(list) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(LIST + '.tmp', JSON.stringify(list, null, 2), { mode: 0o600 }); // (a fresh .tmp each time: was 664 after every write)
  fs.renameSync(LIST + '.tmp', LIST);
}

function seed() {
  if (readList()) return;
  fs.mkdirSync(DIR, { recursive: true });
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(path.join(SEED, 'routes.json'), 'utf8')); } catch {}
  const list = [];
  for (const m of meta) {
    const gpx = fs.readFileSync(path.join(SEED, m.id + '.gpx'), 'utf8');
    fs.writeFileSync(path.join(DIR, m.id + '.gpx'), gpx);
    list.push({ ...m, ...pick(summarise(gpx)), by: 'admin', added: new Date().toISOString() });
  }
  writeList(list);
}
const pick = (s) => (s ? { km: s.km, gain: s.gain, profile: s.profile, shape: s.shape, shape: s.shape } : {});

const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

// Two kinds of route:
//   server: curated RideWorld routes (tuned with corrections); everyone sees them, only admins can change them
//   user:   a person's own uploads; only they (and admins) see them, and they or an admin can delete them
// An admin can promote one of their own user routes to a server route.
const kindOf = (r) => r.kind || 'server';

function list() { return readList() || []; }

function visible(user) {
  return list().filter((r) => kindOf(r) === 'server' || r.by === user.username);
}

function canSee(r, user) { return kindOf(r) === 'server' || r.by === user.username || user.admin; }

function file(id, user) {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return null;
  const r = list().find((x) => x.id === id);
  if (!r || !canSee(r, user)) return null;
  return path.join(DIR, id + '.gpx');
}

function add({ name, where, blurb, gpx, kind }, user) {
  if (typeof gpx !== 'string' || gpx.length > MAX_BYTES) return { error: 'The GPX file is missing or larger than 8 MB.' };
  const s = summarise(gpx);
  if (!s) return { error: "That doesn't look like a GPX route: no track or route points found." };
  name = clean(name || s.name || 'Imported route', 60);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'route';
  const id = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, id + '.gpx'), gpx, { mode: 0o600 });
  const entry = {
    id, name, where: clean(where, 40), blurb: clean(blurb, 300), km: s.km, gain: s.gain, profile: s.profile, shape: s.shape, // (shape: the card's outline straight away)
    kind: kind === 'server' && user.admin ? 'server' : 'user', by: user.username, added: new Date().toISOString(),
    ...(recorded(gpx) ? { trusted: true, trustedAuto: true } : {}),
  };
  const l = list();
  l.push(entry);
  writeList(l);
  return { route: entry };
}

function remove(id, user) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.' };
  if (kindOf(r) === 'server' && !user.admin) return { error: 'RideWorld routes can only be changed by an admin.', status: 403 };
  if (kindOf(r) === 'user' && !user.admin && r.by !== user.username) return { error: 'That route belongs to someone else.', status: 403 };
  writeList(l.filter((x) => x.id !== id));
  fs.rmSync(path.join(DIR, id + '.gpx'), { force: true });
  fs.rmSync(path.join(DIR, id + '.prev.gpx'), { force: true });
  return {};
}

function promote(id, user) {
  if (!user.admin) return { error: 'Admins only.', status: 403 };
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.' };
  r.kind = 'server';
  r.promoted = new Date().toISOString();
  writeList(l);
  return { route: r };
}

// Route editor: replace a route's corrections. RideWorld (server) routes: admins only; user routes: their owner.
function setCorrections(id, user, { adjust, finish, start }) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.', status: 404 };
  const allowed = kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin);
  if (!allowed) return { error: kindOf(r) === 'server' ? 'Only an admin can edit RideWorld routes.' : 'That route belongs to someone else.', status: 403 };
  if (!Array.isArray(adjust) || adjust.length > 300) return { error: 'Corrections must be a list (at most 300).' };
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? +v.toFixed(3) : null);
  const clean = [];
  for (const a of adjust) {
    const from = num(a.from, 0, 1000), to = num(a.to, 0, 1000);
    const right = a.right === undefined ? 0 : num(a.right, -20, 20), up = a.up === undefined ? 0 : num(a.up, -20, 20);
    if (from === null || to === null || to < from || right === null || up === null) return { error: 'A correction has an invalid range or size.' };
    const straight = a.straight === true, level = a.level === true, mine = a.mine === true, hold = a.hold === true, bend = a.bend === true;
    // Route Studio's moves (dx / dy, metres east / north) and smooth bends (public/js/route.js applyBend / applyMove)
    const dx = a.dx === undefined ? 0 : num(a.dx, -60, 60), dy = a.dy === undefined ? 0 : num(a.dy, -60, 60), tension = a.tension === undefined ? null : num(a.tension, 0.3, 1.6);
    if (dx === null || dy === null || (a.tension !== undefined && tension === null)) return { error: 'A correction has an invalid move or tension.' };
    if (!right && !up && !straight && !level && !mine && !hold && !bend && !dx && !dy) continue;
    const c = { from, to };
    if (straight) c.straight = true;
    if ((straight || bend) && a.keepEle === true) c.keepEle = true;
    if (bend) { c.bend = true; if (tension !== null && tension !== 1) c.tension = tension; }
    if (dx) c.dx = dx;
    if (dy) c.dy = dy;
    if (level) c.level = true;
    if (hold) c.hold = true;
    if (mine) c.mine = true;
    if (right) c.right = right;
    if (up) c.up = up;
    if (a.note) c.note = String(a.note).replace(/[<>]/g, '').slice(0, 120);
    clean.push(c);
  }
  r.adjust = clean;
  if (finish === null || finish === undefined || finish === '') delete r.finish;
  else { const f = num(finish, 0.1, 1000); if (f === null) return { error: 'Invalid finish distance.' }; r.finish = f; }
  if (start === null || start === undefined || start === '') delete r.start;
  else {
    const s = num(start, 0.001, 1000);
    if (s === null || (r.finish && s >= r.finish)) return { error: 'Invalid start distance.' };
    r.start = s;
  }
  r.edited = new Date().toISOString();
  r.editedBy = user.username;
  writeList(l);
  return { route: r };
}

// Replace a route's GPX with an edited one (exported with its corrections built in, reworked elsewhere, e.g.
// RideWithGPS). Same id, name and kind; the corrections, start and finish are dropped because the new file already
// has them. The previous file is kept as <id>.prev.gpx in case the new one is worse.
function replaceGpx(id, user, { gpx }) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.', status: 404 };
  const allowed = kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin);
  if (!allowed) return { error: kindOf(r) === 'server' ? 'Only an admin can replace RideWorld routes.' : 'That route belongs to someone else.', status: 403 };
  if (typeof gpx !== 'string' || gpx.length > MAX_BYTES) return { error: 'The GPX file is missing or larger than 8 MB.' };
  const s = summarise(gpx);
  if (!s) return { error: "That doesn't look like a GPX route: no track or route points found." };
  const f = path.join(DIR, id + '.gpx');
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(DIR, id + '.prev.gpx'));
  fs.writeFileSync(f, gpx, { mode: 0o600 });
  r.km = s.km;
  r.gain = s.gain;
  r.profile = s.profile;
  r.shape = s.shape;
  delete r.country; // looked up again with the analysis
  if (r.adjust?.length || r.start || r.finish) r.previousCorrections = { adjust: r.adjust || [], start: r.start, finish: r.finish };
  delete r.adjust; delete r.start; delete r.finish; delete r.structures; delete r.centre; // the new file starts afresh
  r.presmoothed = true; // the browser leaves already-smooth (dense) stretches alone: see cleanPoints()
  // a recorded file is trusted; replacing it with a drawn one drops trust that was set automatically (never a trust an
  // owner or admin ticked by hand)
  if (recorded(gpx)) { if (!r.trusted) { r.trusted = true; r.trustedAuto = true; } }
  else if (r.trustedAuto) { delete r.trusted; delete r.trustedAuto; }
  r.replaced = new Date().toISOString();
  r.replacedBy = user.username;
  writeList(l);
  return { route: r };
}

// Route editor: replace a route's segments (timed stretches with leaderboards). Same permissions as corrections.
// Returns the ids that were removed, so their results can be dropped.
function setSegments(id, user, { segments }) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.', status: 404 };
  const allowed = kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin);
  if (!allowed) return { error: kindOf(r) === 'server' ? 'Only an admin can edit RideWorld routes.' : 'That route belongs to someone else.', status: 403 };
  if (!Array.isArray(segments) || segments.length > 30) return { error: 'Segments must be a list (at most 30).' };
  const out = [];
  for (const s of segments) {
    const from = +s.from, to = +s.to;
    if (!(from >= 0 && to > from + 0.05 && to <= 1000)) return { error: 'A segment needs a start and an end at least 50 m apart.' };
    const sid = /^[a-f0-9]{6}$/.test(s.id || '') ? s.id : crypto.randomBytes(3).toString('hex');
    const kind = ['climb', 'sprint', 'segment'].includes(s.kind) ? s.kind : 'segment';
    out.push({ id: sid, name: clean(s.name, 40) || 'Segment', from: +from.toFixed(3), to: +to.toFixed(3), kind });
  }
  const removed = (r.segments || []).map((s) => s.id).filter((x) => !out.some((s) => s.id === x));
  if (out.length) r.segments = out; else delete r.segments;
  writeList(l);
  return { route: r, removed };
}

// Name, place and description. RideWorld (server) routes: admins only; user routes: their owner.
function setDetails(id, user, { name, where, blurb, banks, camHigh, trusted, scenery, hedges }) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.', status: 404 };
  const allowed = kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin);
  if (!allowed) return { error: kindOf(r) === 'server' ? 'Only an admin can edit RideWorld routes.' : 'That route belongs to someone else.', status: 403 };
  const n = clean(name, 60);
  if (!n) return { error: 'The route needs a name.' };
  Object.assign(r, { name: n, where: clean(where, 40), blurb: clean(blurb, 300), detailsEdited: new Date().toISOString(), detailsEditedBy: user.username });
  // clean road banks: the most they may rise or fall from the road (m); blank = the default (15 m), see cleanroad.js
  if (banks === '' || banks == null) delete r.banks;
  else if (Number.isFinite(+banks) && +banks >= 0 && +banks <= 15) r.banks = Math.round(+banks * 10) / 10;
  else return { error: 'Highest bank must be between 0 and 15 metres (or blank for the usual).' };
  // camera: go high where the road is cluttered (towns, wooded roads); off by default (see camera.js lineBlocked)
  // (on unless switched off, since 2026-10-19: absent = on)
  if (camHigh === true || camHigh === '1') r.camHigh = true;
  else if (camHigh === false || camHigh === '0') r.camHigh = false;
  // the file's heights are reliable (a ride recorded on a GPS head unit's barometric altimeter): gradients come from
  // the file and the 3D is kept within 10 m of it (survey.js)
  if (trusted === true || trusted === '1') { r.trusted = true; delete r.trustedAuto; }
  else if (trusted === false || trusted === '0') { delete r.trusted; delete r.trustedAuto; }
  // scenery (2026-11-14, the owner: Google's 3D is too messy for towns, keep it for open mountain roads): 'generated' =
  // always the generated world (Lite), 'photo' = Google's photo-real 3D where the computer can; absent = the rider's own
  // Scenery type setting (public/js/app/scenery.js wantLite)
  if (scenery === 'generated' || scenery === 'photo') r.scenery = scenery;
  else if (scenery === '' || scenery === 'auto') delete r.scenery;
  // LIDAR hedgerows in the generated world (2026-11-15, the owner: "they don't blend very well"): off unless ticked
  if (hedges === true || hedges === '1') r.hedges = true;
  else if (hedges === false || hedges === '0') delete r.hedges;
  writeList(l);
  return { route: r };
}

// Road centring from the route editor's "Find the road" (public/js/app/roadfinder.js): how far to slide the route east
// and north (dx, dy metres) every `step` m along the cleaned route. Same permissions as corrections. dx: null clears.
function setCentre(id, user, { step, dx, dy }) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.', status: 404 };
  const allowed = kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin);
  if (!allowed) return { error: kindOf(r) === 'server' ? 'Only an admin can edit RideWorld routes.' : 'That route belongs to someone else.', status: 403 };
  if (dx === null) { delete r.centre; writeList(l); return { route: r }; }
  const okList = (a) => Array.isArray(a) && a.length <= 40000 && a.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 25);
  if (!(step >= 5 && step <= 50) || !okList(dx) || !okList(dy) || dx.length !== dy.length) return { error: 'Bad centring data.' };
  r.centre = { step, dx: dx.map((v) => +v.toFixed(2)), dy: dy.map((v) => +v.toFixed(2)), at: new Date().toISOString(), by: user.username };
  writeList(l);
  return { route: r };
}

// The route analyser's findings (lib/structures.js), or why it couldn't run
// The country the route starts in (lib/country.js), for the flag on its card
function setCountry(id, cc) {
  const l = list(), r = l.find((x) => x.id === id);
  if (!r) return;
  if (cc) r.country = cc; else delete r.country;
  writeList(l);
}

// road and place names along the route (lib/names.js)
function setNames(id, names) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return;
  r.names = names;
  writeList(l);
}

function setStructures(id, structures) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return;
  r.structures = structures;
  writeList(l);
}

// A finished route-pipeline job (lib/pipeline.js, tools/pipeline/worker.mjs) applied to the route: new heights (the
// file as uploaded kept once as <id>.orig.gpx; the line is the same, so corrections and shots stay valid), trusted,
// Google's road offset, underpasses (replacing the pipeline's earlier ones), climbs as segments (only while the route
// has no segments of its own), rock walls (only if it has none), and what was done, for the card.
function applyPipeline(id, result, gpx, info) {
  const l = list();
  const r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such route.' };
  if (gpx) {
    const f = path.join(DIR, id + '.gpx'), orig = path.join(DIR, id + '.orig.gpx');
    if (fs.existsSync(f) && !fs.existsSync(orig)) fs.copyFileSync(f, orig);
    fs.writeFileSync(f, gpx, { mode: 0o600 });
    const s = summarise(gpx);
    if (s) { r.km = s.km; r.gain = s.gain; r.profile = s.profile; r.shape = s.shape; }
  }
  if (result.trusted) r.trusted = true;
  if (Number.isFinite(result.googleOffset)) r.googleOffset = result.googleOffset;
  if (Number.isFinite(result.banks) && r.banks == null) r.banks = result.banks;
  if (result.sideWalls && !(r.sideWalls || []).length) r.sideWalls = result.sideWalls;
  if (r.structures?.list && result.underpasses) r.structures.list = [...r.structures.list.filter((s) => s.hand !== 'pipeline'), ...result.underpasses].sort((a, b) => a.km - b.km);
  const own = (r.segments || []).filter((s) => !s.auto);
  if (!own.length && result.climbs) {
    r.segments = result.climbs.slice(0, 30).map((c) => ({ id: crypto.createHash('sha1').update(`${id}:${c.from}:${c.to}`).digest('hex').slice(0, 6), ...c, auto: true }));
  }
  r.processed = { at: info.at, heightSource: result.heightSource || null, drift: result.drift || null, hairpins: result.hairpins || 0, summary: info.summary || [], attention: info.attention || [] };
  writeList(l);
  return { route: r };
}

module.exports = { applyPipeline, setNames, seed, addProfiles, setCountry, list, visible, file, add, remove, promote, setCorrections, setSegments, setDetails, setStructures, setCentre, replaceGpx, kindOf, recorded, MAX_BYTES };
