// The browser tab during a ride (the owner 2026-10-21: "could the server have a favicon? go mad"): the tab's icon becomes
// a tiny power dial in the current zone colour, and its title shows watts and speed, so they can be read from another
// tab. Reads the numbers the dials show (so it never disagrees with them); once a second; back to the normal icon and
// title when not riding.
import { $, state } from './core.js';
import { zoneColour } from '../workout.js';

const TITLE = document.title;
let link = null, shown = '';

function draw(watts, share) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), col = zoneColour(share);
  g.fillStyle = '#0e1116'; g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5; // the dial's sweep, as on the power gauge
  g.lineCap = 'round'; g.lineWidth = 8;
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(32, 32, 24, a0, a0 + span); g.stroke();
  g.strokeStyle = col; g.beginPath(); g.arc(32, 32, 24, a0, a0 + span * Math.min(1, Math.max(0.02, share / 1.5))); g.stroke();
  g.fillStyle = '#fff'; g.font = `bold ${watts >= 1000 ? 17 : 21}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(watts), 32, 34);
  return c.toDataURL('image/png');
}

function tick() {
  const val = (id) => $(id)?.querySelector('.g-value')?.textContent?.trim() || '';
  const riding = state.riding && !state.finished;
  if (!riding) {
    if (link) { link.remove(); link = null; shown = ''; document.title = TITLE; }
    return;
  }
  const watts = Math.round(+val('g-power') || 0), speed = val('g-speed'), unit = $('g-speed')?.querySelector('.g-unit')?.textContent?.trim() || '';
  const ftp = +$('cfg-ftp')?.value || 250;
  document.title = `${watts} W · ${speed} ${unit} · RideWorld`;
  const key = `${watts}|${Math.floor((watts / ftp) * 20)}`;
  if (key === shown) return;
  shown = key;
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/png'; document.head.prepend(link); }
  link.href = draw(watts, watts / ftp);
}

export async function initTabIcon() {
  setInterval(tick, 1000);
}
