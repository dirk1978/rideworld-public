// Everyone else on the road: other riders, pacers and ghosts drawn and kept in lanes, the rider list, group-ride
// lobby and banding, chapeau, and drafting with its slipstream.
import { devices } from '../devices.js';
import { BIKE_LEN, draftFor } from '../draft.js';
import { Multiplayer } from '../multiplayer.js';
import { sound } from './audio.js';
import { $, C, U, bike, esc, me, route, state, toast } from './core.js';
import { refreshGroups } from './groups.js';
import { laneLimit } from './cleanroad.js';
import { cornerLean, createRiderModel, orientModel, roadPoint, surfaceGrade } from './model.js';
import { viewer } from './scenery.js';
import { roadGrade } from './survey.js';
import { setStance, stanceStep } from '../stance.js';
// ---------- multiplayer: other riders, lanes, group rides, elastic banding ----------
export const mp = new Multiplayer();
export const LANE_SIDE = { 0: 0, 1: 0.9, '-1': -0.9, 2: 1.8, '-2': -1.8, 3: 0.45, '-3': -0.45, 4: 1.35, '-4': -1.35, 5: 2.2 };
export const laneSide = (lane) => LANE_SIDE[lane] ?? 0;
export const remotes = new Map(); // id -> { model, label, dist, side, crank, loading }

// Other riders in the room, with where they are now (extrapolated from their last update)
export function others() {
  const now = performance.now(), out = [];
  if (state.legs) return []; // turned round: everyone else is on the way out (see turnaround.js)
  for (const r of mp.riders.values()) {
    if (r.id === mp.you) continue;
    out.push({ ...r, distNow: Math.min(route.length, r.dist - (route.shiftM || 0) + (r.riding && !r.finished ? r.speed * Math.min(1, (now - r.at) / 1000) : 0)) });
  }
  // our own pacers and ghosts (only we see them)
  for (const p of state.pacers || []) {
    out.push({ id: p.id, name: p.name, kit: p.kit, lane: p.lane, distNow: p.dist, speed: p.v, power: Math.round(p.power), cadence: p.v > 0.5 && !p.finished ? 88 : 0, riding: state.riding, finished: p.finished, bot: true });
  }
  for (const g of state.ghosts || []) {
    const d = Math.min(route.length, route.fromV(g.distAt(state.elapsed))); // ghosts record distance ridden (highlights: the gaps left out)
    out.push({ id: g.id, name: g.name, kit: {}, lane: 0, distNow: d, speed: g.speedAt(state.elapsed), power: null, cadence: g.speedAt(state.elapsed) > 0.5 ? 85 : 0, riding: true, finished: d >= route.length - 1, ghost: true });
  }
  return out;
}

// Sideways spot. Riding up behind someone you tuck in on their wheel (to draft); clearly faster, you pull out and
// pass; otherwise you keep your lane. Only riders actually overlapping (within a bike length) step aside.
export function sideFor(dist, lane, id, list, speed = 0) {
  let base = laneSide(lane), lead = null;
  for (const o of list) {
    if (o.id === id) continue;
    const gap = o.dist - dist;
    if (gap > 0.5 && gap < 14 && (!lead || gap < lead.gap)) lead = { ...o, gap };
  }
  if (lead) {
    if (speed > (lead.speed ?? 0) + 1.2 && lead.gap < 8) base = lead.side + (base >= lead.side ? 0.9 : -0.9); // passing
    else base = lead.side; // on the wheel
  }
  let side = base;
  for (const o of list) {
    if (o.id === id) continue;
    const along = o.dist - dist, across = o.side - side;
    if (Math.abs(along) < BIKE_LEN + 0.2 && Math.abs(across) < 0.8) side += (across > 0 || (across === 0 && id < o.id) ? -1 : 1) * (0.8 - Math.abs(across));
  }
  const lim = laneLimit(); // inside the road; a packed bunch overlaps and rides through each other, like Zwift
  return Math.max(-lim, Math.min(lim, side));
}
// everyone who makes (and gets) a draft: real riders and pacers, not ghosts
export const solidRiders = () => [...remotes.entries()].filter(([, r]) => !r.ghost).map(([id, r]) => ({ id, dist: r.dist, side: r.side, speed: r.speed ?? 0 }));
export const meRider = () => ({ id: mp.you || 'me', dist: state.dist, side: state.mySide, speed: bike.v * (state.band || 1) });
// Wandering (the owner 2026-10-18: real riders aren't exactly on the line, "only very slightly and not uniform"): a
// drift of at most ~20 cm either side from three waves of unrelated lengths along the road (so it only changes as
// you move and never settles into a visible rhythm), its size itself rising and falling over a few hundred metres,
// so some stretches are dead straight. Each rider's own pattern from their id. Drawn on top of the lane (`side`),
// which drafting and lane-keeping keep using; it fades out while sheltering on a wheel, so a follower stays behind
// the rider in front. Returns [offset in metres (+ = right), its slope per metre].
const seedOf = (key) => {
  let h = 2166136261;
  for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; // mix, so 'bot:0' and 'bot:1' differ
  return (h >>> 0) / 4294967296;
};
function wanderAt(d, s) {
  const r = (k) => (s * k) % 1;                                   // more numbers from the one seed
  const size = 0.2 * Math.max(0, Math.sin((d / (380 + 300 * r(3.7))) * 6.283 + 6.283 * r(5.3)) * 0.6 + 0.4); // 0 .. 0.2 m
  return size * (0.5 * Math.sin((d / (97 + 50 * r(1.9))) * 6.283 + 6.283 * r(2.3))
    + 0.3 * Math.sin((d / (41 + 23 * r(7.1))) * 6.283 + 6.283 * r(4.1))
    + 0.2 * Math.sin((d / (173 + 71 * r(9.7))) * 6.283 + 6.283 * r(8.9)));
}
export function wander(d, key, draft = 0) {
  const s = seedOf(key), k = Math.max(0, 1 - draft / 0.12);
  return [k * wanderAt(d, s), k * (wanderAt(d + 0.5, s) - wanderAt(d - 0.5, s))];
}

// Our lateral position for drawing: the lane (state.mySide), plus our wander; state.wanderYaw angles the bike with it
export function myLateral(dt) {
  const list = solidRiders();
  const target = list.length ? sideFor(state.dist, mp.room ? mp.lane : 0, mp.you || 'me', list, bike.v * (state.band || 1)) : 0;
  state.mySide += (target - state.mySide) * Math.min(1, dt * 2);
  const [off, slope] = wander(state.dist, me?.username || 'me', state.draft || 0);
  state.wanderOff = Number.isFinite(state.wanderOff) ? state.wanderOff + (off - state.wanderOff) * Math.min(1, dt * 3) : off;
  state.wanderYaw = Math.atan(slope);
  return state.mySide + state.wanderOff;
}

// Elastic band for group rides: compare our distance with the middle of the group
export function bandFactor() {
  const g = mp.group;
  if (!g || !mp.room?.startsWith('group:') || g.banding === 'off') return 1;
  const ds = [state.dist, ...others().filter((o) => o.riding && !o.finished && !o.bot && !o.ghost).map((o) => o.distNow)].sort((a, b) => a - b);
  if (ds.length < 2) return 1;
  const centre = ds[Math.floor(ds.length / 2)], gap = state.dist - centre; // + ahead, - behind
  if (g.banding === 'firm') return Math.max(0.35, Math.min(1.8, 1 - gap / 40)); // ~50 m keeps everyone together
  return Math.max(0.8, Math.min(1.25, 1 - gap / 300));                            // soft: a gentle pull
}

export let lastSend = 0;
export function updateMultiplayer(now, dt, watts, cadence) {
  if (mp.room && now - lastSend > 250) {
    lastSend = now;
    mp.sendPos({ dist: state.legs % 2 ? route.length - state.dist : state.dist + (route.shiftM || 0), speed: bike.v * (state.band || 1), power: watts, cadence, riding: state.riding, finished: state.finished });
  }
  // draw the other riders
  const list = others(), seen = new Set();
  for (const o of list) {
    seen.add(o.id);
    let r = remotes.get(o.id);
    if (!r) {
      r = { model: null, label: null, dist: o.distNow, side: laneSide(o.lane), crank: 0, loading: true, name: o.name, kit: o.kit || {}, ghost: !!o.ghost,
        lift: 2.3 + (remotes.size % 3) * 0.55 }; // staggered name tags, readable when riders are bunched
      remotes.set(o.id, r);
      createRiderModel(o.kit || {}, () => r.crank, () => r.dist).then((m) => {
        r.model = m; r.loading = false;
        if (!remotes.has(o.id)) { viewer.scene.primitives.remove(m); return; }
        // a ghost is a pale, see-through rider
        if (o.ghost) { m.color = C.Color.fromCssColorString('#cfe8ff').withAlpha(0.42); m.colorBlendMode = C.ColorBlendMode.MIX; m.colorBlendAmount = 0.75; }
      });
      r.label = viewer.entities.add({
        position: roadPoint(o.distNow, 0, 2.3),
        label: { text: o.name, font: '600 15px system-ui', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
          style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, disableDepthTestDistance: 2000, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 600) },
      });
    }
    // glide towards where they are (no jumps when updates arrive)
    const gap = o.distNow - r.dist;
    r.dist = Math.abs(gap) > 50 ? o.distNow : r.dist + gap * Math.min(1, dt * 4);
    // whoosh when they pass us or we pass them (panned to their side)
    const ahead = Math.sign(r.dist - state.dist);
    if (!o.ghost && r.ahead && ahead && ahead !== r.ahead && Math.abs(r.dist - state.dist) < 4 && bike.v + o.speed > 3) sound.whoosh((r.side - state.mySide) / 2);
    if (ahead) r.ahead = ahead;
    // ghosts ride our line and pass through everyone; the rest keep their lanes and step aside
    r.speed = o.speed;
    const targetSide = o.ghost ? 0 : sideFor(r.dist, o.lane, o.id, solidRiders().concat([meRider()]), o.speed);
    r.side += (targetSide - r.side) * Math.min(1, dt * 2);
    r.crank += ((o.riding && !o.finished ? o.cadence : 0) / 60) * dt;
    if (!o.ghost) setStance(r.model, stanceStep(r.stance ||= {}, { watts: o.power || 0, grade: roadGrade(r.dist), cadence: o.cadence, dt, riding: o.riding && !o.finished }));
    const [wOff, wSlope] = wander(r.dist, o.id, r.draft || 0);
    r.wander = Number.isFinite(r.wander) ? r.wander + (wOff - r.wander) * Math.min(1, dt * 3) : wOff;
    const pos = roadPoint(r.dist, r.side + r.wander);
    const lean = cornerLean(r, r.dist, o.speed || 0, dt); // they lean into corners like we do
    if (r.model) orientModel(r.model, pos, route.tangent(r.dist) + Math.atan(wSlope), surfaceGrade(r.dist), lean); // along the road at their wheels (angled with their wander), pitched with the 3D road
    r.label.position = roadPoint(r.dist, r.side + r.wander, r.lift);
    r.label.show = !state.film; // Film mode: no name tags
  }
  for (const [id, r] of remotes) {
    if (seen.has(id)) continue;
    if (r.model) viewer.scene.primitives.remove(r.model);
    if (r.label) viewer.entities.remove(r.label);
    remotes.delete(id);
  }
  updateRiderList(list);
  updateLobby(now);
}

export function updateRiderList(list) {
  const panel = $('mp-panel');
  $('btn-chapeau').classList.toggle('hidden', !list.some((o) => !o.ghost));
  if (!list.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const u = U();
  const all = [{ id: mp.you, name: 'You', distNow: state.dist, power: Math.round(state.pHist.at(-1)?.[1] ?? 0), me: true }, ...list]
    .sort((a, b) => b.distNow - a.distNow);
  // a busy road: the list shows the 9 around you (the server sends the nearest 40, all drawn on the road)
  const at = all.findIndex((r) => r.me), from = Math.max(0, Math.min(at - 4, all.length - 9)), rows = all.slice(from, from + 9);
  const total = mp.total > all.length ? ` · ${mp.total} riding` : '';
  const fmtGap = (m) => {
    const sign = m >= 0 ? '+' : '−';
    if (Math.abs(m) >= 1000) return `${sign}${(Math.abs(m) / u.dist).toFixed(1)} ${u.distUnit}`;
    return `${sign}${Math.round(Math.abs(m) / (u.dist === 1000 ? 1 : 0.3048))} ${u.dist === 1000 ? 'm' : 'ft'}`;
  };
  panel.innerHTML = `<h3>${esc(mp.group ? mp.group.name : mp.room && list.some((o) => !o.bot && !o.ghost) ? 'Riding here now' : 'Riding with you')}${total}</h3>` + rows.map((r) => `
    <div class="mp-row${r.me ? ' me' : ''}${r.ghost ? ' ghost' : ''}"${r.me || r.ghost ? '' : ` data-id="${esc(r.id)}" title="Click: Chapeau! 🎩"`}><span class="n">${esc(r.name)}${(r.me ? state.draft : remotes.get(r.id)?.draft) > 0.1 ? '<span class="ro" title="In the draft">💨</span>' : ''}${performance.now() - (chapeaus.get(r.id) || -1e9) < 6000 ? '<span class="ro">🎩</span>' : ''}</span><span class="g">${r.me ? '' : fmtGap(r.distNow - state.dist)}</span><span class="w">${r.power === null ? '' : `${Math.round(r.power || 0)} W`}</span></div>`).join('');
}

// Group rides: waiting for the host, then a countdown, then everyone goes together
export function updateLobby() {
  const box = $('mp-lobby'), g = mp.group;
  if (!g || !mp.room?.startsWith('group:') || !viewer || state.finished) { box.classList.add('hidden'); return; }
  if (g.status === 'waiting') {
    box.classList.remove('hidden');
    const host = g.host === mp.you;
    $('mp-lobby-text').textContent = host
      ? `${g.name}: ${g.riders.length} rider${g.riders.length === 1 ? '' : 's'} here. Start when everyone's ready.`
      : `${g.name}: waiting for ${g.hostName} to start… (${g.riders.length} here)`;
    $('mp-start').classList.toggle('hidden', !host);
    $('btn-ride').disabled = true;
    return;
  }
  if (g.status === 'riding' && g.startAt && !state.riding && !state.finished && state.elapsed === 0) {
    const left = (g.startAt - mp.serverNow()) / 1000;
    box.classList.remove('hidden');
    $('mp-start').classList.add('hidden');
    if (left > 0) { $('mp-lobby-text').textContent = `Starting in ${Math.ceil(left)}…`; return; }
    $('mp-lobby-text').textContent = 'Go!';
    state.dist = 0; state.riding = true;
    $('btn-ride').disabled = false; $('btn-ride').textContent = 'Pause';
    setTimeout(() => box.classList.add('hidden'), 1200);
    return;
  }
  if (state.riding) setTimeout(() => box.classList.add('hidden'), 1200);
}

// Chapeau: a doff of the cap to another rider (H or 🎩 = the nearest one; or click their name in the list)
export const chapeaus = new Map(); // rider id -> when they last sent us one
export function giveChapeau(id) {
  if (!id) {
    const near = others().filter((o) => !o.ghost).sort((a, b) => Math.abs(a.distNow - state.dist) - Math.abs(b.distNow - state.dist))[0];
    id = near?.id;
  }
  if (!id || id.startsWith('ghost:')) return;
  const pacer = (state.pacers || []).find((p) => p.id === id);
  if (!pacer) { mp.send({ type: 'chapeau', to: id }); return; }
  if (performance.now() - (pacer.hatAt || 0) < 2000) return;
  pacer.hatAt = performance.now();
  sound.chime(0.12); toast(`🎩 Chapeau to ${pacer.name}`, 2500);
  setTimeout(() => { chapeaus.set(pacer.id, performance.now()); sound.chime(0.3); toast(`🎩 Chapeau from ${pacer.name}!`, 4000); }, 1200 + Math.random() * 1500);
}
export const wakes = new Map(); // follower id -> { lines: [entities], alpha: [] }
export const WAKE = [[-0.5, 0.45], [0.5, 0.45], [-0.4, 1.2], [0.4, 1.2], [0, 1.75]]; // streaks: [sideways, height] in metres
export function updateDrafts(dt) {
  if (!viewer || !route) return;
  const riders = solidRiders(), all = riders.concat([meRider()]);
  const ease = (cur, target) => cur + (target - cur) * Math.min(1, dt * 2);
  // ours: into the physics, the readout and (every couple of seconds, if it changed) the trainer
  const mine = riders.length ? draftFor(meRider(), riders) : { draft: 0, leader: null };
  state.draft = ease(state.draft, state.riding ? mine.draft : 0);
  bike.draft = state.draft;
  const now = performance.now();
  if (Math.abs(state.draft - (state.sentDraft ?? 0)) > 0.04 && now - (state.draftSentAt || 0) > 2000) {
    state.sentDraft = state.draft; state.draftSentAt = now;
    devices.setWindResistance(+$('cfg-cda').value, state.draft).catch(() => {});
  }
  const v = bike.v * (state.band || 1), saved = 0.5 * 1.225 * bike.cda * state.draft * v * v * v / bike.drivetrain;
  $('draft').classList.toggle('on', state.draft > 0.03);
  $('draft-pct').textContent = `${Math.round(state.draft * 100)}%`;
  $('draft-w').textContent = saved >= 1 ? `saves ${Math.round(saved)} W` : '';
  // pacers draft too (their own physics); real riders' own browsers do theirs, we only show it
  const leaders = new Map([[mp.you || 'me', state.draft > 0.03 ? mine.leader : null]]);
  for (const [id, r] of remotes) {
    if (r.ghost) continue;
    const d = draftFor({ id, dist: r.dist, side: r.side }, all);
    const pacer = (state.pacers || []).find((p) => p.id === id);
    r.draft = ease(r.draft || 0, pacer && !state.riding ? 0 : d.draft);
    if (pacer) pacer.bike.draft = r.draft;
    leaders.set(id, r.draft > 0.03 ? d.leader : null);
  }
  drawWakes(leaders);
}

// Streaks of moving air from the rider giving the draft back to the one taking it (ours brighter)
export function drawWakes(leaders) {
  const t = performance.now() / 1000;
  for (const [id, lead] of leaders) {
    const me = id === (mp.you || 'me');
    const follower = me ? { dist: state.dist, side: state.mySide, draft: state.draft } : { ...remotes.get(id) };
    let w = wakes.get(id);
    if (!lead || !follower || follower.draft < 0.03) { if (w) for (const l of w.lines) l.show = false; continue; }
    if (!w) {
      // positions as a CallbackProperty: they change every frame, and a plain value makes Cesium rebuild the line's
      // geometry in the background each time, so it never finished and nothing was drawn
      w = { pts: WAKE.map(() => []), alpha: WAKE.map(() => 0) };
      w.lines = WAKE.map((_, k) => viewer.entities.add({ polyline: { positions: new C.CallbackProperty(() => w.pts[k], false), width: me ? 8 : 4, arcType: C.ArcType.NONE,
        material: new C.PolylineGlowMaterialProperty({ glowPower: 0.22, taperPower: 0.85, color: new C.CallbackProperty(() => C.Color.fromCssColorString('#a9e4ff').withAlpha(w.alpha[k]), false) }) } }));
      wakes.set(id, w);
    }
    // from just behind the leader's back wheel, round the follower and just past them (from a chase camera
    // the air between the two is hidden behind our own rider, so it is drawn flowing down both sides and over the top)
    const from = lead.dist - 0.6, to = follower.dist - 1.3;
    if (lead.dist - follower.dist < BIKE_LEN) { for (const l of w.lines) l.show = false; continue; }
    const s01 = Math.min(1, follower.draft / 0.3), strength = me ? 0.4 + 0.5 * s01 : 0.2 + 0.3 * s01; // visible as soon as it counts
    WAKE.forEach(([dx, up], k) => {
      const pts = [], n = Math.max(2, Math.ceil((from - to) / 0.6));
      for (let i = 0; i <= n; i++) {
        const f = i / n, d = from - (from - to) * f;
        const centre = d > follower.dist ? lead.side + (follower.side - lead.side) * ((from - d) / Math.max(0.1, from - follower.dist)) : follower.side;
        const flare = 0.55 + 0.45 * Math.min(1, (from - d) / 1.5); // narrow off the leader's wheel, opening round us
        pts.push(roadPoint(d, centre + dx * flare, up));
      }
      w.pts[k] = pts;
      w.lines[k].show = true;
      w.alpha[k] = strength * (0.65 + 0.35 * Math.sin(t * 9 + k * 1.7)); // shimmer
    });
  }
  for (const [id, w] of wakes) if (!leaders.has(id)) { for (const l of w.lines) viewer.entities.remove(l); wakes.delete(id); }
}

// start-up: group ride lobby, chapeau (main.js runs these in order)
export async function initRiders() {
  state.mySide = 0;
  $('mp-start').addEventListener('click', () => mp.send({ type: 'start' }));
  mp.addEventListener('cancelled', (e) => { toast(e.detail.message, 6000); mp.leave(); $('btn-ride').disabled = false; refreshGroups(); });
  mp.addEventListener('error', (e) => toast(e.detail.message, 5000));
  $('btn-chapeau').addEventListener('click', () => giveChapeau());
  $('mp-panel').addEventListener('pointerdown', (e) => { const row = e.target.closest('[data-id]'); if (row) giveChapeau(row.dataset.id); });
  mp.addEventListener('chapeau', (e) => { chapeaus.set(e.detail.from, performance.now()); sound.chime(0.3); toast(`🎩 Chapeau from ${e.detail.name}!`, 4000); });
  mp.addEventListener('chapeau-sent', (e) => { sound.chime(0.12); toast(`🎩 Chapeau to ${e.detail.name}`, 2500); });
  mp.addEventListener('replaced', () => toast('You joined this ride from another window, so this one has left it.', 6000));
}

// start-up: drafting state (main.js runs these in order)
export async function initDrafting() {
  // ---------- drafting: less air resistance in someone's slipstream (draft.js), shown as streaks of moving air ----------
  state.draft = 0;
}
