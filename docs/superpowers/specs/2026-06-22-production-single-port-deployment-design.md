# Production Single-Port Deployment (P1-NFR-7) Design

**Date:** 2026-06-22
**Status:** Approved for planning
**Scope:** Ship a deployable, single-HTTPS-port stack: an app container, an nginx TLS reverse proxy, a production compose, and deployment docs. Pragmatic/medium-effort — closes P1-NFR-7. Not k8s/CI/autoscaling.

## 1. Goal

A maintainer can build the app image and run `docker compose -f docker-compose.prod.yml up` to get OpenLDR CE behind **one HTTPS port** (nginx → the app), with the backing services (Postgres, MinIO, Keycloak) wired. Works on localhost with a self-signed cert out-of-the-box; documented path to Let's Encrypt for real domains.

## 2. Resolved decisions

- **nginx = TLS + reverse-proxy ALL routes to the fastify app** (the server already serves the SPA + SPA-fallback + `/api` + `/config` + auth single-origin; nginx stays thin — TLS, gzip, security headers, 80→443 redirect). No static-serving in nginx.
- **TLS:** self-signed cert generated for local `compose up`; certbot/Let's Encrypt documented (not wired in compose).
- **Compose:** a separate `docker-compose.prod.yml` (dev `docker-compose.yml` untouched) with app + nginx + postgres + minio + keycloak. mssql/dhis2 excluded (optional adapters).
- **Execution:** config files + docs (not TDD feature code) — implemented directly, verified by `docker build` + a smoke check; the live `compose up` run may be user-run if Docker is unavailable in the build environment.

## 3. Current state (what this builds on)

- `apps/server/src/app.ts`: registers all `/api/*` routes + auth, then `@fastify/static` over `webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')` with a `setNotFoundHandler` SPA fallback. So from `apps/server/dist/index.js`, the SPA must sit at `apps/web/dist`. Single-origin already works.
- `apps/server` builds via `tsup` → `apps/server/dist/index.js` (`build` script); `apps/web` builds via Vite → `apps/web/dist`. Root `pnpm turbo build` builds both (+ deps).
- `packages/config` schema: server needs `PORT` (default 3000), `INTERNAL_DATABASE_URL`, `S3_*` (MinIO), `OIDC_ISSUER_URL`/`OIDC_WEB_CLIENT_ID`/`OIDC_AUDIENCE`, optional `TARGET_DATABASE_URL`/`MSSQL_*`, `DHIS2_*`, `MARKETPLACE_*`, `AUTH_DEV_BYPASS`, etc. (all env-driven).
- `docker-compose.yml`: postgres:16 (5433→5432 per memory), minio, minio-init, keycloak:26, mssql, dhis2-db, dhis2-web. Dev only; no app/nginx.
- README §Deployment already states the single-HTTPS-port/nginx/Let's-Encrypt intent + "all application code is proxy-relative."
- Node version: the repo uses Node 22+ (`@types/node` 22). Pin the image to a matching Node LTS.

## 4. Components

### 4.1 App image — `Dockerfile` (repo root)
Multi-stage:
- **build stage** (`node:22-slim` + pnpm via corepack): copy the repo, `pnpm install --frozen-lockfile`, `pnpm turbo build --filter @openldr/web --filter @openldr/server` (builds web→`apps/web/dist`, server→`apps/server/dist`, + workspace deps).
- **runtime stage** (`node:22-slim`): produce a self-contained server dir. Use **`pnpm --filter @openldr/server deploy --prod /app/server`** from the build stage (pnpm deploy resolves workspace deps into a standalone `node_modules`), then copy `apps/server/dist` + `apps/web/dist` into the layout the static path expects (`/app/server/apps/server/dist/index.js` + `/app/server/apps/web/dist`, OR adjust to keep the `../../web/dist` relative resolution valid — the plan pins the exact paths). `WORKDIR` + `CMD ["node", "apps/server/dist/index.js"]`. `EXPOSE 3000`. Non-root user. A `HEALTHCHECK` curling the health endpoint.
  - If `pnpm deploy` proves fiddly with tsup output, fallback: copy the built repo + run `pnpm install --prod --frozen-lockfile` in the runtime stage. The plan picks whichever builds cleanly; the requirement is a runnable image where `apps/web/dist` resolves from the server.
- A `.dockerignore` (node_modules, dist, .turbo, .git, .worktrees, e2e artifacts, scripts/.marketplace-keys).

### 4.2 nginx — `deploy/nginx/openldr.conf.template` (+ entrypoint)
- `server { listen 80; … return 301 https://$host$request_uri; }` and `server { listen 443 ssl; … }`.
- TLS: `ssl_certificate /etc/nginx/certs/fullchain.pem; ssl_certificate_key /etc/nginx/certs/privkey.pem;` (mounted volume).
- `location / { proxy_pass http://app:3000; }` with `proxy_set_header Host/X-Real-IP/X-Forwarded-For/X-Forwarded-Proto`, WebSocket upgrade headers (future-proof), `client_max_body_size` generous enough for plugin/bundle/ingest uploads (e.g. 50m), gzip on text/js/json, sensible security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`). `$host`/server_name templated via env (`${SERVER_NAME}`) using nginx's `envsubst` entrypoint (the official nginx image supports `*.template` → envsubst).
- A `deploy/nginx/gen-selfsigned.sh` (openssl one-liner) to produce `certs/fullchain.pem`+`privkey.pem` for localhost; documented certbot swap.

### 4.3 `docker-compose.prod.yml` (repo root)
- `app`: `build: .` (the Dockerfile), `env_file: .env.prod`, `depends_on` postgres/minio/keycloak (healthchecks), no published ports (only nginx is public). Internal `expose: 3000`.
- `nginx`: `image: nginx:1.27-alpine`, ports `80:80`/`443:443`, mounts the conf template + `deploy/nginx/certs`, `SERVER_NAME` env, `depends_on: app`.
- `postgres` / `minio` (+ minio-init bucket bootstrap) / `keycloak` (production mode `start` with the realm import, or `start-dev` documented for demo) — mirror the dev compose's images/env but production-oriented (named volumes, restart: unless-stopped).
- `.env.prod.example` documenting every required env var (DB URL pointing at the `postgres` service, S3 at `minio`, OIDC at `keycloak`, `SERVER_NAME`, secrets) — secrets NOT committed.

### 4.4 Docs — `DEPLOYMENT.md` (repo root, linked from README §Deployment)
Build the image, generate/supply certs, fill `.env.prod`, `docker compose -f docker-compose.prod.yml up -d`, browse `https://localhost`. Sections: prerequisites, TLS (self-signed for local / certbot for prod), env reference, the single-port architecture (nginx→app), the smoke check, and upgrade/teardown.

## 5. Verification

- `docker build -t openldr-ce .` succeeds (the multi-stage build + the workspace-dep resolution).
- Smoke (`docker compose -f docker-compose.prod.yml up -d` once backing services are healthy): `curl -k https://localhost/api/health` (or the real health path) returns up; `curl -k https://localhost/` returns the SPA HTML (contains the app root div); `curl -ik http://localhost/` returns a 301 to https.
- The existing gate (`pnpm turbo typecheck lint test build && pnpm depcruise`) stays green — the new files are config/docs and don't enter the TS build graph or depcruise (`.dockerignore`/compose/nginx/docs aren't modules). Confirm depcruise is unaffected.
- If Docker isn't available in the implementation environment, deliver the config + a `scripts/`-style documented smoke and mark the live `docker build`/`up` as a **user-run acceptance** (like `mssql:accept`).

## 6. Out of scope

Kubernetes/Helm, CI/CD pipelines, autoscaling/HA, automated certbot renewal wiring, mssql/dhis2 in the prod compose, log shipping/observability stack, multi-arch image builds.

## 7. Risks / notes

- **Monorepo runtime packaging** is the trickiest bit: tsup externalizes deps, so the runtime stage needs the production `node_modules` for `@openldr/*` workspace packages + their transitive deps. `pnpm deploy` is the intended tool; the plan must verify the produced image actually starts and resolves `apps/web/dist`. Fallback to copy-repo + `pnpm install --prod` if needed.
- **Static path:** the server resolves `../../web/dist` relative to its own dist file — the runtime image layout must preserve that or the SPA 404s. Pin the COPY destinations to keep it valid.
- **Keycloak in prod mode** needs a hostname + the realm import; for a demo, `start-dev` is acceptable and documented. Don't over-invest — the realm provisioning already exists (auth workstream).
- **Secrets:** `.env.prod` and `deploy/nginx/certs/` are gitignored; only `.env.prod.example` + the self-signed generator script are committed.
- **Docker may be unavailable** in the implementation environment → the `docker build`/`up` verification becomes a documented user-run step; the committed artifacts are still complete + reviewable.
