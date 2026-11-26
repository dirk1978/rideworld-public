// Workout builder (2026-10-30, the owner's list: "a workout builder in the app, instead of only importing Zwift files"):
// a workout as blocks (warm-up, steady, intervals, ramp, free ride, max effort, cool-down), each a row of fields,
// reorderable, with a live preview (shape, time, training load, hardest watts). Saved to My workouts as a .zwo
// (workout.js toZwo), so it can be used elsewhere too; editing one of yours replaces it, a RideWorld one is copied.
import { blocksFromSteps, blocksToSteps, drawWorkout, totalTime } from '../workout.js';
import { $, esc, fmtTime } from './core.js';

const B = { blocks: [], name: '', description: '', onSave: null };
const ftp = () => +$('cfg-ftp').value || 250;
const LABEL = { warmup: 'Warm-up', steady: 'Steady', intervals: 'Intervals', ramp: 'Ramp', free: 'Free ride', max: 'Max effort', cooldown: 'Cool-down' };
const NEW = {
  warmup: () => ({ type: 'warmup', dur: 600, from: 0.45, to: 0.75 }), steady: () => ({ type: 'steady', dur: 600, power: 0.88 }),
  intervals: () => ({ type: 'intervals', reps: 4, on: 180, off: 120, onPower: 1.05, offPower: 0.55 }), ramp: () => ({ type: 'ramp', dur: 300, from: 0.6, to: 0.9 }),
  free: () => ({ type: 'free', dur: 600 }), max: () => ({ type: 'max', dur: 30 }), cooldown: () => ({ type: 'cooldown', dur: 300, from: 0.6, to: 0.4 }),
};
// "5" = 5 min, "1:30" = 90 s
const mmss = (s) => `${Math.floor(s / 60)}${s % 60 ? ':' + String(Math.round(s % 60)).padStart(2, '0') : ''}`;
const parseT = (v) => { const m = String(v).trim().match(/^(\d+)(?::(\d{1,2}))?$/); return m ? +m[1] * 60 + +(m[2] || 0) : NaN; };
const pct = (x) => Math.round(x * 100);

function field(i, k, label, value, kind) {
  return `<label class="bf"><span>${label}</span><input data-i="${i}" data-k="${k}" data-kind="${kind}" value="${esc(value)}" inputmode="${kind === 'time' ? 'text' : 'numeric'}"${kind === 'pct' ? ' type="number" min="10" max="300" step="1"' : kind === 'int' ? ' type="number" min="1" max="50" step="1"' : kind === 'rpm' ? ' type="number" min="40" max="140" step="1" placeholder="any"' : ' type="text"'}></label>`;
}
function rowHtml(b, i) {
  const f = [];
  if (b.type === 'intervals') f.push(field(i, 'reps', 'Repeats', b.reps, 'int'), field(i, 'on', 'On (m:ss)', mmss(b.on), 'time'), field(i, 'onPower', 'On %', pct(b.onPower), 'pct'), field(i, 'off', 'Off (m:ss)', mmss(b.off), 'time'), field(i, 'offPower', 'Off %', pct(b.offPower), 'pct'));
  else f.push(field(i, 'dur', 'Time (m:ss)', mmss(b.dur), 'time'));
  if (b.type === 'steady') f.push(field(i, 'power', 'Power %', pct(b.power), 'pct'));
  if (['warmup', 'cooldown', 'ramp'].includes(b.type)) f.push(field(i, 'from', 'From %', pct(b.from), 'pct'), field(i, 'to', 'To %', pct(b.to), 'pct'));
  if (['steady', 'intervals'].includes(b.type)) f.push(field(i, 'cadence', 'Cadence', b.cadence || '', 'rpm'));
  return `<div class="brow"><span class="bt bt-${b.type}">${LABEL[b.type]}</span><span class="bfs">${f.join('')}</span><span class="bbtns"><button class="small" data-up="${i}" title="Move up" ${i ? '' : 'disabled'}>↑</button><button class="small" data-down="${i}" title="Move down" ${i < B.blocks.length - 1 ? '' : 'disabled'}>↓</button><button class="small" data-del="${i}" title="Remove">×</button></span></div>`;
}
function render() {
  $('wb-blocks').innerHTML = B.blocks.length ? B.blocks.map(rowHtml).join('') : '<p class="note">Add blocks with the buttons below.</p>';
  preview();
}
function preview() {
  const steps = blocksToSteps(B.blocks), f = ftp();
  const ok = steps.length && steps.every((s) => s.dur > 0 && (s.free || s.max || (s.from > 0 && s.to > 0)));
  $('wb-save').disabled = !ok || !$('wb-name').value.trim();
  if (!ok) { $('wb-info').textContent = steps.length ? 'Some block has a time or power missing.' : ''; $('wb-preview').getContext('2d').clearRect(0, 0, 9999, 9999); return; }
  drawWorkout($('wb-preview'), steps, null, 1);
  const load = Math.round(steps.reduce((a, s) => a + s.dur * (s.free ? 0.36 : s.max ? 2.25 : ((s.from + s.to) / 2) ** 2), 0) / 36);
  const peak = Math.max(0, ...steps.filter((s) => !s.free && !s.max).map((s) => Math.max(s.from, s.to)));
  $('wb-info').innerHTML = `<b>${fmtTime(totalTime(steps))}</b> · training load about <b>${load} TSS</b> · hardest <b>${Math.round(peak * f)} W</b> (${pct(peak)}% of your ${f} W FTP)`;
}

// open with steps (a workout to edit or copy) or nothing (a fresh one from a template)
export function openBuilder({ name = '', description = '', steps = null, onSave }) {
  B.blocks = steps ? blocksFromSteps(steps) : [NEW.warmup(), NEW.intervals(), NEW.cooldown()];
  B.onSave = onSave;
  $('wb-name').value = name; $('wb-desc').value = description;
  $('dlg-builder').showModal();
  render();
}

export function initBuilder() {
  $('wb-add').innerHTML = Object.keys(NEW).map((t) => `<button class="small" data-add="${t}">+ ${LABEL[t]}</button>`).join('');
  $('wb-add').addEventListener('click', (e) => { const t = e.target.closest('[data-add]')?.dataset.add; if (t) { B.blocks.push(NEW[t]()); render(); } });
  $('wb-blocks').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const L = B.blocks;
    if (b.dataset.up) { const i = +b.dataset.up; [L[i - 1], L[i]] = [L[i], L[i - 1]]; }
    if (b.dataset.down) { const i = +b.dataset.down; [L[i + 1], L[i]] = [L[i], L[i + 1]]; }
    if (b.dataset.del) L.splice(+b.dataset.del, 1);
    render();
  });
  // typing updates the block (and the preview) without rebuilding the rows, so the field keeps its cursor
  $('wb-blocks').addEventListener('input', (e) => {
    const el = e.target, blk = B.blocks[+el.dataset.i]; if (!blk) return;
    const v = el.value, k = el.dataset.k, kind = el.dataset.kind;
    blk[k] = kind === 'time' ? parseT(v) : kind === 'pct' ? (+v > 0 ? +v / 100 : NaN) : kind === 'rpm' ? (+v || null) : Math.max(1, Math.round(+v) || 1);
    el.classList.toggle('bad', kind !== 'rpm' && !(blk[k] > 0));
    preview();
  });
  $('wb-name').addEventListener('input', preview);
  $('wb-cancel').addEventListener('click', () => $('dlg-builder').close());
  $('wb-save').addEventListener('click', async () => {
    $('wb-save').disabled = true;
    try { await B.onSave({ name: $('wb-name').value.trim().slice(0, 60), description: $('wb-desc').value.trim().slice(0, 300), blocks: B.blocks }); $('dlg-builder').close(); }
    catch (e) { alert('Could not save: ' + e.message); }
    $('wb-save').disabled = false;
  });
}
