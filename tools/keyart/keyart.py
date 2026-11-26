# Key art for an open world's card (2026-11-24, the owner: "a planet coaster type image ... a cartoony 3d image including the
# church and canals"): the world staged as a sunny diorama and rendered in Cycles. The real ground (LIDAR) painted with
# the game's own painted ground (paintgrab.js in the session notes -> a JPEG over the same box), the game's own landmark
# models where the world file places them, water at its levels, stylised trees from the LIDAR tree list, a rider on the
# path, a bright sky with soft clouds, warm low sun, depth of field.
#   /snap/bin/blender -b --python tools/keyart/keyart.py -- <scene.json> <ground.jpg> <shot.json> <out.png> [samples]
# scene.json: tools/keyart/scene-data.mjs; shot.json: { cam: [x, y, z above ground], at: [x, y, z above ground], lens,
#   rider: { xy, heading (deg, 0 = east, anticlockwise), frame }, sun: { elev, az }, size: [w, h], focus }
import bpy, bmesh, json, math, os, sys, random
from mathutils import Vector, Matrix

A = sys.argv[sys.argv.index('--') + 1:]
SCENE, GROUND, SHOT, OUT = A[0], A[1], A[2], A[3]
SAMPLES = int(A[4]) if len(A) > 4 else 128
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
D = json.load(open(SCENE)); S = json.load(open(SHOT))
random.seed(7)
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene

# ---------- the ground ----------
nx, ny, step = D['nx'], D['ny'], D['step']; W, H = D['size']; G = D['ground']
def gz(x, y):  # ground height (bilinear) at metres from the centre
    fx = min(max((x + W / 2) / W * (nx - 1), 0), nx - 1.001); fy = min(max((H / 2 - y) / H * (ny - 1), 0), ny - 1.001)
    ix, iy = int(fx), int(fy); tx, ty = fx - ix, fy - iy; v = lambda i, j: G[j * nx + i]
    return (v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx) * (1 - ty) + (v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx) * ty
Z0 = gz(*S['cam'][:2])  # everything is placed relative to the ground under the camera, to keep the numbers small
me = bpy.data.meshes.new('Ground'); bm = bmesh.new(); uvl = bm.loops.layers.uv.new()
V = [[bm.verts.new(((c / (nx - 1) - 0.5) * W, (0.5 - r / (ny - 1)) * H, G[r * nx + c] - Z0)) for c in range(nx)] for r in range(ny)]
for r in range(ny - 1):
    for c in range(nx - 1):
        f = bm.faces.new((V[r][c], V[r + 1][c], V[r + 1][c + 1], V[r][c + 1]))
        for l in f.loops: x, y = l.vert.co.x, l.vert.co.y; l[uvl].uv = (x / W + 0.5, y / H + 0.5)
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
ground = bpy.data.objects.new('Ground', me); sc.collection.objects.link(ground)
gm = bpy.data.materials.new('GroundMat'); gm.use_nodes = True; nt = gm.node_tree; bs = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(GROUND); tex.interpolation = 'Cubic'
hsv = nt.nodes.new('ShaderNodeHueSaturation'); hsv.inputs['Saturation'].default_value = 1.5; hsv.inputs['Value'].default_value = 1.0
nt.links.new(tex.outputs['Color'], hsv.inputs['Color']); nt.links.new(hsv.outputs['Color'], bs.inputs['Base Color'])
bs.inputs['Roughness'].default_value = 0.95
ground.data.materials.append(gm)

def mat(name, rgb, rough=0.6, metal=0.0, alpha=1.0, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if alpha < 1: b.inputs['Alpha'].default_value = alpha
    if emit: b.inputs['Emission Color'].default_value = (*rgb, 1); b.inputs['Emission Strength'].default_value = emit
    return m

# ---------- water: ribbons along canals / rivers at their level, areas as flat polygons ----------
WATER = mat('Water', (0.03, 0.24, 0.27), rough=0.03)
# (ripples: a fine stretched noise as a bump, so the surface catches the sky in streaks like real water)
_n = WATER.node_tree.nodes; _l = WATER.node_tree.links
_tc = _n.new('ShaderNodeTexCoord'); _mp = _n.new('ShaderNodeMapping'); _mp.inputs['Scale'].default_value = (0.6, 2.2, 1.0)
_nz = _n.new('ShaderNodeTexNoise'); _nz.inputs['Scale'].default_value = 3.0; _nz.inputs['Detail'].default_value = 6.0
_bp = _n.new('ShaderNodeBump'); _bp.inputs['Strength'].default_value = 0.12
_l.new(_tc.outputs['Object'], _mp.inputs['Vector']); _l.new(_mp.outputs['Vector'], _nz.inputs['Vector']); _l.new(_nz.outputs['Fac'], _bp.inputs['Height'])
_l.new(_bp.outputs['Normal'], _n['Principled BSDF'].inputs['Normal'])
for w in D['water']:
    if not w['lv']: continue
    P = w['pts']; bm = bmesh.new()
    if w['area']:
        vs = [bm.verts.new((x, y, w['lv'][k] + 0.1 - Z0)) for k, (x, y) in enumerate(P)]  # (areas flat at their level: the ground covers them where it's higher)
        try: bm.faces.new(vs)
        except ValueError: pass
    else:
        hw = (w['w'] or 6) / 2 + 0.4; rows = []
        for k, (x, y) in enumerate(P):
            a, b = P[max(0, k - 1)], P[min(len(P) - 1, k + 1)]; tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
            z = max(w['lv'][k], gz(x, y)) + 0.15 - Z0; pass  # (the ground model can sit a little over the water level: it'd hide it)
            rows.append((bm.verts.new((x - ty / L * hw, y + tx / L * hw, z)), bm.verts.new((x + ty / L * hw, y - tx / L * hw, z))))
        for r0, r1 in zip(rows, rows[1:]): bm.faces.new((r0[0], r0[1], r1[1], r1[0]))
    o = bpy.data.objects.new('Water', bpy.data.meshes.new('Water')); bm.to_mesh(o.data); bm.free(); o.data.materials.append(WATER); sc.collection.objects.link(o)

# ---------- the game's own landmark models ----------
cache = {}
def place_glb(path, x, y, z, rot):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    # (under a placing empty: the rider's animation keys its root's own transform, which would snap a moved root back)
    holder = bpy.data.objects.new('Place', None); sc.collection.objects.link(holder)
    holder.matrix_world = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rot, 4, 'Z')
    for r in [o for o in new if o.parent is None]: r.parent = holder
    return new
for L in D['landmarks']:
    p = os.path.join(ROOT, 'public', 'models', L['dir'], L['model'] + '.glb')
    if not os.path.exists(p): print('no model', p); continue
    place_glb(p, L['xy'][0], L['xy'][1], L['ground'] - Z0, -math.radians(L['heading']))
# (the models glow a little for Cesium, which lights from the sun only: in Cycles that looks flat, so turn it down)
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED' and 'Emission Strength' in n.inputs: n.inputs['Emission Strength'].default_value *= 0.15

# ---------- buildings: simple houses (pitched roofs) ----------
WALLS = [mat('Brick', (0.55, 0.28, 0.2), 0.9), mat('Render', (0.86, 0.82, 0.74), 0.9)]; ROOF = mat('Roof', (0.32, 0.2, 0.17), 0.8)
for b in D['buildings']:
    P = b['pts'][:-1] if b['pts'][0] == b['pts'][-1] else b['pts']
    if len(P) < 3: continue
    _cx, _cy = S['cam'][0], S['cam'][1]  # (none round the camera: inside a house the frame is black)
    if min(x for x, y in P) - 5 < _cx < max(x for x, y in P) + 5 and min(y for x, y in P) - 5 < _cy < max(y for x, y in P) + 5: continue
    cx = sum(p[0] for p in P) / len(P); cy = sum(p[1] for p in P) / len(P); z0 = min(gz(x, y) for x, y in P) - Z0
    bm = bmesh.new(); lo = [bm.verts.new((x, y, z0 - 1)) for x, y in P]; hi = [bm.verts.new((x, y, z0 + b['lh'])) for x, y in P]
    for k in range(len(P)): bm.faces.new((lo[k], lo[(k + 1) % len(P)], hi[(k + 1) % len(P)], hi[k]))
    try: bm.faces.new(hi)
    except ValueError: pass
    o = bpy.data.objects.new('House', bpy.data.meshes.new('House')); bm.to_mesh(o.data); bm.free(); o.data.materials.append(random.choice(WALLS)); sc.collection.objects.link(o)
    area = abs(sum(P[k][0] * P[(k + 1) % len(P)][1] - P[(k + 1) % len(P)][0] * P[k][1] for k in range(len(P)))) / 2
    if area > 400 or b['lh'] > 14 or b['lr'] - b['lh'] < 0.5: continue  # (offices, blocks: flat roofs, the walls' top face is enough)
    bm = bmesh.new(); base = [bm.verts.new((x, y, z0 + b['lh'])) for x, y in P]; top = bm.verts.new((cx, cy, z0 + b['lr']))
    for k in range(len(P)): bm.faces.new((base[k], base[(k + 1) % len(P)], top))
    o = bpy.data.objects.new('Roof', bpy.data.meshes.new('Roof')); bm.to_mesh(o.data); bm.free(); o.data.materials.append(ROOF); sc.collection.objects.link(o)

# ---------- trees: a few stylised templates (trunk + lumpy crown of three blobs), instanced at the LIDAR trees ----------
GREENS = [(0.06, 0.4, 0.03), (0.14, 0.5, 0.04), (0.05, 0.3, 0.04), (0.22, 0.55, 0.05), (0.1, 0.44, 0.08)]
BARK = mat('Bark', (0.24, 0.16, 0.1), 0.9)
tcol = bpy.data.collections.new('TreeTemplates'); sc.collection.children.link(tcol); tcol.hide_render = True; tcol.hide_viewport = True
templates = []
for k, g in enumerate(GREENS):
    leaf = mat(f'Leaf{k}', g, 0.75)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.12, depth=1.0, location=(0, 0, 0.5)); trunk = bpy.context.object; trunk.data.materials.append(BARK)
    parts = [trunk]
    for (dx, dy, dz, r) in [(0, 0, 1.0, 0.62), (0.28, 0.12, 0.82, 0.45), (-0.24, -0.18, 0.86, 0.48), (0.05, -0.05, 1.25, 0.4)]:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=(dx, dy, dz)); s = bpy.context.object
        tex = bpy.data.textures.new(f'n{k}{len(parts)}', 'CLOUDS'); tex.noise_scale = 0.35
        md = s.modifiers.new('d', 'DISPLACE'); md.texture = tex; md.strength = 0.18
        bpy.ops.object.modifier_apply(modifier='d'); bpy.ops.object.shade_smooth(); s.data.materials.append(leaf); parts.append(s)
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = trunk; bpy.ops.object.join()
    t = bpy.context.object; t.name = f'Tree{k}'
    for c in t.users_collection: c.objects.unlink(t)
    tcol.objects.link(t); templates.append(t)
CLEAR = [Vector(S['cam'][:2])] + ([Vector(S['rider']['xy'])] if S.get('rider') else [])
def blocks(x, y):  # (a tree on the camera, or in the line from the camera to the rider, fills the frame)
    p = Vector((x, y)); a = CLEAR[0]
    if (p - a).length < 9: return True
    for b in CLEAR[1:]:
        ab = b - a; t = max(0, min(1, (p - a).dot(ab) / (ab.length_squared or 1))); 
        if (p - (a + ab * t)).length < 7: return True
    return False
for (x, y, h, cr) in D['trees']:
    if abs(x) > W / 2 or abs(y) > H / 2 or blocks(x, y): continue
    hgt = max(4.0, min(h, 25.0)) if h < 60 else 10.0  # (h: the tree's height in the LIDAR list)
    sx = max(1.6, cr) * 1.15
    e = bpy.data.objects.new('T', None); e.instance_type = 'COLLECTION'
    one = bpy.data.collections.get('One' + templates[hash((x, y)) % len(templates)].name)
    if one is None:
        t = templates[hash((x, y)) % len(templates)]; one = bpy.data.collections.new('One' + t.name); one.objects.link(t)
    e.instance_collection = one
    e.location = (x, y, gz(x, y) - Z0 - 0.2); e.scale = (sx, sx, hgt / 1.6); e.rotation_euler = (0, 0, random.random() * 6.28)
    sc.collection.objects.link(e)

# ---------- the rider ----------
R = S.get('rider')
if R:
    rx, ry = R['xy']; new = place_glb(os.path.join(ROOT, 'public', 'models', 'rider.glb'), rx, ry, R.get('z', gz(rx, ry)) - Z0, math.radians(R['heading']))
    KIT = {'Jersey': (1.0, 0.27, 0.04), 'Shorts': (0.02, 0.02, 0.025), 'Accent': (1.0, 0.85, 0.2), 'Frame': (0.05, 0.3, 0.85), 'Helmet': (0.95, 0.95, 0.97)}
    for o in new:
        for slot in getattr(o, 'material_slots', []):
            m = slot.material
            if m and m.use_nodes:
                for key, col in KIT.items():
                    if key.lower() in m.name.lower():
                        for n in m.node_tree.nodes:
                            if n.type == 'BSDF_PRINCIPLED': n.inputs['Base Color'].default_value = (*col, 1)
    sc.frame_set(R.get('frame', 6))
    for o in new:  # (the rider file carries a stray icosphere)
        if o.name.startswith('Icosphere'): o.hide_render = True

# ---------- light, sky, clouds ----------
world = bpy.data.worlds.new('Sky'); sc.world = world; world.use_nodes = True; wn = world.node_tree
# a painted sky (Planet Coaster's: deep blue overhead, pale near the horizon), by the view direction's height
sun = S.get('sun', {'elev': 32, 'az': 200})
tc = wn.nodes.new('ShaderNodeTexCoord'); sep = wn.nodes.new('ShaderNodeSeparateXYZ'); ramp = wn.nodes.new('ShaderNodeValToRGB')
wn.links.new(tc.outputs['Generated'], sep.inputs['Vector']); wn.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
# (Generated in a world shader is the view direction: Z runs -1 .. 1, the horizon at 0)
ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.42, 0.68, 0.98, 1)
ramp.color_ramp.elements[1].position = 0.55; ramp.color_ramp.elements[1].color = (0.03, 0.2, 0.78, 1)
wn.links.new(ramp.outputs['Color'], wn.nodes['Background'].inputs['Color']); wn.nodes['Background'].inputs['Strength'].default_value = 1.0
ld = bpy.data.lights.new('Sun', 'SUN'); ld.energy = 5.5; ld.angle = math.radians(2.5); ld.color = (1.0, 0.93, 0.82)
lo = bpy.data.objects.new('Sun', ld); sc.collection.objects.link(lo)
lo.rotation_euler = (math.radians(90 - sun['elev']), 0, math.radians(sun['az'] + 90))
# clouds: big soft white blobs (displaced spheres, a little emission) well behind the scene, in the camera's view
CLOUD = mat('Cloud', (1, 1, 1), rough=1.0, emit=0.35)
cam_xy = Vector(S['cam'][:2]); at_xy = Vector(S['at'][:2]); fwd = (at_xy - cam_xy).normalized(); side = Vector((-fwd.y, fwd.x))
for k in range(9):
    d = 1800 + random.random() * 900; off = (random.random() - 0.5) * 2600
    c = cam_xy + fwd * d + side * off; z = 300 + random.random() * 300
    for j in range(5):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=60 + random.random() * 70, location=(c.x + (random.random() - 0.5) * 220, c.y + (random.random() - 0.5) * 90, z + (random.random() - 0.3) * 50))
        o = bpy.context.object; o.scale = (1.5, 1.0, 0.7); bpy.ops.object.shade_smooth(); o.data.materials.append(CLOUD)

# ---------- camera ----------
cx, cy, ch = S['cam']; tx, ty, th = S['at']
cd = bpy.data.cameras.new('Cam'); cd.lens = S.get('lens', 28); cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (cx, cy, (S['camZ'] if 'camZ' in S else gz(cx, cy) + ch) - Z0); tgt = Vector((tx, ty, (S['atZ'] if 'atZ' in S else gz(tx, ty) + th) - Z0))  # (camZ / atZ: heights in the datum, for shots on bridges)
cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
if S.get('focus'):
    cd.dof.use_dof = True; cd.dof.focus_distance = S['focus']; cd.dof.aperture_fstop = S.get('fstop', 2.8)
cd.clip_end = 6000
cd.shift_y = S.get('shift', 0.0)  # (lens shift: less sky without tipping the verticals)

# ---------- render ----------
sc.render.engine = 'CYCLES'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.render.resolution_x, sc.render.resolution_y = S.get('size', [1600, 1152]); sc.render.resolution_percentage = 100
try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Punchy'
except Exception: sc.view_settings.view_transform = 'Filmic'
sc.render.filepath = OUT; sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('WROTE', OUT)
