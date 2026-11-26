// "Find the road" (route editor): OpenStreetMap's line, so the route and the clean road, can sit several metres off
// the road in Google's imagery (Sa Calobra: 5-11 m in places; the owner saw the markings "drift left"). This flies the
// camera straight down along the whole route, samples the imagery across the line every 10 m and finds the asphalt
// band: plain grey, smooth across, the same all along, where scrub and rock are textured and coloured. The offsets
// become a slide of the map (roadband.js fitSlide), saved with the route as its centring (route.js applyCentre), on top
// of any earlier centring.
// Prototype numbers (Sa Calobra 2.89 mi): road found 5.5 m right going down, 5.25 m left at the same spot coming up.
import { $, C, api, route, state, toast } from './core.js';
import { viewer } from './scenery.js';
import { remotes } from './riders.js';
import { currentInfo } from './setup.js';
import { ed } from './editor.js';
import { MIN_CONTRAST, findBand, fitSlide } from '../roadband.js';

const STEP = 10;          // a reading every 10 m
const FRAME = 40;         // one look-down per 40 m (four readings from each)
const HIGH = 60;          // metres above the ground (about 7 cm a pixel on a 900 px view)
const HALF = 16, DX = 0.25; // across the line: -16 .. +16 m every 25 cm
let running = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// own things off the picture while looking: route line, riders, arches, the clean road (state.cleanRoad off)
function hideOwn() {
  if (state.line) state.line.show = false;
  if (state.model) state.model.show = false;
  if (ed.line) ed.line.show = false;
  for (const r of remotes.values()) { if (r.model) r.model.show = false; if (r.label) r.label.show = false; }
  for (const ents of Object.values(state.arches || {})) for (const e of ents) e.show = false;
}

// the frame as drawn, once the tiles under it have loaded
async function look(at) {
  const sc = viewer.scene, q = route.at(at);
  const g = (await sc.sampleHeightMostDetailed([C.Cartographic.fromDegrees(q.lon, q.lat)]))[0]?.height ?? route.smoothEle(at);
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(q.lon, q.lat, g + HIGH), orientation: { heading: route.heading(at), pitch: -Math.PI / 2, roll: 0 } });
  for (let k = 0; k < 80 && !state.tileset.tilesLoaded; k++) await wait(100);
  await wait(250);
  const canvas = await new Promise((res) => {
    let n = 0;
    const off = sc.postRender.addEventListener(() => {
      if (++n < 3) return;
      off();
      const c = document.createElement('canvas');
      c.width = viewer.canvas.width; c.height = viewer.canvas.height;
      c.getContext('2d').drawImage(viewer.canvas, 0, 0);
      res(c);
    });
  });
  return { g, canvas, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data };
}

// colours across the line at d: rows every 1.5 m along (d +- 6 m), each -HALF..HALF m across
function sampleAcross(frame, d) {
  const sc = viewer.scene, { canvas, data, g } = frame, rows = [];
  for (let a = -6; a <= 6; a += 1.5) {
    const q = route.at(d + a), h = route.tangent(d + a), kx = 111320 * Math.cos((q.lat * Math.PI) / 180), row = [];
    for (let x = -HALF; x <= HALF + 1e-6; x += DX) {
      const s = C.SceneTransforms.worldToDrawingBufferCoordinates(sc, C.Cartesian3.fromDegrees(q.lon + (Math.cos(h) * x) / kx, q.lat + (-Math.sin(h) * x) / 110540, g));
      const px = s && Math.round(s.x), py = s && Math.round(s.y);
      if (!s || px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) { row.push(null); continue; }
      const i = (py * canvas.width + px) * 4;
      row.push([data[i], data[i + 1], data[i + 2]]);
    }
    rows.push(row);
  }
  return rows;
}

async function run() {
  const info = currentInfo();
  if (!info) { toast('Pick one of your saved routes first.'); return; }
  const keep = { cleanRoad: state.cleanRoad, riding: state.riding, scale: viewer.resolutionScale };
  running = { stop: false };
  state.riding = false; state.camHold = true; state.cleanRoad = false;
  state.quality.paused = true; viewer.resolutionScale = 1;
  const hide = viewer.scene.preRender.addEventListener(hideOwn);
  const msg = (t) => { $('ed-find-msg').textContent = t; };
  const L = route.length, n = Math.floor(L / STEP) + 1, found = new Array(n).fill(null);
  const inTunnel = (d) => (route.zones || []).some(([f, t, type]) => type === 'tunnel' && d >= f - 10 && d <= t + 10);
  $('ed-find').textContent = 'Stop';
  try {
    for (let c = FRAME / 2; c < L + FRAME / 2 && !running.stop; c += FRAME) {
      const frame = await look(Math.min(c, L));
      for (let d = c - FRAME / 2 + STEP / 2; d < c + FRAME / 2; d += STEP) {
        const i = Math.round(d / STEP);
        if (i < 0 || i >= n || inTunnel(d)) continue;
        found[i] = findBand(sampleAcross(frame, i * STEP));
      }
      msg(`Looking for the road… ${Math.min(100, Math.round((c / L) * 100))}%`);
    }
    if (running.stop) { msg('Stopped: nothing changed.'); return; }
    const good = found.filter((f) => f && f.contrast >= MIN_CONTRAST).length;
    const right = [], radius = [];
    for (let i = 0; i < n; i++) {
      const h = route.tangent(i * STEP), k = Math.abs(route.curvature(i * STEP));
      right.push([Math.cos(h), -Math.sin(h)]);
      radius.push(k > 1e-6 ? 1 / k : Infinity);
    }
    state.roadFinder = { found, right, radius }; // for diagnosing (?debug: window.__rw.state.roadFinder)
    const slide = fitSlide(found, right, radius, STEP);
    if (!slide || good < n * 0.15) { msg(`Couldn't see the road clearly enough (${good} of ${n} spots): nothing changed.`); return; }
    // on top of any slide already there (the line we looked along included it), along the whole cleaned route
    const startM = route.startM || 0, old = info.centre?.dx ? info.centre : null, total = Math.floor((L + startM) / STEP) + 1;
    const oldAt = (A, k) => (old ? A[Math.min(A.length - 1, Math.round((k * STEP) / old.step))] || 0 : 0);
    const mine = (A, k) => { const j = Math.round((k * STEP - startM) / STEP); return j >= 0 && j < n ? A[j] : 0; };
    const dx = Array.from({ length: total }, (_, k) => +(oldAt(old?.dx, k) + mine(slide.dx, k)).toFixed(2));
    const dy = Array.from({ length: total }, (_, k) => +(oldAt(old?.dy, k) + mine(slide.dy, k)).toFixed(2));
    const bad = dx.filter((v) => !Number.isFinite(v)).length + dy.filter((v) => !Number.isFinite(v)).length;
    if (bad) { msg(`Something went wrong working out the slide (${bad} bad numbers): nothing changed.`); return; }
    const r = await api(`api/routes/${encodeURIComponent(info.id)}/centre`, { method: 'PUT', body: JSON.stringify({ step: STEP, dx, dy }) });
    info.centre = r.route.centre;
    const moved = slide.dx.map((x, i) => Math.hypot(x, slide.dy[i])).sort((a, b) => a - b);
    msg(`Found the road at ${good} of ${n} spots. Typical slide ${moved[moved.length >> 1].toFixed(1)} m, largest ${moved[moved.length - 1].toFixed(1)} m. Saved: reloading…`);
    try { localStorage.setItem('rw.resume', JSON.stringify({ dist: state.dist, at: Date.now() })); } catch {}
    toast('Road found and saved. Reloading the route…', 4000);
    setTimeout(() => location.reload(), 2500);
  } catch (e) {
    console.error(e);
    msg('Something went wrong: ' + e.message);
  } finally {
    hide();
    state.camHold = false; state.cleanRoad = keep.cleanRoad; state.riding = keep.riding;
    viewer.resolutionScale = keep.scale; state.quality.paused = false;
    $('ed-find').textContent = 'Find the road';
    running = null;
  }
}

async function undo() {
  const info = currentInfo();
  if (!info?.centre) { toast('This route has no road centring.'); return; }
  if (!confirm('Put the route back on its original line (undo "Find the road")?')) return;
  await api(`api/routes/${encodeURIComponent(info.id)}/centre`, { method: 'PUT', body: JSON.stringify({ dx: null }) });
  try { localStorage.setItem('rw.resume', JSON.stringify({ dist: state.dist, at: Date.now() })); } catch {}
  toast('Road centring removed. Reloading…', 3000);
  setTimeout(() => location.reload(), 1500);
}

// After "Find the road" (or Undo) reloads the page: straight back into the ride where you were, editor open. Needs
// Load scenery to be possible without a click (simulator ticked: real sensors must be reconnected by hand first).
async function resume() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem('rw.resume') || 'null'); localStorage.removeItem('rw.resume'); } catch {}
  if (!r || Date.now() - r.at > 120000) return;
  await wait(1500); // the route list loads
  if ($('btn-go-sim').disabled) { toast((r.msg || 'Road centring saved.') + ' Press Simulator to ride it.', 6000); return; }
  $('btn-go-sim').click();
  for (let k = 0; k < 600 && $('hud').classList.contains('hidden'); k++) await wait(200);
  if ($('hud').classList.contains('hidden')) return;
  // Route Studio's "Ride it" sends a full-route km and no editor (studio.js)
  state.dist = Math.max(0, Math.min(route.length - 1, r.km != null ? route.m(r.km) : r.dist));
  await wait(500);
  if (r.editor !== false) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
  toast(r.msg || 'Road centring saved: here it is.', 5000);
}

export async function initRoadFinder() {
  resume().catch((e) => console.warn('resume', e));
  $('ed-find').addEventListener('click', () => { if (running) running.stop = true; else run(); });
  $('ed-find-undo').addEventListener('click', () => undo().catch((e) => toast(e.message)));
}
