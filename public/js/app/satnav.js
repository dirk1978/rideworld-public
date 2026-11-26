// Satnav for open worlds (2026-11-16, the owner: "a satnav feature where you can find a place during a ride, then the route
// will auto take you there"). 🧭 Go to… (dock, or / on the keyboard) opens a search over the world's named places
// (villages and areas, pubs, cafés, shops, schools, churches, parks...: build.mjs `places`), every street name and the
// route's start points; picking one hands it to openworld.js setNav, which makes the default way on at every junction
// the shortest way there. The panel under the top bar shows where to and how far, suggests turning round when that's
// quicker, and says when you've arrived (then it's back to free riding). ✕ cancels.
import { $, route, state, store, toast } from './core.js';
import { currentInfo } from './setup.js';
import { world } from './world.js';
import { ow, setNav, clearNav, navStatus, jumpTo } from './openworld.js';

const KIND = { geo: '🔎', area: '🏘', pub: '🍺', bar: '🍺', cafe: '☕', restaurant: '🍴', fast_food: '🍟', shop: '🛒', school: '🏫', college: '🏫', place_of_worship: '⛪', park: '🌳', nature_reserve: '🌳', golf_course: '⛳', sports_centre: '🏟', pharmacy: '💊', fuel: '⛽', library: '📚', hotel: '🏨', attraction: '📍', viewpoint: '🔭', street: '🛣', start: '🚩' };
let index = null, forData = null;
const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const km = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const flat = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));

function buildIndex() {
  const W = world.data; if (!W?.roads) return [];
  const out = [], seen = new Set();
  const add = (name, lat, lon, kind) => { const k = norm(name) + '|' + kind; if (!name || seen.has(k)) return; seen.add(k); out.push({ name, lat, lon, kind, n: norm(name) }); };
  for (const s of currentInfo()?.starts || []) add(s.name, s.lat, s.lon, 'start');
  for (const [lat, lon, name, kind] of W.places || []) add(name, lat, lon, kind);
  // streets: the middle of each name's longest stretch
  const byName = new Map();
  for (const e of W.roads.edges) { if (!e.name) continue; const L = e.pts.length; if (!byName.has(e.name) || byName.get(e.name).pts.length < L) byName.set(e.name, e); }
  for (const [name, e] of byName) { const p = e.pts[e.pts.length >> 1]; add(name, p[0], p[1], 'street'); }
  return out;
}
export function search(q) { // (also for the phone remote, remote.js)
  if (forData !== world.data) { index = buildIndex(); forData = world.data; }
  const here = route?.at ? route.at(state.dist) : null, me = here ? [here.lat, here.lon] : null;
  const nq = norm(q);
  let list = index.map((p) => ({ ...p, d: me ? flat(me, [p.lat, p.lon]) : 0 }));
  if (nq) list = list.filter((p) => p.n.includes(nq)).map((p) => ({ ...p, rank: (p.n.startsWith(nq) ? 0 : p.n.includes(' ' + nq) ? 1 : 2) + (p.kind === 'area' || p.kind === 'start' ? -0.5 : 0) }));
  else list = list.filter((p) => p.kind === 'area' || p.kind === 'start').map((p) => ({ ...p, rank: 0 })); // (nothing typed: villages and areas, nearest first)
  return list.sort((a, b) => a.rank - b.rank || a.d - b.d).slice(0, 14);
}

// Anything else on the map (the owner 2026-11-18: "jump or navigate to any point I search for"): OpenStreetMap's own search
// (Nominatim, as the route planner uses), limited to the world's box, for what the world's place list doesn't have
// (house names, postcodes, businesses); debounced, its results join the list marked 🔎
let geo = { q: null, list: [] }, geoTimer = 0;
function geoSearch(q) {
  clearTimeout(geoTimer);
  const b = world.data?.roads?.box; if (!b || norm(q).length < 3) { geo = { q, list: [] }; return; }
  if (geo.q === q) return;
  geoTimer = setTimeout(async () => {
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=json&limit=8&bounded=1&viewbox=${b.w},${b.n},${b.e},${b.s}&q=${encodeURIComponent(q)}`;
      const res = await fetch(u); const js = await res.json();
      geo = { q, list: js.map((r) => ({ name: r.display_name.split(',').slice(0, 2).join(','), lat: +r.lat, lon: +r.lon, kind: 'geo' })) };
      if ($('nav-q').value === q) render(true);
    } catch { /* offline: the world's own list still works */ }
  }, 450);
}
function render(fromGeo) {
  const box = $('nav-list'), q = $('nav-q').value;
  box.innerHTML = '';
  if (!fromGeo) geoSearch(q);
  const here = route?.at ? route.at(state.dist) : null, me = here ? [here.lat, here.lon] : null;
  const own = search(q), extra = geo.q === q ? geo.list.filter((g) => !own.some((p) => flat([p.lat, p.lon], [g.lat, g.lon]) < 60)).map((g) => ({ ...g, d: me ? flat(me, [g.lat, g.lon]) : 0 })) : [];
  const list = [...own, ...extra];
  if (!list.length) { box.innerHTML = `<p class="muted">${norm(q).length >= 3 && geo.q !== q ? 'Searching…' : 'Nothing called that on this map.'}</p>`; return; }
  for (const p of list) {
    const row = document.createElement('div'); row.className = 'nav-row';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'nav-item'; b.title = 'Satnav: ride there, the junctions take you';
    b.innerHTML = `<span class="nav-ic"></span><span class="nav-name"></span><span class="nav-d"></span>`;
    b.querySelector('.nav-ic').textContent = KIND[p.kind] || '📍';
    b.querySelector('.nav-name').textContent = p.name;
    b.querySelector('.nav-d').textContent = km(p.d);
    b.addEventListener('click', () => go(p));
    const j = document.createElement('button'); j.type = 'button'; j.className = 'nav-jump'; j.textContent = '⤴ Jump'; j.title = 'Jump straight there and ride on from there';
    j.addEventListener('click', () => jump(p));
    row.append(b, j); box.appendChild(row);
  }
}
// jump (the owner 2026-11-17): straight to the rideable spot nearest a place / a click on the map, the ride carries on
export function jump(p) {
  if ($('dlg-nav')?.open) $('dlg-nav').close();
  const road = jumpTo(p.lat, p.lon);
  if (!road) { toast("Couldn't find anywhere to ride near there.", 4000); return; }
  toast(`⤴ Jumped to ${p.name || 'the spot'}${road && road !== p.name ? ` (${road})` : ''}`, 4000);
}
// the dialog's map: the rideable network over the street map; a click drops you on the nearest road or path

// the world's edge (the owner 2026-11-17: "how do I know the map's limits?"): build.mask (rectangles "s,w,n,e;...") or the
// box, outlined, with everything outside greyed out
function worldEdge(Wd, m) {
  const rects = String(Wd?.build?.mask || '').split(';').map((r) => r.split(',').map(Number)).filter((r) => r.length === 4 && r.every(Number.isFinite));
  const b = Wd?.roads?.box; if (!rects.length && b) rects.push([b.s, b.w, b.n, b.e]);
  if (!rects.length) return;
  const holes = rects.map(([s, w, n, e]) => [[s, w], [n, w], [n, e], [s, e]]);
  L.polygon([[[-85, -180], [85, -180], [85, 180], [-85, 180]], ...holes], { stroke: false, fillColor: '#000', fillOpacity: 0.35, interactive: false }).addTo(m);
  for (const h of holes) L.polygon(h, { color: '#ff6a1a', weight: 2, dashArray: '8 6', fill: false, interactive: false }).addTo(m);
}
let pickMap = null, pickMark = null;
function showPickMap() {
  const el = $('nav-map'); if (!el || !window.L || !world.data?.roads) return;
  if (!pickMap) {
    pickMap = L.map(el, { preferCanvas: true, zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors', opacity: 0.75 }).addTo(pickMap);
    for (const e of world.data.roads.edges) L.polyline(e.pts.map((q) => [q[0], q[1]]), { color: e.off ? '#b07a52' : '#ff6a1a', weight: e.off ? 2 : 3, opacity: 0.85, interactive: false }).addTo(pickMap);
    pickMap.on('click', (ev) => {
      if (pickMark) pickMark.remove();
      pickMark = L.marker(ev.latlng).addTo(pickMap);
      const spot = { name: 'the picked spot', lat: ev.latlng.lat, lon: ev.latlng.lng };
      const btn = $('nav-map-go'); btn.disabled = false; btn.onclick = () => jump(spot);
      const nb = $('nav-map-nav'); if (nb) { nb.disabled = false; nb.onclick = () => go(spot); }
    });
    worldEdge(world.data, pickMap);
    const b = world.data.roads.box; pickMap.fitBounds([[b.s, b.w], [b.n, b.e]]);
  }
  setTimeout(() => { pickMap.invalidateSize(); const p = route.at(state.dist); pickMap.setView([p.lat, p.lon], 14); }, 50);
}
export function go(p) {
  if ($('dlg-nav')?.open) $('dlg-nav').close();
  ow.ride = null; // (a place picked by hand ends a pre-plotted route)
  if (!setNav({ name: p.name, lat: p.lat, lon: p.lon })) { toast("Couldn't find a way there.", 4000); return; }
  const s = navStatus();
  toast(`🧭 Taking you to ${p.name}${s ? ` (${km(s.left)})` : ''}: the junction choices now follow the way there.`, 5000);
  panel(true);
}
export function openNav() {
  if (!ow.on) { toast('The satnav works in open worlds.', 3000); return; }
  const d = $('dlg-nav'); if (!d) return;
  $('nav-q').value = '';
  render();
  // the ride waits while you choose (the owner 2026-11-18), and carries on when the dialog closes
  pausedForNav = !!state.riding && !$('btn-ride').disabled;
  if (pausedForNav) $('btn-ride').click();
  d.showModal();
  showPickMap();
  setTimeout(() => $('nav-q').focus(), 30);
}

let pausedForNav = false;
let lastPanel = 0;
function panel(force) {
  const box = $('nav-box'); if (!box) return;
  const now = performance.now(); if (!force && now - lastPanel < 400) return; lastPanel = now;
  const s = navStatus();
  if (!s) { box.hidden = true; return; }
  const R = ow.ride;
  // (on a route, a waypoint counts as reached 120 m before it, so the road beyond it is already planned towards the next
  // stop: planned towards the waypoint itself, the road past it looped back, +0.6 km Shottery to Alcester Road)
  if (R && R.next < R.via.length - 1 && s.left < 120) s.arrived = true;
  if (s.arrived) {
    // a pre-plotted route: on to its next waypoint, or done
    if (R && R.next < R.via.length - 1) { const done = R.via[R.next]; R.next++; const v = R.via[R.next]; setNav({ name: v.name, lat: v.lat, lon: v.lon }); ow.ride = R; return; } // (no waypoint toasts on a route: the owner 2026-11-21, "we don't need satnav stuff while riding a route"; an imported route's waypoints are only coordinates)
    if (R) { toast(`🏁 ${R.name}: route complete! Ride on wherever you like.`, 8000); clearNav(); ow.rideDone = true; box.hidden = true; return; } // (rideDone: the start arch goes, scenery.js)
    toast(`🏁 You've arrived at ${s.name}`, 6000); clearNav(); box.hidden = true; return;
  }
  // (a route: no satnav box at all; the top bar shows what's left of it, trip.js)
  if (R) { box.hidden = true; return; }
  box.hidden = false;
  const rest = R ? (R.legKm || []).slice(R.next).reduce((t, x) => t + x * 1000, 0) : 0;
  $('nav-to').textContent = R ? `${R.name} · next: ${s.name}` : s.name;
  $('nav-left').textContent = km(s.left + rest);
  $('nav-turn').hidden = !s.turn;
}
export function updateSatnav() { const ob = $('btn-nav'); if (ob) ob.classList.toggle('hidden', !ow.on); if (ow.nav || !$('nav-box')?.hidden) panel(false); }

export function initSatnav() {
  $('btn-nav')?.addEventListener('click', openNav);
  // Quiet roads / Most direct (openworld.js navW; per browser): changing it re-plans a destination already set
  { const sel = $('nav-pref'); if (sel) { sel.value = store.get('navPref', 'quiet'); sel.onchange = () => { store.set('navPref', sel.value); if (ow.nav && !ow.ride) setNav({ name: ow.nav.name, lat: ow.nav.lat, lon: ow.nav.lon }); }; } }
  $('nav-q')?.addEventListener('input', () => render());
  $('dlg-nav')?.addEventListener('close', () => { if (pausedForNav && !state.riding && !state.finished && !$('btn-ride').disabled) $('btn-ride').click(); pausedForNav = false; });
  $('nav-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = $('nav-list').querySelector('.nav-item'); if (first) first.click(); } });
  $('nav-cancel')?.addEventListener('click', () => { clearNav(); panel(true); toast('🧭 Satnav off: free riding.', 2500); });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && ow.on && !e.target.closest?.('input, textarea, select, dialog[open]')) { e.preventDefault(); openNav(); } });
}
