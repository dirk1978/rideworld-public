# Steel footbridges over motorways for RideWorld's open worlds (2026-11-21, the bridleway off Bumble Hole Lane over the
# M5). One model per bridge from tools/openworld/footbridges.mjs's spec, built along the path's own line and heights:
#   SPEC=tools/kit/footbridges-<id>.json /snap/bin/blender -b --python tools/kit/footbridge.py -- <out dir> [preview.png]
# X east, Y north, Z up (heading 0), origin = the bridge's middle point at its deck height. A deck you ride on (its surface
# at the path's height), two deep painted steel plate girders under its edges, high mesh parapets (bridleway bridges over
# motorways are fenced 1.8 m high for horses) on steel posts with a top rail, and concrete piers at the ends and every
# ~22 m. Every shape is a closed solid.
import os, sys, math, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'london'))
import lk, bpy, bmesh
import numpy as np

A = lk.args(); OUTDIR = A[0]; PNG = A[1] if len(A) > 1 else None
SPEC = json.load(open(os.environ['SPEC']))

def mesh_tex(size=256):  # weld mesh: a fine grid of green bars, the gaps dark (seen against the sky it reads as a fence)
    img = np.zeros((size, size, 3), np.float32) + np.array([0.08, 0.1, 0.09])
    for k in range(0, size, 16): img[:, k:k + 3] = (0.2, 0.32, 0.24); img[k:k + 3, :] = (0.2, 0.32, 0.24)
    return img
def surf_tex(kind, size=256):
    base = {'paved': (0.36, 0.36, 0.37), 'gravel': (0.55, 0.45, 0.36), 'dirt': (0.44, 0.34, 0.25)}.get(kind, (0.5, 0.42, 0.34))
    return np.zeros((size, size, 3), np.float32) + np.array(base) * (1 + lk.noise(size, size, 0.12, 1))

def ribbon(name, pts, o0, o1, zb, zt, mat, uv=1.0):
    """a closed solid along the line pts [(x, y, z)] from offset o0 to o1 (left +), between z+zb and z+zt"""
    bm = bmesh.new(); rows = []
    for i, p in enumerate(pts):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]; tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1; nx, ny = -ty / L, tx / L
        rows.append([bm.verts.new((p[0] + nx * o, p[1] + ny * o, p[2] + z)) for o, z in ((o0, zb), (o1, zb), (o1, zt), (o0, zt))])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(4): bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    bm.faces.new(rows[0][::-1]); bm.faces.new(rows[-1]); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lk.finish(name, bm, mat, uv)

def build(b):
    """as the real one (the owner's Street View, 2026-11-21): a slim pale concrete deck in long spans, galvanised railings with
    close vertical bars, tall concrete abutment walls at the ends and piers only in the central reservation"""
    P = [tuple(q) for q in b['pts']]
    def ext(p0, p1, d): L = math.hypot(p0[0] - p1[0], p0[1] - p1[1]) or 1; return (p0[0] + (p0[0] - p1[0]) / L * d, p0[1] + (p0[1] - p1[1]) / L * d, p0[2])
    P = [ext(P[0], P[1], 1.0)] + P + [ext(P[-1], P[-2], 1.0)]
    HW = 1.75
    CONC = lk.mat('Concrete', img=lk.image('conc', lk.ashlar((0.7, 0.69, 0.66), rows=2, cols=1, mortar=0.96, jitter=0.02)), rough=0.9, glow=0.2)
    SOFFIT = lk.mat('Soffit', (0.52, 0.52, 0.5), rough=0.9, glow=0.15)
    WALL = lk.mat('Abutment', img=lk.image('abut', lk.ashlar((0.6, 0.59, 0.56), rows=6, cols=2, mortar=0.9, jitter=0.04)), rough=0.95, glow=0.15)
    GALV = lk.mat('Galvanised', (0.62, 0.64, 0.65), rough=0.4, metal=0.7, glow=0.15)
    DECK = lk.mat('Deck', img=lk.image('deck', surf_tex(b.get('surf', 'gravel'))), rough=0.95, glow=0.15)
    ribbon('Surface', P, -HW + 0.25, HW - 0.25, -0.12, -0.02, DECK, 2.0)
    ribbon('DeckSlab', P, -HW - 0.15, HW + 0.15, -1.1, -0.12, CONC, 3.0)       # the pale beam, seen edge-on as a slim band
    ribbon('Soffit', P, -HW + 0.1, HW - 0.1, -1.18, -1.08, SOFFIT, 3.0)
    for s in (-1, 1):
        ribbon('Upstand', P, s * HW - (0.25 if s > 0 else 0), s * HW + (0 if s > 0 else 0.25), -0.12, 0.25, CONC, 2.0)
        ribbon('TopRail', P, s * (HW - 0.12) - 0.04, s * (HW - 0.12) + 0.04, 1.3, 1.38, GALV, 1.0)
        ribbon('BottomRail', P, s * (HW - 0.12) - 0.03, s * (HW - 0.12) + 0.03, 0.3, 0.36, GALV, 1.0)
    S = [0.0]
    for a, c in zip(P, P[1:]): S.append(S[-1] + math.hypot(c[0] - a[0], c[1] - a[1]))
    def at(s):
        i = max(0, min(len(S) - 2, next((k for k in range(len(S) - 1) if S[k + 1] >= s), len(S) - 2)))
        t = (s - S[i]) / ((S[i + 1] - S[i]) or 1); a, c = P[i], P[i + 1]
        tx, ty = c[0] - a[0], c[1] - a[1]; L = math.hypot(tx, ty) or 1
        return a[0] + tx * t, a[1] + ty * t, a[2] + (c[2] - a[2]) * t, tx / L, ty / L
    # railings: posts every 2 m, close vertical bars between (every 0.14 m)
    s = 0.3
    while s < S[-1] - 0.2:
        x, y, z, tx, ty = at(s); nx, ny = -ty, tx; post = abs((s - 0.3) % 2.0) < 0.07
        for sd in (-1, 1):
            w = 0.07 if post else 0.022
            lk.box('Post' if post else 'Bar', x + nx * sd * (HW - 0.12), y + ny * sd * (HW - 0.12), z + 0.25, w, w, 1.1 if not post else 1.15, GALV, rot=math.atan2(ty, tx))
        s += 0.14
    # abutments: tall walls under each end, wide across, down into the ground; piers in the central reservation
    for s in (0.6, S[-1] - 0.6):
        x, y, z, tx, ty = at(s)
        lk.box('Abutment', x, y, z - 13.0, 2.2, 2 * HW + 5.0, 11.9, WALL, rot=math.atan2(ty, tx))
    for sp in b.get('piers', []):
        x, y, z, tx, ty = at(sp + 1.0)
        lk.box('Pier', x, y, z - 13.0, 0.9, 2 * HW - 0.4, 11.9, CONC, rot=math.atan2(ty, tx))

for b in SPEC:
    lk.start(); build(b)
    lk.export(os.path.join(OUTDIR, f"footbridge-{b['n']}.glb"), f"Footbridge{b['n']}")
    if PNG and b is SPEC[0]: lk.preview(PNG, (20, -25, 6), (0, 0, -1), lens=28, ground_z=-9.0)
