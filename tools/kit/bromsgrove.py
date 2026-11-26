# Bromsgrove landmarks for RideWorld's open world (2026-11-18), using the London kit's helpers (tools/kit/london/lk.py).
#   /snap/bin/blender -b --python tools/kit/bromsgrove.py -- <name> <out.glb> [preview.png]
#   names: queens_head
# X east, Y north, Z up, metres; origin = the footprint's centre at ground level (placed by landmarks.mjs, heading 0).
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'london'))
import lk, bpy, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pubkit import Elev, Frame, tiles, plain, cavalier, wall_ring, clip_half
import numpy as np
from mathutils import Matrix, Vector

A = lk.args(); NAME, OUT = A[0], A[1]; PNG = A[2] if len(A) > 2 else None
lk.start()

# The Queen's Head Inn, Stoke Pound (the owner: "iconic, needs to look beautiful"; his Street View photos 2026-11-18 on the
# share, rideworld/photos/Screenshot 2026-11-18 1157..1158). OSM building 443 of the world file is three buildings
# joined: points in metres east / north of its centre (52.309216, -2.057295). The canal runs north-east past the south-
# east side; Sugarbrook Lane along the west, over Stoke Pound bridge at the south-west corner.
P = {'A': (-5.09, -5.81), 'B': (1.37, -11.56), 'C': (-5.09, -18.63), 'D': (-18.08, -6.91), 'E': (9.12, 22.93),
     'F': (12.52, 19.84), 'G': (8.85, 15.75), 'H': (18.17, 7.46), 'I': (4.84, -7.13), 'J': (-4.82, 1.6), 'K': (-10.12, -4.26),
     'L': (-6.59, -7.47)}
poly = lambda s: [P[c] for c in s]
MAIN = poly('CDKLAB')        # the old pub: two storeys, by the bridge
WING = poly('DEFGJK')        # the low wing along the lane (slate, garage doors)
REST = poly('AJGHIB')        # the canal-side restaurant (cream, oak-framed glass doors)
RENDER = np.array((0.77, 0.74, 0.69)); CREAM = np.array((0.92, 0.89, 0.81))
TILE = (0.45, 0.27, 0.2); SLATE = (0.3, 0.31, 0.34)

def casements(base, size=512, storeys=2, h_frac=0.42):
    """painted render with white multi-pane casement windows, one per bay per storey"""
    img = np.ones((size, size, 3), np.float32) * np.array(base) * (1 + lk.noise(size, size, 0.025, 2))
    sh = size // storeys
    for s in range(storeys):
        x0, x1 = int(size * 0.3), int(size * 0.7); y0 = s * sh + int(sh * 0.22); y1 = y0 + int(sh * h_frac)
        img[y0 - 7:y1 + 7, x0 - 7:x1 + 7] = (0.97, 0.97, 0.96)
        g = np.linspace(1.2, 0.7, y1 - y0)[:, None, None] * np.array((0.3, 0.35, 0.4))
        img[y0:y1, x0:x1] = g
        for k in (1, 2): img[y0:y1, x0 + k * (x1 - x0) // 3 - 3:x0 + k * (x1 - x0) // 3 + 3] = (0.97, 0.97, 0.96)
        img[(y0 + y1) // 2 - 3:(y0 + y1) // 2 + 3, x0:x1] = (0.97, 0.97, 0.96)
        img[y1 + 7:y1 + 16, x0 - 14:x1 + 14] = np.array(base) * 0.85
    img[size - 22:] = np.array(base) * 0.6
    return img

def glazed_doors(size=512):
    """the restaurant: cream render with tall oak-framed glazed doors (one 4 m bay, 3 m high)"""
    img = np.ones((size, size, 3), np.float32) * CREAM * (1 + lk.noise(size, size, 0.02, 2))
    x0, x1, y0, y1 = 60, 452, 70, 500
    img[y0:y1, x0:x1] = (0.55, 0.36, 0.18)
    for k in range(4):
        px0 = x0 + 14 + k * (x1 - x0 - 14) // 4; px1 = px0 + (x1 - x0 - 14) // 4 - 14
        g = np.linspace(1.1, 0.75, y1 - y0 - 28)[:, None, None] * np.array((0.22, 0.25, 0.28))
        img[y0 + 14:y1 - 14, px0:px1] = g
        img[y0 + 120:y0 + 126, px0:px1] = (0.55, 0.36, 0.18)
    return img

def text_obj(body, size, pos, rot_z, material, extrude=0.01):
    """a line of lettering as a mesh, upright, reading along direction rot_z (radians from east)"""
    cu = bpy.data.curves.new('T', 'FONT'); cu.body = body; cu.size = size; cu.extrude = extrude; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    o = bpy.data.objects.new('Text', cu); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(o)
    me.transform(Matrix.Translation(pos) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    m2 = bpy.data.objects.new('Lettering', me); bpy.context.scene.collection.objects.link(m2)
    me.materials.append(material); lk.objs.append(m2)
    return m2

def outward(polyg, i):
    """the wall from point i to i+1: midpoint, unit direction along it, outward normal (either winding), length"""
    n = len(polyg)
    a2 = sum(polyg[k][0] * polyg[(k + 1) % n][1] - polyg[(k + 1) % n][0] * polyg[k][1] for k in range(n))
    a, b = polyg[i], polyg[(i + 1) % n]; L = math.hypot(b[0] - a[0], b[1] - a[1]); ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = (uy, -ux) if a2 > 0 else (-uy, ux)
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), (ux, uy), (nx, ny), L

def offset_poly(polyg, d):
    """each wall line moved d metres inwards, neighbours intersected (Blender's inset gave up on these concave shapes)"""
    n = len(polyg)
    a2 = sum(polyg[k][0] * polyg[(k + 1) % n][1] - polyg[(k + 1) % n][0] * polyg[k][1] for k in range(n))
    lines = []
    for k in range(n):
        a, b = polyg[k], polyg[(k + 1) % n]; L = math.hypot(b[0] - a[0], b[1] - a[1]); ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = (-uy, ux) if a2 > 0 else (uy, -ux)   # inward
        lines.append(((a[0] + nx * d, a[1] + ny * d), (ux, uy)))
    out = []
    for k in range(n):
        (p1, d1), (p2, d2) = lines[k - 1], lines[k]
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-6: out.append(p2); continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
        out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out

def hip_roof(name, polyg, eaves, inset, rise, material, overhang=0.35):
    """a hipped roof: the footprint (pushed out a little for the eaves) sloping up to the footprint inset, a flat top"""
    return lk.taper(name, offset_poly(polyg, -overhang), eaves, offset_poly(polyg, inset), eaves + rise, material, uv=2)

def queens_head():
    WALLM = lk.mat('Render', img=lk.image('render', casements(RENDER)), rough=0.85, glow=0.25)
    WINGM = lk.mat('WingRender', img=lk.image('wing', casements(RENDER * 1.03, storeys=1, h_frac=0.3)), rough=0.85, glow=0.25)
    RESTM = lk.mat('Restaurant', img=lk.image('rest', glazed_doors()), rough=0.8, glow=0.25)
    TILEM = lk.mat('Tiles', img=lk.image('tiles', lk.brick(TILE, rows=32, cols=8, mortar=(0.32, 0.2, 0.15))), rough=0.75, glow=0.18)
    SLATEM = lk.mat('Slate', img=lk.image('slate', lk.ashlar(SLATE, rows=24, cols=6, mortar=0.8, jitter=0.05)), rough=0.7, glow=0.15)
    BRICK = lk.mat('Brick', img=lk.image('br', lk.brick((0.58, 0.3, 0.22))), glow=0.2)
    STACK = lk.mat('Stack', (0.76, 0.73, 0.68), glow=0.25)
    POT = lk.mat('Pot', (0.62, 0.32, 0.22), glow=0.2)
    DARK = lk.mat('Iron', (0.05, 0.05, 0.06), rough=0.5, metal=0.4, glow=0.08)
    INK = lk.mat('Ink', (0.18, 0.18, 0.2), glow=0.1)
    WHITE = lk.mat('Board', (0.95, 0.94, 0.9), glow=0.35)
    WOOD = lk.mat('Wood', (0.5, 0.36, 0.22), rough=0.85, glow=0.15)
    CANVAS = lk.mat('Canvas', (0.95, 0.94, 0.9), rough=0.9, glow=0.35)
    GLOW = lk.mat('Glow', (0.98, 0.9, 0.7), glow=0.8)
    # the three buildings
    lk.prism('Main', MAIN, 0, 5.8, WALLM, uv=4, uvz=6, top=False)
    hip_roof('MainRoof', MAIN, 5.8, 3.4, 3.2, TILEM)
    lk.prism('Wing', WING, 0, 2.8, WINGM, uv=4, uvz=3, top=False)
    hip_roof('WingRoof', WING, 2.8, 2.0, 1.9, SLATEM)
    lk.prism('Restaurant', REST, 0, 3.0, RESTM, uv=4, uvz=3, top=False)
    hip_roof('RestRoof', REST, 3.0, 4.0, 2.6, TILEM)
    # the front (C -> D, facing the lane): a tile canopy over the ground-floor bays, the name lettered above it
    (mx, my), (ux, uy), (nx, ny), L = outward(MAIN, 0)
    rot = math.atan2(uy, ux); hl = L * 0.42
    q = lambda s, n: (mx + ux * hl * s + nx * n, my + uy * hl * s + ny * n)
    lk.taper('Canopy', [q(-1, 0), q(1, 0), q(1, 1.6), q(-1, 1.6)], 2.6, [q(-1, 0), q(1, 0), q(1, 0.3), q(-1, 0.3)], 3.4, TILEM)
    lk.box('BrickPlinth', mx + nx * 1.8, my + ny * 1.8, 0, L * 0.86, 0.35, 0.7, BRICK, rot=rot)
    text_obj("THE QUEENS HEAD", 0.42, (mx + nx * 0.03, my + ny * 0.03, 4.0), rot + (0 if nx * -uy + ny * ux < 0 else math.pi), INK)
    # the canal-end gable (B -> C): the big white sign and the chimney stack over it
    (gx, gy), (ux2, uy2), (nx2, ny2), L2 = outward(MAIN, 5)
    rot2 = math.atan2(uy2, ux2); flip2 = 0 if nx2 * -uy2 + ny2 * ux2 < 0 else math.pi
    sgx, sgy = gx + ux2 * L2 * 0.17, gy + uy2 * L2 * 0.17   # the sign, beside the stack
    cx2, cy2 = gx - ux2 * L2 * 0.2, gy - uy2 * L2 * 0.2      # the chimney stack
    lk.box('SignFrame', sgx + nx2 * 0.03, sgy + ny2 * 0.03, 2.3, 2.4, 0.04, 2.1, INK, rot=rot2)
    lk.box('SignBoard', sgx + nx2 * 0.07, sgy + ny2 * 0.07, 2.4, 2.2, 0.06, 1.9, WHITE, rot=rot2)
    text_obj("THE QUEENS", 0.3, (sgx + nx2 * 0.12, sgy + ny2 * 0.12, 3.8), rot2 + flip2, INK)
    text_obj("STOKE POUND", 0.13, (sgx + nx2 * 0.12, sgy + ny2 * 0.12, 3.3), rot2 + flip2, INK)
    text_obj("HEAD", 0.36, (sgx + nx2 * 0.12, sgy + ny2 * 0.12, 2.8), rot2 + flip2, INK)
    lk.box('Chimney', cx2 + nx2 * 0.4, cy2 + ny2 * 0.4, 0, 1.6, 1.0, 10.4, STACK, rot=rot2)
    lk.cyl('Pot', cx2 + nx2 * 0.4, cy2 + ny2 * 0.4, 10.4, 0.18, 0.7, POT, seg=8)
    lk.cyl('Pot2', cx2 + nx2 * 0.4 + ux2 * 0.45, cy2 + ny2 * 0.4 + uy2 * 0.45, 10.4, 0.16, 0.6, POT, seg=8)
    # the canal terrace in front of the restaurant: black iron railings and double-lantern lamp posts
    can0, cdir = (3.82, -17.41), (0.733, 0.680)            # the canal's line here, from the world file
    nrm = (-cdir[1], cdir[0])                               # towards the pub (north-west)
    at = lambda t, n: (can0[0] + cdir[0] * t + nrm[0] * n, can0[1] + cdir[1] * t + nrm[1] * n)
    rail_rot = math.atan2(cdir[1], cdir[0])
    t0, t1 = -2, 30
    m = at((t0 + t1) / 2, 2.6)
    lk.box('RailTop', m[0], m[1], 1.0, t1 - t0, 0.05, 0.05, DARK, rot=rail_rot)
    lk.box('RailLow', m[0], m[1], 0.25, t1 - t0, 0.05, 0.05, DARK, rot=rail_rot)
    for k in range(int((t1 - t0) / 0.6)):
        p = at(t0 + k * 0.6, 2.6); lk.box('Baluster', p[0], p[1], 0.2, 0.025, 0.025, 0.85, DARK)
    for t in range(t0 + 2, t1, 8):
        p = at(t, 2.9)
        lk.cyl('LampPost', p[0], p[1], 0, 0.06, 3.2, DARK, seg=8)
        for s in (-1, 1):
            qq = (p[0] + cdir[0] * 0.35 * s, p[1] + cdir[1] * 0.35 * s)
            lk.box('LampArm', (p[0] + qq[0]) / 2, (p[1] + qq[1]) / 2, 3.1, 0.7, 0.04, 0.04, DARK, rot=rail_rot)
            lk.box('Lantern', qq[0], qq[1], 2.85, 0.22, 0.22, 0.32, GLOW)
    for t in (4, 10, 16, 22):  # terrace tables by the restaurant doors
        p = at(t, 4.4); lk.cyl('Table', p[0], p[1], 0.72, 0.4, 0.04, WOOD, seg=12); lk.cyl('TableLeg', p[0], p[1], 0, 0.05, 0.72, DARK, seg=6)
        for s in (-1, 1): qq = (p[0] + cdir[0] * 0.7 * s, p[1] + cdir[1] * 0.7 * s); lk.box('Chair', qq[0], qq[1], 0, 0.45, 0.45, 0.85, lk.mat('Wicker', (0.35, 0.32, 0.3), glow=0.15))
    # the garden beyond, along the canal: white parasols over picnic tables, the white marquee and the tipi
    for t in range(44, 60, 3):
        for n in (5.0, 9.5):
            p = at(t + (1.5 if n > 6 else 0), n)
            lk.box('Picnic', p[0], p[1], 0, 1.8, 1.5, 0.75, WOOD, rot=rail_rot)
            lk.cyl('ParasolPole', p[0], p[1], 0, 0.04, 2.6, CANVAS, seg=6)
            lk.cyl('Parasol', p[0], p[1], 2.0, 1.5, 0.6, CANVAS, seg=10, r2=0.06)
    m = at(37, 11)
    corners = [(m[0] + cdir[0] * sx * 5.5 + nrm[0] * sy * 3.5, m[1] + cdir[1] * sx * 5.5 + nrm[1] * sy * 3.5) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    lk.prism('Marquee', corners, 0, 2.6, lk.mat('MarqueeSide', (0.96, 0.96, 0.94), rough=0.9, glow=0.35), uv=3, bottom=False)
    ridge = [(m[0] - cdir[0] * 5.5, m[1] - cdir[1] * 5.5), (m[0] + cdir[0] * 5.5, m[1] + cdir[1] * 5.5)]
    lk.taper('MarqueeRoof', corners, 2.6, [ridge[0], ridge[1], ridge[1], ridge[0]], 4.0, CANVAS, cap=False)
    tp = at(62, 9)
    lk.cyl('Tipi', tp[0], tp[1], 0, 3.2, 7.0, lk.mat('TipiCanvas', (0.8, 0.68, 0.5), rough=0.9, glow=0.3), seg=12, r2=0.0)
    for k in range(5):
        a = k * 2 * math.pi / 5; lk.tube('TipiPole', (tp[0], tp[1], 6.0), (tp[0] + 0.5 * math.cos(a), tp[1] + 0.5 * math.sin(a), 8.0), 0.05, WOOD, seg=4)

def tardebigge_church():
    """St Bartholomew's, Tardebigge (Francis Hiorn, 1777; Grade I): the landmark over the lock flight. A plain Georgian
    nave of pale ashlar with tall round-headed windows and a slate roof, a rounded east end, and the west tower: square
    stages to the belfry, a balustraded cornice with urns, a columned octagonal stage and the slender needle spire,
    about 41 m (135 ft) to the tip. The OSM footprint (w121519283) runs ~10.5 deg north of east; origin = its centre."""
    a = math.radians(10.48); ca, sa = math.cos(a), math.sin(a)
    O = (-10.0, -2.91)                                      # a point on the axis, in footprint metres
    T = lambda u, v: (O[0] + u * ca - v * sa, O[1] + u * sa + v * ca)
    R = lambda pts: [T(u, v) for u, v in pts]
    STONE = (0.78, 0.74, 0.66)
    ash = lk.ashlar(STONE, rows=10, cols=3)
    WALL = lk.mat('Ashlar', img=lk.image('ash', ash), rough=0.85, glow=0.22)
    WIN = lk.mat('NaveWindows', img=lk.image('navewin', lk.windows(ash, glass=(0.18, 0.2, 0.24), nx=1, ny=1, w=0.42, h=0.62, arched=True)), rough=0.8, glow=0.2)
    SLATEM = lk.mat('Slate', img=lk.image('slate', lk.ashlar((0.27, 0.28, 0.31), rows=16, cols=6, mortar=0.7)), rough=0.7, glow=0.12)
    LEAD = lk.mat('Lead', (0.42, 0.44, 0.46), rough=0.5, glow=0.15)
    DARK = lk.mat('Louvres', (0.12, 0.12, 0.13), rough=0.8, glow=0.05)
    GOLD = lk.mat('Gilt', (0.75, 0.6, 0.25), rough=0.3, metal=0.8, glow=0.25)
    HW, U0, U1 = 6.3, -12.7, 14.0                           # nave half width; west and east ends along the axis
    EAVE = 8.2
    # nave: walls with a window every 4 m (one texture repeat per bay), a plinth and a cornice
    lk.prism('Plinth', R([(U0, -HW - 0.15), (U1, -HW - 0.15), (U1, HW + 0.15), (U0, HW + 0.15)]), -3.0, 0.6, WALL, uv=4.0)
    lk.prism('Nave', R([(U0, -HW), (U1, -HW), (U1, HW), (U0, HW)]), 0.6, EAVE, WIN, uv=4.0, uvz=7.6)
    lk.prism('Cornice', R([(U0 - 0.2, -HW - 0.3), (U1, -HW - 0.3), (U1, HW + 0.3), (U0 - 0.2, HW + 0.3)]), EAVE, EAVE + 0.4, WALL, uv=2.0)
    # pitched slate roof over the nave (a closed prism, triangle in section)
    bm = bmesh.new(); RISE = 4.2
    def V(u, v, z): return bm.verts.new((*T(u, v), z))
    w0 = [V(U0, -HW - 0.35, EAVE + 0.4), V(U0, HW + 0.35, EAVE + 0.4), V(U0, 0, EAVE + 0.4 + RISE)]
    e0 = [V(U1 + 0.3, -HW - 0.35, EAVE + 0.4), V(U1 + 0.3, HW + 0.35, EAVE + 0.4), V(U1 + 0.3, 0, EAVE + 0.4 + RISE)]
    bm.faces.new(w0); bm.faces.new(e0[::-1])
    for i in range(3): bm.faces.new((w0[i], w0[(i + 1) % 3], e0[(i + 1) % 3], e0[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('NaveRoof', bm, SLATEM, 2.0)
    # the rounded east end: a half-polygon apse, a little lower, with a lead half-cone roof
    N = 8; RA = 5.4; C0 = 14.0
    ap = [(C0, -RA)] + [(C0 + RA * math.sin(math.pi * k / N), -RA * math.cos(math.pi * k / N)) for k in range(1, N)] + [(C0, RA)]
    lk.prism('ApsePlinth', R([(u + (u - C0) * 0.03, v * 1.03) for u, v in ap]), -3.0, 0.6, WALL, uv=4.0)
    lk.prism('Apse', R(ap), 0.6, EAVE - 0.8, WIN, uv=4.0, uvz=7.6)
    lk.taper('ApseRoof', R([(C0 + (u - C0) * 1.06, v * 1.06) for u, v in ap]), EAVE - 0.8, [T(C0, 0)], EAVE + 2.6, LEAD, uv=2.0)
    # the west tower: 5.6 m square, over the nave's west end
    TS, TU = 5.6, U0 + 2.6
    sq = lambda s, z0, z1, m, name, uvz=None: lk.prism(name, R([(TU - s / 2, -s / 2), (TU + s / 2, -s / 2), (TU + s / 2, s / 2), (TU - s / 2, s / 2)]), z0, z1, m, uv=s, uvz=uvz)
    sq(TS + 0.4, -3.0, 0.8, WALL, 'TowerPlinth')
    sq(TS, 0.8, 15.0, WALL, 'Tower')
    for z in (5.0, 10.0, 15.0): sq(TS + 0.3, z, z + 0.35, WALL, 'StringCourse')
    # belfry stage: louvred round-headed openings on each face (dark insets in a slightly smaller block)
    sq(TS - 0.2, 15.35, 20.0, WALL, 'Belfry')
    for (du, dv, along) in ((TS / 2 - 0.05, 0, 'v'), (-TS / 2 + 0.05, 0, 'v'), (0, TS / 2 - 0.05, 'u'), (0, -TS / 2 + 0.05, 'u')):
        cu, cv = TU + du, dv
        pts = [(cu - 0.08, cv - 0.75), (cu + 0.08, cv - 0.75), (cu + 0.08, cv + 0.75), (cu - 0.08, cv + 0.75)] if along == 'v' else [(cu - 0.75, cv - 0.08), (cu + 0.75, cv - 0.08), (cu + 0.75, cv + 0.08), (cu - 0.75, cv + 0.08)]
        lk.prism('BelfryOpening', R(pts), 16.2, 19.0, DARK, uv=1.0)
    sq(TS + 0.5, 20.0, 20.6, WALL, 'TowerCornice')
    sq(TS + 0.2, 20.6, 21.5, WALL, 'Balustrade')
    for du in (-1, 1):
        for dv in (-1, 1):
            c = T(TU + du * (TS / 2 - 0.15), dv * (TS / 2 - 0.15))
            lk.cyl('UrnBase', c[0], c[1], 21.5, 0.28, 0.5, WALL, seg=10)
            lk.dome('Urn', c[0], c[1], 22.0, 0.3, 0.7, WALL, seg=10, rings=5)
    # columned octagonal stage, its own cornice, then the needle spire
    oc = lambda r: [T(TU + r * math.cos(math.pi / 8 + k * math.pi / 4), r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    lk.prism('Octagon', oc(1.9), 21.5, 26.0, WALL, uv=2.0)
    for k in range(8):
        c = T(TU + 2.2 * math.cos(k * math.pi / 4), 2.2 * math.sin(k * math.pi / 4))
        lk.cyl('Column', c[0], c[1], 21.5, 0.17, 4.5, WALL, seg=10)
        o = T(TU + 1.93 * math.cos(k * math.pi / 4), 1.93 * math.sin(k * math.pi / 4))
        lk.cyl('OctOpening', o[0], o[1], 22.6, 0.35, 2.4, DARK, seg=6)
    lk.prism('OctCornice', oc(2.55), 26.0, 26.5, WALL, uv=2.0)
    lk.taper('Spire', oc(2.0), 26.5, [T(TU, 0)], 40.2, WALL, uv=2.0)
    for z in (30.0, 34.0):  # spire bands (lucarne rings, simplified)
        f = (z - 26.5) / 13.7; lk.taper('SpireBand', oc(2.0 * (1 - f) + 0.08), z, oc(2.0 * (1 - f - 0.02) + 0.08), z + 0.3, WALL, uv=1.0)
    t = T(TU, 0)
    lk.cyl('Finial', t[0], t[1], 40.0, 0.05, 1.2, GOLD, seg=8)
    lk.dome('Ball', t[0], t[1], 40.3, 0.16, 0.3, GOLD, seg=10, rings=5)
    lk.box('Vane', t[0] + 0.25, t[1], 40.9, 0.6, 0.03, 0.22, GOLD)

def engine_house():
    """Tardebigge Engine House by lock 57 (built 1823 to pump water up to the summit; now a home and venue), from the owner's
    Street View captures (share rideworld/photos/engine house): a tall narrow engine tower of dark red brick with a gable
    and small windows, a two-storey gabled block with round-arched ground-floor windows and doors, sash windows above and
    half-moon windows in the gable, and a single-storey wing with tall arched windows and a railed roof terrace under a
    pergola. On OSM's footprint (world building 3365: 27 x 14 m, long side along the canal); origin = landmark point."""
    A, B, D = (1.2, -9.2), (-18.8, -27.6), (-8.1, 0.9)            # footprint corners (m east / north of the landmark point)
    Lu = math.hypot(B[0] - A[0], B[1] - A[1]); U = ((B[0] - A[0]) / Lu, (B[1] - A[1]) / Lu)          # NE end -> SW end
    Lv = math.hypot(D[0] - A[0], D[1] - A[1]); V = ((D[0] - A[0]) / Lv, (D[1] - A[1]) / Lv)          # back -> canal side
    O = (A[0] + U[0] * Lu / 2 + V[0] * Lv / 2, A[1] + U[1] * Lu / 2 + V[1] * Lv / 2)
    T = lambda u, v: (O[0] + u * U[0] + v * V[0], O[1] + u * U[1] + v * V[1])
    R = lambda pts: [T(u, v) for u, v in pts]
    hu, hv = Lu / 2, Lv / 2
    BR = (0.43, 0.21, 0.16)
    brick = lk.brick(BR, rows=24, cols=6, mortar=(0.6, 0.55, 0.5))
    WALL = lk.mat('EBrick', img=lk.image('ebrick', brick), rough=0.9, glow=0.18)
    LOWER = lk.mat('ArchWin', img=lk.image('archwin', lk.windows(brick, glass=(0.12, 0.14, 0.17), frame=(0.82, 0.82, 0.78), nx=1, ny=1, w=0.5, h=0.7, arched=True)), rough=0.85, glow=0.18)
    UPPER = lk.mat('SashWin', img=lk.image('sashwin', lk.windows(brick, glass=(0.12, 0.14, 0.17), frame=(0.82, 0.82, 0.78), nx=1, ny=1, w=0.34, h=0.5)), rough=0.85, glow=0.18)
    TOWERW = lk.mat('TowerWin', img=lk.image('towerwin', lk.windows(brick, glass=(0.12, 0.14, 0.17), frame=(0.82, 0.82, 0.78), nx=1, ny=1, w=0.22, h=0.42)), rough=0.85, glow=0.18)
    SLATE = lk.mat('ESlate', img=lk.image('eslate', lk.ashlar((0.25, 0.26, 0.29), rows=16, cols=6, mortar=0.7)), rough=0.7, glow=0.12)
    IRON = lk.mat('Iron', (0.08, 0.08, 0.09), rough=0.5, glow=0.05)
    TIMBER = lk.mat('Pergola', (0.32, 0.3, 0.27), rough=0.8, glow=0.12)
    def gable_roof(name, u0, u1, v0, v1, eave, rise, along_u=True):
        bm = bmesh.new(); Vt = lambda u, v, z: bm.verts.new((*T(u, v), z))
        if along_u:
            a = [Vt(u0, v0, eave), Vt(u0, v1, eave), Vt(u0, (v0 + v1) / 2, eave + rise)]; c = [Vt(u1, v0, eave), Vt(u1, v1, eave), Vt(u1, (v0 + v1) / 2, eave + rise)]
        else:
            a = [Vt(u0, v0, eave), Vt(u1, v0, eave), Vt((u0 + u1) / 2, v0, eave + rise)]; c = [Vt(u0, v1, eave), Vt(u1, v1, eave), Vt((u0 + u1) / 2, v1, eave + rise)]
        bm.faces.new(a); bm.faces.new(c[::-1])
        for i in range(3): bm.faces.new((a[i], a[(i + 1) % 3], c[(i + 1) % 3], c[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish(name, bm, SLATE, 2.0)
    def gable_end(name, u, v0, v1, eave, rise, mat):  # the triangle of brick above the eaves at an end, as a thin solid
        bm = bmesh.new(); Vt = lambda uu, v, z: bm.verts.new((*T(uu, v), z))
        a = [Vt(u - 0.05, v0, eave), Vt(u - 0.05, v1, eave), Vt(u - 0.05, (v0 + v1) / 2, eave + rise)]; c = [Vt(u + 0.05, v0, eave), Vt(u + 0.05, v1, eave), Vt(u + 0.05, (v0 + v1) / 2, eave + rise)]
        bm.faces.new(a); bm.faces.new(c[::-1])
        for i in range(3): bm.faces.new((a[i], a[(i + 1) % 3], c[(i + 1) % 3], c[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish(name, bm, mat, 3.0)
    # the two-storey block at the NE end: arched windows below, sashes above, a slate roof along the canal
    bu0, bu1 = -hu, -hu + 10.5
    lk.prism('BlockPlinth', R([(bu0, -hv), (bu1, -hv), (bu1, hv), (bu0, hv)]), -3.0, 0.3, WALL, uv=3.0)
    lk.prism('BlockGround', R([(bu0, -hv), (bu1, -hv), (bu1, hv), (bu0, hv)]), 0.3, 3.2, LOWER, uv=2.6, uvz=2.9)
    lk.prism('BlockFirst', R([(bu0, -hv), (bu1, -hv), (bu1, hv), (bu0, hv)]), 3.2, 6.2, UPPER, uv=2.6, uvz=3.0)
    lk.prism('BlockEaves', R([(bu0 - 0.15, -hv - 0.15), (bu1, -hv - 0.15), (bu1, hv + 0.15), (bu0 - 0.15, hv + 0.15)]), 6.2, 6.35, WALL, uv=2.0)
    gable_end('BlockGable', bu0 + 0.05, -hv, hv, 6.35, 3.6, WALL)
    gable_roof('BlockRoof', bu0 - 0.25, bu1, -hv - 0.3, hv + 0.3, 6.35, 3.6, along_u=False) if False else gable_roof('BlockRoof', bu0 - 0.25, bu1, -hv - 0.3, hv + 0.3, 6.35, 3.6, along_u=True)
    # a half-moon window high in the NE gable (dark glass in a pale frame), and its brick arch
    c = T(bu0 - 0.02, 0.0); lk.cyl('Lunette', c[0], c[1], 7.4, 0.55, 0.06, IRON, seg=12)
    # the engine tower behind (away from the canal): narrow and tall, small windows, its own gable
    tu0, tu1, tv0, tv1 = bu1 - 2.5, bu1 + 4.0, -hv, -hv + 6.2
    lk.prism('Tower', R([(tu0, tv0), (tu1, tv0), (tu1, tv1), (tu0, tv1)]), -3.0, 16.5, TOWERW, uv=3.2, uvz=4.0)
    lk.prism('TowerEaves', R([(tu0 - 0.15, tv0 - 0.15), (tu1 + 0.15, tv0 - 0.15), (tu1 + 0.15, tv1 + 0.15), (tu0 - 0.15, tv1 + 0.15)]), 16.5, 16.65, WALL, uv=2.0)
    gable_roof('TowerRoof', tu0 - 0.2, tu1 + 0.2, tv0 - 0.2, tv1 + 0.2, 16.65, 2.6, along_u=False)
    for vv in (tv0, tv1):
        bm = bmesh.new(); Vt = lambda uu, v, z: bm.verts.new((*T(uu, v), z))
        a = [Vt(tu0, vv - 0.05, 16.65), Vt(tu1, vv - 0.05, 16.65), Vt((tu0 + tu1) / 2, vv - 0.05, 19.25)]; cc = [Vt(tu0, vv + 0.05, 16.65), Vt(tu1, vv + 0.05, 16.65), Vt((tu0 + tu1) / 2, vv + 0.05, 19.25)]
        bm.faces.new(a); bm.faces.new(cc[::-1])
        for i in range(3): bm.faces.new((a[i], a[(i + 1) % 3], cc[(i + 1) % 3], cc[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('TowerGable', bm, WALL, 3.0)
    # the single-storey wing to the SW: tall arched windows, a flat roof terrace with iron railings, a pergola by the block
    wu0, wu1, wv0, wv1 = bu1, hu, -hv, hv - 2.4
    lk.prism('Wing', R([(wu0, wv0), (wu1, wv0), (wu1, wv1), (wu0, wv1)]), -3.0, 4.6, LOWER, uv=2.4, uvz=4.6)
    lk.prism('WingParapet', R([(wu0, wv0 - 0.1), (wu1 + 0.1, wv0 - 0.1), (wu1 + 0.1, wv1 + 0.1), (wu0, wv1 + 0.1)]), 4.6, 5.0, WALL, uv=2.0)
    lk.prism('WingRoof', R([(wu0, wv0 + 0.25), (wu1 - 0.25, wv0 + 0.25), (wu1 - 0.25, wv1 - 0.25), (wu0, wv1 - 0.25)]), 4.6, 4.75, SLATE, uv=2.0)
    # railings round the terrace: posts and a top rail along the canal side and the far end
    for (u0, v0, u1, v1) in ((wu0 + 1, wv1, wu1, wv1), (wu1, wv0, wu1, wv1)):
        n = max(2, int(math.hypot(u1 - u0, v1 - v0) / 1.5))
        for k in range(n + 1):
            uu, vv = u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n; c = T(uu, vv)
            lk.box('RailPost', c[0], c[1], 5.0, 0.06, 0.06, 1.1, IRON)
        a, b2 = T(u0, v0), T(u1, v1); mid = ((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2)
        lk.box('Rail', mid[0], mid[1], 6.05, math.hypot(b2[0] - a[0], b2[1] - a[1]), 0.06, 0.06, IRON, rot=math.atan2(b2[1] - a[1], b2[0] - a[0]))
    for k in range(5):  # pergola beams over the terrace by the block
        uu = wu0 + 0.6 + k * 0.9; a, b2 = T(uu, wv0 + 1.0), T(uu, wv1 + 0.4); mid = ((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2)
        lk.box('PergolaBeam', mid[0], mid[1], 7.0, math.hypot(b2[0] - a[0], b2[1] - a[1]), 0.12, 0.18, TIMBER, rot=math.atan2(b2[1] - a[1], b2[0] - a[0]))
    for vv in (wv0 + 1.0, wv1 + 0.2):
        c = T(wu0 + 4.2, vv); lk.box('PergolaPost', c[0], c[1], 4.75, 0.14, 0.14, 2.4, TIMBER)
    # a chimney on the block
    c = T(bu0 + 2.0, 1.0); lk.box('Chimney', c[0], c[1], 8.0, 0.6, 0.6, 2.6, WALL)

def tardebigge_tunnel():
    """The west portal of Tardebigge Tunnel (580 yd, 1810), from the owner's photo (share rideworld/photos/tardebigge tunnel):
    a headwall of red-brown sandstone blocks with a low round arch at the water, a coping along its top, the hill and its
    trees over it; no towpath through (horses went over the top). X out of the tunnel along the canal, Y left, z = 0 at the
    summit pound's water."""
    ST = lk.mat('Sandstone', img=lk.image('sand', lk.ashlar((0.5, 0.38, 0.3), rows=10, cols=4, mortar=0.8, jitter=0.07)), rough=0.95, glow=0.18)
    COPE = lk.mat('Cope', img=lk.image('cope2', lk.ashlar((0.56, 0.45, 0.36), rows=1, cols=6, mortar=0.85, jitter=0.05)), rough=0.9, glow=0.2)
    DARK = lk.mat('TunnelDark', (0.02, 0.02, 0.02), rough=1.0, glow=0.0)
    W2, H, AW, AH = 6.5, 5.6, 2.5, 3.5       # half width of the headwall, its height, the arch's half span and its crown
    SP = AH - AW; N = 18  # (a true semicircle on short upright sides, as the photo)
    arch = [(AW, -0.6)] + [(AW * math.cos(math.pi * k / N), SP + AW * math.sin(math.pi * k / N)) for k in range(N + 1)] + [(-AW, -0.6)]
    # the headwall: columns either side of the arch and the spandrel over it, a closed slab 1.2 m deep (x 0..-1.2)
    lk.prism('WallL', [(-1.2, AW), (0.0, AW), (0.0, W2), (-1.2, W2)], -2.0, H, ST, uv=2.0)
    lk.prism('WallR', [(-1.2, -W2), (0.0, -W2), (0.0, -AW), (-1.2, -AW)], -2.0, H, ST, uv=2.0)
    for (y0, z0), (y1, z1) in zip(arch, arch[1:]):
        bm = bmesh.new(); Vt = lambda x, y, z: bm.verts.new((x, y, z))
        a = [Vt(0.0, y0, z0), Vt(0.0, y1, z1), Vt(0.0, y1, H), Vt(0.0, y0, H)]; c = [Vt(-1.2, y0, z0), Vt(-1.2, y1, z1), Vt(-1.2, y1, H), Vt(-1.2, y0, H)]
        bm.faces.new(a); bm.faces.new(c[::-1])
        for i in range(4): bm.faces.new((a[i], a[(i + 1) % 4], c[(i + 1) % 4], c[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('Spandrel', bm, ST, 2.0)
    lk.prism('Coping', [(-1.35, -W2 - 0.15), (0.15, -W2 - 0.15), (0.15, W2 + 0.15), (-1.35, W2 + 0.15)], H, H + 0.3, COPE, uv=1.0)
    # the bore: dark inside, a closed box running back into the hill under the arch
    lk.prism('Bore', [(-12.0, -AW + 0.05), (-1.2, -AW + 0.05), (-1.2, AW - 0.05), (-12.0, AW - 0.05)], -0.5, AH - 0.1, DARK, uv=2.0)

def hanbury_turn():
    """The Hanbury Turn, Redditch Road / Hanbury Road (the A38 lights), from the owner's photos (share rideworld/photos/to
    model/hanbury turn): cream-painted render over a dark navy plinth, white multi-pane sashes, a slate roof hipped at the
    corner with two chimneys; navy fascia boards lettered HANBURY TURN in gold over the Redditch Road front and on the
    Hanbury Road side, a hanging sign on a bracket at the corner, a bay window and a glazed porch with a navy door on the
    Hanbury Road side, window boxes, picnic benches; a white cottage joined on at the west end; the rear range and the taller
    white gabled block running south along Hanbury Road. OSM's three footprints, metres east / north of the pub's point."""
    PUB = [(-1.5, 5.96), (9.6, 6.9), (12.7, -4.3), (4.4, -7), (3.2, -1.1), (-1.5, -1.53)]
    COT = [(-12.8, 5), (-1.5, 5.96), (-1.5, -1.53), (-12, -2.5)]
    REAR = [(12.7, -4.3), (17.3, -18.8), (-3.1, -25.2), (-5, -19.2), (3.7, -16.5), (1.1, -8), (4.4, -7)]
    GAB = [(8.9, -22.8), (13.7, -38.1), (4.5, -41), (1.9, -32.7), (-2.9, -34.2), (-5.2, -27.1)]
    CRM = np.array((0.93, 0.89, 0.74)); WHT = np.array((0.95, 0.95, 0.93)); NAVY = (0.08, 0.13, 0.3)
    PUBM = lk.mat('PubRender', img=lk.image('pubr', casements(CRM)), rough=0.85, glow=0.25)
    COTM = lk.mat('CotRender', img=lk.image('cotr', casements(WHT * 0.97)), rough=0.85, glow=0.25)
    GABM = lk.mat('GabRender', img=lk.image('gabr', casements(WHT)), rough=0.85, glow=0.25)
    PLINTH = lk.mat('Plinth', NAVY, rough=0.6, glow=0.12)
    SLATEM = lk.mat('PubSlate', img=lk.image('pslate', lk.ashlar(SLATE, rows=16, cols=6, mortar=0.7)), rough=0.7, glow=0.12)
    SIGN = lk.mat('SignBoard', NAVY, rough=0.5, glow=0.2)
    GOLD = lk.mat('SignGold', (0.95, 0.82, 0.45), rough=0.3, metal=0.5, glow=0.45)
    BRICKM = lk.mat('ChimBrick', img=lk.image('chim', lk.brick((0.5, 0.27, 0.2), rows=8, cols=2)), rough=0.9, glow=0.18)
    POT = lk.mat('Pot', (0.62, 0.32, 0.22), rough=0.8, glow=0.15)
    WOOD = lk.mat('Bench', (0.55, 0.38, 0.22), rough=0.9, glow=0.15)
    GLASS = lk.mat('BayGlass', img=lk.image('bayg', casements(WHT, storeys=1, h_frac=0.7)), rough=0.4, glow=0.25)
    FLOWERS = lk.mat('Flowers', (0.35, 0.5, 0.2), rough=0.9, glow=0.2)
    BLUE = lk.mat('NavyDoor', NAVY, rough=0.4, glow=0.15)
    def block(name, poly, eave, mat, inset, rise):
        lk.prism(name + 'Plinth', offset_poly(poly, -0.04), -3.0, 0.5, PLINTH, uv=2.0)
        lk.prism(name, poly, 0.5, eave, mat, uv=3.0, uvz=eave - 0.5)
        lk.prism(name + 'Eaves', offset_poly(poly, -0.12), eave, eave + 0.15, PLINTH, uv=2.0)
        hip_roof(name + 'Roof', poly, eave + 0.15, inset, rise, SLATEM, overhang=0.3)
    block('Pub', PUB, 5.8, PUBM, 3.4, 2.7)
    block('Cottage', COT, 5.2, COTM, 3.2, 2.5)
    block('Rear', REAR, 5.6, PUBM, 3.3, 2.6)
    block('Gable', GAB, 6.3, GABM, 3.6, 3.0)
    # chimneys: rendered stacks with pots, at the pub's ends and the cottage's west gable (brick)
    for (cx, cy, top, m) in ((7.5, 3.6, 9.6, PUBM), (0.0, 2.6, 9.3, PUBM), (-12.0, 1.4, 8.6, BRICKM), (6.0, -30.0, 10.3, GABM)):
        lk.box('Chimney', cx, cy, top - 2.2, 1.0, 0.7, 2.2, m)
        for k in (-0.2, 0.2): lk.cyl('ChimneyPot', cx + k, cy, top, 0.12, 0.45, POT, seg=8)
    # the Redditch Road front (north): fascia board and lettering over the ground floor, a navy door, window boxes
    (m, u, n, L) = outward(PUB, 0)
    ang = math.atan2(u[1], u[0])
    fx, fy = m[0] + n[0] * 0.08, m[1] + n[1] * 0.08
    lk.box('Fascia', fx, fy, 3.05, 7.2, 0.12, 0.75, SIGN, rot=ang)
    text_obj('HANBURY TURN', 0.48, (fx + n[0] * 0.08, fy + n[1] * 0.08, 3.42), ang + math.pi, GOLD, extrude=0.02)
    dx, dy = m[0] - u[0] * 0.8 + n[0] * 0.04, m[1] - u[1] * 0.8 + n[1] * 0.04
    lk.box('FrontDoor', dx, dy, 0.5, 1.0, 0.08, 2.2, BLUE, rot=ang)
    for t in (-3.2, 0.6, 3.6):
        bx, by = m[0] + u[0] * t + n[0] * 0.15, m[1] + u[1] * t + n[1] * 0.15
        lk.box('WindowBox', bx, by, 3.75, 1.2, 0.25, 0.22, WOOD, rot=ang); lk.box('Flowers', bx, by, 3.97, 1.1, 0.22, 0.2, FLOWERS, rot=ang)
    for t in (-4.5, 2.0):  # picnic benches on the pavement
        bx, by = m[0] + u[0] * t + n[0] * 1.6, m[1] + u[1] * t + n[1] * 1.6
        lk.box('BenchTop', bx, by, 0.72, 1.8, 0.75, 0.06, WOOD, rot=ang)
        for sgn in (-1, 1): lk.box('BenchSeat', bx + n[0] * sgn * 0.62, by + n[1] * sgn * 0.62, 0.42, 1.8, 0.28, 0.05, WOOD, rot=ang)
        for t2 in (-0.75, 0.75): lk.box('BenchLeg', bx + u[0] * t2, by + u[1] * t2, 0.0, 0.08, 1.4, 0.72, WOOD, rot=ang)
    # the Hanbury Road side (east): the big signboard at first floor, a bay window, the glazed porch and door
    (m, u, n, L) = outward(PUB, 1)
    ang = math.atan2(u[1], u[0])
    sx, sy = m[0] + n[0] * 0.08, m[1] + n[1] * 0.08
    lk.box('SideSign', sx, sy, 3.85, 4.2, 0.12, 1.2, SIGN, rot=ang)
    text_obj('HANBURY', 0.46, (sx + n[0] * 0.08, sy + n[1] * 0.08, 4.72), ang + math.pi, GOLD, extrude=0.02)
    text_obj('TURN', 0.46, (sx + n[0] * 0.08, sy + n[1] * 0.08, 4.16), ang + math.pi, GOLD, extrude=0.02)
    (m, u, n, L) = outward(REAR, 0)
    ang = math.atan2(u[1], u[0])
    for t, w2 in ((-L / 2 + 3.5, 2.8),):
        bx, by = m[0] + u[0] * t + n[0] * 0.45, m[1] + u[1] * t + n[1] * 0.45
        lk.box('Bay', bx, by, 0.5, w2, 0.9, 2.1, GLASS, rot=ang); lk.box('BayRoof', bx, by, 2.6, w2 + 0.2, 1.0, 0.18, SIGN, rot=ang)
    px, py = m[0] + u[0] * (-L / 2 + 7.2) + n[0] * 0.75, m[1] + u[1] * (-L / 2 + 7.2) + n[1] * 0.75
    lk.box('Porch', px, py, 0.5, 2.0, 1.5, 2.3, GLASS, rot=ang); lk.box('PorchRoof', px, py, 2.8, 2.2, 1.7, 0.15, SIGN, rot=ang)
    lk.box('SideDoor', px + u[0] * 1.6, py + u[1] * 1.6, 0.5, 1.0, 0.08, 2.2, BLUE, rot=ang)
    for t in (-L / 2 + 3.5, -L / 2 + 9.0, 0.0, 4.0):
        bx, by = m[0] + u[0] * t + n[0] * 0.15, m[1] + u[1] * t + n[1] * 0.15
        lk.box('WindowBox', bx, by, 3.7, 1.2, 0.25, 0.22, WOOD, rot=ang); lk.box('Flowers', bx, by, 3.92, 1.1, 0.22, 0.2, FLOWERS, rot=ang)
    # the hanging sign on its bracket at the corner (a navy panel, gold lettering both faces)
    (m, u, n, L) = outward(PUB, 0)
    cx, cy = PUB[1][0] + u[0] * -0.6 + n[0] * 0.9, PUB[1][1] + u[1] * -0.6 + n[1] * 0.9
    ang = math.atan2(n[1], n[0])
    lk.box('Bracket', PUB[1][0] + n[0] * 0.5 - u[0] * 0.6, PUB[1][1] + n[1] * 0.5 - u[1] * 0.6, 4.4, 1.0, 0.06, 0.06, PLINTH, rot=ang)
    lk.box('HangingSign', cx, cy, 3.0, 0.9, 0.06, 1.2, SIGN, rot=ang)
    text_obj('HANBURY', 0.14, (cx + math.cos(ang + math.pi / 2) * 0.04, cy + math.sin(ang + math.pi / 2) * 0.04, 3.35), ang, GOLD, extrude=0.01)
    text_obj('TURN', 0.14, (cx + math.cos(ang + math.pi / 2) * 0.04, cy + math.sin(ang + math.pi / 2) * 0.04, 3.15), ang, GOLD, extrude=0.01)
    # the gable block's sign (on its north gable, facing up Hanbury Road)
    (m, u, n, L) = outward(GAB, 5)
    ang = math.atan2(u[1], u[0])
    gx, gy = m[0] + n[0] * 0.08, m[1] + n[1] * 0.08
    lk.box('GableSign', gx, gy, 4.6, 2.6, 0.12, 1.1, SIGN, rot=ang)
    text_obj('HANBURY', 0.34, (gx + n[0] * 0.08, gy + n[1] * 0.08, 5.35), ang + math.pi, GOLD, extrude=0.02)
    text_obj('TURN', 0.34, (gx + n[0] * 0.08, gy + n[1] * 0.08, 4.9), ang + math.pi, GOLD, extrude=0.02)

def black_cross():
    """Ye Olde Black Cross, 68 Worcester Road (the owner's Street View captures, share rideworld/photos/to model/black cross).
    OSM's footprint (world building 3469) is the whole run along the road, 43.8 x 11.4 m: from the south-west, a cream
    rendered shop, a red-brick two-storey house (white-painted ground floor, a bow window, the hanging sign), a low
    whitewashed range with the open doorway and a lantern, a small timber-framed gable with the quatrefoil band, and on the
    corner by the car park lane the big timber-framed gable with brick infill and gold YE OLDE BLACK CROSS; the long white
    side wall down the lane with black posts and iron S wall ties; brown tiled roofs, tall brick chimneys."""
    F = Frame((-18.4, -34.3), (8.6, 0.2), (-28.2, -28.3))     # u: SW end -> NE corner along the front; v: front -> back
    Lu, Lv = F.Lu, F.Lv
    WHITE = (0.93, 0.92, 0.89); BLACK = (0.07, 0.07, 0.08); BRICK = (0.5, 0.23, 0.17); CREAMC = (0.88, 0.83, 0.68)
    TIL = tiles((0.40, 0.27, 0.21)); BRK = lk.mat('BXBrick', img=lk.image('bxbrick', lk.brick(BRICK, rows=24, cols=6)), rough=0.9, glow=0.18)
    WALLW = lk.mat('BXWhite', img=lk.image('bxwhite', casements(np.array(WHITE), storeys=2)), rough=0.85, glow=0.22)
    CRM = lk.mat('BXCream', img=lk.image('bxcream', casements(np.array(CREAMC), storeys=3)), rough=0.85, glow=0.22)
    POT = plain('BXPot', (0.6, 0.32, 0.22)); GOLD = lk.mat('BXGold', (0.95, 0.78, 0.35), rough=0.3, metal=0.6, glow=0.5)
    GREEN = plain('BXBasket', (0.22, 0.42, 0.16), glow=0.2); IRON = plain('BXIron', BLACK, rough=0.5, glow=0.05)
    u1, u2, u3, u4 = 16.3, 25.8, 30.8, 35.8                 # cream | brick | low white | small gable | main gable (to Lu)
    # bodies
    F.block('Cream', 0, u1, 0, Lv, -3, 7.6, CRM, uvz=7.6 / 3 * 1.0)
    F.block('Brick', u1, u2, 0, Lv, -3, 6.6, BRK)
    F.block('Low', u2, u4, 0, Lv, -3, 5.2, WALLW, uvz=2.6)
    F.block('Main', u4, Lu, 0, Lv, -3, 5.6, WALLW, uvz=2.8)
    # roofs
    F.gable_roof('CreamRoof', 0, u1, 0, Lv, 7.6, 3.0, TIL, ridge='u')
    F.gable_roof('BrickRoof', u1, u2, 0, Lv, 6.6, 3.2, TIL, ridge='u')
    F.gable_roof('LowRoof', u2, u4, 0, Lv, 5.2, 3.4, TIL, ridge='u')
    F.gable_roof('MainRoof', u4, Lu, 0, Lv, 5.6, 4.2, TIL, ridge='v', over=0.35)
    F.gable_roof('SmallGableRoof', u3 + 0.2, u4 - 0.2, -0.3, 3.6, 5.2, 2.6, TIL, ridge='v', over=0.25)
    # the brick house's end above the low range (brick triangle) and the main gable's back
    F.tri('BrickEnd', BRK, 0.0, Lv, 6.6, 3.2, v=u2, out=1, along='v')
    # ---- the front, painted to measure ----
    # main gable (u4..Lu, 8 m): ground floor white with two windows and a chalkboard, the black bressumer, first floor
    # timber frame with brick infill and a window; the gold name on the brick under it
    w = Lu - u4; e = Elev(w, 5.6, WHITE)
    e.fill(0, 0, w, 0.45, BLACK)
    e.window(0.9, 0.9, 1.5, 1.5, cols=4, rows=3); e.window(4.9, 0.9, 1.5, 1.5, cols=4, rows=3)
    e.board(6.9, 0.7, 0.6, 1.0, (0.12, 0.13, 0.12), edge=(0.25, 0.2, 0.12))
    e.brick(0.15, 2.85, w - 0.15, 5.45, BRICK)
    e.fill(0, 2.7, w, 2.9, BLACK); e.fill(0, 5.4, w, 5.6, BLACK)
    for x in (0, 2.0, w - 2.0, w - 0.2): e.fill(x, 2.7, x + 0.2, 5.6, BLACK)
    e.window(3.1, 3.95, 1.8, 1.25, cols=4, rows=3)
    F.face('MainFront', e.material('bxmainfront'), u4, Lu, 0, 5.6)
    F.text('YE OLDE', 0.4, u4 + w / 2, 0, 3.6, GOLD, extrude=0.03); F.text('BLACK CROSS', 0.46, u4 + w / 2, 0, 3.08, GOLD, extrude=0.03)
    # the main gable triangle: white panels, black king post, collar, raking struts and bargeboards
    g = Elev(w, 4.2, WHITE)
    g.fill(0, 0, w, 0.2, BLACK)
    g.line(0, 0, w / 2, 4.2, 0.24, BLACK); g.line(w, 0, w / 2, 4.2, 0.24, BLACK)
    g.fill(w / 2 - 0.1, 0, w / 2 + 0.1, 4.2, BLACK); g.fill(w * 0.22, 1.9, w * 0.78, 2.08, BLACK)
    g.line(w * 0.22, 0.1, w / 2, 1.95, 0.16, BLACK); g.line(w * 0.78, 0.1, w / 2, 1.95, 0.16, BLACK)
    g.line(w / 2, 2.0, w * 0.33, 2.9, 0.14, BLACK); g.line(w / 2, 2.0, w * 0.67, 2.9, 0.14, BLACK)
    F.tri('MainGable', g.material('bxmaingable'), u4 - 0.3, Lu + 0.3, 5.6, 4.2 * (w + 0.6) / w)
    # small gable (u3..u4): two windows below, the quatrefoil band, brick and timber with a window, its little gable
    w = u4 - u3; e = Elev(w, 5.2, WHITE)
    e.fill(0, 0, w, 0.45, BLACK)
    e.window(0.45, 0.9, 1.6, 1.5, cols=4, rows=3); e.window(2.85, 0.9, 1.6, 1.5, cols=4, rows=3)
    e.fill(0, 2.6, w, 3.55, WHITE); e.fill(0, 2.6, w, 2.75, BLACK); e.fill(0, 3.45, w, 3.6, BLACK)
    for k in range(4):
        cx = (k + 0.5) * w / 4; e.ring(cx, 3.1, 0.3, 0.1, BLACK); e.line(cx - 0.4, 2.75, cx + 0.4, 3.45, 0.08, BLACK); e.line(cx - 0.4, 3.45, cx + 0.4, 2.75, 0.08, BLACK)
    e.brick(0.1, 3.6, w - 0.1, 5.1, BRICK)
    for x in (0, w - 0.18): e.fill(x, 3.6, x + 0.18, 5.2, BLACK)
    e.fill(0, 5.05, w, 5.2, BLACK)
    e.window(1.6, 3.85, 1.8, 1.05, cols=4, rows=2)
    F.face('SmallFront', e.material('bxsmallfront'), u3, u4, 0, 5.2)
    g = Elev(4.6, 2.6, WHITE)
    g.fill(0, 0, 4.6, 0.16, BLACK); g.line(0, 0, 2.3, 2.6, 0.2, BLACK); g.line(4.6, 0, 2.3, 2.6, 0.2, BLACK)
    g.fill(2.21, 0, 2.39, 2.6, BLACK); g.line(0.8, 0.1, 2.3, 1.4, 0.12, BLACK); g.line(3.8, 0.1, 2.3, 1.4, 0.12, BLACK)
    F.tri('SmallGable', g.material('bxsmallgable'), u3 + 0.2, u4 - 0.2, 5.2, 2.6, v=-0.3)
    # low range (u2..u3): the open doorway, a chalkboard, a small window above
    w = u3 - u2; e = Elev(w, 5.2, WHITE)
    e.fill(0, 0, w, 0.45, BLACK)
    e.door(1.1, 1.2, 2.3, (0.06, 0.05, 0.05), frame=(0.15, 0.12, 0.1))
    e.board(3.3, 0.8, 0.55, 0.9, (0.12, 0.13, 0.12), edge=(0.25, 0.2, 0.12))
    e.window(3.0, 3.4, 0.9, 0.9, cols=2, rows=2)
    F.face('LowFront', e.material('bxlowfront'), u2, u3, 0, 5.2)
    lam = F.T(u2 + 1.7, -0.45); lk.box('LanternBracket', *F.T(u2 + 1.7, -0.22), 2.75, 0.06, 0.5, 0.06, IRON, rot=F.ang)
    lk.box('Lantern', lam[0], lam[1], 2.35, 0.3, 0.3, 0.42, lk.mat('BXLamp', (0.95, 0.85, 0.6), glow=0.8))
    # brick house (u1..u2): white-painted ground floor with two doors and two notice boards, black fascia; brick above
    # with a bow window and an arched sash, the hanging sign between
    w = u2 - u1; e = Elev(w, 6.6, WHITE)
    e.fill(0, 0, w, 0.45, BLACK); e.fill(0, 2.85, w, 3.15, BLACK)
    e.board(0.35, 0.75, 1.5, 1.1, (0.12, 0.18, 0.14), edge=BLACK); e.board(6.9, 0.75, 1.5, 1.1, (0.12, 0.18, 0.14), edge=BLACK)
    e.door(2.6, 1.0, 2.2, (0.16, 0.14, 0.12)); e.door(4.4, 1.0, 2.2, (0.16, 0.14, 0.12))
    e.brick(0, 3.15, w, 6.45, BRICK); e.fill(0, 6.45, w, 6.6, (0.3, 0.15, 0.1))
    e.window(6.6, 3.9, 1.0, 1.7, cols=2, rows=3, arch=True, sill=(0.85, 0.83, 0.78))
    F.face('BrickFront', e.material('bxbrickfront'), u1, u2, 0, 6.6)
    BOW = lk.mat('BXBow', img=lk.image('bxbow', casements(np.array(WHITE), storeys=1, h_frac=0.75)), rough=0.5, glow=0.25)
    F.box('BowWindow', u1 + 2.6, -0.3, 3.7, 2.2, 0.6, 1.6, BOW); F.box('BowTop', u1 + 2.6, -0.32, 5.3, 2.4, 0.7, 0.14, plain('BXLead', (0.3, 0.3, 0.32)))
    F.box('SignBracket', u1 + 4.6, -0.55, 5.3, 0.06, 1.1, 0.06, IRON)
    F.box('HangingSign', u1 + 4.6, -0.9, 4.2, 0.07, 0.95, 1.05, plain('BXSign', (0.12, 0.1, 0.12), glow=0.3))
    F.text('BLACK', 0.17, u1 + 4.63, -0.9, 4.95, GOLD, along='v', out=1); F.text('CROSS', 0.17, u1 + 4.63, -0.9, 4.7, GOLD, along='v', out=1)
    for uu in (u1 + 1.6, u1 + 6.0, u3 + 0.9, u3 + 4.1, u4 + 1.2, u4 + 6.6): F.box('Basket', uu, -0.35, 2.85, 0.42, 0.42, 0.38, GREEN)
    # cream shop (0..u1): a shopfront and two rows of sashes
    e = Elev(u1, 7.6, CREAMC)
    e.fill(0, 2.9, u1, 3.4, (0.45, 0.12, 0.1)); e.fill(0, 0, u1, 0.35, (0.4, 0.38, 0.36))
    for k in range(4):  # two shops: big windows on stall risers between pilasters, a door each
        x0 = 0.5 + k * (u1 - 1.0) / 4; x1 = x0 + (u1 - 1.0) / 4 - 0.35
        if k in (1, 3): e.door(x0 + 0.2, 1.0, 2.4, (0.3, 0.1, 0.08), glazed=True); e.fill(x0 + 1.5, 0.6, x1, 2.6, (0.16, 0.2, 0.24))
        else: e.fill(x0, 0.6, x1, 2.6, (0.16, 0.2, 0.24))
    for k in range(6):
        x = 0.9 + k * (u1 - 1.8) / 6
        e.window(x, 3.9, 1.0, 1.35, cols=2, rows=2, sill=(0.8, 0.78, 0.72)); e.window(x, 5.8, 1.0, 1.2, cols=2, rows=2, sill=(0.8, 0.78, 0.72))
    F.face('CreamFront', e.material('bxcreamfront'), 0, u1, 0, 7.6)
    # ---- the side down the lane (NE end, u = Lu): white, black posts, two S ties, windows and a back door ----
    e = Elev(Lv, 5.6, WHITE)
    e.fill(0, 0, Lv, 0.5, BLACK); e.fill(0, 5.4, Lv, 5.6, BLACK)
    for x in (0, 3.9, 7.3): e.fill(x, 0.5, x + 0.18, 5.4, BLACK)
    e.brick(0.18, 2.9, 3.9, 5.4, BRICK); e.window(1.2, 3.5, 1.3, 1.2, cols=3, rows=2)
    for cx in (5.0, 6.2):
        e.ring(cx, 3.6, 0.28, 0.08, BLACK); e.fill(cx - 0.04, 3.0, cx + 0.04, 3.6, BLACK)
    e.window(8.5, 3.6, 1.1, 0.95, cols=3, rows=2); e.window(8.4, 1.0, 1.2, 1.1, cols=3, rows=2)
    e.door(10.3, 0.9, 2.1, (0.12, 0.12, 0.12))
    F.side('LaneSide', e.material('bxlaneside'), 0, Lv, 0, 5.6, Lu, out=1)
    # the gable's back (white with a plain frame)
    g = Elev(Lu - u4, 4.2, WHITE); g.fill(0, 0, Lu - u4, 0.2, BLACK); g.fill((Lu - u4) / 2 - 0.1, 0, (Lu - u4) / 2 + 0.1, 4.2, BLACK)
    F.tri('MainGableBack', g.material('bxgableback'), u4 - 0.3, Lu + 0.3, 5.6, 4.2 * (Lu - u4 + 0.6) / (Lu - u4), v=Lv, out=1)
    # chimneys: on the lane side by the gable, mid-way along it, the brick house's ends, the cream shop
    F.chimney('ChimneyA', Lu - 0.45, 2.6, 11.2, 0.9, 1.2, BRK, POT, base=5.0)
    F.chimney('ChimneyB', u4 + 4.0, 6.5, 10.8, 1.1, 0.7, BRK, POT, pots=3)
    F.chimney('ChimneyC', u2 - 0.5, Lv / 2, 10.6, 0.8, 1.0, BRK, POT)
    F.chimney('ChimneyD', u1 + 0.5, Lv / 2, 11.2, 0.8, 1.0, BRK, POT)
    F.chimney('ChimneyE', Lu - 3.0, Lv - 1.5, 10.0, 0.8, 0.8, BRK, POT)
    # an easter egg (the owner): King Charles II, who stopped here in 1651 fleeing after the Battle of Worcester, by the door
    cavalier(F, u2 + 2.95, -0.9, name='CharlesII')

def ewe_and_lamb():
    """The Ewe & Lamb, Hanbury Road (the owner's Street View captures, share rideworld/photos/to model/ewe and lamb): a
    two-storey white roughcast pub with its ridge along the road, dark grey casements and door, rendered chimneys at both
    gable ends, a pale board lettered EWE & LAMB high on the car park gable; a single-storey whitewashed outbuilding set back
    to the south with its own board and a grey door; low white restaurant ranges behind with tiled hipped roofs and a gabled
    porch facing the car park. OSM's one footprint (world building 1621), split by hand; metres east / north of the point."""
    WHITE = (0.92, 0.92, 0.9); GREY = (0.2, 0.22, 0.25); PLINTH = (0.3, 0.31, 0.33)
    TIL = tiles((0.36, 0.3, 0.26)); POT = plain('ELPot', (0.62, 0.34, 0.24))
    REND = lk.mat('ELRender', img=lk.image('elrender', casements(np.array(WHITE), storeys=2)), rough=0.9, glow=0.22)
    LOWW = lk.mat('ELLow', img=lk.image('ellow', casements(np.array(WHITE), storeys=1, h_frac=0.5)), rough=0.9, glow=0.22)
    BOARD = plain('ELBoard', (0.82, 0.83, 0.82), glow=0.3); INK = plain('ELInk', (0.22, 0.24, 0.27), glow=0.1)
    WIN = dict(frame=GREY, glass=(0.1, 0.12, 0.14), fw=0.06)
    # the pub: front along Hanbury Road, u from the south end to the north (car park) gable, v back from the road
    P = Frame((14.9, 5.2), (8.2, 17.0), (8.8, 1.7)); Lu, Lv = P.Lu, 7.0
    P.block('Pub', 0, Lu, 0, Lv, -3, 5.0, REND, uvz=2.5)
    P.gable_roof('PubRoof', 0, Lu, 0, Lv, 5.0, 3.2, TIL, ridge='u', over=0.3)
    e = Elev(Lu, 5.0, WHITE, grain=0.06)
    e.fill(0, 0, Lu, 0.3, PLINTH)
    e.window(0.8, 0.9, 1.1, 1.15, cols=3, rows=2, **WIN); e.door(3.2, 0.95, 2.05, GREY)
    for x, w in ((5.7, 1.5), (8.8, 1.6), (11.8, 1.0)): e.window(x, 0.9, w, 1.15, cols=3, rows=2, **WIN)
    for x in (1.0, 4.0, 7.3, 10.4): e.window(x, 3.3, 0.85, 1.0, cols=2, rows=2, **WIN)
    P.face('PubFront', e.material('elfront'), 0, Lu, 0, 5.0)
    # the car park gable (u = Lu): two windows each floor, a door, the name board in the gable
    e = Elev(Lv, 5.0, WHITE, grain=0.06); e.fill(0, 0, Lv, 0.3, PLINTH)
    e.window(1.2, 0.9, 1.0, 1.1, cols=2, rows=2, **WIN); e.door(4.9, 0.95, 2.05, GREY)
    e.window(1.3, 3.3, 0.85, 1.0, cols=2, rows=2, **WIN); e.window(4.6, 3.3, 0.85, 1.0, cols=2, rows=2, **WIN)
    P.side('PubNorth', e.material('elnorth'), 0, Lv, 0, 5.0, Lu, out=1)
    g = Elev(Lv, 3.2, WHITE, grain=0.06); P.tri('PubNorthGable', g.material('elgable'), 0, Lv, 5.0, 3.2, v=Lu, out=1, along='v')
    P.tri('PubSouthGable', g.material('elgable2'), 0, Lv, 5.0, 3.2, v=0, out=-1, along='v')
    c = P.T(Lu + 0.1, Lv / 2); lk.box('NameBoard', c[0], c[1], 5.15, 0.08, 2.6, 0.7, BOARD, rot=P.ang)
    P.text('EWE & LAMB', 0.36, Lv / 2, Lu + 0.1, 5.5, INK, out=1, along='v')
    CHIM = plain('ELChimney', WHITE)
    P.chimney('ChimneyN', Lu - 0.5, Lv / 2, 9.6, 0.7, 1.0, CHIM, POT, pots=1)
    P.chimney('ChimneyS', 0.5, Lv / 2, 9.3, 0.6, 0.9, CHIM, POT, pots=1)
    # the outbuilding, set back to the south
    O = Frame((18.2, -6.4), (12.4, 3.9), (12.5, -9.6)); Ou, Ov = O.Lu, O.Lv
    O.block('Outbuilding', 0, Ou, 0, Ov, -3, 2.8, LOWW, uvz=2.8)
    O.gable_roof('OutRoof', 0, Ou, 0, Ov, 2.8, 2.0, TIL, ridge='u', over=0.3)
    e = Elev(Ou, 2.8, WHITE, grain=0.07); e.fill(0, 0, Ou, 0.25, PLINTH)
    e.window(4.3, 1.0, 0.9, 0.95, cols=2, rows=2, **WIN); e.door(6.6, 1.25, 2.3, GREY)
    O.face('OutFront', e.material('eloutfront'), 0, Ou, 0, 2.8)
    c = O.T(2.4, -0.06); lk.box('OutBoard', c[0], c[1], 1.4, 2.7, 0.06, 0.7, BOARD, rot=O.ang)
    O.text('EWE & LAMB', 0.34, 2.4, -0.06, 1.75, INK)
    for t in (0, Ov):
        g = Elev(Ov, 2.0, WHITE, grain=0.07); O.tri('OutGable%d' % t, g.material('eloutg%d' % t), 0, Ov, 2.8, 2.0, v=0 if t == 0 else Ou, out=-1 if t == 0 else 1, along='v')
    # the restaurant ranges behind: single storey, white, tiled hipped roofs; a gabled porch on the car park side
    REAR = [(-8.4, 7.6), (2.1, 13.5), (8.8, 1.7), (5.9, 1.7), (-1.8, -2.7), (1.0, -7.5), (-4.4, -10.5), (-8.5, -3.3), (-11.6, -5.1), (-15.4, 1.7), (-7.6, 6.1)]
    lk.prism('Rear', REAR, -3, 2.8, LOWW, uv=3.0, uvz=2.8)
    lk.prism('RearEaves', offset_poly(REAR, -0.25), 2.8, 2.95, plain('ELFascia', GREY), uv=2.0)
    hip_roof('RearRoof', REAR, 2.95, 2.2, 1.6, TIL, overhang=0.3)
    (m, u, n, L) = outward(REAR, 0); ang = math.atan2(u[1], u[0])
    px, py = m[0] + n[0] * 1.1, m[1] + n[1] * 1.1
    lk.box('Porch', px, py, 0.0, 2.6, 2.2, 2.6, plain('ELPorch', (0.2, 0.17, 0.15)), rot=ang)
    pf = Frame((px - u[0] * 1.5 + n[0] * 1.2, py - u[1] * 1.5 + n[1] * 1.2), (px + u[0] * 1.5 + n[0] * 1.2, py + u[1] * 1.5 + n[1] * 1.2), (px - u[0] * 1.5 - n[0] * 1.2, py - u[1] * 1.5 - n[1] * 1.2))
    pf.gable_roof('PorchRoof', 0, 3.0, 0, 2.4, 2.6, 1.5, TIL, ridge='v', over=0.2)
    g = Elev(3.0, 1.5, (0.24, 0.2, 0.17)); g.line(0, 0, 1.5, 1.5, 0.12, (0.9, 0.9, 0.88)); g.line(3.0, 0, 1.5, 1.5, 0.12, (0.9, 0.9, 0.88))
    pf.tri('PorchGable', g.material('elporchg'), 0, 3.0, 2.6, 1.5, v=0)
    for k in (-1, 1): lk.cyl('Basket', px + u[0] * k * 1.0 + n[0] * 1.3, py + u[1] * k * 1.0 + n[1] * 1.3, 1.9, 0.28, 0.4, plain('ELFlowers', (0.75, 0.18, 0.3), glow=0.3), seg=8)

def ladybird():
    """The Ladybird Inn, New Road / Finstall Road by Bromsgrove station (the owner's Street View captures, share
    rideworld/photos/to model/ladybird): Edwardian red brick with cream stone bands, sills and a stone door surround; the
    main block on the corner has a hipped roof with dormers and very tall corbelled chimneys; a Dutch-gabled bay with two
    bay windows along New Road, then a single-storey brick extension running south; on Finstall Road a second door, the
    tall chimney breast, the hanging sign at the corner, and a cream-painted wing with a black THE LADYBIRD INN board.
    OSM footprint world building 5999; metres east / north of the place point."""
    F = Frame((-15.4, 11.17), (-4.2, -22.3), (2.0, 17.0))     # u: north corner -> south along New Road; v: east, back
    BR = (0.56, 0.24, 0.16); STONE = (0.86, 0.81, 0.68); WHITE = (0.94, 0.94, 0.92); CRM = (0.88, 0.85, 0.74)
    BRK = lk.mat('LBBrick', img=lk.image('lbbrick', lk.brick(BR, rows=24, cols=6)), rough=0.9, glow=0.18)
    CREAMW = lk.mat('LBCream', img=lk.image('lbcream', casements(np.array(CRM), storeys=2)), rough=0.85, glow=0.22)
    STONEM = plain('LBStone', STONE); TIL = tiles((0.33, 0.28, 0.27)); POT = plain('LBPot', (0.6, 0.32, 0.22))
    WINB = lk.mat('LBWin', img=lk.image('lbwin', casements(np.array(BR), storeys=1, h_frac=0.6)), rough=0.6, glow=0.22)
    BLACK = plain('LBBlack', (0.06, 0.06, 0.07), glow=0.08); GOLDW = plain('LBLetter', (0.92, 0.9, 0.84), glow=0.4)
    W = dict(frame=WHITE, glass=(0.12, 0.14, 0.18), fw=0.07)
    m0, m1, x1 = 8.5, 14.5, 35.0      # main block | Dutch-gable bay | single-storey extension (u)
    # bodies and roofs
    F.block('Main', 0, m1, 0, 11.0, -3, 5.8, BRK)
    F.hip_roof('MainRoof', 0, m0, 0, 11.0, 5.8, 3.4, TIL)
    F.gable_roof('BayRoof', m0, m1, 0.6, 11.0, 5.8, 2.8, TIL, ridge='v', over=0.2)  # (starts behind the Dutch gable wall)
    F.block('Ext', m1, x1, 0, 7.0, -3, 3.6, BRK)
    F.block('ExtParapet', m1, x1, -0.05, 7.05, 3.6, 4.0, STONEM)
    F.block('Wing', 0, 9.0, 11.0, 18.4, -3, 5.0, CREAMW, uvz=2.5)
    F.gable_roof('WingRoof', 0, 9.0, 11.0, 18.4, 5.0, 2.4, TIL, ridge='u', over=0.25)
    F.block('Back', 9.0, 17.0, 11.0, 18.0, -3, 3.2, CREAMW, uvz=3.2)
    F.block('BackRoof', 9.0, 17.0, 11.0, 18.0, 3.2, 3.4, plain('LBFelt', (0.25, 0.25, 0.27)))
    def bands(e, w, top):  # plinth, string course and cornice in cream stone
        e.fill(0, 0, w, 0.5, (0.36, 0.2, 0.15)); e.fill(0, 2.95, w, 3.15, STONE); e.fill(0, top - 0.25, w, top, STONE)
    # New Road front of the main block: window, the stone door surround, window; three sashes above
    e = Elev(m0, 5.8, BR); e.brick(0, 0, m0, 5.8, BR); bands(e, m0, 5.8)
    e.window(0.9, 1.0, 1.2, 1.6, cols=2, rows=3, sill=STONE, **W); e.window(6.1, 1.0, 1.4, 1.6, cols=3, rows=3, sill=STONE, **W)
    e.fill(3.35, 0.0, 5.05, 2.75, STONE); e.door(3.65, 1.1, 2.35, (0.16, 0.2, 0.27), glazed=True)
    for x in (0.95, 3.75, 6.2): e.window(x, 3.55, 1.15, 1.45, cols=2, rows=2, sill=STONE, **W)
    F.face('MainFront', e.material('lbmainfront'), 0, m0, 0, 5.8)
    # the Dutch-gable bay: stone quoins, two windows above (the bay windows are modelled), and its curved gable
    w = m1 - m0; e = Elev(w, 5.8, BR); e.brick(0, 0, w, 5.8, BR); bands(e, w, 5.8)
    e.fill(0, 0.5, 0.3, 5.6, STONE); e.fill(w - 0.3, 0.5, w, 5.6, STONE)
    for x in (0.9, 3.7): e.window(x, 3.55, 1.3, 1.45, cols=2, rows=2, sill=STONE, **W)
    F.face('BayFront', e.material('lbbayfront'), m0, m1, 0, 5.8)
    for uu in (m0 + 1.55, m0 + 4.45):
        F.box('BayWindow', uu, -0.4, 0.45, 2.0, 0.8, 2.2, WINB); F.box('BayWindowRoof', uu, -0.45, 2.65, 2.2, 0.95, 0.16, TIL)
    prof = [(0, 0), (0, 0.8), (0.6, 0.8), (0.9, 1.3), (1.6, 1.95), (1.9, 2.55), (2.4, 2.8), (3.6, 2.8), (4.1, 2.55), (4.4, 1.95), (5.1, 1.3), (5.4, 0.8), (6.0, 0.8), (6.0, 0)]
    bm = bmesh.new()
    for vv, mat_ in ((-0.05, BRK),):
        A2 = [bm.verts.new((*F.T(m0 + a, vv), 5.8 + b)) for a, b in prof]; B2 = [bm.verts.new((*F.T(m0 + a, vv + 0.45), 5.8 + b)) for a, b in prof]
        bm.faces.new(A2); bm.faces.new(B2[::-1])
        for i in range(len(prof)): bm.faces.new((A2[i], A2[(i + 1) % len(prof)], B2[(i + 1) % len(prof)], B2[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish('DutchGable', bm, BRK, 3.0)
    for (a0, b0), (a1, b1) in zip(prof[1:-1], prof[2:-1]):  # stone coping along its outline (a rounded bar along each edge)
        lk.tube('Coping', (*F.T(m0 + a0, 0.17), 5.8 + b0 + 0.05), (*F.T(m0 + a1, 0.17), 5.8 + b1 + 0.05), 0.13, STONEM, seg=8)
        p_ = F.T(m0 + a1, 0.17); lk.cyl('CopingJoint', p_[0], p_[1], 5.8 + b1 - 0.08, 0.13, 0.26, STONEM, seg=8)
    c = F.T(m0 + 3.0, 0.1); lk.cyl('Finial', c[0], c[1], 8.62, 0.12, 0.7, STONEM, seg=8)
    F.box('GableWindow', m0 + 3.0, -0.07, 6.5, 1.0, 0.1, 1.1, lk.mat('LBGWin', img=lk.image('lbgwin', casements(np.array(WHITE), storeys=1, h_frac=0.6)), rough=0.5, glow=0.25))
    # the single-storey extension along New Road
    w = x1 - m1; e = Elev(w, 3.6, BR); e.brick(0, 0, w, 3.6, BR); e.fill(0, 0, w, 0.45, (0.36, 0.2, 0.15)); e.fill(0, 3.35, w, 3.6, STONE)
    for k in range(6): e.window(1.0 + k * 3.3, 1.0, 1.6, 1.5, cols=3, rows=2, sill=STONE, **W)
    F.face('ExtFront', e.material('lbextfront'), m1, x1, 0, 3.6)
    # Finstall Road side (u = 0, facing north): window, chimney breast, the second door, window; three sashes above
    e = Elev(11.0, 5.8, BR); e.brick(0, 0, 11.0, 5.8, BR); bands(e, 11.0, 5.8)
    e.window(9.0, 1.0, 1.2, 1.6, cols=2, rows=3, sill=STONE, **W); e.window(1.0, 1.0, 1.2, 1.6, cols=2, rows=3, sill=STONE, **W)
    e.fill(3.0, 0.0, 4.6, 2.75, STONE); e.door(3.3, 1.0, 2.35, (0.12, 0.12, 0.13))
    for x in (1.0, 3.3, 9.0): e.window(x, 3.55, 1.15, 1.45, cols=2, rows=2, sill=STONE, **W)
    F.side('NorthFront', e.material('lbnorth'), 0, 11.0, 0, 5.8, 0, out=-1)
    e = Elev(7.4, 5.0, CRM, grain=0.05); e.fill(0, 0, 7.4, 0.45, (0.3, 0.3, 0.32))
    e.window(1.0, 3.4, 1.0, 1.1, cols=2, rows=2, **W); e.window(1.0, 1.0, 1.0, 1.2, cols=2, rows=2, **W)
    F.side('WingNorth', e.material('lbwingn'), 11.0, 18.4, 0, 5.0, 0, out=-1)
    c = F.T(-0.08, 15.0); lk.box('InnBoard', c[0], c[1], 3.2, 0.08, 2.4, 1.3, BLACK, rot=F.ang)
    F.text('THE LADYBIRD', 0.3, 15.0, -0.08, 4.1, GOLDW, out=-1, along='v'); F.text('INN', 0.36, 15.0, -0.08, 3.6, GOLDW, out=-1, along='v')
    # chimneys: the tall breast on Finstall Road, the main block's back corner, the bay's back
    F.box('ChimneyBreast', -0.35, 5.0, -1.0, 0.7, 1.4, 7.0, BRK)
    F.chimney('ChimneyTall', -0.2, 5.0, 11.4, 1.0, 1.4, BRK, POT, base=5.8)
    F.chimney('ChimneyBack', 7.6, 10.4, 10.6, 1.2, 0.8, BRK, POT, pots=3)
    F.chimney('ChimneyBay', m1 - 0.6, 9.5, 10.0, 0.9, 0.9, BRK, POT)
    # dormers on the hipped roof (New Road and Finstall Road slopes)
    for (uu, vv, rot_) in ((m0 / 2, 1.9, 0), (2.3, 5.5, 1)):
        if rot_ == 0: F.box('Dormer', uu, vv, 6.1, 1.6, 1.4, 1.3, WINB); F.gable_roof('DormerRoof', uu - 0.9, uu + 0.9, vv - 0.75, vv + 0.8, 7.4, 0.7, TIL, ridge='v', over=0.1)
        else: F.box('Dormer', uu, vv, 6.1, 1.4, 1.6, 1.3, WINB); F.gable_roof('DormerRoof', uu - 0.75, uu + 0.8, vv - 0.9, vv + 0.9, 7.4, 0.7, TIL, ridge='u', over=0.1)
    # the hanging sign at the corner: a black board with a ladybird on each face
    g = Elev(0.9, 1.1, (0.05, 0.05, 0.06))
    for r_ in range(10): g.ring(0.45, 0.5, 0.03 + r_ * 0.03, 0.05, (0.8, 0.08, 0.06))
    g.fill(0.43, 0.2, 0.47, 0.8, (0.05, 0.05, 0.06)); g.ring(0.45, 0.82, 0.08, 0.1, (0.05, 0.05, 0.06))
    for (sx, sz) in ((0.3, 0.6), (0.6, 0.6), (0.32, 0.38), (0.58, 0.38)): g.ring(sx, sz, 0.03, 0.06, (0.05, 0.05, 0.06))
    SIGNM = g.material('lbsign', glow=0.35)
    F.box('SignBracket', -0.7, -0.7, 4.3, 1.4, 0.06, 0.06, BLACK)
    for side_ in (-1, 1):
        F.face('SignFace%d' % side_, SIGNM, -1.15, -0.25, 3.0, 4.1, v=-1.0 + side_ * 0.02, out=side_)

def nailers_yard():
    """Nailers Yard, the former Market Hall site off the High Street (finished 2026; the owner's drone video "Bromsgrove Landmarks
    From The Air" 4:34-5:09, GJS Dillon's particulars and Street View; built finished, without the hoardings): the
    four-storey office and restaurant building on OSM's footprint (world building 10393, rounded at the St John Street
    end): dark brick and glazed ground floor, red standing-seam cladding with vertical fins, ribbon glazing round the curve,
    punched windows on the straight sides, the top floor stopping short of the east end for a roof terrace, solar panels and
    a screened upper terrace over the curve; and the market hall (world building 3478): three steep red gables facing the
    street, tall glazed slots, glazed shopfronts with canopies, roof windows. Metres east / north of the point."""
    RED = (0.55, 0.15, 0.12); RED2 = (0.47, 0.12, 0.1); DARK = (0.16, 0.16, 0.18); GL = (0.12, 0.15, 0.19)
    def seams(e, x0, z0, x1, z1, col, every=0.45):
        e.fill(x0, z0, x1, z1, col, grain=0.03); x = x0
        while x < x1: e.fill(x, z0, x + 0.04, z1, tuple(c * 1.25 for c in col)); x += every
    def glaze(e, x0, z0, x1, z1, bars=1.0):
        e.fill(x0, z0, x1, z1, GL); x = x0
        while x < x1: e.fill(x, z0, x + 0.06, z1, (0.25, 0.25, 0.27)); x += bars
        for k in range(8): e.fill(x0, z0 + (z1 - z0) * k / 8, x1, z0 + (z1 - z0) * k / 8 + 0.02, (0.16, 0.2, 0.25))
    # ---- the office building ----
    POLY = [(29.9, 7.8), (28, -8), (2.4, -0.2), (-4.4, -4.4), (-6.4, -5.5), (-8.6, -5.7), (-10.8, -5.2), (-12.4, -4.1), (-13.4, -2.4), (-13.5, -0.2), (-12.9, 1.7), (-11.8, 3), (5.7, 13.8)]
    e = Elev(3.0, 4.0, DARK); e.brick(0, 0, 3.0, 0.7, (0.2, 0.2, 0.22), mortar=(0.3, 0.3, 0.32)); glaze(e, 0.1, 0.7, 2.9, 3.5, bars=1.4); e.fill(0, 3.5, 3.0, 4.0, (0.22, 0.22, 0.24))
    GROUND = e.material('nyground', rough=0.5, glow=0.25)
    e = Elev(3.0, 6.8, RED); seams(e, 0, 0, 3.0, 6.8, RED)
    for z in (0.5, 3.9): e.window(0.75, z, 1.5, 2.3, cols=2, rows=1, frame=(0.2, 0.2, 0.22), glass=GL, fw=0.05)
    e.fill(0, 3.25, 3.0, 3.45, RED2)
    MID = e.material('nymid', rough=0.6, glow=0.22)
    e = Elev(1.5, 6.8, RED); glaze(e, 0, 0.3, 1.5, 3.1, bars=0.75); glaze(e, 0, 3.7, 1.5, 6.5, bars=0.75)
    e.fill(0, 3.1, 1.5, 3.7, RED2); e.fill(0.62, 0, 0.88, 6.8, tuple(c * 1.15 for c in RED))   # a vertical fin
    RIBBON = e.material('nyribbon', rough=0.45, glow=0.25)
    e = Elev(3.0, 3.2, RED2); seams(e, 0, 0, 3.0, 3.2, RED2); e.window(0.9, 0.6, 1.2, 1.9, cols=1, rows=1, frame=(0.2, 0.2, 0.22), glass=GL, fw=0.05)
    TOP = e.material('nytop', rough=0.6, glow=0.22)
    PAR = plain('NYParapet', tuple(c * 1.1 for c in RED), rough=0.6); ROOF = plain('NYRoof', (0.72, 0.73, 0.74), rough=0.9, glow=0.15)
    curve = lambda i, L: L < 4.0 and i >= 2 and i <= 11
    wall_ring('NYGround', POLY, -3.0, 4.0, lambda i, L: GROUND, tile_w=3.0)
    wall_ring('NYMid', POLY, 4.0, 10.8, lambda i, L: RIBBON if curve(i, L) else MID, tile_w=3.0)
    for k in (4.0, 7.4, 10.8):  # floor edges standing proud round the building (the red bands in the drone shots)
        wall_ring('NYBand', POLY, k - 0.12, k + 0.12, lambda i, L: PAR, out=0.12)
    d = (0.966, -0.259); smax = max(x * d[0] + y * d[1] for x, y in POLY); cut = smax - 11.0
    TOPP = clip_half(POLY, d, cut); TERR = clip_half(POLY, (-d[0], -d[1]), -cut)
    wall_ring('NYTop', TOPP, 10.8, 14.0, lambda i, L: RIBBON if L < 4.0 else TOP, tile_w=3.0)
    lk.prism('NYRoofSlab', TOPP, 13.95, 14.05, ROOF, uv=4.0)
    wall_ring('NYParapet', TOPP, 13.95, 14.6, lambda i, L: PAR, out=0.15)
    lk.prism('NYTerrace', TERR, 10.7, 10.82, plain('NYDeck', (0.5, 0.38, 0.28)), uv=2.0)
    wall_ring('NYBalustrade', TERR, 10.82, 11.9, lambda i, L: lk.mat('NYGlass', (0.6, 0.72, 0.78), rough=0.1, glow=0.15), out=0.1)
    tx = sum(x for x, y in TERR) / len(TERR); ty = sum(y for x, y in TERR) / len(TERR)
    for k, (dx, dy) in enumerate(((-3, 2), (0, -2), (3, 1), (-1, 5))):  # tables with parasols on the terrace
        lk.cyl('NYTable', tx + dx, ty + dy, 10.82, 0.45, 0.75, plain('NYTableTop', (0.25, 0.22, 0.2)), seg=10)
        lk.cyl('NYPole', tx + dx, ty + dy, 11.57, 0.03, 1.4, plain('NYPoleM', (0.3, 0.3, 0.3)), seg=6)
        lk.cyl('NYParasol', tx + dx, ty + dy, 12.8, 1.3, 0.35, plain('NYCanvas', (0.92, 0.9, 0.84), glow=0.25), seg=12, r2=0.05)
    # roof: solar panel rows over the middle, the plant box, the screened upper terrace over the curve
    CUR = clip_half(POLY, (-d[0], -d[1]), -(min(x * d[0] + y * d[1] for x, y in POLY) + 9.0))
    for k in range(4):
        cx, cy = 6.0 + k * 1.6 * d[0] + 2 * d[1], 2.0 + k * 1.6 * d[1] - 2 * d[0]
        for j in range(-2, 3): lk.box('NYSolar', cx + j * 1.2 * d[1] * -1, cy + j * 1.2 * d[0], 14.05, 1.0, 1.1, 0.25, plain('NYPanel', (0.1, 0.13, 0.25), rough=0.3, glow=0.12), rot=math.atan2(d[1], d[0]))
    lk.box('NYPlant', 1.0, 1.5, 14.05, 3.5, 2.5, 1.6, plain('NYPlantM', (0.55, 0.56, 0.58)), rot=math.atan2(d[1], d[0]))
    from pubkit import _offset
    # ---- the market hall: three gables facing the street ----
    H = Frame((62.9, -3.6), (45.2, 3.3), (57.5, -17.1)); Lu, Lv = H.Lu, H.Lv; bw = Lu / 3
    e = Elev(3.0, 5.2, RED); seams(e, 0, 0, 3.0, 5.2, RED); e.window(1.0, 3.0, 1.0, 1.5, cols=1, rows=1, frame=(0.2, 0.2, 0.22), glass=GL, fw=0.05)
    SIDE = e.material('nyhallside', rough=0.6, glow=0.22)
    e = Elev(4.0, 4.0, (0.62, 0.15, 0.12)); seams(e, 0, 0, 4.0, 4.0, (0.62, 0.15, 0.12), every=0.4)
    for (x, z) in ((0.6, 0.8), (2.4, 2.6)): e.fill(x, z, x + 1.0, z + 0.7, GL)
    ROOFM = e.material('nyhallroof', rough=0.5, glow=0.18)
    H.block('Hall', 0, Lu, 0, Lv, -3.0, 5.2, SIDE, uv=3.0, uvz=5.2)
    for k in range(3):
        u0, u1 = k * bw, (k + 1) * bw
        H.gable_roof('HallRoof%d' % k, u0, u1, 0, Lv, 5.2, 4.4, ROOFM, ridge='v', over=0.25)
        for v_, out_ in ((0.0, -1), (Lv, 1)):   # the gable ends: seams and a tall glazed slot
            g = Elev(bw, 4.4, RED); seams(g, 0, 0, bw, 4.4, RED); glaze(g, bw / 2 - 0.55, 0, bw / 2 + 0.55, 3.6, bars=0.55)
            H.tri('HallGable%d%d' % (k, out_), g.material('nyhallg%d%d' % (k, out_)), u0, u1, 5.2, 4.4, v=v_, out=out_)
        # the street front of this bay: a glazed shopfront under a canopy, the slot carried down
        e = Elev(bw, 5.2, RED); seams(e, 0, 0, bw, 5.2, RED); glaze(e, 0.4, 0.15, bw - 0.4, 2.9, bars=1.05); glaze(e, bw / 2 - 0.55, 3.3, bw / 2 + 0.55, 5.2, bars=0.55)
        H.face('HallFront%d' % k, e.material('nyhallf%d' % k), u0, u1, 0, 5.2)
        H.box('Canopy', (u0 + u1) / 2, -0.7, 3.0, bw - 0.6, 1.4, 0.12, plain('NYCanopy', (0.85, 0.8, 0.7), glow=0.25))

def bromsgrove_station():
    """Bromsgrove station (rebuilt 2016), from the owner's drone video 8:14-9:04: the ticket hall on OSM's outline (world
    building 1075: grey cladding and glazing, a flat roof with red stripes), the tower with the red British Rail double-arrow
    panels, the covered footbridge (blue glazed sides, a curved silver roof) over the four tracks to grey lift / stair towers
    on the platforms, platforms with canopies by the bridge. Frame: u along the tracks (north-east), v across them (west
    positive); origin = the station's OSM point."""
    F = Frame((0.0, 0.0), (0.578, 0.816), (-0.816, 0.578))
    GREY = (0.42, 0.44, 0.47); LGREY = (0.7, 0.71, 0.72); BRRED = (0.78, 0.08, 0.1); BLUE = (0.16, 0.36, 0.7)
    def glaze(e, x0, z0, x1, z1, col=(0.12, 0.15, 0.19), bars=1.2):
        e.fill(x0, z0, x1, z1, col); x = x0
        while x < x1: e.fill(x, z0, x + 0.07, z1, (0.3, 0.31, 0.33)); x += bars
    # the ticket hall
    HALL = [(-23.3, 46.6), (-10.9, 54.3), (-3.8, 57.0), (2.2, 55.1), (4.6, 51.3), (7.6, 41.4), (-6.8, 20.4), (-21.5, 29.9), (-20.3, 32.5), (-18.6, 35.7), (-23.7, 40.6), (-24.9, 42.3)]
    e = Elev(4.0, 6.0, GREY); e.fill(0, 0, 4.0, 0.4, (0.25, 0.25, 0.27)); glaze(e, 0.2, 0.4, 3.8, 3.4); e.fill(0, 3.4, 4.0, 6.0, GREY, grain=0.04)
    for k in range(4): e.fill(k + 0.0, 3.4, k + 0.05, 6.0, (0.36, 0.38, 0.41))
    HALLM = e.material('sthall', rough=0.6, glow=0.22)
    wall_ring('StHall', HALL, -3.0, 6.0, lambda i, L: HALLM, tile_w=4.0)
    lk.prism('StHallRoof', HALL, 5.95, 6.25, plain('StRoof', (0.6, 0.61, 0.63)), uv=4.0)
    cx = sum(x for x, y in HALL) / len(HALL); cy = sum(y for x, y in HALL) / len(HALL)
    for ang in (0.6, 0.6 + math.pi / 2):   # the red stripes across the roof
        lk.box('StRoofStripe', cx, cy, 6.25, 26.0, 1.2, 0.03, plain('StStripe', (0.72, 0.28, 0.24)), rot=ang)
    # the footbridge: u = 13, from the hall (v = 31) over the tracks to the east side (v = -16), deck 7.6 m up
    U0, V0, V1, DZ = 13.0, 31.0, -16.0, 7.6
    e = Elev(3.0, 3.0, BLUE); e.fill(0, 0, 3.0, 0.9, (0.75, 0.76, 0.78)); glaze(e, 0, 0.9, 3.0, 2.8, col=BLUE, bars=1.0); e.fill(0, 2.8, 3.0, 3.0, (0.75, 0.76, 0.78))
    SIDES = e.material('stbridge', rough=0.35, glow=0.25)
    F.block('BridgeDeck', U0 - 1.9, U0 + 1.9, V1, V0, DZ - 0.6, DZ, plain('StDeck', (0.55, 0.56, 0.58)))
    for uu in (U0 - 1.85, U0 + 1.85):
        F.box('BridgeSide', uu, (V0 + V1) / 2, DZ, 0.1, V0 - V1, 3.0, SIDES)
    # (the curved roof: an arch of 7 slats across, along the whole span)
    SILV = lk.mat('StSilver', (0.82, 0.83, 0.84), rough=0.3, metal=0.6, glow=0.2)
    for k in range(7):
        a0 = math.pi * k / 7; a1 = math.pi * (k + 1) / 7; r = 2.2
        x0, z0, x1, z1 = math.cos(a0) * r, math.sin(a0) * r * 0.45, math.cos(a1) * r, math.sin(a1) * r * 0.45
        F.box('BridgeRoof', U0 + (x0 + x1) / 2, (V0 + V1) / 2, DZ + 3.0 + min(z0, z1), abs(x1 - x0) + 0.05, V0 - V1 + 0.4, abs(z1 - z0) + 0.08, SILV)
    # lift / stair towers: one by the hall, one on the island platform, one on the east platform
    e = Elev(4.0, 11.2, (0.55, 0.57, 0.6)); glaze(e, 0.3, 7.7, 3.7, 10.4, col=BLUE, bars=0.9); e.fill(0, 0, 4.0, 0.3, (0.3, 0.3, 0.32))
    TOWM = e.material('sttower', rough=0.5, glow=0.22)
    for vv in (7.0, -13.5):
        F.box('LiftTower', U0, vv, -1.0, 4.4, 4.0, 12.2, TOWM); F.box('LiftCap', U0, vv, 11.2, 4.6, 4.2, 0.2, plain('StCap', LGREY))
    # the tower with the double arrow, at the bridge's west end
    e = Elev(4.0, 4.0, BRRED)
    for zz in (2.6, 1.4): e.fill(0.6, zz - 0.18, 3.4, zz + 0.18, (1, 1, 1))
    e.line(0.9, 1.4, 2.0, 0.55, 0.3, (1, 1, 1)); e.line(3.1, 2.6, 2.0, 3.45, 0.3, (1, 1, 1)); e.line(1.4, 1.4, 2.6, 2.6, 0.34, (1, 1, 1))
    LOGO = e.material('stlogo', rough=0.4, glow=0.45)
    TU, TV = U0 - 4.2, V0 + 1.5
    F.box('BRTower', TU, TV, -1.0, 4.2, 4.2, 15.0, plain('StTowerGrey', (0.62, 0.64, 0.67)))
    for side in (-1, 1):
        F.face('LogoA%d' % side, LOGO, TU - 2.0, TU + 2.0, 9.8, 13.8, v=TV + side * 2.1, out=side)
        F.side('LogoB%d' % side, LOGO, TV - 2.0, TV + 2.0, 9.8, 13.8, TU + side * 2.1, out=side)
    F.box('BRTowerCap', TU, TV, 14.0, 4.5, 4.5, 0.25, plain('StCap2', LGREY))
    # platforms (0.9 m up, white edges) and canopies by the bridge
    EDGE = plain('StEdge', (0.92, 0.9, 0.5), glow=0.3); PLAT = plain('StPlat', (0.55, 0.55, 0.56))
    for (v0, v1) in ((15.0, 19.5), (4.0, 9.5), (-12.0, -17.0)):
        F.block('Platform', -80.0, 120.0, v0, v1, -1.0, 0.9, PLAT)
        for ve in (v0, v1): F.block('PlatEdge', -80.0, 120.0, ve - 0.15, ve + 0.15, 0.9, 0.93, EDGE)
        vm = (v0 + v1) / 2
        F.block('Canopy', -10.0, 30.0, v0 + 0.3, v1 - 0.3, 3.6, 3.8, plain('StCanopy', LGREY))
        for uu in range(-8, 30, 6): F.box('CanopyPost', uu, vm, 0.9, 0.18, 0.18, 2.7, plain('StPost', (0.25, 0.25, 0.27)))

def artrix():
    """Artrix arts centre, School Drive (the owner's drone video ~7:00-7:40): a two-storey block of dark grey brick (8.9 m,
    flat roof with solar panels and plant) and the tall white auditorium box rising flush with its south-west and north-west
    faces (16.3 m, solar panels on top); the glazed entrance at the south corner with the white artrix lettering and its
    swirl, red planters, a glass canopy along the south-east side. OSM footprint world building 3501; metres east / north."""
    F = Frame((-19.5, 2.2), (-3.0, -19.9), (2.9, 19.9))    # u: west corner -> south corner along the SW face; v: back NE
    Lu, Lv = F.Lu, F.Lv
    DARK = (0.2, 0.21, 0.23); WHITE = (0.9, 0.91, 0.92); GL = (0.12, 0.15, 0.2)
    def brickwall(w, h, wins=()):
        e = Elev(w, h, DARK); e.brick(0, 0, w, h, DARK, mortar=(0.3, 0.31, 0.33))
        for (x, z, ww, hh) in wins: e.window(x, z, ww, hh, cols=2, rows=2, frame=(0.75, 0.76, 0.78), glass=GL, fw=0.05)
        return e
    WALL = lk.mat('AXBrick', img=lk.image('axbrick', lk.brick(DARK, rows=24, cols=6, mortar=(0.3, 0.31, 0.33))), rough=0.9, glow=0.18)
    F.block('Lower', 0, Lu, 0, Lv, -3.0, 8.9, WALL)
    F.block('LowerCoping', -0.1, Lu + 0.1, -0.1, Lv + 0.1, 8.9, 9.1, plain('AXCoping', (0.75, 0.76, 0.77)))
    # the auditorium box
    e = Elev(4.0, 7.4, WHITE, grain=0.02)
    for k in range(5): e.fill(k * 1.0, 0, k * 1.0 + 0.03, 7.4, (0.8, 0.81, 0.83))
    for z in (2.5, 5.0): e.fill(0, z, 4.0, z + 0.03, (0.8, 0.81, 0.83))
    BOXM = e.material('axbox', rough=0.6, glow=0.25)
    bu, bv = 19.0, 18.0
    lk.prism('Box', F.rect(0, bu, 0, bv), 8.9, 16.3, BOXM, uv=4.0, uvz=7.4)
    F.block('BoxCoping', -0.1, bu + 0.1, -0.1, bv + 0.1, 16.3, 16.5, plain('AXCoping2', (0.78, 0.79, 0.8)))
    PANEL = plain('AXSolar', (0.1, 0.13, 0.24), rough=0.3, glow=0.1)
    for k in range(6): F.box('BoxSolar', 2.0 + k * 2.6, bv / 2, 16.5, 1.8, bv - 3.0, 0.25, PANEL)
    for k in range(4): F.box('LowSolar', bu + 1.5 + k * 1.9, Lv * 0.45, 9.1, 1.3, Lv * 0.6, 0.25, PANEL)
    for (uu, vv) in ((5, 21), (9, 23), (13, 21.5), (24, 24), (25.5, 7)): F.box('Plant', uu, vv, 9.1, 1.6, 1.2, 1.1, plain('AXPlant', (0.66, 0.67, 0.69)))
    # the south-west face (towards School Drive): the glazed entrance at the south corner, the lettering
    e = brickwall(Lu, 8.9, wins=((2.0, 5.6, 1.4, 1.6),))
    e.fill(Lu - 3.4, 0, Lu, 7.2, GL); x = Lu - 3.4
    while x < Lu: e.fill(x, 0, x + 0.07, 7.2, (0.4, 0.41, 0.43)); x += 0.85
    for z in (2.4, 4.8): e.fill(Lu - 3.4, z, Lu, z + 0.07, (0.4, 0.41, 0.43))
    e.door(Lu - 2.6, 1.8, 2.3, (0.1, 0.12, 0.15), glazed=True)
    for k in range(4): e.board(Lu - 9.6 + k * 1.3, 1.2, 1.0, 1.4, (0.3, 0.32, 0.5), edge=(0.85, 0.85, 0.85))   # posters
    F.face('AXFront', e.material('axfront'), 0, Lu, 0, 8.9)
    WHITEL = plain('AXLetters', (0.97, 0.97, 0.97), glow=0.45)
    F.text('artrix', 1.3, Lu - 6.0, 0, 5.3, WHITEL, extrude=0.06)
    c = F.T(Lu - 6.0, -0.06); g = Elev(1.6, 1.6, DARK); g.ring(0.8, 0.8, 0.6, 0.18, (0.97, 0.97, 0.97)); g.ring(0.95, 0.9, 0.3, 0.14, (0.97, 0.97, 0.97))
    F.face('AXSwirl', g.material('axswirl', glow=0.45), Lu - 6.8, Lu - 5.2, 6.4, 8.0, v=-0.03)
    for k in range(5): F.box('Planter', Lu - 9.0 + k * 1.1, -0.6, 0.0, 0.9, 0.7, 0.7, plain('AXRed', (0.8, 0.1, 0.1), glow=0.3))
    # the south-east side: windows, doors and the long glass canopy
    e = brickwall(Lv, 8.9, wins=tuple((x, z, 1.2, 1.3) for x in (3.0, 7.0, 11.0, 15.0, 19.0, 23.0) for z in (1.0,)) + ((1.0, 5.6, 1.2, 1.5), (1.0, 3.2, 1.2, 1.5)))
    F.side('AXSouthEast', e.material('axse'), 0, Lv, 0, 8.9, Lu, out=1)
    c = F.T(Lu + 1.3, Lv / 2 + 1); lk.box('Canopy', c[0], c[1], 3.2, 2.6, Lv - 6, 0.12, lk.mat('AXCanopy', (0.7, 0.8, 0.85), rough=0.15, glow=0.2), rot=F.ang)
    for k in range(6): F.box('CanopyStay', Lu + 1.2, 4.0 + k * (Lv - 8) / 5, 3.3, 2.4, 0.06, 0.06, plain('AXSteel', (0.6, 0.6, 0.62)))
    # the north-west and north-east sides: plain brick with a few windows
    e = brickwall(Lv, 8.9, wins=((6.0, 3.0, 1.2, 1.3), (14.0, 3.0, 1.2, 1.3)))
    F.side('AXNorthWest', e.material('axnw'), 0, Lv, 0, 8.9, 0, out=-1)

def st_johns():
    """St John the Baptist, Bromsgrove (Grade I; C12, mostly C14-C15, restored 1858 by Sir George Gilbert Scott), from
    the owner's drone video (3:36-4:22: "206 ft 4 in to the tip of the weathercock, the stone spire 109 ft of it") and the
    listing: a large sandstone church, the west tower in three stages (west door and great Perpendicular window; three
    canopied niches; paired belfry openings with blind panelling), panelled parapet, battlements and corner pinnacles, the
    octagonal spire with gabled spire lights and a band; embattled clerestoried nave, embattled aisles with buttresses and
    pinnacles and Perpendicular windows, low lead roofs; chancel and north chapel; south porch. On OSM's outline (the
    world's church building); metres east / north of the place point."""
    F = Frame((-19.2, -0.8), (-9.8, 0.2), (-20.1, 8.4))     # u: east along the church from the tower's west face; v: north
    SAND = (0.52, 0.44, 0.38); DK = (0.13, 0.13, 0.15); LEAD = (0.5, 0.52, 0.55)
    STONE = lk.mat('SJStone', img=lk.image('sjstone', lk.ashlar(SAND, rows=10, cols=4, mortar=0.88, jitter=0.07)), rough=0.9, glow=0.2)
    LEADM = lk.mat('SJLead', img=lk.image('sjlead', lk.ashlar(LEAD, rows=2, cols=8, mortar=0.85)), rough=0.6, metal=0.2, glow=0.12)
    def pointed(e, x0, z0, w, h, lights=3):
        """a Perpendicular window: dark glazing under a pointed head, stone mullions and a transom"""
        e.fill(x0, z0, x0 + w, z0 + h, DK)
        for k in range(14):   # the pointed head: two arcs meeting
            t = k / 13; dz = h * 0.28 * math.sin(t * math.pi / 2)
            e.fill(x0 + w * 0.5 * t, z0 + h, x0 + w - w * 0.5 * t, z0 + h + dz, DK)
        for k in range(1, lights): e.fill(x0 + w * k / lights - 0.06, z0, x0 + w * k / lights + 0.06, z0 + h * 1.2, SAND)
        e.fill(x0, z0 + h * 0.55, x0 + w, z0 + h * 0.55 + 0.1, SAND)
    def bay(w, h, win_w, win_h, z0, lights=3):
        e = Elev(w, h, SAND, ppm=16, grain=0.05)
        for z in range(0, int(h), 1): e.fill(0, z, w, z + 0.03, tuple(c * 0.86 for c in SAND))
        pointed(e, (w - win_w) / 2, z0, win_w, win_h, lights); return e
    # body: aisles, nave with clerestory, chancel, north chapel, porch
    AISLE = bay(5.0, 7.5, 2.4, 3.6, 1.6).material('sjaisle'); CLER = bay(5.0, 5.0, 2.6, 2.2, 1.4).material('sjcler')
    CHAN = bay(5.0, 10.0, 2.4, 4.6, 2.4).material('sjchan')
    nu0, nu1 = 9.4, 37.0
    F.block('SouthAisle', nu0, nu1, -9.3, 0.0, -3, 7.5, AISLE, uv=5.0, uvz=7.5)
    F.block('NorthAisle', nu0, nu1, 9.2, 15.4, -3, 7.5, AISLE, uv=5.0, uvz=7.5)
    F.block('Nave', nu0, nu1, 0.0, 9.2, -3, 8.0, STONE, uv=3.0)
    F.block('Clerestory', nu0, nu1, 0.0, 9.2, 8.0, 13.0, CLER, uv=5.0, uvz=5.0)
    F.gable_roof('NaveRoof', nu0, nu1, 0.0, 9.2, 13.0, 1.4, LEADM, ridge='u', over=-0.25)
    for (v0, v1) in ((-9.3, 0.0), (9.2, 15.4)): F.gable_roof('AisleRoof', nu0, nu1, v0, v1, 7.5, 0.8, LEADM, ridge='u', over=-0.25)
    F.block('Chancel', nu1, 47.0, 0.0, 9.2, -3, 10.0, CHAN, uv=5.0, uvz=10.0)
    F.gable_roof('ChancelRoof', nu1, 47.3, 0.0, 9.2, 10.0, 3.6, plain('SJTile', (0.42, 0.36, 0.33)), ridge='u', over=0.25)
    F.tri('ChancelGable', STONE, 0.0, 9.2, 10.0, 3.6, v=47.0, out=1, along='v')
    e = Elev(9.2, 10.0, SAND, ppm=16); pointed(e, 2.6, 2.6, 4.0, 5.6, lights=5)
    F.side('EastWindow', e.material('sjeast'), 0.0, 9.2, 0.0, 10.0, 47.0, out=1)
    F.block('NorthChapel', nu1, 46.0, 9.2, 18.5, -3, 8.0, AISLE, uv=5.0, uvz=7.5)
    F.gable_roof('ChapelRoof', nu1, 46.0, 9.2, 18.5, 8.0, 0.9, LEADM, ridge='u', over=-0.25)
    F.block('Porch', 17.0, 21.5, -14.0, -9.3, -3, 5.4, STONE)
    F.gable_roof('PorchRoof', 17.0, 21.5, -14.2, -9.3, 5.4, 1.8, LEADM, ridge='v', over=0.15)
    g = Elev(4.5, 5.4, SAND, ppm=16); pointed(g, 1.3, 0.0, 1.9, 2.6, lights=1)
    F.face('PorchFront', g.material('sjporch'), 17.0, 21.5, 0, 5.4, v=-14.0)
    # battlements along the aisles, clerestory and tower; buttresses with pinnacles between the aisle bays
    def merlons(u0, u1, v, z, step=1.0):
        u = u0
        while u < u1 - 0.3: F.box('Merlon', u + 0.3, v, z, 0.55, 0.45, 0.6, STONE); u += step
    def merlons_v(v0, v1, u, z, step=1.0):
        vv = v0
        while vv < v1 - 0.3: F.box('Merlon', u, vv + 0.3, z, 0.45, 0.55, 0.6, STONE); vv += step
    for (v, z) in ((-9.3, 7.5), (15.4, 7.5), (0.0, 13.0), (9.2, 13.0)): merlons(nu0 + 0.2, nu1, v, z)
    PIN = lambda u, v, z, h: (F.box('Pinnacle', u, v, z, 0.5, 0.5, h, STONE), lk.taper('PinnacleTop', F.rect(u - 0.25, u + 0.25, v - 0.25, v + 0.25), z + h, [F.T(u, v)], z + h + 1.3, STONE))
    for k in range(6):
        uu = nu0 + 0.3 + k * 5.0
        for v, out in ((-9.3, -1), (15.4, 1)):
            F.box('Buttress', uu, v + out * 0.4, -1.0, 0.7, 0.8, 7.2, STONE); PIN(uu, v + out * 0.1, 7.5, 0.9)
    # the tower: three stages painted on each face, angle buttresses, parapet, battlements, pinnacles
    TW, TH = 9.4, 29.6
    def tower_face(west):
        e = Elev(TW, TH, SAND, ppm=12, grain=0.05)
        for z in range(0, int(TH)): e.fill(0, z, TW, z + 0.04, tuple(c * 0.86 for c in SAND))
        for z in (11.0, 19.0, 26.2): e.fill(0, z, TW, z + 0.3, tuple(c * 0.75 for c in SAND))
        if west:
            e.fill(TW / 2 - 0.95, 0, TW / 2 + 0.95, 2.9, DK); e.fill(TW / 2 - 0.6, 2.9, TW / 2 + 0.6, 3.4, DK)
            pointed(e, TW / 2 - 1.9, 4.0, 3.8, 4.8, lights=4)
        else: pointed(e, TW / 2 - 1.0, 5.0, 2.0, 3.2, lights=2)
        for k in (-1, 0, 1):   # three canopied niches
            x = TW / 2 + k * 1.4; e.fill(x - 0.4, 13.2, x + 0.4, 15.6, tuple(c * 0.55 for c in SAND)); e.fill(x - 0.5, 15.6, x + 0.5, 16.2, tuple(c * 0.75 for c in SAND))
        for x in (TW / 2 - 1.6, TW / 2 + 0.3):   # paired belfry openings, louvred
            e.fill(x, 20.0, x + 1.3, 24.6, DK)
            for z in range(10): e.fill(x, 20.2 + z * 0.44, x + 1.3, 20.3 + z * 0.44, (0.3, 0.27, 0.24))
        for x in (1.0, TW - 2.0): e.fill(x, 20.0, x + 1.0, 24.6, tuple(c * 0.78 for c in SAND))   # blind panels
        for k in range(8): e.fill(0.4 + k * 1.1, 26.7, 0.4 + k * 1.1 + 0.7, 28.6, tuple(c * 0.78 for c in SAND))   # panelled parapet
        return e.material('sjtower%s' % ('w' if west else 'o'))
    F.block('Tower', 0, TW, 0, 9.2, -3, TH, STONE)
    TWEST, TOTH = tower_face(True), tower_face(False)
    F.side('TowerWest', TWEST, 0, 9.2, 0, TH, 0, out=-1)
    F.face('TowerSouth', TOTH, 0, TW, 0, TH, v=0.0); F.face('TowerNorth', TOTH, 0, TW, 0, TH, v=9.2, out=1)
    for (cu, cv, du, dv) in ((0, 0, -1, -1), (TW, 0, 1, -1), (0, 9.2, -1, 1), (TW, 9.2, 1, 1)):   # angle buttresses, set back as they rise
        for (z0, z1, d) in ((-1.0, 11.0, 1.2), (11.0, 19.0, 0.9), (19.0, 26.2, 0.6)):
            F.box('TowerButtress', cu + du * d / 2, cv - dv * 0.6, z0, d, 0.9, z1 - z0, STONE); F.box('TowerButtress', cu - du * 0.6, cv + dv * d / 2, z0, 0.9, d, z1 - z0, STONE)
    merlons(0.2, TW, 0.0, TH); merlons(0.2, TW, 9.2, TH); merlons_v(0.2, 9.2, 0.0, TH); merlons_v(0.2, 9.2, TW, TH)
    for (cu, cv) in ((0.3, 0.3), (TW - 0.3, 0.3), (0.3, 8.9), (TW - 0.3, 8.9)): PIN(cu, cv, TH, 2.2)
    for (cu, cv) in ((TW / 2, 0.3), (TW / 2, 8.9), (0.3, 4.6), (TW - 0.3, 4.6)): PIN(cu, cv, TH, 1.4)
    # the spire: octagonal, 33.2 m from the parapet to the tip, a band a third of the way up, four gabled spire lights
    cx, cy = F.T(TW / 2, 4.6); R0 = 3.55; z0, z1 = TH - 0.3, 62.0
    octo = lambda r: [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), cy + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    lk.taper('Spire', octo(R0), z0, [(cx, cy)], z1, STONE, uv=3.0)
    zb = z0 + (z1 - z0) * 0.36; rb = R0 * (1 - 0.36)
    lk.taper('SpireBand', octo(rb + 0.18), zb, octo(rb + 0.12), zb + 0.5, STONE)
    for k in range(4):
        a = F.ang + k * math.pi / 2; lx, ly = cx + math.cos(a) * (R0 - 0.9), cy + math.sin(a) * (R0 - 0.9)
        lk.box('SpireLight', lx, ly, z0 + 0.2, 1.1, 1.0, 2.0, STONE, rot=a)
        lk.taper('SpireLightTop', lk.rect(lx, ly, 1.1, 1.0, a), z0 + 2.2, [(lx, ly)], z0 + 3.3, STONE)
        lk.box('SpireLightOpening', lx + math.cos(a) * 0.52, ly + math.sin(a) * 0.52, z0 + 0.6, 0.06, 0.6, 1.2, plain('SJDark', DK), rot=a)
    lk.cyl('WeatherRod', cx, cy, z1, 0.05, 1.2, plain('SJIron', (0.1, 0.1, 0.1)), seg=6)
    lk.box('Weathercock', cx, cy, z1 + 0.9, 0.8, 0.1, 0.5, lk.mat('SJGold', (0.9, 0.72, 0.3), rough=0.3, metal=0.8, glow=0.4))

def victoria_ground():
    """Bromsgrove Sporting FC's Victoria Ground (the owner's drone video 6:06-6:54): the pitch with its markings, the main stand
    with the green roof along the west side, the low red-seated stand along the east side, the covered terrace at the north
    end, the red wall with BROMSGROVE SPORTING FC at the south end, a red pitch-side barrier and floodlight masts. On OSM's
    pitch (97 x 64 m) and the stands' footprints; frame u along the pitch from its south-west corner, v across it (east)."""
    F = Frame((-52.3, -21.5), (-1.6, 58.4), (1.4, -58.3)); L, W = F.Lu, F.Lv
    WHITE = (0.96, 0.96, 0.95); RED = (0.75, 0.1, 0.1); GREEN = (0.24, 0.42, 0.3); GRASS = (0.25, 0.5, 0.2)
    # the pitch: grass stripes and white lines (a thin sheet just above the painted ground)
    e = Elev(L, W, GRASS, ppm=4, grain=0.03)
    for k in range(12):
        if k % 2: e.fill(k * L / 12, 0, (k + 1) * L / 12, W, (0.28, 0.55, 0.22))
    lw = 0.3; m = 3.0
    for (x0, z0, x1, z1) in ((m, m, L - m, m + lw), (m, W - m - lw, L - m, W - m), (m, m, m + lw, W - m), (L - m - lw, m, L - m, W - m), (L / 2 - lw / 2, m, L / 2 + lw / 2, W - m)):
        e.fill(x0, z0, x1, z1, WHITE)
    e.ring(L / 2, W / 2, 9.15, lw, WHITE)
    for (x0, s) in ((m, 1), (L - m, -1)):   # penalty and goal areas
        xa, xb = (x0, x0 + s * 16.5) if s > 0 else (x0 + s * 16.5, x0); e.fill(xa, W / 2 - 20.15, xb, W / 2 - 20.15 + lw, WHITE); e.fill(xa, W / 2 + 20.15 - lw, xb, W / 2 + 20.15, WHITE)
        e.fill(x0 + s * 16.5 - lw / 2, W / 2 - 20.15, x0 + s * 16.5 + lw / 2, W / 2 + 20.15, WHITE)
        xa, xb = (x0, x0 + s * 5.5) if s > 0 else (x0 + s * 5.5, x0); e.fill(xa, W / 2 - 9.15, xb, W / 2 - 9.15 + lw, WHITE); e.fill(xa, W / 2 + 9.15 - lw, xb, W / 2 + 9.15, WHITE)
        e.fill(x0 + s * 5.5 - lw / 2, W / 2 - 9.15, x0 + s * 5.5 + lw / 2, W / 2 + 9.15, WHITE)
    a, b, c, d = F.T(0, 0), F.T(L, 0), F.T(L, W), F.T(0, W)
    # the pitch follows the ground's real slope (the owner: "notoriously sloping"; ~1.4 m end to end): the survey's grid
    # (tools/kit/vg-heights.mjs -> vg-heights.json), a sheet 5 cm above it
    import json as _json
    G = _json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vg-heights.json')))
    def hz(u, v):
        fu = max(0, min(G['nu'] - 1.0001, u / L * (G['nu'] - 1))); fv = max(0, min(G['nv'] - 1.0001, v / W * (G['nv'] - 1)))
        i, j = int(fu), int(fv); a_, b_ = fu - i, fv - j; g = G['grid']
        return (g[i][j] * (1 - a_) * (1 - b_) + g[i + 1][j] * a_ * (1 - b_) + g[i][j + 1] * (1 - a_) * b_ + g[i + 1][j + 1] * a_ * b_)
    PM = e.material('vgpitch', rough=0.95, glow=0.15); NU, NV = 24, 12
    bm = bmesh.new(); lay = bm.loops.layers.uv.verify()
    V_ = [[bm.verts.new((*F.T(L * i / NU, W * j / NV), hz(L * i / NU, W * j / NV) + 0.05)) for j in range(NV + 1)] for i in range(NU + 1)]
    for i in range(NU):
        for j in range(NV):
            f = bm.faces.new((V_[i][j], V_[i + 1][j], V_[i + 1][j + 1], V_[i][j + 1]))
            for l_, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): l_[lay].uv = (ii / NU, 1 - jj / NV)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('Pitch'); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new('Pitch', me); bpy.context.scene.collection.objects.link(o); me.materials.append(PM); lk.objs.append(o)
    for (x0, s) in ((m, 1), (L - m, -1)):   # goals
        for vv in (W / 2 - 3.66, W / 2 + 3.66): F.box('GoalPost', x0, vv, hz(x0, vv), 0.12, 0.12, 2.44, plain('VGWhite', WHITE, glow=0.35))
        F.box('Crossbar', x0, W / 2, hz(x0, W / 2) + 2.38, 0.12, 7.44, 0.12, plain('VGWhite2', WHITE, glow=0.35))
    # pitch-side barrier
    BAR = plain('VGBarrier', RED, glow=0.25)
    for (u0, u1, v0, v1) in ((-1.5, L + 1.5, -1.5, -1.3), (-1.5, L + 1.5, W + 1.3, W + 1.5), (-1.5, -1.3, -1.5, W + 1.5), (L + 1.3, L + 1.5, -1.5, W + 1.5)):
        n_ = max(1, int(max(u1 - u0, v1 - v0) / 6))   # (in 6 m pieces, each at the ground's height there)
        for k in range(n_):
            if u1 - u0 > v1 - v0: a0, a1, b0, b1 = u0 + (u1 - u0) * k / n_, u0 + (u1 - u0) * (k + 1) / n_, v0, v1
            else: a0, a1, b0, b1 = u0, u1, v0 + (v1 - v0) * k / n_, v0 + (v1 - v0) * (k + 1) / n_
            z_ = hz((a0 + a1) / 2, (b0 + b1) / 2); F.block('Barrier', a0, a1, b0, b1, z_ - 1.0, z_ + 1.0, BAR)
    def mono(name, u0, u1, vb, vf, zb, zf, mat):
        bm = bmesh.new()
        P = [bm.verts.new((*F.T(u, v), z)) for (u, v, z) in ((u0, vb, zb), (u1, vb, zb), (u1, vf, zf), (u0, vf, zf))]
        Q = [bm.verts.new((x, y, z - 0.25)) for (x, y, z) in (v.co for v in P)]
        bm.faces.new(P); bm.faces.new(Q[::-1])
        for i in range(4): bm.faces.new((P[i], P[(i + 1) % 4], Q[(i + 1) % 4], Q[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish(name, bm, mat, 3.0)
    def stand(name, u0, u1, vb, vf, h, roof, seat, along_v=False):
        """a covered stand: back wall at vb, open towards the pitch at vf, tiers of seats rising to the back, a sloping roof on
        front columns (along_v: the stand runs across the pitch's end, so u and v swap)"""
        T = (lambda u, v: (v, u)) if along_v else (lambda u, v: (u, v))
        def blk(n, a0, a1, b0, b1, z0, z1, mat):
            (p0, q0), (p1, q1) = T(a0, b0), T(a1, b1); F.block(n, min(p0, p1), max(p0, p1), min(q0, q1), max(q0, q1), z0, z1, mat)
        dep = vf - vb; sgn = 1 if dep > 0 else -1
        blk(name + 'Back', u0, u1, vb - sgn * 0.3, vb, -1.0, h, plain(name + 'Wall', (0.55, 0.56, 0.58)))
        for uu in (u0, u1): blk(name + 'End', uu - 0.15, uu + 0.15, vb, vf, -1.0, h - 1.2, plain(name + 'Wall2', (0.6, 0.61, 0.63)))
        n = 6
        for k in range(n):   # tiers
            v0 = vb + dep * (k / n); v1 = vb + dep * ((k + 1) / n); z = (h - 2.8) * (1 - k / n)
            blk(name + 'Tier', u0, u1, min(v0, v1), max(v0, v1), -1.0, z, plain(name + 'Step', (0.62, 0.62, 0.63)))
            blk(name + 'Seats', u0 + 0.3, u1 - 0.3, min(v0, v1) + 0.15, min(v0, v1) + abs(dep) / n * 0.55, z, z + 0.45, seat)
        if along_v: mono(name + 'Roof', vb, vf, u0 - 0.3, u1 + 0.3, h, h - 1.0, roof) if False else None
        # roof (mono-pitch towards the pitch) and its front columns
        if not along_v: mono(name + 'Roof', u0 - 0.3, u1 + 0.3, vb - sgn * 0.3, vf + sgn * 0.8, h, h - 0.9, roof)
        else:
            bm = bmesh.new()
            P = [bm.verts.new((*F.T(uu, vv), z)) for (uu, vv, z) in ((vb - sgn * 0.3, u0 - 0.3, h), (vb - sgn * 0.3, u1 + 0.3, h), (vf + sgn * 0.8, u1 + 0.3, h - 0.9), (vf + sgn * 0.8, u0 - 0.3, h - 0.9))]
            Q = [bm.verts.new((x, y, z - 0.25)) for (x, y, z) in (v.co for v in P)]
            bm.faces.new(P); bm.faces.new(Q[::-1])
            for i in range(4): bm.faces.new((P[i], P[(i + 1) % 4], Q[(i + 1) % 4], Q[i]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces); lk.finish(name + 'Roof', bm, roof, 3.0)
        k = u0 + 2.0
        while k < u1 - 1.0:
            (pu, pv) = T(k, vf + sgn * 0.5); F.box(name + 'Column', pu, pv, -1.0, 0.25, 0.25, h - 0.6, plain(name + 'Steel', (0.85, 0.86, 0.87))); k += 7.5
    stand('Main', 24.0, 61.0, -14.0, -4.5, 8.0, plain('VGGreenRoof', GREEN, glow=0.15), plain('VGSeatG', (0.15, 0.4, 0.25), glow=0.2))
    stand('East', 23.0, 53.0, 74.0, 67.5, 4.2, plain('VGRedRoof', (0.6, 0.12, 0.1), glow=0.15), plain('VGSeatR', RED, glow=0.25))
    stand('North', 2.5, 53.5, 106.0, 100.0, 4.6, plain('VGWhiteRoof', (0.88, 0.89, 0.9), glow=0.2), plain('VGTerrace', (0.6, 0.6, 0.62)), along_v=True)
    # the south end: a red wall with the club's name facing the pitch
    F.block('SouthWall', -7.5, -6.9, 8.0, 57.0, -1.0, 3.2, plain('VGRedWall', RED, glow=0.25))
    F.block('SouthBoard', -7.4, -7.2, 9.0, 56.0, 3.2, 4.4, plain('VGBoard', (0.97, 0.97, 0.96), glow=0.3))
    F.text('BROMSGROVE SPORTING FC', 1.0, W / 2, -7.15, 3.8, plain('VGLetters', (0.75, 0.08, 0.08), glow=0.3), out=1, along='v', extrude=0.04)
    # floodlight masts down both sides
    for uu in (8.0, L / 2, L - 8.0):
        for vv in (-3.5, W + 3.5):
            c = F.T(uu, vv); lk.cyl('Floodlight', c[0], c[1], -1.0, 0.18, 19.0, plain('VGMast', (0.7, 0.71, 0.72)), seg=8)
            F.box('LampHead', uu, vv, 17.8, 1.6, 0.5, 1.0, lk.mat('VGLamp', (0.95, 0.95, 0.9), glow=0.6))

def a38_footbridge():
    """The A38 footbridge over the Bromsgrove Eastern Bypass by Carnforth Road (the owner's Street View captures 2026-11-23):
    a pale grey-green steel Warren-truss span over the cutting, a long ramp down the east side on slim round columns
    with plain bar railings, and the path down an embankment to Fordhouse Road at the west end. Line and heights from
    tools/openworld/handbridges/bromsgrove-open.json (the same ones the ridden path takes); z = 0 at its datum."""
    import json
    spec = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'openworld', 'handbridges', 'bromsgrove-open.json')))['bridges'][0]
    o, D = spec['origin'], spec['datum']; K = 111320 * math.cos(math.radians(o[0]))
    P = [((q[1] - o[1]) * K, (q[0] - o[0]) * 110540, q[2] - D, q[3]) for q in spec['pts']]
    GREEN = lk.mat('FBSteel', (0.66, 0.73, 0.69), rough=0.5, metal=0.4, glow=0.22)
    UNDER = lk.mat('FBUnder', (0.5, 0.56, 0.53), rough=0.6, metal=0.3, glow=0.15)
    SURF = lk.mat('FBSurface', img=lk.image('fbsurf', np.zeros((128, 128, 3), np.float32) + np.array([0.3, 0.3, 0.31]) * (1 + lk.noise(128, 128, 0.15, 1))), rough=0.95, glow=0.12)
    BANK = lk.mat('FBBank', img=lk.image('fbbank', np.zeros((128, 128, 3), np.float32) + np.array([0.3, 0.42, 0.2]) * (1 + lk.noise(128, 128, 0.2, 1))), rough=1.0, glow=0.12)
    CONC = lk.mat('FBConcrete', (0.62, 0.62, 0.6), rough=0.9, glow=0.15)
    def ribbon(name, pts, o0, o1, zb, zt, mat, uv=1.0):
        bm = bmesh.new(); rows = []
        for i, p in enumerate(pts):
            a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]; tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1; nx, ny = -ty / L, tx / L
            rows.append([bm.verts.new((p[0] + nx * q, p[1] + ny * q, p[2] + z)) for q, z in ((o0, zb), (o1, zb), (o1, zt), (o0, zt))])
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(4): bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
        bm.faces.new(rows[0][::-1]); bm.faces.new(rows[-1]); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return lk.finish(name, bm, mat, uv)
    def dense(pts, step=1.0):  # points every metre along a polyline (corners kept), so ribbons follow the switchback cleanly
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / step))
            for k in range(1, n + 1): t = k / n; out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t))
        return out
    def walker(pts):
        S = [0.0]
        for a, c in zip(pts, pts[1:]): S.append(S[-1] + math.hypot(c[0] - a[0], c[1] - a[1]))
        def at(sv):
            i = max(0, min(len(S) - 2, next((k for k in range(len(S) - 1) if S[k + 1] >= sv), len(S) - 2)))
            t = (sv - S[i]) / ((S[i + 1] - S[i]) or 1); a, c = pts[i], pts[i + 1]; tx, ty = c[0] - a[0], c[1] - a[1]; L = math.hypot(tx, ty) or 1
            return a[0] + tx * t, a[1] + ty * t, a[2] + (c[2] - a[2]) * t, tx / L, ty / L
        return S[-1], at
    ramp = dense([p[:3] for p in P[2:7]]); deck = dense([p[:3] for p in P[6:9]]); bank = dense([p[:3] for p in P[8:10]])
    # ---- the ramp: a slim deck 2.2 m wide, bar railings, round columns in pairs every 6 m ----
    HR = 1.1
    ribbon('RampSurface', ramp, -HR + 0.08, HR - 0.08, -0.06, 0.0, SURF, 2.0)
    ribbon('RampDeck', ramp, -HR, HR, -0.55, -0.06, GREEN, 2.0)
    for sd in (-1, 1):
        ribbon('RampTopRail', ramp, sd * (HR - 0.05) - 0.04, sd * (HR - 0.05) + 0.04, 1.12, 1.2, GREEN)
        ribbon('RampMidRail', ramp, sd * (HR - 0.05) - 0.025, sd * (HR - 0.05) + 0.025, 0.1, 0.15, GREEN)
    L, at = walker(ramp)
    sv = 0.2
    while sv < L:
        x, y, z, tx, ty = at(sv); nx, ny = -ty, tx
        for sd in (-1, 1): lk.box('RampBar', x + nx * sd * (HR - 0.05), y + ny * sd * (HR - 0.05), z, 0.025, 0.025, 1.14, GREEN, rot=math.atan2(ty, tx))
        sv += 0.16
    sv = 3.0
    while sv < L - 1.0:
        x, y, z, tx, ty = at(sv); nx, ny = -ty, tx
        for sd in (-1, 1): lk.cyl('RampColumn', x + nx * sd * (HR - 0.3), y + ny * sd * (HR - 0.3), -6.0, 0.13, z - 0.55 + 6.0, UNDER, seg=10)
        lk.box('RampCross', x, y, z - 0.75, 0.25, 2 * HR - 0.3, 0.2, UNDER, rot=math.atan2(ty, tx))
        sv += 6.0
    # ---- the main span: deck 2.6 m wide between two Warren trusses 1.7 m deep, piers at both ends ----
    HW = 1.45
    ribbon('DeckSurface', deck, -HW + 0.1, HW - 0.1, -0.06, 0.0, SURF, 2.0)
    ribbon('DeckSlab', deck, -HW, HW, -0.6, -0.06, UNDER, 2.0)
    TD = 1.7
    for sd in (-1, 1):
        ribbon('TopChord', deck, sd * HW - 0.07, sd * HW + 0.07, TD - 0.1, TD + 0.06, GREEN)
        ribbon('BottomChord', deck, sd * HW - 0.08, sd * HW + 0.08, -0.62, 0.12, GREEN)
        ribbon('Handrail', deck, sd * (HW - 0.12) - 0.03, sd * (HW - 0.12) + 0.03, 1.05, 1.1, GREEN)
    L2, at2 = walker(deck)
    n = max(4, int(round(L2 / 2.3))); pw = L2 / n
    for k in range(n + 1):
        x, y, z, tx, ty = at2(k * pw); nx, ny = -ty, tx
        for sd in (-1, 1):
            bx, by = x + nx * sd * HW, y + ny * sd * HW
            lk.tube('TrussPost', (bx, by, z), (bx, by, z + TD), 0.045, GREEN, seg=6)
            if k < n:
                x2, y2, z2, _, _ = at2((k + 1) * pw); bx2, by2 = x2 + nx * sd * HW, y2 + ny * sd * HW
                lo, hi = ((bx, by, z), (bx2, by2, z2 + TD)) if k % 2 == 0 else ((bx, by, z + TD), (bx2, by2, z2))
                lk.tube('TrussDiag', lo, hi, 0.04, GREEN, seg=6)
    for sv2 in (1.0, L2 - 1.0):
        x, y, z, tx, ty = at2(sv2); nx, ny = -ty, tx
        for sd in (-1, 1): lk.cyl('Pier', x + nx * sd * (HW - 0.35), y + ny * sd * (HW - 0.35), -7.0, 0.28, z - 0.6 + 7.0, UNDER, seg=14)
        lk.box('PierHead', x, y, z - 0.95, 0.6, 2 * HW + 0.2, 0.36, UNDER, rot=math.atan2(ty, tx))
    # ---- the west approach: the path on an embankment down to Fordhouse Road; a concrete bank seat under the deck end ----
    ribbon('BankPath', bank, -1.2, 1.2, -0.08, 0.0, SURF, 2.0)
    ribbon('Bank', bank, -3.4, 3.4, -9.0, -0.08, BANK, 3.0)
    x, y, z, tx, ty = walker(bank)[1](0.4)
    lk.box('BankSeat', x, y, z - 6.0, 1.2, 2 * HW + 1.2, 5.4, CONC, rot=math.atan2(ty, tx))

FUN = {'a38_footbridge': a38_footbridge, 'victoria_ground': victoria_ground, 'st_johns': st_johns, 'artrix': artrix, 'bromsgrove_station': bromsgrove_station, 'nailers_yard': nailers_yard, 'ladybird': ladybird, 'black_cross': black_cross, 'ewe_and_lamb': ewe_and_lamb, 'hanbury_turn': hanbury_turn, 'queens_head': queens_head, 'tardebigge_church': tardebigge_church, 'engine_house': engine_house, 'tardebigge_tunnel': tardebigge_tunnel}
FUN[NAME]()
lk.export(OUT, NAME)
CAM = {'a38_footbridge': ((-55, -30, 14), (0, 5, 2)), 'victoria_ground': ((-80, -60, 40), (0, 10, 0)), 'st_johns': ((-70, -40, 25), (0, 0, 25)), 'artrix': ((-40, -50, 18), (0, 0, 7)), 'bromsgrove_station': ((-40, 70, 30), (0, 20, 5)), 'nailers_yard': ((10, 60, 25), (18, 0, 6)), 'charles': ((3.5, -14.6, 1.6), (0.09, -12.13, 1.05)), 'ladybird': ((-45, 25, 8), (-8, -2, 4)), 'ewe_and_lamb': ((48, -14, 7), (6, 4, 3)), 'black_cross': ((25, -45, 6), (-8, -14, 4)), 'hanbury_turn': ((40, 34, 12), (3, -10, 3)), 'queens_head': ((-12, -48, 9), (2, 0, 3)), 'tardebigge_church': ((10, -62, 14), (-6, 0, 16)), 'engine_house': ((-50, 10, 9), (-12, -14, 6)), 'tardebigge_tunnel': ((14, 5, 3), (0, 0, 2))}[os.environ.get('CAMK', NAME)]
if PNG: lk.preview(PNG, CAM[0], CAM[1], lens=30)
