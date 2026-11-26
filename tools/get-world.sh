#!/usr/bin/env bash
# Download and install a ready-built open world (a ride-anywhere map: roads, buildings, trees, landmarks, the real
# ground heights) from the project's releases, so nothing has to be built here.
#   tools/get-world.sh                 list the worlds available
#   tools/get-world.sh bromsgrove-open install one (also: london-central, stratford-alcester)
# WORLDS_URL (in .env) points at where the packs are published; by default the latest GitHub release of this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }
REPO_URL=$(git config --get remote.origin.url 2>/dev/null | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##' || true)
WORLDS_URL=${WORLDS_URL:-${REPO_URL:+$REPO_URL/releases/latest/download}}
[ -n "$WORLDS_URL" ] || { echo "Set WORLDS_URL in .env to where the world packs are published."; exit 1; }
ID=${1:-}
if [ -z "$ID" ]; then
  echo "Worlds: bromsgrove-open (Bromsgrove, the Clent and Lickey hills, the Tardebigge locks; hilly)"
  echo "        london-central  (Westminster to Tower Bridge, every Thames bridge; flat)"
  echo "        stratford-alcester (Stratford-upon-Avon, Alcester, the Avon and Arrow valleys; rolling)"
  echo "Install one: tools/get-world.sh <name>"; exit 0
fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "Downloading $ID (tens of MB)…"
curl -fL --progress-bar "$WORLDS_URL/$ID.tar.gz" -o "$TMP/w.tar.gz"
tar -xzf "$TMP/w.tar.gz" -C "$TMP"
mkdir -p data/world data/routes && chmod 700 data
cp "$TMP"/world/* data/world/
cp "$TMP"/routes/* data/routes/
# the world's entry in the route list (replacing an older one), then its pre-plotted rides planned on this exact world file
node -e '
  const fs = require("fs"), f = "data/routes.json", e = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  let list = []; try { list = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  list = list.filter((r) => r.id !== e.id); list.push(e);
  fs.writeFileSync(f, JSON.stringify(list, null, 1), { mode: 0o600 });' "$TMP/entry.json"
[ -f "tools/openworld/rides/$ID.json" ] && node tools/openworld/rides.mjs "$ID" --write >/dev/null && echo "Pre-plotted rides planned."
echo "Installed $ID: reload RideWorld and choose Open world."
