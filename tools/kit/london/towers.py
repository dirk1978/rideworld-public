# London towers for RideWorld's London open world (2026-11-17), one script, one model per name:
#   /snap/bin/blender -b --python tools/kit/london/towers.py -- <name> <out.glb> [preview.png]
#   names: shard, gherkin, bt_tower, monument, nelson
# Origin = the centre of the base at ground level, X east, Y north, Z up (see lk.py).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lk
import numpy as np
from mathutils import Matrix

A = lk.args(); NAME, OUT = A[0], A[1]; PNG = A[2] if len(A) > 2 else None
lk.start()
PORTLAND = np.array((0.86, 0.84, 0.78))
GILT = lk.mat('Gilt', (0.83, 0.66, 0.26), rough=0.35, metal=0.7, glow=0.35)

def shard():
    """The Shard, 310 m: eight sloping glass facets on an irregular plan that lean in but never meet; at the top they
    splinter past each other into open shards"""
    G = lk.mat('Glass', img=lk.image('glass', lk.glass((0.55, 0.64, 0.72), floors=6, mullions=10, band=(0.42, 0.48, 0.55), sky=0.3)), rough=0.15, metal=0.5, glow=0.25)
    base = [(28, 0), (22, 20), (2, 27), (-20, 22), (-27, 2), (-22, -19), (0, -26), (21, -21)]  # roughly as built (N up)
    tops = [306, 309.6, 303, 307.5, 304, 308.5, 302.5, 305.5]
    for i in range(8):
        a, b = base[i], base[(i + 1) % 8]
        # each facet is its own plane leaning in to ~14% of the base at 300 m, pushed out a little so they overlap at
        # the corners (the gaps between facets are the Shard's look)
        k0, k1 = 1.0, 0.14
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2; L = math.hypot(mx, my); nx, ny = mx / L, my / L
        def at(p, k, z, push=0.0): return (p[0] * k + nx * push, p[1] * k + ny * push, z)
        top = tops[i]; kt = k0 + (k1 - k0) * top / 300
        pts = [at(a, k0, 0, 0.6), at(b, k0, 0, 0.6), at(b, kt, top, 0.6), at(a, kt, top, 0.6)]
        lk.quad('Facet', pts, G, uvs=((0, 0), (math.hypot(b[0] - a[0], b[1] - a[1]) / 12, 0), (math.hypot(b[0] - a[0], b[1] - a[1]) * kt / 12, top / 12), (0, top / 12)))
    # the core inside (seen through the gaps), dark, to just under the tops
    lk.taper('Core', [(p[0] * 0.92, p[1] * 0.92) for p in base], 0, [(p[0] * 0.12, p[1] * 0.12) for p in base], 300, lk.mat('Core', (0.1, 0.12, 0.15), glow=0.05))

def gherkin():
    """30 St Mary Axe, 180 m: a bullet of diamond glazing with six dark spirals, widest ~1/3 up, a glass cap"""
    S = 512; img = np.zeros((S, S, 3), np.float32)
    yy, xx = np.mgrid[0:S, 0:S] / S
    light = np.array((0.58, 0.68, 0.74)); dark = np.array((0.1, 0.16, 0.22))
    spiral = ((xx * 6 + yy * 2.2) % 1) < 0.33  # six bands climbing round as they rise (u wraps once round)
    img[:] = light; img[spiral] = dark
    diam = (np.abs(((xx * 36 + yy * 18) % 1) - 0.5) < 0.04) | (np.abs(((xx * 36 - yy * 18) % 1) - 0.5) < 0.04)
    img[diam] = (0.75, 0.78, 0.8)
    img *= (1 + lk.noise(S, S, 0.04, 2))
    G = lk.mat('Gherkin', img=lk.image('gherkin', img), rough=0.2, metal=0.45, glow=0.25)
    prof = []
    for k in range(41):
        z = 180 * k / 40
        r = 24.5 + 3.5 * math.sin(min(1, z / 65) * math.pi / 2) if z <= 65 else 28 * math.sqrt(max(0, 1 - ((z - 65) / 115) ** 2.2))
        prof.append((max(r, 0.0), z))
    lk.lathe('Body', prof[:-1] + [(3.0, 178.5)], G, seg=64, u_rep=1, v_len=180)
    lk.dome('Cap', 0, 0, 178.5, 3.0, 1.6, lk.mat('CapGlass', (0.3, 0.4, 0.5), rough=0.1, metal=0.4))

def bt_tower():
    """BT Tower, 177 m (191 m with the mast): a slim cylinder, a band of open aerial galleries and a drum near the top"""
    con = lk.mat('Concrete', img=lk.image('btc', lk.glass((0.62, 0.66, 0.68), floors=12, mullions=24, band=(0.82, 0.83, 0.82), sky=0.12)), rough=0.4, metal=0.2, glow=0.25)
    white = lk.mat('White', (0.88, 0.88, 0.86), glow=0.25); dark = lk.mat('Dark', (0.12, 0.13, 0.15), glow=0.05)
    lk.cyl('Base', 0, 0, 0, 9.5, 12, white, seg=32)
    lk.cyl('Shaft', 0, 0, 12, 7.8, 98, con, seg=32)
    z = 110
    for k in range(4):  # the aerial galleries: open decks with dishes behind railings
        lk.cyl('Gallery', 0, 0, z, 10.5, 1.0, white, seg=32); lk.cyl('GalleryCore', 0, 0, z + 1, 6.8, 4.5, dark, seg=24)
        for i in range(10): a = 2 * math.pi * i / 10; lk.cyl('Dish', 8.6 * math.cos(a), 8.6 * math.sin(a), z + 1.5, 1.2, 2.6, white, seg=10)
        z += 6
    lk.cyl('Shaft2', 0, 0, z, 7.8, 10, con, seg=32); z += 10
    lk.cyl('Drum', 0, 0, z, 9.2, 14, lk.mat('Drum', img=lk.image('drum', lk.glass((0.25, 0.3, 0.36), floors=4, mullions=30, band=(0.8, 0.8, 0.8), sky=0.2)), rough=0.2, metal=0.3), seg=32); z += 14
    lk.cyl('Top', 0, 0, z, 6.5, 12, white, seg=24); z += 12
    lk.cyl('Mast', 0, 0, z, 1.2, 14, white, seg=12, r2=0.4)
    for zz in (126, 152):  # the LED ticker band round the top
        lk.cyl('Ticker', 0, 0, zz, 8.0, 1.2, lk.mat('Ticker', (0.15, 0.45, 0.9), glow=1.0), seg=32)

def monument():
    """The Monument to the Great Fire, 62 m: a fluted Doric column of Portland stone on a carved pedestal, a caged
    viewing gallery and the gilt flaming urn"""
    S = 512; img = lk.ashlar(PORTLAND, S, rows=10, cols=1, mortar=0.94)
    for k in range(24): x = k * S // 24; img[:, x:x + 8] *= 0.82  # flutes
    stone = lk.mat('Portland', img=lk.image('flutes', img), glow=0.25)
    plain = lk.mat('PortlandPlain', img=lk.image('ash', lk.ashlar(PORTLAND)), glow=0.25)
    lk.box('Step', 0, 0, 0, 13, 13, 1.2, plain); lk.box('Pedestal', 0, 0, 1.2, 9.2, 9.2, 10.8, plain)
    lk.box('PedCap', 0, 0, 12, 10.2, 10.2, 1.0, plain)
    lk.lathe('Column', [(2.9, 13), (2.9, 15), (2.6, 46), (2.5, 50)], stone, seg=48, u_rep=1, v_len=37)
    lk.box('Capital', 0, 0, 50, 6.4, 6.4, 1.2, plain)
    lk.cyl('Cage', 0, 0, 51.2, 2.6, 3.0, lk.mat('Cage', (0.1, 0.1, 0.1), glow=0.05), seg=24)
    lk.cyl('Drum', 0, 0, 54.2, 1.5, 2.2, plain, seg=24)
    # the gilt urn of flames: a bulb with spiky tongues
    lk.lathe('Urn', [(0.8, 56.4), (1.4, 57.4), (1.2, 58.6), (0.5, 59.2)], GILT, seg=24)
    for i in range(14):
        a = 2 * math.pi * i / 14; r = 0.9
        lk.cyl('Flame', r * math.cos(a), r * math.sin(a), 59.0, 0.35, 2.4 + (i % 3) * 0.5, GILT, seg=6, r2=0.0)
    lk.cyl('FlameTop', 0, 0, 59.2, 0.6, 2.8, GILT, seg=8, r2=0.0)

def nelson():
    """Nelson's Column, 52 m: granite pedestal with bronze reliefs, a fluted Corinthian column, bronze capital and
    Nelson; four bronze lions on plinths at the base"""
    gran = lk.mat('Granite', img=lk.image('gr', lk.ashlar((0.62, 0.6, 0.58), rows=6, cols=2)), glow=0.25)
    S = 512; img = lk.ashlar((0.72, 0.7, 0.66), S, rows=8, cols=1, mortar=0.95)
    for k in range(20): x = k * S // 20; img[:, x:x + 8] *= 0.82
    col = lk.mat('Column', img=lk.image('fl', img), glow=0.25)
    bronze = lk.mat('Bronze', (0.24, 0.2, 0.14), rough=0.45, metal=0.6, glow=0.15)
    lk.box('Steps', 0, 0, 0, 21, 21, 1.5, gran); lk.box('Steps2', 0, 0, 1.5, 17, 17, 1.0, gran)
    lk.box('Pedestal', 0, 0, 2.5, 9, 9, 9.5, gran); lk.box('PedCap', 0, 0, 12, 10, 10, 1.0, gran)
    for nx, ny in ((0, 1), (0, -1), (1, 0), (-1, 0)):  # bronze reliefs on each face
        lk.box('Relief', nx * 4.55, ny * 4.55, 5.0, 6.0 if ny else 0.1, 0.1 if ny else 6.0, 4.5, bronze)
    lk.lathe('Shaft', [(1.9, 13), (1.9, 15), (1.7, 42)], col, seg=40, u_rep=1, v_len=29)
    lk.lathe('Capital', [(1.7, 42), (2.6, 44.5), (3.0, 45.2)], bronze, seg=32)
    lk.box('Abacus', 0, 0, 45.2, 5.6, 5.6, 0.8, bronze); lk.cyl('Drum', 0, 0, 46, 1.6, 0.9, bronze)
    # Nelson: a cloaked figure, a cocked hat
    lk.lathe('Nelson', [(0.75, 46.9), (0.7, 48.5), (0.55, 49.8), (0.32, 50.3), (0.28, 50.8), (0.0, 51.0)], lk.mat('Stone', (0.66, 0.63, 0.58), glow=0.25), seg=16)
    lk.box('Hat', 0, 0, 50.75, 0.9, 0.3, 0.25, lk.mat('Stone2', (0.6, 0.57, 0.52), glow=0.25))
    for nx, ny in ((1, 1), (1, -1), (-1, 1), (-1, -1)):  # Landseer's lions, lying down, facing out from the column
        x, y = nx * 9.0, ny * 9.0; ang = math.atan2(ny, nx)
        lk.box('LionPlinth', x, y, 2.5, 3.2, 7.4, 2.0, gran, rot=ang - math.pi / 2)
        lion(x, y, 4.5, ang, bronze)

def lion(x, y, z, ang, m):
    """a couchant lion (Landseer's): a long body with haunches, a raised maned head, forepaws stretched out in front;
    built along +X then turned to `ang` (radians from east) and moved to (x, y, z)"""
    M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Scale(1.35, 4)
    def part(name, prof, at, rot=(0, 0, 0), scale=(1, 1, 1)):
        o = lk.lathe(name, prof, m, seg=14, cap_top=True, cap_bottom=True)
        S = Matrix.Diagonal((*scale, 1))
        R = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[2], 4, 'Z')
        lk.xform(o, M @ Matrix.Translation(at) @ R @ S)
    # body: a turned shape lying along X (haunches at the back, chest at the front)
    part('LionBody', [(0.0, -2.1), (0.55, -1.9), (0.78, -1.3), (0.72, -0.2), (0.8, 0.8), (0.7, 1.4), (0.0, 1.7)], (0, 0, 0.75), rot=(0, math.pi / 2, 0), scale=(1, 1.15, 1))
    part('LionMane', [(0.0, -0.6), (0.75, -0.45), (0.92, 0.0), (0.75, 0.5), (0.0, 0.7)], (1.55, 0, 1.45), rot=(0, math.pi / 2 - 0.3, 0))
    part('LionHead', [(0.0, -0.1), (0.42, 0.0), (0.46, 0.35), (0.3, 0.7), (0.0, 0.8)], (1.75, 0, 1.6), rot=(0, math.pi / 2, 0))
    for s in (-1, 1):
        part('LionPaw', [(0.0, -0.9), (0.22, -0.8), (0.24, 0.6), (0.18, 0.9), (0.0, 1.0)], (2.1, s * 0.38, 0.22), rot=(0, math.pi / 2, 0))
        part('LionHaunch', [(0.0, -0.5), (0.45, -0.3), (0.5, 0.2), (0.0, 0.5)], (-1.2, s * 0.62, 0.65), rot=(0, math.pi / 2, 0))
    part('LionTail', [(0.12, 0.0), (0.1, 1.6), (0.0, 1.7)], (-2.0, 0.6, 0.18), rot=(0, math.pi / 2, 0.6))

{'shard': shard, 'gherkin': gherkin, 'bt_tower': bt_tower, 'monument': monument, 'nelson': nelson}[NAME]()
lk.export(OUT, NAME)
CAM = {'shard': ((260, -330, 120), (0, 0, 150), 35), 'gherkin': ((150, -200, 60), (0, 0, 90), 35), 'bt_tower': ((140, -190, 60), (0, 0, 100), 35),
       'monument': ((40, -55, 20), (0, 0, 32), 35), 'nelson': ((16, -20, 9), (9, -9, 5), 35)}[NAME]
if PNG: lk.preview(PNG, CAM[0], CAM[1], lens=CAM[2])
