// Finding the road in imagery (the route editor's "Find the road", app/roadfinder.js): pure maths, unit-tested.
// rows: colours [r, g, b] (or null) across the route line, one row per sample along it, -half..half m every step m.

export const MIN_CONTRAST = 0.15; // how much more road-like the band must be than either side to count

// the most road-like band 3.5-10 m wide: { centre (m right of the line), width, contrast }
export function findBand(rows, half = 16, step = 0.25) {
  const W = rows[0].length, score = [];
  const lum = [], sat = [], sd = [];
  for (let i = 0; i < W; i++) {
    const cs = rows.map((r) => r[i]).filter(Boolean);
    if (cs.length < 3) { lum.push(null); sat.push(1); sd.push(99); continue; }
    const L = cs.map((c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]), m = L.reduce((a, b) => a + b) / L.length;
    lum.push(m);
    sd.push(Math.sqrt(L.reduce((a, x) => a + (x - m) ** 2, 0) / L.length));
    sat.push(cs.reduce((a, c) => a + (Math.max(...c) - Math.min(...c)) / (Math.max(...c) + 1e-6), 0) / cs.length);
  }
  for (let i = 0; i < W; i++) {
    if (lum[i] === null) { score.push(0); continue; }
    const across = Math.abs((lum[Math.min(W - 1, i + 1)] ?? lum[i]) - (lum[Math.max(0, i - 1)] ?? lum[i]));
    // smooth along the road, little colour, smooth across, neither shadow nor glare
    score.push(Math.exp(-sd[i] / 10) * Math.exp(-Math.max(0, sat[i] - 0.08) / 0.08) * Math.exp(-across / 15) * (lum[i] > 90 && lum[i] < 235 ? 1 : 0.2));
  }
  const sum = [0];
  for (const s of score) sum.push(sum[sum.length - 1] + s);
  const mean = (a, b) => (b > a ? (sum[b] - sum[a]) / (b - a) : 0);
  let best = null;
  for (let wid = Math.round(3.5 / step); wid <= Math.round(10 / step); wid++) {
    for (let a = 0; a + wid < W; a++) {
      const b = a + wid, beside = Math.round(4 / step);
      const lo = Math.max(0, a - beside), hi = Math.min(W, b + beside);
      const out = (sum[a] - sum[lo] + sum[hi] - sum[b]) / Math.max(1, (a - lo) + (hi - b));
      const val = mean(a, b) - out;
      if (!best || val > best.contrast) best = { contrast: val, centre: ((a + b) / 2) * step - half, width: wid * step };
    }
  }
  return best;
}

// Readings -> how far the map is slid, every `step` m: { dx, dy } arrays (metres east, north), or null.
// found[i]: findBand result at station i (or null); right[i]: unit vector to the right of travel there [east, north];
// radius[i]: how tight the road bends there (m). Each reading only says how far the road is to the side; the slide
// is the same for both legs of a hairpin, which face opposite ways, so fitting a slide to all readings within ~150 m
// (weighted by distance, least squares, a little pull towards no slide where only one direction is seen) recovers
// it, and moving the route by a slide keeps a hairpin's shape. (The first version moved each point sideways by its
// own reading: on hairpins the readings caught the other leg and the line folded back on itself. the owner: "most
// hairpins were wrong".) Readings on bends tighter than 25 m radius are left out (the cross-section there hits the
// other leg); outliers more than 3 m off the fit are dropped and it's fitted again; the slide changes by at most
// 0.5 m per station and is capped at 12 m.
export function fitSlide(found, right, radius, step = 10) {
  const n = found.length, fin = Number.isFinite;
  // only readings that are whole numbers all through (a missing value once made the whole slide NaN)
  const use = found.map((f, i) => !!f && fin(f.centre) && fin(f.contrast) && f.contrast >= MIN_CONTRAST && fin(right[i]?.[0]) && fin(right[i]?.[1]) && !(radius[i] < 25));
  if (use.filter(Boolean).length < Math.max(5, n * 0.1)) return null;
  const W = Math.round(150 / step), SIG = 80 / step;
  const fit = (k, ok) => {
    let a = 0, b = 0, c = 0, u = 0, v = 0, wsum = 0;
    for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) {
      if (!ok[j]) continue;
      const w = Math.exp(-(((j - k) / SIG) ** 2)) * found[j].contrast, [ex, ny] = right[j], l = found[j].centre;
      a += w * ex * ex; b += w * ex * ny; c += w * ny * ny; u += w * ex * l; v += w * ny * l; wsum += w;
    }
    if (wsum < 1e-6) return null;
    const lam = 0.05 * wsum; // pull towards no slide in the direction no reading sees
    a += lam; c += lam;
    const det = a * c - b * b, t = [(c * u - b * v) / det, (a * v - b * u) / det];
    return fin(t[0]) && fin(t[1]) ? t : null;
  };
  let ok = use.slice(), t = found.map((_, k) => fit(k, ok));
  // drop readings more than 3 m from what the fit says there, and fit again
  ok = ok.map((o, j) => o && t[j] && Math.abs(right[j][0] * t[j][0] + right[j][1] * t[j][1] - found[j].centre) <= 3);
  t = found.map((_, k) => fit(k, ok));
  // no fit nearby: carry the nearest one along
  let last = null;
  for (let k = 0; k < n; k++) if (t[k]) last = t[k]; else t[k] = last;
  last = null;
  for (let k = n - 1; k >= 0; k--) if (t[k]) last = t[k]; else t[k] = last;
  if (!t[0]) return null;
  // limit how fast it changes along the road, both ways, and cap it
  const lim = 0.5, dx = t.map((v) => v[0]), dy = t.map((v) => v[1]);
  for (const arr of [dx, dy]) {
    for (let k = 1; k < n; k++) arr[k] = Math.max(arr[k - 1] - lim, Math.min(arr[k - 1] + lim, arr[k]));
    for (let k = n - 2; k >= 0; k--) arr[k] = Math.max(arr[k + 1] - lim, Math.min(arr[k + 1] + lim, arr[k]));
  }
  for (let k = 0; k < n; k++) {
    const m = Math.hypot(dx[k], dy[k]);
    if (m > 12) { dx[k] *= 12 / m; dy[k] *= 12 / m; }
  }
  return { dx, dy };
}
