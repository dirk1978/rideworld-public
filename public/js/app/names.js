// Road and place names as the rider reaches them (the owner 2026-10-27: "could the current road or area moving into be
// displayed when approaching and fade out? Like if I'm joining Clattercut Lane, display it as I turn into it. Same as
// areas. Into Timberhonger or Hartlebury"). The server finds them (lib/names.js: roads turned onto, places entered);
// here they're placed on the ride (Route.locate) and each shown as it's passed: a glass banner that fades in, holds
// and fades out, one after another when they come together. Nothing on a jump along the route.
import { $, route, state } from './core.js';

let forRoute = null, events = [], last = 0, queue = [], busy = false;

function build() {
  const n = route.opts?.names;
  const ev = [
    ...(n?.roads || []).map((r) => ({ kind: 'road', name: r.name, ref: r.ref, d: route.locate(r.lat, r.lon, r.km, true) })),
    ...(n?.places || []).map((p) => ({ kind: 'place', name: p.name, d: route.locate(p.lat, p.lon, p.km, true) })),
  ];
  events = ev.filter((e) => e.d !== null && e.name).sort((a, b) => a.d - b.d || (a.kind === 'place' ? -1 : 1));
}

// the number's sign colours (British: motorway blue, primary routes green, B roads white; others grey)
const refKind = (ref) => (/^M\d/.test(ref) ? 'm' : /^A\d/.test(ref) ? 'a' : /^B\d/.test(ref) ? 'b' : 'x');

function show(e) {
  busy = true;
  const el = $('name-banner'), esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  el.className = 'nb-' + e.kind;
  el.innerHTML = e.kind === 'place'
    ? `<span class="nb-k">Entering</span><b>${esc(e.name)}</b>`
    : `<span class="nb-k">Onto</span><b>${esc(e.name)}</b>${e.ref ? `<span class="nb-ref nb-${refKind(e.ref)}">${esc(e.ref)}</span>` : ''}`;
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => { busy = false; }, 700); }, 4200);
}

// every frame in the ride
export function updateNames() {
  if (!route) return;
  if (forRoute !== route) { forRoute = route; build(); last = state.dist - 1; queue = []; }
  const d = state.dist;
  if (d > last && d - last < 300) { for (const e of events) if (e.d > last && e.d <= d) queue.push(e); }
  last = d;
  if (queue.length > 3) queue = queue.slice(-3);
  if (!busy && queue.length) show(queue.shift());
}
