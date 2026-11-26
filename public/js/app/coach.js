// The virtual coach (2026-10-29, the owner: "a whole panel with all of this rich performance data, including coaching
// inside the ride, showing power curve on this ride vs recent, fatigue, freshness ... workout suggestions, route
// suggestions (flat route, you've been climbing lots recently)"). Per account: Rider & kit -> Virtual coach On / Off
// (`coach`); off = no Coach section, nothing in the ride, FTP never changed (body.coach-off hides .coach-only).
// - Setup -> Coach: tiles (fitness, fatigue, form, FTP, critical power, VO2max, fitness age, this week), today's workout
//   and route suggestions, charts (fitness / fatigue, form, power curve, weekly load), power profile, time in zones,
//   recent rides (any can be left out: `coachSkip`). Mid-ride (the Esc panel) it adds "This ride".
// - In the ride: nothing stays on screen. Tips fade in and out in a shaded box (warm-up, W' running low, climbs ahead
//   with a target, new bests, a new FTP, eat and drink, cadence on hard efforts) and every 10 minutes how the ride
//   stands (TSS, IF, NP, form now -> after). The Esc panel's Coach section shows this ride and its power curve.
// - Finish: TSS / IF / NP / decoupling, new bests, form after; a higher FTP is set (or offered, `coachFtp` 'ask').
// The numbers: coach-math.js; per-ride numbers from the server (GET /api/coach, lib/coach.js).
import * as M from '../coach-math.js';
import { BUILT_IN, totalTime } from '../workout.js';
import { DAYS, PLANS, nextMonday, planById, schedule, thisMonday } from '../plans.js';
import { $, api, esc, fmtDist, fmtTime, kg, recorder, route, saveSetting, state, store, toast } from './core.js';
import { modeOf, pickSuggested, suggested } from './setup.js';
import { rideSegments } from './segments.js';
import { rideTime } from './trip.js';
import { wo } from './workouts.js';
import { analyseRide } from './analysis.js';

const DAY = 86400000;
const C = { all: [], rides: [], used: [], series: [], b90: {}, ball: {}, est: null, cp: null, loaded: false };
export const coachOn = () => $('cfg-coach').value !== 'off';
const ftpNow = () => +$('cfg-ftp').value || 250;
const maxHr = () => +$('cfg-maxhr').value || 185;
const sex = () => $('cfg-sex').value || 'm';
const skips = () => new Set(($('cfg-coachskip').value || '').split(',').filter(Boolean));
const wv = (b) => (b == null ? 0 : typeof b === 'object' ? b.w : b);
const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Math.round(x));
const fIF = (x) => (x == null ? '–' : x.toFixed(2));
const hm = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`);
// Coggan's 7 zones: the power dial's colours for 1-6, violet for sprints
export const ZCOL = ['#9aa0a6', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
// chart series (validated for the dark glass: dataviz palette check, 2026-10-29)
const BLUE = '#3d8fe6', PINK = '#e5487f', AMBER = '#c28512';

// ---------- data ----------
async function load() {
  try { C.all = (await api('api/coach')).rides || []; } catch (e) { C.all = []; console.warn('coach', e); }
  try { C.plan = (await api('api/plan')).plan; } catch { C.plan = null; }
  C.loaded = true;
  score();
}
// world-class power for this rider's weight, with room: anything above is a simulator test, not a ride
const impossible = (r) => [[5, 25.18], [60, 11.5], [300, 7.6], [1200, 6.8]].some(([d, wkg]) => wv(r.curve?.[d]) > wkg * kg.rider * 1.15);
function score() {
  const sk = skips();
  C.rides = C.all.map((r) => ({ ...r, ...M.rideLoad(r, r.ftp || ftpNow(), maxHr()), bad: impossible(r), skipped: sk.has(r.id) }));
  C.used = C.rides.filter((r) => !r.bad && !r.skipped);
  C.series = M.fitnessSeries(C.used);
  C.b90 = M.bests(C.used, Date.now() - 90 * DAY);
  C.ball = M.bests(C.used);
  C.est = M.ftpEstimate(C.b90);
  C.cp = M.criticalPower(C.b90);
}
const today = () => C.series.at(-1) || { ctl: 0, atl: 0, tsb: 0 };

// ---------- small SVG charts (one axis each; hover readout) ----------
const svgNS = 'http://www.w3.org/2000/svg';
function chart(el, { xs, series, yMin, yMax, xFmt, tip, bars, logX, yFmt = (v) => Math.round(v), zero }) {
  const W = el.clientWidth || 600, H = 190, L = 38, R = 10, T = 12, B = 24;
  const xmin = xs[0], xmax = xs.at(-1);
  // bar charts: each bar gets its own slot, so the first and last stay inside the frame (the owner: bars escaping the boxes)
  const slot = bars ? (W - L - R) / xs.length : 0, bw = bars ? Math.max(1, Math.min(slot - 3, slot * 0.8)) : 0;
  const sx = (x) => L + slot / 2 + ((logX ? Math.log(x / xmin) / Math.log(xmax / xmin) : (x - xmin) / (xmax - xmin || 1)) * (W - L - R - slot));
  const sy = (y) => T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - T - B);
  let g = '';
  const step = niceStep((yMax - yMin) / 4);
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" class="grid${v === 0 && zero ? ' zero' : ''}"/><text x="${L - 6}" y="${sy(v) + 4}" class="ax" text-anchor="end">${yFmt(v)}</text>`;
  const ticks = xFmt.ticks(xs);
  for (const x of ticks) g += `<text x="${sx(x)}" y="${H - 6}" class="ax" text-anchor="middle">${xFmt.label(x)}</text>`;
  let marks = '';
  if (bars) {
    for (const s of series) s.pts.forEach(([x, y]) => {
      if (!y) return;
      const y0 = sy(Math.max(yMin, 0)), y1 = sy(y), col = typeof s.color === 'function' ? s.color(y) : s.color;
      marks += `<rect x="${sx(x) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="${Math.min(3, bw / 3)}" fill="${col}"/>`;
    });
  } else {
    for (const s of series) {
      const pts = s.pts.filter(([, y]) => y != null);
      if (!pts.length) continue;
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
      if (s.fill) marks += `<path d="${d}L${sx(pts.at(-1)[0])},${sy(yMin)}L${sx(pts[0][0])},${sy(yMin)}Z" fill="${s.color}" opacity=".12"/>`;
      marks += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
      const [lx, ly] = pts.at(-1);
      if (s.label) marks += `<circle cx="${sx(lx)}" cy="${sy(ly)}" r="4" fill="${s.color}" stroke="#0f1422" stroke-width="2"/>`;
    }
  }
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${typeof s.color === 'function' ? s.color(1) : s.color}${s.dash ? ';opacity:.7' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  el.innerHTML = `${legend}<div class="plot"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="${svgNS}">${g}${marks}<line class="cross hidden" y1="${T}" y2="${H - B}"/></svg><div class="tip hidden"></div></div>`;
  const svg = el.querySelector('svg'), cross = el.querySelector('.cross'), tp = el.querySelector('.tip');
  const nearest = (px) => xs.reduce((best, x) => (Math.abs(sx(x) - px) < Math.abs(sx(best) - px) ? x : best), xs[0]);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    if (px < L || px > W - R) return;
    const x = nearest(px), cx = sx(x);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.classList.remove('hidden');
    tp.innerHTML = tip(x); tp.classList.remove('hidden');
    const left = (cx / W) * r.width;
    tp.style.left = `${Math.min(r.width - tp.offsetWidth - 4, Math.max(4, left + 12))}px`;
  });
  svg.addEventListener('pointerleave', () => { cross.classList.add('hidden'); tp.classList.add('hidden'); });
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1e-9, raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
const dateAxis = { ticks: (xs) => xs.filter((x, i) => i % Math.ceil(xs.length / 6) === 0), label: (x) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) };
const durAxis = { ticks: (xs) => xs.filter((d) => [5, 60, 300, 1200, 3600, 7200].includes(d)), label: (d) => M.durLabel(d).replace(' ', '') };

// ---------- a ramp test's heart rate (coach-math rampAnalysis): the finish screen and the Coach section ----------
function rampSvg(r) {
  const pts = r.steps.filter((s) => s.hr), W = 320, H = 150, L = 34, B = 22;
  const x0 = Math.min(...pts.map((s) => s.w)) - 10, x1 = Math.max(...pts.map((s) => s.w)) + 10;
  const y0 = Math.min(...pts.map((s) => s.hr)) - 5, y1 = Math.max(r.peakHr || 0, ...pts.map((s) => s.hr)) + 5;
  const X = (w) => L + ((w - x0) / (x1 - x0)) * (W - L - 6), Y = (hr) => H - B - ((hr - y0) / (y1 - y0)) * (H - B - 8);
  const fit = M.fitLine(pts.map((s) => [s.w, s.hr]));
  const ticks = (a, b, n) => { const st = Math.max(1, Math.round((b - a) / n / 10) * 10 || 10); const out = []; for (let v = Math.ceil(a / st) * st; v <= b; v += st) out.push(v); return out; };
  return `<svg class="ramp-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Heart rate at each ramp step">
    ${ticks(y0, y1, 4).map((v) => `<line x1="${L}" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}" class="rg"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
    ${ticks(x0, x1, 5).map((v) => `<text x="${X(v)}" y="${H - 6}" text-anchor="middle">${v} W</text>`).join('')}
    ${fit ? `<line x1="${X(x0)}" y1="${Y(fit.a + fit.b * x0)}" x2="${X(x1)}" y2="${Y(fit.a + fit.b * x1)}" class="rf"/>` : ''}
    ${r.bend ? `<line x1="${X(r.bend.w)}" x2="${X(r.bend.w)}" y1="8" y2="${H - B}" class="rb"/>` : ''}
    ${pts.map((s) => `<circle cx="${X(s.w)}" cy="${Y(s.hr)}" r="3.6"><title>${s.w} W: ${s.hr} bpm</title></circle>`).join('')}
  </svg>`;
}
function rampHtml(r) {
  if (!r) return '';
  const f = r.ftp, z2 = Math.round(f * 0.75), first = r.steps.find((s) => s.hr), last = [...r.steps].reverse().find((s) => s.hr);
  const vo2 = M.vo2FromMap(r.best60, kg.rider);
  const lines = [
    `<b>Result:</b> best minute <b>${r.best60} W</b>, so FTP ≈ <b>${f} W</b> (75% of it). You held ${r.held} s of the ${r.failW} W step${vo2 ? `; VO2max ≈ <b>${vo2.toFixed(1)}</b> from that minute` : ''}.`,
    first && last && r.slope ? `<b>Heart rate:</b> ${first.hr} bpm at ${first.w} W up to ${last.hr} at ${last.w} W, about <b>${(r.slope * 10).toFixed(1)} bpm per 10 W</b>${r.r2 >= 0.95 ? ', in an almost straight line' : ''}.` : '',
    r.bend ? `<b>Bend:</b> it steepens from about <b>${r.bend.w} W</b> (${r.bend.hr} bpm): a rough marker of your threshold. Heart-rate bends are a hint, not a lab test.`
      : `<b>No bend</b> in the line, so heart rate alone can't place your thresholds here: in 1-minute steps it's always catching up, and thresholds show up in steady efforts (the coach watches those on every ride).`,
    r.levels ? `<b>At the top</b> it levelled off near ${r.peakHr} bpm: close to your maximum.`
      : r.peakHr ? `<b>At the top</b> it was still rising at ${r.peakHr} bpm: your legs stopped before your heart did${(+$('cfg-maxhr').value || 0) && +$('cfg-maxhr').value < r.peakHr ? '' : ', so your real maximum is higher than this'}.` : '',
    r.hrr60 != null ? `<b>Recovery:</b> down <b>${r.hrr60} bpm</b> in the first minute after: ${r.hrr60 >= 40 ? 'excellent' : r.hrr60 >= 25 ? 'good' : r.hrr60 >= 15 ? 'fair' : 'slow (tired, or the cool-down was hard)'} (25+ is good).` : '',
    `<b>What it means:</b> endurance riding (zone 2, the "all day" pace) is up to about <b>${z2} W</b>; ${Math.round(f * 0.88)}-${Math.round(f * 0.94)} W is sweet spot; around ${f} W is about an hour's all-out. A 1-minute step at ${Math.round(f * 0.9)} W feels easy because it ends before it bites.`,
  ].filter(Boolean);
  return `<div class="ramp-box">${rampSvg(r)}<div class="ramp-text">${lines.map((l) => `<p>${l}</p>`).join('')}</div></div>`;
}
function renderRamp() {
  const r = C.rides.find((x) => x.ramp);
  $('cc-ramp').classList.toggle('hidden', !r);
  if (r) $('cc-ramp').innerHTML = `<h3>Ramp test <small>${new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(r.name)}</small></h3>${rampHtml(r.ramp)}`;
}

// ---------- the Coach section ----------
function tile(k, v, sub, cls = '') { return `<div class="ct ${cls}"><span class="ct-k">${k}</span><b class="ct-v">${v}</b><span class="ct-s">${sub}</span></div>`; }
// max heart rate: the setting if you've set it, else the higher of what your rides reached and the age formula
// (Tanaka, 208 - 0.7 x age); the dials' 185 default would push a heart-rate VO2max far too high
function maxHrBest() {
  if (store.get('maxhr', null)) return maxHr();
  const seen = Math.max(0, ...C.used.map((r) => r.maxHr || 0)), born = +$('cfg-born').value;
  const tanaka = born ? Math.round(208 - 0.7 * (new Date().getFullYear() - born)) : 0;
  return Math.max(seen, tanaka) || maxHr();
}
// heart rate against power, last 8 weeks (and the 4 weeks before the last 4, for the trend)
function aerobicNow() {
  const mx = maxHrBest(), all = M.aerobicFit(C.used, mx, Date.now() - 56 * DAY);
  if (!all) return null;
  const hr = Math.round(mx * 0.75 / 5) * 5, now = M.aerobicFit(C.used, mx, Date.now() - 28 * DAY);
  const old = M.aerobicFit(C.used.filter((r) => Date.now() - +new Date(r.date) >= 28 * DAY), mx, Date.now() - 56 * DAY);
  return { ...all, hr, max: mx, now: (now || all).powerAt(hr), before: old ? old.powerAt(hr) : null };
}
function recoveryNow() {
  const v = C.used.filter((r) => r.hrr != null).slice(0, 10).map((r) => r.hrr).sort((a, b) => a - b);
  return v.length ? { v: v[v.length >> 1], n: v.length } : null;
}
// ---------- fitness signals from ordinary riding (2026-11-26) ----------
const since = (days) => C.used.filter((r) => Date.now() - +new Date(r.date) < days * DAY);
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
// recovery after hard efforts, at the same power (bands of 10% of FTP), the last 4 weeks against the 8 before
function recoveryPower() {
  const r = M.recoveryAtPower(C.used.flatMap((x) => (x.hre || []).map((e) => ({ ...e, date: x.date }))), ftpNow());
  return r.compared[0] ? { ...r.compared[0], cmp: true } : r.bands.filter((b) => b.nNow).sort((a, b) => b.nNow - a.nNow)[0] || null;
}
const bandLabel = (b) => `${Math.round(b * 100)}-${Math.round(b * 100) + 10}% of FTP`;
// threshold from where heart rate stops settling in steady blocks, last 8 weeks
const thresholdNow = () => M.thresholdFromBlocks(since(56).flatMap((r) => r.blk || []));
// benchmarks, newest first
const benches = () => C.used.filter((r) => r.bench).map((r) => ({ ...r.bench, date: r.date }));
// each signal: -1 (worse), 0, +1 (better), with what it's based on
function signals() {
  const out = [], A = aerobicNow(), R = recoveryPower(), B = benches();
  if (A?.before) { const d = A.now - A.before; out.push({ v: d >= 3 ? 1 : d <= -3 ? -1 : 0, text: `${sign(d)} W at ${A.hr} bpm` }); }
  if (R?.cmp) { const d = R.now - R.before; out.push({ v: d >= 3 ? 1 : d <= -3 ? -1 : 0, text: `recovery ${sign(d)} bpm at ${bandLabel(R.band)}` }); }
  if (B.length >= 2 && +new Date(B[0].date) - +new Date(B[1].date) < 70 * DAY) { const d = (B[0].wpb / B[1].wpb - 1) * 100; out.push({ v: d > 2 ? 1 : d < -2 ? -1 : 0, text: `benchmark ${d > 0 ? '+' : ''}${d.toFixed(1)}% watts per beat` }); }
  const dr = C.used.filter((r) => r.decoupling != null && r.secs >= 1800).map((r) => r.decoupling);
  if (dr.length >= 6) { const a = med(dr.slice(0, 3)), b = med(dr.slice(3, 6)), d = a - b; out.push({ v: d <= -2 ? 1 : d >= 2 ? -1 : 0, text: `drift ${d > 0 ? '+' : ''}${d.toFixed(1)} points` }); }
  return out;
}
const mondayMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return +d; };

// VO2max from the best source: your watch's figure, a ramp test's best minute, heart rate against power, or (least
// reliable) an all-out-looking best 5 minutes. Each says where it came from.
function vo2Now() {
  const watch = +$('cfg-vo2watch').value;
  if (watch > 20 && watch < 95) return { v: watch, from: 'from your watch (set below)' };
  // (a test stopped early, by a doorbell say, isn't one: a real ramp's best minute is ~120-130% of FTP)
  const ramp = C.used.filter((r) => r.workout === 'Ramp test' && Date.now() - +new Date(r.date) < 90 * DAY && r.curve?.[60] >= (r.ftp || ftpNow()) * 1.05).sort((a, b) => b.curve[60] - a.curve[60])[0];
  if (ramp) return { v: M.vo2FromMap(ramp.curve[60], kg.rider), from: `from your ramp test's best minute (${ramp.curve[60]} W)` };
  const A = aerobicNow();
  if (A) return { v: M.vo2FromMap(A.map, kg.rider), from: `from heart rate against power: ~${A.map} W at your max ${A.max} bpm` };
  const p5 = wv(C.b90[300]);
  if (p5 >= ftpNow() * 1.06) return { v: M.vo2max(p5, kg.rider), from: `rough: from your best 5 min (${p5} W)` };
  return null;
}
function renderTiles() {
  const t = today(), wk = C.series.slice(-8, -1)[0], ramp = wk ? t.ctl - wk.ctl : 0, f = ftpNow();
  const born = +$('cfg-born').value, age = born ? new Date().getFullYear() - born : null;
  const V = vo2Now(), vo2 = V?.v ?? null, fa = M.fitnessAge(vo2, sex());
  const A = aerobicNow(), hrr = recoveryNow();
  const week = C.used.filter((r) => Date.now() - +new Date(r.date) < 7 * DAY);
  const formCls = t.tsb > 5 ? 'good' : t.tsb < -30 ? 'bad' : t.tsb < -10 ? 'warn' : '';
  $('coach-tiles').innerHTML = [
    tile('Fitness', Math.round(t.ctl), `${sign(ramp)} this week · 42-day load`),
    tile('Fatigue', Math.round(t.atl), '7-day load'),
    tile('Form', sign(t.tsb), M.formWord(t.tsb), formCls),
    tile('FTP', `${f}<small> W</small>`, `${(f / kg.rider).toFixed(2)} W/kg${C.est ? ` · rides say ${C.est.ftp} W` : ''}`),
    tile('Critical power', C.cp ? `${C.cp.cp}<small> W</small>` : '–', C.cp ? `W′ ${(C.cp.wPrime / 1000).toFixed(1)} kJ` : 'needs a hard 3-5 min and a 10-20 min effort'),
    tile('VO2max', vo2 ? `${vo2.toFixed(0)}<small> ml/kg/min</small>` : '–', vo2 ? V.from : 'needs steady rides with heart rate, a ramp test, or your watch\'s figure below'),
    tile('Fitness age', fa ? (fa <= 20 ? '20 or under' : fa >= 90 ? '90+' : fa) : '–', fa ? (age ? `you're ${age}: ${fa < age ? `${age - fa} years younger` : fa > age ? `${fa - age} years older` : 'spot on'}` : 'add your year born below') : 'from VO2max, once it shows'),
    tile(`Power at ${A?.hr || '–'} bpm`, A ? `${A.now}<small> W</small>` : '–', A ? (A.before ? `${sign(A.now - A.before)} W on the 4 weeks before: ${A.now > A.before ? 'fitter' : A.now < A.before ? 'tired or less fit' : 'steady'}` : `heart rate against power over ${A.n} steady minutes`) : 'needs steady minutes with heart rate on a few rides'),
    tile('Heart-rate recovery', hrr ? `${hrr.v}<small> bpm</small>` : '–', hrr ? `fall in the minute after a hard effort · median of ${hrr.n} ride${hrr.n === 1 ? '' : 's'}${hrr.v >= 30 ? ' · very good' : hrr.v >= 20 ? ' · good' : ''}` : 'shows after rides with a hard effort and an easy minute after'),
    (() => { const R = recoveryPower();
      return tile('Recovery at power', R ? `${R.now}<small> bpm</small>` : '–', R ? (R.cmp ? `after hard efforts at ${bandLabel(R.band)} · ${sign(R.now - R.before)} on the 8 weeks before: ${R.now > R.before ? 'recovering faster' : R.now < R.before ? 'slower (tired?)' : 'the same'}` : `after hard efforts at ${bandLabel(R.band)} · ${R.nNow} in 4 weeks; compares once there are older ones`) : 'needs hard efforts of 2 min+ followed by an easy minute'); })(),
    (() => { const T = thresholdNow();
      return tile('Threshold (heart rate)', T ? `${T.w}<small> W</small>` : '–', T ? `heart rate settles up to ${T.settledUpTo} W and keeps climbing from ${T.climbsFrom} W (${T.n} steady blocks, 8 weeks) · FTP ${f} W` : 'from steady blocks of 5 min+: needs some where heart rate settles and some where it keeps climbing (sweet spot and threshold intervals)'); })(),
    (() => { const B = benches();
      if (!B.length) return tile('Benchmark', '–', 'ride the Benchmark 20 workout every few weeks: the same watts each time, so your heart rate shows your fitness');
      const b = B[0], p = B[1], d = p ? (b.wpb / p.wpb - 1) * 100 : null;
      return tile('Benchmark', `${b.hr}<small> bpm at ${b.w} W</small>`, `${new Date(b.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · drift ${b.drift}%${p ? ` · ${d > 0 ? '+' : ''}${d.toFixed(1)}% watts per beat on ${new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${d > 2 ? 'fitter' : d < -2 ? 'less fit or tired' : 'about the same'}` : ' · the first: the next one compares'}`, d > 2 ? 'good' : d < -2 ? 'warn' : ''); })(),
    (() => { const S = signals(), cap = M.capacity(t.ctl, t.tsb, S.map((x) => x.v)), done = C.used.filter((r) => +new Date(r.date) >= mondayMs()).reduce((a, r) => a + r.tss, 0), left = Math.max(0, cap.tss - done);
      const why = S.length ? S.map((x) => `${x.v > 0 ? '▲' : x.v < 0 ? '▼' : '•'} ${x.text}`).join(' · ') : 'no heart-rate trends yet: set from fitness and form';
      return tile('Capacity this week', `${cap.tss}<small> TSS</small>`, cap.kind === 'rest' ? `a lighter week: form ${sign(t.tsb)} is very low · ${done} done` : `${cap.kind} (fitness +${cap.rate} a week) · ${done} done, ${left ? `~${(left / 50).toFixed(1)} h of steady riding left` : 'all done'} · ${why}`, cap.kind === 'rest' ? 'warn' : ''); })(),
    tile('This week', `${week.reduce((s, r) => s + r.tss, 0)}<small> TSS</small>`, `${hm(week.reduce((s, r) => s + r.secs, 0))} · ${week.length} ride${week.length === 1 ? '' : 's'}`),
  ].join('');
}

function suggestions() {
  const t = today(), now = Date.now(), f = ftpNow();
  const recent = C.used.filter((r) => now - +new Date(r.date) < 14 * DAY);
  const z = recent.reduce((acc, r) => M.zoneSeconds(r.hist, f).map((s, i) => acc[i] + s), [0, 0, 0, 0, 0, 0, 0]), tot = z.reduce((a, b) => a + b, 0);
  const lastTest = C.used.find((r) => wv(r.curve?.[1200]) >= f * 0.97);
  const work = M.suggestWorkout({
    tsb: t.tsb, rides: C.used, hiShare: tot ? (z[3] + z[4] + z[5] + z[6]) / tot : 0,
    ftpTestAgeDays: lastTest ? (now - +new Date(lastTest.date)) / DAY : Infinity,
    hasVo2Recently: recent.some((r) => wv(r.curve?.[300]) >= f * 1.06),
    ...(() => { // (2026-11-26) the heart-rate signals
      const S = signals(), B = benches(), dr = C.used.filter((r) => r.decoupling != null && r.secs >= 1800).slice(0, 3).map((r) => r.decoupling);
      const long = C.used.find((r) => (r.blk || []).some(([, , m]) => m >= 30) || (r.secs >= 3600 && (r.IF ?? 1) < 0.8));
      return { response: S.reduce((a, x) => a + x.v, 0), worse: S.filter((x) => x.v < 0).map((x) => x.text), drift: dr.length >= 3 ? med(dr) : null,
        longSteadyDays: long ? (now - +new Date(long.date)) / DAY : Infinity, benchAgeDays: B.length ? (now - +new Date(B[0].date)) / DAY : Infinity };
    })(),
  });
  const dist = recent.reduce((s, r) => s + (r.distance || 0), 0);
  const km = C.used.slice(0, 10).map((r) => (r.distance || 0) / 1000).filter((x) => x > 2).sort((a, b) => a - b);
  // candidates: classic and photoreal routes, and each open world's pre-plotted rides (the world itself is hundreds of km
  // of roads, not a ride); the best one or two of each kind
  const cands = [];
  for (const r of suggested) {
    if (r.open) { for (const x of r.rides || []) if (x.km && x.gain != null) cands.push({ id: r.id + '|' + x.id, name: x.name, km: x.km, gain: x.gain, where: r.name.replace(/\s*\(open world\)/i, ''), open: true }); }
    else if (r.km && r.gain != null) cands.push(r);
  }
  const routes = M.suggestRoutes(cands, {
    tsb: t.tsb, recentMperKm: dist > 10000 ? recent.reduce((s, r) => s + (r.climbing || 0), 0) / (dist / 1000) : null,
    typicalKm: km.length ? km[Math.floor(km.length / 2)] : 25,
    kindOf: (r) => (r.open ? 'open' : modeOf(r)), kinds: ['open', 'routes', 'photo'], perKind: 2,
  });
  return { work, routes };
}
function renderSuggest() {
  const { work, routes } = suggestions(), w = BUILT_IN.find((x) => x.id === work.id), S = planNow(), t = today();
  // with a plan, today's session (or a catch-up) leads; when you're very tired it offers the easy option instead
  const s = S?.today || S?.catchUp;
  const planRow = s ? `<div class="sg-row plan"><span class="sg-k"><svg class="ic"><use href="#i-history"/></svg>Your plan</span><span class="sg-main"><b>${esc(s.name)}</b> <span class="sg-meta">${esc(S.plan.name)} · week ${s.week}</span><span class="note">${s === S.catchUp ? `Missed on ${dayName(s.date)}: ride it today instead?` : s.kind === 'ride' ? esc(s.note) + '.' : 'Today\'s session.'}${s.kind === 'workout' && s.id !== 'recovery' && t.tsb < -30 ? ` Form ${sign(t.tsb)}: you're very tired. Swap it for an easy spin?` : ''}</span></span>${s === S.catchUp ? `<button class="small primary" data-plan-catch="${s.key}">Ride it today</button>` : `<button class="small primary" data-plan-choose="${s.key}">Choose it</button>`}${s.kind === 'workout' && s.id !== 'recovery' && t.tsb < -30 && s !== S.catchUp ? `<button class="small" data-plan-swap="${s.key}">Swap</button>` : ''}</div>` : '';
  const rest = S && !s && S.current ? `<div class="sg-row plan"><span class="sg-k"><svg class="ic"><use href="#i-history"/></svg>Your plan</span><span class="sg-main"><b>Rest day</b> <span class="sg-meta">${esc(S.plan.name)} · week ${S.week}</span><span class="note">Next: ${esc(S.current.name)} on ${dayName(S.current.date)}. If you ride today, keep it easy so that one counts.</span></span><button class="small" data-wo="recovery">Easy spin</button></div>` : '';
  $('cc-suggest').innerHTML = `<h3>Today <small>${S ? 'from your plan, your form and what you\'ve ridden lately' : 'from your form and what you\'ve ridden lately'}</small></h3>
    ${planRow || rest || `<div class="sg-row"><span class="sg-k"><svg class="ic"><use href="#i-zap"/></svg>Workout</span><span class="sg-main"><b>${esc(w?.name || work.id)}</b><span class="note">${esc(work.why)}</span></span><button class="small" data-wo="${esc(work.id)}">Choose it</button></div>`}
    ${routes.map((r, i) => `<div class="sg-row"><span class="sg-k">${i && routes[i - 1].kind === r.kind ? '' : `<svg class="ic"><use href="#i-map"/></svg>${{ open: 'Open world', routes: 'Classic', photo: 'Photoreal' }[r.kind] || 'Routes'}`}</span><span class="sg-main"><b>${esc(r.name)}</b> <span class="sg-meta">${r.kind === 'open' && r.where ? esc(r.where) + ' · ' : ''}${fmtDist(r.km * 1000)} · ${Math.round(r.gain)} m up</span><span class="note">${esc(r.why[0].toUpperCase() + r.why.slice(1))}</span></span><button class="small" data-route="${esc(r.id)}">Ride this</button></div>`).join('')}`;
}

// ---------- training plan ----------
const WORKOUTS = Object.fromEntries(BUILT_IN.map((w) => [w.id, { name: w.name, secs: totalTime(w.steps) }]));
const planNow = () => (C.plan ? schedule(C.plan, C.rides, WORKOUTS) : null);
const dayName = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
const savePlan = async (plan) => { try { C.plan = (await api('api/plan', { method: 'PUT', body: JSON.stringify(plan) })).plan; } catch (e) { toast('Could not save the plan: ' + e.message); } renderCoach(); };
let picking = null; // the plan whose start form is open
function renderPlan() {
  const S = planNow(), el = $('cc-plan');
  if (!S) {
    el.innerHTML = `<h3>Training plan <small>a few weeks of sessions on your riding days; the coach keeps you on track</small></h3><div class="plans">${PLANS.map((p) => `<div class="plan-card${picking === p.id ? ' open' : ''}">
      <b>${esc(p.name)}</b> <span class="sg-meta">${p.weeks} weeks · 3 rides a week</span><p class="note">${esc(p.blurb)}</p>
      ${picking === p.id ? `<div class="plan-form"><label>Start <select id="plan-start"><option value="${nextMonday()}">Next week (${dayName(nextMonday())})</option><option value="${thisMonday()}">This week (${dayName(thisMonday())})</option></select></label>
        <div class="plan-days"><span class="note">Your three riding days (the last gets the long session):</span>${DAYS.map((d, i) => `<label class="check"><input type="checkbox" data-day="${i}" ${[1, 3, 6].includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
        <button class="small primary" data-plan-go="${p.id}">Start ${esc(p.name)}</button> <button class="small" data-plan-cancel="1">Cancel</button></div>` : `<button class="small" data-plan-pick="${p.id}">Choose this plan</button>`}</div>`).join('')}</div>`;
    return;
  }
  const weeks = [];
  for (const s of S.list) (weeks[s.week - 1] ||= []).push(s);
  const icon = { done: '✓', missed: '✗', today: '●', upcoming: '', skipped: '–' };
  el.innerHTML = `<h3>${esc(S.plan.name)} <small>${S.finished ? 'finished: well done!' : `week ${S.week} of ${S.plan.weeks}`} · ${S.done} of ${S.total} sessions done</small></h3>
    <div class="plan-prog"><i style="width:${((S.done / S.total) * 100).toFixed(1)}%"></i></div>
    <div class="plan-weeks">${weeks.map((wk, i) => `<div class="plan-week${i + 1 === S.week ? ' now' : ''}"><span class="pw-k">Week ${i + 1}${(i + 1) % 4 === 0 || i + 1 === S.plan.weeks ? ' <small>easy</small>' : ''}</span>${wk.map((s) => `<span class="ps ${s.status}" title="${esc(s.kind === 'ride' ? s.note : s.name)}${s.moved ? ' (moved)' : ''}${s.swapped ? ' (swapped)' : ''}"><i>${icon[s.status]}</i><em>${dayName(s.date)}</em>${esc(s.name)}</span>`).join('')}</div>`).join('')}</div>
    <p class="note">A session counts when you ride that workout (or a ride at least 70% as long) on its day or before the next one.${S.current ? ` Next: <b>${esc(S.current.name)}</b> on ${dayName(S.current.date)}.` : ''} <button class="small" data-plan-stop="1">Stop this plan</button></p>`;
}
async function planClick(b) {
  const S = planNow(), find = (k) => S?.list.find((s) => s.key === k);
  if (b.dataset.planPick) { picking = b.dataset.planPick; renderPlan(); }
  if (b.dataset.planCancel) { picking = null; renderPlan(); }
  if (b.dataset.planGo) {
    const days = [...$('cc-plan').querySelectorAll('[data-day]:checked')].map((x) => +x.dataset.day);
    if (days.length !== 3) { toast('Pick three days.', 3000); return; }
    picking = null;
    await savePlan({ id: b.dataset.planGo, start: $('plan-start').value, days });
    toast(`${planById(b.dataset.planGo).name} starts ${dayName(C.plan.start)}.`, 4000);
  }
  if (b.dataset.planStop && confirm('Stop this plan? Your rides stay as they are.')) { await savePlan(null); }
  if (b.dataset.planChoose) chooseSession(find(b.dataset.planChoose));
  if (b.dataset.planCatch) { const s = find(b.dataset.planCatch); await savePlan({ ...C.plan, moved: { ...C.plan.moved, [s.key]: new Date().toLocaleDateString('sv') } }); chooseSession(s); }
  if (b.dataset.planSwap) { await savePlan({ ...C.plan, swaps: { ...C.plan.swaps, [b.dataset.planSwap]: 'recovery' } }); chooseSession(planNow()?.list.find((s) => s.key === b.dataset.planSwap)); }
}
function chooseSession(s) {
  if (!s) return;
  const sel = $('cfg-workout');
  sel.value = s.kind === 'workout' ? 'b:' + s.id : '';
  sel.dispatchEvent(new Event('change'));
  toast(s.kind === 'workout' ? `Workout: ${s.name}` : `${s.name}: ${s.note}. Pick a route (the coach suggests some).`, 4000);
}

function renderCharts() {
  const s90 = C.series.slice(-90);
  if (s90.length >= 2) {
    const xs = s90.map((d) => +new Date(d.date)), top = Math.max(10, ...s90.map((d) => Math.max(d.ctl, d.atl))) * 1.1;
    const at = (x) => s90.find((d) => +new Date(d.date) === x);
    chart($('ch-fit'), { xs, yMin: 0, yMax: top, xFmt: dateAxis,
      series: [{ name: 'Fitness (42 days)', color: BLUE, pts: s90.map((d) => [+new Date(d.date), d.ctl]), fill: true, label: true },
        { name: 'Fatigue (7 days)', color: PINK, pts: s90.map((d) => [+new Date(d.date), d.atl]), label: true }],
      tip: (x) => { const d = at(x); return `<b>${dateAxis.label(x)}</b><span><i style="background:${BLUE}"></i>Fitness ${d.ctl.toFixed(1)}</span><span><i style="background:${PINK}"></i>Fatigue ${d.atl.toFixed(1)}</span><span>TSS that day ${d.tss}</span>`; } });
    const lim = Math.max(15, ...s90.map((d) => Math.abs(d.tsb))) * 1.1;
    chart($('ch-form'), { xs, yMin: -lim, yMax: lim, xFmt: dateAxis, bars: true, zero: true, yFmt: (v) => sign(v),
      series: [{ name: 'Form', color: (y) => (y >= 0 ? BLUE : PINK), pts: s90.map((d) => [+new Date(d.date), d.tsb]) }],
      tip: (x) => { const d = at(x); return `<b>${dateAxis.label(x)}</b><span>Form ${sign(d.tsb)} · ${M.formWord(d.tsb)}</span>`; } });
  } else for (const id of ['ch-fit', 'ch-form']) $(id).innerHTML = '<p class="note">Ride a couple of days and this fills in.</p>';
  drawCurve($('ch-curve'));
  // weekly load: 12 weeks, Monday to Sunday
  const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => { const a = +mon - (11 - i) * 7 * DAY; const rs = C.used.filter((r) => +new Date(r.date) >= a && +new Date(r.date) < a + 7 * DAY); return { a, tss: rs.reduce((s, r) => s + r.tss, 0), secs: rs.reduce((s, r) => s + r.secs, 0), n: rs.length }; });
  chart($('ch-weeks'), { xs: weeks.map((w) => w.a), yMin: 0, yMax: Math.max(100, ...weeks.map((w) => w.tss)) * 1.1, xFmt: dateAxis, bars: true,
    series: [{ name: 'TSS', color: BLUE, pts: weeks.map((w) => [w.a, w.tss]) }],
    tip: (x) => { const w = weeks.find((q) => q.a === x); return `<b>Week of ${dateAxis.label(x)}</b><span>${w.tss} TSS · ${hm(w.secs)} · ${w.n} ride${w.n === 1 ? '' : 's'}</span>`; } });
}
// power curve: last 90 days, all time, and this ride (while riding / after)
function drawCurve(el) {
  const live = rideNow();
  // (all time only where it differs from the last 90 days: otherwise one line hid the other)
  const older = M.DURS.some((d) => wv(C.ball[d]) > wv(C.b90[d]));
  const sets = [['Last 90 days', BLUE, C.b90], ...(older ? [['All time', AMBER, C.ball]] : []), ...(live ? [['This ride', PINK, live.curve]] : [])].filter(([, , b]) => Object.keys(b || {}).length);
  if (!sets.length) { el.innerHTML = '<p class="note">Your best efforts show here once you have a ride with power.</p>'; return; }
  const xs = M.DURS.filter((d) => sets.some(([, , b]) => b[d]));
  if (xs.length < 2) { el.innerHTML = '<p class="note">A few minutes more and your curve appears.</p>'; return; }
  const top = Math.max(...sets.flatMap(([, , b]) => xs.map((d) => wv(b[d])))) * 1.08;
  chart(el, { xs, yMin: 0, yMax: top, xFmt: durAxis, logX: true, yFmt: (v) => `${Math.round(v)}`,
    series: sets.map(([name, color, b]) => ({ name, color, pts: xs.map((d) => [d, b[d] ? wv(b[d]) : null]), dash: name === 'All time', label: true })),
    tip: (d) => `<b>${M.durLabel(d)}</b>${sets.map(([name, color, b]) => `<span><i style="background:${color}"></i>${name} ${b[d] ? `${wv(b[d])} W · ${(wv(b[d]) / kg.rider).toFixed(1)} W/kg` : '–'}</span>`).join('')}` });
}

function renderProfile() {
  const rows = [[5, '5 s', 5], [60, '1 min', 60], [300, '5 min', 300], ['ftp', 'FTP', null]];
  $('cc-profile').innerHTML = rows.map(([key, label, d]) => {
    const w = d ? wv(C.b90[d]) : ftpNow();
    if (!w) return `<div class="pp-row"><span class="pp-k">${label}</span><span class="pp-bar"></span><span class="pp-v">–</span></div>`;
    const wkg = w / kg.rider, { f, level } = M.profileLevel(wkg, key, sex());
    return `<div class="pp-row"><span class="pp-k">${label}</span><span class="pp-bar"><i style="width:${(f * 100).toFixed(1)}%"></i></span><span class="pp-v"><b>${wkg.toFixed(2)}</b> W/kg · ${level}</span></div>`;
  }).join('') + `<p class="note">Best of the last 90 days; FTP is the one you've set.${$('cfg-sex').value ? '' : ' Set your sex below for the right table.'}</p>`;
}
function renderZones() {
  const recent = C.used.filter((r) => Date.now() - +new Date(r.date) < 28 * DAY), f = ftpNow();
  const z = recent.reduce((acc, r) => M.zoneSeconds(r.hist, f).map((s, i) => acc[i] + s), [0, 0, 0, 0, 0, 0, 0]), tot = z.reduce((a, b) => a + b, 0);
  if (!tot) { $('cc-zones').innerHTML = '<p class="note">No rides with power in the last 28 days.</p>'; return; }
  $('cc-zones').innerHTML = `<div class="zbar">${z.map((s, i) => (s ? `<i style="flex:${s};background:${ZCOL[i]}" title="Z${i + 1} ${M.ZONES[i].name}: ${hm(s)}"></i>` : '')).join('')}</div>
    <div class="zlist">${z.map((s, i) => `<span><i style="background:${ZCOL[i]}"></i>Z${i + 1} ${M.ZONES[i].name}<b>${hm(s)}</b><em>${Math.round((s / tot) * 100)}%</em></span>`).join('')}</div>`;
}
function renderRides() {
  const rows = C.rides.slice(0, 12);
  if (!rows.length) { $('cc-rides').innerHTML = '<p class="note">No rides yet. Every ride you keep shows up here.</p>'; return; }
  $('cc-rides').innerHTML = `<table class="cc-table"><thead><tr><th>Date</th><th>Ride</th><th>Time</th><th title="Training stress">TSS</th><th title="Intensity factor">IF</th><th title="Normalized power">NP</th><th title="Power per heartbeat, second half against first (Pw:HR)">Drift</th><th></th></tr></thead><tbody>${rows.map((r) => {
    const out = r.bad || r.skipped;
    return `<tr class="${out ? 'out' : ''}" data-analyse="${r.id}" title="Click for the full analysis"><td>${new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td><td>${esc(r.name)}${r.bad ? ' <small>left out: power beyond world class (a simulator test?)</small>' : r.skipped ? ' <small>left out</small>' : ''}</td><td>${hm(r.secs)}</td><td>${r.tss}</td><td>${fIF(r.IF)}</td><td>${r.np || '–'}</td><td>${r.decoupling == null ? '–' : `${r.decoupling}%`}</td><td>${r.bad ? '' : `<button class="small" data-skip="${r.id}" title="${r.skipped ? 'Count this ride again' : 'Leave this ride out of the coach'}">${r.skipped ? '↺' : '×'}</button>`}</td></tr>`;
  }).join('')}</tbody></table>`;
}

// for the ride analysis (analysis.js): your bests over the last 90 days, loading the rides once if the coach hasn't
export async function bests90() {
  if (!C.loaded) await load();
  return C.b90;
}

export function renderCoach() {
  document.body.classList.toggle('coach-off', !coachOn());
  if (!coachOn() || !C.loaded) return;
  score();
  renderTiles(); renderPlan(); renderSuggest(); renderRamp(); renderCharts(); renderProfile(); renderZones(); renderRides(); renderRideBlock();
}

// ---------- in the ride ----------
const live = { t: 0, m: null, wbal: null, said: {}, lastSay: 0, bests: new Set(), ftpSaid: false, warm: true, low: false, climbs: new Set(), cadLow: 0 };
function rideNow() {
  if (!(state.elapsed > 0) || recorder.samples.length < 10) return null;
  return live.m;
}
function measure() {
  const s = recorder.samples;
  if (s.length < 10) { live.m = null; return; }
  const sec = M.toSeconds(s), m = M.rideNumbers(sec), L = M.rideLoad(m, ftpNow(), maxHr());
  live.m = { ...m, ...L, est: M.ftpEstimate(m.curve) };
}
function say(key, text, gap = 300) {
  const now = performance.now();
  if (!coachOn() || state.film) return;
  if (now - (live.said[key] || -1e9) < gap * 1000 || now - live.lastSay < 25000) return;
  live.said[key] = now; live.lastSay = now;
  const el = $('coach-say');
  el.innerHTML = `<span class="cs-k">Coach</span>${text}`;
  el.classList.remove('hidden', 'out');
  clearTimeout(live.sayTimer);
  live.sayTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.classList.add('hidden'), 400); }, 10000);
}
// each frame from the ride loop. Nothing stays on screen (the owner: "some text in a transparent/shaded box that fades in
// and out"): tips, and every 10 minutes how the ride stands, fade in and out in #coach-say.
export function updateCoach(watts, dt, cadence) {
  if (!coachOn() || !route || !(state.elapsed > 0) || state.finished) return;
  const cp = C.cp?.cp || ftpNow(), wp = C.cp?.wPrime || 20000;
  if (live.wbal === null) live.wbal = wp;
  if (state.riding) live.wbal = M.wbalStep(live.wbal, watts, cp, wp, Math.min(1, dt));
  const now = performance.now();
  if (now - live.t < 2000) return;
  live.t = now;
  measure();
  tips(watts, cadence, live.wbal / wp, cp);
  const m = live.m, step = Math.floor(state.elapsed / 600);
  if (m && step > (live.step ?? 0) && state.riding) {
    live.step = step;
    const t = today(), after = M.afterRide(t, m.tss);
    say('status' + step, `<b>${hm(state.elapsed)}</b> · TSS ${m.tss}${m.IF ? ` · IF ${fIF(m.IF)}` : ''} · NP ${m.np} W · form ${sign(t.tsb)} → ${sign(after.tsb)}`, 0);
  }
}
// the ramp test: what to do, the step you're on, and a push near the end (no FTP guesses: the test decides)
function rampTips() {
  const t = state.elapsed + wo.offset;
  if (state.rampResult) return;
  if (t < 240) { say('ramp-start', 'Ramp test: an easy 5-minute warm-up, then the target rises every minute. Ride in <b>ERG</b>, keep your cadence steady (85-95) and go until you can\'t turn it. It ends by itself.', 9999); return; }
  if (t >= 290 && t < 300) { say('ramp-go', 'Warm-up done: the ramp starts now. Settle in; the first steps are easy.', 9999); return; }
  const k = Math.floor((t - 300) / 60) + 1, target = state.woTarget, f = ftpNow();
  if (k >= 1 && t - 300 - (k - 1) * 60 < 8 && target) {
    const r = target / f;
    const msg = r < 0.85 ? `Step ${k}: <b>${target} W</b>. Easy for now: relax your shoulders, smooth pedalling.`
      : r < 1.05 ? `Step ${k}: <b>${target} W</b>. Getting real: breathe deep and keep the cadence up.`
      : r < 1.25 ? `Step ${k}: <b>${target} W</b>. This is the test now: one minute at a time.`
      : `Step ${k}: <b>${target} W</b>. Everything you've got: spin it, don't grind it!`;
    say('ramp' + k, msg, 9999);
  }
}
function tips(watts, cadence, wb, cp) {
  const m = live.m, f = ftpNow(), s = recorder.samples, el = state.elapsed;
  if (!state.riding || !m) return;
  const p30 = s.slice(-30).reduce((a, x) => a + (x.power || 0), 0) / Math.min(30, s.length);
  const workout = document.getElementById('wo-panel') && !$('wo-panel').classList.contains('hidden');
  if (el < 600 && !workout && p30 > f * 0.9 && el > 60) say('warm', `Easy does it: keep the first 10 minutes under <b>${Math.round(f * 0.75)} W</b>, and the hard bits later go better.`, 600);
  // (in a workout the workout sets the watts: no "ease off" or climb targets; the ramp test has its own words)
  if (workout && wo.ramp) { rampTips(); return; }
  if (wb < 0.25 && !live.low && !workout) { live.low = true; say('wlow', `W′ is down to <b>${Math.round(wb * 100)}%</b>. Ease below <b>${cp} W</b> for a minute to refill it.`, 120); }
  if (wb > 0.8 && live.low) { live.low = false; say('wback', 'W′ is back above 80%: ready for another effort.', 120); }
  // climbs ahead (the route's climb segments): a target from your power curve for about how long it takes
  for (const sg of rideSegments()) {
    if (sg.kind !== 'climb' || live.climbs.has(sg.id) || workout) continue;
    const ahead = sg.startM - state.dist;
    if (ahead < 0 || ahead > 500) continue;
    live.climbs.add(sg.id);
    const secs = rideTime(sg.startM, sg.endM).t, best = M.curveAt(C.b90, secs) || f, target = Math.round(Math.min(best * 0.95, C.cp ? C.cp.cp + C.cp.wPrime / secs : f * 1.05));
    say('climb' + sg.id, `<b>${esc(sg.name)}</b> in ${Math.round(ahead)} m: about ${hm(secs)} of climbing. Aim for <b>~${target} W</b> and save a little for the top.`, 0);
  }
  // new bests against the last 90 days (a minute and longer), and FTP
  for (const d of [60, 300, 1200, 3600]) {
    const w = m.curve[d], old = wv(C.b90[d]);
    if (w && old && w > old && !live.bests.has(d)) { live.bests.add(d); say('best' + d, `New ${M.durLabel(d)} best: <b>${w} W</b> (was ${old}). 🎉`, 0); }
  }
  if (m.est && m.est.ftp > f * 1.02 && !live.ftpSaid) { live.ftpSaid = true; say('ftp', `That says your FTP is about <b>${m.est.ftp} W</b> (set: ${f}). ${$('cfg-coachftp').value === 'ask' ? "I'll ask at the finish." : "I'll update it when you finish."}`, 0); }
  if (el > 3600) say('fuel', `${hm(el)} in: time to eat something and drink.`, 2700);
  if (watts > f && cadence > 0 && cadence < 65) { if ((live.cadLow += 2) >= 30) { live.cadLow = 0; say('cad', `Cadence ${Math.round(cadence)} on a hard effort: a lighter gear and a little faster spin saves your legs.`, 600); } } else live.cadLow = 0;
}
// mid-ride (Esc panel): this ride at the top of the Coach section
function renderRideBlock() {
  const m = rideNow(), el = $('coach-ride');
  el.classList.toggle('hidden', !m || state.finished);
  if (!m || state.finished) return;
  const t = today(), after = M.afterRide(t, m.tss);
  el.innerHTML = `<h3>This ride so far</h3><div class="coach-tiles">${[
    tile('TSS', m.tss, `IF ${fIF(m.IF)}`), tile('Normalized power', `${m.np}<small> W</small>`, `average ${m.avgPower} W`), tile('Work', `${m.kj}<small> kJ</small>`, hm(m.secs)),
    tile('Form after', sign(after.tsb), `now ${sign(t.tsb)}`)].join('')}</div>
    <div class="coach-card wide"><h3>Power curve <small>this ride against your last 90 days</small></h3><div id="cc-live-curve" class="chart"></div></div>`;
  drawCurve($('cc-live-curve'));
}

// ---------- the finish ----------
export function coachFinish() {
  const box = $('finish-coach');
  measure();
  const m = live.m, f = ftpNow();
  state.rideFtp = f; // (the ride is saved after this: it keeps the FTP it was ridden at, not a new one)
  // a ramp test's result (workouts.js) is a measurement: it sets FTP up or down, coach or not (with the coach off, it asks)
  const test = !state.simUsed && state.rampResult ? { ftp: state.rampResult.ftp, from: `75% of your best minute in the ramp test, ${state.rampResult.best60} W`, test: true } : null;
  // A ramp reading well above what your longer efforts show (the owner 2026-11-03: "my short term power is a lot higher than
  // longer term ... could well push my FTP too high"): ramp tests read high for riders with a strong anaerobic kick, so
  // more than 5% over the best 20 min / hour of the last 90 days is never applied by itself: use it, the middle, or keep.
  const longer = test && C.loaded ? M.ftpEstimate(C.b90) : null;
  if (test && longer && test.ftp > longer.ftp * 1.05) {
    box.classList.remove('hidden');
    const mid = Math.round((test.ftp + longer.ftp) / 2);
    const html = `<h3><svg class="ic"><use href="#i-trend"/></svg> Ramp test</h3><p class="note" id="coach-ftp-msg">The ramp says <b>${test.ftp} W</b> (${esc(test.from)}), but ${esc(longer.from)} in the last 90 days points to about <b>${longer.ftp} W</b>. Ramp tests read high for riders with a strong short-term punch; a paced 20-minute test (FTP test) settles it. Your FTP is ${f} W now:<br>
      <button class="small" data-ftp="${test.ftp}">Use the ramp's ${test.ftp} W</button> <button class="small primary" data-ftp="${mid}">Use ${mid} W (between)</button> <button class="small" data-ftp="${f}">Keep ${f} W</button></p>`;
    if (!coachOn() || !m) box.innerHTML = html;
    else box.dataset.ramp = html; // (put in after the coach's tiles, below)
    const wire = () => box.querySelectorAll('[data-ftp]').forEach((b) => b.addEventListener('click', () => { const w = +b.dataset.ftp; if (w !== f) setFtp(w, f); else $('coach-ftp-msg').innerHTML = `Kept at <b>${f} W</b>.`; }));
    if (!coachOn() || !m) { box.insertAdjacentHTML('beforeend', rampFinishHtml()); wire(); return; }
    test.held = wire; // (the coach's block below draws it)
  }
  if (!coachOn() || !m) {
    box.classList.toggle('hidden', !test);
    if (test) {
      box.innerHTML = `<h3><svg class="ic"><use href="#i-trend"/></svg> Ramp test</h3><p class="note" id="coach-ftp-msg">Your FTP is <b>${test.ftp} W</b> (${esc(test.from)}); it's set at ${f} W now. <button class="small primary" id="coach-ftp-yes">Use it</button></p>${rampFinishHtml()}`;
      $('coach-ftp-yes').addEventListener('click', () => setFtp(test.ftp, f));
    }
    return;
  }
  box.classList.remove('hidden');
  const t = today(), after = M.afterRide(t, m.tss);
  const bests = state.simUsed ? [] : [5, 60, 300, 1200, 3600].filter((d) => m.curve[d] && m.curve[d] > wv(C.b90[d]) && wv(C.b90[d])).map((d) => `${M.durLabel(d)} <b>${m.curve[d]} W</b>`);
  const higher = test?.held ? null : test && test.ftp !== f ? test : !state.simUsed && m.est && m.est.ftp > f * 1.02 ? m.est : null;
  box.innerHTML = `<h3><svg class="ic"><use href="#i-trend"/></svg> Coach</h3><div class="coach-tiles">${[
    tile('TSS', m.tss, m.from === 'heart rate' ? 'from heart rate' : `IF ${fIF(m.IF)}`), tile('Normalized power', `${m.np || '–'}<small> W</small>`, `${m.kj} kJ`),
    state.simUsed ? tile('Form', sign(t.tsb), "simulator rides don't count") : tile('Form', `${sign(t.tsb)} → ${sign(after.tsb)}`, M.formWord(after.tsb)),
    tile('Drift', m.decoupling == null ? '–' : `${m.decoupling}%`, m.decoupling == null ? 'rides of 20 min+ with HR' : m.decoupling < -5 ? 'uneven ride: drift reads best on steady ones' : m.decoupling < 5 ? 'steady: good aerobic base' : 'power per beat fell: fatigue, heat or fuel')].join('')}</div>
    ${bests.length ? `<p class="note">New bests (last 90 days): ${bests.join(' · ')} 🎉</p>` : ''}
    ${higher ? `<p class="note" id="coach-ftp-msg">${higher.test ? 'Ramp test: your FTP is' : 'Your FTP looks like'} <b>${higher.ftp} W</b> (${esc(higher.from)}), ${higher.ftp >= f ? 'up' : 'down'} from ${f} W. ${$('cfg-coachftp').value === 'ask' || higher.ftp < f ? '<button class="small primary" id="coach-ftp-yes">Use it</button>' : ''}</p>` : ''}`;
  if (test?.held) { box.insertAdjacentHTML('beforeend', box.dataset.ramp.replace(/^<h3>.*?<\/h3>/, '')); test.held(); }
  if (test) box.insertAdjacentHTML('beforeend', rampFinishHtml());
  // (a lower FTP is always asked about: a test stopped early, by a doorbell say, mustn't drop it by itself)
  if (higher) {
    if ($('cfg-coachftp').value === 'ask' || higher.ftp < f) $('coach-ftp-yes').addEventListener('click', () => setFtp(higher.ftp, f));
    else setFtp(higher.ftp, f);
  }
}
function rampFinishHtml() {
  const s = recorder.samples, r = M.rampAnalysis(s.map((x) => x.power || 0), s.map((x) => x.hr || 0), state.rideFtp || ftpNow());
  return r ? `<h3 class="ramp-h">Your ramp test</h3>${rampHtml(r)}` : '';
}
function setFtp(w, was) {
  const el = $('cfg-ftp');
  el.value = w;
  el.dispatchEvent(new Event('change')); // (saves it to the account, and route times follow)
  const msg = $('coach-ftp-msg');
  if (msg) msg.innerHTML = `FTP updated: <b>${was} → ${w} W</b>. Your zones and the power dial use it from now on.`;
  toast(`FTP updated to ${w} W`, 5000);
}

// ---------- start-up ----------
export async function initCoach() {
  document.body.classList.toggle('coach-off', !coachOn());
  $('cfg-coach').addEventListener('change', () => { renderCoach(); if (coachOn() && !C.loaded) load().then(renderCoach); });
  for (const id of ['cfg-ftp', 'cfg-maxhr', 'cfg-sex', 'cfg-born', 'cfg-vo2watch']) $(id).addEventListener('change', () => renderCoach());
  $('sec-coach').addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-analyse]');
    if (row && !e.target.closest('button')) { const r = C.rides.find((x) => x.id === row.dataset.analyse); if (r) analyseRide(r); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (Object.keys(b.dataset).some((k) => k.startsWith('plan'))) { await planClick(b); return; }
    if (b.dataset.wo) { const sel = $('cfg-workout'); sel.value = 'b:' + b.dataset.wo; sel.dispatchEvent(new Event('change')); toast(`Workout: ${sel.selectedOptions[0]?.textContent || b.dataset.wo}`, 3000); }
    if (b.dataset.route) {
      const [world, ride] = b.dataset.route.split('|'); // (an open world's ride: that world, with the ride chosen as its start)
      if (ride) store.set('owStart.' + world, 'r:' + ride);
      await pickSuggested(world); toast(ride ? 'Ride chosen: see Route' : 'Route chosen: see Route', 3000);
    }
    if (b.dataset.skip) {
      const s = skips();
      s.has(b.dataset.skip) ? s.delete(b.dataset.skip) : s.add(b.dataset.skip);
      const v = [...s].slice(-18).join(','); // (a setting holds 200 characters)
      $('cfg-coachskip').value = v; store.set('coachSkip', v); saveSetting('coachSkip', v);
      renderCoach();
    }
  });
  // the Esc panel: refresh "This ride" while it's open
  setInterval(() => { if (coachOn() && document.body.classList.contains('midride')) { measure(); renderRideBlock(); } }, 3000);
  window.addEventListener('resize', () => { if (coachOn() && C.loaded && $('setup').offsetParent) renderCharts(); });
  if (coachOn()) { await load(); renderCoach(); }
}
