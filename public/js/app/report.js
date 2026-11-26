// ⚑ Report a problem (⋯ menu, ☰ on phones, or R): a screenshot of what the rider sees plus exactly where and how
// they're riding (route, km, position, camera, settings, frame rate, device), with a note, sent to the server
// (lib/reports.js, data/reports/). Works while scrubbing in the simulator, so a whole route can be checked and every
// odd spot reported where it is (the owner 2026-10-26). The ride pauses while the dialog is open.
import { devices } from '../devices.js';
import { $, C, U, api, me, rideDist, route, state, toast } from './core.js';
import { CAMS } from './camera.js';
import { cleanRoad } from './cleanroad.js';
import { viewer } from './scenery.js';
import { grabScreen } from './shots.js';
import { groundHeight, roadGrade } from './survey.js';
import { currentInfo } from './setup.js';
import { inTube } from './tunnels.js';
import { world } from './world.js';

let shot = null, ctx = null, resume = false;
const r1 = (v, dp = 1) => (Number.isFinite(v) ? +v.toFixed(dp) : null);

// everything needed to find the spot again and see it the same way
function context() {
  const d = state.dist, p = route.at(d), cam = viewer.camera, cp = cam.positionCartographic;
  return {
    route: { id: currentInfo()?.id || null, name: route.name, length: r1(route.length, 0), reversed: !!state.legs },
    km: { ride: r1(d / 1000, 3), full: r1(route.km(d), 3), ridden: r1(rideDist() / 1000, 3), shown: $('m-dist').textContent + ' ' + $('m-dist-unit').textContent },
    at: { lat: r1(p.lat, 6), lon: r1(p.lon, 6), road: r1(groundHeight(d), 1), grade: r1(roadGrade(d), 1), inTube: inTube(d) },
    camera: {
      view: CAMS[state.cam]?.name, slideshow: !!state.slideshow, film: !!state.film,
      lat: r1(C.Math.toDegrees(cp.latitude), 6), lon: r1(C.Math.toDegrees(cp.longitude), 6), height: r1(cp.height, 1),
      heading: r1(C.Math.toDegrees(cam.heading), 0), pitch: r1(C.Math.toDegrees(cam.pitch), 0), fov: r1(C.Math.toDegrees(cam.frustum.fov), 0),
    },
    ride: { riding: !!state.riding, sim: !!$('cfg-sim')?.checked, elapsed: Math.round(state.elapsed), power: Math.round(devices.power), cadence: Math.round(devices.cadence) },
    trainer: { difficulty: +$('cfg-diff').value, sentGrade: devices.sentGrade, erg: devices.ergTarget, connected: devices.trainerConnected,
      kinds: [devices.ant?.fec.connected && 'ANT+ trainer', devices.bleTrainer?.connected && 'BLE trainer', devices.blePower?.connected && 'BLE power', devices.bleHr?.connected && 'BLE HR', devices.ant?.hr.connected && 'ANT+ HR'].filter(Boolean) },
    scenery: { lite: !!state.lite, world: world.data ? { chunks: [...world.chunks.keys()], hidden: [...world.chunks.values()].reduce((n, c) => n + (c.blds || []).filter((b) => b.hidden).length, 0) } : (state.lite ? 'not loaded' : null), cleanRoad: !!state.cleanRoad, roadWidth: cleanRoad.width, perf: $('perf')?.textContent || '', gpu: state.gpu?.renderer || null, tier: state.gpu?.name ?? state.gpu?.tier ?? null },
    device: { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, window: `${innerWidth}x${innerHeight}`, units: U().distUnit },
    page: location.pathname + location.search,
  };
}

export async function openReport() {
  if (!viewer || !route || $('dlg-report').open) return;
  resume = state.riding && !state.finished;
  if (resume) $('btn-ride').click(); // pause while writing
  ctx = context(); // before the screenshot, which takes a moment
  $('rep-where').textContent = `${route.name} · ${ctx.km.shown} · ${ctx.camera.view}${ctx.at.inTube ? ' · in a tunnel' : ''}`;
  $('rep-note').value = ''; $('rep-msg').textContent = ''; $('rep-img').removeAttribute('src');
  $('dlg-report').showModal();
  $('rep-note').focus();
  shot = await grabJpeg();
  if (shot) $('rep-img').src = URL.createObjectURL(shot);
  else $('rep-msg').textContent = 'No screenshot (the report still sends the position).';
}
async function grabJpeg() {
  try {
    const c = await grabScreen();
    const k = Math.min(1, 1600 / c.width), out = document.createElement('canvas');
    out.width = Math.round(c.width * k); out.height = Math.round(c.height * k);
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
    return await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.85));
  } catch { return null; }
}
const b64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

// From the phone remote (the owner 2026-11-02): ⚑ captures the spot and the picture at once, the ride carrying on and no
// dialog on the PC; the note comes from the phone a moment later. Status tells the phone how many have been sent.
const remote = { ctx: null, shot: null, busy: null };
export const remoteReports = { sent: 0, failed: 0 };
export function reportCapture() {
  if (!viewer || !route) return;
  remote.ctx = context();
  remote.busy = grabJpeg().then((s) => { remote.shot = s; });
}
export async function reportSend(note) {
  if (!remote.ctx) return;
  const c = remote.ctx;
  remote.ctx = null;
  try {
    await remote.busy;
    const image = remote.shot ? await b64(remote.shot) : null;
    await api('api/reports', { method: 'POST', body: JSON.stringify({ note: `${String(note || '').trim()} (from the phone)`.trim(), image, ctx: { ...c, user: me.username } }) });
    remoteReports.sent++;
    toast('Report sent from your phone', 2500);
  } catch { remoteReports.failed++; }
  remote.shot = null;
}
export function reportCancel() { remote.ctx = null; remote.shot = null; }

async function send(e) {
  e.preventDefault();
  $('rep-msg').textContent = 'Sending…';
  const image = shot ? await b64(shot) : null;
  try {
    await api('api/reports', { method: 'POST', body: JSON.stringify({ note: $('rep-note').value.trim(), image, ctx: { ...ctx, user: me.username } }) });
    close();
    toast('Report sent, thanks');
  } catch (err) { $('rep-msg').textContent = 'Not sent: ' + err.message; }
}

function close() {
  $('dlg-report').close();
  if (resume && !state.riding && !state.finished) $('btn-ride').click();
  resume = false;
}

export async function initReport() {
  $('btn-report').addEventListener('click', () => { $('dock-menu').classList.add('hidden'); openReport(); });
  $('rep-form').addEventListener('submit', send);
  $('rep-cancel').addEventListener('click', close);
  $('dlg-report').addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
}
