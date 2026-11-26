# Warwickshire landmarks for RideWorld's Stratford-upon-Avon and Alcester open world (2026-11-18).
#   /snap/bin/blender -b --python tools/kit/shire.py -- <name> <out.glb> [preview.png]
#   names: edstone
# Built with the London kit's helpers (tools/kit/london/lk.py). X east, Y north, Z up; see each model's notes.
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'london'))
import lk, bpy
import numpy as np

A = lk.args(); NAME, OUT = A[0], A[1]; PNG = A[2] if len(A) > 2 else None
SKIP = set(os.environ.get('SKIP', '').split(','))  # (testing: leave parts out)
lk.start()
BRICK = (0.55, 0.3, 0.22)

def iron_plates(size=512, plates=4, base=(0.09, 0.09, 0.1)):
    """black-painted cast-iron trough sides: bolted plates with raised flanges between them and a bead of rivets"""
    img = np.ones((size, size, 3), np.float32) * np.array(base)
    pw = size // plates
    for k in range(plates):
        x = k * pw
        img[:, x:x + 10] = np.array(base) * 2.2           # the flange, catching the light
        img[:, x + 10:x + 14] = np.array(base) * 0.6      # its shadow
        for y in range(16, size, 32): img[y - 3:y + 3, x + 3:x + 7] = np.array(base) * 3.0  # rivet heads
    img[:24] = np.array(base) * 1.8; img[-24:] = np.array(base) * 1.6  # top and bottom rails
    return img * (1 + lk.noise(size, size, 0.05, 1))

def edstone(L=157.0):
    """The Edstone (Bearley) Aqueduct, 1816, Grade II*: England's longest, 145 m. A cast-iron trough carrying the
    Stratford-upon-Avon Canal on tapering brick piers over a lane, the railway and a brook; the towpath runs alongside
    at the level of the trough's floor, so walking it the water is at your elbow. Origin = the middle of the trough at
    the water surface; the trough runs along Y (the placement turns it to its real bearing); towpath on +X. The piers
    run 16 m down (the ground hides what's below the valley floor)."""
    IN = 2.3                                   # inside width of the trough
    WATER_DEPTH = 1.2                          # trough floor below the water
    IRON = lk.mat('Iron', img=lk.image('iron', iron_plates()), rough=0.5, metal=0.4, glow=0.15)
    IRONP = lk.mat('IronPlain', (0.1, 0.1, 0.11), rough=0.5, metal=0.4, glow=0.12)
    BR = lk.mat('Brick', img=lk.image('br', lk.brick(BRICK)), glow=0.22)
    STONE = lk.mat('Coping', img=lk.image('cp', lk.ashlar((0.72, 0.68, 0.6), rows=2, cols=3)), glow=0.22)
    WATER = lk.mat('Water', img=lk.image('w', lk.glass((0.32, 0.33, 0.25), floors=1, mullions=1, band=(0.32, 0.33, 0.25), sky=0.25)), rough=0.15, metal=0.2, glow=0.2)
    PATH = lk.mat('Path', (0.36, 0.33, 0.3), rough=0.9, glow=0.12)
    RAIL = lk.mat('Rail', (0.85, 0.85, 0.82), rough=0.5, metal=0.4, glow=0.2)
    zf = -WATER_DEPTH                          # trough floor
    # the trough: two cast-iron sides from below the floor to 0.25 m over the water, and its floor
    for sx in (-1, 1):
        x = sx * (IN / 2 + 0.06)
        lk.box('TroughSide', x, 0, zf - 0.5, 0.12, L, WATER_DEPTH + 0.75, IRON, uv=4, uvz=1.5)
    lk.box('TroughFloor', 0, 0, zf - 0.55, IN + 0.24, L, 0.1, IRONP, uv=4)
    lk.box('TroughLip', 0, 0, 0.25, IN + 0.4, L, 0.06, IRONP, uv=4)  # (a ledge round the top edge)
    # the water: a thin slab (a single flat quad here reliably made the test server's nouveau driver kill the WebGL context)
    if 'water' not in SKIP: lk.box('Water', 0, 0, -0.08, IN, L, 0.03, WATER, uv=6)
    # the towpath: an iron walkway on +X at floor level, with iron railings on its outer side
    tx = IN / 2 + 0.12 + 0.6
    lk.box('Towpath', tx, 0, zf - 0.08, 1.2, L, 0.1, PATH, uv=2)
    lk.box('TowpathEdge', tx + 0.62, 0, zf - 0.5, 0.06, L, 0.5, IRON, uv=4, uvz=1.5)
    for k in range(int(L / 2.4) + 1 if 'rail' not in SKIP else 0):
        y = -L / 2 + k * 2.4
        lk.box('RailPost', tx + 0.58, y, zf, 0.05, 0.05, 1.05, RAIL)
    for zz in (zf + 0.55, zf + 1.05): lk.box('Rail', tx + 0.58, 0, zz, 0.05, L, 0.05, RAIL, uv=2)
    # the piers: brick, tapering out as they go down, under trough and towpath, every ~11.5 m; brick abutments at the ends
    span = 11.5; n = int(L / span)
    W = IN + 0.24 + 1.4                       # the width they carry
    cx = (tx + 0.62 - (IN / 2 + 0.12)) / 2    # centred under trough + towpath
    for k in range(1, n + 1):
        y = -L / 2 + k * (L / (n + 1))
        top = zf - 0.6
        lk.taper('Pier', lk.rect(cx, y, W + 0.4, 1.6), top, lk.rect(cx, y, W + 1.6, 2.6), top - 16, BR, uv=2)
        lk.box('PierCap', cx, y, top - 0.05, W + 0.6, 1.8, 0.35, STONE, uv=1)
    for s in (-1, 1):
        y = s * (L / 2 + 3)
        lk.box('Abutment', cx, y, zf - 16, W + 4, 6, 16 + 0.3, BR, uv=2)
        lk.box('AbutmentCap', cx, y, zf + 0.3 - 0.05, W + 4.4, 6.4, 0.3, STONE, uv=1)

def lias(size=512):
    """weathered warm grey-brown lias with orange and pink sandstone patches, coursed in uneven rows (the owner's photos)"""
    img = lk.ashlar((0.6, 0.56, 0.5), size, rows=7, cols=2, mortar=0.9, jitter=0.05)
    yy, xx = np.mgrid[0:size, 0:size] / size
    warm = 0.5 + 0.5 * np.sin(xx * 5.3 + np.sin(yy * 3.1) * 1.7) * np.sin(yy * 4.7 + xx * 1.3)  # (soft orange weathering)
    img = img * (1 + (warm[..., None] - 0.5) * np.array((0.16, 0.04, -0.1)))
    return img * (1 + lk.noise(size, size, 0.05, 2))

def bidford():
    stone_bridge(os.environ['BIDFORD'], spans=[4.6, 5.6, 6.2, 6.6, 6.4, 5.8, 5.2, 4.4], pointed=[True, True, True, True, True, False, False, False], HW=2.75, IN=2.1, pier=2.0)

def clopton():
    """Clopton Bridge, Stratford-upon-Avon (Sir Hugh Clopton, c. 1490, Grade I): fourteen arches of grey Lias with
    cutwaters, carrying the A3400 over the Avon. Two lanes between the parapets (the drawn deck is the road's own 7.5 m).
    The line and deck heights come from the world file (tools/kit/clopton-line.json, made from the Clopton Bridge piece)."""
    stone_bridge(os.environ['CLOPTON'], spans=[5.2, 5.6, 6.0, 6.2, 6.4, 6.6, 6.8, 6.8, 6.6, 6.4, 6.2, 6.0, 5.6, 5.2], pointed=[True] * 12 + [False] * 2, HW=4.45, IN=3.75, pier=2.3)

def stone_bridge(src, spans, pointed, HW, IN, pier):
    """Bidford Bridge (15th century, Grade I), from the owner's photos (2026-11-20): a low, plain stone bridge of eight
    irregular pointed arches (rounder rebuilt ones at the south end), modest cutwaters, plain walls up to a thick
    parapet with big flat coping stones; single lane, ~4 m between the parapets. Built along the bridge's own line and
    deck heights from the world file (BIDFORD = a JSON of { pts: [[x east, y north, z]...], water } about the origin,
    the deck's middle). The road is the world's drawn deck (4.2 m wide here: landmarks deckWidth); the parapets stand on
    its edges. No booleans: each arch is a vault with the wall above it, piers between."""
    import json, bmesh
    P = json.load(open(src))
    pts, WATER = P['pts'], P['water']
    STONE = lk.mat('Lias', img=lk.image('lias', lias()), rough=0.9, glow=0.22)  # (uv 3 m a repeat: courses ~40 cm)
    VAULT = lk.mat('Vault', img=lk.image('vault', lias() * 0.78), rough=0.95, glow=0.15)
    COPE = lk.mat('Coping', img=lk.image('cp', lk.ashlar((0.66, 0.62, 0.55), rows=1, cols=5, mortar=0.84, jitter=0.08)), rough=0.85, glow=0.22)
    # HW: outer face; IN: parapet inner face (the drawn deck's half width)
    seg = []
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / 0.5))
        for k in range(n): t = k / n; seg.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t))
    seg.append(tuple(pts[-1]))
    def ext(p0, p1, d): L = math.hypot(p0[0] - p1[0], p0[1] - p1[1]); return (p0[0] + (p0[0] - p1[0]) / L * d, p0[1] + (p0[1] - p1[1]) / L * d, p0[2])
    seg = [ext(seg[0], seg[2], 3.0)] + seg + [ext(seg[-1], seg[-3], 3.0)]
    S = [0.0]
    for a, b in zip(seg, seg[1:]): S.append(S[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    def frame(i):
        a, b = seg[max(0, i - 1)], seg[min(len(seg) - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty); tx, ty = tx / L, ty / L
        return tx, ty, -ty, tx
    def at_s(s):
        i = max(0, min(len(S) - 2, next((k for k in range(len(S) - 1) if S[k + 1] >= s), len(S) - 2)))
        t = (s - S[i]) / ((S[i + 1] - S[i]) or 1); a, b = seg[i], seg[i + 1]
        tx, ty, nx, ny = frame(i)
        return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, tx, ty, nx, ny
    def ribbon(name, o0, o1, zb, zt, material, s0=-1e9, s1=1e9, uv=2.0):
        bm = bmesh.new(); rows = []
        idx = [i for i in range(len(seg)) if s0 <= S[i] <= s1]
        for i in idx:
            p = seg[i]; tx, ty, nx, ny = frame(i)
            rows.append([bm.verts.new((p[0] + nx * o, p[1] + ny * o, z)) for o, z in ((o0, zb(p)), (o1, zb(p)), (o1, zt(p)), (o0, zt(p)))])
        if len(rows) < 2: bm.free(); return None
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(4): bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
        bm.faces.new(rows[0][::-1]); bm.faces.new(rows[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return lk.finish(name, bm, material, uv)
    # arch layout over the river part
    s_lo, s_hi = S[0] + 4.0, S[-1] - 4.0
    k = (s_hi - s_lo - pier * (len(spans) - 1)) / sum(spans); spans = [w * k for w in spans]
    if pts[0][1] > pts[-1][1]: pointed = pointed[::-1]
    arches = []; s = s_lo
    for w, pt in zip(spans, pointed): arches.append((s, s + w, pt)); s += w + pier
    # piers and abutments: solid from below the water to the deck
    solid_ranges = [(S[0], arches[0][0])] + [(arches[i][1], arches[i + 1][0]) for i in range(len(arches) - 1)] + [(arches[-1][1], S[-1])]
    for a, b in solid_ranges: ribbon('Pier', -HW, HW, lambda p: WATER - 3.0, lambda p: p[2] - 0.05, STONE, a - 0.26, b + 0.26, uv=3.0)
    # each arch: the vault (intrados) and the wall above it, across the full width
    for a, b, pt in arches:
        w = b - a; sc = (a + b) / 2; x, y, z, tx, ty, nx, ny = at_s(sc)
        spring = WATER + 0.5; rise = max(1.0, min(z - 0.75 - spring, w * (0.6 if pt else 0.4)))
        N = 24; bm = bmesh.new(); cols = []
        for jj in range(N + 1):
            u = -w / 2 + w * jj / N
            if pt:
                R = w * 0.75; uc = -w / 2 + R if u < 0 else w / 2 - R; z0 = math.sqrt(R * R - (w / 2 - R) ** 2)
                zz = math.sqrt(max(0, R * R - (u - uc) ** 2)) / z0 * rise
            else: zz = rise * math.sqrt(max(0, 1 - (2 * u / w) ** 2))
            _, _, zd, _, _, _, _ = at_s(sc + u)
            zb = spring + zz if 0 < jj < N else WATER - 3.0
            cols.append([bm.verts.new((x + tx * u + nx * o, y + ty * u + ny * o, zv)) for o, zv in ((-HW, zb), (HW, zb), (HW, zd - 0.05), (-HW, zd - 0.05))])
        # the springing: the vault starts at the water's edge at the piers' faces
        for c0, c1 in zip(cols, cols[1:]):
            for q in range(4): bm.faces.new((c0[q], c0[(q + 1) % 4], c1[(q + 1) % 4], c1[q]))
        bm.faces.new(cols[0][::-1]); bm.faces.new(cols[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        lk.finish('Arch', bm, STONE, 3.0)
        # the vault's lining (a shade darker) and a ring of voussoirs at each face: thin CLOSED solids (an open sheet in a
        # model reliably killed the test server's nouveau WebGL context: Edstone's water, and this bridge's first version)
        def curve(jj):
            u = -w / 2 + w * jj / N
            if pt:
                R = w * 0.75; uc = -w / 2 + R if u < 0 else w / 2 - R; z0 = math.sqrt(R * R - (w / 2 - R) ** 2)
                return u, spring + math.sqrt(max(0, R * R - (u - uc) ** 2)) / z0 * rise
            return u, spring + rise * math.sqrt(max(0, 1 - (2 * u / w) ** 2))
        def band(name, pairs, o0, o1, material, uv):
            """a closed solid between two curves (lists of (u, z)) from offset o0 to o1"""
            bm = bmesh.new()
            V = lambda u, zz, o: bm.verts.new((x + tx * u + nx * o, y + ty * u + ny * o, zz))
            A = [(V(*a, o0), V(*b, o0), V(*b, o1), V(*a, o1)) for a, b in pairs]
            for r0, r1 in zip(A, A[1:]):
                for q in range(4): bm.faces.new((r0[q], r0[(q + 1) % 4], r1[(q + 1) % 4], r1[q]))
            bm.faces.new(A[0][::-1]); bm.faces.new(A[-1])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            lk.finish(name, bm, material, uv)
        C = [curve(jj) for jj in range(1, N)]
        band('Vault', [((u, zz - 0.06), (u, zz + 0.0)) for u, zz in C], -HW + 0.02, HW - 0.02, VAULT, 2.0)
        R2 = [curve(jj) for jj in range(0, N + 1)]
        ring = [((u, zz), (u * (1 + 0.42 / (w / 2)), zz + 0.42)) for u, zz in R2]
        for side in (-1, 1): band('Voussoirs', ring, side * HW, side * (HW + 0.06), VAULT, 1.0)
    # modest cutwaters on both faces at each pier, with sloping caps
    for i in range(len(arches) - 1):
        sp = (arches[i][1] + arches[i + 1][0]) / 2; x, y, z, tx, ty, nx, ny = at_s(sp); top = WATER + 1.9
        for side in (-1, 1):
            base = [(x - tx * pier / 2 + nx * side * HW, y - ty * pier / 2 + ny * side * HW), (x + tx * pier / 2 + nx * side * HW, y + ty * pier / 2 + ny * side * HW), (x + nx * side * (HW + 1.3), y + ny * side * (HW + 1.3))]
            lk.prism('Cutwater', base, WATER - 3.0, top, STONE, uv=2.0)
            lk.taper('CutwaterCap', base, top, [(x + nx * side * HW, y + ny * side * HW)], top + 1.3, COPE, uv=1.0)
    # parapets (on the deck's edges, ~0.95 m) with big flat coping stones
    for side in (-1, 1):
        o0, o1 = sorted((side * IN, side * HW))
        ribbon('Parapet', o0, o1, lambda p: p[2] - 0.4, lambda p: p[2] + 0.85, STONE, uv=3.0)
        ribbon('Coping', o0 - 0.04, o1 + 0.06, lambda p: p[2] + 0.85, lambda p: p[2] + 1.0, COPE, uv=1.0)

FUN = {'bidford': bidford, 'clopton': clopton, 'edstone': edstone, 'wootton': lambda: edstone(36.0)}  # (Wootton Wawen's aqueduct over the A3400, OSM 15220445: the same build, 36 m)
FUN[NAME]()
lk.export(OUT, NAME)
CAM = {'edstone': ((-40, -75, -5), (0, -5, -4)), 'wootton': ((-25, -30, -4), (0, 0, -4)), 'bidford': ((45, -38, 1), (0, 0, -2)), 'clopton': ((60, -70, 2), (0, 0, -2))}[NAME]
if PNG: lk.preview(PNG, CAM[0], CAM[1], lens=30, ground_z={'edstone': -9.0, 'wootton': -7.0, 'bidford': -6.0, 'clopton': -4.5}.get(NAME, 0.0))
