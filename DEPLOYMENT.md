# Deploying OpenLDR CE (single HTTPS port)

OpenLDR CE runs behind **one HTTPS port**. An nginx reverse proxy terminates TLS and
path-routes every request from a single origin:

```
                :443 (TLS)                     internal docker network only
  browser ───────────────▶  gateway ┌── /         ──▶ web       (apps/web static site)
            :80 → 301 https         ├── /studio   ──▶ studio    (static nginx: Studio SPA)
                                    ├── /api      ──▶ api       (fastify: REST API)
                                    ├── /health   ──▶ api
                                    └── /auth     ──▶ keycloak  (OIDC issuer, /auth base path)
                                              api also talks to: postgres, minio (blob)
```

**Only the gateway publishes host ports (80/443).** postgres, minio, keycloak, web, studio, and api
are reachable only on the compose network. Auth uses a split front/back channel: the browser hits the
public issuer `https://<host>/auth/realms/openldr`, while the api validates tokens over the internal
JWKS URL (`http://keycloak:8080/auth/...`) so it never depends on the gateway's cert.

## Images

OpenLDR CE ships four independently-versioned images on GHCR (GitHub Container Registry):

| Image | Contents |
|-------|----------|
| `ghcr.io/open-laboratory-data-repository/openldr-api` | server/API + `/health` (no SPA) |
| `ghcr.io/open-laboratory-data-repository/openldr-studio` | studio SPA (static nginx, served under `/studio/`) |
| `ghcr.io/open-laboratory-data-repository/openldr-web` | public landing site |
| `ghcr.io/open-laboratory-data-repository/openldr-gateway` | nginx reverse proxy (routes `/`→web, `/studio`→studio, `/api`+`/health`→api, `/auth`→keycloak) |

Postgres, MinIO, and Keycloak use their stock upstream images.

### Publishing (maintainers)

```bash
docker login
pnpm run publish:images            # ghcr.io/open-laboratory-data-repository/*, tags :latest + :<package.json version>, amd64
# or: ./scripts/build-and-push.sh --tag rc1 --no-push   # local build without pushing
```

### Two deploy paths

- **From source (`pnpm run init`)** builds the images locally via `docker-compose.prod.yml`.
- **One-line install** (`install/install.sh` | `.ps1`) PULLS the published images — no clone, no build.

### Trusted TLS (Let's Encrypt)

For a public domain, issue a trusted, auto-renewing cert in the install command:

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Prereqs: the domain's DNS A-record points at the host, and ports 80 + 443 are reachable. Add
`--staging` first to test the flow without hitting Let's Encrypt's rate limits. Renewal is automatic
via `/etc/cron.d/openldr-cert` (running `renew-cert.sh` twice daily); if the installer isn't root it
prints the cron line to add manually. Without `--letsencrypt` the installer generates a self-signed
cert (browser warning; not usable on a domain that already served a trusted cert with HSTS).

This is the **one-line-install** path (pulls published images, no clone). For the **from-source**
path (`pnpm run init` + `docker-compose.prod.yml`), see "Production TLS — Let's Encrypt" below —
same idea (certbot over the http-01 webroot, cron-driven renewal), different entry point
(`pnpm run cert` / `deploy/letsencrypt.sh` instead of `renew-cert.sh`). `install.ps1` does not
automate Let's Encrypt on Windows; it prints a warning and falls back to self-signed.

## Prerequisites

- Docker + Docker Compose v2.
- A domain name (production) or `localhost` (local/demo).
- For a public deployment: DNS A-record → this host, and ports **80 + 443** reachable.

## Fastest path — the init wizard

`pnpm run init` (needs Node + pnpm on the host) interactively configures and launches the stack:

1. Address by **IP** (lists the host's addresses) or **Domain** (e.g. `openldr.online`).
2. TLS mode: **self-signed** (lab/internal), **Let's Encrypt** (public domain), or **bring-your-own**.
3. HTTP/HTTPS ports (defaults 80/443).

It writes `.env.prod` (correct `PUBLIC_ORIGIN` / `SERVER_NAME` / OIDC + Keycloak hostnames), renders
the Keycloak realm, generates/plans certs, brings the stack up, and polls `/health`.

## Manual quick start (local, self-signed TLS)

```sh
# 1. Self-signed cert for localhost (writes deploy/nginx/certs/{fullchain,privkey}.pem)
sh deploy/nginx/gen-selfsigned.sh localhost
# 2. Environment
cp .env.prod.example .env.prod          # then edit secrets (SECRETS_ENCRYPTION_KEY, etc.)
# 3. Build + run
docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build
```

Browse **https://localhost** (accept the self-signed warning). On Windows, generate the cert inside a
container if you have no local openssl:

```powershell
docker run --rm -v "${PWD}/deploy/nginx/certs:/certs" alpine/openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
  -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

## Production TLS — Let's Encrypt (effortless)

DNS for your domain must point at this host and ports 80/443 must be reachable first.

```sh
# 1. Configure for the domain (or set SERVER_NAME + LETSENCRYPT_EMAIL in .env.prod by hand)
pnpm run init            # Domain → your.domain → TLS: Let's Encrypt → email

# 2. Bring the stack up (starts on the self-signed placeholder; :80 serves the ACME challenge)
docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build

# 3. Issue the real cert, install it for nginx, and reload — one command
pnpm run cert            # = sh deploy/letsencrypt.sh  (reads domain+email from .env.prod)
```

`deploy/letsencrypt.sh` runs certbot over the webroot nginx already serves, copies the issued
`fullchain.pem`/`privkey.pem` into `deploy/nginx/certs/`, and reloads nginx. It is **idempotent**
(`--keep-until-expiring`) — wire it into cron for hands-off renewal:

```cron
# twice daily; certbot only re-issues when near expiry, nginx reloads either way
0 3,15 * * *  cd /opt/openldr && pnpm run cert >> /var/log/openldr-cert.log 2>&1
```

Bring-your-own cert instead: drop `fullchain.pem` + `privkey.pem` into `deploy/nginx/certs/` and
`docker compose ... restart gateway`.

## Database migrations & seed

The app **self-migrates on startup** when `MIGRATE_ON_START=true` (set in `.env.prod.example`);
migrations are idempotent. `SEED_ON_START=true` seeds idempotent sample data (org/location/patient,
the bundled sample forms, and the default lab-order ingestion workflows) after migration. Loading
real reference terminology (LOINC/RxNorm/SNOMED) and lab data is a separate, heavier import.

## Environment

All configuration is environment-driven — see **`.env.prod.example`** for the full, annotated set.
Service hostnames (`postgres` / `minio` / `keycloak`) resolve on the compose network. For a **local
demo without real login**, set `NODE_ENV=development` + `AUTH_DEV_BYPASS=true` in `.env.prod`
(`AUTH_DEV_BYPASS` is rejected under `NODE_ENV=production`).

## Smoke check

```sh
curl -ik http://localhost/            # → 301 redirect to https
curl -k  https://localhost/health     # → {"status":"up",...} (all checks up)
curl -k  https://localhost/           # → landing HTML
curl -k  https://localhost/studio/    # → Studio SPA (<title>OpenLDR</title>)
curl -k  https://localhost/api/workflows   # → 401 without a token (auth enforced)
```

## Upgrade / teardown

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build   # rebuild + restart
docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr down            # stop (keeps volumes)
docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr down -v         # stop + drop data volumes
```

The gateway re-resolves backing containers at runtime (Docker DNS), so recreating `api` or `studio`
on redeploy does **not** require a gateway restart.

## Out of scope (here)

Kubernetes/Helm, CI/CD, autoscaling/HA, the optional SQL Server and DHIS2 services (use the dev
`docker-compose.yml` profiles), and log/metrics shipping.
