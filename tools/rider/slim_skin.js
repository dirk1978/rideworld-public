// Shrinks rider.glb's skin so phones can draw it (2026-10-21). The MakeHuman "game_engine" rig has 53 joints; each
// joint costs 4 vertex-shader uniform vectors, and many phone GPUs allow only ~256 in all, so Chrome on Android drew
// the bike and helmet but not the skinned body or shoes (the owner's screenshot).
//
// Only the legs move (the "pedal" animation drives thigh / calf / foot; toes follow the feet). Every other joint holds
// one fixed pose, so its skinning matrix (global x inverse bind) is a constant. A vertex weighted only to such joints
// is moved to its posed position here and weighted fully to one new static joint whose matrix is the identity: it
// renders exactly as before. Joints that share a vertex with a moving joint stay as they are. Exact, not approximate:
// skinning is linear, so pre-applying constant matrices changes nothing on screen.
//
//   node tools/rider/slim_skin.js public/models/rider.glb [out.glb]   (rewrites in place without out)
const fs = require('fs');
const [, , IN, OUT = IN] = process.argv;
const b = fs.readFileSync(IN);
const jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl)), binStart = 20 + jl + 8;
let bin = Buffer.from(b.slice(binStart, binStart + b.readUInt32LE(20 + jl)));
const N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CT = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array, 5125: Uint32Array };
const read = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView], n = N[a.type], C = CT[a.componentType];
  const off = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || n * C.BYTES_PER_ELEMENT, out = [];
  for (let k = 0; k < a.count; k++) out.push([...new C(bin.buffer, bin.byteOffset + off + k * stride, n)]);
  return out; };
// append a new accessor (tightly packed, 4-byte aligned) and return its index
const add = (rows, type, componentType, extra = {}) => {
  const C = CT[componentType], flat = new C(rows.flat()), raw = Buffer.from(flat.buffer);
  const pad = (4 - (bin.length % 4)) % 4; bin = Buffer.concat([bin, Buffer.alloc(pad), raw]);
  j.bufferViews.push({ buffer: 0, byteOffset: bin.length - raw.length, byteLength: raw.length });
  j.accessors.push({ bufferView: j.bufferViews.length - 1, componentType, count: rows.length, type, ...extra });
  return j.accessors.length - 1;
};

// --- 4x4 maths (column-major, as glTF) ---
const mul = (a, c) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) o[k * 4 + r] += a[m * 4 + r] * c[k * 4 + m]; return o; };
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => { const [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1]; };
const inv = (m) => { // affine inverse
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4]);
  const i = [(a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det];
  const t = [m[12], m[13], m[14]];
  return [i[0], i[1], i[2], 0, i[3], i[4], i[5], 0, i[6], i[7], i[8], 0,
    -(i[0] * t[0] + i[3] * t[1] + i[6] * t[2]), -(i[1] * t[0] + i[4] * t[1] + i[7] * t[2]), -(i[2] * t[0] + i[5] * t[1] + i[8] * t[2]), 1]; };
const xf = (m, p, w) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + (w ? m[12 + r] : 0));

const skin = j.skins[0], joints = skin.joints;
if (joints.length < 20) { console.log('already slim:', joints.length, 'joints'); process.exit(0); }
const parent = {}; j.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
// the pose: animation values where a channel exists (the static ones hold one value), else the node's own TRS
const pose = j.nodes.map((n) => ({ t: n.translation, r: n.rotation, s: n.scale }));
const moves = new Set();
for (const an of j.animations) for (const ch of an.channels) {
  const out = read(an.samplers[ch.sampler].output), k = { translation: 't', rotation: 'r', scale: 's' }[ch.target.path];
  if (out.some((o) => o.some((x, q) => Math.abs(x - out[0][q]) > 1e-5))) moves.add(ch.target.node);
  else pose[ch.target.node][k] = out[0];
}
const global = (i) => { const p = pose[i], l = j.nodes[i].matrix || trs(p.t, p.r, p.s); return parent[i] === undefined ? l : mul(global(parent[i]), l); };
// 2026-11-03 (the upper body sways now): a joint counts as moving only if its WORLD matrix changes over the animation.
// The hands stay on the hoods while the arms move above them, so the hands and the 30 finger joints are static and get
// pre-posed; judging by the parent chain kept them all (53 joints again).
const sampled = []; // [frame][node] -> world matrix
// (each animation on its own: "pedal" and "stand" drive the same joints, 2026-11-03; a joint still in both but posed
// differently in each counts as moving)
let topN = joints[0]; while (parent[topN] !== undefined) topN = parent[topN];
// (the top node rocks the whole bike in "stand": joints are judged in its frame, which is where the static joint lives)
for (const an of [...j.animations].sort((a, c) => (a.name === 'pedal' ? -1 : c.name === 'pedal' ? 1 : 0))) { // (pedal first: forced-static joints take its pose)
  const chans = an.channels.filter((ch) => ch.target.node !== topN).map((ch) => ({ node: ch.target.node, k: { translation: 't', rotation: 'r', scale: 's' }[ch.target.path], times: read(an.samplers[ch.sampler].input).map((x) => x[0]), out: read(an.samplers[ch.sampler].output) }));
  const times = [...new Set(chans.flatMap((c) => c.times))].sort((a, c) => a - c);
  for (const t of times) {
    const saved = pose.map((p) => ({ ...p }));
    for (const c of chans) { let k = c.times.findIndex((x) => x >= t - 1e-6); if (k < 0) k = c.times.length - 1; pose[c.node][c.k] = c.out[k]; }
    sampled.push(j.nodes.map((_, i) => global(i)));
    pose.forEach((p, i) => Object.assign(p, saved[i]));
  }
}
// hands and fingers: the arms' IK keeps the hands on the hoods; they roll ~0.2 deg as the arms move above them, which
// at the fingertips is a fraction of a millimetre. Pre-posed (else their 32 joints come back).
const HANDS = /^(hand|thumb|index|middle|ring|pinky)_/;
const movingGlobally = (i) => !HANDS.test(j.nodes[i].name || '') && sampled.some((f) => f[i].some((x, q) => Math.abs(x - sampled[0][i][q]) > 2e-4));
if (process.env.SLIM_DEBUG) for (const n of joints) console.log(j.nodes[n].name, Math.max(...sampled.map((f) => Math.max(...f[n].map((x, q) => Math.abs(x - sampled[0][n][q]))))).toFixed(5));
const world = (i) => (sampled.length ? sampled[0][i] : global(i)); // (a static joint's world matrix: any frame)
const ibm = read(skin.inverseBindMatrices);
const M = joints.map((n, k) => (movingGlobally(n) ? null : mul(world(n), ibm[k]))); // constant skin matrices

// pass 1: which static joints share a vertex with a moving one (those must stay)
const prims = [];
j.nodes.forEach((n) => { if (n.skin === 0) for (const p of j.meshes[n.mesh].primitives) prims.push(p); });
const keep = new Set(joints.map((n, k) => (M[k] ? -1 : k)).filter((k) => k >= 0));
for (const p of prims) {
  const J = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0);
  J.forEach((js, v) => { if (js.some((q, s) => W[v][s] > 0 && !M[q])) js.forEach((q, s) => { if (W[v][s] > 0) keep.add(q); }); });
}
// the new skin: the kept joints, then one static joint (a new node under the rig's top node, identity skin matrix)
let top = joints[0]; while (parent[top] !== undefined) top = parent[top];
j.nodes.push({ name: 'static' }); const sNode = j.nodes.length - 1; (j.nodes[top].children ||= []).push(sNode);
const kept = [...keep].sort((a, c) => a - c), remap = new Map(kept.map((q, k) => [q, k])), S = kept.length;
const newIbm = [...kept.map((q) => ibm[q]), inv(world(top))];
let moved = 0, total = 0;
for (const p of prims) {
  const P = read(p.attributes.POSITION), Nn = read(p.attributes.NORMAL), J = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0);
  const nJ = [], nW = [];
  J.forEach((js, v) => {
    total++;
    if (js.every((q, s) => W[v][s] === 0 || keep.has(q))) { nJ.push(js.map((q, s) => (W[v][s] > 0 ? remap.get(q) : 0))); nW.push(W[v]); return; }
    // all its joints are static (else they'd be kept): pre-pose it
    let pos = [0, 0, 0], nor = [0, 0, 0], ws = 0;
    js.forEach((q, s) => { const w = W[v][s]; if (!w) return; ws += w; const a = xf(M[q], P[v], 1), c = xf(M[q], Nn[v], 0); for (let r = 0; r < 3; r++) { pos[r] += w * a[r]; nor[r] += w * c[r]; } });
    pos = pos.map((x) => x / ws); const l = Math.hypot(...nor) || 1; nor = nor.map((x) => x / l);
    P[v] = pos; Nn[v] = nor; nJ.push([S, 0, 0, 0]); nW.push([1, 0, 0, 0]); moved++;
  });
  const mn = [0, 1, 2].map((r) => Math.min(...P.map((x) => x[r]))), mx = [0, 1, 2].map((r) => Math.max(...P.map((x) => x[r])));
  p.attributes.POSITION = add(P, 'VEC3', 5126, { min: mn, max: mx });
  p.attributes.NORMAL = add(Nn, 'VEC3', 5126);
  p.attributes.JOINTS_0 = add(nJ, 'VEC4', 5121);
  p.attributes.WEIGHTS_0 = add(nW, 'VEC4', 5126);
}
skin.joints = [...kept.map((q) => joints[q]), sNode];
skin.inverseBindMatrices = add(newIbm, 'MAT4', 5126);
console.log(`joints ${joints.length} -> ${skin.joints.length} (kept: ${kept.map((q) => j.nodes[joints[q]].name).join(' ')}); ${moved} of ${total} vertices pre-posed`);

// write (old accessors stay unreferenced in the buffer: a little bigger, harmless)
j.buffers[0].byteLength = bin.length;
let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const pb = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + pb.length, 8);
const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
fs.writeFileSync(OUT, Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(pb.length, 0x004e4942), pb]));
