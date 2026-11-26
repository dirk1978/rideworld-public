#!/usr/bin/env bash
# Start RideWorld with the settings in .env (run ./setup.sh first)
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; }
exec node server.js
