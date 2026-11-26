// The painted ground's drawing (2026-11-23, split out of paint.js): textures, the world file gridded for lookups
// (prepare) and one tile (drawTile). No imports and no DOM, so the same code paints on the page or in a Web Worker
// (paintworker.js, OffscreenCanvas): the owner 2026-11-23, "the road drawing late or staying blurred for too long".
// London's tiles took up to 51 ms each on the main thread, inside Cesium's ~5 ms a frame of tile loading.
export const mkCanvas = (w, h = w) => { if (typeof document === 'undefined') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }; // (the page: a real canvas, which Cesium materials accept)
const R = 6378137;
const mx = (lon) => (lon * Math.PI / 180) * R, my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;

// ---------- textures: small canvases, used as patterns ----------
function noiseTex(base, vary, size = 128, extra) {
  const c = mkCanvas(size);
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // two scales of value noise
  const grid = (n) => Array.from({ length: (n + 1) * (n + 1) }, rnd);
  const g1 = grid(8), g2 = grid(32);
  const at = (G, n, x, y) => { const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, v = (i, j) => G[((j % n) * (n + 1)) + (i % n)]; return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (at(g1, 8, x, y) - 0.5) * 0.6 + (at(g2, 32, x, y) - 0.5) * 0.4 + (rnd() - 0.5) * 0.15, k = (y * size + x) * 4;
    for (let ch = 0; ch < 3; ch++) img.data[k + ch] = Math.max(0, Math.min(255, base[ch] + n * vary));
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (extra) extra(g, size);
  return c;
}
// asphalt: dark, every pixel of aggregate its own shade, a few patches and hairline cracks (one repeat = 8 m)
function asphaltTex() {
  const S = 256, c = mkCanvas(S);
  const g = c.getContext('2d'), img = g.createImageData(S, S); let seed = 99; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < S * S; i++) { const v = 84 + (r() - 0.5) * 26 + (r() < 0.04 ? 30 : 0); img.data[i * 4] = v; img.data[i * 4 + 1] = v + 2; img.data[i * 4 + 2] = v + 6; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 5; k++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)'; g.fillRect(r() * S, r() * S, 20 + r() * 50, 14 + r() * 30); } // patches
  g.strokeStyle = 'rgba(20,20,22,0.45)'; g.lineWidth = 1;
  for (let k = 0; k < 4; k++) { let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); for (let n = 0; n < 8; n++) { x += (r() - 0.5) * 22; y += (r() - 0.3) * 14; g.lineTo(x, y); } g.stroke(); } // cracks
  return c;
}
// paving slabs, 0.6 m square, each a slightly different shade, dark joints (one repeat = 2.4 m: 4 x 4 slabs)
export function pavingTex() {
  const S = 256, q = S / 4, c = mkCanvas(S);
  const g = c.getContext('2d'); let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#8f8b84'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 182 + (r() - 0.5) * 18; g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.fillRect(i * q + 2, j * q + 2, q - 4, q - 4);
    for (let n = 0; n < 160; n++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'; g.fillRect(i * q + 2 + r() * (q - 5), j * q + 2 + r() * (q - 5), 2, 2); }
  }
  return c;
}
// grass tufts: short blades in lighter and darker greens on a transparent canvas, drawn over green land close up
function tuftTex() {
  const S = 256, c = mkCanvas(S); const g = c.getContext('2d');
  let sd = 4242; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, l = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 1.4, k = r();
    g.strokeStyle = k < 0.5 ? `rgba(40,80,25,${0.25 + r() * 0.3})` : `rgba(170,210,110,${0.2 + r() * 0.3})`; g.lineWidth = 1 + r();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 60; i++) { const x = r() * S, y = r() * S, rad = 6 + r() * 14, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(${r() < 0.5 ? '30,60,20' : '190,215,120'},0.18)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); } // clumps
  return c;
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const stripes = (col, w, gap) => (g, s) => { g.fillStyle = col; for (let x = 0; x < s; x += w + gap) g.fillRect(x, 0, w, s); };
  TEX = {
    grass: noiseTex([112, 160, 74], 40),
    city: noiseTex([150, 146, 138], 20), // (London: York stone / concrete paving where Bromsgrove has grass)
    tufts: tuftTex(),
    farmland: noiseTex([150, 168, 86], 34, 128, stripes('rgba(90,110,40,0.18)', 3, 5)),
    farmland2: noiseTex([120, 150, 70], 30, 128, stripes('rgba(60,90,30,0.16)', 2, 6)),
    residential: noiseTex([128, 166, 96], 46),
    park: noiseTex([104, 166, 70], 32),
    pitch: noiseTex([92, 168, 62], 18, 128, stripes('rgba(255,255,255,0.08)', 16, 16)),
    golf: noiseTex([120, 178, 80], 22),
    wood: noiseTex([60, 100, 50], 50),
    scrub: noiseTex([96, 124, 62], 50),
    water: noiseTex([72, 122, 168], 18),
    river: noiseTex([107, 106, 82], 14), riverShire: noiseTex([70, 98, 90], 14), // (= world.js waterAreas' tones)
    parking: noiseTex([122, 125, 130], 22),
    retail: noiseTex([178, 172, 160], 24),
    industrial: noiseTex([165, 160, 150], 26),
    civic: noiseTex([170, 174, 156], 24),
    cemetery: noiseTex([118, 150, 92], 30),
    allotments: noiseTex([128, 146, 78], 46, 128, stripes('rgba(110,80,50,0.25)', 4, 8)),
    orchard: noiseTex([126, 160, 76], 36),
    playground: noiseTex([170, 120, 90], 30),
    pavement: pavingTex(), // (2026-11-16, towards Zwift's look: slabs, darker grainy asphalt)
    road: asphaltTex(),
    // paths and tracks (build.mjs surf). (2026-11-20: grass_t and paved sat after a mid-line // comment, so they never
    // existed and those paths fell back to the field grass: every tarmac cycle path and paved footpath was green)
    gravel: noiseTex([150, 116, 92], 34), // (gravel / compacted: tan)
    dirt: noiseTex([112, 86, 64], 38), // (earth bridleways, tracks: the towpath's red-brown, the owner's video)
    grass_t: noiseTex([138, 142, 92], 40), // (grass-surfaced paths: worn, paler and browner than the fields; a muddy line down the middle)
    paved: noiseTex([156, 154, 149], 22), // (paved footpaths and paths: light grey)
    concrete: noiseTex([172, 168, 160], 16, 128, stripes('rgba(90,88,84,0.35)', 1, 64)), // (paved farm tracks: concrete slabs with joints)
  };
  return TEX;
}
// how big one texture repeat is on the ground (metres)
const REPEAT = { gravel: 3, dirt: 4, grass_t: 4, paved: 4, concrete: 5, tufts: 4, farmland: 40, farmland2: 40, pitch: 64, allotments: 24, water: 40, river: 40, riverShire: 40, wood: 30, road: 8, pavement: 2.4, default: 24 };

// ---------- the data, in Web Mercator metres, gridded for fast lookup ----------
let D = null;
export const setData = (d) => { D = d; };
export const getData = () => D;
export function prepare(W) {
  const box = W.roads.box, cellM = 400;
  const P = (pts) => pts.map(([la, lo]) => [mx(lo), my(la)]);
  const land = [], lines = [], roads = [], roofs = [], trees = [], water = [];
  for (const a of W.water || []) if (!a.bridge) water.push({ P: P(a.pts), w: a.w, t: a.t, lv: !!a.lv }); // (an aqueduct isn't painted on the valley floor) // (canals, rivers, streams: build.mjs; lv: drawn in 3D by world.js)
  const ORDER = ['farmland', 'grass', 'golf', 'orchard', 'allotments', 'residential', 'retail', 'industrial', 'civic', 'cemetery', 'park', 'pitch', 'playground', 'parking', 'scrub', 'wetland', 'wood', 'water'];
  for (const a of W.land || []) {
    if (a.t === 'rail') { lines.push({ t: 'rail', P: P(a.pts) }); continue; }
    const o = ORDER.indexOf(a.t); if (o < 0) continue;
    // (a water area with its own 3D surface at the water's level, world.js waterAreas: painted in that surface's colour, not
    // blue: where the bank's ground rises through the surface the blue showed as saw-teeth along both banks, and a distant
    // tile's simplified Thames outline could spill a blue wedge inland; the owner's London reports 2026-11-22)
    const t = a.t === 'water' && Number.isFinite(a.lv) ? (W.flavour === 'shire' ? 'riverShire' : 'river') : a.t;
    land.push({ t, o, P: P(a.pts), alt: (a.pts.length * 7 + Math.round(a.pts[0][0] * 1e5)) % 2 });
  }
  land.sort((a, b) => a.o - b.o);
  const WID = { trunk: 8, trunk_link: 6, primary: 7.5, primary_link: 6, secondary: 7, secondary_link: 6, tertiary: 6.5, tertiary_link: 5.5, unclassified: 5, residential: 5.5, living_street: 4.5, cycleway: 3, track: 3, bridleway: 2.4, path: 1.8, footway: 2 };
  const PAVED = /^(primary|secondary|tertiary|residential|living_street|trunk)/;
  // pavements only along town roads: residential streets, or bigger roads with buildings close by (not country lanes)
  const near = new Set(); for (const b of W.buildings) { const [la, lo] = b.pts[0]; near.add(Math.floor(mx(lo) / 60) + ',' + Math.floor(my(la) / 60)); }
  // (2026-11-24) buildings along at least half the way, not one anywhere near it: a farmhouse by a country lane gave the
  // whole lane pavements (the owner). OSM's sidewalk tag (build.mjs e.sw) wins wherever it's given
  const town = (pts) => { let n = 0, hit = 0; pts.forEach(([la, lo], k) => { if (k % 3) return; n++; if ([[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].some(([i, j]) => near.has((Math.floor(mx(lo) / 60) + i) + ',' + (Math.floor(my(la) / 60) + j)))) hit++; }); return n > 0 && hit / n >= 0.5; };
  for (const e of W.roads.edges) roads.push({ P: P(e.pts), w: e.w || WID[e.hw] || 5, surf: e.off ? e.surf || 'dirt' : null, hw: e.hw, nodraw: !!e.deckModel, pave: !e.off && (e.sw ? e.sw === 'y' : /^(residential|living_street)$/.test(e.hw) || ((PAVED.test(e.hw) || e.hw === 'unclassified') && e.hw !== 'trunk' && town(e.pts))) }); // (residential streets always have pavements: the owner; paths and tracks never)
  // motorways (drawn only, 2026-11-21): painted on the ground for the distance, but not over their bridges nor within 25 m
  // of a bridge end (the ground there is lowered for the road passing under: the painted carriageways showed as wide
  // tarmac beside the lane, "slip roads on the Kidderminster Road?"); the 3D strips (world.js) carry them there
  { const ends = (W.motorways || []).filter((m) => m.bridge).flatMap((m) => [m.pts[0], m.pts[m.pts.length - 1]]);
    const nearEnd = (q) => ends.some((e) => Math.hypot((q[0] - e[0]) * 110540, (q[1] - e[1]) * 69000) < 25);
    for (const m of W.motorways || []) { if (m.bridge) continue; let run = []; const flush = () => { if (run.length >= 2) roads.push({ P: P(run), w: m.w, surf: null, hw: 'motorway', pave: false }); run = []; }; for (const q of m.pts) { if (nearEnd(q)) flush(); else run.push(q); } flush(); } }
  // centre dashes stop at the through road's edge (the owner 2026-11-16: "side road markings shouldn't continue into the
  // main road"): at each junction of 3+ roads the through pair is the best-ranked straightest (as world.js), the others'
  // dash lines are cut back by the through road's half-width + 1 m (r.D, the dash path; Mercator units = m / k)
  { const RANK = { trunk: 7, primary: 6, secondary: 5, tertiary: 4, unclassified: 3, residential: 3, living_street: 2 }, rank = (hw) => (RANK[String(hw).replace('_link', '')] || 2) - (/_link$/.test(hw) ? 1 : 0);
    const kk = Math.cos((((box.s + box.n) / 2) * Math.PI) / 180), ends = new Map(), cut = new Map();
    const dirOf = (Q) => { let k = 1; while (k < Q.length - 1 && Math.hypot(Q[k][0] - Q[0][0], Q[k][1] - Q[0][1]) * kk < 8) k++; const dx = Q[k][0] - Q[0][0], dy = Q[k][1] - Q[0][1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
    W.roads.edges.forEach((e, i) => { const r = roads[i]; for (const [j, end, Q] of [[e.a, 'a', r.P], [e.b, 'b', [...r.P].reverse()]]) { if (!ends.has(j)) ends.set(j, []); ends.get(j).push({ i, end, D: dirOf(Q), w: r.w, rk: rank(e.hw) }); } });
    for (const list of ends.values()) {
      if (list.length < 3) continue;
      let best = null;
      for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) { const dot = list[u].D[0] * list[v].D[0] + list[u].D[1] * list[v].D[1]; if (dot > -0.5) continue; const sc = (list[u].rk + list[v].rk) * 10 - dot * 6; if (!best || sc > best.sc) best = { u, v, sc }; }
      const hw = best ? Math.max(list[best.u].w, list[best.v].w) / 2 : Math.max(...list.map((q) => q.w)) / 2;
      list.forEach((q, n) => { if (best && (n === best.u || n === best.v)) return; cut.set(q.i + q.end, (hw + 1) / kk); });
    }
    const trimP = (Q, a, b) => { const len = (X) => { let L = 0; for (let k = 1; k < X.length; k++) L += Math.hypot(X[k][0] - X[k - 1][0], X[k][1] - X[k - 1][1]); return L; }; const T = len(Q), out = []; let acc = 0; for (let k = 1; k < Q.length; k++) { const p = Q[k - 1], q = Q[k], L = Math.hypot(q[0] - p[0], q[1] - p[1]), lo = Math.max(a, acc), hi = Math.min(acc + L, T - b); if (hi > lo && L) { const f = (t) => [p[0] + ((q[0] - p[0]) * (t - acc)) / L, p[1] + ((q[1] - p[1]) * (t - acc)) / L]; if (!out.length) out.push(f(lo)); out.push(f(hi)); } acc += L; } return out; };
    roads.forEach((r, i) => { const a = cut.get(i + 'a') || 0, b = cut.get(i + 'b') || 0; r.D = a || b ? trimP(r.P, a, b) : r.P; });
  }
  for (const b of W.buildings) roofs.push({ P: P(b.pts), c: (b.pts.length * 13 + Math.round(b.pts[0][1] * 1e5)) % 4 });
  for (const [la, lo, h, cr] of W.lidarTrees || []) trees.push([mx(lo), my(la), cr || 3]);
  const grid = new Map(), key = (i, j) => i + ',' + j;
  const add = (kind, idx, P) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } for (let i = Math.floor(x0 / cellM); i <= Math.floor(x1 / cellM); i++) for (let j = Math.floor(y0 / cellM); j <= Math.floor(y1 / cellM); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, { land: [], lines: [], roads: [], roofs: [], trees: [], water: [] }); grid.get(k)[kind].push(idx); } };
  land.forEach((a, i) => add('land', i, a.P)); lines.forEach((a, i) => add('lines', i, a.P)); roads.forEach((a, i) => add('roads', i, a.P)); water.forEach((a, i) => add('water', i, a.P)); roofs.forEach((a, i) => add('roofs', i, a.P));
  trees.forEach((t, i) => { const k = key(Math.floor(t[0] / cellM), Math.floor(t[1] / cellM)); if (!grid.has(k)) grid.set(k, { land: [], lines: [], roads: [], roofs: [], trees: [], water: [] }); grid.get(k).trees.push(i); });
  // k: ground metres per Mercator metre here (cos of the latitude), for widths and texture sizes
  D = { water, box: { x0: mx(box.w), x1: mx(box.e), y0: my(box.s), y1: my(box.n) }, land, lines, roads, roofs, trees, grid, cellM, k: Math.cos((((box.s + box.n) / 2) * Math.PI) / 180), city: W.flavour === 'london' }; // (city: paved ground, London)
}
const CITYPAVED = /^(residential|retail|industrial|civic)$/; // (in a city these are streets and yards, not lawns)
function gather(kind, x0, y0, x1, y1) {
  const out = new Set();
  for (let i = Math.floor(x0 / D.cellM); i <= Math.floor(x1 / D.cellM); i++) for (let j = Math.floor(y0 / D.cellM); j <= Math.floor(y1 / D.cellM); j++) for (const n of D.grid.get(i + ',' + j)?.[kind] || []) out.add(n);
  return [...out].sort((a, b) => a - b);
}

// ---------- one tile ----------
export const SIZE = 512; // (2026-11-16: 256 px tiles were blurry at riding height)
export function drawTile(w, s, e, n) { // (degrees)
  const T = textures();
  const x0 = mx(w), x1 = mx(e), y0 = my(s), y1 = my(n);
  const mpp = (x1 - x0) / SIZE; // Mercator metres per pixel (ground metres x cos(lat), close enough for textures)
  const c = mkCanvas(SIZE);
  const g = c.getContext('2d');
  const px = (x) => ((x - x0) / (x1 - x0)) * SIZE, py = (y) => ((y1 - y) / (y1 - y0)) * SIZE;
  const path = (P) => { g.beginPath(); P.forEach(([x, y], k) => (k ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y)))); };
  // patterns fixed to the ground (the same phase in every tile, so no seams), one repeat = REPEAT ground metres
  const pat = (name) => { const p = g.createPattern(T[name] || T.grass, 'repeat'), per = (REPEAT[name] || REPEAT.default) / D.k / mpp, sc = per / (T[name] || T.grass).width; p.setTransform(new DOMMatrix().translate(((-x0 / mpp) % per), ((y1 / mpp) % per)).scale(sc)); return p; };
  // only inside the open world's square (outside, the photo shows through)
  g.save(); g.beginPath(); g.rect(px(D.box.x0), py(D.box.y1), px(D.box.x1) - px(D.box.x0), py(D.box.y0) - py(D.box.y1)); g.clip();
  g.fillStyle = pat(D.city ? 'city' : 'grass'); g.fillRect(0, 0, SIZE, SIZE);
  const m = 40 * mpp + 30; // (a margin, for road widths and canopies over the tile's edge)
  // green land first, then tufts of grass over it close up (2026-11-16: smooth paint looked flat next to Zwift's grass),
  // then the hard land (car parks, water, yards) over the tufts
  const landNow = gather('land', x0 - m, y0 - m, x1 + m, y1 + m), GREEN = /^(grass|farmland|residential|park|golf|cemetery|orchard|allotments|pitch|scrub|wetland|wood)$/;
  const fillLand = (a) => { path(a.P); g.closePath(); g.fillStyle = pat(D.city && CITYPAVED.test(a.t) ? 'city' : a.t === 'farmland' && a.alt ? 'farmland2' : a.t === 'wetland' ? 'scrub' : a.t); g.fill(); if (a.t === 'pitch' && mpp < 0.6) { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1, 0.12 / mpp); g.stroke(); } };
  const isGreen = (t) => GREEN.test(t) && !(D.city && CITYPAVED.test(t));
  for (const i of landNow) if (isGreen(D.land[i].t)) fillLand(D.land[i]);
  if (mpp < 0.25) { g.globalAlpha = Math.min(1, (0.25 - mpp) / 0.12); g.fillStyle = pat('tufts'); g.fillRect(0, 0, SIZE, SIZE); g.globalAlpha = 1; }
  for (const i of landNow) if (!isGreen(D.land[i].t)) fillLand(D.land[i]);
  // canals, rivers and streams: water with a darker edge (the towpath runs beside the canal as a path)
  for (const i of gather('water', x0 - m, y0 - m, x1 + m, y1 + m)) { const a = D.water[i]; path(a.P); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#6d6a55'; g.lineWidth = Math.max(1, (a.w * 0.85 + 0.6) / D.k / mpp); g.stroke(); g.strokeStyle = a.lv ? '#3b3a2c' : pat('water'); g.lineWidth = Math.max(1, (a.w * 0.85) / D.k / mpp); g.stroke(); } // (under 3D water: the dark bed, not blue: a blue band showed along the bank, the owner 2026-11-17) // (as wide as the 3D water, world.js; a muddy edge, not a blue one)
  // railways: ballast and a rail pair
  for (const i of gather('lines', x0 - m, y0 - m, x1 + m, y1 + m)) { const a = D.lines[i]; path(a.P); g.strokeStyle = '#7d7468'; g.lineWidth = Math.max(1, 4 / mpp); g.lineJoin = 'round'; g.stroke(); if (mpp < 0.5) { g.strokeStyle = '#5b5552'; g.lineWidth = Math.max(1, 1.6 / mpp); g.setLineDash([Math.max(1, 0.4 / mpp), Math.max(1, 0.6 / mpp)]); g.stroke(); g.setLineDash([]); } }
  const roads = gather('roads', x0 - m, y0 - m, x1 + m, y1 + m);
  // pavements (town roads), then the roads (the 3D roads lie on top near the rider; further off these are the roads)
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = pat('pavement');
  for (const i of roads) { const r = D.roads[i]; if (!r.pave) continue; path(r.P); g.lineWidth = Math.max(1, (r.w + 3.6) / D.k / mpp); g.stroke(); }
  if (mpp < 0.8) { // the kerbs: light concrete stones 15 cm wide, a dark gutter along their foot
    g.strokeStyle = '#c4c1ba'; for (const i of roads) { const r = D.roads[i]; if (!r.pave) continue; path(r.P); g.lineWidth = Math.max(1, (r.w + 0.6) / D.k / mpp); g.stroke(); }
    g.strokeStyle = '#3c3e42'; for (const i of roads) { const r = D.roads[i]; if (!r.pave) continue; path(r.P); g.lineWidth = Math.max(1, (r.w + 0.12) / D.k / mpp); g.stroke(); }
  }
  // the roads (the owner 2026-11-15: junctions "beautiful and flowing like zwift"): painted in passes, so every road's
  // white edge lines are covered where another road's tarmac meets them and run round the junction's corners; round
  // joins and caps make the corners curve. Lanes under 6 m have no edge lines, under 5.5 m no centre line.
  const M = (m) => Math.max(1, m / D.k / mpp);
  if (mpp < 1.2) { g.strokeStyle = '#e9e9e4'; for (const i of roads) { const r = D.roads[i]; if (r.w < 5 || r.pave || r.surf) continue; path(r.P); g.lineWidth = M(r.w); g.stroke(); } } // (none along kerbs)
  // paths and tracks first (roads cross over them), each by its surface and what it is: tarmac cycle paths as tarmac,
  // paved footpaths light grey, paved farm tracks concrete, gravel tan, earth brown, grass worn with a muddy middle
  const pathLook = (r) => r.surf === 'paved' ? (r.hw === 'cycleway' ? 'road' : r.hw === 'track' ? 'concrete' : 'paved') : r.surf === 'grass' ? 'grass_t' : r.surf;
  for (const i of roads) { const r = D.roads[i]; if (!r.surf || r.nodraw) continue; path(r.P); g.strokeStyle = pat(pathLook(r)); g.lineWidth = M(r.w); g.stroke();
    if (r.surf === 'grass' && mpp < 1.5) { g.strokeStyle = pat('dirt'); g.globalAlpha = 0.55; g.lineWidth = M(r.w * 0.35); g.stroke(); g.globalAlpha = 1; } }
  g.strokeStyle = pat('road');
  for (const i of roads) { const r = D.roads[i]; if (r.surf) continue; path(r.P); g.lineWidth = M(r.w >= 5 && !r.pave && mpp < 1.2 ? r.w - 0.5 : r.w); g.stroke(); }
  if (mpp < 0.6) { // centre lines: 2 m dashes, 4 m gaps (as the ridden road had)
    g.strokeStyle = '#ecece6'; g.lineCap = 'butt'; g.setLineDash([M(2), M(4)]);
    for (const i of roads) { const r = D.roads[i]; if (r.w < 4.5 || r.surf || (r.D || r.P).length < 2) continue; path(r.D || r.P); g.lineWidth = M(0.13); g.lineDashOffset = 0; g.stroke(); } // (every road but the narrowest: the owner wanted markings on the lanes)
    g.setLineDash([]); g.lineCap = 'round';
  }
  // roofs and tree canopies (what's seen from afar; near the rider the 3D ones stand on them)
  const ROOF = ['#8a5a48', '#6e6a68', '#9a6b52', '#7a7470'];
  for (const i of gather('roofs', x0 - m, y0 - m, x1 + m, y1 + m)) { const b = D.roofs[i]; path(b.P); g.closePath(); g.fillStyle = ROOF[b.c]; g.fill(); }
  if (mpp < 4) for (const i of gather('trees', x0 - m, y0 - m, x1 + m, y1 + m)) {
    // (as soft shadows: as green discs they read as big blobs under the 3D trees, the owner)
    const [x, y, cr] = D.trees[i], r = Math.max(0.8, (cr * 0.9 / D.k) / mpp), o = (cr * 0.5 / D.k) / mpp;
    g.beginPath(); g.arc(px(x) + o, py(y) - o * 0.6, r, 0, Math.PI * 2); g.fillStyle = 'rgba(20,40,15,0.22)'; g.fill();
  }
  g.restore();
  return c;
}

