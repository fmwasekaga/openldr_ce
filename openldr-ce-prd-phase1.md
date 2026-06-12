# OpenLDR Community Edition — Product Requirements Document
## Phase 1: The Spine

**Status:** Draft for build kickoff
**Audience:** Claude Code (autonomous implementation) + maintainers
**Edition:** `openldr_ce` — clean-slate rebuild, no migration from v2 (v2 has no production deployments)
**License (pending company/legal sign-off):** AGPL-3.0 for the core; permissive (Apache-2.0/MIT) for the plugin SDK

---

## 1. Overview & Vision

OpenLDR Community Edition is a **FHIR-native, central laboratory data integration engine + analytics warehouse + reporting platform** for national lab networks, primarily in PEPFAR-aligned contexts. It ingests heterogeneous lab data from any source via sandboxed plugins, normalizes it to FHIR R4, persists it to a client-chosen analytics database, and provides domain reporting and dashboards over it.

It is a **clean-slate rebuild**. OpenLDR v2 reached only development stage with no country implementations, so there is no data or deployment to migrate. CE reimplements the proven *designs* maturated in the sibling project Corlix — it does **not** copy Corlix source (see §10, IP Boundary).

### Relationship to Corlix
Corlix (an offline-first edge LIS) and OpenLDR CE (the central tier) are **separate projects with separate codebases and separate ownership**. They are bound not by shared code but by a shared standard: both are FHIR R4 native. Because of that, a form (FHIR Questionnaire) or terminology set (CodeSystem/ValueSet) authored in one can run in the other, and a QuestionnaireResponse captured at a Corlix edge node can be submitted to OpenLDR CE over FHIR. Two clean-IP projects, one interoperable product family.

### Lessons from v1 that shape this design
- **v1 was just a DB schema**; countries built their own tools and vendors modified the database directly, with no record of who changed what.
- **COVID-era sovereignty paranoia**: Ministries abandoned long-used systems (some reverting to Excel) when they couldn't extract their own data or keep it in-country.

These produce three non-negotiable principles below: data portability, provenance/accountability, and client-owned storage.

---

## 2. Cross-Cutting Design Principles

| # | Principle | What it means in practice |
|---|-----------|---------------------------|
| DP-1 | **Hexagonal / ports-and-adapters** | All infrastructure sits behind interfaces. Swap any provider without touching core logic. Phase 1 ports: auth, blob storage, eventing, target data store. |
| DP-2 | **Data portability as a trust guarantee** | A client can extract their complete dataset in open formats, on demand, with no maintainer in the loop. This is a first-class requirement, not a feature. |
| DP-3 | **Provenance & accountability** | Every ingested record carries who/what produced it, which plugin (+version) processed it, when, and a batch id linking to the raw payload. Nothing enters the warehouse anonymously. |
| DP-4 | **Agent-operability** | Every subsystem is drivable and inspectable by an autonomous agent. Backend → CLI; frontend → Playwright. Human-in-the-loop for diagnosis is minimized by design. |
| DP-5 | **Lean by default** | Modular monolith, Postgres-first, Postgres-outbox eventing. No Kafka, no OpenSearch unless a deployment proves it needs them — and then only behind the existing port. |
| DP-6 | **FHIR R4 native** | The canonical internal data model is FHIR R4. The warehouse receives flattened, query-friendly projections of it. |
| DP-7 | **Graceful degradation & observability** | A downstream failure (e.g. the external DB is unreachable) fails that pipeline stage, queues/retries, and logs — it never bricks the app. Structured logs (pino) everywhere. |

---

## 3. Architecture Overview

### 3.1 Shape
A **modular monolith** (single deployable) with strict internal module boundaries. Extract a module into its own service later *only* if a concern proves it needs independent scaling (the plugin runner is the most likely future candidate). This is a deliberate reaction to v2's ~30-service weight.

### 3.2 The two databases
- **Internal DB (always Postgres):** operational state only — users, audit log, queue/outbox, pipeline state, config, in-flight payloads. OpenLDR's own operation depends on this.
- **External / analytics DB (client-chosen; Postgres default, MSSQL/Oracle later):** the **system of record for domain/analytics data** — lab requests, results, isolates, patients, facilities. Reporting reads from here. It receives **flattened, tabular** projections (never raw `jsonb`), so it stays portable across engines. It is a *sink* from the pipeline's perspective (graceful failure on write) but a *source of truth* for the reporting layer (read).

> **Why flattened, not jsonb:** SQL Server only gained a native JSON type in SQL Server 2025 (GA Nov 2025, several features still in preview); Oracle differs again. By projecting FHIR into plain relational tables on the way out, the warehouse never needs document-DB features and the per-engine type-mapping problem shrinks to one outbound writer adapter.

### 3.3 The four ports (Phase 1)
| Port | Default adapter | Future adapters (later phases) |
|------|-----------------|-------------------------------|
| **Auth** (OIDC) | Keycloak | Any OIDC provider |
| **Blob storage** (S3 API) | MinIO | Any S3-compatible; local FS for dev/edge |
| **Eventing / orchestration** | Postgres outbox + `pg_notify` + worker pool | Kafka, Inngest |
| **Target data store** | Postgres | MSSQL, Oracle, other |

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

### 3.5 Plugin runtime
Plugins are **sandboxed, any-language format adapters** built on **Extism/WASM**. A plugin's job: take an arbitrary input format (e.g. WHONET SQLite), read it, validate it, and convert it to FHIR R4 — without rebuilding OpenLDR. Plugins are fetched from blob storage at runtime and executed in the WASM sandbox with a defined host-function interface. The plugin SDK is permissively licensed so third parties may ship proprietary plugins (see §10).

### 3.6 Reporting layer
Domain reporting/dashboards (Metabase-style) read the external DB. Because that DB may be any engine, **all reporting goes through the multi-driver query abstraction (Kysely)**. Hand-written raw SQL is a documented exception, never the norm — raw SQL is the lock-in risk.

---

## 4. Technology Stack (locked for Phase 1)

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript end-to-end | |
| Monorepo | Turborepo | |
| Package manager | **pnpm** | Workspaces; pin the pnpm version (Corlix uses pnpm 11), commit the lockfile. Avoids npm supply-chain exposure. No npm/yarn |
| Backend framework | **Fastify** | Schema-based validation + serialization, encapsulated plugins, built-in pino logging |
| Query layer | **Kysely** | Built-in dialects: Postgres, MySQL, **MSSQL**, SQLite, PGlite. Pair with kysely migrations + kysely-codegen for types |
| Internal DB | PostgreSQL | |
| External DB | PostgreSQL (default); MSSQL/Oracle behind the port (later) | |
| Plugin runtime | **Extism / WASM** | Any-language sandboxed plugins |
| FHIR | Hand-rolled over the official FHIR **R4** schema | Follow Corlix's established approach (reimplement, do not copy — §10) |
| Frontend | React + Vite (SPA) + Tailwind + **shadcn/ui** | Web-first; desktop wrapper deferred. shadcn components are vendored into the repo (you own them), themed by Corlix `DESIGN.md` (see §5.11) |
| i18n | react-i18next | en / fr / pt |
| Auth | Keycloak behind OIDC port | |
| Blob storage | MinIO behind S3 port | |
| Logging | pino (structured) | |
| Reverse proxy / TLS | **nginx** | Single HTTPS port in production; TLS termination (Let's Encrypt/Certbot). Path-based routing for SPA + API + auth |
| E2E / UI verification | **Playwright** | Also the agent's self-verification surface |
| CLI | **OpenLDR CLI** | First-class; agent's self-troubleshooting surface |
| License | AGPL-3.0 core / permissive SDK (pending sign-off) | |

---

## 5. Phase 1 Functional Requirements

### 5.1 Core skeleton & ports
- **P1-CORE-1** Bootstrap the Turborepo modular monolith with module boundaries: `core`, `fhir`, `forms`, `ingest`, `plugins`, `reporting`, `audit`, `users`, `cli`, `web`.
- **P1-CORE-2** Define the four ports (auth, storage, eventing, target-store) as interfaces with their Phase 1 default adapters. No core module may import a concrete adapter directly.
- **P1-CORE-3** Config system that selects adapters per deployment (env/config-driven), with a healthcheck per adapter.

### 5.2 FHIR R4 data layer
- **P1-FHIR-1** Hand-rolled FHIR R4 resource handling (model, validation, storage) built on the downloaded R4 schema, following the Corlix approach (reimplemented).
- **P1-FHIR-2** Canonical internal representation of domain entities as FHIR R4 resources (Patient, Specimen/Isolate, ServiceRequest/DiagnosticReport/Observation, Organization/Location for facilities).
- **P1-FHIR-3** A flattening layer that projects FHIR resources into relational analytics tables for the external DB.

### 5.3 Forms-from-templates engine
- **P1-FORM-1** FHIR Questionnaire / QuestionnaireResponse / SDC-based form engine (reimplement the Corlix design).
- **P1-FORM-2** Facilities, Patients, Orders (requests), and Users capture screens are all driven by form templates, not hand-built forms.
- **P1-FORM-3** Group types and repetition handling supported in the form builder/runtime.

### 5.4 Ingest pipeline
- **P1-INGEST-1** Accept an inbound payload of arbitrary format; store the raw payload in blob storage; record provenance (source system/identifier, ingest timestamp, batch id).
- **P1-INGEST-2** Emit an ingest event via the eventing port; worker consumes it.
- **P1-INGEST-3** Resolve and execute the appropriate plugin in the WASM sandbox: read → validate → convert to FHIR R4.
- **P1-INGEST-4** Stamp provenance (plugin id + version, batch id) on every produced record.
- **P1-INGEST-5** Persist canonical FHIR internally + flattened projection to the external DB.
- **P1-INGEST-6** On any stage failure: mark, queue/retry with backoff, log structured error; never fail the whole app. External-DB unreachability degrades only the persist stage.

### 5.5 Plugin runtime & SDK
- **P1-PLUG-1** Extism/WASM runtime with a defined host-function interface (read input, emit FHIR, log, report progress/errors).
- **P1-PLUG-2** Plugins fetched from blob storage by id + version; provenance ties output to the exact plugin version.
- **P1-PLUG-3** Permissively licensed plugin SDK (separate package) for authoring plugins in any WASM-targeting language.
- **P1-PLUG-4** **Reference plugin: WHONET SQLite reader** — proves the model end to end (read WHONET SQLite → validate → FHIR R4 AMR data).

### 5.6 Domain reporting & dashboard
- **P1-REP-1** Multi-driver reporting layer (via Kysely) reading the external DB; works against Postgres in Phase 1, written so MSSQL/Oracle slot in unchanged.
- **P1-REP-2** Metabase-style dashboard surface (reimplement the Corlix design) over the flattened analytics tables.
- **P1-REP-3** All reports use the query abstraction; any raw SQL must be flagged and isolated.

### 5.7 Audit log
- **P1-AUD-1** Append-only audit log (internal DB) capturing actor, action, entity, before/after where relevant, timestamp.
- **P1-AUD-2** Audit entries integrate with provenance so ingestion events are accountable alongside user actions.

### 5.8 Users (decoupled)
- **P1-USER-1** User management that complements Keycloak but is decoupled from it (reimplement the Corlix approach), so identity providers can be swapped behind the OIDC port.

### 5.9 OpenLDR CLI (agent-operable)
- **P1-CLI-1** First-class CLI exposing every subsystem. Minimum commands:
  - `db migrate | seed | reset` (internal + external)
  - `plugin install | list | run <file> | test`
  - `ingest <file> [--plugin <id>]`
  - `pipeline status | retry <id> | logs [--stage]`
  - `queue status`
  - `fhir validate <resource|form>`
  - `health` (per-adapter: auth, storage, eventing, target-store)
  - `provenance audit` (report records missing source/plugin/batch metadata)
  - `export` (data portability — full dataset out in open formats)
- **P1-CLI-2** Commands emit structured, machine-readable output (a `--json` flag) so an agent can parse, diagnose, and iterate autonomously.

### 5.10 Observability
- **P1-OBS-1** Structured pino logging across all stages, with the batch/job id as a correlation key end to end.

### 5.11 Frontend / UI shell
- **P1-UI-1** SPA shell (React + Vite): routing, layout, navigation. All domain surfaces live here — forms-driven entity screens (§5.3), dashboard/reports (§5.6), users (§5.8), audit (§5.7).
- **P1-UI-2** Component layer: **shadcn/ui** (Radix + Tailwind) as the single primitive set. Components are vendored in via the shadcn CLI and configured through `components.json` — no second component library.
- **P1-UI-3** Theming: Corlix `DESIGN.md` is the **single source of truth** for design tokens, color themes, typography, spacing, and light/dark modes. Wire those tokens into shadcn's CSS variables and the Tailwind theme config. (`DESIGN.md` is brought over intentionally by the author as the canonical theme spec — see §10.)
- **P1-UI-4** i18n: every UI string via react-i18next (en/fr/pt); no hard-coded copy.
- **P1-UI-5** Single-origin routing: the SPA, API, and auth callbacks are all served/routed under one origin so the whole app is reachable through one HTTPS port behind the reverse proxy (P1-NFR-7). Use **relative API paths**; never hard-code host:port anywhere in the frontend.
- **P1-UI-6** Playwright-verifiable: key screens expose stable selectors / `data-testid`s so the agent can navigate and self-verify the UI (P1-NFR-5).

---

## 6. Non-Functional Requirements

- **P1-NFR-1 Data portability:** `export` produces a client's complete dataset in open formats (CSV/JSON/FHIR Bundle) without maintainer involvement. (DP-2)
- **P1-NFR-2 Security:** plugin sandbox isolation enforced; secrets never logged; least-privilege adapter credentials.
- **P1-NFR-3 Resource footprint:** materially lighter than v2 at idle and under load. No Kafka/OpenSearch in the default deployment.
- **P1-NFR-4 i18n:** all user-facing strings via react-i18next (en/fr/pt).
- **P1-NFR-5 Testing:** unit tests for core logic; **Playwright** E2E covering the spine flows; Playwright usable headlessly by an agent for visual/console-error self-verification.
- **P1-NFR-6 Provenance completeness:** `provenance audit` returns zero gaps on the reference flow.
- **P1-NFR-7 Single-port deployment:** the entire app is reachable through **one HTTPS port** via an nginx reverse proxy that terminates TLS (Let's Encrypt/Certbot). Production environments typically allocate only 1–2 ports. Path-based routing must cover SPA, API, auth callbacks, and any WebSocket/SSE. No component may assume its own externally-exposed port; everything is proxy-relative.

---

## 7. Explicitly Out of Scope for Phase 1 (deferred)

Designed for, but not built now — interfaces/ports must leave clean seams:
- Plugin/forms/reports **marketplace**
- **DHIS2** integration (mapping-driven; aggregate + tracker)
- Additional **external-DB adapters** (MSSQL, Oracle) beyond the interface + Postgres impl
- Terminology page (FHIR CodeSystem/ValueSet, LOINC-anchored) UI polish
- In-app documentation with screenshots
- **Kafka / Inngest** eventing adapters
- Desktop wrapper (Electron/Tauri)
- AI / experimental services
- FHIR R5 / other versions

---

## 8. Suggested Build Sequence (for Claude Code)

1. Repo + modular-monolith skeleton + the four ports with default adapters + `health` (P1-CORE, P1-CLI-1 health)
2. FHIR R4 data layer + flattening (P1-FHIR)
3. Forms-from-templates engine → entity capture (P1-FORM)
4. Eventing (Postgres outbox + pg_notify) + ingest pipeline skeleton with provenance + graceful failure (P1-INGEST, P1-OBS)
5. Plugin runtime + SDK + WHONET SQLite reference plugin (P1-PLUG) — proves the pipeline end to end
6. Multi-driver reporting + dashboard (P1-REP)
7. Audit log + decoupled users (P1-AUD, P1-USER)
8. CLI completeness + `--json` + `export` + `provenance audit` (P1-CLI, P1-NFR-1)
9. Playwright E2E + agent visual-verification harness (P1-NFR-5)

---

## 9. Open Decisions (resolve before/early in build)

- AGPL-3.0 sign-off from company/legal; final license headers.
- Keep the "Community Edition" name, or ship as `openldr` until a second edition exists.
- Oracle dialect approach for the target-store port (community Kysely dialect vs custom) — Phase 2.
- Confirm the exact FHIR resource mapping for "isolate" (Specimen vs a profiled resource) for AMR data.

---

## 10. IP Boundary (read before writing any code)

OpenLDR CE is **company-owned and AGPL-licensed**. Corlix is a **separate, personally-owned project**. CE reimplements Corlix's proven *designs and architecture* (the FHIR-over-schema approach, FHIR Questionnaire forms, the terminology model, the decoupled-users pattern, the dashboard UX). **CE must not copy Corlix source code.** Ideas and architecture are the shared blueprint; source is not. If a Claude Code session is given access to both repositories for reference, it must treat Corlix strictly as a read-only design reference and write original implementations in the CE repo.

> **Handoff note:** Where this PRD says "follow the Corlix approach," ensure the Claude Code session can see the Corlix source as reference (open the session at a parent directory containing both repos), while honoring §10 — reimplement, never copy.

---

## 11. Repository & Workflow Conventions

- **P1-CONV-1 Package manager:** pnpm only, with workspaces. Pin the pnpm version and commit the lockfile. Do not use npm or yarn.
- **P1-CONV-2 Commit attribution:** commits and pushes must **not** add Claude as a contributor or co-author. Disable `Co-authored-by` trailers (Claude Code attribution setting off). Authorship belongs to the human maintainer.
- **P1-CONV-3 License headers:** AGPL-3.0 headers once company/legal sign-off lands (§9); permissive headers on the plugin SDK package.
- **P1-CONV-4 Scoped commits:** small, reviewable commits aligned to the P1 requirement IDs where practical.
- **P1-CONV-5 Proxy-relative everything:** no hard-coded hosts or ports in app code; all routing assumes a single origin behind the reverse proxy (P1-NFR-7, P1-UI-5).
