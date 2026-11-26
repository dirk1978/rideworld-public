// Ghosts: each rider's completed rides per route, replayed as a see-through rider. Stored per account in
// data/ghosts/<username>.json as { [routeId]: [ride, ...] }, a ride being
// { id, date, time (s), length (m), sim, samples: [distance in metres at 1 s, 2 s, ...] }.
// A route keeps the 5 most recent rides plus the best real (non-simulator) one.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'ghosts');
const KEEP = 5;
const MAX_SAMPLES = 6 * 3600; // six hours at one a second

const fileOf = (username) => path.join(DIR, `${username.replace(/[^a-z0-9_.-]/gi, '_')}.json`);
function load(username) { try { return JSON.parse(fs.readFileSync(fileOf(username), 'utf8')); } catch { return {}; } }
function save(username, data) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const f = fileOf(username);
  fs.writeFileSync(f + '.tmp', JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}

const best = (rides) => rides.filter((r) => !r.sim).sort((a, b) => a.time - b.time)[0] || null;
const summary = (r, b) => ({ id: r.id, date: r.date, time: r.time, length: r.length, sim: !!r.sim, best: r === b });

function list(user, routeId) {
  const rides = load(user.username)[routeId] || [];
  const b = best(rides);
  return rides.map((r) => summary(r, b)).sort((x, y) => (y.date > x.date ? 1 : -1));
}

function get(user, routeId, id) {
  return (load(user.username)[routeId] || []).find((r) => r.id === id) || null;
}

function add(user, routeId, { time, length, sim, samples }) {
  if (!Array.isArray(samples) || samples.length < 10 || samples.length > MAX_SAMPLES) return { error: 'A ghost needs between 10 seconds and 6 hours of samples.' };
  if (!samples.every((d) => typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= 1e6)) return { error: 'Bad samples.' };
  if (!(time > 0 && time < 86400) || !(length > 0 && length <= 1e6)) return { error: 'Bad time or length.' };
  const data = load(user.username);
  const rides = data[routeId] || [];
  const ride = { id: crypto.randomBytes(4).toString('hex'), date: new Date().toISOString(), time: Math.round(time), length: Math.round(length), sim: !!sim, samples: samples.map((d) => Math.round(d * 10) / 10) };
  rides.push(ride);
  // keep the newest few and the best real ride
  const b = best(rides);
  const newest = [...rides].sort((x, y) => (y.date > x.date ? 1 : -1)).slice(0, KEEP);
  data[routeId] = b && !newest.includes(b) ? [...newest, b] : newest;
  save(user.username, data);
  return { ride: summary(ride, best(data[routeId])), best: ride === best(data[routeId]) };
}

function remove(user, routeId, id) {
  const data = load(user.username);
  const rides = data[routeId] || [];
  if (!rides.some((r) => r.id === id)) return { error: 'No such ghost.', status: 404 };
  data[routeId] = rides.filter((r) => r.id !== id);
  save(user.username, data);
  return {};
}

module.exports = { list, get, add, remove };
