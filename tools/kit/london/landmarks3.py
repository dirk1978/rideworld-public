# More London landmarks for RideWorld's London open world (2026-11-17), one model per name:
#   /snap/bin/blender -b --python tools/kit/london/landmarks3.py -- <name> <out.glb> [preview.png]
#   names: white_tower, albert_hall, abbey, buckingham, victoria_memorial, admiralty_arch, wellington_arch,
#          walkie_talkie, st_pancras
# Origin = the landmark's ground point, X east, Y north, Z up (see lk.py). Fronts face -Y (south) unless noted; the
# placement's heading turns them to the real direction.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lk
import numpy as np
from mathutils import Matrix

A = lk.args(); NAME, OUT = A[0], A[1]; PNG = A[2] if len(A) > 2 else None
lk.start()
PORTLAND = np.array((0.86, 0.84, 0.78)); KENTISH = np.array((0.78, 0.76, 0.7)); BATH = np.array((0.83, 0.76, 0.6))
GILT = lk.mat('Gilt', (0.83, 0.66, 0.26), rough=0.35, metal=0.7, glow=0.35)
LEAD = lk.mat('Lead', (0.38, 0.41, 0.44), rough=0.55, metal=0.2, glow=0.2)

def white_tower():
    """The White Tower, Tower of London: a 36 x 32 m Norman keep, 27 m to the battlements, pale Kentish ragstone with
    Caen stone dressings, small round-headed windows, flat buttresses, four corner turrets (one round) with lead
    ogee cupolas and gilt weathervanes"""
    w = lk.windows(lk.ashlar(KENTISH, rows=14, cols=3, jitter=0.07), glass=(0.12, 0.12, 0.13), nx=3, ny=2, w=0.12, h=0.3, arched=True, frame=KENTISH * 1.12)
    WALL = lk.mat('Keep', img=lk.image('keep', w), glow=0.25)
    ST = lk.mat('Stone', img=lk.image('st', lk.ashlar(KENTISH, rows=10, cols=3, jitter=0.07)), glow=0.25)
    lk.box('Keep', 0, 0, 0, 36, 32, 27, WALL, uv=12, uvz=13.5)
    for k in range(-2, 3):  # flat buttresses
        lk.box('ButtressS', k * 7.5, -16.2, 0, 1.6, 0.6, 27, ST, uv=2); lk.box('ButtressN', k * 7.5, 16.2, 0, 1.6, 0.6, 27, ST, uv=2)
    for i in range(18):  # battlements
        x = -17 + i * 2
        for y in (-15.6, 15.6): lk.box('Merlon', x, y, 27, 1.1, 0.8, 1.4, ST, uv=1)
    for i in range(16):
        y = -15 + i * 2
        for x in (-17.6, 17.6): lk.box('Merlon', x, y, 27, 0.8, 1.1, 1.4, ST, uv=1)
    for sx, sy, rnd in ((-1, -1, False), (1, -1, False), (-1, 1, False), (1, 1, True)):
        x, y = sx * 17.5, sy * 15.5
        if rnd: lk.cyl('TurretR', x, y, 0, 4.5, 33, ST, seg=16)
        else: lk.box('Turret', x, y, 0, 6.5, 6.5, 33, ST, uv=3)
        lk.lathe('Cupola', [(3.4, 33), (3.6, 34.5), (2.6, 36.5), (0.9, 38.5), (0.3, 40)], LEAD, seg=16, cx=x, cy=y)
        lk.cyl('Vane', x, y, 40, 0.08, 2.4, GILT, seg=4); lk.box('VaneFlag', x + 0.5, y, 41.6, 1.0, 0.05, 0.6, GILT)
    lk.taper('Roof', lk.rect(0, 0, 33, 29), 27, lk.rect(0, 0, 30, 4), 29.5, LEAD)

def albert_hall():
    """Royal Albert Hall: an elliptical drum (83 x 72 m) of red brick with terracotta bands, the mosaic frieze under the
    cornice, a shallow glass-and-iron dome, and the north porch. Origin = the centre."""
    S = 512; img = lk.brick((0.6, 0.32, 0.24), S, rows=24, cols=6)
    for y0 in (90, 300): img[y0:y0 + 18] = (0.78, 0.6, 0.45)  # terracotta bands
    img[20:70] = (0.55, 0.42, 0.3); img[30:60, ::40] = (0.85, 0.75, 0.5)  # the frieze
    w = lk.windows(img, glass=(0.15, 0.15, 0.17), nx=6, ny=2, w=0.35, h=0.32, arched=True, frame=(0.8, 0.62, 0.46))
    W = lk.mat('Brick', img=lk.image('rah', w), glow=0.25)
    prof = [(1.0, 0), (1.0, 26)]
    o = lk.lathe('Drum', [(r * 39.0, z) for r, z in prof], W, seg=64, u_rep=10, v_len=26)
    lk.xform(o, Matrix.Scale(83 / 78, 4, (1, 0, 0)))
    o = lk.lathe('Cornice', [(39.6, 26), (39.6, 27.4)], lk.mat('Terra', (0.8, 0.62, 0.46), glow=0.25), seg=64); lk.xform(o, Matrix.Scale(83 / 78, 4, (1, 0, 0)))
    dome_img = np.ones((512, 512, 3), np.float32) * np.array((0.55, 0.6, 0.62))
    for k in range(32): dome_img[:, k * 16:k * 16 + 3] = (0.28, 0.3, 0.32)
    for k in range(8): dome_img[k * 64:k * 64 + 3] = (0.28, 0.3, 0.32)
    o = lk.dome('Dome', 0, 0, 27.4, 39.0, 14.0, lk.mat('Glass', img=lk.image('rd', dome_img), rough=0.25, metal=0.35, glow=0.25), seg=64, rings=10, r_top=4.0)
    lk.xform(o, Matrix.Scale(83 / 78, 4, (1, 0, 0)))
    lk.cyl('Lantern', 0, 0, 41.2, 4.2, 2.6, lk.mat('Iron', (0.3, 0.32, 0.34), glow=0.15), seg=16)
    lk.box('Porch', 0, 38, 0, 22, 12, 16, W, uv=10, uvz=13)
    lk.taper('PorchPediment', [(-11, 32), (11, 32), (11, 44), (-11, 44)], 16, lk.rect(0, 38, 22, 2), 20, lk.mat('Terra2', (0.78, 0.6, 0.45), glow=0.25))

def abbey():
    """Westminster Abbey: origin = the west door; the nave runs east along +X. Hawksmoor's twin west towers (69 m) with
    pinnacles, the tall Gothic nave with flying-buttress walls, the north transept front, Kentish / Portland stone."""
    G = lk.mat('Gothic', img=lk.image('g', lk.gothic_windows(BATH * 0.95, panels=3)), glow=0.25)
    ST = lk.mat('Stone', img=lk.image('st', lk.ashlar(BATH * 0.95)), glow=0.25)
    lk.box('Nave', 52, 0, 0, 104, 22, 31, G, uv=7, uvz=15.5)
    lk.box('Aisles', 52, 0, 0, 104, 36, 15, G, uv=7, uvz=15)
    lk.taper('NaveRoof', lk.rect(52, 0, 104, 22), 31, lk.rect(52, 0, 104, 1), 40, LEAD)
    lk.box('Transept', 70, 0, 0, 24, 66, 31, G, uv=7, uvz=15.5)
    lk.taper('TransRoof', lk.rect(70, 0, 24, 66), 31, lk.rect(70, 0, 1, 66), 40, LEAD)
    for k in range(9):  # flying buttresses along both sides
        x = 10 + k * 11
        for s in (-1, 1): lk.tube('Flyer', (x, s * 19, 14), (x, s * 11.5, 27), 0.6, ST, seg=4); lk.box('Pier', x, s * 19, 0, 1.6, 1.6, 18, ST, uv=2)
    for s in (-1, 1):  # the west towers
        y = s * 9.5
        lk.box('WestTower', 2, y, 0, 10, 9, 54, G, uv=5, uvz=12)
        lk.box('Belfry', 2, y, 54, 9, 8, 8, G, uv=4.5, uvz=8)
        for sx in (-1, 1):
            for sy in (-1, 1):
                x0, y0 = 2 + sx * 4.3, y + sy * 3.8
                lk.cyl('Pinnacle', x0, y0, 54, 0.9, 10, ST, seg=8); lk.cyl('PinTop', x0, y0, 64, 1.0, 5, ST, seg=8, r2=0.1)
    lk.box('WestFront', 2, 0, 0, 6, 10, 36, G, uv=5, uvz=12)
    lk.taper('WestGable', [(0, -5), (4, -5), (4, 5), (0, 5)], 36, [(2, 0)], 42, ST, cap=False)
    lk.cyl('RoseWindow', 70, 33.2, 18, 5.5, 0.4, lk.mat('Rose', (0.25, 0.22, 0.3), glow=0.3), seg=24)

def buckingham():
    """Buckingham Palace, the east front (the one on the Mall): 108 m of Portland stone (Aston Webb, 1913), a rusticated
    ground floor, giant pilasters, three floors of windows, a balustrade, the central pediment over the balcony, and
    the Royal Standard. Origin = the middle of the front at ground level, the front facing -Y (east in reality: the
    placement turns it); the body runs back 110 m (the rest is the generated building)."""
    S = 512; base = lk.ashlar(PORTLAND, S, rows=12, cols=3)
    w = lk.windows(base, glass=(0.14, 0.15, 0.17), nx=4, ny=3, w=0.36, h=0.55, frame=PORTLAND * 1.05, sill=PORTLAND * 1.1)
    for k in range(4): w[:, k * 128 + 2:k * 128 + 14] *= 1.08  # pilasters between the bays
    W = lk.mat('Front', img=lk.image('bp', w), glow=0.25)
    ST = lk.mat('Stone', img=lk.image('st', lk.ashlar(PORTLAND)), glow=0.25)
    lk.box('Front', 0, 20, 0, 108, 40, 24, W, uv=14, uvz=24)
    lk.box('Wings', 0, 55, 0, 120, 30, 22, W, uv=14, uvz=24)
    lk.box('Balustrade', 0, 20, 24, 109, 41, 1.6, ST, uv=2)
    lk.box('Centre', 0, -0.8, 0, 30, 3, 26, W, uv=14, uvz=24)
    lk.taper('Pediment', [(-14, -2.3), (14, -2.3), (14, 0.7), (-14, 0.7)], 26, lk.rect(0, -0.8, 1, 3), 31, ST)
    lk.box('Balcony', 0, -3.3, 9, 14, 2.2, 0.5, ST, uv=2); lk.box('BalconyRail', 0, -4.3, 9.5, 14, 0.2, 1.0, ST, uv=1)
    lk.box('Roof', 0, 20, 25.6, 104, 36, 2.0, LEAD, uv=4)
    lk.cyl('Flagpole', 0, 20, 27.6, 0.18, 12, lk.mat('Pole', (0.9, 0.9, 0.9), glow=0.2), seg=6)
    std = np.zeros((256, 512, 3), np.float32); std[:, :] = (0.75, 0.08, 0.12); std[:128, :256] = (0.85, 0.65, 0.12); std[128:, 256:] = (0.85, 0.65, 0.12); std[:128, 256:] = (0.1, 0.25, 0.65)
    lk.box('Standard', 3.0, 20, 36, 6, 0.05, 3, lk.mat('Std', img=lk.image('std', std), glow=0.35))
    for x in (-50, -30, 30, 50): lk.box('Gatepost', x, -30, 0, 2.2, 2.2, 5, ST, uv=2)
    lk.box('Railings', 0, -30, 0, 104, 0.3, 3.0, lk.mat('Rail', (0.08, 0.08, 0.08), glow=0.05), uv=2)

def victoria_memorial():
    """The Victoria Memorial in front of the palace: a tiered white marble monument (25 m) with the seated Queen, sculpture
    groups and the gilt winged Victory on top, in a round basin. Origin = the centre."""
    M = lk.mat('Marble', img=lk.image('m', lk.ashlar((0.92, 0.91, 0.88), rows=6, cols=2, jitter=0.02)), glow=0.3)
    lk.cyl('Basin', 0, 0, 0, 30, 0.9, M, seg=48); lk.cyl('Water', 0, 0, 0.2, 28.5, 0.75, lk.mat('W', (0.3, 0.45, 0.5), rough=0.1, glow=0.2), seg=48)
    lk.cyl('Platform', 0, 0, 0, 16, 2.0, M, seg=32); lk.cyl('Steps', 0, 0, 2, 13, 1.5, M, seg=32)
    lk.box('Pedestal', 0, 0, 3.5, 10, 10, 8, M, uv=3); lk.box('Pedestal2', 0, 0, 11.5, 7, 7, 4, M, uv=3)
    for k in range(4):  # sculpture groups on each face
        a = k * math.pi / 2; x, y = 6.6 * math.cos(a), 6.6 * math.sin(a)
        lk.lathe('Group', [(1.6, 3.5), (1.8, 5), (1.3, 7.5), (0.6, 8.6), (0.0, 9)], M, seg=12, cx=x, cy=y)
    lk.lathe('Obelisk', [(2.8, 15.5), (2.2, 17), (1.6, 20.5), (1.2, 21.5)], M, seg=16)
    lk.lathe('Victory', [(0.5, 21.5), (0.6, 22.5), (0.45, 23.8), (0.25, 24.2), (0.0, 24.6)], GILT, seg=12)
    for s in (-1, 1): lk.box('Wing', s * 0.9, 0, 22.8, 1.4, 0.12, 2.2, GILT, rot=s * 0.4)

def admiralty_arch():
    """Admiralty Arch at the end of the Mall: a curved Portland-stone block 32 m tall with three arches (the middle one
    for state occasions), smaller side gates, columns and the attic inscription. Origin = the middle arch at ground;
    the Mall runs along Y through it."""
    S = 512; base = lk.ashlar(PORTLAND, S, rows=12, cols=3)
    W = lk.mat('Front', img=lk.image('aa', lk.windows(base, glass=(0.15, 0.16, 0.18), nx=4, ny=3, w=0.32, h=0.5, frame=PORTLAND * 1.05)), glow=0.25)
    ST = lk.mat('Stone', img=lk.image('st', lk.ashlar(PORTLAND)), glow=0.25)
    DARK = lk.mat('Dark', (0.1, 0.1, 0.11), glow=0.05)
    # piers between the arches (the road passes through three 7 m arches + two side gates)
    for x0, x1 in ((-26, -16), (-11, -4.5), (4.5, 11), (16, 26)):
        lk.box('Pier', (x0 + x1) / 2, 0, 0, x1 - x0, 14, 14, W, uv=12, uvz=21)
    for x0, x1 in ((-16, -11), (11, 16)): lk.box('SidePier', (x0 + x1) / 2, 0, 0, x1 - x0, 14, 9, W, uv=12, uvz=21)
    lk.box('Upper', 0, 0, 14, 52, 14, 14, W, uv=12, uvz=21)
    for x in (-4.5, 4.5, -11, 11): lk.box('Soffit', 0, 0, 13.6, 52, 14, 0.4, ST, uv=3)
    lk.box('Attic', 0, 0, 28, 52, 14, 4, ST, uv=3)
    for x in (-13, -7, 7, 13): lk.cyl('Column', x, -7.3, 14, 0.8, 13, ST, seg=12)
    lk.box('Inscription', 0, -7.05, 28.8, 30, 0.1, 2.0, lk.mat('Ins', (0.72, 0.7, 0.64), glow=0.25))
    for s in (-1, 1): lk.box('Wing', s * 40, 3, 0, 28, 20, 22, W, uv=12, uvz=21, rot=s * 0.15)

def wellington_arch():
    """Wellington Arch at Hyde Park Corner: a Corinthian triumphal arch (Portland stone, 20 m) topped by the bronze
    quadriga of Peace descending on the chariot of war. Origin = the middle; the road passes through along Y."""
    ST = lk.mat('Stone', img=lk.image('st', lk.ashlar(PORTLAND)), glow=0.25)
    BR = lk.mat('Bronze', (0.22, 0.28, 0.24), rough=0.45, metal=0.5, glow=0.18)
    for s in (-1, 1):
        lk.box('Pier', s * 6.5, 0, 0, 6, 10, 13, ST, uv=3)
        for c in (-1, 1): lk.cyl('Column', s * 6.5 + c * 2.0, -5.4, 0, 0.6, 12, ST, seg=12); lk.cyl('Column', s * 6.5 + c * 2.0, 5.4, 0, 0.6, 12, ST, seg=12)
    lk.box('Soffit', 0, 0, 12.6, 7, 10, 0.4, ST, uv=2)
    lk.box('Entablature', 0, 0, 13, 19, 11, 3.2, ST, uv=3); lk.box('Attic', 0, 0, 16.2, 15, 9, 3.3, ST, uv=3)
    lk.box('Chariot', 0, 0, 19.5, 2.5, 3.0, 2.0, BR)
    for k in range(4): lk.box('Horse', -2.4 + k * 1.6, -2.8, 19.5, 0.8, 3.4, 2.4, BR)
    lk.lathe('Peace', [(0.5, 21.5), (0.55, 23), (0.3, 24.2), (0.0, 24.6)], BR, seg=10)
    for s in (-1, 1): lk.box('Wing', s * 0.8, 0, 23.0, 1.4, 0.1, 1.8, BR, rot=s * 0.5)

def walkie_talkie():
    """20 Fenchurch Street, 160 m (redone 2026-11-20 from OSM's outline, 71 x 59 m N-S at the top): about 55 m wide
    east-west; north to south it grows from ~40 m at the base to ~70 m at the top (the top-heavy bulge). The north face
    curves outwards in plan, the south face inwards (the concave face that focused the sun on Eastcheap in 2013), the
    Sky Garden's sloped glass roof on top. Origin = the centre of the base; Y = north before the heading."""
    G = lk.mat('Glass', img=lk.image('glass', lk.glass((0.5, 0.6, 0.66), floors=6, mullions=10, band=(0.62, 0.66, 0.7), sky=0.3)), rough=0.15, metal=0.45, glow=0.25)
    N = 10
    def plan(w, d):
        """west to east along the south face (concave: bowing in), then east to west along the north face (convex)"""
        sag = 0.07 * w; pts = []
        for k in range(N + 1):
            x = -w / 2 + w * k / N; pts.append((x, -d / 2 + sag * (1 - (2 * x / w) ** 2)))
        for k in range(N + 1):
            x = w / 2 - w * k / N; pts.append((x, d / 2 + sag * (1 - (2 * x / w) ** 2)))
        return pts
    rows = []
    for k in range(17):
        z = 160 * k / 16; t = z / 160
        rows.append((z, 54 + 2 * t, 40 + 30 * t ** 1.5))
    for (z0, w0, d0), (z1, w1, d1) in zip(rows, rows[1:]):
        lk.taper('Band', plan(w0, d0), z0, plan(w1, d1), z1, G, uv=12, cap=False)
    zt, wt, dt = rows[-1]
    top = plan(wt, dt)
    # the Sky Garden: a glass roof rising from the south edge to the north, over the top floors
    lk.taper('SkyGarden', top, zt, [(x, y * 0.6 + dt * 0.12) for x, y in top], zt + 9, lk.mat('SkyGlass', (0.6, 0.7, 0.75), rough=0.1, metal=0.4, glow=0.3), uv=8)

def st_pancras():
    """St Pancras (the Renaissance hotel's clock tower, 82 m): red brick High Victorian Gothic with stone bands, a clock
    on each face, a steep slate spire with dormers and an iron crown. Origin = the tower's base centre; the hotel's long
    front is the generated building."""
    S = 512; img = lk.brick((0.62, 0.3, 0.22), S, rows=24, cols=6)
    for y0 in (120, 360): img[y0:y0 + 14] = (0.85, 0.8, 0.68)
    W = lk.mat('Brick', img=lk.image('sp', lk.windows(img, glass=(0.14, 0.15, 0.17), nx=2, ny=2, w=0.3, h=0.45, arched=True, frame=(0.85, 0.8, 0.68))), glow=0.25)
    ST = lk.mat('Stone', (0.85, 0.8, 0.68), glow=0.25)
    SLATE = lk.mat('Slate', (0.25, 0.27, 0.3), rough=0.6, glow=0.15)
    lk.box('Tower', 0, 0, 0, 11, 11, 52, W, uv=6, uvz=10)
    lk.box('Band', 0, 0, 52, 12, 12, 1.0, ST, uv=2)
    S2 = 512; dial = np.ones((S2, S2, 3), np.float32) * np.array((0.15, 0.25, 0.45))
    yy, xx = np.mgrid[0:S2, 0:S2]; d = np.hypot(xx - 256, yy - 256)
    dial[d < 230] = (0.95, 0.93, 0.85); dial[(d > 200) & (d < 230)] = (0.12, 0.12, 0.14)
    for k in range(12):
        a = 2 * math.pi * k / 12; x, y = int(256 + 215 * math.cos(a)), int(256 + 215 * math.sin(a)); dial[y - 8:y + 8, x - 8:x + 8] = (0.85, 0.7, 0.3)
    D = lk.mat('Dial', img=lk.image('dial', dial), glow=0.4)
    for nx, ny in ((0, 1), (0, -1), (1, 0), (-1, 0)): lk.disc('Dial', (nx * 5.55, ny * 5.55, 46), (nx, ny, 0), 3.0, D)
    lk.taper('Spire', lk.rect(0, 0, 11.5, 11.5), 53, [(0, 0)], 78, SLATE)
    for nx, ny in ((0, 1), (0, -1), (1, 0), (-1, 0)):  # dormers in the spire
        cx, cy = nx * 4.2, ny * 4.2
        lk.box('Dormer', cx, cy, 57, 2.4 if ny else 1.8, 1.8 if ny else 2.4, 3.0, ST, uv=1)
        lk.taper('DormerRoof', lk.rect(cx, cy, 2.6 if ny else 2.0, 2.0 if ny else 2.6), 60, [(cx, cy)], 62, SLATE, cap=False)
    for sx in (-1, 1):
        for sy in (-1, 1): lk.cyl('Pinnacle', sx * 5.3, sy * 5.3, 50, 0.7, 8, ST, seg=8, r2=0.1)
    lk.cyl('Crown', 0, 0, 74, 1.2, 4, lk.mat('Iron', (0.15, 0.15, 0.17), glow=0.1), seg=8, r2=0.3)
    lk.cyl('Finial', 0, 0, 78, 0.2, 4, GILT, seg=6)

FUN = {'white_tower': white_tower, 'albert_hall': albert_hall, 'abbey': abbey, 'buckingham': buckingham, 'victoria_memorial': victoria_memorial,
       'admiralty_arch': admiralty_arch, 'wellington_arch': wellington_arch, 'walkie_talkie': walkie_talkie, 'st_pancras': st_pancras}
FUN[NAME]()
lk.export(OUT, NAME)
CAM = {'white_tower': ((60, -75, 30), (0, 0, 15)), 'albert_hall': ((90, -110, 50), (0, 0, 18)), 'abbey': ((-80, -110, 45), (40, 0, 25)),
       'buckingham': ((90, -140, 35), (0, 20, 15)), 'victoria_memorial': ((40, -55, 20), (0, 0, 12)), 'admiralty_arch': ((50, -75, 20), (0, 0, 15)),
       'wellington_arch': ((30, -40, 12), (0, 0, 12)), 'walkie_talkie': ((150, -230, 60), (0, 0, 85)), 'st_pancras': ((45, -65, 30), (0, 0, 45))}[NAME]
if PNG: lk.preview(PNG, CAM[0], CAM[1], lens=35)
