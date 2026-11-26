// The route editor (simulator only): nudge / raise / straighten stretches, saved as corrections.
import { devices } from '../devices.js';
import { CAMS, FREE, placeCamera, showCam } from './camera.js';
import { $, C, U, api, esc, me, route, setRoute, state, toast } from './core.js';
import { drawProfile } from './hud.js';
import { viewer } from './scenery.js';
import { currentInfo, setSuggestRoute } from './setup.js';
import { SURVEY_STEP, groundHeight, resurvey } from './survey.js';
import { KINDS } from './segments.js';
// ---------- route editor (simulator only) ----------
// Nudge a stretch of the line left/right and the rider up/down, preview it live (the road under the new line is
// re-measured), then save it as corrections on the route (RideWorld routes: admins; your own routes: you).
// The editor uses the normal Free camera, raised to look down on the stretch; drag / scroll / C all work,
// and the previous view comes back when the editor closes.
export const EDIT_VIEW = { yaw: 0, pitch: -60, range: 32 };
export const ed = { on: false, from: 0, to: 0, right: 0, up: 0, list: [], timer: 0, line: null, mode: 'around', saving: false };
export function canEditRoute() {
  const info = currentInfo();
  if (!info || !$('cfg-sim').checked || route?.skipKm || route?.pieces) return false; // edit the whole route, not a part-way start or a highlights route
  return info.kind === 'user' ? (info.by === me.username || me.admin) : me.admin;
}

export const fmtSide = (m) => (m ? `${Math.abs(m).toFixed(2).replace(/\.?0+$/, '')} m ${m < 0 ? 'left' : 'right'}` : '');
export const fmtUp = (m) => (m ? `${m > 0 ? 'up' : 'down'} ${Math.abs(m).toFixed(2).replace(/\.?0+$/, '')} m` : '');
export const fmtRange = (fromM, toM) => `${(fromM / U().dist).toFixed(2)} ${U().distUnit}–${toM >= route.length ? 'finish' : `${(toM / U().dist).toFixed(2)} ${U().distUnit}`}`;

export function openEditor() {
  if (ed.on || !canEditRoute()) return;
  ed.on = true;
  state.riding = false;
  $('btn-ride').textContent = 'Resume';
  devices.setGrade(0);
  ed.list = (route.adjust || []).map((a) => ({ ...a }));
  ed.base = route;
  ed.listKey = null; ed.line = null;
  ed.right = 0; ed.up = 0;
  ed.prevCam = { cam: state.cam, free: { ...CAMS[FREE] } };
  Object.assign(CAMS[FREE], EDIT_VIEW, { ahead: 0, lift: 0.9 });
  state.cam = FREE; showCam();
  aroundMe();
  $('ed-saved').textContent = '';
  $('editor').classList.remove('hidden');
  renderEditor();
}

export function closeEditor() {
  if (ed.right || ed.up) {
    if (!confirm('Keep the change you are nudging? (Cancel throws it away.)')) { ed.right = 0; ed.up = 0; schedulePreview(); }
    else keepChange();
  }
  ed.on = false;
  if (ed.prevCam) { Object.assign(CAMS[FREE], ed.prevCam.free); state.cam = ed.prevCam.cam; showCam(); }
  $('editor').classList.add('hidden');
  if (ed.line) { viewer.entities.remove(ed.line); ed.line = null; }
  if (ed.ghost) { viewer.entities.remove(ed.ghost); ed.ghost = null; }
}

// The stretch follows the rider (30 m either side) until you pin a start or end with [ / ]
export function aroundMe() {
  const from = Math.max(0, state.dist - 30), to = Math.min(route.length, state.dist + 30);
  const moved = Math.abs(from - ed.from) > 1 || Math.abs(to - ed.to) > 1 || ed.mode !== 'around';
  ed.mode = 'around';
  ed.from = from; ed.to = to;
  if (moved || !ed.line) { drawStretch(); renderEditor(); drawProfile(); }
}

export function drawStretch() {
  if (ed.line) viewer.entities.remove(ed.line);
  if (ed.ghost) viewer.entities.remove(ed.ghost);
  // thin white line: where the route was when the editor opened
  const g = [], gFrom = Math.max(0, ed.from - 60), gTo = Math.min(ed.base.length, ed.to + 60);
  for (let d = gFrom; d <= gTo; d += Math.max(2, (gTo - gFrom) / 300)) { const p = ed.base.at(d); g.push(C.Cartesian3.fromDegrees(p.lon, p.lat, groundHeight(d) + 0.5)); }
  ed.ghost = g.length > 1 ? viewer.entities.add({ polyline: { positions: g, width: 2, arcType: C.ArcType.NONE, material: C.Color.WHITE.withAlpha(0.8), depthFailMaterial: C.Color.WHITE.withAlpha(0.3) } }) : null;
  const pts = [], step = Math.max(2, (ed.to - ed.from) / 400); // at most ~400 points however long the stretch
  for (let d = ed.from; d <= ed.to; d += step) { const p = route.at(d); pts.push(C.Cartesian3.fromDegrees(p.lon, p.lat, groundHeight(d) + 0.7)); }
  ed.line = pts.length > 1 ? viewer.entities.add({
    polyline: { positions: pts, width: 9, arcType: C.ArcType.NONE, material: C.Color.fromCssColorString('#22d3ee').withAlpha(0.85), depthFailMaterial: C.Color.fromCssColorString('#22d3ee').withAlpha(0.35) },
  }) : null;
}

export const pendingCorrection = () => (ed.right || ed.up ? { from: route.km(ed.from), to: route.km(ed.to), ...(ed.right ? { right: ed.right } : {}), ...(ed.up ? { up: ed.up } : {}), note: `editor, ${me.username}` } : null);

// Rebuild the route with a set of corrections, keep the rider where they are, and re-measure the road under the
// changed stretch [fromM, toM]. Re-measuring is kept small (at most 400 m, near the change): asking Google for
// full-detail tiles along kilometres of route at once swamps the browser's memory. Anything further ahead is
// simply forgotten and measured again as the rider gets there, like normal.
export async function applyPreview(adjust, fromM = ed.from, toM = ed.to) {
  const keepDist = state.dist;
  setRoute(ed.base.withAdjust(adjust));
  route.adjust = adjust;
  state.dist = Math.min(keepDist, route.length - 1);
  state.lineAt = -1e9;
  drawStretch(); // show the moved line straight away; heights follow once re-measured
  const sv = state.survey;
  const lo = Math.max(0, fromM - 40), hi = Math.min(route.length, toM + 40, lo + 400);
  if (toM + 40 > hi) sv.raw.length = Math.min(sv.raw.length, Math.floor(hi / SURVEY_STEP)); // re-measure later
  if (hi > lo) await resurvey(lo, hi);
  state.lineAt = -1e9;
  drawStretch();
  drawProfile();
}

export function schedulePreview(fromM = ed.from, toM = ed.to) {
  clearTimeout(ed.timer);
  ed.timer = setTimeout(() => { const p = pendingCorrection(); applyPreview(p ? [...ed.list, p] : [...ed.list], fromM, toM); }, 250);
}

export function nudge(dRight, dUp) {
  ed.right = +(ed.right + dRight).toFixed(2);
  ed.up = +(ed.up + dUp).toFixed(2);
  renderEditor(); schedulePreview();
}

// Straighten = a straight line between the stretch's two ends, saved straight away
export function straightenStretch() {
  if (ed.to - ed.from < 5) return;
  if (ed.right || ed.up) keepChange(); // keep any nudge first so it isn't lost
  ed.list.push({ from: route.km(ed.from), to: route.km(ed.to), straight: true, note: `straightened in the editor, ${me.username}` });
  ed.mode = 'fixed';
  renderEditor(); schedulePreview(); saveEditor();
}

// Level = the height over the stretch becomes a straight line between its two ends (a dip or hump in the map
// elevation the road doesn't really have)
export function levelStretch() {
  if (ed.to - ed.from < 5) return;
  if (ed.right || ed.up) keepChange();
  ed.list.push({ from: route.km(ed.from), to: route.km(ed.to), level: true, note: `levelled in the editor, ${me.username}` });
  ed.mode = 'fixed';
  renderEditor(); schedulePreview(); saveEditor();
}

// Use my heights = over the stretch the road follows the file's heights, not Google's 3D (a recorded ride where
// Google's model is wrong: Cap's last km has a 40 m hollow and a peak the road doesn't have; the owner 2026-10-19)
export function mineStretch() {
  if (ed.to - ed.from < 5) return;
  // only a recording's heights are worth trusting over Google's: a planned route's come from map data, which is
  // metres out on mountains, and the road would be cut deep into the hillside (tried on Sa Calobra's hairpins)
  if (!route.opts?.trusted && !confirm("This route's heights aren't marked as reliable (Edit details: \"This file's heights are reliable\", for a recorded ride). From map data they can be metres out, and the road would be cut deep into the hill. Use them here anyway?")) return;
  if (ed.right || ed.up) keepChange();
  ed.list.push({ from: route.km(ed.from), to: route.km(ed.to), mine: true, note: `my heights, set in the editor, ${me.username}` });
  ed.mode = 'fixed';
  renderEditor(); schedulePreview(); saveEditor();
}

// Keep = add to the route's corrections and save straight away
export function keepChange() {
  const p = pendingCorrection();
  if (!p) return;
  ed.list.push(p);
  ed.right = 0; ed.up = 0;
  if (ed.mode === 'start') ed.mode = 'fixed';
  renderEditor(); schedulePreview(); saveEditor();
}

export function renderEditor() {
  if (!ed.on) return;
  $('ed-where').textContent = `${route.name} · rider at ${(state.dist / U().dist).toFixed(2)} ${U().distUnit}`;
  $('ed-stretch').textContent = `${fmtRange(ed.from, ed.to)} (${Math.round(ed.to - ed.from)} m, ${{ around: 'around you', start: 'start set, now set the end', fixed: 'start and end set' }[ed.mode]})`;
  $('ed-change').textContent = [fmtSide(ed.right), fmtUp(ed.up)].filter(Boolean).join(', ') || 'No change yet: use the arrows.';
  $('ed-keep').disabled = !(ed.right || ed.up);
  $('ed-cancel').disabled = !(ed.right || ed.up);
  // only rebuild the list when it changes, so its buttons don't get swapped out from under the mouse
  renderSegments();
  const key = JSON.stringify(ed.list) + U().distUnit;
  if (key === ed.listKey) return;
  ed.listKey = key;
  $('ed-list').innerHTML = ed.list.length ? ed.list.map((a, i) => `
    <div class="item"><span>${fmtRange(route.m(a.from), route.m(a.to))}: ${[a.straight ? 'straightened' : '', a.bend ? 'smooth bend' : '', a.dx || a.dy ? 'moved (Studio)' : '', a.level ? 'levelled' : '', a.mine ? 'my heights' : '', a.hold ? 'held to my shape' : '', fmtSide(a.right), fmtUp(a.up)].filter(Boolean).join(', ')}</span>
    <button data-go="${i}" title="Jump to this correction">Show</button><button data-rm="${i}" title="Remove this correction (saves straight away)">×</button></div>`).join('')
    : '<p class="note">None yet.</p>';
  $('ed-list').querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const a = ed.list[+b.dataset.go];
    state.dist = Math.max(0, route.m(a.from) - 20); placeCamera(0, true);
    ed.from = Math.max(0, route.m(a.from)); ed.to = Math.min(route.length, route.m(a.to)); ed.mode = 'fixed'; drawStretch(); renderEditor(); drawProfile();
  }));
  $('ed-list').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    const [a] = ed.list.splice(+b.dataset.rm, 1);
    renderEditor(); schedulePreview(Math.max(0, route.m(a.from)), Math.min(route.length, route.m(a.to))); saveEditor();
  }));
}

export async function saveEditor() {
  const info = currentInfo();
  $('ed-saved').textContent = 'Saving…';
  try {
    const r = await api(`api/routes/${encodeURIComponent(info.id)}/corrections`, { method: 'PUT', body: JSON.stringify({ adjust: ed.list, finish: route.finishKm ?? null, start: route.startKm ?? null }) });
    info.adjust = r.route.adjust;
    ed.base.adjust = r.route.adjust; // base keeps the original points; corrections are re-applied from them
    setSuggestRoute(route);            // so the saved version is what's loaded next time from the setup screen
    $('ed-saved').textContent = `Saved ✓ (${r.route.adjust.length} correction${r.route.adjust.length === 1 ? '' : 's'})`;
  } catch (e) { $('ed-saved').textContent = 'Not saved: ' + e.message; toast('Could not save: ' + e.message, 6000); }
}

// ---------- crop: where the route starts and ends (the owner 2026-10-19). The route entry's start / finish trims, in
// km along the full cleaned route like the corrections; saved with them, then the page reloads straight back into
// the editor (roadfinder.js resume), because every distance in the ride counts from the start. ----------
async function crop(which) {
  const info = currentInfo();
  if (!info) return;
  const here = route.km(state.dist);
  let start = route.startKm ?? null, finish = route.finishKm ?? null, back = state.dist;
  if (which === 'start') {
    if (finish && here >= finish - 0.2) { $('ed-crop-msg').textContent = 'That is after (or right by) the end: move back first.'; return; }
    start = here > 0.005 ? +here.toFixed(3) : null; back = 0;
  } else if (which === 'end') {
    if (here <= (start || 0) + 0.2) { $('ed-crop-msg').textContent = 'That is before (or right by) the start: move on first.'; return; }
    finish = +here.toFixed(3);
  } else {
    if (!start && !finish) { $('ed-crop-msg').textContent = 'The route isn\'t cropped.'; return; }
    if (!confirm('Put the whole route back (remove the crop)?')) return;
    back = state.dist + (route.startM || 0); start = null; finish = null;
  }
  $('ed-crop-msg').textContent = 'Saving…';
  try {
    await api(`api/routes/${encodeURIComponent(info.id)}/corrections`, { method: 'PUT', body: JSON.stringify({ adjust: ed.list, finish, start }) });
    const what = which === 'start' ? 'New start saved' : which === 'end' ? 'New end saved' : 'Crop removed';
    try { localStorage.setItem('rw.resume', JSON.stringify({ dist: back, at: Date.now(), msg: `${what}: here's the route.` })); } catch {}
    $('ed-crop-msg').textContent = `${what}. Reloading the route…`;
    setTimeout(() => location.reload(), 1200);
  } catch (e) { $('ed-crop-msg').textContent = 'Not saved: ' + e.message; }
}

// ---------- segments: mark the current stretch as a timed segment (segments.js shows them in the ride) ----------
async function saveSegments(list) {
  const info = currentInfo();
  const r = await api(`api/routes/${encodeURIComponent(info.id)}/segments`, { method: 'PUT', body: JSON.stringify({ segments: list }) });
  info.segments = r.route.segments || [];
  renderSegments(true);
  drawProfile();
}
async function markSegment() {
  const len = ed.to - ed.from;
  if (len < 50) { toast('A segment needs at least 50 m: set the stretch with [ and ] first.', 5000); return; }
  const grade = ((route.smoothEle(ed.to) - route.smoothEle(ed.from)) / len) * 100;
  const kind = grade >= 3 ? 'climb' : len <= 1500 ? 'sprint' : 'segment';
  const name = prompt(`Name this ${kind} (${fmtRange(ed.from, ed.to)}, ${grade.toFixed(1)}% average):`, '');
  if (!name || !name.trim()) return;
  const info = currentInfo();
  try {
    await saveSegments([...(info.segments || []), { name: name.trim(), from: route.km(ed.from), to: route.km(ed.to), kind }]);
    toast(`Segment "${name.trim()}" saved.`, 3000);
  } catch (e) { toast('Could not save: ' + e.message, 6000); }
}
export function renderSegments(force = false) {
  const info = currentInfo(), segs = info?.segments || [];
  const key = JSON.stringify(segs) + U().distUnit;
  if (!force && key === ed.segKey) return;
  ed.segKey = key;
  $('ed-segs').innerHTML = segs.length ? segs.map((s, i) => `
    <div class="item"><span>${(KINDS[s.kind] || KINDS.segment).icon} ${esc(s.name)}: ${fmtRange(route.m(s.from), route.m(s.to))}</span>
    <button data-seg-go="${i}" title="Jump to its start">Show</button><button data-seg-rm="${i}" title="Remove this segment and its times">×</button></div>`).join('')
    : '<p class="note">None yet.</p>';
  $('ed-segs').querySelectorAll('[data-seg-go]').forEach((b) => b.addEventListener('click', () => {
    const s = segs[+b.dataset.segGo];
    state.dist = Math.max(0, route.m(s.from) - 20); placeCamera(0, true);
    ed.from = Math.max(0, route.m(s.from)); ed.to = Math.min(route.length, route.m(s.to)); ed.mode = 'fixed'; drawStretch(); renderEditor(); drawProfile();
  }));
  $('ed-segs').querySelectorAll('[data-seg-rm]').forEach((b) => b.addEventListener('click', async () => {
    const s = segs[+b.dataset.segRm];
    if (!confirm(`Remove the segment "${s.name}" and everyone's times on it?`)) return;
    try { await saveSegments(segs.filter((_, k) => k !== +b.dataset.segRm)); } catch (e) { toast('Could not save: ' + e.message, 6000); }
  }));
}

// Arrow keys etc. while the editor is open; returns true if handled
export function editorKey(e) {
  if (e.target.closest?.('input, textarea')) return false;
  const k = e.key;
  if (k === 'ArrowLeft') nudge(-0.5, 0);
  else if (k === 'ArrowRight') nudge(0.5, 0);
  else if (k === 'ArrowUp') nudge(0, 0.25);
  else if (k === 'ArrowDown') nudge(0, -0.25);
  else if (k === '[') stretchStart();
  else if (k === ']') stretchEnd();
  else if (k === 'Enter') keepChange();
  else if (k === 's' || k === 'S') straightenStretch();
  else if (k === 'l' || k === 'L') levelStretch();
  else if (k === 'Escape') closeEditor();
  else return false;
  e.preventDefault();
  return true;
}
export function stretchStart() {
  ed.from = state.dist; ed.to = Math.min(route.length, state.dist + 5); ed.mode = 'start';
  drawStretch(); renderEditor(); drawProfile();
}
export function stretchEnd() {
  if (state.dist < ed.from) { ed.to = ed.from; ed.from = state.dist; } else ed.to = Math.max(state.dist, ed.from + 5);
  ed.mode = 'fixed';
  drawStretch(); renderEditor(); drawProfile();
}

// start-up: route editor buttons and timers (main.js runs these in order)
export async function initEditor() {
  setInterval(() => $('btn-edit').classList.toggle('hidden', !(viewer && canEditRoute())), 1000);
  setInterval(() => {
    if (!ed.on || ed.right || ed.up) return;
    if (ed.mode === 'start') {
      // start fixed: the stretch runs from it to wherever the rider is now
      const to = Math.min(route.length, Math.max(ed.from + 5, state.dist));
      if (Math.abs(to - ed.to) > 1) { ed.to = to; drawStretch(); renderEditor(); drawProfile(); }
      return;
    }
    const outside = state.dist < ed.from - 5 || state.dist > ed.to + 5;
    if (outside || (ed.mode === 'around' && (state.dist < ed.from + 10 || state.dist > ed.to - 10))) aroundMe(); // follow the rider
  }, 300);

  $('btn-edit').addEventListener('click', openEditor);
  $('ed-close').addEventListener('click', closeEditor);
  $('ed-keep').addEventListener('click', keepChange);
  $('ed-straight').addEventListener('click', straightenStretch);
  $('ed-level').addEventListener('click', levelStretch);
  $('ed-mine').addEventListener('click', mineStretch);
  $('ed-seg').addEventListener('click', markSegment);
  $('ed-cancel').addEventListener('click', () => { ed.right = 0; ed.up = 0; renderEditor(); schedulePreview(); });
  $('ed-left').addEventListener('click', () => nudge(-0.5, 0));
  $('ed-right').addEventListener('click', () => nudge(0.5, 0));
  $('ed-up').addEventListener('click', () => nudge(0, 0.25));
  $('ed-down').addEventListener('click', () => nudge(0, -0.25));
  $('ed-start').addEventListener('click', stretchStart);
  $('ed-crop-start').addEventListener('click', () => crop('start'));
  $('ed-crop-end').addEventListener('click', () => crop('end'));
  $('ed-crop-reset').addEventListener('click', () => crop('reset'));
  $('ed-end').addEventListener('click', stretchEnd);
  $('ed-around').addEventListener('click', aroundMe);
  setInterval(() => { if (ed.on) $('ed-where').textContent = `${route.name} · rider at ${(state.dist / U().dist).toFixed(2)} ${U().distUnit}`; }, 500);
}
