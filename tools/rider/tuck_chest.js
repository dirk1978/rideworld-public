// Covers the chest (the owner 2026-11-16: "what's with the exposed nipples?"). The MakeHuman jersey has a small hole at each
// nipple (16 open edges round each), and the body's nipples sit on the jersey's surface (0.2 mm apart), so they showed.
// 1. fills those holes in the Jersey primitive: open-edge loops within 4 cm of a nipple, fan-triangulated (new index
//    accessor appended to the BIN chunk);
// 2. pushes the body in by 4 mm under the jersey within 3 cm of each nipple only (pulling skin in near the jersey's
//    neck and sleeve edges opened gaps there).
// Nipples are found from the skin texture (1024 px: 330,308 and 447,308). Run after build_rider.py + slim_skin.js:
//   node tools/rider/tuck_chest.js public/models/rider*.glb
// Marks the file (asset.extras.chestTucked) so a second run does nothing.
const fs = require('fs');
const DEPTH = 0.004, NEAR = 0.03, HOLE = 0.04, UVS = [[330 / 1024, 308 / 1024], [447 / 1024, 308 / 1024]];
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString());
  if (j.asset?.extras?.chestTucked) { console.log(f, 'already done'); continue; }
  let bin = Buffer.from(b.slice(20 + jl + 8, 20 + jl + 8 + b.readUInt32LE(20 + jl)));
  const acc = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], off = (v.byteOffset || 0) + (a.byteOffset || 0);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], cs = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType], st = v.byteStride || n * cs;
    const rd = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o), 5121: (o) => bin.readUInt8(o) }[a.componentType];
    return { a, get: (k, c = 0) => rd(off + k * st + c * cs), set: (k, c, x) => bin.writeFloatLE(x, off + k * st + c * cs) };
  };
  const mat = (n) => j.materials.findIndex((m) => m.name === n);
  const prim = (n) => j.meshes.flatMap((m) => m.primitives).find((p) => p.material === mat(n));
  const S = prim('Skin'), J = prim('Jersey');
  const SP = acc(S.attributes.POSITION), ST = acc(S.attributes.TEXCOORD_0);
  const JP = acc(J.attributes.POSITION), JN = acc(J.attributes.NORMAL), JI = acc(J.indices);
  const v3 = (A, k) => [A.get(k, 0), A.get(k, 1), A.get(k, 2)], dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  // the nipples in 3D
  const nip = UVS.map(([u0, v0]) => { let bd = Infinity, bk = 0; for (let k = 0; k < SP.a.count; k++) { const d = Math.hypot(ST.get(k, 0) - u0, ST.get(k, 1) - v0); if (d < bd) { bd = d; bk = k; } } return v3(SP, bk); });
  // 1. the jersey's holes there
  const jp = [...Array(JP.a.count)].map((_, k) => v3(JP, k)), jn = [...Array(JP.a.count)].map((_, k) => v3(JN, k));
  const key = (p) => p.map((x) => Math.round(x * 1e4)).join(','), ids = new Map(), wid = jp.map((p) => { const k = key(p); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); });
  const rep = []; wid.forEach((w, k) => { if (rep[w] == null) rep[w] = k; });
  const tris = []; for (let t = 0; t < JI.a.count; t++) tris.push(JI.get(t));
  const ec = new Map(); for (let t = 0; t < tris.length; t += 3) { const v = [tris[t], tris[t + 1], tris[t + 2]].map((x) => wid[x]); for (const [a, c] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) { const k = Math.min(a, c) + '_' + Math.max(a, c); ec.set(k, (ec.get(k) || 0) + 1); } }
  const adj = new Map(); for (const [k, n] of ec) { if (n !== 1) continue; const [a, c] = k.split('_').map(Number); if (!nip.some((q) => dist(jp[rep[a]], q) < HOLE && dist(jp[rep[c]], q) < HOLE)) continue; for (const [x, y] of [[a, c], [c, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } }
  const seen = new Set(), added = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [start]; seen.add(start); let prev = null, cur = start;
    for (;;) { const nx = (adj.get(cur) || []).find((x) => x !== prev && !seen.has(x)); if (nx == null) break; loop.push(nx); seen.add(nx); prev = cur; cur = nx; }
    if (loop.length < 3 || !(adj.get(cur) || []).includes(start)) continue; // (closed loops only)
    for (let k = 1; k < loop.length - 1; k++) added.push(rep[loop[0]], rep[loop[k]], rep[loop[k + 1]]);
  }
  if (added.length) {
    const all = tris.concat(added), big = all.some((x) => x > 65535), cs = big ? 4 : 2;
    const buf = Buffer.alloc(Math.ceil((all.length * cs) / 4) * 4); all.forEach((x, k) => (big ? buf.writeUInt32LE(x, k * 4) : buf.writeUInt16LE(x, k * 2)));
    j.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: all.length * cs, target: 34963 });
    j.accessors.push({ bufferView: j.bufferViews.length - 1, componentType: big ? 5125 : 5123, count: all.length, type: 'SCALAR' });
    J.indices = j.accessors.length - 1;
    bin = Buffer.concat([bin, buf]); j.buffers[0].byteLength = bin.length;
  }
  // 2. the nipples themselves, under the jersey
  let moved = 0;
  for (let k = 0; k < SP.a.count; k++) {
    const s = v3(SP, k);
    if (!nip.some((q) => dist(s, q) < NEAR)) continue;
    let bd = Infinity, bi = 0; for (let i = 0; i < jp.length; i++) { const d = dist(s, jp[i]); if (d < bd) { bd = d; bi = i; } }
    const n = jn[bi], out = (s[0] - jp[bi][0]) * n[0] + (s[1] - jp[bi][1]) * n[1] + (s[2] - jp[bi][2]) * n[2];
    if (out <= -DEPTH) continue;
    for (let c = 0; c < 3; c++) SP.set(k, c, s[c] - n[c] * (out + DEPTH));
    moved++;
  }
  (j.asset.extras ||= {}).chestTucked = true;
  let json = Buffer.from(JSON.stringify(j)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const out = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + json.length); out.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(out, 28 + json.length);
  fs.writeFileSync(f, out);
  console.log(f, 'filled', added.length / 3, 'triangles, moved', moved, 'skin vertices');
}
