# OpenLDR CE Deployment Guide

## Topology

OpenLDR CE uses a **single nginx gateway** that is the only container with published host ports. All backing services (Postgres, MinIO, Keycloak) are docker-network-only and are never reachable from the host.

```
Browser
  │
  ▼
nginx (:80 → :443 redirect / :443 TLS)
  ├── /            → landing  (static landing/docs site)
  ├── /studio      → app      (Studio SPA served by the Node server)
  ├── /api         → app      (REST API, same Node server)
  └── /auth        → keycloak (Keycloak, http-relative-path=/auth)

docker-network only (no host ports):
  postgres   :5432
  minio      :9000
  keycloak   :8080
```

`pnpm run init` is the recommended quickstart — it walks through the configuration interactively and brings everything up. Manual steps are documented below for reference.

---

## Quickstart: `pnpm run init`

Requires Node ≥ 20, pnpm, Docker with Compose plugin.

```bash
git clone https://github.com/Open-Laboratory-Data-Repository/openldr
cd openldr
pnpm install --frozen-lockfile
pnpm run init
```

The wizard will ask:

1. **Host** — IP address or domain name (e.g. `192.168.1.10` or `openldr.example.org`). Defaults to `localhost`.
2. **TLS mode** — `self-signed`, `letsencrypt`, or `bring-your-own`.
3. **HTTP port** (default `80`) and **HTTPS port** (default `443`).

After answering, `init` will:

- Write `.env.prod` with all gateway vars (`SERVER_NAME`, `PUBLIC_ORIGIN`, `OIDC_ISSUER_URL`, `KC_HOSTNAME`, etc.).
- Generate or copy TLS certificates into `deploy/nginx/certs/`.
- Render the Keycloak realm template with the correct issuer URL.
- Run `docker compose -f docker-compose.prod.yml up -d --build`.
- Wait for `/api/health` to return 200.
- Print the access URLs:
  - Studio: `https://<HOST>/studio`
  - API: `https://<HOST>/api`
  - Keycloak admin: `https://<HOST>/auth/admin`

---

## TLS Modes

### 1. Self-Signed (default / localhost)

The wizard generates a 2048-bit RSA certificate for the hostname and places it in `deploy/nginx/certs/`. Browsers will show a certificate warning; accept it once. Suitable for local development and internal-network installs without a DNS record.

Manual equivalent:

```bash
sh deploy/nginx/gen-selfsigned.sh <hostname>
```

### 2. Let's Encrypt

Requires a public DNS record pointing to the host and ports 80/443 open to the internet.

**First-time certificate issuance (one-off, run once before starting the stack):**

```bash
docker compose -f docker-compose.prod.yml --profile letsencrypt run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d $SERVER_NAME \
  --email $LETSENCRYPT_EMAIL \
  --agree-tos -n
```

After the certificate is issued, copy it into the nginx certs directory:

```bash
cp /etc/letsencrypt/live/<domain>/fullchain.pem deploy/nginx/certs/fullchain.pem
cp /etc/letsencrypt/live/<domain>/privkey.pem   deploy/nginx/certs/privkey.pem
```

Then bring the stack up normally. The `certbot` profile service runs continuously alongside nginx and handles automatic renewal (it checks every 12 hours).

Set `LETSENCRYPT_EMAIL` in `.env.prod` before issuing:

```bash
echo "LETSENCRYPT_EMAIL=ops@example.org" >> .env.prod
```

### 3. Bring Your Own Certificate

Place your certificate chain and private key at:

```
deploy/nginx/certs/fullchain.pem
deploy/nginx/certs/privkey.pem
```

Set `TLS_MODE=bring-your-own` in `.env.prod` and bring the stack up. The nginx template reads these paths directly.

---

## Manual Deployment Steps

If you prefer not to use `pnpm run init`:

```bash
cp .env.prod.example .env.prod
# Edit .env.prod: set SERVER_NAME, PUBLIC_ORIGIN, OIDC_ISSUER_URL, KC_HOSTNAME, passwords, etc.

sh deploy/nginx/gen-selfsigned.sh localhost   # or provide your own certs

docker compose -f docker-compose.prod.yml up -d --build
```

Wait for the stack to become healthy:

```bash
curl -k https://localhost/api/health
```

---

## Installer (published images, no source required)

The one-line installer targets hosts that pull published images from GHCR rather than building from source.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

Optional flags: `--dir <path>` (default `./openldr`), `--version <tag>`, `--no-start`, `--no-pull`.

The installer scaffolds `./openldr/`, generates secrets, writes `.env` with gateway-era defaults (`PUBLIC_ORIGIN=https://localhost`, Keycloak proxied at `/auth`), generates a self-signed cert, and runs `docker compose up -d`.

> **Note:** The installer stack uses `ghcr.io/open-laboratory-data-repository/openldr-landing:${OPENLDR_VERSION:-latest}` for the landing service. This image must be published alongside the main app image (`ghcr.io/open-laboratory-data-repository/openldr:...`).

For a non-localhost host (IP or domain) or Let's Encrypt TLS, either run `pnpm run init` from source, or edit `SERVER_NAME`, `PUBLIC_ORIGIN`, `OIDC_ISSUER_URL`, `KC_HOSTNAME`, and `TLS_MODE` in `.env` and re-run `docker compose up -d`.

---

## Service Reference

| Service    | Internal address        | Public path  |
|------------|-------------------------|--------------|
| `app`      | `http://app:3000`       | `/studio`, `/api` |
| `landing`  | `http://landing:80`     | `/`          |
| `keycloak` | `http://keycloak:8080`  | `/auth`      |
| `postgres` | `postgres:5432`         | none (internal) |
| `minio`    | `minio:9000`            | none (internal) |

---

## Keycloak Admin

The Keycloak admin console is available at `https://<HOST>/auth/admin`. The admin username is `admin`; the password is the value of `KEYCLOAK_ADMIN_PASSWORD` in `.env.prod` (or `.env` for installer deployments). Keycloak listens internally on `:8080` with `--http-relative-path=/auth` and is only reachable from outside via the nginx gateway.

---

## Upgrading

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically on startup (`MIGRATE_ON_START=true`).
