// RideWorld server status: admins only (GET /api/admin/status refuses anyone else). Refreshes every 5 seconds.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ago = (t) => {
  if (!t) return '–';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const clock = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const day = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const card = (label, value, sub = '') => `<div class="card"><small>${esc(label)}</small><b>${value}</b>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([50, 0], 4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
const markers = new Map();
let fitted = false;

function draw(d) {
  const t = d.totals, s = d.server, live = d.live.people;
  const riding = live.filter((p) => p.ride && p.ride.started && !p.ride.finished && p.ride.ago < 15);
  $('cards').innerHTML = [
    card('Online now', live.length, live.length ? live.map((p) => esc(p.username)).join(', ') : 'nobody'),
    card('Riding now', riding.filter((p) => p.ride.riding).length, `${riding.filter((p) => !p.ride.riding).length} paused`),
    card('Accounts', t.accounts),
    card('Rides this week', t.ridesWeek, `${t.rides} in all`),
    card('Distance ridden', `${t.km} km`, `${t.hours} h`),
    card('Routes', t.routes, `${t.rideworldRoutes} RideWorld`),
    card('Group rides', t.groups),
    card('Registered interest', t.interest),
  ].join('');

  // the map: one dot per open ride
  const seen = new Set();
  for (const p of live) {
    const w = p.ride?.where;
    if (!w || !Number.isFinite(w.lat)) continue;
    seen.add(p.username);
    const colour = p.ride.riding ? '#22c55e' : '#f59e0b';
    const text = `<b>${esc(p.username)}</b><br>${esc(w.route)}<br>${(w.d / 1000).toFixed(1)} of ${(w.of / 1000).toFixed(1)} km · ${esc(p.ride.speed)} ${esc(p.ride.speedUnit)} · ${esc(p.ride.power)} W`;
    let m = markers.get(p.username);
    if (!m) { m = L.circleMarker([w.lat, w.lon], { radius: 8, weight: 2, color: '#fff', fillOpacity: 1 }).addTo(map); markers.set(p.username, m); }
    m.setLatLng([w.lat, w.lon]).setStyle({ fillColor: colour }).bindTooltip(text);
  }
  for (const [u, m] of markers) if (!seen.has(u)) { m.remove(); markers.delete(u); }
  if (!fitted && markers.size) { map.fitBounds(L.featureGroup([...markers.values()]).getBounds().pad(0.5), { maxZoom: 13 }); fitted = true; }

  $('online').innerHTML = live.length ? `<tr><th>Who</th><th>Doing</th><th>Route</th><th>Progress</th><th class="num">Ride time</th><th class="num">Speed</th><th class="num">Power</th><th class="num">HR</th><th>Room</th><th>Pages</th></tr>` + live.map((p) => {
    const r = p.ride, w = r?.where;
    const doing = !r ? '<span class="muted">setup screen</span>' : r.finished ? 'finished' : r.arrived ? 'at the end' : !r.started ? 'about to start' : r.riding ? '<span class="pill ride">riding</span>' : '<span class="pill pause">paused</span>';
    const prog = w ? `<div class="bar"><i style="width:${Math.min(100, (100 * w.d) / Math.max(1, w.of)).toFixed(0)}%"></i></div><span class="muted">${(w.d / 1000).toFixed(1)} / ${(w.of / 1000).toFixed(1)} km</span>` : '–';
    const room = p.room ? esc(p.room.replace(/^route:/, 'drop-in: ').replace(/^group:/, 'group: ')) : '<span class="muted">solo</span>';
    return `<tr><td><b>${esc(p.username)}</b>${r?.sim ? ' <span class="pill sim">simulator</span>' : ''}</td><td>${doing}</td><td>${esc(w?.route || '–')}</td><td>${prog}</td>
      <td class="num">${r ? clock(w?.secs) : '–'}</td><td class="num">${r ? esc(r.speed) + ' ' + esc(r.speedUnit) : '–'}</td><td class="num">${r ? esc(r.power) + ' W' : '–'}</td><td class="num">${r?.hr ? esc(r.hr) : '–'}</td>
      <td>${room}</td><td>${p.pages}${p.remote ? ' · phone remote' : ''}</td></tr>`;
  }).join('') : '<tr><td class="empty">Nobody has RideWorld open right now.</td></tr>';

  $('people').innerHTML = `<tr><th>Rider</th><th>Last active</th><th class="num">Rides</th><th class="num">This week</th><th class="num">Distance</th><th class="num">Time</th><th>Last ride</th><th class="num">Own routes</th><th>Joined</th></tr>` +
    d.people.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0)).map((p) => `<tr><td><b>${esc(p.name)}</b> <span class="muted">${esc(p.username)}</span>${p.admin ? ' <span class="pill">admin</span>' : ''}</td>
      <td>${ago(p.lastActive)}</td><td class="num">${p.rides}</td><td class="num">${p.ridesWeek}</td><td class="num">${p.km} km</td><td class="num">${p.hours} h</td><td>${day(p.lastRide)}</td><td class="num">${p.routes}</td><td>${day(p.created)}</td></tr>`).join('');

  $('recent').innerHTML = d.recent.length ? `<tr><th>When</th><th>Rider</th><th>Route</th><th class="num">Distance</th><th class="num">Time</th><th class="num">Avg power</th><th>Strava</th></tr>` +
    d.recent.map((r) => `<tr><td>${day(r.date)}</td><td>${esc(r.user)}</td><td>${esc(r.name)}</td><td class="num">${r.km} km</td><td class="num">${dur(r.time)}</td><td class="num">${r.avgPower ? r.avgPower + ' W' : '–'}</td><td>${r.strava ? '✓' : ''}</td></tr>`).join('')
    : '<tr><td class="empty">No rides yet.</td></tr>';

  const disk = (x) => (x ? `${x.freeGB} GB free` : '–'), diskSub = (x) => (x ? `of ${x.totalGB} GB` : '');
  $('server').innerHTML = [
    card('App up', dur(s.uptimeS), `since ${day(new Date(s.started).toISOString())}`),
    card('Load', s.load[0], `${s.load.join(' / ')} · ${s.cpus} cores`),
    card('App memory', `${s.rssMB} MB`, `${s.memFreeGB} of ${s.memTotalGB} GB free on the server`),
    card('System disk', disk(s.disk), diskSub(s.disk)),
    card('4TB disk', disk(s.disk4TB), diskSub(s.disk4TB)),
    card('Server up', dur(s.hostUptimeS), `Node ${esc(s.node)}`),
    card('Drive backup', s.driveBackup ? esc(s.driveBackup.split(/\s+/)[0]) : '–', esc(s.driveBackup || '')),
  ].join('');
}

let last = 0;
async function load() {
  try {
    const r = await fetch('/api/admin/status', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login.html?next=%2Fstatus'; return; }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    $('err').style.display = 'none';
    draw(d);
    last = Date.now();
  } catch (e) {
    $('err').textContent = 'Could not load the status: ' + e.message;
    $('err').style.display = 'block';
  }
}
setInterval(() => { const el = $('updated'); el.textContent = last ? `Updated ${new Date(last).toLocaleTimeString()} · every 5 s` : 'Loading…'; el.classList.toggle('stale', !!last && Date.now() - last > 20000); }, 1000);
load();
setInterval(load, 5000);
