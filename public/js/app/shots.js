// Photos for showing the ride off: a few screenshots taken automatically at random moments (every 4-7 minutes,
// the first after 2-5), kept with the ride in My rides. the owner wants them to show everything on screen (dials, map,
// rider list...), which a page can't draw itself, so at Load scenery Chrome is asked to share this tab with the page
// (getDisplayMedia, preferCurrentTab: one click) and photos are frames of that; if refused, the 3D view alone. At the end up to four, spread over the ride, are uploaded
// (lib/rides.js addShot) and shown on the finish panel to download; the ride's photo page (/share/<code>) shows
// them too. Strava's API can't add photos, so they go up to Strava by hand.
/* global ImageCapture */
import { $, api, state, store } from './core.js';
import { captureFrame } from './hud.js';
import { ed } from './editor.js';

const KEEP = 8, UPLOAD = 4;
const shots = []; // { t (ride s), blob }
const manual = []; // taken from the phone remote: always kept with the ride
let nextAt = null, busy = false, track = null;

// at Load scenery (needs the click): ask to share this tab; resolves to true if we may photograph the whole screen
export async function startTabCapture() {
  if (!photosOn() || !navigator.mediaDevices?.getDisplayMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 5 }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
    });
    track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { track = null; });
    return true;
  } catch { return false; } // cancelled: photos of the 3D view only
}
export function stopTabCapture() { if (track) { track.stop(); track = null; } }

// a frame of the shared tab as a canvas (null if not sharing)
async function grabTab() {
  if (!track || track.readyState !== 'live') return null;
  const bmp = await new ImageCapture(track).grabFrame();
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}

const rand = (a, b) => a + Math.random() * (b - a);
export const photosOn = () => store.get('autoShots', '1') === '1';

// every frame
export function updateShots() {
  if (!photosOn() || !state.riding || state.finished || ed.on || busy) return;
  if (nextAt === null) nextAt = rand(120, 300);
  if (state.elapsed < nextAt) return;
  nextAt = state.elapsed + rand(240, 420);
  busy = true;
  grabTab().catch(() => null).then((c) => c || captureFrame()).then((c) => {
    // JPEG, at most 1920 wide
    const k = Math.min(1, 1920 / c.width), out = document.createElement('canvas');
    out.width = Math.round(c.width * k); out.height = Math.round(c.height * k);
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
    out.toBlob((blob) => {
      if (blob) shots.push({ t: state.elapsed, blob });
      if (shots.length > KEEP) shots.splice(Math.floor(Math.random() * (shots.length - 1)) + 1, 1); // thin out, keep the first
      busy = false;
    }, 'image/jpeg', 0.86);
  }).catch(() => { busy = false; });
}

// the remote's screenshots first, then up to four of the automatic ones spread over the ride (8 at most)
function pick() {
  return [...manual, ...spread()].slice(0, 8);
}
function spread() {
  if (shots.length <= UPLOAD) return shots;
  return Array.from({ length: UPLOAD }, (_, i) => shots[Math.round((i * (shots.length - 1)) / (UPLOAD - 1))]);
}

// a screenshot right now (phone remote): the whole tab if it's being shared, else the 3D view; kept with the ride
// the screen as the rider sees it: the whole tab if it's being shared, else the 3D view + caption strip
export async function grabScreen() {
  return (await grabTab().catch(() => null)) || (await captureFrame());
}

export async function snapNow() {
  const c = await grabScreen();
  const k = Math.min(1, 1920 / c.width), out = document.createElement('canvas');
  out.width = Math.round(c.width * k); out.height = Math.round(c.height * k);
  out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.88));
  manual.push({ t: state.elapsed, blob });
  return blob;
}

// after the ride is saved: upload them and show them on the finish panel
export async function uploadShots(rideId) {
  stopTabCapture();
  const list = pick();
  if (!rideId || !list.length) return null;
  let url = null;
  const thumbs = [];
  for (const s of list) {
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(s.blob); });
    try {
      const r = await api(`api/rides/${rideId}/shots`, { method: 'POST', body: JSON.stringify({ image: b64 }) });
      url = r.url;
      thumbs.push(`<a href="${URL.createObjectURL(s.blob)}" download="RideWorld photo ${thumbs.length + 1}.jpg" title="Download"><img src="${URL.createObjectURL(s.blob)}" alt=""></a>`);
    } catch (e) { console.warn('photo not saved', e); }
  }
  if (thumbs.length) {
    // (Strava's API can't add photos, so: all of them in one download, ready for the activity's "Add photos")
    $('finish-photos').innerHTML = `<p class="note">📸 Photos from your ride, ready to add on Strava: <a class="button small" href="api/rides/${rideId}/photos.zip" download>⬇ Download all</a> (or click one, or <a href="${url}" target="_blank" rel="noopener">open them all</a>). On your phone, the remote's 📸 button saves them to your gallery.</p><div class="thumbs">${thumbs.join('')}</div>`;
    $('finish-photos').classList.remove('hidden');
  }
  return url;
}

export async function initShots() {
  $('cfg-shots').checked = photosOn();
  $('cfg-shots').addEventListener('change', () => store.set('autoShots', $('cfg-shots').checked ? '1' : '0'));
}
