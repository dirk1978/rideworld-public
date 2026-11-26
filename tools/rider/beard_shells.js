// 3D facial hair (2026-11-16, the owner: painted beards looked like "a dirty nose", "oily cheeks"). Adds a `Beard`
// material and primitive to the rider's body mesh: LAYERS copies ("shells") of the skin triangles where facial hair can
// grow, each pushed out along the normals a little further (fur-shell rendering). The browser (model.js beardPng) draws a
// texture per style / colour: an atlas of LAYERS tiles, one per shell, each a scatter of hair-strand dots (alpha MASK);
// fewer dots and a shrunken outline on the outer shells give the hair depth, density and a ragged, rounded edge. No beard
// = a fully transparent texture. Shells copy the source vertices' joints / weights (the head is static after slim_skin).
// Run after build_rider.py + slim_skin.js (+ tuck_chest.js): node tools/rider/beard_shells.js public/models/rider*.glb
// Idempotent (asset.extras.beardShells). The region and atlas layout are shared with model.js (BEARD_BOX, BEARD_LAYERS).
const fs = require('fs');
const LAYERS = 12, STEP = 0.0012, FIRST = 0.0006; // shell k sits FIRST + k * STEP out (metres): 0.6 .. 14 mm
// skin texture px (1024): the face island's lower half. BOX = the atlas tile's area of the skin texture
const BOX = [836, 262, 1024, 778]; // x0, y0, x1, y1
// (model.js beardPng's FULL outline; ears ~865,385 / 865,675, lips 913-935, nostrils x 898)
const JAW = [[878, 630], [878, 644], [900, 647], [925, 648], [942, 652], [962, 640], [978, 610], [988, 570], [990, 526], [988, 482], [978, 442], [962, 412], [942, 400], [925, 404], [900, 405], [878, 408], [878, 422], [895, 442], [912, 467], [926, 494], [916, 503], [906, 526], [916, 549], [926, 558], [912, 585], [895, 610]]; // (= model.js BEARD_FULL, measured on the model with a grid)
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const grow = (P, m) => { const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length; return P.map(([x, y]) => { const L = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / L) * m, y + ((y - cy) / L) * m]; }); };
const REGION = grow(JAW, 8);
const inRegion = (x, y) => inPoly(x, y, REGION);

for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString());
  if (j.asset?.extras?.beardShells) { console.log(f, 'already done'); continue; }
  let bin = Buffer.from(b.slice(20 + jl + 8, 20 + jl + 8 + b.readUInt32LE(20 + jl)));
  const CS = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const acc = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], off = (v.byteOffset || 0) + (a.byteOffset || 0), n = NC[a.type], cs = CS[a.componentType], st = v.byteStride || n * cs;
    const rd = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o), 5121: (o) => bin.readUInt8(o) }[a.componentType];
    return { a, n, get: (k, c = 0) => rd(off + k * st + c * cs) };
  };
  const mesh = j.meshes.find((m) => m.primitives.some((p) => j.materials[p.material]?.name === 'Skin'));
  const S = mesh.primitives.find((p) => j.materials[p.material]?.name === 'Skin');
  const P = acc(S.attributes.POSITION), N = acc(S.attributes.NORMAL), T = acc(S.attributes.TEXCOORD_0), JO = acc(S.attributes.JOINTS_0), WE = acc(S.attributes.WEIGHTS_0), I = acc(S.indices);
  // triangles in the region (by their centre on the texture)
  const tri = [];
  for (let t = 0; t < I.a.count; t += 3) {
    const v = [I.get(t), I.get(t + 1), I.get(t + 2)];
    const x = (v.reduce((s, k) => s + T.get(k, 0), 0) / 3) * 1024, y = (v.reduce((s, k) => s + T.get(k, 1), 0) / 3) * 1024;
    if (x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3] && inRegion(x, y)) tri.push(v);
  }
  const used = [...new Set(tri.flat())], at = new Map(used.map((k, i) => [k, i])), nv = used.length;
  // smooth normals over coincident vertices (the face has UV seams: split normals would tear the shells apart)
  const pk = (k) => [0, 1, 2].map((c) => Math.round(P.get(k, c) * 1e4)).join(',');
  const nsum = new Map(); for (const k of used) { const key = pk(k), s = nsum.get(key) || [0, 0, 0]; for (let c = 0; c < 3; c++) s[c] += N.get(k, c); nsum.set(key, s); }
  const pos = [], nor = [], uv = [], jo = [], we = [], idx = [];
  for (let L = 0; L < LAYERS; L++) {
    for (const k of used) {
      const tx = T.get(k, 0) * 1024, d = (FIRST + L * STEP) * (1 + 0.7 * Math.min(1, Math.max(0, (tx - 955) / 25)) * Math.max(0, 1 - Math.max(0, tx - 980) / 12)); // (the chin's hair stands out further: the full chin of a modern beard)
      const s = nsum.get(pk(k)), ln = Math.hypot(...s) || 1, n = s.map((x) => x / ln);
      for (let c = 0; c < 3; c++) pos.push(P.get(k, c) + n[c] * d);
      nor.push(...n);
      // atlas: tile L of LAYERS across; inside a tile the BOX of the skin texture
      const u = (T.get(k, 0) * 1024 - BOX[0]) / (BOX[2] - BOX[0]), v = (T.get(k, 1) * 1024 - BOX[1]) / (BOX[3] - BOX[1]);
      uv.push((L + Math.min(1, Math.max(0, u))) / LAYERS, Math.min(1, Math.max(0, v)));
      for (let c = 0; c < 4; c++) { jo.push(JO.get(k, c)); we.push(WE.get(k, c)); }
    }
    for (const t of tri) idx.push(...t.map((k) => L * nv + at.get(k)));
  }
  // append the buffers
  const views = [];
  const put = (arr, write, cs, target) => { const buf = Buffer.alloc(Math.ceil((arr.length * cs) / 4) * 4); arr.forEach((x, i) => write(buf, x, i * cs)); j.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: arr.length * cs, ...(target ? { target } : {}) }); bin = Buffer.concat([bin, buf]); return j.bufferViews.length - 1; };
  const f32 = (buf, x, o) => buf.writeFloatLE(x, o);
  const jcs = CS[JO.a.componentType], jw = { 1: (buf, x, o) => buf.writeUInt8(x, o), 2: (buf, x, o) => buf.writeUInt16LE(x, o), 4: (buf, x, o) => buf.writeUInt32LE(x, o) }[jcs];
  const accOf = (view, ct, count, type, extra = {}) => { j.accessors.push({ bufferView: view, componentType: ct, count, type, ...extra }); return j.accessors.length - 1; };
  const mn = [0, 1, 2].map((c) => Math.min(...pos.filter((_, i) => i % 3 === c))), mx = [0, 1, 2].map((c) => Math.max(...pos.filter((_, i) => i % 3 === c)));
  const aP = accOf(put(pos, f32, 4, 34962), 5126, pos.length / 3, 'VEC3', { min: mn, max: mx });
  const aN = accOf(put(nor, f32, 4, 34962), 5126, nor.length / 3, 'VEC3');
  const aT = accOf(put(uv, f32, 4, 34962), 5126, uv.length / 2, 'VEC2');
  const aJ = accOf(put(jo, jw, jcs, 34962), JO.a.componentType, jo.length / 4, 'VEC4');
  const aW = accOf(put(we, f32, 4, 34962), 5126, we.length / 4, 'VEC4');
  const big = pos.length / 3 > 65535;
  const aI = accOf(put(idx, big ? (buf, x, o) => buf.writeUInt32LE(x, o) : (buf, x, o) => buf.writeUInt16LE(x, o), big ? 4 : 2, 34963), big ? 5125 : 5123, idx.length, 'SCALAR');
  j.materials.push({ name: 'Beard', doubleSided: true, alphaMode: 'MASK', alphaCutoff: 0.5, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } });
  mesh.primitives.push({ attributes: { POSITION: aP, NORMAL: aN, TEXCOORD_0: aT, JOINTS_0: aJ, WEIGHTS_0: aW }, indices: aI, material: j.materials.length - 1 });
  j.buffers[0].byteLength = bin.length;
  (j.asset.extras ||= {}).beardShells = { layers: LAYERS, box: BOX };
  let json = Buffer.from(JSON.stringify(j)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + json.length); out.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(out, 28 + json.length);
  fs.writeFileSync(f, out);
  console.log(f, tri.length, 'triangles x', LAYERS, 'shells,', nv, 'vertices a shell');
}
