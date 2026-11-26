// Ride clips (2026-11-16, the owner: "the ability to record ride videos ... a button in the RC so it can be pressed while
// riding a cool section ... set a max time ... it'll auto stop"). Records the 3D view (no dials or panels: clean
// footage) at 30 fps with MediaRecorder, stops by itself after the set length (Advanced → Ride clips, rw.clipSecs,
// default 60 s) or when pressed again, then uploads it in ~2 MB pieces (server.js /api/clips): kept with the rider's
// photos on the 4TB share, and the phone remote gets a link. V on the keyboard, ⏺ on the remote.
import { $, api, route, store, toast } from './core.js';
import { viewer } from './scenery.js';

export const clip = { rec: null, started: 0, secs: 60, last: null, uploading: false };

const pickType = () => ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));

export function toggleClip() { if (clip.rec) stopClip(); else startClip(); }

export function startClip() {
  if (clip.rec || clip.uploading || !viewer) return;
  const type = pickType();
  if (!type || !viewer.canvas.captureStream) { toast('This browser can\'t record video.', 4000); return; }
  clip.secs = Math.max(10, Math.min(300, +store.get('clipSecs', '60') || 60));
  const stream = viewer.canvas.captureStream(30), chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); upload(new Blob(chunks, { type: 'video/webm' })); };
  rec.start(1000);
  clip.rec = rec; clip.started = performance.now(); clip.last = null;
  clip.timer = setTimeout(() => stopClip(), clip.secs * 1000);
  document.body.classList.add('recording');
  toast(`⏺ Recording a clip (up to ${clip.secs} s; V or the remote stops it)`, 3000);
}
export function stopClip() {
  if (!clip.rec) return;
  clearTimeout(clip.timer);
  try { clip.rec.stop(); } catch {}
  clip.rec = null;
  document.body.classList.remove('recording');
}
async function upload(blob) {
  if (!blob.size) { toast('The clip came out empty (this browser gave no video frames).', 6000); console.warn('clip: no frames'); return; }
  clip.uploading = true;
  toast(`Saving the clip (${(blob.size / 1e6).toFixed(0)} MB)…`, 3000);
  try {
    const { id } = await api('api/clips', { method: 'POST', body: JSON.stringify({ route: route?.name }) });
    const PART = 2 * 1024 * 1024;
    let res = null;
    for (let o = 0; o < blob.size; o += PART) {
      const buf = new Uint8Array(await blob.slice(o, o + PART).arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      res = await api(`api/clips/${id}/part`, { method: 'POST', body: JSON.stringify({ data: btoa(bin), last: o + PART >= blob.size }) });
    }
    clip.last = res?.url || null;
    toast('🎬 Clip saved (with your photos on the share; the remote has a link)', 5000);
  } catch (e) {
    console.warn('clip upload failed', e);
    // keep it anyway: download it here
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `rideworld-clip-${Date.now()}.webm`; a.click();
    toast('Couldn\'t save the clip on the server: downloaded it here instead.', 6000);
  }
  clip.uploading = false;
}
export const clipStatus = () => (clip.rec ? { rec: true, left: Math.max(0, Math.round(clip.secs - (performance.now() - clip.started) / 1000)) } : clip.uploading ? { saving: true } : clip.last ? { url: clip.last } : null);

export function initClips() {
  const s = $('cfg-clipsecs');
  if (s) { s.value = store.get('clipSecs', '60'); s.addEventListener('change', () => store.set('clipSecs', s.value)); }
  window.addEventListener('keydown', (e) => { if ((e.key === 'v' || e.key === 'V') && viewer && !e.target.closest?.('input, textarea, select, dialog[open]')) toggleClip(); });
}
