#!/usr/bin/env sh
# OpenLDR CE developer bootstrap (Linux/macOS): clone + install + backing services + DB.
# For running from SOURCE while the published images aren't available yet.
#   curl -fsSL https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install/development.sh | bash
# Flags:
#   --dir <path>     where to clone (default ./openldr_ce)
#   --branch <name>  branch to clone (default main)
#   --seed           also load WHONET sample data (needs the wasm build toolchain)
#   --reset-db       force a db reset even on an existing setup (DESTRUCTIVE)
#   --no-services    just clone + install; skip Docker + DB
set -eu

REPO_URL="https://github.com/fmwasekaga/openldr_ce.git"
DIR="./openldr_ce"
BRANCH="main"
SEED=0
RESET_DB=0
NO_SERVICES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --seed) SEED=1; shift ;;
    --reset-db) RESET_DB=1; shift ;;
    --no-services) NO_SERVICES=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

err() { echo "✗ $1" >&2; exit 1; }

# 1. Preflight
command -v git >/dev/null 2>&1 || err "git is not installed."
command -v node >/dev/null 2>&1 || err "Node.js >=20 is not installed. See https://nodejs.org/"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || err "Node.js >=20 required (found $(node -v))."
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "→ Enabling pnpm via corepack"
    corepack enable >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 || err "pnpm not found. See https://pnpm.io/installation (or run: corepack enable)."
fi
if [ "$NO_SERVICES" -eq 0 ]; then
  command -v docker >/dev/null 2>&1 || err "Docker is not installed (needed for backing services). Use --no-services to skip."
  docker compose version >/dev/null 2>&1 || err "Docker Compose plugin not found. Update Docker Desktop or install docker-compose-plugin."
  docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker and retry."
fi

# 2. Clone (or reuse an existing checkout)
if [ -f package.json ] && node -e 'process.exit(require("./package.json").name==="openldr"?0:1)' 2>/dev/null; then
  echo "→ Running inside an existing openldr checkout — skipping clone"
  REPO_DIR="$(pwd)"
elif [ -d "$DIR/.git" ]; then
  echo "→ Reusing existing clone at $DIR"
  REPO_DIR="$DIR"
else
  echo "→ Cloning $REPO_URL ($BRANCH) into $DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR" || err "git clone failed"
  REPO_DIR="$DIR"
fi
cd "$REPO_DIR"

# 3. Install workspace dependencies
echo "→ pnpm install"
pnpm install || err "pnpm install failed"

# 4. .env — dev bypass so the app is usable without configuring Keycloak SSO.
#    .env.example already sets NODE_ENV=development; we only add AUTH_DEV_BYPASS.
FRESH_ENV=0
if [ ! -f .env ]; then
  cp .env.example .env
  printf '\n# --- added by development.sh: no-login dev mode (remove to use real Keycloak) ---\nAUTH_DEV_BYPASS=true\n' >> .env
  FRESH_ENV=1
  echo "→ Wrote .env (dev bypass enabled — loads as a dev admin)"
else
  echo "→ Reusing existing .env"
fi

if [ "$NO_SERVICES" -eq 1 ]; then
  echo "→ Skipping Docker services + DB (--no-services)"
else
  # 5. Backing services (dev docker-compose.yml: postgres, minio, keycloak)
  echo "→ Starting backing services (postgres, minio, keycloak)"
  docker compose up -d || err "docker compose up failed"

  # 6. DB init — only on a fresh setup so a re-run never wipes data; --reset-db forces it.
  if [ "$FRESH_ENV" -eq 1 ] || [ "$RESET_DB" -eq 1 ]; then
    echo "→ Waiting for Postgres to be ready…"
    i=0
    while [ "$i" -lt 30 ]; do
      docker compose exec -T postgres pg_isready -U openldr >/dev/null 2>&1 && break
      i=$((i + 1)); sleep 2
    done
    echo "→ Resetting the database (pnpm openldr db reset)"
    pnpm openldr db reset || err "db reset failed"
    if [ "$SEED" -eq 1 ]; then
      echo "→ Seeding WHONET sample data (pnpm e2e:seed)"
      pnpm e2e:seed || err "seed failed"
    fi
  else
    echo "→ Skipping db reset (existing setup; pass --reset-db to wipe & re-init)"
  fi
fi

# 7. Next steps
cat <<EOF

✓ Dev environment ready in $REPO_DIR
Start the app in two terminals:
  1) pnpm -C apps/server dev      # API on http://localhost:3000
  2) pnpm -C apps/studio dev      # Studio UI on http://localhost:5173 (proxies /api → :3000)
Backing services: Postgres :5433 · MinIO :9010/:9011 · Keycloak :8180
Auth: AUTH_DEV_BYPASS is on (loads as a dev admin). Edit .env to use real Keycloak.
EOF
