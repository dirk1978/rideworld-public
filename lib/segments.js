// Segments: timed stretches of a route (a climb, a sprint) with a leaderboard. The stretches are stored on the route
// (routes.json `segments`, set in the route editor); every route also has the whole route as segment 'full'.
// Efforts live in data/segments.json: { [routeId]: { [segmentId]: { [username]: { name, best, bestSim } } } }, where
// best / bestSim = { time (s), watts, date, splits: [seconds at every 10 m from the segment's start] }. Leaderboards
// use real rides only; simulator times are kept, marked, for the rider themselves.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'segments.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
function save(data) {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
}

const strip = (e) => e && { time: e.time, watts: e.watts, date: e.date };

// Everything the ride and the setup screen need for one route
function boards(routeId, user) {
  const segs = load()[routeId] || {};
  const out = {};
  for (const [segId, riders] of Object.entries(segs)) {
    const real = Object.entries(riders).filter(([, r]) => r.best).map(([u, r]) => ({ user: u, name: r.name, ...strip(r.best) }))
      .sort((a, b) => a.time - b.time);
    const mine = riders[user.username];
    out[segId] = {
      top: real.slice(0, 10).map((e, i) => ({ rank: i + 1, name: e.name, time: e.time, date: e.date, me: e.user === user.username })),
      riders: real.length,
      rank: real.findIndex((e) => e.user === user.username) + 1 || null,
      best: mine?.best ? { ...strip(mine.best), splits: mine.best.splits } : null,
      bestSim: mine?.bestSim ? { ...strip(mine.bestSim), splits: mine.bestSim.splits } : null,
    };
  }
  return out;
}

// A finished effort; returns where it puts the rider
function add(routeId, segId, user, { time, watts, sim, splits }) {
  if (!(time > 0 && time < 86400)) return { error: 'Bad time.' };
  if (!Array.isArray(splits) || splits.length > 20000 || !splits.every((x) => typeof x === 'number' && Number.isFinite(x))) return { error: 'Bad splits.' };
  const data = load();
  const riders = ((data[routeId] ||= {})[segId] ||= {});
  const r = (riders[user.username] ||= {});
  r.name = user.name || user.username;
  const key = sim ? 'bestSim' : 'best';
  const prev = r[key] ? r[key].time : null;
  const effort = { time: Math.round(time * 10) / 10, watts: Math.round(+watts || 0), date: new Date().toISOString(), splits: splits.map((x) => Math.round(x * 10) / 10) };
  const pb = prev === null || effort.time < prev;
  if (pb) r[key] = effort;
  save(data);
  const b = boards(routeId, user)[segId];
  return { pb, prev, time: effort.time, rank: sim ? null : b.rank, riders: b.riders };
}

// Drop a segment's results (when it is removed from the route)
function removeSegment(routeId, segId) {
  const data = load();
  if (data[routeId]?.[segId]) { delete data[routeId][segId]; save(data); }
}

// Drop all of a route's results (the route was deleted)
function removeRoute(routeId) {
  const data = load();
  if (data[routeId]) { delete data[routeId]; save(data); }
}

module.exports = { boards, add, removeSegment, removeRoute };
