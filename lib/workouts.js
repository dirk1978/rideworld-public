// Workouts a rider has imported (.zwo files), kept per account in data/workouts/<username>.json as
// [{ id, name, zwo, added }]. The browser parses them (public/js/workout.js); built-in workouts live there too.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'workouts');
const MAX = 200 * 1024, KEEP = 50;
const fileOf = (u) => path.join(DIR, `${u.replace(/[^a-z0-9_.-]/gi, '_')}.json`);
const load = (u) => { try { return JSON.parse(fs.readFileSync(fileOf(u), 'utf8')); } catch { return []; } };
function save(u, list) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(fileOf(u) + '.tmp', JSON.stringify(list), { mode: 0o600 });
  fs.renameSync(fileOf(u) + '.tmp', fileOf(u));
}

const list = (user) => load(user.username);

function add(user, { name, zwo }) {
  if (typeof zwo !== 'string' || zwo.length > MAX || !/<workout>/i.test(zwo)) return { error: "That doesn't look like a Zwift workout file (.zwo, up to 200 KB)." };
  const l = load(user.username);
  if (l.length >= KEEP) return { error: `You can keep up to ${KEEP} workouts: delete one first.` };
  const w = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'Workout').replace(/[<>]/g, '').trim().slice(0, 60) || 'Workout', zwo, added: new Date().toISOString() };
  l.push(w);
  save(user.username, l);
  return { workout: w };
}

function remove(user, id) {
  const l = load(user.username);
  if (!l.some((w) => w.id === id)) return { error: 'No such workout.', status: 404 };
  save(user.username, l.filter((w) => w.id !== id));
  return {};
}

module.exports = { list, add, remove };
