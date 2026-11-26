// What shows over the ride (2026-11-14, the owner: "The coach, the rider list, the place names etc all obscure each other
// on mobile. It'd be good to have a toggle for each for mobile and desktop"). One switch per overlay on the setup screen
// (section "On screen", also reachable mid-ride through Settings), kept per browser (`rw.show.<key>`), so a phone and a
// PC keep their own. Off = the element is hidden with a body class (style.css `body.hide-<key>`), nothing else changes.
import { $, store } from './core.js';

export const OVERLAYS = [
  ['coach', 'Coach tips', 'The coach\'s messages during the ride'],
  ['riders', 'Rider list', 'Who you\'re riding with, gaps and watts'],
  ['names', 'Road and place names', '"Entering Lawrence Hill", "Onto Redcliffe Way"'],
  ['segments', 'Segment timer', 'Climbs and sprints: coming up, live time, result'],
  ['maps', 'Maps', 'The whole-route map and the close-up map'],
  ['graph', 'Elevation graph', 'The route\'s profile along the bottom'],
  ['draft', 'Draft readout', '"Draft 32% · saves 58 W" under the power dial'],
  ['music', 'Music player', 'The YouTube panel (needs to show to play)'],
];
const on = (k) => store.get('show.' + k, '1') !== '0';
const apply = () => { for (const [k] of OVERLAYS) document.body.classList.toggle('hide-' + k, !on(k)); };

export function initScreen() {
  $('screen-toggles').innerHTML = OVERLAYS.map(([k, label, hint]) => `<label class="check"><input type="checkbox" data-show="${k}"${on(k) ? ' checked' : ''}> ${label} <span class="opt">${hint}</span></label>`).join('');
  $('screen-toggles').addEventListener('change', (e) => {
    const k = e.target.dataset.show;
    if (!k) return;
    store.set('show.' + k, e.target.checked ? '1' : '0');
    apply();
  });
  apply();
}
