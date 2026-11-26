// Goals and streaks (2026-10-30, the owner's list: "a weekly target on the setup screen, with streaks and simple
// milestones"): a weekly goal in hours, distance or rides (account setting `goal`, "time:240" minutes / "dist:150"
// km / "rides:3"), shown as a ring at the top of the sidebar with the weeks-in-a-row streak; click for the goal and
// your totals and milestones. Passing a milestone with a saved ride says so (milestoneToast). Independent of the coach.
// Weeks run Monday to Sunday, local time; the streak counts back from last week (this week joins once it's met).
import { $, esc, fmtDist, saveSetting, store, toast, U } from './core.js';

const DAY = 86400000;
let rides = [];
const parse = () => { const [k, v] = String($('cfg-goal').value || '').split(':'); return ['time', 'dist', 'rides'].includes(k) && +v > 0 ? { k, v: +v } : null; };
const monday = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return +d; };
const amount = (k, list) => (k === 'time' ? list.reduce((s, r) => s + (r.time || 0), 0) / 60 : k === 'dist' ? list.reduce((s, r) => s + (r.distance || 0), 0) / 1000 : list.length);
const fmtAmount = (k, v) => (k === 'time' ? `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')}` : k === 'dist' ? fmtDist(v * 1000, 0) : `${Math.round(v)} ride${Math.round(v) === 1 ? '' : 's'}`);
const real = () => rides.filter((r) => !r.sim);

export function weekStats(now = Date.now()) {
  const g = parse(), m = monday(now), list = real();
  if (!g) return null;
  const inWeek = (a) => list.filter((r) => { const t = +new Date(r.date); return t >= a && t < a + 7 * DAY; });
  const done = amount(g.k, inWeek(m));
  let streak = 0;
  for (let a = m - 7 * DAY; ; a -= 7 * DAY) { if (amount(g.k, inWeek(a)) >= g.v) streak++; else break; if (streak > 520) break; }
  if (done >= g.v) streak++;
  return { g, done, frac: Math.min(1, done / g.v), streak, met: done >= g.v };
}

// totals and milestones (km, m climbed, hours, rides)
const MILES = [
  { k: 'dist', label: 'ridden', at: [100, 250, 500, 1000, 2500, 5000, 10000], fmt: (v) => fmtDist(v * 1000, 0) },
  { k: 'climb', label: 'climbed', at: [1000, 2500, 5000, 8849, 20000, 50000, 100000], fmt: (v) => (v === 8849 ? 'Everest (8,849 m)' : `${Math.round(v * U().ele).toLocaleString()} ${U().eleUnit}`) },
  { k: 'time', label: 'on the bike', at: [10, 25, 50, 100, 250, 500], fmt: (v) => `${v} hours` },
  { k: 'rides', label: 'rides', at: [10, 25, 50, 100, 250, 500], fmt: (v) => `${v} rides` },
];
export function totals(list = real()) {
  return { dist: list.reduce((s, r) => s + (r.distance || 0), 0) / 1000, climb: list.reduce((s, r) => s + (r.climbing || 0), 0), time: list.reduce((s, r) => s + (r.time || 0), 0) / 3600, rides: list.length };
}
// a ride just saved: any milestone it passed
export function milestoneToast(before, after) {
  const passed = MILES.flatMap((m) => m.at.filter((v) => before[m.k] < v && after[m.k] >= v).map((v) => `${m.fmt(v)} ${m.label}`));
  if (passed.length) toast(`🏅 Milestone: ${passed.join(' · ')} on RideWorld!`, 8000);
}

function renderSide() {
  const s = weekStats(), el = $('side-goal');
  if (!s) { el.innerHTML = `<span class="sg-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" class="rg-bg"/></svg><b>+</b></span><span class="sr-info"><span class="sr-k">Weekly goal</span><b>Set yourself a target</b><span>Hours, distance or rides each week</span></span>`; return; }
  const C = 2 * Math.PI * 15.5;
  el.innerHTML = `<span class="sg-ring${s.met ? ' met' : ''}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" class="rg-bg"/><circle cx="18" cy="18" r="15.5" class="rg-fg" stroke-dasharray="${(s.frac * C).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${Math.round(s.frac * 100)}%</b></span>
    <span class="sr-info"><span class="sr-k">This week${s.streak ? ` · 🔥 ${s.streak} week${s.streak === 1 ? '' : 's'}` : ''}</span><b>${esc(fmtAmount(s.g.k, s.done))} of ${esc(fmtAmount(s.g.k, s.g.v))}</b><span>${s.met ? 'Goal met: nice work!' : `${esc(fmtAmount(s.g.k, s.g.v - s.done))} to go`}</span></span>`;
}
function renderDialog() {
  const g = parse(), t = totals();
  $('goal-kind').value = g?.k || 'time';
  $('goal-amount').value = g ? (g.k === 'time' ? +(g.v / 60).toFixed(1) : g.k === 'dist' ? Math.round(g.v / (U().dist / 1000)) : g.v) : '';
  unitLabel();
  $('goal-totals').innerHTML = MILES.map((m) => {
    const have = t[m.k], got = m.at.filter((v) => have >= v), next = m.at.find((v) => have < v);
    return `<div class="ms-row"><span class="ms-k">${m.k === 'dist' ? fmtDist(have * 1000, 0) : m.k === 'climb' ? `${Math.round(have * U().ele).toLocaleString()} ${U().eleUnit}` : m.k === 'time' ? `${Math.round(have)} h` : have} <small>${m.label}</small></span>
      <span class="ms-badges">${m.at.map((v) => `<i class="${have >= v ? 'got' : ''}" title="${esc(m.fmt(v))}">${have >= v ? '🏅' : '·'}</i>`).join('')}</span>
      <span class="ms-next">${next ? `next: ${esc(m.fmt(next))}` : 'all done!'}${got.length ? '' : ''}</span></div>`;
  }).join('');
}
const unitLabel = () => { $('goal-unit').textContent = { time: 'hours', dist: U().distUnit, rides: 'rides' }[$('goal-kind').value]; };

export function refreshGoals(list) { rides = list || []; renderSide(); }

export function initGoals() {
  $('side-goal').addEventListener('click', () => { renderDialog(); $('dlg-goal').showModal(); });
  $('goal-kind').addEventListener('change', unitLabel);
  $('goal-close').addEventListener('click', () => $('dlg-goal').close());
  const set = (v) => { $('cfg-goal').value = v; store.set('goal', v); saveSetting('goal', v); renderSide(); };
  $('goal-save').addEventListener('click', () => {
    const k = $('goal-kind').value, a = +$('goal-amount').value;
    if (!(a > 0)) { toast('Enter how much each week.', 3000); return; }
    set(`${k}:${k === 'time' ? Math.round(a * 60) : k === 'dist' ? Math.round(a * (U().dist / 1000)) : Math.round(a)}`);
    $('dlg-goal').close();
  });
  $('goal-clear').addEventListener('click', () => { set(''); $('dlg-goal').close(); });
  $('cfg-goal').addEventListener('change', renderSide); // (the account's value arriving at start-up)
  renderSide();
}
