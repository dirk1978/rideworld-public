// Ride controls for phones and tablets (the owner 2026-10-20: "all options must be easily tappable while pounding away on
// a trainer"). On touch screens the dock shrinks to three big buttons (ride / pause, camera, ☰) and ☰ opens a sheet of
// large buttons. Every button here just presses the existing control (same behaviour, same state), so nothing ride-
// related is duplicated. The sheet closes after each tap, except the workout's easier / harder.
import { $, state } from './core.js';

const press = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };
const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

// [id, label (or a function giving it), action, shown when, keep the sheet open]
const ITEMS = [
  ['tm-finish', '🏁 Finish', () => press('btn-finish'), () => !$('btn-finish').classList.contains('hidden')],
  ['tm-uturn', '↩ Turn round', () => press('btn-uturn'), () => !$('btn-uturn').classList.contains('hidden')],
  ['tm-nav', '🧭 Go to…', () => press('btn-nav'), () => !$('btn-nav').classList.contains('hidden')],
  ['tm-cam', () => `🎥 ${$('cam-name').textContent || 'Camera'}`, () => press('btn-cam'), () => true, true],
  ['tm-clean', () => `🛣 Clean road ${state.cleanRoad ? 'on' : 'off'}`, () => press('btn-clean'), () => true, true],
  ['tm-shot', '📷 Photo', () => press('btn-shot'), () => true],
  ['tm-sound', () => `${$('btn-sound').classList.contains('off') ? '🔇' : '🔊'} Sound`, () => press('btn-sound'), () => true, true],
  ['tm-chapeau', '🎩 Chapeau', () => press('btn-chapeau'), () => !$('btn-chapeau').classList.contains('hidden')],
  ['tm-easier', '−5% Easier', () => press('wo-easier'), () => !$('wo-panel').classList.contains('hidden'), true],
  ['tm-harder', '+5% Harder', () => press('wo-harder'), () => !$('wo-panel').classList.contains('hidden'), true],
  ['tm-skip', 'Skip ▶', () => press('wo-skip'), () => !$('wo-panel').classList.contains('hidden')],
  ['tm-erg', () => `ERG ${$('wo-erg').classList.contains('on') ? 'on' : 'off'}`, () => press('wo-erg'), () => !$('wo-panel').classList.contains('hidden'), true],
  ['tm-report', '⚑ Report a problem', () => press('btn-report'), () => true],
  ['tm-film', '🎬 Film mode', () => press('btn-film'), () => true],
  ['tm-settings', '⚙ Settings', () => press('btn-menu'), () => true],
];

function render() {
  const grid = $('tm-grid');
  grid.innerHTML = '';
  for (const [id, label, act, show, keep] of ITEMS) {
    if (!show()) continue;
    const b = document.createElement('button');
    b.id = id;
    b.textContent = typeof label === 'function' ? label() : label;
    b.addEventListener('click', () => { act(); if (keep) setTimeout(render, 50); else close(); });
    grid.appendChild(b);
  }
}
const open = () => { render(); $('tm-sheet').classList.remove('hidden'); };
const close = () => $('tm-sheet').classList.add('hidden');

export async function initTouchMenu() {
  $('tm-open').addEventListener('click', open);
  $('tm-close').addEventListener('click', close);
  $('tm-sheet').addEventListener('click', (e) => { if (e.target.id === 'tm-sheet') close(); }); // tap outside the sheet
  $('tm-ride').addEventListener('click', () => press('btn-ride'));
  $('tm-cam-btn').addEventListener('click', () => press('btn-cam'));
  // Film mode hides everything; on a touch screen there's no F or Esc, so a small ✕ in the corner brings it back
  $('tm-film-exit').addEventListener('click', () => key('Escape'));
  // Simulator power on a touch screen: − and + either side of the ride button do what ↓ / ↑ do (10 W a step, or the
  // workout's target); held down they repeat, faster after a moment (the owner: no keyboard on a phone)
  for (const [id, k] of [['tm-down', 'ArrowDown'], ['tm-up', 'ArrowUp']]) {
    let timer = null, n = 0;
    const stop = () => { clearTimeout(timer); timer = null; };
    const step = () => { key(k); n++; timer = setTimeout(step, n < 4 ? 250 : 80); };
    $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); n = 0; stop(); step(); });
    $(id).addEventListener('contextmenu', (e) => e.preventDefault()); // (no long-press menu while held)
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $(id).addEventListener(ev, stop);
  }
  // the big ride button mirrors the dock's (Start ride / Pause / Resume / Finished)
  setInterval(() => {
    const src = $('btn-ride'), dst = $('tm-ride');
    if (dst.textContent !== src.textContent) dst.textContent = src.textContent;
    dst.disabled = src.disabled;
    const sim = $('cfg-sim').checked;
    for (const id of ['tm-down', 'tm-up']) $(id).classList.toggle('hidden', !sim);
  }, 300);
}
