// The ride so far and what's left: height gained and lost, and an ETA to the finish. The ETA rides the rest of the
// route in a quick simulation (steady speed for each 20 m at your power over the last ~30 s, on that stretch's
// gradient), so a climb ahead counts properly; redone every 3 s.
import { Bike } from '../physics.js';
import { $, U, bike, fmtDist, fmtEle, fmtTime, route, state } from './core.js';
import { rideProgress } from './openworld.js';
import { finishAt } from './scenery.js';
import { groundHeight, roadGrade } from './survey.js';

export const trip = { climb: 0, descent: 0, ref: null, lastDist: 0, pAvg: null, etaAt: 0 };
const sim = new Bike();

// every frame
export function updateTrip(watts, dt) {
  if (state.riding) {
    const k = Math.min(1, dt / 30);
    trip.pAvg = trip.pAvg === null ? watts : trip.pAvg + (watts - trip.pAvg) * k;
    // height gained / lost, ignoring wobbles under 1 m (and the simulator's J jumps)
    if (Math.abs(state.dist - trip.lastDist) > 100) trip.ref = null;
    const h = groundHeight(state.dist);
    if (trip.ref === null) trip.ref = h;
    else if (h > trip.ref + 1) { trip.climb += h - trip.ref; trip.ref = h; }
    else if (h < trip.ref - 1) { trip.descent += trip.ref - h; trip.ref = h; }
    trip.lastDist = state.dist;
  }
  const now = performance.now();
  if (now - trip.etaAt > 3000) { trip.etaAt = now; showEta(); }
  const u = U();
  $('m-climb').textContent = Math.round(trip.climb * u.ele);
  $('m-climb-unit').textContent = u.eleUnit;
  $('m-climb-label').textContent = `↓ ${fmtEle(trip.descent)}`;
}

// seconds to ride from ride metres `from` to `to` at the recent average power (the route ETA, and the segment timer's)
export function rideTime(from, to) {
  const ftp = +$('cfg-ftp').value || 200;
  const watts = Math.max(60, trip.pAvg ?? (state.riding ? 0 : ftp * 0.7));
  Object.assign(sim, { riderKg: bike.riderKg, bikeKg: bike.bikeKg, cda: bike.cda, crr: bike.crr, draft: 0 });
  let t = 0;
  for (let d = from; d < to; d += 20) {
    if (route.pieces) { const at = route.pieceAt(d); if (d < at.p.a) d = at.p.a; } // highlights: the gaps aren't ridden
    t += Math.min(20, to - d) / sim.steadySpeed(watts, roadGrade(d));
  }
  return { t, watts };
}

function showEta() {
  // a pre-plotted open-world route (2026-11-20, the owner: "it doesn't show anywhere how long left there is on the route"):
  // time left at the recent power over the route's own profile, and the distance left
  const rp = rideProgress();
  if (rp && rp.R.profile?.length > 1) {
    const ftp = +$('cfg-ftp').value || 200, watts = Math.max(60, trip.pAvg ?? (state.riding ? 0 : ftp * 0.7)), P = rp.R.profile, step = rp.total / (P.length - 1);
    Object.assign(sim, { riderKg: bike.riderKg, bikeKg: bike.bikeKg, cda: bike.cda, crr: bike.crr, draft: 0 });
    let t = 0; for (let d = rp.done; d < rp.total; d += 20) { const i = Math.min(P.length - 2, Math.floor(d / step)); t += Math.min(20, rp.total - d) / sim.steadySpeed(watts, Math.max(-20, Math.min(20, ((P[i + 1] - P[i]) / step) * 100))); }
    $('m-eta').textContent = fmtTime(t);
    $('m-eta').title = `${rp.R.name}: ${fmtDist(rp.total - rp.done)} to go; at about ${Math.round(watts)} W you'd finish around ${new Date(Date.now() + t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    $('m-eta-label').textContent = `${fmtDist(rp.total - rp.done)} to go`;
    return;
  }
  const end = finishAt();
  if (!route || state.dist >= end || !Number.isFinite(end)) { $('m-eta').textContent = '–'; if (!Number.isFinite(end)) $('m-eta-label').textContent = 'Free ride'; return; }
  const { t, watts } = rideTime(state.dist, end);
  $('m-eta').textContent = fmtTime(t);
  $('m-eta').title = `At about ${Math.round(watts)} W you'd arrive around ${new Date(Date.now() + t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('m-eta-label').textContent = state.legs ? 'To the end' : 'To the finish';
}

export async function initTrip() {}
