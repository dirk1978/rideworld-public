// Jersey designs (2026-11-03, the owner: "uploadable or included jerseys (pro tour jerseys, classic styles, etc)").
// A design is a short string kept in the account setting `design` and sent to other riders:
//   "<id>:<c1>,<c2>,<c3>"            one of DESIGNS below, in up to three colours
//   ...";img=<file>;fit=full|logo"   plus an uploaded picture (served at /api/kit/<file>): "full" is a whole jersey
//                                    painted on the template (public/img/kit-template.png), "logo" goes on the chest
//                                    and back over the design
// drawJersey paints the 1024 x 1024 texture in the layout tools/rider/build_rider.py gives the jersey (see there):
// torso rows 0-576 (u: 0 right side seam, 256 front centre, 512 left side, 768 back centre, wraps; v: collar to hem),
// sleeves rows 614-819 (left x 10-502, right 522-1014; across: underneath, outside at the middle, back underneath).
export const S = 1024;
export const T = { h: 576, front: 256, back: 768, left: 512, chest: [150, 250], sleeve: [614, 819] };
const SLEEVES = [[10, 502], [522, 1014]];

export const DESIGNS = [
  { id: 'plain', name: 'Plain', n: 2, draw: (g) => { g.base(g.c[0]); g.cuffs(g.c[1], 22); } },
  { id: 'panels', name: 'Side panels', n: 2, draw: (g) => { g.base(g.c[0]); g.sides(g.c[1], 95); g.cuffs(g.c[1], 40); } },
  { id: 'chestband', name: 'Chest band', n: 2, draw: (g) => { g.base(g.c[0]); g.band(170, 250, g.c[1]); g.cuffs(g.c[1], 30); } },
  { id: 'hoops', name: 'Hoops', n: 2, draw: (g) => { g.base(g.c[0]); for (let y = 90; y < T.h; y += 110) g.band(y, y + 55, g.c[1]); g.sleeveBands([[60, 110], [160, 205]], g.c[1]); } },
  { id: 'stripes', name: 'Stripes', n: 2, draw: (g) => { g.base(g.c[0]); for (let x = 0; x < S; x += 64) g.rect(x, 0, 32, T.h, g.c[1]); g.cuffs(g.c[1], 30); } },
  { id: 'sash', name: 'Sash', n: 2, draw: (g) => { g.base(g.c[0]); g.sash(g.c[1], 70); g.cuffs(g.c[1], 22); } },
  { id: 'fade', name: 'Fade', n: 2, draw: (g) => { g.fade(g.c[0], g.c[1]); g.cuffs(g.c[1], 22); } },
  { id: 'yoke', name: 'Shoulders', n: 2, draw: (g) => { g.base(g.c[0]); g.yoke(g.c[1], 120); } },
  { id: 'split', name: 'Two-tone', n: 2, draw: (g) => { g.base(g.c[0]); g.poly([...Array.from({ length: 33 }, (_, k) => [(k * S) / 32, 250 + 90 * (((k * S) / 32 % 512) / 512)]), [S, T.h + 10], [0, T.h + 10]], g.c[1]); g.cuffs(g.c[1], 22); } },
  { id: 'chevron', name: 'Chevron', n: 3, draw: (g) => { g.base(g.c[0]); g.chevron(g.c[2], 70, 26); g.chevron(g.c[1], 70, 0); g.cuffs(g.c[1], 22); } },
  { id: 'rainbow', name: 'Rainbow bands', n: 1, draw: (g) => { g.base(g.c[0]); g.rainbow(175, 16); g.sleeveRainbow(); } },
  { id: 'polka', name: 'Polka dots', n: 2, draw: (g) => { g.base(g.c[0]); g.dots(g.c[1], 19, 64); } },
  { id: 'chequer', name: 'Chequer band', n: 3, draw: (g) => { g.base(g.c[0]); g.chequer(165, 2, 40, g.c[1], g.c[2]); g.band(355, 380, g.c[1]); g.cuffs(g.c[1], 26); } },
  { id: 'cubes', name: '90s cubes', n: 3, draw: (g) => { g.base(g.c[0]); g.cubes([g.c[1], g.c[2], '#e62e2d']); g.cuffs(g.c[1], 26); } },
  { id: 'mondrian', name: 'Mondrian', n: 3, draw: (g) => { g.base('#f4f2ec'); g.mondrian(g.c); } },
  // (2026-11-14) champions' chest bands in three colours over the base, and a diagonal split with a stripe along it
  { id: 'band3', name: 'Three bands', n: 4, draw: (g) => { g.base(g.c[0]); [g.c[1], g.c[2], g.c[3]].forEach((col, k) => g.band(150 + k * 38, 188 + k * 38, col)); g.sleeveRect(150, 162, g.c[1]); g.sleeveRect(164, 176, g.c[2]); g.sleeveRect(178, 190, g.c[3]); } },
  { id: 'diagonal', name: 'Diagonal', n: 3, draw: (g) => { g.base(g.c[0]); g.diag(g.c[1], g.c[2]); g.cuffs(g.c[2], 22); } },
];

// Ready-made kits in groups (2026-11-14, the owner: "more classic and famous grand tour top designs, maybe categorised"):
// famous looks recreated with our patterns, no logos; team looks carry PES-style near-names (misspelt, so recognisable: the owner
// couldn't tell which was which from place-name nicknames), never the real names; the site's front page is public
export const PRESET_GROUPS = [
  ['Grand Tour leaders', [
    ['Tour: yellow', 'plain:#ffd200,#1b1b1b'],
    ['Tour: green', 'panels:#23a339,#14632a'],
    ['Tour: polka dots', 'polka:#ffffff,#d6202e'],
    ['Tour: white', 'plain:#ffffff,#1b1b1b'],
    ['Giro: pink', 'plain:#f39ab8,#1b1b1b'],
    ['Giro: cyclamen', 'plain:#b8337c,#1b1b1b'],
    ['Giro: blue', 'plain:#2d7fd3,#0d2f6e'],
    ['Giro: white', 'plain:#ffffff,#f39ab8'],
    ['Vuelta: red', 'plain:#d61f26,#1b1b1b'],
    ['Vuelta: green', 'plain:#2e9e44,#14632a'],
    ['Vuelta: blue dots', 'polka:#ffffff,#2a5db0'],
    ['Vuelta: white', 'plain:#ffffff,#d61f26'],
  ]],
  ['Champions', [
    ['World champion', 'rainbow:#ffffff'],
    ['British champion', 'band3:#ffffff,#c8102e,#012169,#c8102e'],
    ['French champion', 'band3:#ffffff,#0055a4,#ffffff,#ef4135'],
    ['Belgian champion', 'band3:#ffffff,#000000,#fdda24,#ef3340'],
    ['Italian champion', 'band3:#ffffff,#009246,#ffffff,#ce2b37'],
    ['Spanish champion', 'band3:#ffffff,#c60b1e,#ffc400,#c60b1e'],
    ['Dutch champion', 'band3:#ffffff,#ae1c28,#ffffff,#21468b'],
    ['German champion', 'band3:#ffffff,#000000,#dd0000,#ffce00'],
  ]],
  ['Classic teams', [
    ['Moltani \'74', 'chestband:#ef7d00,#111111'],
    ['Peugot Chequer \'83', 'chequer:#ffffff,#141414,#ffffff'],
    ['TI-Raleig \'80', 'band3:#d6202e,#111111,#f6c400,#111111'],
    ['Renolt-Elph \'84', 'diagonal:#ffd400,#ffffff,#111111'],
    ['La Vie Clair \'86', 'mondrian:#d52b1e,#f2c700,#1b4b9b'],
    ['Bianki Celeste', 'plain:#57c1c0,#111111'],
    ['Mappei Cubes \'96', 'cubes:#ffffff,#2350c8,#f4c20d'],
    ['Banesta \'93', 'panels:#0d2a6b,#5ab0e8'],
    ['ONSE \'97', 'panels:#ffe100,#111111'],
    ['Telecom Magenta \'97', 'plain:#e20074,#ffffff'],
    ['Faima \'68', 'yoke:#ffffff,#d61f26'],
    ['Club Bleu \'55', 'hoops:#ffffff,#1f4fa3'],
  ]],
  ['Modern teams', [
    ['Team Vizma', 'split:#ffd400,#111111'],
    ['UAE Emiratez', 'band3:#ffffff,#111111,#d61f26,#11873a'],
    ['Red Bul-Bora', 'chevron:#0e1d3d,#d6202e,#f2c200'],
    ['Movistarz', 'panels:#0a2b5e,#9fd16a'],
    ['Alpeasin', 'yoke:#0b1f4a,#3a8fd9'],
    ['Ineoz Grenadiers', 'chevron:#0e1a35,#c8102e,#ffffff'],
    ['Quick-Steppers', 'fade:#1e5bc6,#0b1f4a'],
    ['Lidel-Trekk', 'band3:#0a3d91,#d6202e,#f6c400,#d6202e'],
    ['EF Pink', 'yoke:#f37ab0,#1b2a5e'],
    ['Decathlon AG2Arr', 'panels:#7fb4e3,#4a2c1a'],
    ['Sky \'12', 'yoke:#111418,#36a3ef'],
    ['Astanna', 'panels:#00a7c4,#ffd100'],
  ]],
  ['Fun', [
    ['Black and gold', 'chestband:#121212,#d9a520'],
    ['Orange fade', 'fade:#ff6a1a,#7a1020'],
    ['Lime two-tone', 'split:#c8f031,#1d1f24'],
    ['Purple fade', 'fade:#7b3fe4,#1a1033'],
  ]],
  ['Club classics', [
    ['Classic hoops', 'hoops:#0d2f6e,#ffffff'],
    ['Belgian sash', 'sash:#ffffff,#d61f26'],
    ['Tricolore', 'chevron:#ffffff,#0b3d91,#d61f26'],
    ['Retro stripes', 'stripes:#ffffff,#0b6fb8'],
    ['Green & white hoops', 'hoops:#ffffff,#1d8a3a'],
    ['Black & white stripes', 'stripes:#ffffff,#111111'],
  ]],
];
export const PRESETS = PRESET_GROUPS.flatMap(([, items]) => items);

const HEX = /^#[0-9a-f]{6}$/i, FILE = /^[a-z0-9_-]{1,40}-[0-9a-f]{12}\.(png|jpg|webp)$/;
export function parseDesign(str, fallback = '#ff6a1a') {
  const [head, ...opts] = String(str || '').split(';');
  const [id, cs = ''] = head.split(':');
  const d = DESIGNS.find((x) => x.id === id) || DESIGNS[0];
  const c = cs.split(',').filter((x) => HEX.test(x));
  const def = [fallback, '#1b1f27', '#ffffff', '#111111'];
  const o = Object.fromEntries(opts.map((s) => s.split('=')));
  return { id: d.id, d, c: [0, 1, 2, 3].map((k) => c[k] || def[k]), img: FILE.test(o.img || '') ? o.img : null, fit: o.fit === 'full' ? 'full' : 'logo' };
}
export const designString = (p) => `${p.id}:${p.c.slice(0, p.d?.n ?? 3).join(',')}${p.img ? `;img=${p.img};fit=${p.fit}` : ''}`;
// what the server lets through (also lib/multiplayer.js)
export const validDesign = (s) => typeof s === 'string' && s.length < 120 && /^[a-z0-9]+:(#[0-9a-f]{6},?){0,4}(;img=[a-z0-9_.-]+;fit=(full|logo))?$/i.test(s);

// --- drawing ---
function painter(ctx, c) {
  const wrapX = (fn) => { for (const dx of [-S, 0, S]) { ctx.save(); ctx.translate(dx, 0); fn(); ctx.restore(); } };
  const torsoClip = (fn) => { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, S, T.h + 8); ctx.clip(); fn(); ctx.restore(); };
  const g = {
    c, ctx,
    base(col) { ctx.fillStyle = col; ctx.fillRect(0, 0, S, S); },
    rect(x, y, w, h, col) { torsoClip(() => wrapX(() => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); })); },
    poly(pts, col) { torsoClip(() => wrapX(() => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); })); },
    band(y0, y1, col) { g.rect(0, y0, S, y1 - y0, col); },
    // sleeve rows, measured from the shoulder (0) to the cuff (205)
    sleeveRect(v0, v1, col, u0 = 0, u1 = 1) { ctx.fillStyle = col; for (const [a, b] of SLEEVES) ctx.fillRect(a + (b - a) * u0, T.sleeve[0] + v0, (b - a) * (u1 - u0), v1 - v0); },
    sleeveBands(list, col) { for (const [a, b] of list) g.sleeveRect(a, b, col); },
    cuffs(col, w) { g.sleeveRect(205 - w, 210, col); },
    sides(col, w) { g.rect(-w, 0, 2 * w, T.h, col); g.rect(T.left - w, 0, 2 * w, T.h, col); g.sleeveRect(0, 210, col, 0, 0.18); g.sleeveRect(0, 210, col, 0.82, 1); },
    yoke(col, h) {
      // shoulders: a curve dipping lower at the sides of the neck than at the side seams
      g.poly([[0, 0], [S, 0], ...Array.from({ length: 33 }, (_, k) => [S - (k * S) / 32, h * (0.55 + 0.45 * Math.abs(Math.cos((k / 32) * 2 * Math.PI)))])], col);
      g.sleeveRect(0, 210, col);
    },
    fade(a, b) { const gr = ctx.createLinearGradient(0, 40, 0, T.h); gr.addColorStop(0, a); gr.addColorStop(1, b); ctx.fillStyle = gr; ctx.fillRect(0, 0, S, T.h + 8); ctx.fillStyle = a; ctx.fillRect(0, T.sleeve[0], S, 220); },
    diag(lower, stripe) { // the lower right of front and back in another colour, a stripe along the edge
      for (const [cx, dir] of [[T.front, 1], [T.back, -1]]) {
        g.poly([[cx - dir * 260, T.h + 10], [cx + dir * 260, -10], [cx + dir * 400, -10], [cx + dir * 400, T.h + 10]], lower);
        g.poly([[cx - dir * 260, T.h + 10], [cx + dir * 260, -10], [cx + dir * 300, -10], [cx - dir * 220, T.h + 10]], stripe);
      }
      g.sleeveRect(0, 210, lower, 0.5, 1);
    },
    sash(col, w) {
      // over the left shoulder, across the front to the right hip; the same on the back
      for (const [cx, dir] of [[T.front, 1], [T.back, -1]]) g.poly([[cx + dir * 150, -10], [cx + dir * 150 + w, -10], [cx - dir * 230 + w, T.h + 10], [cx - dir * 230, T.h + 10]], col);
    },
    chevron(col, w, grow) {
      for (const cx of [T.front, T.back]) g.poly([[cx - 250, 60 - grow], [cx, 260 - grow], [cx + 250, 60 - grow], [cx + 250, 60 + w + grow], [cx, 260 + w + grow], [cx - 250, 60 + w + grow]], col);
    },
    rainbow(y, h) { ['#2a62c8', '#d6202e', '#111111', '#f6c400', '#1f9a3b'].forEach((col, k) => g.band(y + k * h, y + (k + 1) * h, col)); },
    sleeveRainbow() { ['#2a62c8', '#d6202e', '#111111', '#f6c400', '#1f9a3b'].forEach((col, k) => g.sleeveRect(150 + k * 11, 161 + k * 11, col)); },
    dots(col, r, step) {
      ctx.fillStyle = col;
      for (let y = 20, row = 0; y < T.h + r; y += step * 0.866, row++) for (let x = (row % 2) * step / 2; x < S + step; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
      for (const [a, b] of SLEEVES) for (let y = 20, row = 0; y < 205; y += step * 0.866, row++) for (let x = a + (row % 2) * step / 2; x < b; x += step) { ctx.beginPath(); ctx.arc(x, T.sleeve[0] + y, r * 0.8, 0, 2 * Math.PI); ctx.fill(); }
    },
    chequer(y, rows, sq, dark, light) {
      for (let r = 0; r < rows; r++) for (let x = 0; x < S; x += sq) g.rect(x, y + r * sq, sq, sq, ((x / sq + r) % 2) ? light : dark);
      g.band(y - 8, y, dark); g.band(y + rows * sq, y + rows * sq + 8, dark);
    },
    cubes(cols) {
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const sq = 46;
      for (let y = 40; y < T.h - 40; y += sq) for (let x = 0; x < S; x += sq) {
        const p = (y - 40) / (T.h - 80), k = rnd();
        if (k < 0.75 - 0.6 * Math.abs(p - 0.45)) g.rect(x + 1, y + 1, sq - 2, sq - 2, cols[Math.floor(rnd() * cols.length)]);
      }
      for (const [a, b] of SLEEVES) for (let y = 0; y < 180; y += sq) for (let x = a; x < b; x += sq) if (rnd() < 0.5) { ctx.fillStyle = cols[Math.floor(rnd() * cols.length)]; ctx.fillRect(x + 1, T.sleeve[0] + y + 1, sq - 2, sq - 2); }
    },
    mondrian([red, yellow, blue]) {
      const L = '#121212', lw = 12;
      g.rect(0, 0, S, 130, L); g.rect(0, 0, S, 118, red);                 // shoulders red
      g.rect(T.front - 40, 130, 330, 190, blue); g.rect(T.back - 300, 130, 260, 190, yellow);
      g.rect(T.front + 130, 330, 230, 246, yellow); g.rect(T.back + 60, 330, 300, 246, blue);
      for (const y of [118, 320, 330]) g.band(y, y + lw, L);
      for (const x of [T.front - 52, T.front + 118, T.front + 290, T.back - 312, T.back - 40, T.back + 48, T.back + 360]) g.rect(x, 118, lw, T.h, L);
      g.sleeveRect(0, 210, red); g.sleeveRect(150, 162, L);
    },
  };
  return g;
}

export function drawJersey(canvas, design, img = null) {
  const p = typeof design === 'string' ? parseDesign(design) : design;
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (img && p.fit === 'full') { ctx.drawImage(img, 0, 0, S, S); return canvas; }
  p.d.draw(painter(ctx, p.c));
  if (img) { // a logo on the chest and a bigger one on the back, keeping its shape
    const put = (cx, cy, w, h) => { const k = Math.min(w / img.width, h / img.height); ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k); };
    put(T.front, 215, 230, 130); put(T.back, 250, 300, 170);
  }
  return canvas;
}

// a small front view for the picker: the front half of the torso inside a jersey outline, sleeves from the sleeve rows
export function drawThumb(canvas, tex, side = 'front') {
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const k = w / 120;
  const shirt = new Path2D(`M${38 * k} ${8 * k} L${50 * k} ${4 * k} Q${60 * k} ${14 * k} ${70 * k} ${4 * k} L${82 * k} ${8 * k} L${112 * k} ${30 * k} L${100 * k} ${48 * k} L${88 * k} ${40 * k} L${88 * k} ${112 * k} L${32 * k} ${112 * k} L${32 * k} ${40 * k} L${20 * k} ${48 * k} L${8 * k} ${30 * k} Z`);
  ctx.save(); ctx.clip(shirt);
  ctx.drawImage(tex, (side === 'back' ? T.back : T.front) - 150, 20, 300, T.h - 20, 22 * k, 6 * k, 76 * k, 108 * k);                  // body
  for (const [[a, b], A, B] of [[SLEEVES[1], [36, 21], [13, 40]], [SLEEVES[0], [84, 21], [107, 40]]]) { // image left = wearer's right
    const dx = (B[0] - A[0]) * k, dy = (B[1] - A[1]) * k, len = Math.hypot(dx, dy);
    ctx.save(); ctx.translate(A[0] * k, A[1] * k); ctx.rotate(Math.atan2(dy, dx) - Math.PI / 2);
    ctx.drawImage(tex, a + (b - a) * 0.3, T.sleeve[0], (b - a) * 0.4, 205, -17 * k, -4 * k, 34 * k, len + 8 * k);
    ctx.restore();
  }
  ctx.restore();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke(shirt);
  return canvas;
}

// The template for a whole-jersey upload: the layout, labelled (paint over it at 1024 x 1024 and upload the result)
export function drawTemplate(canvas) {
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  const shade = [['#fde3d3', 0, 256, 'RIGHT SIDE → FRONT'], ['#fdf0c8', 256, 512, 'FRONT → LEFT SIDE'], ['#d9ecfb', 512, 768, 'LEFT SIDE → BACK'], ['#e2f5dc', 768, 1024, 'BACK → RIGHT SIDE']];
  ctx.font = '600 20px sans-serif'; ctx.textAlign = 'center';
  for (const [col, a, b, label] of shade) { ctx.fillStyle = col; ctx.fillRect(a, 0, b - a, T.h); ctx.fillStyle = '#555'; ctx.fillText(label, (a + b) / 2, T.h - 18); }
  ctx.strokeStyle = '#999'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
  for (const x of [T.front, T.back]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, T.h); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = '#666';
  for (const y of T.chest) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
  ctx.fillStyle = '#222'; ctx.font = 'bold 44px sans-serif';
  ctx.fillText('FRONT', T.front, 215); ctx.fillText('BACK', T.back, 215);
  ctx.font = '600 18px sans-serif'; ctx.fillStyle = '#555';
  ctx.fillText('collar (top of the shoulders)', T.front, 24); ctx.fillText('collar', T.back, 24);
  ctx.fillText('chest: logos and bands look best between the lines', T.back, T.chest[1] + 26);
  ctx.fillText('hem', T.front, T.h - 40);
  SLEEVES.forEach(([a, b], k) => {
    ctx.fillStyle = k ? '#e8dcf7' : '#f7dcec'; ctx.fillRect(a, T.sleeve[0], b - a, T.sleeve[1] - T.sleeve[0]);
    ctx.fillStyle = '#444'; ctx.font = 'bold 26px sans-serif'; ctx.fillText(k ? 'RIGHT SLEEVE' : 'LEFT SLEEVE', (a + b) / 2, T.sleeve[0] + 100);
    ctx.font = '600 16px sans-serif'; ctx.fillStyle = '#555';
    ctx.fillText('shoulder', (a + b) / 2, T.sleeve[0] + 22); ctx.fillText('cuff', (a + b) / 2, T.sleeve[1] - 10);
    ctx.fillText('underneath', a + 50, T.sleeve[0] + 140); ctx.fillText('outside', (a + b) / 2, T.sleeve[0] + 140); ctx.fillText('underneath', b - 50, T.sleeve[0] + 140);
  });
  ctx.fillStyle = '#888'; ctx.font = '16px sans-serif';
  ctx.fillText('RideWorld jersey template · 1024 × 1024 · the grey area is not used', S / 2, S - 60);
  return canvas;
}
