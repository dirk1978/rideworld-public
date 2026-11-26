// The setup screen: rider settings (including loading the account's), sensors, choosing a route (list, planner,
// GPX, export / replace), saving GPX routes, the account and Accounts dialogs, Strava.
import { AntStick } from '../ant.js';
import { bleRemembers, bleSupported, pickAnyBle, reconnectBle } from '../ble.js';
import { devices } from '../devices.js';
import { toFit, toFitCourse } from '../fit.js';
import { routeFileToGpx, routeToKml, routeToTcx, saveFile } from '../formats.js';
import { pacerWatts } from '../pacers.js';
import { Bike, routeTime } from '../physics.js';
import { Planner } from '../planner.js';
import { Route } from '../route.js';
import { rememberMusic } from './audio.js';
import { renderBots } from './company.js';
import { $, GLOBAL_KEYS, U, USER_KEYS, api, esc, fields, fmtDist, fmtEle, kg, me, recorder, route, saveSetting, setMe, setRoute, showWeights, state, store, toast } from './core.js';
import { uploadSaved } from './rides.js';
// a button's words, keeping its icon (the redesign's buttons start with an <svg class="ic">)
function setLabel(b, text) {
  const icon = b.querySelector(':scope > svg.ic');
  b.textContent = text;
  if (icon) b.prepend(icon);
}

export const diffLabel = () => ($('cfg-diff-val').textContent = $('cfg-diff').value + '%');

// Go ride (with sensors) and the small Simulator button beside it (no hardware: ↑ / ↓ set the power). the owner
// 2026-10-26: the old Simulator tick box in Sensors + one "Load scenery" button made it easy to ride the wrong one.
export function updateGo() {
  if (state.loading) return; // main.js shows the loading steps on the button
  const sensors = devices.any;
  const scenery = $('cfg-google').value.trim() || $('cfg-ion').value.trim();
  $('btn-go').disabled = !(route && sensors && scenery);
  $('btn-go-sim').disabled = !(route && scenery);
  $('btn-go').textContent = !scenery ? (me.admin ? 'Add a scenery key (🔑 Keys at the top)' : 'Scenery isn\'t set up on this site yet') : !route ? 'Choose a route' : !sensors ? 'Connect your trainer to ride' : 'Go ride';
}

// ---------- sensors: ANT+ and Bluetooth ----------
// Weight and aero drag go to the trainer so its own simulation matches what's on screen.
export async function sendTrainerSetup() {
  if (!devices.anyTrainer) return;
  try {
    await devices.setUserWeight(kg.rider, kg.bike);
    await devices.setWindResistance(+$('cfg-cda').value);
    state.trainerSetup = true;
  } catch (e) { console.warn('trainer setup failed', e); }
}

// Resistance test on the setup screen: sends a slope straight to the trainer (difficulty not applied)
export const testLabel = () => ($('test-grade-val').textContent = (+$('test-grade').value).toFixed(1) + '%');

// Bluetooth: each button opens Chrome's device picker filtered to that kind of sensor
// ---------- sensors: what each reading comes from (the owner 2026-10-27: "why is ANT+ by itself and BT devices are
// split out?") ----------
// One row per thing you ride with; each names the source the app is using now (devices.js picks: a power meter over
// the trainer's power, a crank sensor over anyone's cadence), how it's connected, and its live reading.
const ROLES = [
  { role: 'trainer', label: 'Trainer', icon: 'bike', from: () => [devices.bleTrainer, devices.ant?.fec] },
  { role: 'power', label: 'Power', icon: 'zap', from: () => [devices.blePower, devices.bleTrainer, devices.ant?.fec], value: () => `${Math.round(devices.power)} W` },
  { role: 'hr', label: 'Heart rate', icon: 'heart', from: () => [devices.bleHr, devices.ant?.hr], value: () => `${devices.hr} bpm` },
  { role: 'cadence', label: 'Cadence', icon: 'crank', from: () => [devices.bleCadence, devices.ant?.cad, devices.blePower, devices.bleTrainer, devices.ant?.fec], value: () => `${Math.round(devices.cadence)} rpm` },
];
const SLOTS = ['bleTrainer', 'blePower', 'bleHr', 'bleCadence'];
// a source's name, connection and state: Bluetooth devices have names; ANT+ ones are named by what they are
function sourceOf(d) {
  const slot = SLOTS.find((k) => devices[k] === d);
  if (slot) return { name: d.name, via: 'Bluetooth', live: d.live, state: d.live ? '' : d.connected ? 'waiting for data' : 'reconnecting', slot, battery: d.battery };
  const a = devices.ant;
  const name = d === a?.fec ? 'Smart trainer' : d === a?.hr ? `Heart-rate strap${a.hr.dev ? ' ' + a.hr.dev : ''}` : 'Cadence sensor'; // (the strap's ANT+ number once paired: only it is listened to, ant.js)
  return { name, via: 'ANT+', live: !!d.connected, state: d.connected ? '' : 'searching', battery: d.battery };
}
// battery (2026-10-29, the owner): Bluetooth gives a percentage, ANT+ straps a percentage or a word, crank sensors a word
function batteryText(b) {
  if (!b || (b.pct === undefined && !b.status)) return '';
  const low = b.pct !== undefined ? b.pct <= 20 : /low|critical/.test(b.status);
  return ` · <span class="sn-batt${low ? ' low' : ''}" title="Battery">${b.pct !== undefined ? `battery ${b.pct}%` : `battery ${b.status}`}</span>`;
}
// what each reading comes from, by name (the ride's sensor pills and its start message; 2026-11-14, a new rider's first ride:
// their watch never connected and only a grey "HR" pill said so)
export function sensorNames() {
  return Object.fromEntries(ROLES.map((r) => {
    const src = r.from().filter(Boolean).find((d) => sourceOf(d).live);
    return [r.role, src ? sourceOf(src).name : null];
  }));
}
const keptBle = () => { try { return JSON.parse(store.get('bleKeep', '[]')) || []; } catch { return []; } };
const keepBle = (list) => store.set('bleKeep', JSON.stringify(list));
function renderSensors() {
  const rows = ROLES.map((r) => {
    const all = r.from().filter(Boolean), src = all.find((d) => sourceOf(d).live) || all[0];
    if (!src) return { ...r, src: 'Not connected', tail: '', on: false };
    const o = sourceOf(src), own = all[0] === src; // own: this row's own device is the one in use
    let extra = r.role === 'trainer' && o.live ? (devices.bleTrainer === src && !src.controllable ? ' · no resistance control: close other apps using it' : ' · resistance control') : '';
    // a better source for this reading that isn't live (pedals reconnecting): say what's used meanwhile
    if (!own && all[0]) { const p = sourceOf(all[0]); extra += ` · <i>${esc(p.name)} ${p.state || 'not live'}…</i>`; }
    const val = o.live && r.value ? `<b class="sn-val">${esc(r.value())}</b>` : '';
    const mine = sourceOf(all[0]); // (the row's own device, also while another stands in for it)
    const x = mine.slot ? `<button class="sn-x" data-drop="${mine.slot}" title="Disconnect ${esc(mine.name)}">×</button>` : r.role === 'hr' && all[0] === devices.ant?.hr && devices.ant.hr.dev ? '<button class="sn-x" data-anthr title="Listen for a different heart-rate strap (this one is remembered and only it is used)">↻</button>' : '';
    return { ...r, on: o.live, src: `<b>${esc(o.name)}</b> · ${o.via}${o.state ? ` · <i>${o.state}…</i>` : ''}${o.live ? batteryText(o.battery) : ''}${extra}`, tail: val + x };
  });
  const html = rows.map((r) => `<div class="sn-row ${r.on ? 'on' : ''}" data-role="${r.role}"><span class="sn-tile"><svg class="ic"><use href="#i-${r.icon}"/></svg></span><span class="sn-main"><span class="sn-label">${r.label}</span><span class="sn-src">${r.src}</span></span>${r.tail}</div>`).join('');
  if ($('sensor-list').innerHTML !== html) $('sensor-list').innerHTML = html;
}

// ---------- route: suggested, plan on a map, or load a GPX ----------
export let suggested = []; // from /api/routes
export let gpxRoute = null;
export let planRoute = null;
export let suggestRoute = null;
export const setSuggestRoute = (r) => { suggestRoute = r; };
export let routeTab = store.get('routeTab', 'suggest');
export const TABS = ['suggest', 'plan', 'gpx'];

export function useRoute() {
  setRoute({ suggest: suggestRoute, plan: planRoute, gpx: gpxRoute }[routeTab]);
  updateGo();
  showSkip();
}
export const planner = new Planner($('plan-map'), store, (r, msg) => {
  planRoute = r;
  if (r) msg = `${fmtDist(r.length)}, ${fmtEle(r.gain)} climbing. Drag points to adjust, right-click one to remove it.`;
  $('plan-save').disabled = !r;
  if (routeTab === 'plan') $('route-msg').textContent = msg;
  useRoute();
});

export const routeMsg = (r) => `${r.name}: ${fmtDist(r.rideLength)}, ` +
  (r.hasElevation ? `${fmtEle(r.gain)} climbing.` : 'no elevation in file, so the trainer will stay flat.') +
  ` ${timeText((r.pieces || [{ a: 0, b: r.length }]).reduce((t, p) => t + estimate((d) => (r.hasElevation ? r.grade(d) : 0), p.a, p.b), 0))}` +
  (r.pieces ? `, in ${r.pieces.length} parts with a fade between them.` : '.');

// Route times: how long a route takes at a comfortable steady pace, `rw.pace` % of FTP (75% by default, so a
// 220 W FTP rides at 165 W), easing up on climbs and off on descents like a pacer, with this rider's weights and CdA
const PACES = [60, 65, 70, 75, 80, 85, 90];
const paceWatts = () => Math.round((+$('cfg-ftp').value || 200) * (+store.get('pace', 75) || 75) / 100);
function estimate(gradeAt, from, to, step) {
  const b = new Bike({ riderKg: kg.rider, bikeKg: kg.bike, cda: +$('cfg-cda').value || 0.32 }), w = paceWatts();
  return routeTime(b, gradeAt, from, to, (g) => pacerWatts(w, g), step);
}
const fmtDur = (t) => { const m = Math.round(t / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const timeText = (t) => `About ${fmtDur(t)} at ${paceWatts()} W`;
// A saved route's time from the server's 100 m gradient profile, between its start and finish trims
function cardTime(r) {
  const L = (r.km ?? 0) * 1000, step = r.profile?.step || 100, g = r.profile?.grade || [];
  const from = Math.min(L, (r.start || 0) * 1000), to = Math.min(L, r.finish ? r.finish * 1000 : L);
  return estimate((d) => g[Math.min(g.length - 1, Math.floor(d / step))] ?? 0, from, to, step);
}
export function refreshRouteTimes() {
  const w = $('pace-w');
  if (w) w.textContent = `${paceWatts()} W`;
  document.querySelectorAll('.route-card [data-eta]').forEach((el) => {
    const r = suggested.find((x) => x.id === el.closest('.route-card').dataset.id);
    if (!r) return;
    el.textContent = `⏱ ${timeText(cardTime(r))}`;
    el.title = `At ${store.get('pace', 75)}% of your FTP: a bit more on climbs, less downhill. Change the pace above the routes.`;
  });
  for (const r of [suggestRoute, gpxRoute]) if (r) r.msg = routeMsg(r);
  if (routeTab === 'suggest' && suggestRoute) $('route-msg').textContent = suggestRoute.msg;
  if (routeTab === 'gpx' && gpxRoute) $('route-msg').textContent = gpxRoute.msg;
}
// re-show everything that has a unit in it
export function refreshUnits() {
  showSkip();
  for (const r of [suggestRoute, gpxRoute]) if (r) r.msg = routeMsg(r);
  if (routeTab === 'suggest' && suggestRoute) $('route-msg').textContent = suggestRoute.msg;
  if (routeTab === 'gpx' && gpxRoute) $('route-msg').textContent = gpxRoute.msg;
  if (routeTab === 'plan') planner.update();
  document.querySelectorAll('.route-card .km').forEach((m) => { // (was every .meta line: it wiped the time and bridges)
    const r = suggested.find((x) => x.id === m.closest('.route-card').dataset.id);
    if (r) m.textContent = kmLine(r);
  });
}

// "Start at": how far in the next ride starts (km; applied at Load scenery with route.withSkip, main.js). Not kept:
// it goes back to 0 when another route is picked.
// (a function declaration: the units setting calls showSkip while this file is still being set up)
export function skipKm() { return owRow() && !owRow().hidden ? 0 : Math.max(0, (+$('cfg-skip').value || 0) * U().dist / 1000); } // (open worlds start from a place instead; currentInfo isn't ready this early)
// open world (openworld.js): the chosen start (routes.json starts: [{ name, lat, lon }]), kept per browser and route
export function openStart() {
  const info = currentInfo(); if (!info?.open) return null;
  const v = owRow().querySelector('select').value;
  if (v.startsWith('r:')) { const ride = (info.rides || []).find((r) => r.id === v.slice(2)); if (ride) return { name: ride.name, lat: ride.via[0].lat, lon: ride.via[0].lon, ride }; } // (a pre-plotted route, openworld.js setRide)
  if (v === 'pt') { try { const p = JSON.parse(store.get('owPoint.' + info.id, 'null')); if (p) return { name: 'From the map editor', lat: p.lat, lon: p.lon }; } catch {} }
  return (info.starts || [])[+v || 0] || null;
}
// (the "Start from" row lives inside the open world's own route card: the owner, "not 2 screen scrolls away"; the list
// re-renders the cards, so the row is kept here and put back each time)
var owRowEl = null; // (var: skipKm runs while this file is still being set up)
function owRow() {
  if (!owRowEl && (owRowEl = document.getElementById('ow-start-row'))) for (const t of ['pointerdown', 'click', 'keydown']) owRowEl.addEventListener(t, (e) => e.stopPropagation());
  return owRowEl;
}
function showOpenStart(info) {
  const open = !!info?.open, row = owRow(), sel = row.querySelector('select');
  row.hidden = !open;
  document.querySelector('.skip-row').hidden = open;
  if (!open) return;
  const card = document.querySelector(`.route-card[data-id="${CSS.escape(info.id)}"]`);
  const into = card?.querySelector(".info") || card;
  if (into && row.parentElement !== into) into.appendChild(row);
  sel.innerHTML = '';
  // pre-plotted routes first (2026-11-18, the owner: "about 10 each pre-plotted routes with a variety of flat or elevation,
  // taking in landmarks"; tools/openworld/rides.mjs), then free riding from a start
  // grouped like Zwift's route list (the owner: "like zwift routes please - a variety of climbing, flat, distance"): flat,
  // rolling, climbing, epic (50 km and more), shortest first in each
  const KIND = { flat: '🟢 flat', rolling: '🟡 rolling', hilly: '🔴 climbing', epic: '⭐ epic' };
  const catOf = (r) => (r.km >= 50 ? 'epic' : r.kind);
  for (const [cat, label] of [['flat', '🟢 Flat'], ['rolling', '🟡 Rolling'], ['hilly', '🔴 Climbing'], ['epic', '⭐ Epic (50 km and more)']]) {
    const list = (info.rides || []).filter((r) => catOf(r) === cat).sort((x, y) => x.km - y.km);
    if (!list.length) continue;
    const g = document.createElement('optgroup'); g.label = label;
    for (const r of list) { const o = document.createElement('option'); o.value = 'r:' + r.id; o.textContent = `${r.name} · ${fmtDist(r.km * 1000)} · ${fmtEle(r.gain)} up`; g.appendChild(o); }
    sel.appendChild(g);
  }
  const fg = document.createElement('optgroup'); fg.label = 'Free ride from…';
  (info.starts || []).forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.name; fg.appendChild(o); });
  sel.appendChild(fg);
  const about = row.querySelector('.ow-ride-info') || row.appendChild(Object.assign(document.createElement('div'), { className: 'ow-ride-info' }));
  const showRide = () => {
    const r = sel.value.startsWith('r:') && (info.rides || []).find((x) => x.id === sel.value.slice(2));
    about.hidden = !r; if (!r) return;
    const W = 120, H = 70, la = r.shape.map((p) => p[0]), lo = r.shape.map((p) => p[1]), k = Math.cos((la[0] * Math.PI) / 180);
    const x0 = Math.min(...lo), x1 = Math.max(...lo), y0 = Math.min(...la), y1 = Math.max(...la), sc = Math.min((W - 10) / ((x1 - x0) * k || 1e-9), (H - 10) / ((y1 - y0) || 1e-9));
    const pts = r.shape.map(([a, b]) => `${(5 + (b - x0) * k * sc).toFixed(1)},${(H - 5 - (a - y0) * sc).toFixed(1)}`).join(' ');
    const pr = r.profile || [], lo2 = Math.min(...pr), hi2 = Math.max(...pr), sp = Math.max(hi2 - lo2, 30);
    const prof = pr.map((v, i) => `${((i / (pr.length - 1)) * W).toFixed(1)},${(28 - ((v - lo2) / sp) * 24).toFixed(1)}`).join(' ');
    about.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ow-ride-map"><polyline points="${pts}"/></svg><div class="ow-ride-txt"><b></b><span class="ow-ride-k"></span><p></p><svg viewBox="0 0 ${W} 30" preserveAspectRatio="none" class="ow-ride-prof"><polygon points="0,30 ${prof} ${W},30"/></svg></div>`;
    about.querySelector('b').textContent = r.name;
    about.querySelector('.ow-ride-k').textContent = `${KIND[catOf(r)] || ''} · ${fmtDist(r.km * 1000)} · ${fmtEle(r.gain)} climbing · steepest ${r.steep}%${r.loop ? ' · a loop' : ''}`;
    about.querySelector('p').textContent = r.blurb;
  };
  // (a spot picked in the map editor's "Ride from here", mapedit.js)
  if (store.get('owPoint.' + info.id, null)) { const o = document.createElement('option'); o.value = 'pt'; o.textContent = '📍 From the map editor'; sel.appendChild(o); }
  const saved = store.get('owStart.' + info.id, (info.rides || [])[0] ? 'r:' + info.rides[0].id : '0');
  sel.value = sel.querySelector(`option[value="${CSS.escape(saved)}"]`) ? saved : (info.rides || [])[0] ? 'r:' + info.rides[0].id : '0';
  sel.onchange = () => { store.set('owStart.' + info.id, sel.value); showRide(); };
  showRide();
}
export function showSkip() {
  const r = route, k = skipKm();
  $('skip-unit').textContent = U().distUnit;
  if (!r) { $('skip-msg').textContent = ''; return; }
  const total = r.rideLength / U().dist;
  $('cfg-skip').max = Math.max(0, Math.floor(total * 10) / 10);
  if (!k) { $('skip-msg').textContent = ''; return; }
  const left = Math.max(0.2, total - k * 1000 / U().dist);
  $('skip-msg').textContent = k * 1000 >= r.rideLength - 200 ? `That's past the end: you'd ride the last ${fmtDist(200)}.`
    : `${left.toFixed(1)} ${U().distUnit} left to ride (group rides always start at the start).`;
}

export async function pickSuggested(id) {
  const info = suggested.find((r) => r.id === id);
  if (!info) return;
  showOpenStart(info);
  if (store.get('suggested') !== id) $('cfg-skip').value = 0;
  store.set('suggested', id); store.set('suggested.' + modeOf(info), id);
  document.querySelectorAll('.route-card').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  try {
    const res = await fetch(`api/routes/${encodeURIComponent(id)}.gpx`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    suggestRoute = Route.fromGpx(await res.text(), info.name, info.adjust, info.finish, info.start, { keepDense: !!info.presmoothed, country: info.country, structures: info.structures?.list, centre: info.centre, bankMax: info.banks, camHigh: info.camHigh !== false, trusted: !!info.trusted, heightGuard: info.heightGuard ?? true, landmarks: info.landmarks, viewpoints: info.viewpoints, lowCam: info.lowCam, sideWalls: info.sideWalls, pieces: info.pieces, googleOffset: info.googleOffset, hedges: !!info.hedges, open: !!info.open, names: info.names });
    suggestRoute.name = info.name;
    suggestRoute.msg = routeMsg(suggestRoute);
  } catch (e) {
    suggestRoute = null;
    toast('Could not load that route: ' + e.message);
  }
  if (routeTab === 'suggest') $('route-msg').textContent = suggestRoute ? suggestRoute.msg : '';
  useRoute();
}

// Export a route as ridden (corrections built in) / replace its GPX with an edited one
export async function exportRoute(info, fmt = 'gpx') {
  try {
    const res = await fetch(`api/routes/${encodeURIComponent(info.id)}.gpx`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = Route.fromGpx(await res.text(), info.name, info.adjust, info.finish, info.start, { keepDense: !!info.presmoothed, centre: info.centre });
    r.name = info.name;
    const file = `${info.name.replace(/[^\w\- ]+/g, '').trim() || 'route'} (RideWorld).${fmt}`;
    if (fmt === 'gpx') saveFile(r.toGpx(), 'application/gpx+xml', file);
    else if (fmt === 'tcx') saveFile(routeToTcx(info.name, r.pts), 'application/vnd.garmin.tcx+xml', file);
    else if (fmt === 'kml') saveFile(routeToKml(info.name, r.pts), 'application/vnd.google-earth.kml+xml', file);
    else saveFile(toFitCourse(r.pts), 'application/vnd.ant.fit', file);
    const n = info.adjust?.length || 0;
    const parts = [n ? `${n} correction${n === 1 ? '' : 's'}` : '', info.start ? 'the later start' : '', info.finish ? 'the earlier finish' : ''].filter(Boolean);
    toast(`Exported "${info.name}"${parts.length ? ` with ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')} built in` : ''}.`);
  } catch (e) { toast('Could not export: ' + e.message); }
}

export function replaceRoute(info) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx,.tcx,.fit,.kml,application/gpx+xml';
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    const n = (info.adjust?.length || 0) + (info.start ? 1 : 0) + (info.finish ? 1 : 0);
    if (!confirm(`Replace "${info.name}" with ${f.name}?${n ? `\n\nIts ${n} correction${n === 1 ? '' : 's'} will be cleared (an export already has them built in).` : ''}${info.kind !== 'user' ? '\n\nEveryone riding this RideWorld route gets the new version.' : ''}\n\nThe current file is kept on the server as a backup.`)) return;
    try {
      const text = (await routeFileToGpx(f)).gpx;
      Route.fromGpx(text); // check it parses before sending
      await api(`api/routes/${encodeURIComponent(info.id)}/gpx`, { method: 'PUT', body: JSON.stringify({ gpx: text }) });
      await loadSuggested(info.id);
      toast(`"${info.name}" now uses ${f.name}.`, 5000);
    } catch (e) { toast('Could not replace: ' + e.message, 6000); }
  });
  input.click();
}

// The route pipeline's progress on the card (lib/pipeline.js; the owner 2026-10-27: "a visual progress indicator on the
// route panel"): waiting / a bar with the step it's on / what it did. Polled every 3 s while any route is processing,
// updating just these boxes; a route that finishes reloads the list (its km, climbing, segments may have changed).
const ICON = { done: '✓', running: '…', skipped: '–', failed: '✗', pending: '·' };
function procHtml(p) {
  if (!p) return '';
  if (p.state === 'queued') return `<div class="proc-line">⏳ Queued for processing${p.ahead ? ` (${p.ahead} ahead)` : ''}</div>`;
  const i = Math.max(0, p.steps.findIndex((s) => s.key === p.step)), n = p.steps.length;
  const steps = `<ol class="proc-steps">${p.steps.map((s) => `<li class="${s.status}" title="${esc(s.note || '')}">${ICON[s.status] || ''} ${esc(s.label)}${s.note ? `<span>: ${esc(s.note)}</span>` : ''}</li>`).join('')}</ol>`;
  if (p.state === 'running') {
    const frac = (i + Math.min(0.99, p.progress || 0)) / n;
    return `<div class="proc-line">⚙ Processing, step ${i + 1} of ${n}: ${esc(p.steps[i].label)}…</div><div class="proc-bar"><i style="width:${Math.round(frac * 100)}%"></i></div>${steps}`;
  }
  if (p.state === 'failed') return `<details class="proc-done failed"><summary>✗ Processing stopped: ${esc(p.error || 'error')}</summary>${steps}</details>`;
  const look = (p.attention || []).length ? `<p class="proc-look">👀 Worth a look: ${p.attention.map(esc).join(' ')}</p>` : '';
  return `<details class="proc-done"><summary>✓ Processed${p.summary?.length ? `: ${esc(p.summary[0])}` : ''}${p.attention?.length ? ' 👀' : ''}</summary><ul class="proc-sum">${(p.summary || []).slice(1).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${look}${steps}</details>`;
}
let procTimer = null;
function watchProcessing() {
  clearTimeout(procTimer);
  if (!suggested.some((r) => r.processing && (r.processing.state === 'queued' || r.processing.state === 'running'))) return;
  procTimer = setTimeout(async () => {
    let fresh;
    try { fresh = (await api('api/routes')).routes; } catch { return watchProcessing(); }
    let finished = false;
    for (const r of fresh) {
      const old = suggested.find((x) => x.id === r.id), box = document.querySelector(`[data-proc="${CSS.escape(r.id)}"]`);
      if (old?.processing && ['queued', 'running'].includes(old.processing.state) && !['queued', 'running'].includes(r.processing?.state) && r.processing?.applied) finished = true;
      if (old && box && JSON.stringify(old.processing) !== JSON.stringify(r.processing)) { old.processing = r.processing; box.innerHTML = procHtml(r.processing); }
    }
    if (finished) { toast('A route has finished processing.'); await loadSuggested(store.get('suggested', '')); } else watchProcessing();
  }, 3000);
}

// What the route analyser found (lib/structures.js), for the route card
function structSummary(r) {
  const st = r.structures;
  if (!st) return 'Not analysed yet for bridges and tunnels';
  if (st.error) return 'Bridge and tunnel check failed: try Analyse again';
  const under = st.list.filter((x) => x.type === 'under').length, tunnels = st.list.filter((x) => x.type === 'tunnel').length;
  const parts = [under ? `${under} under a bridge` : '', tunnels ? `${tunnels} tunnel${tunnels === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? `Analysed: ${parts.join(' · ')}` : 'Analysed: no bridges or tunnels';
}

// Name, place ("where") and description of a saved route
function editDetails(info) {
  const d = $('dlg-route-details');
  $('rd-name').value = info.name; $('rd-where').value = info.where || ''; $('rd-blurb').value = info.blurb || ''; $('rd-banks').value = info.banks ?? ''; $('rd-camhigh').checked = info.camHigh !== false; $('rd-trusted').checked = !!info.trusted; $('rd-scenery').value = info.scenery || ''; $('rd-hedges').checked = !!info.hedges;
  $('rd-msg').textContent = info.kind !== 'user' ? 'This is a RideWorld route: everyone sees the change.' : '';
  d.dataset.id = info.id;
  d.showModal();
}
async function saveDetails(e) {
  e.preventDefault();
  const d = $('dlg-route-details');
  try {
    await api(`api/routes/${encodeURIComponent(d.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ name: $('rd-name').value, where: $('rd-where').value, blurb: $('rd-blurb').value, banks: $('rd-banks').value, camHigh: $('rd-camhigh').checked, trusted: $('rd-trusted').checked, scenery: $('rd-scenery').value, hedges: $('rd-hedges').checked }) });
    d.close();
    await loadSuggested(d.dataset.id);
    toast('Route details saved.');
  } catch (err) { $('rd-msg').textContent = err.message; }
}

const kmLine = (r) => `${fmtDist((r.km ?? 0) * 1000)} · ${fmtEle(r.gain ?? 0)} climbing${r.kind === 'user' ? '' : ` · by ${r.by}`}`;
const countryName = (cc) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()); } catch { return cc.toUpperCase(); } };
// The route's outline (north up, start green, finish white) over its height profile, for the card (the owner
// 2026-10-19: "a small route image next to each one"). From r.shape (100 points, lib/routes.js shapeOf) and
// r.profile (gradient every 100 m).
function thumbSvg(r) {
  const W = 132, H = 96, ROUTE_H = 70, pad = 7;
  const pts = r.shape || [];
  if (pts.length < 2) return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"></svg>`;
  const k = Math.cos((pts[0][0] * Math.PI) / 180), xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((W - 2 * pad) / ((x1 - x0) || 1e-9), (ROUTE_H - 2 * pad) / ((y1 - y0) || 1e-9));
  const ox = (W - (x1 - x0) * sc) / 2, oy = (ROUTE_H - (y1 - y0) * sc) / 2;
  const P = xs.map((x, i) => [ox + (x - x0) * sc, oy + (ys[i] - y0) * sc]);
  const line = P.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  // height profile: the gradients added up into heights, drawn as a filled strip along the bottom
  const g = r.profile?.grade || [], step = r.profile?.step || 100;
  let prof = '';
  if (g.length > 1) {
    let h = 0; const hs = [0, ...g.map((x) => (h += (x / 100) * step))];
    const lo = Math.min(...hs), hi = Math.max(...hs), top = ROUTE_H + 3, bot = H - 3, span = Math.max(hi - lo, 60);
    const pp = hs.map((v, i) => `${((i / (hs.length - 1)) * W).toFixed(1)},${(bot - ((v - lo) / span) * (bot - top)).toFixed(1)}`);
    prof = `<polygon class="prof" points="0,${bot} ${pp.join(' ')} ${W},${bot}"/>`;
  }
  const [sx, sy] = P[0], [fx, fy] = P[P.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${prof}<polyline class="trk-edge" points="${line}"/><polyline class="trk" points="${line}"/><circle class="fin" cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="3.2"/><circle class="sta" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.6"/></svg>`;
}

// The route list's search, country and sort (the owner 2026-10-21: "now we have a few routes"), and its two groups open
// and close like an accordion. All in the browser on the list already loaded; the choices are kept per browser.
// The three modes (2026-11-18, the owner: "the setup screen probably needs to be split into 3 modes ... yellow for open
// world, blue for simple routes, and red for photorealistic ... at the moment the routes are a hodge podge"): a route's
// mode follows from how it's ridden: open worlds; routes in RideWorld's generated scenery; the rest (Google's 3D, and
// riders' own uploads unless set to generated). body[data-mode] recolours the app (style.css); the list shows only the
// mode's routes; Plan on map / Load GPX belong to Routes and Photoreal. Each mode remembers its last route.
export const modeOf = (r) => (r?.open ? 'open' : r?.scenery === 'generated' ? 'routes' : 'photo');
export let mode = store.get('mode', '');
let applyRouteTools = () => {};
export function setMode(m, pick = true) {
  if (!['open', 'routes', 'photo'].includes(m)) m = 'routes';
  mode = m; store.set('mode', m); document.body.dataset.mode = m;
  document.querySelectorAll('.mode-tile').forEach((b) => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', b.dataset.mode === m); });
  for (const t of ['plan', 'gpx']) $('tab-' + t)?.classList.toggle('hidden', m === 'open');
  if (m === 'open' && routeTab !== 'suggest') showTab('suggest');
  const h = document.querySelector('[data-group="server"] h3.group'); if (h?.firstChild) h.firstChild.textContent = { open: 'Open worlds ', routes: 'RideWorld routes ', photo: 'Photoreal routes ' }[m];
  applyRouteTools();
  if (!pick || !suggested.length) return;
  const cur = suggested.find((r) => r.id === store.get('suggested'));
  if (cur && modeOf(cur) === m) return;
  const next = suggested.find((r) => r.id === store.get('suggested.' + m) && modeOf(r) === m) || suggested.find((r) => modeOf(r) === m && r.kind !== 'user') || suggested.find((r) => modeOf(r) === m);
  if (next) pickSuggested(next.id);
}

function wireRouteTools() {
  const byId = new Map(suggested.map((r) => [r.id, r]));
  const s = $('rt-search'), c = $('rt-country'), o = $('rt-sort');
  c.value = [...c.options].some((x) => x.value === store.get('routeCountry', '')) ? store.get('routeCountry', '') : '';
  o.value = store.get('routeSort', 'name');
  const key = { name: (r) => r.name.toLowerCase(), km: (r) => r.km || 0, gain: (r) => r.gain || 0, steep: (r) => (r.gain || 0) / Math.max(1, r.km || 1), added: (r) => r.added || '' };
  const apply = () => {
    store.set('routeCountry', c.value); store.set('routeSort', o.value);
    const q = s.value.trim().toLowerCase(), desc = o.value.startsWith('-'), k = key[o.value.replace('-', '')];
    document.querySelectorAll('#pane-suggest .route-group').forEach((g) => {
      const box = g.querySelector('.cards'), cards = [...box.querySelectorAll('.route-card')];
      cards.sort((a, b) => { const x = k(byId.get(a.dataset.id)), y = k(byId.get(b.dataset.id)); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
      let shown = 0;
      for (const el of cards) {
        const r = byId.get(el.dataset.id);
        const ok = modeOf(r) === mode && (!c.value || r.country === c.value) && (!q || `${r.name} ${r.where || ''} ${r.blurb || ''}`.toLowerCase().includes(q));
        el.hidden = !ok; if (ok) shown++;
        box.appendChild(el);
      }
      const inMode = cards.filter((el) => modeOf(byId.get(el.dataset.id)) === mode).length;
      g.querySelector('.count').textContent = inMode ? (shown === inMode ? `(${shown})` : `(${shown} of ${inMode})`) : '(none)';
    });
  };
  applyRouteTools = apply;
  s.addEventListener('input', apply); c.addEventListener('change', apply); o.addEventListener('change', apply);
  document.querySelectorAll('#pane-suggest .route-group').forEach((g) => {
    if (store.get('routeClosed.' + g.dataset.group, '0') === '1') g.open = false;
    g.addEventListener('toggle', () => store.set('routeClosed.' + g.dataset.group, g.open ? '0' : '1'));
  });
  apply();
}

// what kind of riding an open world is (routes.json `terrain`; 2026-11-20, the owner: "make it clear that London is flat
// routes, Stratford is rolling and Bromsgrove is hilly")
const TERRAIN = { flat: ['Flat', 'Mostly flat roads'], rolling: ['Rolling', 'Gentle ups and downs'], hilly: ['Hilly', 'Proper climbs'] };

export async function loadSuggested(select) {
  try { suggested = (await api('api/routes')).routes; } catch (e) { suggested = []; toast('Could not load the route list: ' + e.message); }
  const card = (r) => `
    <div class="route-card" data-id="${esc(r.id)}" role="button" tabindex="0">
      <div class="thumb${r.image ? ' pic' : ''}">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : thumbSvg(r)}</div>
      <div class="info">
      <span class="title">${r.country ? `<img class="flag" src="img/flags/${esc(r.country)}.svg" alt="${esc(countryName(r.country))}" title="${esc(countryName(r.country))}">` : ''}<strong>${esc(r.name)}</strong>${TERRAIN[r.terrain] ? `<span class="terrain t-${r.terrain}" title="${TERRAIN[r.terrain][1]}">${TERRAIN[r.terrain][0]}</span>` : ''}<span class="where">${esc(r.where)}</span></span>
      <span class="blurb">${esc(r.blurb)}</span>
      <span class="meta km">${esc(kmLine(r))}</span>
      <span class="meta eta" data-eta></span>
      <span class="meta">${structSummary(r)}</span>
      <div class="proc" data-proc="${esc(r.id)}">${procHtml(r.processing)}</div>
      ${(r.kind === 'server' ? me.admin : (me.admin || r.by === me.username)) ? `<button class="del" title="Delete this route" data-del="${esc(r.id)}">×</button>` : ''}
      <span class="card-actions">
        <select class="small export" data-export="${esc(r.id)}" title="Download the route as you ride it, with its corrections built in (RideWithGPS, Garmin, Wahoo, Google Earth…)">
          <option value="">Export…</option><option value="gpx">GPX</option><option value="tcx">TCX course</option><option value="fit">FIT course</option><option value="kml">KML</option></select>
        ${(r.kind === 'server' ? me.admin : (me.admin || r.by === me.username)) ? `<a class="button small studio-link" href="studio.html?route=${encodeURIComponent(r.id)}" target="_blank" rel="noopener" title="Shape the road on the satellite map: straighten, smooth bends, drag the line (Route Studio)">🎢 Route Studio</a>${r.open && me.admin ? `<a class="button small" href="mapedit.html?route=${encodeURIComponent(r.id)}" target="_blank" rel="noopener" title="Correct the open world on a map: add paths, remove stretches, one-ways, walls; ride from any spot (Map Editor)">🗺 Map Editor</a>` : ''}
        <button class="small" data-details="${esc(r.id)}" title="Change the name, place and description">Edit details…</button>
        <button class="small" data-analyse="${esc(r.id)}" title="Look up the bridges and tunnels on this route (OpenStreetMap), so the 3D road is followed correctly">Analyse</button>
        <button class="small" data-process="${esc(r.id)}" title="Run the route pipeline on it: survey heights, Google's road height, underpasses, climbs, walls">Process again</button>` : ''}
        ${(r.kind === 'server' ? me.admin : (me.admin || r.by === me.username)) ? `<button class="small" data-replace="${esc(r.id)}" title="Swap in an edited GPX (e.g. the export, reworked in RideWithGPS). Same route; its corrections are cleared">Replace GPX…</button>` : ''}
        ${r.kind === 'user' && me.admin ? `<button class="small promote" data-promote="${esc(r.id)}" title="Make it a RideWorld route everyone can ride">Make server route</button>` : ''}
      </span>
      </div>
    </div>`;
  const server = suggested.filter((r) => r.kind !== 'user'), mine = suggested.filter((r) => r.kind === 'user');
  $('pane-suggest').innerHTML = `
    <p class="note pace">Route times at <select id="cfg-pace" class="small">${PACES.map((p) => `<option value="${p}">${p}%</option>`).join('')}</select>
      of your FTP (<span id="pace-w"></span>), a steady, comfortable pace</p>
    <div class="route-tools">
      <input type="search" id="rt-search" placeholder="Search name or place" aria-label="Search routes">
      <select id="rt-country" aria-label="Country"><option value="">All countries</option>${[...new Set(suggested.map((r) => r.country).filter(Boolean))].sort((a, b) => countryName(a).localeCompare(countryName(b))).map((c) => `<option value="${esc(c)}">${esc(countryName(c))}</option>`).join('')}</select>
      <select id="rt-sort" aria-label="Sort by"><option value="name">Name</option><option value="km">Shortest first</option><option value="-km">Longest first</option><option value="gain">Least climbing</option><option value="-gain">Most climbing</option><option value="-steep">Steepest (m per km)</option><option value="-added">Newest</option></select>
    </div>
    <details class="route-group" data-group="server" open><summary><h3 class="group">RideWorld routes <span class="count"></span></h3></summary>
    <div class="cards">${server.map(card).join('') || '<p class="note">None yet.</p>'}</div></details>
    <details class="route-group" data-group="mine" open><summary><h3 class="group">My routes <span class="count"></span></h3></summary>
    <div class="cards">${mine.map(card).join('') || '<p class="note">Load a GPX file and save it here to ride it again.</p>'}</div></details>`;
  wireRouteTools();
  $('cfg-pace').value = PACES.includes(+store.get('pace', 75)) ? store.get('pace', 75) : 75;
  $('cfg-pace').addEventListener('change', () => { store.set('pace', $('cfg-pace').value); refreshRouteTimes(); });
  refreshRouteTimes();
  { const ci = suggested.find((r) => r.id === store.get('suggested')); if (ci?.open) showOpenStart(ci); } // (back into its re-drawn card)
  document.querySelectorAll('.route-card').forEach((el) => {
    el.addEventListener('click', (e) => { if (!e.target.closest('button, select')) pickSuggested(el.dataset.id); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') pickSuggested(el.dataset.id); });
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const r = suggested.find((x) => x.id === b.dataset.del);
    if (!confirm(r.kind === 'user' ? `Delete your route "${r.name}"?` : `Delete the RideWorld route "${r.name}" for everyone?`)) return;
    try {
      await api(`api/routes/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (store.get('suggested', '') === r.id) { suggestRoute = null; useRoute(); }
      await loadSuggested();
    } catch (e) { toast('Could not delete: ' + e.message); }
  }));
  document.querySelectorAll('[data-export]').forEach((s) => s.addEventListener('change', () => {
    if (s.value) exportRoute(suggested.find((x) => x.id === s.dataset.export), s.value);
    s.value = '';
  }));
  document.querySelectorAll('[data-details]').forEach((b) => b.addEventListener('click', () => editDetails(suggested.find((x) => x.id === b.dataset.details))));
  document.querySelectorAll('[data-analyse]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Analysing…';
    try { await api(`api/routes/${encodeURIComponent(b.dataset.analyse)}/analyse`, { method: 'POST' }); await loadSuggested(b.dataset.analyse); toast('Route analysed.'); }
    catch (e) { toast('Could not analyse: ' + e.message, 6000); b.disabled = false; b.textContent = 'Analyse'; }
  }));
  document.querySelectorAll('[data-process]').forEach((b) => b.addEventListener('click', async () => {
    const r = suggested.find((x) => x.id === b.dataset.process);
    // a hand-tuned RideWorld route (Bristol's bridge decks, the Alpe's hairpins) would get the pipeline's heights instead
    if (r.kind !== 'user' && !confirm(`Process "${r.name}" again? Its heights are replaced by the pipeline's (the file as first uploaded is kept), which undoes any heights tuned by hand.`)) return;
    b.disabled = true;
    try { await api(`api/routes/${encodeURIComponent(b.dataset.process)}/process`, { method: 'POST' }); await loadSuggested(store.get('suggested', '')); toast('Queued for processing.'); }
    catch (e) { toast('Could not queue it: ' + e.message, 6000); b.disabled = false; }
  }));
  document.querySelectorAll('[data-replace]').forEach((b) => b.addEventListener('click', () => replaceRoute(suggested.find((x) => x.id === b.dataset.replace))));
  document.querySelectorAll('[data-promote]').forEach((b) => b.addEventListener('click', async () => {
    const r = suggested.find((x) => x.id === b.dataset.promote);
    if (!confirm(`Make "${r.name}" a RideWorld route? Everyone will see it, and only admins can change it.`)) return;
    try { await api(`api/routes/${encodeURIComponent(r.id)}/promote`, { method: 'POST' }); await loadSuggested(r.id); toast(`"${r.name}" is now a RideWorld route.`); }
    catch (e) { toast('Could not promote: ' + e.message); }
  }));
  watchProcessing();
  const want = select || store.get('suggested', '');
  let pick = suggested.find((r) => r.id === want);
  if (select && pick) setMode(modeOf(pick), false); // (a route asked for by name: its mode)
  else { if (!mode && pick) mode = modeOf(pick); setMode(mode || 'routes', false); if (pick && modeOf(pick) !== mode) pick = null; }
  pick ||= suggested.find((r) => r.id === store.get('suggested.' + mode) && modeOf(r) === mode) || suggested.find((r) => modeOf(r) === mode && r.kind !== 'user') || suggested.find((r) => modeOf(r) === mode);
  if (pick) await pickSuggested(pick.id);
}

export function showTab(tab) {
  routeTab = tab;
  store.set('routeTab', tab);
  for (const t of TABS) {
    $('tab-' + t).classList.toggle('active', t === tab);
    $('pane-' + t).classList.toggle('hidden', t !== tab);
  }
  if (tab === 'plan') { planner.refresh(); planner.update(); }
  else if (tab === 'suggest') $('route-msg').textContent = suggestRoute ? suggestRoute.msg : 'Pick a route.';
  else $('route-msg').textContent = gpxRoute ? gpxRoute.msg : '';
  useRoute();
}
export const find = async () => {
  try { await planner.search($('plan-q').value); } catch (e) { toast(e.message); }
};

export const dlgPw = $('dlg-password');

// ---------- accounts (admins) ----------
export const dlgAcc = $('dlg-accounts');
export const newPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(14));
  return [...r].map((x) => a[x % a.length]).join('');
};
export const showSecret = (who, pw) => {
  $('accounts-msg').innerHTML = `Password for <strong>${esc(who)}</strong>: <span class="secret">${esc(pw)}</span>
    — send it to them; they can change it under Password once signed in. It isn't shown again.`;
};
// people who registered interest on the sign-in page
async function listInterest() {
  const [{ list }, { users }] = await Promise.all([api('api/interest'), api('api/users')]);
  // someone given an account by hand before Approve existed: same name (or email) as the registration
  const norm = (t) => String(t || '').trim().toLowerCase();
  const existing = (x) => !x.approved && users.find((u) => norm(u.name) === norm(x.name) || (u.email && norm(u.email) === norm(x.email)));
  $('interest-count').textContent = list.length ? `(${list.length})` : '';
  const done = (x) => x.approved ? `<br><span class="ok">✓ Account <strong>${esc(x.approved.username)}</strong> · ${x.approved.emailed ? 'details emailed' : 'email failed'} ${esc(new Date(x.approved.at).toLocaleDateString('en-GB'))}</span>` : '';
  $('interest-list').innerHTML = list.length ? list.map((x) => `
    <tr><td><strong>${esc(x.name)}</strong> <span class="opt">${esc(x.email)} · ${esc(new Date(x.date).toLocaleDateString('en-GB'))}</span>${x.note ? `<br><span class="opt">${esc(x.note)}</span>` : ''}${done(x)}${existing(x) ? `<br><span class="opt">Already has an account: ${esc(existing(x).username)}</span>` : ''}</td>
    <td>${existing(x) ? `<button class="small" data-approve="${esc(x.id)}" data-existing="${esc(existing(x).username)}" title="They already have an account (${esc(existing(x).username)}): give it a new password and email them the details">Email details</button>` : x.approved ? `<button class="small" data-approve="${esc(x.id)}" title="A new password, emailed to them again">Send again</button>` : `<button class="small primary" data-approve="${esc(x.id)}" title="Make their account and email them the sign-in details">Approve</button>`} <button class="small" data-drop="${esc(x.id)}">Remove</button></td></tr>`).join('')
    : '<tr><td class="opt">Nobody yet.</td></tr>';
  // Approve: the server makes the account (username from their name, a generated password) and emails them the
  // details with the notes from the Email section below; Send again gives them a new password
  $('interest-list').querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    const x = list.find((y) => y.id === b.dataset.approve);
    const ex = b.dataset.existing;
    const ask = x.approved || ex ? `Give ${ex || x.approved.username} a new password and email the sign-in details to ${x.email}? Their old password stops working.` : `Make an account for ${x.name} and email the sign-in details to ${x.email}?`;
    if (!confirm(ask)) return;
    b.disabled = true; $('accounts-msg').textContent = 'Working…';
    try {
      const r = await api(`api/interest/${x.id}/approve`, { method: 'POST', body: JSON.stringify(ex ? { existing: ex } : {}) });
      if (r.emailed) $('accounts-msg').textContent = `Done: ${x.name} is ${r.username}, and the sign-in details are on their way to ${x.email}.`;
      else $('accounts-msg').innerHTML = `Account <strong>${esc(r.username)}</strong> made, but the email failed (${esc(r.mailError)}). Password: <span class="secret">${esc(r.password)}</span> (send it to them; it isn't shown again).`;
      listUsers(); listInterest();
    } catch (e) { $('accounts-msg').textContent = e.message; b.disabled = false; }
  }));
  $('interest-list').querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this person from the list?')) return;
    try { await api(`api/interest/${b.dataset.drop}`, { method: 'DELETE' }); listInterest(); } catch (e) { $('accounts-msg').textContent = e.message; }
  }));
}

// Brevo email settings (the key is never sent back, only its last 4 characters)
async function loadMail() {
  const st = await api('api/mail'), f = $('mail-form'), el = (n) => f.elements.namedItem(n);
  el('from').value = st.from; el('fromName').value = st.fromName; el('notify').value = st.notify; el('thanks').checked = st.thanks;
  el('welcomeNotes').value = st.welcomeNotes || '';
  el('apiKey').value = '';
  $('mail-key-saved').textContent = st.keyEnd ? `(saved, ends …${st.keyEnd}; leave blank to keep it)` : '(not set)';
  $('mail-msg').textContent = st.configured ? 'Email is on.' : 'Email is off until a key and sender are saved.';
}
let mailWired = false;
function wireMail() {
  if (mailWired) return;
  mailWired = true;
  const f = $('mail-form'), el = (n) => f.elements.namedItem(n);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('api/mail', { method: 'PUT', body: JSON.stringify({ apiKey: el('apiKey').value, from: el('from').value, fromName: el('fromName').value, notify: el('notify').value, thanks: el('thanks').checked, welcomeNotes: el('welcomeNotes').value }) });
      await loadMail();
      $('mail-msg').textContent = 'Saved. ' + $('mail-msg').textContent;
    } catch (err) { $('mail-msg').textContent = err.message; }
  });
  $('mail-welcome').addEventListener('click', async () => {
    $('mail-msg').textContent = 'Sending…';
    try { const r = await api('api/mail/welcome-test', { method: 'POST' }); $('mail-msg').textContent = `Example welcome email sent to ${r.to} (save your notes first if you've changed them).`; }
    catch (err) { $('mail-msg').textContent = err.message; }
  });
  $('mail-test').addEventListener('click', async () => {
    $('mail-msg').textContent = 'Sending…';
    try { const r = await api('api/mail/test', { method: 'POST' }); $('mail-msg').textContent = `Test sent to ${r.to}. Check the inbox (and spam).`; }
    catch (err) { $('mail-msg').textContent = err.message; }
  });
}

export async function listUsers() {
  listInterest().catch((e) => console.warn('interest list', e));
  wireMail(); loadMail().catch((e) => console.warn('mail settings', e));
  const { users } = await api('api/users');
  $('user-list').innerHTML = users.map((u) => `
    <tr><td><strong>${esc(u.name)}</strong> <span class="opt">${esc(u.username)}${u.admin ? ' · admin' : ''}</span></td>
    <td><button class="small" data-reset="${esc(u.username)}">New password</button>
    ${u.username === me.username ? '' : `<button class="small" data-remove="${esc(u.username)}">Remove</button>`}</td></tr>`).join('');
  $('user-list').querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const u = b.dataset.reset;
    if (!confirm(`Give ${u} a new password? Their current one stops working.`)) return;
    const pw = newPassword();
    try { await api(`api/users/${encodeURIComponent(u)}/password`, { method: 'POST', body: JSON.stringify({ password: pw }) }); showSecret(u, pw); }
    catch (e) { $('accounts-msg').textContent = e.message; }
  }));
  $('user-list').querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const u = b.dataset.remove;
    if (!confirm(`Remove ${u}'s account? Their routes stay.`)) return;
    try { await api(`api/users/${encodeURIComponent(u)}`, { method: 'DELETE' }); $('accounts-msg').textContent = `Removed ${u}.`; listUsers(); }
    catch (e) { $('accounts-msg').textContent = e.message; }
  }));
}


// ---------- Strava ----------
export let stravaState = { configured: false, connected: false };
export async function refreshStrava() {
  try { stravaState = await api('api/strava'); } catch { return; }
  const st = stravaState;
  $('strava-status').textContent = !st.configured ? (me.admin ? 'Not set up yet: add your Strava app in 🔑 Keys at the top.' : 'Not set up on this site yet.')
    : st.connected ? `Connected as ${st.athlete || 'your Strava account'}. Rides upload as Virtual Rides.` : 'Connect to upload rides straight to Strava.';
  $('btn-strava').classList.toggle('hidden', !st.configured);
  $('btn-strava').textContent = st.connected ? 'Disconnect' : 'Connect with Strava';
  $('strava-admin').classList.toggle('hidden', !me.admin);
  if (me.admin && st.clientId) $('strava-id').value = st.clientId;
}

export async function uploadToStrava() {
  const b = $('finish-strava'), msg = $('finish-strava-msg');
  if (state.simUsed) return; // simulator rides never go to Strava
  b.disabled = true;
  msg.textContent = 'Uploading to Strava… (this takes a few seconds while Strava processes it)';
  try {
    const fit = toFit(recorder.samples, { name: route.name, elapsed: state.elapsed });
    let bin = '';
    for (let i = 0; i < fit.length; i += 0x8000) bin += String.fromCharCode(...fit.subarray(i, i + 0x8000));
    const info = suggested.find((r) => r.id === store.get('suggested', '')) || {};
    const stats = Object.fromEntries(state.summary || []);
    const description = [
      routeTab === 'suggest' && info.blurb ? info.blurb : '',
      [stats['Distance'], stats['Climbing'] && `${stats['Climbing']} climbing`, stats['Average power'] && `avg ${stats['Average power']}`, stats['Time']].filter(Boolean).join(' · '),
      'Ridden on RideWorld 🌍🚴',
    ].filter(Boolean).join('\n\n');
    // a saved ride goes up from the server's copy (and is marked as uploaded in My rides)
    if (state.rideId) {
      const r = await uploadSaved(state.rideId, description);
      msg.innerHTML = r.url ? `Uploaded! <a href="${r.url}" target="_blank" rel="noopener">Open it on Strava</a>` : esc(r.message || 'Uploaded.');
      b.textContent = 'Uploaded ✓';
      return;
    }
    const r = await api('api/strava/upload', {
      method: 'POST',
      body: JSON.stringify({ fit: btoa(bin), name: `${route.name || 'Ride'} (RideWorld)`, description, externalId: `rideworld-${me.username}-${recorder.samples[0]?.time?.toISOString?.()}` }),
    });
    msg.innerHTML = r.url ? `Uploaded! <a href="${r.url}" target="_blank" rel="noopener">Open it on Strava</a>` : esc(r.message || 'Uploaded.');
    b.textContent = 'Uploaded ✓';
  } catch (e) {
    msg.textContent = 'Strava upload failed: ' + e.message;
    b.disabled = false;
  }
}

export const currentInfo = () => (routeTab === 'suggest' ? suggested.find((r) => r.id === store.get('suggested', '')) : null);

// start-up: rider settings: weights, units, load the account's settings, difficulty (main.js runs these in order)
export async function initRiderSettings() {
  for (const k of ['rider', 'bike']) {
    $('cfg-' + k).addEventListener('change', () => {
      const v = +$('cfg-' + k).value;
      if (!(v > 0)) return;
      kg[k] = +(v / U().weight).toFixed(2);
      store.set(k, kg[k]);
      saveSetting(k, String(kg[k]));
    });
  }
  $('cfg-units').addEventListener('change', () => { showWeights(); refreshUnits(); });
  // route times depend on these (the weights' own listeners above run first, so kg is up to date)
  ['cfg-ftp', 'cfg-rider', 'cfg-bike'].forEach((id) => $(id).addEventListener('change', () => refreshRouteTimes()));

  {
    const server = await api('api/settings');
    setMe(server.me);
    store.set('hasAccount', '1'); // the sign-in page then opens on Sign in, not Register interest
    for (const k of GLOBAL_KEYS) if (server.global[k] !== undefined) { $(fields[k]).value = server.global[k]; store.set(k, server.global[k]); }
    for (const k of USER_KEYS) {
      if (server.user[k] === undefined) continue;
      store.set(k, server.user[k]);
      if (k === 'rider' || k === 'bike') kg[k] = +server.user[k] || kg[k];
      else $(fields[k]).value = server.user[k];
      if (k === 'bots') renderBots();
    }
    showWeights();
    $('me').textContent = me.name || me.username;
    $('me').dataset.initials = (me.name || me.username).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); // (the avatar)
    $('btn-accounts').classList.toggle('hidden', !me.admin);
    $('btn-status').classList.toggle('hidden', !me.admin);
    $('btn-keys').classList.toggle('hidden', !me.admin);
    if (server.user.music) rememberMusic(server.user.music); // (the link used to be an account setting: keep it as a recent one)
    $('save-server-wrap').classList.toggle('hidden', !me.admin);
  }
  $('cfg-diff').addEventListener('input', diffLabel);
  diffLabel();
}

// start-up: setup screen: browser checks, sensors, routes (list, planner, GPX) (main.js runs these in order)
export async function initSetupScreen() {
  if (mode) document.body.dataset.mode = mode; // (the colours before the route list arrives)
  document.querySelectorAll('.mode-tile').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  // ---------- environment checks ----------
  (function checkEnv() {
    const msgs = [];
    if (!window.isSecureContext) {
      msgs.push(`This page isn't a secure context, so Chrome hides USB access. Open it via <code>https://</code> (the server prints the address), or add this address to <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>.`);
    } else if (window.rideworldApp?.platform === 'android') {
      // (the Android app: no USB stick yet, Bluetooth only; the stick button and its Zadig video are hidden, the owner 2026-11-24)
      for (const id of ['btn-ant', 'btn-ant-help']) { const el = $(id); if (el) el.style.display = 'none'; }
    } else if (!AntStick.supported()) {
      msgs.push('This browser has no WebUSB. Use Chrome or Edge on Windows/Linux/macOS.');
    }
    if (msgs.length) { $('secure-warn').innerHTML = msgs.join('<br>'); $('secure-warn').classList.remove('hidden'); }
  })();
  ['cfg-google', 'cfg-ion'].forEach((id) => $(id).addEventListener('input', updateGo));
  // ⚙ Advanced (everyone) and 🔑 Keys (admins): settings few people change, kept off the setup screen
  for (const k of ['advanced', 'keys']) {
    $('btn-' + k).addEventListener('click', () => $('dlg-' + k).showModal());
    $('close-' + k).addEventListener('click', () => $('dlg-' + k).close());
  }
  $('diff-reset').addEventListener('click', () => { $('cfg-diff').value = 50; $('cfg-diff').dispatchEvent(new Event('input')); $('cfg-diff').dispatchEvent(new Event('change')); });
  updateGo();
  ['cfg-rider', 'cfg-bike'].forEach((id) => $(id).addEventListener('change', sendTrainerSetup));
  $('test-grade').addEventListener('input', () => {
    testLabel();
    devices.setGrade(+$('test-grade').value);
  });
  testLabel();

  // the sensor list, and keeping the trainer set up as devices come and go
  renderSensors();
  $('sensor-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-anthr]') && devices.ant) { devices.ant.forgetHr().then(() => { $('ant-msg').textContent = 'Listening for any ANT+ heart-rate strap: wear the one you want (and keep watches from broadcasting). It will be remembered.'; renderSensors(); }); return; }
    const b = e.target.closest('[data-drop]');
    if (!b) return;
    const d = devices[b.dataset.drop];
    d?.disconnect(); devices[b.dataset.drop] = null;
    if (d?.device) keepBle(keptBle().filter((k) => k.id !== d.device.id)); // disconnected by hand: not reconnected next time
    renderSensors(); updateGo();
  });
  setInterval(() => {
    if (!state.riding && $('setup').offsetParent) renderSensors();
    if (devices.anyTrainer && !state.trainerSetup) sendTrainerSetup();
    if (!devices.anyTrainer) state.trainerSetup = false;
    $('test-grade').disabled = !devices.trainerConnected;
  }, 1000);

  // the Zadig/WinUSB explainer video (public/media/ant-setup.mp4)
  const antHelp = () => { $('dlg-ant-help').showModal(); $('ant-video').play().catch(() => {}); };
  $('btn-ant-help').addEventListener('click', antHelp);
  $('close-ant-help').addEventListener('click', () => $('dlg-ant-help').close());
  $('dlg-ant-help').addEventListener('close', () => $('ant-video').pause());
  $('ant-msg').addEventListener('click', (e) => { if (e.target.closest('a[data-ant-help]')) { e.preventDefault(); antHelp(); } });

  const openAnt = async (known) => {
    const ant = new AntStick();
    try {
      $('ant-msg').textContent = 'Opening stick…';
      await ant.connect(known);
      devices.ant = ant;
      store.set('antKeep', '1');
      $('ant-msg').textContent = 'Stick open: pedal and wear your strap, and ANT+ sensors appear below as they broadcast.';
      setLabel($('btn-ant'), 'ANT+ stick on'); $('btn-ant').classList.add('connected');
      $('btn-ant').disabled = true;
      ant.addEventListener('error', (e) => { toast('ANT+ stick disconnected'); console.error(e.detail); });
      updateGo();
      return true;
    } catch (e) {
      console.error(e);
      if (known) { $('ant-msg').textContent = ''; return false; } // (the automatic reopen: say nothing, the button still works)
      let hint = e.message;
      if (/Access denied|Unable to claim|SecurityError/i.test(e.message)) {
        hint += ' — on Windows, install the WinUSB driver for the stick with Zadig, and close Zwift/Garmin Express/other apps using it.';
      }
      $('ant-msg').textContent = 'Could not open stick: ' + hint + ' ';
      const a = document.createElement('a');
      a.href = '#'; a.dataset.antHelp = '1'; a.textContent = '▶ Watch how to set it up';
      $('ant-msg').append(a);
    }
  };
  $('btn-ant').addEventListener('click', () => openAnt());
  // a Bluetooth device in its place in devices.js, remembered for next time (rw.bleKeep: [{ id, slot, name }])
  const attachBle = (dev, slot) => {
    devices[slot]?.disconnect();
    devices[slot] = dev;
    keepBle([...keptBle().filter((k) => k.slot !== slot && k.id !== dev.device.id), { id: dev.device.id, slot, name: dev.name }]);
    dev.addEventListener('status', (e) => {
      if (e.detail === 'reconnecting') toast(`${dev.name} disconnected, reconnecting…`);
      if (e.detail === 'reconnected') { toast(`${dev.name} reconnected`); state.trainerSetup = false; }
      if (e.detail === 'lost') toast(`Lost ${dev.name}: still trying every 10 s. Or add it again from the sensor buttons (⚙ Settings → Sensors).`, 9000);
    });
    if (slot === 'bleTrainer' && !dev.controllable) toast(`${dev.name} gives power but won't take resistance control. Close Zwift or other apps using it, then reconnect.`, 9000);
    renderSensors(); updateGo();
  };
  // Reconnect what was used last time (the owner 2026-10-29: "every time I stop and start a ride, it doesn't remember the
  // devices"): the page reloads after every ride. Chrome remembers what this site was allowed, so no picker is needed.
  (async () => {
    try {
      // (one retry: the page before may not have let go of the stick yet)
      const known = store.get('antKeep') === '1' && await AntStick.remembered();
      if (known && !(await openAnt(known)) && !devices.ant) setTimeout(() => devices.ant || openAnt(known), 2000);
    } catch (e) { console.warn('ANT+ reopen', e); }
    const kept = keptBle();
    if (!kept.length || !bleSupported()) return;
    if (!bleRemembers()) {
      $('bt-note').textContent = `To reconnect ${kept.map((k) => k.name).join(', ')} by itself, Chrome needs chrome://flags/#enable-web-bluetooth-new-permissions-backend switched on.`;
      return;
    }
    // Chrome only hands back devices once its newer Bluetooth permissions are on (a flag in some versions)
    const allowed = new Set((await navigator.bluetooth.getDevices().catch(() => [])).map((d) => d.id));
    if (!kept.some((k) => allowed.has(k.id))) {
      $('bt-note').textContent = `Chrome didn't hand back ${kept.map((k) => k.name).join(', ')}. To reconnect them by itself, switch on chrome://flags/#enable-web-bluetooth-new-permissions-backend and add them once more.`;
      return;
    }
    $('ant-msg').textContent = `Reconnecting ${kept.map((k) => k.name).join(', ')}… (wake them by pedalling / wearing the strap)`;
    for (const k of kept.filter((x) => allowed.has(x.id))) {
      reconnectBle(k.id, k.slot, (dev) => { if (!devices[k.slot]?.connected) { attachBle(dev, k.slot); $('ant-msg').textContent = `${dev.name} reconnected.`; } })
        .catch((e) => console.warn('Bluetooth reconnect', k.name, e));
    }
  })();
  if (!bleSupported()) {
    $('btn-bt-add').disabled = true;
    $('bt-note').textContent = 'Bluetooth needs Chrome or Edge on a secure (https) page, with Bluetooth switched on.';
  }
  // forget every Bluetooth device (2026-11-21, a rider: "no option to delete paired devices"): disconnect them, have
  // Chrome forget its permission for each (BluetoothDevice.forget, where Chrome has it) and drop the reconnect list
  $('btn-bt-forget')?.addEventListener('click', async () => {
    for (const slot of ['bleTrainer', 'blePower', 'bleHr', 'bleCadence']) { try { devices[slot]?.disconnect(); } catch {} devices[slot] = null; }
    let n = 0;
    try { for (const d of await navigator.bluetooth?.getDevices?.() || []) { try { await d.forget?.(); n++; } catch {} } } catch {}
    keepBle([]);
    renderSensors(); updateGo();
    $('ant-msg').textContent = `Bluetooth devices forgotten${n ? ` (${n})` : ''}. Wake your trainer / strap and press Add a Bluetooth device to pair them again.`;
  });
  $('btn-bt-add').addEventListener('click', async () => {
    try {
      $('ant-msg').textContent = 'Choose a trainer, power meter, heart-rate strap or cadence sensor in the Bluetooth window…';
      const { dev, slot } = await pickAnyBle();
      attachBle(dev, slot);
      const what = { bleTrainer: 'trainer', blePower: 'power meter', bleHr: 'heart-rate strap', bleCadence: 'cadence sensor' }[slot];
      $('ant-msg').textContent = `${dev.name} connected as your ${what}. Add another the same way.`;
      if ($('setup').classList.contains('hidden')) toast(`${dev.name} connected as your ${what}.`, 5000); // (added from the ride's pills)
    } catch (e) {
      if (e.name === 'NotFoundError') { $('ant-msg').textContent = 'No device chosen.'; return; } // picker cancelled
      console.error(e);
      $('ant-msg').textContent = `Could not connect: ${e.message}`;
    }
  });
  if (!TABS.includes(routeTab)) routeTab = 'suggest';

  $('plan-profile').value = store.get('planProfile', 'fastbike');
  $('plan-loop').checked = store.get('planLoop', '0') === '1';
  for (const t of TABS) $('tab-' + t).addEventListener('click', () => showTab(t));
  $('cfg-skip').addEventListener('input', showSkip);
  await loadSuggested();
  $('plan-undo').addEventListener('click', () => planner.undo());
  $('plan-clear').addEventListener('click', () => planner.clear());
  $('plan-save').addEventListener('click', () => planner.downloadGpx());
  $('plan-profile').addEventListener('change', () => { store.set('planProfile', $('plan-profile').value); planner.update(); });
  $('plan-loop').addEventListener('change', () => { store.set('planLoop', $('plan-loop').checked ? '1' : '0'); planner.update(); });
  $('plan-find').addEventListener('click', find);
  $('plan-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });

  $('route-details').addEventListener('submit', saveDetails);
  $('rd-cancel').addEventListener('click', () => $('dlg-route-details').close());
  $('gpx').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const { name, gpx: text } = await routeFileToGpx(f); // TCX, FIT and KML arrive as GPX
      gpxRoute = Route.fromGpx(text, name);
      gpxRoute.msg = routeMsg(gpxRoute);
      gpxRoute.text = text;
      $('save-name').value = gpxRoute.name;
      $('save-where').value = '';
      $('save-blurb').value = '';
      $('gpx-save').classList.remove('hidden');
      $('route-msg').textContent = gpxRoute.msg;
    } catch (err) {
      gpxRoute = null;
      $('gpx-save').classList.add('hidden');
      $('route-msg').textContent = 'Could not read that file: ' + err.message;
    }
    useRoute();
  });
  showTab(routeTab);
}

// start-up: save a GPX as a route, account and Accounts dialogs, Strava (main.js runs these in order)
export async function initAccountAndStrava() {
  // ---------- save an imported GPX as a suggested route ----------
  $('btn-save-route').addEventListener('click', async () => {
    if (!gpxRoute?.text) return;
    const b = $('btn-save-route');
    b.disabled = true;
    try {
      const { route: r } = await api('api/routes', {
        method: 'POST',
        body: JSON.stringify({ name: $('save-name').value, where: $('save-where').value, blurb: $('save-blurb').value, gpx: gpxRoute.text,
          kind: me.admin && $('save-server').checked ? 'server' : 'user' }),
      });
      $('gpx-save').classList.add('hidden');
      toast(r.kind === 'server' ? `"${r.name}" is now a RideWorld route.` : `Saved "${r.name}" to My routes.`);
      showTab('suggest');
      await loadSuggested(r.id);
    } catch (e) {
      toast('Could not save the route: ' + e.message, 6000);
    } finally {
      b.disabled = false;
    }
  });

  // ---------- account: sign out, change password ----------
  $('btn-logout').addEventListener('click', async () => {
    try { await api('api/logout', { method: 'POST' }); } catch {}
    location.href = '/login.html';
  });
  $('btn-password').addEventListener('click', () => { $('change-password').reset(); $('password-msg').textContent = ''; dlgPw.showModal(); });
  $('close-password').addEventListener('click', () => dlgPw.close());
  $('change-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.again.value) { $('password-msg').textContent = "The new passwords don't match."; return; }
    try {
      await api('api/password', { method: 'POST', body: JSON.stringify({ current: f.current.value, next: f.next.value }) });
      dlgPw.close();
      toast('Password changed. Other devices have been signed out.');
    } catch (err) { $('password-msg').textContent = err.message; }
  });
  $('btn-accounts').addEventListener('click', async () => {
    $('accounts-msg').textContent = '';
    try { await listUsers(); dlgAcc.showModal(); } catch (e) { toast(e.message); }
  });
  $('close-accounts').addEventListener('click', () => dlgAcc.close());
  $('add-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, pw = newPassword();
    try {
      const { user } = await api('api/users', { method: 'POST', body: JSON.stringify({ username: f.username.value.trim().toLowerCase(), name: f.name.value.trim(), admin: f.admin.checked, password: pw }) });
      f.reset();
      showSecret(user.username, pw);
      listUsers();
    } catch (err) { $('accounts-msg').textContent = err.message; }
  });
  $('btn-strava').addEventListener('click', async () => {
    if (!stravaState.connected) { location.href = '/api/strava/connect'; return; }
    if (!confirm('Disconnect RideWorld from your Strava account?')) return;
    await api('api/strava/disconnect', { method: 'POST' }).catch((e) => toast(e.message));
    refreshStrava();
  });
  $('btn-strava-save').addEventListener('click', async () => {
    try {
      await api('api/strava/config', { method: 'PUT', body: JSON.stringify({ clientId: $('strava-id').value, clientSecret: $('strava-secret').value }) });
      $('strava-secret').value = '';
      toast('Strava app saved. Now press Connect with Strava.');
      refreshStrava();
    } catch (e) { toast(e.message, 6000); }
  });
  { // back from Strava's sign-in page
    const q = new URLSearchParams(location.search);
    if (q.has('strava')) {
      toast(q.get('error') || 'Strava connected. Your rides will upload as Virtual Rides.', 7000);
      history.replaceState(null, '', location.pathname);
    }
  }
  refreshStrava();
}
