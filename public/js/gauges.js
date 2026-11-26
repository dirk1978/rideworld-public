// Car-style round dials (SVG): a 270° scale with coloured bands, ticks, a sweeping needle and a digital readout.
const NS = 'http://www.w3.org/2000/svg';
const START = 135, SWEEP = 270; // degrees, 0 = right, clockwise

const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const polar = (r, deg) => [100 + r * Math.cos((deg * Math.PI) / 180), 100 + r * Math.sin((deg * Math.PI) / 180)];
function arc(r, a0, a1) {
  const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export class Gauge {
  // opts: { title, unit, min, max, major, minor, bands: [{ from, to, color }], decimals }
  constructor(host, opts) {
    this.host = host;
    this.value = null;
    this.shown = opts.min;
    this.svg = el('svg', { viewBox: '0 0 200 200', class: 'gauge' }, host);
    this.configure(opts);
  }

  angle(v) {
    const t = Math.max(0, Math.min(1, (v - this.o.min) / (this.o.max - this.o.min)));
    return START + t * SWEEP;
  }

  configure(opts) {
    this.o = { decimals: 0, minor: 0, bands: [], ...opts };
    const o = this.o, s = this.svg;
    s.innerHTML = '';
    el('circle', { cx: 100, cy: 100, r: 96, class: 'g-face' }, s);
    el('circle', { cx: 100, cy: 100, r: 95, class: 'g-rim' }, s);
    el('path', { d: arc(80, START, START + SWEEP), class: 'g-track' }, s);
    // the zones as a thin ring just outside the track; the value itself as a glowing arc in its zone's colour
    // (redesign 2026-10-27), filling from the start of the scale to the needle
    for (const b of o.bands) {
      const a0 = this.angle(b.from), a1 = this.angle(Math.min(b.to, o.max));
      if (a1 > a0 + 0.5) el('path', { d: arc(88, a0, a1), class: 'g-band', stroke: b.color }, s);
    }
    // (the glow: a wide faint copy under it, not an SVG blur filter, which is costly redrawn every frame on four dials)
    this.glowEl = el('path', { class: 'g-fill-glow', d: '' }, s);
    this.fillEl = el('path', { class: 'g-fill', d: '' }, s);
    if (o.minor) for (let v = o.min; v <= o.max + 1e-9; v += o.minor) {
      const a = this.angle(v), [x0, y0] = polar(70, a), [x1, y1] = polar(74, a);
      el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'g-tick-minor' }, s);
    }
    for (let v = o.min; v <= o.max + 1e-9; v += o.major) {
      const a = this.angle(v), [x0, y0] = polar(66, a), [x1, y1] = polar(74, a), [tx, ty] = polar(55, a);
      el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'g-tick' }, s);
      el('text', { x: tx, y: ty + 4, class: 'g-num' }, s).textContent = Math.round(v);
    }
    el('text', { x: 100, y: 128, class: 'g-title' }, s).textContent = o.title;
    // target marker (workouts): a small triangle on the rim, pointing in
    this.targetEl = el('polygon', { points: '93,2 107,2 100,15', class: 'g-target' }, s);
    this.needle = el('g', { class: 'g-needle' }, s);
    el('polygon', { points: '96,100 104,100 100,28' }, this.needle);
    el('circle', { cx: 100, cy: 100, r: 9, class: 'g-hub' }, s);
    this.readout = el('text', { x: 100, y: 160, class: 'g-value' }, s);
    this.unitEl = el('text', { x: 100, y: 178, class: 'g-unit' }, s);
    this.unitEl.textContent = o.unit;
    this.draw();
  }

  set(v) { this.value = v; }
  setTarget(v) { this.target = v; }
  // the line under the number (the power dial shows W/kg there)
  setUnit(t) { if (t !== this.unitText) { this.unitText = t; this.unitEl.textContent = t; } }

  // called every frame: the needle eases towards the value like a real instrument
  tick(dt) {
    const target = this.value ?? this.o.min;
    this.shown += (target - this.shown) * Math.min(1, dt * 8);
    this.draw();
  }

  // Only what changed is written, the needle in 0.25 degree steps (2026-11-14: rewriting every attribute of four dials
  // every frame was a measurable share of a laptop's frame, and a settled needle needs nothing)
  draw() {
    const c = this.cache ||= {};
    const put = (k, v, fn) => { if (c[k] !== v) { c[k] = v; fn(v); } };
    const a = Math.round(this.angle(this.shown) * 4) / 4;
    // the needle polygon points straight up (-90°), so rotate by angle + 90
    put('needle', a, (x) => this.needle.setAttribute('transform', `rotate(${x + 90} 100 100)`));
    put('target', this.target == null ? null : Math.round(this.angle(Math.min(this.o.max, this.target)) * 4) / 4, (x) => {
      if (x == null) this.targetEl.style.display = 'none';
      else { this.targetEl.style.display = ''; this.targetEl.setAttribute('transform', `rotate(${x + 90} 100 100)`); }
    });
    const v = this.value;
    put('text', v == null ? '--' : v.toFixed(this.o.decimals), (x) => { this.readout.textContent = x; });
    const band = this.o.bands.find((b) => v != null && v >= b.from && v < b.to), col = band ? band.color : '#ff7a33';
    put('fillc', band ? band.color : '', (x) => { this.readout.style.fill = x; });
    put('arc', a, (x) => { const d = x > START + 0.5 ? arc(80, START, x) : ''; this.fillEl.setAttribute('d', d); this.glowEl.setAttribute('d', d); });
    put('col', col, (x) => { this.fillEl.style.stroke = x; this.glowEl.style.stroke = x; });
  }
}

// Power zones as a share of FTP (Zwift's colours), heart-rate zones as a share of max HR
export function powerBands(ftp) {
  const z = [[0, 0.55, '#9aa0a6'], [0.55, 0.75, '#3b82f6'], [0.75, 0.9, '#22c55e'], [0.9, 1.05, '#eab308'], [1.05, 1.2, '#f97316'], [1.2, 99, '#ef4444']];
  return z.map(([a, b, color]) => ({ from: a * ftp, to: b * ftp, color }));
}
export function hrBands(max) {
  const z = [[0, 0.6, '#9aa0a6'], [0.6, 0.7, '#3b82f6'], [0.7, 0.8, '#22c55e'], [0.8, 0.9, '#f97316'], [0.9, 2, '#ef4444']];
  return z.map(([a, b, color]) => ({ from: a * max, to: b * max, color }));
}
