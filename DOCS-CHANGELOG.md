# Documentation Changelog

Date: 2026-06-25

## Added

- Rebuilt the active in-app documentation as a twelve-guide, English-first web manual focused on signed-in web-interface tasks.
- Added step-by-step coverage for Dashboard, Reports, Workflows, Forms, Terminology, Users and Roles, Audit, Settings, Connectors, and Marketplace.
- Added an **Advanced Docs — Coming soon** placeholder that points future installation, deployment, API, CLI, plugin, and operator troubleshooting material to the planned dedicated advanced web app.
- Added manifest-driven Playwright screenshot capture with focused crops, masks, and numbered callouts for the active guide screenshots.
- Added deterministic docs fixture seeding for screenshots, including a DHIS2-free marketplace sample bundle.
- Added end-to-end coverage for grouped docs navigation, search, workflow guide metadata/procedures, screenshot lightbox behavior, English fallback, download-menu reachability, and retired DHIS2 docs exclusion.

## Fixed

- Removed DHIS2 from the active in-app documentation registry, search results, screenshot manifest, and bundled screenshot assets.
- Replaced the old self-referential documentation screenshots with twenty-two current, task-focused web-interface screenshots.
- Removed stale French and Portuguese markdown from the active docs set so those locales consistently show the English fallback notice until translations are authored.
- Replaced generic connector examples in the web interface with external-system wording so docs screenshots do not teach a soon-to-be-retired integration path.

## Counts

- Active English guides: **12**.
- Committed guide screenshots: **22**.
- Active French/Portuguese authored guides: **0**; both locales intentionally fall back to English.

## Notes

- This entry supersedes the June 23 “Still Missing” notes about fresh GUI screenshots, missing in-app pages for Workflows/Forms/Marketplace/Users/Audit, and DHIS2-active docs.

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
