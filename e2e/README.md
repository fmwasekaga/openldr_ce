# @openldr/e2e — end-to-end + visual-verification harness

Browser E2E over the dashboard SPA served by the real `apps/server` + Docker stack,
plus an agent-driven visual-verification gallery. Satisfies P1-NFR-5.

## One-time setup (this machine)

Chromium downloads need a mirror — the direct Playwright CDN (`storage.googleapis.com`)
times out here. The install script sets `PLAYWRIGHT_DOWNLOAD_HOST` to npmmirror and the
package pins `@playwright/test@1.57.0` (Chromium rev 1200, Chromium 143 — the newest
Playwright release with both chromium and chromium-headless-shell mirrored on npmmirror;
1.58.0+ (rev 1208+) 404s on the mirror).

The reports **PDF Document tab** uses `pdfjs-dist@6`, which calls
`Map.prototype.getOrInsertComputed` — native only in Chromium >= 144. Chromium 143 has it
behind V8's `--harmony` flag, so `playwright.config.ts` launches Chromium with
`--js-flags=--harmony`; otherwise the Document tab throws `getOrInsertComputed is not a
function` and never renders. (Production hardens real browsers via the app's own
Uint8Array hex/base64 polyfill — a separate concern that stays.)

    pnpm install
    pnpm e2e:install-browsers

> The ECC Playwright **MCP** is NOT used here — it runs in extension-bridge mode and
> needs a Chrome extension that isn't installed. This harness uses the repo's Playwright
> and writes screenshots to disk for an agent to read.

## Bring up + seed the stack

    docker compose up -d        # Postgres / MinIO / Keycloak (git-ignored override ports)
    pnpm e2e:seed               # make sample -> build plugin -> db reset -> install plugin -> ingest WHONET

`pnpm e2e:seed` needs Docker up and the Rust/wasi toolchain (for `build:plugins`).

## Run

    pnpm e2e          # 5 deterministic smoke specs (pass/fail)
    pnpm verify:ui    # capture screenshots -> e2e/artifacts/screenshots/

Both build the SPA + server first; Playwright's `webServer` launches the built server
(reusing an already-running one). If the DB isn't seeded, `globalSetup` fails fast with
the exact commands to run.

## Agent visual verification

After `pnpm verify:ui`, an agent reads each PNG in `e2e/artifacts/screenshots/` and
judges it against `rubric.md`, reporting PASS/notes per screen.

## Layout

- `playwright.config.ts` — chromium-only, headless; `webServer` (built server, cwd repo root); two projects (`smoke`, `capture`).
- `global-setup.ts` — precondition guard (DB seeded + reachable).
- `support/config.ts` — PORT/baseURL (single source).
- `tests/smoke.spec.ts` — health, dashboard, AMR 100%R on AMP, CSV export, 404.
- `capture/capture.spec.ts` — the screenshot matrix.
- `rubric.md` — what each screen should look like.
- `artifacts/` — gitignored (screenshots, html report, traces).
