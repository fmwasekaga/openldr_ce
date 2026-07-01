# Releasing OpenLDR CE

The one-line installer (`install/install.sh`, `install/install.ps1`) pulls the
app image from GHCR. Until an image is published, the installer scaffolds a
working directory but `docker compose pull` will fail — publish an image first.

**Before the image is published, run from source instead** with the developer
bootstrap (`install/development.sh` / `install/development.ps1`): it clones the
repo, `pnpm install`s, starts the dev backing services, resets the DB, and
prints the dev-run commands. See "Install from source" in the landing docs.

## Build & push the app image

```
docker build -t ghcr.io/fmwasekaga/openldr:0.1.0 -t ghcr.io/fmwasekaga/openldr:latest .
echo "$GHCR_TOKEN" | docker login ghcr.io -u fmwasekaga --password-stdin
docker push ghcr.io/fmwasekaga/openldr:0.1.0
docker push ghcr.io/fmwasekaga/openldr:latest
```

The image tag maps to `OPENLDR_VERSION` in the installer's `.env`
(`--version 0.1.0` pins it; default `latest`).

## Verifying the installer end-to-end

After the first push:

```
bash install/install.sh --dir /tmp/openldr-e2e --version 0.1.0
```

Expected: the stack pulls, comes up healthy, and https://localhost serves the
studio SPA.

## Follow-up (Approach B)

Automate build + push + a GitHub release (with the compose bundle attached) via
GitHub Actions on tag push. Not yet implemented.
