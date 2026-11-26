// Map editor for open worlds (2026-11-17, the owner: "OSM isn't quite right with entry and exit points ... a map editor
// would be helpful"). Shows the world's network (api/world/<id>) over the street map or satellite, and lets an admin
// correct it; the edits (api/mapedits/<id>: paths, remove, oneway, walls) are applied by tools/openworld/build.mjs, and
// Rebuild (tools/openworld/rebuild.mjs, ~20 s) puts them into the world riders load.
const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('route') || 'bromsgrove-open';
const api = async (url, opts = {}) => { const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
const hint = (t) => { $('hint').textContent = t || ''; };
const km = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
const lenOf = (P) => P.slice(1).reduce((t, p, i) => t + dist(P[i], p), 0);
const compass = (a, b) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI + 360) % 360 / 45) % 8];

const map = L.map('map', { preferCanvas: true, zoomControl: false }).setView([52.335, -2.06], 14);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
const bases = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap contributors' }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
};
bases.osm.addTo(map);
$('base').addEventListener('change', () => { for (const b of Object.values(bases)) map.removeLayer(b); bases[$('base').value].addTo(map); netLayer.bringToFront?.(); });

let W = null, edits = { paths: [], remove: [], oneway: [], walls: [], shops: [], trees: [] }, dirty = false, tool = 'inspect', drawing = null, selected = null;
const netLayer = L.layerGroup().addTo(map), arrowLayer = L.layerGroup(), editLayer = L.layerGroup().addTo(map), tmpLayer = L.layerGroup().addTo(map);
window.__map = map; // (tests)
// one-way arrows only when zoomed in (zoomed out they were a rash of yellow stars)
const arrowsByZoom = () => { if (map.getZoom() >= 16) arrowLayer.addTo(map); else map.removeLayer(arrowLayer); };
map.on('zoomend', arrowsByZoom);
const MAIN = /^(trunk|primary|secondary)/;
const CATS = { pub: 'pub', cafe: 'café', restaurant: 'restaurant', fast_food: 'takeaway / chip shop', hairdresser: 'hairdresser / barber', estate_agent: 'estate agent', convenience: 'convenience shop', supermarket: 'supermarket', butcher: 'butcher', bakery: 'bakery', pharmacy: 'chemist', charity: 'charity shop', florist: 'florist', bicycle: 'bike shop', bank: 'bank', post_office: 'post office', clothes: 'clothes shop', beauty: 'beauty salon', shop: 'other shop' };
// the survey's trees, as dots, when zoomed right in (so you can see what Remove trees will take away)
const treeLayer = L.layerGroup().addTo(map);
function drawTrees() {
  treeLayer.clearLayers(); if (!W || map.getZoom() < 17) return;
  const b = map.getBounds();
  for (const [la, lo, , cr] of W.lidarTrees || []) if (b.contains([la, lo])) L.circle([la, lo], { radius: Math.max(1.5, (cr || 3) * 0.6), color: '#2e7d32', weight: 1, fillColor: '#4caf50', fillOpacity: 0.35, interactive: false }).addTo(treeLayer);
  for (const [la, lo] of W.trees || []) if (b.contains([la, lo])) L.circle([la, lo], { radius: 2, color: '#2e7d32', weight: 1, fillColor: '#81c784', fillOpacity: 0.5, interactive: false }).addTo(treeLayer);
}
map.on('moveend zoomend', () => drawTrees());
const styleOf = (e) => e.off ? { color: e.surf === 'gravel' ? '#c9b48a' : e.surf === 'paved' ? '#cfcfcf' : '#8a6a48', weight: e.surf === 'paved' ? 2 : 3, dashArray: e.surf === 'paved' ? null : '6 4' } : { color: MAIN.test(e.hw) ? '#f4f4f4' : '#9aa3b5', weight: MAIN.test(e.hw) ? 5 : 3 };
// undo (the owner 2026-11-17: "I need an undo button"): every change calls setDirty(), which stacks the edits as they were
// just before it (`lastEdits`); Undo / Ctrl+Z puts the previous state back
let lastEdits = null; const undoStack = [];
const snap = () => { lastEdits = JSON.stringify(edits); };
const setDirty = (d = true) => {
  if (d && lastEdits != null && lastEdits !== JSON.stringify(edits)) { undoStack.push(lastEdits); if (undoStack.length > 100) undoStack.shift(); }
  snap(); dirty = d; $('save').disabled = !d; $('state').textContent = d ? 'unsaved changes' : 'saved'; if ($('undo')) $('undo').disabled = !undoStack.length;
};
function undo() {
  if (drawing?.length) { drawing.pop(); redrawTmp(); return; } // (while drawing: the last point)
  const prev = undoStack.pop(); if (prev == null) return;
  edits = JSON.parse(prev); snap(); tmpLayer.clearLayers(); $('info').textContent = 'Undone.'; drawEdits();
  dirty = true; $('save').disabled = false; $('state').textContent = 'unsaved changes'; $('undo').disabled = !undoStack.length;
}
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });


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
// ---------- the network, and finding the nearest stretch to a click ----------
let grid = new Map(); const G = 0.0006;
function drawNetwork() {
  netLayer.clearLayers(); arrowLayer.clearLayers(); grid = new Map();
  for (const a of W.water || []) L.polyline(a.pts, { color: '#4aa3df', weight: a.t === 'stream' ? 2 : 6, opacity: 0.7, interactive: false }).addTo(netLayer);
  W.roads.edges.forEach((e, i) => {
    L.polyline(e.pts.map((p) => [p[0], p[1]]), { ...styleOf(e), opacity: 0.95, interactive: false }).addTo(netLayer);
    if (e.oneway) { const m = e.pts[Math.floor(e.pts.length / 2)], n = e.pts[Math.min(e.pts.length - 1, Math.floor(e.pts.length / 2) + 1)], [a, b] = e.oneway === 1 ? [m, n] : [n, m], ang = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI; L.marker([m[0], m[1]], { interactive: false, icon: L.divIcon({ className: 'arrow', html: `<div style="transform:rotate(${ang - 90}deg)">➤</div>`, iconSize: [14, 14] }) }).addTo(arrowLayer); }
    for (let k = 1; k < e.pts.length; k++) { const a = e.pts[k - 1], b = e.pts[k]; for (let gx = Math.floor(Math.min(a[1], b[1]) / G); gx <= Math.floor(Math.max(a[1], b[1]) / G); gx++) for (let gy = Math.floor(Math.min(a[0], b[0]) / G); gy <= Math.floor(Math.max(a[0], b[0]) / G); gy++) { const key = gx + ',' + gy; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([i, k]); } }
  });
}
function nearestEdge(ll, maxM = 25) {
  let best = null; const gx = Math.floor(ll[1] / G), gy = Math.floor(ll[0] / G);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [i, k] of grid.get((gx + a) + ',' + (gy + b)) || []) {
    const p = W.roads.edges[i].pts[k - 1], q = W.roads.edges[i].pts[k], kx = 111320 * Math.cos((ll[0] * Math.PI) / 180);
    const ax = (p[1] - ll[1]) * kx, ay = (p[0] - ll[0]) * 110540, bx = (q[1] - ll[1]) * kx, by = (q[0] - ll[0]) * 110540, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1)));
    const d = Math.hypot(ax + vx * t, ay + vy * t);
    if (d < maxM && (!best || d < best.d)) best = { d, i, at: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] };
  }
  return best;
}
const clickReach = () => Math.max(8, 14 * 156543 * Math.cos((map.getCenter().lat * Math.PI) / 180) / 2 ** map.getZoom()); // (~14 px in metres)

// ---------- edits on the map and in the list ----------
function drawEdits() {
  editLayer.clearLayers(); const list = $('list'); list.innerHTML = '';
  const item = (label, zoomTo, del) => { const d = document.createElement('div'); d.className = 'it'; d.innerHTML = '<span></span><button title="Undo this edit">✕</button>'; d.firstChild.textContent = label; d.firstChild.addEventListener('click', zoomTo); d.lastChild.addEventListener('click', () => { del(); setDirty(); drawEdits(); }); list.appendChild(d); };
  edits.paths.forEach((p, n) => { L.polyline(p.pts, { color: '#39e07a', weight: 4, opacity: 0.95 }).addTo(editLayer); item(`➕ ${p.name || 'path'} · ${p.surf} · ${km(lenOf(p.pts))}${p.src && p.src !== 'editor' ? ' · ' + p.src : ''}`, () => map.fitBounds(L.latLngBounds(p.pts), { maxZoom: 18 }), () => edits.paths.splice(n, 1)); });
  edits.walls.forEach((w, n) => { L.polyline(w.pts, { color: '#c0783c', weight: 4 }).addTo(editLayer); item(`🧱 ${w.t} · ${km(lenOf(w.pts))}`, () => map.fitBounds(L.latLngBounds(w.pts), { maxZoom: 18 }), () => edits.walls.splice(n, 1)); });
  edits.remove.forEach((r, n) => { L.circleMarker(r.at, { radius: 7, color: '#ff4d6d', weight: 3, fill: false }).addTo(editLayer); item(`✂ removed${r.note ? ': ' + r.note : ''}`, () => map.setView(r.at, 18), () => edits.remove.splice(n, 1)); });
  edits.oneway.forEach((o, n) => { L.circleMarker(o.at, { radius: 6, color: '#ffd27a', weight: 3, fill: false }).addTo(editLayer); item(o.mode === 'two' ? '⇄ made two-way' : `→ made one-way (${compass(o.at, o.toward)})`, () => map.setView(o.at, 18), () => edits.oneway.splice(n, 1)); });
  edits.shops.forEach((x, n) => { L.marker(x.at, { icon: L.divIcon({ className: 'arrow', html: '🏪', iconSize: [18, 18] }) }).addTo(editLayer); item(`🏪 ${x.name} (${CATS[x.cat] || x.cat})`, () => map.setView(x.at, 19), () => edits.shops.splice(n, 1)); });
  edits.trees.forEach((t, n) => { L.circle(t.at, { radius: t.r, color: '#ff4d6d', weight: 2, fillOpacity: 0.12 }).addTo(editLayer); item(`🌳 trees cleared within ${t.r} m`, () => map.setView(t.at, 19), () => edits.trees.splice(n, 1)); });
  if (!list.children.length) list.innerHTML = '<div class="it"><span>No edits yet.</span></div>';
}

// ---------- inspect ----------
function inspect(ll) {
  const h = nearestEdge(ll, clickReach());
  tmpLayer.clearLayers(); selected = null;
  if (!h) { $('info').textContent = 'Nothing rideable just there.'; return; }
  const e = W.roads.edges[h.i], P = e.pts.map((p) => [p[0], p[1]]); selected = { ...h, e };
  L.polyline(P, { color: '#ff6a1a', weight: 7, opacity: 0.8 }).addTo(tmpLayer);
  const a = P[0], b = P.at(-1), dirA = compass(a, b), dirB = compass(b, a);
  $('info').innerHTML = `<b></b><div class="k"></div><div class="row"></div>`;
  $('info').querySelector('b').textContent = e.name || (e.off ? e.hw : 'unnamed road');
  $('info').querySelector('.k').textContent = `${e.hw}${e.off ? ' · ' + e.surf : ''} · ${km(lenOf(P))} · ${e.oneway ? 'one-way ' + (e.oneway === 1 ? dirA : dirB) : 'two-way'}${e.bridge ? ' · bridge' : ''}${e.tunnel ? ' · tunnel' : ''}`;
  const row = $('info').querySelector('.row'), btn = (t, f) => { const x = document.createElement('button'); x.textContent = t; x.addEventListener('click', () => { f(); setDirty(); drawEdits(); }); row.appendChild(x); };
  // (one of your own edits? the owner 2026-11-17: selecting it didn't say which to delete) a path whose points lie along
  // this stretch: say so, show it, and offer to delete the whole edit
  const mine = edits.paths.findIndex((pp) => P.filter((q) => pp.pts.some((r) => dist(q, r) < 12)).length >= 0.6 * P.length);
  if (mine >= 0) {
    const pp = edits.paths[mine];
    const note = document.createElement('div'); note.className = 'k'; note.style.color = '#39e07a'; note.textContent = `This is one of your edits (${pp.src && pp.src !== 'editor' ? pp.src : 'drawn here'}, ${km(lenOf(pp.pts))}).`; $('info').insertBefore(note, row);
    L.polyline(pp.pts, { color: '#39e07a', weight: 9, opacity: 0.6 }).addTo(tmpLayer);
    btn('✕ Delete this edit', () => { edits.paths.splice(mine, 1); tmpLayer.clearLayers(); $('info').textContent = 'Edit deleted: Save, then Rebuild.'; });
    const it = $('list').children[mine]; if (it) { it.scrollIntoView({ block: 'nearest' }); it.style.outline = '2px solid #39e07a'; setTimeout(() => { it.style.outline = ''; }, 2500); }
  }
  btn('✂ Remove this piece', () => edits.remove.push({ at: h.at, note: e.name || e.hw })); // (one piece, junction to junction; pieces left leading nowhere are pruned at the rebuild)
  if (e.oneway) btn('⇄ Two-way', () => edits.oneway.push({ at: h.at, mode: 'two' }));
  btn(`→ One-way ${dirA}`, () => edits.oneway.push({ at: h.at, mode: 'one', toward: b }));
  btn(`→ One-way ${dirB}`, () => edits.oneway.push({ at: h.at, mode: 'one', toward: a }));
}

// ---------- drawing paths and walls ----------
function opts() {
  const o = $('opts'); o.innerHTML = '';
  if (tool === 'path') o.innerHTML = '<select id="surf"><option value="road">a road (tarmac, like a street)</option><option value="gravel">gravel</option><option value="paved">paved</option><option value="dirt">dirt</option><option value="grass">grass</option></select><input id="pname" placeholder="name (optional)" style="font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);background:rgba(0,0,0,.3);color:#fff"><button id="finish" disabled>Finish (Enter)</button><button id="cancel" disabled>Cancel (Esc)</button>';
  if (tool === 'shop') o.innerHTML = `<input id="sname" placeholder="name, e.g. Golden Fry" style="font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);background:rgba(0,0,0,.3);color:#fff"><select id="scat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`;
  if (tool === 'trees') o.innerHTML = '<select id="trad"><option value="5">clear within 5 m</option><option value="10" selected>clear within 10 m</option><option value="20">clear within 20 m</option></select>';
  if (tool === 'wall') o.innerHTML = '<select id="wt"><option value="wall">brick / stone wall</option><option value="hedge">hedge</option><option value="fence">fence</option></select><button id="finish" disabled>Finish (Enter)</button><button id="cancel" disabled>Cancel (Esc)</button>';
  $('finish')?.addEventListener('click', finish); $('cancel')?.addEventListener('click', cancel);
}
function setTool(t) { cancel(); tool = t; document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); opts(); hint({ path: 'Click along the path; its first and last points join the nearest road or path. Enter to finish.', wall: 'Click along the wall or hedge. Enter to finish.', remove: 'Click the stretch that can\'t be ridden.', ride: 'Click where you want to start riding.', shop: 'Type the name and pick the kind, then click on the building.', trees: 'Zoom right in to see the trees (green dots), then click where there should be none. (Undoing a clear needs a full rebuild to bring the trees back.)', inspect: '' }[t]); }
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
function redrawTmp() { tmpLayer.clearLayers(); if (drawing?.length) { L.polyline(drawing, { color: tool === 'wall' ? '#c0783c' : '#39e07a', weight: 4, dashArray: '6 6' }).addTo(tmpLayer); for (const p of drawing) L.circleMarker(p, { radius: 4, color: '#fff', weight: 2 }).addTo(tmpLayer); } const on = drawing?.length >= 2; if ($('finish')) $('finish').disabled = !on; if ($('cancel')) $('cancel').disabled = !drawing?.length; }
function finish() {
  if (!drawing || drawing.length < 2) return;
  if (tool === 'path') {
    // (the ends snap onto the nearest road or path within 25 m, so the new path joins it)
    for (const k of [0, drawing.length - 1]) { const h = nearestEdge(drawing[k], 25); if (h) drawing[k] = h.at; }
    edits.paths.push({ pts: drawing, surf: $('surf').value, name: $('pname').value.trim(), src: 'editor' });
  } else edits.walls.push({ pts: drawing, t: $('wt').value });
  drawing = null; redrawTmp(); setDirty(); drawEdits();
}
function cancel() { drawing = null; tmpLayer.clearLayers(); if ($('finish')) $('finish').disabled = true; if ($('cancel')) $('cancel').disabled = true; }
document.addEventListener('keydown', (e) => { if (e.target.closest('input, select')) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; } if (e.key === 'Enter') finish(); if (e.key === 'Escape') cancel(); if (e.key === 'Backspace' && drawing?.length) { drawing.pop(); redrawTmp(); } });

map.on('click', (ev) => {
  const ll = [ev.latlng.lat, ev.latlng.lng];
  if (tool === 'inspect') inspect(ll);
  else if (tool === 'path' || tool === 'wall') { (drawing ||= []).push(ll); redrawTmp(); }
  else if (tool === 'remove') { const h = nearestEdge(ll, clickReach()); if (!h) { hint('Nothing rideable just there.'); return; } const e = W.roads.edges[h.i]; edits.remove.push({ at: h.at, note: e.name || e.hw }); setDirty(); drawEdits(); hint(`✂ Removed: ${e.name || e.hw} (${e.hw}). Not the one you meant? Undo it from the list (×).`); }
  else if (tool === 'shop') { const nm = $('sname').value.trim(); if (!nm) { hint('Type the name first.'); return; } edits.shops.push({ at: ll, name: nm, cat: $('scat').value }); $('sname').value = ''; setDirty(); drawEdits(); }
  else if (tool === 'trees') { edits.trees.push({ at: ll, r: +$('trad').value }); setDirty(); drawEdits(); }
  else if (tool === 'ride') {
    try { localStorage.setItem('rw.owPoint.' + id, JSON.stringify({ lat: ll[0], lon: ll[1] })); } catch {}
    tmpLayer.clearLayers(); L.marker(ll).addTo(tmpLayer);
    hint('Start point set: on the setup screen choose "📍 From the map editor" under Start from, then ride (rebuild first if you\'ve changed the roads there).');
  }
});

// ---------- save, rebuild ----------
$('save').addEventListener('click', async () => { $('save').disabled = true; try { const r = await api(`api/mapedits/${id}`, { method: 'PUT', body: JSON.stringify({ edits }) }); setDirty(false); hint(`Saved: ${r.counts.paths} paths, ${r.counts.remove} removed, ${r.counts.oneway} one-way changes, ${r.counts.walls} walls, ${r.counts.shops} shops, ${r.counts.trees} tree clearings. Press Rebuild to put them into the world.`); } catch (e) { $('save').disabled = false; hint('Not saved: ' + e.message); } });
async function poll() {
  try { const s = await api(`api/mapedits/${id}/rebuild`); if (s.state === 'running') { $('state').textContent = `rebuilding: ${s.step}…`; setTimeout(poll, 1500); return; } $('rebuild').disabled = false; if (s.state === 'done') { $('state').textContent = 'rebuilt ✓'; hint('Rebuilt: riders get the new world the next time they load it. Reloading the map…'); await load(); } else if (s.state === 'failed') { $('state').textContent = 'rebuild failed'; hint('The rebuild failed: ' + (s.log || []).slice(-2).join(' / ')); } } catch (e) { setTimeout(poll, 3000); }
}
$('rebuild').addEventListener('click', async () => { if (dirty && !confirm('Rebuild without saving the latest edits?')) return; $('rebuild').disabled = true; try { await api(`api/mapedits/${id}/rebuild`, { method: 'POST' }); $('state').textContent = 'rebuilding…'; setTimeout(poll, 1500); } catch (e) { $('rebuild').disabled = false; hint('Couldn\'t start: ' + e.message); } });

async function load() {
  hint('Loading the world…');
  const [w, e] = await Promise.all([fetch(`api/world/${id}`).then((r) => r.json()), api(`api/mapedits/${id}`)]);
  W = w; edits = { paths: [], remove: [], oneway: [], walls: [], shops: [], trees: [], ...(e.edits || {}) };
  $('wname').textContent = W.build?.name || id;
  if (!map._edge) { worldEdge(W, map); map._edge = true; }
  drawNetwork(); arrowsByZoom(); drawEdits(); drawTrees(); setDirty(false); hint('');
  if (!map._fitted) { const b = W.roads.box; map.fitBounds([[b.s, b.w], [b.n, b.e]]); map._fitted = true; }
  if (e.rebuild?.state === 'running') { $('rebuild').disabled = true; poll(); }
}
$('undo')?.addEventListener('click', undo);
setTool('inspect');
load().catch((err) => hint('Couldn\'t load: ' + err.message + ' (admins only)'));
