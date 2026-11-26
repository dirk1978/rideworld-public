// Builds a low-poly bike and rider as a glTF model in the browser, so kit colours can change freely.
// Two animations: "pedal" (one crank revolution, legs follow the pedals by 2-bone IK) and "wheels"
// (one wheel revolution). main.js drives both from cadence and distance via animationTime.
// Axes: +X forward, +Y left, +Z up, metres, origin on the ground between the wheels.

export const WHEEL_R = 0.34;
const BB = [0, 0, 0.28]; // bottom bracket
const CRANK = 0.17;
const HIP_Z = 0.98, HIP_X = -0.2, HIP_Y = 0.1;
const THIGH = 0.44, SHIN = 0.46;

export const DEFAULT_KIT = { jersey: '#ff6a1a', shorts: '#1b1f27', frame: '#e8e8e8', helmet: '#ffffff' };

// ---------- tiny mesh builder ----------
class Mesh {
  constructor() { this.pos = []; this.nrm = []; this.idx = []; }
  vert(p, n) { this.pos.push(...p); this.nrm.push(...n); return this.pos.length / 3 - 1; }
  // Tube from a to b, radius r (or [ra, rb]), with flat caps
  tube(a, b, r, seg = 10) {
    const [ra, rb] = Array.isArray(r) ? r : [r, r];
    const d = sub(b, a), ax = norm(d);
    const u = norm(cross(ax, Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(ax, u);
    const ring = (c, rr) => [...Array(seg)].map((_, i) => {
      const t = (i / seg) * Math.PI * 2, n = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
      return { p: add(c, scale(n, rr)), n };
    });
    const A = ring(a, ra), B = ring(b, rb);
    const ia = A.map((q) => this.vert(q.p, q.n)), ib = B.map((q) => this.vert(q.p, q.n));
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.idx.push(ia[i], ib[j], ib[i], ia[i], ia[j], ib[j]); // counter-clockwise from outside
    }
    for (const [c, R, s] of [[a, A, -1], [b, B, 1]]) {
      const ci = this.vert(c, scale(ax, s)), ri = R.map((q) => this.vert(q.p, scale(ax, s)));
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        if (s > 0) this.idx.push(ci, ri[i], ri[j]); else this.idx.push(ci, ri[j], ri[i]);
      }
    }
    return this;
  }
  sphere(c, r, sx = 1, sy = 1, sz = 1, lat = 8, lon = 12) {
    const base = this.pos.length / 3;
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI;
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * Math.PI * 2;
        const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        this.vert([c[0] + n[0] * r * sx, c[1] + n[1] * r * sy, c[2] + n[2] * r * sz], norm([n[0] / sx, n[1] / sy, n[2] / sz]));
      }
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = base + i * (lon + 1) + j, b = a + lon + 1;
      this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return this;
  }
  box(c, s) {
    const h = s.map((x) => x / 2);
    const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    for (const [ax, sg] of faces) {
      const n = [0, 0, 0]; n[ax] = sg;
      const u = (ax + 1) % 3, v = (ax + 2) % 3;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const p = [...c]; p[ax] += h[ax] * sg; p[u] += h[u] * a; p[v] += h[v] * b; return this.vert(p, n);
      });
      if (sg > 0) this.idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else this.idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
    return this;
  }
  // Ring around the Y axis (a tyre)
  torus(R, r, segR = 28, segr = 8) {
    const base = this.pos.length / 3;
    for (let i = 0; i <= segR; i++) {
      const a = (i / segR) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      for (let j = 0; j <= segr; j++) {
        const b = (j / segr) * Math.PI * 2;
        const n = [cx * Math.cos(b), Math.sin(b), cz * Math.cos(b)];
        this.vert([cx * R + n[0] * r, n[1] * r, cz * R + n[2] * r], n);
      }
    }
    for (let i = 0; i < segR; i++) for (let j = 0; j < segr; j++) {
      const a = base + i * (segr + 1) + j, b = a + segr + 1;
      this.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return this;
  }
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const qY = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => c ** 2.2).concat(1); };

// Angle about Y that turns the local -Z axis towards direction (dx, dz)
const aimY = (dx, dz) => Math.atan2(-dx, -dz);

// Leg angles for a crank angle c (0 = pedal at the bottom, increasing = pedalling forwards)
function legPose(c) {
  const pedal = [BB[0] - Math.sin(c) * CRANK, BB[2] - Math.cos(c) * CRANK];
  let dx = pedal[0] - HIP_X, dz = pedal[1] - HIP_Z;
  let L = Math.hypot(dx, dz);
  const maxL = THIGH + SHIN - 0.002;
  if (L > maxL) { dx *= maxL / L; dz *= maxL / L; L = maxL; }
  // knee forward: rotate the hip->pedal direction by the IK angle
  const cosA = (THIGH * THIGH + L * L - SHIN * SHIN) / (2 * THIGH * L);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const base = aimY(dx, dz);
  const thigh = base - A; // negative rotation about Y swings -Z towards +X (knee forwards)
  const knee = [HIP_X - Math.sin(thigh) * THIGH, HIP_Z - Math.cos(thigh) * THIGH];
  const shinAbs = aimY(pedal[0] - knee[0], pedal[1] - knee[1]);
  return { thigh, shin: shinAbs - thigh, foot: -shinAbs }; // foot stays roughly level
}

export function buildRiderGltf(kit = {}) {
  kit = { ...DEFAULT_KIT, ...kit };
  const mats = {
    jersey: hex(kit.jersey), shorts: hex(kit.shorts), frame: hex(kit.frame), helmet: hex(kit.helmet),
    skin: hex('#d9a27e'), black: hex('#16181c'), tyre: hex('#202124'), metal: hex('#9aa0a6'), shoe: hex('#f2f2f2'),
  };
  const matNames = Object.keys(mats);
  const meshes = []; // { parts: [{mat, mesh}] }
  const nodes = [];
  const addMesh = (parts) => { meshes.push(parts); return meshes.length - 1; };
  const node = (o) => { nodes.push(o); return nodes.length - 1; };

  // ---- bike frame (static)
  const ST = [-0.17, 0, 0.88], HT = [0.42, 0, 0.92], HB = [0.4, 0, 0.78];
  const RH = [-0.5, 0, WHEEL_R], FH = [0.5, 0, WHEEL_R];
  const frame = new Mesh()
    .tube(ST, HT, 0.022).tube(HB, BB, 0.026).tube(BB, ST, 0.022).tube(HB, HT, 0.03)
    .tube(BB, add(RH, [0, 0.055, 0]), 0.012).tube(BB, add(RH, [0, -0.055, 0]), 0.012)
    .tube(ST, add(RH, [0, 0.055, 0]), 0.011).tube(ST, add(RH, [0, -0.055, 0]), 0.011)
    .tube(HB, add(FH, [0, 0.05, 0]), 0.014).tube(HB, add(FH, [0, -0.05, 0]), 0.014);
  const parts = new Mesh()
    .tube([-0.19, 0, 0.88], [-0.205, 0, 0.95], 0.014) // seatpost
    .tube(HT, [0.52, 0, 0.95], 0.016) // stem
    .tube([0.53, 0.21, 0.95], [0.53, -0.21, 0.95], 0.013) // bars
    .tube([0.53, 0.2, 0.95], [0.6, 0.2, 0.86], 0.013).tube([0.53, -0.2, 0.95], [0.6, -0.2, 0.86], 0.013) // drops
    .box([-0.22, 0, 0.958], [0.26, 0.1, 0.035]); // saddle
  const chainring = new Mesh().tube(add(BB, [0, -0.05, 0]), add(BB, [0, -0.056, 0]), 0.1, 24);
  const bikeMesh = addMesh([{ mat: 'frame', mesh: frame }, { mat: 'black', mesh: parts }, { mat: 'metal', mesh: chainring }]);

  // ---- wheels (rotate about their hubs)
  const wheel = new Mesh().torus(WHEEL_R - 0.014, 0.014);
  const rim = new Mesh().torus(WHEEL_R - 0.045, 0.018, 28, 6);
  const spokes = new Mesh().tube([0, -0.03, 0], [0, 0.03, 0], 0.03);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    spokes.tube([0, 0, 0], [Math.cos(a) * (WHEEL_R - 0.05), 0, Math.sin(a) * (WHEEL_R - 0.05)], 0.012, 6);
  }
  const wheelMesh = addMesh([{ mat: 'tyre', mesh: wheel }, { mat: 'black', mesh: rim }, { mat: 'metal', mesh: spokes }]);

  // ---- cranks (rotate about BB); arms point down (-Z) at angle 0, left arm opposite
  const cranks = new Mesh()
    .tube([0, -HIP_Y, 0], [0, -HIP_Y, -CRANK], 0.014, 6).box([0, -HIP_Y - 0.03, -CRANK], [0.09, 0.07, 0.02])
    .tube([0, HIP_Y, 0], [0, HIP_Y, CRANK], 0.014, 6).box([0, HIP_Y + 0.03, CRANK], [0.09, 0.07, 0.02])
    .tube([0, -HIP_Y, 0], [0, HIP_Y, 0], 0.012, 6);
  const crankMesh = addMesh([{ mat: 'black', mesh: cranks }]);

  // ---- rider body (static)
  const hipC = [HIP_X, 0, HIP_Z], shoulder = [0.27, 0, 1.33];
  const body = new Mesh().tube(add(hipC, [0.02, 0, 0.05]), shoulder, [0.13, 0.15]).sphere(shoulder, 0.15, 1.0, 1.25, 0.8);
  const shorts = new Mesh().sphere(hipC, 0.13, 1.1, 1.35, 0.9);
  const skin = new Mesh().tube(shoulder, [0.38, 0, 1.43], 0.05).sphere([0.43, 0, 1.47], 0.1, 1.05, 0.9, 1.05);
  const helmet = new Mesh().sphere([0.41, 0, 1.51], 0.125, 1.25, 0.95, 0.75);
  const arms = new Mesh();
  const armSkin = new Mesh();
  for (const s of [1, -1]) {
    const sh = [0.27, 0.17 * s, 1.34], el = [0.4, 0.21 * s, 1.12], hand = [0.55, 0.2 * s, 0.97];
    arms.tube(sh, add(sh, scale(sub(el, sh), 0.55)), [0.055, 0.05]);
    armSkin.tube(add(sh, scale(sub(el, sh), 0.55)), el, [0.045, 0.04]).tube(el, hand, [0.04, 0.032]).sphere(hand, 0.04);
  }
  const bodyMesh = addMesh([
    { mat: 'jersey', mesh: body.tube([0.27, 0.17, 1.34], [0.27, -0.17, 1.34], 0.07) }, { mat: 'jersey', mesh: arms },
    { mat: 'shorts', mesh: shorts }, { mat: 'skin', mesh: skin }, { mat: 'skin', mesh: armSkin }, { mat: 'helmet', mesh: helmet },
  ]);

  // ---- legs: hip -> thigh (rotates) -> knee -> shin (rotates) -> foot
  const thighMesh = addMesh([{ mat: 'shorts', mesh: new Mesh().tube([0, 0, 0.02], [0, 0, -THIGH * 0.6], [0.085, 0.07]) },
    { mat: 'skin', mesh: new Mesh().tube([0, 0, -THIGH * 0.6], [0, 0, -THIGH], [0.065, 0.055]).sphere([0, 0, -THIGH], 0.055) }]);
  const shinMesh = addMesh([{ mat: 'skin', mesh: new Mesh().tube([0, 0, 0], [0, 0, -SHIN + 0.06], [0.055, 0.035]) },
    { mat: 'shoe', mesh: new Mesh().tube([0, 0, -SHIN + 0.08], [0, 0, -SHIN + 0.02], [0.04, 0.035]) }]);
  const footMesh = addMesh([{ mat: 'shoe', mesh: new Mesh().box([0.03, 0, -0.02], [0.24, 0.085, 0.07]) }]);

  const anim = { pedal: [], wheels: [] };
  const children = [];
  children.push(node({ name: 'bike', mesh: bikeMesh }));
  children.push(node({ name: 'body', mesh: bodyMesh }));
  const wheelF = node({ name: 'wheelF', mesh: wheelMesh, translation: FH });
  const wheelR = node({ name: 'wheelR', mesh: wheelMesh, translation: RH });
  const crank = node({ name: 'crank', mesh: crankMesh, translation: BB });
  children.push(wheelF, wheelR, crank);
  anim.wheels.push(wheelF, wheelR);

  const legs = [];
  for (const [side, phase] of [[-1, 0], [1, Math.PI]]) {
    const foot = node({ name: 'foot', mesh: footMesh, translation: [0, 0, -SHIN] });
    const shin = node({ name: 'shin', mesh: shinMesh, translation: [0, 0, -THIGH], children: [foot] });
    const thigh = node({ name: 'thigh', mesh: thighMesh, translation: [HIP_X, HIP_Y * side, HIP_Z], children: [shin] });
    children.push(thigh);
    legs.push({ thigh, shin, foot, phase });
  }
  const root = node({ name: 'rider', children });

  // ---- animation keyframes
  const N = 36;
  const times = [...Array(N + 1)].map((_, i) => i / N);
  const channels = { pedal: [], wheels: [] };
  channels.pedal.push({ node: crank, q: times.map((t) => qY(t * Math.PI * 2)) });
  for (const leg of legs) {
    const poses = times.map((t) => legPose(t * Math.PI * 2 + leg.phase));
    channels.pedal.push({ node: leg.thigh, q: poses.map((p) => qY(p.thigh)) });
    channels.pedal.push({ node: leg.shin, q: poses.map((p) => qY(p.shin)) });
    channels.pedal.push({ node: leg.foot, q: poses.map((p) => qY(p.foot)) });
  }
  for (const w of anim.wheels) channels.wheels.push({ node: w, q: times.map((t) => qY(t * Math.PI * 2)) });

  // ---- pack into one buffer
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [];
  const pushData = (typed, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: typed.byteLength, ...(target ? { target } : {}) });
    chunks.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    byteLength += typed.byteLength;
    return bufferViews.length - 1;
  };
  const accessor = (typed, type, count, extra = {}, target) => {
    accessors.push({ bufferView: pushData(typed, target), componentType: typed instanceof Float32Array ? 5126 : 5125, count, type, ...extra });
    return accessors.length - 1;
  };

  const gltfMeshes = meshes.map((partsList) => ({
    primitives: partsList.map(({ mat, mesh }) => {
      const pos = new Float32Array(mesh.pos);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      return {
        attributes: {
          POSITION: accessor(pos, 'VEC3', pos.length / 3, { min, max }, 34962),
          NORMAL: accessor(new Float32Array(mesh.nrm), 'VEC3', pos.length / 3, {}, 34962),
        },
        indices: accessor(new Uint32Array(mesh.idx), 'SCALAR', mesh.idx.length, {}, 34963),
        material: matNames.indexOf(mat),
      };
    }),
  }));

  const timeAcc = accessor(new Float32Array(times), 'SCALAR', times.length, { min: [0], max: [1] });
  const animations = Object.entries(channels).map(([name, chs]) => {
    const samplers = [], channelsOut = [];
    for (const ch of chs) {
      const out = accessor(new Float32Array(ch.q.flat()), 'VEC4', ch.q.length);
      samplers.push({ input: timeAcc, output: out, interpolation: 'LINEAR' });
      channelsOut.push({ sampler: samplers.length - 1, target: { node: ch.node, path: 'rotation' } });
    }
    return { name, samplers, channels: channelsOut };
  });

  const bin = new Uint8Array(byteLength);
  let off = 0;
  for (const c of chunks) { bin.set(c, off); off += c.byteLength; }
  let b64 = '';
  for (let i = 0; i < bin.length; i += 0x8000) b64 += String.fromCharCode(...bin.subarray(i, i + 0x8000));

  return {
    asset: { version: '2.0', generator: 'RideWorld rider.js' },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    meshes: gltfMeshes,
    materials: matNames.map((n) => ({
      name: n,
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: mats[n], metallicFactor: 0, roughnessFactor: n === 'helmet' || n === 'frame' ? 0.35 : 0.8 },
    })),
    buffers: [{ byteLength, uri: 'data:application/octet-stream;base64,' + btoa(b64) }],
    bufferViews,
    accessors,
    animations,
  };
}
