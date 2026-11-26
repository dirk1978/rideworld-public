// Ride analysis (2026-10-30, the owner's list: "the biggest gap"): a ride in full, from its FIT (My rides, the coach's
// recent rides) or from this ride's samples (the finish summary, simulator rides included).
// - Tiles: time, distance, climbing, average / normalized power, IF / TSS, work, heart rate, cadence, speed.
// - Charts on one timeline (moving time; pauses left out): power (smoothing 1 / 5 / 30 s, each column in its zone's
//   colour), heart rate (over its zones), cadence, speed, elevation. One crosshair and readout across all of them;
//   drag to select a stretch (its numbers in the bar above), Zoom to it, Reset.
// - Intervals found in the ride: 60 s+ at 88%+ of FTP (sweet spot and up; dips under 20 s don't end one) and 10-60 s
//   bursts at 120%+ not inside one; click one to select it.
// - Time in power and heart-rate zones, and best efforts against your last 90 days (coach.js bests90).
// The FTP is the one the ride was ridden at when the ride has it, else today's.
import * as M from '../coach-math.js';
import { hrBands } from '../gauges.js';
import { readFit } from '../formats.js';
import { $, esc, fmtTime, kg, recorder, U } from './core.js';
import { ZCOL, bests90 } from './coach.js';

const A = { s: null, sel: null, view: null, smooth: 5, ftp: 250, drag: null };
const ftpNow = () => +$('cfg-ftp').value || 250;
const maxHrNow = () => +$('cfg-maxhr').value || 185;

// 1 Hz series of moving time: gaps up to 5 s hold the last values, longer gaps (pauses) are left out
function series(recs) {
  const s = { p: [], h: [], c: [], v: [], e: [], d: [] };
  let last = null, prev = null;
  for (const r of recs) {
    const t = +new Date(r.time);
    if (!Number.isFinite(t)) continue;
    const gap = last === null ? 1 : Math.round((t - last) / 1000);
    if (gap < 1) continue;
    const n = gap <= 5 ? gap : 1;
    const v = r.speed != null ? r.speed * 3.6 : 0, e = r.ele ?? prev?.ele ?? null, d = r.distance ?? prev?.distance ?? 0;
    for (let k = 0; k < n; k++) { s.p.push(Math.max(0, r.power || 0)); s.h.push(r.hr || 0); s.c.push(r.cadence || 0); s.v.push(v); s.e.push(e); s.d.push(d); }
    last = t; prev = { ele: e, distance: d };
  }
  return s;
}
const rolling = (a, w) => { if (w <= 1) return a.slice(); const o = []; let sum = 0; for (let i = 0; i < a.length; i++) { sum += a[i]; if (i >= w) sum -= a[i - w]; o.push(sum / Math.min(w, i + 1)); } return o; };
const avg = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);
const nz = (a) => a.filter((x) => x > 0);

// numbers for indices [a, b)
function stats(a, b) {
  const s = A.s, p = s.p.slice(a, b), h = nz(s.h.slice(a, b)), c = nz(s.c.slice(a, b));
  let climb = 0;
  for (let i = a + 1; i < b; i++) if (s.e[i] != null && s.e[i - 1] != null && s.e[i] > s.e[i - 1]) climb += s.e[i] - s.e[i - 1];
  const np = p.length >= 30 ? M.normalizedPower(p) : avg(p), IF = np / A.ftp;
  return {
    secs: b - a, avgP: avg(p), np, IF, tss: ((b - a) / 3600) * IF * IF * 100, kj: p.reduce((t, x) => t + x, 0) / 1000,
    hr: avg(h), hrMax: h.length ? Math.max(...h) : 0, cad: avg(c), dist: (s.d[b - 1] ?? 0) - (s.d[a] ?? 0), climb, speed: avg(s.v.slice(a, b)),
  };
}

// ---------- intervals ----------
function intervals() {
  const s = A.s, p10 = rolling(s.p, 10), on = A.ftp * 0.88, out = [];
  let i = 0;
  while (i < p10.length) {
    if (p10[i] < on) { i++; continue; }
    let j = i, below = 0;
    while (j < p10.length && below < 20) { below = p10[j] < on ? below + 1 : 0; j++; }
    const end = j - below; // (the trailing dip isn't part of it)
    const a = Math.max(0, i - 9); // the 10 s average rises late: start where the effort did
    if (end - a >= 60) out.push([a, end]);
    i = j;
  }
  const p5 = rolling(s.p, 5), hi = A.ftp * 1.2;
  for (let k = 0; k < p5.length; k++) {
    if (p5[k] < hi || out.some(([a, b]) => k >= a && k < b)) continue;
    let j = k; while (j < p5.length && p5[j] >= hi * 0.9) j++;
    const a = Math.max(0, k - 4);
    if (j - a >= 10 && j - a < 60 && !out.some(([x, y]) => a < y && j > x)) out.push([a, j]);
    k = j;
  }
  return out.sort((x, y) => x[0] - y[0]).slice(0, 40).map(([a, b]) => ({ a, b, ...stats(a, b) }));
}

// ---------- charts (canvas; one per measure, the same timeline) ----------
const CHARTS = [
  { k: 'p', label: 'Power', unit: 'W', h: 150 },
  { k: 'h', label: 'Heart rate', unit: 'bpm', h: 100, color: '#e5487f' },
  { k: 'c', label: 'Cadence', unit: 'rpm', h: 80, color: '#3d8fe6' },
  { k: 'v', label: 'Speed', unit: 'km/h', h: 80, color: '#c28512' },
  { k: 'e', label: 'Elevation', unit: 'm', h: 70, color: '#9aa3b5' },
];
const LEFT = 44;
const zoneOf = (w) => { const f = w / A.ftp; return Math.max(0, M.ZONES.findIndex((z) => f < z.to)); };

function draw() {
  const s = A.s, [v0, v1] = A.view, wrap = $('an-charts'), W = wrap.clientWidth;
  const dpr = devicePixelRatio || 1, span = v1 - v0, px = (i) => LEFT + ((i - v0) / span) * (W - LEFT - 6);
  const pS = rolling(s.p, A.smooth);
  for (const ch of CHARTS) {
    const cv = $('an-c-' + ch.k);
    if (!cv) continue;
    const H = ch.h;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const data = ch.k === 'p' ? pS : ch.k === 'e' ? s.e.map((x) => x ?? NaN) : s[ch.k];
    const vis = data.slice(v0, v1).filter((x) => Number.isFinite(x) && (ch.k === 'e' || x > 0));
    if (!vis.length) { g.fillStyle = '#6f7a94'; g.font = '12px system-ui'; g.fillText(`No ${ch.label.toLowerCase()} in this ride`, LEFT + 8, H / 2); continue; }
    let lo = ch.k === 'e' ? Math.min(...vis) : 0, hi = Math.max(...vis);
    if (ch.k === 'e') { const pad = Math.max(10, (hi - lo) * 0.1); lo -= pad; hi += pad; } else hi *= 1.08;
    if (ch.k === 'h') lo = Math.max(0, Math.min(...vis) - 10);
    const y = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 12);
    // backgrounds: heart-rate zones, power's FTP line
    if (ch.k === 'h') for (const b of hrBands(maxHrNow())) { const a = Math.max(lo, b.from), z = Math.min(hi, b.to); if (z > a) { g.fillStyle = b.color + '18'; g.fillRect(LEFT, y(z), W - LEFT, y(a) - y(z)); } }
    // grid and axis
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#6f7a94'; g.font = '10.5px system-ui'; g.textAlign = 'right';
    for (const f of [0.25, 0.5, 0.75, 1]) { const v = lo + (hi - lo) * f, yy = y(v); g.beginPath(); g.moveTo(LEFT, yy); g.lineTo(W, yy); g.stroke(); g.fillText(Math.round(v), LEFT - 6, yy + 4); }
    // one column per pixel
    const cols = Math.max(1, Math.floor(W - LEFT - 6));
    if (ch.k === 'p') {
      for (let x = 0; x < cols; x++) {
        const a = v0 + Math.floor((x / cols) * span), b = Math.max(a + 1, v0 + Math.floor(((x + 1) / cols) * span));
        const m = avg(pS.slice(a, b));
        g.fillStyle = ZCOL[zoneOf(m)]; g.globalAlpha = 0.85;
        g.fillRect(LEFT + x, y(m), 1.2, y(0) - y(m));
      }
      g.globalAlpha = 1;
      if (A.ftp < hi) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(LEFT, y(A.ftp)); g.lineTo(W, y(A.ftp)); g.stroke(); g.setLineDash([]); g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(`FTP ${A.ftp}`, LEFT + 4, y(A.ftp) - 4); }
    } else {
      g.beginPath(); let pen = false;
      for (let x = 0; x < cols; x++) {
        const a = v0 + Math.floor((x / cols) * span), b = Math.max(a + 1, v0 + Math.floor(((x + 1) / cols) * span));
        const vals = data.slice(a, b).filter((q) => Number.isFinite(q) && (ch.k === 'e' || q > 0));
        if (!vals.length) { pen = false; continue; }
        const m = avg(vals), yy = y(m);
        if (pen) g.lineTo(LEFT + x, yy); else g.moveTo(LEFT + x, yy);
        pen = true;
      }
      if (ch.k === 'e') { g.lineTo(W - 6, H); g.lineTo(LEFT, H); g.closePath(); g.fillStyle = 'rgba(154,163,181,.22)'; g.fill(); }
      else { g.strokeStyle = ch.color; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke(); }
    }
    g.textAlign = 'left'; g.fillStyle = '#c3cbd8'; g.font = '700 10.5px system-ui';
    g.fillText(ch.label.toUpperCase(), LEFT + 6, 15);
  }
  // time axis
  const ax = $('an-axis'), step = niceTime(span / 6);
  let html = '';
  for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) html += `<span style="left:${px(t)}px">${fmtTime(t)}</span>`;
  ax.innerHTML = html;
  drawSel();
}
const niceTime = (s) => [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find((x) => x >= s) || 7200;
function drawSel() {
  const el = $('an-sel');
  if (!A.sel) { el.classList.add('hidden'); return; }
  const [v0, v1] = A.view, W = $('an-charts').clientWidth, px = (i) => LEFT + ((i - v0) / (v1 - v0)) * (W - LEFT - 6);
  const a = Math.max(px(A.sel[0]), LEFT), b = Math.min(px(A.sel[1]), W - 6);
  if (b <= a) { el.classList.add('hidden'); return; }
  el.style.left = a + 'px'; el.style.width = (b - a) + 'px'; el.classList.remove('hidden');
}

// ---------- the numbers bar, tiles, intervals, zones, bests ----------
const tile = (k, v, sub = '') => `<div class="ct"><span class="ct-k">${k}</span><b class="ct-v">${v}</b><span class="ct-s">${sub}</span></div>`;
const dist = (m) => `${(m / U().dist).toFixed(m / U().dist < 10 ? 2 : 1)}<small> ${U().distUnit}</small>`;
function rangeText(r) {
  return `<b>${fmtTime(r.secs)}</b> · ${Math.round(r.avgP)} W avg · NP ${Math.round(r.np)} · ${(r.avgP / kg.rider).toFixed(2)} W/kg${r.hr ? ` · ${Math.round(r.hr)} bpm` : ''}${r.cad ? ` · ${Math.round(r.cad)} rpm` : ''}${r.dist > 0 ? ` · ${(r.dist / U().dist).toFixed(2)} ${U().distUnit}` : ''}${r.climb >= 1 ? ` · ↑ ${Math.round(r.climb * U().ele)} ${U().eleUnit}` : ''}`;
}
function renderBar() {
  const r = A.sel ? stats(A.sel[0], A.sel[1]) : null;
  $('an-bar-text').innerHTML = r ? `Selected ${fmtTime(A.sel[0])}–${fmtTime(A.sel[1])}: ${rangeText(r)}` : 'Drag across the charts to see any stretch\'s numbers';
  $('an-zoom').classList.toggle('hidden', !A.sel);
  $('an-reset').classList.toggle('hidden', !A.sel && A.view[0] === 0 && A.view[1] === A.s.p.length);
}
function renderTiles() {
  const r = stats(0, A.s.p.length);
  $('an-tiles').innerHTML = [
    tile('Moving time', fmtTime(r.secs)), tile('Distance', dist(r.dist)), tile('Climbing', `${Math.round(r.climb * U().ele)}<small> ${U().eleUnit}</small>`),
    tile('Average power', `${Math.round(r.avgP)}<small> W</small>`, `${(r.avgP / kg.rider).toFixed(2)} W/kg`),
    tile('Normalized power', `${Math.round(r.np)}<small> W</small>`, `IF ${r.IF.toFixed(2)} · FTP ${A.ftp}`),
    tile('Training stress', Math.round(r.tss), `${Math.round(r.kj)} kJ`),
    tile('Heart rate', r.hr ? `${Math.round(r.hr)}<small> bpm</small>` : '–', r.hrMax ? `max ${r.hrMax}` : ''),
    tile('Cadence', r.cad ? `${Math.round(r.cad)}<small> rpm</small>` : '–', ''),
    tile('Speed', `${(r.speed * (U().speed / 3.6)).toFixed(1)}<small> ${U().speedUnit}</small>`, 'average moving'),
  ].join('');
}
function renderIntervals() {
  const list = intervals();
  $('an-intervals').innerHTML = list.length ? `<table class="cc-table an-int"><thead><tr><th></th><th>Start</th><th>Time</th><th>Power</th><th>% FTP</th><th>NP</th><th>HR</th><th>Cadence</th></tr></thead><tbody>${list.map((x) => {
    const z = zoneOf(x.avgP);
    return `<tr data-a="${x.a}" data-b="${x.b}" title="Click to select it"><td><i class="zchip" style="background:${ZCOL[z]}" title="Z${z + 1} ${M.ZONES[z].name}"></i></td><td>${fmtTime(x.a)}</td><td>${fmtTime(x.secs)}</td><td><b>${Math.round(x.avgP)} W</b></td><td>${Math.round((x.avgP / A.ftp) * 100)}%</td><td>${Math.round(x.np)}</td><td>${x.hr ? Math.round(x.hr) : '–'}</td><td>${x.cad ? Math.round(x.cad) : '–'}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="note">No sustained efforts (a minute or more at 88% of FTP or above) or hard bursts in this ride.</p>';
}
function zoneBars(secs, names, cols) {
  const tot = secs.reduce((a, b) => a + b, 0) || 1, top = Math.max(...secs, 1);
  return secs.map((s, i) => `<div class="an-zrow"><span class="an-zk"><i style="background:${cols[i]}"></i>${names[i]}</span><span class="an-zbar"><i style="width:${((s / top) * 100).toFixed(1)}%;background:${cols[i]}"></i></span><span class="an-zv"><b>${fmtTime(s)}</b> ${Math.round((s / tot) * 100)}%</span></div>`).join('');
}
function renderZones() {
  const s = A.s, [a, b] = A.sel || [0, s.p.length];
  const pz = M.ZONES.map(() => 0); for (let i = a; i < b; i++) pz[zoneOf(s.p[i])]++;
  const bands = hrBands(maxHrNow()), hz = bands.map(() => 0);
  let any = false;
  for (let i = a; i < b; i++) { const h = s.h[i]; if (!h) continue; any = true; const k = bands.findIndex((x) => h < x.to); hz[k < 0 ? bands.length - 1 : k]++; }
  $('an-zones').innerHTML = `<h3>Power zones${A.sel ? ' <small>selection</small>' : ''}</h3>${zoneBars(pz, M.ZONES.map((z, i) => `Z${i + 1} ${z.name}`), ZCOL)}`
    + (any ? `<h3>Heart-rate zones</h3>${zoneBars(hz, bands.map((_, i) => `Z${i + 1}`), bands.map((x) => x.color))}` : '');
}
async function renderBests() {
  const s = A.s, mine = {};
  for (const d of [5, 15, 30, 60, 300, 600, 1200, 1800, 3600]) if (d <= s.p.length) mine[d] = Math.round(M.bestAvg(s.p, d));
  let b90 = {};
  try { b90 = await bests90(); } catch {}
  const w = (x) => (x == null ? 0 : typeof x === 'object' ? x.w : x);
  $('an-bests').innerHTML = `<h3>Best efforts <small>this ride · your last 90 days</small></h3><table class="cc-table"><tbody>${Object.entries(mine).map(([d, p]) => {
    const old = w(b90[d]), top = old && p >= old;
    return `<tr${top ? ' class="best"' : ''}><td>${M.durLabel(+d)}</td><td><b>${p} W</b> <small>${(p / kg.rider).toFixed(2)} W/kg</small></td><td>${old ? `${old} W` : '–'}</td><td>${top ? '🏆 best' : old ? `${Math.round((p / old) * 100)}%` : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}

// ---------- open ----------
function show(title, sub, recs, ftp) {
  A.s = series(recs);
  if (A.s.p.length < 10) { alert('This ride is too short to analyse.'); return; }
  A.ftp = ftp || ftpNow(); A.sel = null; A.view = [0, A.s.p.length];
  $('an-title').textContent = title; $('an-sub').textContent = sub;
  $('dlg-analysis').showModal();
  renderTiles(); renderIntervals(); renderZones(); renderBests(); renderBar();
  requestAnimationFrame(draw);
}
export async function analyseRide(r) {
  try {
    const res = await fetch(`api/rides/${r.id}.fit`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    show(r.name, new Date(r.date).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + (r.workout ? ` · ${r.workout}` : ''), readFit(await res.arrayBuffer()), r.ftp);
  } catch (e) { alert('Could not open the ride: ' + e.message); }
}
// the ride just finished (simulator rides too: they're never saved)
export function analyseThisRide(name) {
  show(name || 'This ride', 'Just now', recorder.samples, ftpNow());
}

export function initAnalysis() {
  $('an-close').addEventListener('click', () => $('dlg-analysis').close());
  const wrap = $('an-charts');
  const idx = (e) => { const r = wrap.getBoundingClientRect(), [v0, v1] = A.view; return Math.max(v0, Math.min(v1 - 1, Math.round(v0 + ((e.clientX - r.left - LEFT) / (r.width - LEFT - 6)) * (v1 - v0)))); };
  wrap.addEventListener('pointerdown', (e) => { if (!A.s) return; A.drag = idx(e); wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', (e) => {
    if (!A.s) return;
    const i = idx(e), r = wrap.getBoundingClientRect(), x = e.clientX - r.left;
    if (x < LEFT) { $('an-cross').classList.add('hidden'); $('an-tip').classList.add('hidden'); return; }
    $('an-cross').style.left = x + 'px'; $('an-cross').classList.remove('hidden');
    const s = A.s, p5 = avg(s.p.slice(Math.max(0, i - (A.smooth - 1)), i + 1));
    $('an-tip').innerHTML = `<b>${fmtTime(i)}</b><span><i style="background:${ZCOL[zoneOf(p5)]}"></i>${Math.round(p5)} W</span>${s.h[i] ? `<span><i style="background:#e5487f"></i>${s.h[i]} bpm</span>` : ''}${s.c[i] ? `<span><i style="background:#3d8fe6"></i>${s.c[i]} rpm</span>` : ''}<span><i style="background:#c28512"></i>${(s.v[i] * (U().speed / 3.6)).toFixed(1)} ${U().speedUnit}</span>${s.e[i] != null ? `<span>${Math.round(s.e[i] * U().ele)} ${U().eleUnit} · ${(s.d[i] / U().dist).toFixed(2)} ${U().distUnit}</span>` : ''}`;
    const tip = $('an-tip'); tip.classList.remove('hidden');
    tip.style.left = Math.min(r.width - tip.offsetWidth - 4, x + 14) + 'px';
    if (A.drag != null && Math.abs(i - A.drag) > 2) { A.sel = [Math.min(A.drag, i), Math.max(A.drag, i) + 1]; drawSel(); renderBar(); }
  });
  wrap.addEventListener('pointerleave', () => { $('an-cross').classList.add('hidden'); $('an-tip').classList.add('hidden'); });
  wrap.addEventListener('pointerup', () => { if (A.drag == null) return; A.drag = null; if (A.sel) renderZones(); });
  $('an-zoom').addEventListener('click', () => { if (A.sel) { A.view = [A.sel[0], A.sel[1]]; draw(); renderBar(); } });
  $('an-reset').addEventListener('click', () => { A.sel = null; A.view = [0, A.s.p.length]; draw(); renderBar(); renderZones(); });
  $('an-smooth').addEventListener('change', () => { A.smooth = +$('an-smooth').value; draw(); });
  $('an-intervals').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-a]');
    if (!tr) return;
    A.sel = [+tr.dataset.a, +tr.dataset.b];
    if (A.sel[0] < A.view[0] || A.sel[1] > A.view[1]) A.view = [0, A.s.p.length];
    draw(); renderBar(); renderZones();
    $('an-charts').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  window.addEventListener('resize', () => { if ($('dlg-analysis').open) draw(); });
}
