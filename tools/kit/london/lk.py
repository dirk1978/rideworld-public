# Shared helpers for RideWorld's London landmark models (2026-11-17, the owner: "landmarks using quality 3d models").
# Each landmark script does:  import lk; lk.start(); ...shapes...; lk.export(OUT); lk.preview(PNG, cam, target)
# Axes: X east, Y north, Z up, metres, origin = the landmark's ground point (Cesium loads them with forwardAxis X).
# Textures are numpy arrays turned into packed images (they travel inside the .glb). Materials glow a little of their
# own colour: Cesium lights models from the sun only, and shaded faces went dark on the Formentor lighthouse.
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

objs = []
rng = np.random.default_rng(11)

def start():
    bpy.ops.wm.read_homefile(use_empty=True)
    objs.clear()

def args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

# ---------- textures ----------
def image(name, arr):
    """arr: H x W x 3 (0..1, row 0 = top) -> a packed Blender image. LK_MAX=256 in the environment halves bigger
    textures (box-averaged) until they fit: a quarter of the graphics memory (2026-11-21, an Intel laptop lost its WebGL
    context in Bromsgrove at speed)"""
    mx = int(os.environ.get('LK_MAX', '256') or 0)   # (256 by default since 2026-11-23: a quarter of the graphics memory; LK_MAX=0 for full size)
    while mx and max(arr.shape[:2]) > mx and arr.shape[0] % 2 == 0 and arr.shape[1] % 2 == 0:
        arr = (arr[0::2, 0::2] + arr[1::2, 0::2] + arr[0::2, 1::2] + arr[1::2, 1::2]) / 4
    h, w = arr.shape[:2]
    a = np.ones((h, w, 4), dtype=np.float32); a[..., :3] = np.clip(arr, 0, 1)
    im = bpy.data.images.new(name, w, h); im.pixels.foreach_set(a[::-1].ravel()); im.pack()
    return im

def noise(h, w, amt=0.04, blur=0):
    n = rng.normal(0, amt, (h, w, 1)).astype(np.float32)
    for _ in range(blur): n = (n + np.roll(n, 1, 0) + np.roll(n, 1, 1) + np.roll(n, -1, 0) + np.roll(n, -1, 1)) / 5
    return n

def ashlar(base, size=512, rows=8, cols=3, mortar=0.82, jitter=0.05):
    """coursed stone blocks (offset courses), each its own shade, thin pale joints"""
    img = np.zeros((size, size, 3), np.float32); rh = size // rows
    for r in range(rows):
        cw = size / cols; off = cw / 2 if r % 2 else 0
        for c in range(-1, cols + 1):
            x0, x1 = int(c * cw + off), int((c + 1) * cw + off)
            img[r * rh:(r + 1) * rh, max(0, x0):min(size, x1)] = np.array(base) * (1 + rng.normal(0, jitter))
        img[r * rh:r * rh + 2] = np.array(base) * mortar
        for c in range(cols + 1):
            x = int(c * cw + off) % size; img[r * rh:(r + 1) * rh, max(0, x - 1):x + 1] = np.array(base) * mortar
    return img * (1 + noise(size, size, 0.035, 1))

def brick(base=(0.55, 0.3, 0.22), size=512, rows=16, cols=4, mortar=(0.72, 0.7, 0.66)):
    img = np.zeros((size, size, 3), np.float32); rh = size // rows
    for r in range(rows):
        cw = size / cols; off = cw / 2 if r % 2 else 0
        for c in range(-1, cols + 1):
            x0, x1 = int(c * cw + off), int((c + 1) * cw + off)
            img[r * rh:(r + 1) * rh, max(0, x0):min(size, x1)] = np.array(base) * (1 + rng.normal(0, 0.09))
        img[r * rh:r * rh + 3] = mortar
        for c in range(cols + 1):
            x = int(c * cw + off) % size; img[r * rh:(r + 1) * rh, max(0, x - 2):x + 2] = mortar
    return img * (1 + noise(size, size, 0.05))

def windows(wall, glass=(0.16, 0.2, 0.25), frame=None, size=512, nx=4, ny=4, w=0.5, h=0.6, arched=False, sill=None):
    """a wall texture with a grid of windows (one repeat = nx x ny bays); w, h = window share of a bay"""
    img = (wall.copy() if isinstance(wall, np.ndarray) else np.ones((size, size, 3), np.float32) * np.array(wall))
    bw, bh = size / nx, size / ny
    for i in range(nx):
        for j in range(ny):
            x0, x1 = int(i * bw + bw * (1 - w) / 2), int(i * bw + bw * (1 + w) / 2)
            y0, y1 = int(j * bh + bh * (1 - h) / 2), int(j * bh + bh * (1 + h) / 2)
            g = np.array(glass) * (1 + rng.normal(0, 0.08))
            img[y0:y1, x0:x1] = g
            if arched:  # round the top corners off into an arch
                r = (x1 - x0) / 2; cx = (x0 + x1) / 2
                for yy in range(y0, int(y0 + r)):
                    dx = math.sqrt(max(0, r * r - (y0 + r - yy) ** 2))
                    img[yy, x0:int(cx - dx)] = img[yy, x0 - 1] if x0 > 0 else img[yy, x0]
                    img[yy, int(cx + dx):x1] = img[yy, x1] if x1 < size else img[yy, x1 - 1]
            if frame is not None:
                img[y0:y0 + 3, x0:x1] = frame; img[y1 - 3:y1, x0:x1] = frame; img[y0:y1, x0:x0 + 3] = frame; img[y0:y1, x1 - 3:x1] = frame
                img[y0:y1, (x0 + x1) // 2 - 1:(x0 + x1) // 2 + 1] = frame
            if sill is not None: img[y1:y1 + 4, x0 - 3:x1 + 3] = sill
    return img

# ---------- materials ----------
def mat(name, rgb=(0.7, 0.7, 0.7), img=None, rough=0.8, metal=0.0, glow=0.2, alpha=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if img is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if glow: nt.links.new(t.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = glow
    else:
        b.inputs['Base Color'].default_value = (*rgb, 1)
        if glow: b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = glow
    return m

# ---------- shapes (all with box-projected UVs, `uv` metres a repeat) ----------
def finish(name, bm, material, uv=3.0, uvz=None):
    lay = bm.loops.layers.uv.verify(); uvz = uvz or uv
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            if ax == 0: u, v = (c.y if n[0] > 0 else -c.y) / uv, c.z / uvz
            elif ax == 1: u, v = (-c.x if n[1] > 0 else c.x) / uv, c.z / uvz
            else: u, v = c.x / uv, c.y / uv
            l[lay].uv = (u, v)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(material); objs.append(o)
    return o

def prism(name, poly, z0, z1, material, uv=3.0, uvz=None, top=True, bottom=False):
    """a plan outline [(x, y)...] extruded from z0 to z1"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y, z0)) for x, y in poly]; b = [bm.verts.new((x, y, z1)) for x, y in poly]
    n = len(poly)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if top: bm.faces.new(b)
    if bottom: bm.faces.new(list(reversed(a)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material, uv, uvz)

def rect(cx, cy, w, d, rot=0.0):
    c, s = math.cos(rot), math.sin(rot)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]]

def box(name, cx, cy, z0, w, d, h, material, rot=0.0, uv=3.0, uvz=None):
    return prism(name, rect(cx, cy, w, d, rot), z0, z0 + h, material, uv, uvz, bottom=True)

def taper(name, poly0, z0, poly1, z1, material, uv=3.0, cap=True):
    """a frustum between two outlines with the same number of points (poly1 may be one point: a pyramid / spire)"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y, z0)) for x, y in poly0]
    if len(poly1) == 1:
        t = bm.verts.new((*poly1[0], z1))
        for i in range(len(a)): bm.faces.new((a[i], a[(i + 1) % len(a)], t))
    else:
        b = [bm.verts.new((x, y, z1)) for x, y in poly1]
        for i in range(len(a)): bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(a)], b[i]))
        if cap: bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material, uv)

def circle(cx, cy, r, seg=24, a0=0.0):
    return [(cx + r * math.cos(a0 + 2 * math.pi * i / seg), cy + r * math.sin(a0 + 2 * math.pi * i / seg)) for i in range(seg)]

def cyl(name, cx, cy, z0, r, h, material, seg=24, r2=None, uv=3.0):
    if r2 is None: return prism(name, circle(cx, cy, r, seg), z0, z0 + h, material, uv)
    return taper(name, circle(cx, cy, r, seg), z0, circle(cx, cy, r2, seg) if r2 > 0 else [(cx, cy)], z0 + h, material, uv)

def dome(name, cx, cy, z0, r, h, material, seg=32, rings=12, uv=3.0, r_top=0.0):
    """a dome of radius r rising h (an elliptical profile), open at r_top for a lantern"""
    bm = bmesh.new(); rows = []
    for j in range(rings + 1):
        t = j / rings; ang = t * math.pi / 2
        rr = r * math.cos(ang); zz = z0 + h * math.sin(ang)
        if rr < r_top: rr = r_top
        rows.append([bm.verts.new((cx + rr * math.cos(2 * math.pi * i / seg), cy + rr * math.sin(2 * math.pi * i / seg), zz)) for i in range(seg)])
    for j in range(rings):
        for i in range(seg): bm.faces.new((rows[j][i], rows[j][(i + 1) % seg], rows[j + 1][(i + 1) % seg], rows[j + 1][i]))
    if r_top == 0: bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material, uv)

def quad(name, pts, material, uvs=((0, 0), (1, 0), (1, 1), (0, 1))):
    """a single face with its own UVs (a clock dial, a sign)"""
    bm = bmesh.new(); v = [bm.verts.new(p) for p in pts]; f = bm.faces.new(v); lay = bm.loops.layers.uv.verify()
    for l, uvv in zip(f.loops, uvs): l[lay].uv = uvv
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(material); objs.append(o)
    return o

def disc(name, centre, normal, r, material, seg=48):
    """a round face facing `normal`, texture mapped across its square (a clock dial)"""
    n = Vector(normal).normalized(); up = Vector((0, 0, 1)); right = up.cross(n).normalized() if abs(n.z) < 0.9 else Vector((1, 0, 0))
    up = n.cross(right)
    bm = bmesh.new(); vs = []
    for i in range(seg):
        a = 2 * math.pi * i / seg; vs.append(bm.verts.new(Vector(centre) + right * (r * math.cos(a)) + up * (r * math.sin(a))))
    f = bm.faces.new(vs); lay = bm.loops.layers.uv.verify()
    for l, i in zip(f.loops, range(seg)):
        a = 2 * math.pi * i / seg; l[lay].uv = (0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(material); objs.append(o)
    return o

def copy_rot(o, angle, cx=0.0, cy=0.0):
    """a copy of object o turned `angle` radians about the vertical through (cx, cy)"""
    me = o.data.copy(); n = bpy.data.objects.new(o.name + '.r', me); bpy.context.scene.collection.objects.link(n)
    M = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(angle, 4, 'Z') @ Matrix.Translation((-cx, -cy, 0))
    me.transform(M); objs.append(n); return n

def four(o, cx=0.0, cy=0.0):
    """o and three copies at 90-degree turns (towers are the same on every face)"""
    return [o] + [copy_rot(o, math.pi / 2 * k, cx, cy) for k in (1, 2, 3)]

# ---------- output ----------
def merge_by_material():
    """(2026-11-23, graphics performance) every mesh object sharing a material joined into one: the browser draws each
    mesh separately, and models built from thousands of small parts (Tower Bridge's tubes, the locks' bricks, railings)
    cost a draw call each. LK_MERGE=0 keeps them apart"""
    if os.environ.get('LK_MERGE', '1') == '0': return
    groups = {}
    for o in objs:
        if o.type != 'MESH' or not o.data.materials: continue
        groups.setdefault(o.data.materials[0].name, []).append(o)
    for mats, group in groups.items():
        if len(group) < 2: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group: o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
    alive = set(bpy.context.scene.objects)
    objs[:] = [o for o in objs if o in alive]

def export(out, name='Landmark', blend=None):
    merge_by_material()
    root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root)
    for o in objs: o.parent = root
    if blend: bpy.ops.wm.save_as_mainfile(filepath=blend)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    # (Draco mesh compression: smaller downloads, decoded by Cesium off the main thread; LK_DRACO=0 to leave it out)
    draco = os.environ.get('LK_DRACO', '1') != '0'
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, export_image_format='JPEG',
                              export_draco_mesh_compression_enable=draco, export_draco_mesh_compression_level=6, export_draco_position_quantization=16,
                              export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
    print('WROTE', out, os.path.getsize(out))

def preview(png, cam, target, lens=35, size=(960, 720), samples=24, ground_z=0.0):
    """a quick Cycles render to check the look (sun from the south-west, sky colour background)"""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.filepath = png
    w = bpy.data.worlds.new('sky'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.7, 0.9, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8; sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-135)); sc.collection.objects.link(sun)
    g = bpy.data.objects.new('ground', bpy.data.meshes.new('g')); bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=400); bm.to_mesh(g.data); bm.free(); sc.collection.objects.link(g); g.location.z = ground_z
    g.data.materials.append(mat('groundm', (0.35, 0.36, 0.33), glow=0))
    c = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); c.data.lens = lens; c.location = cam; sc.collection.objects.link(c)
    d = Vector(target) - Vector(cam); c.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); sc.camera = c
    bpy.ops.render.render(write_still=True)
    print('RENDERED', png)

def lathe(name, profile, material, seg=48, cx=0.0, cy=0.0, u_rep=1.0, v_len=None, cap_top=True, cap_bottom=False):
    """a turned shape: profile [(r, z)...] bottom to top round the vertical through (cx, cy). UVs wrap: u = turn
    (repeating u_rep times round), v = height / v_len (default the whole height = one repeat)"""
    z0, z1 = profile[0][1], profile[-1][1]; v_len = v_len or (z1 - z0) or 1
    bm = bmesh.new(); lay = bm.loops.layers.uv.verify(); rows = []
    for r, z in profile: rows.append([bm.verts.new((cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
    for j in range(len(profile) - 1):
        for i in range(seg):
            f = bm.faces.new((rows[j][i], rows[j][(i + 1) % seg], rows[j + 1][(i + 1) % seg], rows[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): l[lay].uv = (ii / seg * u_rep, (profile[jj][1] - z0) / v_len)
    if cap_top and profile[-1][0] > 0.01: bm.faces.new(rows[-1])
    if cap_bottom and profile[0][0] > 0.01: bm.faces.new(list(reversed(rows[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(material); objs.append(o)
    return o

def tube(name, p0, p1, r, material, seg=8):
    """a straight round bar from p0 to p1 (cables, lattice members, spokes)"""
    a, b = Vector(p0), Vector(p1); d = b - a; L = d.length
    if L < 1e-6: return None
    q = d.normalized().to_track_quat('Z', 'Y')
    bm = bmesh.new(); r0 = []; r1 = []
    for i in range(seg):
        t = 2 * math.pi * i / seg; off = q @ Vector((r * math.cos(t), r * math.sin(t), 0))
        r0.append(bm.verts.new(a + off)); r1.append(bm.verts.new(b + off))
    for i in range(seg): bm.faces.new((r0[i], r0[(i + 1) % seg], r1[(i + 1) % seg], r1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material, 2.0)

def glass(base=(0.42, 0.52, 0.6), size=512, floors=8, mullions=8, band=(0.3, 0.36, 0.42), sky=0.25):
    """curtain-wall glazing: a soft vertical sky gradient (reflection), floor bands and thin mullions"""
    g = np.linspace(1 + sky, 1 - sky * 0.5, size)[:, None, None]
    img = np.ones((size, size, 3), np.float32) * np.array(base) * g
    img *= (1 + noise(size, size, 0.05, 3))
    for k in range(floors): y = k * size // floors; img[y:y + 5] = band
    for k in range(mullions): x = k * size // mullions; img[:, x:x + 2] = band
    return img

def gothic(base=(0.80, 0.69, 0.50), size=512, panels=4, tiers=2):
    """Perpendicular Gothic panelling (Palace of Westminster): one repeat = tall narrow pointed panels, `tiers` bands"""
    base = np.array(base)
    img = ashlar(base, size, rows=6, cols=1, mortar=0.95, jitter=0.02)
    pw, th = size / panels, size / tiers
    for t in range(tiers):
        for p in range(panels):
            x0, x1 = int(p * pw + pw * 0.18), int(p * pw + pw * 0.82); y0, y1 = int(t * th + th * 0.12), int(t * th + th * 0.9)
            r = (x1 - x0) / 2; cx = (x0 + x1) / 2
            for y in range(y0, y1):
                if y < y0 + r * 1.3: k = (y - y0) / (r * 1.3); half = r * math.sqrt(max(0, 1 - (1 - k) ** 2)); xs, xe = int(cx - half), int(cx + half)
                else: xs, xe = x0, x1
                img[y, xs:xe] *= 0.62; img[y, max(0, xs - 5):xs] *= 1.15; img[y, xe:xe + 5] *= 0.85
            img[y1:y1 + 10, :] *= 0.75; img[y1 - 4:y1, :] *= 1.15
    return img

def gothic_windows(base=(0.80, 0.69, 0.50), size=512, panels=4, tiers=2):
    """the same panelling with real (dark glazed) windows in every other panel: for the parts with rooms behind"""
    img = gothic(base, size, panels, tiers); pw, th = size / panels, size / tiers
    for t in range(tiers):
        for p in range(1, panels, 2):
            x0, x1 = int(p * pw + pw * 0.28), int(p * pw + pw * 0.72); y0, y1 = int(t * th + th * 0.3), int(t * th + th * 0.85)
            img[y0:y1, x0:x1] = (0.14, 0.16, 0.2); img[y0:y1, (x0 + x1) // 2 - 1:(x0 + x1) // 2 + 1] = np.array(base) * 0.8
    return img

def xform(o, M):
    """transform an object's mesh in place (to lay a turned shape on its side, scale it...)"""
    o.data.transform(M); return o
