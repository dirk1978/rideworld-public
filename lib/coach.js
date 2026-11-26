// The virtual coach's per-ride numbers (2026-10-29): worked out once from each kept ride's FIT file with
// public/js/coach-math.js (power curve, NP, power / HR histograms, decoupling) and cached beside the rides in
// data/rides/<user>/coach.json. The browser scores them (TSS needs the FTP each ride was ridden at: rides.ftp, or
// the rider's FTP now for rides kept before that was stored) and draws everything.
const fs = require('fs');
const path = require('path');
const rides = require('./rides');

const V = 4; // bump to recompute every ride's numbers (2: heart rate against power, recovery; 3: ramp tests' heart rate; 4: efforts, steady blocks, benchmark)
const ROOT = path.join(__dirname, '..', 'data', 'rides');
const fileOf = (u) => path.join(ROOT, u.replace(/[^a-z0-9_.-]/gi, '_'), 'coach.json');
let mods = null;
const load = async () => (mods ||= {
  math: await import(path.join(__dirname, '..', 'public', 'js', 'coach-math.js')),
  fit: await import(path.join(__dirname, '..', 'public', 'js', 'formats.js')),
});

const busy = new Map(); // one computation per rider at a time
async function forUser(user) {
  if (busy.has(user.username)) return busy.get(user.username);
  const job = (async () => {
    const { math, fit } = await load();
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(fileOf(user.username), 'utf8')); } catch {}
    const list = rides.list(user), out = [], next = {};
    let changed = false;
    for (const r of list) {
      if (r.sim) continue;
      let m = cache[r.id];
      if (!m || m.v !== V) {
        const f = rides.fitPath(user, r.id);
        try {
          const sec = math.toSeconds(fit.readFit(fs.readFileSync(f)));
          m = { v: V, ...math.rideNumbers(sec) };
          if (r.workout === 'Ramp test' && r.ftp > 0) m.ramp = math.rampAnalysis(sec.p, sec.h, r.ftp);
          if (r.workout === 'Benchmark 20') m.bench = math.benchAnalysis(sec.p, sec.h);
        } catch { m = { v: V, secs: 0, broken: true }; }
        changed = true;
      }
      next[r.id] = m;
      if (!m.broken && m.secs > 0) out.push({ id: r.id, date: r.date, name: r.name, routeId: r.routeId, distance: r.distance, climbing: r.climbing, time: r.time, ftp: r.ftp ?? null, workout: r.workout, ...m });
    }
    if (changed || Object.keys(cache).length !== Object.keys(next).length) {
      fs.writeFileSync(fileOf(user.username) + '.tmp', JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(fileOf(user.username) + '.tmp', fileOf(user.username));
    }
    return out;
  })().finally(() => busy.delete(user.username));
  busy.set(user.username, job);
  return job;
}

module.exports = { forUser };
