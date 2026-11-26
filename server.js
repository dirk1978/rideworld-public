#!/usr/bin/env node
// Serves RideWorld over HTTPS. HTTPS matters: Chrome only allows WebUSB (the ANT+ stick) on secure pages.
// No dependencies. Everything except the sign-in page needs an account (lib/accounts.js); suggested routes
// live in data/ (lib/routes.js). Publicly it sits behind Nginx Proxy Manager at rideworld.example.org.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const accounts = require('./lib/accounts');
const routes = require('./lib/routes');
const strava = require('./lib/strava');
const ws = require('./lib/ws');
const multiplayer = require('./lib/multiplayer');
const ghosts = require('./lib/ghosts');
const segments = require('./lib/segments');
const workouts = require('./lib/workouts');
const rides = require('./lib/rides');
const coach = require('./lib/coach');
const plans = require('./lib/plans');
const reports = require('./lib/reports');
const pipeline = require('./lib/pipeline');
setInterval(() => pipeline.applyFinished(), 3000); // finished route-pipeline jobs onto their routes
const { zip } = require('./lib/zip');
const interest = require('./lib/interest');
const mail = require('./lib/mail');
const structures = require('./lib/structures');
const names = require('./lib/names');
const country = require('./lib/country');
const world = require('./lib/world');
const dtm = require('./lib/dtm');
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); // (emails)
const musicInfo = new Map(); // canonical YouTube link -> { title, thumb, list } (setup screen's music picker)
const WORLD_GZ = new Map(); // world file -> { key: file + mtime, buf: gzipped, wait: [callbacks] } (api/world)
const rcShots = new Map(); // username -> [{ id, img }] (phone remote screenshots, for the phone to show)
// Every photo (the phone remote's and the ride's own) is also kept on the 4TB share as it's taken, a folder per day
// and route: <your files folder> <route>\. The remote's were only held in memory and
// the owner lost most of his Cap photos (2026-10-19). Skipped if the disk isn't mounted.
const PHOTO_DIR = '<your photos folder>';
const clips = new Map(); // ride clips being uploaded: id -> { user, route, bytes, at } (see /api/clips)
setInterval(() => { for (const [id, c] of clips) if (Date.now() - c.at > 6 * 3600 * 1000) clips.delete(id); }, 3600 * 1000).unref();
function keepPhoto(user, route, img, kind) {
  try {
    if (!fs.existsSync(path.dirname(PHOTO_DIR))) return;
    const now = new Date(), name = String(route || 'Ride').replace(/[^\w\- ']+/g, '').trim().slice(0, 60) || 'Ride';
    const dir = path.join(PHOTO_DIR, user.username, `${now.toISOString().slice(0, 10)} ${name}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${now.toISOString().slice(11, 23).replace(/[:.]/g, '-')} ${kind}.jpg`), img);
  } catch (e) { console.error('photo copy', e.message); }
}

const PORT = +(process.env.PORT || 8443);
const ROOT = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, 'certs');
const KEY = path.join(CERT_DIR, 'key.pem');
const CRT = path.join(CERT_DIR, 'cert.pem');
const GLOBAL = path.join(__dirname, 'data', 'settings.json'); // Google key / ion token, set by an admin

const lanIps = Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

if (!fs.existsSync(KEY) || !fs.existsSync(CRT)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const san = ['DNS:localhost', `DNS:${os.hostname()}`, 'IP:127.0.0.1', ...lanIps.map((ip) => `IP:${ip}`)].join(',');
  console.log('Creating self-signed certificate for', san);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-keyout', KEY, '-out', CRT, '-subj', '/CN=RideWorld', '-addext', `subjectAltName=${san}`,
  ], { stdio: 'inherit' });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gpx': 'application/gpx+xml', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json',
};
// Reachable without signing in
// (the icons and app manifest too: browsers and phones fetch them without the session cookie)
const PUBLIC_FILES = new Set(['/login.html', '/css/style.css', '/js/login.js', '/img/hero.jpg', '/favicon.ico', '/img/icon.svg',
  '/img/icon-180.png', '/img/icon-192.png', '/img/icon-512.png', '/img/apple-touch-icon.png', '/manifest.webmanifest', '/requirements.html',
  // the typefaces (the sign-in page uses them too)
  ...fs.readdirSync(path.join(__dirname, 'public', 'fonts')).map((f) => '/fonts/' + f)]);
const GLOBAL_KEYS = ['google', 'ion'];
const USER_KEYS = ['rider', 'bike', 'cda', 'diff', 'jersey', 'shorts', 'frame', 'helmet', 'design', 'socks', 'shoes', 'bikestyle', 'skin', 'beard', 'beardcol', 'units', 'ftp', 'maxhr', 'music', 'bots', 'autoStrava', 'coach', 'coachFtp', 'sex', 'born', 'coachSkip', 'goal', 'vo2watch'];
const COOKIE = 'rw_session';

routes.seed();
routes.addProfiles();
setTimeout(() => addCountries(), 3000);

// ---------- helpers ----------
const readGlobal = () => { try { return JSON.parse(fs.readFileSync(GLOBAL, 'utf8')); } catch { return {}; } };
function writeGlobal(obj) {
  fs.mkdirSync(path.dirname(GLOBAL), { recursive: true });
  fs.writeFileSync(GLOBAL + '.tmp', JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(GLOBAL + '.tmp', GLOBAL);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Behind the proxy the real address is in X-Real-IP; only trust it from the proxy's docker network
function clientIp(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip.startsWith('172.19.') && req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  return ip;
}

const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('JSON only'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

// Changes must come from our own pages (cookies are SameSite=Lax too; this is belt and braces)
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const sessionCookie = (token, maxAgeDays) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(maxAgeDays * 86400)}`;

// Stream a file that should exist (a route's GPX, a ride's FIT or photo). If it can't be read, answer 404 (or end the
// response if the headers have gone): an unhandled stream error used to crash the whole server (2026-10-20, a route
// listed in routes.json without its .gpx file)
function sendStream(res, f, head) {
  const st = fs.createReadStream(f);
  st.on('error', () => { if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); else res.destroy(); });
  st.on('open', () => { res.writeHead(200, head); st.pipe(res); });
}

function serveFile(res, p, req) {
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    const head = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Accept-Ranges': 'bytes',
    };
    // byte ranges, so the explainer video can be scrubbed
    const r = /^bytes=(\d*)-(\d*)$/.exec(req?.headers.range || '');
    if (r && (r[1] || r[2])) {
      let a = r[1] ? +r[1] : data.length - +r[2], b = r[1] && r[2] ? Math.min(+r[2], data.length - 1) : data.length - 1;
      a = Math.max(0, a);
      if (a > b) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end(); return; }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${data.length}` });
      res.end(data.subarray(a, b + 1)); return;
    }
    res.writeHead(200, head);
    res.end(data);
  });
}

// ---------- server status (admin page /status) ----------
const lastSeen = new Map(); // username -> last request (since this start; before that: the session's sliding expiry)
const STARTED = Date.now();
function lastActive(username) {
  if (lastSeen.has(username)) return lastSeen.get(username);
  // sessions slide their expiry forward (at most once a day) when used: expiry - SESSION_DAYS ~ last use, to a day
  const s = accounts.sessionsOf(username);
  const t = Math.max(0, ...s.map((x) => x.expires - accounts.SESSION_DAYS * 864e5));
  return t || null;
}
function diskFree(dir) {
  try { const s = fs.statfsSync(dir); return { freeGB: +((s.bavail * s.bsize) / 1e9).toFixed(1), totalGB: +((s.blocks * s.bsize) / 1e9).toFixed(1) }; } catch { return null; }
}
function serverStatus() {
  const now = Date.now(), week = now - 7 * 864e5, live = multiplayer.live();
  const routeList = routes.list();
  const people = accounts.users().map((u) => {
    const rs = rides.list(u);
    return {
      username: u.username, name: u.name || u.username, admin: !!u.admin, created: u.created || null, lastActive: lastActive(u.username),
      rides: rs.length, ridesWeek: rs.filter((r) => Date.parse(r.date) > week).length,
      km: +(rs.reduce((a, r) => a + (r.distance || 0), 0) / 1000).toFixed(1), hours: +(rs.reduce((a, r) => a + (r.time || 0), 0) / 3600).toFixed(1),
      lastRide: rs.length ? rs.reduce((a, r) => (r.date > a.date ? r : a)).date : null,
      routes: routeList.filter((r) => r.by === u.username).length,
    };
  });
  const allRides = accounts.users().flatMap((u) => rides.list(u).map((r) => ({ ...r, user: u.username })));
  const recent = allRides.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10)
    .map((r) => ({ user: r.user, name: r.name, date: r.date, km: +((r.distance || 0) / 1000).toFixed(1), time: r.time, avgPower: r.avgPower || null, strava: !!r.strava?.url }));
  let backup = null;
  try { backup = fs.readFileSync('/var/lib/drive-backup/last-status', 'utf8').trim(); } catch {}
  return {
    now, live, people, recent,
    totals: {
      accounts: people.length, rides: allRides.length, ridesWeek: allRides.filter((r) => Date.parse(r.date) > week).length,
      km: +(allRides.reduce((a, r) => a + (r.distance || 0), 0) / 1000).toFixed(1), hours: +(allRides.reduce((a, r) => a + (r.time || 0), 0) / 3600).toFixed(1),
      routes: routeList.length, rideworldRoutes: routeList.filter((r) => routes.kindOf(r) === 'server').length,
      groups: multiplayer.listGroups().length, interest: interest.list().length,
    },
    server: {
      started: STARTED, uptimeS: Math.round(process.uptime()), node: process.version, rssMB: Math.round(process.memoryUsage().rss / 1e6),
      load: os.loadavg().map((x) => +x.toFixed(2)), cpus: os.cpus().length,
      memFreeGB: +(os.freemem() / 1e9).toFixed(1), memTotalGB: +(os.totalmem() / 1e9).toFixed(1), hostUptimeS: Math.round(os.uptime()),
      disk: diskFree(path.join(__dirname, 'data')), disk4TB: diskFree((process.env.FILES_DISK || '/')), driveBackup: backup,
    },
  };
}

// ---------- approving registrations ----------
// a password that's easy to read and type: three groups of four from letters and digits nobody confuses (no l/1, o/0)
function newPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', b = crypto.randomBytes(12);
  return [0, 4, 8].map((i) => Array.from(b.subarray(i, i + 4), (n) => abc[n % abc.length]).join('')).join('-');
}
// a username from their name (simon.ellison), else their email's first part; a number added if it's taken
function usernameFor(x) {
  const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 28);
  let base = clean(x.name);
  if (base.length < 2) base = clean(String(x.email).split('@')[0]);
  if (base.length < 2) base = 'rider';
  let name = base;
  for (let n = 2; accounts.findUser(name); n++) name = `${base}${n}`;
  return name;
}

// Route analyser (lib/structures.js): bridges over / tunnels on the route, stored with it. Never throws.
async function analyseRoute(id) {
  const f = path.join(__dirname, 'data', 'routes', id + '.gpx');
  let st;
  try { st = await structures.analyse(fs.readFileSync(f, 'utf8')); }
  catch (e) { st = { at: new Date().toISOString(), error: e.message }; console.error('route analyser', id, e.message); }
  routes.setStructures(id, st);
  world.get(id, f); // the generated world's map data, in the background (lib/world.js)
  await analyseNames(id);
  // and the country it starts in, for the flag on its card
  const r = routes.list().find((x) => x.id === id);
  if (r && r.shape?.length) routes.setCountry(id, await country.countryOf(r.shape[0][0], r.shape[0][1]));
  return st;
}
// the road and place names along it (lib/names.js), shown as the rider reaches them
async function analyseNames(id) {
  const f = path.join(__dirname, 'data', 'routes', id + '.gpx');
  let nm;
  try { nm = await names.analyse(fs.readFileSync(f, 'utf8')); }
  catch (e) { nm = { at: new Date().toISOString(), error: e.message, tries: (routes.list().find((x) => x.id === id)?.names?.tries || 0) + 1 }; console.error('names', id, e.message); }
  routes.setNames(id, nm);
  return nm;
}
// Analyses that failed (OpenStreetMap busy) are tried again: a few minutes after start-up, then hourly, up to 6 times
async function retryAnalyses() {
  for (const r of routes.list().filter((x) => x.structures?.error && (x.structures.tries || 0) < 6)) {
    const tries = (r.structures.tries || 0) + 1;
    const st = await analyseRoute(r.id);
    if (st.error) routes.setStructures(r.id, { ...st, tries });
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  // names: routes without them (made before 2026-10-27, or the lookup failed), one at a time
  for (const r of routes.list().filter((x) => !x.names || (x.names.error && (x.names.tries || 0) < 6))) {
    await analyseNames(r.id);
    await new Promise((ok) => setTimeout(ok, 5000));
  }
}
setTimeout(() => retryAnalyses(), 5 * 60 * 1000);
setInterval(() => retryAnalyses(), 60 * 60 * 1000);
// at start-up: flags for routes saved before countries were looked up, one a second (Nominatim's usage policy)
async function addCountries() {
  for (const r of routes.list().filter((x) => !x.country && x.shape?.length)) {
    routes.setCountry(r.id, await country.countryOf(r.shape[0][0], r.shape[0][1]));
    await new Promise((ok) => setTimeout(ok, 1200));
  }
}

// ---------- API ----------
async function api(req, res, p, user) {
  const m = req.method;

  if (p === '/api/login' && m === 'POST') {
    const body = await readBody(req, 4096);
    const ip = clientIp(req), name = String(body.username || '').toLowerCase();
    // per address, and per address+username, so nobody can lock someone else out by guessing at their username
    const keys = ['ip:' + ip, 'ipuser:' + ip + ':' + name];
    if (accounts.tooManyAttempts(keys)) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const u = accounts.findLogin(name); // username, email or name
    if (!u || !accounts.checkPassword(u, String(body.password || ''))) {
      accounts.noteFailure(keys);
      return json(res, 401, { error: 'Wrong username or password.' });
    }
    const token = accounts.newSession(u.username);
    return json(res, 200, { user: accounts.publicUser(u) }, { 'Set-Cookie': sessionCookie(token, accounts.SESSION_DAYS) });
  }

  // Forgotten password (sign-in page, no account needed): a link by email, valid 1 hour. The answer is the same
  // whether or not the account exists. An account with no email address (made by hand) borrows the one from its
  // registration of interest; failing that, the admin is told so they can help.
  if (p === '/api/forgot' && m === 'POST') {
    const body = await readBody(req, 4096), ip = clientIp(req);
    if (accounts.tooManyAttempts(['forgot:' + ip])) return json(res, 429, { error: 'Too many requests. Try again later.' });
    accounts.noteFailure(['forgot:' + ip]); // counts every request (8 per 15 min per address)
    const u = accounts.findLogin(body.who);
    const ok = { message: 'If that account has an email address, a reset link is on its way. It works for an hour.' };
    if (!u) return json(res, 200, ok);
    let to = u.email;
    if (!to) {
      const x = interest.list().find((r) => String(r.name || '').trim().toLowerCase() === String(u.name || '').trim().toLowerCase() || r.approved?.username === u.username);
      if (x?.email) { to = x.email; accounts.setEmail(u.username, to); }
    }
    const link = `${strava.PUBLIC_URL}/login.html#reset=${accounts.newResetToken(u.username)}`;
    try {
      if (to) await mail.send({ to, toName: u.name, subject: 'Reset your RideWorld password',
        text: `Hi ${u.name},\n\nSomeone (hopefully you) asked to reset the password for your RideWorld account (username: ${u.username}).\n\nSet a new one here (the link works for an hour):\n${link}\n\nIf it wasn't you, ignore this email: your password stays as it is.\n\nRideWorld`,
        html: `<p>Hi ${esc(u.name)},</p><p>Someone (hopefully you) asked to reset the password for your RideWorld account (username: <strong>${esc(u.username)}</strong>).</p><p><a href="${esc(link)}">Set a new password</a> (the link works for an hour).</p><p>If it wasn't you, ignore this email: your password stays as it is.</p><p>RideWorld</p>` });
      else await mail.send({ to: mail.status().notify || (process.env.NOTIFY_EMAIL || ''), subject: `RideWorld: ${u.name} asked to reset their password`, text: `${u.name} (${u.username}) asked for a password reset, but the account has no email address. Set a new password for them in Accounts.` });
    } catch (e) { console.error('password reset email', e.message); }
    return json(res, 200, ok);
  }
  if (p === '/api/reset' && m === 'POST') {
    const body = await readBody(req, 4096);
    const r = accounts.useResetToken(String(body.token || ''), String(body.password || ''));
    if (r.error) return json(res, 400, r);
    const token = accounts.newSession(r.user.username);
    return json(res, 200, { user: accounts.publicUser(r.user) }, { 'Set-Cookie': sessionCookie(token, accounts.SESSION_DAYS) });
  }

  // register your interest (sign-in page, no account needed)
  if (p === '/api/interest' && m === 'POST') {
    const r = interest.add(await readBody(req, 4096), clientIp(req));
    if (r.entry) mail.interestArrived(r.entry); // emails the owner (and thanks them) if Brevo is set up; doesn't hold the reply
    return r.error ? json(res, r.status, { error: r.error }) : json(res, 200, { ok: true });
  }

  // Strava sends the rider back here; the OAuth state says who it is (they may be signed in on another address)
  if (p === '/api/strava/callback' && m === 'GET') {
    const q = Object.fromEntries(new URL(req.url, 'https://x').searchParams);
    let r;
    try { r = await strava.callback(q); } catch (e) { r = { error: e.message }; }
    const msg = r.error ? 'error=' + encodeURIComponent(r.error) : 'connected=1';
    res.writeHead(302, { Location: `${strava.PUBLIC_URL}/?strava=1&${msg}`, 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (!user) return json(res, 401, { error: 'Please sign in.' });

  // ----- Strava
  if (p === '/api/strava' && m === 'GET') {
    return json(res, 200, {
      configured: strava.configured(), connected: !!user.strava, athlete: user.strava?.athlete || null,
      ...(user.admin ? { clientId: strava.readConfig().clientId || '' } : {}),
    });
  }
  if (p === '/api/strava/config' && m === 'PUT') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    const b = await readBody(req, 4096);
    const r = strava.saveConfig(b.clientId, b.clientSecret);
    return r.error ? json(res, 400, r) : json(res, 200, { configured: true });
  }
  if (p === '/api/strava/connect' && m === 'GET') {
    if (!strava.configured()) return json(res, 400, { error: 'Strava is not set up yet: an admin needs to add the Strava app details.' });
    res.writeHead(302, { Location: strava.connectUrl(user), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/api/strava/disconnect' && m === 'POST') {
    await strava.disconnect(user);
    return json(res, 200, { connected: false });
  }
  if (p === '/api/strava/upload' && m === 'POST') {
    const b = await readBody(req, 9 * 1024 * 1024);
    const fit = Buffer.from(String(b.fit || ''), 'base64');
    if (fit.length < 20 || fit.toString('latin1', 8, 12) !== '.FIT') return json(res, 400, { error: 'That is not a FIT file.' });
    try { return json(res, 200, await strava.upload(user, { fit, name: b.name, description: b.description, externalId: b.externalId })); }
    catch (e) { return json(res, e.status || 502, { error: e.message }); }
  }

  if (p === '/api/logout' && m === 'POST') {
    accounts.endSession(cookies(req)[COOKIE]);
    return json(res, 200, {}, { 'Set-Cookie': sessionCookie('', 0) });
  }

  // The open-world map editor (public/mapedit.html, 2026-11-17, admins): its edits (data/world/<id>.edits.json, else the
  // repository's tools/openworld/edits/<id>.json), saving them, and rebuilding the world with them in the background
  // (tools/openworld/rebuild.mjs, ~20 s) with its progress
  {
    const me = /^\/api\/mapedits\/([a-z0-9-]{1,60})(\/rebuild)?$/.exec(p);
    if (me) {
      if (!user.admin) return json(res, 403, { error: 'Admins only' });
      const wid = me[1], D = path.join(__dirname, 'data', 'world'), ef = path.join(D, wid + '.edits.json'), sf = path.join(D, wid + '.rebuild.json');
      if (!fs.existsSync(path.join(D, wid + '.json'))) return json(res, 404, { error: 'No such open world' });
      const readJ0 = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
      // a rebuild whose process has gone (killed by a service restart: the owner's sat at "building heights" on 2026-11-17)
      // reads as interrupted, so the editor stops waiting and Rebuild can be pressed again
      const readJ = (f) => {
        const j = readJ0(f);
        if (f === sf && j?.state === 'running' && j.pid) { let alive = true; try { process.kill(j.pid, 0); } catch (e2) { alive = e2.code === 'EPERM'; } if (!alive) { j.state = 'failed'; j.step = 'interrupted (the server restarted): press Rebuild again'; try { fs.writeFileSync(sf, JSON.stringify(j), { mode: 0o600 }); } catch {} } }
        return j;
      };
      if (!me[2] && m === 'GET') return json(res, 200, { edits: readJ(ef) || readJ(path.join(__dirname, 'tools', 'openworld', 'edits', wid + '.json')) || {}, rebuild: readJ(sf) });
      if (!me[2] && m === 'PUT') {
        const b = await readBody(req, 4 * 1024 * 1024), e = b.edits || {};
        const pts = (a) => Array.isArray(a) && a.length >= 1 && a.length <= 5000 && a.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
        const out = {
          _: 'Map editor edits (public/mapedit.html), applied by tools/openworld/build.mjs on top of OpenStreetMap',
          paths: (e.paths || []).filter((x) => pts(x.pts) && x.pts.length >= 2).slice(0, 2000).map((x) => ({ pts: x.pts.map(([a, c]) => [+a.toFixed(6), +c.toFixed(6)]), surf: /^(road|paved|gravel|dirt|grass)$/.test(x.surf) ? x.surf : 'gravel', src: String(x.src || 'editor').slice(0, 80), name: String(x.name || '').slice(0, 60) })),
          remove: (e.remove || []).filter((x) => pts([x.at])).slice(0, 2000).map((x) => ({ at: x.at.map((v) => +v.toFixed(6)), note: String(x.note || '').slice(0, 80) })),
          oneway: (e.oneway || []).filter((x) => pts([x.at]) && (x.mode === 'two' || pts([x.toward]))).slice(0, 2000).map((x) => ({ at: x.at.map((v) => +v.toFixed(6)), mode: x.mode === 'two' ? 'two' : 'one', ...(x.mode === 'two' ? {} : { toward: x.toward.map((v) => +v.toFixed(6)) }) })),
          walls: (e.walls || []).filter((x) => pts(x.pts) && x.pts.length >= 2).slice(0, 2000).map((x) => ({ pts: x.pts.map(([a, c]) => [+a.toFixed(6), +c.toFixed(6)]), t: /^(wall|hedge|fence)$/.test(x.t) ? x.t : 'wall' })),
          shops: (e.shops || []).filter((x) => pts([x.at]) && String(x.name || '').trim()).slice(0, 2000).map((x) => ({ at: x.at.map((v) => +v.toFixed(6)), name: String(x.name).trim().slice(0, 40), cat: /^[a-z_]{2,30}$/.test(x.cat || '') ? x.cat : 'shop' })),
          trees: (e.trees || []).filter((x) => pts([x.at])).slice(0, 5000).map((x) => ({ at: x.at.map((v) => +v.toFixed(6)), r: Math.max(2, Math.min(40, +x.r || 8)) })),
        };
        fs.writeFileSync(ef + '.tmp', JSON.stringify(out, null, 1), { mode: 0o600 }); fs.renameSync(ef + '.tmp', ef);
        return json(res, 200, { ok: true, counts: Object.fromEntries(['paths', 'remove', 'oneway', 'walls', 'shops', 'trees'].map((k) => [k, out[k].length])) });
      }
      if (me[2] && m === 'GET') return json(res, 200, readJ(sf) || { state: 'none' });
      if (me[2] && m === 'POST') {
        const st = readJ(sf);
        if (st?.state === 'running' && Date.now() - Date.parse(st.at) < 15 * 60 * 1000) return json(res, 409, { error: 'A rebuild is already running' });
        fs.writeFileSync(sf, JSON.stringify({ state: 'running', step: 'starting', at: new Date().toISOString(), log: [] }), { mode: 0o600 });
        require('child_process').spawn(process.execPath, [path.join(__dirname, 'tools', 'openworld', 'rebuild.mjs'), wid], { cwd: __dirname, detached: true, stdio: 'ignore' }).unref();
        return json(res, 202, { started: true });
      }
    }
  }

  // The real ground under an open world (lib/dtm.js): n x n Float32 heights (m above Ordnance Datum, NaN = no survey)
  // over ?r=west,south,east,north (degrees), for flatterrain.js's terrain tiles
  {
    const dm = /^\/api\/dtm\/([a-z0-9-]{1,64})$/.exec(p);
    if (dm && m === 'GET') {
      if (!routes.file(dm[1], user)) return json(res, 404, { error: 'No such route' });
      const q = new URL(req.url, 'https://x').searchParams, r = String(q.get('r') || '').split(',').map(Number), N = Math.max(2, Math.min(129, +q.get('n') || 81));
      if (r.length !== 4 || !r.every(Number.isFinite) || r[2] <= r[0] || r[3] <= r[1] || r[2] - r[0] > 1 || r[3] - r[1] > 1) return json(res, 400, { error: 'bad rectangle' });
      const out = dtm.sample(dm[1], r[0], r[1], r[2], r[3], N);
      if (!out) return json(res, 404, { error: 'No ground model' });
      const raw = Buffer.from(out.buffer);
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, max-age=86400' }); return res.end(require('zlib').gzipSync(raw, { level: 4 })); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
      return res.end(raw);
    }
  }

  // The generated world's map data for a route (lib/world.js): 202 { pending } while it's being fetched (a few minutes
  // the first time), then the cached JSON, gzipped when the browser takes it
  {
    const wm = /^\/api\/world\/([a-z0-9-]{1,64})$/.exec(p);
    if (wm && m === 'GET') {
      const gpxFile = routes.file(wm[1], user);
      if (!gpxFile) return json(res, 404, { error: 'No such route' });
      const w = world.get(wm[1], gpxFile);
      if (w.pending) return json(res, 202, { pending: true, error: w.error });
      // (gzipped once per version of the file and kept, off the main thread: London's 38 MB world took a second or two
      // of blocked server per load with gzipSync, stalling every rider's socket; 2026-11-17)
      const st = fs.statSync(w.file), key = w.file + ':' + st.mtimeMs;
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const gz = WORLD_GZ.get(w.file);
        if (gz && gz.key === key && gz.buf) { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' }); return res.end(gz.buf); }
        if (!gz || gz.key !== key) {
          const entry = { key, buf: null, wait: [] }; WORLD_GZ.set(w.file, entry);
          fs.readFile(w.file, (err, raw) => { if (err) { WORLD_GZ.delete(w.file); for (const f of entry.wait) f(null); return; } require('zlib').gzip(raw, { level: 6 }, (e2, buf) => { if (!e2) entry.buf = buf; else WORLD_GZ.delete(w.file); for (const f of entry.wait) f(e2 ? null : buf); entry.wait = []; }); });
        }
        const cur = WORLD_GZ.get(w.file);
        return cur.wait.push((buf) => { if (!buf) return json(res, 500, { error: 'world file unreadable' }); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' }); res.end(buf); });
      }
      const raw = fs.readFileSync(w.file);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      return res.end(raw);
    }
  }
  // Jersey pictures (2026-11-03): a rider's uploaded design or logo (public/js/kit.js). One per rider, data/kit/,
  // shown to every signed-in rider who sees them on the road. The page shrinks it to 1024 px before sending.
  if (p === '/api/kit' && m === 'POST') {
    const b = await readBody(req, 3 * 1024 * 1024);
    const img = Buffer.from(String(b.image || '').replace(/^data:[^,]*,/, ''), 'base64');
    const ext = img.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
      : img[0] === 0xff && img[1] === 0xd8 ? 'jpg' : img.toString('latin1', 0, 4) === 'RIFF' && img.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!ext || img.length < 100) return json(res, 400, { error: 'Upload a PNG, JPEG or WebP picture.' });
    const dir = path.join(__dirname, 'data', 'kit'), who = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of fs.readdirSync(dir)) if (f.startsWith(who + '-')) fs.unlinkSync(path.join(dir, f)); // the old one
    const file = `${who}-${crypto.createHash('sha256').update(img).digest('hex').slice(0, 12)}.${ext}`;
    fs.writeFileSync(path.join(dir, file), img, { mode: 0o600 });
    return json(res, 200, { file });
  }
  if (p.startsWith('/api/kit/') && m === 'GET') {
    const file = p.slice(9);
    if (!/^[a-z0-9_-]{1,40}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(file)) return json(res, 404, { error: 'Not found' });
    let img; try { img = fs.readFileSync(path.join(__dirname, 'data', 'kit', file)); } catch { return json(res, 404, { error: 'Not found' }); }
    res.writeHead(200, { 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[file.split('.').pop()],
      'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    return res.end(img);
  }

  // Ride clips (2026-11-16, the owner: "the ability to record ride videos ... a button in the RC"): the ride page records
  // the 3D view (public/js/app/clips.js) and sends it in pieces of ~2 MB (NPM takes 10 MB a request); kept in
  // data/clips/<user>/ and copied to the 4TB share beside the photos. Only the rider can fetch their clips.
  if (p === '/api/clips' && m === 'POST') {
    const b = await readBody(req, 4096), id = crypto.randomBytes(8).toString('hex');
    clips.set(id, { user: user.username, route: String(b.route || 'Ride').slice(0, 80), bytes: 0, at: Date.now() });
    return json(res, 200, { id });
  }
  if (/^\/api\/clips\/[0-9a-f]{16}\/part$/.test(p) && m === 'POST') {
    const id = p.split('/')[3], c = clips.get(id);
    if (!c || c.user !== user.username) return json(res, 404, { error: 'Not found' });
    const b = await readBody(req, 4 * 1024 * 1024), buf = Buffer.from(String(b.data || ''), 'base64');
    if (c.bytes + buf.length > 300 * 1024 * 1024) return json(res, 413, { error: 'Clip too big' });
    const dir = path.join(__dirname, 'data', 'clips', user.username.replace(/[^\w.-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dir, id + '.webm'), buf, { mode: 0o600 });
    c.bytes += buf.length;
    if (b.last) {
      // browsers only record WebM; Strava (and phones) want MP4 (the owner 2026-11-16): converted here with ffmpeg (H.264,
      // constant 30 fps, fast start), in the background; the MP4 then goes to the 4TB share beside the day's photos
      const now = new Date(), name = c.route.replace(/[^\w\- ']+/g, '').trim().slice(0, 60) || 'Ride';
      const src = path.join(dir, id + '.webm'), mp4 = path.join(dir, id + '.mp4');
      require('child_process').execFile('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr', '-movflags', '+faststart', mp4 + '.tmp.mp4'], { timeout: 15 * 60 * 1000 }, (err, so, se) => {
        if (err) { console.error('clip mp4', id, err.message, String(se).slice(0, 300)); return; }
        try {
          fs.renameSync(mp4 + '.tmp.mp4', mp4); fs.chmodSync(mp4, 0o600);
          if (fs.existsSync(path.dirname(PHOTO_DIR))) {
            const d2 = path.join(PHOTO_DIR, user.username, `${now.toISOString().slice(0, 10)} ${name}`);
            fs.mkdirSync(d2, { recursive: true });
            fs.copyFileSync(mp4, path.join(d2, `${now.toISOString().slice(11, 19).replace(/:/g, '-')} clip.mp4`));
          }
        } catch (e) { console.error('clip copy', e.message); }
      });
      // (the rider's clip list, data/clips/<user>/index.json: 2026-11-21, the owner: "not sure how I can get them afterwards")
      try { const ix = path.join(dir, 'index.json'); let L = []; try { L = JSON.parse(fs.readFileSync(ix, 'utf8')); } catch {} L.unshift({ id, at: new Date().toISOString(), route: c.route, bytes: c.bytes }); fs.writeFileSync(ix, JSON.stringify(L.slice(0, 500)), { mode: 0o600 }); } catch (e) { console.error('clip index', e.message); }
      return json(res, 200, { url: `/api/clips/${id}.mp4`, bytes: c.bytes });
    }
    return json(res, 200, { ok: true });
  }
  // the rider's clips, newest first (index.json, plus any older clip files in the folder from before the index)
  if (p === '/api/clips' && m === 'GET') {
    const dir = path.join(__dirname, 'data', 'clips', user.username.replace(/[^\w.-]/g, '_'));
    let L = []; try { L = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch {}
    let files = []; try { files = fs.readdirSync(dir); } catch {}
    const known = new Set(L.map((x) => x.id));
    for (const f of files) { const mm = /^([0-9a-f]{16})\.webm$/.exec(f); if (mm && !known.has(mm[1])) { const st = fs.statSync(path.join(dir, f)); L.push({ id: mm[1], at: st.mtime.toISOString(), route: 'Ride', bytes: st.size }); } }
    L = L.filter((x) => files.includes(x.id + '.webm') || files.includes(x.id + '.mp4')).sort((a, b) => (a.at < b.at ? 1 : -1));
    return json(res, 200, { clips: L.map((x) => ({ ...x, mp4: files.includes(x.id + '.mp4') })) });
  }
  if (/^\/api\/clips\/[0-9a-f]{16}$/.test(p) && m === 'DELETE') {
    const id = p.slice(11, 27), dir = path.join(__dirname, 'data', 'clips', user.username.replace(/[^\w.-]/g, '_'));
    for (const e of ['webm', 'mp4']) try { fs.unlinkSync(path.join(dir, `${id}.${e}`)); } catch {}
    try { const ix = path.join(dir, 'index.json'); const L = JSON.parse(fs.readFileSync(ix, 'utf8')).filter((x) => x.id !== id); fs.writeFileSync(ix, JSON.stringify(L), { mode: 0o600 }); } catch {}
    return json(res, 200, { ok: true });
  }
  if (/^\/api\/clips\/[0-9a-f]{16}\.(webm|mp4)$/.test(p) && m === 'GET') {
    const id = p.slice(11, 27), ext = p.endsWith('.mp4') ? 'mp4' : 'webm', base = path.join(__dirname, 'data', 'clips', user.username.replace(/[^\w.-]/g, '_'), id);
    const f = base + '.' + ext;
    if (!fs.existsSync(f)) {
      if (ext === 'mp4' && fs.existsSync(base + '.webm')) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '20', 'Cache-Control': 'no-store' }); return res.end('Still converting the clip to MP4: try again in a minute.'); }
      return json(res, 404, { error: 'Not found' });
    }
    // ?play: shown in the page (with byte ranges, so the player can seek); otherwise a download
    const size = fs.statSync(f).size, play = (req.url || '').includes('play'), type = ext === 'mp4' ? 'video/mp4' : 'video/webm';
    const disp = play ? 'inline' : `attachment; filename="rideworld-clip-${id}.${ext}"`, rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg) {
      const a = rg[1] ? +rg[1] : Math.max(0, size - +rg[2]), b = rg[1] && rg[2] ? Math.min(size - 1, +rg[2]) : size - 1;
      if (a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Disposition': disp, 'Cache-Control': 'private', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Disposition': disp, 'Cache-Control': 'private', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(f).pipe(res);
  }

  if (p === '/api/settings') {
    if (m === 'GET') return json(res, 200, { me: accounts.publicUser(user), global: readGlobal(), user: user.settings || {} });
    if (m === 'PUT') {
      const body = await readBody(req, 8192);
      if (body.global && user.admin) {
        const g = readGlobal();
        for (const k of GLOBAL_KEYS) if (typeof body.global[k] === 'string' && body.global[k].length <= 200) g[k] = body.global[k];
        writeGlobal(g);
      }
      if (body.user) accounts.updateSettings(user.username, body.user, USER_KEYS);
      return json(res, 200, { global: readGlobal(), user: user.settings || {} });
    }
  }

  if (p === '/api/password' && m === 'POST') {
    const body = await readBody(req, 4096);
    if (!accounts.checkPassword(user, String(body.current || ''))) return json(res, 403, { error: 'Your current password is wrong.' });
    const r = accounts.setPassword(user.username, body.next);
    if (r.error) return json(res, 400, r);
    const token = accounts.newSession(user.username); // the change signed everyone out; keep this browser in
    return json(res, 200, {}, { 'Set-Cookie': sessionCookie(token, accounts.SESSION_DAYS) });
  }

  // ----- email through Brevo (admin only): settings, and a test message
  if (p === '/api/mail' && (m === 'GET' || m === 'PUT')) {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    if (m === 'GET') return json(res, 200, mail.status());
    const r = mail.configure(await readBody(req, 16384)); // (the welcome notes can run to 3000 characters)
    return r.error ? json(res, 400, r) : json(res, 200, r);
  }
  if (p === '/api/mail/test' && m === 'POST') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    const st = mail.status();
    try {
      await mail.send({ to: st.notify || st.from, subject: 'RideWorld email test', text: 'This is a test from RideWorld. Email through Brevo is working.' });
      return json(res, 200, { ok: true, to: st.notify || st.from });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // ----- people who registered interest (admin only)
  if (p === '/api/interest' && m === 'GET') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    return json(res, 200, { list: interest.list() });
  }
  // Approve: make them an account (username from their name, a generated password) and email them the details with
  // the admin's notes. Again on an approved entry: a new password, sent again. If the email fails the account still
  // stands and the password comes back to the admin to pass on.
  // the welcome email as an approved rider would get it, sent to the admin's notify address with made-up details
  if (p === '/api/mail/welcome-test' && m === 'POST') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    const to = mail.status().notify || mail.status().from;
    try { await mail.welcome({ to, name: 'Example Rider', username: 'example.rider', password: newPassword(), site: strava.PUBLIC_URL }); }
    catch (e) { return json(res, 502, { error: e.message }); }
    return json(res, 200, { to });
  }
  // a browser's error report (main.js), written to the service log with who and what browser
  if (p === '/api/clientlog' && m === 'POST') {
    const b = await readBody(req, 4096).catch(() => ({}));
    console.error(`client error [${user.username}] ${String(b.page || '').slice(0, 60)}: ${String(b.msg || '').slice(0, 500)} @ ${String(b.where || '').slice(0, 500)} | ${String(req.headers['user-agent'] || '').slice(0, 160)}`);
    return json(res, 200, {});
  }
  const ra = p.match(/^\/api\/interest\/([a-f0-9]{12})\/approve$/);
  if (ra && m === 'POST') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    const x = interest.list().find((e) => e.id === ra[1]);
    if (!x) return json(res, 404, { error: 'Not found.' });
    const password = newPassword(), body = await readBody(req, 1024);
    // an account made by hand before Approve existed: the admin picks it (body.existing) and it gets a new password
    let username = x.approved?.username || (body.existing && accounts.findUser(String(body.existing)) ? String(body.existing) : null);
    if (username && accounts.findUser(username)) {
      const r = accounts.setPassword(username, password);
      if (r.error) return json(res, 400, r);
    } else {
      username = usernameFor(x);
      const r = accounts.createUser({ username, name: x.name, password, email: x.email });
      if (r.error) return json(res, 400, r);
    }
    let emailed = true, mailError = null;
    try { await mail.welcome({ to: x.email, name: x.name, username, password, site: strava.PUBLIC_URL }); }
    catch (e) { emailed = false; mailError = e.message; }
    interest.markApproved(x.id, { username, at: new Date().toISOString(), emailed });
    return json(res, 200, { username, emailed, ...(emailed ? {} : { password, mailError }) });
  }
  const ri = p.match(/^\/api\/interest\/([a-f0-9]{12})$/);
  if (ri && m === 'DELETE') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    return interest.remove(ri[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Not found.' });
  }

  // ----- server status (admin only, the /status page): who's on and where, stats, server health
  if (p === '/api/admin/status' && m === 'GET') {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    return json(res, 200, serverStatus());
  }

  // ----- accounts (admin only)
  if (p === '/api/users' || p.startsWith('/api/users/')) {
    if (!user.admin) return json(res, 403, { error: 'Admins only.' });
    if (p === '/api/users' && m === 'GET') {
      return json(res, 200, { users: accounts.users().map((u) => ({ ...accounts.publicUser(u), created: u.created, email: u.email || '' })) });
    }
    if (p === '/api/users' && m === 'POST') {
      const r = accounts.createUser(await readBody(req, 4096));
      return r.error ? json(res, 400, r) : json(res, 200, { user: accounts.publicUser(r.user) });
    }
    const mm = p.match(/^\/api\/users\/([a-z0-9._-]+)(\/password)?$/);
    if (mm && mm[2] && m === 'POST') {
      const r = accounts.setPassword(mm[1], (await readBody(req, 4096)).password);
      return r.error ? json(res, 400, r) : json(res, 200, {});
    }
    if (mm && !mm[2] && m === 'DELETE') {
      if (mm[1] === user.username) return json(res, 400, { error: "You can't remove your own account." });
      const r = accounts.deleteUser(mm[1]);
      return r.error ? json(res, 400, r) : json(res, 200, {});
    }
  }

  // ----- ghosts: your own completed rides on a route (lib/ghosts.js)
  const gh = p.match(/^\/api\/ghosts\/([a-z0-9-]{1,64})(?:\/([a-f0-9]{8}))?$/);
  if (gh) {
    if (!routes.file(gh[1], user)) return json(res, 404, { error: 'No such route.' });
    if (!gh[2] && m === 'GET') return json(res, 200, { ghosts: ghosts.list(user, gh[1]) });
    if (!gh[2] && m === 'POST') {
      const body = await readBody(req, 512 * 1024);
      if (body.sim) return json(res, 400, { error: 'Simulator rides are not kept as ghosts.' });
      const r = ghosts.add(user, gh[1], body);
      return r.error ? json(res, 400, r) : json(res, 200, r);
    }
    if (gh[2] && m === 'GET') {
      const r = ghosts.get(user, gh[1], gh[2]);
      return r ? json(res, 200, { ghost: r }) : json(res, 404, { error: 'No such ghost.' });
    }
    if (gh[2] && m === 'DELETE') {
      const r = ghosts.remove(user, gh[1], gh[2]);
      return r.error ? json(res, r.status || 400, r) : json(res, 200, {});
    }
  }

  // ----- segment leaderboards (lib/segments.js); 'full' = the whole route
  const sg = p.match(/^\/api\/segments\/([a-z0-9-]{1,64})(?:\/([a-f0-9]{6}|full))?$/);
  if (sg) {
    const r = routes.list().find((x) => x.id === sg[1]);
    if (!r || !routes.file(sg[1], user)) return json(res, 404, { error: 'No such route.' });
    if (!sg[2] && m === 'GET') return json(res, 200, { boards: segments.boards(sg[1], user) });
    if (sg[2] && m === 'POST') {
      if (sg[2] !== 'full' && !(r.segments || []).some((s) => s.id === sg[2])) return json(res, 404, { error: 'No such segment.' });
      const out = segments.add(sg[1], sg[2], user, await readBody(req, 256 * 1024));
      return out.error ? json(res, 400, out) : json(res, 200, out);
    }
  }

  // ----- phone remote: screenshots taken on request, held in memory (last 12 per rider) for the phone to show
  if (p === '/api/rc/shot' && m === 'POST') {
    const body = await readBody(req, 6 * 1024 * 1024), img = Buffer.from(String(body.image || ''), 'base64');
    if (img.length < 100 || img[0] !== 0xff || img[1] !== 0xd8) return json(res, 400, { error: 'Not a JPEG.' });
    const list = rcShots.get(user.username) || [];
    const id = crypto.randomBytes(6).toString('hex');
    list.push({ id, img }); while (list.length > 12) list.shift();
    rcShots.set(user.username, list);
    keepPhoto(user, body.route, img, 'remote');
    return json(res, 200, { url: `/api/rc/shot/${id}.jpg` });
  }
  // ----- music: a YouTube link's title and thumbnail for the setup screen's music picker (YouTube's oEmbed; its
  // automatic mixes, "RD..." lists, have none). Cached; only youtube.com is ever asked.
  if (p === '/api/music/info' && m === 'GET') {
    const q = new URL(req.url, 'https://x').searchParams.get('url') || '';
    let u; try { u = new URL(q); } catch { return json(res, 400, { error: 'Not a link.' }); }
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return json(res, 400, { error: 'Not a YouTube link.' });
    const ok = (x) => (x && /^[\w-]{2,64}$/.test(x) ? x : null);
    const list = ok(u.searchParams.get('list')), video = ok(u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v'));
    if (!list && !video) return json(res, 400, { error: 'Not a song or playlist link.' });
    const canon = list ? `https://www.youtube.com/playlist?list=${list}` : `https://www.youtube.com/watch?v=${video}`;
    if (!musicInfo.has(canon)) {
      let info = { title: null, thumb: null, list: !!list };
      try {
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canon)}`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const j = await r.json(); info = { title: String(j.title || '').slice(0, 200) || null, thumb: /^https:\/\/i\.ytimg\.com\//.test(j.thumbnail_url || '') ? j.thumbnail_url : null, list: !!list }; }
      } catch {}
      if (musicInfo.size > 500) musicInfo.clear();
      musicInfo.set(canon, info);
    }
    return json(res, 200, musicInfo.get(canon));
  }

  // ----- problem reports (lib/reports.js): screenshot + where and how, from the ride's ⚑ Report
  if (p === '/api/reports' && m === 'POST') {
    const r = reports.add(user, await readBody(req, 8 * 1024 * 1024));
    return json(res, r.error ? 400 : 200, r);
  }
  const rcs = p.match(/^\/api\/rc\/shot\/([a-f0-9]{12})\.jpg$/);
  if (rcs && m === 'GET') {
    const s = (rcShots.get(user.username) || []).find((x) => x.id === rcs[1]);
    if (!s) return json(res, 404, { error: 'Gone.' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="RideWorld-${rcs[1]}.jpg"` });
    return res.end(s.img);
  }

  // ----- my rides (lib/rides.js): stats + FIT of each ride, re-download, upload to Strava later
  if (p === '/api/rides' && m === 'GET') return json(res, 200, { rides: rides.list(user) });
  // the virtual coach: every kept ride's numbers (power curve, NP, histograms...), worked out once from its FIT
  if (p === '/api/coach' && m === 'GET') return json(res, 200, { rides: await coach.forUser(user) });
  if (p === '/api/rides' && m === 'POST') {
    const body = await readBody(req, 13 * 1024 * 1024);
    if (body.summary?.sim) return json(res, 400, { error: 'Simulator rides are not kept.' });
    const r = rides.add(user, body);
    return r.error ? json(res, 400, r) : json(res, 200, r);
  }
  const rd = p.match(/^\/api\/rides\/([a-f0-9]{10})(\.fit|\/strava)?$/);
  if (rd && rd[2] === '.fit' && m === 'GET') {
    const f = rides.fitPath(user, rd[1]);
    if (!f) return json(res, 404, { error: 'No such ride.' });
    const r = rides.get(user, rd[1]), name = `${(r.name || 'ride').replace(/[^\w-]+/g, '_')}_${r.date.slice(0, 10)}.fit`;
    return sendStream(res, f, { 'Content-Type': 'application/vnd.ant.fit', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  }
  if (rd && rd[2] === '/strava' && m === 'POST') {
    const f = rides.fitPath(user, rd[1]);
    if (!f) return json(res, 404, { error: 'No such ride.' });
    const r = rides.get(user, rd[1]), b = await readBody(req, 16 * 1024);
    if (r.sim) return json(res, 400, { error: 'Simulator rides are not sent to Strava.' });
    try {
      const out = await strava.upload(user, { fit: fs.readFileSync(f), name: `${r.name} (RideWorld)`, description: String(b.description || 'Ridden on RideWorld 🌍🚴').slice(0, 1000), externalId: `rideworld-${user.username}-${r.id}` });
      rides.setStrava(user, r.id, { url: out.url || null, at: new Date().toISOString() });
      return json(res, 200, out);
    } catch (e) { return json(res, e.status || 502, { error: e.message }); }
  }
  // a ride's photos (the owner 2026-10-26: Strava's API can't take photos, so make adding them by hand quick): all of them
  // in one .zip (finish panel, My rides), or one at a time (the phone remote shares them to the phone's gallery / apps)
  const rz = p.match(/^\/api\/rides\/([a-f0-9]{10})\/photos(?:\.zip|\/(\d{1,2})\.jpg)$/);
  if (rz && m === 'GET') {
    const r = rides.get(user, rz[1]);
    if (!r || !r.shots) return json(res, 404, { error: 'No photos for that ride.' });
    const base = `RideWorld ${String(r.name || 'ride').replace(/[^\w\- ']+/g, '').trim().slice(0, 50)} ${String(r.date).slice(0, 10)}`;
    if (rz[2]) {
      const f = rides.photoPath(user, r.id, +rz[2]);
      if (!f) return json(res, 404, { error: 'No such photo.' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${base} ${rz[2]}.jpg"` });
      return res.end(fs.readFileSync(f));
    }
    const files = [];
    for (let n = 1; n <= r.shots; n++) { const f = rides.photoPath(user, r.id, n); if (f && fs.existsSync(f)) files.push({ name: `${base} ${n}.jpg`, data: fs.readFileSync(f), date: new Date(r.date) }); }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${base} photos.zip"` });
    return res.end(zip(files));
  }
  const rl = p.match(/^\/api\/rides\/([a-f0-9]{10})\/log$/);
  if (rl && m === 'POST') { const r = rides.addLog(user, rl[1], (await readBody(req, 6 * 1024 * 1024)).csv); return r.error ? json(res, r.status || 400, r) : json(res, 200, {}); }
  const rs = p.match(/^\/api\/rides\/([a-f0-9]{10})\/shots$/);
  if (rs && m === 'POST') {
    const image = (await readBody(req, 6 * 1024 * 1024)).image, r = rides.addShot(user, rs[1], image);
    if (!r.error) keepPhoto(user, rides.get(user, rs[1])?.name, Buffer.from(String(image), 'base64'), 'auto');
    return r.error ? json(res, r.status || 400, r) : json(res, 200, { ...r, url: `${strava.PUBLIC_URL}/share/${r.share}` });
  }
  if (rd && !rd[2] && m === 'DELETE') {
    const r = rides.remove(user, rd[1]);
    return r.error ? json(res, r.status || 400, r) : json(res, 200, {});
  }

  // ----- workouts imported by this rider (lib/workouts.js)
  if (p === '/api/workouts' && m === 'GET') return json(res, 200, { workouts: workouts.list(user) });
  // the training plan this rider follows (lib/plans.js)
  if (p === '/api/plan' && m === 'GET') return json(res, 200, { plan: plans.get(user) });
  if (p === '/api/plan' && m === 'PUT') { const r = plans.set(user, await readBody(req, 16 * 1024)); return r.error ? json(res, 400, r) : json(res, 200, r); }
  if (p === '/api/workouts' && m === 'POST') {
    const r = workouts.add(user, await readBody(req, 256 * 1024));
    return r.error ? json(res, 400, r) : json(res, 200, r);
  }
  const wk = p.match(/^\/api\/workouts\/([a-f0-9]{8})$/);
  if (wk && m === 'DELETE') {
    const r = workouts.remove(user, wk[1]);
    return r.error ? json(res, r.status || 400, r) : json(res, 200, {});
  }

  // ----- group rides (the live part runs over the /ws WebSocket, see lib/multiplayer.js)
  if (p === '/api/groups' && m === 'GET') return json(res, 200, { groups: multiplayer.listGroups() });
  if (p === '/api/groups' && m === 'POST') {
    const r = multiplayer.createGroup(user, await readBody(req, 4096));
    return r.error ? json(res, 400, r) : json(res, 200, r);
  }
  const gm = p.match(/^\/api\/groups\/([a-f0-9]{8})$/);
  if (gm && m === 'DELETE') {
    const r = multiplayer.deleteGroup(user, gm[1]);
    return r.error ? json(res, r.status || 400, r) : json(res, 200, {});
  }

  // ----- suggested routes
  if (p === '/api/routes' && m === 'GET') {
    return json(res, 200, { routes: routes.visible(user).map((r) => ({ ...r, kind: routes.kindOf(r), processing: pipeline.status(r.id) })) });
  }
  if (p === '/api/routes' && m === 'POST') {
    const r = routes.add(await readBody(req, routes.MAX_BYTES + 64 * 1024), user);
    if (!r.error) { analyseRoute(r.route.id); pipeline.enqueue(r.route.id, 'new'); } // in the background: bridges and tunnels (OpenStreetMap), then the route pipeline (lib/pipeline.js)
    return r.error ? json(res, 400, r) : json(res, 200, r);
  }
  const cm = p.match(/^\/api\/routes\/([a-z0-9-]+)\/corrections$/);
  if (cm && m === 'PUT') {
    const r = routes.setCorrections(cm[1], user, await readBody(req, 128 * 1024));
    return r.error ? json(res, r.status || 400, r) : json(res, 200, r);
  }
  const cn = p.match(/^\/api\/routes\/([a-z0-9-]+)\/centre$/);
  if (cn && m === 'PUT') {
    const r = routes.setCentre(cn[1], user, await readBody(req, 1024 * 1024));
    return r.error ? json(res, r.status || 400, r) : json(res, 200, r);
  }
  const gm2 = p.match(/^\/api\/routes\/([a-z0-9-]+)\/gpx$/);
  if (gm2 && m === 'PUT') {
    const r = routes.replaceGpx(gm2[1], user, await readBody(req, routes.MAX_BYTES + 64 * 1024));
    if (!r.error) { analyseRoute(gm2[1]); pipeline.enqueue(gm2[1], 'replaced'); }
    return r.error ? json(res, r.status || 400, r) : json(res, 200, r);
  }
  const sm = p.match(/^\/api\/routes\/([a-z0-9-]+)\/segments$/);
  if (sm && m === 'PUT') {
    const r = routes.setSegments(sm[1], user, await readBody(req, 64 * 1024));
    if (r.error) return json(res, r.status || 400, r);
    for (const sid of r.removed) segments.removeSegment(sm[1], sid);
    return json(res, 200, { route: r.route });
  }
  // run the route analyser again now (owner, or admin for RideWorld routes); answers with what it found
  const am = p.match(/^\/api\/routes\/([a-z0-9-]+)\/analyse$/);
  if (am && m === 'POST') {
    const r = routes.list().find((x) => x.id === am[1]);
    if (!r) return json(res, 404, { error: 'No such route.' });
    if (!(routes.kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin))) return json(res, 403, { error: 'Not your route.' });
    const st = await analyseRoute(am[1]);
    return st.error ? json(res, 502, { error: st.error }) : json(res, 200, { structures: st });
  }
  // the route pipeline again (route card "Process again"): owner or admin, as Analyse
  const pq = p.match(/^\/api\/routes\/([a-z0-9-]+)\/process$/);
  if (pq && m === 'POST') {
    const r = routes.list().find((x) => x.id === pq[1]);
    if (!r) return json(res, 404, { error: 'No such route.' });
    if (!(routes.kindOf(r) === 'server' ? user.admin : (r.by === user.username || user.admin))) return json(res, 403, { error: 'Not your route.' });
    const q = pipeline.enqueue(pq[1], 'again');
    return q.error ? json(res, q.status || 400, q) : json(res, 200, q);
  }
  const pm = p.match(/^\/api\/routes\/([a-z0-9-]+)\/promote$/);
  if (pm && m === 'POST') {
    const r = routes.promote(pm[1], user);
    return r.error ? json(res, r.status || 400, r) : json(res, 200, r);
  }
  const rm = p.match(/^\/api\/routes\/([a-z0-9-]+)(\.gpx)?$/);
  if (rm && rm[2] && m === 'GET') {
    const f = routes.file(rm[1], user);
    if (!f) return json(res, 404, { error: 'No such route.' });
    return sendStream(res, f, { 'Content-Type': TYPES['.gpx'], 'Cache-Control': 'no-cache' });
  }
  if (rm && !rm[2] && m === 'PATCH') {
    const r = routes.setDetails(rm[1], user, await readBody(req, 4096));
    return r.error ? json(res, r.status || 400, r) : json(res, 200, r);
  }
  if (rm && !rm[2] && m === 'DELETE') {
    const r = routes.remove(rm[1], user);
    if (!r.error) { segments.removeRoute(rm[1]); pipeline.forget(rm[1]); } // and its segment times, and its pipeline job
    return r.error ? json(res, r.status || 400, r) : json(res, 200, {});
  }

  return json(res, 404, { error: 'Not found' });
}

// The share page: a ride's photos and numbers, plain HTML, no scripts
function sharePage(res, token, n) {
  const s = rides.shared(token);
  if (!s) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  if (n) {
    const f = s.photo(n);
    if (!f) { res.writeHead(404).end(); return; }
    sendStream(res, f, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    return;
  }
  const r = s.ride, e = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hms = (t) => { t = Math.round(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`; };
  const stats = [hms(r.time), `${((r.distance || 0) / 1000).toFixed(1)} km`, r.climbing ? `${Math.round(r.climbing)} m climbing` : '', r.avgPower ? `${r.avgPower} W average` : '', r.workout ? e(r.workout) : ''].filter(Boolean).join(' · ');
  const base = `${strava.PUBLIC_URL}/share/${token}`;
  const imgs = Array.from({ length: r.shots || 0 }, (_, i) => `<img src="/share/${token}/${i + 1}.jpg" alt="Photo ${i + 1} from the ride" loading="lazy">`).join('\n');
  // (the redesign's look, 2026-10-27: ink with the brand's glows, glass stat tiles, italic condensed numbers; the
  // typefaces from our own /fonts, so the policy allows fonts from this site and nothing else)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'self'" });
  const tiles = [['Time', hms(r.time)], ['Distance', `${((r.distance || 0) / 1000).toFixed(1)} km`], r.climbing ? ['Climbing', `${Math.round(r.climbing)} m`] : null,
    r.avgPower ? ['Avg power', `${r.avgPower} W`] : null, r.avgHr ? ['Avg heart rate', `${r.avgHr} bpm`] : null].filter(Boolean)
    .map(([k, v]) => `<div class="t"><small>${k}</small><b>${e(v)}</b></div>`).join('');
  const font = (f, w, st = 'normal') => `@font-face{font-family:"${f.split('-')[0] === 'Inter' ? 'Inter' : 'Barlow Semi Condensed'}";font-style:${st};font-weight:${w};font-display:swap;src:url(/fonts/${f}.woff2) format("woff2")}`;
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(r.name)} · RideWorld</title><meta name="theme-color" content="#04060c">
<meta property="og:title" content="${e(r.name)} · RideWorld"><meta property="og:description" content="${e(stats)}">${r.shots ? `<meta property="og:image" content="${base}/1.jpg">` : ''}
<style>${font('Inter-normal-400-800', '400 800')}${font('BarlowSemiCondensed-italic-800', 800, 'italic')}${font('BarlowSemiCondensed-italic-700', 700, 'italic')}
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:#f5f7fc;font:16px/1.5 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;
background:radial-gradient(60vmax 45vmax at 0% 0%,rgba(255,106,26,.2),transparent 60%),radial-gradient(60vmax 45vmax at 100% 40%,rgba(255,46,126,.14),transparent 60%),#04060c;background-attachment:fixed}
main{max-width:1100px;margin:0 auto;padding:28px 16px 48px}@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.brand{display:flex;align-items:center;gap:9px;font:italic 800 20px "Barlow Semi Condensed",Inter,sans-serif;text-transform:uppercase;margin-bottom:26px}
.brand i{width:12px;height:12px;border-radius:50%;background:linear-gradient(120deg,#ff8a1e,#ff2e7e);box-shadow:0 0 14px rgba(255,90,60,.8)}
.brand span,.brand em{font-style:italic}.brand em{background:linear-gradient(100deg,#ffb057,#ff6a1a 40%,#ff3d86);-webkit-background-clip:text;background-clip:text;color:transparent}
h1{margin:0 0 6px;font:italic 800 clamp(34px,6vw,60px)/1 "Barlow Semi Condensed",Inter,sans-serif;text-transform:uppercase;animation:rise .6s cubic-bezier(.2,.8,.2,1) both}
.when{margin:0 0 22px;color:#a6b0c6;animation:rise .6s .05s cubic-bezier(.2,.8,.2,1) both}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.t{padding:12px 16px;border-radius:18px;background:rgba(17,22,36,.6);border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 50px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08);animation:rise .6s .1s cubic-bezier(.2,.8,.2,1) both}
.t small{display:block;color:#6f7a94;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.t b{font:italic 700 30px/1.15 "Barlow Semi Condensed",Inter,sans-serif}
.wo{display:inline-block;margin:-8px 0 22px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(120deg,#ff8a1e,#ff2e7e)}
.ph{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ph img{display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 50px rgba(0,0,0,.4);animation:rise .7s .15s cubic-bezier(.2,.8,.2,1) both}
.ph img:first-child{grid-column:1/-1}@media(max-width:600px){.ph{grid-template-columns:1fr}}
.none{color:#a6b0c6}footer{margin-top:30px;color:#a6b0c6;font-size:13px}footer b{background:linear-gradient(100deg,#ffb057,#ff6a1a 40%,#ff3d86);-webkit-background-clip:text;background-clip:text;color:transparent}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head>
<body><main><div class="brand"><i></i><span>Ride<em>World</em></span></div>
<h1>${e(r.name)}</h1><p class="when">${e(new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
<div class="tiles">${tiles}</div>${r.workout ? `<span class="wo">${e(r.workout)}</span>` : ''}
${imgs ? `<div class="ph">${imgs}</div>` : '<p class="none">No photos from this ride.</p>'}
<footer>Ridden on <b>RideWorld</b>: real roads, real 3D scenery.</footer></main></body></html>`);
}

const server = https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CRT) }, async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'https://x').pathname); } catch { res.writeHead(400).end(); return; }
  const user = accounts.sessionUser(cookies(req)[COOKIE]);
  if (user) lastSeen.set(user.username, Date.now());
  try {
    if (p.startsWith('/api/')) {
      if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site request refused.' });
      return await api(req, res, p, user);
    }
    // a ride's share page and its photos: open to anyone with the (unguessable) link, no sign-in
    const sh = p.match(/^\/share\/([a-f0-9]{24})(?:\/(\d)\.jpg)?$/);
    if (sh && req.method === 'GET') return sharePage(res, sh[1], sh[2] && +sh[2]);
    if (p === '/rc' || p === '/rc/') p = '/rc.html'; // the phone remote
    if (p === '/status' || p === '/status/') p = '/status.html'; // server status (admins; the API checks)
    if (p.endsWith('/')) p += 'index.html';
    if (!user && !PUBLIC_FILES.has(p)) {
      if (p.endsWith('.html')) {
        res.writeHead(302, { Location: '/login.html?next=' + encodeURIComponent(req.url), 'Cache-Control': 'no-store' });
        return res.end();
      }
      res.writeHead(401).end('Please sign in');
      return;
    }
    serveFile(res, p, req);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  }
});

// Multiplayer link: a WebSocket at /ws for signed-in riders, from our own pages only
server.on('upgrade', (req, sock) => {
  let p;
  try { p = new URL(req.url, 'https://x').pathname; } catch { p = ''; }
  const user = accounts.sessionUser(cookies(req)[COOKIE]);
  if (p !== '/ws' || !user || !sameOrigin(req)) {
    sock.end(`HTTP/1.1 ${user ? 403 : 401} ${user ? 'Forbidden' : 'Unauthorized'}\r\n\r\n`);
    return;
  }
  const s = ws.accept(req, sock);
  if (s) multiplayer.attach(s, user);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RideWorld is running on port ${PORT}. ${accounts.users().length} account(s).`);
  if (!accounts.users().length) console.log('No accounts yet: create one with  node tools/adduser.js <username> --admin');
});
