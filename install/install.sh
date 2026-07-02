#!/usr/bin/env sh
# OpenLDR CE one-line installer (Linux/macOS).
#   curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/install.sh | bash
# Flags: --dir <path> (default ./openldr), --version <tag> (default latest),
#        --no-start (scaffold + config only), --no-pull (skip image pull).
set -eu

REPO_RAW="https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main"
DIR="./openldr"
VERSION="latest"
NO_START=0
NO_PULL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --no-start) NO_START=1; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

err() { echo "✗ $1" >&2; exit 1; }

# 1. Preflight
command -v docker >/dev/null 2>&1 || err "Docker is not installed. See https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || err "Docker Compose plugin not found. Update Docker Desktop or install docker-compose-plugin."
docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker and retry."

# 2. Scaffold
echo "→ Scaffolding $DIR"
mkdir -p "$DIR/config/nginx/certs" "$DIR/config/keycloak"
fetch() { curl -fsSL "$REPO_RAW/$1" -o "$2" || err "failed to download $1"; }
fetch "deploy/install/docker-compose.yml" "$DIR/docker-compose.yml"
fetch "deploy/nginx/openldr.conf.template" "$DIR/config/nginx/openldr.conf.template"
fetch "infra/keycloak/openldr-realm.json" "$DIR/config/keycloak/openldr-realm.json"
fetch "scripts/init-target-db.sql" "$DIR/config/init-target-db.sql"

# 3. Secrets + cert (only on first run — never overwrite an existing .env)
# Read a bounded block of /dev/urandom (not an unbounded stream) and take the
# first 24 alnum chars with cut — cut consumes all of its input, so no early
# pipe close can SIGPIPE an upstream reader even under `set -o pipefail`.
rand() { head -c 3072 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24; }
if [ ! -f "$DIR/.env" ]; then
  PG_PW="$(rand)"; KC_PW="$(rand)"; S3_KEY="$(rand)"; S3_SECRET="$(rand)"
  SECRETS_KEY="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '\n')"
  # Restrict before writing so the plaintext secrets are never briefly world-readable.
  ( umask 077; : > "$DIR/.env" )
  cat > "$DIR/.env" <<EOF
OPENLDR_VERSION=$VERSION
SERVER_NAME=localhost
PUBLIC_ORIGIN=https://localhost
GATEWAY_HTTP_PORT=80
GATEWAY_HTTPS_PORT=443
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
OIDC_ISSUER_URL=https://localhost/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=https://localhost/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$KC_PW
SECRETS_ENCRYPTION_KEY=$SECRETS_KEY
SEED_ON_START=true
MARKETPLACE_REGISTRY_URL=https://raw.githubusercontent.com/fmwasekaga/openldr-ce-marketplace/main
EOF
  echo "→ Wrote $DIR/.env (generated secrets)"
else
  echo "→ Reusing existing $DIR/.env"
fi

if [ ! -f "$DIR/config/nginx/certs/fullchain.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$DIR/config/nginx/certs/privkey.pem" \
    -out "$DIR/config/nginx/certs/fullchain.pem" \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null \
    && echo "→ Generated self-signed cert" || echo "! openssl not found — provide certs in $DIR/config/nginx/certs/"
fi

# 4. Start
if [ "$NO_START" -eq 1 ]; then
  echo "✓ Scaffolded $DIR (--no-start). Run: cd $DIR && docker compose up -d"
  exit 0
fi
cd "$DIR"
[ "$NO_PULL" -eq 1 ] || docker compose pull
docker compose up -d
echo ""
echo "✓ OpenLDR is starting. Open https://localhost"
echo "  Keycloak admin password: $(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2)"
echo ""
echo "  Tip: for a non-localhost host (IP/domain) or Let's Encrypt TLS, run"
echo "  'pnpm run init' from source, or edit SERVER_NAME / PUBLIC_ORIGIN /"
echo "  OIDC_ISSUER_URL / KC_HOSTNAME / TLS_MODE in .env and re-run:"
echo "  docker compose up -d"
