# Tower Bridge for RideWorld's London open world: the rebuild of 2026-11-22 (the owner: "absolutely essential to get bang on.
# Perfectly placed in the water, beautifully drawn, proper gaps, roads flowing smoothly either side ... consider it your
# magnum opus"). Replaces the first version of 2026-11-17.
#   node tools/kit/london/tower_bridge_geo.mjs      (the real geometry from the built world -> tower_bridge_geo.json)
#   LK_MAX=256 /snap/bin/blender -b --python tools/kit/london/tower_bridge.py -- public/models/london/tower_bridge.glb [preview.png] [cam]
# Frame: x = across the road (east of the axis looking north is +x), y = along it (north +), z up, metres; origin = the
# landmark's point at the deck's height there (landmarks/london-central.json places it with heading 23). The road
# surface is the world's (world.js draws the deck at its surveyed heights); this model is everything round it.
# Dimensions: OSM's pier outlines (each 21 m along the road x 57 m across: the Act's 70 x 185 ft) with the 200 ft (61 m)
# opening between their faces; side spans 270 ft (82 m); towers 213 ft (65 m) above the river; the high walkways 143 ft
# (44 m) above high water; Cornish granite and Portland stone over a steel frame; blue and white steelwork.
import os, sys, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import lk, bpy, bmesh
import numpy as np
from pubkit import Elev, Frame

A = lk.args(); OUT = A[0]; PNG = A[1] if len(A) > 1 else None; CAMK = A[2] if len(A) > 2 else 'river'
lk.start()
G = json.load(open(os.path.join(HERE, 'tower_bridge_geo.json')))
WATER = G['water']                                   # the river surface (world.js draws it at lv), below the deck
DECK = sorted(G['deck'], key=lambda d: d[1])
def deck_z(v):
    """the world's road height at v along the bridge (its own surveyed deck), relative to the origin's"""
    if v <= DECK[0][1]: return DECK[0][2]
    if v >= DECK[-1][1]: return DECK[-1][2]
    for a, b in zip(DECK, DECK[1:]):
        if a[1] <= v <= b[1]:
            t = (v - a[1]) / ((b[1] - a[1]) or 1); return a[2] + (b[2] - a[2]) * t
    return 0.0
PIERS = {p['name']: [tuple(q) for q in p['pts']] for p in G['piers']}
NP, SP = PIERS['Tower Bridge North Tower'], PIERS['Tower Bridge South Tower']
ext = lambda P, k: (min(q[k] for q in P), max(q[k] for q in P))
AX = (sum(ext(NP, 0)) + sum(ext(SP, 0))) / 4          # the bridge's axis across (the piers' middles; the road runs there)
N_IN, N_OUT = ext(NP, 1); S_OUT, S_IN = ext(SP, 1)    # pier faces along the road: the 61 m opening is N_IN - S_IN
NC, SC = (N_IN + N_OUT) / 2, (S_IN + S_OUT) / 2        # tower centres along the road
F = Frame((AX, 0.0), (AX + 1.0, 0.0), (AX, 1.0))     # u across from the axis, v along: F.T(u, v) = (AX + u, v)
T = F.T

# ---- materials ----
STONE = (0.80, 0.77, 0.70); GRAN = (0.52, 0.52, 0.54); SLATE = (0.26, 0.29, 0.33)
BLUE = (0.42, 0.66, 0.86); WHITE = (0.94, 0.95, 0.96); GLASS = (0.16, 0.2, 0.26); DARKC = (0.1, 0.11, 0.13)
def ashlar(col, rows=10, cols=3, m=0.9): return lk.ashlar(col, rows=rows, cols=cols, mortar=m, jitter=0.05)
STONEM = lk.mat('TBStone', img=lk.image('tbstone', ashlar(STONE, 12, 3)), rough=0.85, glow=0.22)
GRANM = lk.mat('TBGranite', img=lk.image('tbgran', ashlar(GRAN, 6, 2, 0.85)), rough=0.85, glow=0.2)
SLATEM = lk.mat('TBSlate', img=lk.image('tbslate', lk.ashlar(SLATE, rows=24, cols=10, mortar=0.8)), rough=0.6, glow=0.12)
BLUEM = lk.mat('TBBlue', BLUE, rough=0.45, metal=0.25, glow=0.3)
WHITEM = lk.mat('TBWhite', WHITE, rough=0.45, glow=0.3)
GILT = lk.mat('TBGilt', (0.88, 0.7, 0.3), rough=0.3, metal=0.8, glow=0.45)
PAVE = lk.mat('TBPave', img=lk.image('tbpave', lk.ashlar((0.62, 0.62, 0.6), rows=8, cols=4, mortar=0.85)), rough=0.9, glow=0.15)
DARK = lk.mat('TBDark', (0.1, 0.11, 0.13), rough=0.6, glow=0.05)

def quad_rep(name, mat, p0, p1, z0, z1, rep, flip=False):
    """an upright face from p0 to p1 (plan points) between z0 and z1, its texture repeated rep times along it"""
    pts = [(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)]; uvs = [(0, 0), (rep, 0), (rep, 1), (0, 1)]
    if flip: pts = [pts[1], pts[0], pts[3], pts[2]]
    return F._uvface(name, pts, uvs, mat)

# ---- the elevations ----
def gothic_window(e, x, z, w, h, lights=2):
    """a Gothic window: stone surround, dark glass under a pointed head, mullions"""
    e.fill(x - 0.15, z - 0.15, x + w + 0.15, z + h + 0.15, tuple(c * 0.92 for c in STONE))
    e.fill(x, z, x + w, z + h * 0.8, GLASS)
    for k in range(10):
        t = k / 9; dz = h * 0.2 * math.sin(t * math.pi / 2)
        e.fill(x + w * 0.5 * t, z + h * 0.8, x + w - w * 0.5 * t, z + h * 0.8 + dz, GLASS)
    for k in range(1, lights): e.fill(x + w * k / lights - 0.06, z, x + w * k / lights + 0.06, z + h * 0.92, STONE)
    e.fill(x, z + h * 0.45, x + w, z + h * 0.45 + 0.08, STONE)
def courses(e, w, z0, z1, col, step=0.6):
    z = z0
    while z < z1: e.fill(0, z, w, z + 0.03, tuple(c * 0.86 for c in col)); z += step
def river_face(w, z0, z1):
    """a tower's river face (up- or downstream): rusticated granite to the road arch's height, then Portland stone in
    three stages of Gothic windows with string courses, the tall central window at the walkway stage"""
    e = Elev(w, z1 - z0, STONE, ppm=10, grain=0.04); Z = lambda z: z - z0
    e.fill(0, 0, w, Z(12.0), GRAN, grain=0.06); courses(e, w, 0, Z(12.0), GRAN, 0.9)
    courses(e, w, Z(12.0), Z(41.5), STONE, 0.55)
    for zz in (12.0, 25.0, 33.0): e.fill(0, Z(zz) - 0.15, w, Z(zz) + 0.25, tuple(c * 0.8 for c in STONE))
    for k in range(3): gothic_window(e, w / 2 - 0.6 + (k - 1) * 4.6, Z(3.0), 1.2, 3.2, 1)
    for zz, h in ((14.0, 4.4), (19.6, 4.0), (26.8, 4.6)):
        for k in range(3): gothic_window(e, w / 2 - 0.9 + (k - 1) * 4.6, Z(zz), 1.8, h, 2)
    gothic_window(e, w / 2 - 1.6, Z(34.0), 3.2, 5.6, 3)
    for k in (-1, 1): gothic_window(e, w / 2 - 0.6 + k * 5.2, Z(34.6), 1.2, 4.0, 1)
    return e
def road_face_upper(w, z0, z1, walkways):
    """a tower's road face above the arch: stone, window tiers, the walkways' doors (inner faces) or the chains' anchors"""
    e = Elev(w, z1 - z0, STONE, ppm=10, grain=0.04); Z = lambda z: z - z0
    courses(e, w, 0, Z(41.5), STONE, 0.55)
    for zz in (25.0, 33.0): e.fill(0, Z(zz) - 0.15, w, Z(zz) + 0.25, tuple(c * 0.8 for c in STONE))
    for zz, h in ((14.0, 4.4), (19.6, 4.0), (26.8, 4.6)):
        for k in range(4): gothic_window(e, w / 2 - 0.8 + (k - 1.5) * 4.4, Z(zz), 1.6, h, 2)
    if walkways:
        for uu in (-4.3, 4.3): e.fill(w / 2 + uu - 1.6, Z(32.8), w / 2 + uu + 1.6, Z(37.6), DARKC)
    else:
        for k in range(3): gothic_window(e, w / 2 - 0.9 + (k - 1) * 5.0, Z(34.4), 1.8, 4.6, 2)
    e.fill(0, 0, w, 0.6, tuple(c * 0.75 for c in GRAN))
    return e

# ---- a tower (main or shore): body with the road arch, corner turrets, roof ----
def octo(cx, cy, r): return [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), cy + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
def tower(name, vc, hu, hv, base, arch_hu, arch_spring, arch_top, top, roof_h, turret_r, inner_face_v=None, walk=False, scale=1.0):
    """hu / hv: half sizes across / along the road; base: where it stands; the road arch arch_hu wide each side, springing
    at arch_spring, its point at arch_top; top: the cornice; roof_h: the central roof's height"""
    # the legs either side of the arch, full depth, granite
    for s in (-1, 1):
        u0, u1 = sorted((s * arch_hu, s * hu))
        F.block(name + 'Leg', u0, u1, vc - hv, vc + hv, base, min(top, 12.0 * scale), GRANM, uv=3.0)
    # the pointed arch: slices filling from its curve up to the stage above
    n = 26
    for k in range(n):
        ua, ub = -arch_hu + 2 * arch_hu * k / n, -arch_hu + 2 * arch_hu * (k + 1) / n; um = abs((ua + ub) / 2) / arch_hu
        h = arch_spring + (arch_top - arch_spring) * (1 - um ** 1.35)   # a pointed (two-centred) look
        F.block(name + 'ArchFill', ua, ub, vc - hv, vc + hv, h, 12.0 * scale, GRANM, uv=3.0)
        for vv in (vc - hv - 0.25, vc + hv + 0.25):   # the arch's moulding, a granite ring standing proud of each face
            F.box(name + 'ArchRing', (ua + ub) / 2, vv, h - 0.55, ub - ua + 0.02, 0.5, 0.6, GRANM)
    F.block(name + 'Soffit', -arch_hu, arch_hu, vc - hv, vc + hv, arch_top - 0.05, arch_top, DARK)   # (a ceiling seen from the road)
    # the body above the arch, stone, to the cornice
    F.block(name + 'Body', -hu, hu, vc - hv, vc + hv, 12.0 * scale, top, STONEM, uv=3.0)
    # painted faces: the river faces whole height, the road faces above the arch, the legs' road faces
    rf = river_face(2 * hv, base, top).material(name.lower() + 'river')
    F.side(name + 'RiverE', rf, vc - hv, vc + hv, base, top, hu, out=1); F.side(name + 'RiverW', rf, vc - hv, vc + hv, base, top, -hu, out=-1)
    for vv, out in ((vc - hv, -1), (vc + hv, 1)):
        is_inner = inner_face_v is not None and abs(vv - inner_face_v) < 0.01
        uf = road_face_upper(2 * hu, 12.0 * scale, top, walk and is_inner).material(name.lower() + ('in' if is_inner else 'out') + str(out))
        F.face(name + 'RoadFace', uf, -hu, hu, 12.0 * scale, top, v=vv, out=out)
    # projecting string courses round the body (the faces aren't flat: each stage is marked by a stone band) and a corbel
    # table under the cornice
    for zz in (12.0 * scale, 25.0 * scale, 33.0 * scale):
        if zz < top - 1: F.block(name + 'String', -hu - 0.25, hu + 0.25, vc - hv - 0.25, vc + hv + 0.25, zz - 0.2, zz + 0.3, STONEM, uv=1.5)
    F.block(name + 'Corbels', -hu - 0.35, hu + 0.35, vc - hv - 0.35, vc + hv + 0.35, top - 1.2, top, STONEM, uv=1.5)
    # cornice and parapet with battlements
    F.block(name + 'Cornice', -hu - 0.5, hu + 0.5, vc - hv - 0.5, vc + hv + 0.5, top, top + 0.8, STONEM, uv=2.0)
    k = -hu + 0.4
    while k < hu - 0.4:
        for vv in (vc - hv - 0.3, vc + hv + 0.3): F.box(name + 'Merlon', k + 0.35, vv, top + 0.8, 0.7, 0.4, 0.8, STONEM)
        k += 1.4
    # the roof: a steep hipped pyramid of slate with dormers, iron cresting, a lantern and a gilded finial
    rt = top + 0.8
    lk.taper(name + 'Roof', F.rect(-hu + 0.6, hu - 0.6, vc - hv + 0.6, vc + hv - 0.6), rt, F.rect(-1.2, 1.2, vc - 0.8, vc + 0.8), rt + roof_h, SLATEM, uv=2.0)
    for (du, dv) in ((0, -1), (0, 1), (-1, 0), (1, 0)):   # a dormer on each slope
        cu, cv = du * (hu - 3.0), vc + dv * (hv - 3.0)
        F.box(name + 'Dormer', cu, cv, rt + 1.0, 1.6 if dv else 1.2, 1.2 if dv else 1.6, 2.2, STONEM)
        lk.taper(name + 'DormerTop', F.rect(cu - 0.9, cu + 0.9, cv - 0.9, cv + 0.9), rt + 3.2, [T(cu, cv)], rt + 4.6, SLATEM)
    F.block(name + 'Lantern', -1.0, 1.0, vc - 0.7, vc + 0.7, rt + roof_h, rt + roof_h + 2.2 * scale, STONEM)
    lk.taper(name + 'Fleche', F.rect(-1.1, 1.1, vc - 0.8, vc + 0.8), rt + roof_h + 2.2 * scale, [T(0, vc)], rt + roof_h + 5.5 * scale, SLATEM)
    c = T(0, vc); lk.cyl(name + 'Finial', c[0], c[1], rt + roof_h + 5.4 * scale, 0.14, 1.8 * scale, GILT, seg=6)
    # four octagonal corner turrets with tall spire caps and gilded finials
    for su in (-1, 1):
        for sv in (-1, 1):
            cx, cy = T(su * hu, vc + sv * hv)
            lk.prism(name + 'Turret', octo(cx, cy, turret_r), base, top + 2.5 * scale, STONEM, uv=2.0)
            lk.prism(name + 'TurretBand', octo(cx, cy, turret_r + 0.25), top + 0.2, top + 0.9, STONEM, uv=1.5)
            for zz in [z for z in np.arange(4.0 * scale, top - 2, 7.5 * scale)]:   # slit windows up the turret
                for kk in range(4):
                    a = math.pi / 8 + kk * math.pi / 2 + math.pi / 4; px, py = cx + math.cos(a) * (turret_r + 0.02), cy + math.sin(a) * (turret_r + 0.02)
                    lk.box(name + 'TurretSlit', px, py, zz, 0.12, 0.45, 1.8 * scale, DARK, rot=a)
            lk.taper(name + 'TurretSpire', octo(cx, cy, turret_r + 0.15), top + 2.5 * scale, [(cx, cy)], top + 2.5 * scale + 8.0 * scale, SLATEM, uv=2.0)
            lk.cyl(name + 'TurretFinial', cx, cy, top + 10.3 * scale, 0.12, 1.4 * scale, GILT, seg=6)

# ---- the river piers: OSM's outlines in granite, from the riverbed up to their tops ----
PIER_TOP = WATER + 9.0
for nm, P in PIERS.items():
    lk.prism('Pier', P, WATER - 6.0, PIER_TOP, GRANM, uv=3.0)
    lk.prism('PierTide', P, WATER - 0.05, WATER + 1.2, lk.mat('TBTide', (0.32, 0.33, 0.3), rough=0.9, glow=0.1), uv=3.0)   # the dark tide band

# ---- the two main towers on the piers ----
HU, HV = 10.5, (N_OUT - N_IN) / 2 - 1.0               # 21 m across the road; nearly the pier's depth along it
TOP = 41.5; ROOF = 8.5
tower('North', NC, HU, HV, PIER_TOP, 7.8, 7.4, 11.2, TOP, ROOF, 2.6, inner_face_v=NC - HV, walk=True)
tower('South', SC, HU, HV, PIER_TOP, 7.8, 7.4, 11.2, TOP, ROOF, 2.6, inner_face_v=SC + HV, walk=True)

# ---- the high walkways: two lattice girders 44 m above high water, side by side, from tower to tower ----
WZ0 = WATER + 44.0; WZ1 = WZ0 + 4.8
ev = Elev(4.0, 4.8, (0.55, 0.66, 0.74), ppm=32)       # one 4 m panel: blue chords and posts, white X lattice, glazing
ev.fill(0, 0, 4.0, 0.45, BLUE); ev.fill(0, 4.35, 4.0, 4.8, BLUE); ev.fill(0, 0, 0.22, 4.8, BLUE); ev.fill(3.78, 0, 4.0, 4.8, BLUE)
ev.line(0.2, 0.45, 3.8, 4.35, 0.16, WHITE); ev.line(0.2, 4.35, 3.8, 0.45, 0.16, WHITE)
for zz in (1.6, 3.2): ev.fill(0.22, zz, 3.78, zz + 0.08, (0.4, 0.5, 0.58))
LATM = ev.material('tbwalk', rough=0.4, glow=0.3)
wv0, wv1 = SC + HV, NC - HV
for uc in (-4.3, 4.3):
    for s in (-1, 1):
        p0, p1 = T(uc + s * 1.7, wv0), T(uc + s * 1.7, wv1)
        quad_rep('Walkway', LATM, p0, p1, WZ0, WZ1, (wv1 - wv0) / 4.0, flip=(s < 0))
    F.block('WalkwayFloor', uc - 1.75, uc + 1.75, wv0, wv1, WZ0 - 0.5, WZ0, BLUEM)
    F.block('WalkwayRoof', uc - 1.85, uc + 1.85, wv0, wv1, WZ1, WZ1 + 0.35, BLUEM)
    # the cantilever brackets under each end: curved blue arms from the tower face out under the walkway
    for vf, dirv in ((wv0, 1), (wv1, -1)):
        for s in (-1, 1):
            pts = []
            for k in range(9):
                a = (math.pi / 2) * k / 8; dv = 8.0 * (1 - math.cos(a)); dz = 7.0 * math.sin(a)
                pts.append((*T(uc + s * 1.5, vf + dirv * (8.0 - dv)), WZ0 - 7.0 + dz))
            for p, q in zip(pts, pts[1:]): lk.tube('Bracket', p, q, 0.28, BLUEM, seg=6)
            lk.tube('BracketTie', (*T(uc + s * 1.5, vf), WZ0 - 7.0), (*T(uc + s * 1.5, vf + dirv * 8.0), WZ0 - 0.4), 0.12, WHITEM, seg=4)

# ---- the deck furniture along the whole bridge: footways, blue side girders, railings (the road is the world's) ----
ROAD_HALF = 4.25                                      # world.js: a trunk road's 8 m deck (+ its 0.25 m edge)
FOOT = 7.4                                            # the footways out to here; the railings just beyond
def along(v0, v1, step=3.0):
    n = max(1, int(abs(v1 - v0) / step)); return [v0 + (v1 - v0) * k / n for k in range(n + 1)]
def deck_run(v0, v1, girder=True):
    vs = along(v0, v1)
    for a, b in zip(vs, vs[1:]):
        za, zb = deck_z(a), deck_z(b); zm = (za + zb) / 2
        for s in (-1, 1):
            u0, u1 = sorted((s * ROAD_HALF, s * FOOT))
            F.block('Footway', u0, u1, min(a, b), max(a, b), zm - 0.35, zm + 0.12, PAVE, uv=2.0)
            F.block('Kerb', min(s * ROAD_HALF, s * (ROAD_HALF + 0.25)), max(s * ROAD_HALF, s * (ROAD_HALF + 0.25)), min(a, b), max(a, b), zm - 0.35, zm + 0.16, GRANM)
            if girder: F.block('SideGirder', min(s * FOOT, s * (FOOT + 0.7)), max(s * FOOT, s * (FOOT + 0.7)), min(a, b), max(a, b), zm - 2.4, zm + 0.1, BLUEM)
            F.block('RailTop', min(s * (FOOT + 0.25), s * (FOOT + 0.45)), max(s * (FOOT + 0.25), s * (FOOT + 0.45)), min(a, b), max(a, b), zm + 1.15, zm + 1.28, BLUEM)
            F.block('RailMid', min(s * (FOOT + 0.3), s * (FOOT + 0.4)), max(s * (FOOT + 0.3), s * (FOOT + 0.4)), min(a, b), max(a, b), zm + 0.55, zm + 0.62, WHITEM)
        F.block('DeckUnder', -FOOT, FOOT, min(a, b), max(a, b), zm - 1.6, zm - 1.3, lk.mat('TBUnder', (0.27, 0.28, 0.3), rough=0.8, glow=0.1))
    for v in along(v0, v1, 1.6):   # railing posts
        z = deck_z(v)
        for s in (-1, 1): F.box('RailPost', s * (FOOT + 0.35), v, z + 0.1, 0.12, 0.12, 1.15, BLUEM)
# the bascules (between the piers) and the decks through the towers and over the side spans
NA_IN, NA_OUT = N_OUT + 82.0, N_OUT + 82.0 + 14.0     # the shore towers: 270 ft (82 m) beyond the piers
SA_IN, SA_OUT = S_OUT - 82.0, S_OUT - 82.0 - 14.0
deck_run(S_IN, N_IN)
deck_run(N_IN, N_OUT, girder=False); deck_run(S_OUT, S_IN, girder=False)
deck_run(N_OUT, NA_IN); deck_run(SA_IN, S_OUT)
deck_run(NA_IN, NA_OUT, girder=False); deck_run(SA_OUT, SA_IN, girder=False)
# the bascules' meeting line and their leaf ends (a fine dark joint across the footways, the leaves' blue noses below)
for s in (-1, 1):
    vm = (N_IN + S_IN) / 2; z = deck_z(vm)
    u0, u1 = sorted((s * ROAD_HALF, s * FOOT)); F.block('BasculeJoint', u0, u1, vm - 0.04, vm + 0.04, z + 0.12, z + 0.14, DARK)
for vv in ((N_IN + S_IN) / 2 - 0.3, (N_IN + S_IN) / 2 + 0.3):
    F.block('BasculeNose', -FOOT, FOOT, vv - 0.25, vv + 0.25, deck_z(vv) - 2.4, deck_z(vv) - 0.4, BLUEM)

# ---- the shore towers: smaller, the road through their arches ----
SHV = 7.0
for nm, (vin, vout) in (('NorthShore', (NA_IN, NA_OUT)), ('SouthShore', (SA_OUT, SA_IN))):
    vc = (vin + vout) / 2; zb = deck_z(vc)
    tower(nm, vc, 9.0, SHV, zb - 6.0, 7.6, zb + 6.0 * 0.62, zb + 9.0 * 0.62 + 2.0, zb + 19.0, 6.5, 1.9, scale=0.62)

# ---- the suspension chains: curved lattice girders from high on the main towers down to the shore towers ----
CHU = FOOT + 1.4                                      # just outside the railings
def chain(v0, v1, z0, z1, side):
    """one side span's chain on one side: its top member from (v0, z0) at the main tower curving down to (v1, z1) at the
    shore tower (steep by the tower, flattening out towards the shore), the bottom member 1.8 m under it, white lattice
    between, hangers down to the deck girder every 4.5 m"""
    n = 30; top = []; bot = []
    for k in range(n + 1):
        t = k / n; v = v0 + (v1 - v0) * t; z = z1 + (z0 - z1) * (1 - t) ** 2.1
        top.append((*T(side * CHU, v), z)); bot.append((*T(side * CHU, v), z - 1.8 + 0.9 * t))
    for p, q in zip(top, top[1:]): lk.tube('ChainTop', p, q, 0.42, BLUEM, seg=8)
    for p, q in zip(bot, bot[1:]): lk.tube('ChainBottom', p, q, 0.32, BLUEM, seg=8)
    for k in range(n):   # the lattice: posts and diagonals, white
        lk.tube('ChainPost', top[k], bot[k], 0.11, BLUEM, seg=4)
        lk.tube('ChainLattice', top[k], bot[k + 1], 0.09, WHITEM, seg=4); lk.tube('ChainLattice', bot[k], top[k + 1], 0.09, WHITEM, seg=4)
    sg = 1 if v1 > v0 else -1; vs = along(v0 + 2.0 * sg, v1 - 2.0 * sg, 4.5)
    for v in vs:   # hangers
        t = (v - v0) / (v1 - v0); z = z1 + (z0 - z1) * (1 - t) ** 2.1 - 1.8 + 0.9 * t
        lk.tube('Hanger', (*T(side * CHU, v), z), (*T(side * (FOOT + 0.35), v), deck_z(v) + 0.1), 0.07, BLUEM, seg=4)
for s in (-1, 1):
    chain(N_OUT, NA_IN, 27.5, deck_z(NA_IN) + 7.5, s)
    chain(S_OUT, SA_IN, 27.5, deck_z(SA_IN) + 7.5, s)
    # where each chain meets its main tower: a granite block it bears on
    for v in (N_OUT + 0.6, S_OUT - 0.6): F.box('ChainSaddle', s * CHU, v, 25.0, 1.4, 1.2, 3.4, GRANM)

lk.export(OUT, 'TowerBridge')
CAMS = {'river': ((-150, -40, 22), (0, 0, 20)), 'east': ((140, 60, 25), (0, -5, 20)), 'road': ((0, -130, 3.5), (0, 0, 8)),
        'close': ((-40, -10, 12), (0, -5, 15)), 'walk': ((-35, 20, 45), (0, -3, 38))}
if PNG: lk.preview(PNG, CAMS[CAMK][0], CAMS[CAMK][1], lens=30, ground_z=WATER)
