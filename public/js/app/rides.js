// My rides: each ride is kept on the server (lib/rides.js) with its stats and FIT file: saved at the finish, or when
// leaving a ride of a minute or more. The setup screen lists them (download the .fit again, upload to Strava, delete);
// with "Upload finished rides to Strava automatically" on, a finished ride goes straight to Strava.
import { analyseRide } from './analysis.js';
import { milestoneToast, refreshGoals, totals } from './goals.js';
import { $, api, esc, fmtDist, fmtTime, recorder, route, state, toast, U } from './core.js';
import { toFit } from '../fit.js';
import { readFit, samplesToGpx, samplesToTcx, saveFile } from '../formats.js';
import { currentInfo, stravaState } from './setup.js';
import { wo } from './workouts.js';
import { uploadShots } from './shots.js';

let rides = [], showAll = false;

// numbers for the list (the finish panel shows the same, formatted)
export function summarise(finished) {
  const s = recorder.samples, n = s.length || 1;
  const avg = (k) => s.reduce((a, x) => a + (x[k] || 0), 0) / n;
  const withHr = s.filter((x) => x.hr > 0), withCad = s.filter((x) => x.cadence > 0);
  let climbing = 0;
  for (let i = 1; i < s.length; i++) if (s[i].ele > s[i - 1].ele) climbing += s[i].ele - s[i - 1].ele;
  return {
    name: route?.name || 'Ride', routeId: currentInfo()?.id || null, time: Math.round(state.elapsed), distance: Math.round(s.at(-1)?.distance ?? state.dist),
    climbing: Math.round(climbing), avgPower: Math.round(avg('power')), maxPower: Math.round(Math.max(0, ...s.map((x) => x.power || 0))),
    avgHr: withHr.length ? Math.round(withHr.reduce((a, x) => a + x.hr, 0) / withHr.length) : null,
    avgCadence: withCad.length ? Math.round(withCad.reduce((a, x) => a + x.cadence, 0) / withCad.length) : null,
    avgSpeed: +avg('speed').toFixed(2), sim: $('cfg-sim').checked, finished, workout: wo.steps ? wo.name : null, ftp: state.rideFtp || +$('cfg-ftp').value || null,
  };
}

function fitBase64() {
  const fit = toFit(recorder.samples, { name: route.name, elapsed: state.elapsed });
  let bin = '';
  for (let i = 0; i < fit.length; i += 0x8000) bin += String.fromCharCode(...fit.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Keep this ride (once). Finished rides need 10 s of samples, unfinished ones a minute.
export async function saveRide(finished) {
  if (state.simUsed) return null; // simulator rides aren't kept (the owner 2026-10-18)
  if (state.rideId || recorder.samples.length < (finished ? 10 : 60)) return state.rideId || null;
  try {
    const summary = summarise(finished), before = totals(rides.filter((r) => !r.sim));
    const { ride } = await api('api/rides', { method: 'POST', body: JSON.stringify({ summary, fit: fitBase64() }) });
    state.rideId = ride.id;
    milestoneToast(before, totals([...rides.filter((r) => !r.sim), ride])); // (passing 1,000 km and so on)
    await uploadShots(ride.id); // the photos taken during the ride
    api(`api/rides/${ride.id}/log`, { method: 'POST', body: JSON.stringify({ csv: rideLogCsv() }) }).catch(() => {}); // (for checking the trainer later)
    // never uploaded to Strava by itself: the summary asks (the owner: it went up before he could say yes or no)
    return ride.id;
  } catch (e) { console.warn('ride not saved', e); return null; }
}

// the ride log: one row a second of what the trainer reported and what it was sent (⋯ menu → Log, and kept with each
// saved ride since 2026-11-03)
export function rideLogCsv() {
  const head = ['time_s', 'distance_m', 'power_w', 'cadence_rpm', 'hr_bpm', 'speed_kmh', 'trainer_speed_kmh', 'road_grade_pct', 'sent_grade_pct', 'erg_target_w', 'workout_target_w', 'draft_pct', 'band', 'simulator', 'cadence_from'];
  const rows = recorder.samples.map((x, i) => {
    const l = x.log || {};
    return [i + 1, x.distance.toFixed(1), Math.round(x.power || 0), Math.round(x.cadence || 0), x.hr || '', (x.speed * 3.6).toFixed(1), l.trainerSpeed == null ? '' : (l.trainerSpeed * 3.6).toFixed(1),
      l.grade ?? '', l.sentGrade == null ? '' : l.sentGrade.toFixed(2), l.ergTarget ?? '', l.woTarget ?? '', l.draft == null ? '' : (l.draft * 100).toFixed(1), l.band ?? '', l.sim ? 1 : 0, l.cadFrom ? `"${String(l.cadFrom).replace(/"/g, '')}"` : ''].join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function uploadSaved(id, description) {
  return api(`api/rides/${id}/strava`, { method: 'POST', body: JSON.stringify({ description }) });
}

// ---------- the setup screen list ----------
const when = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// the rider's ride clips (2026-11-21, the owner: "not sure how I can get them afterwards"): newest first, each playable here,
// a ⬇ MP4 to save it and × to delete; the server converts each clip to MP4 a minute or so after it's saved
let showAllClips = false;
export async function refreshClips() {
  let clips = []; try { clips = (await api('api/clips')).clips; } catch {}
  const head = $('clips-head'), box = $('clips-list'); if (!box) return;
  head.hidden = !clips.length;
  const list = showAllClips ? clips : clips.slice(0, 6);
  box.innerHTML = list.map((c) => `
    <div class="clip-row">
      <video src="api/clips/${c.id}.${c.mp4 ? 'mp4' : 'webm'}?play" preload="metadata" controls playsinline></video>
      <div class="clip-info"><strong>${esc(c.route || 'Ride')}</strong><span class="opt">${when(c.at)} · ${(c.bytes / 1e6).toFixed(0)} MB</span>
        <span class="clip-btns">${c.mp4 ? `<a class="btn small" href="api/clips/${c.id}.mp4" download>⬇ MP4</a>` : '<span class="opt">converting to MP4…</span>'} <a class="btn small" href="api/clips/${c.id}.webm" download title="The original recording">WebM</a> <button class="small" data-clip-del="${c.id}" title="Delete this clip">×</button></span></div>
    </div>`).join('') + (clips.length > 6 && !showAllClips ? `<button class="small" id="clips-all">Show all ${clips.length}</button>` : '');
  box.querySelectorAll('[data-clip-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this clip? (The copy on the 4TB share stays.)')) return;
    try { await api(`api/clips/${b.dataset.clipDel}`, { method: 'DELETE' }); } catch (e) { toast('Could not delete: ' + e.message); }
    refreshClips();
  }));
  $('clips-all')?.addEventListener('click', () => { showAllClips = true; refreshClips(); });
}
export async function refreshRides() {
  refreshClips();
  try { rides = (await api('api/rides')).rides; } catch { rides = []; }
  refreshGoals(rides);
  const list = showAll ? rides : rides.slice(0, 8);
  $('rides-list').innerHTML = rides.length ? list.map((r) => `
    <div class="ride-row">
      <div class="ride-main" data-analyse="${r.id}" title="Click for the full analysis"><strong>${esc(r.name)}</strong>${r.finished ? '' : ' <span class="opt">(left early)</span>'}${r.sim ? ' <span class="opt">(sim)</span>' : ''}
        <span class="opt">${when(r.date)}${r.workout ? ' · ' + esc(r.workout) : ''}</span>
        <span class="ride-stats">${r.share ? `<a href="/share/${r.share}" target="_blank" rel="noopener" title="This ride's photos">📸 ${r.shots}</a> <a href="api/rides/${r.id}/photos.zip" download title="Download all this ride's photos (.zip), to add on Strava">⬇</a> · ` : ''}${fmtTime(r.time || 0)} · ${fmtDist(r.distance || 0, 1)} · ${r.avgPower ?? 0} W${r.avgHr ? ` · ${r.avgHr} bpm` : ''}${r.climbing ? ` · ${Math.round(r.climbing * U().ele)} ${U().eleUnit} up` : ''}</span></div>
      <button class="small" data-analyse="${r.id}" title="Charts, intervals, zones and best efforts">📈</button>
      <a class="button small" href="api/rides/${r.id}.fit" download title="Download the .fit file">.fit</a>
      <button class="small" data-ride-as="tcx" data-id="${r.id}" title="Download as TCX">.tcx</button>
      <button class="small" data-ride-as="gpx" data-id="${r.id}" title="Download as GPX (with heart rate, cadence and power)">.gpx</button>
      ${r.strava ? `<a class="button small" ${r.strava.url ? `href="${r.strava.url}" target="_blank" rel="noopener"` : ''} title="Uploaded to Strava">Strava ✓</a>`
        : stravaState.connected ? `<button class="small" data-ride-strava="${r.id}" title="Upload to Strava">Strava</button>` : ''}
      <button class="small" data-ride-del="${r.id}" title="Delete this ride">×</button>
    </div>`).join('') + (rides.length > 8 ? `<button class="small" id="rides-more">${showAll ? 'Show fewer' : `Show all ${rides.length}`}</button>` : '')
    : '<p class="note">Your rides will be kept here: each one you finish, or leave after a minute or more.</p>';
  $('rides-list').querySelectorAll('[data-ride-strava]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Uploading…';
    try { await uploadSaved(b.dataset.rideStrava); toast('Uploaded to Strava.', 3000); } catch (e) { toast('Strava upload failed: ' + e.message, 6000); }
    refreshRides();
  }));
  // .tcx / .gpx made here from the stored .fit
  $('rides-list').querySelectorAll('[data-ride-as]').forEach((b) => b.addEventListener('click', async () => {
    const r = rides.find((x) => x.id === b.dataset.id), fmt = b.dataset.rideAs;
    try {
      const res = await fetch(`api/rides/${r.id}.fit`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const samples = readFit(await res.arrayBuffer()).filter((s) => s.time);
      const file = `${r.name.replace(/[^\w\- ]+/g, '').trim() || 'ride'} ${r.date.slice(0, 10)}.${fmt}`;
      if (fmt === 'tcx') saveFile(samplesToTcx(samples, r.name), 'application/vnd.garmin.tcx+xml', file);
      else saveFile(samplesToGpx(samples, r.name), 'application/gpx+xml', file);
    } catch (e) { toast('Could not convert the ride: ' + e.message); }
  }));
  $('rides-list').querySelectorAll('[data-ride-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this ride? (It stays on Strava if you uploaded it.)')) return;
    try { await api(`api/rides/${b.dataset.rideDel}`, { method: 'DELETE' }); } catch (e) { toast(e.message); }
    refreshRides();
  }));
  $('rides-more')?.addEventListener('click', () => { showAll = !showAll; refreshRides(); });
  $('rides-list').querySelectorAll('[data-analyse]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // (the photo links)
    analyseRide(rides.find((x) => x.id === el.dataset.analyse));
  }));
}

// start-up: the list
export async function initRides() {
  await refreshRides();
}
