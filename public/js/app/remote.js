// The ride page's side of the phone remote (/rc, public/js/rc.js): once a ride is open it registers as the
// account's 'ride' with the server, carries out the phone's buttons through the same paths as the on-screen ones,
// and sends its numbers once a second. A screenshot from the phone is uploaded (POST /api/rc/shot) and the phone is
// told where to fetch it; it is also kept with the ride's photos.
import { $, api, bike, rideDist, route, state, U, fmtTime } from './core.js';
import { CAMS } from './camera.js';
import { finishRide } from './hud.js';
import { mp, giveChapeau } from './riders.js';
import { gauges } from './hud.js';
import { music, playRecent, recentMusic } from './audio.js';
import { wo } from './workouts.js';
import { snapNow } from './shots.js';
import { roadGrade } from './survey.js';
import { remoteReports, reportCancel, reportCapture, reportSend } from './report.js';
import { kg } from './core.js';
import { clipStatus, toggleClip } from './clips.js';
import { choose, ow, turnRound, clearNav, navStatus } from './openworld.js';
import { search as navSearch, go as navGo, jump as navJump } from './satnav.js';
import { gears, shift } from './gearsui.js';

// the phone's satnav search: its last query and results (ride page does the searching; the phone shows them)
const rnav = { q: '', results: [], at: 0 };
const sendNow = () => mp.send({ type: 'rc-status', s: status() });

const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
const click = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };

let shooting = false;
const COMMANDS = {
  pause: () => click('btn-ride'), camera: () => click('btn-cam'), chapeau: () => giveChapeau(), sound: () => click('btn-sound'),
  clean: () => key('k'), music: () => music.toggle(), next: () => music.next(), prev: () => music.prev(), musicpick: (m) => { playRecent(m.n); setTimeout(sendNow, 1500); },
  easier: () => click('wo-easier'), harder: () => click('wo-harder'), skip: () => click('wo-skip'), erg: () => click('wo-erg'),
  up: () => key('w'), down: () => key('s'), // (W / S: ↑ also picks the way at open-world junctions)
  way: (m) => choose({ n: m.n }), uturn: () => turnRound(), rec: () => toggleClip(),
  // satnav from the phone (the owner 2026-11-16: "RC is probably the most useful here")
  navq: (m) => { rnav.q = String(m.q || '').slice(0, 60); rnav.results = ow.on ? navSearch(rnav.q).slice(0, 10) : []; rnav.at = Date.now(); sendNow(); },
  navgo: (m) => { const p = rnav.results[m.n]; if (p) { navGo(p); rnav.results = []; rnav.q = ''; } sendNow(); },
  navoff: () => { clearNav(); sendNow(); },
  gearup: () => { shift(1); sendNow(); }, geardown: () => { shift(-1); sendNow(); }, // (virtual gears, app/gearsui.js)
  navjump: (m) => { const p = rnav.results[m.n]; if (p) { navJump(p); rnav.results = []; rnav.q = ''; } sendNow(); },
  // added 2026-10-19: finish (the phone asks for confirmation, so no dialog pops up on the PC), Film mode, and the
  // choice at the end of the route
  finish: () => { if (!state.finished && state.elapsed > 0) finishRide(); },
  film: () => key('f'), turn: () => click('end-keep'), finishhere: () => click('end-finish'),
  report: () => reportCapture(), reportsend: (m) => reportSend(m.note), reportcancel: () => reportCancel(),
  shot: async () => {
    if (shooting) return; // (the big button gets smashed: one photo, not a burst)
    shooting = true;
    try {
      const blob = await snapNow();
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      const { url } = await api('api/rc/shot', { method: 'POST', body: JSON.stringify({ image: b64, route: route?.name }) });
      mp.send({ type: 'rc-shot', url });
    } catch (e) { console.warn('remote screenshot failed', e); }
    shooting = false;
  },
};

function status() {
  const u = U();
  return {
    power: Math.round(gauges.power?.value ?? 0), wkg: ((gauges.power?.value ?? 0) / kg.rider).toFixed(1), reports: remoteReports,
    hr: Math.round(gauges.hr?.value ?? 0) || null,
    speed: (bike.v * ((state.riding && state.band) || 1) * u.speed).toFixed(1), speedUnit: u.speedUnit,
    dist: (rideDist() / u.dist).toFixed(2), distUnit: u.distUnit, time: fmtTime(state.elapsed),
    grade: Number.isFinite(state.dist) ? roadGrade(state.dist).toFixed(1) : null,
    riding: state.riding, finished: state.finished, sim: $('cfg-sim').checked,
    arrived: !!state.endBox, started: state.elapsed > 0, film: !!state.film,
    cam: (state.slideshow ? '▶ ' : '') + (CAMS[state.cam]?.name || ''),
    // where (the admin status page's map and list; the phone ignores it)
    where: route && Number.isFinite(state.dist) ? (() => { const p = route.at(state.dist); return { route: route.name, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), d: Math.round(state.dist), of: Math.round(route.length), secs: Math.round(state.elapsed || 0) }; })() : null,
    // an open-world junction coming up (big buttons on the phone) and the clip recorder
    junction: ow.on && ow.shown ? { m: Math.max(0, Math.round(ow.shown.atM - state.dist)), ways: ow.shown.ways.map((w, n) => ({ n, name: w.name || (Math.abs(w.turn) < 0.3 ? 'Straight on' : w.turn < 0 ? 'Left' : 'Right'), turn: +w.turn.toFixed(2), on: w.steps.every((st, k) => ow.path[ow.shown.k + k]?.i === st.i && ow.path[ow.shown.k + k]?.rev === st.rev) })) } : null,
    open: !!ow.on, clip: clipStatus(), gear: gears.on ? gears.n : null,
    nav: (() => { const n = navStatus(); return n ? { name: n.name, left: Math.round(n.left), turn: n.turn } : null; })(),
    navq: Date.now() - rnav.at < 120000 ? { q: rnav.q, results: rnav.results.map((p, n) => ({ n, name: p.name, kind: p.kind, d: Math.round(p.d) })) } : null,
    music: { title: music.title(), playing: music.playing, recent: recentMusic().map((r, n) => ({ n, title: r.title })) }, // (the phone: song, and the recent links to switch to)
    workout: wo.steps ? { name: wo.name, intensity: Math.round(wo.intensity * 100), now: $('wo-now').textContent, next: $('wo-next').textContent, erg: wo.erg } : null,
  };
}

// at Load scenery
export function startRemote() {
  mp.setRole('ride');
  setInterval(() => mp.send({ type: 'rc-status', s: status() }), 1000);
  // and straight away when a junction appears or its choice changes (1 s is too slow at 30 km/h)
  let lastJ = '';
  setInterval(() => { const j = ow.shown ? ow.shown.k + ':' + ow.path[ow.shown.k]?.i : ''; if (j !== lastJ) { lastJ = j; mp.send({ type: 'rc-status', s: status() }); } }, 200);
}

export async function initRemote() {
  mp.addEventListener('rc', (e) => COMMANDS[e.detail.cmd]?.(e.detail));
  mp.addEventListener('rc-want-status', () => { if (mp.role === 'ride') mp.send({ type: 'rc-status', s: status() }); });
}
