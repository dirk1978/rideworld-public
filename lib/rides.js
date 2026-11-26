// My rides: every ride a rider finishes (or leaves after a minute or more) is kept with its stats and FIT file, so
// it can be downloaded again or uploaded to Strava later. data/rides/<username>/index.json (newest first) plus
// <id>.fit beside it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data', 'rides');
const KEEP = 1000;
const dirOf = (u) => path.join(ROOT, u.replace(/[^a-z0-9_.-]/gi, '_'));
const load = (u) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(u), 'index.json'), 'utf8')); } catch { return []; } };
function save(u, list) {
  const d = dirOf(u);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(d, 'index.json.tmp'), JSON.stringify(list), { mode: 0o600 });
  fs.renameSync(path.join(d, 'index.json.tmp'), path.join(d, 'index.json'));
}
const n = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

function list(user) { return load(user.username); }

function add(user, body) {
  const fit = Buffer.from(String(body.fit || ''), 'base64');
  if (fit.length < 20 || fit.length > 9 * 1024 * 1024 || fit.toString('latin1', 8, 12) !== '.FIT') return { error: 'That is not a FIT file.' };
  const s = body.summary || {};
  const ride = {
    id: crypto.randomBytes(5).toString('hex'), date: new Date().toISOString(),
    name: String(s.name || 'Ride').replace(/[<>]/g, '').slice(0, 80), routeId: /^[a-z0-9-]{1,64}$/.test(s.routeId || '') ? s.routeId : null,
    time: n(s.time, 0, 86400), distance: n(s.distance, 0, 1e6), climbing: n(s.climbing, 0, 1e5), avgPower: n(s.avgPower, 0, 3000),
    maxPower: n(s.maxPower, 0, 5000), avgHr: n(s.avgHr, 0, 250), avgCadence: n(s.avgCadence, 0, 250), avgSpeed: n(s.avgSpeed, 0, 40),
    ftp: n(s.ftp, 0, 2000), // (the FTP it was ridden at: the coach's TSS)
    sim: !!s.sim, finished: !!s.finished, workout: s.workout ? String(s.workout).slice(0, 60) : null, strava: null,
  };
  const l = load(user.username);
  l.unshift(ride);
  for (const old of l.splice(KEEP)) fs.rmSync(path.join(dirOf(user.username), old.id + '.fit'), { force: true });
  fs.mkdirSync(dirOf(user.username), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dirOf(user.username), ride.id + '.fit'), fit, { mode: 0o600 });
  save(user.username, l);
  return { ride };
}

const get = (user, id) => load(user.username).find((r) => r.id === id) || null;
const fitPath = (user, id) => (/^[a-f0-9]{10}$/.test(id) && get(user, id) ? path.join(dirOf(user.username), id + '.fit') : null);

function setStrava(user, id, strava) {
  const l = load(user.username), r = l.find((x) => x.id === id);
  if (!r) return;
  r.strava = strava;
  save(user.username, l);
}

function remove(user, id) {
  const l = load(user.username), r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such ride.', status: 404 };
  save(user.username, l.filter((x) => x.id !== id));
  fs.rmSync(path.join(dirOf(user.username), id + '.fit'), { force: true });
  fs.rmSync(path.join(dirOf(user.username), id + '.log.csv'), { force: true });
  for (let n = 1; n <= (r.shots || 0); n++) fs.rmSync(path.join(dirOf(user.username), `${id}-${n}.jpg`), { force: true });
  if (r.share) { const sh = loadShares(); delete sh[r.share]; saveShares(sh); }
  return {};
}

// The ride log (2026-11-03): one row a second of what the trainer reported and what it was sent (main.js / rides.js
// rideLogCsv), kept as <id>.log.csv so the trainer's response can be checked after the ride (the owner: small gradients
// feeling too strong on his Kickr).
function addLog(user, id, csv) {
  if (!get(user, id)) return { error: 'No such ride.', status: 404 };
  const t = String(csv || '');
  if (!t.startsWith('time_s,') || t.length > 5 * 1024 * 1024) return { error: 'That is not a ride log.' };
  fs.writeFileSync(path.join(dirOf(user.username), id + '.log.csv'), t, { mode: 0o600 });
  return {};
}

// ---------- photos: a few screenshots taken during the ride, on a share page anyone with the link can open ----------
// (Strava's API can't add photos to an activity; the owner adds them by hand, so nothing links here from Strava.)
const SHARES = path.join(ROOT, 'shares.json'); // token -> { user, id }
const loadShares = () => { try { return JSON.parse(fs.readFileSync(SHARES, 'utf8')); } catch { return {}; } };
function saveShares(s) {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SHARES + '.tmp', JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(SHARES + '.tmp', SHARES);
}
const MAX_SHOTS = 8;

function addShot(user, id, b64) {
  const l = load(user.username), r = l.find((x) => x.id === id);
  if (!r) return { error: 'No such ride.', status: 404 };
  const img = Buffer.from(String(b64 || ''), 'base64');
  if (img.length < 100 || img.length > 4 * 1024 * 1024 || img[0] !== 0xff || img[1] !== 0xd8) return { error: 'That is not a JPEG (up to 4 MB).' };
  if ((r.shots || 0) >= MAX_SHOTS) return { error: `Up to ${MAX_SHOTS} photos per ride.` };
  r.shots = (r.shots || 0) + 1;
  fs.writeFileSync(path.join(dirOf(user.username), `${id}-${r.shots}.jpg`), img, { mode: 0o600 });
  if (!r.share) {
    r.share = crypto.randomBytes(12).toString('hex');
    const sh = loadShares(); sh[r.share] = { user: user.username, id }; saveShares(sh);
  }
  save(user.username, l);
  return { shots: r.shots, share: r.share };
}

// what a share link shows: { ride, photo(n) -> file path }
function shared(token) {
  if (!/^[a-f0-9]{24}$/.test(token)) return null;
  const s = loadShares()[token];
  if (!s) return null;
  const r = load(s.user).find((x) => x.id === s.id);
  if (!r) return null;
  return { ride: r, photo: (n) => (n >= 1 && n <= (r.shots || 0) ? path.join(dirOf(s.user), `${r.id}-${n}.jpg`) : null) };
}

// a rider's own ride's photo n (file path), or null
function photoPath(user, id, n) {
  const r = get(user, id);
  return r && n >= 1 && n <= (r.shots || 0) ? path.join(dirOf(user.username), `${id}-${n}.jpg`) : null;
}

module.exports = { addLog, list, add, get, fitPath, setStrava, remove, addShot, shared, photoPath };
