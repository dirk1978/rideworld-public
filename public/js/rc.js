// Phone remote (/rc): sends the ride page's controls over the same WebSocket as multiplayer (server relays them to
// this account's open ride, see lib/multiplayer.js onRemote) and shows the ride's numbers and new screenshots.
const $ = (id) => document.getElementById(id);
let ws = null, retry = 0, lastStatus = 0;

function connect() {
  ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ type: 'rc-role', role: 'remote' })); $('conn').textContent = 'connected'; $('conn').className = 'ok'; };
  ws.onclose = () => { $('conn').textContent = 'reconnecting…'; $('conn').className = ''; setTimeout(connect, Math.min(8000, 800 * 2 ** retry++)); };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'rc-status') { lastStatus = Date.now(); show(m.s); }
    if (m.type === 'rc-shot') addShot(m.url);
  };
}

let sentSeen = null, failSeen = null, noteTimer = 0;
function note(t) { $('rep-ok').textContent = t; $('rep-ok').classList.remove('hidden'); clearTimeout(noteTimer); noteTimer = setTimeout(() => $('rep-ok').classList.add('hidden'), 5000); }

function show(s) {
  $('offline').classList.add('hidden');
  $('power').textContent = s.power ?? '–';
  $('wkg').textContent = s.wkg != null ? `${s.wkg} W/kg` : 'watts';
  // a report going through (the ride page counts them)
  if (s.reports) {
    if (sentSeen !== null && s.reports.sent > sentSeen) note('✓ Report sent');
    if (failSeen !== null && s.reports.failed > failSeen) note('Report not sent: try again from the PC (R).');
    sentSeen = s.reports.sent; failSeen = s.reports.failed;
  }
  $('hr').textContent = s.hr || '–';
  $('speed').textContent = s.speed ?? '–'; $('speedu').textContent = s.speedUnit || 'km/h';
  $('dist').textContent = s.dist ?? '–'; $('distu').textContent = s.distUnit || 'km';
  $('time').textContent = s.time ?? '–';
  $('grade').textContent = s.grade == null ? '–' : `${s.grade}%`;
  $('b-pause').textContent = s.finished ? 'Finished' : s.riding ? 'Pause' : 'Ride / resume';
  // music: what's playing, and the recent links (as on the PC's setup screen) to switch to (2026-11-24)
  if (s.music) {
    $('music-now').textContent = s.music.title ? `♫ ${s.music.title}` : '';
    const key = JSON.stringify(s.music.recent || []);
    if ($('music-list').dataset.k !== key) {
      $('music-list').dataset.k = key; $('music-list').innerHTML = '';
      for (const r of s.music.recent || []) {
        const b = document.createElement('button'); b.className = 'wide'; b.textContent = '♫ ' + r.title;
        b.addEventListener('click', () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: 'musicpick', n: r.n })); if (navigator.vibrate) navigator.vibrate(20); });
        $('music-list').appendChild(b);
      }
    }
  }
  $('wo').classList.toggle('hidden', !s.workout);
  $('wo-ctl').classList.toggle('hidden', !s.workout);
  $('gear-ctl').classList.toggle('hidden', s.gear == null); if (s.gear != null) $('gear-now').textContent = s.gear; // (virtual gears)
  if (s.workout) {
    $('wo').innerHTML = `<div class="muted">${esc(s.workout.name)} · ${s.workout.intensity}%</div><b>${esc(s.workout.now)}</b><div class="muted">${esc(s.workout.next || '')}</div>`;
    $('b-erg').textContent = s.workout.erg ? 'ERG on (tap for off)' : 'ERG off (tap for on)';
  }
  $('sim-ctl').classList.toggle('hidden', !s.sim);
  $('cam').textContent = s.cam || 'camera';
  $('film').textContent = s.film ? 'film mode on' : 'film mode';
  $('arrive').classList.toggle('hidden', !s.arrived);
  $('b-finish').classList.toggle('hidden', !s.started || !!s.finished || !!s.arrived);
  // open world: the junction ahead, as big buttons (tap = that way), and turning round
  $('b-uturn').classList.toggle('hidden', !s.open);
  const J = s.junction;
  $('junc').classList.toggle('hidden', !J);
  if (J) {
    $('junc-m').textContent = `${J.m} m`;
    const key = J.ways.map((w) => w.name + w.on).join('|');
    if ($('junc-ways').dataset.key !== key) {
      $('junc-ways').dataset.key = key; $('junc-ways').innerHTML = '';
      for (const w of J.ways) {
        const b = document.createElement('button'); b.className = w.on ? 'on' : '';
        const deg = Math.max(-150, Math.min(150, (w.turn * 180) / Math.PI));
        b.innerHTML = `<svg viewBox="-50 -50 100 100" style="transform:rotate(${Math.abs(w.turn) < 0.35 ? 0 : deg.toFixed(0)}deg)"><path d="M0 -44 L30 -6 L12 -6 L12 42 L-12 42 L-12 -6 L-30 -6 Z"/></svg><span></span>`;
        b.querySelector('span').textContent = w.name;
        b.addEventListener('click', () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: 'way', n: w.n })); if (navigator.vibrate) navigator.vibrate(30); });
        $('junc-ways').appendChild(b);
      }
    }
  }
  // satnav (open worlds): where to and how far; search results from the ride page
  $('nav').classList.toggle('hidden', !s.open);
  $('nav-cur').classList.toggle('hidden', !s.nav);
  if (s.nav) { $('nav-to').textContent = s.nav.name; $('nav-left').textContent = s.nav.left < 950 ? `${Math.round(s.nav.left / 10) * 10} m` : `${(s.nav.left / 1000).toFixed(1)} km`; $('nav-turn').classList.toggle('hidden', !s.nav.turn); }
  const R = s.navq && s.navq.q === navQ ? s.navq.results : [], key = navQ + '|' + R.map((r) => r.name).join('|');
  if ($('nav-res').dataset.key !== key) {
    $('nav-res').dataset.key = key; $('nav-res').innerHTML = '';
    for (const r of R) {
      const b = document.createElement('button'); b.type = 'button';
      b.innerHTML = `<span></span><span></span><small></small>`;
      b.children[0].textContent = NAV_IC[r.kind] || '📍'; b.children[1].textContent = r.name; b.children[2].textContent = r.d < 950 ? `${Math.round(r.d / 10) * 10} m` : `${(r.d / 1000).toFixed(1)} km`;
      const send = (cmd) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd, n: r.n })); navQ = null; $('nav-q').value = ''; $('nav-q').blur(); $('nav-res').innerHTML = ''; $('nav-res').dataset.key = ''; if (navigator.vibrate) navigator.vibrate(30); };
      b.addEventListener('click', () => send('navgo'));
      const j = document.createElement('button'); j.type = 'button'; j.className = 'jump'; j.textContent = '⤴'; j.title = 'Jump straight there'; j.addEventListener('click', () => send('navjump'));
      const row = document.createElement('div'); row.className = 'navrow'; row.append(b, j);
      $('nav-res').appendChild(row);
    }
  }
  // the clip recorder
  const c = s.clip;
  $('b-rec').classList.toggle('on', !!c?.rec);
  $('b-rec').firstChild.textContent = c?.rec ? `⏹ Stop clip (${c.left} s left)` : c?.saving ? 'Saving the clip…' : '⏺ Record clip';
  if (c?.url && c.url !== lastClip) { lastClip = c.url; $('rec-note').textContent = 'saved: it\'s in My clips below'; setTimeout(loadClips, 1500); setTimeout(loadClips, 60000); }
}
let lastClip = null;
const NAV_IC = { area: '🏘', pub: '🍺', bar: '🍺', cafe: '☕', restaurant: '🍴', shop: '🛒', school: '🏫', place_of_worship: '⛪', park: '🌳', street: '🛣', start: '🚩' };
let navQ = null, navT = 0;
$('nav-q').addEventListener('input', () => { clearTimeout(navT); navT = setTimeout(() => { navQ = $('nav-q').value; if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: 'navq', q: navQ })); }, 250); });
$('nav-q').addEventListener('focus', () => { if (!$('nav-q').value) { navQ = ''; if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: 'navq', q: '' })); } }); // (nothing typed: nearby villages)
$('nav-off').addEventListener('click', () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: 'navoff' })); if (navigator.vibrate) navigator.vibrate(15); });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function addShot(url) {
  const box = $('shots');
  if (!box.querySelector('a')) box.innerHTML = '';
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.innerHTML = `<img src="${url}" alt="Screenshot">`;
  box.prepend(a);
}

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: b.dataset.cmd }));
  if (navigator.vibrate) navigator.vibrate(15);
}));
// ⚑ Report: the ride page saves the spot and the screen now; the note follows (the owner 2026-11-02)
const rc = (cmd, extra = {}) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd, ...extra })); };
$('b-report').addEventListener('click', () => {
  if (Date.now() - lastStatus > 4000) return; // (no ride open)
  rc('report');
  $('rep-note').value = '';
  $('rep').classList.remove('hidden');
  $('rep-note').focus();
  if (navigator.vibrate) navigator.vibrate(15);
});
$('rep-send').addEventListener('click', () => { rc('reportsend', { note: $('rep-note').value }); $('rep').classList.add('hidden'); });
$('rep-cancel').addEventListener('click', () => { rc('reportcancel'); $('rep').classList.add('hidden'); });
// Finish asks here rather than on the PC (a dialog there would need the keyboard)
$('b-finish').addEventListener('click', () => {
  if (confirm('Finish the ride? You can save it and upload it to Strava on the PC.') && ws?.readyState === 1) ws.send(JSON.stringify({ type: 'rc', cmd: 'finish' }));
});
setInterval(() => { if (Date.now() - lastStatus > 4000) $('offline').classList.remove('hidden'); }, 1000);
// Back from another app: the phone froze this page, and its socket (and the retry timer) with it; the socket can
// still claim to be open. Start again straight away (the owner 2026-10-19: switching apps and back never reconnected).
function wake() {
  if (document.hidden) return;
  if (ws && ws.readyState === 1 && Date.now() - lastStatus < 5000) return; // fine: the ride is still talking to us
  retry = 0;
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
  $('conn').textContent = 'reconnecting…'; $('conn').className = '';
  connect();
}
document.addEventListener('visibilitychange', wake);
window.addEventListener('pageshow', wake);
window.addEventListener('online', wake);
connect();

// "Photos of my last ride" (the owner 2026-10-26: Strava's API can't take photos, so make adding them by hand quick):
// the newest saved ride's photos go to the phone's share sheet (Save to Photos / Gallery, or straight into the Strava
// app); where a phone can't share files, they're offered one by one to download
document.getElementById('b-photos').addEventListener('click', async () => {
  const msg = document.getElementById('photos-msg');
  msg.textContent = 'Fetching…';
  try {
    const { rides } = await (await fetch('/api/rides')).json();
    const r = (rides || []).find((x) => x.shots);
    if (!r) { msg.textContent = 'None of your saved rides has photos yet.'; return; }
    const files = [];
    for (let n = 1; n <= r.shots; n++) {
      const blob = await (await fetch(`/api/rides/${r.id}/photos/${n}.jpg`)).blob();
      files.push(new File([blob], `RideWorld ${r.date.slice(0, 10)} ${n}.jpg`, { type: 'image/jpeg' }));
    }
    if (navigator.canShare && navigator.canShare({ files })) {
      msg.textContent = `${files.length} photos from ${r.name}: choose Save (or Strava) in the share sheet.`;
      await navigator.share({ files, title: `${r.name} · RideWorld` }).catch(() => {});
      return;
    }
    msg.innerHTML = '';
    msg.append(`${files.length} photos from ${r.name}, tap each to save: `);
    files.forEach((f, i) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.textContent = ` ${i + 1}`; msg.append(a); });
  } catch (e) { msg.textContent = "Couldn't fetch the photos: " + e.message; }
});

// My clips (2026-11-21, the owner: "the downloading of videos from the remote is a real pain"): the rider's clips, newest
// first; ⬇ Save sends the MP4 to the phone's share sheet (Save video / Photos, or the Strava app), or downloads it where
// a phone can't share files. Converting to MP4 takes a minute or so after a clip is saved.
async function loadClips() {
  const box = document.getElementById('clips'), msg = document.getElementById('clips-msg');
  let clips = []; try { clips = (await (await fetch('/api/clips')).json()).clips || []; } catch { return; }
  box.innerHTML = ''; msg.textContent = clips.length ? '' : 'No clips yet: ⏺ Record clip above while riding.';
  for (const c of clips.slice(0, 8)) {
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border-radius:12px;padding:10px 12px';
    const when = new Date(c.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `<div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></b><small style="color:var(--muted)">${when} · ${(c.bytes / 1e6).toFixed(0)} MB</small></div>`;
    row.querySelector('b').textContent = c.route || 'Ride';
    const b = document.createElement('button'); b.style.cssText = 'min-width:110px;padding:12px 10px;font-size:16px';
    b.textContent = c.mp4 ? '⬇ Save' : 'converting…'; b.disabled = !c.mp4;
    b.addEventListener('click', async () => {
      b.textContent = 'fetching…';
      try {
        const blob = await (await fetch(`/api/clips/${c.id}.mp4`)).blob();
        const file = new File([blob], `RideWorld ${c.at.slice(0, 10)} ${c.id.slice(0, 4)}.mp4`, { type: 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: `${c.route || 'Ride'} · RideWorld` }).catch(() => {});
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
      } catch (e) { msg.textContent = "Couldn't fetch the clip: " + e.message; }
      b.textContent = '⬇ Save';
    });
    row.append(b); box.append(row);
  }
  if (clips.some((c) => !c.mp4)) setTimeout(loadClips, 30000);
}
loadClips();
