# Installer Let's Encrypt — Design

- **Date:** 2026-07-02
- **Status:** Approved (brainstorm → spec)
- **Owner:** OpenLDR CE

## Problem

The image-based one-line installer (`install/install.{sh,ps1}` + `deploy/install/docker-compose.yml`)
generates a **self-signed** TLS cert. On a real domain that's a dead end: browsers warn
(`ERR_CERT_AUTHORITY_INVALID`), and once a domain has ever served a trusted cert with HSTS the
browser hard-blocks self-signed (no click-through). Only the **source** path
(`docker-compose.prod.yml` + `deploy/letsencrypt.sh` + `pnpm run cert`) can issue a trusted Let's
Encrypt cert — which defeats "installer-only, no clone" for a production domain.

## Goal

A clean droplet + a fresh domain becomes a genuinely one-command, production-grade install:

```
curl -fsSL …/install/install.sh | bash -s -- --server-name openldr.online --letsencrypt you@email.com
```

→ boots the stack, issues a trusted LE cert over the gateway's http-01 webroot, installs it, and
sets up **automatic renewal** — no repo clone.

## Non-goals / deferred

- **Windows LE** — `install.ps1` stays self-signed (LE + host cron are Linux/production-oriented;
  Windows/localhost can't do LE). The `.ps1` prints a note pointing at the Linux installer for
  public TLS.
- **HSTS header** — the gateway does NOT add `Strict-Transport-Security` (keeps a self-signed
  fallback possible on non-HSTS domains). Out of scope.
- **DNS-01 / wildcard certs** — only http-01 webroot (matches the source path). Single domain.
- **Non-root cron auto-install** — if the installer isn't root it prints the cron line instead of
  writing `/etc/cron.d`.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Renewal | **Auto host cron** (`/etc/cron.d/openldr-cert`, twice daily) |
| Rate-limit testing | Add a **`--staging`** toggle (LE staging CA) |
| Renew script | A downloaded repo file `deploy/install/renew-cert.sh` (not heredoc-written) |
| Windows | `.ps1` stays self-signed (note only) |
| HSTS | Not added |
| Challenge | http-01 webroot (reuse the nginx template's `/.well-known/acme-challenge/`) |

## Prior art to mirror

- `deploy/letsencrypt.sh` — `certbot certonly --webroot -w /var/www/certbot -d $DOMAIN --email
  $EMAIL --agree-tos --no-eff-email --keep-until-expiring --non-interactive`, then copy
  `/etc/letsencrypt/live/$DOMAIN/{fullchain,privkey}.pem` → `/certs-out`, then `nginx -s reload`.
- `docker-compose.prod.yml` `certbot` service: `certbot/certbot:latest`, `profiles: ["letsencrypt"]`,
  volumes `letsencrypt:/etc/letsencrypt`, `./deploy/nginx/certs:/certs-out`, `certbot-www:/var/www/certbot`.
- `deploy/nginx/openldr.conf.template` line 8 already serves `location /.well-known/acme-challenge/
  { root /var/www/certbot; }` (baked into `openldr-gateway`).

## Component A: installer compose (`deploy/install/docker-compose.yml`)

Add a profile-gated `certbot` service + the `certbot-www` mount on the gateway + two named volumes:

```yaml
  gateway:
    image: fmwasekaga/openldr-gateway:${OPENLDR_VERSION:-latest}
    environment:
      SERVER_NAME: ${SERVER_NAME:-localhost}
    ports:
      - "${GATEWAY_HTTP_PORT:-80}:80"
      - "${GATEWAY_HTTPS_PORT:-443}:443"
    volumes:
      - ./config/nginx/certs:/etc/nginx/certs:ro
      - certbot-www:/var/www/certbot          # NEW — serves the ACME http-01 challenge
    depends_on: ["api", "studio", "web", "keycloak"]
    restart: unless-stopped

  # Let's Encrypt helper (profile-gated: does NOT start with `up`). Invoked by the installer's
  # --letsencrypt flag and by renew-cert.sh (cron). Certs land in ./config/nginx/certs where the
  # gateway reads them.
  certbot:
    image: certbot/certbot:latest
    profiles: ["letsencrypt"]
    volumes:
      - letsencrypt:/etc/letsencrypt
      - ./config/nginx/certs:/certs-out
      - certbot-www:/var/www/certbot

volumes:
  pgdata:
  miniodata:
  certbot-www:      # NEW
  letsencrypt:      # NEW
```

The `certbot-www` volume is shared between `gateway` (serves the challenge) and `certbot` (writes
the challenge token). The gateway image already routes `/.well-known/acme-challenge/` to
`/var/www/certbot`, so no image change is needed.

## Component B: `install.sh` — `--letsencrypt <email>` (+ `--staging`)

New flags parsed alongside the existing ones:
- `--letsencrypt <email>` → sets `LE_EMAIL`.
- `--staging` → sets `LE_STAGING=1` (adds `--staging` to certbot; uses the LE staging CA).

Guard (before issuance): LE requires a real hostname. If `LE_EMAIL` is set but `HOST` is `localhost`
or matches a bare IPv4, error out: `--letsencrypt needs a public --server-name (a domain), not
localhost/IP`.

Flow (only when `LE_EMAIL` is set; self-signed path unchanged otherwise):
1. Keep generating the self-signed cert first (so nginx can bind :443 and boot).
2. `docker compose up -d` (existing).
3. Wait until the gateway answers `http://localhost:80/.well-known/acme-challenge/` (or `:80` root)
   — a short readiness loop so certbot's http-01 can reach the webroot.
4. Issue:
   ```
   docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
     certonly --webroot -w /var/www/certbot -d "$HOST" --email "$LE_EMAIL" \
     --agree-tos --no-eff-email --keep-until-expiring --non-interactive ${LE_STAGING:+--staging}
   ```
5. Install the cert where the gateway reads it:
   ```
   docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
     "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && \
      cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
   ```
6. `docker compose exec gateway nginx -s reload`.
7. Record `LETSENCRYPT_EMAIL=$LE_EMAIL` in `.env` (for renew reference + parity with `.env.prod`).
8. Download `renew-cert.sh` into the install dir and install the renewal cron (Component C).

On certbot failure (e.g. DNS not pointing at the host yet, port 80 unreachable): print a clear
message that the stack is up on the self-signed cert and how to retry (`re-run with --letsencrypt`
once DNS/ports are ready), and DO NOT abort the whole install — the stack stays up.

## Component C: renewal — `deploy/install/renew-cert.sh` + host cron

New repo file `deploy/install/renew-cert.sh` (downloaded by the installer into the install dir):

```sh
#!/bin/sh
# Renew the Let's Encrypt cert for this install dir's domain and reload the gateway.
# Run from cron (see /etc/cron.d/openldr-cert). Idempotent: certbot only re-issues near expiry.
set -eu
cd "$(dirname "$0")"
HOST="$(grep -E '^SERVER_NAME=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
[ -n "$HOST" ] || { echo "no SERVER_NAME in .env" >&2; exit 1; }
docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
  renew --webroot -w /var/www/certbot --quiet
docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
  "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && \
   cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
docker compose exec gateway nginx -s reload
```

Installer cron install (Linux, when running as root):
```
# /etc/cron.d/openldr-cert  (written by the installer)
0 3,15 * * * root cd <ABS_INSTALL_DIR> && sh renew-cert.sh >> /var/log/openldr-cert.log 2>&1
```
- `<ABS_INSTALL_DIR>` is the resolved absolute path of `--dir`.
- If not root (can't write `/etc/cron.d`): skip and print the exact line for the user to add to
  `crontab -e`.

## Component D: `install.ps1`

No LE. After the self-signed cert step, if the user passes something like `-Letsencrypt`, print:
"Let's Encrypt is available on the Linux installer (install.sh --letsencrypt); on Windows the cert
is self-signed." Keep the `.ps1` otherwise unchanged. (Adding a `-Letsencrypt` param that only warns
keeps parity of surface without implementing Windows cron.)

## Testing

- **Local (no public domain):** `docker compose config` renders the installer compose with the
  `certbot` service + gateway `certbot-www` mount + new volumes; `sh -n install/install.sh` and
  `sh -n deploy/install/renew-cert.sh` pass; `install.sh --server-name localhost --letsencrypt x@y`
  errors on the localhost guard; `install.sh --server-name example.com --letsencrypt x@y --no-start`
  scaffolds without attempting issuance (no `up`).
- **Droplet (real issuance):** `install.sh --server-name openldr.online --letsencrypt you@email.com
  --staging` → a **staging** cert issues (browser shows "not trusted" staging CA, but proves the
  http-01 flow works end to end) → then without `--staging` for the real cert → `curl -sI
  https://openldr.online/studio/` returns 200 with a Let's Encrypt chain → `/etc/cron.d/openldr-cert`
  exists.

## Rollout / sequencing (for the plan)

1. `deploy/install/docker-compose.yml`: add `certbot` service + gateway `certbot-www` mount + volumes.
2. `deploy/install/renew-cert.sh` (new).
3. `install.sh`: `--letsencrypt`/`--staging` flags, localhost guard, issuance flow, `renew-cert.sh`
   download + cron install, non-fatal failure handling.
4. `install.ps1`: `-Letsencrypt` warn-only note.
5. Docs (`DEPLOYMENT.md` install section): the `--letsencrypt` one-liner + renewal note.
6. Local verification (compose config, syntax, guard, scaffold). Droplet issuance handed to the user.
