# Viaduct pier for RideWorld's earthworks (public/js/app/earthworks.js), game-style, built by script.
#   /snap/bin/blender -b --python tools/kit/pier.py -- public/models/kit/pier.glb [preview.blend]
# Axes: X across the road, Y along it, Z up; origin = the top of the cap (the deck's underside sits on it). The shaft
# runs 45 m down, tapering outwards, so it reaches the ground under any viaduct earthworks builds (they are 7-40 m
# deep); what's below the ground is hidden in it. Coursed limestone like the tunnel portal (tools/kit/portal.py).
import bpy, bmesh, os, sys
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0]) if args else '/tmp/pier.glb'
BLEND = os.path.abspath(args[1]) if len(args) > 1 else None
DEPTH = 45.0

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
rng = np.random.default_rng(11)

def blocks_image(name, base, size=512, rows=6, cols=3, mortar=(0.33, 0.31, 0.28), jitter=0.09):
    img = np.zeros((size, size, 4), dtype=np.float32); img[..., 3] = 1
    rh = size // rows
    for r in range(rows):
        cw = size / cols; off = (cw / 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0 = int(c * cw + off); x1 = int((c + 1) * cw + off)
            col = np.clip(np.array(base) * (1 + rng.normal(0, jitter)), 0, 1)
            img[r * rh:(r + 1) * rh, max(0, x0):min(size, x1), :3] = col
    img[..., :3] = np.clip(img[..., :3] * (1 + rng.normal(0, 0.035, (size, size, 1))), 0, 1)
    for r in range(rows + 1):
        y = min(size - 1, r * rh); img[max(0, y - 2):y + 2, :, :3] = mortar
    for r in range(rows):
        cw = size / cols; off = (cw / 2) if r % 2 else 0
        for c in range(cols + 1):
            x = int(c * cw + off) % size; img[r * rh:(r + 1) * rh, max(0, x - 2):x + 2, :3] = mortar
    im = bpy.data.images.new(name, size, size); im.pixels.foreach_set(img[::-1].ravel()); im.pack()
    return im

def mat(name, image=None, rgb=(0.86, 0.83, 0.75)):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.85
    if image:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image
        nt.links.new(t.outputs['Color'], b.inputs['Base Color']); nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    else:
        b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Emission Color'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = 0.22  # Cesium lights models from the sun only (see portal.py)
    return m

STONE = mat('Stone', blocks_image('stone', (0.80, 0.73, 0.60)))
CAP = mat('Cap')
objs = []

def frustum(name, z0, z1, hx0, hy0, hx1, hy1, material, uv_scale=3.0):
    """a box from z0 (half-sizes hx0, hy0) to z1 (hx1, hy1), box-projected UVs"""
    bm = bmesh.new()
    lo = [bm.verts.new((sx * hx0, sy * hy0, z0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    hi = [bm.verts.new((sx * hx1, sy * hy1, z1)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(list(reversed(lo))); bm.faces.new(hi)
    for k in range(4): bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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

# shaft: 2.0 x 1.4 m under the cap, widening to 3.2 x 2.2 m 45 m down (a batter of ~1:37)
frustum('Shaft', -DEPTH, -1.1, 1.6, 1.1, 1.0, 0.7, STONE)
# a band of lighter stone below the cap, then the cap itself, corbelled out under the deck
frustum('Necking', -1.4, -1.1, 1.05, 0.75, 1.05, 0.75, CAP, uv_scale=1.0)
frustum('Corbel', -1.1, -0.45, 1.05, 0.75, 1.45, 1.0, CAP, uv_scale=1.0)
frustum('Cap', -0.45, 0.0, 1.55, 1.1, 1.55, 1.1, CAP, uv_scale=1.0)

root = bpy.data.objects.new('ViaductPier', None); scene.collection.objects.link(root)
for o in objs: o.parent = root
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, export_image_format='JPEG')
print('WROTE', OUT, os.path.getsize(OUT))
