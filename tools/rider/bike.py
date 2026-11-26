# Road bike modelled procedurally in Blender. Units metres; +X forward, +Y left, +Z up
# (exported to glTF and loaded in Cesium with forwardAxis X, so these axes carry straight through).
# The frame, fork, bars and seatpost are one Skin-modifier mesh, so the tubes join smoothly like a
# moulded carbon frame. Imported by build_rider.py.
import bpy, bmesh, math
from mathutils import Vector, Matrix

WHEEL_R = 0.335          # 700x25c outer radius
BB = Vector((0.0, 0.0, 0.27))
REAR_HUB = Vector((-0.405, 0.0, WHEEL_R))
FRONT_HUB = Vector((0.60, 0.0, WHEEL_R))   # ~45 mm fork rake ahead of the steering axis
SADDLE_TOP = Vector((-0.205, 0.0, 1.0))
HOOD = Vector((0.6, 0.205, 0.975))       # left hood; right is mirrored
# cockpit (2026-11-03, the rider hunched like a pro instead of sitting up: the owner's "giraffe" neck): spacers under the
# stem, stem length and angle. Until then 5 spacers and a ~104 mm stem rising slightly (bars ~6 cm under the saddle).
SPACERS, STEM_LEN, STEM_ANGLE = 5, 0.104, 6.6
CRANK_LEN = 0.1725
HAND_Y = 0.225  # the rider's hands: 2 cm outside the hood centres (build_rider.py)

# ---------------------------------------------------------------- styles (2026-11-03, the owner: "different bikes ...
# original classic Giant TCR - old peugeot or look, bmx, MTB"). One rider GLB per style (build_rider.py RW_BIKE=..).
#   road     the modern carbon race bike (until then the only one)
#   classic  80s steel: thin round tubes, chrome lugs, level top tube, quill stem, silver box rims, tan-wall tyres
#   compact  90s aluminium compact (the first TCR's idea): fat round tubes, steeply sloping top tube, long seatpost
#   mtb      29er hardtail: suspension fork, flat bar, knobbly 2.3" tyres, disc brakes; sits more upright
# Geometry: wheel radius, BB, hubs, head tube ends, top of the seat tube, the seat cluster, saddle setback; tube radii.
STYLE = 'road'
STYLES = {
    'road': dict(R=0.335, BB=(0, 0, 0.27), rear=(-0.405, 0, 0.335), front=(0.60, 0, 0.335), ht_top=(0.40, 0, 0.875),
                 ht_bot=(0.447, 0, 0.715), st_top=(-0.155, 0, 0.83), seat=(-0.13, 0, 0.77), saddle_x=-0.205,
                 tubes=dict(bb=(0.034, 0.042), dt=[(0.03, 0.036), (0.028, 0.034), (0.03, 0.032)], ht=[(0.024, 0.024), (0.022, 0.022)],
                            tt=[(0.02, 0.016), (0.019, 0.016)], tj=(0.022, 0.02), st=[(0.022, 0.026), (0.02, 0.022), (0.02, 0.02)],
                            cs=[(0.016, 0.018), (0.012, 0.014)], ss=[(0.011, 0.012), (0.009, 0.01)], drop=(0.008, 0.01), sleeve=(0.0265, 0.0225))),
    'classic': dict(R=0.334, BB=(0, 0, 0.268), rear=(-0.415, 0, 0.334), front=(0.605, 0, 0.334), ht_top=(0.415, 0, 0.86),
                    ht_bot=(0.457, 0, 0.72), st_top=(-0.162, 0, 0.872), seat=(-0.158, 0, 0.858), saddle_x=-0.215,
                    tubes=dict(bb=(0.021, 0.021), dt=[(0.0143, 0.0143)] * 3, ht=[(0.0158, 0.0158)] * 2, tt=[(0.0128, 0.0128)] * 2,
                               tj=(0.0135, 0.0135), st=[(0.0143, 0.0143)] * 3, cs=[(0.011, 0.012), (0.0085, 0.009)], ss=[(0.0085, 0.0085), (0.0075, 0.0075)],
                               drop=(0.007, 0.009), sleeve=(0.0168, 0.0168))),
    'compact': dict(R=0.334, BB=(0, 0, 0.27), rear=(-0.4, 0, 0.334), front=(0.595, 0, 0.334), ht_top=(0.405, 0, 0.88),
                    ht_bot=(0.45, 0, 0.73), st_top=(-0.105, 0, 0.705), seat=(-0.098, 0, 0.69), saddle_x=-0.205,
                    tubes=dict(bb=(0.025, 0.03), dt=[(0.026, 0.026), (0.025, 0.025), (0.026, 0.026)], ht=[(0.021, 0.021)] * 2, tt=[(0.019, 0.019)] * 2,
                               tj=(0.02, 0.02), st=[(0.017, 0.017)] * 3, cs=[(0.012, 0.014), (0.01, 0.011)], ss=[(0.0095, 0.0095), (0.0085, 0.0085)],
                               drop=(0.008, 0.01), sleeve=(0.0225, 0.0215))),
    'mtb': dict(R=0.372, BB=(0, 0, 0.315), rear=(-0.435, 0, 0.372), front=(0.735, 0, 0.372), ht_top=(0.468, 0, 0.985),
                ht_bot=(0.512, 0, 0.875), st_top=(-0.13, 0, 0.8), seat=(-0.12, 0, 0.78), saddle_x=-0.215,
                tubes=dict(bb=(0.03, 0.036), dt=[(0.028, 0.032), (0.027, 0.03), (0.029, 0.031)], ht=[(0.026, 0.026), (0.024, 0.024)],
                           tt=[(0.022, 0.019), (0.02, 0.018)], tj=(0.024, 0.021), st=[(0.019, 0.021), (0.018, 0.019), (0.018, 0.018)],
                           cs=[(0.015, 0.017), (0.012, 0.013)], ss=[(0.0105, 0.011), (0.009, 0.0095)], drop=(0.009, 0.012), sleeve=(0.029, 0.025))),
    # Giant Revolt Advanced 2 (2023), size S: the owner's own (2026-11-03, his photos + Giant's chart): stack 570, reach 381,
    # head 71 deg x 135 mm, seat 73.5 deg x 450 mm, chainstays 425, BB drop 80, wheelbase 1020, 700x38 tyres; a bowed,
    # steeply sloping top tube, seat stays dropped well down the seat tube, D-Fuse post, flared bars, 60 mm stem
    'gravel': dict(R=0.349, BB=(0, 0, 0.269), rear=(-0.4174, 0, 0.349), front=(0.603, 0, 0.349), ht_top=(0.381, 0, 0.839),
                   ht_bot=(0.425, 0, 0.711), st_top=(-0.122, 0, 0.685), seat=(-0.114, 0, 0.655), saddle_x=-0.215, tt_bow=0.022, ss_z=0.555,
                   tubes=dict(bb=(0.032, 0.04), dt=[(0.03, 0.036), (0.029, 0.034), (0.03, 0.033)], ht=[(0.025, 0.025), (0.023, 0.023)],
                              tt=[(0.021, 0.017), (0.019, 0.016)], tj=(0.023, 0.02), st=[(0.022, 0.025), (0.02, 0.022), (0.019, 0.02)],
                              cs=[(0.016, 0.018), (0.012, 0.013)], ss=[(0.0085, 0.0095), (0.0075, 0.0085)], drop=(0.008, 0.011), sleeve=(0.0275, 0.0235))),
}


def set_style(name):
    global STYLE, WHEEL_R, HAND_Y
    STYLE = name if name in STYLES else 'road'
    G = STYLES[STYLE]
    WHEEL_R = G['R']
    BB[:] = G['BB']; REAR_HUB[:] = G['rear']; FRONT_HUB[:] = G['front']
    SADDLE_TOP.x = G['saddle_x']
    HAND_Y = 0.335 if STYLE == 'mtb' else 0.225
    return G


def mat(name, color, rough=0.5, metal=0.0, clearcoat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if clearcoat:
        b.inputs["Coat Weight"].default_value = clearcoat
    return m


def materials():
    M = _materials()
    if STYLE == 'classic':  # polished alloy bits, silver rims, tan sidewalls
        mat("Carbon", (0.75, 0.76, 0.78), 0.18, 1.0); mat("Rim", (0.7, 0.71, 0.73), 0.22, 1.0); mat("DarkMetal", (0.6, 0.61, 0.63), 0.25, 1.0)
        M["Wall"] = mat("Wall", (0.55, 0.36, 0.17), 0.7)
        M["Frame"] = mat("Frame", (0.85, 0.85, 0.85), 0.2, 0.0, 0.9)
    elif STYLE == 'compact':  # anodised grey alloy bits and rims
        mat("Carbon", (0.08, 0.08, 0.09), 0.35, 0.9); mat("Rim", (0.32, 0.33, 0.35), 0.3, 1.0)
    elif STYLE == 'gravel':
        M["Frame"] = mat("Frame", (0.85, 0.85, 0.85), 0.28, 0.45, 0.8)  # metallic flake under a clear coat (Starry Night)
    elif STYLE == 'mtb':
        mat("Carbon", (0.025, 0.025, 0.027), 0.55); mat("Tyre", (0.035, 0.035, 0.035), 0.92)
        M["Frame"] = mat("Frame", (0.85, 0.85, 0.85), 0.45, 0.0, 0.2)  # satin
        M["Stanchion"] = mat("Stanchion", (0.6, 0.42, 0.12), 0.18, 1.0)  # gold-coated fork legs
    return M


def _materials():
    return {
        "Frame": mat("Frame", (0.85, 0.85, 0.85), 0.25, 0.0, 0.6),
        "Carbon": mat("Carbon", (0.02, 0.02, 0.022), 0.3, 0.0, 0.5),
        "Rim": mat("Rim", (0.025, 0.025, 0.028), 0.45),
        "Tyre": mat("Tyre", (0.03, 0.03, 0.03), 0.85),
        "Metal": mat("Metal", (0.65, 0.66, 0.68), 0.3, 1.0),
        "DarkMetal": mat("DarkMetal", (0.12, 0.12, 0.13), 0.35, 1.0),
        "Saddle": mat("Saddle", (0.02, 0.02, 0.02), 0.55),
        "BarTape": mat("BarTape", (0.03, 0.03, 0.03), 0.8),
        "Bottle": mat("Bottle", (0.86, 0.88, 0.9), 0.25, 0.0, 0.3),
        "BottleLabel": mat("BottleLabel", (0.05, 0.25, 0.6), 0.4),
    }


def new_obj(name, mesh, parent=None, material=None):
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    if parent:
        o.parent = parent
    if material:
        o.data.materials.append(material)
    return o


def shade_smooth(o, angle=40):
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(angle))


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=m.name)


def skin_mesh(name, verts, edges, radii, material, subdiv=2, flat=None):
    """verts: list of Vector; radii: list of (rx, ry) per vertex; flat: per-vertex (unused)"""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], edges, [])
    o = new_obj(name, me, material=material)
    o.modifiers.new("skin", "SKIN")
    for i, r in enumerate(radii):
        o.data.skin_vertices[0].data[i].radius = r
    o.data.skin_vertices[0].data[0].use_root = True
    s = o.modifiers.new("subd", "SUBSURF")
    s.levels = subdiv
    s.render_levels = subdiv
    apply_mods(o)
    # where several tubes meet, the skin modifier can leave doubled or flipped faces that shade in grey blotches
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data); bm.free()
    shade_smooth(o, 60)
    return o


def lathe(name, profile, segments, material, axis_y=True):
    """profile: list of (r, y) points in the wheel plane; revolved about the Y axis"""
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ring = [bm.verts.new((r * math.cos(a), y, r * math.sin(a))) for (r, y) in profile]
        rings.append(ring)
    n = len(profile)
    for i in range(segments):
        A, B = rings[i], rings[(i + 1) % segments]
        for j in range(n - 1):
            bm.faces.new((A[j], A[j + 1], B[j + 1], B[j]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me, material=material)
    shade_smooth(o, 50)
    return o


def cyl(name, p0, p1, r, material, seg=8, r1=None):
    p0, p1 = Vector(p0), Vector(p1)
    bm = bmesh.new()
    d = p1 - p0
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r1 if r1 is not None else r, depth=d.length)
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_obj(name, me, material=material)
    shade_smooth(o, 50)
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def build_frame(M):
    # Key points (side view, Y=0 unless stated)
    # Standard road geometry: ~73.5° head angle and ~45 mm fork rake, so the front axle sits ahead of the head tube
    # and the fork sweeps forward. (The head tube used to be 14 cm further forward: the fork angled back and the
    # bars were so far out the rider had to lie flat.)
    G = STYLES[STYLE]; T = G['tubes']
    ht_top = Vector(G['ht_top'])
    ht_bot = Vector(G['ht_bot'])
    st_top = Vector(G['st_top'])
    seat_cluster = Vector(G['seat'])
    v, e, r = [], [], []

    def add(p, rad):
        v.append(Vector(p)); r.append(rad); return len(v) - 1

    def chain(points, radii):
        idx = [add(p, rr) for p, rr in zip(points, radii)]
        for a, b in zip(idx, idx[1:]):
            e.append((a, b))
        return idx

    bb = add(BB, T['bb'])
    # down tube (oval, big), with a mid point so it stays straight under subdivision
    dt_d = (ht_bot - BB).normalized()
    dt = chain([BB + dt_d * 0.078, (BB + ht_bot) / 2, ht_bot], T['dt'])
    e.append((bb, dt[0]))
    # head tube
    ht = chain([ht_bot + Vector((0.006, 0, -0.03)), ht_top + Vector((-0.004, 0, 0.02))], T['ht'])
    e.append((dt[-1], ht[0]))
    e.append((ht[0], ht[1]))
    # top tube (slight slope)
    tt = chain([(ht_top + st_top) / 2 - Vector((0, 0, G.get('tt_bow', 0))), st_top], T['tt'])
    top_join = add(ht_top + Vector((-0.02, 0, -0.02)), T['tj'])
    e.append((ht[1], top_join)); e.append((top_join, tt[0]))
    # seat tube
    st_d = (seat_cluster - BB).normalized()
    st_mid = BB + (seat_cluster - BB) * ((G['ss_z'] - BB.z) / (seat_cluster.z - BB.z)) if 'ss_z' in G else (BB + seat_cluster) / 2 + Vector((0, 0, 0.012))
    st = chain([BB + st_d * 0.126, st_mid, seat_cluster], T['st'])
    e.append((bb, st[0])); e.append((st[-1], tt[-1]))
    # seat post (black, separate below) top stub on frame
    # chain stays and seat stays to dropouts, both sides
    for s in (1, -1):
        drop = add(REAR_HUB + Vector((0, (0.072 if STYLE == 'mtb' else 0.064) * s, 0)), T['drop'])
        cs = chain([BB + Vector((-0.07, 0.035 * s, -0.005)), (BB + REAR_HUB) / 2 + Vector((0, 0.06 * s, 0.005))], T['cs'])
        e.append((bb, cs[0])); e.append((cs[-1], drop))
        ss_top = st[1] if 'ss_z' in G else st[-1]   # dropped stays (gravel) join the seat tube part way down
        ss_from = v[ss_top]
        ss_d = (REAR_HUB - ss_from).normalized()
        ss = chain([ss_from + ss_d * 0.035 + Vector((0, 0.02 * s, 0)), (ss_from + REAR_HUB) / 2 + Vector((0, 0.055 * s, 0))], T['ss'])
        e.append((ss_top, ss[0])); e.append((ss[-1], drop))
    frame = skin_mesh("Frame", v, e, r, M["Frame"])
    # a clean tapered head tube over the skin mesh's junction there (it folded into a crease where the down tube,
    # head tube and top tube meet)
    ax = (ht_top - ht_bot).normalized()
    sleeve = cyl("HeadTube", ht_bot - ax * 0.02, ht_top + ax * 0.016, T['sleeve'][0], M["Frame"], 32, T['sleeve'][1])
    extra = []
    if STYLE == 'classic':  # chrome lugs: head lugs, seat lug, BB shell, fork crown below (build_fork), dropouts
        for c, d, rr in ((ht_top + ax * 0.004, ax, 0.0182), (ht_bot - ax * 0.008, ax, 0.0182), (seat_cluster + st_d * 0.0, st_d, 0.0162)):
            extra.append(cyl("Lug", c - d * 0.016, c + d * 0.016, rr, M["Metal"], 24))
        extra.append(cyl("Shell", BB + Vector((0, -0.036, 0)), BB + Vector((0, 0.036, 0)), 0.0215, M["Metal"], 24))
        extra.append(cyl("Clamp", seat_cluster + Vector((-0.012, -0.012, -0.004)), seat_cluster + Vector((-0.012, 0.012, -0.004)), 0.006, M["Metal"], 8))
    frame = join([frame, sleeve] + extra, "Frame")
    return frame, ht_top, ht_bot, seat_cluster


def build_susp_fork(M, ht_top, ht_bot):
    # 29er suspension fork: crown under the head tube, two gold stanchions down the steering axis into fat lowers
    # joined by an arch in front, the axle offset ~44 mm forwards; a disc caliper on the left lower
    axis = (ht_bot - ht_top).normalized()
    fwd = Vector((-axis.z, 0, axis.x))
    if fwd.x < 0: fwd = -fwd
    t_hub = (FRONT_HUB.z - ht_bot.z) / axis.z
    offset = (FRONT_HUB - (ht_bot + axis * t_hub)).dot(fwd)
    crown = ht_bot + axis * 0.035
    parts = [cyl("Crown", crown + Vector((0, -0.07, 0)), crown + Vector((0, 0.07, 0)), 0.022, M["Carbon"], 16)]
    parts.append(cyl("Steerer", ht_bot - axis * 0.01, crown, 0.02, M["Carbon"], 16))
    for s in (1, -1):
        top = crown + fwd * offset * 0.5 + Vector((0, 0.058 * s, 0))
        low_top = top + axis * 0.2
        hub = Vector((FRONT_HUB.x, 0.058 * s, FRONT_HUB.z))
        parts.append(cyl("Stanchion", top, low_top + axis * 0.04, 0.0165, M["Stanchion"], 20))
        parts.append(cyl("Lower", low_top, hub + axis * 0.02, 0.022, M["Carbon"], 20, 0.019))
        parts.append(cyl("Seal", low_top - axis * 0.006, low_top + axis * 0.006, 0.0235, M["DarkMetal"], 20))
    a_l, a_r = crown + axis * 0.26 + fwd * (offset * 0.5 + 0.03) + Vector((0, 0.058, 0)), crown + axis * 0.26 + fwd * (offset * 0.5 + 0.03) + Vector((0, -0.058, 0))
    mid = (a_l + a_r) / 2 - axis * 0.03 + fwd * 0.01
    parts += [cyl("Arch", a_l, mid, 0.012, M["Carbon"], 12), cyl("Arch", mid, a_r, 0.012, M["Carbon"], 12)]
    parts.append(cyl("Caliper", FRONT_HUB + Vector((-0.07, 0.05, 0.06)), FRONT_HUB + Vector((-0.04, 0.05, 0.09)), 0.014, M["DarkMetal"], 10))
    return parts


def build_fork(M, ht_top, ht_bot):
    if STYLE == 'mtb':
        return build_susp_fork(M, ht_top, ht_bot)
    # A real road fork (the owner 2026-10-18: "weirdly backwards"): the blades run down the steering axis from a crown
    # under the head tube, then curve FORWARDS into the dropouts, the axle ~45 mm ahead of the axis (rake). The old
    # blades started behind the axis and bent back into the hub, and being part of the frame's skin mesh they
    # branched off the head tube, which shaded the head tube and fork in blotches.
    axis = (ht_bot - ht_top).normalized()                      # down the steering axis
    fwd = Vector((axis.z, 0, -axis.x)) * -1                     # perpendicular to the axis, pointing forwards
    if fwd.x < 0:
        fwd = -fwd
    t_hub = (FRONT_HUB.z - ht_bot.z) / axis.z                   # distance down the axis to axle height
    on_axis = ht_bot + axis * t_hub
    rake = (FRONT_HUB - on_axis).dot(fwd)
    crown_c = ht_bot + axis * 0.03
    # one unbranched tube: up the left blade, across the crown just under the head tube, down the right blade
    def blade(side):
        pts, radii = [], []
        n = 9
        for k in range(n + 1):
            u = k / n
            along = 0.045 + (t_hub - 0.045) * u
            bend = rake * max(0.0, (u - 0.45) / 0.55) ** 2       # straight, then sweeping forwards at the bottom
            y = side * (0.042 + 0.01 * u)                        # blades splay to the hub's width
            pts.append(ht_bot + axis * along + fwd * bend + Vector((0, y, 0)))
            radii.append(((0.0145 - 0.006 * u, 0.0115 - 0.004 * u) if STYLE != 'classic' else (0.0118 - 0.004 * u, 0.0098 - 0.003 * u)))  # tapered, oval (deeper fore-aft)
        pts[-1] = Vector((FRONT_HUB.x, side * 0.052, FRONT_HUB.z))
        return pts, radii
    lp, lr = blade(1)
    rp, rr = blade(-1)
    pts = lp[::-1] + [crown_c + Vector((0, 0.022, 0)), crown_c + Vector((0, -0.022, 0))] + rp
    radii = lr[::-1] + [(0.02, 0.021), (0.02, 0.021)] + rr
    parts = [skin_mesh("Fork", pts, [(i, i + 1) for i in range(len(pts) - 1)], radii, M["Frame"], subdiv=2)]
    for side in (1, -1):
        parts.append(cyl("Dropout", FRONT_HUB + Vector((0, side * 0.049, 0)), FRONT_HUB + Vector((0, side * 0.056, 0)), 0.009, M["Frame"], 12))
    # front brake caliper hanging in front of the crown
    parts.append(cyl("Brake", crown_c + fwd * 0.026, crown_c + fwd * 0.03 + axis * 0.05, 0.011, M["DarkMetal"], 10))
    if STYLE == 'gravel':  # flat-mount disc caliper behind the left blade (no rim brake)
        parts.pop()  # (the rim brake caliper just added)
        parts.append(cyl("Caliper", FRONT_HUB + Vector((-0.07, 0.05, 0.055)), FRONT_HUB + Vector((-0.035, 0.05, 0.085)), 0.014, M["DarkMetal"], 10))
    if STYLE == 'classic':  # chrome fork crown and chromed blade tips
        parts.append(cyl("Crown", crown_c + Vector((0, -0.045, 0)), crown_c + Vector((0, 0.045, 0)), 0.017, M["Metal"], 16))
    return parts


def build_bottle(M, base, d, up):
    # A real bidon (the owner: "looks like a cardboard tube"): rounded base, grip waist, shoulder, push-pull cap,
    # a label band, in a black wire cage on the tube. `base` = bottom centre, `d` = along the bottle, `up` = away
    # from the tube.
    rot = d.to_track_quat('Y', 'Z').to_matrix().to_4x4()
    def place(o):
        o.matrix_world = Matrix.Translation(base) @ rot
        bpy.context.view_layer.update()
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
        return o
    body = [(0.0, 0.0), (0.02, 0.001), (0.031, 0.005), (0.0355, 0.014), (0.036, 0.03), (0.036, 0.07), (0.0335, 0.09),
            (0.032, 0.102), (0.0335, 0.114), (0.036, 0.132), (0.036, 0.168), (0.033, 0.183), (0.025, 0.194), (0.019, 0.2)]
    cap = [(0.0, 0.2), (0.0195, 0.2), (0.0195, 0.211), (0.016, 0.215), (0.0085, 0.216), (0.0075, 0.226), (0.0055, 0.229), (0.0, 0.229)]
    label = [(0.0364, 0.104), (0.0364, 0.156)]
    parts = [place(lathe("Bottle", [(r, y) for r, y in body], 32, M["Bottle"])),
             place(lathe("BottleCap", cap, 24, M["Saddle"])),
             place(lathe("BottleLabel", label, 32, M["BottleLabel"]))]
    # cage: two rails along the tube side, a bottom cup bar and a band round the bottle's upper half
    side = d.cross(up).normalized()
    w = lambda y, a, r=0.0375: base + d * y + up * (r * math.cos(a)) + side * (r * math.sin(a))
    for sg in (1, -1):
        parts.append(cyl("CageRail", w(-0.004, sg * 1.9), w(0.15, sg * 1.9), 0.0028, M["Saddle"], 6))
        parts.append(cyl("CageFoot", w(-0.004, sg * 1.9), base - d * 0.006 + up * -0.012 + side * 0.012 * sg, 0.0028, M["Saddle"], 6))
    arc = [w(0.15, a / 10) for a in range(-19, 20, 2)]
    for a_, b_ in zip(arc, arc[1:]):
        parts.append(cyl("CageBand", a_, b_, 0.0028, M["Saddle"], 6))
    parts.append(cyl("CageBottom", base - d * 0.004 + side * 0.02, base - d * 0.004 - side * 0.02, 0.003, M["Saddle"], 6))
    return parts


def build_quill(M, ht_top, ht_bot):
    # classic: a chrome quill stem rising out of the head tube (no spacers), a forged extension, round alloy drops
    axis = (ht_top - ht_bot).normalized()
    parts = [cyl("Headset", ht_top - axis * 0.008, ht_top + axis * 0.02, 0.0195, M["Metal"], 20),
             cyl("Locknut", ht_top + axis * 0.02, ht_top + axis * 0.028, 0.017, M["Metal"], 6)]
    q_top = ht_top + axis * (0.075 + 0.012 * max(0, SPACERS - 2))
    parts.append(cyl("Quill", ht_top + axis * 0.02, q_top, 0.0112, M["Metal"], 16))
    clamp = q_top + Vector((math.cos(math.radians(-8)), 0, math.sin(math.radians(-8)))) * (STEM_LEN + 0.004)
    d = (clamp - q_top).normalized()
    parts.append(cyl("StemExt", q_top + d * 0.004, clamp - d * 0.014, 0.0118, M["Metal"], 16, 0.0108))
    parts.append(cyl("StemBolt", q_top + Vector((0, 0, 0.004)), q_top + Vector((0, 0, 0.012)), 0.008, M["Metal"], 6))
    parts.append(cyl("Clamp", clamp + Vector((0, -0.02, 0)), clamp + Vector((0, 0.02, 0)), 0.0165, M["Metal"], 16))
    return parts, clamp


def build_flatbar(M, ht_top, ht_bot):
    # mtb: 3 spacers, a 50 mm stem, a 760 mm riser bar with 9 deg back sweep, lock-on grips and brake levers
    axis = (ht_top - ht_bot).normalized()
    parts = [cyl("Headset", ht_top - axis * 0.01, ht_top + axis * 0.016, 0.024, M["Carbon"], 20)]
    base = ht_top + axis * 0.016
    for k in range(3):
        parts.append(cyl("Spacer", base + axis * (0.01 * k), base + axis * (0.01 * k + 0.0095), 0.019, M["Carbon"], 20))
    stem_c = ht_top + axis * 0.065
    parts.append(cyl("StemClamp", stem_c - axis * 0.02, stem_c + axis * 0.02, 0.021, M["Carbon"], 20))
    clamp = stem_c + Vector((math.cos(math.radians(4)), 0, math.sin(math.radians(4)))) * 0.05
    parts.append(cyl("Stem", stem_c, clamp, 0.019, M["Carbon"], 16))
    parts.append(cyl("Faceplate", clamp + Vector((0.004, -0.028, 0)), clamp + Vector((0.004, 0.028, 0)), 0.023, M["Carbon"], 20))
    cx, cz = clamp.x, clamp.z
    half = [(cx, 0.0, cz), (cx, 0.06, cz), (cx - 0.004, 0.12, cz + 0.012), (cx - 0.014, 0.17, cz + 0.022), (cx - 0.03, 0.27, cz + 0.026), (cx - 0.048, 0.38, cz + 0.028)]
    pts = [Vector((x, -y, z)) for x, y, z in reversed(half[1:])] + [Vector(p_) for p_ in half]
    radii = [(0.0175, 0.0175) if abs(p_.y) < 0.07 else (0.0112, 0.0112) for p_ in pts]
    parts.append(skin_mesh("Bars", pts, [(i, i + 1) for i in range(len(pts) - 1)], radii, M["Carbon"], subdiv=2))
    for s in (1, -1):
        g0, g1 = Vector((cx - 0.026, 0.25 * s, cz + 0.026)), Vector((cx - 0.048, 0.38 * s, cz + 0.028))
        gd = (g1 - g0).normalized()
        parts.append(cyl("Grip", g1 - gd * 0.135, g1, 0.0165, M["Saddle"], 16))
        parts.append(cyl("LockRing", g1 - gd * 0.14, g1 - gd * 0.13, 0.017, M["DarkMetal"], 16))
        lv = g1 - gd * 0.165
        parts.append(cyl("LeverBody", lv, lv + Vector((0.01, 0, 0.012)), 0.011, M["DarkMetal"], 10))
        parts.append(cyl("Lever", lv + Vector((0.012, 0, 0.012)), lv + Vector((0.06, 0.07 * s, 0.0)), 0.0045, M["DarkMetal"], 6))
    grip_mid = Vector((cx - 0.042, 0.33, cz + 0.03))
    return parts, grip_mid


def build_cockpit(M, ht_top, ht_bot):
    if STYLE == 'mtb':
        parts, g = build_flatbar(M, ht_top, ht_bot)
        HOOD.x, HOOD.y, HOOD.z = g.x + 0.012, 0.335, g.z - 0.008  # (wrist 6 cm behind and 4 cm over this: hands round the grips)
        return parts
    if STYLE == 'classic':
        quill, clamp = build_quill(M, ht_top, ht_bot)
        return quill + drop_bars(M, clamp)
    global SPACERS, STEM_LEN, STEM_ANGLE
    if STYLE == 'gravel':  # 60 mm, 8 deg stem on a 71 deg head tube: rises ~11 deg; 3 spacers (the owner's photos)
        SPACERS, STEM_LEN, STEM_ANGLE = 3, 0.06, 11.0
    # Steerer with spacers, a 100 mm stem rising slightly, its bar clamp, and drop bars as one unbranched tube
    # (the owner 2026-10-18: "the bike is missing a stem": the old skin mesh branched at the stem, so the stem
    # melted into a blob where the bars met it). The bars stay where the fit had them.
    axis = (ht_top - ht_bot).normalized()
    parts = []
    # headset cap sunk into the head tube's rounded top (the spacers used to float 1-2 cm above it)
    parts.append(cyl("Headset", ht_top - axis * 0.01, ht_top + axis * 0.016, 0.0205, M["Carbon"], 20))
    base = ht_top + axis * 0.016
    for k in range(SPACERS):  # 14 mm spacers, the gaps hinting at separate rings
        parts.append(cyl("Spacer", base + axis * (0.014 * k), base + axis * (0.014 * k + 0.0135), 0.0175, M["Carbon"], 20))
    stem_c = ht_top + axis * (0.032 + 0.014 * SPACERS)  # middle of the stem's steerer clamp
    parts.append(cyl("StemClamp", stem_c - axis * 0.02, stem_c + axis * 0.02, 0.019, M["Carbon"], 20))
    parts.append(cyl("TopCap", stem_c + axis * 0.02, stem_c + axis * 0.028, 0.016, M["DarkMetal"], 20))
    clamp = stem_c + Vector((math.cos(math.radians(STEM_ANGLE)), 0, math.sin(math.radians(STEM_ANGLE)))) * STEM_LEN  # bar centre
    d = (clamp - stem_c).normalized()
    parts.append(cyl("Stem", stem_c + d * 0.01, clamp - d * 0.012, 0.0165, M["Carbon"], 16, 0.0155))
    parts.append(cyl("Faceplate", clamp + Vector((0.004, -0.024, 0)), clamp + Vector((0.004, 0.024, 0)), 0.0215, M["Carbon"], 20))
    for z in (0.012, -0.012):  # faceplate bolts
        for y in (0.014, -0.014):
            parts.append(cyl("Bolt", clamp + Vector((0.024, y, z)), clamp + Vector((0.029, y, z)), 0.003, M["Metal"], 8))
    return parts + drop_bars(M, clamp)


def drop_bars(M, clamp):
    parts = []
    clamp_x, bar_z = clamp.x, clamp.z
    half = [
        (clamp_x, 0.0, bar_z),
        (clamp_x, 0.05, bar_z),
        (clamp_x + 0.003, 0.15, bar_z + 0.002),
        (clamp_x - 0.005, 0.2, bar_z),             # tops -> bend
        (clamp_x + 0.04, 0.205, bar_z + 0.005),    # ramps forward
        (clamp_x + 0.085, 0.205, bar_z - 0.015),   # hood area
        (clamp_x + 0.1, 0.205, bar_z - 0.06),
        (clamp_x + 0.085, 0.208, bar_z - 0.11),    # drop curve
        (clamp_x + 0.04, 0.21, bar_z - 0.13),
        (clamp_x - 0.03, 0.21, bar_z - 0.125),     # drop ends
    ]
    if STYLE == 'gravel':  # flared drops (Giant Contact XR D-Fuse): the drops splay out below the hoods
        half[-3:] = [(x, y + fl, z) for (x, y, z), fl in zip(half[-3:], (0.016, 0.03, 0.04))]
    pts = [Vector((x, -y, z)) for x, y, z in reversed(half[1:])] + [Vector(p) for p in half]
    radii = [(0.0159, 0.0159) if abs(p.y) < 0.06 else (0.0125, 0.0125) if abs(p.y) < 0.19 else (0.013, 0.013) for p in pts]
    bars = skin_mesh("Bars", pts, [(i, i + 1) for i in range(len(pts) - 1)], radii, M["Carbon"], subdiv=2)
    for s in (1, -1):
        # brake/shift hood body and lever blade
        parts.append(cyl("Hood", (clamp_x + 0.07, 0.205 * s, bar_z - 0.005), (clamp_x + 0.145, 0.205 * s, bar_z + 0.01), 0.019, M["Saddle"], 12, 0.016))
        parts.append(cyl("Lever", (clamp_x + 0.14, 0.205 * s, bar_z + 0.0), (clamp_x + 0.13, (0.205 + (0.025 if STYLE == 'gravel' else 0)) * s, bar_z - 0.12), 0.008, M["DarkMetal"], 8, 0.006))
    HOOD.x, HOOD.z = clamp_x + 0.085, bar_z + 0.01
    return [bars] + parts


def build_saddle(M, seat_cluster):
    post = cyl("Seatpost", seat_cluster, SADDLE_TOP + Vector((0.012, 0, -0.04)), 0.0135, M["Carbon"], 16)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    for vert in bm.verts:
        x, y, z = vert.co
        # saddle plan shape: wide at the back, narrow nose
        t = (x + 1) / 2                                  # 0 back .. 1 nose
        width = 0.075 * (1 - 0.72 * t ** 1.4) + 0.012
        vert.co = Vector((x * 0.135, y * width, z * 0.022 + (0.006 if z > 0 else 0) - 0.006 * t))
        vert.co.z -= 0.012 * (x ** 2)                     # dip in the middle, raised tail and nose
    me = bpy.data.meshes.new("Saddle")
    bm.to_mesh(me); bm.free()
    sad = new_obj("Saddle", me, material=M["Saddle"])
    sad.location = SADDLE_TOP + Vector((-0.005, 0, -0.022))
    shade_smooth(sad, 80)
    rails = [cyl("Rail", SADDLE_TOP + Vector((-0.09, 0.025 * s, -0.035)), SADDLE_TOP + Vector((0.08, 0.012 * s, -0.03)), 0.0035, M["Metal"], 6) for s in (1, -1)]
    return [post, sad] + rails


WHEELS = {  # tyre height and half-width, rim depth / half-width, spokes front & rear, rim material
    'road': dict(h=0.0245, w=0.0139, depth=0.045, rw=0.0105, spokes=(20, 24)),
    'classic': dict(h=0.021, w=0.0118, depth=0.016, rw=0.0098, spokes=(32, 32)),
    'compact': dict(h=0.022, w=0.0125, depth=0.024, rw=0.0098, spokes=(28, 32)),
    'mtb': dict(h=0.055, w=0.0295, depth=0.022, rw=0.0145, spokes=(28, 28)),
    'gravel': dict(h=0.038, w=0.0195, depth=0.026, rw=0.0128, spokes=(24, 24)),
}
# the road tyre's half section (bead to tread centre) in units of tyre height (radially) and half-width (sideways)
_TYRE = [(-1.0, 0.705), (-0.878, 0.892), (-0.673, 1.0), (-0.429, 0.978), (-0.224, 0.849), (-0.09, 0.604), (-0.02, 0.309), (0.0, 0.0)]


def build_wheel(M, name, spokes=None, rear=False):
    W_ = WHEELS[STYLE]
    R, h, tw, rim_depth, rw = WHEEL_R, W_['h'], W_['w'], W_['depth'], W_['rw']
    spokes = W_['spokes'][1 if rear else 0]
    # Tyre (2026-11-03, the owner: "the wheels have little gaps around the rim/tyre"): the old one was only the outer half
    # of a tube, its edges 12 mm above the rim's, leaving a slot all round. Now a tyre seated on the rim: from the bead
    # (just inside the rim's top edge) out to the bulging sidewall and round over the tread, and back.
    half = [(R + nr * h, nz * tw) for nr, nz in _TYRE]
    full = half + [(r, -z) for r, z in reversed(half[:-1])]
    parts = []
    if 'Wall' in M:  # classic tan sidewalls: the sides one material, the tread another
        parts.append(lathe(name + "Wall", half[:5], 72, M["Wall"]))
        parts.append(lathe(name + "Wall", [(r, -z) for r, z in reversed(half[:5])], 72, M["Wall"]))
        parts.append(lathe(name + "Tyre", half[4:] + [(r, -z) for r, z in reversed(half[4:-1])], 72, M["Tyre"]))
    else:
        parts.append(lathe(name + "Tyre", full, 72, M["Tyre"]))
    rb = R - h + 0.0005
    parts.append(lathe(name + "Rim", [(rb, rw), (rb - rim_depth * 0.5, rw + 0.0015), (rb - rim_depth, rw * 0.57), (rb - rim_depth - 0.006, 0.0), (rb - rim_depth, -rw * 0.57), (rb - rim_depth * 0.5, -rw - 0.0015), (rb, -rw)], 64, M["Rim"]))
    if STYLE in ('mtb', 'gravel'):  # knobs: a centre row and two shoulder rows, staggered (gravel: small and many)
        kn = 1.0 if STYLE == 'mtb' else 0.55
        for row, (nr, nz, sz) in enumerate(((0.0, 0.0, (0.009 * kn, 0.012 * kn)), (-0.3, 0.86, (0.008 * kn, 0.008 * kn)), (-0.3, -0.86, (0.008 * kn, 0.008 * kn)))):
            n = 40 if STYLE == 'mtb' else 64
            for i in range(n):
                a = 2 * math.pi * (i + (0.5 if row else 0)) / n
                bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
                for v in bm.verts:
                    v.co = Vector((v.co.x * sz[0], v.co.y * sz[1], v.co.z * 0.0045 * kn))
                me = bpy.data.meshes.new("Knob"); bm.to_mesh(me); bm.free()
                k = new_obj("Knob", me, material=M["Tyre"])
                r0 = R + nr * h * 0.25 + 0.0003
                k.matrix_world = Matrix.Translation((r0 * math.cos(a), nz * tw, r0 * math.sin(a))) @ Matrix.Rotation(-a + math.pi / 2, 4, 'Y')
                bpy.context.view_layer.update(); k.data.transform(k.matrix_world); k.matrix_world = Matrix.Identity(4)
                parts.append(k)
    hw = 0.06 if STYLE == 'mtb' else 0.055 if STYLE == 'gravel' else 0.05
    parts.append(cyl(name + "Hub", (0, -hw, 0), (0, hw, 0), 0.016, M["Metal"], 16))
    fl = 0.035 if STYLE != 'mtb' else 0.042
    parts += [cyl(name + "Flange", (0, y - 0.003, 0), (0, y + 0.003, 0), 0.026, M["Metal"], 16) for y in (-fl, fl)]
    inner_r = rb - rim_depth
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        side = fl if i % 2 == 0 else -fl
        a_hub = a + (0.25 if i % 4 < 2 else -0.25)  # crossed lacing
        p0 = (0.025 * math.cos(a_hub), side, 0.025 * math.sin(a_hub))
        p1 = (inner_r * math.cos(a), side * 0.15, inner_r * math.sin(a))
        parts.append(cyl(name + "Spoke", p0, p1, 0.0011, M["Metal"], 4))
    if STYLE in ('mtb', 'gravel'):  # disc rotor (left side) with its spider (gravel 160 mm)
        parts.append(cyl("Rotor", (0, 0.05, 0), (0, 0.052, 0), 0.09 if STYLE == 'mtb' else 0.08, M["Metal"], 40))
        parts.append(cyl("RotorHub", (0, 0.049, 0), (0, 0.053, 0), 0.03, M["DarkMetal"], 16))
    if rear:
        n_cogs, big = (11, 0.085) if STYLE == 'mtb' else (6, 0.048) if STYLE == 'classic' else (9, 0.05)
        for k in range(n_cogs):
            parts.append(cyl("Cog", (0, -0.03 - k * 0.0042, 0), (0, -0.032 - k * 0.0042, 0), big - k * (big - 0.02) / n_cogs, M["Metal"], 24))
    return join(parts, name)


def build_drivetrain(M):
    # chainrings (right side, -Y), static; crank assembly is a separate object rotating about the BB
    rings = ([cyl("Ring", (0, -0.05, 0), (0, -0.053, 0), 0.068, M["DarkMetal"], 40)] if STYLE == 'mtb' else
             [cyl("Ring", (0, -0.045, 0), (0, -0.048, 0), 0.097 if STYLE == 'gravel' else 0.1, M["DarkMetal"], 48), cyl("Ring2", (0, -0.052, 0), (0, -0.055, 0), 0.066 if STYLE == 'gravel' else 0.08, M["DarkMetal"], 40)])
    for i in range(5):  # spider arms
        a = 2 * math.pi * i / 5
        rings.append(cyl("Spider", (0, -0.05, 0), (0.07 * math.cos(a), -0.05, 0.07 * math.sin(a)), 0.006, M["Carbon"], 6))
    crank_parts = rings
    for s, ang in ((-1, 0.0), (1, math.pi)):
        # arm along -Z (pedal at bottom at angle 0), tapered
        tip = Vector((-math.sin(ang) * CRANK_LEN, 0.075 * s, -math.cos(ang) * CRANK_LEN))
        crank_parts.append(cyl("Arm", (0, 0.068 * s, 0), tip, 0.014, M["Carbon"], 10, 0.01))
    spindle = cyl("Spindle", (0, -0.075, 0), (0, 0.075, 0), 0.012, M["Metal"], 12)
    crank = join(crank_parts + [spindle], "Crank")
    crank.location = BB
    pedals = []
    for s, ang in ((-1, 0.0), (1, math.pi)):
        tip = Vector((-math.sin(ang) * CRANK_LEN, 0.075 * s, -math.cos(ang) * CRANK_LEN))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for vert in bm.verts:
            vert.co = Vector((vert.co.x * 0.085, vert.co.y * 0.065, vert.co.z * 0.016))
        me = bpy.data.meshes.new("Pedal")
        bm.to_mesh(me); bm.free()
        p = new_obj("Pedal" + ("R" if s < 0 else "L"), me, material=M["Saddle"])
        bev = p.modifiers.new("bev", "BEVEL"); bev.width = 0.006; bev.segments = 2
        apply_mods(p)
        p.parent = crank
        p.location = tip + Vector((0, 0.04 * s, 0))
        pedals.append(p)
    # chain: top and bottom runs between big ring and middle cog
    chain = [cyl("Chain", (0.0, -0.047, 0.1), REAR_HUB - BB + Vector((0, -0.047, 0.033)), 0.0035, M["DarkMetal"], 6),
             cyl("Chain", (0.0, -0.047, -0.1), REAR_HUB - BB + Vector((0.01, -0.047, -0.06)), 0.0035, M["DarkMetal"], 6)]
    ch = join(chain, "Chain")
    ch.location = BB
    # rear derailleur and front mech
    rd = cyl("RearMech", REAR_HUB + Vector((0.0, -0.06, -0.02)), REAR_HUB + Vector((0.01, -0.062, -0.075)), 0.012, M["DarkMetal"], 10)
    fd = cyl("FrontMech", BB + Vector((-0.05, -0.04, 0.12)), BB + Vector((0.0, -0.045, 0.125)), 0.008, M["DarkMetal"], 8)
    return crank, pedals, [ch, rd] + ([] if STYLE == 'mtb' else [fd])


def build_bike():
    M = materials()
    frame, ht_top, ht_bot, seat_cluster = build_frame(M)
    cockpit = build_cockpit(M, ht_top, ht_bot)
    saddle = build_saddle(M, seat_cluster)
    crank, pedals, drive_static = build_drivetrain(M)
    fork = build_fork(M, ht_top, ht_bot)
    # bottle sits on top of the down tube, in its cage
    dt = (ht_bot - BB).normalized()
    up = Vector((-dt.z, 0, dt.x))
    bottle = build_bottle(M, BB + dt * 0.19 + up * 0.068, dt, up)
    # brakes: calipers at fork crown and seat stay bridge
    seat_stay_mid = (seat_cluster + REAR_HUB) / 2 + (seat_cluster - REAR_HUB).normalized() * 0.12
    brakes = ([cyl("Caliper", REAR_HUB + Vector((0.02, 0.05, 0.075)), REAR_HUB + Vector((0.06, 0.05, 0.06)), 0.014, M["DarkMetal"], 10)] if STYLE in ('mtb', 'gravel')
              else [cyl("Brake", seat_stay_mid, seat_stay_mid + Vector((-0.02, 0, -0.03)), 0.012, M["DarkMetal"], 8)])
    static = join([frame] + fork + cockpit + saddle + drive_static + bottle + brakes, "Bike")
    front = build_wheel(M, "WheelF")
    front.location = FRONT_HUB
    rear = build_wheel(M, "WheelR", rear=True)
    rear.location = REAR_HUB
    return {"bike": static, "front": front, "rear": rear, "crank": crank, "pedals": pedals, "materials": M}
