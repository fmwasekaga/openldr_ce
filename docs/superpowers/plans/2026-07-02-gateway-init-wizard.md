# Single-Port Gateway + `pnpm run init` Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all traffic through one nginx gateway (path-based: `/`=landing, `/studio`=app, `/api`=server, `/auth`=Keycloak), unexpose all backing-service host ports, make the OIDC issuer/redirect host-configurable (split front/back channel), and add an interactive `pnpm run init` wizard that configures + launches + verifies the stack.

**Architecture:** Separate containers behind nginx: a `landing` static container (`apps/web`), the `app` fastify container (studio SPA under `/studio` + `/api`), Keycloak under relative path `/auth`. The app validates the public issuer (`https://HOST/auth/realms/openldr`) but fetches JWKS from an internal URL (`http://keycloak:8080/auth/...`). A Node CLI (`scripts/init.mjs`) prompts for host (IP/domain), TLS mode (self-signed / Let's Encrypt / bring-your-own), and ports, then writes `.env.prod` + certs + a rendered realm import, brings the stack up, and polls `/health`.

**Tech Stack:** Docker Compose, nginx, Keycloak 26 (hostname v2), `jose` (JWT/JWKS), Vite/React (studio + landing), Node (wizard, `@inquirer/prompts`), Vitest.

**Spec:** [2026-07-02-gateway-init-wizard-design.md](../specs/2026-07-02-gateway-init-wizard-design.md).

---

## Key facts (verified against the codebase)

- **Auth adapter** `packages/adapter-auth/src/index.ts` uses `jose`: `createAuth(cfg, deps)` → `getKeySet()` fetches OIDC discovery (`${issuerUrl}/.well-known/openid-configuration`) → `createRemoteJWKSet(new URL(doc.jwks_uri))`; `verifyToken` calls `jwtVerify(token, jwks, { issuer: cfg.issuerUrl, audience: cfg.audience, algorithms:[...] })`. `deps` already supports injecting `fetchFn` and `keySet` (tests use `createLocalJWKSet`). `AuthConfig = { issuerUrl, audience?, adminClientId?, adminClientSecret? }`.
- **Bootstrap** `packages/bootstrap/src/index.ts` builds it: `createAuth({ issuerUrl: cfg.OIDC_ISSUER_URL, audience: cfg.OIDC_AUDIENCE, adminClientId, adminClientSecret })`.
- **Config** `packages/config/src/schema.ts`: `OIDC_ISSUER_URL: z.string().url()`, `OIDC_WEB_CLIENT_ID` default `openldr-web`, `OIDC_AUDIENCE` optional, `PORT` default 3000.
- **Studio**: `apps/studio/vite.config.ts` has no `base`; router `main.tsx` `<BrowserRouter>` has no `basename`; OIDC client `apps/studio/src/auth/oidc.ts` sets `redirect_uri: ${window.location.origin}/auth/callback`, `post_logout_redirect_uri: window.location.origin`; `App.tsx` route `/auth/callback`; `AuthProvider.tsx` checks `location.pathname === '/auth/callback'`.
- **Server static** `apps/server/src/app.ts` serves `WEB_DIST_DIR` (default `../../studio/dist`) at `/` via `fastifyStatic` + a not-found handler that 404s `/api*` and otherwise `sendFile('index.html')`. Health route is `/health` (not `/api/*`).
- **Landing** `apps/web` (`@openldr/web`) is a static Vite site (`vite build` → `dist`), NOT built in the Dockerfile or run anywhere.
- **Dockerfile** builds `@openldr/studio` + `@openldr/server`, `pnpm deploy` → `/deploy`, copies `apps/studio/dist` → `/deploy/web` (`WEB_DIST_DIR=/app/web`). Single runtime container, `EXPOSE 3000`, healthcheck hits `/health`.
- **Compose**: `docker-compose.prod.yml` = app(build)+nginx(80/443)+postgres+minio+keycloak(**still `8180:8080`**). `deploy/install/docker-compose.yml` = same but `image: ghcr.io/fmwasekaga/openldr` + `./config/*` mounts. Dev `docker-compose.yml` publishes 5433/9010/9011/8180.
- **nginx** `deploy/nginx/openldr.conf.template`: single `location /` → `app:3000`; `${SERVER_NAME}` via envsubst. `gen-selfsigned.sh <CN>` → `deploy/nginx/certs/{fullchain,privkey}.pem` (SAN DNS:CN,DNS:localhost,IP:127.0.0.1).
- **Keycloak realm** `infra/keycloak/openldr-realm.json`: client `openldr-web`, `redirectUris:["http://localhost:5173/*","http://localhost:3000/*","http://localhost:8180/*"]`, `webOrigins:["+"]`, public client, PKCE S256. Realm imported via `start-dev --import-realm`. No KC_HOSTNAME/relative-path today.
- **`.env.prod.example`**: `SERVER_NAME=localhost`, `OIDC_ISSUER_URL=http://host.docker.internal:8180/realms/openldr`. Root `package.json` has no `init` script and NO prompt lib.
- **Install scripts** `install/install.{sh,ps1}` hardcode `SERVER_NAME=localhost` + the `:8180` OIDC issuer into a generated `.env`.

## Non-obvious conventions

- Server esbuild bundle build fails locally on native deps — use **typecheck + vitest**, not `pnpm build`, for the server. `pnpm -C apps/studio build` and `pnpm -C apps/web build` DO work.
- Run the cross-package gate forced: `pnpm typecheck --force` (turbo cache hides cross-package breakage).
- `@openldr/studio#test` has a known parallel flake — re-run isolated.
- Leave the pre-existing uncommitted `.gitignore` + untracked `scripts/*.ts` alone; use scoped `git add`.
- Docker/nginx/compose changes are verified by **rendered-file inspection + `docker compose config` + manual acceptance**, not unit tests. The wizard's PURE pieces (config-compute, env-merge, realm-render, host-detect, port-check) ARE unit-tested.

## File structure

**Create:**
- `infra/keycloak/openldr-realm.json.template` — realm import with `${PUBLIC_ORIGIN}` placeholders
- `apps/web/Dockerfile` (or a build stage + static image) — landing container
- `scripts/init/host-detect.mjs`, `port-check.mjs`, `config-compute.mjs`, `env-merge.mjs`, `realm-render.mjs`, `certs.mjs`, `launch.mjs`, `verify.mjs` — wizard units
- `scripts/init/*.test.mjs` — unit tests for the pure units
- `scripts/init.mjs` — the `pnpm run init` orchestrator

**Modify:**
- `packages/adapter-auth/src/index.ts` (+ `.test.ts`) — internal JWKS seam
- `packages/config/src/schema.ts` — new env vars
- `packages/bootstrap/src/index.ts` — pass `internalJwksUrl`
- `apps/studio/vite.config.ts`, `apps/studio/src/main.tsx`, `apps/studio/src/auth/oidc.ts`, `apps/studio/src/auth/AuthProvider.tsx` — `/studio` base
- `apps/server/src/app.ts` (+ `.test.ts`) — serve studio under `/studio`
- `Dockerfile` — build landing; keep studio→WEB_DIST_DIR
- `docker-compose.prod.yml`, `deploy/install/docker-compose.yml` — landing service, unexpose ports, KC env, gateway port vars
- `deploy/nginx/openldr.conf.template` — path map + ACME location
- `.env.prod.example` — new vars
- `install/install.sh`, `install/install.ps1` — stop hardcoding SERVER_NAME/issuer (point at the wizard or the new vars)
- `package.json` — `init` script + `@inquirer/prompts` dep
- `docs/DEPLOYMENT.md`, `docs/CONFIGURATION.md` — new topology + wizard + TLS modes

---

## Group 1 — OIDC split front/back channel

### Task 1: `internalJwksUrl` seam in the auth adapter

**Files:**
- Modify: `packages/adapter-auth/src/index.ts`
- Modify: `packages/adapter-auth/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/adapter-auth/src/index.test.ts` (reuses the file's existing `localKeySet` helper + `generateKeyPair`/`exportJWK`/`createRemoteJWKSet` from `jose`). The test asserts that when `internalJwksUrl` is set, discovery is NOT fetched and keys come from the internal URL, while the public issuer is still validated:

```typescript
it('with internalJwksUrl: skips discovery, fetches JWKS from the internal url, validates the public issuer', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key'; jwk.alg = 'RS256';
  const publicIssuer = 'https://host/auth/realms/openldr';
  const internalJwks = 'http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs';
  let discoveryCalls = 0; let jwksCalls = 0;
  const fetchFn = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('.well-known')) { discoveryCalls++; throw new Error('discovery must not be called'); }
    if (u === internalJwks) { jwksCalls++; return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
  const auth = createAuth({ issuerUrl: publicIssuer, audience: 'openldr-api', internalJwksUrl: internalJwks }, { fetchFn });
  const token = await new SignJWT({ preferred_username: 'ada' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt()
    .setSubject('user-123').setIssuer(publicIssuer).setAudience('openldr-api').setExpirationTime('5m')
    .sign(privateKey);
  const claims = await auth.verifyToken(token);
  expect(claims.sub).toBe('user-123');
  expect(discoveryCalls).toBe(0);
  expect(jwksCalls).toBeGreaterThanOrEqual(1);
});
```

(Ensure `SignJWT` is imported in the test — the file already imports from `jose`; add `SignJWT` to that import if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/adapter-auth test`
Expected: FAIL — the new test errors because `internalJwksUrl` is ignored and discovery is attempted (or the option is a type error).

- [ ] **Step 3: Implement the seam**

In `packages/adapter-auth/src/index.ts`, add `internalJwksUrl?: string` to `AuthConfig`:

```typescript
export interface AuthConfig {
  issuerUrl: string;
  audience?: string;
  adminClientId?: string;
  adminClientSecret?: string;
  /** When set, fetch JWKS directly from this URL (internal/back-channel) instead of via
   *  OIDC discovery on the public issuer. The issuer CLAIM is still validated against issuerUrl. */
  internalJwksUrl?: string;
}
```

In `getKeySet()`, short-circuit to the internal URL when configured (keep the discovery path as the default):

```typescript
function getKeySet(): Promise<JWTVerifyGetKey> {
  if (!keySetPromise) {
    keySetPromise = (async () => {
      if (cfg.internalJwksUrl) {
        return createRemoteJWKSet(new URL(cfg.internalJwksUrl));
      }
      const res = await fetchFn(discoveryUrl);
      if (!res.ok) throw new Error(`OIDC discovery returned ${res.status}`);
      const doc = (await res.json()) as { jwks_uri?: string };
      if (!doc.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
      return createRemoteJWKSet(new URL(doc.jwks_uri));
    })().catch((e) => { keySetPromise = undefined; throw e; });
  }
  return keySetPromise;
}
```

Note: `createRemoteJWKSet` uses the global fetch, so the test injects `fetchFn` for discovery-avoidance but `createRemoteJWKSet` will fetch the internal URL via the real global fetch — to keep the test hermetic, the test's `fetchFn` guards discovery; the internal JWKS fetch by `createRemoteJWKSet` needs the global `fetch` to reach `internalJwks`. Since that URL isn't real in the test, EITHER: (a) pass the jose `createRemoteJWKSet` a custom `[customFetch]` option pointing at `fetchFn` (jose supports `createRemoteJWKSet(url, { [customFetch]: fetchFn })`), OR (b) inject a `keySet` for the internal case. **Use option (a):** thread `fetchFn` into `createRemoteJWKSet` for BOTH branches so the injected fetch is honored:

```typescript
import { createRemoteJWKSet, jwtVerify, customFetch, type JWTVerifyGetKey } from 'jose';
// ...
return createRemoteJWKSet(new URL(cfg.internalJwksUrl), { [customFetch]: fetchFn });
// and in the discovery branch:
return createRemoteJWKSet(new URL(doc.jwks_uri), { [customFetch]: fetchFn });
```

(If the installed `jose@5.9.6` doesn't export `customFetch`, fall back to injecting `keySet` in the test instead and assert discovery isn't called by using `internalJwksUrl` + a `keySet` dep; keep the production code using the plain `createRemoteJWKSet(url)`. Verify which `jose` API is available before finalizing.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/adapter-auth test`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-auth/src/index.ts packages/adapter-auth/src/index.test.ts
git commit -m "feat(adapter-auth): internal JWKS url seam (split front/back channel)"
```

### Task 2: config var + bootstrap passthrough

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add the config field**

In `packages/config/src/schema.ts`, next to the OIDC vars:

```typescript
    // Internal (back-channel) JWKS URL. When set, the app fetches signing keys from this
    // docker-network URL instead of via discovery on the public issuer (which may sit behind
    // the gateway with a self-signed cert). Issuer CLAIM validation still uses OIDC_ISSUER_URL.
    OIDC_INTERNAL_JWKS_URL: z.string().url().optional(),
```

- [ ] **Step 2: Pass it through in bootstrap**

In `packages/bootstrap/src/index.ts`, extend the `createAuth({...})` call:

```typescript
  const auth = createAuth({
    issuerUrl: cfg.OIDC_ISSUER_URL,
    audience: cfg.OIDC_AUDIENCE,
    internalJwksUrl: cfg.OIDC_INTERNAL_JWKS_URL,
    adminClientId: cfg.KEYCLOAK_ADMIN_CLIENT_ID,
    adminClientSecret: cfg.KEYCLOAK_ADMIN_CLIENT_SECRET,
  });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C packages/config typecheck && pnpm -C packages/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/config/src/schema.ts packages/bootstrap/src/index.ts
git commit -m "feat(config): OIDC_INTERNAL_JWKS_URL wired to the auth adapter"
```

---

## Group 2 — Studio under `/studio`

### Task 3: Vite base + router basename

**Files:**
- Modify: `apps/studio/vite.config.ts`
- Modify: `apps/studio/src/main.tsx`

- [ ] **Step 1: Set the Vite base**

In `apps/studio/vite.config.ts`, add `base: '/studio/'` to the returned config object (keep the existing dev `/api` proxy):

```typescript
export default defineConfig(({ mode }) => ({
  base: '/studio/',
  plugins: [react(), tailwindcss()],
  // ...unchanged...
}));
```

- [ ] **Step 2: Set the router basename**

In `apps/studio/src/main.tsx`:

```typescript
    <BrowserRouter basename="/studio">
```

- [ ] **Step 3: Build to verify base is applied**

Run: `pnpm -C apps/studio build`
Expected: build succeeds; `apps/studio/dist/index.html` references assets under `/studio/assets/...`.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/vite.config.ts apps/studio/src/main.tsx
git commit -m "feat(studio): serve under /studio base (vite base + router basename)"
```

### Task 4: OIDC redirect + callback path under `/studio`

**Files:**
- Modify: `apps/studio/src/auth/oidc.ts`
- Modify: `apps/studio/src/auth/AuthProvider.tsx`

- [ ] **Step 1: Update redirect URIs**

In `apps/studio/src/auth/oidc.ts`, the app now lives under `/studio`; `window.location.origin` does NOT include the base path, so append it explicitly:

```typescript
    redirect_uri: `${window.location.origin}/studio/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/studio`,
```

- [ ] **Step 2: Update the AuthProvider callback-path guard**

In `apps/studio/src/auth/AuthProvider.tsx`, the "don't double-redirect on the callback route" check must match the new path:

```typescript
      if (location.pathname === '/studio/auth/callback') { if (active) setLoading(false); return; }
```

> Note: `location.pathname` here comes from react-router's `useLocation()`. With `basename="/studio"`, react-router STRIPS the basename from `location.pathname` (so routes see `/auth/callback`). **Verify which value `AuthProvider` reads:** if it uses react-router's `useLocation()`, keep `'/auth/callback'`; if it reads `window.location.pathname`, use `'/studio/auth/callback'`. Match reality — check the import at the top of `AuthProvider.tsx`. The `App.tsx` route stays `<Route path="/auth/callback">` (basename-relative). Only the OIDC `redirect_uri` (a full browser URL, not router-relative) needs the `/studio` prefix.

- [ ] **Step 3: Build**

Run: `pnpm -C apps/studio build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/auth/oidc.ts apps/studio/src/auth/AuthProvider.tsx
git commit -m "feat(studio): OIDC redirect_uri + callback under /studio"
```

### Task 5: server serves the studio SPA under `/studio`

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts` (if it asserts SPA-at-root behavior)

- [ ] **Step 1: Write/adjust the failing test**

In `apps/server/src/app.test.ts`, add (or adjust) a test asserting the SPA is served under `/studio` and non-`/api`, non-`/studio` paths are NOT served the SPA (they belong to the landing container now). If the file has an existing "serves index.html at /" test, update it. Minimal new assertion (uses the existing `buildApp`/`ctxWith` harness in that file; set `WEB_DIST_DIR` to a temp dir containing an `index.html`):

```typescript
it('serves the studio SPA under /studio and 404s unknown non-/studio non-/api paths', async () => {
  // WEB_DIST_DIR points at a temp dir with index.html (see harness setup in this file)
  const app = buildApp(ctxWith());
  await app.ready();
  const studio = await app.inject({ method: 'GET', url: '/studio/dashboard' });
  expect(studio.statusCode).toBe(200);          // SPA fallback
  const api = await app.inject({ method: 'GET', url: '/api/nope' });
  expect(api.statusCode).toBe(404);
  const root = await app.inject({ method: 'GET', url: '/' });
  expect(root.statusCode).toBe(404);            // landing owns '/', not the app
});
```

(Match the file's existing WEB_DIST_DIR/temp-dir setup; if none exists, mirror how other app.test.ts cases stub the SPA dir. If wiring a real temp dir is heavy, assert only the `/api` 404 + `/studio/*` fallback and skip the `/` case with a comment.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/server test -- app.test`
Expected: FAIL (SPA currently served at `/`, `/` returns 200).

- [ ] **Step 3: Serve under `/studio`**

In `apps/server/src/app.ts`, change the static block to mount the SPA under a `/studio` prefix and scope the fallback to `/studio`:

```typescript
  const webDist = process.env.WEB_DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../studio/dist');
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist, prefix: '/studio/' });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      // API 404s are JSON; studio client-routes fall back to the SPA shell; everything else 404s
      // (the landing container owns '/').
      if (url.startsWith('/api')) { void reply.code(404).send({ error: 'not found' }); return; }
      if (url.startsWith('/studio')) { void reply.sendFile('index.html', webDist); return; }
      void reply.code(404).send({ error: 'not found' });
    });
  }
```

(Confirm `fastifyStatic`'s `sendFile(filename, rootPath)` signature in the installed version; if `reply.sendFile('index.html')` already resolves against the registered root, drop the second arg. Keep behavior: `/studio/*` → SPA shell.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C apps/server test -- app.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts
git commit -m "feat(server): serve the studio SPA under /studio (landing owns /)"
```

---

## Group 3 — Landing container + prod compose

### Task 6: build the landing site into a container image

**Files:**
- Create: `apps/web/Dockerfile`
- Modify: `Dockerfile` (root) — no change to the app image; the landing gets its own image

- [ ] **Step 1: Landing Dockerfile**

Create `apps/web/Dockerfile` — a build stage that builds `@openldr/web` from the monorepo, then serves the static `dist` with `nginx:alpine`:

```dockerfile
# syntax=docker/dockerfile:1
# ---- build the landing SPA (@openldr/web) ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/web

# ---- serve the static site ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Landing is a static SPA served at container root; the outer gateway proxies '/' here.
EXPOSE 80
```

(Build context is the repo root so pnpm workspace resolves. The landing is served at the container's `/`; the gateway maps `HOST/` → `landing:80`.)

- [ ] **Step 2: Verify the landing builds**

Run: `pnpm -C apps/web build`
Expected: `apps/web/dist/index.html` produced. (Docker build itself is exercised in Task 20's manual acceptance.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "feat(web): landing container image (nginx static)"
```

### Task 7: rewrite `docker-compose.prod.yml` — landing service + unexpose ports

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add the landing service, gateway port vars, and drop backing-service host ports**

Rewrite `docker-compose.prod.yml` so ONLY nginx publishes host ports; add the `landing` service; parametrize gateway ports:

```yaml
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

  landing:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    expose: ["80"]
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    environment:
      SERVER_NAME: ${SERVER_NAME:-localhost}
    ports:
      - "${GATEWAY_HTTP_PORT:-80}:80"
      - "${GATEWAY_HTTPS_PORT:-443}:443"
    volumes:
      - ./deploy/nginx/openldr.conf.template:/etc/nginx/templates/default.conf.template:ro
      - ./deploy/nginx/certs:/etc/nginx/certs:ro
    depends_on: ["app", "landing", "keycloak"]
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
      - ./scripts/init-target-db.sql:/docker-entrypoint-initdb.d/10-init-target-db.sql:ro
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
      until mc alias set local http://minio:9000 ${S3_ACCESS_KEY_ID:-minioadmin} ${S3_SECRET_ACCESS_KEY:-minioadmin}; do echo 'waiting for minio'; sleep 2; done &&
      mc mb --ignore-existing local/${S3_BUCKET:-openldr} &&
      echo 'bucket ready'"

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm --http-relative-path=/auth
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KEYCLOAK_ADMIN:-admin}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-admin}
      KC_HOSTNAME: ${KC_HOSTNAME:-http://localhost/auth}
      KC_HTTP_ENABLED: "true"
      KC_PROXY_HEADERS: xforwarded
    volumes:
      - ./infra/keycloak/openldr-realm.json:/opt/keycloak/data/import/openldr-realm.json:ro
    expose: ["8080"]
    restart: unless-stopped

volumes:
  pgdata:
  miniodata:
```

Note: `keycloak` loses `ports:` (now `expose:` only), runs under relative path `/auth`, and gets `KC_HOSTNAME`/`KC_PROXY_HEADERS`. The realm volume is swapped to the rendered template output in Task 9 (the wizard writes `infra/keycloak/openldr-realm.json` from the template).

- [ ] **Step 2: Validate compose parses**

Run: `SERVER_NAME=localhost docker compose -f docker-compose.prod.yml config >/dev/null && echo OK`
Expected: `OK` (no YAML/interpolation errors). If docker isn't available in this environment, skip and validate in Task 20.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(deploy): prod compose — landing service, unexpose backing ports, keycloak under /auth"
```

---

## Group 4 — nginx path map + Keycloak `/auth` + realm template + env

### Task 8: nginx path routing

**Files:**
- Modify: `deploy/nginx/openldr.conf.template`

- [ ] **Step 1: Rewrite the 443 server block with the path map**

Replace the single `location /` with the path map (keep the 80→443 redirect, TLS, headers, gzip, body size). Add a shared proxy header snippet:

```nginx
server {
    listen 80 default_server;
    server_name ${SERVER_NAME};
    # ACME http-01 challenge for Let's Encrypt (certbot webroot); everything else → https.
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl default_server;
    server_name ${SERVER_NAME};

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 50m;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";
    proxy_read_timeout 120s;

    location /        { proxy_pass http://landing:80; }
    location /studio  { proxy_pass http://app:3000; }
    location /api      { proxy_pass http://app:3000; }
    location = /health { proxy_pass http://app:3000/health; }
    location /auth     { proxy_pass http://keycloak:8080; }
}
```

- [ ] **Step 2: Commit**

```bash
git add deploy/nginx/openldr.conf.template
git commit -m "feat(nginx): path map (landing / studio / api / auth) + ACME challenge location"
```

### Task 9: realm import template + `realm-render` unit

**Files:**
- Create: `infra/keycloak/openldr-realm.json.template`
- Create: `scripts/init/realm-render.mjs`
- Create: `scripts/init/realm-render.test.mjs`

- [ ] **Step 1: Create the realm template**

Copy `infra/keycloak/openldr-realm.json` to `infra/keycloak/openldr-realm.json.template` and change the `openldr-web` client so `redirectUris`/`webOrigins`/`post.logout.redirect.uris` reference `${PUBLIC_ORIGIN}`:

```json
      "redirectUris": ["${PUBLIC_ORIGIN}/studio/*"],
      "webOrigins": ["${PUBLIC_ORIGIN}"],
      "attributes": {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": "${PUBLIC_ORIGIN}/studio"
      },
```

(Leave the rest of the realm identical to the current file.)

- [ ] **Step 2: Write the failing test**

Create `scripts/init/realm-render.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { renderRealm } from './realm-render.mjs';

describe('renderRealm', () => {
  it('substitutes ${PUBLIC_ORIGIN} in redirectUris/webOrigins', () => {
    const tpl = '{"clients":[{"redirectUris":["${PUBLIC_ORIGIN}/studio/*"],"webOrigins":["${PUBLIC_ORIGIN}"]}]}';
    const out = renderRealm(tpl, 'https://lab.example.org');
    const parsed = JSON.parse(out);
    expect(parsed.clients[0].redirectUris).toEqual(['https://lab.example.org/studio/*']);
    expect(parsed.clients[0].webOrigins).toEqual(['https://lab.example.org']);
    expect(out).not.toContain('${PUBLIC_ORIGIN}');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run scripts/init/realm-render.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

Create `scripts/init/realm-render.mjs`:

```javascript
/** Replace every ${PUBLIC_ORIGIN} occurrence in a realm-import template string. */
export function renderRealm(templateText, publicOrigin) {
  return templateText.split('${PUBLIC_ORIGIN}').join(publicOrigin);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run scripts/init/realm-render.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/keycloak/openldr-realm.json.template scripts/init/realm-render.mjs scripts/init/realm-render.test.mjs
git commit -m "feat(init): keycloak realm template + realm-render (PUBLIC_ORIGIN redirect)"
```

### Task 10: `.env.prod.example` new vars

**Files:**
- Modify: `.env.prod.example`

- [ ] **Step 1: Update the auth + gateway section**

Replace the SERVER_NAME + OIDC block with the gateway-era vars (keep secrets/other keys). Set the issuer to the proxied `/auth` path and add the new vars:

```
# --- Gateway / public addressing (set by `pnpm run init`) ---
SERVER_NAME=localhost
PUBLIC_ORIGIN=https://localhost
GATEWAY_HTTP_PORT=80
GATEWAY_HTTPS_PORT=443
TLS_MODE=self-signed
# LETSENCRYPT_EMAIL=ops@example.org   # required when TLS_MODE=letsencrypt

# --- Auth (Keycloak proxied under /auth) ---
# Public issuer (browser + issuer-claim validation). Internal JWKS is fetched over the
# docker network so the app needs no trust of the gateway's (possibly self-signed) cert.
OIDC_ISSUER_URL=https://localhost/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=https://localhost/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=admin
```

Remove the old `OIDC_ISSUER_URL=http://host.docker.internal:8180/...` line and the long "REAL single-port SSO … documented follow-up" comment (that follow-up is now DONE).

- [ ] **Step 2: Commit**

```bash
git add .env.prod.example
git commit -m "docs(env): gateway + proxied-Keycloak env vars in .env.prod.example"
```

---

## Group 5 — Wizard pure units (TDD)

### Task 11: `host-detect`

**Files:**
- Create: `scripts/init/host-detect.mjs`, `scripts/init/host-detect.test.mjs`

- [ ] **Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { formatIpChoices, isValidFqdn } from './host-detect.mjs';

describe('host-detect', () => {
  it('formats non-internal IPv4 interfaces into {name, address} choices', () => {
    const fake = {
      eth0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
      lo:   [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      wg0:  [{ family: 'IPv6', address: 'fe80::1', internal: false }],
    };
    expect(formatIpChoices(fake)).toEqual([{ name: 'eth0', address: '192.168.1.20' }]);
  });
  it('validates FQDNs', () => {
    expect(isValidFqdn('lab.example.org')).toBe(true);
    expect(isValidFqdn('localhost')).toBe(true);
    expect(isValidFqdn('bad_host')).toBe(false);
    expect(isValidFqdn('http://x.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm exec vitest run scripts/init/host-detect.test.mjs`

- [ ] **Step 3: Implement**

```javascript
import { networkInterfaces } from 'node:os';

/** Non-internal IPv4 addresses as [{name, address}], from an os.networkInterfaces()-shaped map. */
export function formatIpChoices(ifaces = networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

/** Accept hostnames/FQDNs (labels of a-z0-9-, no scheme/path). */
export function isValidFqdn(s) {
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s);
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/init/host-detect.mjs scripts/init/host-detect.test.mjs
git commit -m "feat(init): host-detect (ip enumeration + fqdn validation)"
```

### Task 12: `port-check`

**Files:**
- Create: `scripts/init/port-check.mjs`, `scripts/init/port-check.test.mjs`

- [ ] **Step 1: Failing test** (binds a real port, then checks it's reported busy; a likely-free high port is free)

```javascript
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:net';
import { isPortFree } from './port-check.mjs';

let srv;
afterEach(() => { if (srv) srv.close(); srv = undefined; });

describe('isPortFree', () => {
  it('true for an unbound port, false for a bound one', async () => {
    await new Promise((res) => { srv = createServer().listen(0, '127.0.0.1', res); });
    const busy = srv.address().port;
    expect(await isPortFree(busy)).toBe(false);
    srv.close(); srv = undefined;
    expect(await isPortFree(busy)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```javascript
import { createServer } from 'node:net';

/** Resolve true if `port` can be bound on 0.0.0.0, false if in use. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`scripts/init/port-check.*`, message `feat(init): port-check (isPortFree)`).

### Task 13: `config-compute`

**Files:**
- Create: `scripts/init/config-compute.mjs`, `scripts/init/config-compute.test.mjs`

- [ ] **Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { computeEnv } from './config-compute.mjs';

describe('computeEnv', () => {
  it('derives origin/issuer/jwks/redirect for a domain on 443', () => {
    const e = computeEnv({ host: 'lab.example.org', tlsMode: 'letsencrypt', httpPort: 80, httpsPort: 443, email: 'ops@example.org' });
    expect(e.SERVER_NAME).toBe('lab.example.org');
    expect(e.PUBLIC_ORIGIN).toBe('https://lab.example.org');
    expect(e.OIDC_ISSUER_URL).toBe('https://lab.example.org/auth/realms/openldr');
    expect(e.OIDC_INTERNAL_JWKS_URL).toBe('http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs');
    expect(e.KC_HOSTNAME).toBe('https://lab.example.org/auth');
    expect(e.TLS_MODE).toBe('letsencrypt');
    expect(e.LETSENCRYPT_EMAIL).toBe('ops@example.org');
  });
  it('includes the port in the origin when https != 443', () => {
    const e = computeEnv({ host: '192.168.1.20', tlsMode: 'self-signed', httpPort: 8080, httpsPort: 8443 });
    expect(e.PUBLIC_ORIGIN).toBe('https://192.168.1.20:8443');
    expect(e.OIDC_ISSUER_URL).toBe('https://192.168.1.20:8443/auth/realms/openldr');
    expect(e.LETSENCRYPT_EMAIL).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```javascript
/** answers -> flat env map (only gateway/auth keys; secrets untouched). */
export function computeEnv({ host, tlsMode, httpPort, httpsPort, email }) {
  const origin = httpsPort === 443 ? `https://${host}` : `https://${host}:${httpsPort}`;
  const env = {
    SERVER_NAME: host,
    PUBLIC_ORIGIN: origin,
    GATEWAY_HTTP_PORT: String(httpPort),
    GATEWAY_HTTPS_PORT: String(httpsPort),
    TLS_MODE: tlsMode,
    OIDC_ISSUER_URL: `${origin}/auth/realms/openldr`,
    OIDC_INTERNAL_JWKS_URL: 'http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs',
    OIDC_WEB_CLIENT_ID: 'openldr-web',
    KC_HOSTNAME: `${origin}/auth`,
  };
  if (tlsMode === 'letsencrypt' && email) env.LETSENCRYPT_EMAIL = email;
  return env;
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** (message `feat(init): config-compute (answers → env)`).

### Task 14: `env-merge`

**Files:**
- Create: `scripts/init/env-merge.mjs`, `scripts/init/env-merge.test.mjs`

- [ ] **Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { mergeEnv } from './env-merge.mjs';

describe('mergeEnv', () => {
  it('updates existing keys in place, appends new ones, preserves comments/secrets/order', () => {
    const existing = [
      '# secrets below',
      'POSTGRES_PASSWORD=s3cret',
      'SERVER_NAME=localhost',
      '',
      '# trailing note',
    ].join('\n');
    const out = mergeEnv(existing, { SERVER_NAME: 'lab.example.org', PUBLIC_ORIGIN: 'https://lab.example.org' });
    expect(out).toContain('POSTGRES_PASSWORD=s3cret');       // secret preserved
    expect(out).toContain('SERVER_NAME=lab.example.org');    // updated in place
    expect(out).not.toContain('SERVER_NAME=localhost');
    expect(out).toContain('PUBLIC_ORIGIN=https://lab.example.org'); // appended
    expect(out).toContain('# trailing note');                // comment preserved
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```javascript
/** Merge `updates` (key→value) into an existing .env text. Existing keys are replaced in
 *  place; unknown keys/comments/blank lines are preserved; new keys are appended. */
export function mergeEnv(existingText, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = (existingText ? existingText.split('\n') : []).map((line) => {
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m && remaining.has(m[2])) {
      const v = remaining.get(m[2]); remaining.delete(m[2]);
      return `${m[1]}${m[2]}=${v}`;
    }
    return line;
  });
  const appended = [...remaining.entries()].map(([k, v]) => `${k}=${v}`);
  const body = lines.join('\n').replace(/\n*$/, '');
  return (appended.length ? `${body}\n${appended.join('\n')}` : body) + '\n';
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** (message `feat(init): env-merge (in-place update, preserve secrets)`).

---

## Group 6 — Cert modes, launch/verify, orchestrator

### Task 15: `certs` (mode dispatch)

**Files:**
- Create: `scripts/init/certs.mjs`, `scripts/init/certs.test.mjs`

- [ ] **Step 1: Failing test** (test the pure command-planning, not actual openssl/certbot execution — the module returns a plan the orchestrator runs, so it's testable)

```javascript
import { describe, it, expect } from 'vitest';
import { planCerts } from './certs.mjs';

describe('planCerts', () => {
  it('self-signed → openssl command with the host CN', () => {
    const p = planCerts({ tlsMode: 'self-signed', host: 'lab.example.org' });
    expect(p.kind).toBe('exec');
    expect(p.command).toContain('openssl');
    expect(p.command).toContain('CN=lab.example.org');
  });
  it('byo → copy the provided cert/key', () => {
    const p = planCerts({ tlsMode: 'byo', certPath: '/tmp/f.pem', keyPath: '/tmp/k.pem' });
    expect(p.kind).toBe('copy');
    expect(p.files).toEqual([{ from: '/tmp/f.pem', to: 'deploy/nginx/certs/fullchain.pem' }, { from: '/tmp/k.pem', to: 'deploy/nginx/certs/privkey.pem' }]);
  });
  it('letsencrypt → certbot profile marker with domain+email', () => {
    const p = planCerts({ tlsMode: 'letsencrypt', host: 'lab.example.org', email: 'ops@example.org' });
    expect(p.kind).toBe('certbot');
    expect(p.domain).toBe('lab.example.org');
    expect(p.email).toBe('ops@example.org');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (pure planner; the orchestrator executes the plan)

```javascript
const CERT_DIR = 'deploy/nginx/certs';

/** Return a cert-provisioning plan for the chosen TLS mode. The orchestrator executes it. */
export function planCerts({ tlsMode, host, email, certPath, keyPath }) {
  if (tlsMode === 'self-signed') {
    return {
      kind: 'exec',
      command: `openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout ${CERT_DIR}/privkey.pem -out ${CERT_DIR}/fullchain.pem -subj "/CN=${host}" -addext "subjectAltName=DNS:${host},DNS:localhost,IP:127.0.0.1"`,
    };
  }
  if (tlsMode === 'byo') {
    return { kind: 'copy', files: [{ from: certPath, to: `${CERT_DIR}/fullchain.pem` }, { from: keyPath, to: `${CERT_DIR}/privkey.pem` }] };
  }
  if (tlsMode === 'letsencrypt') {
    return { kind: 'certbot', domain: host, email };
  }
  throw new Error(`unknown tlsMode: ${tlsMode}`);
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** (message `feat(init): certs planner (self-signed / byo / certbot)`).

### Task 16: `launch` + `verify`

**Files:**
- Create: `scripts/init/launch.mjs`, `scripts/init/verify.mjs`, `scripts/init/verify.test.mjs`

- [ ] **Step 1: Failing test for the pure bits of `verify` (URL building + status interpretation)**

```javascript
import { describe, it, expect } from 'vitest';
import { healthUrl, isHealthy } from './verify.mjs';

describe('verify helpers', () => {
  it('builds the gateway health url (omits :443)', () => {
    expect(healthUrl('https://lab.example.org', 443)).toBe('https://lab.example.org/health');
    expect(healthUrl('https://192.168.1.20:8443', 8443)).toBe('https://192.168.1.20:8443/health');
  });
  it('treats non-"down" status as healthy', () => {
    expect(isHealthy({ status: 'up' })).toBe(true);
    expect(isHealthy({ status: 'degraded' })).toBe(true);
    expect(isHealthy({ status: 'down' })).toBe(false);
    expect(isHealthy(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `verify.mjs`** (pure helpers + a poll that uses them; poll tolerates self-signed via an https agent)

```javascript
import { request } from 'node:https';

export function healthUrl(publicOrigin, httpsPort) {
  return httpsPort === 443 ? `${publicOrigin}/health` : `${publicOrigin}/health`;
}
export function isHealthy(body) {
  return !!body && typeof body.status === 'string' && body.status !== 'down';
}
/** Poll the gateway /health (accepting self-signed) until healthy or timeout. */
export async function pollHealth(url, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await fetchJsonInsecure(url).catch(() => null);
    if (isHealthy(body)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
function fetchJsonInsecure(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { rejectUnauthorized: false }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}
```

(Note: `Date.now()`/`setTimeout` are fine here — the workflow-script sandbox restriction does NOT apply to ordinary Node scripts.)

- [ ] **Step 4: Implement `launch.mjs`**

```javascript
import { spawnSync } from 'node:child_process';

/** Bring the prod stack up (build + detached). Returns the exit code. */
export function launchStack() {
  const r = spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yml', 'up', '-d', '--build'], { stdio: 'inherit' });
  return r.status ?? 1;
}
```

- [ ] **Step 5: Run → PASS. Step 6: Commit** (`scripts/init/launch.mjs scripts/init/verify.mjs scripts/init/verify.test.mjs`, message `feat(init): launch + verify (compose up + health poll)`).

### Task 17: the `pnpm run init` orchestrator

**Files:**
- Create: `scripts/init.mjs`
- Modify: `package.json` (script + `@inquirer/prompts` devDependency)

- [ ] **Step 1: Add the dep + script**

Add to root `package.json` `scripts`: `"init": "node scripts/init.mjs"`. Add `@inquirer/prompts` to `devDependencies` (confirm the latest 2.x/5.x that supports `select`/`input`/`confirm`; run `pnpm add -D -w @inquirer/prompts`). If a dep is undesirable, use Node's built-in `readline/promises` with a hand-rolled select — but prefer `@inquirer/prompts` for the IP pick-list UX.

- [ ] **Step 2: Write the orchestrator** (thin; composes the tested units)

Create `scripts/init.mjs`:

```javascript
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { select, input, confirm } from '@inquirer/prompts';
import { formatIpChoices, isValidFqdn } from './init/host-detect.mjs';
import { isPortFree } from './init/port-check.mjs';
import { computeEnv } from './init/config-compute.mjs';
import { mergeEnv } from './init/env-merge.mjs';
import { renderRealm } from './init/realm-render.mjs';
import { planCerts } from './init/certs.mjs';
import { launchStack } from './init/launch.mjs';
import { healthUrl, pollHealth } from './init/verify.mjs';

async function askPort(label, def) {
  for (;;) {
    const v = Number(await input({ message: `${label} port`, default: String(def) }));
    if (!Number.isInteger(v) || v < 1 || v > 65535) { console.log('  invalid port'); continue; }
    if (!(await isPortFree(v))) { const go = await confirm({ message: `port ${v} looks busy — use it anyway?`, default: false }); if (!go) continue; }
    return v;
  }
}

async function main() {
  const kind = await select({ message: 'Address the server by', choices: [{ name: 'IP', value: 'ip' }, { name: 'Domain', value: 'domain' }] });
  let host;
  if (kind === 'ip') {
    const choices = formatIpChoices();
    host = await select({ message: 'Which address?', choices: [...choices.map((c) => ({ name: `${c.address} (${c.name})`, value: c.address })), { name: 'enter manually', value: '__manual__' }] });
    if (host === '__manual__') host = await input({ message: 'IP address' });
  } else {
    host = await input({ message: 'Domain (FQDN)', validate: (s) => isValidFqdn(s) || 'invalid hostname' });
  }
  const tlsMode = await select({ message: 'TLS', choices: [{ name: 'Self-signed (lab/internal)', value: 'self-signed' }, { name: "Let's Encrypt (public domain)", value: 'letsencrypt' }, { name: 'Bring your own cert', value: 'byo' }] });
  let email, certPath, keyPath;
  if (tlsMode === 'letsencrypt') email = await input({ message: 'Email for Let’s Encrypt' });
  if (tlsMode === 'byo') { certPath = await input({ message: 'fullchain cert path' }); keyPath = await input({ message: 'private key path' }); }
  const httpPort = await askPort('HTTP', 80);
  const httpsPort = await askPort('HTTPS', 443);

  const env = computeEnv({ host, tlsMode, httpPort, httpsPort, email });

  // .env.prod (create from example on first run, then merge)
  if (!existsSync('.env.prod')) copyFileSync('.env.prod.example', '.env.prod');
  writeFileSync('.env.prod', mergeEnv(readFileSync('.env.prod', 'utf8'), env));

  // rendered realm import
  mkdirSync('deploy/nginx/certs', { recursive: true });
  writeFileSync('infra/keycloak/openldr-realm.json', renderRealm(readFileSync('infra/keycloak/openldr-realm.json.template', 'utf8'), env.PUBLIC_ORIGIN));

  // certs
  const plan = planCerts({ tlsMode, host, email, certPath, keyPath });
  if (plan.kind === 'exec') execSync(plan.command, { stdio: 'inherit' });
  else if (plan.kind === 'copy') for (const f of plan.files) copyFileSync(f.from, f.to);
  else if (plan.kind === 'certbot') console.log('  Let’s Encrypt: bringing up the certbot profile — ensure DNS for', plan.domain, 'points here and port 80 is reachable.');

  console.log('\nLaunching the stack…');
  const code = launchStack();
  if (code !== 0) { console.error('docker compose up failed — see the output above.'); process.exit(code); }

  console.log('Waiting for /health…');
  const ok = await pollHealth(healthUrl(env.PUBLIC_ORIGIN, httpsPort));
  console.log(ok ? `\n✅ up.\n  landing: ${env.PUBLIC_ORIGIN}/\n  studio:  ${env.PUBLIC_ORIGIN}/studio\n  keycloak admin: ${env.PUBLIC_ORIGIN}/auth/admin` : '\n⚠ health did not go green in time — check `docker compose -f docker-compose.prod.yml logs`.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

(For the certbot profile: launching it fully is an integration detail — v1 prints guidance and relies on the certbot compose profile from Task 18. The self-signed + byo paths are fully automated.)

- [ ] **Step 3: Smoke — help/parse only (no docker)**

Run: `node -e "import('./scripts/init.mjs').catch(e=>{console.error(e);process.exit(1)})"` is interactive; instead verify the module imports its units without throwing at load: `node --input-type=module -e "import './scripts/init/config-compute.mjs'; import './scripts/init/env-merge.mjs'; import './scripts/init/realm-render.mjs'; console.log('units load')"`
Expected: `units load`.

- [ ] **Step 4: Commit**

```bash
git add scripts/init.mjs package.json pnpm-lock.yaml
git commit -m "feat(init): pnpm run init orchestrator (host/TLS/ports → config → launch → verify)"
```

---

## Group 7 — certbot profile, docs/installer ripple, acceptance

### Task 18: Let's Encrypt certbot profile

**Files:**
- Modify: `docker-compose.prod.yml` (add a `certbot` service under a `letsencrypt` profile + a shared certs volume mount for the webroot)

- [ ] **Step 1: Add the certbot service (profile-gated)**

Append to `docker-compose.prod.yml`:

```yaml
  certbot:
    image: certbot/certbot:latest
    profiles: ["letsencrypt"]
    volumes:
      - ./deploy/nginx/certs:/etc/letsencrypt/live-out
      - certbot-www:/var/www/certbot
    entrypoint: /bin/sh -c "trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot; sleep 12h & wait $${!}; done"
```

Add `certbot-www:` to the `volumes:` block, and mount `certbot-www:/var/www/certbot` on the `nginx` service (matching the ACME `root /var/www/certbot;` location from Task 8). Document that first issuance for a new domain runs `docker compose -f docker-compose.prod.yml --profile letsencrypt run --rm certbot certonly --webroot -w /var/www/certbot -d $SERVER_NAME --email $LETSENCRYPT_EMAIL --agree-tos -n` and the resulting cert is symlinked/copied to `deploy/nginx/certs/{fullchain,privkey}.pem`.

> The exact certbot↔nginx cert-path wiring (letsencrypt `live/<domain>/` → `deploy/nginx/certs`) is finalized during the live demo-host acceptance (Task 20 item 3); v1 documents the commands. Self-signed + byo are fully automated by the wizard.

- [ ] **Step 2: Validate compose parses**

Run: `SERVER_NAME=localhost docker compose -f docker-compose.prod.yml --profile letsencrypt config >/dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(deploy): certbot profile for Let's Encrypt TLS"
```

### Task 19: docs + installer ripple

**Files:**
- Modify: `docs/DEPLOYMENT.md`, `docs/CONFIGURATION.md`
- Modify: `deploy/install/docker-compose.yml`
- Modify: `install/install.sh`, `install/install.ps1`

- [ ] **Step 1: Update DEPLOYMENT.md**

Replace the single-port topology description + the `:8180` Keycloak diagram with the path-based gateway (landing `/`, studio `/studio`, api `/api`, keycloak `/auth`), the unexposed backing services, and the `pnpm run init` quickstart (IP/domain → TLS mode → ports → up). Document the three TLS modes + the Let's Encrypt first-issuance command.

- [ ] **Step 2: Update CONFIGURATION.md**

Document the new env vars (`PUBLIC_ORIGIN`, `GATEWAY_HTTP_PORT`/`_HTTPS_PORT`, `TLS_MODE`, `LETSENCRYPT_EMAIL`, `OIDC_INTERNAL_JWKS_URL`, `KC_HOSTNAME`) and that `OIDC_ISSUER_URL` now points at `/auth`. Note `pnpm run init` writes these.

- [ ] **Step 3: Mirror the compose changes into the installer stack**

Update `deploy/install/docker-compose.yml` the same way as `docker-compose.prod.yml` (landing service via the published landing image or a build note, unexpose keycloak, KC env, gateway port vars). Since the installer uses `image: ghcr.io/...`, add a `landing` service pointing at a published landing image `ghcr.io/fmwasekaga/openldr-landing:${OPENLDR_VERSION:-latest}` (note in docs that the landing image must be published alongside the app image).

- [ ] **Step 4: De-hardcode the install scripts**

In `install/install.sh` + `install/install.ps1`, stop writing `SERVER_NAME=localhost` + the `:8180` OIDC issuer; instead either (a) write the new gateway defaults (localhost/self-signed/80/443 + the `/auth` issuer + internal JWKS), or (b) after scaffolding, print "run `pnpm run init` (or set SERVER_NAME/PUBLIC_ORIGIN) to configure the host". Keep the secret-generation logic. Match both scripts.

- [ ] **Step 5: Commit**

```bash
git add docs/DEPLOYMENT.md docs/CONFIGURATION.md deploy/install/docker-compose.yml install/install.sh install/install.ps1
git commit -m "docs(deploy): gateway topology + init wizard; ripple into installer stack + scripts"
```

### Task 20: full gate + manual acceptance

**Files:** none (verification only)

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm typecheck --force`
Expected: PASS across all packages (adapter-auth, config, bootstrap, server, studio, web).

- [ ] **Step 2: Affected unit suites**

Run: `pnpm -C packages/adapter-auth test && pnpm -C apps/server test && pnpm exec vitest run scripts/init`
Then isolated: `pnpm -C apps/studio test` (known parallel flake — re-run isolated).
Expected: all PASS.

- [ ] **Step 3: Studio + landing builds**

Run: `pnpm -C apps/studio build && pnpm -C apps/web build`
Expected: both succeed; studio assets under `/studio/`.

- [ ] **Step 4: Manual acceptance (document results)**

1. `pnpm run init` → IP/localhost + self-signed + ports 80/443 → stack up. Verify: `docker compose -f docker-compose.prod.yml ps` shows ONLY nginx publishing host ports (no 8180/5433/9010); `https://localhost/` = landing; `https://localhost/studio` loads under the base path; login round-trips through `/auth`; `https://localhost/health` green; the app validated the token via internal JWKS (check server logs — no discovery fetch to the public issuer).
2. Re-run `pnpm run init` with a different port (e.g. 8443) → `.env.prod` updated, secrets preserved, stack relaunched, URLs reflect `:8443`.
3. Let's Encrypt path on the real partner demo host (public domain) → run the documented certbot first-issuance → trusted cert, login round-trips.

- [ ] **Step 5: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore(gateway-init): gate green + acceptance fixes"
```

---

## Self-review notes (author checklist — applied)

- **Spec coverage:** topology/containers (T6-T7), path map (T8), Keycloak `/auth` + KC env (T7-T8), unexpose ports (T7), Option-2 split channel (T1-T2), studio `/studio` (T3-T5), realm template/redirect (T9), config surface (T10), wizard units (T9,T11-T14), cert modes (T15,T18), launch/verify (T16), orchestrator (T17), docs/installer ripple (T19), gate/acceptance (T20). ✔
- **Naming consistency:** `internalJwksUrl` (adapter) ↔ `OIDC_INTERNAL_JWKS_URL` (env); `computeEnv`/`mergeEnv`/`renderRealm`/`planCerts`/`formatIpChoices`/`isPortFree`/`pollHealth`/`healthUrl`/`launchStack`; env keys `PUBLIC_ORIGIN`/`SERVER_NAME`/`GATEWAY_HTTP_PORT`/`GATEWAY_HTTPS_PORT`/`TLS_MODE`/`KC_HOSTNAME` used identically across compute, compose, nginx, and docs. ✔
- **Known risks flagged inline:** the `jose` `customFetch` availability (Task 1 fallback to `keySet` injection); react-router basename stripping for the AuthProvider path check (Task 4); `fastifyStatic.sendFile` signature (Task 5); certbot↔nginx cert path finalized at live acceptance (Task 18/20). Each has a concrete fallback.
- **Gate caveat:** `pnpm typecheck --force`; server via typecheck+vitest (not `pnpm build`); studio test isolated.
