# Studio/Web split + landing page + one-line installer — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorm)
**Approach:** A — scaffold now, publish images later.

## Background

OpenLDRv2 shipped as two front-ends: a public **web** site (marketing landing +
public install docs, visible even before the app is running) and a **studio**
application (the actual product UI). OpenLDR CE currently collapses both into a
single SPA at `apps/web` (`@openldr/web`) served by the server from
`WEB_DIST_DIR`.

This workstream restores the v2 split:

1. Rename the existing SPA `apps/web` → `apps/studio` (`@openldr/studio`).
2. Create a new, lightweight `apps/web` (`@openldr/web`) landing/docs site.
3. Add a headline **one-line installer** on the landing page that bootstraps the
   Docker Compose stack.

The three pieces are implemented as sequenced slices; each slice ends green and
is committed atomically.

## Goals

- A clean marketing + public-docs front door that is deployable independently of
  the running server (so people can discover OpenLDR and learn to install it
  even when they have nothing set up yet).
- A `curl … | bash` (Linux/macOS) and `irm … | iex` (Windows PowerShell)
  installer that stands up the production Docker stack with sensible defaults.
- No regression to the existing application — after the rename, the server still
  serves the studio SPA and all builds/e2e still pass.

## Non-goals

- Extracting a shared `@openldr/ui` design-system package. The landing copies the
  few primitives it needs; extraction is deferred until duplication justifies it.
- Standing up container-image publishing / release CI (Approach B). This is a
  documented follow-up; the installer scripts are written correctly against a
  GHCR image reference but cannot be fully end-to-end verified until the first
  image is pushed.
- Choosing/wiring the landing deploy host CI (Pages vs Netlify). The site builds
  to a static `dist/`; host selection is not blocking and is decided later.

## Decisions (from brainstorm)

- **Landing hosting:** standalone static site on a separate host (truest match to
  v2 — visible without the app running).
- **Landing stack:** Vite + React, matching studio, reusing `tokens.css` +
  shadcn primitives directly. No new tooling.
- **Installer target:** bootstrap the Docker Compose stack (pull published
  images), not build-from-source.
- **Installer model:** scaffold a local `openldr/` directory (compose +
  `config/` + generated `.env` + self-signed cert), like Supabase/Plausible/n8n.

---

## Slice 1 — Rename `apps/web` → `apps/studio`

Mechanical refactor. The trap to avoid: everything that currently means "the
application" filters on `@openldr/web`; if not repointed, the *new* landing page
(which takes the `@openldr/web` name) would be silently built by Docker/e2e
instead of the app.

### Touchpoints

| File | Change |
|---|---|
| `apps/web/` → `apps/studio/` | `git mv` the directory |
| `apps/studio/package.json` | `name`: `@openldr/web` → `@openldr/studio` |
| `apps/server/src/app.ts:75` | default SPA path `../../web/dist` → `../../studio/dist` |
| root `package.json` scripts `e2e`, `verify:ui`, `docs:screenshots` | `--filter @openldr/web` → `@openldr/studio` |
| `Dockerfile` (lines ~8, ~12) | build `--filter @openldr/studio`; copy `apps/studio/dist` |
| `e2e/capture-docs/docs-screenshots.spec.ts` | path `apps/web/src/docs/...` → `apps/studio/src/docs/...` |
| `e2e/capture-docs/manifest.test.ts` | path `apps/web/src/docs/registry.ts` → `apps/studio/...` |
| `e2e/capture-docs/manifest.ts` | path `apps/web/src/docs/...` → `apps/studio/...` |
| `e2e/tests/plugin-ui.spec.ts:17` | comment only (cosmetic) |
| `apps/studio/src` sweep | internal self-references (e.g. `workflows/constants.ts`, `docs/version.ts`) — verify none load-bearing |

- `pnpm-workspace.yaml` — **no change** (`apps/*` glob covers `apps/studio`).
- The in-app docs at `apps/web/src/docs/` move **with** studio; they remain the
  application's docs. The landing site gets its own separate public docs (Slice 2).

### Verification

- `pnpm install`
- `pnpm build --filter @openldr/studio --filter @openldr/server`
- e2e smoke (`pnpm --filter @openldr/e2e e2e`) confirms the server still serves
  the SPA from the new default path.
- Commit atomically (bisectable, separate from landing work).

---

## Slice 2 — New `apps/web` landing app (`@openldr/web`)

A lightweight, self-contained Vite + React static site, separately deployable.

### Structure & reuse

- New workspace package `apps/web`, `name: @openldr/web`, Vite + React.
- Copy `tokens.css` and only the shadcn primitives the landing uses (`Button`,
  `Tabs` for the OS-tabbed install block, `Card`). No shared UI package.
- Builds to static `dist/` via `vite build`. Not baked into the server image.

### Content

- **Hero** — product name, one-line pitch, primary CTA (the install command),
  secondary CTAs ("View on GitHub", "Docs").
- **Install block** — headline feature. OS-tabbed code box:
  - Linux/macOS: `curl -fsSL <url>/install.sh | bash`
  - Windows: `irm <url>/install.ps1 | iex`
  - Copy-to-clipboard button.
- **Feature highlights** — a few cards (ingestion, workflows, forms, DHIS2,
  reports).
- **Docs** — public getting-started / install / requirements pages, Markdown
  rendered (reuse the studio `DocMarkdown` approach or a minimal renderer). This
  is the "visible even if you never got the app running" content.
- **Footer** — links, license, version.

### Verification

- `pnpm build --filter @openldr/web`
- Render smoke (loads without console errors; install command renders and copies).

---

## Slice 3 — One-line installer + image-based compose bundle

### Scripts

Two scripts with identical logic, kept in the repo at `install/install.sh` and
`install/install.ps1`, served initially from raw GitHub, upgradable to
`openldr.<domain>/install.sh` once the landing has a domain.

- Linux/macOS: `curl -fsSL <url>/install.sh | bash`
- Windows: `irm <url>/install.ps1 | iex`

Each script:

1. **Preflight** — check `docker` and `docker compose` exist and the daemon is
   running; friendly error + link on failure.
2. **Scaffold** an `openldr/` directory (default `./openldr`, overridable via
   `--dir`): download the image-based `docker-compose.yml` + a `config/` dir
   (nginx template, Keycloak realm JSON, `init-target-db.sql`) — the files the
   stack mounts.
3. **Secrets** — generate `.env` with random `POSTGRES_PASSWORD`,
   `KEYCLOAK_ADMIN_PASSWORD`, S3 keys; generate a self-signed cert (reuse
   `deploy/nginx/gen-selfsigned.sh` logic).
4. **Run** — `docker compose pull` → `up -d`; wait for health; print URL +
   generated admin credentials.
5. Idempotent / re-runnable; `--version` and `--dir` flags; `--no-pull` for
   local dry-run.

### New artifact — install compose file

`docker-compose.prod.yml` uses `build: .`. Add a sibling install compose at
`deploy/install/docker-compose.yml` where the app service is:

```yaml
app:
  image: ghcr.io/fmwasekaga/openldr:${OPENLDR_VERSION:-latest}
```

and references only the downloaded `config/` files (no repo-relative mounts that
assume a source checkout).

### Documented release step (not built now)

Add `RELEASE.md` describing `docker build` + `docker push` of the app image to
GHCR and how versions map to `OPENLDR_VERSION` in the installer. This is the seam
to Approach B (release CI).

### Verification

- Script logic + preflight + `.env`/cert generation verified via local dry-run
  (`--no-pull` against a locally built or fake image).
- **Known limitation:** true end-to-end install (`pull` from GHCR → healthy
  stack) is blocked on the first image publish and is explicitly out of scope for
  this workstream.

---

## Sequencing

Slice 1 (rename, atomic commit) → Slice 2 (landing) → Slice 3 (installer). Each
slice ends green.
