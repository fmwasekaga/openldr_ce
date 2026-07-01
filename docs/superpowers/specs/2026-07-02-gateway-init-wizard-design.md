# Single-Port Gateway + `pnpm run init` Wizard — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm)
**Origin:** Route all traffic through one nginx gateway on a single host (landing / studio / api / Keycloak), unexpose backing-service ports (docker-network only), make the OIDC issuer/redirect configurable, and add an interactive `pnpm run init` wizard that configures + launches + verifies the stack. Builds on the existing single-HTTPS-port prod stack (`docker-compose.prod.yml` + `deploy/nginx/openldr.conf.template`).

## Decisions (from brainstorm)

- **Scope:** ONE combined spec — gateway routing + Keycloak proxy + port unexposing + OIDC config + init wizard.
- **Serving:** separate containers per concern — a `landing` container (`apps/web`), an `app` container (fastify: studio SPA under `/studio` + `/api`), the `nginx` gateway, and backing services.
- **Addressing:** **path-based, single origin** — `HOST/`=landing, `HOST/studio`=studio, `HOST/api`=api, `HOST/auth`=Keycloak. One TLS cert. Works identically for localhost, an internal IP, or a public domain. No subdomains.
- **Keycloak token validation:** **Option 2 — split front/back channel.** Browser uses the public issuer `https://HOST/auth`; the app validates that issuer claim but fetches JWKS/token endpoints internally over `http://keycloak:8080/auth` (no cert-trust dependency; robust for self-signed/internal installs).
- **TLS:** wizard offers three modes — **self-signed** (lab/internal, default), **Let's Encrypt** (public partner demo/playground), **bring-your-own**.
- **Wizard (`pnpm run init`):** configure → launch → verify. Idempotent/re-runnable.

## Design

### 1. Container topology (prod compose)

Only `nginx` publishes host ports. Everything else is `expose:` only, reachable over the docker network by service DNS.

```
services:
  nginx    ports: [${GATEWAY_HTTP_PORT:-80}:80, ${GATEWAY_HTTPS_PORT:-443}:443]  → landing, app, keycloak
  landing  expose: [80]     # serves apps/web/dist (static)
  app      expose: [3000]   # fastify: studio SPA (/studio) + /api + auth callback
  postgres expose: [5432]   # was already unpublished in prod
  minio    expose: [9000,9001]
  keycloak expose: [8080]   # NO MORE 8180:8080 — reached at /auth
```

- **`landing`** — a lightweight static container serving `apps/web/dist`. Either `nginx:alpine` serving the built assets, or reuse the app's static-serving. Chosen: a minimal static image (own Dockerfile stage or an `nginx:alpine` with the dist mounted/copied). It has no API and no auth.
- **`app`** — the existing fastify server, unchanged in responsibility but now serving the studio SPA under the `/studio` base and `/api` under `/api`. Same origin for studio+api keeps auth same-site.
- **Dev vs prod:** the dev compose (`docker-compose.yml` / `.override.yml`) MAY keep publishing postgres/minio/keycloak ports for local debugging. The **prod** compose (`docker-compose.prod.yml`) unexposes them.

### 2. nginx gateway (`deploy/nginx/openldr.conf.template`)

One server block on 443 (with the 80→443 redirect kept), `server_name ${SERVER_NAME}`, existing security headers + `client_max_body_size 50m` + gzip preserved. Path map:

```
location /        { proxy_pass http://landing:80; }        # landing SPA/site
location /studio  { proxy_pass http://app:3000; }          # studio SPA (base /studio) + its assets
location /api      { proxy_pass http://app:3000; }          # REST API
location = /health { proxy_pass http://app:3000/health; }  # app health (used by the wizard verify)
location /auth     { proxy_pass http://keycloak:8080; }     # Keycloak (relative path /auth)
```

The app's existing health route is `/health` (not `/api/*`), so the gateway proxies that one exact path to the app; without it, `/health` would fall through to `location /` (landing).

- All proxied locations keep the `Host / X-Real-IP / X-Forwarded-For / X-Forwarded-Proto` + websocket `Upgrade/Connection` headers (Keycloak and the app both need correct `X-Forwarded-*` to emit correct URLs).
- `/studio` and `/api` go to the same `app` upstream; the SPA fallback for client-side routes under `/studio/*` is served by the app (see §4).
- Keycloak is served under the relative path `/auth` (via `KC_HTTP_RELATIVE_PATH=/auth`), so no path rewriting is needed — `HOST/auth/realms/...` maps straight through.

### 3. Keycloak behind the proxy (Option 2 — split front/back channel)

- **Keycloak config:** `KC_HOSTNAME=https://HOST/auth` (or `KC_HOSTNAME=HOST` + `KC_HOSTNAME_URL`), `KC_HTTP_RELATIVE_PATH=/auth`, `KC_PROXY_HEADERS=xforwarded`, `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`. This makes Keycloak advertise the public issuer `https://HOST/auth/realms/openldr` in tokens/discovery while accepting backchannel calls on its internal address.
- **App (fastify) config:**
  - `OIDC_ISSUER_URL=https://HOST/auth/realms/openldr` — the issuer claim the app validates.
  - **Internal JWKS/token URL** = `http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs` — the app fetches signing keys over the docker network, so it does NOT depend on nginx being up or on trusting the self-signed gateway cert.
  - **Implementation check (spike in plan):** confirm the app's current OIDC verification path (in the auth adapter / `auth-plugin`) can accept a JWKS URL distinct from the issuer. If the library only derives JWKS from the issuer via discovery, add a config seam for an explicit internal JWKS URL (or an internal discovery URL) — a small, well-bounded change. This is the one implementation risk and is verified first.
- **Browser flow:** studio redirects to `https://HOST/auth/realms/openldr/...`; Keycloak redirects back to `OIDC_WEB_REDIRECT=https://HOST/studio/auth/callback`.

### 4. Studio base-path (`/studio`)

Studio moves from `/` to `/studio`:
- **Build:** Vite `base: '/studio/'` (so asset URLs are `/studio/assets/...`).
- **Router:** React-Router `basename="/studio"`.
- **OIDC redirect/callback** paths become `/studio/auth/callback` (update the callback route + the `OIDC_WEB_REDIRECT`).
- **Server static mount:** the app serves the studio dist under `/studio` with an SPA fallback for `/studio/*` (adjust the existing `WEB_DIST_DIR` static registration + not-found handler to be `/studio`-scoped; `/api` 404s stay JSON).
- **Landing** stays at `/` and is a separate container, so no base-path change for it.

### 5. Config surface (env the wizard writes to `.env.prod`)

| Var | Example | Purpose |
|-----|---------|---------|
| `SERVER_NAME` | `lab.example.org` or `192.168.1.20` or `localhost` | nginx `server_name` + cert CN |
| `PUBLIC_ORIGIN` | `https://lab.example.org` | canonical external origin |
| `GATEWAY_HTTP_PORT` / `GATEWAY_HTTPS_PORT` | `80` / `443` | host ports nginx publishes |
| `OIDC_ISSUER_URL` | `https://lab.example.org/auth/realms/openldr` | public issuer (claim validation) |
| `OIDC_INTERNAL_JWKS_URL` *(new)* | `http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs` | app-side key fetch (Option 2) |
| `OIDC_WEB_REDIRECT` | `https://lab.example.org/studio/auth/callback` | post-login redirect |
| `KC_HOSTNAME` | `https://lab.example.org/auth` | Keycloak advertised hostname |
| `TLS_MODE` | `self-signed` \| `letsencrypt` \| `byo` | drives cert provisioning |
| `LETSENCRYPT_EMAIL` | `ops@example.org` | certbot registration (letsencrypt mode) |

Secrets already in `.env.prod` (POSTGRES_PASSWORD, S3 keys, KEYCLOAK_ADMIN*, SECRETS_ENCRYPTION_KEY, etc.) are **preserved** on re-run.

### 6. Keycloak realm redirect (the "configurable OIDC redirect")

The realm import currently hard-codes client `redirectUris`/`webOrigins`. To make it host-configurable deterministically (no post-boot admin call):
- Add `infra/keycloak/openldr-realm.json.template` with `${PUBLIC_ORIGIN}` placeholders in the openldr client's `redirectUris` (`${PUBLIC_ORIGIN}/studio/*`) and `webOrigins` (`${PUBLIC_ORIGIN}`).
- The wizard renders it to `infra/keycloak/openldr-realm.json` (envsubst-style) before launch, so `--import-realm` loads a client that trusts the chosen host.
- Idempotent: re-running with a new host re-renders + re-imports (on a fresh realm) — for an existing realm, document that the operator re-imports or the wizard patches via admin API (admin-API patch is a possible enhancement, not required for v1).

### 7. The `pnpm run init` wizard (`scripts/init.mjs`)

Interactive Node CLI, runs on the deployment host, idempotent (reads existing `.env.prod` for defaults, preserves secrets).

**Steps:**
1. **Host** — prompt *IP or Domain*.
   - IP → enumerate `os.networkInterfaces()` (IPv4, non-internal), present a pick-list + "enter manually".
   - Domain → prompt FQDN (basic validation).
2. **TLS mode** — self-signed | letsencrypt (also prompt email; warn: needs public DNS + inbound 80) | byo (prompt cert + key paths).
3. **Ports** — HTTP (default 80) + HTTPS (default 443); probe each with a `net.createServer` bind; if busy, warn + re-prompt.
4. **Compute + write config** — derive all §5 vars from the answers; merge into `.env.prod` preserving unknown/secret keys; render the realm template (§6).
5. **Provision certs** by mode:
   - self-signed → run the `gen-selfsigned.sh` openssl logic for `SERVER_NAME`, writing `deploy/nginx/certs/{fullchain,privkey}.pem`.
   - letsencrypt → enable a **certbot compose profile** (a `certbot` service sharing the cert volume + an ACME http-01 location in nginx); the wizard triggers issuance for the domain/email. Renewal via certbot's own timer/loop.
   - byo → copy the provided cert/key into `deploy/nginx/certs`.
6. **Launch** — `docker compose -f docker-compose.prod.yml up -d --build`.
7. **Verify** — poll `https://HOST:<httpsPort>/health` (the app health route the gateway proxies at exactly `/health`; Node `https` with `rejectUnauthorized:false` to tolerate self-signed) until `status!=='down'` or timeout; on success print the URL map (landing `/`, studio `/studio`, Keycloak admin `/auth/admin`); on timeout print the failing check + `docker compose logs` hint.

**Prompt library:** use a minimal existing/added dep for pick-lists (confirm what's already vendored; prefer `@inquirer/prompts` or `prompts` — one small dev-time dep, wizard is dev/ops tooling not shipped in the server image).

**Decomposition (units, each testable in isolation):**
- `host-detect.ts` — `listIpv4Addresses()`, FQDN validation. (pure/os)
- `port-check.ts` — `isPortFree(port)`. (net)
- `config-compute.ts` — `answers → EnvUpdates` (pure; the URL derivations). **Unit-tested.**
- `env-merge.ts` — merge EnvUpdates into an existing `.env` string, preserving unknown keys/secrets. **Unit-tested.**
- `realm-render.ts` — render the realm template with `PUBLIC_ORIGIN`. **Unit-tested.**
- `certs.ts` — self-signed / byo / certbot-trigger (shells out; integration/manual).
- `launch.ts` + `verify.ts` — compose up + health poll (integration/manual).
- `init.mjs` — the prompt orchestration (thin; prompts mocked in tests).

### 8. Non-goals

- Subdomain routing (path-based only).
- Multi-node / orchestration (single-host compose).
- Automatic DNS record creation.
- Cert renewal beyond certbot's built-in timer.
- Windows as a *deployment* host (the wizard may be authored cross-platform, but the target is Linux+docker; openssl/certbot/compose assumed present).
- Migrating existing realms in place (v1 renders+imports for fresh installs; in-place admin-API patch is a later enhancement).

## Testing

- **Unit (pure):** `config-compute` (issuer/redirect/JWKS/KC_HOSTNAME derivation for localhost, IP, domain + custom ports), `env-merge` (adds/updates target keys, preserves secrets + comments), `realm-render` (redirectUris/webOrigins substitution), `host-detect` formatting, `port-check`.
- **OIDC spike (first task in the plan):** verify/enable the app validating a public issuer while fetching JWKS from an internal URL (Option 2). Gate the rest on this.
- **Manual/integration acceptance:**
  1. `pnpm run init` → localhost + self-signed + default ports → stack up → `/` landing, `/studio` studio loads under base path, login via `/auth` round-trips, `/health` green through the gateway, no backing-service host ports published (`docker compose ps` shows only nginx ports).
  2. Re-run `pnpm run init` with a different host/port → config updated, secrets preserved, stack relaunches.
  3. Let's Encrypt path on the real partner demo host (public domain) → trusted cert issued, login round-trips.

## Sequencing (for the plan)

1. **OIDC split-channel spike** (verify Option 2 works / add the JWKS-URL seam).
2. **Studio base-path** (`/studio`) — Vite base + router basename + server static mount + callback path.
3. **Landing container** + **prod compose** rewrite (separate containers, unexpose ports).
4. **nginx path map** + **Keycloak `/auth`** (relative path, KC_HOSTNAME, proxy headers) + **realm template**.
5. **Wizard units** (host-detect, port-check, config-compute, env-merge, realm-render) with tests.
6. **Wizard cert modes** (self-signed, byo, certbot profile) + **launch/verify** + `pnpm run init` wiring.
7. **Docs** (DEPLOYMENT.md / CONFIGURATION.md: new topology, `pnpm run init`, TLS modes) + manual acceptance.
