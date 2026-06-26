# OpenLDR Community Edition — Product Requirements Document

**Single consolidated PRD** — supersedes the original `openldr-ce-prd-phase1.md`,
`openldr-ce-prd-phase2.md`, and `openldr-ce-prd-phase3.md` (folded in here; originals
remain in git history). Also absorbs the point-in-time status/handoff/audit notes that
previously lived at the repo root.

**Edition:** `openldr_ce` — clean-slate rebuild, no migration from v2 (v2 had no production deployments)
**License (pending company/legal sign-off):** AGPL-3.0 for the core; permissive (Apache-2.0/MIT) for the plugin SDK
**Status of this document:** living. Requirements below are annotated with **as-built delivery status**.

> **How to read this document.** Sections 1–4 are the durable product vision, principles,
> architecture, and stack — still accurate. Sections 5–7 are the Phase 1 / 2 / 3 requirements,
> each row marked with its delivery state. Section 8 records significant work delivered **beyond**
> the original three PRDs. Section 9 lists what remains deferred. The per-feature design trail
> (brainstorm → spec → plan) lives under `docs/superpowers/specs/` and `docs/superpowers/plans/`.

**Delivery legend:** ✅ Delivered · 🟡 Partial / evolved · ⏳ Deferred (not built)

---

## 1. Overview & Vision

OpenLDR Community Edition is a **FHIR-native, central laboratory data integration engine +
analytics warehouse + reporting platform** for national lab networks, primarily in
PEPFAR-aligned contexts. It ingests heterogeneous lab data from any source via sandboxed
plugins, normalizes it to FHIR R4, persists it to a client-chosen analytics database, and
provides domain reporting and dashboards over it.

It is a **clean-slate rebuild**. OpenLDR v2 reached only development stage with no country
implementations, so there is no data or deployment to migrate. CE reimplements the proven
*designs* maturated in the sibling project Corlix — it does **not** copy Corlix source
(see §10, IP Boundary).

### Relationship to Corlix
Corlix (an offline-first edge LIS) and OpenLDR CE (the central tier) are **separate projects
with separate codebases and separate ownership**, bound not by shared code but by a shared
standard: both are FHIR R4 native. A form (FHIR Questionnaire) or terminology set
(CodeSystem/ValueSet) authored in one can run in the other, and a QuestionnaireResponse
captured at a Corlix edge node can be submitted to OpenLDR CE over FHIR.

### Lessons from v1/v2 that shape this design
- **v1 was just a DB schema**; countries built their own tools and vendors modified the
  database directly, with no record of who changed what.
- **COVID-era sovereignty paranoia**: Ministries abandoned systems when they couldn't extract
  their own data or keep it in-country.

These produce three non-negotiable principles: **data portability**, **provenance/accountability**,
and **client-owned storage**.

### The north-star flow
WHONET (and other lab sources) → OpenLDR CE (FHIR-normalized warehouse + terminology + reports)
→ DHIS2 (Ministry surveillance), with every extension a signed, capability-scoped, audited artifact.

---

## 2. Cross-Cutting Design Principles

| # | Principle | What it means in practice |
|---|-----------|---------------------------|
| DP-1 | **Hexagonal / ports-and-adapters** | All infrastructure sits behind interfaces. Swap any provider without touching core logic. Core ports: auth, blob storage, eventing, target data store, reporting target, health. |
| DP-2 | **Data portability as a trust guarantee** | A client can extract their complete dataset in open formats, on demand, with no maintainer in the loop. A first-class requirement, not a feature. |
| DP-3 | **Provenance & accountability** | Every ingested record carries who/what produced it, which plugin (+version) processed it, when, and a batch id linking to the raw payload. Nothing enters the warehouse anonymously. |
| DP-4 | **Agent-operability** | Every subsystem is drivable and inspectable by an autonomous agent. Backend → CLI; frontend → Playwright. |
| DP-5 | **Lean by default** | Modular monolith, Postgres-first, Postgres-outbox eventing. No Kafka, no OpenSearch unless a deployment proves it needs them — and then only behind the existing port. |
| DP-6 | **FHIR R4 native** | The canonical internal data model is FHIR R4. The warehouse receives flattened, query-friendly projections of it. |
| DP-7 | **Graceful degradation & observability** | A downstream failure (e.g. the external DB is unreachable) fails that pipeline stage, queues/retries, and logs — it never bricks the app. Structured logs (pino) everywhere. |

---

## 3. Architecture Overview

### 3.1 Shape
A **modular monolith** (single deployable) with strict internal module boundaries, enforced by
`depcruise`. Extract a module into its own service later *only* if a concern proves it needs
independent scaling. A deliberate reaction to v2's ~30-service weight.

### 3.2 The two databases
- **Internal DB (always Postgres):** operational state only — users, audit log, queue/outbox,
  pipeline state, config, in-flight payloads, marketplace/registry/connector/workflow state.
- **External / analytics DB (client-chosen; Postgres default, MSSQL implemented):** the **system
  of record for domain/analytics data**. Reporting reads from here. It receives **flattened,
  tabular** projections (never raw `jsonb`), so it stays portable across engines.

> **Why flattened, not jsonb:** SQL Server only gained a native JSON type in SQL Server 2025;
> Oracle differs again. Projecting FHIR into plain relational tables on the way out keeps the
> warehouse engine-portable and shrinks per-engine type-mapping to one outbound writer adapter.

### 3.3 The ports
| Port | Default adapter | Other adapters |
|------|-----------------|----------------|
| **Auth** (OIDC) | Keycloak | Any OIDC provider |
| **Blob storage** (S3 API) | MinIO / S3 | Local FS for dev/edge |
| **Eventing / orchestration** | Postgres outbox + `pg_notify` + worker pool | Kafka, Inngest (deferred) |
| **Target data store** | Postgres | **MSSQL (built)**, Oracle (deferred) |
| **Reporting target** | DHIS2 (via WASM sink plugin) | Any push target via the sink-plugin ABI |

### 3.4 Ingest pipeline (the heart)
```
source file/payload
   → received & stored raw in blob storage (provenance: source, timestamp, batch id)
   → event emitted via eventing port
   → worker picks up event
   → sandboxed plugin (Extism/WASM) reads → validates → converts to FHIR R4
   → provenance stamped (plugin id + version, batch id)
   → persisted: FHIR canonical form internally + flattened projection to external DB
   → on failure at any stage: retry/queue + structured log, no app-wide failure
```

### 3.5 Plugin runtime & extensibility
Plugins are **sandboxed, any-language artifacts** on **Extism/WASM**. Three plugin kinds now
exist: **ingest converters** (format → FHIR R4), **sink plugins** (FHIR/flattened → external
push target, e.g. DHIS2), and **UI/webview plugins** (sandboxed-iframe SPAs that contribute their
own pages and data store). All are distributed as signed, capability-scoped marketplace artifacts.

### 3.6 Reporting layer
Domain reporting/dashboards read the external DB through the **multi-driver query abstraction
(Kysely)**. Raw SQL is a documented, isolated exception — never the norm.

---

## 4. Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript end-to-end (+ Rust for WASM plugins) | |
| Monorepo | Turborepo + **pnpm** (pinned, lockfile committed) | No npm/yarn |
| Backend framework | **Fastify** | Schema validation, encapsulated plugins, pino logging |
| Query layer | **Kysely** | Postgres, MSSQL, SQLite, PGlite dialects |
| Internal DB | PostgreSQL | |
| External DB | PostgreSQL (default); **MSSQL** behind the port | Oracle deferred |
| Plugin runtime | **Extism / WASM** | Any-language sandboxed plugins (TS SDK + Rust SDK) |
| FHIR | Hand-rolled over the official FHIR **R4** schema | Reimplement, do not copy (§10) |
| Frontend | React + Vite (SPA) + Tailwind + **shadcn/ui** | Themed by `DESIGN.md` |
| i18n | react-i18next | en / fr / pt |
| Auth | Keycloak behind OIDC port | |
| Blob storage | MinIO / S3 behind the port | |
| Logging | pino (structured) | |
| Reverse proxy / TLS | **nginx** | Single HTTPS port in production |
| E2E / UI verification | **Playwright** | Also the agent's self-verification surface |
| CLI | **OpenLDR CLI** (commander, `--json`) | Agent's self-troubleshooting surface |
| Secrets at rest | AES-256-GCM (`@openldr/core`, `SECRETS_ENCRYPTION_KEY`) | Connector configs encrypted in the internal DB |

**Workspace layout (current):** `apps/{server,web}`; `packages/{core, config, ports, db, fhir,
forms, ingest, plugins, reporting, dashboards, report-pdf, audit, users, terminology, dhis2,
marketplace, workflows, plugin-ui-sdk, bootstrap, cli}` + adapters
(`adapter-auth, adapter-s3-bucket, adapter-event-bus, adapter-db-store, adapter-mssql-store`);
`wasm/{whonet-sqlite, hl7v2, tabular, dhis2-sink, test-sink, openldr-plugin-sdk}`; `e2e/`.

---

## 5. Phase 1 — The Spine (delivered)

### 5.1 Core skeleton & ports
| Req | Status | Notes |
|-----|:------:|-------|
| P1-CORE-1 modular monorepo skeleton | ✅ | Turborepo/pnpm workspace with the package layout above; boundaries enforced by `depcruise`. |
| P1-CORE-2 the ports as interfaces | ✅ | `packages/ports`: auth, blob, eventing, target-store, reporting-target, health. No core module imports a concrete adapter. |
| P1-CORE-3 config-driven adapter selection + health | ✅ | `packages/config` schema selects adapters; health registry checks each. |

### 5.2 FHIR R4 data layer
| Req | Status | Notes |
|-----|:------:|-------|
| P1-FHIR-1 hand-rolled R4 model/validation/storage | ✅ | `packages/fhir`. |
| P1-FHIR-2 canonical domain entities as FHIR resources | ✅ | Patient, Specimen/Isolate, ServiceRequest/DiagnosticReport/Observation, Organization/Location. |
| P1-FHIR-3 flattening to relational analytics tables | ✅ | External `001_flat_tables` (+ `002_specimen_origin`). |

### 5.3 Forms-from-templates engine
| Req | Status | Notes |
|-----|:------:|-------|
| P1-FORM-1 Questionnaire/QuestionnaireResponse/SDC engine | ✅ | `packages/forms`. |
| P1-FORM-2 entity capture driven by form templates | ✅ | Facilities/Patients/Orders/Users captured via templates. |
| P1-FORM-3 group types & repetition | ✅ | |
| **Form Builder** (full Corlix-parity three-pane builder) | ✅ | Shipped beyond the original P1 slice — see §8. |

### 5.4 Ingest pipeline
| Req | Status | Notes |
|-----|:------:|-------|
| P1-INGEST-1 accept payload, store raw, record provenance | ✅ | `packages/ingest`. |
| P1-INGEST-2 emit event; worker consumes | ✅ | Postgres outbox + `pg_notify`. |
| P1-INGEST-3 resolve + run plugin in WASM sandbox | ✅ | |
| P1-INGEST-4 stamp provenance (plugin id+version, batch id) | ✅ | |
| P1-INGEST-5 persist canonical FHIR + flattened projection | ✅ | |
| P1-INGEST-6 graceful per-stage failure / retry / log | ✅ | |

### 5.5 Plugin runtime & SDK
| Req | Status | Notes |
|-----|:------:|-------|
| P1-PLUG-1 Extism/WASM runtime + host-function interface | ✅ | `packages/plugins`. |
| P1-PLUG-2 plugins fetched by id+version; provenance ties output to version | ✅ | |
| P1-PLUG-3 permissively-licensed plugin SDK | ✅ | TS SDK + `wasm/openldr-plugin-sdk` (Rust). |
| P1-PLUG-4 WHONET SQLite reference plugin | ✅ | `wasm/whonet-sqlite`. |

### 5.6 Domain reporting & dashboard
| Req | Status | Notes |
|-----|:------:|-------|
| P1-REP-1 multi-driver reporting (Kysely) over external DB | ✅ | `packages/reporting`. |
| P1-REP-2 dashboard surface over flattened tables | ✅ | `packages/dashboards` + web dashboard. |
| P1-REP-3 all reports via the query abstraction; raw SQL isolated | ✅ | Custom-SQL widgets are gated/flagged. |

### 5.7 Audit log
| Req | Status | Notes |
|-----|:------:|-------|
| P1-AUD-1 append-only audit log | ✅ | `packages/audit`. |
| P1-AUD-2 audit integrates with provenance | ✅ | Ingest/plugin/DHIS2/marketplace lifecycle + user/UI actions instrumented. |

### 5.8 Users (decoupled)
| Req | Status | Notes |
|-----|:------:|-------|
| P1-USER-1 user management decoupled from Keycloak | ✅ | `packages/users` + Keycloak admin/realm provisioning; roles: lab_admin, lab_manager, lab_technician, data_analyst, system_auditor. |

### 5.9 OpenLDR CLI (agent-operable)
| Req | Status | Notes |
|-----|:------:|-------|
| P1-CLI-1 first-class CLI over every subsystem | ✅ | `db, plugin, ingest, pipeline, queue, fhir, health, provenance, export` + later families (terminology, forms, target-store, report, audit, users, dhis2, market, artifact). |
| P1-CLI-2 `--json` machine-readable output | ✅ | |

### 5.10 Observability
| Req | Status | Notes |
|-----|:------:|-------|
| P1-OBS-1 structured pino logging with correlation key | ✅ | |

### 5.11 Frontend / UI shell
| Req | Status | Notes |
|-----|:------:|-------|
| P1-UI-1 SPA shell (routing, layout, nav) | ✅ | `apps/web`. |
| P1-UI-2 shadcn/ui single primitive set | ✅ | Vendored under `components/ui`. |
| P1-UI-3 theming from `DESIGN.md` | ✅ | `DESIGN.md` is the design-token source of truth. |
| P1-UI-4 i18n en/fr/pt, no hard-coded copy | ✅ | |
| P1-UI-5 single-origin routing, relative API paths | ✅ | |
| P1-UI-6 Playwright-verifiable selectors | ✅ | |

### 5.12 Phase 1 Non-Functional
| Req | Status | Notes |
|-----|:------:|-------|
| P1-NFR-1 data portability (`export`) | ✅ | CSV/JSON/FHIR Bundle export. |
| P1-NFR-2 security (sandbox isolation, no secret logging) | ✅ | Plugin sandbox + secret redaction; secrets sealed at rest. |
| P1-NFR-3 lean footprint (no Kafka/OpenSearch default) | ✅ | |
| P1-NFR-4 i18n en/fr/pt | ✅ | |
| P1-NFR-5 unit + Playwright E2E | ✅ | |
| P1-NFR-6 provenance completeness | ✅ | `provenance audit`. |
| P1-NFR-7 single-port deployment | ✅ | nginx TLS reverse proxy + single-port Docker stack (`docker-compose.prod.yml`). |

---

## 6. Phase 2 — Country-Deployable AMR Surveillance (delivered)

**Shippable outcome reached:** a Ministry can stand up CE behind a single HTTPS port, ingest
WHONET / HL7 / CSV lab data, store it in Postgres or SQL Server, validate against LOINC and AMR
terminology, push aggregate/tracker data to DHIS2 per their own mapping, and produce
GLASS-aligned AMR reports.

### 6.1 SQL Server target-store adapter (P2-DB)
| Req | Status | Notes |
|-----|:------:|-------|
| P2-DB-1 MSSQL target-store via Kysely | ✅ | `packages/adapter-mssql-store`. |
| P2-DB-2 MSSQL-compatible flattened projection + bulk load | ✅ | |
| P2-DB-3 reporting verified on MSSQL, raw-SQL variants | ✅ | |
| P2-DB-4 external DDL/migration across Postgres + MSSQL | ✅ | |
| P2-DB-5 Oracle interface ready, impl deferred | ⏳ | Deferred (see §9). |

### 6.2 Terminology service & management (P2-TERM)
| Req | Status | Notes |
|-----|:------:|-------|
| P2-TERM-1 store/manage CodeSystem/ValueSet/ConceptMap | ✅ | `packages/terminology`. |
| P2-TERM-2 `$lookup` / `$validate-code` / `$expand` / `$translate` | ✅ | |
| P2-TERM-3 LOINC loader (license accept on import) | ✅ | Operator-provided distributions. |
| P2-TERM-4 AMR reference terminology (organism/antibiotic, WHONET/EUCAST/CLSI-aligned) | ✅ | |
| P2-TERM-5 custom ValueSet authoring + management UI | ✅ | Full Corlix-parity Terminology page incl. Ontology Browser (SP1–SP4). |
| P2-TERM-6 binding: forms/DHIS2 mappings validate against ValueSets | ✅ | |

### 6.3 DHIS2 integration (P2-DHIS2)
**Architectural evolution:** DHIS2 was first built as an in-host adapter (`@openldr/adapter-dhis2`),
then re-architected into a **Rust→WASM sink plugin** (`wasm/dhis2-sink`) over a generic sink-plugin
ABI, plus a **dynamic Connector model** (DB-stored, AES-256-GCM-encrypted secrets, configure/test
live in the UI — no `.env`/restart). The host package `@openldr/dhis2` shrank to helpers and the
old adapter was deleted. The capability surface is unchanged; the delivery mechanism is now a
removable plugin. See §8 and the DHIS2 sink-plugin design spec.

| Req | Status | Notes |
|-----|:------:|-------|
| P2-DHIS2-1 connector behind a reporting-target port; managed secrets | ✅ | Now via sink-plugin + encrypted connector store (migration 033). |
| P2-DHIS2-2 declarative mapping engine (aggregate + tracker) | ✅ | Ported into `wasm/dhis2-sink`. |
| P2-DHIS2-3 facility ↔ orgUnit mapping table + UI | ✅ | |
| P2-DHIS2-4 aggregate / tracker / both, per mapping | ✅ | |
| P2-DHIS2-5 scheduled + event-driven push; dry-run preview | ✅ | |
| P2-DHIS2-6 push auditing, retries, never blocks app | ✅ | |
| P2-DHIS2-7 mapping authoring UI vs pulled DHIS2 metadata | ✅ | Metadata cache + mapping editors (aggregate + tracker). |
| P2-DHIS2-8 Web API default; FHIR pathway permitted | ✅ | Web API default. |

### 6.4 AMR / GLASS report pack (P2-REP)
| Req | Status | Notes |
|-----|:------:|-------|
| P2-REP-1 GLASS-aligned report pack on the multi-driver layer | ✅ | |
| P2-REP-2 antibiogram/resistance with denominators, dedup, first-isolate | ✅ | |
| P2-REP-3 GLASS-aligned output/export | 🟡 | GLASS-**aligned** reports delivered; full GLASS submission-format export deferred. |
| P2-REP-4 PDF/exports through the reporting layer | ✅ | `packages/report-pdf`. |

### 6.5 Additional ingestion plugins (P2-PLUG)
| Req | Status | Notes |
|-----|:------:|-------|
| P2-PLUG-1 HL7 v2 → FHIR R4 | ✅ | `wasm/hl7v2`. |
| P2-PLUG-2 CSV/Excel with column mapping → FHIR R4 | ✅ | `wasm/tabular`. |
| P2-PLUG-3 built on the Extism/WASM SDK | ✅ | |

### 6.6 In-app documentation (P2-DOC)
| Req | Status | Notes |
|-----|:------:|-------|
| P2-DOC-1 in-app markdown docs, searchable, i18n, versioned | ✅ | `apps/web/src/docs` (0.1.0, en/fr/pt) + step-by-step overhaul. |
| P2-DOC-2 screenshots alongside docs, Playwright-regenerable | 🟡 | Screenshots maintained; auto-regen harness needs a seeded WHONET dataset. |
| P2-DOC-3 setup guides incl. DHIS2 + external DB | ✅ | |

### 6.7 Hardening & load (P2-HARD)
| Req | Status | Notes |
|-----|:------:|-------|
| P2-HARD-1 plugin sandbox security review | ✅ | Sandbox doc (`docs/security/plugin-sandbox.md`) + Phase-4 security audit. |
| P2-HARD-2 warehouse performance/load testing | 🟡 | Functional on Postgres + MSSQL; large-volume load tuning ongoing. |
| P2-HARD-3 security pass on external-target credentials | ✅ | Encrypted connector store; live audit. |

---

## 7. Phase 3 — Ecosystem & Extensibility (delivered)

The headline is a **marketplace** distributing plugins, form templates, and report templates,
backed by a security model for running untrusted, third-party artifacts in production. Every
extension is a **signed, versioned, capability-scoped, audited** artifact. The marketplace is
**local-first** (works fully offline / air-gapped); federation is optional and additive.

### 7.1 Artifact & manifest model (P3-ART)
| Req | Status | Notes |
|-----|:------:|-------|
| P3-ART-1 common artifact model (plugins, form templates, report templates) | ✅ | `packages/marketplace`; extensible to sink/UI plugins, which now exist. |
| P3-ART-2 manifest: id, version, publisher, CE-version range, capabilities, deps, signature | ✅ | |
| P3-ART-3 self-contained bundles installable offline or from a registry | ✅ | |

### 7.2 Trust & security (P3-SEC)
| Req | Status | Notes |
|-----|:------:|-------|
| P3-SEC-1 signing & verification (Ed25519); reject tampered/unsigned | ✅ | TOFU trust model. |
| P3-SEC-2 capability-based permissions enforced by the sandbox | ✅ | Fail-closed runtime enforcement. |
| P3-SEC-3 consent-on-install (capabilities surfaced, grants recorded) | ✅ | |
| P3-SEC-4 compatibility gate (CE version range) | ✅ | |
| P3-SEC-5 lifecycle audit (install/update/enable/disable/remove + active version) | ✅ | |

### 7.3 Local registry & lifecycle (P3-REG)
| Req | Status | Notes |
|-----|:------:|-------|
| P3-REG-1 offline registry: install/update/rollback/enable-disable/remove | ✅ | |
| P3-REG-2 installed artifacts register without rebuild | ✅ | Plugins, form templates, report templates, UI/sink plugins. |
| P3-REG-3 version management (multiple versions, safe update/rollback, deps) | ✅ | Version model collapses Browse by id with a version switcher (SP-B). |
| **User-managed DB-backed registries** (multiple sources, no restart) | ✅ | Registries management tab + per-request aggregation (SP-C, migration 034). |

### 7.4 Publishing & developer experience (P3-PUB)
| Req | Status | Notes |
|-----|:------:|-------|
| P3-PUB-1 publish flow (package + manifest + sign → registry/catalog) | ✅ | Incl. in-app GitHub-PR publish for form templates. |
| P3-PUB-2 scaffolding CLI (`plugin/form/report new`) | ✅ | `artifact` authoring CLI + marketplace `scaffold`/`packBundle`. |
| P3-PUB-3 local test harness; agent-operable | ✅ | `marketplace:accept` / `dhis2:accept` live harnesses. |

### 7.5 Marketplace UI (P3-UI)
| Req | Status | Notes |
|-----|:------:|-------|
| P3-UI-1 browse/search/filter by type/compat/publisher | ✅ | `/settings/marketplace`. |
| P3-UI-2 artifact detail (manifest, capabilities, version history, signature/publisher, signed README) | ✅ | Sanitized markdown README rendered on detail page. |
| P3-UI-3 install/update/remove with consent; admin-gated | ✅ | |
| P3-UI-4 "Installed" management (active versions, enable/disable, rollback) | ✅ | |

### 7.6 Optional federation (P3-FED)
| Req | Status | Notes |
|-----|:------:|-------|
| P3-FED-1 thin sync from a remote catalog | 🟡 | HTTP-registry install + in-app GitHub-PR publish delivered; full central-catalog governance out of scope. |
| P3-FED-2 pulled artifacts go through the same sign/verify/consent path | ✅ | |

---

## 8. Beyond the Original PRDs (delivered)

Significant subsystems built on top of, or as evolutions of, the three phase PRDs. Full design
trail under `docs/superpowers/`.

- **Workflow Builder** — an internal n8n-style, node-based workflow designer (`packages/workflows`,
  `/workflows`). Sources (SQL / FHIR / HTTP / load-dataset), a sandboxed worker-thread **Code node**,
  sinks (materialize dataset / export artifact / DHIS2 push), queryable published datasets, and
  **triggers + run history** (cron / webhook / ingest). Replaces hand-built DB views and standalone
  Node.js analysis projects. (SP-1…SP-4, SP-D list page; migrations 027–032.)
- **Plugin-contributed UI (webview plugins)** — a sandboxed-iframe host + host-injected versioned
  **`@openldr/plugin-ui-sdk`** over a transferred MessagePort, a capability/role/global-policy broker,
  a per-plugin server-scoped datastore (`plugin_data`, migration 035), and nav contribution. Plugins
  contribute their own pages at `/x/:pluginId`. (Marketplace-extensibility v-next SP-A1.)
- **DHIS2 sink-plugin + dynamic Connectors** — DHIS2 re-architected from an in-host adapter into a
  Rust→WASM **sink plugin** (`wasm/dhis2-sink`) + a generic, DB-stored **Connector** model with
  AES-256-GCM-encrypted secrets configured/tested live in the UI (no `.env`/restart). `@openldr/adapter-dhis2`
  deleted. Migrations 033 (connectors), 036 (dhis2 → plugin_data). Proven live against DHIS2 2.40.3.
  (DHIS2 sink-plugin workstream SP-1…SP-7.) **In progress:** migrating DHIS2's admin UI into a removable
  **webview plugin** and deleting the host DHIS2 page (SP-A2).
- **Reports page (Corlix parity)** — full report library + params + Document/PDF viewer + run history
  + scheduling engine (`report_schedules`/`_runs`, migrations 025–026).
- **Form Builder** — full Corlix-parity three-pane builder (completes P1-FORM beyond the original slice).
- **Production single-port Docker stack** — Dockerfile + nginx TLS proxy + `docker-compose.prod.yml`
  (delivers P1-NFR-7 end to end).
- **i18n en/fr/pt full sweep** — per-language UI bundles with compile-time key parity + translated docs.

---

## 9. Deferred / Not Built

Designed-for but not built; ports/seams left clean for later.

- **Oracle** target-store adapter — build when a client mandates Oracle (interface ready).
- **Kafka / Inngest** eventing adapters — build when throughput proves it (behind the existing port).
- **Desktop wrapper** (Electron/Tauri) — when offline/desktop central use emerges.
- **FHIR R5** / other versions — schema-driven layer accommodates; not built.
- **Full GLASS submission-format export** — GLASS-*aligned* reports are delivered; the formal
  submission-file export is deferred.
- **Central public catalog federation** (hosting/governance) — local-first registry + HTTP/GitHub
  publish delivered; a governed central catalog is an org decision, out of scope.
- **Warehouse large-volume load tuning** — functional on Postgres + MSSQL; sustained high-volume
  tuning ongoing (P2-HARD-2).
- **Phase 4 — Intelligence** (candidate future phase): AI/agentic services — local/edge inference,
  MCP-exposed tools over the FHIR/warehouse data, assisted mapping and data-quality detection.

---

## 10. IP Boundary (read before writing any code)

OpenLDR CE is **company-owned and AGPL-licensed**. Corlix is a **separate, personally-owned
project**. CE reimplements Corlix's proven *designs and architecture* (the FHIR-over-schema
approach, FHIR Questionnaire forms, the terminology model, the decoupled-users pattern, the
dashboard/terminology/reports UX). **CE must not copy Corlix source code.** Ideas and architecture
are the shared blueprint; source is not. Where this document says "follow the Corlix approach,"
treat Corlix strictly as a read-only design reference and write original implementations in the
CE repo. The plugin SDK is permissively licensed so third parties may publish artifacts under their
own terms, including proprietary, across the arm's-length WASM boundary.

---

## 11. Repository & Workflow Conventions

- **Package manager:** pnpm only, with workspaces. Pin the pnpm version, commit the lockfile. No npm/yarn.
- **License headers:** AGPL-3.0 headers once company/legal sign-off lands; permissive headers on the plugin SDK.
- **Scoped commits:** small, reviewable commits aligned to requirement IDs where practical.
- **Proxy-relative everything:** no hard-coded hosts/ports in app code; single origin behind the reverse proxy.
- **Gates (run from repo root):** `pnpm turbo typecheck lint test build` and `pnpm depcruise` — both green before merge.
  Periodically run with `--force` so cross-package type breakage can't hide behind the turbo cache.

---

## 12. Open Decisions

- AGPL-3.0 sign-off from company/legal; final license headers.
- Keep the "Community Edition" name, or ship as `openldr` until a second edition exists.
- Oracle dialect approach for the target-store port (community Kysely dialect vs custom) — on demand.
- Whether/when to host a governed central marketplace catalog (federation), and who moderates it.
- Phase 4 (Intelligence) scope and timing.

---

*Design history (per-feature brainstorm → spec → plan) lives under `docs/superpowers/specs/` and
`docs/superpowers/plans/`. Operator/reference docs live under `docs/` and the in-app docs under
`apps/web/src/docs/`.*
