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
- If widgets time out or return too much data, tune the `dashboard.sql_timeout_ms` and `dashboard.sql_row_cap` **number settings** under **Settings → General → Limits & tuning** (or `pnpm openldr settings numbers set …`). These are no longer environment variables.

## Reports

Use reports for parameterized AMR/GLASS outputs, CSV/PDF exports, run history, and schedules. The HTTP API exposes report catalog, CSV/PDF, run history, schedules, and scheduled artifact downloads.

Worked example:

```bash
pnpm openldr report list --json
pnpm openldr report run amr-resistance --param from=2026-01-01 --param to=2026-03-31 --json
pnpm openldr report glass-export --country ZMB --year 2026 --from 2026-01-01 --to 2026-03-31 --out glass-ris.csv
```

Troubleshooting:

- Empty AMR rows usually mean the target warehouse has not been seeded or ingested.
- PDF output needs `--format pdf --out <file>` for the CLI path.

## Workflows

Use Workflow Builder for analyst-authored data jobs: triggers, SQL/FHIR/HTTP sources, JavaScript code, filtering, transforms, dataset materialization, file export, plugin sink pushes (e.g. the DHIS2 plugin, when installed), schedules, webhooks, ingest triggers, and run history.

Key configuration:

- `WORKFLOW_CODE_ENABLED` is the master switch for Code nodes (**default off, fail-safe** — `vm` is not a sandbox); `WORKFLOW_CODE_TIMEOUT_MS` and `WORKFLOW_CODE_MEMORY_MB` bound them once enabled.
- `WORKFLOW_HTTP_ALLOWLIST` controls HTTP Request egress.
- Publishing materialized datasets as `wf_ds_<name>` tables (PostgreSQL target) is the `workflow.dataset_publish_enabled` **feature flag** (Settings → General), not an env var.

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

## Ingesting & pushing data

"How do I push data into CE?" has three answers depending on what you have. **There is no generic `POST /fhir` or `POST /api/ingest` endpoint** — do not try to POST a FHIR Bundle to an arbitrary URL and expect it to persist.

### 1. From a file — `openldr ingest` (the reliable path)

`openldr ingest <file>` runs a file through the pipeline (accept → convert → drain into the FHIR store). The **converter** decides how the file is parsed:

- `--converter fhir-bundle` (default) — the file is a FHIR **transaction/collection Bundle** (a JSON object with `resourceType: "Bundle"` and an `entry` array). A bare JSON array is **not** a Bundle and will not persist clinical rows.
- `--plugin <id>` — parse with an installed WASM converter plugin, e.g. `whonet-sqlite` (WHONET AMR databases), `hl7v2` (HL7 v2 messages), or `tabular` (CSV/TSV with a `--config` column mapping). Install the plugin first with `openldr plugin install`.

```bash
# A FHIR transaction Bundle
pnpm openldr ingest bundle.json --json

# A WHONET SQLite export via a converter plugin
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json

# Inspect / retry the batch it created
pnpm openldr pipeline status --json
pnpm openldr pipeline retry <batchId>
```

A successful run prints `batch <id>: done (<n> resources)`. Zero resources means the converter did not recognise the input — check the file shape against the converter, not the pipeline.

### 2. Over HTTP — a workflow webhook

The only inbound HTTP data path is a **workflow webhook**: `POST /api/workflows/hooks/<path>`, gated by a per-webhook secret. The request body is delivered to the workflow as its input; **what gets persisted is whatever the workflow does with it**, not a fixed FHIR contract. Build the workflow first (Workflow Builder → a Webhook trigger → validate/transform → a Persist/Store node), then have the external system POST to that path with its secret. See [Workflows](#workflows). This is deliberately flexible — the same webhook can accept a form submission, a vendor JSON payload, or a Bundle you then normalise inside the workflow.

An **ingest trigger** is the complement: a workflow with an `ingest` trigger runs *after* `openldr ingest` (or any pipeline batch) completes, so you can post-process each batch (notify, forward to a sink, re-report).

### 3. Lab → central — sync push (not for third parties)

`POST /api/sync/push` exists, but it is **machine-to-machine change-log replication** from an enrolled lab up to a central server, authenticated by client-credentials with a `site_id` claim. It is not a general ingest endpoint — a third-party system cannot use it. See [Distributed sync](#distributed-sync).

Troubleshooting:

- `batch … done (0 resources)`: the converter did not parse the input (wrong `--converter`/`--plugin`, or a bare array where a Bundle was expected).
- A webhook POST returns `401`/`404`: the per-webhook secret is wrong/missing, or the workflow (and thus its webhook path) is not saved/enabled — a webhook only exists once its workflow is saved.
- Data ingested but not visible in reports: the analytics warehouse projection runs off the FHIR change log; confirm `TARGET_STORE_ADAPTER`/target DB and that the projection worker is running.

## DHIS2 (plugin)

DHIS2 is **no longer a core feature** — it ships as a removable `dhis2-sink` plugin installed from **Settings ▸ Marketplace**. There are no `REPORTING_TARGET_ADAPTER`/`DHIS2_SYNC_ENABLED` env vars and no `openldr dhis2 …` CLI. Once installed, configure it from the plugin's own screens: set `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`), create a DHIS2 connector under **Settings ▸ Connectors** (base URL + credentials, encrypted at rest), and drive aggregate `dataValueSet` / tracker pushes from the plugin UI or a workflow sink node (use its dry-run before a live push). See the plugin's bundled documentation for details.

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
   pnpm openldr sync enroll lab-site-01 --name "Regional Reference Lab" --central-url https://central.example.org
   pnpm openldr sync list
   ```

   Hand the printed client id, client secret, site id, central URL, and OIDC issuer to the lab operator. Lost secrets are unrecoverable — `pnpm openldr sync rotate <siteId>` issues a new one; `pnpm openldr sync revoke <siteId>` deletes the client.

2. **On each lab**, enter those values under **Settings → General → Distributed Sync** (or `pnpm openldr settings sync set …`), choose a **mode** — `push`, `pull`, or `bidirectional` — set the interval, and enable. Monitor with the card's live status panel or `pnpm openldr sync status`, and force a pass with **Sync now** / `pnpm openldr sync now`.

Result amendments (co-edit): a central operator can correct a lab-owned result without breaking ownership. `POST /api/settings/sync/amend` (admin, `lab_admin`) or `pnpm openldr sync amend --resource-type <t> --id <id> --status <s> [--reason …] [--patch <json>]` writes a new FHIR version on central and queues it. The owning lab drains those amendments on its next `pull`/`bidirectional` pass through the `'sync-amend-pull'` cursor, applying the higher versionId back into its own store. Order status/metadata co-edit uses this same amend surface against the `ServiceRequest` (e.g. `activity: update`). Intra-lab MPI merge: `POST /api/settings/sync/merge-patient` (admin, `lab_admin`) or `pnpm openldr sync merge-patient --survivor <id> --duplicate <id> [--reason …]` keeps the survivor, marks the duplicate `replaced-by` the survivor, and re-attributes the duplicate's lab history to it — the superseded duplicate then shows `active=false` in the patient list.

Transport compression: sync traffic is gzip-compressed both ways, with no configuration. Responses — including the large terminology bulk drains and pull pages — compress automatically once they exceed ~1KB. Push bodies compress only after central advertises support (an `Accept-Encoding: gzip` response header, RFC 7694), so a lab on a newer build talking to an older central simply keeps sending uncompressed and keeps working: there is **no upgrade-order requirement** and no operator action.

Troubleshooting:

- `415` from a machine endpoint: the request body used a `Content-Encoding` central does not accept — only `gzip` is supported. The coded response is `SY0415`.

- One bad record blocks the pull: the pull stream is ordered, so a terminology system/concept map (or other bulk record) that keeps failing to apply used to silently wedge **all** config and terminology sync behind it. Such a record is now quarantined after 3 failed attempts and the stream moves on. Inspect the held/quarantined records with `pnpm openldr sync quarantine list` or `GET /api/settings/sync/quarantine` (admin, `lab_admin`); once the cause is fixed, re-apply it with `pnpm openldr sync quarantine retry <entityType> <entityId>` or `POST /api/settings/sync/quarantine/retry`.

- Sync does nothing: confirm it is enabled and the mode is what you expect; re-check the central URL, site id, OIDC issuer, client id, and (if blanked) the secret.
- `403`/`503` when enrolling on central: the admin service account lacks `manage-clients`/`view-clients` or Keycloak admin is not configured — re-import the realm and retry.
- Machine endpoints `POST /api/sync/push`, `POST /api/sync/pull`, and `POST /api/sync/pull-amendments` are client-credentials-authed (lab → central); the `/api/settings/sync/*` admin endpoints (including `sync/amend`) are `lab_admin` user-authed.

## i18n

The app ships English, French, and Portuguese UI bundles. The in-app manual (`apps/studio/src/docs`) is grouped into Start here, Daily work, Data and design, Administration, and More — currently: Start Here, Dashboard, Reports, Workflows, Scheduled reports, Custom Queries, Report Designer, Forms, Terminology, Users and Roles, Audit, Settings, Distributed Sync, Connectors, Marketplace, Environment Variables, and Deployment & Developer Docs. French/Portuguese in-app guides fall back to English until authored. Adding an in-app page requires a source-code registry change (`apps/studio/src/docs/registry.ts`), so operator/API/deployment reference lives here under `docs/**` and on the public website.
