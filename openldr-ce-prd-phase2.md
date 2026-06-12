# OpenLDR Community Edition — Product Requirements Document
## Phase 2: Country-Deployable AMR Surveillance

**Status:** Draft (Phase 1 in build)
**Audience:** Claude Code (autonomous implementation) + maintainers
**Builds on:** Phase 1 spine. All Phase 1 principles (DP-1…DP-7), stack, and the four ports carry forward unchanged.

---

## 1. Overview & Theme

Phase 2 takes the Phase 1 spine and makes OpenLDR CE **deployable for a real national AMR surveillance program**: data lands in the client's chosen warehouse, concepts are coded and validated, surveillance data flows to DHIS2 on the Ministry's terms, GLASS-aligned outputs are produced, and ingestion broadens beyond the single reference plugin.

Nothing in Phase 2 introduces new default infrastructure. Every feature uses the Phase 1 ports and abstractions. Where a feature reaches outward (DHIS2, an external warehouse), it does so behind an interface, logs it, and degrades gracefully (DP-1, DP-7).

### Shippable outcome
At the end of Phase 2, a Ministry of Health can stand up OpenLDR CE behind a single HTTPS port, ingest WHONET / HL7 / CSV lab data, store it in Postgres or SQL Server, validate it against LOINC and AMR terminology, push aggregate and/or tracker data to their DHIS2 instance per their own mapping, and produce GLASS-aligned AMR surveillance reports.

---

## 2. Functional Requirements

### 2.1 SQL Server target-store adapter (P2-DB)
- **P2-DB-1** Implement the Phase 1 target-store port for **SQL Server** via Kysely's MSSQL dialect.
- **P2-DB-2** The FHIR → flattened-tabular projection emits MSSQL-compatible schema and types and bulk-loads via SQL Server's bulk-copy path; batched and idempotent. No `jsonb`/document features required (data is flattened — see Phase 1 §3.2).
- **P2-DB-3** The multi-driver reporting layer (P1-REP) is verified against SQL Server with no raw-SQL regressions; any raw SQL is flagged and given per-dialect variants.
- **P2-DB-4** External-schema DDL/migration management works across Postgres and SQL Server.
- **P2-DB-5** Oracle: interface remains ready; implementation deferred (Phase 3 or on client demand).

### 2.2 Terminology service & management (P2-TERM)
- **P2-TERM-1** Storage and management of FHIR `CodeSystem`, `ValueSet`, and `ConceptMap` resources.
- **P2-TERM-2** Core terminology operations: `$lookup`, `$validate-code`, `$expand`, `$translate`.
- **P2-TERM-3** LOINC loader (accept LOINC license terms on import) — anchors the LOINC test engine.
- **P2-TERM-4** AMR reference terminology: organism and antibiotic code systems / ValueSets, WHONET/EUCAST/CLSI-aligned (reuse the maintainer's existing AMR reference work as a design reference, not copied — §IP).
- **P2-TERM-5** Custom ValueSet authoring + the **Terminology management UI** (the page that supersedes v2's concept pages).
- **P2-TERM-6** Binding: forms (Questionnaire) and DHIS2 mappings reference terminology; coded results are validated against bound ValueSets at ingest.

### 2.3 DHIS2 integration (P2-DHIS2)
- **P2-DHIS2-1** A DHIS2 connector behind an **external-reporting-target port** (so GLASS and future targets reuse the pattern). Instance URL + credentials handled as managed secrets.
- **P2-DHIS2-2** **Mapping engine** — declarative, data-driven mappings (no code) from FHIR resources / flattened fields to DHIS2 payloads:
  - *Aggregate:* `dataElement` + `categoryOptionCombo` + `orgUnit` + `period` (dataValueSets).
  - *Tracker:* `program` + `programStage` + data elements + tracked entity (events).
- **P2-DHIS2-3** Facility ↔ DHIS2 `orgUnit` mapping table + UI.
- **P2-DHIS2-4** Both modes supported and selectable per mapping, driven by whatever the MoH specifies (aggregate, tracker, or both).
- **P2-DHIS2-5** Sync model: scheduled push aligned to reporting periods (aggregate) + optional event-driven push (tracker), via the eventing port. **Dry-run** mode that previews the payload without sending.
- **P2-DHIS2-6** Push auditing: every push records target, payload reference, period, record counts, DHIS2 import summary, and status; retried on failure; never blocks the app (DP-7). Pushes appear in the audit log (DP-3).
- **P2-DHIS2-7** Mapping authoring UI: create/edit/validate mappings against a pulled copy of the target DHIS2 metadata.
- **P2-DHIS2-8** Default mechanism is the DHIS2 Web API; the port permits a FHIR-based implementation where a Ministry provides a DHIS2 FHIR pathway.

### 2.4 Domain report pack — AMR / GLASS (P2-REP)
- **P2-REP-1** A pack of AMR surveillance reports aligned to **WHO GLASS**, built entirely on the Phase 1 multi-driver reporting layer (no raw SQL; works on Postgres and SQL Server).
- **P2-REP-2** Antibiogram and resistance summaries with correct denominators, deduplication, and first-isolate logic (the maintainer's AMR domain rules).
- **P2-REP-3** GLASS-aligned output/export where applicable (see Open Decisions on full submission format).
- **P2-REP-4** Report output (PDF/exports) generated through the reporting layer, consistent with the dashboard.

### 2.5 Additional ingestion plugins (P2-PLUG)
- **P2-PLUG-1** **HL7 v2** ingestion plugin (lab result messages, e.g. ORU) → FHIR R4.
- **P2-PLUG-2** **CSV / Excel** ingestion plugin with configurable column-to-field mapping → FHIR R4.
- **P2-PLUG-3** Both built on the Phase 1 Extism/WASM SDK; together with WHONET SQLite they prove multi-format ingestion and exercise the plugin contract.

### 2.6 In-app documentation (P2-DOC)
- **P2-DOC-1** In-app documentation system: markdown/MDX rendered in the SPA, searchable, i18n (en/fr/pt), versioned with the product.
- **P2-DOC-2** Screenshots maintained alongside docs and optionally regenerated via Playwright (agent-operability tie-in, DP-4).
- **P2-DOC-3** Setup guides including DHIS2 connection/mapping and external-DB configuration (mirror the Corlix docs approach — reimplement, don't copy).

### 2.7 Hardening & load (P2-HARD)
- **P2-HARD-1** Plugin sandbox security review: resource limits, least-privilege host functions, untrusted-input fuzzing.
- **P2-HARD-2** Warehouse performance/load testing at realistic ingest volumes; tune flattening and bulk load on both Postgres and SQL Server.
- **P2-HARD-3** Security pass on external-target credentials (DHIS2, external DB) and secret handling.

---

## 3. CLI Additions (agent-operable, all support `--json`)

- `dhis2 map | validate | push [--dry-run] | status`
- `terminology import <loinc|amr|valueset> | lookup | validate-code | expand`
- `target-store test --engine <postgres|mssql>`
- `report run <id> [--format pdf]`
- `docs build`

---

## 4. Non-Functional Requirements

- **P2-NFR-1 Portability extends to metadata:** `export` now also emits ValueSets, ConceptMaps, and DHIS2/orgUnit mappings in open formats (DP-2).
- **P2-NFR-2 Idempotent, auditable pushes:** DHIS2 pushes are idempotent and fully auditable; re-running a period does not double-count.
- **P2-NFR-3 Multi-driver verified:** reporting and warehouse writes pass on both Postgres and SQL Server.
- **P2-NFR-4 i18n:** all new UI strings via react-i18next (en/fr/pt).
- **P2-NFR-5 Playwright coverage:** new surfaces (terminology UI, DHIS2 mapping UI, reports, docs) carry stable selectors and E2E coverage.

---

## 5. Deferred to Phase 3

- **Marketplace** (forms/reports/plugins): registry, publish/install, signing, permissions, local-first with optional federation.
- **Kafka / Inngest** eventing adapters (on-demand, behind the existing port).
- **Oracle** target-store adapter (unless a client needs it sooner).
- **Desktop wrapper** (Electron/Tauri).
- **AI / experimental** services.
- **FHIR R5** and additional versions (schema-driven layer already accommodates; not built).

---

## 6. Open Decisions

- **Marketplace timing:** Phase 3 by default. Pull into Phase 2 if extensibility is prioritized over surveillance-completeness?
- **SNOMED in scope?** LOINC + AMR reference is in. SNOMED adds licensing/per-country constraints — include behind a flag, or leave out for now?
- **DHIS2 mechanism:** confirm native Web API as default (vs FHIR adapter) — depends on the target Ministries' DHIS2 instances.
- **GLASS:** full GLASS submission-format export in Phase 2, or GLASS-aligned reports only with export deferred?
- **HL7 v2 scope:** which message types first (assumed: ORU result messages)?
- **Oracle:** keep deferred to Phase 3, or pull forward for a specific client?

---

## 7. Suggested Build Sequence

1. **SQL Server adapter** + reporting verification (P2-DB) — unblocks real client deployments.
2. **Terminology service** + LOINC/AMR load + management UI (P2-TERM) — foundational for forms, DHIS2 mappings, and reports.
3. **DHIS2** mapping engine + orgUnit mapping + push + audit + dry-run (P2-DHIS2).
4. **AMR/GLASS report pack** (P2-REP).
5. **HL7 v2 + CSV/Excel plugins** (P2-PLUG).
6. **In-app documentation** (P2-DOC).
7. **Hardening, load, security pass** (P2-HARD).

---

## 8. Phase 1 Preconditions

Phase 2 assumes these Phase 1 deliverables are stable: the four ports with default adapters; the FHIR R4 data layer + flattening; the forms-from-templates engine; the multi-driver reporting abstraction; the Extism/WASM plugin runtime + SDK; the CLI + Playwright harness; and the provenance/audit foundation.

---

## IP Boundary (carries over from Phase 1 §10)

OpenLDR CE is company-owned and AGPL-licensed; Corlix and the maintainer's prior AMR reference work are separate, personally-owned references. Phase 2 reimplements proven *designs* (terminology model, AMR reference structures, DHIS2 setup approach, docs UX). **It does not copy source.** Where this PRD says "follow the Corlix/prior approach," treat that source strictly as a read-only design reference and write original implementations in the CE repo.
