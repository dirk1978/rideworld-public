// Shared basics every module uses: DOM/Cesium helpers, settings storage and the API, units and formatting,
// toasts, and the ride state (state, bike, recorder, the current route). Imports nothing from app/, so it loads first.
import { Bike } from '../physics.js';
import { Recorder } from '../recorder.js';
export const $ = (id) => document.getElementById(id);
export const C = window.Cesium;

// ---------- settings (kept in this browser only) ----------
export const store = {
  get(k, d) { try { const v = localStorage.getItem('rw.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rw.' + k, v); } catch {} },
};
export const fields = {
  google: 'cfg-google', ion: 'cfg-ion', detail: 'cfg-quality', world: 'cfg-world', target: 'cfg-target', startCam: 'cfg-startcam', diff: 'cfg-diff',
  jersey: 'kit-jersey', shorts: 'kit-shorts', frame: 'kit-frame', helmet: 'kit-helmet', design: 'kit-design', socks: 'kit-socks', shoes: 'kit-shoes', bikestyle: 'kit-bikestyle', skin: 'kit-skin', beard: 'kit-beard', beardcol: 'kit-beardcol',
  units: 'cfg-units', ftp: 'cfg-ftp', maxhr: 'cfg-maxhr', bots: 'cfg-bots', autoStrava: 'cfg-autoStrava',
  coach: 'cfg-coach', coachFtp: 'cfg-coachftp', sex: 'cfg-sex', born: 'cfg-born', coachSkip: 'cfg-coachskip', goal: 'cfg-goal', vo2watch: 'cfg-vo2watch',
};
// Rider settings belong to your account; the scenery keys are site-wide and only admins can change them.
// Detail level stays per browser (GPUs differ).
export const GLOBAL_KEYS = ['google', 'ion'];
export const USER_KEYS = ['rider', 'bike', 'diff', 'jersey', 'shorts', 'frame', 'helmet', 'design', 'socks', 'shoes', 'bikestyle', 'skin', 'beard', 'beardcol', 'units', 'ftp', 'maxhr', 'bots', 'autoStrava', 'coach', 'coachFtp', 'sex', 'born', 'coachSkip', 'goal', 'vo2watch'];
export let me = { username: '', name: '', admin: false };
export const setMe = (m) => { me = m; };
export const api = async (path, opts = {}) => {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
};
export const saveSetting = (k, v) => api('api/settings', { method: 'PUT', body: JSON.stringify(GLOBAL_KEYS.includes(k) ? { global: { [k]: v } } : { user: { [k]: v } }) })
  .catch((e) => toast('Could not save: ' + e.message));
// ---------- units: everything is kept metric internally and converted for display ----------
export const UNITS = {
  metric: { speed: 3.6, speedUnit: 'km/h', speedMax: 70, speedMajor: 10, dist: 1000, distUnit: 'km', ele: 1, eleUnit: 'm', weight: 1, weightUnit: 'kg' },
  imperial: { speed: 2.236936, speedUnit: 'mph', speedMax: 45, speedMajor: 5, dist: 1609.344, distUnit: 'mi', ele: 3.28084, eleUnit: 'ft', weight: 2.20462, weightUnit: 'lb' },
};
export const U = () => UNITS[$('cfg-units').value] || UNITS.metric;
export const fmtDist = (m, dp = 1) => `${(m / U().dist).toFixed(dp)} ${U().distUnit}`;
export const fmtEle = (m) => `${Math.round(m * U().ele)} ${U().eleUnit}`;
export const kg = { rider: +store.get('rider', 75) || 75, bike: +store.get('bike', 9) || 9 };
export function showWeights() {
  for (const k of ['rider', 'bike']) $('cfg-' + k).value = Math.round(kg[k] * U().weight * 2) / 2;
  document.querySelectorAll('.u-weight').forEach((e) => (e.textContent = U().weightUnit));
}

// ---------- state ----------
export let route = null;
export const setRoute = (r) => { route = r; }; // other modules can't assign an imported binding
// distance ridden so far, over every leg (after turning round at the end, state.dist counts along the way back)
export const rideDist = () => state.distBase + state.dist;
export const bike = new Bike();
export let recorder = new Recorder();
export const state = {
  riding: false, finished: false, dist: 0, elapsed: 0, simWatts: 150, sampleAcc: 0,
  survey: { raw: [], diff: [], edge: [], flat: [], over: [], busy: false, version: 0 }, legs: 0, distBase: 0, arrived: false, simCad: 0, simHr: 62, simWobble: 0, crank: 0, lean: 0, pHist: [], arches: {}, introYaw: 0, /* (the opening shot, 30 -> 0: off for now, the owner 2026-11-21: it hid where the rider was; a better cinematic opening later) */ camCheckT: 0, camClear: null, camRange: null, lineAt: -1e9, lineOff: -1, frames: 0, fpsT: 0, heading: 0, cam: 0,
};

export function toast(text, ms = 3500) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function median(a) {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
}

export function fmtTime(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
export const download = (data, type, ext) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = `${(route.name || 'RideWorld').replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// start-up: settings fields: restore this browser's values, save on change (main.js runs these in order)
export async function initSettingsFields() {
  for (const [k, id] of Object.entries(fields)) {
    const el = $(id);
    el.value = store.get(k, el.value);
    el.addEventListener('change', () => {
      store.set(k, el.value);
      if (USER_KEYS.includes(k) || (GLOBAL_KEYS.includes(k) && me.admin)) saveSetting(k, el.value);
    });
    // the site's keys save as they're typed or pasted, and say so (2026-11-14: the owner pasted the ion token and closed
    // the dialog with the cursor still in the box: no 'change', nothing saved)
    if (GLOBAL_KEYS.includes(k)) {
      let t = null;
      el.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          if (!me.admin) return;
          store.set(k, el.value.trim());
          await saveSetting(k, el.value.trim());
          toast(`${k === 'ion' ? 'Cesium ion token' : 'Google key'} saved for everyone.`, 3000);
        }, 700);
      });
    }
  }
}
