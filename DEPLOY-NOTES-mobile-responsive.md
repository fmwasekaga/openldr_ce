# Deploying the mobile-responsive Studio update

This change is **Studio-only** (the `apps/studio` SPA — no API, gateway, Keycloak,
Postgres, or MinIO changes). So the deploy is a targeted rebuild + restart of the
`studio` service. **Nothing here touches TLS certs.**

Branch: `claude/openldr-mobile-responsive-jwn9sh`

## Why your certs are safe

The gateway (nginx) reads certs from `deploy/nginx/certs/`, which are populated from the
`letsencrypt` docker volume and refreshed by the `renew-cert.sh` cron. The `studio` service
has **no cert mounts** and shares nothing with the gateway or certbot. Rebuilding/restarting
only `studio` leaves the gateway container, its cert volume, and `deploy/nginx/certs/`
completely untouched.

**Do NOT run any of these** — they regenerate/overwrite certs:
- `pnpm run init` (interactive; can rewrite `.env.prod` + certs)
- `install/install.sh` / `install.ps1` (fresh install; self-signed cert without `--letsencrypt`)
- `sh deploy/nginx/gen-selfsigned.sh …`
- anything that writes into `deploy/nginx/certs/`

## Deploy — from source (docker-compose.prod.yml on the droplet)

This is the path if the droplet has the repo checked out and builds images locally.

```sh
cd /path/to/openldr            # your install dir (the one with .env.prod)

# 1. Get the new code (merge to main first if you prefer, then pull main)
git fetch origin
git checkout claude/openldr-mobile-responsive-jwn9sh
git pull --ff-only

# 2. Rebuild ONLY the studio image and restart ONLY the studio container
docker compose -f docker-compose.prod.yml build studio
docker compose -f docker-compose.prod.yml up -d studio
```

The gateway keeps serving with its existing cert; there's a ~few-second blip on `/studio`
while the container swaps. Verify:

```sh
docker compose -f docker-compose.prod.yml ps studio     # Up
curl -ksS https://your.domain.com/studio/ | head -c 100  # serves the SPA shell
```

Then hard-refresh `https://your.domain.com/studio` on your phone (the JS/CSS filenames are
content-hashed, so the browser picks up the new build automatically).

## Deploy — published GHCR images (install.sh path)

If the droplet runs prebuilt images from GHCR, the new `openldr-studio` image must be
published first (maintainer step, from a machine with `docker login ghcr.io`):

```sh
./scripts/build-and-push.sh --tag latest        # or: pnpm run publish:images
```

Then on the droplet:

```sh
cd /path/to/openldr
docker compose pull studio
docker compose up -d studio
```

Same cert guarantee — only the `studio` service changes.

## Rollback

```sh
git checkout main       # or the previous commit
docker compose -f docker-compose.prod.yml build studio
docker compose -f docker-compose.prod.yml up -d studio
```
