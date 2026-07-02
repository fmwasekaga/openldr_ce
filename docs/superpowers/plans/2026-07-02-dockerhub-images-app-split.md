# Docker Hub Images + api/studio Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split CE's single-origin app into independently-updatable `openldr-api` + `openldr-studio` images, add `openldr-web` + `openldr-gateway`, publish all four to Docker Hub `fmwasekaga/` via a local buildx script, and repoint the one-line installer to pull them.

**Architecture:** Four per-component Docker images. The server becomes API-only (no SPA staged — `app.ts` already skips SPA serving when `WEB_DIST_DIR`'s path is absent). The studio SPA (already built for `base: '/studio/'`, config fetched at runtime from `/api/config`) ships as a static nginx image. A gateway image bakes the split routing config. Both compose files mirror the split.

**Tech Stack:** Docker, docker buildx, nginx, pnpm/turbo monorepo, sh + PowerShell.

**Conventions (from repo memory + spec):**
- The DOCKER build works (unlike the server esbuild bundle); building images is the verification here.
- Work on local `main`; frequent commits; push to origin when the user wants a droplet test (these images ARE deploy-relevant — expect to push).
- Docker is available. Builds take minutes — that's expected.
- amd64-only; namespace `fmwasekaga`; version from root `package.json` (`0.1.0`).
- After the split, compose service names MUST be exactly `api`, `studio`, `web`, `keycloak` (nginx upstreams resolve them by name via Docker DNS).

---

## File Structure

- **Create** `apps/server/Dockerfile` — API-only image (root `Dockerfile` minus SPA staging + `WEB_DIST_DIR`).
- **Create** `apps/studio/Dockerfile` — static nginx serving the SPA under `/studio/`.
- **Create** `apps/studio/nginx.conf` — SPA serving + client-route fallback for the studio image.
- **Create** `deploy/nginx/Dockerfile` — gateway image baking `openldr.conf.template`.
- **Modify** `deploy/nginx/openldr.conf.template` — split routing (`web`/`studio`/`api` upstreams).
- **Delete** `Dockerfile` (combined root image) — repoint all references.
- **Modify** `docker-compose.prod.yml` — 4 split services (build-from-source; gateway stays stock nginx + mounted template).
- **Modify** `deploy/install/docker-compose.yml` — 4 `fmwasekaga/openldr-*` services + baked gateway image.
- **Modify** `install/install.sh`, `install/install.ps1` — stop downloading the nginx template (baked in).
- **Create** `scripts/build-and-push.sh`, `scripts/build-and-push.ps1` — buildx publish.
- **Modify** `package.json` — `publish:images` script.
- **Modify** `DEPLOYMENT.md` — document the 4 images + publish flow.

---

## Task 1: `openldr-api` Dockerfile (API-only)

**Files:**
- Create: `apps/server/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `apps/server/Dockerfile` (this is the current root `Dockerfile` with the SPA staging removed and `WEB_DIST_DIR` unset; the fixtures copy MUST stay):

```dockerfile
# syntax=docker/dockerfile:1
# openldr-api — the backend/API image (no SPA; the studio image serves the UI).
# ---- build: install, build the server, produce a standalone deploy ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/server
# pnpm deploy resolves the server's workspace deps into a self-contained dir (/deploy).
RUN pnpm --filter @openldr/server deploy --prod --legacy /deploy
# Bundled, license-safe terminology fixtures (FHIR R4 ValueSet catalog + full UCUM). @openldr/db
# resolves these at runtime relative to the server bundle (dist/../fixtures/fhir), but pnpm deploy
# carries only code, not packages/db's data dir — so stage them explicitly. Without this the
# first-boot seed logs "fixture missing" and coded form-fields come up with no terminology.
RUN mkdir -p /deploy/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy/fixtures/fhir/

# ---- runtime: slim node, non-root, API-only (no SPA — WEB_DIST_DIR unset) ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /deploy /app
# No WEB_DIST_DIR / no /app/web: app.ts guards SPA serving on existsSync(webDist), so with the
# default path absent the server runs API + /health only. The studio image owns the SPA.
RUN useradd --system --uid 10001 openldr && chown -R openldr /app
USER openldr
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the image**

Run: `docker build -f apps/server/Dockerfile -t openldr-api:test .`
Expected: builds successfully to the `runtime` stage (takes several minutes; the final image has `/app/dist/index.js`, `/app/node_modules`, `/app/fixtures/fhir/*.gz`, and NO `/app/web`).

- [ ] **Step 3: Verify it's API-only and serves /health**

The server needs config env to boot fully, but `/health` + the absence of the SPA can be checked. Run:

```bash
docker run --rm --name openldr-api-test -e PORT=3000 -d openldr-api:test
sleep 8
# SPA must NOT be staged in the image:
docker exec openldr-api-test sh -c 'test ! -e /app/web && echo NO_SPA_OK'
# fixtures must be present:
docker exec openldr-api-test sh -c 'ls /app/fixtures/fhir/*.gz >/dev/null 2>&1 && echo FIXTURES_OK'
docker stop openldr-api-test
```
Expected: prints `NO_SPA_OK` and `FIXTURES_OK`. (The server may log config/DB connection errors without a full env — that's fine; we're verifying image contents, not a live DB.)

- [ ] **Step 4: Commit**

```bash
git add apps/server/Dockerfile
git commit -m "feat(deploy): openldr-api image (API-only, no SPA)"
```

---

## Task 2: `openldr-studio` Dockerfile (static SPA under /studio/)

**Files:**
- Create: `apps/studio/Dockerfile`
- Create: `apps/studio/nginx.conf`

- [ ] **Step 1: Write the studio nginx config**

Create `apps/studio/nginx.conf` (serves the SPA at `/studio/` with client-route fallback; uses `root` not `alias` so `try_files` resolves reliably):

```nginx
server {
    listen 80;
    server_name _;

    # The SPA is built with Vite base '/studio/', so all asset URLs are /studio/...
    # dist is copied to /usr/share/nginx/html/studio, and root maps /studio/* → that dir.
    location /studio/ {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /studio/index.html;
    }

    # Container-local health (the gateway routes the app's /health to the api, not here).
    location = /healthz { return 200 "ok\n"; add_header Content-Type text/plain; }
}
```

- [ ] **Step 2: Write the Dockerfile**

Create `apps/studio/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# openldr-studio — the studio SPA as a static nginx site served under /studio/.
# ---- build the SPA (@openldr/studio, base '/studio/') ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/studio

# ---- serve the static site ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/studio/dist /usr/share/nginx/html/studio
COPY apps/studio/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: Build the image**

Run: `docker build -f apps/studio/Dockerfile -t openldr-studio:test .`
Expected: builds successfully; final image has `/usr/share/nginx/html/studio/index.html`.

- [ ] **Step 4: Verify it serves the SPA + deep-route fallback**

```bash
docker run --rm --name openldr-studio-test -p 8099:80 -d openldr-studio:test
sleep 2
# index served at /studio/:
curl -fsS http://localhost:8099/studio/ | grep -qi "<div id=\"root\"" && echo INDEX_OK
# deep client route falls back to index.html (SPA routing):
curl -fsS http://localhost:8099/studio/reports | grep -qi "<div id=\"root\"" && echo FALLBACK_OK
# a built asset is reachable under /studio/assets (grab one from the page):
ASSET=$(curl -fsS http://localhost:8099/studio/ | grep -oE '/studio/assets/[^"]+\.js' | head -1)
curl -fsS -o /dev/null -w "%{http_code}\n" "http://localhost:8099$ASSET"
docker stop openldr-studio-test
```
Expected: `INDEX_OK`, `FALLBACK_OK`, and the asset request prints `200`. (If the root div marker differs, grep for `<title>` or `type="module"` instead — inspect the served index once and adjust the grep to a stable string that's actually in `apps/studio/index.html`.)

- [ ] **Step 5: Commit**

```bash
git add apps/studio/Dockerfile apps/studio/nginx.conf
git commit -m "feat(deploy): openldr-studio static image (SPA under /studio/)"
```

---

## Task 3: `openldr-gateway` image + split routing

**Files:**
- Modify: `deploy/nginx/openldr.conf.template`
- Create: `deploy/nginx/Dockerfile`

- [ ] **Step 1: Split the routing in the template**

In `deploy/nginx/openldr.conf.template`, change the upstream `set` lines and the `location` blocks. Replace:

```nginx
    set $upstream_app     http://app:3000;
    set $upstream_landing http://landing:80;
    set $upstream_kc      http://keycloak:8080;
```
with:
```nginx
    set $upstream_web    http://web:80;
    set $upstream_studio http://studio:80;
    set $upstream_api    http://api:3000;
    set $upstream_kc     http://keycloak:8080;
```
and replace the location block:
```nginx
    location /         { proxy_pass $upstream_landing$request_uri; }
    location /studio   { proxy_pass $upstream_app$request_uri; }
    location /api      { proxy_pass $upstream_app$request_uri; }
    location = /health { proxy_pass $upstream_app/health; }
    location /auth     { proxy_pass $upstream_kc$request_uri; }
```
with:
```nginx
    location /          { proxy_pass $upstream_web$request_uri; }
    # Bare /studio (no trailing slash) must redirect to /studio/, else it proxies to the studio
    # container whose nginx only defines `location /studio/` → 404. The exact-match wins over the
    # prefix below for the bare case; everything under /studio/ hits the prefix and proxies through.
    location = /studio  { return 301 /studio/; }
    location /studio    { proxy_pass $upstream_studio$request_uri; }
    location /api       { proxy_pass $upstream_api$request_uri; }
    location = /health  { proxy_pass $upstream_api/health; }
    location /auth      { proxy_pass $upstream_kc$request_uri; }
```
Leave the `resolver 127.0.0.11 valid=30s ipv6=off;` line and everything else unchanged.

- [ ] **Step 2: Write the gateway Dockerfile**

Create `deploy/nginx/Dockerfile` (context is `deploy/nginx/`):

```dockerfile
# syntax=docker/dockerfile:1
# openldr-gateway — nginx reverse proxy with the OpenLDR routing baked in.
# The official nginx entrypoint runs envsubst on /etc/nginx/templates/*.template at start,
# so ${SERVER_NAME} is still substituted at runtime. TLS certs stay mounted (host-specific).
FROM nginx:1.27-alpine
COPY openldr.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80 443
```

- [ ] **Step 3: Build the gateway image**

Run: `docker build -f deploy/nginx/Dockerfile -t openldr-gateway:test deploy/nginx`
Expected: builds successfully.

- [ ] **Step 4: Verify the baked config renders to valid nginx**

Certs/upstreams aren't present standalone, so verify envsubst produces the template and nginx parses the templating step (the official entrypoint renders templates then `nginx -t` would need certs — instead assert the template was baked and renders):

```bash
docker run --rm -e SERVER_NAME=example.com openldr-gateway:test \
  sh -c 'envsubst "$(printf '"'"'${%s} '"'"' SERVER_NAME)" < /etc/nginx/templates/default.conf.template | grep -E "server_name example.com|upstream_studio http://studio:80|upstream_api http://api:3000|proxy_pass \$upstream_web"'
```
Expected: the grep prints the substituted `server_name example.com` line plus the `studio`/`api`/`web` upstream/route lines — confirming the split routing is baked and `${SERVER_NAME}` substitutes.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx/openldr.conf.template deploy/nginx/Dockerfile
git commit -m "feat(deploy): openldr-gateway image + split web/studio/api routing"
```

---

## Task 4: Split the source compose + delete the root Dockerfile

**Files:**
- Modify: `docker-compose.prod.yml`
- Delete: `Dockerfile`

- [ ] **Step 1: Replace the `app`/`landing`/`nginx` services**

In `docker-compose.prod.yml`, replace the `app:` service block and the `landing:` service block with three services `api`, `studio`, `web`, and rename `nginx:` → `gateway:` (keep it stock nginx + mounted template on the source/build path). The new service set:

```yaml
  api:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    env_file: .env.prod
    expose: ["3000"]
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
      keycloak: { condition: service_started }
    restart: unless-stopped

  studio:
    build:
      context: .
      dockerfile: apps/studio/Dockerfile
    expose: ["80"]
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    expose: ["80"]
    restart: unless-stopped

  gateway:
    image: nginx:1.27-alpine
    environment:
      SERVER_NAME: ${SERVER_NAME:-localhost}
    ports:
      - "${GATEWAY_HTTP_PORT:-80}:80"
      - "${GATEWAY_HTTPS_PORT:-443}:443"
    volumes:
      - ./deploy/nginx/openldr.conf.template:/etc/nginx/templates/default.conf.template:ro
      - ./deploy/nginx/certs:/etc/nginx/certs:ro
      - certbot-www:/var/www/certbot
    depends_on: ["api", "studio", "web", "keycloak"]
    restart: unless-stopped
```

Leave `certbot`, `postgres`, `minio`, `minio-init`, `keycloak`, and the `volumes:` section unchanged. Update the top-of-file comment that says `app (studio SPA + API)` to reflect the split (`api` + `studio` + `web`).

- [ ] **Step 2: Delete the combined root Dockerfile**

Run: `git rm Dockerfile`

- [ ] **Step 3: Repoint any other references to the root Dockerfile**

Run: `grep -rn "dockerfile: Dockerfile\|build: \.\|/Dockerfile\b" --include=*.yml --include=*.mjs --include=*.md --include=*.sh --include=*.ps1 . | grep -v apps/ | grep -v deploy/nginx | grep -v node_modules`
Expected: no remaining references to the deleted root `Dockerfile` (the `build: .` in `docker-compose.prod.yml` was replaced in Step 1). If any doc/script still references the combined build, update it to mention the split images.

- [ ] **Step 4: Validate the compose renders**

Run: `SERVER_NAME=localhost docker compose -f docker-compose.prod.yml config >/dev/null && echo COMPOSE_OK`
Expected: `COMPOSE_OK` (compose parses; services `api`/`studio`/`web`/`gateway` present, no `app`/`landing`). If it complains about a missing `.env.prod`, create an empty one first: `touch .env.prod` (do not commit it — it's gitignored).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "refactor(deploy): split prod compose into api/studio/web/gateway; drop root Dockerfile"
```

---

## Task 5: Repoint the installer compose to Docker Hub

**Files:**
- Modify: `deploy/install/docker-compose.yml`
- Modify: `install/install.sh`
- Modify: `install/install.ps1`

- [ ] **Step 1: Rewrite the pull-based services**

In `deploy/install/docker-compose.yml`, replace the header comment + the `app`/`landing`/`nginx` services with `api`/`studio`/`web`/`gateway` on Docker Hub images. New services:

```yaml
  api:
    image: fmwasekaga/openldr-api:${OPENLDR_VERSION:-latest}
    env_file: .env
    expose: ["3000"]
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
      keycloak: { condition: service_started }
    restart: unless-stopped

  studio:
    image: fmwasekaga/openldr-studio:${OPENLDR_VERSION:-latest}
    expose: ["80"]
    restart: unless-stopped

  web:
    image: fmwasekaga/openldr-web:${OPENLDR_VERSION:-latest}
    expose: ["80"]
    restart: unless-stopped

  gateway:
    image: fmwasekaga/openldr-gateway:${OPENLDR_VERSION:-latest}
    environment:
      SERVER_NAME: ${SERVER_NAME:-localhost}
    ports:
      - "${GATEWAY_HTTP_PORT:-80}:80"
      - "${GATEWAY_HTTPS_PORT:-443}:443"
    volumes:
      - ./config/nginx/certs:/etc/nginx/certs:ro
    depends_on: ["api", "studio", "web", "keycloak"]
    restart: unless-stopped
```

Note: NO nginx-template volume (baked into `openldr-gateway`); certs still mounted from `./config/nginx/certs`. Leave `postgres`/`minio`/`minio-init`/`keycloak`/`volumes` unchanged. Update the header comment (remove the "landing requires a published image / comment it out" note — it's published now).

- [ ] **Step 2: Trim the installer's nginx-template download**

In `install/install.sh`, the scaffold section fetches four files. Remove the nginx-template fetch line:

```sh
fetch "deploy/nginx/openldr.conf.template" "$DIR/config/nginx/openldr.conf.template"
```
Keep the `mkdir -p "$DIR/config/nginx/certs" "$DIR/config/keycloak"` (certs dir still needed) and the other three fetches (compose, realm, init-target-db.sql). Make the identical change in `install/install.ps1` (remove its corresponding `openldr.conf.template` download line; keep the certs dir + other downloads).

- [ ] **Step 3: Validate the installer compose renders**

Run:
```bash
cd deploy/install
printf 'SERVER_NAME=localhost\nOPENLDR_VERSION=latest\n' > .env
docker compose -f docker-compose.yml config >/dev/null && echo INSTALL_COMPOSE_OK
rm -f .env
cd ../..
```
Expected: `INSTALL_COMPOSE_OK` (parses; the `fmwasekaga/openldr-*` image refs are syntactically valid even though not yet pushed — `config` doesn't pull).

- [ ] **Step 4: Confirm the installer no longer references the template**

Run: `grep -n "openldr.conf.template" install/install.sh install/install.ps1`
Expected: no matches (the download lines are gone).

- [ ] **Step 5: Commit**

```bash
git add deploy/install/docker-compose.yml install/install.sh install/install.ps1
git commit -m "feat(deploy): installer pulls fmwasekaga/openldr-* from Docker Hub"
```

---

## Task 6: The buildx publish script

**Files:**
- Create: `scripts/build-and-push.sh`
- Create: `scripts/build-and-push.ps1`
- Modify: `package.json`

- [ ] **Step 1: Write the bash script**

Create `scripts/build-and-push.sh`:

```bash
#!/usr/bin/env bash
# Build and push the OpenLDR CE images to Docker Hub.
#   ./scripts/build-and-push.sh                      # fmwasekaga/*, :latest + :<version>, push
#   ./scripts/build-and-push.sh --registry myorg
#   ./scripts/build-and-push.sh --tag rc1
#   ./scripts/build-and-push.sh --platform linux/amd64,linux/arm64
#   ./scripts/build-and-push.sh --no-push            # build + load locally, don't push
#   ./scripts/build-and-push.sh --dry-run            # print commands only
# Must be run from the repo root.
set -euo pipefail

REGISTRY="${DOCKER_REGISTRY:-fmwasekaga}"
TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
DRY_RUN=false
PUSH=true

while [ $# -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --tag)      TAG="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --no-push)  PUSH=false; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    -h|--help)  echo "Usage: $0 [--registry <org>] [--tag <tag>] [--platform <p>] [--no-push] [--dry-run]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[ -f package.json ] && [ -d apps ] || { echo "ERROR: run from the repo root" >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"

OUT="--push"
[ "$PUSH" = true ] || OUT="--load"

run() { echo "+ $*"; [ "$DRY_RUN" = true ] || "$@"; }

# name -> "dockerfile context" (context defaults to repo root '.')
build_one() {
  name="$1"; dockerfile="$2"; context="$3"
  echo "--- $name ---"
  run docker buildx build --platform "$PLATFORM" \
    -t "$REGISTRY/$name:$TAG" -t "$REGISTRY/$name:$VERSION" \
    -f "$dockerfile" $OUT "$context"
}

echo "Registry=$REGISTRY  Tag=$TAG(+$VERSION)  Platform=$PLATFORM  Push=$PUSH  DryRun=$DRY_RUN"
build_one openldr-api     apps/server/Dockerfile .
build_one openldr-studio  apps/studio/Dockerfile .
build_one openldr-web     apps/web/Dockerfile    .
build_one openldr-gateway deploy/nginx/Dockerfile deploy/nginx
echo "Done. Images: $REGISTRY/openldr-{api,studio,web,gateway}:{$TAG,$VERSION}"
```

- [ ] **Step 2: Write the PowerShell script**

Create `scripts/build-and-push.ps1`:

```powershell
#!/usr/bin/env pwsh
# Build and push the OpenLDR CE images to Docker Hub (Windows).
#   ./scripts/build-and-push.ps1 [-Registry fmwasekaga] [-Tag latest] [-Platform linux/amd64] [-NoPush] [-DryRun]
param(
  [string]$Registry = "fmwasekaga",
  [string]$Tag = "latest",
  [string]$Platform = "linux/amd64",
  [switch]$NoPush,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path package.json) -or -not (Test-Path apps)) { throw "run from the repo root" }
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$Out = if ($NoPush) { "--load" } else { "--push" }

function Build-One($name, $dockerfile, $context) {
  Write-Host "--- $name ---"
  $args = @("buildx","build","--platform",$Platform,
            "-t","$Registry/$name`:$Tag","-t","$Registry/$name`:$Version",
            "-f",$dockerfile,$Out,$context)
  Write-Host "+ docker $($args -join ' ')"
  if (-not $DryRun) { & docker @args }
}

Write-Host "Registry=$Registry Tag=$Tag(+$Version) Platform=$Platform NoPush=$NoPush DryRun=$DryRun"
Build-One "openldr-api"     "apps/server/Dockerfile" "."
Build-One "openldr-studio"  "apps/studio/Dockerfile" "."
Build-One "openldr-web"     "apps/web/Dockerfile"    "."
Build-One "openldr-gateway" "deploy/nginx/Dockerfile" "deploy/nginx"
Write-Host "Done. Images: $Registry/openldr-{api,studio,web,gateway}:{$Tag,$Version}"
```

- [ ] **Step 3: Add the pnpm alias**

In `package.json`, add to `"scripts"`:

```json
    "publish:images": "bash scripts/build-and-push.sh",
```

- [ ] **Step 4: Verify the script's dry-run prints correct commands**

Run: `bash scripts/build-and-push.sh --dry-run`
Expected: prints four `docker buildx build --platform linux/amd64 -t fmwasekaga/openldr-<name>:latest -t fmwasekaga/openldr-<name>:0.1.0 -f <dockerfile> --push <context>` lines (api/studio/web from `.`, gateway from `deploy/nginx`), and executes nothing. Also test `--no-push --dry-run` shows `--load` instead of `--push`, and `--registry myorg --tag rc1` reflects in the tags.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-and-push.sh scripts/build-and-push.ps1 package.json
git commit -m "feat(deploy): buildx publish script for the four Docker Hub images"
```

---

## Task 7: Docs + integrated local verification

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Update DEPLOYMENT.md**

In `DEPLOYMENT.md`, update the section that describes the app image / root Dockerfile build to document the four images and the two paths. Add concrete content (adapt to the file's existing structure/headings):

```markdown
## Images

OpenLDR CE ships four independently-versioned images on Docker Hub:

| Image | Contents |
|-------|----------|
| `fmwasekaga/openldr-api` | server/API + `/health` (no SPA) |
| `fmwasekaga/openldr-studio` | studio SPA (static nginx, served under `/studio/`) |
| `fmwasekaga/openldr-web` | public landing site |
| `fmwasekaga/openldr-gateway` | nginx reverse proxy (routes `/`→web, `/studio`→studio, `/api`+`/health`→api, `/auth`→keycloak) |

Postgres, MinIO, and Keycloak use their stock upstream images.

### Publishing (maintainers)

```bash
docker login
pnpm run publish:images            # fmwasekaga/*, tags :latest + :<package.json version>, amd64
# or: ./scripts/build-and-push.sh --tag rc1 --no-push   # local build without pushing
```

### Two deploy paths

- **From source (`pnpm run init`)** builds the images locally via `docker-compose.prod.yml`.
- **One-line install** (`install/install.sh` | `.ps1`) PULLS the published images — no clone, no build.
```

Remove/replace any lingering DEPLOYMENT.md text that says the app is a single combined image built from the root `Dockerfile`.

- [ ] **Step 2: Integrated build of all four images (no push)**

Run: `bash scripts/build-and-push.sh --no-push`
Expected: all four images build and `--load` into the local docker (several minutes total). Confirm: `docker images | grep -E "fmwasekaga/openldr-(api|studio|web|gateway)"` shows all four with both `latest` and `0.1.0` tags.

- [ ] **Step 3: Bring up the source stack and curl through the gateway**

This is the real end-to-end proof (self-signed localhost). Run:

```bash
# minimal env for a localhost bring-up (adapt existing .env.prod.example if present):
cp .env.prod.example .env.prod 2>/dev/null || true
sh deploy/nginx/gen-selfsigned.sh localhost 2>/dev/null || true
SERVER_NAME=localhost docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr-split up -d --build
sleep 30
curl -ksS -o /dev/null -w "landing / -> %{http_code}\n"      https://localhost/
curl -ksS -o /dev/null -w "studio /studio/ -> %{http_code}\n" https://localhost/studio/
curl -ksS -o /dev/null -w "api /health -> %{http_code}\n"     https://localhost/health
curl -ksS -o /dev/null -w "auth /auth -> %{http_code}\n"      https://localhost/auth/realms/openldr/.well-known/openid-configuration
```
Expected: `/` → 200 (landing), `/studio/` → 200 (studio SPA), `/health` → 200 (api), `/auth/...` → 200 (keycloak). Tear down: `docker compose -p openldr-split down -v`.

If any route fails, check `docker compose -p openldr-split logs gateway` (routing) and confirm the service names match the nginx upstreams (`api`/`studio`/`web`).

- [ ] **Step 4: Commit docs**

```bash
git add DEPLOYMENT.md
git commit -m "docs(deploy): document the four Docker Hub images + publish flow"
```

- [ ] **Step 5: Final gate**

Confirm the working tree is clean except intended files, and the two composes still validate:
```bash
SERVER_NAME=localhost docker compose -f docker-compose.prod.yml config >/dev/null && echo PROD_OK
( cd deploy/install && printf 'SERVER_NAME=localhost\n' > .env && docker compose config >/dev/null && echo INSTALL_OK; rm -f .env )
```
Expected: `PROD_OK` and `INSTALL_OK`.

---

## Post-plan: publish + droplet test (user-driven)

After the plan is green locally, the maintainer publishes and the droplet pulls:
```bash
docker login && pnpm run publish:images         # push fmwasekaga/openldr-* to Docker Hub
# then the true one-line fresh install (no clone/build) pulls the images.
```
This push is the natural checkpoint for the user's fresh-install test.

## Self-Review notes (author)

- **Spec coverage:** A (four images) → Tasks 1-3,6; B (split) → Tasks 1-2,4; C (installer pulls) → Task 5; D (compose mirror) → Tasks 4-5; publish script → Task 6; server api-only → Task 1; studio base/fallback → Task 2; gateway baked routing → Task 3; delete root Dockerfile → Task 4; init reconciliation (source path unchanged) → Task 4 (gateway stays stock+mounted); docs → Task 7. All covered.
- **Service-name invariant:** the nginx upstreams (`web`/`studio`/`api`) require compose services named exactly that — enforced in Tasks 4 and 5.
- **No push in the plan:** Tasks build/verify locally; the actual Docker Hub push is a user-driven post-plan step (needs `docker login`).
- **Verify-then-adjust points:** Task 2 Step 4 grep string (match a stable marker in the real `apps/studio/index.html`); Task 7 Step 3 env bring-up (adapt to the real `.env.prod.example` + `gen-selfsigned.sh`).
