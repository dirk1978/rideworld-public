// Training plans (2026-10-30): the plan a rider is following, kept per account in data/plans/<username>.json as
// { id (a plan in public/js/plans.js), start (YYYY-MM-DD, a Monday), days ([3 weekdays, 0 = Monday]), moved
// ({ "week.session": "YYYY-MM-DD" }: a missed session ridden on another day), swaps ({ "week.session": workout id }) }
// or nothing. The browser does the rest (public/js/plans.js, app/coach.js).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'plans');
const fileOf = (u) => path.join(DIR, `${u.replace(/[^a-z0-9_.-]/gi, '_')}.json`);
function get(user) { try { return JSON.parse(fs.readFileSync(fileOf(user.username), 'utf8')); } catch { return null; } }
const DATE = /^\d{4}-\d{2}-\d{2}$/, KEY = /^\d{1,2}\.\d$/;
function set(user, body) {
  if (body === null || body?.id === null) { fs.rmSync(fileOf(user.username), { force: true }); return { plan: null }; }
  const { id, start, days, moved = {}, swaps = {} } = body || {};
  if (!/^[a-z0-9-]{1,40}$/.test(id || '') || !DATE.test(start || '')) return { error: 'That plan has no id or start date.' };
  if (!Array.isArray(days) || days.length < 1 || days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { error: 'Pick the days you ride.' };
  const clean = (o, ok) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => KEY.test(k) && ok(v)).slice(0, 60));
  const plan = { id, start, days: [...new Set(days)].sort(), moved: clean(moved, (v) => DATE.test(v)), swaps: clean(swaps, (v) => /^[a-z0-9-]{1,40}$/.test(v)), at: new Date().toISOString() };
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(fileOf(user.username) + '.tmp', JSON.stringify(plan), { mode: 0o600 });
  fs.renameSync(fileOf(user.username) + '.tmp', fileOf(user.username));
  return { plan };
}
module.exports = { get, set };
