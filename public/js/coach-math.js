// The virtual coach's numbers (2026-10-29, the owner: "analyses the ride performance and auto adjusts FTP, gives current
// training 'freshness', athletic age, all of the stats we can give them from all publicly available algorithms").
// Pure functions, no DOM: used by the server (lib/coach.js, per-ride numbers from the stored FIT files), the setup
// screen's Coach section and the in-ride coach. Unit-tested in tests/unit.mjs.
//
// Where each comes from:
// - Normalized Power, Intensity Factor, Training Stress Score: Coggan (Allen & Coggan, Training and Racing with a
//   Power Meter). NP = 4th-power mean of the 30 s rolling average; IF = NP / FTP; TSS = h x IF^2 x 100.
// - Without power, a heart-rate TSS: h x (avg HR / threshold HR)^2 x 100, threshold HR taken as 89% of max.
// - Fitness / fatigue / form (CTL / ATL / TSB): Banister's impulse-response model as TrainingPeaks' Performance
//   Management Chart: exponentially weighted daily TSS over 42 and 7 days; form = fitness - fatigue.
// - Power curve: best average power over each duration (mean maximal power).
// - FTP estimate: 95% of the best 20 minutes, or the best hour, whichever is higher (Coggan's field test).
// - Critical power and W': the 2-parameter model (work = CP x t + W') fitted to 3-20 minute bests (Monod & Scherrer).
// - W' balance in a ride: Skiba's differential model (Skiba et al. 2015).
// - VO2max: the ACSM leg-cycling equation, VO2 = 10.8 x W/kg + 7, at the best 5 minutes.
// - Fitness age: the age whose average VO2max matches yours, from the HUNT fitness study norms (Loe et al. 2013:
//   54.4 / 43.0 ml/kg/min for men / women aged 20-29, about 3.5 lower each decade to 50, then 8% a decade).
// - Power profile: Coggan's W/kg table (5 s, 1 min, 5 min, FTP), between its untrained and world-class ends.
// - Aerobic decoupling (Pw:HR): Friel, power / HR in the second half against the first.

export const DURS = [5, 15, 30, 60, 120, 180, 300, 480, 600, 720, 1200, 1800, 2700, 3600, 5400, 7200];
export const durLabel = (d) => (d < 60 ? `${d} s` : d < 3600 ? `${d / 60} min` : `${d / 3600} h`);
const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);

// 1 Hz series from timed samples ({ time: Date | ms, power, hr, cadence }): gaps up to 5 s hold the last value,
// longer gaps (pauses) are left out
export function toSeconds(samples) {
  const p = [], h = [], c = [];
  let last = null;
  for (const s of samples) {
    const t = +new Date(s.time);
    if (!Number.isFinite(t)) continue;
    const gap = last === null ? 1 : Math.round((t - last) / 1000);
    if (gap < 1) continue;
    const n = gap <= 5 ? gap : 1;
    for (let k = 0; k < n; k++) { p.push(Math.max(0, s.power || 0)); h.push(s.hr || 0); c.push(s.cadence || 0); }
    last = t;
  }
  return { p, h, c };
}

// best average over d seconds
export function bestAvg(p, d) {
  if (p.length < d) return 0;
  let sum = 0, best = 0;
  for (let i = 0; i < p.length; i++) {
    sum += p[i];
    if (i >= d) sum -= p[i - d];
    if (i >= d - 1 && sum > best) best = sum;
  }
  return best / d;
}

export function normalizedPower(p) {
  if (p.length < 30) return mean(p);
  let sum = 0, acc = 0, n = 0;
  for (let i = 0; i < p.length; i++) {
    sum += p[i];
    if (i >= 30) sum -= p[i - 30];
    if (i >= 29) { acc += (sum / 30) ** 4; n++; }
  }
  return (acc / n) ** 0.25;
}

// What a ride was, independent of the rider's FTP (so it can be kept and re-scored when FTP changes)
export function rideNumbers({ p, h }) {
  const secs = p.length, hasPower = p.some((x) => x > 0);
  const curve = {};
  if (hasPower) for (const d of DURS) if (d <= secs) curve[d] = Math.round(bestAvg(p, d));
  const hist = {}; // seconds per 10 W
  if (hasPower) for (const x of p) { const b = Math.min(200, Math.floor(x / 10)); hist[b] = (hist[b] || 0) + 1; }
  const hs = h.filter((x) => x > 0), avgHr = hs.length ? Math.round(mean(hs)) : 0;
  const np = hasPower ? Math.round(normalizedPower(p)) : 0;
  let decoupling = null; // only steady-ish rides of 20 min+ with heart rate throughout
  if (hasPower && secs >= 1200 && hs.length > secs * 0.8) {
    const half = Math.floor(secs / 2), r = (a, b) => mean(p.slice(a, b)) / (mean(h.slice(a, b).filter((x) => x > 0)) || 1);
    const r1 = r(0, half), r2 = r(half, secs);
    if (r1 > 0 && r2 > 0) decoupling = +((r1 / r2 - 1) * 100).toFixed(1);
  }
  return {
    hrp: hasPower ? hrPairs(p, h) : [], hrr: hasPower ? hrRecovery(p, h) : null, hre: hasPower ? hrEfforts(p, h) : [], blk: hasPower ? steadyBlocks(p, h) : [],
    secs, hasPower, avgPower: hasPower ? Math.round(mean(p)) : 0, np, kj: Math.round(p.reduce((t, x) => t + x, 0) / 1000),
    curve, hist, avgHr, maxHr: hs.length ? Math.max(...hs) : 0, decoupling, ef: avgHr && np ? +(np / avgHr).toFixed(2) : null,
  };
}

// Training load of one ride: TSS from power and the FTP it was ridden at, else from heart rate
export function rideLoad(m, ftp, maxHr) {
  if (m.hasPower && m.np > 0 && ftp > 0) {
    const IF = m.np / ftp;
    return { tss: Math.round((m.secs / 3600) * IF * IF * 100), IF: +IF.toFixed(2), from: 'power' };
  }
  if (m.avgHr > 0 && maxHr > 0) {
    const r = m.avgHr / (0.89 * maxHr);
    return { tss: Math.round((m.secs / 3600) * r * r * 100), IF: null, from: 'heart rate' };
  }
  return { tss: 0, IF: null, from: null };
}

// Coggan's seven power zones (share of FTP); their colours match the power dial where it has them
export const ZONES = [
  { name: 'Recovery', to: 0.55 }, { name: 'Endurance', to: 0.75 }, { name: 'Tempo', to: 0.9 }, { name: 'Threshold', to: 1.05 },
  { name: 'VO2 max', to: 1.2 }, { name: 'Anaerobic', to: 1.5 }, { name: 'Sprint', to: Infinity },
];
export function zoneSeconds(hist, ftp) {
  const out = ZONES.map(() => 0);
  for (const [b, s] of Object.entries(hist || {})) {
    const w = +b * 10 + 5;
    out[ZONES.findIndex((z) => w < z.to * ftp)] += s;
  }
  return out;
}

const day = (d) => new Date(d).toISOString().slice(0, 10);
// Fitness (CTL), fatigue (ATL) and form (TSB) for every day from the first ride to `today`
// rides: [{ date, tss }]. Form here is fitness minus fatigue at the end of the day (today: after today's rides).
export function fitnessSeries(rides, today = new Date(), startCtl = 0) {
  if (!rides.length) return [];
  const byDay = {};
  for (const r of rides) byDay[day(r.date)] = (byDay[day(r.date)] || 0) + (r.tss || 0);
  const first = new Date(Math.min(...rides.map((r) => +new Date(r.date))));
  first.setUTCHours(0, 0, 0, 0);
  const out = [];
  let ctl = startCtl, atl = startCtl;
  for (let t = +first; t <= +today; t += 86400000) {
    const d = day(t), tss = byDay[d] || 0;
    ctl += (tss - ctl) / 42; atl += (tss - atl) / 7;
    out.push({ date: d, tss, ctl, atl, tsb: ctl - atl });
  }
  return out;
}
// What a further `tss` today would do to them
export function afterRide(last, tss) {
  if (!last) return null;
  const ctl = last.ctl + tss / 42, atl = last.atl + tss / 7; // (the day's load, added on top of what's counted)
  return { ctl, atl, tsb: ctl - atl };
}
export function formWord(tsb) {
  if (tsb > 15) return 'Very fresh';
  if (tsb > 5) return 'Fresh';
  if (tsb > -10) return 'Neutral';
  if (tsb > -30) return 'Building';
  return 'Overreaching';
}

// Best power for each duration over rides ([{ curve, date, id }]) since a time (ms)
export function bests(rides, since = 0) {
  const out = {};
  for (const r of rides) {
    if (+new Date(r.date) < since) continue;
    for (const [d, w] of Object.entries(r.curve || {})) if (!out[d] || w > out[d].w) out[d] = { w, date: r.date, id: r.id };
  }
  return out;
}
// power at any duration from a curve (log-interpolated between the durations it has)
export function curveAt(curve, d) {
  const ks = Object.keys(curve).map(Number).sort((a, b) => a - b);
  if (!ks.length) return 0;
  const v = (k) => (typeof curve[k] === 'object' ? curve[k].w : curve[k]);
  if (d <= ks[0]) return v(ks[0]);
  for (let i = 1; i < ks.length; i++) {
    if (d <= ks[i]) { const f = Math.log(d / ks[i - 1]) / Math.log(ks[i] / ks[i - 1]); return v(ks[i - 1]) + (v(ks[i]) - v(ks[i - 1])) * f; }
  }
  return null; // longer than anything ridden
}

export function ftpEstimate(b) {
  const w = (d) => (b[d] ? (typeof b[d] === 'object' ? b[d].w : b[d]) : 0);
  const c = [];
  if (w(1200)) c.push({ ftp: Math.round(w(1200) * 0.95), from: `95% of your best 20 minutes (${w(1200)} W)` });
  if (w(3600)) c.push({ ftp: Math.round(w(3600)), from: `your best hour (${w(3600)} W)` });
  return c.sort((x, y) => y.ftp - x.ftp)[0] || null;
}

// 2-parameter critical power from 3-20 minute bests; null unless the fit is sensible
export function criticalPower(b) {
  const pts = [180, 300, 480, 600, 720, 1200].filter((d) => b[d]).map((d) => [d, (typeof b[d] === 'object' ? b[d].w : b[d]) * d]);
  if (pts.length < 2 || pts[0][0] > 300 || pts[pts.length - 1][0] < 600) return null;
  const mx = mean(pts.map((q) => q[0])), my = mean(pts.map((q) => q[1]));
  let sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const cp = sxy / sxx, wp = my - cp * mx;
  return cp > 50 && wp > 3000 && wp < 50000 ? { cp: Math.round(cp), wPrime: Math.round(wp) } : null;
}
// W' balance, one step of dt seconds at power P (Skiba's differential form)
export function wbalStep(bal, P, cp, wp, dt) {
  if (P > cp) return Math.max(0, bal - (P - cp) * dt);
  return bal + (wp - bal) * (1 - Math.exp(-((cp - P) * dt) / wp));
}

export const vo2max = (p5, kg) => (p5 > 0 && kg > 0 ? 10.8 * (p5 / kg) + 7 : null);
// VO2max from maximal aerobic power (a ramp test's best minute, or power at max heart rate): Hawley & Noakes 1992,
// VO2max (L/min) = 0.01141 x W + 0.435
export const vo2FromMap = (w, kg) => (w > 0 && kg > 0 ? ((0.01141 * w + 0.435) / kg) * 1000 : null);

// ---------- heart rate against power (2026-11-03, the owner: "I did assume that the coach would be watching ... the
// heart rate at power levels, the recovery time, the ramp up") ----------
// Steady minutes of a ride as [power, heart rate]: after the first 10 min, a minute whose power holds within 15% and
// matches the minute before (so heart rate has caught up), heart rate read 30 s later (it lags). At most 120.
export function hrPairs(p, h) {
  const out = [];
  for (let i = 600; i + 90 <= p.length && out.length < 120; i += 60) {
    const blk = p.slice(i, i + 60), m = mean(blk);
    if (m < 50) continue;
    const sd = Math.sqrt(mean(blk.map((x) => (x - m) ** 2)));
    if (sd / m > 0.15 || Math.abs(mean(p.slice(i - 60, i)) - m) / m > 0.15) continue;
    const hb = h.slice(i + 30, i + 90).filter((x) => x > 0);
    if (hb.length >= 50) out.push([Math.round(m), Math.round(mean(hb))]);
  }
  return out;
}
// Heart-rate recovery: after each hard 2 minutes (25%+ above the ride's average power) that ends with a minute of easy
// riding (under 60% of it), how many beats it fell in that minute. The ride's median, or null.
export function hrRecovery(p, h) {
  const e = hrEfforts(p, h);
  if (!e.length) return null;
  const s = e.map((x) => x.drop).sort((a, b) => a - b);
  return s[s.length >> 1];
}
// Each such effort: { w: its 2 minutes' average power, hr: heart rate as it stopped, drop: beats fallen in the next minute }
// (2026-11-26: kept per ride so recovery can be compared at the same power, coach-math recoveryAtPower)
export function hrEfforts(p, h) {
  const avg = mean(p.filter((x) => x > 0)), out = [];
  for (let i = 120; i + 60 < p.length; i++) {
    const eff = mean(p.slice(i - 120, i));
    if (eff < avg * 1.25 || Math.max(...p.slice(i, i + 10)) > eff * 0.6 || mean(p.slice(i, i + 60)) > eff * 0.6 || !(h[i] > 0 && h[i + 60] > 0)) continue; // (from when the effort has stopped)
    out.push({ w: Math.round(eff), hr: h[i], drop: h[i] - h[i + 60] });
    i += 180;
  }
  return out;
}
// The ramp test's heart rate (2026-11-03, the owner: "I assume the coach will look at my HR for each power and analyse the LT
// and how it stabilises and recovers at the end"). The test's shape is fixed (workout.js 'ramptest': 5 min warm-up, then
// 1-minute steps from 50% of FTP rising 6% of FTP), so step k is seconds 300+60(k-1) .. +60. Per full step: its power
// and the heart rate of its last 10 s. Then the line through them, whether it bends (a steeper second line fits much
// better: a heart-rate deflection), whether it levels off at the top (near your max), the peak and the first minute's
// drop after the end. ftp: the FTP the test was ridden at.
export function rampAnalysis(p, h, ftp) {
  if (!(ftp > 0) || p.length < 600) return null;
  const steps = [];
  let k = 1, end = null;
  for (; k <= 25; k++) {
    const a = 300 + 60 * (k - 1), b = a + 60, target = ftp * (0.5 + 0.06 * (k - 1));
    if (b > p.length || mean(p.slice(b - 20, b)) < target * 0.8) {
      // the step it ended in: the end is where power falls away
      end = a;
      const low = (i) => p[i] < target * 0.6 && p[i + 1] < target * 0.6 && p[i + 2] < target * 0.6;
      while (end < Math.min(p.length - 3, b) && !low(end)) end++;
      break;
    }
    const hs = h.slice(b - 10, b).filter((x) => x > 0);
    steps.push({ w: Math.round(mean(p.slice(a, b))), target: Math.round(target), hr: hs.length ? Math.round(mean(hs)) : null });
  }
  if (steps.length < 4 || end == null) return null;
  const held = end - (300 + 60 * (k - 1)), best60 = Math.round(bestAvg(p.slice(0, end + 2), 60));
  const pts = steps.filter((s) => s.hr).map((s) => [s.w, s.hr]);
  const hrAround = h.slice(Math.max(0, end - 30), end + 20).filter((x) => x > 0), peakHr = hrAround.length ? Math.max(...hrAround) : null;
  const hrr60 = peakHr && h[end + 60] > 0 ? peakHr - h[end + 60] : null;
  const line = pts.length >= 4 ? fitLine(pts) : null;
  let bend = null, levels = false;
  if (line && pts.length >= 8) {
    const sse = (q, L) => q.reduce((s, [x, y]) => s + (y - L.a - L.b * x) ** 2, 0), all = sse(pts, line);
    let best = null;
    for (let i = 3; i < pts.length - 3; i++) {
      const A = fitLine(pts.slice(0, i + 1)), B = fitLine(pts.slice(i));
      if (!A || !B) continue;
      const e = sse(pts.slice(0, i + 1), A) + sse(pts.slice(i), B);
      if (!best || e < best.e) best = { e, i, A, B };
    }
    if (best && best.e < all * 0.6 && best.B.b > best.A.b * 1.4) bend = { w: pts[best.i][0], hr: pts[best.i][1] };
    const top = pts.slice(-3);
    levels = top.length === 3 && (top[2][1] - top[0][1]) / Math.max(1, top[2][0] - top[0][0]) < line.b * 0.4;
  }
  return { steps, held, best60, ftp: Math.round(best60 * 0.75), slope: line ? +line.b.toFixed(3) : null, r2: line ? +line.r2.toFixed(2) : null,
    bend, levels, peakHr, hrr60, endW: steps[steps.length - 1].target, failW: Math.round(ftp * (0.5 + 0.06 * (k - 1))) };
}

// ---------- fitness signals from ordinary riding (2026-11-26, the owner: "all of it": recovery at set powers, threshold
// from ordinary rides, a benchmark test, training capacity, and the coach's advice using them) ----------

// Steady blocks of a ride (5 min+ with every 30 s average within 10% of the block's mean, after the first 5 minutes):
// [power, heart-rate slope over the block after its first 2 minutes (bpm per minute), minutes]. Below threshold heart
// rate levels off within a couple of minutes at a steady power; above it, it keeps climbing (the "slow component").
// At most 40 blocks a ride.
export function steadyBlocks(p, h) {
  const out = [], n = p.length, a30 = [];
  for (let i = 0; i + 30 <= n; i += 30) a30.push(mean(p.slice(i, i + 30)));
  let i = 10; // 30 s pieces: skip the first 5 minutes
  while (i < a30.length && out.length < 40) {
    let j = i + 1, m = a30[i];
    const ok = (k, mm) => a30.slice(i, k + 1).every((x) => Math.abs(x - mm) <= mm * 0.1);
    while (j < a30.length && ok(j, mean(a30.slice(i, j + 1)))) { j++; m = mean(a30.slice(i, j)); }
    const pieces = j - i;
    // (straight after a warm-up ramp or a hard effort heart rate is still catching up: the slope is then measured from 3
    // minutes in, and the block must be 6 minutes or more)
    const before = mean(a30.slice(Math.max(0, i - 4), i)), jolt = Math.abs(before - m) > m * 0.2, lead = jolt ? 6 : 4;
    if (pieces >= (jolt ? 12 : 10) && m >= 60) {
      const s0 = (i + lead) * 30, s1 = j * 30, pts = [];
      for (let t = s0; t < s1; t += 10) if (h[t] > 0) pts.push([(t - s0) / 60, h[t]]);
      const L = pts.length >= 12 ? fitLine(pts) : null;
      if (L || (pts.length >= 12 && pts.every((q) => q[1] === pts[0][1]))) out.push([Math.round(m), L ? +L.b.toFixed(2) : 0, +(pieces / 2).toFixed(1)]);
      i = j;
    } else i++;
  }
  return out;
}
// Threshold from ordinary rides: pooled steady blocks (blocks = [[w, slope, mins]]). Heart rate "settles" (slope under
// 1 bpm/min) below threshold and "climbs" (over 2) above it. The estimate is the power that best splits the two: the
// highest settled block below it and the lowest climbing block above it, at least 3 settled and 2 climbing blocks, and
// no more than 20% of blocks on the wrong side. Null otherwise (most rides never hold a steady effort above threshold).
export function thresholdFromBlocks(blocks) {
  const pts = blocks.filter(([w, s]) => w > 0 && Number.isFinite(s));
  const settled = pts.filter(([, s]) => s < 1), climbing = pts.filter(([, s]) => s > 2);
  if (settled.length < 3 || climbing.length < 2) return null;
  const ws = [...new Set(pts.map(([w]) => w))].sort((a, b) => a - b);
  let best = null;
  for (let k = 1; k < ws.length; k++) {
    const cut = (ws[k - 1] + ws[k]) / 2;
    const wrong = settled.filter(([w]) => w > cut).length + climbing.filter(([w]) => w < cut).length;
    const below = settled.filter(([w]) => w < cut).length, above = climbing.filter(([w]) => w > cut).length;
    if (below < 3 || above < 2) continue;
    if (!best || wrong < best.wrong) best = { cut, wrong, below, above };
  }
  if (!best || best.wrong > (settled.length + climbing.length) * 0.2) return null;
  const hi = Math.max(...settled.filter(([w]) => w < best.cut).map(([w]) => w)), lo = Math.min(...climbing.filter(([w]) => w > best.cut).map(([w]) => w));
  return { w: Math.round((hi + lo) / 2), settledUpTo: hi, climbsFrom: lo, n: pts.length, gap: lo - hi };
}
// Recovery at the same power: efforts ([{ w, drop, date }]) grouped into bands of 10% of FTP (from 90%); per band the
// median beats fallen in the last 28 days and in the 56 days before. Returns the bands with efforts in both periods
// (best-filled first) and every band's recent median.
export function recoveryAtPower(efforts, ftp, now = Date.now()) {
  const D = 86400000, band = (w) => Math.floor((w / ftp) * 10) / 10;
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const by = {};
  for (const e of efforts) {
    if (!(e.w >= ftp * 0.9)) continue;
    const b = Math.min(1.5, band(e.w)), age = now - +new Date(e.date);
    const k = (by[b] ||= { band: b, now: [], before: [] });
    if (age < 28 * D) k.now.push(e.drop); else if (age < 84 * D) k.before.push(e.drop);
  }
  const all = Object.values(by).map((k) => ({ band: k.band, now: med(k.now), before: med(k.before), nNow: k.now.length, nBefore: k.before.length }));
  return { compared: all.filter((k) => k.nNow && k.nBefore).sort((a, b) => (b.nNow + b.nBefore) - (a.nNow + a.nBefore)), bands: all.sort((a, b) => a.band - b.band) };
}
// The benchmark workout (workout.js 'benchmark': 10 min warm-up, then 20 min steady at a fixed share of FTP): over
// seconds 600-1800, if power held steady (30 s averages within 12% of the mean), the block's power, the heart rate of its
// last 5 minutes, its drift (power:HR first half against second, %), and watts per beat. Null if not ridden as written.
export function benchAnalysis(p, h) {
  if (p.length < 1800) return null;
  const blk = p.slice(600, 1800), m = mean(blk);
  if (m < 50) return null;
  for (let i = 0; i < 1200; i += 30) if (Math.abs(mean(blk.slice(i, i + 30)) - m) > m * 0.12) return null;
  const hr = (a, b) => { const x = h.slice(a, b).filter((v) => v > 0); return x.length > (b - a) * 0.8 ? mean(x) : null; };
  const last5 = hr(1500, 1800), h1 = hr(600, 1200), h2 = hr(1200, 1800);
  if (!last5 || !h1 || !h2) return null;
  const r1 = mean(p.slice(600, 1200)) / h1, r2 = mean(p.slice(1200, 1800)) / h2;
  return { w: Math.round(m), hr: Math.round(last5), drift: +((r1 / r2 - 1) * 100).toFixed(1), wpb: +(m / last5).toFixed(3) };
}
// Training capacity for the week ahead: how much load lifts fitness at a rate the body is coping with. Fitness (CTL)
// rises by about (daily load - CTL) / 6 a week, so a week of 7 x (CTL + 6 r) TSS raises it by r. r starts at 5 a week
// (a moderate build), 3 when the signals say you're not absorbing the work (or form is below -25), 7 when they say you
// are and you're fresh enough (form above -10); a rest week (2 x CTL x 7 x 0.6) when form is below -35.
// signals: [-1 | 0 | 1, ...] (worse / no news / better: power at a heart rate, recovery at a power, benchmark, drift).
export function capacity(ctl, tsb, signals = []) {
  const score = signals.reduce((s, x) => s + (x || 0), 0);
  if (tsb < -35) return { tss: Math.round(7 * ctl * 0.6), rate: -2, kind: 'rest', score };
  const rate = tsb < -25 || score < 0 ? 3 : score > 0 && tsb > -10 ? 7 : 5;
  return { tss: Math.round(7 * (Math.max(ctl, 10) + 6 * rate)), rate, kind: rate === 3 ? 'easy build' : rate === 7 ? 'strong build' : 'build', score };
}

// least squares heart rate = a + b x power over pooled [power, hr] pairs
export function fitLine(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = mean(pairs.map((q) => q[0])), my = mean(pairs.map((q) => q[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy), n, range: Math.max(...pairs.map((q) => q[0])) - Math.min(...pairs.map((q) => q[0])) };
}
// Your heart rate's line against power from recent rides: the power you'd reach at max heart rate (maximal aerobic
// power, the basis of a heart-rate VO2max, as watches do it) and the power at any heart rate. Null unless the fit is
// trustworthy: 20+ steady minutes spanning 50 W+, r2 >= 0.5, heart rate rising with power.
export function aerobicFit(rides, maxHr, since = 0) {
  const pairs = rides.filter((r) => +new Date(r.date) >= since).flatMap((r) => r.hrp || []);
  const f = fitLine(pairs);
  if (!f || f.n < 20 || f.range < 50 || f.r2 < 0.5 || f.b <= 0) return null;
  return { ...f, map: Math.round((maxHr - f.a) / f.b), powerAt: (hr) => Math.round((hr - f.a) / f.b) };
}
export function normVo2(age, sex) {
  const base = sex === 'f' ? 43.0 : 54.4, a = Math.max(25, age);
  const at50 = base - 0.35 * 25;
  return a <= 50 ? base - 0.35 * (a - 25) : at50 * 0.92 ** ((a - 50) / 10);
}
// the age whose average VO2max is yours (20 = "20 or younger", 90 = "90 or older")
export function fitnessAge(vo2, sex) {
  if (!(vo2 > 0)) return null;
  for (let a = 20; a <= 90; a += 0.5) if (normVo2(a, sex) <= vo2) return Math.round(a);
  return 90;
}

// Coggan's power profile (W/kg): untrained ... world class ends, linear between, 8 categories
const PROFILE = {
  m: { 5: [10.17, 25.18], 60: [5.64, 11.5], 300: [2.33, 7.6], ftp: [1.86, 6.4] },
  f: { 5: [8.43, 19.42], 60: [4.71, 9.29], 300: [1.85, 6.61], ftp: [1.5, 5.69] },
};
export const LEVELS = ['Untrained', 'Fair', 'Moderate', 'Good', 'Very good', 'Excellent', 'Exceptional', 'World class'];
export function profileLevel(wkg, key, sex) {
  const [lo, hi] = PROFILE[sex === 'f' ? 'f' : 'm'][key];
  const f = (wkg - lo) / (hi - lo);
  return { f: Math.max(0, Math.min(1, f)), level: LEVELS[Math.max(0, Math.min(7, Math.floor(f * 8)))] };
}

// ---------- suggestions ----------
// ctx: { tsb, ctl, rides (recent first, each with tss, IF, zones?, date), ftpTestAgeDays, hiShare (share of the last
// 14 days' riding at threshold or above) }
export function suggestWorkout(ctx) {
  const { tsb = 0, rides = [], hiShare = 0, ftpTestAgeDays = Infinity, hasVo2Recently = false } = ctx;
  const last = rides[0], lastHard = last && last.IF >= 0.85 && (Date.now() - +new Date(last.date)) < 36 * 3600000;
  if (!rides.length) return { id: 'ftptest', why: 'No rides to go on yet: an FTP test sets your zones, and everything the coach works out starts from it.' };
  if (tsb < -30) return { id: 'recovery', why: `Form ${Math.round(tsb)}: you're carrying a lot of fatigue. An easy spin helps your body absorb the work.` };
  if (lastHard) return { id: tsb < -15 ? 'recovery' : 'endurance', why: `Your last ride was hard (IF ${last.IF.toFixed(2)}). Keep today easy so the next hard day counts.` };
  // (2026-11-26) the heart-rate signals: worse = the body isn't absorbing the work (watts per beat down, slower recovery at
  // the same power, a worse benchmark); high drift = endurance is the gap; an old benchmark = time to check
  const { response = 0, worse = [], drift = null, longSteadyDays = Infinity, benchAgeDays = Infinity } = ctx;
  if (response < 0 && tsb < 0) return { id: tsb < -15 ? 'recovery' : 'endurance', why: `Your heart rate says you're not absorbing the work yet (${worse.join('; ')}). An easy day lets it catch up.` };
  if (benchAgeDays > 28 && tsb > -15 && rides.length >= 3) return { id: 'benchmark', why: benchAgeDays === Infinity ? 'A 20-minute steady benchmark gives the coach a fixed point to measure your fitness against from now on (same watts each time; your heart rate tells the story).' : `Your last benchmark was ${Math.round(benchAgeDays)} days ago: ride it again to see how your heart rate at the same watts has moved.` };
  if (drift != null && drift > 8 && longSteadyDays > 10 && tsb > -15) return { id: 'endurance', why: `Your heart rate drifts ${drift.toFixed(0)}% over your steady rides (under 5% is well trained): long steady riding is where your quickest gains are.` };
  if (tsb < -10) return hiShare > 0.2
    ? { id: 'endurance', why: `Form ${Math.round(tsb)} and plenty of intensity lately: steady endurance builds fitness without digging deeper.` }
    : { id: 'sweetspot', why: `Form ${Math.round(tsb)}: a productive place to train. Sweet spot adds fitness without needing to be fresh.` };
  if (tsb > 5 && ftpTestAgeDays > 42) return { id: 'ftptest', why: `You're fresh (form ${Math.round(tsb)}) and haven't done a hard 20 minutes in six weeks: a good day to check your FTP.` };
  if (tsb > 5) return { id: hasVo2Recently ? 'threshold' : 'vo2', why: `You're fresh (form ${Math.round(tsb)}): a day for quality. ${hasVo2Recently ? 'Threshold work' : 'VO2 max intervals'} make the most of it.` };
  return hasVo2Recently ? { id: 'sweetspot2x20', why: 'Neutral form: sustained sweet spot is the best value for time.' } : { id: 'threshold', why: 'Neutral form: threshold intervals raise your FTP.' };
}
// routes: [{ id, name, km, gain }] (gain in m over the ridden km); ctx: { tsb, recentMperKm, typicalKm }
export function suggestRoutes(routes, ctx) {
  const { tsb = 0, recentMperKm = null, typicalKm = 25 } = ctx;
  const want = tsb < -20 ? typicalKm * 0.6 : tsb > 5 ? typicalKm * 1.4 : typicalKm;
  const hilly = recentMperKm !== null && recentMperKm > 12, flat = recentMperKm !== null && recentMperKm < 6;
  const scored = routes.filter((r) => r.km > 2).map((r) => {
    const mpk = r.gain / r.km, dist = Math.abs(Math.log(r.km / want));
    const shape = hilly ? mpk / 20 : flat ? -mpk / 20 : 0;
    return { r, mpk, score: dist + shape };
  }).sort((a, b) => a.score - b.score);
  const why = (s) => {
    const bits = [];
    if (hilly && s.mpk < 8) bits.push(`flatter (${Math.round(s.mpk)} m/km): you've done a lot of climbing lately`);
    else if (flat && s.mpk > 10) bits.push(`hillier (${Math.round(s.mpk)} m/km): you haven't climbed much lately`);
    if (tsb < -20) bits.push('shorter, while you recover');
    else if (tsb > 5) bits.push('a longer one while you\'re fresh');
    else bits.push(`about your usual distance`);
    return bits.join('; ');
  };
  // (2026-11-26, the owner: "one or two from each type of world (open, classic, photo)": with `kindOf`, the best `perKind`
  // of each kind, in the order given; without, the best three as before)
  const out = (s) => ({ id: s.r.id, name: s.r.name, km: s.r.km, gain: s.r.gain, why: why(s), kind: ctx.kindOf ? ctx.kindOf(s.r) : undefined, where: s.r.where });
  if (!ctx.kindOf) return scored.slice(0, 3).map(out);
  return (ctx.kinds || []).flatMap((k) => scored.filter((s) => ctx.kindOf(s.r) === k).slice(0, ctx.perKind || 2)).map(out);
}
