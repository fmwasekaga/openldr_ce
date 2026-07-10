# Releasing OpenLDR CE

The one-line installer (`install/install.sh`, `install/install.ps1`) pulls the
published images from GHCR. Until they are published, the installer scaffolds a
working directory but `docker compose pull` will fail — publish the images first.

**Before the images are published, run from source instead** with the developer
bootstrap (`install/development.sh` / `install/development.ps1`): it clones the
repo, `pnpm install`s, starts the dev backing services, resets the DB, and
prints the dev-run commands. See "Install from source" in the landing docs.

## Build & push the images

OpenLDR CE ships four images to GHCR:
`ghcr.io/open-laboratory-data-repository/openldr-{api,studio,web,gateway}`.
Authenticate to GHCR with a GitHub PAT that has `write:packages`, then run the
publish script (its default registry is the org namespace above):

```
echo "$GHCR_TOKEN" | docker login ghcr.io -u <your-github-username> --password-stdin
pnpm run publish:images                 # builds + pushes all four, tags :latest + :<package.json version>
# variations:
# ./scripts/build-and-push.sh --tag rc1              # pin a tag
# ./scripts/build-and-push.sh --no-push              # build + load locally, don't push
# ./scripts/build-and-push.sh --registry <ns>        # override the target namespace
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
