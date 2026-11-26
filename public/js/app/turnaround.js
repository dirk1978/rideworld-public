// Turning round at the end of the route: a solo rider always turns straight round and keeps riding, Zwift style, while
// a box (hud.js showEndBox) offers Keep riding or Finish (the owner 2026-10-26; before, the ride paused on the summary). The route is swapped for the same road the other way (Route.reversed()), the
// rider carries on from the same spot, and distance keeps counting (state.distBase + state.dist, see rideDist):
// one ride, one file. The 3D survey is mirrored rather than measured again. Segments, pacers, ghosts and other
// riders belong to the way out, so they are left behind; the route time counts as a ghost.
import { route, setRoute, state, toast } from './core.js';
import { cleanRoad } from './cleanroad.js';
import { saveGhost } from './company.js';
import { trip } from './trip.js';
import { viewer } from './scenery.js';
import { SURVEY_STEP, filterSurvey } from './survey.js';

// survey readings are per 10 m from the start; read them back from the far end
function mirrorSurvey(L) {
  const sv = state.survey, raw = sv.raw, n = Math.floor(L / SURVEY_STEP) + 1, out = [];
  for (let j = 0; j < n; j++) {
    const f = Math.max(0, L - j * SURVEY_STEP) / SURVEY_STEP, i = Math.floor(f), t = f - i;
    const a = raw[i], b = raw[Math.min(i + 1, raw.length - 1)];
    out.push(Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : Number.isFinite(a) ? a : b);
  }
  sv.raw = out;
  // ground beyond the edges (absolute heights): nearest station, left and right swapped
  const edge = sv.edge;
  sv.edge = Array.from({ length: n }, (_, j) => {
    const e = edge[Math.round(Math.max(0, L - j * SURVEY_STEP) / SURVEY_STEP)];
    return e ? [e[1], e[0], e[3], e[2]] : undefined;
  });
  filterSurvey();
}

export function turnAround(say = true) {
  const L = route.length, d = L - state.dist;
  if (!state.legs) saveGhost(); // the route itself was ridden: that's a ghost time
  state.distBase += state.dist - d;
  state.legs++;
  mirrorSurvey(L);
  setRoute(route.reversed());
  state.dist = d;
  state.lean = 0;
  // rebuild what's drawn along the road from the new direction
  for (const ents of Object.values(state.arches)) for (const e of ents) viewer.entities.remove(e);
  state.arches = {};
  cleanRoad.at = -1e9;
  trip.etaAt = 0; // the ETA to the new end, straight away
  state.lineAt = -1e9;
  if (say) toast(state.legs === 1 ? '↩ Turning round: same road, the other way. 🏁 Finish ride ends it any time.' : '↩ Turning round again.', 6000);
}
