# Preview renders of the rider model (2026-11-03): the views RideWorld's cameras see it from, so changes to the rider
# can be compared side by side. Cycles on the CPU, small and quick.
#   /snap/bin/blender -b --python tools/rider/render.py -- <rider.glb> <out prefix> [crank frame 0-23] [anim]
# writes <prefix>-rear.png (the chase view), -rear34.png, -side.png, -front34.png
import bpy, sys, math, os
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = args[0], args[1]
FRAME = int(args[2]) if len(args) > 2 else 6
ANIM = args[3] if len(args) > 3 else 'pedal'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
sc = bpy.context.scene
# play the chosen animation's strips at the frame
for o in sc.objects:
    ad = o.animation_data
    if not ad: continue
    for t in ad.nla_tracks:
        t.mute = not t.name.startswith(ANIM) and not t.name.startswith('wheels')
sc.frame_set(FRAME)
BIKE_ONLY = os.environ.get('RW_BIKE_ONLY')  # the setup screen's bike pictures: no rider, no ground, transparent
if BIKE_ONLY:
    keep = lambda o: o.name.split('.')[0] in ('Bike', 'WheelF', 'WheelR', 'Crank', 'PedalL', 'PedalR', 'Pedal')
    for o in sc.objects:
        if o.type == 'MESH' and not keep(o): o.hide_render = True
# world: soft sky light; a sun; a ground plane
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.62, 0.72, 0.85, 1); bg.inputs[1].default_value = 0.9
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(50), math.radians(-20), math.radians(140))
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
if BIKE_ONLY: bpy.context.object.hide_render = True; sc.render.film_transparent = True
g = bpy.context.object; gm = bpy.data.materials.new('ground'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.32, 0.33, 1); g.data.materials.append(gm)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = int(os.environ.get('RW_RES', 900))
sc.cycles.samples = int(os.environ.get('RW_SAMPLES', 48))
cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
cam.lens = 50
target = Vector((0.0, 0, 0.95))
VIEWS = {'rear': (-3.6, 0.0, 1.45), 'rear34': (-2.6, 2.2, 1.35), 'side': (0.05, 3.6, 1.0), 'front34': (2.6, 2.2, 1.3), 'head': (0.35, 1.35, 1.3), 'chase': (-2.4, 0.5, 1.75), 'wheel': (0.95, 0.62, 0.5), 'back': (-0.9, 0.35, 1.75), 'chest': (1.25, -0.35, 1.05), 'bikeside': (0.1, -3.2, 0.5)}
TARGETS = {'head': Vector((0.3, 0, 1.12)), 'chase': Vector((0.1, 0, 0.9)), 'wheel': Vector((0.6, 0, 0.33)), 'back': Vector((0.15, 0, 1.0)), 'chest': Vector((0.25, 0, 1.0)), 'bikeside': Vector((0.1, 0, 0.47))}
import os
ONLY = os.environ.get('RW_VIEWS', '').split(',') if os.environ.get('RW_VIEWS') else list(VIEWS)
for name, pos in VIEWS.items():
    if name not in ONLY: continue
    co.location = Vector(pos)
    d = TARGETS.get(name, target) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{OUT}-{name}.png'
    bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
