# Far de Formentor (Cap de Formentor lighthouse) and its café, game-style, for the end of the Cap route.
#   /snap/bin/blender -b --python tools/landmarks/formentor.py -- public/models/landmarks/formentor.glb [preview.blend]
# Blender axes: X east, Y north, Z up, metres; origin = the lighthouse (OSM node 274070169, 39.961368 N 3.212287 E)
# at the building's floor level (169.0 m on Google's height scale; the route entry's landmark `alt`).
# Footprints from OpenStreetMap (ODbL): main building way 247384225, NE outbuilding 474019784; café node 4680436189.
# The ground falls steeply to the north-west (terrace ~170 m, north corner ~153 m), so the buildings stand on stone
# plinths down the slope; terrace furniture sits on Google's ground (heights measured 2026-10-19, GROUND below).
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0]) if args else '/tmp/formentor.glb'
BLEND = os.path.abspath(args[1]) if len(args) > 1 else None
FLOOR = 169.0

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.7, metal=0.0, emit=None, glow=0.22):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    # a little of its own colour as light: Cesium lights the model from the sun only, so the shaded walls came out
    # dark grey-green against Google's evenly lit photo scenery; this keeps them bright and flat, game-style
    b.inputs['Emission Color'].default_value = (*(emit or rgb), 1); b.inputs['Emission Strength'].default_value = 1.5 if emit else glow
    return m

def hexc(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # sRGB -> linear

M = {
    'Wall': mat('Wall', hexc('#ece0b6')), 'Plinth': mat('Plinth', hexc('#a39886'), 0.9), 'Roof': mat('Roof', hexc('#b4533a'), 0.75),
    'Trim': mat('Trim', hexc('#f4f2ea'), 0.6), 'Window': mat('Window', hexc('#27303b'), 0.3), 'Shutter': mat('Shutter', hexc('#3f6b4f'), 0.6),
    'Tower': mat('Tower', hexc('#f7f6f0'), 0.5), 'Glass': mat('Glass', hexc('#bfe3ee'), 0.1, 0.0, hexc('#fff3c4')), 'Iron': mat('Iron', hexc('#2b2e33'), 0.4, 0.8),
    'Dome': mat('Dome', hexc('#7d3a2a'), 0.45, 0.4), 'Canvas': mat('Canvas', hexc('#f1ebdc'), 0.8), 'Stripe': mat('Stripe', hexc('#c0452f'), 0.8),
    'Table': mat('Table', hexc('#f2f2f2'), 0.5), 'Chair': mat('Chair', hexc('#3a3f45'), 0.6), 'Sign': mat('Sign', hexc('#24493a'), 0.6), 'Letter': mat('Letter', hexc('#fbf7e8'), 0.5),
}
objs = []
def obj(name, bm, material):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); me.materials.append(M[material]); objs.append(o); return o

def prism(name, poly, z0, z1, material, inset=0.0):
    """vertical prism from a 2D polygon (anticlockwise), optionally grown outwards by -inset"""
    bm = bmesh.new()
    c = Vector((sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)))
    pts = [Vector(p) + (Vector(p) - c).normalized() * -inset for p in poly]
    bot = [bm.verts.new((p.x, p.y, z0)) for p in pts]; top = [bm.verts.new((p.x, p.y, z1)) for p in pts]
    bm.faces.new(top); bm.faces.new(list(reversed(bot)))
    n = len(pts)
    for i in range(n): bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, material)

def box(name, centre, size, material, rot=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot, 3, 'Z'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=bm.verts)
    return obj(name, bm, material)

def cyl(name, centre, r, h, material, seg=24, r2=None):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector((centre[0], centre[1], centre[2] + h / 2)), verts=bm.verts)
    o = obj(name, bm, material)
    for p in o.data.polygons: p.use_smooth = True
    return o

def sphere(name, centre, r, material, half=False):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r)
    if half: bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
    bmesh.ops.translate(bm, vec=Vector(centre), verts=bm.verts)
    o = obj(name, bm, material)
    for p in o.data.polygons: p.use_smooth = True
    return o

# ---------- main building (OSM way 247384225, its four corners) ----------
MAIN = [(-15.4, 1.6), (-2.1, -13.3), (13.6, 0.5), (0.4, 15.2)]  # W, S, E, N: anticlockwise
WALL_H = 5.6
prism('Plinth', MAIN, -26.0, 0.25, 'Plinth', inset=-0.35)
prism('Walls', MAIN, 0.25, WALL_H, 'Wall')
prism('Cornice', MAIN, WALL_H, WALL_H + 0.35, 'Trim', inset=-0.25)
# hipped roof: eaves 0.7 m out, up to a short ridge
def hip_roof(poly, z0, rise, over):
    c = Vector((sum(p[0] for p in poly) / 4, sum(p[1] for p in poly) / 4))
    eaves = [Vector(p) + (Vector(p) - c).normalized() * over for p in poly]
    bm = bmesh.new()
    ev = [bm.verts.new((p.x, p.y, z0)) for p in eaves]
    apex = bm.verts.new((c.x, c.y, z0 + rise))
    for i in range(4): bm.faces.new((ev[i], ev[(i + 1) % 4], apex))
    bm.faces.new(list(reversed(ev)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj('Roof', bm, 'Roof')
hip_roof(MAIN, WALL_H + 0.35, 4.2, 0.9)

# windows with green shutters on every wall, the café door and sign on the south-east wall (S -> E)
def along(a, b, t): return Vector(a).lerp(Vector(b), t)
for i in range(4):
    a, b = Vector(MAIN[i]), Vector(MAIN[(i + 1) % 4])
    d = (b - a); L = d.length; t_hat = d / L; out = Vector((t_hat.y, -t_hat.x))  # outward for an anticlockwise polygon
    rot = math.atan2(d.y, d.x)
    n = max(2, int(L // 4.2))
    for k in range(n):
        t = (k + 0.5) / n
        if i == 1 and abs(t - 0.62) < 0.12: continue  # the café door goes here
        p = along(a, b, t) + out * 0.06
        box('Window', (p.x, p.y, 2.9), (1.1, 0.12, 1.7), 'Window', rot)
        for s in (-1, 1):
            q = p + t_hat * s * 0.85 + out * 0.04
            box('Shutter', (q.x, q.y, 2.9), (0.55, 0.1, 1.75), 'Shutter', rot)
        q = p + out * 0.05
        box('Sill', (q.x, q.y, 2.0), (1.35, 0.25, 0.12), 'Trim', rot)
# café door + sign on the S -> E wall
a, b = Vector(MAIN[1]), Vector(MAIN[2]); d = b - a; t_hat = d / d.length; out = Vector((t_hat.y, -t_hat.x)); rot = math.atan2(d.y, d.x)
door = along(a, b, 0.62) + out * 0.07
box('Door', (door.x, door.y, 1.4), (1.8, 0.12, 2.6), 'Window', rot)
q = door + out * 0.05
box('DoorFrame', (q.x, q.y, 2.85), (2.3, 0.15, 0.25), 'Trim', rot)
sign_c = along(a, b, 0.62) + out * 0.16
box('SignBoard', (sign_c.x, sign_c.y, 4.25), (7.4, 0.1, 0.95), 'Sign', rot)
def text(body, size, centre, rot):
    bpy.ops.object.text_add(location=(0, 0, 0))
    t = bpy.context.object; t.data.body = body; t.data.size = size; t.data.extrude = 0.02; t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
    bpy.ops.object.convert(target='MESH'); o = bpy.context.object
    o.rotation_euler = (math.pi / 2, 0, rot); o.location = centre
    o.data.materials.clear(); o.data.materials.append(M['Letter']); objs.append(o); return o
text('CAFÈ  ·  FAR DE FORMENTOR', 0.44, (sign_c + out * 0.07).to_3d() + Vector((0, 0, 4.25)), rot)

# ---------- the tower, from the middle of the building ----------
cyl('Tower', (0, 0, 0.25), 2.3, 17.0, 'Tower', 32, 2.05)
cyl('TowerBand', (0, 0, 9.0), 2.2, 0.35, 'Trim', 32)
cyl('Cornice', (0, 0, 17.0), 2.85, 0.45, 'Trim', 32)
cyl('Gallery', (0, 0, 17.45), 3.0, 0.15, 'Iron', 32)
for k in range(24):  # gallery railing posts
    ang = 2 * math.pi * k / 24
    cyl('Post', (2.85 * math.cos(ang), 2.85 * math.sin(ang), 17.6), 0.04, 1.0, 'Iron', 6)
cyl('Rail', (0, 0, 18.55), 2.88, 0.07, 'Iron', 32)
cyl('LanternBase', (0, 0, 17.6), 1.75, 0.6, 'Iron', 24)
cyl('Lantern', (0, 0, 18.2), 1.6, 2.4, 'Glass', 24)
for k in range(8):  # lantern mullions
    ang = 2 * math.pi * k / 8
    cyl('Mullion', (1.62 * math.cos(ang), 1.62 * math.sin(ang), 18.2), 0.05, 2.4, 'Iron', 6)
sphere('Lamp', (0, 0, 19.3), 0.55, 'Glass')
cyl('Eave', (0, 0, 20.6), 1.95, 0.15, 'Iron', 24)
sphere('Dome', (0, 0, 20.75), 1.75, 'Dome', half=True)
cyl('Finial', (0, 0, 22.4), 0.06, 1.0, 'Iron', 6)
sphere('FinialBall', (0, 0, 23.45), 0.16, 'Iron')

# ---------- the north-east outbuilding (OSM 474019784), lower down the slope ----------
NE = [(5.6, 20.0), (20.4, 4.0), (25.0, 7.0), (13.5, 21.2)]
NE_FLOOR = -7.5
prism('NEPlinth', NE, -26.0, NE_FLOOR + 0.2, 'Plinth', inset=-0.3)
prism('NEWalls', NE, NE_FLOOR + 0.2, NE_FLOOR + 3.6, 'Wall')
prism('NERoof', NE, NE_FLOOR + 3.6, NE_FLOOR + 3.9, 'Trim', inset=-0.3)

# ---------- café terrace: tables, chairs and parasols on Google's ground (heights measured 2026-10-19) ----------
GRID_X = [-24, -18, -12, -6, 0, 6, 12, 18, 24, 30]
GRID = {  # y: heights at GRID_X (Google's ground, m)
    0: [155.4, 158.5, 161.2, 162.8, 164.4, 165.9, 167.0, 168.3, 169.8, 171.4],
    -6: [158.5, 161.7, 163.8, 165.4, 166.5, 167.5, 169.1, 169.8, 171.4, 172.5],
    -12: [161.7, 164.8, 167.0, 168.0, 168.6, 169.6, 170.7, 171.4, 172.5, 173.5],
    -18: [164.8, 167.5, 169.6, 170.1, 171.2, 171.7, 172.2, 173.0, 174.0, 174.6],
}
def ground(x, y):
    ys = sorted(GRID); y = max(ys[0], min(ys[-1], y)); x = max(GRID_X[0], min(GRID_X[-1], x))
    j = max(0, min(len(ys) - 2, max(k for k in range(len(ys)) if ys[k] <= y) if any(v <= y for v in ys) else 0))
    i = max(0, min(len(GRID_X) - 2, max(k for k in range(len(GRID_X)) if GRID_X[k] <= x)))
    fy = (y - ys[j]) / (ys[j + 1] - ys[j]); fx = (x - GRID_X[i]) / (GRID_X[i + 1] - GRID_X[i])
    h0 = GRID[ys[j]][i] * (1 - fx) + GRID[ys[j]][i + 1] * fx; h1 = GRID[ys[j + 1]][i] * (1 - fx) + GRID[ys[j + 1]][i + 1] * fx
    return h0 * (1 - fy) + h1 * fy - FLOOR
def parasol(x, y):
    z = ground(x, y)
    cyl('Pole', (x, y, z), 0.04, 2.5, 'Iron', 8)
    bm = bmesh.new()  # striped canopy: 8 panels
    apex = bm.verts.new((x, y, z + 2.75)); ring = [bm.verts.new((x + 1.5 * math.cos(2 * math.pi * k / 8), y + 1.5 * math.sin(2 * math.pi * k / 8), z + 2.25)) for k in range(8)]
    faces = [bm.faces.new((ring[k], ring[(k + 1) % 8], apex)) for k in range(8)]
    me = bpy.data.meshes.new('Canopy'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Canopy', me); scene.collection.objects.link(o); me.materials.append(M['Canvas']); me.materials.append(M['Stripe'])
    for k, p in enumerate(o.data.polygons): p.material_index = k % 2
    objs.append(o)
def table(x, y, chairs=2):
    z = ground(x, y)
    cyl('TableTop', (x, y, z + 0.72), 0.42, 0.04, 'Table', 20); cyl('TableLeg', (x, y, z), 0.04, 0.72, 'Iron', 8)
    for k in range(chairs):
        ang = math.pi * k + 0.4
        cx, cy = x + 0.75 * math.cos(ang), y + 0.75 * math.sin(ang)
        cz = ground(cx, cy)
        box('Seat', (cx, cy, cz + 0.45), (0.42, 0.42, 0.05), 'Chair', ang)
        box('Back', (cx + 0.2 * math.cos(ang), cy + 0.2 * math.sin(ang), cz + 0.72), (0.06, 0.42, 0.5), 'Chair', ang)
        for sx in (-0.17, 0.17):
            for sy in (-0.17, 0.17):
                cyl('ChairLeg', (cx + sx, cy + sy, cz), 0.02, 0.45, 'Iron', 6)
for (x, y) in [(9.5, -8.5), (12.5, -5.5), (6.5, -11.0), (11.0, -11.5), (14.5, -9.0)]:
    table(x, y); parasol(x, y)

for o in objs:
    if o.type == 'MESH':
        for p in o.data.polygons:
            if o.name.startswith(('Walls', 'Plinth', 'Roof', 'NE', 'Window', 'Shutter', 'Sill', 'Door', 'Sign', 'Seat', 'Back')): p.use_smooth = False

root = bpy.data.objects.new('FarDeFormentor', None); scene.collection.objects.link(root)
for o in objs: o.parent = root
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
print('WROTE', OUT, os.path.getsize(OUT))
