#!/usr/bin/env sh
# Generate a self-signed TLS cert for local/demo deployment.
# For production, obtain certs via Let's Encrypt/certbot and drop fullchain.pem +
# privkey.pem into deploy/nginx/certs/ instead (see DEPLOYMENT.md).
set -eu
DIR="$(dirname "$0")/certs"
CN="${1:-localhost}"
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
  -subj "/CN=$CN" -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1"
echo "wrote $DIR/fullchain.pem + $DIR/privkey.pem (CN=$CN)"
