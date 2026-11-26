# Tunnel portal for RideWorld's 3D tunnels (public/js/app/tunnels.js), game-style, built by script.
#   /snap/bin/blender -b --python tools/kit/portal.py -- public/models/kit/portal.glb [preview.blend]
# Axes: X across the road (right +), Y along it INTO the tunnel, Z up; metres; origin = the road's centre line at the
# portal face, road level. The opening matches the tube's profile for a 4 m clean road: walls at x = +-W0 up to WALL,
# then a half-ellipse rising 0.75 W0 (tunnels.js profile()); tunnels.js scales it for other widths.
# Headwall 15 m wide x 9 m tall with a projecting coping, an arch ring of wedge stones with a keystone, jambs, wing
# walls angled back towards the approach and stepping down, and a dark recess just inside. Textures are drawn here as
# images (coursed limestone blocks), so they travel inside the .glb.
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0]) if args else '/tmp/portal.glb'
BLEND = os.path.abspath(args[1]) if len(args) > 1 else None
W0, WALL = 3.4, 3.2            # must match tunnels.js (W for a 4 m road, wall height before the arch)
RISE = 0.75 * W0               # the arch's rise
HALF = 7.4                     # headwall half-width (W0 + 4, as the old flat portal)
TOP = 9.0                      # headwall height
THICK = 1.2                    # headwall thickness (into the tunnel, +Y)

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene

# ---------- textures ----------
rng = np.random.default_rng(7)
def blocks_image(name, base, size=512, rows=8, cols=4, mortar=(0.33, 0.31, 0.28), jitter=0.07):
    """coursed blocks: `rows` courses, `cols` blocks per course (offset every other course), each block its own shade"""
    img = np.zeros((size, size, 4), dtype=np.float32)
    img[..., 3] = 1
    rh = size // rows
    for r in range(rows):
        cw = size / cols
        off = (cw / 2) if r % 2 else 0
        for c in range(-1, cols + 1):
            x0 = int(c * cw + off); x1 = int((c + 1) * cw + off)
            shade = 1 + rng.normal(0, jitter)
            col = np.clip(np.array(base) * shade, 0, 1)
            xs = slice(max(0, x0), min(size, x1)); ys = slice(r * rh, (r + 1) * rh)
            img[ys, xs, :3] = col
    noise = rng.normal(0, 0.035, (size, size, 1))
    img[..., :3] = np.clip(img[..., :3] * (1 + noise), 0, 1)
    # mortar lines
    for r in range(rows + 1):
        y = min(size - 1, r * rh); img[max(0, y - 2):y + 2, :, :3] = mortar
    for r in range(rows):
        cw = size / cols; off = (cw / 2) if r % 2 else 0
        for c in range(cols + 1):
            x = int(c * cw + off) % size; img[r * rh:(r + 1) * rh, max(0, x - 2):x + 2, :3] = mortar
    im = bpy.data.images.new(name, size, size)
    im.pixels.foreach_set(img[::-1].ravel())  # Blender's rows run bottom-up
    im.pack()
    return im

def mat(name, image=None, rgb=(0.7, 0.66, 0.58), rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    # a little of its own colour as light (Cesium lights models from the sun only; shaded stone went dark, as on the
    # Formentor lighthouse); not the recess, which is meant to be dark
    if image:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = image
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    else:
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Emission Color'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = 0.22 if (image or rgb[0] > 0.2) else 0.0
    return m

STONE = mat('Stone', blocks_image('stone', (0.80, 0.73, 0.60), rows=6, cols=3, jitter=0.09))
ARCH = mat('ArchStone', blocks_image('arch', (0.90, 0.86, 0.76), rows=1, cols=1, jitter=0.03, mortar=(0.9, 0.86, 0.76)))
COPING = mat('Coping', rgb=(0.86, 0.83, 0.75), rough=0.7)
RECESS = mat('Recess', rgb=(0.08, 0.08, 0.09), rough=1.0)

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

def prism(name, outline, y0, y1, material, uv_scale=2.0):
    """an outline in the x-z plane ([(x, z), ...], anticlockwise seen from -Y) extruded from y0 to y1"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in outline]; b = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    n = len(outline)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material, uv_scale)

def arch_pt(t, grow=0.0):
    """a point on the opening's arch (t from 0 at the right springing to pi at the left), grown outwards by `grow`"""
    return ((W0 + grow) * math.cos(t), WALL + (RISE + grow) * math.sin(t))

def opening(grow=0.0, steps=24):
    pts = [(W0 + grow, -0.5)]
    pts += [arch_pt(math.pi * k / steps, grow) for k in range(steps + 1)]
    pts += [(-W0 - grow, -0.5)]
    return pts

# ---------- headwall: a slab with the opening cut out (built as a ring of quads, no boolean) ----------
def wall_with_hole(name, half, top, y0, y1, hole, material):
    """front and back faces = rectangle minus `hole` (bottom-open outline), joined by the hole's sides and the outside"""
    bm = bmesh.new()
    # pair each hole point with a point on the rectangle: walls straight out sideways, arch points along their ray
    def outer(p):
        x, z = p
        if z <= WALL: return (math.copysign(half, x), z)
        dx, dz = x, z - WALL
        s = min(half / abs(dx) if abs(dx) > 1e-6 else 1e9, (top - WALL) / dz)
        return (dx * s, WALL + dz * s)
    ring = [(p, outer(p)) for p in hole]
    for y, flip in ((y0, False), (y1, True)):
        prev = None
        for p, q in ring:
            vp = bm.verts.new((p[0], y, p[1])); vq = bm.verts.new((q[0], y, q[1]))
            if prev:
                f = (prev[0], vp, vq, prev[1]); bm.faces.new(tuple(reversed(f)) if flip else f)
            prev = (vp, vq)
        # the two top corners the rays skip
        for sx in (-1, 1):
            c = [bm.verts.new((sx * half, y, WALL)), bm.verts.new((sx * half, y, top)), bm.verts.new((0, y, top))]
            bm.faces.new(c if (sx > 0) != flip else list(reversed(c)))
    # the hole's sides (the arch soffit) and the slab's outside edges
    for (p0, _), (p1, _) in zip(ring, ring[1:]):
        bm.faces.new((bm.verts.new((p0[0], y0, p0[1])), bm.verts.new((p1[0], y0, p1[1])), bm.verts.new((p1[0], y1, p1[1])), bm.verts.new((p0[0], y1, p0[1]))))
    for (a, b) in (((-half, -0.5), (-half, top)), ((-half, top), (half, top)), ((half, top), (half, -0.5))):
        bm.faces.new((bm.verts.new((a[0], y0, a[1])), bm.verts.new((b[0], y0, b[1])), bm.verts.new((b[0], y1, b[1])), bm.verts.new((a[0], y1, a[1]))))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material)

GAP = 0.15  # the opening a little bigger than the tube, so the tube's lining shows inside the stones
wall_with_hole('Headwall', HALF, TOP, 0, THICK, opening(GAP + 0.55), STONE)

# ---------- arch ring: wedge stones between the opening and 0.55 m out, standing 0.12 m proud; a bigger keystone ----------
N = 15
for k in range(N):
    t0, t1 = math.pi * k / N, math.pi * (k + 1) / N
    key = k == N // 2
    out = 0.85 if key else 0.55
    j = 0.012  # half a joint, in radians: dark lines between the stones
    a0, a1 = t0 + j, t1 - j
    pts = [arch_pt(a0, GAP), arch_pt(a1, GAP), arch_pt(a1, GAP + out), arch_pt(a0, GAP + out)]
    if key:  # the keystone flares: its outer edge wider
        pts[2] = arch_pt(a1 + 0.05, GAP + out); pts[3] = arch_pt(a0 - 0.05, GAP + out)
    prism('Voussoir' if not key else 'Keystone', [pts[0], pts[3], pts[2], pts[1]], -(0.32 if key else 0.2), THICK, ARCH, uv_scale=0.8)
# jambs: stones up each side of the opening, also proud
for sx in (-1, 1):
    for j in range(4):
        z0, z1 = -0.5 + j * (WALL + 0.5) / 4, -0.5 + (j + 1) * (WALL + 0.5) / 4
        w = 0.55 if j % 2 == 0 else 0.4
        x0 = sx * (W0 + GAP); x1 = sx * (W0 + GAP + w)
        prism('Jamb', [(min(x0, x1), z0 + 0.02), (max(x0, x1), z0 + 0.02), (max(x0, x1), z1 - 0.02), (min(x0, x1), z1 - 0.02)], -0.2, THICK, ARCH, uv_scale=0.8)

# ---------- coping along the top and a plinth along the bottom ----------
prism('Coping', [(-HALF - 0.25, TOP), (HALF + 0.25, TOP), (HALF + 0.25, TOP + 0.45), (-HALF - 0.25, TOP + 0.45)], -0.3, THICK + 0.2, COPING, uv_scale=1.0)
prism('StringCourse', [(-HALF, WALL + RISE + 1.6), (HALF, WALL + RISE + 1.6), (HALF, WALL + RISE + 1.85), (-HALF, WALL + RISE + 1.85)], -0.12, THICK, COPING, uv_scale=1.0)
for sx in (-1, 1):
    x0, x1 = sorted((sx * (W0 + GAP + 0.7), sx * HALF))
    prism('Plinth', [(x0, -0.5), (x1, -0.5), (x1, 0.6), (x0, 0.6)], -0.15, THICK, COPING, uv_scale=1.0)

# ---------- wing walls: from the headwall's ends, angled back towards the approach, their tops sloping down ----------
ANG, LEN, WT = math.radians(30), 7.5, 0.8   # angle back from the headwall line, length, thickness
H0, H1 = TOP - 0.4, 1.4                      # height at the headwall, at the far end
def sloped_box(name, plan, h_near, h_far, z0, material, uv_scale=3.0):
    # plan: 4 (x, y) corners, the first two at the near end
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in plan]
    hs = [h_near, h_far, h_far, h_near]
    hi = [bm.verts.new((x, y, h)) for (x, y), h in zip(plan, hs)]
    bm.faces.new(lo); bm.faces.new(list(reversed(hi)))
    for k in range(4): bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, material, uv_scale)
for sx in (-1, 1):
    ux, uy = sx * math.sin(ANG), -math.cos(ANG)      # along the wing, from the headwall corner
    px, py = -uy * sx * -1, ux * sx * -1              # across it, away from the road
    px, py = (math.cos(ANG) * sx, math.sin(ANG))      # (outwards and a little into the hill)
    ax, ay = sx * (HALF - 0.4), 0.2
    bx, by = ax + ux * LEN, ay + uy * LEN
    plan = [(ax, ay), (bx, by), (bx + px * WT, by + py * WT), (ax + px * WT, ay + py * WT)]
    plan = [plan[0], plan[3], plan[2], plan[1]] if sx < 0 else plan
    near_far = (H0, H1)
    # (sloped_box wants the near end first: corners 0 and 3 are at the headwall)
    sloped_box('Wing', [plan[0], plan[1], plan[2], plan[3]], H0, H1, -0.5, STONE) if sx > 0 else sloped_box('Wing', [plan[0], plan[3], plan[2], plan[1]], H0, H1, -0.5, STONE)
    cap = [(x - px * 0.18, y - py * 0.18) for x, y in plan[:2]] if False else None
    # coping: a slab along the top
    cx0, cy0 = ax - px * 0.15, ay - py * 0.15
    cx1, cy1 = bx - px * 0.15, by - py * 0.15
    cpl = [(cx0, cy0), (cx1, cy1), (cx1 + px * (WT + 0.15), cy1 + py * (WT + 0.15)), (cx0 + px * (WT + 0.15), cy0 + py * (WT + 0.15))]
    bm = bmesh.new()
    hs = [H0, H1, H1, H0]
    lo = [bm.verts.new((x, y, h)) for (x, y), h in zip(cpl, hs)]; hi = [bm.verts.new((x, y, h + 0.2)) for (x, y), h in zip(cpl, hs)]
    bm.faces.new(lo); bm.faces.new(list(reversed(hi)))
    for k in range(4): bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    finish('WingCoping', bm, COPING, uv_scale=1.0)

# ---------- the recess: a dark band lining the first 1.5 m inside the arch (the tube's own lining carries on) ----------
bm = bmesh.new()
inner = opening(GAP + 0.02)
fr = [bm.verts.new((x, THICK - 0.01, z)) for x, z in inner]; bk = [bm.verts.new((x, THICK + 1.5, z)) for x, z in inner]
for i in range(len(inner) - 1): bm.faces.new((fr[i], fr[i + 1], bk[i + 1], bk[i]))
finish('Recess', bm, RECESS)

root = bpy.data.objects.new('TunnelPortal', None); scene.collection.objects.link(root)
for o in objs: o.parent = root
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_cameras=False, export_lights=False, export_image_format='JPEG')
print('WROTE', OUT, os.path.getsize(OUT))
