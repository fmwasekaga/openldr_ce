# Deploying OpenLDR CE (single HTTPS port)

OpenLDR CE runs behind **one HTTPS port**: an nginx reverse proxy terminates TLS and
proxies every request to the application container, which serves the SPA, the `/api`
surface, and the auth callback from a single origin. Postgres, MinIO, and Keycloak run
as backing services on the internal network.

```
            :443 (TLS)            :3000 (internal)
  browser ───────────▶  nginx  ───────────▶  app (fastify: SPA + /api + auth)
            :80 → 301 https                    │
                                               ├── postgres   (internal DB)
                                               ├── minio       (blob storage)
                                               └── keycloak    (:8180, OIDC issuer)
```

## Prerequisites

- Docker + Docker Compose v2.
- A domain name (production) or `localhost` (local/demo).

## Quick start (local, self-signed TLS)

```sh
# 1. Self-signed cert for localhost (writes deploy/nginx/certs/{fullchain,privkey}.pem)
sh deploy/nginx/gen-selfsigned.sh localhost

# 2. Environment
cp .env.prod.example .env.prod        # then edit secrets

# 3. Build + run the stack
docker compose -f docker-compose.prod.yml up -d --build
```

Browse **https://localhost** (accept the self-signed-certificate warning).

### Windows (PowerShell)

`docker compose` works the same. For the cert, either run the script from **Git Bash**
(`sh deploy/nginx/gen-selfsigned.sh localhost`) or use this PowerShell one-liner (no local
openssl needed — generates it inside a container):

```powershell
docker run --rm -v "${PWD}/deploy/nginx/certs:/certs" alpine/openssl req -x509 -newkey rsa:2048 -nodes -days 825 `
  -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
Copy-Item .env.prod.example .env.prod   # then edit secrets
docker compose -f docker-compose.prod.yml up -d --build
```

Smoke from PowerShell with `curl.exe` (the real curl, not the `Invoke-WebRequest` alias):
`curl.exe -k https://localhost/health`. (The repo's `.gitattributes` keeps `*.sh` and the
nginx template LF so they aren't CRLF-mangled on a Windows checkout.)

## TLS in production

Replace the self-signed cert with a real one — e.g. via **Let's Encrypt / certbot**:

1. Obtain a certificate for your domain (certbot, your CA, or a managed LB).
2. Place `fullchain.pem` + `privkey.pem` in `deploy/nginx/certs/`.
3. Set `SERVER_NAME=your.domain` in `.env.prod` (and re-run `up -d`).

Certificate renewal (certbot cron / your platform's mechanism) is the operator's
responsibility — it is intentionally not wired into the compose file.

## Environment

All configuration is environment-driven; see **`.env.prod.example`** for the full,
annotated set. Required keys: `INTERNAL_DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `OIDC_ISSUER_URL`. Service hostnames
(`postgres` / `minio` / `keycloak`) resolve on the compose network.

**Auth note:** `OIDC_ISSUER_URL` must be reachable by **both** the browser (for the login
redirect) and the app (for token validation). The compose publishes Keycloak on `:8180`
so a local issuer URL (`http://localhost:8180/realms/openldr`) works for both. For a quick
demo without real login, set `AUTH_DEV_BYPASS=true`. Production Keycloak hardening
(stable hostname, `start` instead of `start-dev`, TLS, fronting it under the same domain)
is a follow-up beyond this single-port baseline.

## Smoke check

After `up`, once the backing services are healthy:

```sh
curl -ik http://localhost/            # → 301 redirect to https
curl -k  https://localhost/health     # → {"status":"up",...}
curl -k  https://localhost/           # → SPA HTML (contains id="root")
curl -k  https://localhost/api/config # → JSON (auth/OIDC config)
```

## Upgrade / teardown

```sh
docker compose -f docker-compose.prod.yml up -d --build   # rebuild + restart
docker compose -f docker-compose.prod.yml down            # stop (keeps volumes)
docker compose -f docker-compose.prod.yml down -v         # stop + drop data volumes
```

## Out of scope (here)

Kubernetes/Helm, CI/CD, autoscaling/HA, automated certbot renewal, the optional SQL Server
and DHIS2 services (use the dev `docker-compose.yml` profiles for those), and log/metrics
shipping.
