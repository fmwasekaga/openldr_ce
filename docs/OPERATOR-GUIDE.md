# OpenLDR CE Operator Guide

This guide documents the repository as it exists now. It complements the in-app docs, which are limited to the current bundled page order.

## Setup

Prerequisites:

- Node.js 20 or newer.
- pnpm 11.5.2 through the package-manager pin.
- Docker and Docker Compose for local PostgreSQL, MinIO, Keycloak, and optional DHIS2/SQL Server services.

PowerShell:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose up -d
pnpm openldr db migrate
pnpm -C apps/server dev
```

Start the web app in a second shell:

```powershell
pnpm -C apps/studio dev
```

Bash:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d
pnpm openldr db migrate
pnpm -C apps/server dev
```

Start the web app in a second shell:

```bash
pnpm -C apps/studio dev
```

For screenshot/e2e data, seed WHONET sample data:

```bash
pnpm e2e:seed
```

## Dashboards

Use dashboards when users need repeatable operational views over warehouse data. The builder mode works across PostgreSQL and SQL Server warehouses. The raw SQL tab is advanced, PostgreSQL-only, and enabled via **Settings → General → Feature Flags** (admin-only, default off).

Worked example:

```bash
pnpm openldr db migrate
pnpm openldr target-store test --json
```

Troubleshooting:

- If SQL widgets are not visible, enable the `dashboard.raw_sql` feature flag in **Settings → General → Feature Flags** (admin-only) and ensure `TARGET_STORE_ADAPTER=pg`.
- If widgets time out or return too much data, tune `DASHBOARD_SQL_TIMEOUT_MS` and `DASHBOARD_SQL_ROW_CAP`.

## Reports

Use reports for parameterized AMR/GLASS outputs, CSV/PDF exports, run history, and schedules. The HTTP API exposes report catalog, CSV/PDF, run history, schedules, and scheduled artifact downloads.

Worked example:

```bash
pnpm openldr report list --json
pnpm openldr report run amr-resistance --param from=2026-01-01 --param to=2026-03-31 --json
pnpm openldr report glass-export --from 2026-01-01 --to 2026-03-31 --out glass-ris.csv
```

Troubleshooting:

- Empty AMR rows usually mean the target warehouse has not been seeded or ingested.
- PDF output needs `--format pdf --out <file>` for the CLI path.

## Workflows

Use Workflow Builder for analyst-authored data jobs: triggers, SQL/FHIR/HTTP sources, JavaScript code, filtering, transforms, dataset materialization, file export, DHIS2 push, schedules, webhooks, ingest triggers, and run history.

Key configuration:

- `WORKFLOW_CODE_TIMEOUT_MS` and `WORKFLOW_CODE_MEMORY_MB` protect Code nodes.
- `WORKFLOW_HTTP_ALLOWLIST` controls HTTP Request egress.
- `WORKFLOW_DATASET_PUBLISH_ENABLED=true` publishes materialized datasets as `wf_ds_<name>` tables on PostgreSQL target stores.

Worked example:

```bash
pnpm openldr db migrate
pnpm openldr target-store test --json
```

Then in the app, create a workflow with Manual Trigger -> SQL Query -> Materialize Dataset. If dataset publishing is enabled, query it from PostgreSQL as:

```sql
select data from wf_ds_amr;
```

Troubleshooting:

- HTTP Request nodes fail closed unless the hostname is listed in `WORKFLOW_HTTP_ALLOWLIST`.
- TypeScript is visible as a disabled Code-node language; JavaScript is the runnable language.
- Some palette nodes are intentionally disabled until handlers are implemented.

## Marketplace

Use Marketplace under Settings for signed plugin, form, and report bundles. Installed artifacts can be enabled, disabled, rolled back, detached, or removed. Available artifacts come from a local registry directory or remote registry URL.

Key configuration:

- `MARKETPLACE_REGISTRY_DIR` for local registry browsing.
- `MARKETPLACE_REGISTRY_URL` for a remote raw registry.
- `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` only for local unsigned development bundles.
- `MARKETPLACE_PUBLISH_*` for GitHub publish flows.

Worked example:

```bash
pnpm make:marketplace-bundle
pnpm openldr market verify reference-plugins/whonet-sqlite --json
pnpm openldr market list --json
```

Troubleshooting:

- Unsigned bundles fail unless explicitly allowed in development.
- Install requires capability approval with `--approve` in CLI or the UI consent flow.

## Forms

Use Forms for FHIR Questionnaire authoring, publishing, runtime capture, response extraction, export, lifecycle state, and marketplace form-template bundles.

Worked example:

```bash
pnpm openldr forms list --json
pnpm openldr forms extract packages/cli/src/__fixtures__/sample-questionnaire.json packages/cli/src/__fixtures__/sample-response.json --subject Patient/123 --json
```

Troubleshooting:

- Published forms are runnable; draft/disabled/archived forms are not normal capture targets.
- Use `GET /api/forms/:id/questionnaire` or the UI Export action for Questionnaire JSON.

## DHIS2

Use DHIS2 for aggregate `dataValueSet` and tracker event pushes. Set `REPORTING_TARGET_ADAPTER=dhis2` and `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`), then create a DHIS2 connector under **Settings ▸ Connectors** (base URL + credentials, encrypted at rest) and select it from each mapping.

Worked example:

```bash
pnpm openldr dhis2 orgunit import orgunits.json --json
pnpm openldr dhis2 map import mapping.json --json
pnpm openldr dhis2 validate mapping-1 --json
pnpm openldr dhis2 push mapping-1 --period 2026Q1 --dry-run --json
```

Troubleshooting:

- Use `--dry-run` before live pushes.
- `DHIS2_SYNC_ENABLED=false` disables scheduled/event-driven sync.
- Use `pnpm dhis2:seed` only for local/demo DHIS2 data setup.

## Users And Audit

Use Users for local profile and role management; Keycloak admin actions are available only when admin client config is present. Use Audit to inspect append-only operational events.

Worked example:

```bash
pnpm openldr user list --json
pnpm openldr audit list --json
```

Troubleshooting:

- Admin-only user mutations require the `lab_admin` role in the web app.
- Reset-email, force-logout, and password reset actions need Keycloak admin credentials.

## Distributed sync

Use distributed sync to link many labs to one central OpenLDR server over intermittent, low-bandwidth links. Each lab runs a full instance and works offline; operational data (patients, requests, results, specimens, reports) pushes **up** to central's read-only mirror, while reference configuration (forms, dashboards, reports, allowlisted settings) and terminology pull **down** to labs. Every record is stamped with its originating `site_id`. Labs authenticate with a per-lab Keycloak client-credentials client whose token carries a `site_id` claim; central validates the token and scopes writes by site.

Realm prerequisite: enrollment mints Keycloak clients, so the central realm must grant the admin service account `manage-clients` and `view-clients`. These are in the shipped realm export; a Keycloak container first started before distributed sync existed needs its realm re-imported (or the two client roles added by hand).

Flow:

1. **On central**, enroll each lab. This mints a confidential `sync-<siteId>` client with a `site_id` mapper, generates a secret shown once, and records a registry row. Use **Sites** in the app (admin-only) or the CLI:

   ```bash
   pnpm openldr sync enroll lab-ndola-01 --name "Ndola Central Hospital" --central-url https://central.example.org
   pnpm openldr sync list
   ```

   Hand the printed client id, client secret, site id, central URL, and OIDC issuer to the lab operator. Lost secrets are unrecoverable — `pnpm openldr sync rotate <siteId>` issues a new one; `pnpm openldr sync revoke <siteId>` deletes the client.

2. **On each lab**, enter those values under **Settings → General → Distributed Sync** (or `pnpm openldr settings sync set …`), choose a **mode** — `push`, `pull`, or `bidirectional` — set the interval, and enable. Monitor with the card's live status panel or `pnpm openldr sync status`, and force a pass with **Sync now** / `pnpm openldr sync now`.

Troubleshooting:

- Sync does nothing: confirm it is enabled and the mode is what you expect; re-check the central URL, site id, OIDC issuer, client id, and (if blanked) the secret.
- `403`/`503` when enrolling on central: the admin service account lacks `manage-clients`/`view-clients` or Keycloak admin is not configured — re-import the realm and retry.
- Machine endpoints `POST /api/sync/push` and `POST /api/sync/pull` are client-credentials-authed (lab → central); the `/api/settings/sync/*` admin endpoints are `lab_admin` user-authed.

## i18n

The app ships English, French, and Portuguese UI/doc bundles. In-app docs currently have a fixed page order: overview, getting-started, dashboard, reports, ingestion, terminology, DHIS2, external database, and CLI. Adding new in-app doc pages requires a source-code registry change, so broader monorepo docs live under `docs/**`.
