#!/usr/bin/env sh
# OpenLDR CE one-line installer (Linux/macOS).
#   curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
# Flags: --dir <path> (default ./openldr), --version <tag> (default latest),
#        --server-name <host> (default localhost — the public hostname/domain),
#        --http-port <n> (default 80), --https-port <n> (default 443 — gateway ports),
#        --letsencrypt <email> (issue a trusted Let's Encrypt cert for --server-name),
#        --staging (use the LE staging CA — for testing, avoids rate limits),
#        --no-start (scaffold + config only), --no-pull (skip image pull).
set -eu

REPO_RAW="https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main"
DIR="./openldr"
VERSION="latest"
HOST="localhost"
HTTP_PORT="80"
HTTPS_PORT="443"
LE_EMAIL=""
LE_STAGING=""
NO_START=0
NO_PULL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --server-name) HOST="$2"; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --https-port) HTTPS_PORT="$2"; shift 2 ;;
    --letsencrypt) LE_EMAIL="$2"; shift 2 ;;
    --staging) LE_STAGING=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# An existing .env (from a prior run in this dir) is never overwritten below, so its
# GATEWAY_*_PORT/SERVER_NAME are what will actually be used — adopt them instead of
# re-deriving from (possibly stale/different) CLI args.
ENV_EXISTS=0
if [ -f "$DIR/.env" ]; then
  ENV_EXISTS=1
  EXISTING_HTTP="$(grep -E '^GATEWAY_HTTP_PORT=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  EXISTING_HTTPS="$(grep -E '^GATEWAY_HTTPS_PORT=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  EXISTING_HOST="$(grep -E '^SERVER_NAME=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  [ -n "$EXISTING_HTTP" ] && HTTP_PORT="$EXISTING_HTTP"
  [ -n "$EXISTING_HTTPS" ] && HTTPS_PORT="$EXISTING_HTTPS"
  [ -n "$EXISTING_HOST" ] && HOST="$EXISTING_HOST"
fi
if [ "$HTTPS_PORT" = "443" ]; then
  ORIGIN="https://$HOST"
else
  ORIGIN="https://$HOST:$HTTPS_PORT"
fi

err() { echo "✗ $1" >&2; exit 1; }

# Let's Encrypt needs a public hostname reachable over :80 — reject localhost / bare IPs.
if [ -n "$LE_EMAIL" ]; then
  if [ "$HOST" = "localhost" ] || echo "$HOST" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    err "--letsencrypt needs a public --server-name (a domain), not localhost or an IP."
  fi
fi

# 1. Preflight
command -v docker >/dev/null 2>&1 || err "Docker is not installed. See https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || err "Docker Compose plugin not found. Update Docker Desktop or install docker-compose-plugin."
docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker and retry."

# Port-conflict detection — fail fast with remediation instead of a confusing failure deep
# inside `docker compose up`. Only for fresh installs: if .env already exists, HTTP_PORT/
# HTTPS_PORT above were adopted from it, so "in use" almost certainly means this same
# install's own (already running) stack, not a real conflict. Best-effort: falls back
# through ss/netstat/nc/lsof and silently skips the check if none are available.
port_in_use() {
  p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[.:]${p}\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -i listen | grep -qE "[.:]${p}([[:space:]]|\$)"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$p" >/dev/null 2>&1
  else
    return 1
  fi
}
if [ "$ENV_EXISTS" -eq 0 ]; then
  for p in "$HTTP_PORT" "$HTTPS_PORT"; do
    if port_in_use "$p"; then
      err "Port $p is already in use by another process/service. Free it, or install to different ports, e.g.:
    install.sh --http-port 8080 --https-port 8443"
    fi
  done
fi

# 2. Scaffold
echo "→ Scaffolding $DIR"
mkdir -p "$DIR/config/nginx/certs" "$DIR/config/keycloak"
fetch() { curl -fsSL "$REPO_RAW/$1" -o "$2" || err "failed to download $1"; }
fetch "deploy/install/docker-compose.yml" "$DIR/docker-compose.yml"
fetch "infra/keycloak/openldr-realm.json" "$DIR/config/keycloak/openldr-realm.json"
fetch "scripts/init-target-db.sql" "$DIR/config/init-target-db.sql"
fetch "deploy/install/renew-cert.sh" "$DIR/renew-cert.sh"
chmod +x "$DIR/renew-cert.sh" 2>/dev/null || true

# Register this deploy's origin as a valid OIDC redirect so studio login works behind the
# gateway. The shipped realm lists localhost + dev URLs; a non-localhost host (or https://localhost)
# must be added or Keycloak rejects the /studio/auth/callback redirect. webOrigins is already "+".
REALM="$DIR/config/keycloak/openldr-realm.json"
if ! grep -qF "\"$ORIGIN/*\"" "$REALM" 2>/dev/null; then
  sed "s|\"redirectUris\": \[|\"redirectUris\": [\"$ORIGIN/*\", |" "$REALM" > "$REALM.tmp" && mv "$REALM.tmp" "$REALM"
  echo "→ Registered $ORIGIN/* as an OIDC redirect in the realm"
fi

# 3. Secrets + cert (only on first run — never overwrite an existing .env)
# Read a bounded block of /dev/urandom (not an unbounded stream) and take the
# first 24 alnum chars with cut — cut consumes all of its input, so no early
# pipe close can SIGPIPE an upstream reader even under `set -o pipefail`.
rand() { head -c 3072 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24; }
if [ ! -f "$DIR/.env" ]; then
  PG_PW="$(rand)"; KC_PW="$(rand)"; S3_KEY="$(rand)"; S3_SECRET="$(rand)"
  SECRETS_KEY="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '\n')"

  # COMPOSE_PROJECT_NAME: Compose's own default (the install dir's leaf name) collides
  # whenever two installs share a leaf dir name (e.g. two "./openldr" installs from
  # different parent paths on the same Docker host). Derive a name that is stable for
  # THIS install dir but unique across install dirs: leaf name + a short hash of the
  # resolved absolute path.
  RESOLVED_DIR="$(cd "$DIR" 2>/dev/null && pwd)"
  [ -n "$RESOLVED_DIR" ] || RESOLVED_DIR="$(pwd)/$DIR"
  LEAF="$(basename "$RESOLVED_DIR" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9_-]/-/g' -e 's/^-*//' -e 's/-*$//')"
  [ -n "$LEAF" ] || LEAF="openldr"
  LOWER_PATH="$(printf '%s' "$RESOLVED_DIR" | tr '[:upper:]' '[:lower:]')"
  if command -v md5sum >/dev/null 2>&1; then
    HASH="$(printf '%s' "$LOWER_PATH" | md5sum | cut -c1-8)"
  elif command -v md5 >/dev/null 2>&1; then
    HASH="$(printf '%s' "$LOWER_PATH" | md5 | cut -c1-8)"
  else
    HASH="$(printf '%s' "$LOWER_PATH" | cksum | cut -d' ' -f1)"
  fi
  PROJECT_NAME="${LEAF}-${HASH}"

  # Restrict before writing so the plaintext secrets are never briefly world-readable.
  ( umask 077; : > "$DIR/.env" )
  cat > "$DIR/.env" <<EOF
OPENLDR_VERSION=$VERSION
SERVER_NAME=$HOST
PUBLIC_ORIGIN=$ORIGIN
GATEWAY_HTTP_PORT=$HTTP_PORT
GATEWAY_HTTPS_PORT=$HTTPS_PORT
COMPOSE_PROJECT_NAME=$PROJECT_NAME
TLS_MODE=self-signed
PORT=3000
NODE_ENV=production
INTERNAL_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr
TARGET_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr_target
POSTGRES_PASSWORD=$PG_PW
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$S3_KEY
S3_SECRET_ACCESS_KEY=$S3_SECRET
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
OIDC_ISSUER_URL=$ORIGIN/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=$ORIGIN/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$KC_PW
SECRETS_ENCRYPTION_KEY=$SECRETS_KEY
MIGRATE_ON_START=true
SEED_ON_START=true
LETSENCRYPT_EMAIL=$LE_EMAIL
MARKETPLACE_REGISTRY_URL=https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main
EOF
  echo "→ Wrote $DIR/.env (generated secrets, compose project '$PROJECT_NAME')"
else
  echo "→ Reusing existing $DIR/.env"
fi

if [ ! -f "$DIR/config/nginx/certs/fullchain.pem" ]; then
  CERT_DIR="$DIR/config/nginx/certs"
  SUBJ="/CN=$HOST"
  SAN="subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1"
  if command -v openssl >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
      -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
      -subj "$SUBJ" -addext "$SAN" 2>/dev/null || true
  else
    # No local openssl — Docker is a prereq, so generate the cert via a throwaway container.
    echo "→ openssl not on PATH; generating cert via Docker (alpine/openssl)"
    CERT_DIR_ABS="$(cd "$CERT_DIR" && pwd)"
    docker run --rm -v "$CERT_DIR_ABS:/certs" alpine/openssl \
      req -x509 -newkey rsa:2048 -nodes -days 825 \
      -keyout /certs/privkey.pem -out /certs/fullchain.pem \
      -subj "$SUBJ" -addext "$SAN" >/dev/null 2>&1 || true
  fi
  if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "→ Generated self-signed cert"
  else
    echo "! Could not generate a self-signed cert — provide certs in $CERT_DIR/ (fullchain.pem + privkey.pem)."
  fi
fi

# 4. Start
if [ "$NO_START" -eq 1 ]; then
  echo "✓ Scaffolded $DIR (--no-start). Run: cd $DIR && docker compose up -d"
  exit 0
fi
cd "$DIR"
[ "$NO_PULL" -eq 1 ] || docker compose pull
docker compose up -d

# Let's Encrypt: the stack is up (nginx serving the http-01 webroot on :80). Issue a trusted cert,
# install it where the gateway reads it, reload, and wire up auto-renewal. Non-fatal: on failure the
# stack stays up on the self-signed cert.
if [ -n "$LE_EMAIL" ]; then
  echo "→ Requesting Let's Encrypt cert for $HOST ${LE_STAGING:+(staging)}..."
  # give nginx a moment to be ready to serve the challenge
  i=0; while [ "$i" -lt 12 ]; do curl -fsS -o /dev/null "http://localhost:$HTTP_PORT/.well-known/acme-challenge/" 2>/dev/null && break; i=$((i+1)); sleep 2; done
  if docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
       certonly --webroot -w /var/www/certbot -d "$HOST" --email "$LE_EMAIL" \
       --agree-tos --no-eff-email --keep-until-expiring --non-interactive ${LE_STAGING:+--staging}; then
    docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
      "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
    docker compose exec gateway nginx -s reload
    echo "✓ Trusted cert installed for $ORIGIN"
    ABS_DIR="$(pwd)"
    if [ "$(id -u)" = "0" ]; then
      printf '0 3,15 * * * root cd %s && sh renew-cert.sh >> /var/log/openldr-cert.log 2>&1\n' "$ABS_DIR" > /etc/cron.d/openldr-cert
      chmod 0644 /etc/cron.d/openldr-cert
      echo "→ Installed auto-renewal cron: /etc/cron.d/openldr-cert"
    else
      echo "! Not root — add this to your crontab (crontab -e) for auto-renewal:"
      echo "  0 3,15 * * * cd $ABS_DIR && sh renew-cert.sh >> /tmp/openldr-cert.log 2>&1"
    fi
  else
    echo "! Let's Encrypt issuance failed (DNS not pointing at this host yet? port 80 blocked?)."
    echo "  The stack is UP on the self-signed cert. Once DNS/ports are ready, re-run the installer"
    echo "  with the same --server-name $HOST --letsencrypt $LE_EMAIL to retry."
  fi
fi

echo ""
echo "✓ OpenLDR is starting. Open $ORIGIN"
echo "  Keycloak admin password: $(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2)"
if [ "$HTTP_PORT" != "80" ] || [ "$HTTPS_PORT" != "443" ]; then
  echo "  Gateway ports: HTTP $HTTP_PORT / HTTPS $HTTPS_PORT"
fi
echo ""
echo "  Public domain + trusted TLS in one shot:"
echo "    install.sh --server-name your.domain.com --letsencrypt you@email.com"
echo "  (add --staging first to test without hitting Let's Encrypt rate limits)"
echo "  Non-default ports: install.sh --http-port 8080 --https-port 8443"
