# Production Single-Port Deployment (P1-NFR-7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) — the deliverables are config + docs (Dockerfile, nginx, compose, env, markdown), not TDD-able feature code, except Task 1 which is a small TDD'd server change. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A deployable single-HTTPS-port stack — app container behind a thin nginx TLS reverse proxy, a production compose with the backing services, and deployment docs.

**Architecture:** The fastify server already serves the SPA + API + auth on one port. Containerize it (multi-stage `pnpm deploy` image), put nginx in front for TLS + reverse-proxy-all, wire `docker-compose.prod.yml` (app + nginx + postgres + minio + keycloak), and document it. Make the server's SPA-dist path env-configurable so the container layout is robust.

**Tech Stack:** Docker multi-stage, pnpm@11.5.2, Node 22, nginx 1.27-alpine, fastify, openssl (self-signed TLS). Spec: `docs/superpowers/specs/2026-06-22-production-single-port-deployment-design.md`.

**Conventions:**
- Existing gate must stay green: `pnpm turbo typecheck lint test build && pnpm depcruise` (config/docs files aren't in the TS/depcruise graph; only Task 1 touches code).
- The `docker build` + live smoke are **user-run** if Docker isn't available in the implementation environment — mark them so, deliver complete artifacts.
- Commit after every task.

---

### Task 1: Make the SPA-dist path env-configurable (`WEB_DIST_DIR`)

**Files:**
- Modify: `apps/server/src/app.ts`, `apps/server/src/app.test.ts`

- [ ] **Step 1: Write the failing test** — add to `app.test.ts`:

```ts
import { existsSync } from 'node:fs';
// (existing imports…)

it('uses WEB_DIST_DIR for the SPA root when set', () => {
  // The static-serving block only registers when the dir exists; assert the resolver
  // honors the env override by checking the resolved path via a small exported helper.
  // (If app.ts exposes no helper, assert behavior through env: set WEB_DIST_DIR to a temp
  //  dir with an index.html and confirm GET / serves it.)
});
```
Concretely (no new export needed): make the test set `process.env.WEB_DIST_DIR` to a temp dir containing an `index.html`, build the app, and assert `GET /` returns that HTML. Mirror the existing app.test harness (`ctxWith`, `buildApp`/`registerRoutes` — match the real construction the file uses). Clean up the env in `afterEach`.

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @openldr/server test -- --run src/app.test.ts`

- [ ] **Step 3: Implement** — in `app.ts`, change the static-dist resolution:

```ts
const webDist = process.env.WEB_DIST_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
```
(Everything else — the `existsSync(webDist)` guard, `fastifyStatic`, the SPA `setNotFoundHandler` — unchanged. Default behavior is identical to today when the env is unset, so all existing tests stay green.)

- [ ] **Step 4: Run, expect PASS** + server typecheck.

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "feat(server): WEB_DIST_DIR override for the SPA static root (deploy robustness)"
```

---

### Task 2: App `Dockerfile` + `.dockerignore`

**Files:**
- Create: `Dockerfile`, `.dockerignore` (repo root)

- [ ] **Step 1: Create `.dockerignore`**
```
node_modules
**/node_modules
**/dist
.turbo
.git
.worktrees
e2e/artifacts
e2e/test-results
playwright-report
test-results
scripts/.marketplace-keys
deploy/nginx/certs
*.tsbuildinfo
.env
.env.*
!.env.prod.example
```

- [ ] **Step 2: Create `Dockerfile` (multi-stage)**
```dockerfile
# syntax=docker/dockerfile:1
# ---- build: install + build web + server, then produce a standalone server deploy ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/web --filter @openldr/server
# pnpm deploy resolves the server's workspace deps into a self-contained dir.
RUN pnpm --filter @openldr/server deploy --prod /deploy
# Stage the built SPA where WEB_DIST_DIR will point (decoupled from the server dist layout).
RUN mkdir -p /deploy/web && cp -r apps/web/dist/* /deploy/web/

# ---- runtime: slim node, non-root, serve single-origin ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=build /deploy /app
# /app/dist/index.js (server entry from pnpm deploy), /app/node_modules, /app/web (SPA)
RUN useradd --system --uid 10001 openldr && chown -R openldr /app
USER openldr
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```
NOTE (verify during build): `pnpm deploy` copies the server package root to `/deploy`, so the server entry lands at `/deploy/dist/index.js` (the package's `build` outputs `dist/`). Confirm the entry path — if `pnpm deploy` places it elsewhere (e.g. `/deploy/apps/server/dist`), adjust the `CMD` + the COPY/layout accordingly. `WEB_DIST_DIR=/app/web` decouples the SPA from the server-dist relative path (Task 1), so wherever the entry sits, the SPA is found. **Fallback if `pnpm deploy` is problematic with the tsup bundle:** in the runtime stage `COPY --from=build /repo /app` then `RUN pnpm install --prod --frozen-lockfile` — heavier image but reliable; the plan's executor picks whichever `docker build`s + runs cleanly.

- [ ] **Step 3: Verify** — `docker build -t openldr-ce:local .` succeeds (USER-RUN if Docker unavailable here — if so, note it and proceed; the file is still committed).

- [ ] **Step 4: Commit**
```bash
git add Dockerfile .dockerignore
git commit -m "feat(deploy): app Dockerfile (multi-stage) + dockerignore"
```

---

### Task 3: nginx reverse-proxy config + self-signed cert script

**Files:**
- Create: `deploy/nginx/openldr.conf.template`, `deploy/nginx/gen-selfsigned.sh`

- [ ] **Step 1: Create `deploy/nginx/openldr.conf.template`** (nginx image runs `envsubst` on `*.template` → conf):
```nginx
# 80 → 443 redirect
server {
    listen 80;
    server_name ${SERVER_NAME};
    return 301 https://$host$request_uri;
}

# TLS-terminating reverse proxy → the single fastify app (serves SPA + /api + auth).
server {
    listen 443 ssl;
    server_name ${SERVER_NAME};

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 50m;          # plugin/bundle/ingest uploads
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;   # ws future-proof
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
    }
}
```

- [ ] **Step 2: Create `deploy/nginx/gen-selfsigned.sh`**
```sh
#!/usr/bin/env sh
# Generate a self-signed cert for local/demo TLS. For production use Let's Encrypt/certbot
# and drop fullchain.pem + privkey.pem into deploy/nginx/certs/ instead.
set -eu
DIR="$(dirname "$0")/certs"
CN="${1:-localhost}"
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
  -subj "/CN=$CN" -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1"
echo "wrote $DIR/fullchain.pem + privkey.pem (CN=$CN)"
```
Make it executable (`git update-index --chmod=+x` or `chmod +x` before add).

- [ ] **Step 3: Commit**
```bash
git add deploy/nginx/openldr.conf.template deploy/nginx/gen-selfsigned.sh
git commit -m "feat(deploy): nginx TLS reverse-proxy template + self-signed cert script"
```

---

### Task 4: `docker-compose.prod.yml` + env example + gitignore

**Files:**
- Create: `docker-compose.prod.yml`, `.env.prod.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `docker-compose.prod.yml`**
```yaml
# Single-HTTPS-port production stack: nginx (TLS) → app (SPA + API + auth) + backing services.
# Usage: cp .env.prod.example .env.prod && edit; sh deploy/nginx/gen-selfsigned.sh;
#        docker compose -f docker-compose.prod.yml up -d --build
services:
  app:
    build: .
    env_file: .env.prod
    expose: ["3000"]
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_started }
      keycloak: { condition: service_started }
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    environment:
      SERVER_NAME: ${SERVER_NAME:-localhost}
    ports: ["80:80", "443:443"]
    volumes:
      - ./deploy/nginx/openldr.conf.template:/etc/nginx/templates/openldr.conf.template:ro
      - ./deploy/nginx/certs:/etc/nginx/certs:ro
    depends_on: ["app"]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: openldr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openldr}
      POSTGRES_DB: openldr
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openldr"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    command: server /data --console-address ':9001'
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:-minioadmin}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:-minioadmin}
    volumes:
      - miniodata:/data
    restart: unless-stopped

  minio-init:
    image: minio/mc:latest
    depends_on: ["minio"]
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 ${S3_ACCESS_KEY_ID:-minioadmin} ${S3_SECRET_ACCESS_KEY:-minioadmin}; do sleep 2; done &&
      mc mb --ignore-existing local/${S3_BUCKET:-openldr} && echo 'bucket ready'"

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KEYCLOAK_ADMIN:-admin}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-admin}
    volumes:
      - ./infra/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    ports: ["8180:8080"]   # issuer must be reachable by browser + server; see DEPLOYMENT.md
    restart: unless-stopped

volumes:
  pgdata:
  miniodata:
```
(Note in DEPLOYMENT.md: `keycloak start-dev` is fine for a demo; production hardening of Keycloak (hostname, `start`, TLS) is a documented follow-up. Keycloak is exposed on 8180 so the OIDC issuer URL resolves for both browser and server — the README's "one or two ports".)

- [ ] **Step 2: Create `.env.prod.example`**
```sh
# Copy to .env.prod and fill in. NEVER commit .env.prod.
SERVER_NAME=localhost
PORT=3000
NODE_ENV=production

# Internal Postgres (the `postgres` service)
INTERNAL_DATABASE_URL=postgres://openldr:openldr@postgres:5432/openldr
POSTGRES_PASSWORD=openldr

# Blob storage (the `minio` service)
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true

# Auth (the `keycloak` service). The issuer URL must be reachable by BOTH the browser and
# the server. For a local demo set it to the published Keycloak port; OR set AUTH_DEV_BYPASS=true.
OIDC_ISSUER_URL=http://localhost:8180/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
# AUTH_DEV_BYPASS=true   # quick demo without real login

# Adapters
TARGET_STORE_ADAPTER=pg
REPORTING_TARGET_ADAPTER=none
MARKETPLACE_DEV_ALLOW_UNSIGNED=false
# MARKETPLACE_REGISTRY_DIR=/app/marketplace-registry
```
(Cross-check every key against `packages/config/src/schema.ts` while writing — include all REQUIRED keys, omit optional ones, and match defaults. Adjust if the schema requires more.)

- [ ] **Step 3: Update `.gitignore`** — append:
```
.env.prod
deploy/nginx/certs/
```

- [ ] **Step 4: Commit**
```bash
git add docker-compose.prod.yml .env.prod.example .gitignore
git commit -m "feat(deploy): production compose (app+nginx+pg+minio+keycloak) + env example"
```

---

### Task 5: `DEPLOYMENT.md` + README link

**Files:**
- Create: `DEPLOYMENT.md` (repo root)
- Modify: `README.md` (§Deployment links to it)

- [ ] **Step 1: Write `DEPLOYMENT.md`** with these sections (concrete commands, no placeholders):
  - **Prerequisites:** Docker + Docker Compose; a domain (prod) or `localhost` (demo).
  - **Quick start (local, self-signed):** `sh deploy/nginx/gen-selfsigned.sh localhost` → `cp .env.prod.example .env.prod` (edit secrets) → `docker compose -f docker-compose.prod.yml up -d --build` → browse `https://localhost` (accept the self-signed warning).
  - **Architecture:** one diagram-in-prose — `:443 nginx (TLS) → app:3000 (fastify serves SPA + /api + auth)`; Keycloak on `:8180`; Postgres/MinIO internal.
  - **TLS in production:** obtain certs via Let's Encrypt/certbot, drop `fullchain.pem`+`privkey.pem` into `deploy/nginx/certs/`, set `SERVER_NAME`; renewal is the operator's cron/certbot (out of scope here).
  - **Environment:** point to `.env.prod.example`; call out the OIDC issuer-reachability requirement + the `AUTH_DEV_BYPASS` demo shortcut; Keycloak prod-hardening note.
  - **Smoke check:** `curl -ik http://localhost/` (→ 301 https), `curl -k https://localhost/health` (→ up JSON), `curl -k https://localhost/` (→ SPA HTML), `curl -k https://localhost/api/config` (→ JSON).
  - **Upgrade / teardown:** `docker compose -f docker-compose.prod.yml pull/up -d --build`; `down` (and `down -v` to drop data).

- [ ] **Step 2: Link from README §Deployment** — add a line under the existing Deployment paragraph: `See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the single-port Docker stack (nginx + app + backing services).`

- [ ] **Step 3: Commit**
```bash
git add DEPLOYMENT.md README.md
git commit -m "docs(deploy): DEPLOYMENT.md single-port guide + README link"
```

---

### Task 6: Verify

- [ ] **Step 1: Repo gate stays green** — `pnpm turbo typecheck lint test build && pnpm depcruise`. The only code change is Task 1 (server `WEB_DIST_DIR`, backward-compatible); config/docs files don't enter the TS/depcruise graph. Re-run `@openldr/web#test` in isolation if it flakes.
- [ ] **Step 2: Docker build + smoke (USER-RUN if Docker unavailable here)** — `docker build -t openldr-ce:local .`; then `sh deploy/nginx/gen-selfsigned.sh && cp .env.prod.example .env.prod && docker compose -f docker-compose.prod.yml up -d --build`; run the §Smoke-check curls. If Docker is unavailable in the implementation environment, capture that, do NOT fake it, and hand the smoke to the user (the artifacts are complete + committed).
- [ ] **Step 3: Commit any fixes.**

---

## Self-Review

**Spec coverage:**
- §4.1 app Dockerfile (multi-stage, pnpm deploy, web-dist layout) → Task 2 (+ Task 1 makes the layout robust via `WEB_DIST_DIR`). ✓
- §4.2 nginx conf template (proxy-all, TLS, gzip/headers, 80→443) + self-signed script → Task 3. ✓
- §4.3 docker-compose.prod.yml (app+nginx+pg+minio+keycloak) + .env.prod.example → Task 4. ✓
- §4.4 DEPLOYMENT.md + README link → Task 5. ✓
- §5 verification (gate green; docker build + smoke; user-run fallback) → Task 6. ✓
- §6 out-of-scope (k8s/CI/certbot-automation/mssql-dhis2) → none built. ✓
- §7 risks (monorepo packaging — pnpm deploy + documented fallback; static path — solved via WEB_DIST_DIR Task 1; secrets gitignored — Task 4; Keycloak issuer reachability — exposed :8180 + documented; Docker-maybe-unavailable — Task 6 user-run) → addressed. ✓

**Placeholder scan:** No TBD/TODO. The Dockerfile carries a verify-and-adjust note on the `pnpm deploy` entry path + an explicit fallback (copy-repo + `pnpm install --prod`) — concrete alternatives, not vagueness, appropriate because the exact `pnpm deploy` output layout must be confirmed against a real build (which may be user-run). The `.env.prod.example` instructs cross-checking `packages/config/src/schema.ts` for the authoritative required-key set.

**Type/name consistency:** `WEB_DIST_DIR` is defined in Task 1 (server) and consumed by the Dockerfile `ENV` (Task 2). Service names (`app`/`nginx`/`postgres`/`minio`/`keycloak`) are consistent between `docker-compose.prod.yml` (Task 4), the nginx `proxy_pass http://app:3000` (Task 3), and `.env.prod.example` URLs (`postgres`/`minio` hosts, Task 4). `SERVER_NAME`/`S3_*`/`POSTGRES_PASSWORD` env names match between the compose, the nginx template, and the env example. The `/health` smoke path (Task 5/6) matches the real server route; the SPA is served because `WEB_DIST_DIR=/app/web` is populated in the runtime image (Task 2).
