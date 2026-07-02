#!/bin/sh
# Renew the Let's Encrypt cert for THIS install dir's domain and reload the gateway.
# Run from cron (see /etc/cron.d/openldr-cert). Idempotent: certbot renew only re-issues near
# expiry; the copy + reload run either way so a fresh cert is always picked up.
set -eu
cd "$(dirname "$0")"
HOST="$(grep -E '^SERVER_NAME=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
[ -n "$HOST" ] || { echo "renew-cert: no SERVER_NAME in .env" >&2; exit 1; }
docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
  renew --webroot -w /var/www/certbot --quiet
docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
  "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && \
   cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
docker compose exec gateway nginx -s reload
