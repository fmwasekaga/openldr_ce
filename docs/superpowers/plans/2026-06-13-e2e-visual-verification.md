# E2E + Agent Visual-Verification Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright E2E smoke suite over the dashboard SPA (served by the real `apps/server` + Docker stack) plus an agent-driven visual-verification harness (`pnpm verify:ui`) that captures a curated screenshot gallery an agent reads and judges against a committed rubric. Closes P1-NFR-5 and the §8 build sequence.

**Architecture:** A new private workspace package `@openldr/e2e` (in `e2e/`) using `@playwright/test@1.50.0` (Chromium rev 1155 — the newest rev mirrored on npmmirror). Playwright's `webServer` launches the built `apps/server/dist` (cwd = repo root for dotenv) with `reuseExistingServer`. A `globalSetup` precondition guard fails fast with seed instructions if the DB isn't seeded. Two Playwright projects: `smoke` (5 deterministic specs) and `capture` (screenshot gallery → `e2e/artifacts/screenshots/`, no pixel baselines). The e2e run script is named `e2e` (not `test`) so `turbo test` skips it automatically.

**Tech Stack:** Playwright Test 1.50.0, TypeScript (ESM, `moduleResolution: Bundler`), pnpm 11 workspaces, turbo, Fastify server + React/Vite SPA + Recharts (existing).

---

## Environment preconditions (operator, once per machine/session)

These are NOT plan steps — they are the live-stack prerequisites the harness assumes:
- Docker Desktop running; `docker compose up -d` (Postgres 5433 / MinIO 9000 / Keycloak 8180 via the git-ignored override).
- `pnpm install` has been run.
- Chromium installed via the mirror (Task 2 adds the script; run `pnpm e2e:install-browsers`).
- DB seeded via `pnpm e2e:seed` (Task 2 adds the script).

Known facts the specs depend on (verified in the codebase):
- Server PORT = **3000** (`.env` and `.env.example`), binds `0.0.0.0`. baseURL = `http://127.0.0.1:3000`.
- AMR report id = **`amr-resistance`**, name **"AMR Resistance Rate"**; seeded WHONET data yields **100% R on AMP**.
- CSV route sets `content-disposition: attachment` (so the Export-CSV link fires a real download). CSV header line = **`Antibiotic,Tested,R,I,S,%R`** (from column labels via `toCsv`).
- Theme: `data-theme` attribute on `<html>` + `localStorage['openldr-theme']` ('dark' default).
- Recharts renders an `svg.recharts-surface`.
- Report cards are `<Link to="/reports/:id">` containing an `<h3>` with the report name. 404 route renders the text `Page not found.`.

---

## Task 1: Scaffold the `@openldr/e2e` package

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/tsconfig.json`
- Create: `e2e/.gitignore`
- Modify: `pnpm-workspace.yaml` (add `e2e` to packages)

- [ ] **Step 1: Create `e2e/package.json`**

```json
{
  "name": "@openldr/e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "e2e": "playwright test --project=smoke",
    "capture": "playwright test --project=capture",
    "typecheck": "tsc --noEmit",
    "lint": "echo \"no lint\""
  },
  "devDependencies": {
    "@playwright/test": "1.50.0",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2"
  }
}
```

Note: the run script is `e2e`, NOT `test` — `turbo test` only runs a package's `test` script, so naming it `e2e` keeps the suite out of `pnpm test` with no extra config.

- [ ] **Step 2: Create `e2e/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["**/*.ts"],
  "exclude": ["artifacts"]
}
```

- [ ] **Step 3: Create `e2e/.gitignore`**

```gitignore
artifacts/
```

- [ ] **Step 4: Register the workspace** — edit `pnpm-workspace.yaml`. Change the `packages:` block from:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

to:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'e2e'
```

Leave the `allowBuilds:` block unchanged. Deliberately do NOT add playwright to `allowBuilds`: that keeps pnpm from running Playwright's browser-download postinstall (which would hit the blocked CDN). Browsers are installed separately via the mirror script in Task 2.

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: completes; `e2e/node_modules/.bin/playwright` exists. No browser download is attempted during install.

- [ ] **Step 6: Verify the playwright CLI resolves**

Run: `pnpm --filter @openldr/e2e exec playwright --version`
Expected: `Version 1.50.0`

- [ ] **Step 7: Commit**

```bash
git add e2e/package.json e2e/tsconfig.json e2e/.gitignore pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(e2e): scaffold @openldr/e2e package (P1-NFR-5)"
```

---

## Task 2: Mirror-aware browser install script + root wiring + .gitignore

**Files:**
- Create: `scripts/install-playwright-browsers.mjs`
- Modify: `package.json` (root — add scripts)
- Modify: `.gitignore` (root — add Playwright artifacts)

- [ ] **Step 1: Create `scripts/install-playwright-browsers.mjs`**

```js
// Installs Chromium for the e2e package via the npmmirror mirror (the direct
// Playwright CDN -> storage.googleapis.com times out on this machine). Idempotent:
// re-running with the browser already cached is a fast no-op. Override the host by
// exporting PLAYWRIGHT_DOWNLOAD_HOST before invoking.
import { spawnSync } from 'node:child_process';

const MIRROR = 'https://cdn.npmmirror.com/binaries/playwright';
if (!process.env.PLAYWRIGHT_DOWNLOAD_HOST) {
  process.env.PLAYWRIGHT_DOWNLOAD_HOST = MIRROR;
  console.log(`[e2e] PLAYWRIGHT_DOWNLOAD_HOST=${MIRROR}`);
} else {
  console.log(`[e2e] using existing PLAYWRIGHT_DOWNLOAD_HOST=${process.env.PLAYWRIGHT_DOWNLOAD_HOST}`);
}

const res = spawnSync(
  'pnpm',
  ['--filter', '@openldr/e2e', 'exec', 'playwright', 'install', 'chromium'],
  { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
);
process.exit(res.status ?? 1);
```

- [ ] **Step 2: Add root scripts** — edit `package.json` `scripts` block. Add these four entries (alongside the existing ones):

```json
    "e2e": "turbo build --filter=@openldr/web --filter=@openldr/server && pnpm --filter @openldr/e2e e2e",
    "verify:ui": "turbo build --filter=@openldr/web --filter=@openldr/server && pnpm --filter @openldr/e2e capture",
    "e2e:install-browsers": "node scripts/install-playwright-browsers.mjs",
    "e2e:seed": "pnpm make:whonet-sample && pnpm build:plugins && pnpm openldr db reset && pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm && pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite"
```

(`pnpm e2e` / `pnpm verify:ui` build the SPA + server first, then run Playwright, whose `webServer` launches the built server.)

- [ ] **Step 3: Add Playwright artifacts to root `.gitignore`** — append:

```gitignore
playwright-report/
test-results/
e2e/artifacts/
```

- [ ] **Step 4: Run the browser install**

Run: `pnpm e2e:install-browsers`
Expected: prints the mirror host, then either downloads `chromium`/`chromium-headless-shell` rev 1155 or reports they're already installed. Exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-playwright-browsers.mjs package.json .gitignore
git commit -m "chore(e2e): mirror-aware browser install + root e2e scripts (P1-NFR-5)"
```

---

## Task 3: Shared config + Playwright config + precondition guard

**Files:**
- Create: `e2e/support/config.ts`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/global-setup.ts`

- [ ] **Step 1: Create `e2e/support/config.ts`**

```ts
// Single source of truth for the server port / baseURL so the override-compose
// port remap can't desync the config from the running server.
export const PORT = Number(process.env.PORT ?? 3000);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
```

- [ ] **Step 2: Create `e2e/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { BASE_URL } from './support/config';

// Repo root (one level up from e2e/) so the built server finds the root .env via dotenv.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  globalSetup: './global-setup.ts',
  outputDir: 'artifacts/test-results',
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'smoke', testDir: 'tests' },
    { name: 'capture', testDir: 'capture' },
  ],
  webServer: {
    command: 'node apps/server/dist/index.js',
    cwd: repoRoot,
    url: `${BASE_URL}/health`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
```

- [ ] **Step 3: Create `e2e/global-setup.ts`**

```ts
import { request, type FullConfig } from '@playwright/test';
import { BASE_URL } from './support/config';

const SEED_HELP = [
  '',
  'The stack appears unseeded or unreachable. Bring it up and seed it, then re-run:',
  '  docker compose up -d',
  '  pnpm e2e:seed',
].join('\n');

// Fail fast with actionable instructions if the live stack has no data, instead of
// letting individual specs fail with confusing UI errors.
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const listRes = await ctx.get('/api/reports');
    if (!listRes.ok()) throw new Error(`GET /api/reports -> ${listRes.status()}${SEED_HELP}`);
    const reports = (await listRes.json()) as { id: string }[];
    if (!Array.isArray(reports) || reports.length === 0) {
      throw new Error(`GET /api/reports returned no reports.${SEED_HELP}`);
    }
    const amrRes = await ctx.get('/api/reports/amr-resistance');
    if (!amrRes.ok()) throw new Error(`GET /api/reports/amr-resistance -> ${amrRes.status()}${SEED_HELP}`);
    const amr = (await amrRes.json()) as { rows: unknown[] };
    if (!Array.isArray(amr.rows) || amr.rows.length === 0) {
      throw new Error(`amr-resistance has no rows (DB not seeded with WHONET data?).${SEED_HELP}`);
    }
  } finally {
    await ctx.dispose();
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @openldr/e2e typecheck`
Expected: PASS (no errors). If it complains about missing test specs, that's fine — there are none yet; tsconfig `include` is `**/*.ts` so config + support + global-setup compile.

- [ ] **Step 5: Commit**

```bash
git add e2e/support/config.ts e2e/playwright.config.ts e2e/global-setup.ts
git commit -m "feat(e2e): playwright config + precondition guard (P1-NFR-5)"
```

---

## Task 4: Smoke spec — health + dashboard render

**Files:**
- Create: `e2e/tests/smoke.spec.ts`

**Prereq for running:** Docker up + `pnpm e2e:seed` already run (see Environment preconditions).

- [ ] **Step 1: Create `e2e/tests/smoke.spec.ts` with the first two specs**

```ts
import { test, expect } from '@playwright/test';

test('health endpoint is up', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string };
  expect(body.status).not.toBe('down');
});

test('dashboard renders report cards from live data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AMR Resistance Rate' })).toBeVisible();
});
```

- [ ] **Step 2: Run the smoke project**

Run: `pnpm e2e`
Expected: builds web+server, launches the server, globalSetup passes, both specs PASS.
If globalSetup throws the seed message: run `docker compose up -d` then `pnpm e2e:seed`, then retry.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/smoke.spec.ts
git commit -m "test(e2e): smoke - health + dashboard render (P1-NFR-5)"
```

---

## Task 5: Smoke spec — AMR resistance value (real data through the stack)

**Files:**
- Modify: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Append the AMR spec** to `e2e/tests/smoke.spec.ts`:

```ts
test('AMR report shows 100% resistance on AMP', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link').filter({ hasText: 'AMR Resistance Rate' }).click();
  await expect(page).toHaveURL(/\/reports\/amr-resistance/);
  const ampRow = page.getByRole('row').filter({ hasText: 'AMP' });
  await expect(ampRow).toContainText('100%');
});
```

- [ ] **Step 2: Run**

Run: `pnpm e2e`
Expected: all 3 specs PASS. The AMP row shows `100%` in the %R column, proving WHONET data flowed through ingest → flat tables → reporting → API → SPA.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/smoke.spec.ts
git commit -m "test(e2e): smoke - AMR 100%R on AMP end-to-end (P1-NFR-5)"
```

---

## Task 6: Smoke spec — CSV export download

**Files:**
- Modify: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Add the import** at the top of `e2e/tests/smoke.spec.ts` (below the existing import):

```ts
import { readFileSync } from 'node:fs';
```

- [ ] **Step 2: Append the CSV spec**:

```ts
test('CSV export downloads a non-empty file with the expected header', async ({ page }) => {
  await page.goto('/reports/amr-resistance');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export CSV' }).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();
  const content = readFileSync(file!, 'utf8');
  expect(content.length).toBeGreaterThan(0);
  expect(content.split('\n')[0]).toBe('Antibiotic,Tested,R,I,S,%R');
});
```

- [ ] **Step 3: Run**

Run: `pnpm e2e`
Expected: all 4 specs PASS. The download fires (route sets `content-disposition: attachment`), the file is non-empty, and the first line equals the header.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/smoke.spec.ts
git commit -m "test(e2e): smoke - CSV export download (P1-NFR-5)"
```

---

## Task 7: Smoke spec — SPA 404 fallback

**Files:**
- Modify: `e2e/tests/smoke.spec.ts`

- [ ] **Step 1: Append the 404 spec**:

```ts
test('unknown route renders the SPA not-found state', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByText('Page not found.')).toBeVisible();
});
```

- [ ] **Step 2: Run the full suite**

Run: `pnpm e2e`
Expected: all 5 specs PASS. (The server `setNotFoundHandler` serves `index.html`; the client router's `path="*"` route renders the not-found card.)

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/smoke.spec.ts
git commit -m "test(e2e): smoke - SPA 404 fallback (P1-NFR-5)"
```

---

## Task 8: Visual-verification capture spec + rubric

**Files:**
- Create: `e2e/capture/capture.spec.ts`
- Create: `e2e/rubric.md`

- [ ] **Step 1: Create `e2e/capture/capture.spec.ts`**

```ts
import { test, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Screenshots land in e2e/artifacts/screenshots/ (gitignored). An agent reads these
// PNGs and judges them against rubric.md. No pixel baselines.
const OUT = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

type Shot = {
  name: string;
  path: string;
  theme: 'dark' | 'light';
  width: number;
  height: number;
  fullPage: boolean;
  chart: boolean;
};

const SHOTS: Shot[] = [
  { name: 'dashboard-dark', path: '/', theme: 'dark', width: 1440, height: 900, fullPage: true, chart: true },
  { name: 'dashboard-light', path: '/', theme: 'light', width: 1440, height: 900, fullPage: true, chart: true },
  { name: 'dashboard-narrow', path: '/', theme: 'dark', width: 768, height: 1024, fullPage: true, chart: true },
  { name: 'report-amr-dark', path: '/reports/amr-resistance', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: true },
  { name: 'report-amr-light', path: '/reports/amr-resistance', theme: 'light', width: 1440, height: 900, fullPage: false, chart: true },
  { name: 'notfound-dark', path: '/nope', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: false },
];

async function capture(browser: Browser, shot: Shot): Promise<void> {
  const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height } });
  // Seed the theme before any app code runs.
  await context.addInitScript((theme) => {
    try { localStorage.setItem('openldr-theme', theme); } catch { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
  }, shot.theme);
  const page = await context.newPage();
  await page.goto(shot.path, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  if (shot.chart) {
    await page.locator('.recharts-surface').first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page.screenshot({ path: `${OUT}${shot.name}.png`, fullPage: shot.fullPage });
  await context.close();
}

for (const shot of SHOTS) {
  test(`capture ${shot.name}`, async ({ browser }) => {
    await capture(browser, shot);
  });
}
```

- [ ] **Step 2: Create `e2e/rubric.md`**

```markdown
# Visual-verification rubric

Run `pnpm verify:ui`, then Read each PNG in `e2e/artifacts/screenshots/` and check it
against the items below. Report PASS/notes per screen. This is agent judgment, not pixel diff.

## Global (every screen)
- Dark-native surfaces: page `#171717`, panels `#1a1a1a`/`#1e1e1e`. Light variant inverts to light surfaces.
- Accent is steelblue (`#4682B4` / `#5A9BD6`). Separation is via borders, not drop-shadows.
- Inter font, ~14px base. No raw error text, no stack traces, no broken layout.

## dashboard-dark / dashboard-light (1440x900, full page)
- Sidebar ~240px wide on the left: "OpenLDR" wordmark, Dashboard + Reports nav, disabled Forms/Users/Audit, an "operator/local" avatar block at the bottom.
- Topnav ~48px: "Dashboard" title left, theme toggle (sun/moon) right.
- Card grid of reports; each card has a title, a muted description, and a rendered chart (bar/line/pie) or stat — NOT a "Loading..." or error state.
- light variant: surfaces are light, text is dark, accent unchanged, contrast is readable.

## dashboard-narrow (768x1024)
- Same shell; the card grid reflows to fewer columns (1-2) with no horizontal overflow or clipped cards.

## report-amr-dark / report-amr-light (1440x900)
- Title reads "Report . amr-resistance" (or "Report").
- Param bar: two date inputs, a "Facility id" input, and an "Export CSV" button (pill/primary).
- A rendered bar chart of %R by antibiotic, then a data table with columns Antibiotic / Tested / R / I / S / %R, including an AMP row showing 100%.
- light variant: light surfaces, chart + table still legible.

## notfound-dark (1440x900)
- The app shell with a card containing "Page not found." — not a blank page or a server error.
```

- [ ] **Step 3: Run the capture project**

Run: `pnpm verify:ui`
Expected: builds, launches server, globalSetup passes, 6 capture tests PASS, and `e2e/artifacts/screenshots/` contains the 6 PNGs (`dashboard-dark.png`, `dashboard-light.png`, `dashboard-narrow.png`, `report-amr-dark.png`, `report-amr-light.png`, `notfound-dark.png`).

- [ ] **Step 4: Verify files exist**

Run (PowerShell): `Get-ChildItem e2e/artifacts/screenshots | Select-Object Name, Length`
Expected: 6 non-zero PNG files.

- [ ] **Step 5: Commit** (rubric + spec only — artifacts are gitignored)

```bash
git add e2e/capture/capture.spec.ts e2e/rubric.md
git commit -m "feat(e2e): visual-verification capture gallery + rubric (P1-NFR-5)"
```

---

## Task 9: README + final typecheck

**Files:**
- Create: `e2e/README.md`

- [ ] **Step 1: Create `e2e/README.md`**

```markdown
# @openldr/e2e — end-to-end + visual-verification harness

Browser E2E over the dashboard SPA served by the real `apps/server` + Docker stack,
plus an agent-driven visual-verification gallery. Satisfies P1-NFR-5.

## One-time setup (this machine)

Chromium downloads need a mirror — the direct Playwright CDN (`storage.googleapis.com`)
times out here. The install script sets `PLAYWRIGHT_DOWNLOAD_HOST` to npmmirror and the
package pins `@playwright/test@1.50.0` (Chromium rev 1155, the newest rev with both
chromium and chromium-headless-shell mirrored on npmmirror).

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
```

- [ ] **Step 2: Full typecheck across the repo**

Run: `pnpm typecheck`
Expected: PASS, including `@openldr/e2e`.

- [ ] **Step 3: Confirm `pnpm test` still excludes E2E**

Run: `pnpm test`
Expected: existing unit suites run and pass; Playwright is NOT invoked (the e2e package has no `test` script).

- [ ] **Step 4: Commit**

```bash
git add e2e/README.md
git commit -m "docs(e2e): harness README (P1-NFR-5)"
```

---

## Task 10: Live acceptance + agent visual verification (closes Phase-1)

**Files:** none (verification + memory update).

- [ ] **Step 1: Ensure stack is up and seeded**

Run: `docker compose up -d` then (if not already seeded this session) `pnpm e2e:seed`
Expected: ingest completes; `pnpm openldr provenance audit --json` shows 0 gaps.

- [ ] **Step 2: Run the smoke suite**

Run: `pnpm e2e`
Expected: 5/5 specs PASS.

- [ ] **Step 3: Run the visual capture**

Run: `pnpm verify:ui`
Expected: 6/6 capture tests PASS; 6 PNGs in `e2e/artifacts/screenshots/`.

- [ ] **Step 4: Agent visual verification**

Read each PNG with the Read tool and check it against `e2e/rubric.md`. Report PASS/notes per screen. This is the concrete demonstration of "a harness an agent can use to visually verify the UI" (P1-NFR-5).

- [ ] **Step 5: Update the build-plan memory** — mark sub-project 9 done and Phase-1 §8 build sequence complete; note any carry-forward limitations discovered (e.g. mirror dependency, port assumption). File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`.

- [ ] **Step 6: Finish the branch** — use the superpowers:finishing-a-development-branch skill to merge to `main`.

---

## Self-review notes (author)

- **Spec coverage:** §3 package → Task 1; §4 lifecycle/config → Tasks 2–3; §5 smoke (5 specs) → Tasks 4–7; §6 capture + rubric → Task 8; §7 reproducibility → Tasks 1–2 + README (Task 9); §8 testing strategy (e2e out of `pnpm test`, typecheck) → Task 1 (script name) + Task 9 steps 2–3; §9 live acceptance → Task 10.
- **No placeholders:** every file has full contents; every run step has an expected result.
- **Type/name consistency:** AMR id `amr-resistance`, name "AMR Resistance Rate", CSV header `Antibiotic,Tested,R,I,S,%R`, theme key `openldr-theme`/`data-theme`, `svg.recharts-surface`, PORT 3000, baseURL `http://127.0.0.1:3000` — used consistently across config, global-setup, smoke, capture, rubric.
