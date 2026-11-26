// The rider model: loading and recolouring rider.glb, placing a rider on the road (lanes) and orienting it.
import { drawJersey, parseDesign } from '../kit.js';
import { WHEEL_R, buildRiderGltf } from '../rider.js';
import { toRad } from '../route.js';
import { CAMS } from './camera.js';
import { $, C, bike, fields, route, state } from './core.js';
import { viewer } from './scenery.js';
import { groundHeight } from './survey.js';
// Swap the kit colours into the glTF material list of a .glb before Cesium loads it, and any textures (PNG bytes by
// material name: the jersey's design) into its BIN chunk
export function recolourGlb(buf, colours, textures = {}) {
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((c) => (c / 255) ** 2.2).concat(1); };
  for (const m of gltf.materials || []) {
    if (colours[m.name]) (m.pbrMetallicRoughness ??= {}).baseColorFactor = lin(colours[m.name]);
  }
  const binLen = dv.getUint32(20 + jsonLen, true);
  let bin = new Uint8Array(buf, 20 + jsonLen + 8, binLen), extra = [];
  for (const [name, png] of Object.entries(textures)) {
    const m = (gltf.materials || []).find((x) => x.name === name);
    if (!m || !png) continue;
    const off = binLen + extra.reduce((s, a) => s + a.length, 0);
    const padded = new Uint8Array(Math.ceil(png.length / 4) * 4); padded.set(png);
    extra.push(padded);
    gltf.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: png.length });
    (gltf.images ||= []).push({ bufferView: gltf.bufferViews.length - 1, mimeType: 'image/png' });
    (gltf.samplers ||= []).push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 });
    (gltf.textures ||= []).push({ source: gltf.images.length - 1, sampler: gltf.samplers.length - 1 });
    Object.assign(m.pbrMetallicRoughness ??= {}, { baseColorTexture: { index: gltf.textures.length - 1 }, baseColorFactor: [1, 1, 1, 1] });
  }
  if (extra.length) {
    const all = new Uint8Array(binLen + extra.reduce((s, a) => s + a.length, 0));
    all.set(bin); let o = binLen; for (const a of extra) { all.set(a, o); o += a.length; }
    bin = all; gltf.buffers[0].byteLength = all.length;
  }
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const pad = (4 - (json.length % 4)) % 4;
  const jsonChunk = new Uint8Array(json.length + pad).fill(0x20);
  jsonChunk.set(json);
  const rest = new Uint8Array(8 + bin.length); // the BIN chunk (header + data, textures appended)
  new DataView(rest.buffer).setUint32(0, bin.length, true); new DataView(rest.buffer).setUint32(4, 0x004e4942, true); rest.set(bin, 8);
  const out = new Uint8Array(12 + 8 + jsonChunk.length + rest.length);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, jsonChunk.length, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  out.set(rest, 20 + jsonChunk.length);
  return out;
}

// The jersey's texture for a design (cached: riders in the same kit share it). Uploaded pictures come from /api/kit/.
const jerseyPngs = new Map();
export function jerseyPng(design, fallback) {
  const key = design + '|' + fallback;
  if (!jerseyPngs.has(key)) jerseyPngs.set(key, (async () => {
    const p = parseDesign(design, fallback);
    let img = null;
    if (p.img) img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = 'api/kit/' + p.img; });
    const cv = drawJersey(document.createElement('canvas'), p, img);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  })().catch((e) => { console.warn('jersey design', design, e); return null; }));
  return jerseyPngs.get(key);
}

// Skin tone and facial hair (2026-11-16, the owner's request): the rider's skin texture (MakeHuman's, in the GLB: the
// face is the island on the right, turned on its side, forehead to the left, chin to the right) is redrawn per rider:
// multiplied by the tone, then hair painted on the lower face as thousands of short strokes (stubble finer and fainter,
// a beard denser and longer). Coordinates on the 1024 px texture.
const TONES = { light: null, fair: '#f2ddd0', tan: '#ecd2b6', olive: '#c49a6c', brown: '#9a6a48', dark: '#6e4834', deep: '#4c3024' };
const skinPngs = new Map();
function skinImage(glb) {
  const dv = new DataView(glb), jl = dv.getUint32(12, true), j = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jl)));
  const m = j.materials.find((x) => x.name === 'Skin'), t = j.textures[m.pbrMetallicRoughness.baseColorTexture.index], im = j.images[t.source], bv = j.bufferViews[im.bufferView];
  return createImageBitmap(new Blob([new Uint8Array(glb, 20 + jl + 8 + (bv.byteOffset || 0), bv.byteLength)], { type: im.mimeType }));
}
// hair areas on the face (texture px): the lower face below the cheekbones round the mouth to the chin and jaw
const FACE = { mouth: [925, 531], nose: [893, 533], jaw: [[895, 315], [975, 300], [1012, 420], [1015, 525], [1012, 630], [975, 745], [895, 735], [905, 600], [902, 450]] };
export function skinPng(glb, skin, beard) {
  const key = (skin || 'light') + '|' + (beard || '');
  if (!TONES[skin] && !beard) return Promise.resolve(null);
  if (!skinPngs.has(key)) skinPngs.set(key, (async () => {
    const img = await skinImage(glb), cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'), sx = img.width / 1024;
    g.drawImage(img, 0, 0);
    if (TONES[skin]) { g.globalCompositeOperation = 'multiply'; g.fillStyle = TONES[skin]; g.fillRect(0, 0, cv.width, cv.height); g.globalCompositeOperation = 'source-over'; }
    if (beard) { // (the hair itself is 3D now: beardPng; just a faint shadow on the skin where it grows, lips left clear)
      const mask = document.createElement('canvas'); mask.width = cv.width; mask.height = cv.height;
      const m = mask.getContext('2d'); m.filter = `blur(${8 * sx}px)`; m.fillStyle = 'rgb(70,48,34)';
      const P = beard === 'moustache' ? BEARD_TACHE : beard === 'goatee' ? null : BEARD_FULL;
      m.beginPath(); for (const Q of P ? [P] : [BEARD_TACHE, BEARD_CHIN]) { Q.forEach(([x, y], k) => (k ? m.lineTo(x * sx, y * sx) : m.moveTo(x * sx, y * sx))); m.closePath(); }
      m.fill(); m.globalCompositeOperation = 'destination-out'; m.filter = 'none'; m.beginPath(); m.ellipse(LIPS[0] * sx, LIPS[1] * sx, LIPS[2] * sx, LIPS[3] * sx, 0, 0, Math.PI * 2); m.fill();
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = beard === 'stubble' ? 0.35 : 0.45; g.drawImage(mask, 0, 0); g.restore();
    }
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  })().catch((e) => { console.warn('skin', key, e); return null; }));
  return skinPngs.get(key);
}

// 3D facial hair (2026-11-16 v3: painted hair looked like dirt, the owner). The GLB carries shells round the lower face
// (tools/rider/beard_shells.js: BEARD_LAYERS copies of the skin pushed out 0.8 .. 14 mm); this draws their texture, an
// atlas of one tile per shell covering BEARD_BOX of the skin texture. Each shell gets hair-strand dots (alpha cut-out)
// inside the style's outline; outer shells have fewer dots and a smaller outline, so the hair has depth and a rounded,
// ragged edge, and inner ones are darker (shadowed). No beard: transparent.
// Outlines on the skin texture, MEASURED (2026-11-16) by painting a labelled grid on the model's face and rendering it
// from the front and side (earlier guesses from the flat texture put the beard over the ears and above the nostrils):
// face centre line y 526; nostrils x 900; upper lip x 922-925, mouth line 935, lower lip to 945; mouth corners y 500 /
// 552; chin ~975, under the chin to ~990; ears y 650-700 (and 352-402), earlobes ~x 905; jaw angle ~x 942, y 652 / 400.
// The "chad" full beard (the owner): sideburns in front of the ears, a high clean cheek line down to the moustache corners,
// along the jaw and under it.
export const BEARD_FULL = [[878, 630], [878, 644], [900, 647], [925, 648], [942, 652], [962, 640], [978, 610], [988, 570], [990, 526], [988, 482], [978, 442], [962, 412], [942, 400], [925, 404], [900, 405], [878, 408], [878, 422], [895, 442], [912, 467], [926, 494], [916, 503], [910, 526], [916, 549], [926, 558], [912, 585], [895, 610]];
// the moustache: from just below the nostrils over the top of the upper lip, ending at the mouth corners
export const BEARD_TACHE = [[906, 526], [908, 510], [913, 501], [925, 497], [937, 498], [930, 504], [926, 515], [925, 526], [926, 537], [930, 548], [937, 554], [925, 555], [913, 551], [908, 542]];
const BEARD_CHIN = [[930, 497], [945, 494], [965, 498], [982, 508], [988, 526], [982, 544], [965, 554], [945, 558], [930, 555]];
const LIPS = [934, 526, 12, 25]; // (x, y, half height, half width on the texture)
const BEARD_LAYERS = 12, BEARD_BOX = [836, 262, 1024, 778];
const HAIR = { brown: '#4a3324', dark: '#2b1e16', black: '#141110', ginger: '#9a4a22', blond: '#b08a55', grey: '#8d8a86', white: '#d8d5cf' };
const beardPngs = new Map();
export function beardPng(beard, col) {
  const key = (beard || '') + '|' + (col || '');
  if (!beardPngs.has(key)) beardPngs.set(key, (async () => {
    const TW = 282, TH = 774, s = TW / (BEARD_BOX[2] - BEARD_BOX[0]), cv = document.createElement('canvas'); cv.width = TW * BEARD_LAYERS; cv.height = TH;
    const g = cv.getContext('2d');
    const ST = { stubble: { L: 2, dens: 0.45, len: 1.5, wid: 1.2, edge: 8 }, short: { L: 5, dens: 1.3, len: 4, wid: 1.6, edge: 7 }, full: { L: 12, dens: 1.3, len: 6, wid: 1.6, edge: 7 },
      moustache: { L: 6, dens: 1, len: 4, wid: 2, edge: 3 }, goatee: { L: 7, dens: 1, len: 4, wid: 2, edge: 4 } }[beard];
    if (ST) {
      // the style's outline, soft (its alpha = how far inside), in tile pixels
      const [mx, my] = FACE.mouth, X = (x) => (x - BEARD_BOX[0]) * s, Y = (y) => (y - BEARD_BOX[1]) * s;
      const mask = document.createElement('canvas'); mask.width = TW; mask.height = TH; const m = mask.getContext('2d');
      m.filter = `blur(${ST.edge * s}px)`; m.fillStyle = '#fff'; m.beginPath();
      // outlines on the skin texture (checked against an overlay of the face: ears ~865,385 / 865,675, nostrils x 898,
      // lips 913-935): a full beard runs from the sideburns in front of the ears down the jaw, with a cheek line sloping
      // to the corners of the moustache; the moustache hangs over the top of the upper lip
      const poly = (P) => { P.forEach(([x, y], k) => (k ? m.lineTo(X(x), Y(y)) : m.moveTo(X(x), Y(y)))); m.closePath(); };
      const FULL = BEARD_FULL, TACHE = BEARD_TACHE;
      m.filter = `blur(${ST.edge * s}px)`; m.fillStyle = '#fff'; m.beginPath();
      if (beard === 'moustache') poly(TACHE);
      else if (beard === 'goatee') { poly(TACHE); poly(BEARD_CHIN); }
      else { poly(FULL); poly(TACHE); }
      m.fill();
      m.globalCompositeOperation = 'destination-out'; m.filter = `blur(${2 * s}px)`;
      m.filter = `blur(${5 * s}px)`; m.beginPath(); m.ellipse(X(LIPS[0]), Y(LIPS[1]), (LIPS[2] + 4) * s, (LIPS[3] + 5) * s, 0, 0, Math.PI * 2); m.fill(); m.filter = 'none'; m.beginPath(); m.ellipse(X(LIPS[0]), Y(LIPS[1]), LIPS[2] * s, LIPS[3] * s, 0, 0, Math.PI * 2); m.fill(); // (the lips: clear, the hair thinning towards them)
      
      const md = m.getImageData(0, 0, TW, TH).data, inside = (x, y) => md[((y | 0) * TW + (x | 0)) * 4 + 3] / 255;
      const base = HAIR[col] || HAIR.brown, rgb = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
      let sd = 99; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      g.lineCap = 'round';
      for (let L = 0; L < ST.L; L++) {
        const f = ST.L > 1 ? L / (ST.L - 1) : 0, th = 0.18 + 0.72 * f ** 1.2, dens = ST.dens * (1 - 0.55 * f), shade = 0.5 + 0.5 * (ST.L > 1 ? (L + 1) / ST.L : 1);
        g.save(); g.translate(L * TW, 0); g.beginPath(); g.rect(0, 0, TW, TH); g.clip();
        if (L === 0 && beard !== 'stubble') { // a dense dark underlayer: no skin between the strands
          const u = document.createElement('canvas'); u.width = TW; u.height = TH; const ug = u.getContext('2d'); ug.drawImage(mask, 0, 0);
          ug.globalCompositeOperation = 'source-in'; ug.fillStyle = `rgb(${rgb.map((c) => (c * 0.45) | 0)})`; ug.fillRect(0, 0, TW, TH);
          const ud = ug.getImageData(0, 0, TW, TH); for (let i = 3; i < ud.data.length; i += 4) ud.data[i] = ud.data[i] > 90 ? 255 : 0; ug.putImageData(ud, 0, 0); g.drawImage(u, 0, 0);
        }
        const n = Math.round(TW * TH * 0.55 * dens);
        for (let i = 0; i < n; i++) {
          const x = R() * TW, y = R() * TH, w = inside(x, y);
          if (w < th + (R() - 0.5) * 0.12) continue;
          // the "chad" shape (the owner 2026-11-16: "pretty much the standard"): faded at the sideburns, close on the cheeks,
          // full at the chin and along the jaw, short right round the mouth (long hair there hid the lips)
          const tx = x / s + BEARD_BOX[0], ty = y / s + BEARD_BOX[1], dm = Math.hypot((tx - LIPS[0]) / 26, (ty - LIPS[1]) / 40);
          if (beard !== 'stubble') {
            let fmax = beard === 'moustache' ? 1 : Math.min(1, Math.max(0.25, (tx - 900) / 70));
            if (dm < 2.3) fmax = Math.min(fmax, beard === 'moustache' ? 0.7 : 0.25 + 0.55 * Math.max(0, dm - 1.1));
            if (f > fmax) continue;
          }
          if (tx < 900 && R() > Math.max(0.2, (tx - 876) / 24)) continue; // (the sideburns fade out at the top)
          const k = shade * (R() < 0.05 ? 1.25 + R() * 0.2 : 0.75 + R() * 0.4), a = (R() - 0.5) * 0.8, len = ST.len * s * (0.6 + R() * 0.8);
          g.strokeStyle = `rgb(${rgb.map((c) => Math.min(255, c * k) | 0)})`; g.lineWidth = ST.wid * s * (0.7 + R() * 0.5);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); // (grows down the face: +x in the texture)
        }
        // strands that started beside the mouth must not reach over it (they hid the lips)
        if (beard !== 'stubble') { g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.ellipse(X(LIPS[0]), Y(LIPS[1]), LIPS[2] * s, LIPS[3] * s, 0, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over'; }
        g.restore();
      }
    }
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  })().catch((e) => { console.warn('beard', key, e); return null; }));
  return beardPngs.get(key);
}

export const KIT_KEYS = ['jersey', 'shorts', 'frame', 'helmet', 'design', 'socks', 'shoes', 'bikestyle', 'skin', 'beard', 'beardcol'];
// Bike styles (2026-11-03): one rider GLB each (tools/rider/build_rider.py RW_BIKE=..), and its wheel size for the
// wheels' spin. Looks only: every style rides the same.
export const BIKES = {
  road: { name: 'Modern road', file: 'models/rider.glb', r: 0.335 },
  classic: { name: 'Classic steel (80s)', file: 'models/rider-classic.glb', r: 0.334 },
  compact: { name: 'Aluminium compact (90s)', file: 'models/rider-compact.glb', r: 0.334 },
  mtb: { name: 'Mountain bike', file: 'models/rider-mtb.glb', r: 0.372 },
  gravel: { name: 'Gravel (Giant Revolt)', file: 'models/rider-gravel.glb', r: 0.349 },
};
// One copy of the rider GLB, recoloured per rider (our own kit, and each other rider's)
const riderGlbs = new Map(); // style -> the GLB's bytes (a promise)
export async function createRiderModel(kit, crankFn, distFn) {
  let gltf;
  const bk = BIKES[kit.bikestyle] || BIKES.road;
  try {
    // High-quality rider built in Blender (tools/rider/build_rider.py); the code-built one is the fallback
    if (!riderGlbs.has(bk.file)) riderGlbs.set(bk.file, fetch(bk.file).then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.arrayBuffer(); }));
    const riderGlb = await riderGlbs.get(bk.file).catch((e) => { riderGlbs.delete(bk.file); throw e; });
    const png = await jerseyPng(kit.design || 'plain', kit.jersey || '#ff6a1a'), skin = await skinPng(riderGlb, kit.skin, kit.beard), beardTex = await beardPng(kit.beard, kit.beardcol);
    gltf = recolourGlb(riderGlb, { Jersey: kit.jersey, Shorts: kit.shorts, Accent: kit.shorts, Frame: kit.frame, Helmet: kit.helmet, Socks: kit.socks, Shoes: kit.shoes }, { Jersey: png, ...(skin ? { Skin: skin } : {}), Beard: beardTex });
  } catch (e) {
    console.warn('rider.glb unavailable, using the simple rider', e);
    gltf = buildRiderGltf(kit);
  }
  // Cesium caches glTF by its URL, and bytes have none: without a distinct basePath every rider would reuse the
  // first model loaded (all in our kit)
  const basePath = bk.file + '?kit=' + encodeURIComponent(KIT_KEYS.map((k) => kit[k] || '').join(','));
  const model = await C.Model.fromGltfAsync({ gltf, basePath, forwardAxis: C.Axis.X, upAxis: gltf instanceof Uint8Array ? C.Axis.Y : C.Axis.Z });
  // Sky reflections wash the kit colours out to grey; keep the sky's diffuse light, most of its specular off
  model.imageBasedLighting.imageBasedLightingFactor = new C.Cartesian2(1, 0.15);
  viewer.scene.primitives.add(model);
  model.readyEvent.addEventListener(() => {
    const anims = model.activeAnimations;
    anims.animateWhilePaused = true; // we drive time ourselves, from cadence and distance
    model.rwAnim = { anims, crankFn, loop: C.ModelAnimationLoop.REPEAT, standing: false, noStand: !(gltf instanceof Uint8Array),
      cur: anims.add({ name: 'pedal', loop: C.ModelAnimationLoop.REPEAT, animationTime: crankFn }) }; // (stance.js swaps it for 'stand')
    anims.add({ name: 'wheels', loop: C.ModelAnimationLoop.REPEAT, animationTime: () => distFn() / (2 * Math.PI * (gltf instanceof Uint8Array ? bk.r : WHEEL_R)) });
  });
  return model;
}

export async function loadRiderModel() {
  const kit = Object.fromEntries(KIT_KEYS.map((k) => [k, $(fields[k]).value]));
  try {
    state.model = await createRiderModel(kit, () => state.crank, () => state.dist);
  } catch (e) {
    console.warn('rider model failed to load; showing a dot instead', e);
    state.model = null;
  }
}

// Point on the road d metres along, shifted `side` metres to the right (lanes)
// Keep to the side of the road the country drives on (the owner 2026-11-17: "on UK maps ... the left side of the road, and
// on the right in other countries"; groups still spread around it): every rider's lateral position is offset ~1 m from
// the middle, less on narrow roads (open worlds: the road's width where it is, openworld.js keepWidth), none on paths.
const LEFT_HAND = /^(GB|IE|IM|JE|GG|MT|CY|AU|NZ|JP|IN|PK|BD|LK|NP|TH|MY|SG|ID|HK|MO|ZA|KE|UG|TZ|ZM|ZW|BW|NA|MZ|MW|SZ|LS|MU|JM|TT|BB|BS|GY|SR|FJ|PG|BN|BT)$/;
export function keepOffset(d) {
  const c = route?.opts?.country; if (!c) return 0;
  const w = state.keepWidth ? state.keepWidth(d) : 1.0;
  return (LEFT_HAND.test(String(c).toUpperCase()) ? -1 : 1) * w;
}
export function roadPoint(d, side, lift = 0.05) {
  const p = route.at(d);
  side = (side || 0) + keepOffset(d);
  if (side) {
    const h = route.tangent(d), kx = 111320 * Math.cos(toRad(p.lat)); // the road's own direction here, not the look-ahead
    return C.Cartesian3.fromDegrees(p.lon + (Math.cos(h) * side) / kx, p.lat + (-Math.sin(h) * side) / 110540, groundHeight(d) + lift);
  }
  return C.Cartesian3.fromDegrees(p.lon, p.lat, groundHeight(d) + lift);
}

// The slope (%) of the road surface the wheels are on: the rendered 3D height a couple of metres either side. The
// bike is pitched by this, not by roadGrade() (the trainer's gradient, smoothed over hundreds of metres and kept
// within 3% of the trend), which left the front wheel in the air or in the road on steep ramps (the owner 2026-10-18,
// Alpe d'Huez at 15%).
// Kept inside the route and never NaN: a NaN pitch puts NaN into the model matrix and stops Cesium rendering.
export function surfaceGrade(d) {
  const a = Math.max(0, Math.min(route.length - 4, d - 2));
  const g = (groundHeight(a + 4) - groundHeight(a)) * 25;
  return Number.isFinite(g) ? Math.max(-40, Math.min(40, g)) : 0;
}

// Orient a rider model: facing heading h, pitched with the gradient, leaning by `lean` radians
export const scratch = { enu: new C.Matrix4() };
export function orientModel(model, pos, h, grade, lean) {
  const p = Math.atan(grade / 100);
  const fwd = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  let left = [-Math.cos(h), Math.sin(h), 0];
  let up = [fwd[1] * left[2] - fwd[2] * left[1], fwd[2] * left[0] - fwd[0] * left[2], fwd[0] * left[1] - fwd[1] * left[0]];
  const cr = Math.cos(lean), sr = Math.sin(lean);
  [left, up] = [left.map((v, i) => v * cr + up[i] * sr), up.map((v, i) => v * cr - left[i] * sr)];
  const enu = C.Transforms.eastNorthUpToFixedFrame(pos, undefined, scratch.enu);
  const toEcef = (v) => C.Matrix4.multiplyByPointAsVector(enu, new C.Cartesian3(...v), new C.Cartesian3());
  const X = toEcef(fwd), Y = toEcef(left), Z = toEcef(up);
  model.modelMatrix = C.Matrix4.fromArray([X.x, X.y, X.z, 0, Y.x, Y.y, Y.z, 0, Z.x, Z.y, Z.z, 0, pos.x, pos.y, pos.z, 1], 0, new C.Matrix4());
}

// Corner lean for any rider at distance d doing v m/s; `r` keeps the eased angle (r.lean, radians, + = right).
// From the road's own curve just ahead (0.3 s), not the smoothed camera heading, which lags: the rider straightens
// up as the bend ends instead of ~0.7 s later. Lean angle = atan(v^2 * curvature / g).
// Faded out at low speed (the owner: amazing at speed, too much when slow): none below ~9 km/h, full from ~32 km/h.
// Capped at 0.7 rad (~40 deg, about what real riders reach); 0.4 (~23 deg) looked too upright on tight fast corners
// (the owner 2026-10-18). Used for us and for other riders, pacers and ghosts.
export function cornerLean(r, d, v, dt) {
  const curvature = route.curvature(d + v * 0.3); // radians per metre, positive = turning right
  const fade = Math.max(0, Math.min(1, (v - 2.5) / 6.5));
  const target = fade * Math.max(-0.7, Math.min(0.7, Math.atan((v * v * curvature) / 9.81)));
  r.lean = Number.isFinite(r.lean) ? r.lean + (target - r.lean) * Math.min(1, dt * 7) : target;
  return r.lean;
}

// Place our rider on the road: facing along the route, pitched with the gradient, leaning into corners. (The effort
// rock, side to side when pushing hard, was dropped 2026-10-26: the owner never used it.)
export function placeRider(dt, pos, grade) {
  if (!state.model) return;
  cornerLean(state, state.dist, bike.v, dt);
  const sg = surfaceGrade(state.dist);
  state.visGrade = !Number.isFinite(state.visGrade) || dt === 0 ? sg : state.visGrade + (sg - state.visGrade) * Math.min(1, dt * 8);
  // The bike faces along the road at its own wheels (route.tangent, +-4 m). state.heading is the camera's look-ahead
  // (8-32 m ahead): facing that, the bike pointed into the corner ahead of itself and looked like it was sliding its
  // back wheel out (the owner 2026-10-18).
  orientModel(state.model, pos, route.tangent(state.dist) + (state.wanderYaw || 0), state.visGrade, state.lean);
  state.model.show = CAMS[state.cam].name !== 'Rider';
}
