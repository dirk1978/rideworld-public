// The route pipeline, web server side (the owner 2026-10-27): every uploaded, planned or replaced route is queued for the
// treatment routes used to get by hand (stops taken out, survey heights, Google's road height, underpasses, climbs as
// segments, rock walls), with its progress on the route's card. The work is done by tools/pipeline/worker.mjs, its own
// service (it needs Playwright and the graphics card, which this server's sandbox keeps out). Here: queue a job
// (data/pipeline/<route id>.json), read its progress for the route list, and apply a finished job's results to the
// route (only this server writes routes.json).
const fs = require('fs');
const path = require('path');
const routes = require('./routes');

const DIR = path.join(__dirname, '..', 'data', 'pipeline');
const STEPS = [
  ['read', 'Reading the file'],
  ['tidy', 'Taking out stops'],
  ['source', 'Finding a height survey'],
  ['heights', 'Re-heighting from the survey'],
  ['google', "Measuring Google's road height"],
  ['bridges', 'Bridges and underpasses'],
  ['climbs', 'Climbs and hairpins'],
  ['walls', 'Walls and finishing touches'],
];
const file = (id) => path.join(DIR, id + '.json');
const read = (id) => { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; } };
function write(job) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(job.routeId) + '.tmp', JSON.stringify(job, null, 1), { mode: 0o600 });
  fs.renameSync(file(job.routeId) + '.tmp', file(job.routeId));
}

// reason: 'new' (uploaded / planned), 'replaced' (Replace GPX), 'again' (Process again)
function enqueue(routeId, reason) {
  const old = read(routeId);
  if (old && (old.state === 'running' || old.state === 'queued')) return { error: 'Already being processed.', status: 409 };
  const job = { routeId, reason, state: 'queued', created: new Date().toISOString(), steps: STEPS.map(([key, label]) => ({ key, label, status: 'pending' })), progress: 0, result: {}, summary: [], attention: [] };
  write(job);
  return { job: status(routeId) };
}

// what the route card shows (null if the route was never processed)
function status(routeId) {
  const j = read(routeId);
  if (!j) return null;
  const queue = j.state === 'queued' ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => read(f.slice(0, -5))).filter((x) => x && (x.state === 'queued' || x.state === 'running') && x.created < j.created).length : 0;
  return { state: j.state, step: j.step || null, progress: j.progress || 0, ahead: queue, steps: j.steps.map(({ key, label, status: s, note }) => ({ key, label, status: s, note })),
    summary: j.summary || [], attention: j.attention || [], error: j.error || null, finishedAt: j.finishedAt || null, applied: j.applied || null };
}

// every few seconds: finished jobs' results go onto their routes
function applyFinished() {
  if (!fs.existsSync(DIR)) return;
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const j = read(f.slice(0, -5));
    if (!j || j.state !== 'done' || j.applied) continue;
    try {
      const gpx = j.result.gpx && fs.existsSync(path.join(DIR, j.routeId + '.gpx')) ? fs.readFileSync(path.join(DIR, j.routeId + '.gpx'), 'utf8') : null;
      routes.applyPipeline(j.routeId, j.result, gpx, { summary: j.summary, attention: j.attention, at: j.finishedAt });
      j.applied = new Date().toISOString();
    } catch (e) { j.applied = 'failed: ' + e.message; console.error('pipeline apply', j.routeId, e.message); }
    write(j);
  }
}

// a deleted route's job goes too
function forget(routeId) { for (const f of [file(routeId), path.join(DIR, routeId + '.gpx')]) fs.rmSync(f, { force: true }); }

module.exports = { enqueue, status, applyFinished, forget, STEPS };
