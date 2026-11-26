// Buildings with a face (2026-11-15, the owner: "are you able to build more 3d models for common things like churches,
// shops, houses, pubs?"): instead of plain coloured blocks, walls get a texture by what the building is (from its OSM
// building tag and any named place inside it): houses in brick or cream render with windows (and chimneys on pitched
// roofs); shops with a glazed shopfront and fascia; pubs with a dark painted ground floor, small-paned windows and a
// sign band; churches in stone with tall arched windows, a tower and a spire; warehouses in ribbed cladding; offices,
// schools and flats with bands of windows. One texture repeat = one bay (3.2 m) by one storey (3 m), so windows come
// out the right size on any wall. Used by world.js buildChunk; textures are drawn here on canvases.
import { C } from './core.js';

const BAY = 3.2, STOREY = 3.0, GROUND = 4.0;
const BAYW = {}; // (houses: 5.6 m bays, one window each; filled from HOUSE below)
const HOUSE_KEYS = ['brickRed', 'brickOrange', 'brickBuff', 'renderCream', 'renderWhite', 'renderSage', 'renderBlue', 'renderPeach', 'stockBrick', 'stuccoWhite', 'redVictorian'];
BAYW.portland = 4.0; BAYW.glassT = 3.0; BAYW.gothic = 3.0;
// the world's flavour (world.data.flavour, tools/openworld/landmarks/<id>.json): 'london' swaps the Worcestershire palette for
// London's (2026-11-17): stock brick and stucco terraces, Portland stone offices, glass towers
let FLAVOUR = '';
export function setFlavour(f) { FLAVOUR = f || ''; }
for (const k of HOUSE_KEYS) { BAYW[k] = 5.6; BAYW[k + 'G'] = 5.6; BAYW[k + 'W'] = 5.6; }
for (let i = 0; i < 6; i++) BAYW['shop' + i] = 5.6; // (set here, before any wall is built: in looks() it came too late for the first square)

// ---------- textures ----------
function tex(draw, w = 128, h = 128) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function rng(seed) { let s = (seed * 9301 + 49297) % 2147483647 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function grain(g, w, h, base, vary, seed = 7) {
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 6; i++) { const v = (r() - 0.5) * vary; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
}
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const shade = ([r, g, b], f) => `rgb(${Math.max(0, Math.min(255, r * f)) | 0},${Math.max(0, Math.min(255, g * f)) | 0},${Math.max(0, Math.min(255, b * f)) | 0})`;
// (2026-11-16, the owner: get the houses up to Zwift's quality) Textures drawn at ~90 px per metre, with the depth cues a
// flat wall needs: every brick its own shade, window reveals in shadow, frames, sills that cast a shadow, lintels,
// a plinth and ambient darkening at the foot of the wall, doors with panels and a fanlight.
function brickWall(g, w, h, base, seed, bw = 20, bh = 6.4) {
  const r = rng(seed), c = hex(base);
  g.fillStyle = shade(c, 1.35); g.fillRect(0, 0, w, h); // mortar (close to the brick: a pale mortar shimmered at a distance)
  for (let row = 0, y = 0; y < h; row++, y += bh) for (let x = row % 2 ? -bw / 2 : 0; x < w; x += bw) {
    g.fillStyle = shade(c, 0.86 + r() * 0.26); g.fillRect(x + 1, y + 1, bw - 1.6, bh - 1.4);
    if (r() < 0.12) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 1, y + 1, bw - 1.6, bh - 1.4); }
  }
}
function renderWall(g, w, h, base, seed) {
  const r = rng(seed); grain(g, w, h, base, 0.05, seed);
  for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, rad = 20 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
}
// a window: x, y top-left of the glass area, w, h; brick: a soldier-course lintel (else a plain stone header)
function windowHQ(g, x, y, w, h, brick, frame = '#f4f2ec') {
  // the reveal (the opening's depth): dark, deeper at the top and left (light from above)
  g.fillStyle = 'rgba(20,16,12,0.55)'; g.fillRect(x - 9, y - 9, w + 18, h + 14);
  // lintel
  if (brick) { g.fillStyle = 'rgba(70,35,25,0.55)'; for (let k = x - 14; k < x + w + 14; k += 7) g.fillRect(k, y - 24, 6, 14); }
  else { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 14, y - 22, w + 28, 12); g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x - 14, y - 10, w + 28, 2); }
  // frame
  g.fillStyle = frame; g.fillRect(x - 4, y - 4, w + 8, h + 8);
  // glass: sky above, darker below, a diagonal reflection
  const gl = g.createLinearGradient(0, y, 0, y + h); gl.addColorStop(0, '#b9cddd'); gl.addColorStop(0.35, '#6f8597'); gl.addColorStop(1, '#2a333d');
  const pane = (px, py, pw, ph) => { g.fillStyle = gl; g.fillRect(px, py, pw, ph); g.save(); g.beginPath(); g.rect(px, py, pw, ph); g.clip(); g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(px + pw * 0.15, py + ph); g.lineTo(px + pw * 0.45, py + ph); g.lineTo(px + pw * 0.95, py); g.lineTo(px + pw * 0.65, py); g.closePath(); g.fill(); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, py, pw, 5); g.fillRect(px, py, 4, ph); g.restore(); };
  const tr = y + h * 0.3, mid = x + w / 2;
  pane(x, y, w, tr - y - 3); // top lights
  pane(x, tr + 3, w / 2 - 3, y + h - tr - 3); pane(mid + 3, tr + 3, w / 2 - 3, y + h - tr - 3);
  g.fillStyle = frame; g.fillRect(x, tr - 3, w, 6); g.fillRect(mid - 3, tr, 6, y + h - tr);
  // sill: stone, wider than the opening, with its shadow below
  g.fillStyle = '#e4ddcf'; g.fillRect(x - 13, y + h + 5, w + 26, 9);
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x - 13, y + h + 5, w + 26, 2);
  const sh = g.createLinearGradient(0, y + h + 14, 0, y + h + 26); sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(x - 11, y + h + 14, w + 22, 12);
}
function doorHQ(g, x, y, w, h, colour, brick) {
  g.fillStyle = 'rgba(20,16,12,0.6)'; g.fillRect(x - 8, y - 8, w + 16, h + 8); // reveal
  if (brick) { g.fillStyle = 'rgba(70,35,25,0.55)'; for (let k = x - 12; k < x + w + 12; k += 7) g.fillRect(k, y - 22, 6, 14); }
  g.fillStyle = '#f2efe8'; g.fillRect(x - 4, y - 4, w + 8, h + 4); // frame
  const fan = h * 0.17;
  const gl = g.createLinearGradient(0, y, 0, y + fan); gl.addColorStop(0, '#a9bfd0'); gl.addColorStop(1, '#4a5a68');
  g.fillStyle = gl; g.fillRect(x, y, w, fan - 4); // fanlight
  const c = hex(colour), dy = y + fan;
  g.fillStyle = colour; g.fillRect(x, dy, w, h - fan);
  // panels
  for (const [px, py, pw, ph] of [[0.14, 0.08, 0.32, 0.36], [0.54, 0.08, 0.32, 0.36], [0.14, 0.52, 0.32, 0.4], [0.54, 0.52, 0.32, 0.4]]) {
    const X = x + w * px, Y = dy + (h - fan) * py, W = w * pw, H = (h - fan) * ph;
    g.fillStyle = shade(c, 0.78); g.fillRect(X, Y, W, H); g.fillStyle = shade(c, 1.15); g.fillRect(X + 2, Y + H - 2, W - 2, 2); g.fillRect(X + W - 2, Y + 2, 2, H - 2);
  }
  g.fillStyle = '#d8c070'; g.fillRect(x + w * 0.82, dy + (h - fan) * 0.48, 5, 9); // handle
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, dy, w, 4);
  g.fillStyle = '#d9d2c4'; g.fillRect(x - 12, y + h, w + 24, 10); // step
}
// the foot of a ground floor: a plinth and the darkening where wall meets ground
function plinth(g, w, h, brick) {
  g.fillStyle = brick ? 'rgba(45,25,20,0.55)' : 'rgba(80,78,74,0.75)'; g.fillRect(0, h - 26, w, 26);
  g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, h - 27, w, 2);
  const ao = g.createLinearGradient(0, h - 70, 0, h); ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = ao; g.fillRect(0, h - 70, w, 70);
}
// house walls: one bay = 5.6 m (512 px) by one storey (3 m, 256 px; the ground floor 2.7 m)
const HOUSE = {
  brickRed: { brick: '#8e4a36', door: '#1d3557' }, brickOrange: { brick: '#a65c40', door: '#2d6a4f' }, brickBuff: { brick: '#b99a6b', door: '#7a1f2b' },
  renderCream: { render: '#e9dfc4', door: '#264653' }, renderWhite: { render: '#f1efe9', door: '#1b1b1b' }, renderSage: { render: '#c6d1b4', door: '#5b3a29' },
  renderBlue: { render: '#c3d0da', door: '#8a1c1c' }, renderPeach: { render: '#ecc7a2', door: '#1d3557' },
  stockBrick: { brick: '#a3906a', door: '#111111' }, stuccoWhite: { render: '#f0ede4', door: '#151515' }, redVictorian: { brick: '#93492f', door: '#1f3f2a' }, // (London)
};
function houseUpper(spec, seed) {
  return tex((g, w, h) => { if (spec.brick) brickWall(g, w, h, spec.brick, seed); else renderWall(g, w, h, spec.render, seed); windowHQ(g, 201, 70, 110, 112, !!spec.brick); }, 512, 256);
}
function houseGround(spec, seed, door = true) {
  return tex((g, w, h) => {
    if (spec.brick) brickWall(g, w, h, spec.brick, seed + 1, 20, 7.1); else renderWall(g, w, h, spec.render, seed + 1);
    if (door) doorHQ(g, 96, 52, 84, 186, spec.door, !!spec.brick); else windowHQ(g, 84, 58, 112, 108, !!spec.brick); // (the other walls: windows, no door)
    windowHQ(g, 300, 58, 112, 108, !!spec.brick);
    plinth(g, w, h, !!spec.brick);
  }, 512, 256);
}
let T = null;
function textures() {
  if (T) return T;
  T = {
    stone: tex((g, w, h) => {
      grain(g, w, h, '#b8ad98', 0.14, 3);
      g.fillStyle = 'rgba(90,80,65,0.35)'; for (let y = 0; y < h; y += 16) { g.fillRect(0, y, w, 1.5); for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) g.fillRect(x, y, 1.5, 16); }
      g.fillStyle = '#e8e2d2'; g.beginPath(); g.moveTo(46, 118); g.lineTo(46, 40); g.arc(64, 40, 18, Math.PI, 0); g.lineTo(82, 118); g.closePath(); g.fill(); // lancet window
      const gl = g.createLinearGradient(0, 30, 0, 118); gl.addColorStop(0, '#5c6f8c'); gl.addColorStop(1, '#2d3442');
      g.fillStyle = gl; g.beginPath(); g.moveTo(50, 116); g.lineTo(50, 42); g.arc(64, 42, 14, Math.PI, 0); g.lineTo(78, 116); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,30,30,0.6)'; g.lineWidth = 1.2; for (let y = 50; y < 116; y += 10) { g.beginPath(); g.moveTo(50, y); g.lineTo(78, y); g.stroke(); } g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 116); g.stroke();
    }),
    cladding: tex((g, w, h) => { grain(g, w, h, '#a8adb2', 0.06); for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 2, 0, 1, h); } }),
    office: tex((g, w, h) => { grain(g, w, h, '#d4d1ca', 0.06); const gl = g.createLinearGradient(0, 30, 0, 96); gl.addColorStop(0, '#8fa6ba'); gl.addColorStop(1, '#34404c'); g.fillStyle = gl; g.fillRect(0, 34, w, 58); g.fillStyle = '#c8c4bc'; for (let x = 0; x < w; x += 32) g.fillRect(x, 34, 4, 58); }),
  };
  // London (2026-11-17): Portland stone offices (one 4 m bay x one storey: a tall sash window in a stone grid, a cornice
  // line), curtain-wall glass (3 m bays: floor bands, mullions, sky reflection), Gothic panelling (the Palace of
  // Westminster's long fronts: honey stone, two narrow pointed windows a bay)
  T.portland = tex((g, w, h) => {
    grain(g, w, h, '#ddd6c6', 0.07, 31); g.fillStyle = 'rgba(90,80,65,0.25)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
    windowHQ(g, 176, 46, 160, 150, false, '#ece8de'); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, w, 10); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 10, w, 4);
  }, 512, 256);
  T.glassT = tex((g, w, h) => {
    const gl = g.createLinearGradient(0, 0, w, h); gl.addColorStop(0, '#9fb6c6'); gl.addColorStop(0.5, '#5f7586'); gl.addColorStop(1, '#8aa1b2'); g.fillStyle = gl; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(w * 0.2, h); g.lineTo(w * 0.5, 0); g.lineTo(w * 0.7, 0); g.lineTo(w * 0.4, h); g.fill();
    g.fillStyle = '#3c4650'; g.fillRect(0, h - 22, w, 22); g.fillStyle = '#c9d0d6'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 5, h);
  }, 512, 256);
  T.gothic = tex((g, w, h) => {
    grain(g, w, h, '#c8b088', 0.08, 41); g.fillStyle = 'rgba(80,60,35,0.3)'; for (let y = 0; y < h; y += 28) g.fillRect(0, y, w, 1.5);
    for (const cx of [128, 384]) {
      g.fillStyle = 'rgba(70,52,30,0.45)'; g.beginPath(); g.moveTo(cx - 52, 240); g.lineTo(cx - 52, 70); g.quadraticCurveTo(cx - 52, 20, cx, 8); g.quadraticCurveTo(cx + 52, 20, cx + 52, 70); g.lineTo(cx + 52, 240); g.fill(); // the panel
      const gl = g.createLinearGradient(0, 50, 0, 220); gl.addColorStop(0, '#70839a'); gl.addColorStop(1, '#262d36');
      g.fillStyle = gl; g.beginPath(); g.moveTo(cx - 30, 220); g.lineTo(cx - 30, 80); g.quadraticCurveTo(cx - 30, 44, cx, 34); g.quadraticCurveTo(cx + 30, 44, cx + 30, 80); g.lineTo(cx + 30, 220); g.fill();
      g.fillStyle = '#c8b088'; g.fillRect(cx - 2, 40, 4, 180); g.fillRect(cx - 30, 130, 60, 4);
    }
    g.fillStyle = 'rgba(255,240,210,0.35)'; for (const x of [0, 252, 504]) g.fillRect(x, 0, 8, h); // buttress strips
  }, 512, 256);
  // houses (HOUSE: brick / render colours, each with its own door colour): upper storeys and a ground floor with a door
  Object.entries(HOUSE).forEach(([k, spec], i) => { T[k] = houseUpper(spec, 11 + i * 7); T[k + 'G'] = houseGround(spec, 13 + i * 7); T[k + 'W'] = houseGround(spec, 13 + i * 7, false); });
  // shopfronts (ground floor, 4 m high; one 5.6 m bay = 512 px): fascia with pale lettering, pilasters, a recessed door
  // between two deep plate-glass windows over panelled stall risers (2026-11-16, towards Zwift's shops)
  const FASCIA = ['#1f3f6e', '#8a1c2b', '#20503a', '#2a2a2a', '#b5651d', '#5b2a6e'];
  T.shop = FASCIA.map((f, fi) => tex((g, w, h) => {
    const r = rng(70 + fi);
    grain(g, w, h, '#e8e2d6', 0.05, 70 + fi); // pilasters and surround
    g.fillStyle = f; g.fillRect(14, 8, w - 28, 52); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(14, 8, w - 28, 3); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(14, 57, w - 28, 3);
    g.fillStyle = 'rgba(255,248,230,0.9)'; let x = 60 + r() * 40; const end = w - 60 - r() * 40; while (x < end) { const lw = 10 + r() * 16; g.fillRect(x, 22, lw, 24); x += lw + (r() < 0.2 ? 18 : 5); } // lettering
    g.fillStyle = '#cfc8ba'; g.fillRect(0, 64, w, 6); // cornice
    const pane = (px, pw) => {
      g.fillStyle = 'rgba(20,16,12,0.6)'; g.fillRect(px - 6, 78, pw + 12, 132); // the reveal
      const gl = g.createLinearGradient(0, 80, 0, 200); gl.addColorStop(0, '#c4d4e0'); gl.addColorStop(0.4, '#6e8496'); gl.addColorStop(1, '#2f3a45');
      g.fillStyle = gl; g.fillRect(px, 84, pw, 118);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.moveTo(px + pw * 0.1, 202); g.lineTo(px + pw * 0.35, 202); g.lineTo(px + pw * 0.75, 84); g.lineTo(px + pw * 0.5, 84); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, 84, pw, 8); // the fascia's shadow on the glass
      for (let k = 0; k < 4; k++) { g.fillStyle = `hsl(${r() * 360},45%,${45 + r() * 20}%)`; g.fillRect(px + 10 + r() * (pw - 40), 150 + r() * 30, 14 + r() * 18, 20 + r() * 20); } // goods on display
      g.fillStyle = f; g.fillRect(px - 2, 202, pw + 4, 40); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px + 8, 210, pw - 16, 24); // stall riser, panelled
    };
    pane(26, 170); pane(316, 170);
    g.fillStyle = 'rgba(15,12,10,0.75)'; g.fillRect(210, 80, 92, 176); g.fillStyle = f; g.fillRect(220, 96, 72, 160); // recessed door
    const dg = g.createLinearGradient(0, 100, 0, 200); dg.addColorStop(0, '#9fb3c4'); dg.addColorStop(1, '#3a4652'); g.fillStyle = dg; g.fillRect(230, 106, 52, 92);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 248, w, 8);
  }, 512, 256));
  // a pub's ground floor: dark paint, small-paned windows, a gold sign band
  T.pub = tex((g, w, h) => {
    grain(g, w, h, '#1f3a2c', 0.06);
    g.fillStyle = '#c9a54a'; g.fillRect(0, 6, w, 18); g.fillStyle = '#1f3a2c'; g.fillRect(0, 12, w, 6);
    g.fillStyle = '#d8cfb8'; g.fillRect(18, 36, 92, 64);
    const gl = g.createLinearGradient(0, 40, 0, 96); gl.addColorStop(0, '#c9b37a'); gl.addColorStop(1, '#5a4626');
    g.fillStyle = gl; g.fillRect(22, 40, 84, 56);
    g.fillStyle = '#d8cfb8'; for (let x = 22; x < 106; x += 14) g.fillRect(x, 40, 2, 56); for (let y = 40; y < 96; y += 14) g.fillRect(22, y, 84, 2);
  });
  return T;
}
let LOOK = null;
export function looks() {
  if (LOOK) return LOOK;
  const t = textures(), mk = (img) => new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: img, repeat: new C.Cartesian2(1, 1) }), flat: false, faceForward: true, closed: false });
  LOOK = { stone: mk(t.stone), cladding: mk(t.cladding), office: mk(t.office), pub: mk(t.pub), portland: mk(t.portland), glassT: mk(t.glassT), gothic: mk(t.gothic) };
  for (const k of Object.keys(HOUSE)) { LOOK[k] = mk(t[k]); LOOK[k + 'G'] = mk(t[k + 'G']); LOOK[k + 'W'] = mk(t[k + 'W']); }
  t.shop.forEach((img, i) => { LOOK['shop' + i] = mk(img); });
  return LOOK;
}

// ---------- what a building is ----------
const SHOPS = /^(shop|restaurant|cafe|fast_food|bank|pharmacy|hairdresser|ice_cream|bureau_de_change|post_office|dentist|doctors|veterinary|estate_agent|travel_agency|bakery|butcher|optician)$/;
export function styleOf(b, r) {
  const k = b.k || '', p = b.kind || '';
  if (b.st) return { walls: b.st }; // (a footprint the world's config names: the Palace of Westminster's Gothic)
  if (FLAVOUR === 'london') return styleLondon(b, r, k, p);
  if (/^(church|chapel|cathedral)$/.test(k) || p === 'place_of_worship') return { walls: 'stone', tower: true };
  if (p === 'pub' || p === 'bar' || k === 'pub') return { walls: r < 0.6 ? 'brickRed' : 'renderCream', ground: 'pub', chimney: true };
  if (SHOPS.test(p) || ((k === 'retail' || k === 'commercial') && (b.area || 0) < 700)) return { walls: r < 0.35 ? 'brickRed' : r < 0.6 ? 'brickOrange' : r < 0.8 ? 'renderCream' : 'renderWhite', ground: 'shop' + Math.floor(r * 6), shopIdx: Math.floor(r * 6), awning: r * 13 % 1 < 0.6 };
  if (/^(industrial|warehouse|manufacture|hangar|barn|shed|garages|garage)$/.test(k) || (b.area || 0) > 900) return { walls: 'cladding' };
  if (/^(school|college|university|hospital|office|commercial|retail|apartments|public|civic|hotel|train_station)$/.test(k) || (b.area || 0) > 450) return { walls: 'office' };
  // houses: mostly red / orange brick (it's Worcestershire), some buff brick and pastel render; a ground floor with a door
  const key = r < 0.3 ? 'brickRed' : r < 0.5 ? 'brickOrange' : r < 0.58 ? 'brickBuff' : r < 0.7 ? 'renderCream' : r < 0.8 ? 'renderWhite' : r < 0.87 ? 'renderSage' : r < 0.94 ? 'renderBlue' : 'renderPeach';
  return { walls: key, ground: key + 'G', groundW: key + 'W', groundH: 2.7, chimney: true, roof: r * 7 % 1 < 0.45 ? 'redtile' : r * 7 % 1 < 0.75 ? 'slate' : 'browntile' };
}

// central London: Georgian / Victorian terraces of stock brick and white stucco, red-brick mansion blocks, Portland stone
// offices and civic buildings, glass towers in the City and on the South Bank (tall buildings by their LIDAR height)
function styleLondon(b, r, k, p) {
  if (/^(church|chapel|cathedral)$/.test(k) || p === 'place_of_worship') return { walls: 'stone', tower: true };
  if (p === 'pub' || p === 'bar' || k === 'pub') return { walls: r < 0.5 ? 'stockBrick' : r < 0.8 ? 'stuccoWhite' : 'redVictorian', ground: 'pub', chimney: true };
  const tall = (b.lh || 0) > 55; // (38 made Edwardian stone blocks like County Hall glass towers)
  if (tall) return { walls: r < 0.75 ? 'glassT' : 'portland' };
  if (SHOPS.test(p) || ((k === 'retail' || k === 'commercial') && (b.area || 0) < 900)) return { walls: r < 0.35 ? 'stockBrick' : r < 0.6 ? 'portland' : r < 0.85 ? 'stuccoWhite' : 'redVictorian', ground: 'shop' + Math.floor(r * 6), awning: r < 0.3 };
  if (/^(industrial|warehouse|manufacture|hangar|shed|garages|garage)$/.test(k)) return { walls: 'cladding' };
  if (/^(office|commercial|public|civic|government|hotel|train_station|museum|bank)$/.test(k) || (b.area || 0) > 1400) return { walls: r < 0.6 ? 'portland' : r < 0.85 ? 'glassT' : 'office' };
  if (/^(school|college|university|hospital|apartments)$/.test(k) || (b.area || 0) > 500) return { walls: r < 0.4 ? 'redVictorian' : r < 0.7 ? 'portland' : 'stockBrick' };
  const key = r < 0.45 ? 'stockBrick' : r < 0.72 ? 'stuccoWhite' : r < 0.88 ? 'redVictorian' : 'brickBuff';
  return { walls: key, ground: key + 'G', groundW: key + 'W', groundH: 3.2, chimney: true, roof: 'slate' };
}

// ---------- walls with texture coordinates ----------
// P: footprint [[x, y]] (local metres), ll(x, y) -> [lat, lon]; base / top heights; returns { look: Geometry } (one or
// two looks: the ground floor band and the floors above)
export function wallGeometry(P, ll, base, top, style, frontOf = null) {
  const out = {};
  let area2 = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) area2 += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]);
  const ccw = area2 < 0; // (outward normals either way round: for a ccw ring (b.y - a.y, a.x - b.x) already points out; it was flipped the wrong way until 2026-11-16, so doors and awnings went on the back)
  const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length, [cla, clo] = ll(cx, cy);
  const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(clo, cla)), E = C.Matrix4.getColumn(enu, 0, new C.Cartesian4()), N = C.Matrix4.getColumn(enu, 1, new C.Cartesian4());
  // the street-facing wall (frontOf scores each wall: facing and near a road), for the door
  let front = -1;
  if (frontOf && (style.groundW || style.awning)) { let bs = -Infinity; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 2.5) continue; let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L; if (!ccw) { nx = -nx; ny = -ny; } const sc = frontOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, nx, ny); if (sc > bs) { bs = sc; front = i; } } }
  const band = (look0, z0, z1, v0, vScale, perWall) => {
    let u = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.3) continue;
      const look = perWall && front >= 0 && i !== front && style.groundW ? style.groundW : look0, g = out[look] ||= { pos: [], nor: [], st: [], idx: [] };
      let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L; if (!ccw) { nx = -nx; ny = -ny; }
      const n = [E.x * nx + N.x * ny, E.y * nx + N.y * ny, E.z * nx + N.z * ny];
      // a whole number of bays per wall, so windows sit centred in their bays and never on a corner (the owner 2026-11-16);
      // walls too short for a window are plain (the left of the texture, before the window)
      const bay = BAYW[look] || BAY, s0 = g.pos.length / 3, nb = Math.round(L / bay);
      const uA = 0, uB = nb >= 1 ? nb : Math.min(0.3, L / bay);
      for (const [q, uu] of [[a, uA], [b, uB]]) for (const z of [z0, z1]) {
        const [la, lo] = ll(q[0], q[1]), c = C.Cartesian3.fromDegrees(lo, la, z);
        g.pos.push(c.x, c.y, c.z); g.nor.push(...n); g.st.push(uu, v0 + (z - z0) / vScale);
      }
      g.idx.push(s0, s0 + 2, s0 + 1, s0 + 1, s0 + 2, s0 + 3);
      u += L;
    }
  };
  const GH = style.groundH || GROUND, g0 = style.ground && top - base > GH + 1.5 ? base + 0.3 + GH : null; // (the ground floor band, from just above the ground)
  if (g0) { band(style.ground, base, g0, -0.3 / GH, GH, true); band(style.walls, g0, top, 0, STOREY); }
  else if (style.walls === 'stone') band('stone', base, top, 0, Math.max(STOREY, top - base)); // (a church: one tall row of arched windows, not one per storey)
  else band(style.walls, base, top, -(0.3 / STOREY), STOREY);
  const geoms = {};
  if (front >= 0) { const a = P[front], b = P[(front + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L; if (!ccw) { nx = -nx; ny = -ny; } Object.defineProperty(geoms, 'front', { value: { a, b, nx, ny, L }, enumerable: false }); }
  for (const [look, g] of Object.entries(out)) {
    if (!g.idx.length) continue;
    geoms[look] = new C.Geometry({ attributes: {
      position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(g.pos) }),
      normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(g.nor) }),
      st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(g.st) }) },
      indices: new Uint32Array(g.idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(g.pos) });
  }
  return geoms;
}

// a church's tower (square, at one end of the long axis, inside the footprint) and its spire: [walls geometry for the
// stone look, spire GeometryInstance-ready geometry + its model matrix]
export function churchTower(P, ll, base, top) {
  // the long axis
  let best = 0, ax = [1, 0];
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ax = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } }
  const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length;
  let lo = Infinity, hi = -Infinity; for (const p of P) { const t = (p[0] - cx) * ax[0] + (p[1] - cy) * ax[1]; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const s = Math.max(3.5, Math.min(6, (hi - lo) * 0.22)), tc = lo + s / 2 + 0.3; // tower side, centre along the axis
  const ox = cx + ax[0] * tc, oy = cy + ax[1] * tc, px = -ax[1], py = ax[0], hs = s / 2;
  const Q = [[ox - ax[0] * hs - px * hs, oy - ax[1] * hs - py * hs], [ox + ax[0] * hs - px * hs, oy + ax[1] * hs - py * hs], [ox + ax[0] * hs + px * hs, oy + ax[1] * hs + py * hs], [ox - ax[0] * hs + px * hs, oy - ax[1] * hs + py * hs]];
  const towerTop = top + Math.max(8, s * 2.2);
  const walls = wallGeometry(Q, ll, base, towerTop, { walls: 'stone' }).stone;
  const [la, lon] = ll(ox, oy), spireH = s * 2.4;
  const spire = { geometry: new C.CylinderGeometry({ length: spireH, topRadius: 0, bottomRadius: hs * 1.25, slices: 4, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }),
    modelMatrix: C.Matrix4.multiplyByTranslation(C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon, la, towerTop)), new C.Cartesian3(0, 0, spireH / 2), new C.Matrix4()),
    capTop: towerTop, Q };
  return { walls, spire };
}

// ---------- pitched roofs (2026-11-16): eaves overhanging the walls, tiles with their rows and shadows, gable ends in
// the wall's colour (they were one flat colour, flush with the walls) ----------
const ROOF = { slate: ['#4a4f57', 36, 0.1], redtile: ['#9a4b34', 40, 0.14], browntile: ['#6e4a3a', 40, 0.12] };
function roofTex([base, rowPx, vary], seed) {
  return tex((g, w, h) => {
    const r = rng(seed), c = hex(base);
    g.fillStyle = shade(c, 0.6); g.fillRect(0, 0, w, h);
    for (let row = 0, y = 0; y < h; row++, y += rowPx) for (let x = row % 2 ? -18 : 0; x < w; x += 36) {
      g.fillStyle = shade(c, 1 - vary + r() * vary * 2); g.fillRect(x + 1, y, 34, rowPx - 3);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 1, y + rowPx - 8, 34, 4); // the lit lower edge of each tile
    }
    for (let y = 0; y < h; y += rowPx) { const sh = g.createLinearGradient(0, y, 0, y + 9); sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(0, y, w, 9); } // each row's shadow on the one below
  }, 512, 512);
}
let ROOFLOOK = null;
function roofLooks() {
  if (ROOFLOOK) return ROOFLOOK;
  ROOFLOOK = {};
  Object.entries(ROOF).forEach(([k, spec], i) => { ROOFLOOK[k] = new C.MaterialAppearance({ material: C.Material.fromType('Image', { image: roofTex(spec, 40 + i), repeat: new C.Cartesian2(1, 1) }), flat: false, faceForward: true, closed: false }); });
  return ROOFLOOK;
}
export const ROOF_KINDS = Object.keys(ROOF);
// roofs: [{ id, P (4 corners), top, roof (kind), wall (#rrggbb) }]; returns Primitives
export function pitchedRoofs(roofs, ll) {
  const byKind = {}, gables = [];
  const p3 = (q, h) => { const [la, lo] = ll(q[0], q[1]); return C.Cartesian3.fromDegrees(lo, la, h); };
  for (const { id, P, top, roof, wall, rise: measured } of roofs) {
    let [A, B, Cc, D] = P;
    const e = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (e(A, B) < e(B, Cc)) [A, B, Cc, D] = [B, Cc, D, A]; // A-B a long side
    const short = e(B, Cc), rise = measured || Math.min(4, 0.32 * short + 0.3), Lr = e(A, B) || 1; // (measured: the LIDAR's ridge over eaves)
    const u = [(B[0] - A[0]) / Lr, (B[1] - A[1]) / Lr];
    const m1 = [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2], m2 = [(B[0] + Cc[0]) / 2, (B[1] + Cc[1]) / 2];
    const out = (S, mid) => { const vx = S[0] - mid[0], vy = S[1] - mid[1], L = Math.hypot(vx, vy) || 1; return [vx / L, vy / L]; };
    const nAB = out([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], [(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2]), nCD = [-nAB[0], -nAB[1]];
    const OV = 0.35, OE = 0.3, drop = rise * (OV / Math.max(1, short / 2)), eave = top - drop;
    const mv = (q, a, b) => [q[0] + a[0] + b[0], q[1] + a[1] + b[1]];
    const sc = (v, k) => [v[0] * k, v[1] * k];
    const A2 = mv(A, sc(u, -OE), sc(nAB, OV)), B2 = mv(B, sc(u, OE), sc(nAB, OV)), C2 = mv(Cc, sc(u, OE), sc(nCD, OV)), D2 = mv(D, sc(u, -OE), sc(nCD, OV));
    const r1 = mv(m1, sc(u, -OE), [0, 0]), r2 = mv(m2, sc(u, OE), [0, 0]);
    const slope = Math.hypot(short / 2 + OV, rise + drop), along = Lr + 2 * OE;
    // two planes, st in 3 m repeats (u along the ridge, v up the slope)
    const pos = [], st = [], idx = [];
    for (const [e1, e2, rA, rB] of [[A2, B2, r1, r2], [C2, D2, r2, r1]]) {
      const b0 = pos.length / 3, sA = e1 === A2 ? 0 : along, sB = e1 === A2 ? along : 0;
      for (const [q, h, s, t] of [[e1, eave, sA, 0], [e2, eave, sB, 0], [rB, top + rise, sB, slope], [rA, top + rise, sA, slope]]) { const c = p3(q, h); pos.push(c.x, c.y, c.z); st.push(s / 3, t / 3); }
      idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
    const geom = new C.Geometry({ attributes: {
      position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(pos) }),
      st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }) },
      indices: new Uint16Array(idx), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(pos) });
    C.GeometryPipeline.computeNormal(geom);
    (byKind[roof] ||= []).push(new C.GeometryInstance({ id, geometry: geom, attributes: { show: new C.ShowGeometryInstanceAttribute(true) } }));
    // the gable ends (walls up to the ridge), in the wall's colour
    const gp = [], gi = [];
    for (const [a, b, m] of [[D, A, m1], [B, Cc, m2]]) { const b0 = gp.length / 3; for (const c of [p3(a, top), p3(b, top), p3(m, top + rise)]) gp.push(c.x, c.y, c.z); gi.push(b0, b0 + 1, b0 + 2); }
    const gg = new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(gp) }) }, indices: new Uint16Array(gi), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(gp) });
    C.GeometryPipeline.computeNormal(gg);
    const wc = hex(wall || '#b07a5a');
    gables.push(new C.GeometryInstance({ id: id + 'e', geometry: gg, attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(wc[0] / 255, wc[1] / 255, wc[2] / 255, 1)), show: new C.ShowGeometryInstanceAttribute(true) } }));
  }
  const looks2 = roofLooks(), prims = [];
  for (const [k, gi] of Object.entries(byKind)) prims.push(new C.Primitive({ geometryInstances: gi, appearance: looks2[k], asynchronous: false, allowPicking: false, compressVertices: false, shadows: (globalThis.__rwShadow ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED) }));
  if (gables.length) prims.push(new C.Primitive({ geometryInstances: gables, appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false, faceForward: true }), asynchronous: false, allowPicking: false, shadows: (globalThis.__rwShadow ? C.ShadowMode.ENABLED : C.ShadowMode.DISABLED) }));
  return prims;
}
export const wallColour = (style) => { const h = HOUSE[style.walls]; return h ? h.brick || h.render : style.walls === 'stone' ? '#b8ad98' : '#b07a5a'; };
export const FASCIA_COLOURS = ['#1f3f6e', '#8a1c2b', '#20503a', '#2a2a2a', '#b5651d', '#5b2a6e'];
