# OpenLDR CE HTTP API Surface

Source of truth: `apps/server/src/*.ts`. Routes marked "admin" use `requireRole('lab_admin')`; workflow manage routes use `lab_admin` or `lab_manager`.

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

## Workflows

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workflows` | List workflows. |
| `POST` | `/api/workflows` | Create a workflow. |
| `GET` | `/api/workflows/:id` | Get a workflow. |
| `PUT` | `/api/workflows/:id` | Update a workflow and synchronize triggers. |
| `DELETE` | `/api/workflows/:id` | Delete a workflow and clear triggers/schedules. |
| `POST` | `/api/workflows/:id/execute-stream` | Execute a workflow and stream run events. |
| `GET` | `/api/workflows/:id/runs` | List workflow runs. |
| `GET` | `/api/workflows/runs/:runId` | Get a workflow run. |
| `GET` | `/api/workflows/datasets` | List materialized workflow datasets. |
| `GET` | `/api/workflows/datasets/:name` | Get a materialized workflow dataset. |
| `GET` | `/api/workflows/datasets/:name.csv` | Download a dataset as CSV. |
| `GET` | `/api/workflows/artifacts/*` | Download a workflow artifact. |
| `POST` | `/api/workflows/hooks/*` | Invoke a registered webhook trigger. |

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

## DHIS2

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dhis2/status` | Show DHIS2 connection/status. |
| `POST` | `/api/dhis2/metadata/pull` | Pull DHIS2 metadata into cache. |
| `GET` | `/api/dhis2/metadata` | Read cached DHIS2 metadata. |
| `GET` | `/api/dhis2/orgunit-mappings` | List facility-to-orgUnit mappings. |
| `PUT` | `/api/dhis2/orgunit-mappings/:facilityId` | Upsert a facility mapping. |
| `DELETE` | `/api/dhis2/orgunit-mappings/:facilityId` | Delete a facility mapping. |
| `GET` | `/api/dhis2/mappings` | List aggregate/tracker mappings. |
| `GET` | `/api/dhis2/mappings/:id` | Get a mapping. |
| `PUT` | `/api/dhis2/mappings/:id` | Upsert a mapping. |
| `DELETE` | `/api/dhis2/mappings/:id` | Delete a mapping. |
| `POST` | `/api/dhis2/mappings/:id/run` | Dry-run or push a mapping. |
| `POST` | `/api/dhis2/mappings/validate` | Validate a mapping definition. |
| `GET` | `/api/dhis2/pushes` | List push audit entries. |
| `GET` | `/api/dhis2/schedules` | List DHIS2 schedules. |
| `POST` | `/api/dhis2/schedules` | Create a DHIS2 schedule. |
| `POST` | `/api/dhis2/schedules/:id/enabled` | Enable/disable a schedule. |
| `DELETE` | `/api/dhis2/schedules/:id` | Delete a schedule. |
| `GET` | `/api/dhis2/event-sources` | List tracker event sources. |
| `GET` | `/api/dhis2/report-columns` | List report columns for mapping. |

## Marketplace

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/marketplace/installed` | List installed artifacts. |
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

## Terminology

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/terminology/CodeSystem/$lookup` | Lookup a code. |
| `GET` | `/api/terminology/ValueSet/$validate-code` | Validate a code against a value set. |
| `GET` | `/api/terminology/ValueSet/$expand` | Expand a value set. |
| `GET` | `/api/terminology/ConceptMap/$translate` | Translate a code through a concept map. |
| `GET/POST/PUT/DELETE` | `/api/terminology/publishers` and `/api/terminology/publishers/:id` | Publisher CRUD and deletion impact. |
| `GET/POST/PUT/DELETE` | `/api/terminology/systems` and `/api/terminology/systems/:id` | Coding system CRUD and deletion impact. |
| `POST` | `/api/terminology/import/loinc` | Import a LOINC distribution. |
| `GET/POST/PUT/DELETE` | `/api/terminology/systems/:id/terms` and `/api/terminology/systems/:id/terms/:code` | Term list/import/CRUD/template. |
| `GET/POST/PUT/DELETE` | `/api/terminology/terms/:system/:code/mappings` and `/api/terminology/mappings/:id` | Term mapping CRUD. |
| `GET/POST/PUT/DELETE` | `/api/terminology/valuesets` and `/api/terminology/valuesets/:id` | Value set CRUD/import/export/duplicate/expand. |
| `GET/DELETE` | `/api/terminology/ontology/distributions` and `/api/terminology/ontology/distributions/:id` | Ontology distribution registry. |
| `GET` | `/api/terminology/ontology/:id/*` | Ontology roots, children, node, search, path, panels, answers, specimens, build, and rebuild. |

## Users And Audit

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

## Distributed Sync

Admin routes under `/api/settings/sync/*` are user-authed and `lab_admin`-gated. The client secret is write-only on config and returned only once (never in a `GET`) on enroll/rotate.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/settings/sync` | Read the sync configuration (no secret value, only whether one is set). |
| `PUT` | `/api/settings/sync` | Update the sync configuration; `clientSecret` is write-only (blank keeps the stored value). |
| `GET` | `/api/settings/sync/status` | Live sync status: per-direction workers, cursors, and pending backlog. |
| `POST` | `/api/settings/sync/now` | Trigger a sync pass immediately. Returns `409` when sync is disabled. |
| `POST` | `/api/settings/sync/enroll` | Enroll a lab (central): mint its Keycloak client + registry row; returns the client id and secret once. |
| `GET` | `/api/settings/sync/sites` | List enrolled sites (never returns secrets). |
| `POST` | `/api/settings/sync/sites/:siteId/rotate` | Rotate a site's client secret; returns the new secret once. |
| `POST` | `/api/settings/sync/sites/:siteId/revoke` | Revoke a site: delete its client and mark the registry row revoked. |
| `POST` | `/api/settings/sync/amend` | Amend a lab-owned result (central operator): writes a new FHIR version and queues it for the owning lab to pull back. Body: `{ resourceType, id, status, reason?, patch?, agent?, activity? }` (`activity` defaults to `amend`). Amends `Observation`, `DiagnosticReport`, or `ServiceRequest` (any other resource type → `400`). |

The machine endpoints `POST /api/sync/push` (a lab pushes operational change-log records up) and `POST /api/sync/pull` (a lab pulls the reference-data delta down) are authenticated by lab **client credentials**, not user sessions, and scope by the token's `site_id`. `POST /api/sync/pull-amendments` (also client-credentials-authed and site-scoped) lets the owning lab drain the central-authored amendment stream for its own resources.
