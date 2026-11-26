// Back on the road after the graphics give out (2026-11-21, the owner: an Intel laptop lost its WebGL context starting
// from Stoke Heath at 1500 W: "Fragment shader failed to compile", the 3D view dead). A lost WebGL context can't be
// brought back inside Cesium, so: note where the rider is, save the ride so far (a real ride of a minute or more, as
// leaving early would), reload the page, and start again at the same spot (an open world from that point, a route at that
// distance), simulator or not as before. Only once in 3 minutes, so a machine that keeps failing isn't stuck in a loop.
import { $, route, state, store, toast } from './core.js';
import { viewer } from './scenery.js';
import { currentInfo } from './setup.js';
import { ow } from './openworld.js';

const KEY = 'rw.recover';
let busy = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function onLost(e) {
  if (busy || !state.riding && !(state.elapsed > 0)) return;
  e?.preventDefault?.();
  busy = true;
  let last = null; try { last = JSON.parse(localStorage.getItem(KEY + '.last') || 'null'); } catch {}
  if (last && Date.now() - last < 180000) { toast('The graphics stopped again. Reload the page (lower Detail in Settings may help).', 12000); return; }
  const info = currentInfo(), p = route?.at ? route.at(state.dist) : null;
  const rec = { at: Date.now(), id: info?.id, open: !!ow?.on, dist: state.dist, lat: p?.lat, lon: p?.lon, sim: !!$('cfg-sim')?.checked, ride: ow?.ride?.id || null };
  toast('The graphics ran out of memory: restarting the 3D view where you are…', 6000);
  try { if (!rec.sim && (state.elapsed || 0) > 60) { const R = await import('./rides.js'); await R.saveRide(false); } } catch (err) { console.warn('recover: save', err); }
  try { localStorage.setItem(KEY, JSON.stringify(rec)); localStorage.setItem(KEY + '.last', String(Date.now())); } catch {}
  await wait(1200);
  location.reload();
}

async function resumeAfter() {
  let r = null; try { r = JSON.parse(localStorage.getItem(KEY) || 'null'); localStorage.removeItem(KEY); } catch {}
  if (!r || Date.now() - r.at > 180000 || !r.id) return;
  await wait(2000); // (the route list and the settings load)
  const info = currentInfo();
  if (!info || info.id !== r.id) { toast('The 3D view was restarted after a graphics error: pick your route again.', 8000); return; }
  // an open world: start from the spot (the map editor's "start from" point, put back as it was afterwards)
  let keep = null;
  if (r.open && Number.isFinite(r.lat) && !r.ride) {
    keep = { pt: store.get('owPoint.' + r.id, null), st: store.get('owStart.' + r.id, null) };
    store.set('owPoint.' + r.id, JSON.stringify({ lat: r.lat, lon: r.lon }));
    const sel = document.querySelector('#ow-start-row select');
    if (sel) { if (![...sel.options].some((o) => o.value === 'pt')) { const o = document.createElement('option'); o.value = 'pt'; o.textContent = '📍 Where you were'; sel.appendChild(o); } sel.value = 'pt'; }
  }
  const go = r.sim ? $('btn-go-sim') : $('btn-go');
  for (let k = 0; k < 100 && go?.disabled; k++) await wait(200); // (sensors reconnecting by themselves)
  if (!go || go.disabled) { toast('The 3D view was restarted after a graphics error. Connect your sensors and press Go ride to carry on.', 10000); return; }
  go.click();
  for (let k = 0; k < 600 && $('hud').classList.contains('hidden'); k++) await wait(200);
  if (keep) { if (keep.pt == null) { try { localStorage.removeItem('rw.owPoint.' + r.id); } catch {} } else store.set('owPoint.' + r.id, keep.pt); if (keep.st != null) store.set('owStart.' + r.id, keep.st); }
  if (!r.open && Number.isFinite(r.dist)) state.dist = Math.max(0, Math.min(route.length - 1, r.dist));
  // a pre-plotted route: the same route (its start is still the chosen one), jumped to the spot, on to the next waypoint
  if (r.open && r.ride && Number.isFinite(r.lat)) {
    await wait(1500);
    const O = await import('./openworld.js'), R = O.ow.ride;
    if (R && R.id === r.ride) {
      try { O.ow.debug.jumpTo(r.lat, r.lon); } catch (err) { console.warn('recover: jump', err); }
      let k = 0, best = Infinity; R.via.forEach((v, i) => { const d = Math.hypot((v.lat - r.lat) * 110540, (v.lon - r.lon) * 68000); if (d < best) { best = d; k = i; } });
      R.next = Math.min(R.via.length - 1, Math.max(1, k + 1)); const v = R.via[R.next];
      O.setNav({ name: v.name, lat: v.lat, lon: v.lon }); O.ow.ride = R;
    }
  }
  toast('Back where you were (the graphics were restarted).', 6000);
}

export function initRecover() {
  // the viewer is made at Load scenery: hook its canvas once it exists
  const seen = new WeakSet();
  setInterval(() => { const c = viewer?.canvas; if (c && !seen.has(c)) { seen.add(c); c.addEventListener('webglcontextlost', onLost); } }, 1000);
  resumeAfter().catch((e) => console.warn('recover: resume', e));
}
