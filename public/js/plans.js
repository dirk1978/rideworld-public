// Training plans (2026-10-30, the owner's list: "multi-week plans ... on a calendar, where the coach picks each day's
// workout and adjusts"). Pure: the plans, and where a rider is in one. Three sessions a week on the rider's chosen
// days; a session is a built-in workout (workout.js id) or a ride on any route for so many minutes. Every 4th week (and
// the last) is lighter. The account keeps { id, start (a Monday), days, moved, swaps } (lib/plans.js).
const R = (min, note) => ({ ride: min, note });
export const PLANS = [
  { id: 'get-going', name: 'Get going', weeks: 4, blurb: 'Four easy-going weeks of three short rides: a habit first, then a little sweet spot, and a ramp test at the end to set your zones.',
    sessions: [['quick30', 'recovery', R(45, 'Easy on any route you like')], ['quick30', 'endurance', R(60, 'Steady on a flat or rolling route')],
      ['sweetspot', 'endurance', R(75, 'Steady, with any hills taken at tempo')], ['recovery', 'quick30', 'ramptest']] },
  { id: 'ftp-builder', name: 'FTP builder', weeks: 6, blurb: 'Six weeks to raise your FTP: sweet spot and threshold work twice a week and a longer ride, a lighter fourth week, and ramp tests at the start and end to see the gain.',
    sessions: [['ramptest', 'endurance', R(90, 'Endurance: 65-75% of FTP')], ['sweetspot', 'tempo', R(90, 'Endurance: 65-75% of FTP')], ['sweetspot2x20', 'overunder', R(105, 'Endurance, a few tempo hills')],
      ['recovery', 'quick30', R(60, 'Easy: let the work sink in')], ['threshold', 'overunder', 'longride'], ['sweetspot', 'recovery', 'ramptest']] },
  { id: 'sportive', name: 'Sportive prep', weeks: 8, blurb: 'Eight weeks for a big day out: climbing strength, sweet spot and threshold, and a long ride every weekend building to three hours. The last week tapers so you arrive fresh.',
    sessions: [['endurance', 'climbing', R(90, 'Endurance on a hilly route')], ['tempo', 'climbing', R(120, 'Long and steady')], ['sweetspot', 'pyramid', 'longride'],
      ['recovery', 'endurance', R(75, 'Easy week')], ['sweetspot2x20', 'climbing', R(150, 'Long, with the climbs at tempo')], ['threshold', 'thirtythirty', R(150, 'Long and steady')],
      ['overunder', 'climbing', R(180, 'Your longest: eat and drink every 30 min')], ['quick30', 'recovery', R(60, 'Taper: easy, stay fresh')]] },
];
export const planById = (id) => PLANS.find((p) => p.id === id) || null;
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // (local date)
const at = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
export const today = (now = new Date()) => iso(now);
// the Monday on or after a date (a plan starts on a Monday)
export function nextMonday(now = new Date()) { const d = new Date(now); d.setHours(0, 0, 0, 0); const k = (d.getDay() + 6) % 7; if (k) d.setDate(d.getDate() + 7 - k); return iso(d); }
export function thisMonday(now = new Date()) { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }

// what a session is: { kind: 'workout', id } or { kind: 'ride', min, note }; swaps put another workout in
const sessionOf = (s, swap) => (swap ? { kind: 'workout', id: swap, swapped: true } : typeof s === 'string' ? { kind: 'workout', id: s } : { kind: 'ride', min: s.ride, note: s.note });

// The whole plan with dates and how each went. mine: { id, start, days, moved, swaps }; rides: [{ date, workout
// (name), secs }]; workouts: id -> { name, secs } (built-ins). A ride counts for a session if it's on or after the
// session's date and before the next session's: by the workout's name, or, for rides and plain rides on a workout's
// day, by being at least 70% as long. Each ride counts once.
export function schedule(mine, rides, workouts, now = new Date()) {
  const plan = planById(mine?.id);
  if (!plan) return null;
  const days = (mine.days || []).slice().sort((a, b) => a - b), t = today(now), list = [];
  const began = mine.at ? today(new Date(mine.at)) : '0000'; // (sessions due before the plan was started are skipped, not missed)
  plan.sessions.forEach((week, w) => week.forEach((s, n) => {
    const key = `${w + 1}.${n + 1}`, planned = addDays(mine.start, w * 7 + days[Math.min(n, days.length - 1)]);
    const sess = sessionOf(s, mine.swaps?.[key]);
    const wk = sess.kind === 'workout' ? workouts[sess.id] : null;
    list.push({ key, week: w + 1, n: n + 1, date: mine.moved?.[key] || planned, planned, moved: !!mine.moved?.[key], ...sess,
      name: sess.kind === 'ride' ? `Ride ${sess.min} min` : wk?.name || sess.id, secs: sess.kind === 'ride' ? sess.min * 60 : wk?.secs || 3600 });
  }));
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.week - b.week || a.n - b.n));
  const used = new Set();
  list.forEach((s, i) => {
    const until = list[i + 1] ? list[i + 1].date : addDays(s.date, 3);
    const fits = (r) => { const d = iso(new Date(r.date)); return d >= s.date && d < (until > s.date ? until : addDays(s.date, 1)); };
    const match = rides.find((r) => !used.has(r) && fits(r) && s.kind === 'workout' && r.workout === s.name)
      || rides.find((r) => !used.has(r) && fits(r) && !r.workout && (r.secs || 0) >= 0.7 * s.secs);
    if (match) { used.add(match); s.done = match; }
    s.status = s.done ? 'done' : s.date < began ? 'skipped' : s.date < t ? 'missed' : s.date === t ? 'today' : 'upcoming';
  });
  const done = list.filter((s) => s.done).length, counted = list.filter((s) => s.status !== 'skipped').length, cur = list.find((s) => s.status === 'today') || list.find((s) => s.status === 'upcoming') || null;
  const week = cur ? cur.week : plan.weeks, last = list[list.length - 1];
  return { plan, list, done, total: counted, week, current: cur, finished: !cur && last && last.date < t,
    today: list.find((s) => s.status === 'today') || null,
    // a session missed in the last two days, when today has none: offer it today
    catchUp: list.find((s) => s.status === 'missed' && s.date >= addDays(t, -2)) && !list.some((s) => s.status === 'today') ? list.find((s) => s.status === 'missed' && s.date >= addDays(t, -2)) : null };
}
