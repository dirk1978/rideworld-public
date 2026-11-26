# Builds public/models/rider.glb: a MakeHuman (MPFB2, CC0 assets) cyclist in kit, posed on the procedural road
# bike from bike.py, with two animations: "pedal" (one crank revolution, legs by IK) and "wheels".
#
#   /snap/bin/blender -b --python tools/rider/build_rider.py -- public/models/rider.glb [preview.blend]
#
# Needs Blender 4.5 with the MPFB extension and the MakeHuman system assets (see tools/rider/README.md).
# Axes: +X forward, +Y left, +Z up, metres. Material names (Jersey, Shorts, Accent, Frame, Helmet) are what the
# app recolours at load time.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bike as B
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0]) if args else '/tmp/rider.glb'
BLEND = os.path.abspath(args[1]) if len(args) > 1 else None
FRAMES = 24  # one crank revolution

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start, scene.frame_end = 0, FRAMES


def update():
    bpy.context.view_layer.update()


def pbr(name, color, rough=0.6, metal=0.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


# ---------------------------------------------------------------- human
macro = {"gender": 1.0, "age": 0.45, "muscle": float(os.environ.get("RW_MUSCLE", 0.62)),  # (0.5 until 2026-11-03: "shoulders a bit underdeveloped")
         "weight": 0.5, "proportions": 0.8, "height": 0.6,
         "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0}}
body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
# flatter buttocks (the owner 2026-10-18: "too round and shiny and distracting"); baked in with the other shape keys
TargetService.load_target(body, TargetService.target_full_path("buttocks-volume-decr"), weight=0.9)
# (2026-11-03, the owner: "the neck still looks really weird - it's too long and the head too low ... giraffe style") a
# shorter neck and a little more shoulder (riders' shoulders are broad and hunched; the neck hardly shows)
TUNE = {k: float(os.environ.get('RW_' + k, d)) for k, d in (('NECK_SHORT', 0.5), ('SHOULDERS', 0.35), ('REACH', 0.9), ('CLAV_FWD', 5), ('CLAV_UP', 0), ('EYE_DOWN', 12), ('NECK_TILT', 8), ('NECK_LOW', 0.015), ('NECK_UP', 0.42), ('SWAY', 1.0), ('DELTS', 0.6), ('TRAPS', 0.5), ('SOCK_TOP', 0.03), ('STAND', 1), ('STAND_FWD', 0.17), ('ROCK', 7.0), ('STAND_ARM', 0.8), ('SPACERS', 5), ('STEM_LEN', 0.104), ('STEM_ANGLE', 6.6))}  # (the owner: on the hoods with the original back; a low pro position isn't how most ride)
print('TUNE', TUNE)
TargetService.load_target(body, TargetService.target_full_path("measure-neck-height-decr"), weight=TUNE['NECK_SHORT'])
TargetService.load_target(body, TargetService.target_full_path("measure-shoulder-dist-incr"), weight=TUNE['SHOULDERS'])
# fuller deltoids and a thicker neck base (traps): with slight shoulders hunched, the head looked dropped between them
for side in ("l", "r"):
    TargetService.load_target(body, TargetService.target_full_path(f"{side}-upperarm-shoulder-muscle-incr"), weight=TUNE['DELTS'])
TargetService.load_target(body, TargetService.target_full_path("neck-scale-horiz-incr"), weight=TUNE['TRAPS'] * 0.6)
TargetService.load_target(body, TargetService.target_full_path("torso-muscle-dorsi-incr"), weight=TUNE['TRAPS'])
rig = HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
skin_file = os.path.join(LocationService.get_user_data("skins"), "young_caucasian_male", "young_caucasian_male.mhmat")
HumanService.set_character_skin(skin_file, body, skin_type="GAMEENGINE")
body.data.materials[0].name = "Skin"
# trainers with white socks (MakeHuman shoes05); MPFB hides the body's feet under them with a mask
shoes_file = os.path.join(LocationService.get_user_data("clothes"), "shoes05", "shoes05.mhclo")
_before = set(bpy.data.objects)
HumanService.add_mhclo_asset(shoes_file, body, asset_type="Clothes", subdiv_levels=0, material_type="MAKESKIN")
shoes = [o for o in bpy.data.objects if o not in _before and o.type == 'MESH'][0]
shoes.name = "Shoes"

# bake the body-shape targets (shape keys) into the mesh, then drop the helper geometry for good
bpy.context.view_layer.objects.active = body
if body.data.shape_keys:
    with bpy.context.temp_override(object=body, active_object=body):
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
for m in list(body.modifiers):
    if m.type == 'MASK':
        with bpy.context.temp_override(object=body, active_object=body):
            bpy.ops.object.modifier_apply(modifier=m.name)

# face +X instead of -Y (kept as an object rotation; everything below works in world space)
rig.rotation_euler = (0, 0, math.radians(90))
update()
W = rig.matrix_world


def bone_world(name, tail=False):
    b = rig.data.bones[name]
    return W @ (b.tail_local if tail else b.head_local)


# ---------------------------------------------------------------- kit: assign faces to materials
mats = {
    "Skin": body.data.materials[0],
    "Jersey": pbr("Jersey", (0.9, 0.25, 0.03), 0.65),
    "Accent": pbr("Accent", (0.03, 0.03, 0.04), 0.6),
    "Shorts": pbr("Shorts", (0.02, 0.022, 0.03), 0.78),  # matt lycra (0.45 was glossy)
}
for n in list(mats)[1:]:
    body.data.materials.append(mats[n])
slot = {n: i for i, n in enumerate(m.name for m in body.data.materials)}

groups = {vg.index: vg.name for vg in body.vertex_groups}
me = body.data


def along(name, p):
    """0 at bone head .. 1 at bone tail (rest pose)"""
    h, t = bone_world(name), bone_world(name, True)
    d = t - h
    return (p - h).dot(d) / d.length_squared


neck_base_z = bone_world("neck_01").z + 0.025
# the neckline dips at the front like a jersey collar (2026-11-03: a level cut put the collar under the chin once the
# head came up over the bars: "turtleneck"); a plane through the neck base, NECK_TILT degrees lower at the front (+X)
_nk = bone_world("neck_01")
NECK_P = Vector((_nk.x - 0.055, 0, neck_base_z - 0.01 - TUNE['NECK_LOW']))  # pivot at the BACK of the neck: only the front dips  # (lower: the head tipped up squeezed the back of the collar to the hairline)
NECK_N = Vector((math.tan(math.radians(TUNE['NECK_TILT'])), 0, 1)).normalized()
above_neckline = lambda c: (c - NECK_P).dot(NECK_N) > 0
waist_z = bone_world("pelvis").z + 0.1

# Clean hems (the owner 2026-10-18: the jersey / shorts line was jagged): before colouring, cut the body's mesh exactly
# along each hem, so whole faces fall on one side of it. Each cut only touches faces belonging to that body part.
Minv = body.matrix_world.inverted()
bmh_ = bmesh.new(); bmh_.from_mesh(me)
dl = bmh_.verts.layers.deform.active


def dominant(f):
    acc = {}
    for v in f.verts:
        for gi, w in v[dl].items():
            n = groups.get(gi)
            if n and w > 0 and not n.startswith(("joint", "helper")) and n not in ("body", "Left", "Right", "Mid"):
                acc[n] = acc.get(n, 0) + w
    return max(acc, key=acc.get) if acc else ""


def cut(part, co, no):
    """bisect the faces whose dominant bone passes `part` (a test on the bone name) with a world-space plane"""
    faces = [f for f in bmh_.faces if part(dominant(f))]
    if not faces:
        return
    edges = {e for f in faces for e in f.edges}; verts = {v for f in faces for v in f.verts}
    n_l = (Minv.to_3x3() @ Vector(no)).normalized()
    bmesh.ops.bisect_plane(bmh_, geom=faces + list(edges) + list(verts), plane_co=Minv @ Vector(co), plane_no=n_l)


torso = lambda n: n.startswith(("spine", "clavicle", "pelvis")) or n == "neck_01"
cut(torso, (0, 0, waist_z), (0, 0, 1))                      # jersey hem
cut(torso, tuple(NECK_P), tuple(NECK_N))                    # neckline (dipping at the front)
for suf in ("_l", "_r"):
    for bone, ts in (("upperarm", (0.42, 0.5)), ("thigh", (0.7, 0.77))):   # sleeve ends, leg grippers
        h, t = bone_world(bone + suf), bone_world(bone + suf, True)
        for tt in ts:
            cut(lambda n, b=bone + suf: n == b, h + (t - h) * tt, t - h)
bmh_.to_mesh(me); bmh_.free()
me.update()
for poly in me.polygons:
    c = body.matrix_world @ poly.center
    # dominant bone for this face
    acc = {}
    for vi in poly.vertices:
        for g in me.vertices[vi].groups:
            n = groups.get(g.group)
            if n and not n.startswith(("joint", "helper")) and n not in ("body", "Left", "Right", "Mid") and g.weight > 0:
                acc[n] = acc.get(n, 0) + g.weight
    dom = max(acc, key=acc.get) if acc else ""
    m = "Skin"
    if dom.startswith(("spine", "clavicle", "pelvis")) or dom == "neck_01":
        if above_neckline(c):
            m = "Skin"
        elif c.z > waist_z:
            m = "Jersey"
        else:
            m = "Shorts"
    elif dom.startswith("upperarm"):
        t = along(dom, c)
        m = "Jersey" if t < 0.42 else "Accent" if t < 0.5 else "Skin"
    elif dom.startswith("thigh"):
        t = along(dom, c)
        m = "Shorts" if t < 0.7 else "Accent" if t < 0.77 else "Skin"
    poly.material_index = slot[m]

# ---------------------------------------------------------------- kit texture layout (2026-11-03)
# The jersey gets its own UV layout so the app can paint designs on it (public/js/app/kit.js draws to the same plan;
# docs: tools/rider/README.md, upload template public/img/kit-template.png). In the rest pose the rider faces +X, left
# is +Y. Texture rows from the top (v): torso 0 .. TORSO_V, sleeves SLEEVE_V0 .. SLEEVE_V1 (left u 0-0.5, right 0.5-1).
# Torso u runs round the body from the right-hand side seam: 0.25 the front centre, 0.5 the left side, 0.75 the back
# centre (wraps). Its v is height, linear from the collar's back (0) to the hem (TORSO_V). Sleeves: u round the arm
# with the seam underneath, v from the shoulder (SLEEVE_V0) to the cuff (SLEEVE_V1).
TORSO_V, SLEEVE_V0, SLEEVE_V1 = 0.5625, 0.6, 0.8
uvl = me.uv_layers.active.data
Mw = body.matrix_world
jv = [Mw @ me.vertices[i].co for poly in me.polygons if poly.material_index == slot["Jersey"] for i in poly.vertices]
top_z = NECK_P.z + 0.03
ax_x = sum(p.x for p in jv) / len(jv)
print("KIT UV torso x", round(ax_x, 3), "z", round(waist_z, 3), "-", round(top_z, 3))
def torso_uv(p):
    a = math.atan2(p.y, p.x - ax_x)  # 0 front, +pi/2 left, pi back
    return ((a + math.pi / 2) / (2 * math.pi)) % 1.0, (top_z - p.z) / (top_z - waist_z) * TORSO_V
def sleeve_uv(dom, p):
    h, t = bone_world(dom), bone_world(dom, True)
    d = (t - h).normalized()
    ref = Vector((0, 0, -1)); ref = (ref - d * ref.dot(d)).normalized()          # the seam: underneath
    side = d.cross(ref)
    r = p - h - d * (p - h).dot(d)
    a = math.atan2(r.dot(side), r.dot(ref)) % (2 * math.pi)
    left = dom.endswith("_l")
    return (a / (2 * math.pi)) * 0.48 + (0.01 if left else 0.51), SLEEVE_V0 + min(1.0, along(dom, p) / 0.42) * (SLEEVE_V1 - SLEEVE_V0)
for poly in me.polygons:
    if poly.material_index != slot["Jersey"]:
        continue
    dom = ""
    acc = {}
    for vi in poly.vertices:
        for g in me.vertices[vi].groups:
            n = groups.get(g.group)
            if n and n.startswith(("upperarm", "spine", "clavicle", "pelvis", "neck")) and g.weight > 0:
                acc[n] = acc.get(n, 0) + g.weight
    dom = max(acc, key=acc.get) if acc else ""
    uvs = [(sleeve_uv(dom, Mw @ me.vertices[vi].co) if dom.startswith("upperarm") else torso_uv(Mw @ me.vertices[vi].co)) for vi in poly.vertices]
    us = [u for u, v in uvs]
    if max(us) - min(us) > 0.5:  # straddles the wrap: keep the face whole (the sampler repeats)
        uvs = [(u + 1 if u < 0.5 else u, v) for u, v in uvs]
    for li, uv in zip(poly.loop_indices, uvs):
        uvl[li].uv = (uv[0], 1 - uv[1])  # Blender's v is up; the glTF exporter flips it back
# shoes and socks coloured separately: the socks are the top of the shoes05 mesh (one texture, now two materials)
sm = shoes.data
sm.materials[0].name = "Shoes"
socks_m = sm.materials[0].copy(); socks_m.name = "Socks"; sm.materials.append(socks_m)
ankle_z = max(bone_world("foot_l").z, bone_world("foot_r").z)
n_socks = 0
for poly in sm.polygons:
    if (shoes.matrix_world @ poly.center).z > ankle_z + TUNE['SOCK_TOP']:
        poly.material_index = 1; n_socks += 1
print("SOCKS faces", n_socks, "of", len(sm.polygons), "ankle z", round(ankle_z, 3))
KIT_TEST = os.environ.get("RW_KIT_TEST")
if KIT_TEST:  # renders only: paint a test image on the jersey
    jm = mats["Jersey"]; nt = jm.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(KIT_TEST)
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    for nm, col in (("Socks", (1, 0.1, 0.1, 1)), ("Shoes", (0.1, 0.3, 1, 1))):  # tint like the app does
        mt = bpy.data.materials[nm]; bsdf = next(n for n in mt.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        src = bsdf.inputs["Base Color"].links[0].from_socket if bsdf.inputs["Base Color"].links else None
        mix = mt.node_tree.nodes.new("ShaderNodeMix"); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
        if src: mt.node_tree.links.new(src, mix.inputs[6])
        mix.inputs[7].default_value = col
        mt.node_tree.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

# Soften the cleft between the buttocks under the shorts (the owner: "still too defined"): smooth the shorts' surface
# behind the hips near the middle, as lycra would bridge it.
pelvis_w = bone_world("pelvis")
bms = bmesh.new(); bms.from_mesh(me)
Mw = body.matrix_world
behind = [v for v in bms.verts
          if any(f.material_index == slot["Shorts"] for f in v.link_faces)
          and (Mw @ v.co).x < pelvis_w.x - 0.02 and abs((Mw @ v.co).y - pelvis_w.y) < 0.075
          and pelvis_w.z - 0.2 < (Mw @ v.co).z < pelvis_w.z + 0.08]
for _ in range(12):
    bmesh.ops.smooth_vert(bms, verts=behind, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bms.to_mesh(me); bms.free()
me.update()
print("SMOOTHED", len(behind))

# ---------------------------------------------------------------- helmet and glasses (rigid, parented to the head bone)
# 2026-10-18 (the owner: helmet "a bit too time-trial", glasses "look silly"): the helmet was a squashed egg with a
# pointed tail and the glasses one thick dark band. Now the helmet is the skull's own shape pushed out by the foam,
# with dark vent openings, and the glasses are two wrap lenses on a thin frame with arms to the ears.
from mathutils.bvhtree import BVHTree
head_verts = [body.matrix_world @ v.co for v in me.vertices
              if any(groups.get(g.group) == "head" and g.weight > 0.6 for g in v.groups)]
hx = [p.x for p in head_verts]; hy = [p.y for p in head_verts]; hz = [p.z for p in head_verts]
head_c = Vector(((min(hx) + max(hx)) / 2, (min(hy) + max(hy)) / 2, (min(hz) + max(hz)) / 2))
head_size = Vector((max(hx) - min(hx), max(hy) - min(hy), max(hz) - min(hz)))
print("HEAD", head_c, head_size)
bvh = BVHTree.FromPolygons([body.matrix_world @ v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons])


def skin_out(origin, direction, far=0.4):
    """outermost point of the body seen from `far` out along `direction` from `origin`"""
    d = Vector(direction).normalized()
    hit = bvh.ray_cast(origin + d * far, -d)
    return hit[0]


mats["Helmet"] = pbr("Helmet", (0.95, 0.95, 0.95), 0.3)
mats["HelmetInner"] = pbr("HelmetInner", (0.02, 0.02, 0.02), 0.8)
mats["Lens"] = pbr("Lens", (0.03, 0.035, 0.05), 0.06, 0.8)
mats["GlassFrame"] = pbr("GlassFrame", (0.02, 0.02, 0.025), 0.35)

eye_z = min(hz) + head_size.z * 0.55
HC = head_c + Vector((-0.01, 0, 0.0))          # helmet centre, for the radial shaping


brow = eye_z + 0.032 - HC.z
front_x, back_x = max(hx) - HC.x, min(hx) - HC.x


def cut_z(x, y):
    """the helmet's lower edge (helmet-local): just above the brow, over the ears, down over the back of the skull"""
    t = max(0.0, min(1.0, (x - back_x) / (front_x - back_x)))   # 0 back .. 1 front
    side = min(1.0, abs(y) / (0.5 * head_size.y))
    return brow - 0.075 * (1 - t) ** 1.6 + 0.018 * side ** 2 * math.sin(math.pi * t) ** 2 + 0.008 * side ** 4 * t


def gap_for(d, gap):
    """foam thickness by direction: slimmer at the sides, a little longer at the back (a road helmet's shape)"""
    return gap * (1 - 0.45 * abs(d.y)) + (0.012 * max(0.0, -d.x) ** 2 if gap > 0.008 else 0)


def surface_at(d, gap):
    hit = skin_out(HC, d)
    return (hit - HC + d * gap_for(d, gap)) if hit is not None else d * (0.5 * head_size.y + gap)


def shaped_shell(name, gap, n_round=96, n_up=36):
    """the skull's shape pushed out by `gap`, on a grid that runs from the lower edge up to the crown, so the edge
    is a smooth line (deleting sphere faces below it left a staircase)"""
    bm = bmesh.new()
    rows = []
    for i in range(n_round):
        th = 2 * math.pi * i / n_round
        e = 0.0
        for _ in range(5):  # find the elevation where this azimuth meets the lower edge
            d = Vector((math.cos(e) * math.cos(th), math.cos(e) * math.sin(th), math.sin(e)))
            p = surface_at(d, gap)
            e += (cut_z(p.x, p.y) - p.z) / max(0.05, p.length)
        col = []
        for j in range(n_up):
            k = j / n_up
            el = e + (math.pi / 2 - e) * (k ** 0.9) * 0.985
            d = Vector((math.cos(el) * math.cos(th), math.cos(el) * math.sin(th), math.sin(el)))
            col.append(bm.verts.new(surface_at(d, gap)))
        rows.append(col)
    crown = bm.verts.new(surface_at(Vector((0, 0, 1)), gap))
    for i in range(n_round):
        A, Bc = rows[i], rows[(i + 1) % n_round]
        for j in range(n_up - 1):
            bm.faces.new((A[j], Bc[j], Bc[j + 1], A[j + 1]))
        bm.faces.new((A[-1], Bc[-1], crown))
    rim = {col[0] for col in rows}
    for _ in range(8):
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v not in rim], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in bm.verts:  # smoothing pulls hollows in: keep at least most of the gap everywhere
        d = v.co.normalized()
        hit = skin_out(HC, d)
        if hit is not None and v.co.length < (hit - HC).length + gap_for(d, gap) * 0.8:
            v.co = hit - HC + d * gap_for(d, gap) * 0.8
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new(name, m); scene.collection.objects.link(o)
    o.location = HC
    return o


VENTS = [  # (forward angle centre, half length, sideways angle centre, half width), degrees from the top
    (32, 17, 14, 5.5), (-24, 17, 14, 5.5), (30, 15, 38, 5), (-21, 15, 38, 5), (30, 10, 60, 4)]


helmet = shaped_shell("Helmet", 0.012)
helmet_me = helmet.data
helmet_me.materials.append(mats["Helmet"]); helmet_me.materials.append(mats["HelmetInner"])
sol = helmet.modifiers.new("solid", "SOLIDIFY"); sol.thickness = 0.022; sol.offset = 1
sol.material_offset = 1; sol.material_offset_rim = 1; sol.use_even_offset = True
bpy.context.view_layer.objects.active = helmet
with bpy.context.temp_override(object=helmet, active_object=helmet):
    bpy.ops.object.modifier_apply(modifier="solid")
for p in helmet.data.polygons:
    p.use_smooth = True
helmet.data.set_sharp_from_angle(angle=math.radians(55))
# vents: smooth dark rounded slots laid just on the shell (punching holes through the mesh came out jagged)
hb = BVHTree.FromObject(helmet, bpy.context.evaluated_depsgraph_get())
bmv = bmesh.new()
for a0, al, b0, bw in VENTS:
    for sd in (1, -1):
        def on_shell(da, db):
            al_, be_ = math.radians(a0 + da), math.radians(sd * (b0 + db))
            d = Vector((math.tan(al_), math.tan(be_), 1)).normalized()
            hit = hb.ray_cast(d * 0.5, -d)[0]   # helmet-local, from outside
            return (hit + d * 0.0012) if hit is not None else d * 0.12
        ring = []
        for k in range(28):
            ps = 2 * math.pi * k / 28
            c_, s_ = math.cos(ps), math.sin(ps)
            ring.append((math.copysign(abs(c_) ** 0.5, c_), math.copysign(abs(s_) ** 0.5, s_)))
        centre = bmv.verts.new(on_shell(0, 0))
        outer = [bmv.verts.new(on_shell(u * al, w * bw)) for u, w in ring]
        mid = [bmv.verts.new(on_shell(u * al * 0.55, w * bw * 0.55)) for u, w in ring]
        for k in range(28):
            k2 = (k + 1) % 28
            for q in ((mid[k], mid[k2], outer[k2], outer[k]), (centre, mid[k2], mid[k])):
                f = bmv.faces.new(q if sd > 0 else q[::-1])
bmesh.ops.recalc_face_normals(bmv, faces=bmv.faces)
vme = bpy.data.meshes.new("Vents"); bmv.to_mesh(vme); bmv.free()
vents = bpy.data.objects.new("Vents", vme); scene.collection.objects.link(vents)
vents.location = HC
vme.materials.append(mats["HelmetInner"])
for p in vme.polygons:
    p.use_smooth = True
# chin straps: thin dark strips from the shell's sides, in front of the ears, to under the chin
front_low = [p for p in head_verts if abs(p.y - head_c.y) < 0.02 and p.x > head_c.x + 0.02]
chin = min(front_low, key=lambda p: p.z)                     # under the chin
straps = []
for sd in (1, -1):
    top = skin_out(Vector((head_c.x - 0.005, head_c.y, eye_z + 0.005)), (0, sd, 0)) + Vector((0, 0.006 * sd, 0))
    mid = skin_out(Vector((head_c.x + 0.012, head_c.y, eye_z - 0.05)), (0, sd, 0)) + Vector((0, 0.005 * sd, 0))
    bot = chin + Vector((-0.025, 0.014 * sd, -0.004))
    for a, b_ in ((top, mid), (mid, bot)):
        straps.append(B.cyl("Strap", a, b_, 0.0022, mats["HelmetInner"], 6))
strap = straps[0]
if len(straps) > 1:
    bpy.ops.object.select_all(action='DESELECT')
    for o in straps:
        o.select_set(True)
    bpy.context.view_layer.objects.active = strap
    bpy.ops.object.join()

# glasses: two lenses wrapped round the face on a circle (centre behind the nose), a thin top frame and arms
eye_front = max(skin_out(Vector((head_c.x, sd * 0.032, eye_z)), (1, 0, 0)).x for sd in (1, -1))
WR = 0.085                                     # wrap radius
LENS_GAP = 0.016                               # in front of the eyes
wc = Vector((eye_front + LENS_GAP - WR, head_c.y, eye_z))


def wrap(s, t, out=0.0):
    """s: metres round the wrap from the middle (+ left), t: metres up from eye level"""
    a = s / WR
    return wc + Vector(((WR + out) * math.cos(a), (WR + out) * math.sin(a), t - 0.004 * (s / 0.07) ** 2))


def lens_bottom(u):  # u 0 at the nose .. 1 at the outer edge
    return -0.012 - 0.014 * math.sin(math.pi * min(1, u * 1.15)) ** 0.7 + 0.006 * u ** 3


def lens_top(u):
    return 0.016 + 0.003 * u - 0.006 * u ** 4


bmg = bmesh.new()
NU, NV = 14, 5
for sd in (1, -1):
    s0, s1 = 0.009, 0.072
    grid = [[bmg.verts.new(wrap(sd * (s0 + (s1 - s0) * i / NU), lens_bottom(i / NU) + (lens_top(i / NU) - lens_bottom(i / NU)) * j / NV))
             for j in range(NV + 1)] for i in range(NU + 1)]
    for i in range(NU):
        for j in range(NV):
            q = (grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
            bmg.faces.new(q if sd > 0 else q[::-1])
gme = bpy.data.meshes.new("Glasses"); bmg.to_mesh(gme); bmg.free()
glasses = bpy.data.objects.new("Glasses", gme); scene.collection.objects.link(glasses)
gme.materials.append(mats["Lens"])
gs = glasses.modifiers.new("solid", "SOLIDIFY"); gs.thickness = 0.0025
bpy.context.view_layer.objects.active = glasses
with bpy.context.temp_override(object=glasses, active_object=glasses):
    bpy.ops.object.modifier_apply(modifier="solid")
for p in glasses.data.polygons:
    p.use_smooth = True
# frame: along the lens tops and over the nose, then the arms back above the ears (kept just off the skin)
fr = []
top_pts = [wrap(s, lens_top(min(1, abs(abs(s) - 0.009) / 0.063)) + 0.0015, 0.001) for s in [x / 1000 for x in range(-75, 76, 5)]]
for a, b_ in zip(top_pts, top_pts[1:]):
    fr.append(B.cyl("GlassBar", a, b_, 0.0022, mats["GlassFrame"], 6))
for sd in (1, -1):
    prev = wrap(sd * 0.074, lens_top(1) + 0.0015, 0.001)
    for k in range(1, 7):
        x = prev.x - 0.016
        z = eye_z + 0.012 - 0.002 * k
        hit = skin_out(Vector((x, head_c.y, z)), (0, sd, 0))
        y = (hit.y + 0.005 * sd) if hit is not None else prev.y
        nxt = Vector((x, y if sd * y > sd * prev.y - 0.01 else prev.y, z))
        fr.append(B.cyl("Arm", prev, nxt, 0.0018, mats["GlassFrame"], 6))
        prev = nxt
bpy.ops.object.select_all(action='DESELECT')
for o in fr:
    o.select_set(True)
bpy.context.view_layer.objects.active = fr[0]
bpy.ops.object.join()
gframe = fr[0]; gframe.name = "GlassesFrame"

for o in (helmet, vents, strap, glasses, gframe):
    mw = o.matrix_world.copy()
    o.parent = rig
    o.parent_type = 'BONE'
    o.parent_bone = "head"
    update()
    o.matrix_world = mw

# ---------------------------------------------------------------- fit the bike to the rider
thigh = rig.data.bones["thigh_l"].length
calf = rig.data.bones["calf_l"].length
foot_len = rig.data.bones["foot_l"].length
BALL_UP = 0.035          # ball joint above the pedal spindle (shoe sole, cleat, pedal)
# The foot bone (ankle -> ball) already slopes down when the sole is flat (standing), so the sole's angle is added
# to that. Aiming the bone itself 18 deg down left the sole heel-down (the owner 2026-10-18: "drops the heel too low").
_fh, _ft = bone_world("foot_l"), bone_world("foot_l", True)
FOOT_REST = math.atan2(_fh.z - _ft.z, math.hypot(_ft.x - _fh.x, _ft.y - _fh.y))
print("FOOT rest slope deg", math.degrees(FOOT_REST))


def sole_angle(c):
    """toes-down angle of the sole: about level over the top and into the push, most toe-down at the back"""
    return math.radians(10 + 8 * math.sin(c) + 3 * math.cos(c))


def ball_and_ankle(c, side):
    """crank angle c (0 = this pedal at the bottom, increasing = pedalling forwards); side +1 left, -1 right"""
    pedal = B.BB + Vector((-math.sin(c) * B.CRANK_LEN, 0.115 * side, -math.cos(c) * B.CRANK_LEN))
    ball = pedal + Vector((0.0, 0.0, BALL_UP))
    phi = FOOT_REST + sole_angle(c)
    ankle = ball + foot_len * Vector((-math.cos(phi), 0, math.sin(phi)))
    return ball, ankle


BIKE = os.environ.get('RW_BIKE', 'road')
B.set_style(BIKE)
print('BIKE', B.STYLE)
hip_x = B.SADDLE_TOP.x + 0.02
_, ankle_bottom = ball_and_ankle(0.0, 1)
reach = 0.97 * (thigh + calf)
hip_z = ankle_bottom.z + math.sqrt(reach ** 2 - (hip_x - ankle_bottom.x) ** 2)
HIP_ABOVE_SADDLE = 0.085
B.SADDLE_TOP.z = hip_z - HIP_ABOVE_SADDLE
print("FIT saddle", B.SADDLE_TOP, "hip_z", hip_z, "legs", thigh, calf, foot_len)
B.SPACERS, B.STEM_LEN, B.STEM_ANGLE = int(TUNE['SPACERS']), TUNE['STEM_LEN'], TUNE['STEM_ANGLE']
parts = B.build_bike()
# move the cockpit to the computed bar height
bike_obj = parts["bike"]
for o in bpy.data.objects:
    o.select_set(False)

# place the rider: hip joints over the saddle
hips_mid = (bone_world("thigh_l") + bone_world("thigh_r")) / 2
rig.location += Vector((hip_x, 0, hip_z)) - hips_mid
update()
W = rig.matrix_world

# ---------------------------------------------------------------- pose
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
P = rig.pose.bones


def rot_world(pb, axis, ang):
    A = rig.matrix_world.to_3x3()
    ax = (A.inverted() @ Vector(axis)).normalized()
    h = pb.head.copy()
    R = Matrix.Rotation(ang, 4, ax)
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    update()


HAND_Y = B.HAND_Y  # road: hands 2 cm outside the hood centres (at 0.205 they went through the hoods); mtb: the grips
wrist_target = {s: B.HOOD.copy() + Vector((-0.06, 0.0, 0.04)) for s in (1, -1)}
for s in (1, -1):
    wrist_target[s].y = HAND_Y * s
arm_len = rig.data.bones["upperarm_l"].length + rig.data.bones["lowerarm_l"].length
# lean the torso forward until the hoods are within comfortable reach (elbows slightly bent)
lean = 0
for step in range(80):
    sh = rig.matrix_world @ P["upperarm_l"].head
    if (sh - wrist_target[1]).length <= TUNE['REACH'] * arm_len:  # elbows bent (0.9 until 2026-11-03: a flatter back now)
        break
    for name, share in (("pelvis", 0.35), ("spine_01", 0.25), ("spine_02", 0.2), ("spine_03", 0.2)):
        rot_world(P[name], (0, 1, 0), math.radians(1.0) * share * 1.0)
    lean += 1
# the pelvis rotation moved the hips; put them back over the saddle
hips_now = rig.matrix_world @ ((P["thigh_l"].head + P["thigh_r"].head) / 2)
rig.location += Vector((hip_x, 0, hip_z)) - hips_now
update()
# head up to look down the road
# Most of the look-up is in the head, not the neck: bending the neck back 0.45 x lean stood it up vertically from
# the shoulders with the head jutting forward, "like a banana" from the side (the owner 2026-10-19). A rider's neck
# carries on roughly in line with the back and the head tips up at the top.
# 2026-11-03: shoulders rounded forward and a little up (riders hunch: the neck hardly shows), the neck carrying on
# from the back, and the head turned up until the eyes look EYE_DOWN degrees below the horizon down the road.
for s in ("_l", "_r"):
    side = 1 if s == "_l" else -1
    rot_world(P["clavicle" + s], (0, 0, 1), -side * math.radians(TUNE['CLAV_FWD']))   # forward round the chest
    rot_world(P["clavicle" + s], (1, 0, 0), -side * math.radians(TUNE['CLAV_UP']))    # up towards the ears
NECK_UP = TUNE['NECK_UP']  # (0.22 until 2026-11-03; the shorter neck can lift more without the 'banana')
rot_world(P["neck_01"], (0, 1, 0), -math.radians(lean * NECK_UP))
def face_pitch():  # degrees the head's forward axis points below the horizon (the head bone runs up the skull)
    hb = rig.matrix_world.to_3x3() @ (P["head"].matrix.to_3x3() @ Vector((0, 0, 1)))  # bone's local Z ~ face forward
    return math.degrees(math.atan2(-hb.z, math.hypot(hb.x, hb.y)))
for _ in range(60):
    if face_pitch() <= TUNE['EYE_DOWN']: break
    rot_world(P["head"], (0, 1, 0), -math.radians(1.0))
print('FACE PITCH', round(face_pitch(), 1))
print("LEAN deg", lean)


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    return e


# IK: legs to ankle targets, feet aimed at the ball-of-foot targets, arms to the hoods
targets = {}
for side, suf in ((1, "_l"), (-1, "_r")):
    t_ankle, t_ball = empty("ankle" + suf), empty("ball" + suf)
    pole = empty("knee_pole" + suf, (1.2, 0.1 * side, 0.9))
    c = P["calf" + suf].constraints.new('IK'); c.target = t_ankle; c.chain_count = 2; c.pole_target = pole
    d = P["foot" + suf].constraints.new('DAMPED_TRACK'); d.target = t_ball; d.track_axis = 'TRACK_Y'
    w_t, h_t = empty("wrist" + suf, wrist_target[side]), empty("hood" + suf, B.HOOD + Vector((0.03, 0, -0.01)) * 1)
    h_t.location.y = HAND_Y * side
    epole = empty("elbow_pole" + suf, (B.HOOD.x - 0.3, 0.6 * side, B.HOOD.z - 0.2))
    ca = P["lowerarm" + suf].constraints.new('IK'); ca.target = w_t; ca.chain_count = 2; ca.pole_target = epole
    da = P["hand" + suf].constraints.new('DAMPED_TRACK'); da.target = h_t; da.track_axis = 'TRACK_Y'
    targets[side] = (t_ankle, t_ball, c, ca)


def set_crank(c):
    for side, phase in ((-1, 0.0), (1, math.pi)):
        ball, ankle = ball_and_ankle(c + phase, side)
        t_ankle, t_ball, _, _ = targets[side]
        t_ankle.location = ankle
        t_ball.location = ankle + (ball - ankle) * 1.6  # straight on through the ball, so the sole angle is exact
    update()


# pick pole angles that put knees forward and elbows out (bone rolls differ per rig)
set_crank(0.5)
for side, suf in ((1, "_l"), (-1, "_r")):
    _, _, cl, ca = targets[side]
    best = None
    for a in range(-180, 180, 15):
        cl.pole_angle = math.radians(a); update()
        knee = rig.matrix_world @ P["calf" + suf].head
        score = knee.x - 3 * abs(knee.y - 0.11 * side)
        if best is None or score > best[0]:
            best = (score, a)
    cl.pole_angle = math.radians(best[1])
    best = None
    for a in range(-180, 180, 15):
        ca.pole_angle = math.radians(a); update()
        el = rig.matrix_world @ P["lowerarm" + suf].head
        score = -3 * abs(el.y - 0.23 * side) - 2 * abs(el.z - (B.HOOD.z + 0.13))
        if best is None or score > best[0]:
            best = (score, a)
    ca.pole_angle = math.radians(best[1])
    print("POLES", suf, cl.pole_angle, ca.pole_angle)

# curl fingers round the hoods
for suf in ("_l", "_r"):
    for f in ("index", "middle", "ring", "pinky"):
        for k, ang in (("01", 45), ("02", 55), ("03", 35)):
            pb = P[f"{f}_{k}{suf}"]
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler.x = math.radians(ang)
    P["thumb_02" + suf].rotation_mode = 'XYZ'; P["thumb_02" + suf].rotation_euler.x = math.radians(25)
update()

# ---------------------------------------------------------------- animate: crank, legs (baked), wheels
# The upper body moves slightly with the stroke (2026-11-03, the owner: "the upper body just doesn't move at all"): the
# torso rolls towards the leg pushing down, the hips rock a little, the shoulders dip, the head counter-rolls to keep
# the eyes level, and the chest rises once a revolution. Degrees; keyed on top of the fitted pose, hands stay on the
# hoods (arm IK). SWAY=0 turns it off.
SWAY = TUNE['SWAY']
sway_bones = ("pelvis", "spine_02", "spine_03", "clavicle_l", "clavicle_r", "neck_01", "head")
sway_base = {n: P[n].matrix.copy() for n in sway_bones}
def set_sway(c):
    for n in sway_bones:
        P[n].matrix = sway_base[n]
    update()
    if c == 0: print('SWAY modes', {n: P[n].rotation_mode for n in sway_bones})
    roll = math.sin(c) * SWAY   # + = towards +Y (left): the left foot pushes down at c ~ pi/2 (phase checked in renders)
    for n, share in (("pelvis", 0.6), ("spine_02", 0.4), ("spine_03", 0.2)):  # (0.5 / 0.5: the head swung side to side, the owner)
        rot_world(P[n], (1, 0, 0), math.radians(roll * share))
    for s, sg in (("_l", 1), ("_r", -1)):
        rot_world(P["clavicle" + s], (1, 0, 0), math.radians(-sg * roll * 0.5))       # shoulder on the pushing side dips
    rot_world(P["spine_03"], (0, 1, 0), math.radians(math.sin(2 * c) * 0.25 * SWAY))   # breathing, a touch
    rot_world(P["head"], (1, 0, 0), math.radians(-roll * 1.4))                        # eyes stay level
crank = parts["crank"]
crank.rotation_mode = 'XYZ'
for f in range(FRAMES + 1):
    c = 2 * math.pi * f / FRAMES
    scene.frame_set(f)
    crank.rotation_euler = (0, c, 0)
    crank.keyframe_insert("rotation_euler", index=1, frame=f)
    if SWAY:
        set_sway(c)
        for n in sway_bones:
            P[n].keyframe_insert("rotation_quaternion" if P[n].rotation_mode == 'QUATERNION' else "rotation_euler", frame=f)
            P[n].keyframe_insert("location", frame=f)
    set_crank(c)
    for side, suf in ((1, "_l"), (-1, "_r")):
        t_ankle, t_ball, _, _ = targets[side]
        t_ankle.keyframe_insert("location", frame=f)
        t_ball.keyframe_insert("location", frame=f)
for fc in crank.animation_data.action.fcurves:
    for k in fc.keyframe_points:
        k.interpolation = 'LINEAR'

bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                 clear_constraints=not TUNE['STAND'], use_current_action=False, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')


def to_nla(obj, track, act=None):
    ad = obj.animation_data
    act = act or ad.action
    act.name = f"{track}_{obj.name}"
    t = ad.nla_tracks.new(); t.name = track
    t.strips.new(track, 0, act)
    if ad.action is act:
        ad.action = None
    return t


pedal_track = to_nla(rig, "pedal")

# ---------------------------------------------------------------- stand: out of the saddle (2026-11-03, the owner's list:
# "sprinting/standing up"). A second baked cycle, "stand": the hips up and STAND_FWD forward of the saddle (legs nearly
# straight at the bottom), the torso raised until the elbows bend (STAND_ARM x arm length to the hoods), and the bike
# rocking ROCK degrees away from the pushing leg under a rider who stays upright over it (the root node's roll, keyed
# here only for "stand"; "pedal" keys it level, as Cesium leaves a node where the last animation put it). The app
# switches between the two (public/js/app/stance.js).
lean_y = lambda c: -math.sin(c) * TUNE['ROCK']   # degrees, + = the bike's top towards +Y (left): leans away from the left leg as it pushes
if TUNE['STAND']:
    pedal_track.mute = True
    rig.animation_data.action = bpy.data.actions.new("standkeys")
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    scene.frame_set(0)
    for n in sway_bones:
        P[n].matrix = sway_base[n]
    update()
    Minv_r = rig.matrix_world.inverted()
    def hips_w():
        return rig.matrix_world @ ((P["thigh_l"].head + P["thigh_r"].head) / 2)
    def move_hips_to(target):
        d = (Minv_r @ target) - (Minv_r @ hips_w())
        P["pelvis"].matrix = Matrix.Translation(d) @ P["pelvis"].matrix
        update()
    seat_hips = hips_w()
    _, ank0 = ball_and_ankle(0.0, 1)
    sx = seat_hips.x + TUNE['STAND_FWD']
    sz = ank0.z + math.sqrt((0.985 * (thigh + calf)) ** 2 - (sx - ank0.x) ** 2)
    stand_hips = Vector((sx, seat_hips.y, sz))
    move_hips_to(stand_hips)
    # torso: raise (or lower) until the hoods are STAND_ARM x arm length from the shoulder
    for _ in range(60):
        dist = ((rig.matrix_world @ P["upperarm_l"].head) - wrist_target[1]).length
        if abs(dist - TUNE['STAND_ARM'] * arm_len) < 0.01: break
        sgn = -1 if dist < TUNE['STAND_ARM'] * arm_len else 1
        for name, share in (("pelvis", 0.4), ("spine_01", 0.3), ("spine_02", 0.3)):
            rot_world(P[name], (0, 1, 0), sgn * math.radians(1.0) * share)
        move_hips_to(stand_hips)
    for _ in range(60):  # eyes back down the road
        fp = face_pitch()
        if abs(fp - TUNE['EYE_DOWN']) < 1.0: break
        rot_world(P["head"], (0, 1, 0), math.radians(1.0 if fp < TUNE['EYE_DOWN'] else -1.0))
    print("STAND hips", tuple(round(x, 3) for x in stand_hips), "face", round(face_pitch(), 1))
    stand_base = {n: P[n].matrix.copy() for n in sway_bones}
    hip_h = stand_hips.z
    for f in range(FRAMES + 1):
        c = 2 * math.pi * f / FRAMES
        scene.frame_set(f)
        for n in sway_bones:
            P[n].matrix = stand_base[n]
        update()
        ly = math.radians(lean_y(c))
        # the rider stays over the line of the tyres while the bike rocks: hips the other way in the bike's frame,
        # the body rolled back most of the way, the head the rest (eyes level); hips dip a little on each downstroke
        target = stand_hips + Vector((0, -math.sin(ly) * hip_h * 0.85, -0.012 * abs(math.sin(c))))
        move_hips_to(target)
        rot_world(P["pelvis"], (1, 0, 0), -ly * 0.8)
        rot_world(P["spine_03"], (1, 0, 0), ly * 0.15)
        rot_world(P["head"], (1, 0, 0), -ly * 0.3)
        for n in sway_bones:
            P[n].keyframe_insert("rotation_quaternion" if P[n].rotation_mode == 'QUATERNION' else "rotation_euler", frame=f)
            P[n].keyframe_insert("location", frame=f)
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=0, frame_end=FRAMES, only_selected=True, visual_keying=True,
                     clear_constraints=True, use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    to_nla(rig, "stand")
    pedal_track.mute = False

for w in (parts["front"], parts["rear"]):
    w.rotation_mode = 'XYZ'
    for f in (0, FRAMES):
        w.rotation_euler = (0, 2 * math.pi * f / FRAMES, 0)
        w.keyframe_insert("rotation_euler", index=1, frame=f)
    for fc in w.animation_data.action.fcurves:
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'

crank_act = crank.animation_data.action
to_nla(crank, "pedal")
if TUNE['STAND']:
    to_nla(crank, "stand", crank_act.copy())
to_nla(parts["front"], "wheels")
to_nla(parts["rear"], "wheels")

# remove the IK helpers
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o)

# group everything under one root
root = bpy.data.objects.new("RideWorldRider", None)
scene.collection.objects.link(root)
for o in (rig, parts["bike"], parts["front"], parts["rear"], crank):
    o.parent = root
if TUNE['STAND']:  # the bike's rock (stand) and level (pedal)
    root.rotation_mode = 'XYZ'
    for f in (0, FRAMES):
        root.rotation_euler = (0, 0, 0); root.keyframe_insert("rotation_euler", index=0, frame=f)
    to_nla(root, "pedal")
    for f in range(FRAMES + 1):
        root.rotation_euler = (-math.radians(lean_y(2 * math.pi * f / FRAMES)), 0, 0)
        root.keyframe_insert("rotation_euler", index=0, frame=f)
    to_nla(root, "stand")
    root.rotation_euler = (0, 0, 0)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)

# web-sized textures: 1024 px JPEG. Skin and shoes are opaque, so unhook alpha (which forces PNG on export).
for m in bpy.data.materials:
    if m.node_tree:
        for link in list(m.node_tree.links):
            if link.to_socket.name == "Alpha":
                m.node_tree.links.remove(link)
        m.blend_method = 'OPAQUE' if hasattr(m, 'blend_method') else None
tex_dir = os.path.join(os.path.dirname(OUT), ".tex")
os.makedirs(tex_dir, exist_ok=True)
for img in bpy.data.images:
    if img.source != 'FILE':
        continue
    if not img.has_data:
        img.reload()
        _ = img.pixels[0]  # forces the pixels to load
    if img.size[0] == 0:
        continue
    if img.size[0] > 1024:
        img.scale(1024, 1024 * img.size[1] // img.size[0])
    path = os.path.join(tex_dir, img.name.rsplit(".", 1)[0] + ".jpg")
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 82
    img.save_render(path, scene=scene)
    img.filepath = path
    img.reload()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_skins=True, export_morph=False, export_image_format='JPEG', export_jpeg_quality=82,
    export_cameras=False, export_lights=False,
    export_optimize_animation_keep_anim_object=True,  # (keeps "pedal"'s level root: without it the bike stayed tilted after standing)
)
import shutil
shutil.rmtree(tex_dir, ignore_errors=True)
print("WROTE", OUT, os.path.getsize(OUT))
