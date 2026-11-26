#!/bin/bash
# Rebuild every Blender-scripted model (the lk.py ones) into a models folder: by default a staging copy, so the
# result can be compared before it replaces public/models. lk.export merges meshes by material, Draco-compresses
# them and caps textures at LK_MAX (256 by default).
#   tools/kit/rebuild-all.sh [out dir, default /tmp/rw-models] [filter: a word in the job name]
# Not here (not lk.py, small, built by hand): kit/portal*.glb, kit/pier.glb, landmarks/formentor.glb, the rider.
cd "$(dirname "$0")/../.." || exit 1
OUT=${1:-/tmp/rw-models}; F=${2:-}
B=/snap/bin/blender
run() { # name, then the command's env + script + args
  local name=$1 log; shift; log="$OUT/.log-${name//\//_}"
  [[ -n $F && $name != *$F* ]] && return
  printf '%-28s ' "$name"
  if env "$@" >"$log" 2>&1; then echo ok; else echo "FAILED (see $log)"; fi
}
mkdir -p "$OUT"/{bromsgrove,london,shire,canal/boats,canal/bromsgrove-open,canal/stratford-alcester,footbridges/bromsgrove-open}
for n in victoria_ground st_johns artrix bromsgrove_station nailers_yard ladybird black_cross ewe_and_lamb hanbury_turn queens_head tardebigge_church engine_house tardebigge_tunnel; do
  run "bromsgrove/$n" $B -b --python tools/kit/bromsgrove.py -- $n "$OUT/bromsgrove/$n.glb"
done
for n in eye stpauls battersea victoria_tower central_tower; do run "london/$n" $B -b --python tools/kit/london/landmarks2.py -- $n "$OUT/london/$n.glb"; done
for n in white_tower albert_hall abbey buckingham victoria_memorial admiralty_arch wellington_arch st_pancras walkie_talkie; do
  run "london/$n" $B -b --python tools/kit/london/landmarks3.py -- $n "$OUT/london/$n.glb"
done
for n in shard gherkin bt_tower monument nelson; do run "london/$n" $B -b --python tools/kit/london/towers.py -- $n "$OUT/london/$n.glb"; done
run london/trafalgar $B -b --python tools/kit/london/trafalgar.py -- "$OUT/london/trafalgar.glb"
run london/elizabeth_tower $B -b --python tools/kit/london/elizabeth_tower.py -- "$OUT/london/elizabeth_tower.glb"
run london/tower_bridge $B -b --python tools/kit/london/tower_bridge.py -- "$OUT/london/tower_bridge.glb"
for n in bidford clopton edstone wootton; do run "shire/$n" BIDFORD=tools/kit/bidford-line.json CLOPTON=tools/kit/clopton-line.json $B -b --python tools/kit/shire.py -- $n "$OUT/shire/$n.glb"; done
run canal/boats $B -b --python tools/kit/narrowboat.py -- "$OUT/canal/boats"
for w in bromsgrove-open stratford-alcester; do
  run "canal/$w" LOCKS=tools/kit/canal-$w.json BRIDGES=tools/kit/canal-$w-bridges.json $B -b --python tools/kit/canal.py -- "$OUT/canal/$w"
done
run footbridges/bromsgrove-open SPEC=tools/kit/footbridges-bromsgrove-open.json $B -b --python tools/kit/footbridge.py -- "$OUT/footbridges/bromsgrove-open"
