// Route Studio (2026-11-14, the owner: "a mad banging route editor ... I wanna feel like I'm building a coaster in
// rollercoaster tycoon"; the corners were harsh: "random chicanes, long corners shown as multiple leans up and down").
// A top-down editor on the satellite map for a route's road line. Everything is a hand correction saved on that route
// (PUT /api/routes/<id>/corrections, the same list the ride's editor uses), applied in order (route.js):
//   select a stretch (click its start and end on the line; drag the cyan handles to adjust)
//   Smooth bend   the stretch becomes one flowing curve that leaves and joins the line in its own direction
//   Straighten    the stretch becomes a straight line
//   Drag          grab the line and pull: it moves with a smooth fall-off over the reach (or the selected stretch)
//   ← / →         nudge the selected stretch sideways 0.5 m
// The line is coloured by how hard it would lean the rider (curvature over 10 m chords), and suspected chicanes
// (a sharp left and right within 50 m) get a marker: hints only, nothing is changed by itself. Each change saves
// straight away; Undo / Redo re-save. "Ride it" opens the ride in the simulator at the selection.
import { Route, applyMove } from './route.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search), ID = qs.get('route');
const S = { info: null, gpx: '', adjust: [], hist: [], redo: [], P: [], cum: [], kx: 1, ky: 110540, sel: null, tool: 'select', canEdit: false, layers: {}, K: [], wig: [] };
let map;

const toast = (t, ms = 2500) => { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms); };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const fmtKm = (m) => (m / 1000).toFixed(2) + ' km';

// ---------- the line: the route as ridden, every correction applied, in local metres ----------
function build() {
  const r = Route.fromGpx(S.gpx, S.info.name, S.adjust, null, null, { keepDense: !!S.info.presmoothed, centre: S.info.centre });
  const P = r.fullPts;
  S.P = P;
  S.kx = 111320 * Math.cos(P[0].lat * Math.PI / 180); // (the same flat metres route.js measures corrections in)
  S.cum = [0];
  for (let i = 1; i < P.length; i++) S.cum.push(S.cum[i - 1] + Math.hypot((P[i].lon - P[i - 1].lon) * S.kx, (P[i].lat - P[i - 1].lat) * S.ky));
  S.len = S.cum[S.cum.length - 1];
  // curvature every 5 m over 10 m chords (+ = turning left)
  const Q = [];
  for (let d = 0; d <= S.len; d += 5) Q.push(at(d));
  const xy = (p) => [p.lon * S.kx, p.lat * S.ky];
  S.K = Q.map((_, i) => {
    if (i < 2 || i > Q.length - 3) return 0;
    const a = xy(Q[i - 2]), b = xy(Q[i]), c = xy(Q[i + 2]);
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    return dh / 10;
  });
  // suspected chicanes: a left and a right of at least ~120 m radius within 50 m of each other
  S.wig = [];
  const T = 1 / 120;
  for (let i = 0; i < S.K.length; i++) {
    if (Math.abs(S.K[i]) < T) continue;
    for (let j = i + 1; j < Math.min(S.K.length, i + 10); j++) {
      if (Math.abs(S.K[j]) >= T && Math.sign(S.K[j]) !== Math.sign(S.K[i])) {
        const d = ((i + j) / 2) * 5;
        if (!S.wig.some((w) => Math.abs(w - d) < 80)) S.wig.push(d);
        break;
      }
    }
  }
}
function at(d) {
  const P = S.P, c = S.cum;
  let lo = 0, hi = P.length - 1;
  d = Math.max(0, Math.min(S.len, d));
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}
// nearest distance along the line to a map point, and how far off it is (metres)
function nearest(ll) {
  const x = ll.lng * S.kx, y = ll.lat * S.ky, P = S.P;
  let best = { off: Infinity, d: 0 };
  for (let i = 1; i < P.length; i++) {
    const ax = P[i - 1].lon * S.kx, ay = P[i - 1].lat * S.ky, bx = P[i].lon * S.kx, by = P[i].lat * S.ky;
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    const off = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (off < best.off) best = { off, d: S.cum[i - 1] + (S.cum[i] - S.cum[i - 1]) * t };
  }
  return best;
}
const mPerPx = () => (156543.03 * Math.cos(map.getCenter().lat * Math.PI / 180)) / 2 ** map.getZoom();
const roadPx = () => Math.max(4, Math.min(60, 4.4 / mPerPx()));
const colourOf = (k) => { const R = 1 / Math.max(1e-6, Math.abs(k)); return R > 250 ? '#e8edf5' : R > 90 ? '#34d399' : R > 35 ? '#fbbf24' : '#ff4d4d'; };

// ---------- drawing ----------
function draw() {
  for (const l of Object.values(S.layers)) if (l) map.removeLayer(l);
  S.layers = {};
  const w = roadPx(), g = L.layerGroup();
  const pts = (a, b) => { const out = []; for (let d = a; d <= b + 0.01; d += 5) { const p = at(d); out.push([p.lat, p.lon]); } return out; };
  g.addLayer(L.polyline(S.P.map((p) => [p.lat, p.lon]), { color: '#05070d', weight: w + 4, opacity: 0.85, interactive: false }));
  // coloured by curvature, in runs of the same colour
  let start = 0;
  for (let i = 1; i <= S.K.length; i++) {
    if (i < S.K.length && colourOf(S.K[i]) === colourOf(S.K[start])) continue;
    g.addLayer(L.polyline(pts(start * 5, Math.min(S.len, i * 5)), { color: colourOf(S.K[start]), weight: w, opacity: 0.95, interactive: false, lineCap: 'butt' }));
    start = i;
  }
  // centre line, as on the road
  if (w > 9) g.addLayer(L.polyline(S.P.map((p) => [p.lat, p.lon]), { color: '#ffffff', weight: 1.2, opacity: 0.8, dashArray: `${Math.max(4, 2 / mPerPx())} ${Math.max(6, 4 / mPerPx())}`, interactive: false }));
  for (const d of S.wig) { const p = at(d); g.addLayer(L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '<div class="wig" title="Possible chicane: a left and a right close together">!</div>', iconSize: [22, 22] }), interactive: false })); }
  // start and finish flags
  const a = at(0), b = at(S.len);
  g.addLayer(L.circleMarker([a.lat, a.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#34d399', fillOpacity: 1, interactive: false }));
  g.addLayer(L.circleMarker([b.lat, b.lon], { radius: 7, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }));
  S.layers.line = g.addTo(map);
  drawSel();
  drawStrip();
}
function drawSel() {
  if (S.layers.sel) map.removeLayer(S.layers.sel);
  S.layers.sel = null;
  const s = S.sel;
  if (!s) return hint();
  const g = L.layerGroup(), w = roadPx();
  if (s.to != null) {
    const out = []; for (let d = s.from; d <= s.to + 0.01; d += 3) { const p = at(d); out.push([p.lat, p.lon]); }
    g.addLayer(L.polyline(out, { color: '#22d3ee', weight: w + 10, opacity: 0.35, interactive: false }));
  }
  for (const k of ['from', 'to']) {
    if (s[k] == null) continue;
    const p = at(s[k]);
    const m = L.marker([p.lat, p.lon], { draggable: S.canEdit, icon: L.divIcon({ className: '', html: '<div class="handle"></div>', iconSize: [16, 16] }) });
    m.on('drag', (e) => { const n = nearest(e.latlng); s[k] = n.d; const q = at(n.d); m.setLatLng([q.lat, q.lon]); });
    m.on('dragend', () => { if (s.to != null && s.to < s.from) [s.from, s.to] = [s.to, s.from]; drawSel(); });
    g.addLayer(m);
  }
  S.layers.sel = g.addTo(map);
  hint();
}
function hint() {
  const s = S.sel, h = $('hint');
  if (!S.canEdit) { h.textContent = 'Looking only: this route can be changed by its owner or an admin.'; return; }
  if (S.tool === 'drag') { h.textContent = s?.to != null ? `Grab the track inside the cyan stretch and pull: just that stretch moves. Esc lets go of the stretch.` : 'Grab the track anywhere and pull. It eases off over the drag reach either side.'; return; }
  if (!s) h.textContent = 'Click the start of a stretch on the track, then its end.';
  else if (s.to == null) h.textContent = 'Now click where the stretch ends.';
  else h.textContent = `${fmtKm(s.to - s.from)} selected (${fmtKm(s.from)}–${fmtKm(s.to)}). Smooth bend (B), Straighten (T), ← → to nudge, or drag it.`;
}

// the lean strip: curvature along the whole route, the map's view and the selection marked
function drawStrip() {
  const cv = $('lean'), dpr = devicePixelRatio || 1, W = (cv.width = cv.clientWidth * dpr), H = (cv.height = cv.clientHeight * dpr), g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const X = (d) => (d / S.len) * W, mid = H / 2, scale = (H / 2 - 2) / (1 / 25);
  // the part of the route in view
  const b = map.getBounds();
  let v0 = null, v1 = null;
  for (let d = 0; d <= S.len; d += 20) { const p = at(d); if (b.contains([p.lat, p.lon])) { if (v0 == null) v0 = d; v1 = d; } }
  if (v0 != null) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(X(v0), 0, Math.max(2, X(v1) - X(v0)), H); }
  if (S.sel?.to != null) { g.fillStyle = 'rgba(34,211,238,.25)'; g.fillRect(X(S.sel.from), 0, Math.max(2, X(S.sel.to) - X(S.sel.from)), H); }
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
  const bw = Math.max(1, W / S.K.length);
  S.K.forEach((k, i) => { const y = Math.max(-H / 2 + 1, Math.min(H / 2 - 1, -k * scale)); g.fillStyle = colourOf(k); g.fillRect(X(i * 5), Math.min(mid, mid + y), bw, Math.abs(y) || 1); });
  g.fillStyle = '#ff2e7e'; for (const d of S.wig) g.fillRect(X(d) - 1, 0, 2 * dpr, 6 * dpr);
  $('strip-km').textContent = v0 != null ? `in view ${fmtKm(v0)}–${fmtKm(v1)} of ${fmtKm(S.len)}` : fmtKm(S.len);
}

// ---------- changes ----------
async function save() {
  $('saved').textContent = 'Saving…';
  try {
    await api(`/api/routes/${encodeURIComponent(ID)}/corrections`, { method: 'PUT', body: JSON.stringify({ adjust: S.adjust, finish: S.info.finish ?? null, start: S.info.start ?? null }) });
    $('saved').textContent = 'Saved ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { $('saved').textContent = 'Not saved'; toast('Could not save: ' + e.message, 5000); }
}
function changed() { build(); draw(); list(); $('undo').disabled = !S.hist.length; $('redo').disabled = !S.redo.length; save(); }
function commit(fn, msg) {
  S.hist.push(clone(S.adjust)); S.redo = [];
  fn(S.adjust);
  changed();
  if (msg) toast(msg);
}
const needSel = () => { if (S.sel?.to != null && S.sel.to - S.sel.from >= 6) return true; toast('Select a stretch first: click its start and end on the track.'); return false; };
function bend() {
  if (!S.canEdit || !needSel()) return;
  const t = +$('tension').value;
  commit((a) => a.push({ from: +(S.sel.from / 1000).toFixed(4), to: +(S.sel.to / 1000).toFixed(4), bend: true, keepEle: true, ...(t !== 1 ? { tension: t } : {}), note: 'Route Studio' }), 'Smoothed into one bend');
  keepSel();
}
function straighten() {
  if (!S.canEdit || !needSel()) return;
  commit((a) => a.push({ from: +(S.sel.from / 1000).toFixed(4), to: +(S.sel.to / 1000).toFixed(4), straight: true, keepEle: true, note: 'Route Studio' }), 'Straightened');
  keepSel();
}
// after a change the stretch's length changes: keep the selection's start, end it at the same distance as before
function keepSel() { if (S.sel) S.sel.to = Math.min(S.len, S.sel.to); drawSel(); }
function nudge(right) {
  if (!S.canEdit || !needSel()) return;
  const f = +(S.sel.from / 1000).toFixed(4), t = +(S.sel.to / 1000).toFixed(4), last = S.adjust[S.adjust.length - 1];
  commit((a) => { if (last && last.right && !last.straight && !last.bend && last.from === f && last.to === t && last.note === 'Route Studio nudge') last.right = +(last.right + right).toFixed(2); else a.push({ from: f, to: t, right, note: 'Route Studio nudge' }); });
}
function undo() { if (!S.hist.length) return; S.redo.push(clone(S.adjust)); S.adjust = S.hist.pop(); changed(); toast('Undone'); }
function redo() { if (!S.redo.length) return; S.hist.push(clone(S.adjust)); S.adjust = S.redo.pop(); changed(); toast('Redone'); }

function list() {
  const name = (a) => (a.bend ? '⤳ Smooth bend' : a.straight ? '━ Straightened' : a.dx || a.dy ? `✋ Moved ${Math.hypot(a.dx || 0, a.dy || 0).toFixed(1)} m` : a.right ? `↔ ${a.right > 0 ? 'Right' : 'Left'} ${Math.abs(a.right)} m` : a.level ? 'Levelled' : a.mine ? 'Own heights' : a.up ? `↕ ${a.up > 0 ? 'Up' : 'Down'} ${Math.abs(a.up)} m` : a.hold ? 'Held' : 'Correction');
  const shape = (a) => a.bend || a.straight || a.dx || a.dy || a.right;
  $('list').innerHTML = S.adjust.map((a, i) => `<div class="corr${/Route Studio/.test(a.note || '') ? ' mine' : ''}" data-i="${i}" title="${(a.note || '').replace(/"/g, '')}"><span class="t">${name(a)} <small>${a.from.toFixed(2)}–${a.to.toFixed(2)} km</small></span>${S.canEdit && shape(a) ? `<button class="x" data-rm="${i}" title="Remove">×</button>` : ''}</div>`).reverse().join('') || '<div class="corr">None yet</div>';
}

// ---------- dragging the track ----------
let drag = null;
// (pointer events on the map's box, caught before Leaflet's own panning sees them; mouse and touch alike)
function startDrag(ev) {
  if (!S.canEdit || S.tool !== 'drag' || ev.button > 0) return;
  const e = { latlng: map.mouseEventToLatLng(ev) };
  const n = nearest(e.latlng);
  if (n.off > Math.max(6, 22 * mPerPx())) return;
  const R = +$('reach').value, inSel = S.sel?.to != null && n.d >= S.sel.from && n.d <= S.sel.to;
  const range = inSel ? [S.sel.from, S.sel.to] : [Math.max(0, n.d - R), Math.min(S.len, n.d + R)];
  drag = { at: e.latlng, range, dx: 0, dy: 0, id: ev.pointerId };
  ev.stopPropagation(); ev.preventDefault();
  try { $('map').setPointerCapture(ev.pointerId); } catch {}
  map.dragging.disable();
  document.body.classList.add('dragging');
}
function moveDrag(ev) {
  if (!drag) return;
  ev.stopPropagation(); ev.preventDefault();
  const e = { latlng: map.mouseEventToLatLng(ev) };
  drag.dx = (e.latlng.lng - drag.at.lng) * S.kx; drag.dy = (e.latlng.lat - drag.at.lat) * S.ky;
  const moved = applyMove(S.P, { from: drag.range[0] / 1000, to: drag.range[1] / 1000, dx: drag.dx, dy: drag.dy });
  if (S.layers.preview) map.removeLayer(S.layers.preview);
  const out = [];
  for (let i = 0; i < moved.length; i++) if (S.cum[i] >= drag.range[0] - 30 && S.cum[i] <= drag.range[1] + 30) out.push([moved[i].lat, moved[i].lon]);
  S.layers.preview = L.polyline(out, { color: '#ff8a3c', weight: roadPx(), opacity: 0.9, interactive: false }).addTo(map);
}
function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  map.dragging.enable();
  document.body.classList.remove('dragging');
  if (S.layers.preview) { map.removeLayer(S.layers.preview); S.layers.preview = null; }
  if (Math.hypot(d.dx, d.dy) < 0.3) return;
  commit((a) => a.push({ from: +(d.range[0] / 1000).toFixed(4), to: +(d.range[1] / 1000).toFixed(4), dx: +d.dx.toFixed(2), dy: +d.dy.toFixed(2), note: 'Route Studio' }), `Moved ${Math.hypot(d.dx, d.dy).toFixed(1)} m`);
}

// ---------- map ----------
async function baseLayer(key) {
  if (key) {
    try {
      const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapType: 'satellite', language: 'en-GB', region: 'GB' }) });
      const j = await r.json();
      if (j.session) return L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${encodeURIComponent(key)}`, { maxZoom: 22, maxNativeZoom: 21, attribution: 'Imagery © Google' });
    } catch (e) { console.warn('satellite', e); }
  }
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
}
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  hint();
}

async function init() {
  if (!ID) { $('rname').textContent = 'No route chosen: open Route Studio from a route card.'; return; }
  const [set, rl] = await Promise.all([api('/api/settings'), api('/api/routes')]);
  const info = rl.routes.find((r) => r.id === ID);
  if (!info) { $('rname').textContent = 'That route is not here (or not yours).'; return; }
  S.info = info; S.adjust = clone(info.adjust || []);
  S.canEdit = info.kind === 'server' ? set.me.admin : (set.me.admin || info.by === set.me.username);
  if (info.pieces) { $('rname').textContent = `${info.name}: a highlights route, edit its parent route instead.`; return; }
  $('rname').textContent = info.name;
  document.title = `${info.name} · Route Studio`;
  S.gpx = await (await fetch(`/api/routes/${encodeURIComponent(ID)}.gpx`)).text();
  build();
  map = L.map('map', { zoomControl: false, preferCanvas: true, maxZoom: 22 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  (await baseLayer(set.global?.google || '')).addTo(map);
  map.fitBounds(L.latLngBounds(S.P.map((p) => [p.lat, p.lon])).pad(0.05));
  draw(); list();
  map.on('zoomend', draw);
  map.on('moveend', drawStrip);
  map.on('click', (e) => {
    if (!S.canEdit || S.tool !== 'select') return;
    const n = nearest(e.latlng);
    if (n.off > Math.max(8, 30 * mPerPx())) { if (S.sel) { S.sel = null; drawSel(); drawStrip(); } return; }
    if (!S.sel || S.sel.to != null) S.sel = { from: n.d, to: null };
    else { S.sel.to = n.d; if (S.sel.to < S.sel.from) [S.sel.from, S.sel.to] = [S.sel.to, S.sel.from]; if (S.sel.to - S.sel.from < 6) S.sel = null; }
    drawSel(); drawStrip();
  });
  const box = $('map');
  box.addEventListener('pointerdown', startDrag, true);
  box.addEventListener('pointermove', moveDrag, true);
  box.addEventListener('pointerup', endDrag, true);
  box.addEventListener('pointercancel', endDrag, true);
  if (!S.canEdit) document.querySelectorAll('#tools button, #undo, #redo').forEach((b) => (b.disabled = true));
  hint();  if (qs.has('debug')) window.__studio = { S, at, map: () => map }; // (tests)
}

// ---------- controls ----------
document.querySelectorAll('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('t-bend').addEventListener('click', bend);
$('t-straight').addEventListener('click', straighten);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('tension').addEventListener('input', () => ($('tension-v').textContent = (+$('tension').value).toFixed(2)));
$('reach').addEventListener('input', () => ($('reach-v').textContent = $('reach').value + ' m'));
$('list').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { const i = +rm.dataset.rm; commit((a) => a.splice(i, 1), 'Correction removed'); return; }
  const row = e.target.closest('[data-i]');
  if (row) { const a = S.adjust[+row.dataset.i]; const p = [at(a.from * 1000), at(a.to * 1000)]; map.fitBounds(L.latLngBounds(p.map((q) => [q.lat, q.lon])).pad(0.6)); S.sel = { from: Math.min(a.from * 1000, S.len), to: Math.min(a.to * 1000, S.len) }; drawSel(); drawStrip(); }
});
$('lean').addEventListener('click', (e) => { const r = e.target.getBoundingClientRect(), d = ((e.clientX - r.left) / r.width) * S.len, p = at(d); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17)); });
$('ride').addEventListener('click', () => {
  const d = S.sel ? S.sel.from : nearest(map.getCenter()).d;
  try {
    localStorage.setItem('rw.suggested', ID); localStorage.setItem('rw.routeTab', 'suggest');
    localStorage.setItem('rw.resume', JSON.stringify({ km: Math.max(0, d - 80) / 1000, at: Date.now(), editor: false, msg: 'From Route Studio: here it is.' }));
  } catch {}
  window.open('/', 'rideworld-ride');
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  const k = e.key;
  if (k === '1') setTool('select');
  else if (k === '2') setTool('drag');
  else if (k === 'b' || k === 'B') bend();
  else if (k === 't' || k === 'T') straighten();
  else if (k === 'z' || k === 'Z') undo();
  else if (k === 'y' || k === 'Y') redo();
  else if (k === 'Escape') { S.sel = null; drawSel(); drawStrip(); }
  else if (k === 'ArrowLeft' && S.sel?.to != null) { e.preventDefault(); nudge(-0.5); }
  else if (k === 'ArrowRight' && S.sel?.to != null) { e.preventDefault(); nudge(0.5); }
});
addEventListener('resize', () => map && drawStrip());
init().catch((e) => { console.error(e); $('rname').textContent = 'Could not open the route: ' + e.message; });
