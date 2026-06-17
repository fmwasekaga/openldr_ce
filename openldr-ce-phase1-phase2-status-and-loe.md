# OpenLDR CE Phase 1 + Phase 2 Status And Level Of Effort

**Date:** 2026-06-17  
**Scope reviewed:** `openldr-ce-prd-phase1.md`, `openldr-ce-prd-phase2.md`, current repository state by static inspection.  
**Purpose:** Informational planning document for deciding the next build push after usage resets.

## Executive Summary

OpenLDR CE has moved well beyond a bare skeleton. The repo now contains a functioning TypeScript monorepo with the main Phase 1 architecture in place: ports/adapters, Fastify API, React/Vite UI shell, FHIR resource handling, canonical and flattened persistence, ingest pipeline, event queue, plugin runtime, CLI, reporting, dashboards, users, audit storage, forms runtime, terminology, DHIS2 packages, SQL Server adapter, docs, and Playwright/Vitest coverage.

The biggest remaining gap is not the foundation. The biggest gap is product completeness and workflow depth. Several PRD items exist as technically valid slices but are not yet the full operator experience implied by the PRDs.

The three most important known gaps are:

1. **Forms page exists, but there is no Form Builder.** Forms can be imported, listed, published/archived, exported as Questionnaire, and run in a basic capture page. The `New form` button is disabled and explicitly says the builder is a later sub-project.
2. **Users page exists, but it is a thin local account slice.** It supports list/create/edit/roles/status, but it is not yet Corlix-style user administration. It lacks richer user management workflows, permissions UX, identity-provider operational behavior, audit integration, and likely several Corlix parity details.
3. **Audit page exists, but normal UI/admin activity is barely instrumented.** The audit store, API, CLI, and UI are present. Ingest/plugin/DHIS2 paths record some system events. Forms and Users routes currently do not emit audit events, so the page will often show little or nothing during normal UI use.

Overall status estimate:

| Area | Current State | Product Readiness |
|---|---:|---:|
| Phase 1 architecture/spine | Mostly complete | Medium-high |
| Phase 1 operator UI | Partial | Medium |
| Phase 1 audit/accountability | Partial | Low-medium |
| Phase 1 forms | Runtime partial, builder missing | Low-medium |
| Phase 2 terminology | Strong slice complete | Medium-high |
| Phase 2 DHIS2 | Backend/CLI slice present, UI unclear/missing | Medium |
| Phase 2 AMR/GLASS reports | Strong backend/report slice present | Medium |
| Phase 2 SQL Server | Adapter and config present | Medium |
| Production readiness | Not complete | Low-medium |

## Level Of Effort Scale

These estimates assume one senior engineer/agent familiar with the repo.

| LOE | Meaning |
|---|---|
| XS | 0.5-1 day |
| S | 1-2 days |
| M | 3-5 days |
| L | 1-2 weeks |
| XL | 2-4 weeks |
| XXL | 1+ month |

Estimates include implementation and focused tests. They do not include long external acceptance cycles with a Ministry, DHIS2 instance, real LOINC distribution, or production infrastructure.

## Evidence Base

This document is based on repo inspection, especially:

- PRDs: `openldr-ce-prd-phase1.md`, `openldr-ce-prd-phase2.md`
- Current handoff: `openldr-ce-handoff.md`
- Main app shell and routes: `apps/web/src/App.tsx`, `apps/web/src/shell/AppShell.tsx`
- Forms: `apps/web/src/pages/Forms.tsx`, `apps/web/src/pages/FormCapture.tsx`, `packages/forms/src/*`, `apps/server/src/forms-routes.ts`
- Users: `apps/web/src/pages/Users.tsx`, `apps/web/src/users/UserDialog.tsx`, `packages/users/src/store.ts`, `apps/server/src/users-routes.ts`
- Audit: `apps/web/src/pages/Audit.tsx`, `packages/audit/src/store.ts`, `apps/server/src/audit-routes.ts`
- Ingest/plugins: `packages/ingest/src/*`, `packages/plugins/src/*`, `packages/bootstrap/src/ingest-context.ts`, `wasm/*`
- Terminology: `packages/terminology/src/*`, `packages/db/src/terminology-*`, `apps/web/src/pages/Terminology.tsx`
- DHIS2: `packages/dhis2/src/*`, `packages/adapter-dhis2/src/*`, `packages/bootstrap/src/dhis2-context.ts`
- Reporting/dashboard: `packages/reporting/src/*`, `packages/dashboards/src/*`, `apps/web/src/dashboard/*`
- CLI: `packages/cli/src/index.ts`
- Config/deployment: `packages/config/src/schema.ts`, `docker-compose.yml`, `README.md`

No full test suite or live browser acceptance was run for this document. Treat statuses as static-code review findings, not a fresh green build certificate.

## Status Categories

| Status | Meaning |
|---|---|
| Complete | Usable slice exists and appears to satisfy the core PRD intent. |
| Partial | Meaningful code exists, but the full PRD behavior or UX is incomplete. |
| Stub/Thin | Surface exists, but it is intentionally minimal or non-functional for the intended workflow. |
| Missing | No clear implementation found. |
| Needs Validation | Code exists, but live acceptance against real services/data is still needed. |

## Phase 1 Status

### P1-CORE: Skeleton, Ports, Config, Health

| Requirement | Status | Notes |
|---|---|---|
| P1-CORE-1 modular monorepo skeleton | Complete | Turborepo/pnpm workspace exists with `apps/server`, `apps/web`, and many packages: `core`, `fhir`, `forms`, `ingest`, `plugins`, `reporting`, `audit`, `users`, `cli`, etc. |
| P1-CORE-2 four ports | Complete | Ports exist in `packages/ports/src`: auth, blob, eventing, target-store, health, reporting-target. |
| P1-CORE-3 env/config adapter selection + health | Complete/Needs Validation | Config schema supports auth/blob/eventing/target-store/reporting target. Health registry wires auth/blob/eventing/target-store. Live environment still needs regular validation. |

Remaining work:

- Add architecture docs that explicitly describe module boundaries and forbidden imports.
- Keep `depcruise` passing as the repo grows.
- Add a production deployment example with nginx path routing once the app routes stabilize.

Estimated remaining LOE: **S-M**.

### P1-FHIR: FHIR R4 Data Layer

| Requirement | Status | Notes |
|---|---|---|
| P1-FHIR-1 hand-rolled FHIR R4 resource handling | Complete/Partial | `packages/fhir` has resource schemas, validation, OperationOutcome, registry, datatypes. It is hand-rolled, not a full official schema engine. |
| P1-FHIR-2 canonical internal representation | Complete/Partial | Internal FHIR store and migrations exist; resources include Patient, Specimen, ServiceRequest, DiagnosticReport, Observation, Organization, Location, Questionnaire, QuestionnaireResponse, CodeSystem, ValueSet, ConceptMap, Bundle. |
| P1-FHIR-3 flattening layer to relational analytics tables | Complete/Needs Validation | `packages/db/src/flatten/*`, `flat-writer.ts`, external migrations, and persistence exist. Needs broader real-data validation. |

Remaining work:

- Validate the FHIR schemas against representative real-world lab data.
- Decide whether to expand validation coverage for profiles and constraints that matter to AMR.
- Add more golden fixtures for WHONET, HL7, CSV, and QuestionnaireResponse flows.

Estimated remaining LOE: **M-L**, depending on how strict validation should become.

### P1-FORM: Forms-From-Templates Engine

| Requirement | Status | Notes |
|---|---|---|
| P1-FORM-1 FHIR Questionnaire/QuestionnaireResponse/SDC form engine | Partial | Conversion, validation, Questionnaire export, response build, and extraction exist in `packages/forms`. |
| P1-FORM-2 entity capture screens driven by form templates | Partial | Generic `FormCapture` exists. It is not yet clearly wired as the actual Facilities, Patients, Orders, and Users capture system. |
| P1-FORM-3 group types and repetition in builder/runtime | Partial/Stub | Schema supports sections/fields and repeated fields. There is no builder. Runtime does not appear to offer a complete repeated-group authoring/capture experience. |

What is completed:

- Form storage table/migration exists.
- API supports list/get/create/update/status/delete/questionnaire/response.
- CLI supports form listing and extraction from Questionnaire + QuestionnaireResponse.
- UI supports forms list, search, import JSON, status changes, delete, export, and run/capture.
- Basic capture page renders fields and client-validates common types.

What is missing:

- **No Form Builder.** `apps/web/src/pages/Forms.tsx` has `New form` disabled with tooltip: "Form builder coming in a later sub-project."
- No drag/drop or structured authoring UI for sections, fields, FHIR bindings, terminology bindings, cardinality, conditional visibility, repeats, group repeats, or extraction paths.
- No Corlix-style form authoring parity.
- No versioning workflow beyond a version label.
- No form preview/test mode inside the builder because builder does not exist.
- No template marketplace/install flow, deferred by PRD.
- No visible form governance workflow: draft review, publish confirmation, archive impact, duplicate, import validation report.
- Forms route does not record audit events.

Recommended next build for Forms:

1. Build the Corlix-style Form Builder as a first-class page/dialog.
2. Support authoring: metadata, sections, field palette, field properties, terminology-bound choices, required/cardinality/repeats, conditional visibility, FHIR mapping/extraction.
3. Add preview/run panel using the same runtime.
4. Add import validation and export/import round-trip tests.
5. Add audit events for create/update/publish/archive/delete/import/export/response submission.

Estimated remaining LOE: **XL** for a useful builder; **XXL** for Corlix parity plus advanced SDC behavior.

### P1-INGEST: Pipeline

| Requirement | Status | Notes |
|---|---|---|
| P1-INGEST-1 accept payload, store raw blob, provenance | Complete/Needs Validation | `acceptPayload`, blob storage, batch store, source/converter config exist. |
| P1-INGEST-2 emit event and worker consumes | Complete | Postgres event bus, subscribe/drain/start worker paths exist. |
| P1-INGEST-3 resolve/execute plugin | Complete/Needs Validation | Resolver chains default converters and plugin runtime. |
| P1-INGEST-4 stamp provenance | Complete/Partial | Provenance fields exist and are passed into persistence. Need audit/checks across all converters. |
| P1-INGEST-5 persist canonical FHIR + flattened projection | Complete/Needs Validation | `persistResources` writes canonical and flattened projection with degraded external writes. |
| P1-INGEST-6 stage failure/retry/backoff/log | Partial/Needs Validation | Event bus backoff and batch failure handling exist. Needs stress/failure acceptance. |

What is completed:

- Batch table/config/log-ish state exists.
- CLI `ingest`, `pipeline status`, `pipeline retry`, `pipeline logs`, `queue status`, `provenance audit`.
- Built-in converters for FHIR Bundle and QuestionnaireResponse.
- Plugin resolver path.
- External DB failure degrades flat write while canonical save stands.

Remaining work:

- Confirm all failure modes are visible enough to an operator.
- Make pipeline logs UI-accessible or at least richer from CLI.
- Add a queue/pipeline UI if desired.
- Improve retry policy observability and dead-letter handling.
- Run real end-to-end acceptance using sample files and built WASM plugins.

Estimated remaining LOE: **M-L**.

### P1-PLUG: Plugin Runtime And SDK

| Requirement | Status | Notes |
|---|---|---|
| P1-PLUG-1 Extism/WASM runtime + host interface | Complete/Needs Validation | `packages/plugins` and Rust SDK exist. |
| P1-PLUG-2 plugins fetched from blob by id/version | Complete/Needs Validation | Plugin store/runtime/install/list/remove paths exist. |
| P1-PLUG-3 permissive plugin SDK | Complete | `wasm/openldr-plugin-sdk` has its own license/package. |
| P1-PLUG-4 WHONET SQLite reference plugin | Complete/Needs Validation | `wasm/whonet-sqlite` exists with sample generation. |

Additional current plugins:

- `wasm/hl7v2`
- `wasm/tabular`

Remaining work:

- Security hardening and resource limits.
- Larger plugin contract documentation.
- More plugin fixture coverage.
- Live plugin build/install/run acceptance in CI or documented manual acceptance.
- Signing or marketplace is deferred to Phase 3.

Estimated remaining LOE: **M-L**.

### P1-REP: Reporting And Dashboard

| Requirement | Status | Notes |
|---|---|---|
| P1-REP-1 multi-driver reporting via Kysely | Complete/Needs Validation | Reporting packages use Kysely. SQL Server validation still needs live proof. |
| P1-REP-2 Metabase-style dashboard surface | Complete/Partial | Dashboard page, models, widgets, filters, import/export, builder/sql modes exist. |
| P1-REP-3 raw SQL isolated/flagged | Complete/Partial | Raw SQL dashboard widgets are gated behind config and Postgres adapter. Need continued review. |

Completed report catalog includes:

- AMR resistance
- Test volume
- Patient demographics
- Turnaround time
- AMR antibiogram
- AMR first-isolate summary
- AMR GLASS RIS

Completed dashboard features:

- Dashboard list/select.
- Default sample dashboard seed.
- Edit mode.
- Add/edit/delete widgets.
- Filters.
- Builder queries and gated raw SQL widgets.
- Dashboard import/export.
- Multiple widget visual types.

Remaining work:

- Confirm all reports run cleanly against populated external warehouse data.
- Add country-specific report pack configuration.
- Improve dashboard/report permissions and ownership.
- Add better empty-state guidance once seeded data is absent.
- Live E2E against real ingest-generated data.

Estimated remaining LOE: **M-L**.

### P1-AUD: Audit Log

| Requirement | Status | Notes |
|---|---|---|
| P1-AUD-1 append-only audit log | Partial | Store, migration, API, CLI, and UI exist. Instrumentation is incomplete. |
| P1-AUD-2 audit integrates with provenance/ingest | Partial | Ingest and plugin paths record some system events. User/admin UI actions mostly do not. |

What is completed:

- `packages/audit` has append-only-style `record`, `list`, `count`, `get`, and `safeRecord`.
- `apps/server/src/audit-routes.ts` exposes query/detail.
- `apps/web/src/pages/Audit.tsx` has filters, table, detail sheet, before/after/metadata display.
- CLI `audit list` exists.
- Some system actions are recorded:
  - `db.reset`
  - `plugin.install`
  - `plugin.remove`
  - ingest audit callback from ingest handling
  - DHIS2 push/failure audit events

Current major gap:

- Forms routes do not record audit events for create/update/status/delete/response.
- Users routes do not record audit events for create/update/roles/status.
- Terminology/admin routes need review for audit coverage.
- Dashboard/report/DHIS2 mapping management routes need review for audit coverage.
- The UI has no actor context beyond hardcoded/local assumptions elsewhere.
- Audit actor extraction from authenticated requests is not visibly implemented in the server routes reviewed.

Recommended next build for Audit:

1. Add request actor resolution helper.
2. Add `safeRecord` calls to every mutating route.
3. Capture before/after snapshots for update/status/delete where practical.
4. Add tests proving events are emitted for Forms, Users, Terminology, Dashboards, DHIS2 mappings, and plugin/admin flows.
5. Add an "audit coverage checklist" to prevent future unaudited routes.

Estimated remaining LOE: **L** for comprehensive instrumentation; **M** for high-value Forms/Users/Terminology coverage only.

### P1-USER: Users Decoupled From Keycloak

| Requirement | Status | Notes |
|---|---|---|
| P1-USER-1 decoupled user management | Partial | Local user store, JIT sync from token claims, roles/status, API, CLI, and UI exist. Corlix parity is not done. |

What is completed:

- Internal `users` table/migration.
- User store supports create/get/list/update/set roles/set status.
- `syncFromClaims` can link/create local users from OIDC token claims.
- API routes for list/get/create/update/status.
- UI list/search/create/edit/roles/status.
- CLI list/show/create/set-role/activate/deactivate.

What is missing or likely incomplete:

- Corlix-style management behavior and display parity.
- Permissions/role matrix UX.
- Rich profile/details page.
- Password reset/invite/first-login workflow, if Corlix has it.
- Bulk import/export, if Corlix has it.
- Session management/force logout, if required.
- Clear Keycloak reconciliation/admin behavior.
- Audit events for user operations.
- Actor/permission enforcement on the server routes.

Recommended next build for Users:

1. Inspect Corlix Users implementation and document parity requirements.
2. Rework OpenLDR Users UI to match Corlix layout and operations.
3. Define local roles/permissions and server enforcement.
4. Add audit events for all user mutations.
5. Add E2E tests for create/edit/disable/role assignment and denied access paths.

Estimated remaining LOE: **L** for Corlix-style parity; **M** for audit + permissions + modest UI polish without full parity.

### P1-CLI: Agent-Operable CLI

| Requirement | Status | Notes |
|---|---|---|
| P1-CLI-1 commands expose every subsystem | Complete/Partial | Large CLI exists across health/db/plugin/ingest/pipeline/queue/fhir/provenance/export/forms/report/audit/users/terminology/DHIS2. |
| P1-CLI-2 structured output via `--json` | Complete/Partial | Many commands support `--json`. Need systematic confirmation all command paths produce valid JSON on success/failure. |

Notable commands present:

- `health`
- `db migrate|reset|seed`
- `target-store test`
- `terminology import|lookup|validate-code|expand|translate`
- `terminology publisher|system|term|valueset|ontology`
- `forms list|extract`
- `ingest`
- `pipeline status|retry|logs`
- `queue status`
- `provenance audit`
- `plugin install|list|test|run|remove`
- `report list|run|glass-export`
- `audit list`
- `users list`
- `user list|show|create|set-role|activate|deactivate`
- `export`
- `dhis2 map|orgunit|pull-metadata|validate|push|status|tracker|schedule`

Remaining work:

- CLI acceptance tests against built `dist` artifacts.
- Confirm all commands have good failure redaction and JSON mode.
- Add CLI docs generated from commands.

Estimated remaining LOE: **S-M**.

### P1-OBS: Observability

| Requirement | Status | Notes |
|---|---|---|
| P1-OBS-1 structured pino logging with correlation | Partial | Logger exists and ingest uses batch IDs in places. Need end-to-end review for consistent correlation. |

Remaining work:

- Standardize correlation keys across request, batch, plugin, queue, persistence, DHIS2.
- Add operator-facing troubleshooting docs.
- Possibly add request IDs in Fastify.

Estimated remaining LOE: **M**.

### P1-UI: Frontend Shell

| Requirement | Status | Notes |
|---|---|---|
| P1-UI-1 SPA shell/routing/layout/nav | Complete | Dashboard, Reports, Terminology, Forms, Users, Audit, Docs routes exist. |
| P1-UI-2 shadcn/ui primitives | Complete/Partial | Local UI primitives exist and are widely used. |
| P1-UI-3 Corlix design tokens | Complete/Partial | `DESIGN.md`, `tokens.css`, shell and components exist. Needs visual acceptance against Corlix. |
| P1-UI-4 i18n all strings en/fr/pt | Partial | Docs locale exists. Many UI strings are hard-coded English in inspected files. |
| P1-UI-5 single-origin relative API paths | Complete | Frontend uses relative `/api/...` paths. |
| P1-UI-6 Playwright-verifiable stable selectors | Partial | E2E tests exist. Need review for stable selectors on all critical flows. |

Remaining work:

- Internationalize all UI strings using react-i18next if still required.
- Add/standardize `data-testid`s for core flows.
- Run cross-viewport visual acceptance.
- Complete UI parity for Forms, Users, Audit, and DHIS2 mapping surfaces.

Estimated remaining LOE: **L** mostly due to i18n and UI parity.

## Phase 1 Non-Functional Requirements

| Requirement | Status | Notes |
|---|---|---|
| P1-NFR-1 data portability/export | Complete/Partial | CLI `export` and `packages/db/src/export-data.ts` exist. Needs metadata export review and live acceptance. |
| P1-NFR-2 security | Partial | Redaction exists; plugin sandbox exists. Full security review/resource limits remain. |
| P1-NFR-3 lean footprint | Complete/Needs Validation | Default stack is Postgres/MinIO/Keycloak, no Kafka/OpenSearch. |
| P1-NFR-4 i18n | Partial | Not all UI is i18n. |
| P1-NFR-5 testing + Playwright | Complete/Partial | Many Vitest and Playwright files exist. Need current full green run and coverage review. |
| P1-NFR-6 provenance completeness | Partial/Needs Validation | `provenance audit` exists; real reference flow needs regular zero-gap acceptance. |
| P1-NFR-7 single-port deployment | Partial | Relative API paths exist; README describes nginx; production nginx config not clearly present. |

Estimated remaining LOE: **L-XL** for NFR hardening as a package.

## Phase 2 Status

### P2-DB: SQL Server Target Store

| Requirement | Status | Notes |
|---|---|---|
| P2-DB-1 MSSQL adapter via Kysely | Complete/Needs Validation | `packages/adapter-mssql-store` uses Kysely `MssqlDialect`, tarn, tedious. |
| P2-DB-2 MSSQL-compatible flattened schema/bulk load | Partial/Needs Validation | External migrations have dialect support; no obvious bulk-copy implementation seen in quick inspection. |
| P2-DB-3 reporting verified against SQL Server | Needs Validation | Code structure supports Kysely, but live SQL Server test proof still needed. |
| P2-DB-4 external schema migrations across PG/MSSQL | Complete/Needs Validation | External migrations include dialect handling. |
| P2-DB-5 Oracle deferred | Complete | Deferred as planned. |

Remaining work:

- Run SQL Server profile in Docker and execute migrations/report tests.
- Add CI or documented acceptance for MSSQL.
- Implement true bulk-copy if not already hidden elsewhere.
- Review raw SQL variants/gating.

Estimated remaining LOE: **M-L**.

### P2-TERM: Terminology Service And Management

| Requirement | Status | Notes |
|---|---|---|
| P2-TERM-1 CodeSystem/ValueSet/ConceptMap storage | Complete | FHIR resources, terminology store, admin store, migrations exist. |
| P2-TERM-2 lookup/validate-code/expand/translate | Complete | `packages/terminology/src/operations.ts` implements operations. |
| P2-TERM-3 LOINC loader | Complete/Needs Validation | Loader and UI import dialog exist, including license acceptance flag. Needs real distribution validation. |
| P2-TERM-4 AMR reference terminology | Complete/Partial | WHONET/AMR loader/fixtures exist. Needs domain validation. |
| P2-TERM-5 custom ValueSet authoring + UI | Complete | Terminology UI has publishers, code systems, terms, mappings, value sets, builder, imports, ontology browser. |
| P2-TERM-6 terminology binding to forms/DHIS2/ingest | Partial | Terminology exists; full binding enforcement through forms and ingest needs review. |

What is strong:

- Terminology page appears to be the most developed admin surface.
- Publisher/code-system/term/mapping/value-set workflows exist.
- Ontology browser/distribution support exists for LOINC/SNOMED/RxNorm-style indexing.
- Tests exist across terminology, DB migrations/stores, UI components, and e2e.

Remaining work:

- Validate with real LOINC distribution and AMR reference data.
- Confirm terminology bindings are enforced during ingest and forms capture.
- Add audit events for terminology mutations if missing.
- Add SNOMED licensing/feature flag decision if required.

Estimated remaining LOE: **M-L**.

### P2-DHIS2: DHIS2 Integration

| Requirement | Status | Notes |
|---|---|---|
| P2-DHIS2-1 connector behind reporting-target port | Complete/Needs Validation | `ReportingTargetPort`, DHIS2 adapter, config, context exist. |
| P2-DHIS2-2 declarative mapping engine | Complete/Partial | Aggregate and tracker mapping code exists. Slice A report-source limitation appears in code comments/errors. |
| P2-DHIS2-3 facility to orgUnit mapping table + UI | Partial | Store/CLI likely exist. A dedicated UI was not obvious in the main nav. |
| P2-DHIS2-4 aggregate/tracker selectable per mapping | Complete/Partial | Both aggregate and tracker code paths exist. UI status unclear. |
| P2-DHIS2-5 scheduled/event-driven push + dry-run | Complete/Needs Validation | Schedule store/context and CLI support exist. |
| P2-DHIS2-6 push auditing/retry/non-blocking | Partial | Audit of push success/failure exists. Broader retry/status UI needs validation. |
| P2-DHIS2-7 mapping authoring UI | Missing/Partial | CLI exists; no obvious main UI route found. |
| P2-DHIS2-8 Web API default, FHIR pathway later | Complete | Adapter uses DHIS2 Web API style. |

Remaining work:

- Build/finish DHIS2 mapping UI if not present.
- Add orgUnit mapping UI.
- Add dry-run preview UI.
- Add mapping validation against pulled metadata UI.
- Run against real or seeded DHIS2 instance.
- Add audit coverage for mapping CRUD and schedule changes.

Estimated remaining LOE: **L-XL**, mostly UI + live acceptance.

### P2-REP: AMR / GLASS Report Pack

| Requirement | Status | Notes |
|---|---|---|
| P2-REP-1 AMR surveillance reports aligned to WHO GLASS | Complete/Needs Validation | AMR/GLASS report modules exist. Need domain validation. |
| P2-REP-2 antibiogram/resistance with denominator/dedup/first-isolate | Complete/Needs Validation | AMR first-isolate and aggregate logic/tests exist. Needs maintainer domain review. |
| P2-REP-3 GLASS-aligned output/export | Complete/Partial | `report glass-export` and GLASS RIS report exist. Full submission format decision may still be open. |
| P2-REP-4 PDF/exports consistent with dashboard | Complete/Partial | PDF renderer and report export paths exist. Needs visual acceptance. |

Remaining work:

- Validate AMR rules with maintainer-approved datasets.
- Confirm GLASS export format target: aligned report vs exact submission file.
- Add country config and denominator documentation.

Estimated remaining LOE: **M-L**.

### P2-PLUG: Additional Ingestion Plugins

| Requirement | Status | Notes |
|---|---|---|
| P2-PLUG-1 HL7 v2 plugin | Complete/Needs Validation | `wasm/hl7v2` exists with parser/mapping/fuzz files. |
| P2-PLUG-2 CSV/Excel plugin with configurable mapping | Complete/Needs Validation | `wasm/tabular` and sample CSV/XLSX/mapping exist. |
| P2-PLUG-3 built on Phase 1 SDK | Complete/Needs Validation | Rust WASM plugins use local SDK pattern. |

Remaining work:

- Live plugin build/install/run acceptance for HL7 and tabular samples.
- Expand HL7 message coverage beyond first ORU assumptions.
- Add richer mapping UI for CSV/Excel if desired.

Estimated remaining LOE: **M-L**.

### P2-DOC: In-App Documentation

| Requirement | Status | Notes |
|---|---|---|
| P2-DOC-1 markdown/MDX docs, searchable, i18n, versioned | Complete/Partial | Docs registry, search, locale hook, markdown renderer, versioned `0.1.0` docs exist. Likely English-first with fallback. |
| P2-DOC-2 screenshots maintained/regenerated by Playwright | Complete/Partial | Screenshot files and capture specs exist. Needs routine regeneration workflow. |
| P2-DOC-3 setup guides for DHIS2/external DB | Complete/Partial | Docs include DHIS2 and external DB pages. Needs review for current accuracy. |

Additional completed features:

- Docs page with sidebar search.
- Language selector.
- Screenshot lightbox.
- Export docs as Markdown/PDF/Word.

Remaining work:

- Fill French/Portuguese translations if required.
- Keep screenshots synced with UI.
- Expand deployment/operator docs.

Estimated remaining LOE: **M**.

### P2-HARD: Hardening And Load

| Requirement | Status | Notes |
|---|---|---|
| P2-HARD-1 plugin sandbox security review | Partial | Security doc exists. Full hardening remains. |
| P2-HARD-2 warehouse performance/load testing | Partial | Load script and notes exist. Needs regular target thresholds. |
| P2-HARD-3 credential/secret handling security pass | Partial | Redaction/config exist. Needs deliberate review. |

Remaining work:

- Set explicit load targets.
- Run load tests against Postgres and SQL Server.
- Review plugin resource limits/timeouts/memory.
- Review secrets in logs, CLI output, exceptions, and audit metadata.
- Add hardening checklist to release process.

Estimated remaining LOE: **L-XL**.

## Highest-Value Remaining Work

### 1. Build The Form Builder

Current state:

- Forms page exists.
- Import JSON works.
- Run/capture page exists.
- New form is disabled.

Why it matters:

- Forms are a central Phase 1 concept.
- Users, facilities, patients, and orders are supposed to be form-template driven.
- Without a builder, non-developer configuration is blocked.

Recommended scope:

- Corlix-style form builder page.
- Sections and fields.
- Field palette and properties panel.
- Field types currently supported by schema.
- Required/cardinality/repeats/visibility.
- Terminology-bound choices using ValueSets.
- FHIR extraction/mapping fields.
- Preview/run mode.
- Import/export round trip.
- Publish/archive governance.
- Audit events.

LOE: **XL**.

### 2. Make Audit Real Across The App

Current state:

- Audit viewer is good enough to display events.
- Store/API/CLI exist.
- But many mutating routes do not write audit events.

Recommended scope:

- Add actor resolver.
- Instrument all mutating routes.
- Add before/after snapshots.
- Add audit tests route-by-route.
- Add audit coverage checklist.

Minimum high-value first pass:

- Forms create/update/status/delete/response.
- Users create/update/roles/status.
- Terminology publisher/system/term/value-set/mapping changes.
- Dashboard create/update/delete/import.
- DHIS2 mapping/orgUnit/schedule changes.

LOE: **M** for first pass, **L** for comprehensive coverage.

### 3. Bring Users To Corlix-Style Parity

Current state:

- Local users list/create/edit/roles/status exists.
- User page is a useful admin slice, not full parity.

Recommended scope:

- Inspect Corlix Users page and define exact parity.
- Rebuild layout/actions to match expected Corlix management behavior.
- Add permission model UI.
- Add server-side access enforcement.
- Add audit.
- Add E2E.

LOE: **L**.

### 4. Finish DHIS2 UI And Acceptance

Current state:

- Backend/CLI packages exist.
- Mapping engine exists.
- Scheduler and audit push events exist.
- UI route is not obvious in current main nav.

Recommended scope:

- DHIS2 settings page.
- Metadata pull/status.
- OrgUnit mapping UI.
- Aggregate/tracker mapping editor.
- Dry-run preview.
- Push history.
- Schedule management.
- Live acceptance against seeded DHIS2.

LOE: **L-XL**.

### 5. Hardening Pass

Current state:

- Strong scaffolding and tests exist.
- Production readiness still needs deliberate validation.

Recommended scope:

- Run full gate: `pnpm turbo typecheck lint test build`, `pnpm depcruise`, `pnpm build:check` where available.
- Run Playwright visual/e2e.
- Run sample ingest flows.
- Run MSSQL profile.
- Run DHIS2 profile.
- Run load scripts.
- Review secrets and logging.

LOE: **L** for a first hardening sprint, **XL** for release-candidate hardening.

## Suggested Next Sprint Options

### Option A: Product-Usable Phase 1 Finish

Goal: Make Phase 1 feel coherent to an operator.

Work:

- Form Builder MVP.
- Users parity slice.
- Audit instrumentation for Forms and Users.
- Full UI smoke/e2e for Forms/Users/Audit.
- Update docs.

LOE: **XL**.

Best if the next milestone is a demo of the central app shell and admin workflows.

### Option B: Accountability Sprint

Goal: Make provenance/audit credible before adding more features.

Work:

- Actor resolution.
- Audit all mutating routes.
- Audit tests.
- Audit docs.
- Provenance audit acceptance.

LOE: **L**.

Best if the concern is trust/accountability and avoiding v1's "silent DB edits" problem.

### Option C: AMR Deployment Sprint

Goal: Make Phase 2 closer to country-deployable AMR surveillance.

Work:

- Validate WHONET + HL7 + CSV ingest samples.
- Validate AMR/GLASS reports.
- MSSQL live validation.
- DHIS2 dry-run + push against seeded instance.
- DHIS2 mapping/orgUnit UI if missing.

LOE: **XL**.

Best if the next milestone is a surveillance demo with reports and DHIS2.

### Option D: Forms-First Sprint

Goal: Unblock non-developer data capture/template configuration.

Work:

- Form Builder MVP.
- Terminology-bound fields.
- Preview/run.
- Publish/archive/duplicate/import/export.
- Audit events.
- Entity screen integration plan.

LOE: **XL**.

Best if forms are the most visible missing piece.

## Recommended Priority Order

Given your notes, the cleanest next sequence is:

1. **Audit instrumentation for Forms and Users first** because it is smaller than the builder and immediately makes existing pages truthful.
2. **Users Corlix parity** because the page exists and can be brought to expected behavior without waiting on the form builder.
3. **Form Builder MVP** because it is larger and should be planned carefully from Corlix before coding.
4. **DHIS2 UI/acceptance** after the Phase 1 admin experience is less hollow.
5. **Hardening + full gates** before treating the app as release-candidate.

If the next reset allows only one major workstream, pick **Form Builder** if the goal is visible product completeness, or **Audit instrumentation** if the goal is architectural trust and correctness.

## Detailed Remaining Backlog

### Forms Backlog

| Item | Status | LOE | Notes |
|---|---|---:|---|
| Form Builder page | Missing | L-XL | Largest visible gap. |
| Field palette | Missing | M | Field types already exist in schema. |
| Section/group authoring | Missing | M | Needed for SDC-like forms. |
| Repeated group authoring/runtime | Partial | M-L | Repeated fields exist; repeated sections need deeper UX. |
| Terminology-bound choices | Missing/Partial | M | Should use ValueSets. |
| FHIR mapping/extraction UI | Missing | M-L | Backend extraction exists. |
| Preview mode | Missing | S-M | Can reuse `FormCapture`. |
| Import validation report | Partial | S | Current import checks only basic schema shape in UI. |
| Duplicate/version workflow | Missing | S-M | Important for safe editing. |
| Form audit events | Missing | S-M | Route-level instrumentation. |
| Entity capture integration | Partial | M-L | Need Facilities/Patients/Orders screens driven by published forms. |

### Users Backlog

| Item | Status | LOE | Notes |
|---|---|---:|---|
| Corlix parity review/spec | Missing | S | Read Corlix and lock scope. |
| User page parity implementation | Partial | M-L | Current page is a thin table/dialog. |
| Permissions/role matrix | Missing/Partial | M | Roles are strings; enforcement needs review. |
| Server-side access control | Missing/Partial | M-L | Routes reviewed do not show permission checks. |
| Audit events | Missing | S-M | Create/update/roles/status. |
| IdP reconciliation UX | Partial/Missing | M | Local sync exists; admin workflow unclear. |
| Bulk import/export | Unknown/Missing | S-M | Depends on Corlix parity. |
| Session/force logout | Unknown/Missing | M | Depends on Keycloak integration scope. |

### Audit Backlog

| Item | Status | LOE | Notes |
|---|---|---:|---|
| Actor resolver | Missing/Partial | S-M | Needed before route instrumentation. |
| Forms audit | Missing | S | High value. |
| Users audit | Missing | S | High value. |
| Terminology audit | Needs review | M | Many admin mutations. |
| Dashboard audit | Needs review | S-M | Create/update/delete/import/export. |
| DHIS2 config/mapping audit | Partial | M | Push audit exists; CRUD needs review. |
| Before/after snapshots | Partial | M | Store supports it; callers must supply it. |
| Audit coverage tests | Missing/Partial | M | Prevent regression. |
| Audit export/report | Missing | S-M | Useful for operators. |

### DHIS2 Backlog

| Item | Status | LOE | Notes |
|---|---|---:|---|
| Metadata pull acceptance | Partial | S-M | Connector exists. |
| OrgUnit mapping UI | Missing/Partial | M | Store/CLI likely exist. |
| Mapping authoring UI | Missing/Partial | L | Required by PRD. |
| Dry-run preview UI | Missing/Partial | M | CLI exists. |
| Push history UI | Missing/Partial | S-M | Audit list can support it. |
| Scheduler UI | Missing/Partial | M | Backend exists. |
| Seeded DHIS2 e2e | Partial | M | Docker profile and scripts exist. |

### Production/Release Backlog

| Item | Status | LOE | Notes |
|---|---|---:|---|
| Full gate run | Needs Validation | XS-S | `pnpm turbo typecheck lint test build`, `pnpm depcruise`. |
| Built artifact smoke tests | Needs Validation | S | README warns source tests can miss bundle regressions. |
| Playwright visual acceptance | Needs Validation | S-M | E2E exists. |
| MSSQL live acceptance | Needs Validation | M | Docker profile exists. |
| DHIS2 live acceptance | Needs Validation | M | Docker profile exists. |
| Security review | Partial | L | Plugin sandbox/secrets/logs. |
| Load test thresholds | Partial | M | Load script/notes exist. |
| nginx/single-port production config | Partial/Missing | M | README describes it; config not obvious. |
| Full i18n | Partial | L | Many UI strings hard-coded English. |

## Practical Milestone Definitions

### Phase 1 "Actually Done" Criteria

Phase 1 should be called done when:

- All PRD P1 commands work with `--json`.
- WHONET reference ingest produces canonical FHIR and flattened external rows.
- `provenance audit` returns zero gaps for the reference flow.
- Forms can be authored, published, run, exported, and audited without editing JSON by hand.
- Users can be managed in the expected Corlix-style workflow.
- Audit page shows real events from normal UI/admin activity.
- Reports/dashboard run against ingest-produced data.
- Full test/type/lint/build/depcruise gates pass.
- Playwright covers Dashboard, Reports, Terminology, Forms, Users, Audit, Docs.
- Single-origin deployment path is documented and tested locally.

### Phase 2 "Actually Done" Criteria

Phase 2 should be called done when:

- SQL Server target store is live-validated for migrations, writes, and reports.
- LOINC and AMR terminology import works with real distributions/reference files.
- Terminology bindings validate coded ingest/form data.
- DHIS2 aggregate and tracker mappings can be authored in UI, dry-run, pushed, audited, retried, and scheduled.
- Facility/orgUnit mapping can be managed in UI.
- AMR/GLASS reports are domain-reviewed with representative data.
- HL7 v2 and CSV/Excel plugin flows are validated end-to-end.
- Docs explain setup, external DB, DHIS2, terminology, ingestion, reports, and CLI.
- Hardening/load/security pass is complete.

## Risk Register

| Risk | Severity | Why It Matters | Mitigation |
|---|---|---|---|
| Forms Builder missing | High | Blocks non-developer form/template authoring and several Phase 1 workflows. | Plan and build Corlix-style builder as its own workstream. |
| Audit instrumentation incomplete | High | Undermines core provenance/accountability principle. | Add actor resolver and route-level audit coverage. |
| Users not Corlix-parity | Medium-high | Admin workflow may feel incomplete or wrong to expected users. | Inspect Corlix and port behavior/design. |
| i18n incomplete | Medium | PRD requires en/fr/pt; many strings are English. | Add i18n sweep after UI stabilizes. |
| SQL Server unvalidated | Medium-high | Phase 2 deployability depends on it. | Run live MSSQL acceptance. |
| DHIS2 UI missing/incomplete | Medium-high | CLI/backend alone does not satisfy mapping authoring workflow. | Build DHIS2 admin UI. |
| Plugin sandbox hardening incomplete | High | Untrusted ingest inputs/plugins are a security boundary. | Security review, resource limits, fuzzing/load. |
| Real AMR domain validation pending | Medium-high | Reports can be technically correct but epidemiologically wrong. | Validate with maintainer-approved fixtures and rules. |
| Docs may drift | Medium | Rapid build means docs/screenshots can become stale. | Regenerate screenshots and review docs near release. |

## Bottom Line

The repo has a strong spine and a surprising amount of Phase 2 implementation already present. The next work should not be another broad foundation pass. The next work should close the visible and trust-related gaps:

1. **Make audit real.**
2. **Make Users behave like the Corlix reference.**
3. **Build the missing Form Builder.**
4. **Then validate DHIS2/MSSQL/AMR flows end-to-end.**

If only one thing can be done next, choose based on the next milestone:

- For a credible operator/admin demo: **Users + Audit**.
- For a credible forms/product demo: **Form Builder**.
- For a credible surveillance deployment demo: **MSSQL + DHIS2 + AMR validation**.
