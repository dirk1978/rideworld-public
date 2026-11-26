# Railway underbridge portal for RideWorld's tunnel kit (public/js/app/tunnelkit.js, style 'rail'), built by script:
#   /snap/bin/blender -b --python tools/kit/portal_rail.py -- public/models/kit/portal-rail.glb [preview.blend]
# Axes as portal.py: X across the road (right +), Y along it INTO the tunnel, Z up; metres; origin = the road's centre
# line at the portal face, road level. The opening is a rectangle, half-width W0 and H0 tall (tunnelkit.js scales it to
# each tube's size). A Victorian-style bridge: blue-brick abutments with limestone quoins and bed stones, a riveted
# steel plate girder across the opening (painted, flanges and stiffeners), a brick parapet with a stone coping above
# it, and brick wing walls stepping down towards the approach. Textures are drawn here and travel inside the .glb.
import bpy, bmesh, math, os, sys
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0]) if args else '/tmp/portal-rail.glb'
BLEND = os.path.abspath(args[1]) if len(args) > 1 else None
W0, H0 = 3.4, 4.6              # must match tunnelkit.js (RAIL: half-width and clear height the model is built for)
HALF = 7.4                     # face half-width
GIRDER = 1.25                  # girder depth
TOP = H0 + GIRDER + 1.15       # parapet top (girder, then a 1 m brick parapet and its coping)
THICK = 1.0                    # face thickness (into the tunnel, +Y)

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
rng = np.random.default_rng(11)

def to_image(name, img):
    size = img.shape[0]
    im = bpy.data.images.new(name, size, size)
    im.pixels.foreach_set(img[::-1].ravel())
    im.pack()
    return im

def brick_image(name, base, size=512, rows=16, cols=4, mortar=(0.62, 0.6, 0.55)):
    """English bond: courses of stretchers (`cols` bricks) alternating with headers (twice as many), each brick its own
    shade, a few darker 'burnt' ones, soot towards the bottom"""
    img = np.zeros((size, size, 4), dtype=np.float32); img[..., 3] = 1
    rh = size // rows
    for r in range(rows):
        n = cols if r % 2 == 0 else cols * 2
        cw = size / n
        for c in range(n + 1):
            x0, x1 = int(c * cw - (cw / 2 if r % 4 == 3 else 0)), int((c + 1) * cw - (cw / 2 if r % 4 == 3 else 0))
            shade = 1 + rng.normal(0, 0.09) - (0.25 if rng.random() < 0.08 else 0)
            img[r * rh:(r + 1) * rh, max(0, x0):min(size, x1), :3] = np.clip(np.array(base) * shade, 0, 1)
    img[..., :3] *= (1 + rng.normal(0, 0.04, (size, size, 1)))
    for r in range(rows + 1):
        y = min(size - 1, r * rh); img[max(0, y - 2):y + 2, :, :3] = mortar
    for r in range(rows):
        n = cols if r % 2 == 0 else cols * 2; cw = size / n
        for c in range(n + 1):
            x = int(c * cw - (cw / 2 if r % 4 == 3 else 0)) % size; img[r * rh:(r + 1) * rh, max(0, x - 2):x + 2, :3] = mortar
    img[..., :3] = np.clip(img[..., :3], 0, 1)
    return to_image(name, img)

def plain_image(name, base, size=256, noise=0.05, streaks=0):
    img = np.zeros((size, size, 4), dtype=np.float32); img[..., 3] = 1
    img[..., :3] = np.array(base) * (1 + rng.normal(0, noise, (size, size, 1)))
    for _ in range(streaks):  # rust / rain streaks running down
        x = rng.integers(0, size); w = rng.integers(2, 6); l = rng.integers(size // 4, size)
        img[0:l, x:x + w, :3] *= 0.85
    img[..., :3] = np.clip(img[..., :3], 0, 1)
    return to_image(name, img)

def mat(name, image=None, rgb=(0.7, 0.66, 0.58), rough=0.85, glow=0.22):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    if image:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image
        nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    else:
        b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Emission Color'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = glow  # Cesium lights models from the sun only: shaded faces went dark
    return m

BRICK = mat('Brick', brick_image('brick', (0.42, 0.25, 0.20)))
STONE = mat('Stone', plain_image('stone', (0.80, 0.76, 0.66), noise=0.06))
STEEL = mat('Steel', plain_image('steel', (0.20, 0.30, 0.26), noise=0.03, streaks=40), rough=0.6, glow=0.15)
RECESS = mat('Recess', rgb=(0.07, 0.07, 0.08), rough=1.0, glow=0.0)

objs = []
def finish(name, bm, material, uv_scale=3.0):
    """box-project UVs (each face onto its main axis plane, `uv_scale` metres a repeat) and make the object"""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            u, v = ((c.y, c.z) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y))
            l[uv].uv = (u / uv_scale, v / uv_scale)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); me.materials.append(material); objs.append(o)
    return o

def box(name, x0, x1, y0, y1, z0, z1, material, uv_scale=3.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1; v.co.y = y0 if v.co.y < 0 else y1; v.co.z = z0 if v.co.z < 0 else z1
    return finish(name, bm, material, uv_scale)

# ---------- abutments: brick from the opening out to the face's edge, up to the girder's seat ----------
for sx in (-1, 1):
    a, b = sorted((sx * W0, sx * HALF))
    box('Abutment', a, b, 0, THICK, -0.5, H0, BRICK, uv_scale=1.5)
    # limestone quoins up the opening's edge, alternately long and short, standing 4 cm proud
    z = -0.5
    k = 0
    while z < H0 - 0.05:
        h = min(0.45, H0 - z); w = 0.7 if k % 2 == 0 else 0.45
        qa, qb = sorted((sx * W0, sx * (W0 + w)))
        box('Quoin', qa, qb, -0.04, THICK, z + 0.015, z + h - 0.015, STONE, uv_scale=1.0)
        z += h; k += 1
    # the bed stone the girder sits on
    ba, bb = sorted((sx * (W0 - 0.1), sx * (W0 + 1.3)))
    box('BedStone', ba, bb, -0.08, THICK, H0 - 0.05, H0 + 0.25, STONE, uv_scale=1.0)
    # pilaster at the face's outer end
    pa, pb = sorted((sx * (HALF - 0.6), sx * HALF))
    box('Pilaster', pa, pb, -0.12, THICK, -0.5, TOP - 0.25, BRICK, uv_scale=1.5)
    box('PilasterCap', pa - 0.08, pb + 0.08, -0.2, THICK + 0.05, TOP - 0.25, TOP + 0.05, STONE, uv_scale=1.0)
    # brick between the bed stone and the parapet, beside the girder
    ca, cb = sorted((sx * (W0 + 1.3), sx * (HALF - 0.6)))
    box('Spandrel', ca, cb, 0, THICK, H0, TOP - 1.15, BRICK, uv_scale=1.5)

# ---------- the girder: a plate girder spanning the opening, flanges proud, stiffeners every ~0.9 m ----------
GX = W0 + 1.25
gz0, gz1 = H0 + 0.25, H0 + 0.25 + GIRDER
box('GirderWeb', -GX, GX, 0.15, THICK, gz0 + 0.06, gz1 - 0.06, STEEL, uv_scale=2.0)
for z0, z1 in ((gz0, gz0 + 0.08), (gz1 - 0.08, gz1)):
    box('GirderFlange', -GX - 0.05, GX + 0.05, -0.12, THICK, z0, z1, STEEL, uv_scale=2.0)
n = int(2 * GX / 0.9)
for i in range(n + 1):
    x = -GX + 0.1 + i * (2 * GX - 0.2) / n
    box('Stiffener', x - 0.05, x + 0.05, -0.08, 0.15, gz0 + 0.08, gz1 - 0.08, STEEL, uv_scale=1.0)
# the underside of the deck just inside, dark (the tube's soffit carries on)
box('DeckUnder', -W0, W0, 0.15, THICK + 1.2, gz0 - 0.02, gz0 + 0.06, RECESS)

# ---------- parapet over the girder: brick, stone coping, the whole width ----------
box('Parapet', -HALF + 0.6, HALF - 0.6, 0.1, THICK, gz1, TOP - 0.15, BRICK, uv_scale=1.5)
box('ParapetCoping', -HALF + 0.55, HALF - 0.55, 0.0, THICK + 0.08, TOP - 0.15, TOP, STONE, uv_scale=1.0)
box('StringCourse', -HALF + 0.6, HALF - 0.6, 0.02, THICK, gz1, gz1 + 0.12, STONE, uv_scale=1.0)

# ---------- wing walls: brick, angled back 30 deg towards the approach, stepping down ----------
ANG, LEN, WT = math.radians(30), 7.0, 0.7
STEPS = [(0, 2.4, TOP - 0.6), (2.4, 4.8, TOP - 2.2), (4.8, LEN, 1.6)]
for sx in (-1, 1):
    ux, uy = sx * math.sin(ANG), -math.cos(ANG)    # along the wing, away from the face (towards the approach)
    px, py = sx * math.cos(ANG), math.sin(ANG)     # across it, outwards
    ax, ay = sx * (HALF - 0.3), 0.3
    for s0, s1, h in STEPS:
        corners = [(ax + ux * s0, ay + uy * s0), (ax + ux * s1, ay + uy * s1), (ax + ux * s1 + px * WT, ay + uy * s1 + py * WT), (ax + ux * s0 + px * WT, ay + uy * s0 + py * WT)]
        for nm, z0, z1, m, sc in (('Wing', -0.5, h, BRICK, 1.5), ('WingCoping', h, h + 0.18, STONE, 1.0)):
            bm = bmesh.new()
            grow = 0.08 if nm == 'WingCoping' else 0
            cs = corners if not grow else [(x - px * grow, y - py * grow) if i in (0, 1) else (x + px * grow, y + py * grow) for i, (x, y) in enumerate(corners)]
            lo = [bm.verts.new((x, y, z0)) for x, y in cs]; hi = [bm.verts.new((x, y, z1)) for x, y in cs]
            bm.faces.new(lo); bm.faces.new(list(reversed(hi)))
            for k in range(4): bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            finish(nm, bm, m, sc)

root = bpy.data.objects.new('RailBridgePortal', None); scene.collection.objects.link(root)
for o in objs: o.parent = root
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, export_image_format='JPEG')
print('WROTE', OUT, os.path.getsize(OUT))
