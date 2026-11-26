// The 3D world: the Cesium viewer and Google tiles, waiting for scenery, the route line, the quality controller
// hook, and the start / finish arches.
import { Quality, detectGpu } from '../quality.js';
import { toRad } from '../route.js';
import { CAMS } from './camera.js';
import { $, C, route, state, toast } from './core.js';
import { loadRiderModel } from './model.js';
import { SURVEY_STEP, groundHeight } from './survey.js';
import { KINDS, rideSegments } from './segments.js';
import { ed } from './editor.js';
import { cleanRoad } from './cleanroad.js';
import { currentInfo } from './setup.js';
import { ow } from './openworld.js';
export let viewer = null;
export let mode = null; // 'google' | 'ion' | 'lite'

// Lite scenery (2026-11-14, the owner: "anything we could do with the graphics that would allow low performance laptops
// to work smoothly?"). Google's photo-real tiles are nearly all the cost of a frame (millions of triangles, the
// clean road's clipping across them, a render per survey reading). Lite draws Cesium World Terrain with satellite
// imagery instead (ion), and everything else stays: the clean road is cut into the globe (Globe.clippingPolygons),
// the survey reads the terrain's heights on the CPU (survey.js sampleSurface), so road heights, gradients, the trainer,
// cameras, tunnels and earthworks work as before. state.tileset is the globe in Lite: it has the same
// clippingPolygons / tilesLoaded / maximumScreenSpaceError the rest of the app uses. Setting `world` (per browser):
// auto = Lite on software rendering and laptop-class graphics (not phones: they run Google smoothly), full, lite.
export function wantLite() {
  const v = $('cfg-world')?.value || 'auto', rs = currentInfo()?.scenery; // the route's own choice (Edit details)
  if (rs === 'generated') return true; // towns: never Google's 3D (2026-11-14)
  if (v !== 'auto') return v === 'lite';
  try {
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const g = gl ? detectGpu(gl) : null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!g && (g.software || (g.tier <= 1 && g.name !== 'mobile'));
  } catch { return false; }
}

// Resolves once the 3D tiles in view have finished loading (two checks in a row), or after timeoutMs
export function waitForScenery(timeoutMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let calm = 0;
    const check = () => {
      const ts = state.tileset;
      calm = !ts || ts.tilesLoaded ? calm + 1 : 0;
      if (calm >= 2 || performance.now() - t0 > timeoutMs) resolve();
      else setTimeout(check, 400);
    };
    setTimeout(check, 800);
  });
}

// Cesium ion's satellite imagery, only when it's needed (2026-11-25: the ion account went over its 1,000 imagery sessions
// a month, one per page load, though the open worlds' painted ground covers it all): a route in the Lite view with no
// painted ground, or G (paint off) to compare with the photo. Loaded once, then shown / hidden.
let satLayer = null;
export function satellite(on) {
  if (!viewer || mode !== 'lite') return;
  if (on && !satLayer) { satLayer = C.ImageryLayer.fromProviderAsync(C.createWorldImageryAsync({ style: C.IonWorldImageryStyle.AERIAL })); viewer.imageryLayers.add(satLayer, 0); }
  if (satLayer) satLayer.show = on;
}
export async function buildViewer() {
  const googleKey = $('cfg-google').value.trim();
  const ionToken = $('cfg-ion').value.trim();
  const common = {
    baseLayerPicker: false, geocoder: false, timeline: false, animation: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
    selectionIndicator: false, requestRenderMode: false,
    // Resolution is managed by adaptResolution(): sharp on a fast GPU, scaled down to keep the frame rate up
    useBrowserRecommendedResolution: false, msaaSamples: 2,
  };
  if (ionToken) C.Ion.defaultAccessToken = ionToken;

  if (wantLite()) {
    mode = 'lite';
    viewer = new C.Viewer('globe', { ...common, msaaSamples: 1, terrainProvider: await C.createWorldTerrainAsync(),
      baseLayer: false }); // (no satellite photo unless something needs it: satellite() below)
    state.gpu = detectGpu(viewer.scene.context._gl);
    const g = viewer.scene.globe;
    g.depthTestAgainstTerrain = true;
    g.maximumScreenSpaceError = 2;
    g.tileCacheSize = 1000; // (was 300: tiles were dropped and re-made as the detail changed, the owner 2026-11-16 "the road and tiles keep disappearing" on a laptop)
    g.baseColor = C.Color.fromCssColorString('#6f9a4e'); // (a tile still waiting for its painted ground shows grass, not black)
    g.preloadSiblings = false;
    // (2026-11-23, the road sharpening late) Cesium spends ~5 ms a frame on tile loading; on a capable card give it 10 ms
    // and 30 tiles in flight, so the near ground refines sooner (London headless: the road 25 m ahead coarse 35% -> 9% of
    // the time riding). Laptops and phones keep Cesium's defaults (their frames have no time to spare).
    if (/^(mid|high)$/.test(state.gpu?.tier)) { g._surface._loadQueueTimeSlice = 10; g.loadingDescendantLimit = 30; }
    g.showGroundAtmosphere = false; // (a haze pass over every tile; the sky keeps its own)
    state.tileset = g; // (see above: clipping, tilesLoaded and detail through the same property)
    state.lite = true;
    state.cleanRoad = true; // (Lite's road is the clean road: the imagery's own roads are flat paint)
  } else if (googleKey) {
    mode = 'google';
    viewer = new C.Viewer('globe', { ...common, globe: false, baseLayer: false, skyAtmosphere: new C.SkyAtmosphere() });
    state.gpu = detectGpu(viewer.scene.context._gl);
    const tileset = await C.createGooglePhotorealistic3DTileset(
      { key: googleKey, onlyUsingWithGoogleGeocoder: true },
      // the cache follows the graphics tier (256 MB on software rendering up to 1 GB on a gaming card)
      { maximumScreenSpaceError: 16, cacheBytes: state.gpu.cacheMB * 1024 * 1024, ...(state.gpu.overflowMB ? { maximumCacheOverflowBytes: state.gpu.overflowMB * 1024 * 1024 } : {}), preloadFlightDestinations: true },
    );
    viewer.scene.primitives.add(tileset);
    state.tileset = tileset;
  } else {
    mode = 'ion';
    viewer = new C.Viewer('globe', { ...common, terrainProvider: await C.createWorldTerrainAsync() });
    state.gpu = detectGpu(viewer.scene.context._gl);
    viewer.scene.globe.depthTestAgainstTerrain = true;
    state.buildings = viewer.scene.primitives.add(await C.createOsmBuildingsAsync());
  }
  viewer.scene.screenSpaceCameraController.enableInputs = false; // the ride drives the camera
  // Cesium catches errors in its render loop itself, stops drawing and shows its own panel; none of that reached the
  // server log (2026-11-05, the owner: "a GL array error" scrolling in the simulator). Report it with the stack and where
  // the ride was, then restart drawing (up to 3 times a page; a fault every frame would loop otherwise).
  viewer.scene.showRenderLoopErrors = false;
  let restarts = 0;
  viewer.scene.renderError.addEventListener((scene, err) => {
    const where = `d=${Math.round(state.dist || 0)} cam=${state.cam} sim=${$('cfg-sim')?.checked} | ` + String(err?.stack || '').split('\n').slice(0, 6).join(' | ');
    window.rwReport?.('render: ' + (err?.message || err), where);
    if (restarts++ < 3) { setTimeout(() => { viewer.useDefaultRenderLoop = true; }, 500); toast('The 3D view hit an error and was restarted.', 4000); }
    else toast('The 3D view stopped after repeated errors: reload the page (it has been reported).', 10000);
  });
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00012;

  // Route line: only the next few hundred metres, drawn just above the road. Draping the whole route over
  // the 3D tiles (clampToGround) costs a lot of frame rate.
  // positions as a CallbackProperty: replacing them made Cesium rebuild the line in the background, so it vanished
  // for a moment every 15 m (the "flashing")
  state.linePts = [];
  state.line = viewer.entities.add({
    polyline: {
      positions: new C.CallbackProperty(() => state.linePts, false), width: 6, arcType: C.ArcType.NONE, material: C.Color.fromCssColorString('#ff6a1a').withAlpha(0.6),
      depthFailMaterial: C.Color.fromCssColorString('#ff6a1a').withAlpha(0.3), // still visible where the road surface hides it
    },
  });
  const mountainous = () => { const p = route?.profile || []; let lo = Infinity, hi = -Infinity; for (const e of p) { if (e < lo) lo = e; if (e > hi) hi = e; } return hi - lo > 400; };
  // Detail (distant scenery) and resolution (pixels drawn), adjusted to this computer as we ride: see quality.js
  state.quality = new Quality(viewer, state.gpu, { detail: $('cfg-quality').value, target: $('cfg-target').value }, (sse) => {
    // Mountain routes (over 400 m of height in them) never coarser than 8 (the owner 2026-10-27, Stelvio 6 km: "where has
    // the tile gone?"): in a steep valley Google's coarse tiles sit tens of metres above the real ground, above the road
    // and the camera, and seen from underneath they aren't drawn: black patches. 12 still left them, 8 filled them;
    // it costs ~30% of the frames there, which the quality controller takes back as resolution.
    if (state.lite) state.tileset.maximumScreenSpaceError = Math.max(1.5, sse / 8); // (the globe counts in finer units)
    else if (state.tileset) state.tileset.maximumScreenSpaceError = mountainous() ? Math.min(sse, 8) : sse;
    else {
      viewer.scene.globe.maximumScreenSpaceError = Math.max(1, sse / 8);
      if (state.buildings) state.buildings.maximumScreenSpaceError = sse;
    }
  });
  $('perf').title = state.quality.title();
  if (state.gpu.software) toast('Chrome is drawing the 3D view in software, so it will be slow. Check chrome://gpu (in chrome://flags, set the ANGLE backend to D3D11 or Default).', 12000);
  // Light the rider as if at midday (Google's scenery has its own baked-in lighting)
  viewer.clock.currentTime = C.JulianDate.fromIso8601(new Date().toISOString().slice(0, 10) + 'T12:00:00Z');
  viewer.clock.shouldAnimate = false;
  await loadRiderModel();
  state.rider = viewer.entities.add({
    position: C.Cartesian3.fromDegrees(route.pts[0].lon, route.pts[0].lat, 0),
    point: { pixelSize: 14, color: C.Color.fromCssColorString('#ff6a1a'), outlineColor: C.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });
}

export function updateLine() {
  // on the clean road the road itself shows the way; the line stays for the route editor and Google's own road
  state.line.show = !state.film && !(state.cleanRoad && !ed.on) && !route.opts?.open; // never in Film mode, nor in an open world (the roads are drawn)
  if (!state.line.show) return;
  if (Math.abs(state.dist - state.lineAt) < 15 && state.survey.version === state.lineOff) return;
  state.lineAt = state.dist;
  state.lineOff = state.survey.version;
  const pts = [];
  for (let d = state.dist; d <= Math.min(route.length, state.dist + 400); d += 5) {
    const p = route.at(d);
    pts.push(C.Cartesian3.fromDegrees(p.lon, p.lat, groundHeight(d) + 0.4));
  }
  state.linePts = pts.length > 1 ? pts : [];
}

// Frame rate, resolution and detail are handled by state.quality (quality.js); this just keeps the pill up to date
export function adaptResolution(now) {
  const q = state.quality;
  q.frame(now);
  if (q.fps && now - (state.pillAt || 0) > 1000) { state.pillAt = now; $('perf').textContent = q.label(); $('perf').title = q.title(); }
}

// ---------- start and finish ----------
// The finish line sits 40 m before the end of the route so there's room to roll to a stop after it.
export const RUNOUT = 40;
export const finishAt = () => (route.opts?.open ? Infinity : route.length > RUNOUT * 5 ? route.length - RUNOUT : route.length); // (open world: no finish line, see openworld.js)

// Banner image: chequered strips either side of the word, drawn on a canvas
export function bannerImage(text) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
  const sq = 20;
  for (const y0 of [0, c.height - sq * 2]) for (let x = 0; x < c.width; x += sq) for (let y = 0; y < 2; y++) {
    g.fillStyle = ((x / sq + y) % 2) ? '#fff' : '#111'; g.fillRect(x, y0 + y * sq, sq, sq);
  }
  g.fillStyle = '#ff6a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 78; // shrink long names (segments) to fit the banner
  do { g.font = `900 ${size}px system-ui, sans-serif`; } while (g.measureText(text).width > c.width - 60 && (size -= 4) > 30);
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  return c;
}

// An arch across the road at distance d: two posts and a banner, 9 m wide, 4.6 m tall
export function buildArch(d, text) {
  const p = route.at(d), h = route.heading(d), base = groundHeight(d);
  // as wide as the clean road's cut (+0.6 m) when it's on, so trees beside the road can't hide the banner (the owner
  // 2026-10-26: "signs can be obscured easily"); 9 m across otherwise
  const half = state.cleanRoad ? cleanRoad.width / 2 + 0.6 : 4.5, ex = Math.cos(h), ny = -Math.sin(h); // to the rider's right
  const side = (s) => [p.lon + (ex * s) / (111320 * Math.cos(toRad(p.lat))), p.lat + (ny * s) / 110540];
  const [l, r] = [side(-half), side(half)];
  const ents = [];
  ents.d = d;
  ents.alpha = 1; // faded out while it would sit between the camera and the rider (see updateArches)
  const postColour = C.Color.fromCssColorString('#e8e8e8');
  for (const [lon, lat] of [l, r]) {
    ents.push(viewer.entities.add({
      position: C.Cartesian3.fromDegrees(lon, lat, base + 2.3),
      cylinder: { length: 4.6, topRadius: 0.14, bottomRadius: 0.16,
        material: new C.ColorMaterialProperty(new C.CallbackProperty(() => postColour.withAlpha(ents.alpha), false)) },
    }));
  }
  // two faces 6 cm apart: left-to-right reads correctly coming towards it, right-to-left from behind
  const fwd = (pt, m) => [pt[0] + (Math.sin(h) * m) / (111320 * Math.cos(toRad(p.lat))), pt[1] + (Math.cos(h) * m) / 110540];
  const img = bannerImage(text);
  ents.faces = [];
  for (const pts of [[...l, ...r], [...fwd(r, 0.06), ...fwd(l, 0.06)]]) {
    ents.faces.push(viewer.entities.add({
      wall: {
        positions: C.Cartesian3.fromDegreesArray(pts),
        minimumHeights: [base + 3.4, base + 3.4], maximumHeights: [base + 4.6, base + 4.6],
        // see-through only while fading: a translucent banner shows the other face's mirrored text through it
        material: new C.ImageMaterialProperty({ image: img, transparent: new C.CallbackProperty(() => ents.alpha < 0.999, false),
          color: new C.CallbackProperty(() => C.Color.WHITE.withAlpha(ents.alpha), false) }),
      },
    }));
  }
  ents.push(...ents.faces);
  return ents;
}

// Arches are built once the road under them has been measured, so they stand on the real road
export function updateArches() {
  const surveyed = state.survey.raw.length * SURVEY_STEP;
  const segArches = rideSegments().filter((s) => s.id !== 'full').flatMap((s) => [
    { key: `seg:${s.id}:s`, d: s.startM, text: `${(KINDS[s.kind] || KINDS.segment).word} · ${s.name.toUpperCase()}` },
    { key: `seg:${s.id}:e`, d: s.endM, text: `${s.name.toUpperCase()} · FINISH` }]);
  const start = state.legs || state.noStartArch ? [] : [{ key: 'start', d: Math.min(8, route.length / 4), text: 'START' }]; // none behind us after turning round (or once a route's start arch has gone)
  for (const a of [...start, { key: 'finish', d: finishAt(), text: 'FINISH' }, ...segArches]) {
    if (state.arches[a.key] || surveyed < a.d + 20 && surveyed < route.length - 1) continue;
    if (a.key !== 'start' && state.dist < a.d - 600) continue; // only build arches coming up
    state.arches[a.key] = buildArch(a.d, a.text);
  }
  // a pre-plotted open-world route (the owner 2026-11-20: "the start banner still says start when you're riding towards it on
  // lap 2 or the finish ... after you finish it's still there"): the start arch reads what the next time we reach that spot
  // will be (LAP 2, LAP 3 ... or FINISH), and goes once the route is complete or it won't be passed again
  const sa = state.arches.start;
  if (sa && ow.on && (ow.ride || ow.rideDone)) {
    const R = ow.ride, near = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 111320 * Math.cos(toRad(a.lat))) < 80;
    let text = null;
    if (R) {
      const here = route.at(state.dist), v0 = R.via[0];
      if (R.next <= 1 && near(here, { lat: v0.lat, lon: v0.lon }) && state.dist < 400) text = 'START';
      else { const k = R.via.findIndex((v, i) => i >= R.next && near(v, v0)); if (k >= 0) text = k === R.via.length - 1 ? 'FINISH' : `LAP ${1 + R.via.filter((v, i) => i > 0 && i <= k && near(v, v0)).length}`; }
    }
    if (!text) { for (const e of sa) viewer.entities.remove(e); delete state.arches.start; state.noStartArch = true; }
    else if (sa.text !== text) { sa.text = text; const img = bannerImage(text); for (const f of sa.faces) f.wall.material.image = img; }
  }
  // Riding through an arch, the chase camera (up to ~26 m back) ends up behind it and the banner fills the view:
  // fade it out as the rider goes under, and back in once the camera has passed it too
  const back = (state.camRange ?? CAMS[state.cam].range) + 6;
  for (const ents of Object.values(state.arches)) {
    const past = state.dist - ents.d;
    const alpha = past < -2 ? 1 : past < 3 ? (3 - past) / 5 : past < back ? 0 : Math.min(1, (past - back) / 5);
    if (alpha === ents.alpha) continue;
    ents.alpha = alpha;
    for (const e of ents) e.show = alpha > 0.01;
    // while fading, only the face towards the camera: the front one as we ride in, the back one once the camera is past
    if (alpha < 0.999) { ents.faces[0].show &&= past < back; ents.faces[1].show &&= past >= back; }
  }
}

// start-up: Detail / Priority applied mid-ride (main.js runs these in order)
export async function initQualityControls() {
  // Detail / priority changed (also mid-ride from the setup screen): apply straight away
  for (const id of ['cfg-quality', 'cfg-target']) $(id).addEventListener('change', () => {
    if (state.quality) { state.quality.set({ detail: $('cfg-quality').value, target: $('cfg-target').value }); $('perf').title = state.quality.title(); }
  });
}
