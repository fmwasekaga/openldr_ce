# Documentation Changelog

Date: 2026-06-23

## Added

- `AUDIT-REPORT.md`: read-only audit findings, build/test/depcruise results, git state, and prioritized recommendations.
- `docs/CONFIGURATION.md`: environment reference for every key in `packages/config/src/schema.ts`, plus PowerShell/bash setup and troubleshooting.
- `docs/HTTP-API.md`: server route inventory grouped by feature area.
- `docs/CLI-REFERENCE.md`: command-family reference with exit-code guidance and a pointer to captured terminal output.
- `docs/OPERATOR-GUIDE.md`: operator setup and user-facing area guide for Dashboards, Reports, Workflows, Marketplace, Forms, DHIS2, Users/Audit, and i18n.
- `docs/audit/2026-06-23/cli-help-output.md`: captured `--help` output for 99 CLI command forms.
- `docs/audit/2026-06-23/*.log`: install, turbo, isolated web test, depcruise, and screenshot-capture logs.

## Fixed

- `README.md`: replaced stale root `pnpm dev` quick start with `pnpm -C apps/server dev` and `pnpm -C apps/web dev`.
- `README.md`: updated project structure to include server, e2e, and recently shipped packages.
- `README.md`: removed the broken `CONTRIBUTING.md` link and linked the new reference docs.
- `apps/web/src/docs/0.1.0/en/cli.md`: expanded from a partial sample into a complete command-family guide.
- `apps/web/src/docs/0.1.0/en/getting-started.md`: added `.env` setup, frozen install, PowerShell and bash commands, and package-specific dev scripts.
- `apps/web/src/docs/0.1.0/en/overview.md`: added Workflows, Forms, Users, Audit, and Marketplace coverage.
- `apps/web/src/docs/0.1.0/en/dhis2.md`: added sync flag, metadata/status commands, dry-run guidance, and config troubleshooting.
- `apps/web/src/docs/0.1.0/en/reports.md`: added run history, schedules, and CLI examples.
- `apps/web/src/docs/0.1.0/en/dashboard.md`: added SQL widget config and workflow dataset publishing note.
- `apps/web/src/docs/0.1.0/en/external-db.md`: added missing SQL Server env vars and adapter-required-key guidance.
- `apps/web/src/docs/0.1.0/en/ingestion.md`: added pipeline/queue/logs/retry examples.

## Counts

- CLI command outputs captured: **99**.
- Screenshots captured/refreshed: **0**.
- Existing screenshot assets left in place: **4** (`dashboard.png`, `report-amr.png`, `docs.png`, `doc-dhis2.png`).

## Still Missing

- Fresh GUI screenshots: `pnpm docs:screenshots` built web/server but failed first with `GET /api/reports -> 401` on port 3000, then with `amr-resistance has no rows` on port 3100. The harness requires `docker compose up -d` and `pnpm e2e:seed`; I did not reset/seed the local DB without explicit approval.
- First-class in-app pages for Workflows, Forms, Marketplace, Users, and Audit: adding slugs requires editing `apps/web/src/docs/registry.ts`, which is application source and outside the docs-only edit scope.
- Localized French/Portuguese doc parity for the expanded English pages: only the English bundled markdown was updated in this docs-only pass.
