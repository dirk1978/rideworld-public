# More London landmarks for RideWorld's London open world (2026-11-17), one model per name:
#   /snap/bin/blender -b --python tools/kit/london/landmarks2.py -- <name> <out.glb> [preview.png]
#   names: eye, stpauls, battersea, victoria_tower, central_tower
# Origin = the landmark's ground point, X east, Y north, Z up (see lk.py); notes per model below.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lk
import numpy as np
from mathutils import Matrix, Vector

A = lk.args(); NAME, OUT = A[0], A[1]; PNG = A[2] if len(A) > 2 else None
lk.start()
PORTLAND = np.array((0.86, 0.84, 0.78)); ANSTON = np.array((0.80, 0.69, 0.50))
GILT = lk.mat('Gilt', (0.83, 0.66, 0.26), rough=0.35, metal=0.7, glow=0.35)

def eye():
    """The London Eye, 135 m: the wheel stands in the X-Z plane (hub 70 m up, rim radius 60 m, a triangular truss of
    three tubes), 64 spoke cables, 32 egg-shaped glass capsules on the outside of the rim, an A-frame of two legs leaning
    back to +Y from the hub, and backstay cables. Origin = ground below the hub; heading turns X along the real rim."""
    white = lk.mat('White', (0.93, 0.94, 0.95), rough=0.4, glow=0.3)
    cable = lk.mat('Cable', (0.75, 0.77, 0.8), rough=0.4, metal=0.5, glow=0.2)
    cap_img = lk.glass((0.55, 0.68, 0.78), floors=1, mullions=6, band=(0.85, 0.87, 0.9), sky=0.35)
    capm = lk.mat('Capsule', img=lk.image('cap', cap_img), rough=0.1, metal=0.4, glow=0.3)
    H, R, N = 70.0, 60.0, 64
    ring = lambda r, y: [(r * math.cos(2 * math.pi * k / N), y, H + r * math.sin(2 * math.pi * k / N)) for k in range(N)]
    rims = [ring(R, -3.0), ring(R, 3.0), ring(R - 5.0, 0.0)]
    for rim in rims:
        for k in range(N): lk.tube('Rim', rim[k], rim[(k + 1) % N], 0.45, white, seg=6)
    for k in range(N):  # the truss: ties between the three rim tubes
        lk.tube('Tie', rims[0][k], rims[1][k], 0.2, white, seg=4); lk.tube('Tie', rims[0][k], rims[2][k], 0.2, white, seg=4)
        lk.tube('Tie', rims[1][k], rims[2][k], 0.2, white, seg=4); lk.tube('Tie', rims[0][k], rims[1][(k + 1) % N], 0.15, white, seg=4)
    for k in range(N):  # spokes from the hub's two ends to the inner rim
        y = -6.0 if k % 2 else 6.0
        lk.tube('Spoke', (0, y, H), rims[2][k], 0.12, cable, seg=4)
    o = lk.lathe('Hub', [(2.5, -9), (3.2, -6), (3.2, 6), (2.5, 9)], white, seg=24, cap_top=True, cap_bottom=True)
    lk.xform(o, Matrix.Translation((0, 0, H)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    for k in range(32):  # the capsules, outside the rim, long axis across the wheel (along Y)
        a = 2 * math.pi * k / 32; r = R + 3.6
        o = lk.lathe('Capsule', [(0.0, -4.2), (1.6, -3.6), (2.3, -2.0), (2.4, 0.0), (2.3, 2.0), (1.6, 3.6), (0.0, 4.2)], capm, seg=16, u_rep=2)
        lk.xform(o, Matrix.Translation((r * math.cos(a), 1.5, H + r * math.sin(a))) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
        lk.tube('CapMount', (R * math.cos(a), 0, H + R * math.sin(a)), (r * math.cos(a), 0, H + r * math.sin(a)), 0.35, white, seg=4)
    for sx in (-1, 1):  # the A-frame legs, leaning back from the hub to the ground
        lk.tube('Leg', (sx * 1.5, 8.0, H), (sx * 26.0, 52.0, 0.0), 1.6, white, seg=10)
        lk.tube('Backstay', (sx * 1.5, 8.0, H + 1), (sx * 18.0, 110.0, 0.0), 0.25, cable, seg=4)
    lk.tube('LegTie', (-15.0, 32.0, 32.0), (15.0, 32.0, 32.0), 0.8, white, seg=8)
    lk.box('Boarding', 0, -4, 0, 70, 12, 1.2, lk.mat('Deck', (0.55, 0.56, 0.58), glow=0.15))

def stpauls():
    """St Paul's Cathedral: origin = the centre of the dome at ground; the nave runs along X (west front at -X).
    Two storeys of Portland stone with pilasters and round-headed windows, a cross plan (nave, choir and apse, transepts
    with porticoes), the west front's double portico and two baroque towers, the drum with its colonnade, the lead dome,
    the stone lantern, golden ball and cross (111 m)."""
    wall_img = lk.windows(lk.ashlar(PORTLAND, rows=10, cols=2), glass=(0.18, 0.2, 0.22), nx=2, ny=1, w=0.3, h=0.5, arched=True, frame=PORTLAND * 1.05)
    for k in range(4): wall_img[:, k * 128:k * 128 + 10] *= 1.1  # pilasters
    WALL = lk.mat('Wall', img=lk.image('stp', wall_img), glow=0.25)
    STONE = lk.mat('Stone', img=lk.image('stone', lk.ashlar(PORTLAND)), glow=0.25)
    LEAD = lk.mat('Lead', (0.42, 0.45, 0.47), rough=0.55, metal=0.2, glow=0.2)
    col_img = np.ones((512, 512, 3), np.float32) * PORTLAND
    for k in range(32): x = k * 16; col_img[:, x:x + 7] *= 0.55  # columns with dark gaps between
    COLS = lk.mat('Colonnade', img=lk.image('cols', col_img), glow=0.25)
    # nave (west), choir (east) with apse, transepts (north and south)
    lk.box('Nave', -42, 0, 0, 72, 37, 27, WALL, uv=14, uvz=13.5); lk.box('Choir', 40, 0, 0, 48, 37, 27, WALL, uv=14, uvz=13.5)
    lk.cyl('Apse', 64, 0, 0, 12, 24, WALL, seg=16)
    lk.box('Transepts', 0, 0, 0, 37, 76, 27, WALL, uv=14, uvz=13.5)
    lk.box('Crossing', 0, 0, 0, 40, 40, 30, STONE, uv=4)
    for b, (cx, cy, w, d) in enumerate(((-42, 0, 72, 37), (40, 0, 48, 37), (0, 0, 37, 76))):  # pitched lead roofs behind balustrades
        if w > d: lk.taper('Roof', lk.rect(cx, cy, w, d - 4), 27, lk.rect(cx, cy, w, 2), 33, LEAD)
        else: lk.taper('Roof', lk.rect(cx, cy, w - 4, d), 27, lk.rect(cx, cy, 2, d), 33, LEAD)
        lk.box('Balustrade', cx, cy, 27, w + 0.6, d + 0.6, 1.4, STONE, uv=2)
    # transept porticoes (semicircular, north and south)
    for s in (-1, 1): lk.lathe('Portico', [(7, 0), (7, 18)], COLS, seg=24, cy=s * 39, u_rep=0.5); lk.dome('PorticoDome', 0, s * 39, 18, 7.2, 3.5, LEAD, seg=16, rings=6)
    # west front: the double portico and the two towers
    lk.box('WestFront', -80, 0, 0, 6, 50, 30, WALL, uv=8, uvz=15)
    lk.box('Portico1', -85, 0, 0, 6, 28, 15, COLS, uv=8, uvz=15); lk.box('Portico2', -85, 0, 15, 6, 22, 13, COLS, uv=8, uvz=13)
    lk.taper('Pediment', [(-88, -12), (-82, -12), (-82, 12), (-88, 12)], 28, [(-85, 0)], 35, STONE, cap=False)
    for s in (-1, 1):
        y = s * 20
        lk.box('TowerBase', -80, y, 30, 11, 11, 8, STONE, uv=3)
        lk.lathe('TowerDrum', [(5, 38), (5, 50)], COLS, seg=16, cx=-80, cy=y, u_rep=0.4)
        lk.cyl('TowerCap', -80, y, 50, 5.6, 1.2, STONE, seg=12)
        lk.lathe('TowerTop', [(4.8, 51.2), (4.2, 54), (2.4, 57), (1.6, 60), (0.8, 63)], LEAD, seg=12, cx=-80, cy=y)
        lk.cyl('TowerFinial', -80, y, 63, 0.4, 4, GILT, seg=6, r2=0.1)
    # the dome: drum with its colonnade, the attic, the lead dome, lantern, ball and cross
    lk.cyl('Drum', 0, 0, 30, 19.5, 17, STONE, seg=48)
    lk.lathe('Peristyle', [(21.5, 30), (21.5, 45)], COLS, seg=64, u_rep=1)
    lk.cyl('PeristyleTop', 0, 0, 45, 22.3, 1.6, STONE, seg=48)
    lk.cyl('Attic', 0, 0, 46.6, 17.8, 8.4, lk.mat('Attic', img=lk.image('att', lk.windows(lk.ashlar(PORTLAND), glass=(0.2, 0.22, 0.24), nx=4, ny=1, w=0.3, h=0.5, arched=True)), glow=0.25), seg=48)
    lk.dome('Dome', 0, 0, 55, 17.5, 23.5, lk.mat('DomeLead', img=lk.image('dl', (lambda im: [im.__setitem__((slice(None), slice(k * 16, k * 16 + 3)), im[:, k * 16:k * 16 + 3] * 0.8) for k in range(32)] and im)(np.ones((512, 512, 3), np.float32) * np.array((0.44, 0.47, 0.49)))), rough=0.5, metal=0.2, glow=0.2), seg=48, rings=14, r_top=3.2)
    lk.cyl('LanternBase', 0, 0, 78.4, 4.2, 2.6, STONE, seg=16)
    lk.lathe('Lantern', [(3.4, 81), (3.4, 92)], COLS, seg=24, u_rep=0.4)
    lk.lathe('LanternTop', [(3.8, 92), (3.0, 95), (1.6, 99), (0.7, 102)], STONE, seg=16)
    lk.lathe('Ball', [(0.0, 102.0), (1.1, 102.6), (1.5, 103.8), (1.1, 105.0), (0.0, 105.6)], GILT, seg=16)
    lk.box('CrossV', 0, 0, 105.6, 0.4, 0.4, 5.0, GILT); lk.box('CrossH', 0, 0, 108.6, 2.6, 0.4, 0.4, GILT)

def battersea():
    """Battersea Power Station: origin = the centre; the long side runs along Y. Brick boiler-house halls, corner towers
    stepped in art deco, and the four white fluted chimneys (101 m) on the corner towers."""
    BRICK = lk.mat('Brick', img=lk.image('br', lk.brick((0.6, 0.36, 0.26))), glow=0.22)
    bwin = lk.windows(lk.brick((0.6, 0.36, 0.26)), glass=(0.2, 0.22, 0.25), nx=2, ny=1, w=0.18, h=0.85)
    BWIN = lk.mat('BrickWin', img=lk.image('bw', bwin), glow=0.22)
    S = 512; ch = np.ones((S, S, 3), np.float32) * np.array((0.93, 0.92, 0.88))
    for k in range(20): x = k * S // 20; ch[:, x:x + 10] *= 0.85
    CH = lk.mat('Chimney', img=lk.image('ch', ch), glow=0.3)
    L, Wd = 160.0, 120.0
    lk.box('Hall', 0, 0, 0, Wd - 40, L, 40, BWIN, uv=16, uvz=40)
    for sx in (-1, 1): lk.box('SideHall', sx * (Wd / 2 - 12), 0, 0, 24, L - 40, 30, BWIN, uv=16, uvz=30)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (Wd / 2 - 13), sy * (L / 2 - 13)
            lk.box('CornerTower', x, y, 0, 26, 26, 44, BRICK, uv=4)
            lk.box('Step1', x, y, 44, 22, 22, 4, BRICK, uv=4); lk.box('Step2', x, y, 48, 17, 17, 3, BRICK, uv=4)
            lk.lathe('Chimney', [(4.6, 51), (4.4, 55), (3.8, 98), (4.1, 99.5), (4.1, 101)], CH, seg=24, cx=x, cy=y, u_rep=1)
    lk.box('Roof', 0, 0, 40, Wd - 40, L, 0.5, lk.mat('RoofM', (0.35, 0.33, 0.32), glow=0.1))

def victoria_tower():
    """Victoria Tower (Palace of Westminster's south-west tower), 98.5 m: a 23 m square of Anston limestone panelled in
    Gothic tracery, the Sovereign's Entrance arch at its foot, eight-sided corner turrets with gilt-topped caps above
    the parapet, the iron crown and flagpole."""
    G = lk.mat('Gothic', img=lk.image('g', lk.gothic(ANSTON)), glow=0.25)
    GW = lk.mat('GothicWin', img=lk.image('gw', lk.gothic_windows(ANSTON)), glow=0.25)
    PL = lk.mat('Plain', img=lk.image('pl', lk.ashlar(ANSTON * 0.97)), glow=0.25)
    DARK = lk.mat('Dark', (0.1, 0.09, 0.08), glow=0.05)
    S = 23.0
    lk.box('Base', 0, 0, 0, S, S, 20, PL, uv=4)
    for nx, ny in ((0, 1), (0, -1), (1, 0), (-1, 0)):  # the great entrance arch on the south and west faces (dark recess)
        if (nx, ny) in ((0, -1), (-1, 0)):
            tx, ty = -ny, nx; c = (nx * (S / 2 + 0.05), ny * (S / 2 + 0.05))
            lk.quad('Arch', [(c[0] - tx * 6, c[1] - ty * 6, 0), (c[0] + tx * 6, c[1] + ty * 6, 0), (c[0] + tx * 6, c[1] + ty * 6, 15), (c[0] - tx * 6, c[1] - ty * 6, 15)], DARK)
    lk.box('Shaft', 0, 0, 20, S, S, 60, GW, uv=6, uvz=12)
    lk.box('Belfry', 0, 0, 80, S - 1, S - 1, 8, G, uv=6, uvz=8)
    lk.box('Parapet', 0, 0, 88, S + 0.4, S + 0.4, 1.4, PL, uv=2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (S / 2 - 1.5), sy * (S / 2 - 1.5)
            lk.cyl('Turret', x, y, 0, 2.8, 90, G, seg=8)
            lk.cyl('TurretTop', x, y, 90, 3.0, 2.0, PL, seg=8)
            lk.cyl('TurretCap', x, y, 92, 2.8, 5.0, lk.mat('Iron', (0.2, 0.24, 0.3), rough=0.5, metal=0.4, glow=0.2), seg=8, r2=0.6)
            lk.cyl('TurretFinial', x, y, 97, 0.4, 1.5, GILT, seg=6)
    lk.taper('Crown', lk.rect(0, 0, 10, 10), 89.4, lk.rect(0, 0, 3, 3), 95, lk.mat('IronC', (0.2, 0.24, 0.3), rough=0.5, metal=0.4, glow=0.2))
    lk.cyl('Flagpole', 0, 0, 95, 0.25, 18, lk.mat('Pole', (0.9, 0.9, 0.9), glow=0.2), seg=6)
    lk.box('Flag', 0, 3.5, 107, 0.05, 7, 3.5, lk.mat('Flag', img=lk.image('flag', union_jack()), glow=0.35))

def union_jack(w=512, h=256):
    img = np.ones((h, w, 3), np.float32) * np.array((0.0, 0.14, 0.49))
    yy, xx = np.mgrid[0:h, 0:w]
    d1 = np.abs(yy / h - xx / w) * h; d2 = np.abs(yy / h - (1 - xx / w)) * h
    img[(d1 < 26) | (d2 < 26)] = 1.0; img[(d1 < 9) | (d2 < 9)] = (0.8, 0.07, 0.18)
    img[(np.abs(yy - h / 2) < 42) | (np.abs(xx - w / 2) < 42)] = 1.0
    img[(np.abs(yy - h / 2) < 25) | (np.abs(xx - w / 2) < 25)] = (0.8, 0.07, 0.18)
    return img

def central_tower():
    """The Central Tower over the Palace of Westminster's lobby, 91 m: an octagonal Gothic lantern rising out of the
    roof (from 26 m: the palace below is the generated building with its Gothic façade) to a ribbed stone spire."""
    G = lk.mat('Gothic', img=lk.image('g', lk.gothic_windows(ANSTON)), glow=0.25)
    PL = lk.mat('Plain', img=lk.image('pl', lk.ashlar(ANSTON * 0.97)), glow=0.25)
    lk.cyl('Base', 0, 0, 20, 12.5, 10, PL, seg=8)
    lk.cyl('Lantern', 0, 0, 30, 10.5, 22, G, seg=8)
    lk.cyl('Ring', 0, 0, 52, 11.2, 1.2, PL, seg=8)
    for i in range(8):
        a = 2 * math.pi * i / 8; x, y = 10.8 * math.cos(a), 10.8 * math.sin(a)
        lk.cyl('Pinnacle', x, y, 30, 0.9, 26, PL, seg=6); lk.cyl('PinnacleTop', x, y, 56, 1.0, 6, PL, seg=6, r2=0.1)
    lk.cyl('Spire', 0, 0, 53.2, 6.8, 36, lk.mat('Spire', img=lk.image('sp', lk.ashlar(ANSTON * 0.95, rows=16, cols=2)), glow=0.25), seg=8, r2=0.4)
    lk.cyl('Finial', 0, 0, 89.2, 0.35, 2.0, GILT, seg=6)

{'eye': eye, 'stpauls': stpauls, 'battersea': battersea, 'victoria_tower': victoria_tower, 'central_tower': central_tower}[NAME]()
lk.export(OUT, NAME)
CAM = {'eye': ((150, -190, 60), (0, 0, 65)), 'stpauls': ((-190, -170, 70), (-10, 0, 45)), 'battersea': ((230, -250, 90), (0, 0, 45)),
       'victoria_tower': ((80, -110, 40), (0, 0, 55)), 'central_tower': ((60, -85, 40), (0, 0, 60))}[NAME]
if PNG: lk.preview(PNG, CAM[0], CAM[1], lens=35)
