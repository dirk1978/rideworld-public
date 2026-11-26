# Rider model (public/models/rider.glb)

Built on the server with Blender, from free assets:

- Body: MakeHuman base mesh, skin texture and `shoes05` via the MPFB2 Blender extension (assets CC0;
  MPFB itself is GPL but is only the tool, the output is ours to use).
- Kit, helmet, glasses and the whole bike are made by the scripts here (`bike.py`, `build_rider.py`).

## Rebuild

    /snap/bin/blender -b --python tools/rider/build_rider.py -- public/models/rider.glb [/tmp/preview.blend]
    node tools/rider/slim_skin.js public/models/rider.glb   # ALWAYS after a build: 53 -> 13 skin joints, for phones

Takes about a minute. Then hard-refresh the app.

## One-time setup (already done on the test server, 2026-10-14)

1. `sudo snap install blender --channel=4.5lts/stable --classic`
2. MPFB: download `add-on-mpfb-v2.0.18.zip` from extensions.blender.org, then
   `blender --command extension install-file -r user_default -e add-on-mpfb-v2.0.18.zip`
3. Assets: unzip `makehuman_system_assets_cc0.zip` (static.makehumancommunity.org asset packs) into
   `~/.config/blender/4.5/mpfb/data` and make `~/.config/blender/4.5/extensions/.user/user_default/mpfb/data`
   a symlink to it (MPFB reads from the latter).

## Notes

- Body (2026-10-17, the owner: "slightly less athletic"): MakeHuman macros muscle 0.72 -> 0.5, weight 0.32 -> 0.5,
  age 0.4 -> 0.45. The bike refits itself to the new leg length.

- Axes: +X forward, +Y left, +Z up. The app loads it with `forwardAxis: X` (glTF Y-up is handled by Cesium).
- Animations: `pedal` (crank + baked leg IK, one revolution over 1 s) and `wheels` (one turn over 1 s);
  the app scrubs them from cadence and distance.
- Materials the app recolours by name: Jersey, Shorts, Accent (= shorts colour), Frame, Helmet.
- The saddle height is computed from the rider's leg length (about 30° knee bend at the bottom of the stroke);
  the torso leans forward until the hoods are within 90% of arm length (elbows bent).
- Frame geometry (2026-10-15 refit): head tube ~73.5° with the front axle ahead of it (fork sweeps forward),
  70 mm stem with spacers, bars ~level with the saddle. The first version had the head tube 14 cm too far forward:
  the fork angled back and the rider lay flat with straight arms ("superman").
- This CPU has no AVX2: Blender's EXACT boolean solver crashes with "Illegal instruction", so avoid it.

- 2026-10-18 (the owner: no stem, silly glasses, time-trial helmet, heel too low):
  - Feet: the foot bone slopes ~27 deg down when standing flat (`FOOT_REST`), so the sole angle (`sole_angle()`:
    ~13 deg toe-down at the bottom, 18 at the back, 7 over the top, ~2 in the push) is added to it. The old code
    aimed the bone 18 deg down, i.e. the sole heel-down. The saddle refits higher (+4.7 cm) because the heel is up.
  - Cockpit: steerer, four 15 mm spacers, stem clamp, top cap, a ~100 mm stem, faceplate with bolts, and the bars as
    one unbranched tube (the old skin mesh branched at the stem and melted it). Bars raised 3 cm with the saddle.
  - Helmet: the skull's own shape (ray cast onto the body, `shaped_shell()`) pushed out by the foam, slimmer at the
    sides, slightly longer at the back, on a grid that starts at the lower edge (`cut_z()`) so the edge is smooth;
    vents are dark rounded slots laid on the shell (`VENTS`; punched holes came out jagged); chin straps.
  - Glasses: two wrap lenses on a circle round the face, thin top frame, arms to the ears (ray cast to clear the skin).
  - Preview renders: open the .blend from the build command and render with Cycles (camera + sun).
  - Tweaks the same day: hands 2 cm wider (`HAND_Y` 0.225; at 0.205 they went through the hoods), a headset cap
    sunk into the head tube under five 14 mm spacers (there was a gap between them), MakeHuman target
    `buttocks-volume-decr` at 0.9 and matt shorts (roughness 0.78; the owner: "too round and shiny").
  - Hems: before colouring, the body mesh is cut (bmesh bisect) exactly along the jersey hem, the neckline, the
    sleeve ends and the leg grippers, each cut only on that body part's faces, so the kit edges are straight lines
    instead of face staircases. The shorts' surface behind the hips near the middle is smoothed (the cleft).
  - Fork (the owner: "weirdly backwards"): its own unbranched tube (`build_fork()`): blades straight down the steering
    axis, then sweeping forwards to the axle, ~45 mm rake (FRONT_HUB x 0.585 -> 0.60), crown under the head tube.
    It used to branch off the frame's skin mesh, start behind the axis and bend back into the hub. Skin meshes get
    doubles removed and normals recalculated (grey blotches at junctions), and a tapered head tube sleeve covers
    the frame's crease there. Front brake caliper hangs from the new crown.
  - Bottle (the owner: "a cardboard tube"): lathed bidon (rounded base, grip waist, shoulder, push-pull cap, blue label
    band, material BottleLabel) in a black wire cage (`build_bottle()`).
- 2026-10-19 (the owner: "the rider's neck looks like a banana" from the side): the look-up after leaning forward is
  now mostly in the head (`NECK_UP, HEAD_UP = 0.22, 0.53` x lean; was 0.45 / 0.35). The neck carries on roughly in
  line with the back instead of standing up vertically from the shoulders.

- 2026-11-03 (the owner: "the neck still looks really weird - it's too long and the head too low ... giraffe style";
  "the upper body just doesn't move at all"; reference shots in <your files folder>):
  - Tuning knobs at the top of build_rider.py (`TUNE`, each overridable with an `RW_<NAME>` env var for experiments).
  - Neck: MakeHuman `measure-neck-height-decr` 0.5 and `measure-shoulder-dist-incr` 0.35; shoulders rounded forward 5 deg
    and up 2 deg (clavicles); neck extended 0.42 x lean (was 0.22) so the head sits up above the shoulders; the head then
    tips until the eyes look 12 deg below the horizon (`face_pitch()`), instead of a fixed share of the lean.
  - Collar: the neckline plane pivots at the back of the neck and dips 8 deg at the front, 1.5 cm lower than before (a
    level cut read as a turtleneck once the head came up; pivoting mid-neck raised the back to the hairline).
  - the owner tried a lower pro position (2 spacers, 110 mm -6 deg stem) and preferred the original back angle "on the
    hoods": bike.py `SPACERS, STEM_LEN, STEM_ANGLE` default to the old 5 / 104 mm / +6.6.
  - Upper body sway baked into `pedal` (`SWAY` 1.5 deg): torso rolls towards the leg pushing down, hips 0.6 of it, the
    pushing-side shoulder dips, head counter-rolls to keep the eyes level, a breath twice a revolution. Bones keyed in
    their own rotation mode (they're XYZ: keying quaternions did nothing).
  - slim_skin.js: a joint moves if its WORLD matrix changes over the animation (sampled per frame); hand and finger joints
    are always pre-posed (they roll ~0.2 deg on the hoods). 53 -> 28 joints (was 13 with a frozen upper body); 112
    uniform vectors, still well under the ~256 phones allow.
  - Renders: `tools/rider/render.py` (views rear, rear34, side, front34, head, chase; RW_VIEWS / RW_RES / RW_SAMPLES).
- 2026-11-03 wheels (the owner: "little gaps around the rim/tyre"): the tyre was the outer half of a tube whose edges sat
  12 mm above the rim's: a slot all round. Now a 28 mm tyre profile seated just inside the rim's edge, bulging sidewalls.
- 2026-11-03 kit: the jersey faces get their own UV layout (build_rider.py "kit texture layout"; plan in
  public/js/kit.js): torso rows 0-576 of 1024 (u from the right side seam: 256 front centre, 512 left side, 768 back
  centre, wraps), sleeves rows 614-819. The app paints the design on a canvas and recolourGlb puts the PNG into the GLB.
  Shoes05 split into `Shoes` and `Socks` materials (socks = faces above ankle + 3 cm), each tinted by the app.
  Render a test design: `RW_KIT_TEST=/path/1024.png` (+ red socks / blue shoes) with try.sh / render.py views back, chest.
- 2026-11-03 bike styles: `RW_BIKE=road|classic|compact|mtb|gravel` (gravel = Giant Revolt Advanced 2, size S, from Giant's chart and the owner's photos) (bike.py STYLES / WHEELS / set_style). Each builds its own
  GLB: public/models/rider.glb (road), rider-classic.glb, rider-compact.glb, rider-mtb.glb; run slim_skin.js on each.
  The app's list is BIKES in public/js/app/model.js (file + wheel radius). MTB hands go on the grips (B.HAND_Y 0.335).
  Rider: muscle 0.62, deltoids 0.6, traps/lats 0.5 (the owner: "shoulders a bit underdeveloped"), shoulders not raised
  (CLAV_UP 0), sway 1.0 deg with less roll high in the spine (the head swung side to side).
  Rebuild all four:  for b in road classic compact mtb gravel; do f=public/models/rider.glb; [ $b != road ] && f=public/models/rider-$b.glb;
  RW_BIKE=$b /snap/bin/blender -b --python tools/rider/build_rider.py -- $f; node tools/rider/slim_skin.js $f; done
- 2026-11-03 standing: build_rider.py bakes a second cycle "stand" (STAND=1): hips STAND_FWD 17 cm forward and up until
  the legs are 98.5% straight at the bottom, torso raised until the hoods are STAND_ARM 0.8 x arm length away, eyes
  re-aimed; the root node rolls ROCK 7 deg away from the pushing leg (keyed level in "pedal": the exporter keeps it with
  export_optimize_animation_keep_anim_object) while the hips shift the other way and the pelvis counter-rolls, so the
  rider stays over the tyres. slim_skin.js samples each animation separately and judges joints in the root's frame.
  App: public/js/stance.js (when to stand; switches the Cesium animation). Bike pictures for the setup screen:
  RW_BIKE_ONLY=1 RW_VIEWS=bikeside render.py -> public/img/bikes/<style>.webp (crop 900x560 at y 170, 480 wide).

## Chest under the jersey (2026-11-16)
After build_rider.py and slim_skin.js, run `node tools/rider/tuck_chest.js public/models/rider*.glb`: the MakeHuman jersey
has a hole at each nipple and the body's nipples sit on its surface, so they showed through (the owner). It fills the holes
and pushes the nipples 4 mm in. Idempotent (asset.extras.chestTucked).

## 3D facial hair (2026-11-16)
Then `node tools/rider/beard_shells.js public/models/rider*.glb`: 8 shells of the lower face (0.8-14 mm out) with a
`Beard` material (alpha mask). model.js beardPng draws their atlas per style + colour (kit Facial hair / Hair colour).
Order: build_rider.py, slim_skin.js, tuck_chest.js, beard_shells.js. Both scripts are idempotent.

### Finding places on the face (2026-11-16, lesson)
Don't guess from the flat skin texture (the beard ended up over the ears and above the nostrils). Paint a labelled grid
on the Skin material in the setup preview (model-viewer: `mv.createTexture(canvas)` + `baseColorTexture.setTexture`) and
render front and side views; read the texture x/y of each landmark off the grid. Measured: face centre y 526, nostrils
x 900, lips x 922-945 / y 500-552, chin ~975, ears y 650-700 and 352-402, jaw angle ~(942, 652). The outlines live in
model.js (BEARD_FULL / BEARD_TACHE / BEARD_CHIN / LIPS) and beard_shells.js (JAW, same as BEARD_FULL).
