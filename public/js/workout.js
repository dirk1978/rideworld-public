// Structured workouts: Zwift .zwo files (and a few built in) as steps with targets as a share of FTP.
// A step is { type, dur (s), from, to (share of FTP; a ramp goes from -> to), free (free ride: no target),
// max (max effort: no target, all out), cadence }. Pure functions, so tests can run them outside the browser.

const num = (attrs, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs); return m ? parseFloat(m[1]) : NaN; };
const pick = (...v) => v.find((x) => Number.isFinite(x));

// Parse a .zwo file (XML). Returns { name, description, steps } or throws.
export function parseZwo(text) {
  const body = /<workout>([\s\S]*?)<\/workout>/i.exec(String(text));
  if (!body) throw new Error("That doesn't look like a Zwift workout (.zwo): no <workout> section.");
  const unx = (t) => t.replace(/&(lt|gt|quot|apos|amp);/g, (m, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]); // (entities, as Zwift's own files have)
  const name = unx((/<name>([\s\S]*?)<\/name>/i.exec(text)?.[1] || 'Workout').trim().replace(/<!\[CDATA\[|\]\]>/g, '')).slice(0, 60);
  const description = unx((/<description>([\s\S]*?)<\/description>/i.exec(text)?.[1] || '').trim().replace(/<!\[CDATA\[|\]\]>/g, '')).slice(0, 300);
  const steps = [];
  for (const m of body[1].matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
    const tag = m[1].toLowerCase(), a = m[2];
    const dur = num(a, 'Duration'), cadence = pick(num(a, 'Cadence')) || null;
    if (tag === 'warmup' || tag === 'cooldown' || tag === 'ramp') {
      steps.push({ type: tag, dur, from: pick(num(a, 'PowerLow'), num(a, 'Power')), to: pick(num(a, 'PowerHigh'), num(a, 'Power')), cadence });
    } else if (tag === 'steadystate') {
      const p = pick(num(a, 'Power'), (num(a, 'PowerLow') + num(a, 'PowerHigh')) / 2);
      steps.push({ type: 'steady', dur, from: p, to: p, cadence });
    } else if (tag === 'intervalst') {
      const reps = Math.max(1, Math.round(pick(num(a, 'Repeat')) || 1));
      const on = pick(num(a, 'OnPower'), num(a, 'PowerOnHigh'), num(a, 'PowerOnLow')), off = pick(num(a, 'OffPower'), num(a, 'PowerOffLow'), num(a, 'PowerOffHigh'));
      for (let i = 0; i < reps; i++) {
        steps.push({ type: 'on', dur: num(a, 'OnDuration'), from: on, to: on, cadence: pick(num(a, 'Cadence')) || null, rep: [i + 1, reps] });
        steps.push({ type: 'off', dur: num(a, 'OffDuration'), from: off, to: off, cadence: pick(num(a, 'CadenceResting')) || null, rep: [i + 1, reps] });
      }
    } else if (tag === 'freeride') {
      steps.push({ type: 'free', dur, free: true });
    } else if (tag === 'maxeffort') {
      steps.push({ type: 'max', dur, max: true });
    }
  }
  const ok = steps.filter((s) => s.dur > 0 && (s.free || s.max || (Number.isFinite(s.from) && Number.isFinite(s.to) && s.from > 0 && s.from < 5 && s.to > 0 && s.to < 5)));
  if (!ok.length) throw new Error('That workout has no steps RideWorld understands.');
  return { name, description, steps: ok };
}

const W = (type, min, from, to = from) => ({ type, dur: min * 60, from, to });
// The ramp test is over when the last 15 s of power average under 80% of the step's target, three steps in at least
// (samples: the recorder's last 15 { power }). Pure, for the tests.
export function rampFailed(step, samples) {
  if (!step?.ramp || step.rampStep < 4 || samples.length < 15) return false;
  const p = samples.slice(-15).reduce((t, s) => t + (s.power || 0), 0) / 15;
  return p < 0.8 * step.target;
}
export const rampFtp = (best60) => Math.round(best60 * 0.75);
// Holding a heart rate: the next ERG target from the last one. Heart rate lags effort by a minute or so, so small,
// slow steps (called every 15 s): 0.8 W per beat out, at most 6 W, nothing within 2 bpm.
export function hrStep(watts, hr, target) {
  const err = target - hr;
  return Math.abs(err) <= 2 ? watts : watts + Math.max(-6, Math.min(6, err * 0.8));
}

const reps = (n, ...block) => Array.from({ length: n }, (_, i) => block.map((s) => ({ ...s, rep: [i + 1, n] }))).flat();
export const BUILT_IN = [
  { id: 'sweetspot', name: 'Sweet spot 3 × 10', description: 'Three 10-minute blocks at 90% of FTP with 5 minutes easy between: the classic way to build FTP.',
    steps: [W('warmup', 10, 0.45, 0.75), ...reps(3, W('on', 10, 0.9), W('off', 5, 0.55)), W('cooldown', 7, 0.65, 0.4)] },
  { id: 'vo2', name: 'VO2 max 5 × 4', description: 'Five 4-minute efforts at 115% of FTP with 4 minutes easy: hard, short, top-end fitness.',
    steps: [W('warmup', 12, 0.45, 0.8), ...reps(5, W('on', 4, 1.15), W('off', 4, 0.5)), W('cooldown', 8, 0.6, 0.4)] },
  { id: 'overunder', name: 'Over-unders 3 × 9', description: 'Three 9-minute blocks switching between just under and just over FTP, 5 minutes easy between.',
    steps: [W('warmup', 10, 0.45, 0.75), ...reps(3, ...reps(3, W('on', 2, 0.95), W('on', 1, 1.08)), W('off', 5, 0.55)), W('cooldown', 7, 0.6, 0.4)] },
  { id: 'endurance', name: 'Endurance hour', description: 'An hour at a steady 68% of FTP: base miles, chatting pace.',
    steps: [W('warmup', 5, 0.45, 0.68), W('steady', 50, 0.68), W('cooldown', 5, 0.6, 0.4)] },
  // Benchmark (2026-11-26): a fitness check ridden the same way every time: 10 min warm-up, 20 min steady at 65% of FTP,
  // 5 min easy. coach-math benchAnalysis reads the 20 minutes (heart rate of the last 5, drift, watts per beat); the
  // length and intensity settings don't apply (`fixed`), so tests stay comparable.
  { id: 'benchmark', fixed: true, name: 'Benchmark 20', description: 'A fitness check: 10 minutes warming up, then 20 minutes steady at 65% of FTP (ride it in ERG), 5 easy. Ride it every few weeks: the coach compares your heart rate at the same watts. Needs a heart-rate strap.',
    steps: [W('warmup', 10, 0.45, 0.65), W('steady', 20, 0.65), W('cooldown', 5, 0.55, 0.4)] },
  { id: 'recovery', name: 'Recovery spin', description: '30 easy minutes under 55% of FTP to loosen the legs the day after a hard ride. Keep it honestly easy.',
    steps: [W('warmup', 5, 0.4, 0.52), W('steady', 20, 0.52), W('cooldown', 5, 0.5, 0.4)] },
  { id: 'quick30', name: 'Quick 30', description: 'Short on time: 30 minutes with five 2-minute efforts at 105% of FTP. Enough to feel you trained.',
    steps: [W('warmup', 7, 0.45, 0.75), ...reps(5, W('on', 2, 1.05), W('off', 2, 0.5)), W('cooldown', 3, 0.55, 0.4)] },
  { id: 'tempo', name: 'Tempo 2 × 20', description: 'Two 20-minute blocks at 80% of FTP: comfortably hard, the bread and butter of endurance.',
    steps: [W('warmup', 10, 0.45, 0.75), ...reps(2, W('on', 20, 0.8), W('off', 5, 0.55)), W('cooldown', 5, 0.6, 0.4)] },
  { id: 'sweetspot2x20', name: 'Sweet spot 2 × 20', description: 'Two 20-minute blocks at 90% of FTP: the step up from 3 × 10 once that feels steady.',
    steps: [W('warmup', 10, 0.45, 0.75), ...reps(2, W('on', 20, 0.9), W('off', 5, 0.55)), W('cooldown', 5, 0.6, 0.4)] },
  { id: 'threshold', name: 'Threshold 4 × 8', description: 'Four 8-minute efforts right at FTP with 4 minutes easy: raises the power you can hold for an hour.',
    steps: [W('warmup', 10, 0.45, 0.8), ...reps(4, W('on', 8, 1.0), W('off', 4, 0.5)), W('cooldown', 6, 0.6, 0.4)] },
  { id: 'pyramid', name: 'Pyramid', description: '1-2-3-4-3-2-1 minutes at 105% of FTP, each followed by the same time easy. Up the stairs and back down.',
    steps: [W('warmup', 10, 0.45, 0.75), ...[1, 2, 3, 4, 3, 2, 1].flatMap((m) => [W('on', m, 1.05), W('off', m, 0.5)]), W('cooldown', 8, 0.6, 0.4)] },
  { id: 'thirtythirty', name: '30/30s', description: 'Two sets of ten 30-second bursts at 130% of FTP with 30 seconds easy: lots of time near VO2 max without the long suffering.',
    steps: [W('warmup', 12, 0.45, 0.8), ...reps(10, W('on', 0.5, 1.3), W('off', 0.5, 0.5)), W('off', 6, 0.5), ...reps(10, W('on', 0.5, 1.3), W('off', 0.5, 0.5)), W('cooldown', 8, 0.6, 0.4)] },
  { id: 'climbing', name: 'Big gear climbing 4 × 6', description: 'Four 6-minute efforts at 88% of FTP at a low 60-65 rpm, like grinding up a long climb. Builds strength on the pedals.',
    steps: [W('warmup', 10, 0.45, 0.75), ...reps(4, { ...W('on', 6, 0.88), cadence: 62 }, W('off', 4, 0.5)), W('cooldown', 6, 0.6, 0.4)] },
  { id: 'sprints', name: 'Sprints 8 × 15 s', description: 'Eight all-out 15-second sprints with nearly 4 minutes easy between, on top of a steady ride. Go as hard as you can: no target.',
    steps: [W('warmup', 12, 0.45, 0.7), ...reps(8, { type: 'max', dur: 15, max: true }, W('off', 3.75, 0.6)), W('cooldown', 8, 0.6, 0.4)] },
  { id: 'ftptest', name: 'FTP test (20 minutes)', description: 'Warm up, open the legs with 5 hard minutes, recover, then ride 20 minutes as hard as you can hold evenly. Your FTP is about 95% of your average power for the 20.',
    steps: [W('warmup', 10, 0.45, 0.75), W('on', 5, 1.05), W('off', 10, 0.5), { type: 'max', dur: 20 * 60, max: true }, W('cooldown', 10, 0.55, 0.4)] },
  // Ramp test (2026-10-30): 1-minute steps rising 6% of FTP from 50% until you can't hold the target; FTP = 75% of
  // the best minute (the usual ramp-test rule). app/workouts.js ends it when you fall off (rampFailed) and drops
  // straight into the cool-down; length and intensity settings don't apply to it.
  { id: 'ramptest', ramp: true, name: 'Ramp test', description: 'A 5-minute warm-up, then the target rises every minute until you can\'t hold it: about 15-20 minutes in all. Ride it in ERG. Your FTP is 75% of your best minute; RideWorld spots the end by itself.',
    steps: [W('warmup', 5, 0.4, 0.5), ...Array.from({ length: 25 }, (_, i) => ({ ...W('steady', 1, 0.5 + i * 0.06), ramp: true, rampStep: i + 1 })), W('cooldown', 5, 0.45, 0.35)] },
  // Heart-rate sessions (2026-10-30): a step with `hr` (share of max HR) has no fixed watts: app/workouts.js steers the
  // ERG target to hold that heart rate (hrStep). from / to are only what the chart draws.
  { id: 'hrz2', name: 'Heart-rate zone 2 (45 min)', description: 'Hold 70% of your max heart rate: the trainer sets the watts to keep you there, so tired or hot days are automatically easier. Needs a heart-rate strap.',
    steps: [W('warmup', 8, 0.4, 0.6), { type: 'steady', dur: 30 * 60, from: 0.62, to: 0.62, hr: 0.7 }, W('cooldown', 7, 0.55, 0.4)] },
  { id: 'hrz2long', name: 'Heart-rate zone 2 (90 min)', description: 'The long version: 70 minutes held at 70% of your max heart rate, with the trainer setting the watts. Needs a heart-rate strap.',
    steps: [W('warmup', 10, 0.4, 0.6), { type: 'steady', dur: 70 * 60, from: 0.62, to: 0.62, hr: 0.7 }, W('cooldown', 10, 0.55, 0.4)] },
  { id: 'longride', name: 'Long ride 2 h', description: 'Two hours at 65% of FTP with a 5-minute tempo lift at 85% every half hour to keep it lively.',
    steps: [W('warmup', 10, 0.45, 0.65), ...reps(3, W('steady', 25, 0.65), W('on', 5, 0.85)), W('steady', 15, 0.65), W('cooldown', 5, 0.55, 0.4)] },
];

export const totalTime = (steps) => steps.reduce((a, s) => a + s.dur, 0);

// Where we are at t seconds into the workout: { i, step, at (s into the step), left (s left in it), target (share of
// FTP, or null in free ride / max effort), done }
export function workoutAt(steps, t) {
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (t < start + s.dur) {
      const at = Math.max(0, t - start);
      const target = s.free || s.max ? null : s.from + (s.to - s.from) * (at / s.dur);
      return { i, step: s, at, left: s.dur - at, target, done: false, start };
    }
    start += s.dur;
  }
  return { i: steps.length, step: null, at: 0, left: 0, target: null, done: true, start };
}

// Zwift's power zone colours for a share of FTP
export function zoneColour(share) {
  if (share == null) return '#64748b';
  if (share < 0.6) return '#9aa0a6';
  if (share < 0.76) return '#3b82f6';
  if (share < 0.9) return '#22c55e';
  if (share < 1.05) return '#eab308';
  if (share < 1.19) return '#f97316';
  return '#ef4444';
}

// Draw a workout as blocks (height = target) on a canvas; `progress` (s) shades what's done
export function drawWorkout(canvas, steps, progress = null, intensity = 1) {
  const dpr = window.devicePixelRatio || 1, w = (canvas.width = canvas.clientWidth * dpr), h = (canvas.height = canvas.clientHeight * dpr);
  // (the top fits the hardest step: a fixed 150% of FTP flattened the ramp test's last steps, the owner 2026-11-03)
  const g = canvas.getContext('2d'), total = totalTime(steps), top = Math.max(1.5, ...steps.map((s) => (s.max ? 1.45 : Math.max(s.from || 0, s.to || 0)) * intensity * 1.04));
  g.clearRect(0, 0, w, h);
  let x = 0;
  for (const s of steps) {
    const sw = (s.dur / total) * w;
    const y = (p) => h - Math.min(1, (p * intensity) / top) * (h - 2 * dpr);  // (2 px clear at the top)
    g.fillStyle = zoneColour(s.free ? null : s.max ? 2 : ((s.from + s.to) / 2) * intensity);
    g.beginPath();
    if (s.free || s.max) { const p = s.free ? 0.5 : 1.45; g.rect(x, y(p), sw, h - y(p)); }
    else { g.moveTo(x, h); g.lineTo(x, y(s.from)); g.lineTo(x + sw, y(s.to)); g.lineTo(x + sw, h); }
    g.fill();
    x += sw;
  }
  if (progress != null) {
    const px = Math.min(w, (progress / total) * w);
    g.fillStyle = 'rgba(14,17,22,0.55)'; g.fillRect(0, 0, px, h);
    g.fillStyle = '#ffffff'; g.fillRect(px - dpr, 0, 2 * dpr, h);
  }
}

// ---------- the workout builder's blocks (2026-10-30, app/builder.js) ----------
// A block is how a rider thinks of a workout; steps are how it's ridden. { type, dur (s), from, to (share of FTP) }
// for warmup / cooldown / ramp; { type: 'steady', dur, power }; { type: 'intervals', reps, on, off (s), onPower,
// offPower }; { type: 'free' | 'max', dur }; any may carry cadence (rpm).
export function blocksToSteps(blocks) {
  const out = [];
  for (const b of blocks) {
    const c = b.cadence || null;
    if (b.type === 'warmup' || b.type === 'cooldown' || b.type === 'ramp') out.push({ type: b.type, dur: b.dur, from: b.from, to: b.to, cadence: c });
    else if (b.type === 'steady') out.push({ type: 'steady', dur: b.dur, from: b.power, to: b.power, cadence: c });
    else if (b.type === 'intervals') for (let i = 0; i < b.reps; i++) { out.push({ type: 'on', dur: b.on, from: b.onPower, to: b.onPower, cadence: c, rep: [i + 1, b.reps] }); out.push({ type: 'off', dur: b.off, from: b.offPower, to: b.offPower, cadence: null, rep: [i + 1, b.reps] }); }
    else if (b.type === 'free') out.push({ type: 'free', dur: b.dur, free: true });
    else if (b.type === 'max') out.push({ type: 'max', dur: b.dur, max: true });
  }
  return out;
}
// steps (a parsed .zwo or a built-in) back into blocks: on/off pairs with repeat counts become one intervals block
export function blocksFromSteps(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'on' && s.rep && steps[i + 1]?.type === 'off') {
      const n = s.rep[1], off = steps[i + 1];
      out.push({ type: 'intervals', reps: n, on: s.dur, off: off.dur, onPower: s.from, offPower: off.from, cadence: s.cadence || null });
      i += n * 2 - 1;
    } else if (s.type === 'warmup' || s.type === 'cooldown' || s.type === 'ramp') out.push({ type: s.type, dur: s.dur, from: s.from, to: s.to, cadence: s.cadence || null });
    else if (s.free) out.push({ type: 'free', dur: s.dur });
    else if (s.max) out.push({ type: 'max', dur: s.dur });
    else out.push({ type: 'steady', dur: s.dur, power: s.from, cadence: s.cadence || null });
  }
  return out;
}
// blocks as a Zwift workout file (what My workouts keep, so it can be used elsewhere too)
export function toZwo(name, description, blocks) {
  const x = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const p = (v) => (+v).toFixed(3).replace(/\.?0+$/, ''), cad = (b) => (b.cadence ? ` Cadence="${Math.round(b.cadence)}"` : '');
  const tag = (b) => {
    if (b.type === 'warmup' || b.type === 'cooldown' || b.type === 'ramp') return `<${b.type === 'warmup' ? 'Warmup' : b.type === 'cooldown' ? 'Cooldown' : 'Ramp'} Duration="${Math.round(b.dur)}" PowerLow="${p(b.from)}" PowerHigh="${p(b.to)}"${cad(b)}/>`;
    if (b.type === 'steady') return `<SteadyState Duration="${Math.round(b.dur)}" Power="${p(b.power)}"${cad(b)}/>`;
    if (b.type === 'intervals') return `<IntervalsT Repeat="${b.reps}" OnDuration="${Math.round(b.on)}" OffDuration="${Math.round(b.off)}" OnPower="${p(b.onPower)}" OffPower="${p(b.offPower)}"${cad(b)}/>`;
    if (b.type === 'free') return `<FreeRide Duration="${Math.round(b.dur)}"/>`;
    return `<MaxEffort Duration="${Math.round(b.dur)}"/>`;
  };
  return `<workout_file>\n  <author>RideWorld</author>\n  <name>${x(name)}</name>\n  <description>${x(description)}</description>\n  <sportType>bike</sportType>\n  <workout>\n${blocks.map((b) => '    ' + tag(b)).join('\n')}\n  </workout>\n</workout_file>\n`;
}
