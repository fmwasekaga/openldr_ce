#!/bin/sh
# Issue (or renew) a Let's Encrypt TLS cert for the single-port gateway and reload nginx.
#
# Prereqs: the stack is already up (`docker compose -f docker-compose.prod.yml -p <project> up -d`)
# so nginx is serving the ACME http-01 challenge on :80; the domain's DNS A-record points at this
# host; and ports 80+443 are reachable from the internet.
#
# Usage:
#   sh deploy/letsencrypt.sh                       # domain+email read from .env.prod
#   sh deploy/letsencrypt.sh <domain> <email>      # or pass explicitly
#   PROJECT=openldr sh deploy/letsencrypt.sh        # override the compose project name (default: openldr)
#
# Idempotent: safe to re-run. Wire it into cron (e.g. twice daily) for hands-off renewal —
# certbot only re-issues when the cert is near expiry (--keep-until-expiring); nginx reloads either way.
set -eu

DOMAIN="${1:-$(grep -E '^SERVER_NAME=' .env.prod | head -1 | cut -d= -f2- | tr -d '\r')}"
EMAIL="${2:-$(grep -E '^LETSENCRYPT_EMAIL=' .env.prod | head -1 | cut -d= -f2- | tr -d '\r')}"
PROJECT="${PROJECT:-openldr}"
COMPOSE="docker compose -f docker-compose.prod.yml -p ${PROJECT}"

if [ -z "${DOMAIN}" ] || [ -z "${EMAIL}" ]; then
  echo "error: need a domain and email. Pass them as args, or set SERVER_NAME + LETSENCRYPT_EMAIL in .env.prod (pnpm run init does this)." >&2
  exit 1
fi

echo "==> issuing/renewing Let's Encrypt cert for ${DOMAIN} (project ${PROJECT})"
# certonly over the webroot nginx already serves. --keep-until-expiring makes re-runs cheap.
${COMPOSE} run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" --email "${EMAIL}" --agree-tos --no-eff-email --keep-until-expiring --non-interactive

echo "==> installing the cert where nginx reads it (deploy/nginx/certs)"
${COMPOSE} run --rm --entrypoint sh certbot -c \
  "cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem /certs-out/fullchain.pem && cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem /certs-out/privkey.pem"

echo "==> reloading nginx"
${COMPOSE} exec nginx nginx -s reload

echo "==> done. https://${DOMAIN} now serves the Let's Encrypt cert."
