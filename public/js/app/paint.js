// Painted ground (2026-11-15, the owner: "build bromsgrove in pure 3d"): the open world's ground drawn from the map
// instead of the satellite photo, so the whole world is one consistent, artificial look (Zwift style) on the real
// hills. A Cesium imagery layer over the open world's square (outside it the photo carries on): each tile is painted on
// a canvas from the world file: land use (build.mjs `land`: farmland, gardens, parks, pitches, car parks, woods,
// water...), railways, pavements and roads, roofs and tree canopies (so the distance, beyond the 3D squares, reads the
// same). Every texture is made here (noise, stripes), scaled to ground metres so it doesn't swim between zoom levels.
// G (or Advanced → Painted ground) switches back to the photo to compare.
import { C, state, store, toast } from './core.js';
import { satellite, viewer } from './scenery.js';
import { drawTile, prepare, getData, pavingTex, SIZE } from './paintcore.js';
export { pavingTex };

export const paint = { layer: null, on: true };

// ---------- painters: tiles painted off the main thread (2026-11-23) ----------
// Measured in London riding at 36 km/h (headless): the road showed a coarser level than it settles at for 25-65% of
// the time 10-100 m ahead, tiles took up to 51 ms each to paint on the main thread (inside Cesium's few ms a frame of
// tile loading, so they queued, and each one cost the ride a frame), and after a jump the road took 3.4-4.6 s to
// sharpen. Now 1-3 workers paint (Cesium's requests first, newest first), the tiles the road ahead will need are
// painted before Cesium asks (prepaintAhead), and recent tiles are kept (Cesium drops and re-asks for tiles as the
// view changes). Without Worker / OffscreenCanvas support it paints on the page as before.
const pool = { workers: [], free: [], queue: [], jobs: new Map(), cache: new Map(), max: 96, seq: 0, ok: false, timer: 0 };
function stopPainters() {
  for (const w of pool.workers) w.terminate();
  for (const j of pool.jobs.values()) j.fail?.(new Error('painters stopped'));
  Object.assign(pool, { workers: [], free: [], queue: [], jobs: new Map(), cache: new Map(), pending: new Map(), ok: false });
  clearInterval(pool.timer); pool.timer = 0;
}
function startPainters() {
  stopPainters();
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof OffscreenCanvas.prototype.transferToImageBitmap !== 'function') return;
  const mobile = state.gpu?.tier === 'mobile';
  const n = Math.max(1, Math.min(mobile ? 2 : 3, (navigator.hardwareConcurrency || 4) - 2));
  pool.max = mobile ? 32 : 96;
  try {
    const D = getData();
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./paintworker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => done(w, e.data);
      w.onerror = (e) => { console.warn('painter failed: painting on the page instead', e.message); stopPainters(); };
      w.postMessage({ t: 'data', D });
      pool.workers.push(w); pool.free.push(w);
    }
    pool.ok = true;
    pool.timer = setInterval(prepaintAhead, 400);
  } catch (e) { console.warn('painters', e); stopPainters(); }
}
function done(w, m) {
  const j = pool.jobs.get(m.id); pool.jobs.delete(m.id);
  pool.free.push(w);
  if (j) {
    if (m.bmp) { remember(j.key, m.bmp); j.ok?.(m.bmp); } else { console.warn('paint tile', m.err); j.fail?.(new Error(m.err)); }
    pool.pending?.delete(j.key);
  }
  dispatch();
}
function remember(key, bmp) {
  pool.cache.delete(key); pool.cache.set(key, bmp);
  while (pool.cache.size > pool.max) pool.cache.delete(pool.cache.keys().next().value); // (not closed: Cesium may still be uploading it; the GC frees it)
}
function dispatch() {
  while (pool.free.length && pool.queue.length) {
    // Cesium's own requests before painting ahead; newest first within each (the view has moved on from older ones)
    let k = -1;
    for (let i = pool.queue.length - 1; i >= 0; i--) if (k < 0 || pool.queue[i].pri > pool.queue[k].pri) k = i;
    const j = pool.queue.splice(k, 1)[0], w = pool.free.pop(), id = ++pool.seq;
    pool.jobs.set(id, j);
    w.postMessage({ t: 'tile', id, w: j.r[0], s: j.r[1], e: j.r[2], n: j.r[3] });
  }
}
function degRect(scheme, x, y, level) { const r = scheme.tileXYToRectangle(x, y, level); return [C.Math.toDegrees(r.west), C.Math.toDegrees(r.south), C.Math.toDegrees(r.east), C.Math.toDegrees(r.north)]; }
// a tile: from the cache, or the job already on its way (raised to Cesium's priority), or a new job
function tileFor(scheme, x, y, level, pri) {
  const key = level + '/' + x + '/' + y;
  const hit = pool.cache.get(key); if (hit) { if (pri) remember(key, hit); return Promise.resolve(hit); }
  pool.pending ||= new Map();
  const p = pool.pending.get(key);
  if (p) { if (pri) for (const j of pool.queue) if (j.key === key) j.pri = Math.max(j.pri, pri); return p.promise; }
  if (!pri && pool.queue.filter((j) => !j.pri).length > 48) return null; // (painting ahead never piles up)
  const j = { key, r: degRect(scheme, x, y, level), pri };
  j.promise = new Promise((ok, fail) => { j.ok = ok; j.fail = fail; });
  j.promise.catch(() => {});
  pool.pending.set(key, j); pool.queue.push(j);
  dispatch();
  return j.promise;
}
// the tiles the road ahead will want, painted before Cesium asks: the level each distance settles at (measured: 20-21
// within ~12 m, 19 to 50 m, 18 to 100 m, 17 to 200 m, 16 beyond), along the next 300 m (an open world's route runs to
// the next junction; past it the painting waits for the choice)
async function prepaintAhead() {
  if (!pool.ok || !paint.layer || !paint.on || document.hidden) return;
  const { route } = await import('./core.js');
  if (!route?.at || !route.opts?.open) return;
  const prov = paint.layer.imageryProvider, sch = prov.tilingScheme, seen = new Set();
  for (let a = -20; a <= 300; a += 12) {
    const d = Math.max(0, Math.min(route.length, state.dist + a)), p = route.at(d), c = C.Cartographic.fromDegrees(p.lon, p.lat);
    const A = Math.abs(a), levels = A <= 12 ? [20, 21] : A <= 50 ? [19] : A <= 100 ? [18] : A <= 200 ? [17] : [16];
    for (const L of levels) {
      if (L > prov.maximumLevel) continue;
      const t = sch.positionToTileXY(c, L), key = L + '/' + t.x + '/' + t.y;
      if (seen.has(key)) continue; seen.add(key);
      tileFor(sch, t.x, t.y, L, 0);
    }
  }
}

// ---------- the Cesium imagery provider ----------
class PaintProvider { // (laptops, basic / mobile GPUs: paint one level less, ~4x fewer tiles to draw)
  constructor(rect) {
    this.tilingScheme = new C.WebMercatorTilingScheme(); this.rectangle = rect; this.tileWidth = SIZE; this.tileHeight = SIZE;
    this.minimumLevel = 10; this.maximumLevel = /^(basic|mobile|software)$/.test(state.gpu?.tier) ? 20 : 21; this.errorEvent = new C.Event(); this.credit = undefined; this.hasAlphaChannel = true;
    this.tileDiscardPolicy = undefined; this.proxy = undefined; this.ready = true; this.readyPromise = Promise.resolve(true);
  }
  getTileCredits() { return undefined; }
  requestImage(x, y, level) {
    if (pool.ok) return tileFor(this.tilingScheme, x, y, level, 1);
    const [w, s, e, n] = degRect(this.tilingScheme, x, y, level); return Promise.resolve(drawTile(w, s, e, n));
  }
  pickFeatures() { return undefined; }
}

export function removePaint() { stopPainters(); if (paint.layer && viewer) viewer.imageryLayers.remove(paint.layer, true); paint.layer = null; state.paintOn = false; }
// at Load scenery, once the open world's file is in (world.js)
export function paintGround(W) {
  removePaint();
  if (!viewer || !W?.land?.length || !W.roads) return;
  prepare(W);
  startPainters();
  const b = W.roads.box;
  paint.layer = viewer.imageryLayers.addImageryProvider(new PaintProvider(C.Rectangle.fromDegrees(b.w, b.s, b.e, b.n)));
  paint.on = store.get('paint', '1') === '1';
  paint.layer.show = paint.on;
  state.paintOn = paint.on;
}
export function togglePaint(on = !paint.on) {
  paint.on = on; store.set('paint', on ? '1' : '0');
  if (paint.layer) paint.layer.show = on;
  satellite(!on); // (the photo underneath: only loaded when asked for)
  state.paintOn = on && !!paint.layer;
  const cb = document.getElementById('cfg-paint'); if (cb) cb.checked = on;
  if (state.lite) toast(on ? '🎨 Painted ground' : '🛰 Satellite photo', 1800);
}
export function initPaint() {
  const sh = document.getElementById('cfg-shadows');
  if (sh) { sh.value = store.get('shadows', 'auto'); sh.addEventListener('change', async () => { store.set('shadows', sh.value); const W = await import('./world.js'); W.setShadows(sh.value === 'on' || (sh.value === 'auto' && (state.gpu?.tier ?? 0) >= 3 && state.gpu?.name !== 'mobile')); }); }
  const cb = document.getElementById('cfg-paint');
  if (cb) { cb.checked = store.get('paint', '1') === '1'; cb.addEventListener('change', () => togglePaint(cb.checked)); }
  window.addEventListener('keydown', (e) => { if ((e.key === 'g' || e.key === 'G') && !e.target.closest?.('input, textarea, select, dialog[open]') && paint.layer) togglePaint(); });
}
