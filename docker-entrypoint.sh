#!/bin/sh
# First start: a self-signed certificate (unless you put your own in the certs volume) and the first admin (password in the logs)
set -e
cd /app
if [ ! -f certs/key.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout certs/key.pem -out certs/cert.pem -subj "/CN=RideWorld" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1${HOST_IP:+,IP:$HOST_IP}" 2>/dev/null
  echo "RideWorld: made a self-signed certificate (put your own key.pem / cert.pem in the certs volume to replace it)"
fi
if [ ! -s data/users.json ]; then
  echo "RideWorld: creating the first admin account:"
  node tools/adduser.js "${ADMIN_USER:-admin}" --admin
fi
exec node server.js
