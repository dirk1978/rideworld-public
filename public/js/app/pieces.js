// Highlights routes (route.pieces, see Route in route.js): only some stretches of a long route are ridden, e.g. the
// cobbles and climbs of We Ride Flanders. At the end of each piece the screen fades to white with the next piece's
// name, the rider is moved to its start, and the picture fades back once the scenery and the road there are ready.
// Distance keeps counting what was ridden (state.distBase takes up the jump, as when turning round), and the ride
// waits at the join (no metres are lost or gained while the screen is white).
import { $, route, state } from './core.js';
import { placeCamera } from './camera.js';
import { SURVEY_STEP, surveyStations } from './survey.js';
import { waitForScenery } from './scenery.js';

const FADE_OUT = 0.6, FADE_IN = 0.9, MAX_WAIT = 12; // seconds
const join = { phase: null }; // null | 'out' | 'wait' | 'in'
export const joinActive = () => !!join.phase && join.phase !== 'in';
let warmed = -1;

const nextPiece = (d) => {
  const at = route?.pieceAt(d);
  return at && at.i < route.pieces.length - 1 ? { ...at, next: route.pieces[at.i + 1], n: at.i + 2, of: route.pieces.length } : null;
};

// Called from the ride loop after the rider has moved from `before` to d: returns where the rider is allowed to be.
// Crossing a piece's end starts the change-over and holds the rider there; while the screen is white it holds them
// at the new start. (The piece is looked up from where the rider was: past its end, d is already in the gap.)
export function holdAtJoin(before, d) {
  if (!route?.pieces) return d;
  if (join.phase === 'out') return join.from;
  if (join.phase === 'wait') return join.to;
  const at = nextPiece(before);
  if (!at || before < at.p.a) return d; // in a gap (only by jumping there in the simulator): ride on
  // warm up the next piece ~600 m before the join: its scenery and road heights (Cesium fetches the finest tiles
  // for the measurements), so the wait at the join is short
  if (at.p.b - d < 600 && warmed !== at.i) { warmed = at.i; warm(at.next.a); }
  if (d < at.p.b) return d;
  start(at);
  return at.p.b;
}

async function warm(a) {
  const sv = state.survey, r = route;
  while (sv.busy) await new Promise((res) => setTimeout(res, 100));
  if (route !== r) return;
  const from = Math.max(0, Math.floor((a - 120) / SURVEY_STEP)), to = Math.min(Math.floor(r.length / SURVEY_STEP) + 1, Math.ceil((a + 300) / SURVEY_STEP));
  if (sv.raw.slice(from, to).some((x) => x === undefined)) await surveyStations(from, to, 2); // 2 points a frame: no hitch
}

function start(at) {
  Object.assign(join, { phase: 'out', t: 0, from: at.p.b, to: at.next.a, scenery: false });
  const el = $('join-fade');
  el.querySelector('.jf-name').textContent = at.next.name || `Part ${at.n}`;
  el.querySelector('.jf-of').textContent = `${at.n} of ${at.of}`;
  el.classList.remove('hidden');
}

// Every frame: the fade and the wait
export function updatePieces(dt) {
  if (!join.phase) return;
  const el = $('join-fade');
  join.t += dt;
  if (join.phase === 'out') {
    el.style.opacity = Math.min(1, join.t / FADE_OUT);
    if (join.t < FADE_OUT) return;
    // white: move to the next piece. Distance ridden carries on (the jump is taken up by distBase), segment timing
    // knows it was a join (segments.js), pacers keep their gaps to us
    state.distBase += join.from - join.to;
    state.dist = join.to;
    state.joinJumped = true;
    for (const p of state.pacers || []) p.dist = Math.max(0, Math.min(route.length, join.to + (p.dist - join.from)));
    placeCamera(0, true);
    Object.assign(join, { phase: 'wait', t: 0 });
    waitForScenery(MAX_WAIT * 1000).then(() => { join.scenery = true; });
    return;
  }
  if (join.phase === 'wait') {
    placeCamera(0, true);
    // ready: the scenery has loaded and the road is measured 150 m ahead (or we've waited long enough)
    const raw = state.survey.raw, i = Math.floor(join.to / SURVEY_STEP);
    const measured = raw.slice(i, i + 15).length === 15 && raw.slice(i, i + 15).every((x) => x !== undefined);
    if (join.t > MAX_WAIT || (join.t > 0.8 && join.scenery && measured)) Object.assign(join, { phase: 'in', t: 0 });
    return;
  }
  el.style.opacity = Math.max(0, 1 - join.t / FADE_IN);
  if (join.t >= FADE_IN) { el.classList.add('hidden'); join.phase = null; }
}
