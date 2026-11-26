#!/usr/bin/env bash
# Start RideWorld with the settings in .env (run ./setup.sh first). The route worker (tools/pipeline/worker.mjs: heights,
# bridges and climbs for every new or replaced route) runs beside the web server; its log is data/pipeline-worker.log.
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; }
mkdir -p data
node tools/pipeline/worker.mjs >> data/pipeline-worker.log 2>&1 &
WORKER=$!
trap 'kill $WORKER 2>/dev/null' EXIT INT TERM
node server.js
