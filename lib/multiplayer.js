// Multiplayer: riders in the same "room" see each other. A room is either drop-in (everyone currently riding a
// RideWorld route: "route:<id>") or an organised group ride ("group:<id>", started together by its host).
// Drop-in rooms are one shared world per route (up to 5000 riders), group rides up to 100. Each browser sends its
// position ~4x a second; 4x a second each rider is sent the NEAREST riders only (40, by distance along the route,
// like Zwift), with names and kit only the first time it sees them, plus how many are in the room. Sending everyone
// to everyone grows with the square of the riders (load test 2026-10-17: 200 KB/s each and the server overloaded at
// ~500 in one room); nearest-only stays flat per rider. Lanes (sideways spots) are handed out on joining.
const crypto = require('crypto');
const accounts = require('./accounts');
const routes = require('./routes');

const MAX_WORLD = 5000, MAX_GROUP = 100;
const NEAR = 40; // riders each rider is told about
const LANES = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5];
const GROUP_TTL = 4 * 3600e3;          // group rides disappear 4 hours after creation
const STALE_MS = 30000;                // a rider who stops sending for 30 s is dropped (browsers send a heartbeat)
const BANDING = ['firm', 'soft', 'off'];

const rooms = new Map();   // room id -> { riders: Map(username -> rider), group? }
const groups = new Map();  // group id -> group

// Group rides are kept in data/groups.json too, so restarting the server doesn't cancel them (riders' browsers
// reconnect and rejoin by themselves). Riders' positions are not kept: they arrive again within a second.
const fs = require('fs');
const path = require('path');
const GROUPS_FILE = path.join(__dirname, '..', 'data', 'groups.json');
function saveGroups() {
  try {
    fs.writeFileSync(GROUPS_FILE + '.tmp', JSON.stringify([...groups.values()]), { mode: 0o600 });
    fs.renameSync(GROUPS_FILE + '.tmp', GROUPS_FILE);
  } catch (e) { console.error('could not save group rides', e.message); }
}
try {
  for (const g of JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'))) if (g.status !== 'done' && Date.now() - g.createdMs < GROUP_TTL) groups.set(g.id, g);
} catch { /* none yet */ }

const colour = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : undefined);
// design: public/js/kit.js (validDesign there matches this)
const design = (v) => (typeof v === 'string' && v.length < 120 && /^[a-z0-9]+:(#[0-9a-f]{6},?){0,4}(;img=[a-z0-9_.-]+;fit=(full|logo))?$/i.test(v) ? v : undefined);
const kitOf = (u) => { const s = u.settings || {}; return { jersey: colour(s.jersey), shorts: colour(s.shorts), frame: colour(s.frame), helmet: colour(s.helmet), design: design(s.design), socks: colour(s.socks), shoes: colour(s.shoes), bikestyle: ['classic', 'compact', 'mtb', 'gravel'].includes(s.bikestyle) ? s.bikestyle : undefined, skin: ['light', 'fair', 'tan', 'olive', 'brown', 'dark', 'deep'].includes(s.skin) ? s.skin : undefined, beard: ['stubble', 'moustache', 'goatee', 'short', 'full'].includes(s.beard) ? s.beard : undefined, beardcol: ['brown', 'dark', 'black', 'ginger', 'blond', 'grey', 'white'].includes(s.beardcol) ? s.beardcol : undefined }; }; // (skin / beard: 2026-11-16)
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

function publicGroup(g) {
  const room = rooms.get('group:' + g.id);
  return {
    id: g.id, name: g.name, routeId: g.routeId, routeName: g.routeName, host: g.host, hostName: g.hostName, banding: g.banding,
    status: g.status, startAt: g.startAt || null, created: g.created,
    riders: room ? [...room.riders.values()].map((r) => r.name) : [],
  };
}

function listGroups() {
  const now = Date.now();
  let changed = false;
  for (const [id, g] of groups) if (now - g.createdMs > GROUP_TTL) { groups.delete(id); rooms.delete('group:' + id); changed = true; }
  if (changed) saveGroups();
  return [...groups.values()].filter((g) => g.status !== 'done').map(publicGroup);
}

function createGroup(user, { name, routeId, banding }) {
  const route = routes.list().find((r) => r.id === routeId);
  if (!route || routes.kindOf(route) !== 'server') return { error: 'Group rides need a RideWorld route (everyone has to be able to see it).' };
  if ([...groups.values()].filter((g) => g.host === user.username && g.status !== 'done').length >= 3) return { error: 'You already have 3 group rides open.' };
  const id = crypto.randomBytes(4).toString('hex');
  const g = {
    id, name: clean(name, 60) || `${user.name || user.username}'s ride`, routeId, routeName: route.name,
    host: user.username, hostName: user.name || user.username, banding: BANDING.includes(banding) ? banding : 'firm',
    status: 'waiting', created: new Date().toISOString(), createdMs: Date.now(),
  };
  groups.set(id, g);
  saveGroups();
  return { group: publicGroup(g) };
}

function deleteGroup(user, id) {
  const g = groups.get(id);
  if (!g) return { error: 'No such group ride.', status: 404 };
  if (g.host !== user.username && !user.admin) return { error: 'Only the host can cancel it.', status: 403 };
  groups.delete(id);
  saveGroups();
  const room = rooms.get('group:' + id);
  if (room) for (const r of room.riders.values()) r.sock.send({ type: 'cancelled', message: 'The host cancelled this group ride.' });
  rooms.delete('group:' + id);
  return {};
}

function leave(sock) {
  if (!sock.room) return;
  const room = rooms.get(sock.room);
  if (room && room.riders.get(sock.user.username)?.sock === sock) room.riders.delete(sock.user.username);
  if (room && !room.riders.size && !room.group) rooms.delete(sock.room);
  sock.room = null;
}

function join(sock, roomId) {
  leave(sock);
  const m = /^(route|group):([a-z0-9-]{1,64})$/.exec(String(roomId || ''));
  if (!m) return sock.send({ type: 'error', message: 'Bad room.' });
  let group = null;
  if (m[1] === 'group') {
    group = groups.get(m[2]);
    if (!group || group.status === 'done') return sock.send({ type: 'error', message: 'That group ride has ended.' });
  } else {
    const r = routes.list().find((x) => x.id === m[2]);
    if (!r || routes.kindOf(r) !== 'server') return sock.send({ type: 'joined', room: null }); // drop-in only on RideWorld routes
  }
  const room = rooms.get(roomId) || { riders: new Map(), group };
  rooms.set(roomId, room);
  const old = room.riders.get(sock.user.username);
  if (old && old.sock !== sock) { old.sock.room = null; old.sock.send({ type: 'replaced' }); }
  const max = group ? MAX_GROUP : MAX_WORLD;
  if (!old && room.riders.size >= max) return sock.send({ type: 'error', message: `This ride is full (${max} riders).` });
  const used = new Set([...room.riders.values()].filter((r) => r.sock !== sock).map((r) => r.lane));
  const lane = old?.lane ?? LANES.find((l) => !used.has(l)) ?? LANES[room.riders.size % LANES.length];
  const user = accounts.findUser(sock.user.username) || sock.user; // fresh copy: name or kit may have changed since connecting
  room.riders.set(sock.user.username, {
    sock, id: sock.user.username, name: user.name || user.username, kit: kitOf(user), lane,
    dist: 0, speed: 0, power: 0, cadence: 0, riding: false, seen: Date.now(),
  });
  sock.room = roomId;
  sock.send({ type: 'joined', room: roomId, you: sock.user.username, lane, group: group ? publicGroup(group) : null });
}

// ---------- phone remote (/rc): a rider's phone drives their own ride page, same account only ----------
// The ride page registers as 'ride' (at Load scenery), the phone as 'remote'. Commands go phone -> ride pages,
// status (and new screenshots) ride page -> phones.
const sockets = new Map(); // username -> Set of sockets
const RC_CMDS = new Set(['gearup', 'geardown', 'pause', 'camera', 'shot', 'chapeau', 'sound', 'clean', 'music', 'next', 'prev', 'musicpick', 'easier', 'harder', 'skip', 'erg', 'up', 'down', 'finish', 'film', 'turn', 'finishhere', 'report', 'reportsend', 'reportcancel', 'way', 'uturn', 'rec', 'navq', 'navgo', 'navoff', 'navjump']); // (way / uturn: open-world junctions and turning round; rec: a ride clip, 2026-11-16)
function relay(sock, role, msg) {
  for (const s of sockets.get(sock.user.username) || []) if (s !== sock && s.role === role && s.open) s.send(msg);
}
function onRemote(sock, msg) {
  if (msg.type === 'rc-role' && (msg.role === 'ride' || msg.role === 'remote')) {
    sock.role = msg.role;
    if (msg.role === 'remote') relay(sock, 'ride', { type: 'rc-want-status' });
    return true;
  }
  if (msg.type === 'rc' && sock.role === 'remote' && RC_CMDS.has(msg.cmd)) {
    const now = Date.now();
    if (now - (sock.rcAt || 0) < 150) return true; // no more than ~6 presses a second
    sock.rcAt = now;
    relay(sock, 'ride', { type: 'rc', cmd: msg.cmd, ...(msg.cmd === 'reportsend' ? { note: String(msg.note || '').slice(0, 2000) } : {}), ...(msg.cmd === 'way' || msg.cmd === 'navgo' || msg.cmd === 'navjump' || msg.cmd === 'musicpick' ? { n: Math.max(0, Math.min(9, msg.n | 0)) } : {}), ...(msg.cmd === 'navq' ? { q: String(msg.q || '').slice(0, 60) } : {}) });
    return true;
  }
  if ((msg.type === 'rc-status' || msg.type === 'rc-shot') && sock.role === 'ride') {
    const clean = msg.type === 'rc-shot' ? { type: 'rc-shot', url: String(msg.url || '').slice(0, 200) } : { type: 'rc-status', s: msg.s && typeof msg.s === 'object' ? msg.s : {} };
    if (clean.type === 'rc-status') { sock.status = clean.s; sock.statusAt = Date.now(); } // for the admin status page
    relay(sock, 'remote', clean);
    return true;
  }
  return false;
}

function onMessage(sock, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (String(msg.type).startsWith('rc') && onRemote(sock, msg)) return;
  if (msg.type === 'join') return join(sock, msg.room);
  if (msg.type === 'leave') return leave(sock);
  let room = sock.room && rooms.get(sock.room);
  let me = room?.riders.get(sock.user.username);
  // dropped as stale (e.g. a long scenery load or a stalled tab) but still here: put them back in
  if (msg.type === 'pos' && sock.room && !me) {
    join(sock, sock.room);
    room = rooms.get(sock.room);
    me = room?.riders.get(sock.user.username);
  }
  if (msg.type === 'pos' && me) {
    Object.assign(me, {
      dist: num(msg.dist, 0, 1e6), speed: num(msg.speed, 0, 40), power: Math.round(num(msg.power, 0, 3000)),
      cadence: Math.round(num(msg.cadence, 0, 250)), riding: !!msg.riding, finished: !!msg.finished, seen: Date.now(),
    });
    return;
  }
  // Chapeau (a doff of the cap) to another rider in the same room: at most one every 2 s per sender
  if (msg.type === 'chapeau' && me) {
    const to = room.riders.get(String(msg.to || ''));
    if (!to || to === me) return;
    const now = Date.now();
    if (now - (sock.lastChapeau || 0) < 2000) return;
    sock.lastChapeau = now;
    to.sock.send({ type: 'chapeau', from: me.id, name: me.name });
    sock.send({ type: 'chapeau-sent', to: to.id, name: to.name });
    return;
  }
  if (msg.type === 'start' && room?.group) {
    const g = room.group;
    if (g.host !== sock.user.username) return sock.send({ type: 'error', message: 'Only the host can start the ride.' });
    if (g.status !== 'waiting') return;
    g.status = 'riding';
    g.startAt = Date.now() + 5000; // 5-second countdown for everyone
    saveGroups();
    for (const r of room.riders.values()) r.sock.send({ type: 'start', at: g.startAt, now: Date.now() });
  }
}

// Relay each room's state 4 times a second
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    for (const [name, r] of room.riders) if (now - r.seen > STALE_MS || !r.sock.open) room.riders.delete(name);
    if (!room.riders.size) {
      if (!room.group) rooms.delete(id);
      else if (room.group.status === 'riding') { room.group.status = 'done'; rooms.delete(id); saveGroups(); }
      continue;
    }
    const group = room.group ? publicGroup(room.group) : null, total = room.riders.size;
    // everyone in order along the road; each rider gets the NEAR closest (a window around their own place)
    const order = [...room.riders.values()].sort((a, b) => a.dist - b.dist);
    // compact rows (a third of the bytes of named fields): [id, lane, dist (0.1 m), speed (0.01 m/s), power, cadence,
    // flags (1 riding, 2 finished)], plus [..., name, kit] the first time; public/js/multiplayer.js unpacks them
    const brief = order.map((r) => [r.id, r.lane, Math.round(r.dist * 10) / 10, Math.round(r.speed * 100) / 100, r.power, r.cadence, (r.riding ? 1 : 0) | (r.finished ? 2 : 0)]);
    order.forEach((me, i) => {
      let lo = i, hi = i;
      while (hi - lo < NEAR && (lo > 0 || hi < order.length - 1)) {
        if (lo === 0) hi++;
        else if (hi === order.length - 1) lo--;
        else if (me.dist - order[lo - 1].dist <= order[hi + 1].dist - me.dist) lo--;
        else hi++;
      }
      // names and kit only for riders this rider hasn't been sent yet (the page keeps them while they stay near)
      const known = me.known || (me.known = new Set()), now2 = new Set(), riders = [];
      for (let k = lo; k <= hi; k++) {
        const r = order[k];
        now2.add(r.id);
        riders.push(known.has(r.id) ? brief[k] : [...brief[k], r.name, r.kit]);
      }
      me.known = now2;
      me.sock.send({ type: 'state', now, group, total, riders });
    });
  }
}, 250);

// Who's connected now (admin status page, /status): every account with an open page, its newest ride page's numbers
// (sent once a second for the phone remote, with where it is on the route) and the room it's in
function live() {
  const out = [], now = Date.now();
  for (const [username, set] of sockets) {
    const open = [...set].filter((s) => s.open);
    if (!open.length) continue;
    const ride = open.filter((s) => s.role === 'ride' && s.statusAt).sort((a, b) => b.statusAt - a.statusAt)[0];
    out.push({
      username, pages: open.length, remote: open.some((s) => s.role === 'remote'),
      room: ride?.room || open.find((s) => s.room)?.room || null,
      ride: ride ? { ...ride.status, ago: Math.round((now - ride.statusAt) / 1000) } : null,
    });
  }
  const roomList = [...rooms].map(([id, r]) => ({ id, riders: r.riders.size, group: r.group ? r.group.name : null }));
  return { people: out, rooms: roomList };
}

function attach(sock, user) {
  sock.user = user;
  sock.on('message', (m) => { try { onMessage(sock, m); } catch (e) { console.error('multiplayer', e); } });
  sock.on('close', () => { leave(sock); sockets.get(user.username)?.delete(sock); });
  if (!sockets.has(user.username)) sockets.set(user.username, new Set());
  sockets.get(user.username).add(sock);
  sock.send({ type: 'hello', you: user.username, now: Date.now() });
}

module.exports = { attach, listGroups, createGroup, deleteGroup, live };
