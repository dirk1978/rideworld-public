// Scotland's LIDAR terrain models (Scottish Remote Sensing Portal, open data; 50 cm national programme 2020s and the
// earlier 1 m / 50 cm phases), read straight out of the public S3 tiles (../cogtiff.mjs). tiles.json (index.mjs) lists
// them by survey, newest first; a spot takes the first survey with a height there.
import fs from 'fs';
import path from 'path';
import { openTiff } from '../cogtiff.mjs';
const B = 'https://srsp-open-data.s3.eu-west-2.amazonaws.com/';
const SURVEYS = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'tiles.json'), 'utf8'))
  .map((s) => ({ ...s, set: new Set(s.names) }));

// OS grid square letters -> the square's south-west corner in metres
function square(letters) {
  const idx = (c) => { const i = c.charCodeAt(0) - 65; return i > 7 ? i - 1 : i; }; // no I
  const l1 = idx(letters[0]), l2 = idx(letters[1]);
  return { E: (((l1 - 2) % 5) * 5 + (l2 % 5)) * 100000, N: (19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5)) * 100000 };
}
const letters = (E, N) => {
  const e = Math.floor(E / 100000), n = Math.floor(N / 100000);
  for (let a = 0; a < 25; a++) for (let b = 0; b < 25; b++) {
    const L = String.fromCharCode(65 + (a > 7 ? a + 1 : a)) + String.fromCharCode(65 + (b > 7 ? b + 1 : b)), s = square(L);
    if (s.E === e * 100000 && s.N === n * 100000) return L;
  }
  return null;
};
const memo = new Map();
const lettersAt = (E, N) => { const k = `${Math.floor(E / 1e5)},${Math.floor(N / 1e5)}`; if (!memo.has(k)) memo.set(k, letters(E, N)); return memo.get(k); };

// the tile names that could hold (E, N): 10 km (NT27), 5 km quarters (NT27NE), 1 km (NT2573)
function names(E, N) {
  const L = lettersAt(E, N);
  if (!L) return [];
  const e = E % 100000, n = N % 100000, e10 = Math.floor(e / 10000), n10 = Math.floor(n / 10000);
  const q = (n % 10000 >= 5000 ? 'N' : 'S') + (e % 10000 >= 5000 ? 'E' : 'W');
  return [`${L}${e10}${n10}`, `${L}${e10}${n10}${q}`, `${L}${String(Math.floor(e / 1000)).padStart(2, '0')}${String(Math.floor(n / 1000)).padStart(2, '0')}`];
}

export async function scotDtm(E, N) {
  const cands = names(E, N);
  for (const s of SURVEYS) {
    for (const n of cands) {
      if (!s.set.has(n)) continue;
      try {
        const v = await (await openTiff(B + s.pattern.replace('{}', n))).value(E, N);
        if (Number.isFinite(v)) return v;
      } catch (e) { console.warn('scotland', n, e.message); }
    }
  }
  return NaN;
}
