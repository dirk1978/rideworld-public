// Workouts on the setup screen and during a ride. The plan (workout.js) gives a target as a share of FTP for every
// moment of the workout; workout time is ride time (pauses stop it) plus any skips. In ERG the trainer holds the
// target (devices.setTargetPower: FE-C page 49 / FTMS op 0x05) except in free-ride steps and after the end, when it
// goes back to the road's slope; without ERG you ride the road and chase the target yourself. Speed always comes
// from your real power through the physics. In the simulator the rider follows the target (↑/↓ nudge it).
import { $, api, esc, fmtTime, recorder, state, store, toast } from './core.js';
import { devices } from '../devices.js';
import { BUILT_IN, drawWorkout, hrStep, parseZwo, rampFailed, rampFtp, toZwo, totalTime, workoutAt, zoneColour } from '../workout.js';
import { initBuilder, openBuilder } from './builder.js';
import { sound } from './audio.js';

export const wo = { steps: null, name: '', total: 0, offset: 0, intensity: 1, erg: true, lastStep: -1, done: false, simAdj: 0, drawAt: 0 };
let mine = []; // imported workouts [{ id, name, zwo }]

const ftp = () => +$('cfg-ftp').value || 250;
// the chosen workout, squeezed or stretched to the Length setting (minutes; empty = as written)
function selected() {
  const w = chosen();
  const len = +$('cfg-wo-len').value * 60;
  if (!w || !(len > 0) || w.ramp || w.fixed) return w; // (the ramp test and the benchmark run as they are)
  const k = len / totalTime(w.steps);
  return { ...w, steps: w.steps.map((s) => ({ ...s, dur: Math.max(10, Math.round((s.dur * k) / 5) * 5) })) };
}
function chosen() {
  const v = $('cfg-workout').value;
  if (v.startsWith('b:')) return BUILT_IN.find((w) => w.id === v.slice(2)) || null;
  if (v.startsWith('u:')) {
    const w = mine.find((x) => x.id === v.slice(2));
    if (!w) return null;
    try { const p = parseZwo(w.zwo); return { ...p, name: w.name || p.name }; } catch { return null; }
  }
  return null;
}
// rough training load: TSS ~ sum(time x share^2) / 3600 x 100
const tss = (steps) => Math.round(steps.reduce((a, s) => a + s.dur * (s.free ? 0.36 : s.max ? 2.25 : ((s.from + s.to) / 2) ** 2), 0) / 36);

function renderSetup() {
  const v = store.get('workout', '');
  $('cfg-workout').innerHTML = '<option value="">None: just ride</option>'
    + `<optgroup label="RideWorld workouts">${BUILT_IN.map((w) => `<option value="b:${w.id}">${esc(w.name)}</option>`).join('')}</optgroup>`
    + (mine.length ? `<optgroup label="My workouts">${mine.map((w) => `<option value="u:${w.id}">${esc(w.name)}</option>`).join('')}</optgroup>` : '');
  $('cfg-workout').value = [...$('cfg-workout').options].some((o) => o.value === v) ? v : '';
  showSelected();
}
function showSelected() {
  const w = selected();
  $('wo-delete').classList.toggle('hidden', !$('cfg-workout').value.startsWith('u:'));
  $('wo-edit').classList.toggle('hidden', !$('cfg-workout').value || !!selected()?.steps.some((s) => s.hr)); // (heart-rate steps have no .zwo form)
  $('wo-edit').textContent = $('cfg-workout').value.startsWith('u:') ? 'Edit' : 'Copy and edit';
  $('wo-preview').classList.toggle('hidden', !w);
  $('wo-erg-row').classList.toggle('hidden', !w);
  if (!w) { $('wo-info').textContent = 'Pick a workout to ride it on the route you choose; the route is the scenery.'; return; }
  const int = (+$('cfg-wo-int').value || 100) / 100;
  requestAnimationFrame(() => drawWorkout($('wo-preview'), w.steps, null, int));
  const peak = Math.max(...w.steps.filter((s) => !s.free && !s.max).map((s) => Math.max(s.from, s.to)));
  $('wo-info').textContent = `${fmtTime(totalTime(w.steps))} · training load about ${tss(w.steps.map((s) => ({ ...s, from: s.from * int, to: s.to * int })))} TSS · hardest ${Math.round(peak * int * ftp())} W`
    + (w.description ? ` · ${w.description}` : '');
}

async function loadMine() {
  try { mine = (await api('api/workouts')).workouts; } catch { mine = []; }
  renderSetup();
}

// Keep the map credits (Cesium, Google: must stay readable) clear of the workout panel, which sits where they were
let creditsWatch = null;
function creditsAbovePanel() {
  const panel = $('wo-panel');
  const set = () => document.documentElement.style.setProperty('--credits-bottom',
    panel.classList.contains('hidden') ? '160px' : `${Math.ceil(innerHeight - panel.getBoundingClientRect().top + 4)}px`);
  if (!creditsWatch) { creditsWatch = new ResizeObserver(set); creditsWatch.observe(panel); addEventListener('resize', set); }
  set();
}

// at Load scenery
export function startWorkout() {
  const w = selected();
  state.rampResult = null;
  Object.assign(wo, { hrW: null, hrAt: 0, hrSaid: false, ramp: !!w?.ramp, steps: w ? w.steps : null, name: w ? w.name : '', total: w ? totalTime(w.steps) : 0, offset: 0, lastStep: -1, done: false, simAdj: 0,
    intensity: w?.ramp || w?.fixed ? 1 : (+$('cfg-wo-int').value || 100) / 100, erg: $('cfg-erg').checked });
  $('wo-panel').classList.toggle('hidden', !w);
  creditsAbovePanel();
  state.woTarget = null;
  state.woErg = false;
  if (w) { $('wo-name').textContent = w.name; showErg(); }
}

const showErg = () => { $('wo-erg').classList.toggle('on', wo.erg); $('wo-erg').textContent = wo.erg ? 'ERG on' : 'ERG off'; };
const fmtS = (s) => fmtTime(Math.max(0, Math.ceil(s)));

// Every frame, before power is read: sets state.woTarget (W or null) and state.woErg (the trainer holds it)
export function updateWorkout(now) {
  if (!wo.steps) { state.woTarget = null; state.woErg = false; return; }
  const t = state.elapsed + wo.offset, here = workoutAt(wo.steps, t);
  let target = here.target == null ? null : Math.round(here.target * wo.intensity * ftp());
  // a heart-rate step: steer the watts to hold the heart rate (no strap: a steady 60% of FTP, said once)
  const hrGoal = here.step?.hr ? Math.round(here.step.hr * (+$('cfg-maxhr').value || 185)) : null;
  const hrNow = $('cfg-sim').checked ? Math.round(state.simHr || 0) : devices.hr;
  if (hrGoal) {
    wo.hrW ??= Math.round(ftp() * 0.6);
    if (hrNow > 0 && state.riding && now - (wo.hrAt || 0) > 15000) { wo.hrAt = now; wo.hrW = Math.max(ftp() * 0.3, Math.min(ftp() * 0.9, hrStep(wo.hrW, hrNow, hrGoal))); }
    if (!(hrNow > 0) && !wo.hrSaid && state.riding) { wo.hrSaid = true; toast('No heart rate: this session needs a strap. Holding 60% of your FTP instead.', 7000); }
    target = Math.round(wo.hrW);
  }
  state.woTarget = here.done ? null : target;
  state.woErg = wo.erg && state.riding && target != null;
  if ($('cfg-sim').checked && state.riding) {
    const s = here.step;
    state.simWatts = Math.max(0, (target ?? (s?.max ? Math.round(1.5 * ftp()) : s?.free ? Math.round(0.6 * ftp()) : state.simWatts)) + wo.simAdj);
  }
  // the ramp test: falling off the target ends it (straight to the cool-down), FTP from the best minute
  if (wo.ramp && !state.rampResult && state.riding && here.step?.ramp && !$('cfg-sim').checked && rampFailed({ ...here.step, target: target ?? 0 }, recorder.samples)) {
    const p = recorder.samples.map((s) => s.power || 0);
    let best = 0, sum = 0;
    for (let i = 0; i < p.length; i++) { sum += p[i]; if (i >= 60) sum -= p[i - 60]; if (i >= 59) best = Math.max(best, sum / 60); }
    state.rampResult = { best60: Math.round(best), ftp: rampFtp(best), step: here.step.rampStep };
    const cool = wo.steps.findIndex((s) => s.type === 'cooldown'), at = wo.steps.slice(0, cool).reduce((s, x) => s + x.dur, 0);
    wo.offset += at - t; // (jump to the cool-down)
    toast(`🏁 Ramp test done: best minute ${state.rampResult.best60} W, so your FTP is about ${state.rampResult.ftp} W. Cool down now; it's set when you finish.`, 12000);
    sound.chime(0.3);
    return;
  }
  if (here.i !== wo.lastStep) {
    if (wo.lastStep >= 0 && !here.done) sound.chime(0.15);
    wo.lastStep = here.i;
    if (here.done && !wo.done) {
      wo.done = true; sound.chime(0.3);
      // the ramp test is a test, not a ride: after its cool-down the ride finishes and the summary (with the result and
      // the heart-rate analysis) opens (the owner 2026-11-03: "At the end of the test, nothing happened")
      if (wo.ramp && state.riding && !state.finished) { toast('🏁 Ramp test complete: here are your results.', 6000); import('./hud.js').then((m) => m.finishRide()); }
      else toast(`🏁 ${wo.name}: workout complete! Ride on, or press Finish for your summary.`, 7000);
    }
  }
  if (now - wo.drawAt < 250) return; // the panel 4 times a second
  wo.drawAt = now;
  drawWorkout($('wo-bar'), wo.steps, Math.min(t, wo.total), wo.intensity);
  if (here.done) { $('wo-now').innerHTML = '<b>Done</b> · free ride'; $('wo-next').textContent = ''; return; }
  const s = here.step, label = s.free ? 'Free ride' : s.max ? 'All out!' : hrGoal ? `<b style="color:#ff7a93">♥ ${hrGoal} bpm</b>${hrNow > 0 ? ` (now ${hrNow})` : ''} · ${target} W` : `<b style="color:${zoneColour(here.target * wo.intensity)}">${target} W</b>`;
  const rep = s.rep ? ` · ${s.rep[0]}/${s.rep[1]}` : '';
  $('wo-now').innerHTML = `${label} · ${fmtS(here.left)} left${rep}${s.cadence ? ` · ${s.cadence} rpm` : ''}`;
  const n = wo.steps[here.i + 1];
  $('wo-next').textContent = n ? `Next: ${n.free ? 'free ride' : n.max ? 'all out' : `${Math.round(n.from * wo.intensity * ftp())} W`} for ${fmtS(n.dur)}` : 'Last one';
}

// start-up: the setup section and the ride panel's buttons
export async function initWorkouts() {
  $('cfg-erg').checked = store.get('erg', '1') === '1';
  $('cfg-wo-int').value = store.get('woInt', '100');
  $('cfg-wo-len').value = store.get('woLen', '');
  $('cfg-wo-len').addEventListener('change', () => { store.set('woLen', $('cfg-wo-len').value); showSelected(); });
  $('cfg-workout').addEventListener('change', () => { store.set('workout', $('cfg-workout').value); showSelected(); });
  $('cfg-wo-int').addEventListener('change', () => { store.set('woInt', $('cfg-wo-int').value); showSelected(); });
  $('cfg-erg').addEventListener('change', () => store.set('erg', $('cfg-erg').checked ? '1' : '0'));
  $('wo-import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.zwo,application/xml,text/xml';
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const zwo = await f.text();
        const p = parseZwo(zwo); // check it before saving
        const { workout } = await api('api/workouts', { method: 'POST', body: JSON.stringify({ name: p.name, zwo }) });
        await loadMine();
        $('cfg-workout').value = 'u:' + workout.id; store.set('workout', $('cfg-workout').value); showSelected();
        toast(`Imported "${p.name}" (${fmtTime(totalTime(p.steps))}).`, 4000);
      } catch (e) { toast('Could not import: ' + e.message, 6000); }
    });
    input.click();
  });
  // the builder (builder.js): new, edit one of mine (replaced), or copy a RideWorld one
  initBuilder();
  const save = (replace) => async ({ name, description, blocks }) => {
    const { workout } = await api('api/workouts', { method: 'POST', body: JSON.stringify({ name, zwo: toZwo(name, description, blocks) }) });
    if (replace) await api(`api/workouts/${replace}`, { method: 'DELETE' }).catch(() => {});
    await loadMine();
    $('cfg-workout').value = 'u:' + workout.id; store.set('workout', $('cfg-workout').value); showSelected();
    toast(`Saved "${name}" to My workouts.`, 3000);
  };
  $('wo-build').addEventListener('click', () => openBuilder({ onSave: save(null) }));
  $('wo-edit').addEventListener('click', () => {
    const v = $('cfg-workout').value, w = chosen();
    if (!w) return;
    openBuilder({ name: v.startsWith('u:') ? w.name : `My ${w.name}`, description: w.description || '', steps: w.steps, onSave: save(v.startsWith('u:') ? v.slice(2) : null) });
  });
  $('wo-delete').addEventListener('click', async () => {
    const id = $('cfg-workout').value.slice(2), w = mine.find((x) => x.id === id);
    if (!w || !confirm(`Delete the workout "${w.name}"?`)) return;
    try { await api(`api/workouts/${id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
    store.set('workout', ''); await loadMine();
  });
  $('wo-easier').addEventListener('click', () => { wo.intensity = Math.max(0.5, +(wo.intensity - 0.05).toFixed(2)); toast(`Workout at ${Math.round(wo.intensity * 100)}%`, 1500); wo.drawAt = 0; });
  $('wo-harder').addEventListener('click', () => { wo.intensity = Math.min(1.5, +(wo.intensity + 0.05).toFixed(2)); toast(`Workout at ${Math.round(wo.intensity * 100)}%`, 1500); wo.drawAt = 0; });
  $('wo-skip').addEventListener('click', () => {
    if (!wo.steps || wo.done) return;
    const here = workoutAt(wo.steps, state.elapsed + wo.offset);
    wo.offset += here.left + 0.01; wo.drawAt = 0;
  });
  $('wo-erg').addEventListener('click', () => { wo.erg = !wo.erg; showErg(); toast(wo.erg ? 'ERG on: the trainer holds the target' : 'ERG off: ride the road, chase the target', 2500); });
  await loadMine();
}
