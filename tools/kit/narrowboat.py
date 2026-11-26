# Narrowboats for RideWorld's canals (2026-11-21, Tardebigge): moored boats in a few liveries.
#   /snap/bin/blender -b --python tools/kit/narrowboat.py -- <out dir> [preview.png]
# writes boat-1.glb ... boat-4.glb. Local axes: X along the boat (bow at +X), Y to port, Z up; origin on the waterline
# at the middle. ~18 m long, 2.08 m beam (a 57 ft narrowboat); black hull to the gunwale with a coloured rubbing strake,
# a painted cabin with lining, windows and portholes, a grey roof with a chimney, a water can, a plank and a pole,
# a bow well with a cratch, the counter stern with tiller and rudder, rope fenders. Every shape is a closed solid.
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'london'))
import lk, bpy, bmesh
import numpy as np

A = lk.args(); OUTDIR = A[0]; PNG = A[1] if len(A) > 1 else None
rng = np.random.default_rng(3)
LIVERIES = [  # (cabin, lining, panel ends, roof, strake)
    ((0.12, 0.3, 0.18), (0.88, 0.78, 0.45), (0.55, 0.08, 0.06), (0.38, 0.38, 0.36), (0.55, 0.08, 0.06)),  # Brunswick green, gold lining, red ends
    ((0.1, 0.16, 0.38), (0.9, 0.8, 0.3), (0.85, 0.65, 0.15), (0.4, 0.4, 0.4), (0.85, 0.65, 0.15)),        # royal blue and yellow
    ((0.4, 0.07, 0.07), (0.88, 0.84, 0.7), (0.12, 0.25, 0.16), (0.34, 0.33, 0.32), (0.88, 0.84, 0.7)),    # maroon and cream, green ends
    ((0.2, 0.22, 0.24), (0.75, 0.2, 0.15), (0.75, 0.2, 0.15), (0.36, 0.36, 0.36), (0.75, 0.2, 0.15)),     # grey with red lining
]

def cabin_tex(base, line, ends, size=512, rep=4.0):
    """one 4 m repeat of a cabin side: the colour with a lined panel, a window and two portholes"""
    img = np.zeros((size // 2, size, 3), np.float32) + np.array(base)
    h, w = img.shape[:2]
    img[6:12] = line; img[h - 12:h - 6] = line                      # coachlines top and bottom
    img[:, 4:10] = line; img[:, w - 10:w - 4] = line
    # a window (dark glass, chrome frame) and two round portholes
    wy0, wy1, wx0, wx1 = int(h * 0.28), int(h * 0.62), int(w * 0.12), int(w * 0.38)
    img[wy0 - 4:wy1 + 4, wx0 - 4:wx1 + 4] = (0.75, 0.75, 0.72); img[wy0:wy1, wx0:wx1] = (0.1, 0.12, 0.15)
    yy, xx = np.mgrid[0:h, 0:w]
    for cx in (0.6, 0.82):
        r = ((xx - w * cx) ** 2 + (yy - h * 0.45) ** 2) ** 0.5
        img[(r < h * 0.13) & (r > h * 0.1)] = (0.78, 0.68, 0.35); img[r <= h * 0.1] = (0.1, 0.12, 0.15)
    return img * (1 + lk.noise(h, w, 0.02))
def hull_tex(strake, size=256):
    img = np.zeros((size, size, 3), np.float32) + 0.06
    img[int(size * 0.12):int(size * 0.2)] = strake                  # the rubbing strake band near the top
    return img * (1 + lk.noise(size, size, 0.05))

def solid(name, poly, zb, zt, mat, uv=1.0, uvz=None):
    bm = bmesh.new()
    a = [bm.verts.new((x, y, zb)) for x, y in poly]; b = [bm.verts.new((x, y, zt)) for x, y in poly]
    n = len(poly)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(b); bm.faces.new(list(reversed(a)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lk.finish(name, bm, mat, uv, uvz)
def taper2(name, p0, z0, p1, z1, mat, uv=1.0):
    return lk.taper(name, p0, z0, p1, z1, mat, uv=uv)

def boat(i):
    cab, line, ends, roof, strake = LIVERIES[i % len(LIVERIES)]
    L, B = 18.0, 2.08; hb = B / 2
    HULL = lk.mat('Hull', img=lk.image('hull%d' % i, hull_tex(strake)), rough=0.5, glow=0.08)
    CAB = lk.mat('Cabin', img=lk.image('cab%d' % i, cabin_tex(cab, line, ends)), rough=0.4, glow=0.2)
    END = lk.mat('Ends', ends, rough=0.4, glow=0.2)
    ROOF = lk.mat('Roof', roof, rough=0.8, glow=0.12)
    BLACK = lk.mat('Black', (0.04, 0.04, 0.04), rough=0.5, glow=0.05)
    BRASS = lk.mat('Brass', (0.78, 0.6, 0.26), rough=0.3, metal=0.8, glow=0.2)
    ROPE = lk.mat('Rope', (0.62, 0.55, 0.42), rough=0.95, glow=0.15)
    WOOD = lk.mat('Wood', (0.45, 0.32, 0.2), rough=0.9, glow=0.12)
    TARP = lk.mat('Cratch', (0.2, 0.3, 0.22) if i % 2 else (0.15, 0.17, 0.25), rough=0.9, glow=0.12)
    # hull: straight sides, a pointed bow, a rounded counter stern; 0.55 m draught, the gunwale 0.32 m over the water
    bow = [(L / 2 - 2.6 + 2.6 * (1 - math.cos(t * math.pi / 2)), hb * math.cos(t * math.pi / 2) ** 0.9) for t in np.linspace(0, 1, 7)]
    stern = [(-L / 2 + 0.6 * (1 - math.sin(t * math.pi / 2)), hb * math.cos(t * math.pi / 2)) for t in np.linspace(0, 1, 5)]
    plan = [(x, -y) for x, y in bow] + [(x, y) for x, y in reversed(bow)][1:] + [(x, y) for x, y in stern] + [(x, -y) for x, y in reversed(stern)][1:-1]
    solid('Hull', plan, -0.55, 0.32, HULL, uv=1.6)
    solid('Gunwale', [(x * 0.999, y * 1.02) for x, y in plan], 0.32, 0.36, BLACK, uv=1.0)
    # cabin: from 2.4 m behind the bow to 1.4 m short of the stern, a little narrower than the hull, ends in the panel colour
    c0, c1, cw = -L / 2 + 1.4, L / 2 - 2.4, hb - 0.06
    # (2026-11-24, the owner: the boats "look very basic" in the key art: the cabin leans in a little (tumblehome), a cambered
    # roof in the panel colour with handrails, flowers in the pots, a coiled rope and a painted diamond panel at the bow)
    tw = cw
    solid('Cabin', [(c0 + 0.25, -cw), (c1 - 0.25, -cw), (c1 - 0.25, cw), (c0 + 0.25, cw)], 0.36, 1.62, CAB, uv=4.0, uvz=2.0)  # (straight sides: leaning ones lost the windows' texture)
    solid('CabinEndF', [(c1 - 0.25, -cw), (c1, -cw + 0.05), (c1, cw - 0.05), (c1 - 0.25, cw)], 0.36, 1.62, END, uv=1.0)
    solid('CabinEndA', [(c0, -cw + 0.05), (c0 + 0.25, -cw), (c0 + 0.25, cw), (c0, cw - 0.05)], 0.36, 1.62, END, uv=1.0)
    ROOF2 = lk.mat('RoofTop', tuple(0.75 * c for c in ends), rough=0.7, glow=0.12)
    bm = bmesh.new(); prof = [(-tw - 0.04, 1.62), (-tw * 0.7, 1.7), (-tw * 0.35, 1.745), (0, 1.76), (tw * 0.35, 1.745), (tw * 0.7, 1.7), (tw + 0.04, 1.62)]
    A_ = [bm.verts.new((c0 - 0.02, y, z)) for y, z in prof]; B_ = [bm.verts.new((c1 + 0.02, y, z)) for y, z in prof]
    for k in range(len(prof) - 1): bm.faces.new((A_[k], A_[k + 1], B_[k + 1], B_[k]))
    bm.faces.new(list(reversed(A_))); bm.faces.new(B_); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('Roof', bm, ROOF2, 2.0)
    for sd in (-1, 1):  # handrails along both roof edges, on little stanchions
        lk.box('Handrail', (c0 + c1) / 2, sd * (tw - 0.05), 1.76, c1 - c0 - 0.6, 0.04, 0.04, BRASS)
        for x in np.linspace(c0 + 0.4, c1 - 0.4, 6): lk.box('Stanchion', x, sd * (tw - 0.05), 1.66, 0.03, 0.03, 0.12, BRASS)
    # roof clutter: a chimney with a brass band, a water can, a long plank and a boat pole, a few plant pots
    lk.cyl('Chimney', c1 - 1.2, 0.3, 1.7, 0.08, 0.55, BLACK, seg=10); lk.cyl('ChimneyBand', c1 - 1.2, 0.3, 2.1, 0.085, 0.06, BRASS, seg=10)
    lk.box('WaterCan', c1 - 3.0, -0.35, 1.7, 0.5, 0.25, 0.35, END)
    lk.box('Plank', 0.5, 0.55, 1.7, 5.5, 0.22, 0.05, WOOD)
    lk.box('Pole', -0.5, 0.25, 1.7, 6.0, 0.05, 0.05, WOOD)
    FLOWERS = [lk.mat('Flower%d' % k, col, rough=0.8, glow=0.25) for k, col in enumerate([(0.85, 0.15, 0.2), (0.95, 0.75, 0.1), (0.9, 0.4, 0.75)])]
    LEAF = lk.mat('Leaves', (0.12, 0.42, 0.1), rough=0.9, glow=0.15)
    for k in range(3):
        px = c0 + 2.5 + k * 0.6
        lk.cyl('Pot', px, -0.5, 1.75, 0.13, 0.22, (END if k % 2 else ROOF), seg=8)
        lk.cyl('Plant', px, -0.5, 1.97, 0.16, 0.12, LEAF, seg=8, r2=0.1)
        for j in range(4): lk.cyl('Bloom', px + 0.08 * math.cos(j * 1.6 + k), -0.5 + 0.08 * math.sin(j * 1.6 + k), 2.07, 0.045, 0.04, FLOWERS[(j + k) % 3], seg=6)
    lk.cyl('RopeCoil', c1 - 0.6, 0.35, 1.76, 0.22, 0.07, ROPE, seg=14)
    # the painted panel at the bow end of the cabin: a diamond in the lining colour on the panel colour
    LINE = lk.mat('Lining', line, rough=0.4, glow=0.25)
    for sd in (-1, 1):
        lk.box('BowPanel', c1 - 0.7, sd * (cw + 0.005), 0.55, 0.9, 0.01, 0.85, END)
        y = sd * (cw + 0.012); dx, cz, hh = c1 - 0.7, 0.97, 0.3
        lk.quad('Diamond', [(dx - 0.22, y, cz), (dx, y, cz - hh), (dx + 0.22, y, cz), (dx, y, cz + hh)] if sd < 0 else [(dx + 0.22, y, cz), (dx, y, cz - hh), (dx - 0.22, y, cz), (dx, y, cz + hh)], LINE)
    # bow well with a cratch board and its cover, the stern deck with tiller, rudder and the rope fenders
    taper2('Cratch', [(c1, -cw + 0.1), (c1, cw - 0.1)] + [(c1 + 1.4, 0.05), (c1 + 1.4, -0.05)], 0.36, [(c1 + 0.3, 0)], 1.55, TARP)
    lk.box('Tiller', -L / 2 + 0.55, 0, 1.0, 1.3, 0.05, 0.05, BRASS)
    lk.box('TillerPost', -L / 2 + 0.25, 0, 0.36, 0.08, 0.08, 0.7, BLACK)
    lk.box('Rudder', -L / 2 - 0.35, 0, -0.5, 0.7, 0.07, 0.95, BLACK)
    lk.cyl('BowFender', L / 2 - 0.05, 0, -0.1, 0.16, 0.45, ROPE, seg=10)
    lk.cyl('SternFender', -L / 2 + 0.05, 0, -0.1, 0.18, 0.4, ROPE, seg=10)
    for x in (-5.5, 0.0, 5.5): lk.box('SideFender', x, -hb - 0.08, -0.05, 0.4, 0.12, 0.28, ROPE)

for i in range(4):
    lk.start(); boat(i)
    lk.export(os.path.join(OUTDIR, f'boat-{i + 1}.glb'), f'Boat{i + 1}')
    if PNG and i == 0: lk.preview(PNG, (12, -12, 5), (0, 0, 0.6), lens=30, ground_z=-0.6)
