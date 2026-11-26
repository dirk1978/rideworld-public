// Landmarks: our own game-style 3D buildings on a route (route.opts.landmarks, from the route's entry in
// routes.json), e.g. the Far de Formentor lighthouse and café at the end of Cap. Google's melted copy is clipped
// away under the model's footprints; near the finish a camera stands on the café steps watching the rider come in,
// and after the finish the camera circles the lighthouse.
//   { model: 'formentor', lat, lon, alt,      the model's origin (Blender X east, Y north, Z up; alt on Google's scale)
//     heading: 0,                              degrees clockwise from north (the models are built facing north)
//     clips: [[[x, y], ...], ...],             footprints to cut out of Google's mesh, metres east / north of the origin
//     cam: { x, y, z, from: 250 },             the arrival camera (metres from the origin), used within `from` m of it
//     orbit: { z: 12, range: 70, height: 25 } } the finish orbit: around the origin, looking at z m up
import { C, route, state } from './core.js';
import { viewer } from './scenery.js';

export const landmarks = { list: [], models: [], polys: [], world: [] };
const toRad = (d) => (d * Math.PI) / 180;

// metres east / north of a landmark (turned by its heading) -> lon / lat
function lonLat(L, x, y) {
  const h = toRad(L.heading || 0), e = x * Math.cos(h) + y * Math.sin(h), n = -x * Math.sin(h) + y * Math.cos(h);
  return [L.lon + e / (111320 * Math.cos(toRad(L.lat))), L.lat + n / 110540];
}
const place = (L, x, y, z) => { const [lon, lat] = lonLat(L, x, y); return C.Cartesian3.fromDegrees(lon, lat, L.alt + z); };

export async function loadLandmarks() {
  clearLandmarks();
  landmarks.list = route?.opts?.landmarks || [];
  for (const L of landmarks.list) {
    try {
      const m = await C.Model.fromGltfAsync({
        url: `models/landmarks/${L.model}.glb`,
        forwardAxis: C.Axis.X, // Blender X east / Y north as built (the default, +Z forward, turned it a quarter turn)
        modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(L.lon, L.lat, L.alt), new C.HeadingPitchRoll(toRad(L.heading || 0), 0, 0)),
      });
      viewer.scene.primitives.add(m);
      landmarks.models.push(m);
    } catch (e) { console.warn('landmark', L.model, e); }
    for (const ring of L.clips || []) landmarks.polys.push(new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray(ring.flatMap(([x, y]) => lonLat(L, x, y))) }));
  }
}

// An open world's own landmarks (world.data.landmarks, tools/openworld/landmarks.mjs; London 2026-11-17): models from
// public/models/<dir>/<model>.glb at the LIDAR ground (`ground`, the file's datum) + the terrain offset. They go in
// landmarks.models too, so road surveys and camera checks look through them (Tower Bridge's walkways over the road).
export function addWorldLandmarks(list, off, alive = () => true) {
  clearWorldLandmarks();
  landmarks.wlist = (list || []).map((L) => ({ L, model: null, loading: false })); landmarks.woff = off; landmarks.walive = alive;
  updateWorldLandmarks(true);
}
// (2026-11-17) only the landmarks within 3 km of the rider are loaded (gone again past 3.8 km): all 21 of London's at once
// took enough graphics memory to lose the WebGL context on a 1 GB card. Called about once a second from world.js.
let lastWL = 0;
export function updateWorldLandmarks(force = false) {
  if (!landmarks.wlist?.length || !route?.at) return;
  const now = performance.now(); if (!force && now - lastWL < 1000) return; lastWL = now;
  const p = route.at(state.dist), off = landmarks.woff, alive = landmarks.walive;
  for (const w of landmarks.wlist) {
    const L = w.L, d = Math.hypot((p.lon - L.lon) * 111320 * Math.cos(toRad(L.lat)), (p.lat - L.lat) * 110540);
    const R = L.near || 3000; // (a landmark's own reach: Tardebigge's 36 lock models load within 700 m, 2026-11-21)
    if (d < R && !w.model && !w.loading && !w.failed) {
      w.loading = true;
      C.Model.fromGltfAsync({
        url: `models/${L.dir || 'london'}/${L.model}.glb`, forwardAxis: C.Axis.X,
        modelMatrix: C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(L.lon, L.lat, L.ground + (Number.isFinite(off) ? off : 0) + (L.lift || 0)), new C.HeadingPitchRoll(toRad(L.heading || 0), 0, 0)),
        shadows: C.ShadowMode.ENABLED,
      }).then((m) => {
        w.loading = false;
        if (!alive() || !landmarks.wlist?.includes(w)) { m.destroy(); return; }
        viewer.scene.primitives.add(m); w.model = m; landmarks.models.push(m); landmarks.world.push(m);
      }).catch((e) => { w.loading = false; w.failed = true; console.warn('world landmark', L.model, e); });
    } else if (d > R * 1.27 && w.model) {
      const m = w.model; w.model = null; viewer.scene.primitives.remove(m);
      for (const arr of [landmarks.models, landmarks.world]) { const k = arr.indexOf(m); if (k >= 0) arr.splice(k, 1); }
    }
  }
}
export function clearWorldLandmarks() {
  landmarks.wlist = [];
  for (const m of landmarks.world || []) { viewer?.scene.primitives.remove(m); const k = landmarks.models.indexOf(m); if (k >= 0) landmarks.models.splice(k, 1); }
  landmarks.world = [];
}
export function clearLandmarks() {
  for (const m of landmarks.models) viewer?.scene.primitives.remove(m);
  const coll = state.tileset?.clippingPolygons;
  for (const p of landmarks.polys) if (coll?.contains(p)) coll.remove(p);
  landmarks.models = landmarks.models.filter((m) => landmarks.world.includes(m)); landmarks.polys = []; landmarks.list = []; // (an open world's own landmarks stay: world.js owns them)
}

// straight-line metres from the rider to a point near a landmark
function metresTo(L, x, y) {
  const p = route.at(state.dist), [lon, lat] = lonLat(L, x, y);
  return Math.hypot((p.lon - lon) * 111320 * Math.cos(toRad(lat)), (p.lat - lat) * 110540);
}

// every frame: the clips only while we're within 1.5 km (any clip costs the graphics card on every tile), and kept
// in place when the clean road rebuilds its own
export function updateLandmarks() {
  if (!landmarks.polys.length || !state.tileset) return;
  const near = landmarks.list.some((L) => metresTo(L, 0, 0) < 1500);
  if (!state.tileset.clippingPolygons) state.tileset.clippingPolygons = new C.ClippingPolygonCollection();
  const coll = state.tileset.clippingPolygons;
  for (const p of landmarks.polys) {
    if (near && !coll.contains(p)) coll.add(p);
    else if (!near && coll.contains(p)) coll.remove(p);
  }
}

// The landmark camera, if one applies now: { pos, look } (Cartesian3), else null.
//  - after the finish (or arriving at the end), within 500 m: circling the landmark, ~50 s a lap
//  - coming in to the end (the last 600 m of the route), within cam.from of the camera: on the café steps
export function landmarkCamera(riderTarget, now) {
  for (const L of landmarks.list) {
    if (state.finished && L.orbit && metresTo(L, 0, 0) < 500) {
      const o = L.orbit, a = (now / 1000) * ((2 * Math.PI) / 50);
      return { pos: place(L, Math.cos(a) * o.range, Math.sin(a) * o.range, o.height), look: place(L, 0, 0, o.z) };
    }
    if (L.cam && !state.finished && route.length - state.dist < 600 && metresTo(L, L.cam.x, L.cam.y) < (L.cam.from || 250)) {
      return { pos: place(L, L.cam.x, L.cam.y, L.cam.z), look: riderTarget };
    }
  }
  return null;
}

// ---- open worlds: a fly-by of each named landmark as the rider passes (2026-11-22, the owner: "could the camera move to show
// a few seconds pan of each landmark as we pass it? I'm riding past them without a clue") ----
// A landmark with a `title` (tools/openworld/landmarks/<world>.json, passed on by landmarks.mjs) gets a 7 s shot when the
// rider comes within reach of it (by its size): the camera glides off, sweeps 70 degrees round it from the rider's side,
// framed by the model's bounding sphere, with its name and a line about it in a banner; then glides back. Once per
// landmark in 20 minutes. Advanced → "Landmark fly-bys" (rw.lmShots, on by default). camera.js asks every frame.
const FB_MS = 7000, FB_AGAIN = 20 * 60000;
const fbSeen = new Map(); let fb = null, fbCheck = 0;
function banner(L) {
  let el = document.getElementById('lm-title');
  if (!el) { el = document.createElement('div'); el.id = 'lm-title'; document.body.appendChild(el); }
  if (!L) { el.classList.remove('on'); return; }
  el.innerHTML = ''; const h = document.createElement('b'); h.textContent = L.title; el.appendChild(h);
  if (L.blurb) { const s = document.createElement('span'); s.textContent = L.blurb; el.appendChild(s); }
  el.classList.add('on');
}
export function flybyActive() { return !!fb; }
export function flybyCamera(riderPos, now, allowed) {
  let on = true; try { on = localStorage.getItem('rw.lmShots') !== 'off'; } catch {}
  if (fb && (now - fb.t0 > FB_MS || !allowed || !on)) { fb = null; banner(null); }
  if (!on || !allowed || !landmarks.wlist?.length) return null;
  if (!fb && now - fbCheck > 400 && state.riding) {
    fbCheck = now;
    for (const w of landmarks.wlist) {
      const L = w.L; if (!L.title || !w.model || w.model.ready === false) continue;
      const bs = w.model.boundingSphere; if (!bs || !(bs.radius > 0)) continue;
      if (now - (fbSeen.get(L.title) ?? -1e12) < FB_AGAIN) continue;
      // (along the ground: a tall model's sphere centre is high in the air, and riding under the London Eye never counted)
      const ca = C.Cartographic.fromCartesian(bs.center), cb = C.Cartographic.fromCartesian(riderPos);
      const d = Math.hypot((ca.latitude - cb.latitude) * 6371000, (ca.longitude - cb.longitude) * 6371000 * Math.cos(cb.latitude));
      if (d < Math.max(70, Math.min(bs.radius, 120) * 1.2 + 40)) { fb = { L, t0: now, c: C.Cartesian3.clone(bs.center), r: Math.min(bs.radius, 120), rp: C.Cartesian3.clone(riderPos) }; fbSeen.set(L.title, now); banner(L); break; }
    }
  }
  if (!fb) return null;
  const t = Math.min(1, (now - fb.t0) / FB_MS), e = 0.5 - 0.5 * Math.cos(Math.PI * t);   // (eased: slow at both ends)
  const enu = C.Transforms.eastNorthUpToFixedFrame(fb.c), inv = C.Matrix4.inverse(enu, new C.Matrix4());
  const rl = C.Matrix4.multiplyByPoint(inv, fb.rp, new C.Cartesian3());
  const a = Math.atan2(rl.y, rl.x) - 0.6 + 1.2 * e;
  const R = Math.max(32, fb.r * 2.1), H = Math.max(10, fb.r * 0.65);
  return { pos: C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(Math.cos(a) * R, Math.sin(a) * R, H), new C.Cartesian3()),
    look: C.Matrix4.multiplyByPoint(enu, new C.Cartesian3(0, 0, fb.r * 0.1), new C.Cartesian3()) };
}
export function initFlyby() { // (Advanced → Landmark fly-bys, per browser)
  const cb = document.getElementById('cfg-lmshots'); if (!cb) return;
  try { cb.checked = localStorage.getItem('rw.lmShots') !== 'off'; } catch {}
  cb.addEventListener('change', () => { try { localStorage.setItem('rw.lmShots', cb.checked ? 'on' : 'off'); } catch {} });
}

// under a canal bridge model on the towpath (2026-11-22, the owner: "still not enough room for the bike under the bridge": the
// arch has 2.6 m over the path, but the camera behind and above went through the brickwork): within 10 m of a canal bridge
// landmark (canal.mjs: model bridge-N in canal/...) and lower than its deck (riding over it on the lane doesn't count).
// camera.js then uses the low road camera close behind
export function underCanalBridge(lat, lon, h) {
  for (const w of landmarks.wlist || []) {
    const L = w.L; if (!/^bridge-/.test(L.model) || !/^canal\//.test(L.dir || '')) continue;
    const d = Math.hypot((L.lat - lat) * 110540, (L.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180));
    if (d < 10 && h < L.ground + (Number.isFinite(landmarks.woff) ? landmarks.woff : 0) + 2.5) return true;
  }
  return false;
}
