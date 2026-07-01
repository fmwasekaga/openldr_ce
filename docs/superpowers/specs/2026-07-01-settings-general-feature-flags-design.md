# Settings → General + feature-flags store — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorm)
**Origin:** User wants a corlix/v2-style Settings → General section, and to move `DASHBOARD_SQL_ENABLED` from an env var to a live, admin-toggleable setting.

## Decisions (from brainstorm)

- **General page scope:** About card + admin **Feature flags** card + admin **Danger Zone** card. (Corlix's desktop-specific MFL/sync/auto-updater/backup-to-file are out of scope for server CE.)
- **`DASHBOARD_SQL_ENABLED`:** **replace the env var entirely** — DB-backed flag only, default **false**.
- **Storage:** a **generic feature-flags / app-settings store** (reusable for future flags), not a one-off setting.
- **Danger Zone actions (all four, admin-only, typed confirmation):** reset dashboards to default; purge lab/ingested data; factory reset (wipe + reseed); clear audit log / run history.
- **Sequencing:** implement AFTER the in-flight round-2 fixes, since it re-touches the dashboard SQL-gate files.

## Design

### 1. Feature-flags / app-settings store (new)

- **Table** `app_settings`: `key` TEXT PK, `value` TEXT (or JSONB), `updated_at`, `updated_by`. Internal DB, new migration.
- **Store** `packages/db/src/app-settings-store.ts` (`createAppSettingsStore`): `get(key)`, `getAll()`, `set(key, value, actor)`. Surfaced on `AppContext`.
- **Typed flags registry** `packages/config/src/feature-flags.ts` (or similar): a declarative list of known flags `{ id, labelKey, descriptionKey, default: boolean }`. First entry: `dashboard.raw_sql` (default false). The registry drives both the seed and the Feature-flags UI, so adding a flag is one edit.
- **API** (`apps/server/src/settings-routes.ts`, `requireRole('lab_admin')` for writes):
  - `GET /api/settings/flags` → all known flags with current values (merged registry defaults + stored overrides).
  - `PUT /api/settings/flags/:key` → set a boolean flag; audited (`settings.flag.update`); returns the new value.
- **Caching:** flags are read on the hot path (dashboard queries). Cache the flag map in the store/context with a short TTL (e.g. 5s) or an in-process value invalidated on `set`. A stale window of seconds is acceptable.
- **Seed:** on first boot (migration or `seedDatabase`), initialize each registry flag's row to its default if absent. Idempotent.

### 2. Replace `DASHBOARD_SQL_ENABLED` env → `dashboard.raw_sql` flag

- Remove `DASHBOARD_SQL_ENABLED` from `packages/config/src/schema.ts`.
- Rewire the three current read-sites (just refactored in `3fb7634`) to read the `dashboard.raw_sql` flag from the app-settings store instead of `cfg.DASHBOARD_SQL_ENABLED`:
  - authoring gate — `apps/server/src/dashboards-routes.ts` (`assertSqlAuthoringAllowed`)
  - execution vetting — the bootstrap dashboard-query runner (`packages/bootstrap/src/index.ts`, `isSqlExecutionAllowed`)
  - client exposure — `apps/server/src/app.ts` `/config` (`dashboardSqlEnabled`)
- The runner + routes get the flag value from the store (via `AppContext`). The `TARGET_STORE_ADAPTER==='pg'` requirement for SQL execution stays.
- **Live update:** after a successful flag toggle, the client refetches `/config` so the dashboard editor's read-only state and the widget-preview behavior flip without a reload. (The Feature-flags UI triggers a config refetch / query invalidation on toggle.)
- Remove any `.env(.prod).example` reference to `DASHBOARD_SQL_ENABLED` (and the `DASHBOARD_SQL_ENABLED` note in `docs/CONFIGURATION.md`), replacing with a note that it's now a Settings → General feature flag.

### 3. Settings → General page

- New sub-nav item in `apps/studio/src/pages/settings/SettingsShell.tsx` — **General**, placed first. About is visible to all authenticated users; Feature-flags + Danger Zone are `lab_admin`-only (gated in-page, matching corlix).
- **About** card: app version (from the server, e.g. a `/api/health`/`/config` field or package version), environment (`NODE_ENV`), license (Apache-2.0), and backing-service reachability (Postgres/MinIO/Keycloak) if cheaply available; else omit service status.
- **Feature flags** card (admin): `Switch` list built from the flags registry + current values; toggling calls `PUT /api/settings/flags/:key`, shows saved/failed state, and refetches `/config`. "Dashboard raw SQL" is the first flag, with a clear description of what enabling it does (allows authoring + running arbitrary read-only SQL in dashboards).
- **Danger Zone** card (admin): four actions, each a destructive `Button` that opens a typed-confirmation dialog (reuse the app's confirm-dialog pattern; require typing a phrase). Design follows the app's sheet/dialog + edge-to-edge conventions; corlix is the design source of truth.

### 4. Danger Zone action implementations (admin API, audited)

Each is a `POST /api/settings/danger/<action>` (`requireRole('lab_admin')`, audited):
- **reset-dashboards** — delete all dashboards; re-seed the sample via the existing `seedDefaultDashboard`.
- **purge-data** — truncate the ingested/analytics data (the target-store FHIR-projected tables in `TARGET_DATABASE_URL`), keeping config/forms/connectors/users/terminology. Reuse or mirror the target-DB init/truncate logic; enumerate the data tables explicitly (do NOT drop config/reference tables).
- **factory-reset** — wipe all data and re-seed defaults. **Implement as truncate-all-data-tables + `seedDatabase()`**, NOT a schema drop/recreate — the server holds live connections, so truncating rows (in dependency order, or `TRUNCATE ... CASCADE`) then re-seeding is safe at runtime, whereas dropping/recreating the schema mid-connection is not.
- **clear-audit** — truncate the audit-log and workflow-run-history tables, keeping everything else.

All four require typed confirmation client-side AND are `lab_admin`-gated server-side; each writes an audit row describing the action + actor.

### 5. Migration + seed

- New migration: create `app_settings`.
- Seed the flag registry defaults (idempotent) in `seedDatabase` (or a dedicated bootstrap step that always runs, since flags are reference config not demo data).

## Non-goals

- Corlix desktop features that don't map to server CE: auto-updater, local backup-to-file, MFL sync, data-sync status, facility config.
- New flags beyond `dashboard.raw_sql` (the registry makes adding more trivial later).
- Fine-grained RBAC beyond `lab_admin` for settings writes.

## Testing

- Store: get/set/getAll, actor recorded, defaults from registry.
- API: admin-gating (non-admin `PUT`/danger → 403), flag round-trip, danger actions perform + audit.
- Gate rewire: with `dashboard.raw_sql` false → authoring blocked, stored SQL still executes (unchanged behavior); toggling true → authoring allowed; `/config` reflects the live value.
- General page: renders About; Feature-flags toggle calls API + refetches; Danger Zone actions require typed confirmation before firing.
- Danger actions (integration): reset-dashboards leaves exactly the sample; purge-data clears data but keeps forms/connector; clear-audit empties audit; factory-reset wipes + reseeds (assert seeded entities present).
