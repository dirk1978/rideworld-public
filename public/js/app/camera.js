// Cameras: the views (CAMS), placing the camera each frame (see "the camera, rebuilt 2026-10-26" below) and the Free
// view's drag / scroll controls.
import { $, C, bike, route, state, store, toast } from './core.js';
import { ed } from './editor.js';
import { placeRider, roadPoint } from './model.js';
import { myLateral } from './riders.js';
import { viewer } from './scenery.js';
import { SURVEY_STEP, deckBetween, groundHeight, roadGrade } from './survey.js';
import { landmarkCamera, flybyCamera, underCanalBridge } from './landmarks.js';
import { tubeCamAt } from './tunnels.js';
// Chase frames the rider like Zwift; High chase looks over roadside trees, which Google's 3D tiles render as blobs.
// yaw: degrees the camera swings round from straight behind (negative = to the rider's right, the drive side)
export const CAMS = [
  // Default: where the Free view starts (the owner's favourite: mountains behind the rider), but fixed (2026-10-19)
  { name: 'Default', ahead: 0, range: 20, pitch: -7, lift: 0.9, yaw: 0 }, // (the owner 2026-11-15: 20 m back, 7 degrees down looks best; was 26.5 m / -6)
  { name: 'Chase', ahead: 0, range: 8, pitch: -10, lift: 0.6, yaw: 0 }, // locked on the road behind (viewWants)
  { name: 'High chase', ahead: 4, range: 22, pitch: -19, lift: 1.2, yaw: 0 },
  { name: 'Rear 45°', ahead: 0, range: 6.5, pitch: -9, lift: 0.9, yaw: -45 },
  { name: 'Rider', ahead: 0, range: 0, pitch: 0, lift: 1.65, yaw: 0 }, // first person (viewWants)
  { name: 'Drone', ahead: 0, range: 90, pitch: -32, lift: 1.2, yaw: 0 },
  { name: 'Free', ahead: 0, range: 20, pitch: -7, lift: 0.9, yaw: 0 }, // drag to orbit, scroll to zoom
  // cinematic cameras, for filming (Film mode, F, hides the overlays): they move by themselves
  { name: 'Orbit', ahead: 0, range: 14, pitch: -12, lift: 1, yaw: 0, cine: 'orbit' },   // circles the rider, ~50 s a lap
  { name: 'Sweep', ahead: 10, range: 70, pitch: -22, lift: 1, yaw: 0, cine: 'sweep' },  // high drone, drifting side to side
  { name: 'Fly-by', ahead: 0, range: 0, pitch: 0, lift: 1.1, yaw: 0, cine: 'flyby' },   // fixed by the road; the rider rides past
];
export const FREE = CAMS.findIndex((c) => c.name === 'Free');
// Free is the default view: straight behind, about 26.5 m back (the owner's favourite).
// pitch -6 since 2026-10-16 (was -10): lower, so mountains show behind the rider (the owner, Llanberis Pass)
// While adjusting the Free view, say where it is, so a view someone likes can be made the default
function showFreeNumbers(f) {
  const side = Math.round(f.yaw) ? `, swung ${Math.abs(Math.round(f.yaw))}° to the ${f.yaw < 0 ? 'right' : 'left'}` : '';
  toast(`Free camera: ${Math.round(-f.pitch)}° down, ${f.range.toFixed(1)} m back${side}`, 2500);
}

export const FREE_DEFAULT = { yaw: 0, pitch: -7, range: 20 };
export const FREE_INIT = { ...CAMS[FREE], ...FREE_DEFAULT };
export const resetFree = () => Object.assign(CAMS[FREE], FREE_INIT);

// the rider on the road (normally placeCamera does it; with the camera held by the road finder or the trailer
// director, main.js calls this instead)
export function placeMe(dt) {
  placeRider(dt, roadPoint(state.dist, myLateral(dt)), roadGrade(state.dist));
}

// Slideshow (the owner 2026-10-18): the camera changes to the next view every 30 s, from Default round all of them.
// Since 2026-10-19 it's one of the start views (setup screen), not the default. C / the camera button picks a view and stops it; so does dragging or scrolling
// (that takes the Free view by hand). Paused while the route editor has the camera.
export const SLIDE_MS = 30000;
const SLIDE_SAFE = new Set(['Default', 'Chase', 'High chase', 'Rider']);
// mountain routes only (photoreal, 20 m+ climbing per km, not a highlights route: Alpe d'Huez, Stelvio, Hardknott, Sa
// Calobra, Formentor). In towns walls and trees beside the road would count as hillside too, and they stay as they were
const mountainRoute = () => !!route && !route.opts?.open && !state.lite && !route.pieces && route.gain / (route.length / 1000) >= 20;
// hillside: within 80 m either way, 3+ stations with the ground 2.5-3.5 m beside the road over 2.5 m above it (photoreal
// routes; checked once a second, and it stays "hillside" for 20 s after the last such station so views don't flick back)
function hillside(now) {
  if (!mountainRoute()) return false;
  if (now - (state.hillT || 0) < 1000) return now - (state.hillAt || -1e9) < 20000;
  state.hillT = now;
  const sv = state.survey;
  let n = 0;
  for (let i = Math.max(0, Math.round((state.dist - 80) / SURVEY_STEP)); i <= Math.round((state.dist + 80) / SURVEY_STEP); i++) {
    const e = sv?.edge?.[i];
    if (!e) continue;
    const top = Math.max(...e.filter(Number.isFinite)), road = groundHeight(Math.min(route.length, i * SURVEY_STEP));
    if (top > road + 2.5) n++;
  }
  if (n >= 3) state.hillAt = now;
  return now - (state.hillAt || -1e9) < 20000;
}
function slideshowTick() {
  if (!state.slideshow || ed.on) return;
  const now = performance.now();
  state.slideAt ??= now;
  // (2026-11-26, the owner riding Sa Calobra: "it would be incredible if the camera didn't keep going into the hillside".
  // Only Default, Chase, High chase and Rider look after themselves on a hillside (lift / road-following / first
  // person); Rear 45, Drone, Free and the cinematic views are fixed framings that end up inside the slope. Where the
  // survey has the ground beside the road well above it, the slideshow skips those views, and leaves one at once)
  const steep = hillside(now), unsafe = (i) => steep && !SLIDE_SAFE.has(CAMS[i].name);
  if (now - state.slideAt < SLIDE_MS && !unsafe(state.cam)) return;
  state.slideAt = now;
  let next = (state.cam + 1) % CAMS.length;
  for (let k = 0; k < CAMS.length && unsafe(next); k++) next = (next + 1) % CAMS.length;
  state.cam = next;
  if (state.cam === FREE) resetFree();
  state.flyby = null; state.camRange = undefined; state.camClear = undefined; // each view starts afresh
  showCam();
}

// ---------- the camera, rebuilt 2026-10-26 ----------
// the owner, after riding Alpe d'Huez: "the whole camera system has had so many tweaks it's got many conflicting things".
// A dozen rules (lift over obstacles, closer-not-steeper, the wide view, riding the road, tunnel / low cameras, deck
// tilt, opening swing, shots, landmarks, slideshow) all adjusted the same camera whatever the view, so Chase flew up
// to 31 m, Chase looked down at the road on climbs, "Rider" (25 m back aimed 25 m ahead) ended up over the trees on
// hairpins, and Default looked up from the road below on a 20% ramp. Now each view has ONE behaviour, the extras only
// belong to the views meant to have them, and they take over in a fixed order:
//   1. the route editor (it uses the Free view)
//   2. a landmark's camera, then a route's shots (viewpoints): hard cuts, like TV. Default / High chase / Drone only.
//   3. tunnels, 'use my heights' stretches and a route's lowCam: the low road camera. All but Rider, Chase, Free.
//   4. the view itself:
//      Rider       at the rider's head, looking along the road ahead (so it tilts with the slope). Nothing else.
//      Chase       locked on the road 8 m behind, 2.4 m up, looking at the road 12 m ahead of the rider: it follows the
//                  road round bends and tilts with the gradient (you see the road ahead on a climb). Never lifts.
//      Default     the cinematic one: straight back 26.5 m along the view direction (mountains behind), lifting up to
//                  12 degrees over small obstacles; where it would need more, it rides the road behind instead
//                  (hysteresis); out in open country it sweeps out wide (110 m, 16 degrees down); swings in at the start.
//      High chase  straight back and high; lifts (and comes closer) over obstacles. No wide view, no road-riding.
//      Rear 45, Drone, Free, Orbit, Sweep, Fly-by: their fixed framings (Free by hand), no lift.
// Everything but the hard cuts goes through one smoothing step: the camera's offset from the rider eases towards
// where the view wants it (fast for Rider and Chase, gentler for Default), so a change of rule, view or road height
// can never make it jump. The look point is eased the same way.
const SHOTS = new Set(['Default', 'High chase', 'Drone']);
const LOW_ROAD = (cam) => !['Rider', 'Chase', 'Free'].includes(cam.name);
const EASE = { Rider: 14, Chase: 5, 'Rear 45°': 5, Free: 8 }; // per second; others 2.5
const hprPos = (target, h, p, r) => C.Matrix4.multiplyByPoint(C.Transforms.eastNorthUpToFixedFrame(target),
  new C.Cartesian3(-r * Math.cos(p) * Math.sin(h), -r * Math.cos(p) * Math.cos(h), -r * Math.sin(p)), new C.Cartesian3());
const roadAt = (d, up) => { const q = route.at(Math.max(0, Math.min(route.length, d))); return C.Cartesian3.fromDegrees(q.lon, q.lat, groundHeight(Math.max(0, Math.min(route.length, d))) + up); };
// a point `back` metres behind the rider along the road (before the start: back along the line the road starts on).
// On a tight bend it comes closer, until the straight line to the rider is at least 85% of the way round by road:
// round a hairpin the camera looked across the inside of the bend, through the hillside (Alpe d'Huez)
function behindOnRoad(back, up, floorAt = null) {
  const here = route.at(state.dist), kh = 111320 * Math.cos((here.lat * Math.PI) / 180);
  while (back > 6 && state.dist - back > 0) {
    const q = route.at(state.dist - back);
    if (Math.hypot((q.lon - here.lon) * kh, (q.lat - here.lat) * 110540) >= back * 0.85) break;
    back *= 0.85;
  }
  const d = state.dist - back;
  let z = groundHeight(Math.max(0, d)) + up;
  if (floorAt !== null) z = Math.max(z, groundHeight(floorAt) + up * 0.6); // on a steep ramp, not below the rider's road
  if (d >= 0) { const q = route.at(d); return C.Cartesian3.fromDegrees(q.lon, q.lat, z); }
  const q = route.at(0), h = route.tangent(0), kx = 111320 * Math.cos((q.lat * Math.PI) / 180);
  return C.Cartesian3.fromDegrees(q.lon - (Math.sin(h) * -d) / kx, q.lat - (Math.cos(h) * -d) / 110540, z);
}

export function placeCamera(dt, snap = false) {
  slideshowTick();
  const cam = CAMS[state.cam];
  if (cam.cine === 'orbit') cam.yaw = (cam.yaw + dt * 7) % 360;
  if (cam.cine === 'sweep') cam.yaw = 45 * Math.sin(performance.now() / 7000);
  const targetHeading = route.heading(state.dist);
  if (snap) state.heading = targetHeading;
  else { const diff = Math.atan2(Math.sin(targetHeading - state.heading), Math.cos(targetHeading - state.heading)); state.heading += diff * Math.min(1, dt * 2.5); }
  const rp = route.at(state.dist);
  state.rider.position = C.Cartesian3.fromDegrees(rp.lon, rp.lat, groundHeight(state.dist) + 1.0);
  // the dot only shows while we're under a bridge deck, where the model can't be seen (it shows through everything),
  // or if the 3D rider failed to load (not in the Drone view: the owner, an orange spot on the rider, 2026-10-19)
  state.rider.show = !state.film && (state.model ? cam.name !== 'Rider' && deckBetween(state.dist - 5, state.dist + 5) !== null : cam.name !== 'Rider');
  placeRider(dt, roadPoint(state.dist, myLateral(dt)), roadGrade(state.dist));
  // Cesium's own collision lifted the camera above Google's surface every frame and ours put it back the next
  // (flicker); off everywhere since 2026-10-21
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  // while editing, the camera stays on the route as it was when the editor opened, so a nudged line visibly
  // slides across the road instead of the whole view moving with it
  const tp = (ed.on && ed.base ? ed.base : route).at(state.dist + cam.ahead);
  const target = C.Cartesian3.fromDegrees(tp.lon, tp.lat, groundHeight(state.dist + cam.ahead) + cam.lift);
  const fr = viewer.camera.frustum;
  if (normalFov === null) normalFov = fr.fov;
  if (fr.fov !== normalFov) fr.fov = normalFov;

  // 2. hard cuts: a landmark's camera, a route's shot (the TV zoom keeps the rider about the same size)
  state.vpNoClean = false;
  if (!ed.on && SHOTS.has(cam.name)) {
    const lm = landmarkCamera(target, performance.now());
    if (lm) { cut(lm.pos, lm.look); return; }
    // (open worlds: a fly-by of a named landmark as it's passed, landmarks.js; a glide, not a cut)
    const fly = flybyCamera(target, performance.now(), !!state.lite);
    if (fly) { ease(fly.pos, fly.look, target, 1.4, dt, false); return; }
    const vp = viewpointAt(state.dist, target, dt);
    if (vp) {
      // a shot can ask for Google's own road while it lasts (the Clifton Suspension Bridge from the river below)
      state.vpNoClean = !!vp.noClean;
      fr.fov = vp.fov ?? Math.min(normalFov, Math.max(C.Math.toRadians(7), 2 * Math.atan(vp.frame / C.Cartesian3.distance(vp.pos, vp.look))));
      cut(vp.pos, vp.look);
      return;
    }
  }
  // 3. the low road camera: in and around 3D tunnels, on 'use my heights' stretches (Google's false humps) and a
  // route's lowCam stretches (narrow lanes like the Koppenberg; set by hand: "hills are very random")
  const mine = !route.opts?.open && (route.mine?.() || []).some(([a, b]) => state.dist >= a - 30 && state.dist <= b + 20);
  const low = !state.lite && (route.opts?.lowCam || []).some(([a, b]) => state.dist >= route.m(a) - 20 && state.dist <= route.m(b) + 10);
  let want;
  // (under a canal bridge on the towpath: closer and lower still, inside the arch, landmarks.js)
  const canal = state.lite && LOW_ROAD(cam) && (() => { const p = route.at(state.dist), q = route.at(Math.max(0, state.dist - 6)); return underCanalBridge(p.lat, p.lon, groundHeight(state.dist)) || underCanalBridge(q.lat, q.lon, groundHeight(Math.max(0, state.dist - 6))); })();
  if (canal) {
    want = { pos: behindOnRoad(6, 1.7), look: target };
    state.camLiftHold = 0; state.followOn = false; state.camRange = 6.2; state.camPitchNow = -4;
  } else if (LOW_ROAD(cam) && (tubeCamAt(state.dist) || mine || low)) {
    want = { pos: behindOnRoad(9, 2.5), look: target };
    state.camLiftHold = 0; state.followOn = false; state.camRange = 9.3; state.camPitchNow = -8;
  } else want = viewWants(cam, target, dt, snap);
  if (cam.name !== 'Rider' && !canal) want.pos = clearHill(want.pos);
  ease(want.pos, want.look, target, EASE[cam.name] ?? 2.5, dt, snap || state.lastCut);
}

// Hillside guard (2026-11-26, the owner riding Sa Calobra: "every camera is the same on high sides"; his report: Orbit 14 m
// out on the uphill side, inside the slope). Mountain routes only. Where the camera's spot lies beside the road on a side
// the survey measured rising (the ground 2.5 / 3.5 m out more than 1.5 m over the road), the slope is carried on out to
// the camera (as steep as the rise so far suggests, between 0.3 and 1.2 m per metre) and the camera is raised to 3 m
// over it (3 m, not less: Low detail draws a coarser, fuller slope than the finest tiles the survey measures). Anything
// else (the road side, the valley side, flat ground) is left exactly as the view wants it. The usual easing smooths it.
function clearHill(pos) {
  if (!mountainRoute() || !state.survey?.edge?.length) return pos;
  const c = C.Cartographic.fromCartesian(pos);
  if (!c) return pos;
  const lat = C.Math.toDegrees(c.latitude), lon = C.Math.toDegrees(c.longitude);
  const kx = 111320 * Math.cos(c.latitude), ky = 110540;
  let best = null;
  for (let d = Math.max(0, state.dist - 140); d <= Math.min(route.length, state.dist + 140); d += 2) {
    const q = route.at(d), dx = (lon - q.lon) * kx, dy = (lat - q.lat) * ky, dd = dx * dx + dy * dy;
    if (!best || dd < best.dd) best = { d, dd, dx, dy };
  }
  if (!best) return pos;
  const t = route.tangent(best.d), side = best.dx * Math.cos(t) - best.dy * Math.sin(t), a = Math.abs(side); // + = right
  if (a <= 3) return pos;
  const e = state.survey.edge[Math.round(best.d / SURVEY_STEP)];
  if (!e) return pos;
  const ups = (side < 0 ? [e[0], e[2]] : [e[1], e[3]]).filter(Number.isFinite);
  if (!ups.length) return pos;
  const road = groundHeight(best.d), rise = Math.max(...ups) - road;
  if (!(rise > 1.5)) return pos;
  const k = Math.max(0.3, Math.min(1.2, rise / 3.5)), ground = road + rise + k * Math.max(0, a - 3.5);
  if (c.height >= ground + 3) return pos;
  return C.Cartesian3.fromRadians(c.longitude, c.latitude, ground + 3);
}

// 4. what each view wants: { pos, look }
function viewWants(cam, target, dt, snap) {
  if (cam.name === 'Rider') { // first person: the rider's head, looking along the road ahead
    const head = roadPoint(state.dist, (state.mySide || 0) + (state.wanderOff || 0), 1.65);
    return { pos: head, look: roadAt(state.dist + 15, 1.45) };
  }
  if (cam.name === 'Chase') { // locked on the road behind, looking at the road ahead of the rider
    state.camRange = 8; state.camPitchNow = -10;
    return { pos: behindOnRoad(viewRange(8), 2.4, state.dist), look: roadAt(state.dist + 12, 0.6) };
  }
  if (cam.cine === 'flyby') { flyByPos(); return { pos: state.flyby.pos, look: target }; }
  // the views placed straight back along the view direction
  const isDefault = cam.name === 'Default', liftable = (isDefault || cam.name === 'High chase') && route.opts?.camHigh !== false && !ed.on;
  // opening shot (Default; the owner 2026-11-16: "as high as possible, e.g. 150m back, 12 deg down, swept left 15 deg"):
  // starts 150 m back, 12 degrees down (~31 m up, over the rooftops), swung 15 degrees left, and sweeps in behind the
  // rider over ~5 s once they're 15 m past the line. state.introYaw runs 30 -> 0 (k = 1 -> 0, eased).
  if (state.introYaw > 0 && state.dist > 15) state.introYaw = Math.max(0, state.introYaw - dt * 6);
  const k0 = isDefault ? state.introYaw / 30 : 0, kI = k0 * k0 * (3 - 2 * k0);
  const introYaw = 15 * kI, introPitch = (-12 - cam.pitch) * kI;
  // under a bridge deck: tilt so the camera stays over it (the survey knows the deck; Google's mesh is solid under it)
  let deckPitch = 0;
  if (liftable) {
    const camBack = (state.camRange ?? cam.range) * Math.cos(C.Math.toRadians(cam.pitch));
    const deck = deckBetween(state.dist - camBack - 10, state.dist - camBack + 10);
    if (deck !== null) deckPitch = Math.min(0, -C.Math.toDegrees(Math.asin(Math.min(0.95, Math.max(0, (deck + 3 - (groundHeight(state.dist + cam.ahead) + cam.lift)) / (state.camRange ?? cam.range))))) - (cam.pitch + introPitch));
  }
  state.deckPitch = snap ? deckPitch : (state.deckPitch ?? 0) + (deckPitch - (state.deckPitch ?? 0)) * Math.min(1, dt * 3);
  const basePitch = cam.pitch + introPitch + state.deckPitch;
  // obstacles (liftable views only): how much steeper the camera would have to look down to see the rider over what
  // the survey measured beside the road, now and ~2 s ahead; held 4 s, eased
  const now = performance.now();
  if (now - (state.camClearT || 0) > CHECK_MS) {
    state.camClearT = now;
    let need = 0;
    if (liftable) {
      const dA = Math.min(route.length, state.dist + Math.max(10, bike.v * 2));
      need = Math.max(needLift(cam, basePitch, viewRange(cam.range), state.dist, state.heading), needLift(cam, basePitch, viewRange(cam.range), dA, route.heading(dA)));
      if (!Number.isFinite(need)) need = 0;
    }
    if (need >= (state.camLiftHold ?? 0) || now - (state.camLiftT || 0) > HOLD_MS) { state.camLiftHold = need; state.camLiftT = now; }
    // trees: the closest clear range now and ~2 s ahead; shorter at once, longer only after 3 s (the views from behind only:
    // Sweep / Orbit were pulled in front of the rider, 2026-11-22)
    { let tr = Infinity; if (state.treesNear && !ed.on && ['Default', 'High chase', 'Rear 45', 'Free', 'Drone'].includes(cam.name)) { const pr = basePitch - Math.min(12, state.camLiftHold || 0), rg = viewRange(cam.range), dA = Math.min(route.length, state.dist + Math.max(10, bike.v * 2)); tr = Math.min(treeClear(pr, rg, state.dist, state.heading, cam), treeClear(pr, rg, dA, route.heading(dA), cam)); }
      if (tr <= (state.treeHold ?? Infinity) || now - (state.treeT || 0) > 3000) { state.treeHold = tr; state.treeT = now; } }
    // the wide view (Default): open if, now and ~4 s ahead, the wide framing needs no lift and no tube is near
    // (not in Lite: the generated world's trees aren't in the survey, so 'open' country was often woods: Hardknott)
    if (isDefault && liftable && !state.lite) {
      const wideCam = { ...cam, pitch: -16 }, dB = Math.min(route.length, state.dist + Math.max(40, bike.v * 4));
      const open = need === 0 && !tubeCamAt(state.dist) && !tubeCamAt(dB)
        && needLift(wideCam, -16, viewRange(110), state.dist, state.heading) === 0 && needLift(wideCam, -16, viewRange(110), dB, route.heading(dB)) === 0;
      state.openSince = open ? state.openSince || now : 0;
    } else state.openSince = 0;
  }
  if (!liftable) { state.camLiftHold = 0; state.openSince = 0; }
  const need = state.camLiftHold ?? 0;
  // Default: road-riding where more than 8 degrees would be needed (on after 1 s of it, off after 4 s under 4)
  if (isDefault && liftable && state.cleanRoad && !state.vpNoClean) {
    if (need > 8) { state.liftHiT ||= now; state.liftLoT = 0; } else if (need < 4) { state.liftLoT ||= now; state.liftHiT = 0; } else { state.liftHiT = 0; state.liftLoT = 0; }
    if (!state.followOn && state.liftHiT && now - state.liftHiT > 1000) state.followOn = true;
    else if (state.followOn && state.liftLoT && now - state.liftLoT > 4000) state.followOn = false;
  } else state.followOn = false;
  // Default: the wide view (in after 6 s open; out for at least 10 s and until closed for 2 s)
  if (!state.openSince) state.closedSince ||= now; else state.closedSince = 0;
  const wideOn = isDefault && !state.followOn && (state.wideOn ? !(now - (state.wideAt || 0) > 10000 && state.closedSince && now - state.closedSince > 2000) : !!(state.openSince && now - state.openSince > 6000));
  if (wideOn && !state.wideOn) state.wideAt = now;
  state.wideOn = wideOn;
  // the lift itself: Default up to 12 degrees (beyond that it rides the road), High chase all of it, 60% of anything
  // over 12 coming as a closer camera rather than a steeper one
  const lift = isDefault ? Math.min(12, need) : need;
  state.camExtra = snap ? lift : (state.camExtra ?? 0) + (lift - (state.camExtra ?? 0)) * Math.min(1, dt * (lift > (state.camExtra ?? 0) ? 1.5 : 0.25));
  const over = Math.max(0, state.camExtra - 12);
  let pitch = Math.max(-80, basePitch - (state.camExtra - over * 0.6));
  if (!Number.isFinite(pitch)) pitch = cam.pitch;
  let range = viewRange(cam.range) * Math.max(0.45, 1 - over / 45);
  // (trees: in closer, eased: in over ~1 s, out over ~4 s)
  { const want = Number.isFinite(state.treeHold ?? Infinity) ? Math.min(range, state.treeHold) : range, cur = state.treeRangeNow ?? range;
    state.treeRangeNow = snap ? want : cur + (want - cur) * Math.min(1, dt * (want < cur ? 2.5 : 0.4)); if (state.treeRangeNow < range) range = state.treeRangeNow; }
  if (wideOn) { range = viewRange(110); pitch = -16; } // (the easing makes the sweep out and in)
  if (kI > 0) { range += (viewRange(150) - range) * kI; pitch = basePitch; } // (the opening shot: no lift needed from up there)
  state.camRange = range; state.camPitchNow = pitch;
  if (state.followOn) { // ride the road ~70% as far back, a few metres up, never below the rider's road on a ramp
    const back = viewRange(cam.range) * Math.cos(C.Math.toRadians(cam.pitch)) * 0.7;
    const up = Math.max(3, Math.tan(C.Math.toRadians(-cam.pitch + 4)) * back) + cam.lift;
    return { pos: behindOnRoad(back, up, state.dist), look: target };
  }
  return { pos: hprPos(target, state.heading + C.Math.toRadians(cam.yaw + introYaw), C.Math.toRadians(Math.max(-85, pitch)), range), look: target };
}

// the one smoothing step: the camera's offset from the rider (and the look point's) eases towards what's wanted
function ease(pos, look, target, rate, dt, hard) {
  const wantOff = C.Cartesian3.subtract(pos, target, new C.Cartesian3()), wantLook = C.Cartesian3.subtract(look, target, new C.Cartesian3());
  const k = Math.min(1, dt * rate);
  if (hard || !state.camOff || !Number.isFinite(state.camOff.x)) { state.camOff = wantOff; state.lookOff = wantLook; }
  else {
    state.camOff = C.Cartesian3.lerp(state.camOff, wantOff, k, new C.Cartesian3());
    state.lookOff = C.Cartesian3.lerp(state.lookOff || wantLook, wantLook, k, new C.Cartesian3());
  }
  state.lastCut = false;
  lookFrom(C.Cartesian3.add(target, state.camOff, new C.Cartesian3()), C.Cartesian3.add(target, state.lookOff, new C.Cartesian3()));
}
// a hard cut (shots): straight there; the view after it starts from scratch
function cut(pos, look) { state.lastCut = true; lookFrom(pos, look); }

// How many degrees steeper the camera must look down so that the line from it to the rider, and its own spot, pass
// MARGIN m over everything the survey knows there. Points along the line are placed against the road (nearest
// station, how far to the side) and compared with: the road (and any canopy or deck over it, survey.deck) over the
// road; the ground measured 2.5 / 3.5 m out on that side (survey.edge: walls, hillsides, roadside trees, and so our
// banks too) out to 3.5 m; beyond that the slope between those two readings carried on (at most 1:1) up to 15 m out.
// Further out nothing is known and it's ignored. No ray picks: they stalled the graphics card.
const MARGIN = 1.8, HOLD_MS = 4000, CHECK_MS = 250, MAX_EXTRA = 50; // m, ms, ms, degrees
// trees (open worlds; world.js state.treesNear, 2026-11-21, the owner's list: on wooded paths the camera sat in the
// canopy): how far back the camera can be before the line from it to the rider runs through a crown (the top 70% of the
// tree, its measured radius + 0.5 m). Rising over a 15 m canopy would mean looking straight down, so under trees the
// camera comes in closer instead, below the crowns. Infinity = nothing in the way
function treeClear(pitchDeg, range, dist, heading, cam) {
  if (!state.treesNear) return Infinity;
  const tp = route.at(dist + cam.ahead), h = heading + C.Math.toRadians(cam.yaw), p = C.Math.toRadians(-pitchDeg);
  const back = range * Math.cos(p), trees = state.treesNear(tp.lat, tp.lon, back + 10);
  if (!trees.length) return Infinity;
  const base = groundHeight(dist), targetZ = groundHeight(dist + cam.ahead) + cam.lift;
  for (let s = 1.5; s <= back + 0.5; s += 1) {
    const e = -Math.sin(h) * s, n = -Math.cos(h) * s, zl = targetZ + Math.tan(p) * s;
    for (const [tx, ty, th, cr] of trees) {
      if (Math.hypot(tx - e, ty - n) > cr + 0.5) continue;
      if (zl >= base + th * 0.3 && zl <= base + th + 0.5) return Math.max(4, (s - 1) / Math.cos(p));
    }
  }
  return Infinity;
}

function needLift(cam, basePitch, range, dist, heading) {
  const sv = state.survey;
  if (!sv.raw.length) return 0;
  const tp = route.at(dist + cam.ahead);
  const h = heading + C.Math.toRadians(cam.yaw + state.introYaw / 2), p = C.Math.toRadians(-basePitch); // p: looking down
  const kx = 111320 * Math.cos(C.Math.toRadians(tp.lat)), ky = 110540;
  const targetZ = groundHeight(dist + cam.ahead) + cam.lift;
  let need = 0;
  for (const f of [0.3, 0.5, 0.7, 0.85, 1]) {
    const x = f * range * Math.cos(p); // back from the target, horizontally
    if (x < 3) continue;
    const e = -Math.sin(h) * x, n = -Math.cos(h) * x; // east / north of the target
    let best = null; // nearest bit of road
    for (let d = Math.max(0, dist + cam.ahead - range - 20); d <= Math.min(route.length, dist + cam.ahead + 20); d += 2) {
      const q = route.at(d), dx = (q.lon - tp.lon) * kx - e, dy = (q.lat - tp.lat) * ky - n, dd = dx * dx + dy * dy;
      if (!best || dd < best.dd) best = { d, dd, dx, dy };
    }
    if (!best) continue;
    const t = route.tangent(best.d), side = -(best.dx * Math.cos(t) - best.dy * Math.sin(t)), a = Math.abs(side); // + = right
    const i = Math.round(best.d / SURVEY_STEP), edge = sv.edge[i], road = groundHeight(best.d);
    let top;
    if (a <= 1.75) top = Math.max(road, sv.deck?.[i] ?? -Infinity);
    else if (a <= 15 && edge) {
      const e25 = side < 0 ? edge[0] : edge[1], e35 = side < 0 ? edge[2] : edge[3];
      if (!Number.isFinite(e25) && !Number.isFinite(e35)) top = road;
      else if (a <= 3.5) top = Math.max(...[e25, e35].filter(Number.isFinite));
      else if (Number.isFinite(e25) && Number.isFinite(e35)) top = e35 + Math.max(-1, Math.min(1, e35 - e25)) * (a - 3.5); // the slope carried on
      else top = Number.isFinite(e35) ? e35 : e25;
    } else continue;
    // (within 6 m of the line the drawn road itself is there: on a lane drawn above the ground beside it, the survey's edge
    // readings were lower than the road and the camera sat under it behind the rider, St Kenelm's Pass 2026-11-20)
    if (a <= 6) top = Math.max(top, road);
    const n_ = C.Math.toDegrees(Math.atan2(top + MARGIN - targetZ, x)) - C.Math.toDegrees(p);
    if (Number.isFinite(n_)) need = Math.max(need, n_);
  }
  return Math.max(0, Math.min(MAX_EXTRA, need));
}

// Fly-by: a camera standing by the road 60 m ahead, just off it and 3 m up, turning to follow the rider past; once
// the rider is 25 m beyond it, it leapfrogs ahead (alternating sides) for the next pass
function flyByPos() {
  const f = state.flyby;
  if (!f || state.dist > f.d + 25 || state.dist < f.d - 120) {
    const d = Math.min(route.length, state.dist + 60), side = f?.side === 4 ? -4 : 4; // just off the road, above the banks
    state.flyby = { d, side, pos: roadPoint(d, side, 3) };
    state.lastCut = true; // a new camera position: no gliding across to it
  }
}
// the camera at `pos`, looking at `target` (both Cartesian3)
// Landmark viewpoints (the owner 2026-10-21: "when approaching cool landmarks the camera switches to the view from
// that as the bike goes past and then back to whatever it was before"). A route's `viewpoints` in routes.json:
// [{ name, lat, lon (where the camera stands), up (metres above the road there, default 40), near: { lat, lon }
// (the spot the rider passes; default the camera's own spot), radius (how close counts as passing, default 120 m),
// before / after (metres of ride either side of the closest point, default 180 / 60) }]. Every pass counts (the
// Paris lap passes the Arc twice; Barca's laps pass Drassanes four times).
// Moving shots and aiming (2026-10-25, Bristol: a sweep past the SS Great Britain, a drone looking up at the Clifton
// Suspension Bridge), all optional:
//   alt: the camera's height above sea level (the route file's datum: metres AOD for Bristol's LIDAR heights) instead
//        of `up` above the road; converted with the survey's offset between the file and Google's heights at the rider
//   to: { lat, lon, up | alt }: the camera glides from its spot to this one while the rider rides the window (eased)
//   follow: { ahead, side, up }: a drone that travels with the rider: `ahead` metres along the route from the rider
//        (negative = behind), `side` metres to the right (negative = left), `up` metres above the road there
//   look: { lat, lon, up | alt, mix, mixTo }: aim part of the way from the rider towards this point (mix 0 = the rider,
//        1 = the point; mixTo: the mix eases to this by the end of the window)
//   km: [from, to] (full-route km): only the pass within that stretch (a route that comes by twice, or two shots near
//        one place: Bristol passes Temple Meads at its start and finish and the SS Great Britain from both quays)
//   fov: a fixed field of view in degrees (a wide lens: the rider small in a big scene); otherwise the TV zoom keeps
//        `frame` metres (default 40) either side of what it's aiming at
let vpCache = null, normalFov = null;
function viewpoints() {
  // (not in Lite: the TV shots were placed for Google's 3D; in the generated world Sacré-Cœur's shot sat inside the
  // church's block, a grey screen, the owner 2026-11-15)
  if (state.lite) return [];
  if (vpCache?.route === route) return vpCache.list;
  const list = [];
  for (const v of route.opts?.viewpoints || []) {
    const n = v.near || v, kx = 111320 * Math.cos((n.lat * Math.PI) / 180), R = v.radius ?? 120;
    let run = null;
    const end = () => { if (run) list.push({ a: run.d - (v.before ?? 180), b: run.d + (v.after ?? 60), lat: v.lat, lon: v.lon, up: v.up ?? 40, d0: run.d, v }); run = null; };
    const d0 = v.km ? Math.max(0, route.m(v.km[0])) : 0, d1 = v.km ? Math.min(route.length, route.m(v.km[1])) : route.length;
    for (let d = d0; d <= d1; d += 5) {
      const p = route.at(d), e = Math.hypot((p.lat - n.lat) * 110540, (p.lon - n.lon) * kx);
      if (e < R) { if (!run || e < run.e) run = { d, e }; } else end();
    }
    end();
  }
  vpCache = { route, list };
  return list;
}
// the offset between the route file's heights and Google's (ellipsoid) heights, eased: `alt` points use it
let fileToGoogle = null;
function viewpointAt(d, rider, dt = 0) {
  const w = viewpoints().find((x) => d >= x.a && d <= x.b);
  if (!w) return null;
  const v = w.v, t0 = (d - w.a) / Math.max(1, w.b - w.a), t = t0 * t0 * (3 - 2 * t0); // eased progress through the window
  const off = groundHeight(d) - route.smoothEle(d);
  if (Number.isFinite(off)) fileToGoogle = fileToGoogle === null ? off : fileToGoogle + (off - fileToGoogle) * Math.min(1, dt * 0.5);
  // height of a point: above sea level (alt, the file's datum), or `up` above the road at the closest pass
  // (measured by now: the survey reaches it as the rider comes near)
  const h = (p, dRef) => (p.alt !== undefined ? p.alt + (fileToGoogle ?? off) : groundHeight(dRef) + (p.up ?? 40));
  let pos;
  if (v.follow) {
    const f = v.follow, da = Math.max(0, Math.min(route.length, d + (f.ahead ?? 0))), p = route.at(da), hd = route.tangent(da);
    const ex = Math.cos(hd), ny = -Math.sin(hd), side = f.side ?? 0; // unit vector to the right, metres east / north
    pos = C.Cartesian3.fromDegrees(p.lon + (ex * side) / (111320 * Math.cos((p.lat * Math.PI) / 180)), p.lat + (ny * side) / 110540, groundHeight(da) + (f.up ?? 3));
  } else {
    const A = { lat: w.lat, lon: w.lon, h: h(v, w.d0) };
    const B = v.to ? { lat: v.to.lat, lon: v.to.lon, h: h(v.to, w.d0) } : A;
    pos = C.Cartesian3.fromDegrees(A.lon + (B.lon - A.lon) * t, A.lat + (B.lat - A.lat) * t, A.h + (B.h - A.h) * t);
  }
  let look = rider;
  if (v.look) {
    // turn part of the way from the rider towards the point (by direction: blending the points themselves swung a far
    // landmark's shots right off the rider, 15% of 1.6 km to the bridge from Sea Walls is 240 m)
    const L = v.look, mix = (L.mix ?? 0.5) + ((L.mixTo ?? L.mix ?? 0.5) - (L.mix ?? 0.5)) * t;
    const lp = C.Cartesian3.fromDegrees(L.lon, L.lat, h(L, w.d0));
    const toR = C.Cartesian3.normalize(C.Cartesian3.subtract(rider, pos, new C.Cartesian3()), new C.Cartesian3());
    const toL = C.Cartesian3.normalize(C.Cartesian3.subtract(lp, pos, new C.Cartesian3()), new C.Cartesian3());
    const dir = C.Cartesian3.normalize(C.Cartesian3.lerp(toR, toL, mix, new C.Cartesian3()), new C.Cartesian3());
    look = C.Cartesian3.add(pos, C.Cartesian3.multiplyByScalar(dir, C.Cartesian3.distance(pos, rider), new C.Cartesian3()), new C.Cartesian3());
  }
  return { pos, look, fov: v.fov ? C.Math.toRadians(v.fov) : null, frame: v.frame ?? 40, noClean: !!v.noClean };
}

function lookFrom(pos, target) {
  const enu = C.Transforms.eastNorthUpToFixedFrame(target);
  viewer.camera.lookAt(target, C.Matrix4.multiplyByPoint(C.Matrix4.inverseTransformation(enu, new C.Matrix4()), pos, new C.Cartesian3()));
}

// On a phone held upright the views come in closer: at the desktop distances the rider was a speck on a tall narrow
// screen (the owner 2026-10-20: "the rider on the bike isn't visible")
const viewScale = () => (innerHeight > innerWidth * 1.2 ? (innerWidth <= 700 ? 0.55 : innerWidth <= 1100 ? 0.75 : 1) : 1); // (tablets held upright: 0.75)
// only the distant views come in (Default / Free 26.5 m -> 14.6 m on a phone), never closer than 10 m: scaling Chase
// (8 m) too put the camera 4 m behind the rider, who filled the screen
const viewRange = (r) => (r <= 10 ? r : Math.max(10, r * viewScale()));

let shownCam = null;
export const showCam = () => {
  $('cam-name').textContent = state.slideshow ? `▶ ${CAMS[state.cam].name}` : CAMS[state.cam].name;
  // touch screens have no camera name in their dock (the owner: "on mobile you can't see"): a short notice when it changes
  const label = (state.slideshow ? '▶ ' : '') + CAMS[state.cam].name;
  if (shownCam !== null && label !== shownCam && matchMedia('(pointer: coarse), (max-width: 700px)').matches) toast(`🎥 ${label}`, 1600);
  shownCam = label;
  $('btn-cam').title = state.slideshow ? 'Slideshow: a new view every 30 seconds. Click (or C) to pick a view' : 'Change view (C); after the last one the slideshow starts again';
};
// C / the camera button: from the slideshow, stay on the view being shown; then step through the views, and after
// the last one go back to the slideshow
export const nextCam = () => {
  if (state.slideshow) { state.slideshow = false; toast(`Slideshow off: ${CAMS[state.cam].name} view. Press C to change.`, 3000); }
  else if (state.cam === CAMS.length - 1) startSlideshow();
  else state.cam += 1;
  store.set('cam', state.cam); showCam();
};
export function startSlideshow() {
  state.slideshow = true; state.slideAt = performance.now();
  state.cam = 0; resetFree(); showCam();
}
// at Load scenery: the view chosen on the setup screen (Default unless changed), or the slideshow
export function startView() {
  const want = $('cfg-startcam')?.value || 'Default';
  if (want === 'slideshow') return startSlideshow();
  state.slideshow = false; resetFree();
  state.cam = Math.max(0, CAMS.findIndex((c) => c.name === want)); showCam();
}

// Free camera: drag on the 3D view to swing round the rider, scroll to zoom, double-click to go back behind.
// Dragging from any other view switches to Free, starting from where that view was.
export function toFree() {
  if (state.slideshow) { state.slideshow = false; showCam(); } // taking the camera by hand ends the slideshow
  if (state.cam === FREE) return CAMS[FREE];
  const from = CAMS[state.cam], f = CAMS[FREE];
  Object.assign(f, { range: Math.min(from.range, 60), pitch: from.pitch, yaw: from.yaw, lift: 0.9, ahead: 0 });
  state.cam = FREE; store.set('cam', FREE); showCam();
  return f;
}
export let drag = null;

// start-up: camera: Free view defaults, the remembered camera (main.js runs these in order)
export async function initCamera() {
  // The Free view starts from the default at every ride (the owner, 2026-10-16); changes last for that ride only
  Object.assign(CAMS[FREE], FREE_DEFAULT);
  try { localStorage.removeItem('rw.freeCam.v2'); } catch {}
  state.cam = Math.min(CAMS.length - 1, +store.get('cam', FREE));
  startView(); // the start view setting (Default unless changed; the owner 2026-10-19: a consistent view, slideshow optional)
}

// start-up: camera button, Free view drag / scroll / double-click (main.js runs these in order)
export async function initCameraControls() {
  $('btn-cam').addEventListener('click', nextCam);
  // fingers on the screen: one drags (as the mouse), two pinch to zoom (as the wheel)
  const touches = new Map();
  let pinch = null;
  const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  $('globe').addEventListener('pointerdown', (e) => {
    if (!viewer) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { $('globe').setPointerCapture(e.pointerId); } catch {} // (keeps the moves coming if a finger leaves the view)
    if (touches.size === 2) { drag = null; pinch = spread(); } else drag = { x: e.clientX, y: e.clientY };
  });
  const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; if (!touches.size) drag = null; };
  $('globe').addEventListener('pointercancel', lift);
  $('globe').addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const now = spread(), f = toFree();
      if (now > 0 && pinch > 0) f.range = Math.max(2.5, Math.min(150, f.range * (pinch / now)));
      pinch = now;
      showFreeNumbers(f);
      return;
    }
    if (!drag) return;
    const f = toFree();
    f.yaw = ((f.yaw - (e.clientX - drag.x) * 0.3 + 540) % 360) - 180;
    f.pitch = Math.max(-85, Math.min(-2, f.pitch + (e.clientY - drag.y) * 0.25)); // drag down to look from higher
    drag = { x: e.clientX, y: e.clientY };
    showFreeNumbers(f);
  });
  $('globe').addEventListener('pointerup', lift);
  $('globe').addEventListener('wheel', (e) => {
    if (!viewer) return;
    e.preventDefault();
    const f = toFree();
    f.range = Math.max(2.5, Math.min(150, f.range * Math.exp(e.deltaY * 0.001)));
    showFreeNumbers(f);
  }, { passive: false });
  $('globe').addEventListener('dblclick', () => { Object.assign(toFree(), FREE_DEFAULT); });
  showCam();
}
