// Virtual gears in the ride (2026-11-18, the owner: Zwift Cog support): the setting (Advanced: "Virtual gears", per browser
// rw.vgears, off by default), the gear pill under the top bar (− / + and the gear), keys [ and ] (not in the route
// editor, which uses them), the phone remote's gearup / geardown (app/remote.js). main.js asks slopeFor() for the slope
// to send the trainer; with gears off it returns the slope unchanged, so nothing changes for anyone not using them.
import { $, state, store, bike, toast } from './core.js';
import { devices } from '../devices.js';
import { GEARS, REF_GEAR, gearFactor, gearedGrade } from '../gears.js';
import { sound } from './audio.js';

export const gears = { on: false, n: REF_GEAR };

export function slopeFor(gradePct) {
  if (!gears.on) return gradePct;
  // the trainer's own speed (its flywheel: your cadence through the real cog); without one (simulator) the speed the
  // reference gear would give at this cadence
  const ts = devices.powerSource?.speed, v = Number.isFinite(ts) && ts > 0.3 ? ts : (bike.v || 0) / gearFactor(gears.n);
  return gearedGrade(gradePct, gears.n, { v, mass: bike.mass, cda: bike.cda });
}

export function shift(d) {
  if (!gears.on) { toast('Virtual gears are off: Advanced → Virtual gears.', 2500); return; }
  const n = Math.max(1, Math.min(GEARS.length, gears.n + d));
  if (n === gears.n) return;
  sound.shift(d > 0); gears.n = n; state.gear = n; show();
}

function show() {
  const box = $('gear-box'); if (!box) return;
  box.hidden = !gears.on || !state.riding && !(state.elapsed > 0);
  $('gear-n').textContent = gears.n;
}
export function updateGears() { const box = $('gear-box'); if (box && box.hidden !== (!gears.on || !(state.riding || state.elapsed > 0))) show(); }

export function initGears() {
  gears.on = store.get('vgears', '0') === '1'; gears.n = +store.get('vgearN', REF_GEAR) || REF_GEAR; state.gear = gears.n;
  const cb = $('cfg-vgears');
  if (cb) { cb.checked = gears.on; cb.addEventListener('change', () => { gears.on = cb.checked; store.set('vgears', gears.on ? '1' : '0'); show(); }); }
  $('gear-up')?.addEventListener('click', () => shift(1));
  $('gear-dn')?.addEventListener('click', () => shift(-1));
  addEventListener('beforeunload', () => store.set('vgearN', String(gears.n)));
  show();
}
