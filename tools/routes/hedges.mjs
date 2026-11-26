// Hedgerows from the Environment Agency's LIDAR (2026-11-15; the owner's CCCP reports: lanes lined with hedges that
// OpenStreetMap hardly maps). Every 5 m along the route, each side, the canopy height (DSM - DTM, as canopy.mjs) is
// read outwards from 2.5 to 12 m: the first place it stands 0.8-4.5 m high, at least ~1 m thick, rough on top (a hedge;
// car roofs and garden walls are smooth or a clean step) and with open ground between it and the road is that side's
// hedge. Readings at a steady distance for 25 m+ become a run. Mapped buildings are left out. For lib/world.js:
// [{ t: 'hedge', h, pts: [[lat, lon], ...] }], drawn like OSM's hedges (public/js/app/world.js) at their own height.
import { tile, toBNG } from './bristol/lidar.mjs';
import { fromBNGNear } from './canopy.mjs';

const T = 500, STEP = 5;

// route: [{ lat, lon }] (~every 20 m); buildings: [[[lat, lon], ...]]
export async function hedgeRuns(route, buildings = [], { log = () => {} } = {}) {
  // stations every 5 m with the road's direction
  const R = route.map((p) => ({ ...toBNG(p.lat, p.lon), lat: p.lat, lon: p.lon })), S = [];
  let carry = 0;
  for (let i = 1; i < R.length; i++) {
    const a = R[i - 1], b = R[i], L = Math.hypot(b.E - a.E, b.N - a.N);
    if (L < 0.5) continue;
    const ux = (b.E - a.E) / L, uy = (b.N - a.N) / L;
    let s = carry;
    for (; s < L; s += STEP) S.push({ E: a.E + ux * s, N: a.N + uy * s, ux, uy, near: a });
    carry = s - L;
  }
  const B = buildings.map((pts) => { const q = pts.map(([la, lo]) => toBNG(la, lo)); return { q, e0: Math.min(...q.map((v) => v.E)) - 2, e1: Math.max(...q.map((v) => v.E)) + 2, n0: Math.min(...q.map((v) => v.N)) - 2, n1: Math.max(...q.map((v) => v.N)) + 2 }; });
  const inPoly = (q, E, N) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a.N > N) !== (b.N > N) && E < ((b.E - a.E) * (N - a.N)) / (b.N - a.N) + a.E) c = !c; } return c; };
  const nearBuilding = (E, N) => B.some((b) => E > b.e0 && E < b.e1 && N > b.n0 && N < b.n1 && (inPoly(b.q, E, N) || inPoly(b.q, E + 2, N) || inPoly(b.q, E - 2, N) || inPoly(b.q, E, N + 2) || inPoly(b.q, E, N - 2)));
  // tiles, cached by lidar.mjs (canopy.mjs fetched them all already)
  const tiles = new Map();
  const get = async (E, N) => {
    const tx = Math.floor(E / T), ty = Math.floor(N / T), k = `${tx},${ty}`;
    if (!tiles.has(k)) { try { tiles.set(k, { dtm: await tile('dtm', tx, ty), dsm: await tile('dsm', tx, ty), E0: tx * T, N1: ty * T + T }); } catch (e) { log(`tile ${k}: ${e.message}`); tiles.set(k, null); } }
    return tiles.get(k);
  };
  const cell = (t, E, N) => { const c = Math.floor(E - t.E0), r = Math.floor(t.N1 - N); return c < 1 || r < 1 || c >= t.dtm.w - 1 || r >= t.dtm.h - 1 ? -1 : r * t.dtm.w + c; };
  const chm = async (E, N) => { const t = await get(E, N); if (!t) return NaN; const i = cell(t, E, N); if (i < 0) return NaN; const g = t.dtm.data[i], s = t.dsm.data[i]; return g > -1000 && g < 5000 && s > -1000 && s < 5000 ? s - g : NaN; };
  const rough = async (E, N) => { const t = await get(E, N); if (!t) return 0; const i = cell(t, E, N); if (i < 0) return 0; let sum = 0, sum2 = 0, k = 0; for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const v = t.dsm.data[i + y * t.dtm.w + x]; if (v > -1000 && v < 5000) { sum += v; sum2 += v * v; k++; } } return k > 4 ? Math.sqrt(Math.max(0, sum2 / k - (sum / k) ** 2)) : 0; };
  // each side: offset and height of the hedge at every station (null = none)
  const found = { [-1]: [], [1]: [] };
  for (let si = 0; si < S.length; si++) {
    const s = S[si];
    for (const side of [-1, 1]) {
      const nx = s.uy * side, ny = -s.ux * side; // side 1 = right of the direction of travel
      let hit = null, open = 0;
      for (let o = 2.5; o <= 12; o += 0.5) {
        const E = s.E + nx * o, N = s.N + ny * o, h = await chm(E, N);
        if (!Number.isFinite(h)) break;
        if (h < 0.4) { open++; continue; }
        if (h > 4.5) break; // a tree, a building, a bank: no hedge on this line (trees come from canopy.mjs)
        if (h < 0.8) continue; // a hedge's sloping flank
        if (open < 1 && o > 2.5) break; // something solid from the road's edge out (a bank, a parked van)
        const h2 = await chm(E + nx, N + ny); // ~1 m thick
        if (!(h2 > 0.6 && h2 < 6)) continue;
        if ((await rough(E + nx * 0.5, N + ny * 0.5)) < 0.08) continue; // smooth top: a car roof, a wall
        if (nearBuilding(E, N)) break;
        hit = { o: o + 0.5, h: Math.max(h, h2) };
        break;
      }
      found[side].push(hit);
    }
    if (si % 2000 === 0 && si) log(`hedges: ${si}/${S.length} stations`);
  }
  // runs: 5+ stations in a row (25 m) with the offset steady (within 1.5 m of the run's median), gaps of up to 3 (15 m: a hedgerow tree, a gateway) allowed
  const out = [];
  const inv = new Map(); // one BNG -> WGS84 inversion per route point (good within a few hundred metres)
  const toLL = (s, E, N) => { if (!inv.has(s.near)) inv.set(s.near, fromBNGNear(s.near.lat, s.near.lon)); return inv.get(s.near)(E, N); };
  for (const side of [-1, 1]) {
    const F = found[side];
    let i = 0;
    while (i < S.length) {
      if (!F[i]) { i++; continue; }
      let j = i, miss = 0;
      const offs = [F[i].o];
      while (j + 1 < S.length) {
        const f = F[j + 1], med = offs.slice().sort((a, b) => a - b)[offs.length >> 1];
        if (f && Math.abs(f.o - med) <= 1.5) { offs.push(f.o); j++; miss = 0; } else if (!f && miss < 3 && [2, 3, 4].some((q) => F[j + q] && Math.abs(F[j + q].o - med) <= 1.5)) { j++; miss++; } else break;
      }
      if (j - i + 1 >= 5) {
        const pts = [], hs = [];
        for (let k = i; k <= j; k++) {
          // smoothed offset (median of 5) so the hedge runs straight along the lane
          const win = []; for (let q = k - 2; q <= k + 2; q++) if (q >= i && q <= j && F[q]) win.push(F[q].o);
          const o = win.sort((a, b) => a - b)[win.length >> 1], s = S[k], nx = s.uy * side, ny = -s.ux * side;
          if (F[k]) hs.push(F[k].h);
          if ((k - i) % 2 && k !== j) continue; // every 10 m is plenty
          const ll = toLL(s, s.E + nx * o, s.N + ny * o);
          pts.push([+ll[0].toFixed(6), +ll[1].toFixed(6)]);
        }
        out.push({ t: 'hedge', h: +Math.min(3.5, Math.max(1.2, hs.sort((a, b) => a - b)[hs.length >> 1])).toFixed(1), pts });
      }
      i = j + 1;
    }
  }
  return out;
}

