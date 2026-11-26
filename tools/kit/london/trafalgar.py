# Trafalgar Square for RideWorld's London (2026-11-20, the "Trafalgar Square paving / fountains / National Gallery" polish).
#   /snap/bin/blender -b --python tools/kit/london/trafalgar.py -- <out.glb> [preview.png]
# Built from the real shapes in tools/kit/london/trafalgar.json (OSM outlines and LIDAR heights about Nelson's Column,
# made by a prep script: the square's pedestrian area, the two fountain basins and their jets, the National Gallery's
# footprint; z relative to the ground at the column): granite-flagged paving over the square, the fountains' granite
# rims, pedestals, bowls and jets, and the National Gallery on its terrace: Portland stone, a Corinthian portico with
# pediment, the dome and lantern behind it, cupolas at the ends of Wilkins' front, cornice and balustrade.
# Origin = the ground at Nelson's Column; X east, Y north. Nelson's Column itself is its own model (towers.py nelson).
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lk, bpy, bmesh
import numpy as np

A = lk.args(); OUT = A[0]; PNG = A[1] if len(A) > 1 else None
D = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trafalgar.json')))
lk.start()
PORTLAND = np.array((0.84, 0.82, 0.76)); GRANITE = np.array((0.62, 0.6, 0.58))

def flags(size=512):
    """big pale granite flags in a running bond, a darker band every so often"""
    img = lk.ashlar(GRANITE * 1.12, size, rows=6, cols=4, mortar=0.86, jitter=0.04)
    img[::128] *= 0.85
    return img * (1 + lk.noise(size, size, 0.03, 2))

def facade(size=512):
    """one 8 m bay of Wilkins' front: Portland ashlar, a tall pedimented window between pilasters, a plinth"""
    img = lk.ashlar(PORTLAND, size, rows=14, cols=3, mortar=0.93, jitter=0.03)
    img[:, :34] *= 1.06; img[:, -34:] *= 1.06                     # the pilasters, catching the light
    img[:, 34:40] *= 0.82; img[:, -40:-34] *= 0.82
    x0, x1, y0, y1 = 190, 322, 150, 400
    img[y0:y1, x0:x1] = (0.18, 0.2, 0.23)                           # the window
    img[y0 - 12:y0, x0 - 16:x1 + 16] = PORTLAND * 0.9              # its cornice
    for k in range(1, 3): img[y0:y1, x0 + k * (x1 - x0) // 3 - 3:x0 + k * (x1 - x0) // 3 + 3] = PORTLAND
    img[y0 + (y1 - y0) // 2 - 3:y0 + (y1 - y0) // 2 + 3, x0:x1] = PORTLAND
    img[size - 50:] = PORTLAND * 0.82                               # the plinth
    return img * (1 + lk.noise(size, size, 0.02, 2))

def balustrade(size=256):
    img = np.ones((size, size, 3), np.float32) * PORTLAND
    for x in range(8, size, 32): img[60:200, x:x + 14] = PORTLAND * 0.96; img[60:200, x + 14:x + 32] = (0.25, 0.27, 0.3)  # (sky between the balusters)
    img[:60] = PORTLAND * 0.92; img[200:] = PORTLAND * 0.9
    return img

STONE = lk.mat('Portland', img=lk.image('pl', lk.ashlar(PORTLAND, rows=8, cols=3, mortar=0.93)), rough=0.85, glow=0.25)
FAC = lk.mat('Facade', img=lk.image('fac', facade()), rough=0.85, glow=0.25)
BAL = lk.mat('Balustrade', img=lk.image('bal', balustrade()), rough=0.85, glow=0.25)
LEAD = lk.mat('Lead', (0.42, 0.45, 0.47), rough=0.6, metal=0.3, glow=0.15)
GRAN = lk.mat('Granite', img=lk.image('gr', lk.ashlar(GRANITE, rows=3, cols=6, mortar=0.85)), rough=0.8, glow=0.2)
FLAGS = lk.mat('Flags', img=lk.image('fl', flags()), rough=0.9, glow=0.2)
SPRAY = lk.mat('Spray', (0.92, 0.96, 1.0), rough=0.2, glow=0.5, alpha=0.55)

# ---- the paving: the square's outline, a thin slab just over the ground model (it's level: LIDAR, square z) ----
z_sq = D['squareZ']
lk.prism('Paving', [tuple(p) for p in D['square']], z_sq - 0.35, z_sq + 0.07, FLAGS, uv=6.0, bottom=True)

# ---- the fountains: granite rims along the basins, a pedestal, two bowls and jets in each ----
def centroid(P): return (sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P))
for b in D['basins']:
    P, z = b['pts'], b['z']
    if P[0] == P[-1]: P = P[:-1]
    cx, cy = centroid(P)
    for a, c in zip(P, P[1:] + P[:1]):                     # the rim: a granite kerb on every side, 0.55 m wide
        L = math.hypot(c[0] - a[0], c[1] - a[1]); rot = math.atan2(c[1] - a[1], c[0] - a[0])
        # pushed outwards half its width, so the water drawn inside the basin meets its inner face
        mx, my = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2; ox, oy = mx - cx, my - cy; ol = math.hypot(ox, oy) or 1
        lk.box('Rim', mx + ox / ol * 0.27, my + oy / ol * 0.27, z - 0.5, L + 0.5, 0.55, 1.15, GRAN, rot=rot, uv=1.5)
    lk.cyl('Pedestal', cx, cy, z - 0.3, 1.1, 1.6, GRAN, seg=16)
    lk.lathe('Bowl', [(0.35, 0), (1.6, 0.35), (3.4, 0.75), (3.6, 0.95), (3.3, 1.0), (1.6, 0.7), (0.4, 0.55)], GRAN, seg=32, cx=cx, cy=cy, cap_bottom=True).location.z += z + 1.3
    lk.cyl('Stem', cx, cy, z + 2.2, 0.35, 1.4, GRAN, seg=12)
    lk.lathe('Bowl2', [(0.25, 0), (1.0, 0.25), (1.7, 0.55), (1.8, 0.7), (1.5, 0.72), (0.3, 0.45)], GRAN, seg=24, cx=cx, cy=cy, cap_bottom=True).location.z += z + 3.5
    lk.cyl('Jet', cx, cy, z + 4.0, 0.2, 5.0, SPRAY, seg=10, r2=0.05)            # the central jet
    lk.cyl('Fall', cx, cy, z + 2.0, 3.4, 1.4, SPRAY, seg=24, r2=3.6)            # water falling off the big bowl
for (x, y) in D['jets']:                                                         # the outer jets
    lk.cyl('JetSide', x, y, 0.4, 0.12, 3.2, SPRAY, seg=8, r2=0.04)

# ---- the National Gallery ----
G = [tuple(p) for p in D['gallery']]
if G[0] == G[-1]: G = G[:-1]
zg = D['galleryZ']
H = 15.5
lk.prism('Gallery', G, zg - 1.0, zg + H, FAC, uv=8.0, uvz=H + 1.0)
lk.prism('Cornice', G, zg + H, zg + H + 0.9, STONE, uv=3.0)
lk.prism('Balustrade', G, zg + H + 0.9, zg + H + 2.0, BAL, uv=2.0)
lk.prism('Roof', G, zg + H + 0.5, zg + H + 0.8, LEAD, uv=4.0)
# Wilkins' front: the southern edge; the portico at its middle
# (the footprint's southernmost edge is the Sainsbury Wing's: the portico is the middle of Wilkins' front, about 8 m west of
# the column, between the mapped Getty entrance and exit; its wall is the footprint's south edge there)
px = -8.0
ymin = min(p[1] for p in G if abs(p[0] - px) < 25)
front = [p for p in G if p[1] < ymin + 7 and -110 < p[0] < 95]
fx0, fx1 = max(-95.0, min(p[0] for p in front)), min(43.0, max(p[0] for p in front))
lk.box('PorticoBase', px, ymin - 5.0, zg - 1.0, 30, 10, 2.2, STONE, uv=3.0)
for s in range(5):                                                               # the steps down to the terrace
    lk.box('Step', px, ymin - 10.2 - s * 0.4, zg - 1.0, 26 - s * 0.6, 0.45, 1.2 - s * 0.24, STONE, uv=2.0)
for k in range(8):                                                               # eight Corinthian columns
    x = px - 12.25 + k * 3.5
    lk.cyl('Column', x, ymin - 8.0, zg + 1.2, 0.62, 11.0, STONE, seg=16, r2=0.54)
    lk.box('Capital', x, ymin - 8.0, zg + 12.2, 1.6, 1.6, 0.9, STONE, uv=1.0)
lk.box('Entablature', px, ymin - 4.6, zg + 13.1, 29, 8.2, 2.0, STONE, uv=2.0)
pz = zg + 15.1                                                                   # the pediment
lk.taper('Pediment', lk.rect(px, ymin - 4.6, 29, 8.2), pz, [(px - 14.5, ymin - 4.6), (px + 14.5, ymin - 4.6), (px + 14.5, ymin - 4.6), (px - 14.5, ymin - 4.6)], pz + 4.2, STONE, uv=2.0)
# the dome on its drum behind the portico, with a lantern
dy = ymin + 16; dz = zg + H + 0.8
lk.cyl('Drum', px, dy, dz, 7.0, 4.5, FAC, seg=32)
lk.cyl('DrumCornice', px, dy, dz + 4.5, 7.4, 0.6, STONE, seg=32)
lk.dome('Dome', px, dy, dz + 5.1, 7.0, 6.5, LEAD, seg=32, rings=12)
lk.cyl('Lantern', px, dy, dz + 11.4, 1.3, 2.6, STONE, seg=16)
lk.dome('LanternDome', px, dy, dz + 14.0, 1.5, 1.4, LEAD, seg=16, rings=6)
# the pepper-pot cupolas at each end of the front
for x in (fx0 + 9, fx1 - 9):
    lk.box('CupolaBase', x, ymin + 6, dz, 6, 6, 3.0, FAC, uv=3.0)
    lk.cyl('Cupola', x, ymin + 6, dz + 3.0, 2.6, 2.6, STONE, seg=16)
    lk.dome('CupolaDome', x, ymin + 6, dz + 5.6, 2.8, 2.4, LEAD, seg=16, rings=6)

lk.export(OUT, 'TrafalgarSquare')
if PNG: lk.preview(PNG, (60, -110, 45), (-20, 40, 6), lens=28)
