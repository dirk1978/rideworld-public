// Segments: timed stretches of a route (climbs, sprints) with leaderboards (server: lib/segments.js). Marked in the
// route editor and stored on the route in full-route km like corrections; the whole route is segment 'full'.
// While riding: a heads-up as one comes up (leader and your best), a live timer with how far ahead or behind your
// best you are, and the result at the end. Efforts are timed on ride time (pauses don't count), from the moment
// the rider crosses the line (interpolated between frames), with a split every 10 m for the live comparison.
import { $, api, esc, fmtDist, fmtTime, route, state, toast } from './core.js';
import { currentInfo } from './setup.js';
import { finishAt } from './scenery.js';
import { sound } from './audio.js';
import { rideTime } from './trip.js';

export const KINDS = { climb: { icon: '⛰', word: 'CLIMB', colour: '#ef4444' }, sprint: { icon: '⚡', word: 'SPRINT', colour: '#22c55e' },
  segment: { icon: '⏱', word: 'SEGMENT', colour: '#38bdf8' }, route: { icon: '🏁', word: 'ROUTE', colour: '#ff6a1a' } };
const SPLIT = 10; // metres between splits

export let boards = {}; // segment id -> { top, riders, rank, best, bestSim }
const active = new Map(); // segment id -> { seg, t0, splits, wattSum, last }
let prev = null; // { dist, t } last frame
let result = null; // { text, until }

// The route being ridden's segments, in ride metres (the whole route last)
export function rideSegments() {
  if (!route || state.legs) return []; // segments are for the way out (see turnaround.js)
  const info = currentInfo();
  const inPieces = (s) => !route.pieces || route.pieces.some((p) => s.startM >= p.a && s.endM <= p.b); // highlights: only whole segments in a piece
  const list = (info?.segments || []).map((s) => ({ ...s, startM: route.m(s.from), endM: Math.min(route.m(s.to), finishAt()) }))
    .filter((s) => s.startM >= 0 && s.endM > s.startM + 20 && inPieces(s));
  // the whole route's time only when it was all ridden (not started part-way, not a highlights route)
  if (info && !route.skipKm && !route.pieces && !route.opts?.open) list.push({ id: 'full', name: info.name, kind: 'route', startM: 0, endM: finishAt() });
  return list;
}

export async function loadBoards() {
  const info = currentInfo();
  if (!info) { boards = {}; return; }
  try { boards = (await api(`api/segments/${encodeURIComponent(info.id)}`)).boards; } catch { boards = {}; }
}

const fmtS = (s) => (s < 60 ? `${s.toFixed(1)} s` : fmtTime(s));
const delta = (d) => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(1)} s`;
// your best's time at m metres into the segment (real best, else your simulator best)
function bestAt(segId, m) {
  const b = boards[segId]?.best || boards[segId]?.bestSim;
  const sp = b?.splits;
  if (!sp?.length) return null;
  const i = m / SPLIT;
  if (i >= sp.length - 1) return null;
  const k = Math.floor(i);
  return sp[k] + (sp[k + 1] - sp[k]) * (i - k);
}

// Every frame (after the rider has moved)
export function updateSegments(watts, dt) {
  const t = state.elapsed, d = state.dist;
  if (!route || !state.riding && !state.finished) { prev = { dist: d, t }; showLive(); return; }
  const segs = rideSegments();
  if (state.joinJumped) { state.joinJumped = false; active.clear(); prev = { dist: d, t }; return; } // highlights: the next piece
  if (prev && Math.abs(d - prev.dist) > 60) {
    // a jump (simulator J, dragging the graph): the timing would be meaningless
    if (active.size) toast('Segment timing stopped: you jumped along the route.', 4000);
    active.clear();
    prev = { dist: d, t };
    return;
  }
  const p = prev || { dist: d, t };
  const at = (m) => (d === p.dist ? t : p.t + ((m - p.dist) / (d - p.dist)) * (t - p.t)); // when we crossed m
  for (const s of segs) {
    const a = active.get(s.id);
    // starts: crossing the line, or the whole route as the ride begins
    if (!a && ((p.dist < s.startM && d >= s.startM) || (s.id === 'full' && s.startM === 0 && p.t === 0 && t > 0 && d < 20))) {
      active.set(s.id, { seg: s, t0: s.id === 'full' ? 0 : at(s.startM), splits: [0], wattSum: 0 });
      continue;
    }
    if (!a) continue;
    a.wattSum += watts * dt;
    while (a.seg.startM + a.splits.length * SPLIT <= Math.min(d, a.seg.endM)) a.splits.push(at(a.seg.startM + a.splits.length * SPLIT) - a.t0);
    if (d >= a.seg.endM) { active.delete(s.id); finishEffort(a, at(a.seg.endM) - a.t0); }
  }
  prev = { dist: d, t };
  showLive();
}

async function finishEffort(a, time) {
  const s = a.seg, k = KINDS[s.kind] || KINDS.segment, info = currentInfo();
  const sim = $('cfg-sim').checked;
  const watts = a.wattSum / Math.max(1, time);
  try {
    const r = await api(`api/segments/${encodeURIComponent(info.id)}/${s.id}`, { method: 'POST', body: JSON.stringify({ time, watts, sim, splits: a.splits }) });
    const parts = [`${k.icon} ${s.name}  ${fmtS(r.time)}`];
    if (r.prev === null) parts.push(sim ? 'first time (sim)' : 'first time');
    else if (r.pb) parts.push(`new best! ${delta(r.time - r.prev)}`);
    else parts.push(`${delta(r.time - r.prev)} on your best`);
    if (r.rank) parts.push(`${ordinal(r.rank)} of ${r.riders}`);
    result = { text: parts.join(' · '), pb: r.pb, until: performance.now() + 8000 };
    if (r.pb) sound.chime(0.25);
    await loadBoards();
  } catch (e) { console.warn('effort not saved', e); }
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// The panel under the top bar: coming up / live timer / result
function showLive() {
  const box = $('seg-live');
  const now = performance.now();
  let html = '';
  const live = [...active.values()].filter((a) => a.seg.id !== 'full').sort((x, y) => x.seg.endM - y.seg.endM)[0];
  if (result && now < result.until) html = `<div class="seg-res${result.pb ? ' pb' : ''}">${esc(result.text)}</div>`;
  else if (live) {
    const s = live.seg, k = KINDS[s.kind] || KINDS.segment, m = state.dist - s.startM, el = state.elapsed - live.t0;
    const b = bestAt(s.id, m), dl = b === null ? '' : `<b class="${el - b <= 0 ? 'ahead' : 'behind'}">${delta(el - b)}</b>`;
    // ETA (the owner 2026-10-26): the time it'll end on, riding the rest at the last ~30 s power on its gradients (once
    // a second), and against your best time
    const now2 = performance.now();
    if (!live.etaAt || now2 - live.etaAt > 1000) { live.etaAt = now2; live.eta = el + rideTime(state.dist, s.endM).t; }
    const best = (boards[s.id] || {}).best?.time ?? (boards[s.id] || {}).bestSim?.time;
    const eta = `ETA ${fmtS(live.eta)}${best ? ` (${delta(live.eta - best)} on best)` : ''}`;
    html = `<div><span class="k">${k.icon} ${esc(s.name)}</span> <b>${fmtS(el)}</b> ${dl}<span class="sub">${fmtDist(Math.max(0, s.endM - state.dist), 2)} to go · ${eta}</span></div>`;
  } else if (route) {
    const next = rideSegments().filter((s) => s.id !== 'full' && s.startM > state.dist && s.startM - state.dist < 300).sort((x, y) => x.startM - y.startM)[0];
    if (next) {
      const k = KINDS[next.kind] || KINDS.segment, b = boards[next.id] || {}, lead = b.top?.[0], mine = b.best || b.bestSim;
      html = `<div><span class="k">${k.icon} ${esc(next.name)}</span> in ${fmtDist(next.startM - state.dist, 2)}<span class="sub">${lead ? `🏆 ${esc(lead.name)} ${fmtS(lead.time)}` : 'No times yet'}${mine ? ` · you ${fmtS(mine.time)}${b.best ? '' : ' (sim)'}` : ''}</span></div>`;
    }
  }
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  box.classList.toggle('hidden', !html);
}

// ---------- the setup screen: segments on the selected route ----------
export async function refreshSegmentList() {
  const info = currentInfo();
  const el = $('seg-list');
  if (!info) { el.innerHTML = '<p class="note">Segments are kept for saved routes.</p>'; return; }
  await loadBoards();
  const segs = [...(info.segments || []).map((s) => ({ ...s })), { id: 'full', name: 'Whole route', kind: 'route', from: 0, to: info.km }];
  el.innerHTML = segs.map((s) => {
    const k = KINDS[s.kind] || KINDS.segment, b = boards[s.id] || {}, lead = b.top?.[0], mine = b.best || b.bestSim;
    const len = s.id === 'full' ? '' : ` · ${fmtDist((s.to - s.from) * 1000, 1)}`;
    return `<div class="seg-row"><span class="seg-name">${k.icon} ${esc(s.name)}<span class="opt">${len}</span></span>
      <span class="opt">${lead ? `🏆 ${esc(lead.name)} ${fmtS(lead.time)}` : 'no times yet'}${mine ? ` · you ${fmtS(mine.time)}${b.best ? (b.rank ? ` (${ordinal(b.rank)})` : '') : ' (sim)'}` : ''}</span></div>`;
  }).join('') + (info.segments?.length ? '' : '<p class="note">Mark climbs and sprints in the route editor (✏️, simulator) to time them here.</p>');
}

// start-up: keep the setup screen's list in step with the selected route
export async function initSegments() {
  let last = null;
  setInterval(() => {
    const info = currentInfo(), key = info ? `${info.id}:${(info.segments || []).length}` : '';
    if ($('setup').offsetParent && key !== last) { last = key; refreshSegmentList(); }
  }, 1000);
}
