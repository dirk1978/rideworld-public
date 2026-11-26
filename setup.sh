#!/usr/bin/env bash
# RideWorld: one-command setup on Linux, macOS or WSL.
#   ./setup.sh             set up here (Node 20+ needed; nothing else to install)
#   ./setup.sh --service   also install and start it as a systemd service (Linux, asks for sudo)
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\033[1;33m%s\033[0m\n' "$*"; }

# 1. Node
if ! command -v node >/dev/null; then echo "Node.js 20 or newer is needed: https://nodejs.org (or use Docker: docker compose up -d)"; exit 1; fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node $NODE_MAJOR found; RideWorld needs 20 or newer."; exit 1; }

# 2. settings
[ -f .env ] || { cp .env.example .env; say "Created .env (edit it to change the port or your public address)."; }
set -a; . ./.env; set +a
PORT=${PORT:-8443}

LAN_IP=$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1) | awk '{print $1}')
# the address riders use (links in emails, Strava's return, the phone remote's QR code): this computer on the LAN unless
# you've set your own (a public address behind a proxy)
if [ -z "${PUBLIC_URL:-}" ]; then
  PUBLIC_URL="https://$LAN_IP:$PORT"
  if grep -q '^PUBLIC_URL=' .env; then sed -i.bak "s#^PUBLIC_URL=.*#PUBLIC_URL=$PUBLIC_URL#" .env && rm -f .env.bak; else echo "PUBLIC_URL=$PUBLIC_URL" >> .env; fi
  say "PUBLIC_URL set to $PUBLIC_URL (change it in .env if riders reach this server another way)."
fi

# 3. data folder (accounts, routes, rides: private, kept out of git)
mkdir -p data && chmod 700 data

# 4. HTTPS certificate (browsers only allow Bluetooth, USB and the phone remote on https)
if [ ! -f certs/key.pem ]; then
  mkdir -p certs
  if command -v mkcert >/dev/null; then
    mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 "$LAN_IP" "$(hostname)"
    say "Certificate made with mkcert (trusted on this computer)."
  else
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout certs/key.pem -out certs/cert.pem -subj "/CN=RideWorld" \
      -addext "subjectAltName=DNS:localhost,DNS:$(hostname),IP:127.0.0.1,IP:$LAN_IP" 2>/dev/null
    say "Self-signed certificate made (your browser warns once: Advanced -> continue). For no warning, install mkcert and run this again."
  fi
fi

# 5. the first admin account
if [ ! -s data/users.json ]; then
  U=""
  if [ -t 0 ]; then read -r -p "Admin username [${ADMIN_USER:-admin}]: " U || true; fi # (no keyboard: ADMIN_USER from .env)
  U=${U:-${ADMIN_USER:-admin}}
  node tools/adduser.js "$U" --admin
  say "Keep that password: sign in with it, then add other riders under Accounts."
fi

# 6. optional: a systemd service
if [ "${1:-}" = "--service" ]; then
  UNIT=/etc/systemd/system/rideworld.service
  sudo tee "$UNIT" >/dev/null <<UNIT
[Unit]
Description=RideWorld
After=network-online.target
[Service]
WorkingDirectory=$PWD
EnvironmentFile=$PWD/.env
ExecStart=$(command -v node) $PWD/server.js
User=$(id -un)
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$PWD/data
[Install]
WantedBy=multi-user.target
UNIT
  # the route worker (heights, bridges and climbs for every new route) as its own service
  sudo tee /etc/systemd/system/rideworld-pipeline.service >/dev/null <<UNIT
[Unit]
Description=RideWorld route worker
After=rideworld.service
[Service]
WorkingDirectory=$PWD
EnvironmentFile=$PWD/.env
ExecStart=$(command -v node) $PWD/tools/pipeline/worker.mjs
User=$(id -un)
Restart=on-failure
Nice=10
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$PWD/data
[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload && sudo systemctl enable --now rideworld rideworld-pipeline
  say "Installed and started: systemctl status rideworld"
  echo "Open https://$LAN_IP:$PORT"
  exit 0
fi
say "Ready. Start it with ./start.sh and open https://$LAN_IP:$PORT"
