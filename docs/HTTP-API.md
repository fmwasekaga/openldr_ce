# OpenLDR CE HTTP API Surface

Source of truth: `apps/server/src/*.ts` (route registration in `apps/server/src/app.ts`). Routes marked "admin" use `requireRole('lab_admin')`; workflow manage routes use `lab_admin` or `lab_manager`.

> **DHIS2 is no longer a core API.** DHIS2 shipped as a removable plugin — there is no `dhis2-routes.ts` and the server registers no `/api/dhis2/*` routes. A DHIS2 integration is installed from the Marketplace and surfaces through the connector model and the plugin UI (`GET /api/plugins/ui`). See [Ingesting & pushing data](OPERATOR-GUIDE.md) for how external systems exchange data with CE.

## Core

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Run all registered health checks. Returns `503` when health status is down. |
| `GET` | `/api/config` | Browser-facing feature/auth/OIDC configuration. |
| `GET` | `/api/me` | Current authenticated user. Returns `401` when no user is available. |

## Reports

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/reports` | List report catalog entries. |
| `GET` | `/api/reports/:id` | Run or fetch a report by id with query parameters. |
| `GET` | `/api/reports/:id.csv` | Download report CSV. |
| `GET` | `/api/reports/:id.pdf` | Download report PDF. |
| `GET` | `/api/reports/:id/options` | Fetch parameter/options metadata. |
| `GET` | `/api/reports/glass/ris.csv` | Download GLASS RIS CSV. |
| `GET` | `/api/reports/runs` | List report run history. |
| `POST` | `/api/reports/:id/runs` | Record/run a report history entry. |
| `GET` | `/api/reports/:id/schedules` | List schedules for a report. |
| `POST` | `/api/reports/:id/schedules` | Create a report schedule. |
| `PATCH` | `/api/reports/schedules/:sid` | Update a report schedule. |
| `DELETE` | `/api/reports/schedules/:sid` | Delete a report schedule. |
| `POST` | `/api/reports/schedules/:sid/run` | Trigger a scheduled report immediately. |
| `GET` | `/api/reports/schedule-runs` | List scheduled report run results. |
| `GET` | `/api/reports/schedule-runs/:runId/download` | Download a scheduled report artifact. |

## Report definitions, designs & categories

The Reports page is data-driven: a **report definition** binds a **report design** (printable template) to a query, grouped by **category**.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/report-defs` | List report definitions. |
| `POST` | `/api/report-defs` | Create a report definition. |
| `GET` | `/api/report-defs/:id` | Get a report definition. |
| `PUT` | `/api/report-defs/:id` | Update a report definition. |
| `DELETE` | `/api/report-defs/:id` | Delete a report definition. |
| `GET` | `/api/report-designs` | List report designs (Report Designer templates). |
| `POST` | `/api/report-designs` | Create a report design. |
| `GET` | `/api/report-designs/:id` | Get a report design. |
| `PUT` | `/api/report-designs/:id` | Update a report design. |
| `DELETE` | `/api/report-designs/:id` | Delete a report design. |
| `POST` | `/api/report-designs/preview` | Render a design preview from a draft. |
| `GET` | `/api/report-categories` | List report categories. |
| `PUT` | `/api/report-categories` | Replace the report-category set. |

## Dashboards

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dashboards/models` | List dashboard model sources/dimensions/metrics. |
| `POST` | `/api/dashboards/query` | Execute a dashboard query or raw SQL widget query. |
| `GET` | `/api/dashboards` | List dashboards. |
| `POST` | `/api/dashboards` | Create a dashboard. |
| `GET` | `/api/dashboards/:id` | Get a dashboard. |
| `PUT` | `/api/dashboards/:id` | Replace/update a dashboard. |
| `DELETE` | `/api/dashboards/:id` | Delete a dashboard. |

## Custom Queries (Query workbench)

Powers the `/query` workbench and the queries that back report definitions.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/custom-queries` | List saved custom queries. |
| `POST` | `/api/custom-queries` | Create a custom query. |
| `GET` | `/api/custom-queries/:id` | Get a custom query. |
| `PUT` | `/api/custom-queries/:id` | Update a custom query. |
| `DELETE` | `/api/custom-queries/:id` | Delete a custom query. |
| `POST` | `/api/query/run` | Execute a parameterized query against a connector. |
| `POST` | `/api/query/param-options` | Resolve a parameter's option list. |
| `GET` | `/api/query/connectors` | List connectors available to the workbench. |
| `GET` | `/api/query/connectors/:id/schemas` | List schemas on a connector. |
| `GET` | `/api/query/connectors/:id/schemas/:schema/tables` | List tables in a schema. |
| `GET` | `/api/query/datasets` | List materialized workflow datasets queryable here. |
| `GET` | `/api/query/datasets/:name` | Get a materialized dataset. |

## Workflows

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workflows` | List workflows. |
| `POST` | `/api/workflows` | Create a workflow. |
| `GET` | `/api/workflows/:id` | Get a workflow. |
| `PUT` | `/api/workflows/:id` | Update a workflow and synchronize triggers. |
| `DELETE` | `/api/workflows/:id` | Delete a workflow and clear triggers/schedules. |
| `POST` | `/api/workflows/:id/execute-stream` | Execute a workflow and stream run events. |
| `POST` | `/api/workflows/:id/uploads` | Upload a binary input (e.g. an Excel template) for a workflow. |
| `GET` | `/api/workflows/:id/runs` | List workflow runs. |
| `GET` | `/api/workflows/runs/:runId` | Get a workflow run. |
| `GET` | `/api/workflows/nodes` | List available node types for the builder palette. |
| `GET` | `/api/workflows/node-options/:source` | List dynamic options for a node source. |
| `GET` | `/api/workflows/node-detail/:source` | Describe a node source (fields/schema). |
| `GET` | `/api/workflows/dhis2-mappings` | List DHIS2 mappings available to workflow nodes (when the DHIS2 plugin is installed). |
| `GET` | `/api/workflows/datasets` | List materialized workflow datasets. |
| `GET` | `/api/workflows/datasets/:name` | Get a materialized workflow dataset. |
| `GET` | `/api/workflows/datasets/:name.csv` | Download a dataset as CSV. |
| `GET` | `/api/workflows/artifacts/*` | Download a workflow artifact. |
| `POST` | `/api/workflows/hooks/*` | Invoke a registered webhook trigger. See [Ingesting & pushing data](OPERATOR-GUIDE.md) — this is the inbound HTTP data path. |

## Forms

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/forms` | List form definitions. |
| `POST` | `/api/forms` | Create/import a form definition. |
| `GET` | `/api/forms/published` | List published forms, optionally filtered by target page. |
| `GET` | `/api/forms/:id` | Get a form. |
| `PUT` | `/api/forms/:id` | Update a form. |
| `DELETE` | `/api/forms/:id` | Delete a form. |
| `POST` | `/api/forms/:id/status` | Set draft/published/archived/disabled status. |
| `POST` | `/api/forms/:id/publish` | Publish a version. |
| `POST` | `/api/forms/:id/duplicate` | Duplicate a form. |
| `GET` | `/api/forms/:id/versions` | List form versions. |
| `GET` | `/api/forms/:id/versions/:version` | Get one form version. |
| `GET` | `/api/forms/:id/questionnaire` | Export FHIR Questionnaire. |
| `GET` | `/api/forms/:id/export-bundle` | Export a marketplace form bundle. |
| `POST` | `/api/forms/:id/responses` | Submit form answers and extract FHIR resources. |

## Connectors

Saved, encrypted connections to external systems (databases, email, SFTP, plugin sinks) that workflow and query nodes use by reference.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/connectors` | List connectors. |
| `POST` | `/api/connectors` | Create a connector (secrets encrypted at rest). |
| `GET` | `/api/connectors/:id` | Get a connector (secrets masked). |
| `PUT` | `/api/connectors/:id` | Update a connector; blank secret keeps the stored value. |
| `DELETE` | `/api/connectors/:id` | Delete a connector. |
| `POST` | `/api/connectors/:id/test` | Test connectivity. |
| `GET` | `/api/connectors/sink-plugins` | List installed sink plugins that can back a connector. |

## Marketplace

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/marketplace/installed` | List installed artifacts. |
| `GET` | `/api/marketplace/installed/:id` | Inspect an installed artifact. |
| `GET` | `/api/marketplace/available` | List available registry artifacts. |
| `GET` | `/api/marketplace/available/:ref` | Inspect an available artifact. |
| `POST` | `/api/marketplace/install` | Install an artifact with capability approval. |
| `POST` | `/api/marketplace/refresh` | Refresh registry data. |
| `GET` | `/api/marketplace/publish/status` | Show publish configuration/status. |
| `POST` | `/api/marketplace/publish` | Publish a staged bundle. |
| `POST` | `/api/marketplace/:id/enable` | Enable an installed artifact. |
| `POST` | `/api/marketplace/:id/disable` | Disable an installed artifact. |
| `POST` | `/api/marketplace/:id/rollback` | Roll back an installed artifact. |
| `POST` | `/api/marketplace/:id/detach` | Detach an installed form/template from runtime use. |
| `DELETE` | `/api/marketplace/:id` | Remove an installed artifact. |
| `GET` | `/api/marketplace/registries` | List configured registries. |
| `POST` | `/api/marketplace/registries` | Add a registry. |
| `PUT` | `/api/marketplace/registries/:id` | Update a registry. |
| `DELETE` | `/api/marketplace/registries/:id` | Delete a registry. |

## Plugin UI

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/plugins/ui` | List UI surfaces contributed by installed plugins (webviews, settings panels). |

## Terminology

Read-only FHIR terminology operations plus the admin CRUD surface.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/terminology/CodeSystem/$lookup` | Lookup a code. |
| `GET` | `/api/terminology/ValueSet/$validate-code` | Validate a code against a value set. |
| `GET` | `/api/terminology/ValueSet/$expand` | Expand a value set. |
| `GET` | `/api/terminology/ConceptMap/$translate` | Translate a code through a concept map. |
| `GET/POST` | `/api/terminology/publishers` · `POST/PUT/DELETE /api/terminology/publishers/:id` · `GET .../:id/deletion-impact` | Publisher CRUD and deletion impact. |
| `GET/POST` | `/api/terminology/systems` · `PUT/DELETE /api/terminology/systems/:id` · `GET .../:id/deletion-impact` | Coding system CRUD and deletion impact. |
| `POST` | `/api/terminology/import/loinc` | Import a LOINC distribution. |
| `GET/POST` | `/api/terminology/systems/:id/terms` · `POST .../terms/import` · `GET .../terms/template.csv` · `PUT/DELETE .../terms/:code` | Term list/import/CRUD/template. |
| `GET/POST` | `/api/terminology/terms/:system/:code/mappings` · `PUT/DELETE /api/terminology/mappings/:id` | Term mapping CRUD. |
| `GET/POST` | `/api/terminology/valuesets` · `PUT/DELETE /api/terminology/valuesets/:id` · `POST .../import` · `POST .../:id/duplicate` · `GET .../:id/export` · `GET .../:id/expand` | Value set CRUD/import/export/duplicate/expand. |
| `GET/DELETE` | `/api/terminology/ontology/distributions` · `/api/terminology/ontology/distributions/:id` | Ontology distribution registry. |
| `GET` | `/api/terminology/ontology/:id/*` | Ontology roots, children, node, search, path, panels, answers, specimens, build, and rebuild. |

## Users & Audit

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/users` | List users. |
| `POST` | `/api/users` | Create a local user profile. |
| `GET` | `/api/users/:id` | Get a user. |
| `PUT` | `/api/users/:id` | Update user core/profile fields. |
| `POST` | `/api/users/:id/status` | Activate/deactivate a user. |
| `POST` | `/api/users/:id/reset-password` | Reset a password through the IdP/admin adapter when configured. |
| `POST` | `/api/users/:id/send-reset-email` | Send a reset email through the IdP/admin adapter when configured. |
| `POST` | `/api/users/:id/force-logout` | Force logout through the IdP/admin adapter when configured. |
| `GET` | `/api/audit` | List audit events with filters. |
| `GET` | `/api/audit/:id` | Get one audit event. |

## Activity

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/activity` | List payload-lifecycle activity (batches/correlations). |
| `GET` | `/api/activity/:correlationId` | Get the activity trail for one correlation id. |

## Settings

Admin-gated (`lab_admin`) general settings, plus the sync admin surface (next section).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/settings/flags` | Read feature flags. |
| `PUT` | `/api/settings/flags/:key` | Set a feature flag. |
| `GET` | `/api/settings/numbers` | Read numeric settings (e.g. dashboard SQL timeout/row cap). |
| `PUT` | `/api/settings/numbers/:key` | Set a numeric setting. |
| `POST` | `/api/settings/danger/:action` | Run a danger-zone action (reset-dashboards, clear-audit, factory-reset). |

## Distributed Sync

Admin routes under `/api/settings/sync/*` are user-authed and `lab_admin`-gated. The client secret is write-only on config and returned only once (never in a `GET`) on enroll/rotate.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/settings/sync` | Read the sync configuration (no secret value, only whether one is set). |
| `PUT` | `/api/settings/sync` | Update the sync configuration; `clientSecret` is write-only (blank keeps the stored value). |
| `GET` | `/api/settings/sync/status` | Live sync status: per-direction workers, cursors, and pending backlog. |
| `POST` | `/api/settings/sync/now` | Trigger a sync pass immediately. Returns `409` when sync is disabled. |
| `GET` | `/api/settings/sync/quarantine` | List bulk records the pull stream is holding or has quarantined, with attempt counts and the last error. |
| `POST` | `/api/settings/sync/quarantine/retry` | Clear a quarantined bulk entity and re-sync it by id. Body: `{ entityType, entityId }`. `400` missing/blank input, `409` when sync pull is not enabled. |
| `GET` | `/api/settings/sync/divergences` | List same-version divergences detected between lab and central. |
| `GET` | `/api/settings/sync/divergences/:resourceType/:resourceId/:version` | Inspect one divergence. |
| `POST` | `/api/settings/sync/divergences/:resourceType/:resourceId/:version/clear` | Acknowledge/clear a divergence. |
| `POST` | `/api/settings/sync/enroll` | Enroll a lab (central): mint its Keycloak client + registry row; returns the client id and secret once. |
| `GET` | `/api/settings/sync/sites` | List enrolled sites (never returns secrets). |
| `POST` | `/api/settings/sync/sites/:siteId/rotate` | Rotate a site's client secret; returns the new secret once. |
| `POST` | `/api/settings/sync/sites/:siteId/revoke` | Revoke a site: delete its client and mark the registry row revoked. |
| `POST` | `/api/settings/sync/amend` | Amend a lab-owned result (central operator): writes a new FHIR version and queues it for the owning lab to pull back. Body: `{ resourceType, id, status, reason?, patch?, agent?, activity? }` (`activity` defaults to `amend`). Amends `Observation`, `DiagnosticReport`, or `ServiceRequest` (any other resource type → `400`). |
| `POST` | `/api/settings/sync/merge-patient` | Intra-lab patient merge (`lab_admin`): re-points the duplicate patient's lab history to the survivor and marks the duplicate replaced. Body: `{ survivorId, duplicateId, reason? }`. `400` same-patient/bad-input, `404` patient not found, `409` cross-site. |

The machine endpoints below are authenticated by lab **client credentials** (not user sessions) and scope by the token's `site_id`:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sync/push` | A lab pushes operational change-log records up to central. **Not** a general external-ingest endpoint. |
| `POST` | `/api/sync/pull` | A lab pulls the reference-data delta down. |
| `POST` | `/api/sync/pull-amendments` | The owning lab drains the central-authored amendment stream for its own resources. |
| `POST` | `/api/sync/terminology/concepts` | Bulk terminology concept delta (central → lab). |
| `POST` | `/api/sync/terminology/map-elements` | Bulk concept-map element delta (central → lab). |

### Compression

Compression is global, so it applies to every route above — but it matters most for sync, which moves the largest payloads over the thinnest links.

- **Responses**: compressed when the client sends `Accept-Encoding: gzip` and the body exceeds 1024 bytes. Already-compressed content types (PDF, xlsx) are skipped.
- **Requests**: a gzipped body (`Content-Encoding: gzip`) is accepted on every route. Any other request encoding → `415` with code `SY0415`.
- **Advert**: every response carries `Accept-Encoding: gzip` (RFC 7694) so a client can discover that the server accepts compressed request bodies before it sends one. The sync push client reads this off the response and only then starts gzipping, which is what lets a newer lab talk to an older central.

## There is no `POST /fhir` or `POST /api/ingest`

External systems do **not** post FHIR to a generic endpoint. The inbound data paths are:

1. **Workflow webhook** — `POST /api/workflows/hooks/<path>`, secured by a per-webhook secret, routed into a workflow you build.
2. **CLI ingest** — `openldr ingest <file> --plugin <converter>` for file/plugin-based loads.
3. **Sync push** — `POST /api/sync/push`, but only for enrolled lab→central change-log replication (client-credentialed), not third-party ingest.

See [Ingesting & pushing data](OPERATOR-GUIDE.md) for the full walkthrough.
