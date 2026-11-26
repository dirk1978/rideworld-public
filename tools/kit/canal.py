# Narrow canal locks for RideWorld's open worlds (2026-11-21, the owner: "really work hard on these Tardebigge locks ...
# the longest lock flight in the country"). One model per lock, at its own length (gate to gate) and fall, built by
# tools/openworld/canal.mjs's spec:
#   LOCKS=spec.json /snap/bin/blender -b --python tools/kit/canal.py -- <out dir> [preview.png]
# spec: [{ ref, name, len, fall, tow: 'left'|'right' }]. One .glb per lock: lock-<ref>.glb.
# Local axes: X along the lock DOWNHILL (upper gate at -len/2, lower gate at +len/2), Y to the left, Z up; origin on the
# centre line halfway between the gates, z = 0 at the LOWER pound's water level. canal.mjs turns each to its heading.
# What's in one (a Worcester & Birmingham narrow lock, from photos of the Tardebigge flight): brick chamber 2.2 m wide
# with blue-brick coping, white-painted coping at the ends, a single top gate and a mitred pair of bottom gates in dark
# timber, black balance beams with white ends over brick-ribbed swing quadrants, paddle gear, a footboard and handrail on
# the bottom gates, bollards, the brick cill under the top gate, wing walls at both ends, the by-weir's overflow at the
# head on the offside and its outfall at the tail, water leaking through the top gate, a cast lock-number plate.
# Every shape is a CLOSED solid: an open sheet in a model kills the test server's nouveau WebGL context.
import os, sys, math, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'london'))
import lk, bpy, bmesh
import numpy as np

A = lk.args(); OUTDIR = A[0]; PNG = A[1] if len(A) > 1 else None
SPEC = json.load(open(os.environ['LOCKS']))
rng = np.random.default_rng(5)

# ---------- textures (small: one set travels inside every lock's file) ----------
def brick_tex(base, wet=False, size=256):
    img = lk.brick(base, size=size, rows=8, cols=2, mortar=(0.66, 0.63, 0.58) if not wet else (0.3, 0.32, 0.26))
    if wet:  # green-black slime, darker at the bottom (row 0 = top of the image)
        g = np.linspace(0.85, 0.45, size)[:, None, None]
        img = img * g + np.array([0.02, 0.05, 0.0]) * (1 - g)
    return img
def copers(size=256):  # blue engineering brick coping: dark blue-grey bullnose bricks, end on
    img = np.zeros((size, size, 3), np.float32) + np.array([0.2, 0.21, 0.24])
    for c in range(8):
        x0 = c * size // 8; img[:, x0:x0 + 2] = (0.12, 0.12, 0.13)
        img[:, x0 + 2:(c + 1) * size // 8] *= 1 + rng.normal(0, 0.08)
    return img * (1 + lk.noise(size, size, 0.05))
def timber(size=256):  # black-stained gate timber, vertical boards
    img = np.zeros((size, size, 3), np.float32) + np.array([0.11, 0.1, 0.09])
    for c in range(10):
        x0 = c * size // 10; img[:, x0:x0 + 1] = (0.05, 0.05, 0.05)
        img[:, x0 + 1:(c + 1) * size // 10] *= 1 + rng.normal(0, 0.12)
    return img * (1 + lk.noise(size, size, 0.06))
def setts(size=256):  # blue-brick paving with raised ribs (the beam-pushers' footholds), in rows
    img = np.zeros((size, size, 3), np.float32) + np.array([0.46, 0.42, 0.38])
    for r in range(8):
        y0 = r * size // 8; img[y0:y0 + 3] = (0.3, 0.28, 0.26)
        for c in range(4):
            x0 = c * size // 4 + (size // 8 if r % 2 else 0); img[y0 + 3:(r + 1) * size // 8, x0 % size:(x0 % size) + 2] = (0.3, 0.28, 0.26)
        img[y0 + 3:(r + 1) * size // 8] *= 1 + rng.normal(0, 0.07)
    return img * (1 + lk.noise(size, size, 0.06))
def digits_tex(text, size=128):
    """white numerals on a black cast plate with a raised white border"""
    F = {'0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
         '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
         '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111']}
    img = np.zeros((size, size, 3), np.float32) + 0.06
    img[:5] = img[-5:] = 0.9; img[:, :5] = img[:, -5:] = 0.9
    t = [c for c in text if c in F][:3]; n = len(t) or 1; cw = (size - 24) // (n * 4); px = cw
    x = (size - n * 4 * px + px) // 2; y = (size - 5 * px) // 2
    for ch in t:
        for r, row in enumerate(F[ch]):
            for c, bit in enumerate(row):
                if bit == '1': img[y + r * px:y + (r + 1) * px, x + c * px:x + (c + 1) * px] = 0.92
        x += 4 * px
    return img
def water_tex(size=128):
    img = np.zeros((size, size, 3), np.float32) + np.array([0.24, 0.32, 0.29])
    return img * (1 + lk.noise(size, size, 0.08, 2))
def foam_tex(size=128):
    img = np.zeros((size, size, 3), np.float32) + 0.9
    return img * (1 + lk.noise(size, size, 0.1, 1))

M = {}
def mats():
    M['brick'] = lk.mat('Brick', img=lk.image('brick', brick_tex((0.52, 0.29, 0.21))), rough=0.9, glow=0.18)
    M['wet'] = lk.mat('WetBrick', img=lk.image('wet', brick_tex((0.42, 0.25, 0.19), wet=True)), rough=0.6, glow=0.1)
    M['cope'] = lk.mat('Coping', img=lk.image('cope', copers()), rough=0.7, glow=0.35)
    M['white'] = lk.mat('WhitePaint', (0.9, 0.9, 0.87), rough=0.6, glow=0.25)
    M['black'] = lk.mat('BlackPaint', (0.05, 0.05, 0.055), rough=0.5, glow=0.05)
    M['timber'] = lk.mat('Timber', img=lk.image('timber', timber()), rough=0.8, glow=0.08)
    M['setts'] = lk.mat('Setts', img=lk.image('setts', setts()), rough=0.85, glow=0.45)
    M['water'] = lk.mat('Water', img=lk.image('water', water_tex()), rough=0.15, glow=0.12)
    M['foam'] = lk.mat('Foam', img=lk.image('foam', foam_tex()), rough=0.3, glow=0.35)
    M['red'] = lk.mat('RedPaint', (0.55, 0.08, 0.06), rough=0.5, glow=0.15)
    M['grass'] = lk.mat('Grass', (0.3, 0.42, 0.18), rough=0.95, glow=0.15)

def solid(name, poly, zb, zt, mat, uv=1.0, uvz=None):
    """a closed solid over a plan outline, its bottom at zb and its top at zt (a number, or one height per corner)"""
    if not isinstance(zt, (list, tuple)): zt = [zt] * len(poly)
    bm = bmesh.new()
    a = [bm.verts.new((x, y, zb)) for x, y in poly]; b = [bm.verts.new((x, y, z)) for (x, y), z in zip(poly, zt)]
    n = len(poly)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(b); bm.faces.new(list(reversed(a)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lk.finish(name, bm, mat, uv, uvz)
def rbox(name, x0, x1, y0, y1, z0, z1, mat, uv=1.0):
    return solid(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, mat, uv)
def beam(name, x, y0, y1, z, mat, t=0.26):
    return rbox(name, x - t / 2, x + t / 2, min(y0, y1), max(y0, y1), z - t / 2, z + t / 2, mat, 1.0)
def sector(cx, cy, r, a0, a1, n=10):
    return [(cx, cy)] + [(cx + r * math.cos(a0 + (a1 - a0) * k / n), cy + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]

def build(k):
    L, F = k['len'], k['fall']; tow = 1 if k.get('tow', 'left') == 'left' else -1
    RU = k.get('reach', {}).get('up', {}); RD = k.get('reach', {}).get('down', {})
    side = lambda s: 'left' if s > 0 else 'right'
    # a beam's length beyond the wall: as drawn, but reaching only about halfway across the nearest path on that side
    # (the owner 2026-11-21: in reality the beams reach about halfway across the towpath: end 0.9 m into the path, R = the path's near edge)
    blen = lambda R, s, want: max(0.4, min(want, R.get(side(s), 9) + 0.9 - (1.1 + 1.0)))
    # (paving, landings and wing walls stop 0.2 m short of a path's near edge: the owner 2026-11-21, "the brick quarter circle
    # corners encroach onto the path ... the bike rides through a brick wall")
    clear = lambda R, s, want, y0: max(0.3, min(want, R.get(side(s), 9) - 0.2 - y0))
    xu, xd = -L / 2, L / 2
    HW, WT = 1.1, 1.0                 # chamber half width (7 ft 2 in narrow lock); wall thickness behind it
    TOP = F + 0.45                    # coping top: 45 cm over the upper pound
    FLOOR = -1.7                      # chamber floor under the lower pound
    UBED = F - 1.5                    # the upper pound's bed: the cill under the top gate
    LOW = 0.5                         # the lower pound's bank top, at the tail
    # chamber walls, each side: wet brick to a little over the lower water, dry brick above, coping on top; white coping
    # for the first and last metre (the lock's ends painted, as on the flight)
    for s in (-1, 1):
        y0, y1 = sorted((s * HW, s * (HW + WT)))
        rbox('ChamberWet', xu - 0.6, xd + 0.6, y0, y1, FLOOR - 0.4, 0.35, M['wet'])
        rbox('Chamber', xu - 0.6, xd + 0.6, y0, y1, 0.35, TOP - 0.13, M['brick'])
        cy0, cy1 = sorted((s * (HW - 0.06), s * (HW + 0.42)))
        for xa, xb, m in ((xu - 0.6, xu + 0.9, 'white'), (xu + 0.9, xd - 0.9, 'cope'), (xd - 0.9, xd + 0.6, 'white')):
            rbox('Coping', xa, xb, cy0, cy1, TOP - 0.13, TOP, M[m], 0.9)
        # the bank behind the coping, paved for a metre then grass, standing down to meet the ground
        by0, by1 = sorted((s * (HW + 0.42), s * (HW + 0.42 + clear(RU, s, WT - 0.22, HW + 0.42))))
        rbox('Edge', xu - 0.6, xd + 0.6, by0, by1, TOP - 0.5, TOP - 0.07, M['setts'], 1.2)
    # the cill under the top gate (the step in the floor, seen when the chamber is down), and the head wall over it
    rbox('Cill', xu, xu + 0.55, -HW, HW, FLOOR - 0.4, UBED, M['wet'])
    # wing walls: splayed brick from the gates out to the pounds' banks, both ends, coping on top (the tail ones step down
    # to the lower bank)
    for s in (-1, 1):
        # head (upper pound): from the chamber mouth to 3.5 m upstream, out to 3.4 m
        ho = HW + WT + clear(RU, s, 4.4 - HW - WT, HW + WT); hi_ = min(3.4, ho - 0.5)
        hp = [(xu - 0.6, s * HW), (xu - 4.1, s * hi_), (xu - 4.1, s * ho), (xu - 0.6, s * (HW + WT))]
        solid('WingHead', hp if s > 0 else hp[::-1], UBED - 0.6, TOP - 0.13, M['brick'])
        cp = [(xu - 0.6, s * (HW - 0.06)), (xu - 4.1, s * (hi_ - 0.06)), (xu - 4.1, s * min(ho, hi_ + 0.46)), (xu - 0.6, s * (HW + 0.42))]
        solid('WingHeadCope', cp if s > 0 else cp[::-1], TOP - 0.13, TOP, M['cope'], 0.9)
        # tail (lower pound)
        to_ = HW + WT + clear(RD, s, 4.4 - HW - WT, HW + WT); ti_ = min(3.4, to_ - 0.5)
        tp = [(xd + 0.6, s * HW), (xd + 4.6, s * ti_), (xd + 4.6, s * to_), (xd + 0.6, s * (HW + WT))]
        zt = [TOP - 0.13, LOW + 0.2, LOW + 0.2, TOP - 0.13]
        solid('WingTail', tp if s > 0 else tp[::-1], FLOOR - 0.4, zt if s > 0 else zt[::-1], M['brick'])
        tc = [(xd + 0.6, s * (HW - 0.06)), (xd + 4.6, s * (ti_ - 0.06)), (xd + 4.6, s * min(to_, ti_ + 0.46)), (xd + 0.6, s * (HW + 0.42))]
        zc = [TOP, LOW + 0.33, LOW + 0.33, TOP]
        bm = bmesh.new()
        pts = tc if s > 0 else tc[::-1]; zz = zc if s > 0 else zc[::-1]
        a = [bm.verts.new((x, y, z - 0.13)) for (x, y), z in zip(pts, zz)]; b = [bm.verts.new((x, y, z)) for (x, y), z in zip(pts, zz)]
        for i in range(4): bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))
        bm.faces.new(b); bm.faces.new(list(reversed(a))); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('WingTailCope', bm, M['cope'], 0.9)
    # TOP GATE: one leaf across the chamber on its cill, its balance beam out over the towpath side
    rbox('TopGate', xu - 0.36, xu, -HW - 0.2, HW + 0.2, UBED - 0.1, TOP + 0.18, M['timber'], 1.2)
    rbox('TopGateCap', xu - 0.4, xu + 0.04, -HW - 0.22, HW + 0.22, TOP + 0.18, TOP + 0.26, M['black'])
    TB = blen(RU, tow, 3.6)
    beam('TopBeam', xu - 0.18, tow * (HW - 0.1), tow * (HW + WT + TB), TOP + 0.75, M['black'], 0.3)
    beam('TopBeamEnd', xu - 0.18, tow * (HW + WT + TB - 0.85), tow * (HW + WT + TB + 0.02), TOP + 0.75, M['white'], 0.32)
    rbox('TopBeamPost', xu - 0.3, xu - 0.06, tow * (HW - 0.05) - 0.12, tow * (HW - 0.05) + 0.12, TOP + 0.18, TOP + 0.62, M['black'])
    # its swing quadrant (the beam swings upstream to open)
    q = sector(xu - 0.18, tow * (HW + 0.3), clear(RU, tow, min(4.6, TB + 1.4), HW + 0.3), math.pi / 2 * tow, math.pi if tow > 0 else -math.pi, 12)
    solid('TopQuadrant', q if tow > 0 else q[::-1], TOP - 0.35, TOP - 0.06, M['setts'], 1.2)
    # gate paddles: rack posts on the leaf (black, white-tipped spindles)
    for yy in (-0.55, 0.55):
        rbox('Paddle', xu - 0.3, xu - 0.06, yy - 0.09, yy + 0.09, TOP + 0.26, TOP + 1.0, M['black'])
        rbox('PaddleTop', xu - 0.32, xu - 0.04, yy - 0.11, yy + 0.11, TOP + 1.0, TOP + 1.08, M['red'])
    # ground paddles beside the head, on both copings
    for s in (-1, 1):
        rbox('GroundPaddle', xu - 1.9, xu - 1.5, s * (HW + 0.15) - 0.17, s * (HW + 0.15) + 0.17, TOP, TOP + 0.62, M['black'])
        rbox('GroundPaddleTop', xu - 1.95, xu - 1.45, s * (HW + 0.15) - 0.2, s * (HW + 0.15) + 0.2, TOP + 0.62, TOP + 0.7, M['red'])
    # water leaking through the top gate into the chamber: white streaks down its downstream face to the water
    # (the chambers stand FULL, at the upper pound's level: the owner 2026-11-21; so the water leaks through the bottom gates,
    # in white streaks down their downstream faces into the lower pound)
    for yy in (-0.7, -0.2, 0.35, 0.8):
        rbox('Leak', xd + 0.12, xd + 0.18, yy - 0.05, yy + 0.05, 0.0, F * rng.uniform(0.45, 0.85), M['foam'])
    rbox('LeakFoam', xd + 0.15, xd + 1.3, -HW + 0.05, HW - 0.05, -0.02, 0.025, M['foam'])
    # BOTTOM GATES: a mitred pair meeting upstream, each with a beam out over its bank, a footboard and handrail
    for s in (-1, 1):
        hx, hy, mx, my = xd, s * (HW + 0.15), xd - 0.42, 0.0
        cxm, cym = (hx + mx) / 2, (hy + my) / 2; ln = math.hypot(hx - mx, hy - my); ang = math.atan2(hy - my, hx - mx)
        lk.box('BottomGate', cxm, cym, FLOOR - 0.2, ln + 0.08, 0.3, TOP + 0.15 - FLOOR + 0.2, M['timber'], rot=ang, uv=1.2)
        lk.box('BottomGateCap', cxm, cym, TOP + 0.15, ln + 0.1, 0.34, 0.08, M['black'], rot=ang)
        # footboard on the downstream face and a handrail on posts
        ox, oy = math.cos(ang + math.pi / 2), math.sin(ang + math.pi / 2)
        sgn = 1 if ox > 0 else -1; fx, fy = cxm + ox * sgn * 0.32, cym + oy * sgn * 0.32
        lk.box('Footboard', fx, fy, TOP - 0.05, ln, 0.3, 0.07, M['timber'], rot=ang)
        rx, ry = cxm + ox * sgn * 0.45, cym + oy * sgn * 0.45
        lk.box('Handrail', rx, ry, TOP + 0.95, ln, 0.06, 0.06, M['white'], rot=ang)
        for t in (-0.42, 0.42):
            lk.box('HandrailPost', rx + math.cos(ang) * t * ln, ry + math.sin(ang) * t * ln, TOP - 0.02, 0.06, 0.06, 0.98, M['white'])
        # beam: from over the heel post out across the bank, at waist height
        BB = blen(RD, s, 2.4)
        beam('BottomBeam', xd + 0.18, s * (HW - 0.2), s * (HW + WT + BB), TOP + 0.85, M['black'], 0.28)
        beam('BottomBeamEnd', xd + 0.18, s * (HW + WT + BB - 0.8), s * (HW + WT + BB + 0.02), TOP + 0.85, M['white'], 0.3)
        rbox('BottomBeamPost', xd + 0.06, xd + 0.3, s * (HW + 0.05) - 0.12, s * (HW + 0.05) + 0.12, TOP + 0.15, TOP + 0.72, M['black'])
        # gate paddle on each leaf
        px, py = cxm - math.cos(ang) * 0.1, cym - math.sin(ang) * 0.1
        rbox('Paddle', px - 0.09, px + 0.09, py - 0.09, py + 0.09, TOP + 0.23, TOP + 0.95, M['black'])
        rbox('PaddleTop', px - 0.11, px + 0.11, py - 0.11, py + 0.11, TOP + 0.95, TOP + 1.03, M['red'])
        # quadrant (the bottom beams swing downstream)
        # (the bank falls away past the tail, so these stand as raised brick landings, paved on top)
        q = sector(xd + 0.18, s * (HW + 0.3), clear(RD, s, min(3.1, BB + 1.3), HW + 0.3), 0.0, s * math.pi / 2, 12)
        solid('BottomLanding', q if s > 0 else q[::-1], LOW - 0.8, TOP - 0.12, M['brick'], 1.0)
        solid('BottomQuadrant', q if s > 0 else q[::-1], TOP - 0.12, TOP - 0.05, M['setts'], 1.2)
        # bollards: cast iron, black with a white band, on the coping near both ends
        for bx in (xu - 2.6, xd + 1.6):
            lk.cyl('Bollard', bx, s * (HW + 0.32), TOP - 0.02, 0.13, 0.5, M['black'], seg=12)
            lk.cyl('BollardBand', bx, s * (HW + 0.32), TOP + 0.3, 0.135, 0.08, M['white'], seg=12)
    # the by-weir on the offside: the upper pound spills over a brick crest at the head into a grated culvert, and comes out
    # of an arch in the tail wing wall into the lower pound, foaming
    o = -tow
    wy0, wy1 = sorted((o * (HW + WT + 0.15), o * (HW + WT + 1.35)))
    rbox('WeirWalls', xu - 3.0, xu - 0.9, wy0 - 0.25, wy1 + 0.25, UBED, F + 0.05, M['brick'])
    rbox('WeirCrest', xu - 3.0, xu - 2.6, wy0, wy1, F + 0.05, F + 0.12, M['cope'])
    rbox('WeirSpill', xu - 2.6, xu - 2.5, wy0 + 0.05, wy1 - 0.05, F - 0.55, F + 0.08, M['foam'])
    rbox('WeirGrate', xu - 2.5, xu - 0.95, wy0 + 0.05, wy1 - 0.05, F - 0.62, F - 0.55, M['black'])
    rbox('WeirWater', xu - 4.2, xu - 3.0, wy0, wy1, F - 0.3, F + 0.02, M['water'])
    oy = o * 2.9
    rbox('OutfallArch', xd + 2.2, xd + 3.1, oy - 0.45, oy + 0.45, 0.0, 0.62, M['black'])
    rbox('OutfallFoam', xd + 1.9, xd + 3.6, oy - 1.0 if o < 0 else oy - 0.2, oy + 0.2 if o < 0 else oy + 1.0, -0.02, 0.03, M['foam'])
    # the lock's number on a cast plate on a short post by the tail, towpath side
    nm = lk.mat('Plate' + k['ref'], img=lk.image('plate' + k['ref'], digits_tex(k['ref'])), rough=0.5, glow=0.3)
    py = tow * (HW + WT + 0.9)
    rbox('PlatePost', xd + 2.0, xd + 2.12, py - 0.06, py + 0.06, LOW - 0.6, LOW + 1.0, M['black'])
    rbox('Plate', xd + 1.95, xd + 2.17, py - 0.28, py + 0.28, LOW + 1.0, LOW + 1.5, nm, 0.56)

def bridge(b):
    """a brick canal bridge under the drawn road: solid masonry across the canal from bank to bank, its top 32 cm under the
    road's own deck heights (b['deck']: [v across, z over the pound, u along]), an arch over the water and, where it's high
    enough, over the towpath too; a ring of darker header bricks on both faces; brick parapets with blue coping on the
    road's edges (the world's own parapet walls stand hidden inside them). X along the canal, Y across (left), z = 0 at
    the pound's water."""
    D = b['deck']; W = b['road'] + 1.0
    def zd(v):
        if v <= D[0][0]: return D[0][1]
        for (v0, z0, _), (v1, z1, _) in zip(D, D[1:]):
            if v <= v1: return z0 + (z1 - z0) * (v - v0) / ((v1 - v0) or 1)
        return D[-1][1]
    def uc(v):
        if v <= D[0][0]: return D[0][2]
        for (v0, _, u0), (v1, _, u1) in zip(D, D[1:]):
            if v <= v1: return u0 + (u1 - u0) * (v - v0) / ((v1 - v0) or 1)
        return D[-1][2]
    tow, to = b['tow'], b['towOff']
    # (the masonry stops just past the arch on the towpath side, so the path up to the lane beside the bridge stays clear;
    # the owner 2026-11-21: "really messy to go under the bridge")
    reach_t = min(to, 4.5) + 3.6 + 0.8
    vmin, vmax = (max(D[0][0], -6.0), min(D[-1][0], reach_t)) if tow > 0 else (max(D[0][0], -reach_t), min(D[-1][0], 6.0))
    # the opening: over the water (2.3 m each side) and over the towpath when there's 2.2 m of headroom above it
    # (the owner 2026-11-21: nowhere on the flight does the towpath leave the canal, so every arch spans the towpath too)
    over = min(to, 4.5) + 3.6   # (OSM's towpath passes 3.5-6.3 m out from the canal's middle: the opening covers it all, 2026-11-22)
    o0, o1 = (-2.3, over) if tow > 0 else (-over, 2.3)
    mid, hs = (o0 + o1) / 2, (o1 - o0) / 2
    crown = min(zd(v) for v in np.linspace(o0, o1, 12)) - 0.32 - 0.45; SPR = 0.2; rise = max(0.8, crown - SPR)
    arch = lambda v: SPR + rise * max(0.0, 1 - abs((v - mid) / hs) ** 4) ** (1 / 4)  # (boxy: full headroom over the towpath)
    BR = lk.mat('BridgeBrick', img=lk.image('bbrick', brick_tex((0.55, 0.3, 0.2))), rough=0.9, glow=0.2)
    HD = lk.mat('Headers', img=lk.image('hdr', brick_tex((0.38, 0.2, 0.15))), rough=0.9, glow=0.18)
    CP = lk.mat('BridgeCope', img=lk.image('bcope', copers()), rough=0.7, glow=0.35)
    step = 0.3; vs = list(np.arange(vmin, vmax + 1e-6, step))
    for v0, v1 in zip(vs, vs[1:]):
        vm = (v0 + v1) / 2; inside = o0 < vm < o1
        top0, top1 = zd(v0) - 0.32, zd(v1) - 0.32
        bot0, bot1 = (arch(v0), arch(v1)) if inside else (-1.6, -1.6)
        if inside and (v0 <= o0 or v1 >= o1): bot0, bot1 = -1.6, -1.6
        u0, u1 = uc(v0), uc(v1)
        # the masonry column (a skewed slab following the road), then the face rings and parapets
        bm = bmesh.new()
        def ring(v, u, zb, zt): return [bm.verts.new((u - W / 2, v, zb)), bm.verts.new((u + W / 2, v, zb)), bm.verts.new((u + W / 2, v, zt)), bm.verts.new((u - W / 2, v, zt))]
        a = ring(v0, u0, bot0, top0); c = ring(v1, u1, bot1, top1)
        for i in range(4): bm.faces.new((a[i], a[(i + 1) % 4], c[(i + 1) % 4], c[i]))
        bm.faces.new(a[::-1]); bm.faces.new(c); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('Masonry', bm, BR, 1.0)
        for sd in (-1, 1):
            if inside and not (v0 <= o0 or v1 >= o1):
                bm = bmesh.new()
                def q(v, u, zb, zt): x = u + sd * (W / 2 + 0.03); return [bm.verts.new((x - 0.04, v, zb)), bm.verts.new((x + 0.04, v, zb)), bm.verts.new((x + 0.04, v, zt)), bm.verts.new((x - 0.04, v, zt))]
                a = q(v0, u0, bot0, bot0 + 0.45); c = q(v1, u1, bot1, bot1 + 0.45)
                for i in range(4): bm.faces.new((a[i], a[(i + 1) % 4], c[(i + 1) % 4], c[i]))
                bm.faces.new(a[::-1]); bm.faces.new(c); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('ArchRing', bm, HD, 1.0)
            # parapet: 35 cm brick, 1 m over the road, blue coping
            for (zb, zt, m, wdt) in ((zd(v0) - 0.32, zd(v0) + 0.92, BR, 0.35), (zd(v0) + 0.92, zd(v0) + 1.04, CP, 0.42)):
                bm = bmesh.new()
                def p(v, u, zb2, zt2): x0 = u + sd * (W / 2 - wdt + 0.03); x1 = u + sd * (W / 2 + 0.03); xa, xb = min(x0, x1), max(x0, x1); return [bm.verts.new((xa, v, zb2)), bm.verts.new((xb, v, zb2)), bm.verts.new((xb, v, zt2)), bm.verts.new((xa, v, zt2))]
                dz = zd(v1) - zd(v0)
                a = p(v0, u0, zb, zt); c = p(v1, u1, zb + dz, zt + dz)
                for i in range(4): bm.faces.new((a[i], a[(i + 1) % 4], c[(i + 1) % 4], c[i]))
                bm.faces.new(a[::-1]); bm.faces.new(c); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('Parapet', bm, m, 1.0)

mats_done = False
BSPEC = json.load(open(os.environ['BRIDGES'])) if os.environ.get('BRIDGES') else []
for b in BSPEC:
    lk.start(); M.clear(); mats()
    bridge(b)
    lk.export(os.path.join(OUTDIR, f"bridge-{b['n']}.glb"), 'Bridge' + str(b['n']))
    if PNG and os.environ.get('VIEW') == 'bridge' and b is BSPEC[0]:
        lk.preview(PNG, (16, -4, 4), (0, 0, 1.5), lens=24, ground_z=0.0)
if os.environ.get('ONLY') == 'bridges': SPEC = []
for k in SPEC:
    lk.start(); M.clear(); mats()
    build(k)
    out = os.path.join(OUTDIR, f"lock-{k['ref']}.glb")
    lk.export(out, 'Lock' + k['ref'])
    if PNG and k is SPEC[0]:
        L, F = k['len'], k['fall']; v = os.environ.get('VIEW', 'head')
        cam, tgt = {'head': ((-L / 2 - 9, 7, F + 5), (-L / 2 + 1, 0, F - 0.5)), 'tail': ((L / 2 + 10, -6, 4.5), (L / 2 - 1, 0, 0.5)), 'side': ((0, 16, F + 7), (0, 0, F * 0.4))}[v]
        lk.preview(PNG, cam, tgt, lens=24, ground_z=float(os.environ.get('GZ', '-2.2')))
