# OpenLDR CE Documentation and Repo Audit

Audit date: 2026-06-23  
Repository: `D:\Projects\Repositories\openldr_ce`

## Executive Summary

- `pnpm install --frozen-lockfile` succeeded with exit code 0; no lockfile drift was detected in that run. Full log: `docs/audit/2026-06-23/pnpm-install-frozen-lockfile.log`.
- `pnpm turbo typecheck lint test build` failed with exit code 1 because `@openldr/web#test` failed. Full log: `docs/audit/2026-06-23/pnpm-turbo-typecheck-lint-test-build.log`.
- The required isolated web test rerun also failed with exit code 1, but on a different single test: `apps/web/src/dashboard/DashboardPage.test.tsx:34`.
- `pnpm depcruise` succeeded with exit code 0 and reported no dependency violations across 1136 modules and 2479 dependencies.
- The root quick start was stale: it told users to run `pnpm dev`, but the root scripts do not define `dev` (`README.md:117-118`, `package.json:9-29`).
- The root README linked to a missing `CONTRIBUTING.md` (`README.md:189`), so the link would fail.
- In-app docs navigation is limited to nine slugs (`apps/web/src/docs/registry.ts:14-16`) while the app has shipped routes for workflows, forms, users, audit, settings/DHIS2, and marketplace (`apps/web/src/App.tsx:31-54`).
- The CLI docs were substantially incomplete: `apps/web/src/docs/0.1.0/en/cli.md` had only a handful of database/plugin/report/DHIS2 examples, while the commander tree exposes 99 captured help surfaces from `packages/cli/src/index.ts:21-464`.
- Internal migrations are contiguous and registered from `001_fhir_resources` through `032_workflow_dataset_published` (`packages/db/src/migrations/internal/index.ts:1-67`); external migrations are contiguous and registered through `002_specimen_origin` (`packages/db/src/migrations/external/index.ts:1-10`).
- Docs screenshots could not be refreshed because the docs capture harness required a seeded WHONET dataset. On port 3000 it hit `GET /api/reports -> 401`; on port 3100 it started its own server but failed with `amr-resistance has no rows`.

## Documentation Issues

| File | Line/section | What is wrong | Suggested fix |
|---|---:|---|---|
| `README.md` | `117-118` | Quick start says `pnpm dev`, but root `package.json:9-29` has no `dev` script. | Use `pnpm -C apps/server dev` and `pnpm -C apps/web dev`. |
| `README.md` | `139-151` | Project structure omitted `apps/server`, `e2e`, and recently shipped packages such as `workflows`, `marketplace`, `dashboards`, `dhis2`, and `terminology`. Actual routes and imports show those areas are live (`apps/web/src/App.tsx:15-21`, `apps/web/src/App.tsx:31-54`). | Expand the structure table to match the monorepo. |
| `README.md` | `189` | Links to `CONTRIBUTING.md`, but no such file is present in the repo. | Remove the link or add the guide. |
| `apps/web/src/docs/registry.ts` | `14-16` | Bundled docs nav includes only overview/getting-started/dashboard/reports/ingestion/terminology/DHIS2/external-db/CLI. It has no first-class pages for Workflows, Forms, Users, Audit, or Marketplace, despite app routes for those surfaces (`apps/web/src/App.tsx:33`, `apps/web/src/App.tsx:45`, `apps/web/src/App.tsx:48-52`). | Add docs pages in a future source change, or keep broader docs under `docs/**` until source edits are allowed. |
| `apps/web/src/docs/0.1.0/en/cli.md` | whole file before Part B | It documented only a small subset of CLI commands, while `packages/cli/src/index.ts:21-464` exposes health, fhir, db, target-store, terminology, forms, pipeline, queue, provenance, plugin, report, audit, users/user, export, DHIS2, market, and artifact commands. | Replace with a complete command-family guide and captured help appendix. |
| `apps/web/src/docs/0.1.0/en/getting-started.md` | install section before Part B | It omitted `.env` creation, `--frozen-lockfile`, and separate server/web dev commands. Root scripts show no root dev command (`package.json:9-29`); server/web package scripts define `dev` separately (`apps/server/package.json:7-14`, `apps/web/package.json:6-13`). | Document PowerShell and bash setup using package-specific dev commands. |
| `apps/web/src/docs/0.1.0/en/dhis2.md` | connecting/pushing sections before Part B | It did not document `DHIS2_SYNC_ENABLED`, `pull-metadata`, `status`, or dry-run as the safest live-push path, despite CLI commands at `packages/cli/src/index.ts:374-378`. | Add connection defaults, metadata/status commands, and dry-run examples. |
| `apps/web/src/docs/0.1.0/en/external-db.md` | SQL Server config before Part B | It omitted `MSSQL_ENCRYPT` and `MSSQL_TRUST_SERVER_CERT`, both in config schema (`packages/config/src/schema.ts:47-48`). | Add all SQL Server target-store settings. |
| `apps/web/src/docs/0.1.0/en/dashboard.md` | Custom SQL before Part B | It described SQL mode but did not list controlling env vars. Config schema defines `DASHBOARD_SQL_ENABLED`, `DASHBOARD_SQL_TIMEOUT_MS`, and `DASHBOARD_SQL_ROW_CAP` (`packages/config/src/schema.ts:79-81`). | Add config reference and workflow dataset note. |
| `apps/web/src/docs/0.1.0/en/reports.md` | schedule/history gap before Part B | The docs did not mention report run history or schedules, while routes exist at `apps/server/src/reports-routes.ts:79-178`. | Add history/schedules section. |
| `apps/web/src/i18n/en.ts` | `310` | Marketplace still carries an `Install (coming soon)` string, but form-template install is now supported for installable types in `apps/web/src/pages/settings/marketplace/PackageDetail.tsx:40-43` and tests cover form-template install (`apps/web/src/pages/settings/Marketplace.test.tsx`). | Narrow the label to non-installable artifact kinds, or rename it to avoid implying all install is pending. |
| `apps/web/src/shell/AppShell.tsx` | `130` | Live TODO notes settings-nav visibility is hard-coded to current lab-admin-only sections. | Track as UI cleanup once non-admin settings sections exist. |

## Remaining / Unfinished Work

### Workflows

- `apps/web/src/workflows/constants.ts:5` and `apps/web/src/workflows/components/sidebar.tsx:26` intentionally render unimplemented palette nodes as disabled "coming soon". Effort: **M**, because enabling more templates requires handlers, node forms, and tests.
- Code node TypeScript remains disabled (`apps/web/src/workflows/components/node-forms/code-form.tsx:30`). Effort: **M**, because the runtime currently runs JavaScript and would need TypeScript transpilation or a documented compile path.

### Marketplace

- Non-plugin/non-form-template available artifacts still show disabled "Install (coming soon)" in detail (`apps/web/src/pages/settings/marketplace/PackageDetail.tsx:40-43`, `apps/web/src/pages/settings/marketplace/PackageDetail.tsx:78-82`). Effort: **S** if only copy is clarified, **M** if report-template install is implemented.

### In-App Docs

- New first-class docs pages for Workflows, Forms, Users, Audit, and Marketplace require editing `apps/web/src/docs/registry.ts:14-16`, which is source code and outside this docs-only task. Effort: **S/M** after source edits are allowed.

### Settings/Auth

- Settings nav visibility TODO remains in `apps/web/src/shell/AppShell.tsx:130`. Effort: **S** once multiple settings sub-sections with mixed roles exist.

### Live/acceptance gaps

- Docs screenshots require a seeded WHONET dataset. The harness states the required setup in `e2e/global-setup.ts:15-26` and failed accordingly during this audit. Effort: **S** if the local stack can be reset/seeded; otherwise **M** to make docs capture use fixture-backed data.

## Dead Code and Consistency Findings

- Dependency Cruiser reported no dependency violations: `pnpm depcruise` exit code 0, "no dependency violations found (1136 modules, 2479 dependencies cruised)".
- Internal migration sequence is contiguous and registered: `packages/db/src/migrations/internal/index.ts:1-67` includes `001` through `032`.
- External migration sequence is contiguous and registered: `packages/db/src/migrations/external/index.ts:1-10` includes `001` and `002`.
- I did not prove package-level dead-code absence beyond depcruise; no source deletions were attempted under the docs-only constraint.

## Build, Test, Depcruise, Screenshot Results

Full logs are under `docs/audit/2026-06-23/`. The PowerShell capture includes ANSI/encoding noise in long logs; the command headers and exit markers are present.

```console
PS D:\Projects\Repositories\openldr_ce> pnpm install --frozen-lockfile
Scope: all 29 workspace projects
Already up to date
Done in 603ms using pnpm v11.5.2
EXIT_CODE=0
```

```console
PS D:\Projects\Repositories\openldr_ce> pnpm turbo typecheck lint test build
Tasks: 84 successful, 86 total
Failed: @openldr/web#test
src/pages/Terminology.test.tsx:150:38
EXIT_CODE=1
```

```console
PS D:\Projects\Repositories\openldr_ce> pnpm -C apps/web test
FAIL src/dashboard/DashboardPage.test.tsx > DashboardPage > seeds a default dashboard when none exist
src/dashboard/DashboardPage.test.tsx:34:18
EXIT_CODE=1
```

```console
PS D:\Projects\Repositories\openldr_ce> pnpm depcruise
no dependency violations found (1136 modules, 2479 dependencies cruised)
EXIT_CODE=0
```

```console
PS D:\Projects\Repositories\openldr_ce> pnpm docs:screenshots
@openldr/web:build: built in 21.04s
Error: GET /api/reports -> 401
EXIT_CODE=1
```

```console
PS D:\Projects\Repositories\openldr_ce> $env:PORT=3100; pnpm --filter @openldr/e2e docs:screenshots
Server listening at http://127.0.0.1:3100
GET /api/reports -> 200
GET /api/reports/amr-resistance -> 200
Error: amr-resistance has no rows (DB not seeded with WHONET data?).
EXIT_CODE=1
```

## Git State

Initial audit state:

```console
PS D:\Projects\Repositories\openldr_ce> git status --short --branch
## main...origin/main
```

```console
PS D:\Projects\Repositories\openldr_ce> git log origin/main..main --oneline
(no output)
```

Local `main` was not ahead of `origin/main` at audit start and had no uncommitted files before this docs work began.

## Prioritized Recommendations

1. Fix or quarantine the two web test failures before treating the repo as build/test clean: turbo web failure at `apps/web/src/pages/Terminology.test.tsx:150` and isolated web failure at `apps/web/src/dashboard/DashboardPage.test.tsx:34`.
2. Add first-class in-app doc pages for Workflows, Forms, Marketplace, Users, and Audit once source edits to `apps/web/src/docs/registry.ts` are allowed.
3. Seed the local e2e stack with `docker compose up -d` and `pnpm e2e:seed`, then rerun `pnpm docs:screenshots` to refresh Dashboard, AMR report, docs, and DHIS2 screenshots.
4. Clarify Marketplace "coming soon" copy so it applies only to artifact kinds that are not currently installable.
5. Keep `docs/CLI-REFERENCE.md`, `docs/CONFIGURATION.md`, and `docs/HTTP-API.md` in review whenever CLI routes, config schema, or server routes change.
