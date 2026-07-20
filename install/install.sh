#!/usr/bin/env sh
# OpenLDR CE one-line installer (Linux/macOS).
#   curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
# Flags: --dir <path> (default ./openldr), --version <tag> (default latest),
#        --server-name <host> (default localhost — the public hostname/domain),
#        --http-port <n> (default 80), --https-port <n> (default 443 — gateway ports),
#        --letsencrypt <email> (issue a trusted Let's Encrypt cert for --server-name),
#        --staging (use the LE staging CA — for testing, avoids rate limits),
#        --no-start (scaffold + config only), --no-pull (skip image pull).
#        --target-db postgres|mssql|mysql (default postgres — selects the external analytics/target DB),
#        --mssql-demo (spin up a bundled MSSQL container for evaluation; implies --target-db mssql),
#        --mssql-host/--mssql-port/--mssql-database/--mssql-user/--mssql-password (BYO MSSQL
#          connection — required when --target-db mssql without --mssql-demo; keep the password
#          free of '#', spaces, or quote characters — they confuse Docker Compose's .env reader),
#        --mssql-encrypt true|false (default false), --mssql-trust-cert true|false (default true).
#        --mysql-demo (spin up a bundled MySQL container for evaluation; implies --target-db mysql),
#        --mysql-host/--mysql-port/--mysql-database/--mysql-user/--mysql-password (BYO MySQL
#          connection — required when --target-db mysql without --mysql-demo; keep the password
#          free of '#', spaces, or quote characters — they confuse Docker Compose's .env reader),
#        --mysql-ssl true|false (default false).
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
TARGET_DB="postgres"
MSSQL_DEMO=0
MSSQL_HOST=""
MSSQL_PORT="1433"
MSSQL_DATABASE="openldr_target"
MSSQL_USER=""
MSSQL_PASSWORD=""
MSSQL_ENCRYPT="false"
MSSQL_TRUST_CERT="true"
MYSQL_DEMO=0
MYSQL_HOST=""
MYSQL_PORT="3306"
MYSQL_DATABASE="openldr_target"
MYSQL_USER=""
MYSQL_PASSWORD=""
MYSQL_SSL="false"

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
    --target-db) TARGET_DB="$2"; shift 2 ;;
    --mssql-demo) MSSQL_DEMO=1; TARGET_DB="mssql"; shift ;;
    --mssql-host) MSSQL_HOST="$2"; shift 2 ;;
    --mssql-port) MSSQL_PORT="$2"; shift 2 ;;
    --mssql-database) MSSQL_DATABASE="$2"; shift 2 ;;
    --mssql-user) MSSQL_USER="$2"; shift 2 ;;
    --mssql-password) MSSQL_PASSWORD="$2"; shift 2 ;;
    --mssql-encrypt) MSSQL_ENCRYPT="$2"; shift 2 ;;
    --mssql-trust-cert) MSSQL_TRUST_CERT="$2"; shift 2 ;;
    --mysql-demo) MYSQL_DEMO=1; TARGET_DB="mysql"; shift ;;
    --mysql-host) MYSQL_HOST="$2"; shift 2 ;;
    --mysql-port) MYSQL_PORT="$2"; shift 2 ;;
    --mysql-database) MYSQL_DATABASE="$2"; shift 2 ;;
    --mysql-user) MYSQL_USER="$2"; shift 2 ;;
    --mysql-password) MYSQL_PASSWORD="$2"; shift 2 ;;
    --mysql-ssl) MYSQL_SSL="$2"; shift 2 ;;
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
  EXISTING_ADAPTER="$(grep -E '^TARGET_STORE_ADAPTER=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  if [ "$EXISTING_ADAPTER" = "mssql" ]; then
    TARGET_DB="mssql"
    EXISTING_MSSQL_HOST="$(grep -E '^MSSQL_HOST=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -n "$EXISTING_MSSQL_HOST" ] && MSSQL_HOST="$EXISTING_MSSQL_HOST"
    # host 'mssql' is the managed-demo signature → re-enable the overlay on re-runs
    [ "$EXISTING_MSSQL_HOST" = "mssql" ] && MSSQL_DEMO=1
  fi
  if [ "$EXISTING_ADAPTER" = "mysql" ]; then
    TARGET_DB="mysql"
    EXISTING_MYSQL_HOST="$(grep -E '^MYSQL_HOST=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -n "$EXISTING_MYSQL_HOST" ] && MYSQL_HOST="$EXISTING_MYSQL_HOST"
    # host 'mysql' is the managed-demo signature → re-enable the overlay on re-runs
    [ "$EXISTING_MYSQL_HOST" = "mysql" ] && MYSQL_DEMO=1
  fi
fi
if [ "$HTTPS_PORT" = "443" ]; then
  ORIGIN="https://$HOST"
else
  ORIGIN="https://$HOST:$HTTPS_PORT"
fi

err() { echo "✗ $1" >&2; exit 1; }

if [ "$TARGET_DB" != "postgres" ] && [ "$TARGET_DB" != "mssql" ] && [ "$TARGET_DB" != "mysql" ]; then
  echo "✗ --target-db must be 'postgres', 'mssql', or 'mysql' (got '$TARGET_DB')" >&2; exit 2
fi

for bv in "mssql-encrypt=$MSSQL_ENCRYPT" "mssql-trust-cert=$MSSQL_TRUST_CERT" "mysql-ssl=$MYSQL_SSL"; do
  bname="${bv%%=*}"; bval="${bv#*=}"
  if [ "$bval" != "true" ] && [ "$bval" != "false" ]; then
    echo "✗ --$bname must be 'true' or 'false' (got '$bval')" >&2; exit 2
  fi
done

# Managed-demo MSSQL: point the app at the bundled 'mssql' compose service and (below) generate a
# policy-compliant SA password. Developer/Express editions are NOT licensed for production — this
# container is for evaluation only.
if [ "$MSSQL_DEMO" -eq 1 ]; then
  MSSQL_HOST="mssql"
  MSSQL_PORT="1433"
  MSSQL_DATABASE="openldr_target"
  MSSQL_USER="sa"
  MSSQL_ENCRYPT="false"
  MSSQL_TRUST_CERT="true"
fi

# Managed-demo MySQL: point the app at the bundled 'mysql' compose service and (below) generate a
# root password. For evaluation only.
if [ "$MYSQL_DEMO" -eq 1 ]; then
  MYSQL_HOST="mysql"
  MYSQL_PORT="3306"
  MYSQL_DATABASE="openldr_target"
  MYSQL_USER="root"
  MYSQL_SSL="false"
fi

# BYO MSSQL: require connection details before writing .env / starting the stack.
# Fresh install only — on a re-run the never-overwritten on-disk .env is authoritative,
# so don't demand flags the operator already provided the first time.
if [ "$ENV_EXISTS" -eq 0 ] && [ "$TARGET_DB" = "mssql" ] && [ "$MSSQL_DEMO" -eq 0 ]; then
  for pair in "MSSQL_HOST=$MSSQL_HOST" "MSSQL_USER=$MSSQL_USER" "MSSQL_PASSWORD=$MSSQL_PASSWORD"; do
    key="${pair%%=*}"; val="${pair#*=}"
    [ -n "$val" ] || err "--target-db mssql (BYO) requires --mssql-host, --mssql-user, and --mssql-password (missing $key). The target database '$MSSQL_DATABASE' must already exist on your SQL Server."
  done
fi

# BYO MySQL: require connection details before writing .env / starting the stack.
# Fresh install only — on a re-run the never-overwritten on-disk .env is authoritative,
# so don't demand flags the operator already provided the first time.
if [ "$ENV_EXISTS" -eq 0 ] && [ "$TARGET_DB" = "mysql" ] && [ "$MYSQL_DEMO" -eq 0 ]; then
  for pair in "MYSQL_HOST=$MYSQL_HOST" "MYSQL_USER=$MYSQL_USER" "MYSQL_PASSWORD=$MYSQL_PASSWORD"; do
    key="${pair%%=*}"; val="${pair#*=}"
    [ -n "$val" ] || err "--target-db mysql (BYO) requires --mysql-host, --mysql-user, and --mysql-password (missing $key). The target database '$MYSQL_DATABASE' must already exist on your MySQL/MariaDB server."
  done
fi

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
fetch "scripts/init-keycloak-db.sql" "$DIR/config/init-keycloak-db.sql"
fetch "deploy/install/renew-cert.sh" "$DIR/renew-cert.sh"
chmod +x "$DIR/renew-cert.sh" 2>/dev/null || true
if [ "$MSSQL_DEMO" -eq 1 ]; then
  fetch "deploy/install/docker-compose.mssql.yml" "$DIR/docker-compose.mssql.yml"
  fetch "scripts/init-target-db-mssql.sql" "$DIR/config/init-target-db-mssql.sql"
fi
if [ "$MYSQL_DEMO" -eq 1 ]; then
  fetch "deploy/install/docker-compose.mysql.yml" "$DIR/docker-compose.mysql.yml"
  fetch "scripts/init-target-db-mysql.sql" "$DIR/config/init-target-db-mysql.sql"
fi

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

# Pin the openldr-admin service-account secret in the realm import to a per-install value. The
# committed realm ships a well-known dev secret ("openldr-admin-dev-secret") that a real deployment
# must not use; without a matching KEYCLOAK_ADMIN_CLIENT_SECRET in .env the server's identity-admin
# actions (Distributed Sync site enrollment, password reset, force sign-out) fail with a 503. Generate
# one — reusing the existing .env value on a re-run so the on-disk import stays consistent with what the
# app authenticates with — substitute it into the realm import, and write it to .env below.
if [ -f "$DIR/.env" ] && grep -q '^KEYCLOAK_ADMIN_CLIENT_SECRET=' "$DIR/.env"; then
  KC_ADMIN_SECRET="$(grep '^KEYCLOAK_ADMIN_CLIENT_SECRET=' "$DIR/.env" | cut -d= -f2-)"
else
  KC_ADMIN_SECRET="$(rand)"
fi
sed "s|\"openldr-admin-dev-secret\"|\"$KC_ADMIN_SECRET\"|" "$REALM" > "$REALM.tmp" && mv "$REALM.tmp" "$REALM"

# Same per-install treatment for the seeded human `labadmin` user. The committed realm ships the
# well-known "labadmin" password (marked temporary → forced change on first login); a real deployment
# must not import that guessable credential. Generate a per-install password — reusing the existing
# .env value on a re-run so the on-disk import stays consistent — substitute it into the CREDENTIAL
# value (the "username": "labadmin" line does not match this pattern), and surface it below.
if [ -f "$DIR/.env" ] && grep -q '^INITIAL_LAB_ADMIN_PASSWORD=' "$DIR/.env"; then
  LABADMIN_PW="$(grep '^INITIAL_LAB_ADMIN_PASSWORD=' "$DIR/.env" | cut -d= -f2-)"
else
  LABADMIN_PW="$(rand)"
fi
sed "s|\"value\": \"labadmin\"|\"value\": \"$LABADMIN_PW\"|" "$REALM" > "$REALM.tmp" && mv "$REALM.tmp" "$REALM"

if [ ! -f "$DIR/.env" ]; then
  PG_PW="$(rand)"; KC_PW="$(rand)"; S3_KEY="$(rand)"; S3_SECRET="$(rand)"
  if [ "$MSSQL_DEMO" -eq 1 ] && [ -z "$MSSQL_PASSWORD" ]; then MSSQL_PASSWORD="$(rand)Aa1!"; fi
  if [ "$MYSQL_DEMO" -eq 1 ] && [ -z "$MYSQL_PASSWORD" ]; then MYSQL_PASSWORD="$(rand)Aa1"; fi
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
  if [ "$TARGET_DB" = "mssql" ]; then
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=$MSSQL_HOST
MSSQL_PORT=$MSSQL_PORT
MSSQL_DATABASE=$MSSQL_DATABASE
MSSQL_USER=$MSSQL_USER
MSSQL_PASSWORD=$MSSQL_PASSWORD
MSSQL_ENCRYPT=$MSSQL_ENCRYPT
MSSQL_TRUST_SERVER_CERT=$MSSQL_TRUST_CERT"
  elif [ "$TARGET_DB" = "mysql" ]; then
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=mysql
MYSQL_HOST=$MYSQL_HOST
MYSQL_PORT=$MYSQL_PORT
MYSQL_DATABASE=$MYSQL_DATABASE
MYSQL_USER=$MYSQL_USER
MYSQL_PASSWORD=$MYSQL_PASSWORD
MYSQL_SSL=$MYSQL_SSL"
  else
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr_target"
  fi
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
# One reverse-proxy hop (the gateway) fronts the app: trust its X-Forwarded-For so req.ip and the
# auth.failed audit record the real client, not the gateway's container IP.
TRUST_PROXY=1
INTERNAL_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr
$TARGET_DB_ENV_BLOCK
POSTGRES_PASSWORD=$PG_PW
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$S3_KEY
S3_SECRET_ACCESS_KEY=$S3_SECRET
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
OIDC_ISSUER_URL=$ORIGIN/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=$ORIGIN/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$KC_PW
KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=$KC_ADMIN_SECRET
INITIAL_LAB_ADMIN_PASSWORD=$LABADMIN_PW
TLS_CERT_PATH=/etc/openldr/tls-cert.pem
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
COMPOSE_FILES="-f docker-compose.yml"
[ "$MSSQL_DEMO" -eq 1 ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.mssql.yml"
[ "$MYSQL_DEMO" -eq 1 ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.mysql.yml"
[ "$NO_PULL" -eq 1 ] || docker compose $COMPOSE_FILES pull
docker compose $COMPOSE_FILES up -d

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
echo "  App sign-in: labadmin / $(grep '^INITIAL_LAB_ADMIN_PASSWORD=' .env | cut -d= -f2-)  (change it on first login)"
if [ "$MSSQL_DEMO" -eq 1 ]; then
  echo "  MSSQL (demo) SA password: $(grep '^MSSQL_PASSWORD=' .env | cut -d= -f2-)"
  echo "  ⚠ The demo SQL Server container is for evaluation only — not licensed for production."
fi
if [ "$MYSQL_DEMO" -eq 1 ]; then
  echo "  MySQL (demo) root password: $(grep '^MYSQL_PASSWORD=' .env | cut -d= -f2-)"
fi
if [ "$HTTP_PORT" != "80" ] || [ "$HTTPS_PORT" != "443" ]; then
  echo "  Gateway ports: HTTP $HTTP_PORT / HTTPS $HTTPS_PORT"
fi
echo "  Distributed Sync: identity-admin client provisioned (unique secret in .env) — site enrollment is ready."
echo ""
echo "  Public domain + trusted TLS in one shot:"
echo "    install.sh --server-name your.domain.com --letsencrypt you@email.com"
echo "  (add --staging first to test without hitting Let's Encrypt rate limits)"
echo "  Non-default ports: install.sh --http-port 8080 --https-port 8443"
