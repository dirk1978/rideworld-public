// 3D tunnels (the owner's idea, 2026-10-19): inside a tunnel (route.zones, from OpenStreetMap) the clean road used to run
// through a black void, because Google's mountain is cut away along the road and nothing is behind it. Now each tunnel
// gets a tube from the tunnel kit (tunnelkit.js: a mountain bore, a railway underbridge or an open-sided gallery, at
// the size its route entry asks for), built as the rider approaches it. This module finds the tubes (OSM's tunnels,
// stretched while Google's rock covers the road, and earthworks.js's deep cuttings), and rebuilds them when the
// survey's road heights under them move. The camera keeps inside the tube (camera.js tubeCamAt).
import { route, state } from './core.js';
import { viewer } from './scenery.js';
import { SURVEY_STEP, groundHeight } from './survey.js';
import { earthworks } from './earthworks.js';
import { makeTunnel } from './tunnelkit.js';
import { ed } from './editor.js';

export const tunnels = { prims: [], polys: [], list: [], forRoute: null, heights: '', checked: 0 };
const PAD = 12;          // route.zones pad tunnels by 15 m each end (for the survey); the tube starts 3 m outside

// metres Google's surface stands over the road at d (survey.over), or null if not measured
function overAt(d) {
  const v = state.survey.over?.[Math.round(d / SURVEY_STEP)];
  return Number.isFinite(v) ? v - groundHeight(d) : null;
}
// OpenStreetMap's tunnel can be shorter than the mountain over the road (Formentor: the way is ~195 m, its own length
// tag says 300 m, and Google's mountain covers the road for ~150 m before it): the clean road then cut a gorge up to
// a portal standing out of the hillside (the owner 2026-10-19). Each end moves out, 10 m at a time (up to 300 m), while
// Google's surface stays 5 m or more over the road.
// Gaps (no reading: up to 80 m; the readings just outside a portal are often missing) are stepped over; the end is
// the last reading that was still 5 m up. Bridge styles (rail / gallery / underpass) move at most 10 m: under a bridge,
// trees over the approach count as "5 m up" too (Bristol's St Philips Causeway underpass grew to 156 m of hedge-lined path).
function extend([f, t], max = 300) {
  const walk = (from, dir) => {
    let end = from, gap = 0;
    for (let d = from + 10 * dir; Math.abs(d - from) <= max && d >= 0 && d <= route.length; d += 10 * dir) {
      const o = overAt(d);
      if (o === null) { if (++gap > 8) break; continue; }
      if (o < 5) break;
      end = d; gap = 0;
    }
    return end;
  };
  return [walk(f, -1), walk(t, 1)];
}

// the tunnels as ride metres [from, to] (the real portals, not the survey's padded zone)
function tubes() {
  // OSM's tunnels, and any cutting too deep for earthworks.js (handed over as a tunnel)
  const list = [...(route.zones || []).filter(([, , type]) => type === 'tunnel').map(([f, t, , kit]) => [...extend([f + PAD, t - PAD], kit?.style && kit.style !== 'bore' ? 10 : 300), kit ? { kit } : null]), ...earthworks.tubes.map((s) => s.slice())].sort((a, b) => a[0] - b[0]);
  // one tunnel mapped as several ways (Brighton Marina): overlapping or nearly touching tubes become one, or portal
  // faces stood across the road inside it
  const out = [];
  for (const [f, t, meta] of list) { const last = out[out.length - 1]; if (last && f <= last[1] + 15) last[1] = Math.max(last[1], t); else out.push([f, t, meta]); }
  return out.filter(([f, t]) => t - f > 10);
}
export const inTube = (d) => tunnels.list.some(([f, t]) => d >= f && d <= t);
// where the camera keeps low behind the rider: from 80 m before a portal (Google's mountain over the approach lifted
// it high over the hill) to 30 m after the exit
// (also near a tube that isn't built yet, `coming`: a long one is only built once the survey has measured past its far
// end, and until then the camera went high over the mountain on the approach (Formentor, 2026-10-26))
export const tubeCamAt = (d) => [...tunnels.list, ...(tunnels.coming || [])].some(([f, t]) => d >= f - 80 && d <= t + 30);

// the forecourt cuts (tunnelkit.js) only while the clean road cuts Google's scenery at all, and within 1 km
function forecourtCuts() {
  const coll = state.tileset?.clippingPolygons;
  if (!coll) return;
  const on = state.cleanRoad && !ed.on;
  for (const p of tunnels.polys) {
    const want = on && Math.abs(p.at - state.dist) < 1000;
    if (want && !coll.contains(p)) coll.add(p); else if (!want && coll.contains(p)) coll.remove(p);
  }
}

export function clearTunnels() {
  for (const p of tunnels.polys || []) if (state.tileset?.clippingPolygons?.contains(p)) state.tileset.clippingPolygons.remove(p);
  tunnels.polys = [];
  for (const p of tunnels.prims) viewer?.scene.primitives.remove(p);
  tunnels.prims = []; tunnels.list = []; tunnels.forRoute = null; tunnels.heights = ''; tunnels.gen = (tunnels.gen || 0) + 1;
}
// the road heights a tube was built at (each end and the middle, to 30 cm): the survey keeps refining them after the
// first build (the road through Formentor's tunnel settled 5 m lower and the ceiling cut through it), so the tubes
// are rebuilt when these move
const heightsOf = (list) => list.map(([f, t]) => [f, (f + t) / 2, t].map((d) => Math.round(groundHeight(d) / 0.3)).join(',')).join(';');

// the tubes the survey has reached: each is built as the rider approaches it. Until 2026-10-26 nothing was built until
// the survey had passed the route's LAST tunnel, so on Bristol the Kingsland Road tunnel (2.35 km) didn't exist when
// riders got there (the shelter at 8.1 km was the last)
function ready() {
  const measured = state.survey.raw.length * SURVEY_STEP, all = tubes();
  tunnels.coming = all; // every tube as far as it's known now (stretched over what the survey has measured), for tubeCamAt
  // built once the survey is 60 m past the entrance: waiting for the far end (as until 2026-10-26) left a long tunnel
  // (Formentor, 330 m) unbuilt until the rider was nearly in it. The survey then keeps measuring towards the exit, and
  // the tube is rebuilt if the road heights or its far end move (heightsOf, same() below) - by then the rider is inside.
  // (2026-11-26, the owner's Sa Calobra reports at 12.44 km: the road goes down through a tunnel and back up through the
  // same one, so both passes' tubes stood there, a few metres apart, two portals one above the other. A tube the rider
  // is 300 m past is left out when another tube on the route stands in the same place: only routes that pass through a
  // tunnel twice are touched)
  const mid = ([f, t]) => route.at((f + t) / 2), kx = 111320 * Math.cos(((route.at(0).lat) * Math.PI) / 180);
  const twin = (a) => all.some((b) => b !== a && Math.abs(b[0] - a[0]) > 200 && (() => { const p = mid(a), q = mid(b); return Math.hypot((p.lon - q.lon) * kx, (p.lat - q.lat) * 110540) < 60; })());
  return all.filter((tb) => measured >= Math.min(route.length, tb[0] + 60) && !(tb[1] < state.dist - 300 && twin(tb)));
}

// every frame: (re)build the tubes when one more is ready or the road heights under them moved (cheap check otherwise)
export function updateTunnels() {
  if (!viewer || !route) return;
  if (tunnels.forRoute === route) {
    const now = performance.now();
    if (now - tunnels.checked < 1000) return;
    tunnels.checked = now;
    forecourtCuts();
    const same = (a, b) => a.length === b.length && a.every(([f, t], i) => Math.abs(f - b[i][0]) < 1 && Math.abs(t - b[i][1]) < 1);
    if (heightsOf(tunnels.list) === tunnels.heights && same(ready(), tunnels.list)) return;
  }
  if (tunnels.prims.length) clearTunnels(); // another route (or the same road turned round): new tubes
  const list = ready();
  if (!list.length) { tunnels.forRoute = route; tunnels.checked = performance.now(); return; }
  clearTunnels();
  // each tube from the tunnel kit (tunnelkit.js): its style and size from the route's tunnel entry (routes.json
  // structures: style, width, height, open), else a 'bore' at the usual size. The portal faces reach just over the rock
  // above them (the clean road's cut goes all the way up), at most 25 m; a tunnel through a cutting from earthworks.js
  // says how tall and wide its portals must be to fill the cutting.
  const gen = tunnels.gen;
  for (const [f, t, meta] of list) {
    const top = meta?.top || [f, t].map((d, k) => Math.min(25, Math.max(overAt(d) ?? 0, overAt(d + 5 * (k ? -1 : 1)) ?? 0) + 1));
    const spec = { f, t, ...(meta?.kit || {}), top, wide: meta?.R };
    makeTunnel(spec, tunnels.prims, () => tunnels.gen === gen);
    tunnels.polys.push(...spec.polys.map((p) => Object.assign(p, { at: (f + t) / 2 })));
  }
  tunnels.list = list;
  tunnels.forRoute = route;
  tunnels.heights = heightsOf(list);
  forecourtCuts();
}
