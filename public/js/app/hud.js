// What's on screen during a ride: dials, map, elevation graph and scrubbing, the finish panel, screenshots.
import { devices } from '../devices.js';
import { Gauge, hrBands, powerBands } from '../gauges.js';
import { MiniMap } from '../minimap.js';
import { placeCamera } from './camera.js';
import { saveGhost } from './company.js';
import { $, U, bike, download, fmtDist, fmtEle, fmtTime, kg, recorder, rideDist, route, state, toast } from './core.js';
import { ed } from './editor.js';
import { others, remotes } from './riders.js';
import { viewer } from './scenery.js';
import { sensorNames, stravaState, uploadToStrava } from './setup.js';
import { KINDS, rideSegments } from './segments.js';
import { coachFinish } from './coach.js';
import { analyseThisRide } from './analysis.js';
import { rideProgress } from './openworld.js';
import { saveRide } from './rides.js';
// The ride's numbers in the summary panel (finish, and arriving at the end of the route)
function showSummary() {
  const s = recorder.samples, n = s.length || 1;
  const avg = (k) => s.reduce((a, x) => a + (x[k] || 0), 0) / n;
  const withHr = s.filter((x) => x.hr > 0);
  let climb = 0;
  for (let i = 1; i < s.length; i++) if (s[i].ele > s[i - 1].ele) climb += s[i].ele - s[i - 1].ele;
  const u = U();
  const rows = [
    ['Time', fmtTime(state.elapsed)],
    ['Distance', fmtDist(rideDist(), 2)],
    ['Climbing', fmtEle(climb)],
    ['Average speed', `${(avg('speed') * u.speed).toFixed(1)} ${u.speedUnit}`], // from the samples, so a J jump in the simulator doesn't count
    ['Average power', `${Math.round(avg('power'))} W`],
    ['Max power', `${Math.round(Math.max(0, ...s.map((x) => x.power || 0)))} W`],
    ['Average heart rate', withHr.length ? `${Math.round(withHr.reduce((a, x) => a + x.hr, 0) / withHr.length)} bpm` : '—'],
    ['Average cadence', `${Math.round(avg('cadence'))} rpm`],
  ];
  $('finish-route').textContent = route.name || 'Route';
  $('finish-stats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  state.summary = rows;
}

// The end of a solo route (Zwift style, the owner 2026-10-26): the rider has already been turned round (turnaround.js) and
// keeps riding; this box says so and offers Keep riding (closes it) or Finish (the summary: save, Strava, back to setup).
// It stays until answered. (Until then the ride paused on the summary at the end and the stop felt abrupt.)
export function showEndBox() {
  if (state.finished) return;
  state.endBox = true;
  $('end-flag').textContent = state.legs > 1 ? '🏁 Back at the end' : state.legs ? '🏁 Route done!' : '🏁 End of the route';
  $('end-text').textContent = `${fmtDist(rideDist())} in ${fmtTime(state.elapsed)}. You've turned round onto the same road back: keep riding, or finish here.`;
  $('end-box').classList.remove('hidden');
  // Keep riding is chosen by itself after 20 s (the owner 2026-10-29), counting down on the button
  let left = 20;
  const tick = () => { $('end-keep').textContent = `↩ Keep riding (${left})`; };
  tick(); clearInterval(endTimer);
  endTimer = setInterval(() => { if (--left <= 0) hideEndBox(); else tick(); }, 1000);
}
let endTimer = 0;
const hideEndBox = () => { clearInterval(endTimer); state.endBox = false; $('end-box').classList.add('hidden'); };

export function finishRide() {
  hideEndBox();
  coachFinish();
  state.finished = true;
  state.riding = false;
  $('btn-ride').textContent = 'Finished';
  $('btn-ride').disabled = true;
  devices.setGrade(0);
  showSummary();
  $('finish-flag').textContent = '🏁 Ride complete';
  $('finish-strava').classList.toggle('hidden', !stravaState.connected || !!state.simUsed);
  if (state.simUsed) $('finish-strava-msg').textContent = 'Simulator ride: not kept in My rides, not saved as a ghost and not sent to Strava. You can still save the .fit here.';
  else if (stravaState.connected) $('finish-strava-msg').textContent = `Upload this ride to Strava? It goes to ${stravaState.athlete || 'your Strava account'} as a Virtual Ride, only if you press Upload.`;
  setTimeout(() => $('finish-panel').classList.remove('hidden'), 1500);
  if (!state.legs) saveGhost(); // after turning round it was saved at the turn
  saveRide(true); // My rides (not simulator rides; Strava only if they press Upload)
}

// ---------- dials ----------
export const gauges = {};
export const minimap = new MiniMap($('minimap'));
export const minimap2 = new MiniMap($('minimap2'), { close: true });
export function updateMinimap(now) {
  if (now - (state.mapAt || 0) < 200) return; // 5 times a second is plenty
  state.mapAt = now;
  const others = [...remotes.values()].map((r) => ({ dist: r.dist, colour: r.ghost ? '#cfe8ff' : r.kit?.jersey }));
  const rp = rideProgress(); // (a pre-plotted open-world route: its whole outline, openworld.js)
  if (rp) { const p = route.at(state.dist); minimap.drawRide(rp.R, rp.done / rp.total, [p.lat, p.lon], $('kit-jersey').value); }
  else minimap.draw(route, { dist: state.dist, colour: $('kit-jersey').value }, others);
  minimap2.draw(route, { dist: state.dist, colour: $('kit-jersey').value }, others);
}

export function setupGauges() {
  const ftp = +$('cfg-ftp').value || 250, maxhr = +$('cfg-maxhr').value || 185, u = U();
  const pMax = Math.max(400, Math.ceil((ftp * 2) / 100) * 100);
  const cfg = {
    power: { title: 'Power', unit: 'watts', min: 0, max: pMax, major: pMax <= 800 ? 100 : 200, minor: pMax <= 800 ? 20 : 50, bands: powerBands(ftp) },
    hr: { title: 'Heart rate', unit: 'bpm', min: 40, max: Math.ceil((maxhr + 10) / 20) * 20, major: 20, minor: 5, bands: hrBands(maxhr) },
    cad: { title: 'Cadence', unit: 'rpm', min: 0, max: 140, major: 20, minor: 5,
      bands: [{ from: 0, to: 70, color: '#9aa0a6' }, { from: 70, to: 80, color: '#3b82f6' }, { from: 80, to: 100, color: '#22c55e' }, { from: 100, to: 115, color: '#eab308' }, { from: 115, to: 999, color: '#f97316' }] },
    speed: { title: 'Speed', unit: u.speedUnit, min: 0, max: u.speedMax, major: u.speedMajor, minor: u.speedMajor / 5, decimals: 1, bands: [] },
  };
  $('minimap').classList.remove('hidden');
  $('minimap2').classList.remove('hidden'); document.body.classList.add('map2');
  for (const [k, o] of Object.entries(cfg)) {
    $('g-' + k).classList.remove('hidden');
    if (gauges[k]) gauges[k].configure(o); else gauges[k] = new Gauge($('g-' + k), o);
  }
}

// text written only when it changes (every frame otherwise: a style and layout pass each time on laptop graphics)
const txtSeen = {};
const txt = (id, v) => { v = String(v); if (txtSeen[id] !== v) { txtSeen[id] = v; $(id).textContent = v; } };

export function updateHud(watts3s, hr, cadence, grade, dt = 0) {
  if (gauges.power) {
    gauges.power.set(watts3s);
    gauges.power.setUnit(`${(watts3s / kg.rider).toFixed(1)} W/kg`); // (the owner 2026-11-02; the rider's weight, not the bike's)
    gauges.power.setTarget(state.woTarget ?? null); // workout target marker
    gauges.hr.set(hr || null);
    gauges.cad.set(cadence);
    gauges.speed.set(bike.v * ((state.riding && state.band) || 1) * U().speed); // group rides: the speed we really move at
    for (const g of Object.values(gauges)) g.tick(dt);
  }
  txt('m-grade', grade.toFixed(1));
  txt('m-grade-label', devices.trainerConnected && devices.sentGrade != null ? `Trainer ${devices.sentGrade.toFixed(1)}% · ${$('cfg-diff').value}% difficulty` : 'Gradient');
  txt('m-dist', (rideDist() / U().dist).toFixed(2));
  txt('m-dist-unit', U().distUnit);
  txt('m-dist-label', route.opts?.open ? 'ridden' : state.legs ? `↩ ${fmtDist(Math.max(0, route.length - state.dist))} to the end` : `of ${fmtDist(route.rideLength)}`);
  txt('m-time', fmtTime(state.elapsed));
  const set = (id, on, text) => { const el = $(id), cls = 'pill ' + (on ? 'on' : 'off'); if (el.className !== cls) el.className = cls; if (text) txt(id, text); };
  const links = [devices.ant?.running && 'ANT+', (devices.bleTrainer?.connected || devices.blePower?.connected || devices.bleHr?.connected) && 'Bluetooth'].filter(Boolean);
  set('status-ant', links.length > 0, links.length ? links.join(' + ') : 'Sensors off');
  const nm = sensorNames();
  set('status-hr', devices.hrConnected, nm.hr ? `♥ ${nm.hr}` : 'No HR');
  set('status-fec', !!devices.powerSource, nm.power ? `⚡ ${nm.power}` : 'No power');
}

const rideTrack = { id: null, base: 0, at: [] }; // (a pre-plotted route: [samples recorded, metres done] as we go, for the graph)
export function drawProfile() {
  const cv = $('profile');
  const w = (cv.width = cv.clientWidth * devicePixelRatio);
  const h = (cv.height = cv.clientHeight * devicePixelRatio);
  const ctx = cv.getContext('2d');
  // a pre-plotted open-world route (2026-11-20): the whole route's profile (rides.mjs `profile`), ridden part shaded to
  // where we are; the ride itself is built a few km at a time, so route.profile showed only the next stretch
  const rp = rideProgress();
  if (rp && rp.R.profile?.length > 1) {
    const prof = rp.R.profile; let min = Math.min(...prof), max = Math.max(...prof);
    if (max - min < 100) { min = Math.max(min - 10, (max + min) / 2 - 50); max = min + 100; }
    const pad = 8 * devicePixelRatio, x = (i) => (i / (prof.length - 1)) * w, y = (e) => h - pad - ((e - min) / (max - min)) * (h - 2 * pad);
    const di = (rp.done / rp.total) * (prof.length - 1);
    const path = () => { ctx.beginPath(); ctx.moveTo(0, h); prof.forEach((e, i) => ctx.lineTo(x(i), y(e))); ctx.lineTo(w, h); ctx.closePath(); };
    const ahead = ctx.createLinearGradient(0, 0, 0, h); ahead.addColorStop(0, 'rgba(255,255,255,0.22)'); ahead.addColorStop(1, 'rgba(255,255,255,0.03)');
    path(); ctx.fillStyle = ahead; ctx.fill();
    if (recorder.samples.length < 30) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x(di), h); ctx.clip();
    const done = ctx.createLinearGradient(0, 0, w, 0); done.addColorStop(0, 'rgba(255,138,30,0.55)'); done.addColorStop(1, 'rgba(255,46,126,0.6)');
    path(); ctx.fillStyle = done; ctx.fill(); ctx.restore(); }
    // power zones and heart rate as on other routes (the owner: "has all of the HR and power banding disappeared?"), placed by
    // how far along the route each second was ridden (rideTrack: samples count -> metres done, kept as we go)
    if (rideTrack.id !== rp.R.id || rideTrack.base !== state.distBase && rideTrack.at.length && recorder.samples.length < rideTrack.at.at(-1)[0]) { rideTrack.id = rp.R.id; rideTrack.base = state.distBase; rideTrack.at = []; }
    // (progress kept from going backwards: the satnav's estimate steps back when it re-plans, and the heart-rate line drew back
    // over itself, the owner 2026-11-22 London)
    const n = recorder.samples.length; if (!rideTrack.at.length || rideTrack.at.at(-1)[0] !== n) rideTrack.at.push([n, Math.max(rp.done, rideTrack.at.at(-1)?.[1] ?? 0)]);
    const doneAt = (i) => { const A = rideTrack.at; let lo = 0, hi = A.length - 1; if (!A.length || i < A[0][0]) return null; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m][0] <= i) lo = m; else hi = m - 1; } return A[lo][1]; };
    const xr = (m) => (m / rp.total) * w;
    const bands = powerBands(+$('cfg-ftp').value || 250), blocks = [];
    for (let i0 = 0; i0 < n; i0 += 30) {
      const s0 = doneAt(i0), s1 = doneAt(Math.min(n - 1, i0 + 30)); if (s0 == null || s1 == null) continue; // (to where the next block starts: ending a second early left slivers between them)
      const seg = recorder.samples.slice(i0, i0 + 30); if (seg.length < 5) continue;
      const avg = seg.reduce((t, sm) => t + (sm.power || 0), 0) / seg.length, col = (bands.find((b) => avg >= b.from && avg < b.to) || bands[bands.length - 1]).color;
      blocks.push([xr(Math.min(s0, s1)), Math.max(devicePixelRatio, Math.abs(xr(s1) - xr(s0)) + 0.5), col]);
    }
    if (blocks.length) {
      ctx.save(); ctx.globalAlpha = 0.14; for (const [bx, bw, col] of blocks) { ctx.fillStyle = col; ctx.fillRect(bx, 0, bw, h); }
      path(); ctx.clip(); ctx.globalAlpha = 0.62; for (const [bx, bw, col] of blocks) { ctx.fillStyle = col; ctx.fillRect(bx, 0, bw, h); } ctx.restore();
    }
    ctx.beginPath(); prof.forEach((e, i) => (i ? ctx.lineTo(x(i), y(e)) : ctx.moveTo(x(i), y(e)))); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2 * devicePixelRatio; ctx.stroke();
    {
      const maxHr = +$('cfg-maxhr').value || 185, lo = 60, hy = (b) => h - pad - ((Math.min(maxHr, b) - lo) / (maxHr - lo)) * (h - 2 * pad);
      ctx.save(); ctx.beginPath(); let pen = false, last = null;
      recorder.samples.forEach((sm, i) => { const m = doneAt(i); if (!(sm.hr > 0) || m == null) { pen = false; return; } const sx = xr(m), sy = hy(sm.hr); if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); pen = true; last = { sx, sy, hr: sm.hr }; });
      if (last) {
        ctx.strokeStyle = 'rgba(255,59,92,0.95)'; ctx.lineWidth = 1.6 * devicePixelRatio; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(255,40,80,0.8)'; ctx.shadowBlur = 6 * devicePixelRatio; ctx.stroke(); ctx.shadowBlur = 0;
        const label = `♥ ${Math.round(last.hr)}`; ctx.font = `italic 700 ${14 * devicePixelRatio}px "Barlow Semi Condensed", system-ui`;
        const tw = ctx.measureText(label).width, lx = Math.min(w - tw - 6 * devicePixelRatio, last.sx + 8 * devicePixelRatio), ly = Math.max(14 * devicePixelRatio, Math.min(h - 6 * devicePixelRatio, last.sy + 5 * devicePixelRatio));
        ctx.lineWidth = 3 * devicePixelRatio; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(label, lx, ly); ctx.fillStyle = '#ff5c7a'; ctx.fillText(label, lx, ly);
      }
      ctx.restore();
    }
    const i0 = Math.floor(di), t = di - i0, ey = prof[i0] + ((prof[Math.min(prof.length - 1, i0 + 1)] - prof[i0]) * t || 0);
    ctx.beginPath(); ctx.arc(x(di), y(ey), 5 * devicePixelRatio, 0, Math.PI * 2); ctx.fillStyle = $('kit-jersey').value || '#ff6a1a'; ctx.fill(); ctx.lineWidth = 2 * devicePixelRatio; ctx.strokeStyle = '#fff'; ctx.stroke();
    return;
  }
  // highlights routes (route.pieces): the graph shows only what's ridden, the pieces side by side; toV() maps a ride
  // metre to its place along them (the same metre on other routes)
  const L = route.rideLength;
  if (route.pieces && route._vprof?.L !== L) {
    const vp = []; for (let v = 0; v <= L; v += 10) vp.push(route.smoothEle(route.fromV(v)));
    route._vprof = { L, prof: vp };
  }
  const prof = route.pieces ? route._vprof.prof : route.profile;
  let min = Math.min(...prof), max = Math.max(...prof);
  // show at least 100 m of height, so a flat route looks flat instead of being stretched to fill the box
  if (max - min < 100) { min = Math.max(min - 10, (max + min) / 2 - 50); max = min + 100; }
  const pad = 8 * devicePixelRatio;
  const x = (i) => (i / (prof.length - 1)) * w;
  const y = (e) => h - pad - ((e - min) / (max - min)) * (h - 2 * pad);
  const doneIdx = (route.toV(state.dist) / L) * (prof.length - 1);

  const path = () => { ctx.beginPath(); ctx.moveTo(0, h); prof.forEach((e, i) => ctx.lineTo(x(i), y(e))); ctx.lineTo(w, h); ctx.closePath(); };
  // (redesign 2026-10-27) the road ahead a soft white fading down, the ridden part the brand's orange-to-pink, a crisp
  // line along the top
  const ahead = ctx.createLinearGradient(0, 0, 0, h);
  ahead.addColorStop(0, 'rgba(255,255,255,0.22)'); ahead.addColorStop(1, 'rgba(255,255,255,0.03)');
  path(); ctx.fillStyle = ahead; ctx.fill();
  // segments: shaded in their colour (climbs red, sprints green, others blue)
  for (const sg of rideSegments()) {
    if (sg.id === 'full') continue;
    const x0 = (route.toV(sg.startM) / L) * w, x1 = (route.toV(sg.endM) / L) * w;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, h); ctx.clip();
    path(); ctx.globalAlpha = 0.32; ctx.fillStyle = (KINDS[sg.kind] || KINDS.segment).colour; ctx.fill(); ctx.restore();
  }
  // power zones (the owner 2026-10-29: "power zones also overlayed/underlayed ... transparent blocks of colour matching the
  // zone ... every 30 seconds average"): this time along the route, a block per 30 s of riding in the zone colour of its
  // average power (the power dial's zones, from your FTP), strong under the profile and faint above it. They take the
  // place of the orange ridden fill; before any power is recorded the ridden part is orange as before.
  const blocks = [];
  {
    const bands = powerBands(+$('cfg-ftp').value || 250);
    let blk = null;
    const flush = () => {
      if (!blk || blk.n < 1) return;
      const avg = blk.w / blk.n, col = (bands.find((b) => avg >= b.from && avg < b.to) || bands[bands.length - 1]).color;
      const x0 = (route.toV(blk.a) / L) * w, x1 = (route.toV(blk.b) / L) * w;
      blocks.push([Math.min(x0, x1), Math.max(devicePixelRatio, Math.abs(x1 - x0) + 0.5), col]);
    };
    for (const sm of recorder.samples) {
      if (sm.base !== state.distBase || !Number.isFinite(sm.pos)) { flush(); blk = null; continue; }
      if (!blk) blk = { a: sm.pos, b: sm.pos, w: 0, n: 0 };
      blk.b = sm.pos; blk.w += sm.power || 0; blk.n++;
      if (blk.n >= 30) { flush(); blk = { a: sm.pos, b: sm.pos, w: 0, n: 0 }; }
    }
    if (blk && blk.n >= 5) flush(); // the block being ridden now, once it has 5 s
  }
  if (blocks.length) {
    ctx.save(); ctx.globalAlpha = 0.14;
    for (const [bx, bw, col] of blocks) { ctx.fillStyle = col; ctx.fillRect(bx, 0, bw, h); }
    path(); ctx.clip(); ctx.globalAlpha = 0.62;
    for (const [bx, bw, col] of blocks) { ctx.fillStyle = col; ctx.fillRect(bx, 0, bw, h); }
    ctx.restore();
  } else {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x(doneIdx), h); ctx.clip();
    const done = ctx.createLinearGradient(0, 0, w, 0);
    done.addColorStop(0, 'rgba(255,138,30,0.55)'); done.addColorStop(1, 'rgba(255,46,126,0.6)');
    path(); ctx.fillStyle = done; ctx.fill(); ctx.restore();
  }
  ctx.beginPath(); prof.forEach((e, i) => (i ? ctx.lineTo(x(i), y(e)) : ctx.moveTo(x(i), y(e))));
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2 * devicePixelRatio; ctx.stroke();
  // highlights: a thin line where one piece ends and the next begins
  if (route.pieces) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const pc of route.pieces.slice(1)) ctx.fillRect((route.toV(pc.a) / L) * w - devicePixelRatio / 2, 0, devicePixelRatio, h);
  }

  // everyone else on the graph too (the owner 2026-10-26: it works as a timeline of who's where): pacers and riders as dots
  // in their jersey colour, ghosts as pale rings; ours on top
  for (const o of others()) {
    if (!Number.isFinite(o.distNow)) continue;
    const ox = (route.toV(o.distNow) / L) * w, oy = y(route.smoothEle(o.distNow));
    ctx.beginPath(); ctx.arc(ox, oy, 3.5 * devicePixelRatio, 0, Math.PI * 2);
    if (o.ghost) { ctx.strokeStyle = 'rgba(207,232,255,0.95)'; ctx.lineWidth = 1.5 * devicePixelRatio; ctx.stroke(); continue; }
    ctx.fillStyle = o.kit?.jersey || '#cfd6df'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = devicePixelRatio; ctx.stroke();
  }
  // heart rate (the owner 2026-10-27: "a really big heart rate graph ... over the elevation graph with a thin red line"):
  // this time along the route, from 60 bpm at the bottom to your max at the top, with your latest at the end
  {
    const maxHr = +$('cfg-maxhr').value || 185, lo = 60, hy = (b) => h - pad - ((Math.min(maxHr, b) - lo) / (maxHr - lo)) * (h - 2 * pad);
    ctx.save(); ctx.beginPath();
    let pen = false, last = null;
    for (const sm of recorder.samples) {
      if (!(sm.hr > 0) || sm.base !== state.distBase || !Number.isFinite(sm.pos)) { pen = false; continue; }
      const sx = (route.toV(sm.pos) / L) * w, sy = hy(sm.hr);
      if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      pen = true; last = { sx, sy, hr: sm.hr };
    }
    if (last) {
      ctx.strokeStyle = 'rgba(255,59,92,0.95)'; ctx.lineWidth = 1.6 * devicePixelRatio; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(255,40,80,0.8)'; ctx.shadowBlur = 6 * devicePixelRatio; ctx.stroke(); ctx.shadowBlur = 0;
      const label = `♥ ${Math.round(last.hr)}`;
      ctx.font = `italic 700 ${14 * devicePixelRatio}px "Barlow Semi Condensed", system-ui`;
      const tw = ctx.measureText(label).width, lx = Math.min(w - tw - 6 * devicePixelRatio, last.sx + 8 * devicePixelRatio), ly = Math.max(14 * devicePixelRatio, Math.min(h - 6 * devicePixelRatio, last.sy + 5 * devicePixelRatio));
      ctx.lineWidth = 3 * devicePixelRatio; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(label, lx, ly);
      ctx.fillStyle = '#ff5c7a'; ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }
  { // you: a white dot ringed in orange, with a glow
    const mx = x(doneIdx), my = y(route.smoothEle(state.dist));
    ctx.save(); ctx.shadowColor = 'rgba(255,90,50,0.9)'; ctx.shadowBlur = 12 * devicePixelRatio;
    ctx.fillStyle = '#ff5a3c'; ctx.beginPath(); ctx.arc(mx, my, 6 * devicePixelRatio, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 2.6 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 ${12 * devicePixelRatio}px "Barlow Semi Condensed", system-ui`;
  ctx.fillText(fmtEle(max), 6 * devicePixelRatio, 14 * devicePixelRatio);
  ctx.fillText(fmtEle(min), 6 * devicePixelRatio, h - 6 * devicePixelRatio);

  const dpr = devicePixelRatio, xd = (d) => (Math.min(d, route.length) / route.length) * w;
  // route editor: mark each correction (blue) and the stretch being edited (outline)
  if (ed.on) {
    ctx.fillStyle = 'rgba(34,211,238,0.85)';
    for (const a of ed.list) { const x0 = xd(route.m(a.from)), x1 = xd(route.m(a.to)); ctx.fillRect(x0, 0, Math.max(2 * dpr, x1 - x0), 6 * dpr); }
    ctx.strokeStyle = 'rgba(34,211,238,0.9)'; ctx.lineWidth = dpr;
    ctx.strokeRect(xd(ed.from), 1, Math.max(2 * dpr, xd(ed.to) - xd(ed.from)), h - 2);
  }
  // scrubbing: show where you are
  if (scrub.active) {
    const label = `${(route.toV(state.dist) / U().dist).toFixed(2)} ${U().distUnit}`;
    ctx.font = `700 ${13 * dpr}px system-ui`;
    const tw = ctx.measureText(label).width, lx = Math.min(w - tw - 8 * dpr, Math.max(4 * dpr, x(doneIdx) - tw / 2));
    ctx.fillStyle = 'rgba(14,17,22,.85)'; ctx.fillRect(lx - 4 * dpr, 16 * dpr, tw + 8 * dpr, 20 * dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(label, lx, 31 * dpr);
  }
}

// ---------- scrubbing along the elevation graph (simulator / route editor only) ----------
// Click or drag on the graph to move the rider anywhere on the route. Locked during real rides.
export const scrub = { active: false };
export const canScrub = () => !!(viewer && route && ($('cfg-sim').checked || ed.on));
export function scrubTo(e) {
  const r = $('profile').getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  state.dist = Math.min(route.length - 1, route.fromV(t * route.rideLength));
  bike.v = 0;
  placeCamera(0, true);
  drawProfile();
}
export const endScrub = () => { if (scrub.active) { scrub.active = false; drawProfile(); } };

// ---------- screenshots ----------
// Renders one frame at the screen's full resolution, adds a caption strip and saves a PNG to Downloads.
// (Strava's API has no photo upload, so screenshots are saved locally to add to the activity by hand.)
export let shots = 0;
// A full-resolution frame of the 3D view (no dials or buttons) with a caption strip, as a canvas
export function captureFrame() {
  return new Promise((resolve) => {
  const sc = viewer.scene, keep = viewer.resolutionScale;
  state.quality.paused = true;
  viewer.resolutionScale = 1;
  let frames = 0;
  const off = sc.postRender.addEventListener(() => {
    if (++frames < 3) return; // let the full-resolution frame settle
    off();
    const src = viewer.canvas, c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    viewer.resolutionScale = keep;
    state.quality.paused = false;
    const u = U(), k = c.width / 1600, pad = 22 * k;
    const line1 = `${route.name || 'RideWorld'}`;
    const line2 = [fmtDist(rideDist(), 2), `${Math.round(gauges.power?.value ?? 0)} W`, gauges.hr?.value ? `${Math.round(gauges.hr.value)} bpm` : null,
      `${(bike.v * u.speed).toFixed(1)} ${u.speedUnit}`, fmtTime(state.elapsed)].filter(Boolean).join('  ·  ');
    g.fillStyle = 'rgba(14,17,22,.72)';
    g.fillRect(0, c.height - 110 * k, c.width, 110 * k);
    g.fillStyle = '#ff6a1a'; g.font = `800 ${40 * k}px system-ui, sans-serif`; g.textBaseline = 'alphabetic';
    g.fillText(line1, pad, c.height - 58 * k);
    g.fillStyle = '#f2f4f7'; g.font = `600 ${28 * k}px system-ui, sans-serif`;
    g.fillText(line2, pad, c.height - 20 * k);
    g.textAlign = 'right'; g.fillStyle = '#9aa4b2'; g.font = `700 ${24 * k}px system-ui, sans-serif`;
    g.fillText('RideWorld', c.width - pad, c.height - 20 * k);
    resolve(c);
  });
  });
}

export async function takeScreenshot() {
  const c = await captureFrame();
  c.toBlob((blob) => {
    download(blob, 'image/png', `${String(++shots).padStart(2, '0')}.png`);
    toast(`Screenshot ${shots} saved to Downloads`, 2500);
  }, 'image/png');
}

// start-up: finish panel buttons, scrubbing along the elevation graph (main.js runs these in order)
export async function initHud() {
  $('finish-save').addEventListener('click', () => $('btn-save-fit').click());
  $('finish-strava').addEventListener('click', uploadToStrava);
  $('finish-close').addEventListener('click', () => $('finish-panel').classList.add('hidden'));
  // the end of the route: carry on (just close the box) or finish
  $('finish-analyse').addEventListener('click', () => analyseThisRide(route?.name));
  $('end-keep').addEventListener('click', hideEndBox);
  $('end-finish').addEventListener('click', () => finishRide());
  // the sensor pills: tap to add a Bluetooth device mid-ride (the setup screen's button, still inside this tap's gesture)
  for (const id of ['status-hr', 'status-fec']) {
    $(id).title = 'Tap to add a Bluetooth sensor (heart-rate strap or watch, power meter, trainer)';
    $(id).addEventListener('click', () => $('btn-bt-add').click());
  }
  $('finish-setup').addEventListener('click', () => location.reload());
  $('profile-wrap').addEventListener('pointerdown', (e) => {
    if (!canScrub()) return;
    scrub.active = true;
    $('profile-wrap').setPointerCapture(e.pointerId);
    scrubTo(e);
  });
  $('profile-wrap').addEventListener('pointermove', (e) => { if (scrub.active) scrubTo(e); });
  $('profile-wrap').addEventListener('pointerup', endScrub);
  $('profile-wrap').addEventListener('pointercancel', endScrub);
  setInterval(() => $('profile-wrap').classList.toggle('scrubbable', canScrub()), 1000);
}

// start-up: screenshot button (main.js runs these in order)
export async function initScreenshots() {
  $('btn-shot').addEventListener('click', () => viewer && takeScreenshot());
}
