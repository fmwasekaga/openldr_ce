# Docker Hub Images + api/studio Split — Design

- **Date:** 2026-07-02
- **Status:** Approved (brainstorm → spec)
- **Owner:** OpenLDR CE

## Problem

The one-line installer (`install/install.{sh,ps1}` + `deploy/install/docker-compose.yml`)
is already image-based — it downloads compose + config and does `docker compose pull && up -d` —
but it references **unpublished** `ghcr.io/fmwasekaga/openldr[-landing]` images. Meanwhile the
real deploy path (`docker-compose.prod.yml` + `pnpm run init`) **builds from source** (~250s on
the droplet). We want a fresh install to PULL prebuilt images from **Docker Hub** (fast, no
clone/build).

Additionally, CE currently ships the studio SPA and the server/API as ONE single-origin image.
The user wants them as **separately-updatable images** (bump/pull just the api, or just studio,
independently). This requires splitting the app — which is also the "gateway single-port next
iteration" work (route everything through nginx; api and studio as distinct upstreams).

## Goals

1. Publish CE as **four independently-versioned Docker Hub images** under `fmwasekaga/`:
   `openldr-api`, `openldr-studio`, `openldr-web`, `openldr-gateway`.
2. **Split** the single-origin app into `openldr-api` (backend) + `openldr-studio` (static SPA)
   so each updates independently.
3. Point the one-line installer's compose at Docker Hub so a fresh install PULLS (no build).
4. A local `docker buildx` publish script (modeled on v2's `build-and-push.sh`).

## Non-goals / deferred

- **GitHub Actions release CI** — publishing is a local buildx script for now.
- **arm64 / multi-arch** — amd64-only; a `--platform` flag allows opting in later.
- **Image-based `init`** — `init` stays a build-from-source path; only the installer pulls images.
- **Configurable OIDC redirect** — public URLs stay `/studio` + `/api`, so Keycloak redirect URIs
  are unchanged; the "configurable OIDC redirect" idea stays deferred.
- **Unexposing backing-service ports further** — both composes already publish only the gateway's
  `80/443`; no additional port work needed.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Publish mechanism | Local `docker buildx` script (v2 prior art `docker/scripts/build-and-push.sh`) |
| Namespace | `docker.io/fmwasekaga` |
| Scope | **Split** api/studio into separate images (folds in gateway-single-port) |
| App image naming | `openldr-api` (backend) + `openldr-studio` (static SPA) |
| Combined root `Dockerfile` | **Delete** it; all references move to the new per-app Dockerfiles |
| Architectures | **amd64-only** (`--platform` flag to add arm64 later) |
| Tags | each image tagged both `:latest` and `:<version>` (root `package.json` → `0.1.0`) |
| `init` vs installer | separate paths: `init` = build-from-source, installer = pull images |

## The four images (`docker.io/fmwasekaga/`)

| Image | Built from (context = repo root unless noted) | Contents |
|---|---|---|
| `openldr-api` | **new** `apps/server/Dockerfile` | server/API + `/health`; no SPA staged, `WEB_DIST_DIR` unset |
| `openldr-studio` | **new** `apps/studio/Dockerfile` | static nginx serving the built SPA under `/studio/` |
| `openldr-web` | existing `apps/web/Dockerfile` | landing site (static nginx) |
| `openldr-gateway` | **new** `deploy/nginx/Dockerfile` (context `deploy/nginx/`) | `nginx:1.27-alpine` + **baked** `openldr.conf.template` |

Stock third-party images (postgres, minio, minio/mc, keycloak) are never rebuilt or pushed.

## Component: `openldr-api` (`apps/server/Dockerfile`, new)

Essentially today's root `Dockerfile` **minus** the SPA staging. Build `@openldr/server` (not
`@openldr/studio`), `pnpm --filter @openldr/server deploy --prod --legacy /deploy`, stage the
terminology fixtures (the `packages/db/fixtures/fhir/*.gz` copy — still required), but do NOT copy
`apps/studio/dist` and do NOT set `WEB_DIST_DIR`. `apps/server/src/app.ts` already guards SPA
serving on `existsSync(webDist)`, so with no SPA present the image is API + `/health` only — no code
change needed. Runtime: non-root `openldr` uid 10001, `EXPOSE 3000`.

## Component: `openldr-studio` (`apps/studio/Dockerfile`, new)

Two stages: build `@openldr/studio` (`pnpm turbo build --filter @openldr/studio`) → static
`nginx:1.27-alpine` serving `apps/studio/dist`.

- The SPA is already built for **`base: '/studio/'`** (`apps/studio/vite.config` line 8) and reads
  its runtime config from **`/api/config`** — so the static image is env-agnostic (no per-host
  rebuild, no build-time secrets).
- nginx serves the SPA under the `/studio/` path with a client-side-routing fallback. A small baked
  `nginx` config: serve `apps/studio/dist` at location `/studio/` with
  `try_files $uri $uri/ /studio/index.html;`. The gateway proxies `/studio*` → `studio:80`, and the
  studio nginx serves `/studio/assets/*` etc. directly (matching the SPA's `/studio/` base — no path
  rewriting needed). `EXPOSE 80`.

## Component: `openldr-gateway` (`deploy/nginx/Dockerfile`, new)

`FROM nginx:1.27-alpine` + `COPY openldr.conf.template /etc/nginx/templates/default.conf.template`.
nginx's official entrypoint runs envsubst on the template at container start, so `${SERVER_NAME}`
is still substituted at runtime. TLS certs stay **mounted** (host-specific), not baked. Baking the
routing config means the installer no longer downloads the nginx template.

**Split the routing** in `deploy/nginx/openldr.conf.template`:
```
set $upstream_web    http://web:80;
set $upstream_studio http://studio:80;
set $upstream_api    http://api:3000;
set $upstream_kc     http://keycloak:8080;
...
location /         { proxy_pass $upstream_web$request_uri; }
location /studio   { proxy_pass $upstream_studio$request_uri; }
location /api      { proxy_pass $upstream_api$request_uri; }
location = /health { proxy_pass $upstream_api/health; }
location /auth     { proxy_pass $upstream_kc$request_uri; }
```
Keep the existing `resolver 127.0.0.11` variable-`proxy_pass` pattern so nginx re-resolves the new
`web`/`studio`/`api` upstreams per request (survives container recreation on redeploy).

## Component: publish script (`scripts/build-and-push.sh` + `.ps1`, new)

Modeled on v2's `docker/scripts/build-and-push.sh`. Must run from repo root (guard on
`package.json` + `apps/`).

- Flags: `--registry` (default `fmwasekaga`), `--tag` (default `latest`), `--dry-run`, `--no-push`,
  `--platform` (default `linux/amd64`).
- Reads the version from root `package.json` and tags each image **both** `:<tag>` (default
  `latest`) and `:<version>` (e.g. `0.1.0`) so installs can pin.
- Builds via `docker buildx build --platform "$PLATFORM" --push` (or `--load` under `--no-push`):
  - `openldr-api` → `-f apps/server/Dockerfile .`
  - `openldr-studio` → `-f apps/studio/Dockerfile .`
  - `openldr-web` → `-f apps/web/Dockerfile .`
  - `openldr-gateway` → `-f deploy/nginx/Dockerfile deploy/nginx/`
- `--dry-run` prints the commands only. A `pnpm run publish:images` alias in root `package.json`.
- The `.ps1` mirrors the `.sh` for Windows (the user builds on Windows).

## Component: compose files (both mirror the split)

**`deploy/install/docker-compose.yml`** (installer, pull): replace `app`/`landing` with services
`api`, `studio`, `web`, `gateway` on `fmwasekaga/openldr-*:${OPENLDR_VERSION:-latest}`. The `gateway`
service uses the published image (baked config) — so drop the mounted nginx-template volume (still
mount `certs`). `api` keeps the postgres/minio/keycloak `depends_on`. `studio`/`web` depend on
nothing. Only `gateway` publishes `80/443`. The installer (`install.sh`/`.ps1`) stops downloading
`deploy/nginx/openldr.conf.template` (baked into the gateway image).

**`docker-compose.prod.yml`** (source/build, for `init`): same 4 services, but `build:` from the new
Dockerfiles instead of pulling:
- `api`: `build: { context: ., dockerfile: apps/server/Dockerfile }`
- `studio`: `build: { context: ., dockerfile: apps/studio/Dockerfile }`
- `web`: `build: { context: ., dockerfile: apps/web/Dockerfile }` (unchanged)
- `gateway`: `build: { context: deploy/nginx }` — OR keep it stock `nginx` + mounted template for
  the source path (dev doesn't need to build the gateway image). **Decision: source compose keeps
  stock nginx + mounted template** (one less thing to build locally); only the INSTALL compose uses
  the published `openldr-gateway` image. Both render the same split routing.

Update the `nginx`/`gateway` `depends_on` to `["api", "studio", "web", "keycloak"]`. Update any
healthcheck that referenced `app` to `api`.

## Delete the combined root `Dockerfile`

Remove `Dockerfile`. Repoint every reference: `docker-compose.prod.yml` `app` service → split
`api`+`studio`; `DEPLOYMENT.md` and any docs mentioning the root build. Grep for `build: .` and
`dockerfile: Dockerfile` / bare `Dockerfile` references and update them all.

## `init` reconciliation

`pnpm run init` (`scripts/init.mjs` → `scripts/init/launch.mjs`) keeps building from source via
`docker-compose.prod.yml up -d --build` under `-p openldr --env-file .env.prod`. After the split it
builds `api`+`studio`+`web` (gateway stays stock nginx in the source path). No image-pull mode for
`init` in this scope. The installer path (`deploy/install/docker-compose.yml`) is the image-pull
path.

## Risks / gotchas

- **Studio base path:** the studio nginx must serve assets under `/studio/` to match the SPA's
  `base: '/studio/'`. Serving the dist at nginx location `/studio/` (not root) avoids any path
  rewrite. Verify a hard refresh of a deep route (`/studio/reports`) falls back to
  `/studio/index.html`.
- **api has no SPA:** confirm a request the gateway would send to `/api/*` and `/health` works from
  the api image with `WEB_DIST_DIR` unset (the `existsSync` guard skips static serving). A direct
  `/studio` hit never reaches api (gateway routes it to studio).
- **Fixtures still needed in api image:** the terminology fixtures copy
  (`packages/db/fixtures/fhir/*.gz` → `/deploy/fixtures/fhir/`) must remain in `apps/server/Dockerfile`
  — dropping it reintroduces the first-boot "fixture missing" seed failure.
- **buildx builder:** `docker buildx` needs a builder instance; the script should `docker buildx
  create --use` if none, or assume the default `docker-container`/`docker` driver. `--load` only
  supports single-platform (fine for amd64) if testing without push.
- **OIDC unchanged:** public origin + `/studio` + `/api` paths are identical post-split, so
  Keycloak `openldr-web` client redirect URIs stay valid.
- **Version bump:** `0.1.0` is the current tag; independent updates work by rebuilding one image and
  `docker compose pull <service>`.

## Rollout / sequencing (for the plan)

1. `apps/server/Dockerfile` (api-only) + verify api-only container serves `/api` + `/health`.
2. `apps/studio/Dockerfile` (static SPA under `/studio/`) + nginx SPA-fallback config.
3. `deploy/nginx/Dockerfile` (gateway) + split routing in `openldr.conf.template`.
4. Delete root `Dockerfile`; repoint `docker-compose.prod.yml` to the 4 split services; update
   depends_on/healthchecks; keep gateway stock+mounted in the source path.
5. `deploy/install/docker-compose.yml` → 4 `fmwasekaga/openldr-*` services + baked gateway; trim the
   installer's nginx-template download.
6. `scripts/build-and-push.{sh,ps1}` + `pnpm run publish:images`.
7. Docs (`DEPLOYMENT.md`, install README) + a local end-to-end smoke: `--dry-run`, then a real
   `pnpm run init` from source (build path), then a real installer run against pushed images.
