# Sub-project 9 — Playwright E2E + agent visual-verification harness

**Date:** 2026-06-13
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase1.md` — P1-NFR-5 (automated E2E + a harness an agent can use to visually verify the UI)
**Build-sequence step:** §8 step 9 — the **final** Phase-1 build step

---

## 1. Purpose & scope

Deliver the end-to-end test + visual-verification layer over the dashboard SPA (sub-project 6, `apps/web`) served by `apps/server`. Two complementary halves:

1. **Deterministic Playwright smoke suite** — a headless, agent-free pass/fail signal over the critical user path, run against the **real full stack** (live `apps/server` backed by the Docker Postgres/MinIO, seeded via the documented WHONET ingest path).
2. **Agent visual-verification harness** — a `pnpm verify:ui` command that captures a curated screenshot gallery of the SPA, plus a committed `rubric.md`. An agent Reads the PNGs and judges them against the rubric. **No pixel baselines** (cross-machine font/AA rendering makes them brittle, and the point is agent judgment).

This is the last brick of the §8 build sequence; once it is green, Phase-1 is feature-complete.

**In scope (9):**
- New top-level `e2e/` workspace package (`@openldr/e2e`, private) using `@playwright/test@1.50.0`.
- `playwright.config.ts` (chromium-only, headless), `global-setup.ts` (precondition guard), `tests/smoke.spec.ts` (5 critical-path specs), `capture/capture.spec.ts` (screenshot gallery), `rubric.md`, `README.md`.
- Root scripts: `pnpm e2e`, `pnpm verify:ui`, `pnpm e2e:seed`, `pnpm e2e:install-browsers`.
- `.gitignore` entries for E2E artifacts.
- Live acceptance run (docker → seed → `pnpm e2e` green → `pnpm verify:ui` → agent reads + verifies screenshots against the rubric).

**Out of scope (deferred / not this step):**
- Broad interaction coverage (theme persistence, sidebar collapse, param-bar filtering, every report) — smoke only.
- Direct API-contract assertions through Playwright's request API beyond the single `/health` check.
- Pixel-diff visual regression (`toHaveScreenshot` baselines).
- A GitHub Actions / CI workflow — nothing is pushed to origin yet; the harness is local-runnable. (Designed so a future CI job is a thin wrapper: install browsers via the mirror, seed, `pnpm e2e`.)
- Auto-running the heavy seed pipeline (db reset + build:plugins + plugin install + ingest) inside the test run.

---

## 2. Cross-cutting principles this sub-project demonstrates

- **P1-NFR-5** — automated browser E2E over the SPA + a harness an agent can use to visually verify the UI.
- **DP-4 Agent-operability** — the visual harness is *for* an agent: deterministic capture → PNGs on disk → agent Reads + judges against an explicit rubric.
- **DP-7 Resilience evidence** — the precondition guard converts an unseeded/unreachable stack into a one-line remediation message instead of a confusing mid-test failure.
- **Reproducibility on a mirror-constrained machine** — the npmmirror download-host + pinned Playwright/Chromium rev are encoded in a script + README, mirroring the WASM-toolchain workaround pattern.

---

## 3. Package `@openldr/e2e` (`e2e/`)

A new private workspace package — **not** a domain module, **not** in the dependency-cruiser `packages`/`apps` graph (it is test tooling, not shipped code). It uses Playwright's own test runner, deliberately **kept out of the turbo `test`/vitest pipeline** so `pnpm test` (unit) stays fast and stack-free; E2E is invoked explicitly via `pnpm e2e`.

```
e2e/
  package.json            # @openldr/e2e, private, type: module; devDep @playwright/test@1.50.0
  playwright.config.ts
  global-setup.ts
  tests/
    smoke.spec.ts
  capture/
    capture.spec.ts
  support/
    server.ts             # webServer launcher helper (ensure dist built, resolve PORT/baseURL)
  rubric.md
  README.md
  artifacts/              # gitignored (screenshots/, playwright-report/, test-results/)
```

Pinning rationale: `@playwright/test@1.50.0` resolves Chromium rev **1155**, the newest revision with both full chromium and chromium-headless-shell mirrored on npmmirror. Newer Playwright uses the `builds/cft/` Chrome-for-Testing layout that npmmirror does not mirror (404), and the direct CDN → `storage.googleapis.com` times out on this machine. (See the `playwright-toolchain` memory.)

---

## 4. Stack lifecycle & configuration

**Prerequisites (operator-run, documented in README):** Docker Desktop up → `docker compose up -d` → `pnpm install` → seed pipeline (`pnpm e2e:seed`, which runs `openldr db reset` → `build:plugins` → `plugin install` → `ingest whonet-sample`). The heavy seed is intentionally **not** auto-run per test invocation.

**`playwright.config.ts`:**
- `projects`: a single chromium project; `use: { browserName: 'chromium', headless: true, baseURL, reducedMotion: 'reduce' }`.
- `baseURL` = `http://127.0.0.1:${PORT}` where PORT is read from the environment (default matches the server's default port; resolved in `support/server.ts`).
- `webServer`: starts the real server (`node apps/server/dist/index.js`) with `cwd` = repo root (so dotenv finds the root `.env`, per the build-plan run note), `url` = `${baseURL}/health`, `reuseExistingServer: true`, generous `timeout`. The launcher ensures `apps/web/dist` and `apps/server/dist` exist (builds them if missing) before spawning, so the server serves the SPA.
- `globalSetup`: `./global-setup.ts`.
- `outputDir` / reporter output under `e2e/artifacts/` (gitignored).
- **No** `expect.toHaveScreenshot` baselines configured.

**`global-setup.ts` (precondition guard):** before any test, fetch `${baseURL}/api/reports`. If unreachable, throw with the docker/up + seed remediation commands. If reachable but the report list (or the AMR report's data) is empty, throw with the seed remediation commands. This makes "stack not seeded" fail fast and self-explanatory.

---

## 5. Smoke suite — `tests/smoke.spec.ts`

Five deterministic specs over the real stack (the agent-free pass/fail signal):

1. **Health** — GET `/health` (via Playwright `request`) returns 200 and status not `down`.
2. **Dashboard renders** — navigate `/`; at least one report card is visible (cards rendered from real `/api/reports` data).
3. **AMR resistance value** — navigate into the AMR-resistance report detail; assert the known WHONET acceptance figure (**100% R on AMP**) is visible in the rendered report. (Anchors the test to real ingested data flowing through the reporting stack.)
4. **CSV export** — trigger the CSV export on the AMR report; assert a download occurs, the file is **non-empty**, and the first line is the expected CSV header row.
5. **SPA fallback / 404** — navigate to an unknown client route; assert the "Page not found" card renders (server `setNotFoundHandler` → `index.html` → client router catch-all).

Specs wait on visible elements / network idle rather than fixed sleeps. Chart-dependent assertions wait for the Recharts SVG to be present.

---

## 6. Visual-verification harness — `pnpm verify:ui` (`capture/capture.spec.ts`)

A capture spec navigates a fixed matrix and writes named PNGs to `e2e/artifacts/screenshots/`. Captures are made stable by `reducedMotion: 'reduce'`, disabling CSS animation/transition, and waiting for the Recharts SVG to settle before shooting.

**Matrix (≈6 PNGs):**

| name | route | viewport | theme |
|---|---|---|---|
| `dashboard-dark` | `/` | 1440×900 | dark (default) |
| `dashboard-light` | `/` | 1440×900 | light |
| `dashboard-narrow` | `/` | 768×1024 | dark |
| `report-amr-dark` | AMR report detail | 1440×900 | dark |
| `report-amr-light` | AMR report detail | 1440×900 | light |
| `notfound-dark` | unknown route | 1440×900 | dark |

Theme is switched via the SPA's existing light/dark toggle (UI-honest) or by seeding the theme state before load; the chosen mechanism is an implementation detail recorded in the plan. Each capture is `fullPage` where it adds value (dashboard grid), viewport-only otherwise.

**`rubric.md`** — a committed checklist of what each screen should look like, so the agent's judgment is anchored, not vibes:
- **Tokens/theme:** dark-native background `#171717`/`#1a1a1a`/`#1e1e1e`; steelblue accents `#4682B4`/`#5A9BD6`; borders, not drop-shadows; Inter ~14px. Light variant inverts surfaces correctly with the same accent.
- **Shell:** sidebar 240px + topnav 48px; nav items present (Forms/Users/Audit stubbed/disabled is acceptable).
- **Dashboard:** responsive card grid; each card shows a report name, description, and a rendered chart (bar/line/pie) — **no** loading/empty/error states in the captured frame.
- **Report detail:** title, param bar, a rendered chart, data table, CSV export affordance.
- **404:** the "Page not found" card inside the shell.
- **Narrow:** the grid reflows to fewer columns without overflow/clipping.

**The agent loop:** run `pnpm verify:ui` → Read each PNG with the Read tool → compare against `rubric.md` → report pass/notes per screen. This is the concrete realization of "a harness an agent can use to visually verify the UI."

---

## 7. Reproducibility

- **`pnpm e2e:install-browsers`** → a script (`scripts/install-playwright-browsers.mjs`) that sets `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright` (unless already set) and runs `playwright install chromium`. Idempotent; respects an already-populated cache.
- **`e2e/README.md`** documents: prerequisites, the mirror env, browser install, the seed pipeline, and the run commands. Notes the ECC Playwright MCP is unusable here (extension-bridge) and that the harness uses the repo Playwright + on-disk PNGs instead.
- **`.gitignore`** gains `e2e/artifacts/`, `**/playwright-report/`, `**/test-results/`. The global `~/AppData/Local/ms-playwright` browser cache is outside the repo (not committed).

---

## 8. Testing strategy

- The smoke suite **is** the automated test deliverable; there are no unit tests for test code. Any non-trivial pure helper (e.g. PORT/baseURL resolution, CSV-header check) is small and exercised by the specs.
- `pnpm test` (vitest, unit) is unchanged and still excludes E2E.
- `pnpm typecheck` covers the e2e TypeScript (its own tsconfig; Playwright types).

---

## 9. Live acceptance (closes Phase-1)

1. Docker up; `pnpm install`; `pnpm e2e:install-browsers`.
2. `pnpm e2e:seed` (db reset → build:plugins → plugin install → ingest WHONET).
3. `pnpm e2e` → all 5 smoke specs pass.
4. `pnpm verify:ui` → the screenshot gallery is produced under `e2e/artifacts/screenshots/`.
5. The agent Reads each PNG and verifies it against `rubric.md`, reporting per-screen results.

Passing 3–5 demonstrates **P1-NFR-5** and completes the §8 build sequence — Phase-1 is feature-complete.

---

## 10. Risks & mitigations

- **Mirror drift** — npmmirror could change the layout or drop rev 1155. Mitigation: pin the version; the README records the rev and the fallback (any rev with both chromium + headless-shell on the mirror). The global browser cache already holds 1155.
- **Docker not running / DB unseeded** — the precondition guard fails fast with exact commands.
- **Recharts render timing** — captures/assertions wait for the SVG to settle; `reducedMotion` + animation-disable reduce flake.
- **Server port coupling** — baseURL/PORT resolved from env in one place (`support/server.ts`) so the override-compose port remap doesn't desync config.
- **Built-artifact regressions** — `webServer` runs the **built** `dist` server (consistent with the "artifacts must be RUN" convention), so a tsup bundling break surfaces here too.
