# Fresh-install defaults / first-run experience — Design

**Date:** 2026-07-01
**Status:** Approved (investigated + decisions made)
**Origin:** Fresh-install test cycle (development.ps1 from GitHub) surfaced 7 first-run gaps.

## Context

A from-scratch install (clone → install → services → `db reset`) leaves the app
technically running but with a broken/empty first-run experience. Seven issues
were reported and investigated (findings below). Decisions taken:

- **Terminology:** bundle only the license-safe HL7 FHIR **R4 base ValueSet
  catalog** (~1 MB), auto-import on first boot. LOINC / SNOMED CT / RxNorm remain
  user-provided via the existing license-gated `openldr terminology import` CLI.
- **Dashboard SQL:** `DASHBOARD_SQL_ENABLED=false` gates **authoring** SQL only;
  SQL already persisted on a dashboard still executes (runner is read-only,
  row-capped, timeout-bounded). Plus fix the create-500 bug.
- **Fresh-install seed:** **full starter set** — required published forms, a
  default target-DB connector, the default marketplace registry, and sample
  org/patient/workflow demo data. Everything removable.

## Items, findings, and design

### 1. Dashboard — 500 on create + SQL blanks the board

**Findings.** `create failed: 500` is a StrictMode double-seed race: both effect
invocations `INSERT id:'default'`; the loser hits a primary-key violation, which
`mapError` falls through to 500 (audit shows one create still succeeds).
`DASHBOARD_SQL_ENABLED` gates **execution** at the runner
(`packages/bootstrap/src/index.ts:262`), and all 13 sample widgets are `mode:'sql'`,
so the board fully blanks.

**Design.**
- Make dashboard create idempotent: `store.create` uses `ON CONFLICT (id) DO
  NOTHING` and returns the existing row; map unique-violation → 409 in `mapError`
  (`apps/server/src/dashboards-routes.ts`). Covers multi-tab/retry races too.
- Split the SQL gate: `DASHBOARD_SQL_ENABLED` governs **authoring** (create/update
  routes + the editor SQL tab). Executing SQL that is already persisted on a
  dashboard is allowed when the target store is Postgres, regardless of the flag.
  Enforce authoring-gate in `dashboards-routes` create/update; relax the runtime
  execution gate for stored-widget queries. The sample dashboard renders; the
  flag still prevents untrusted users from authoring arbitrary SQL.

### 2. Forms — required published forms missing

**Findings.** `seedDatabase()` (`packages/bootstrap/src/seed.ts`) already creates
and publishes the canonical `usersForm` (targetPage `users`); it just doesn't run
on fresh installs (`SEED_ON_START=false`, `openldr db seed` is manual). Only the
`users` page currently hard-requires a form.

**Design.** Run the seed on fresh install (see item 8 seed wiring). The required
page-bound forms are published as part of the full starter set.

### 3. Terminology — FHIR seed for Forms

**Findings.** Migrations already seed publishers + 6 local ValueSets + UCUM +
ICD-10 (enough for basic coded fields). LOINC/SNOMED/RxNorm live in the sibling
`corlix/fixtures`, are license-restricted, and are not bundled. The HL7 FHIR R4
base ValueSet catalog (`R4.valuesets.json.gz`, ~958 KB) is freely redistributable
and imports via the existing `importFhirCatalog` path
(`packages/db/src/fhir-value-set.ts:140`).

**Design.** Bundle `R4.valuesets.json.gz` into the repo (e.g.
`packages/db/fixtures/fhir/R4.valuesets.json.gz`) and auto-import it on first boot
(idempotent; only when the FHIR catalog hasn't been imported). LOINC/SNOMED/RxNorm
stay behind the license-gated CLI — documented, never bundled.

**UCUM (decided: bundle the FULL set this batch).** UCUM is freely
redistributable. Today only a ~26-unit starter set ships (migration
`017_reference_terminology_seeds.ts`, CodeSystem `cs-ucum-seed`); there is no
full UCUM source or importer in-repo. This unit sources the official
`ucum-essence` distribution, converts it to a bundled FHIR CodeSystem JSON
(gzipped fixture alongside R4), and auto-imports it on first boot via the generic
CodeSystem import path (`openldr terminology import resource` /
`importTerminologyResource`). Idempotent; supersedes/extends the starter units.

### 4. Audit — JSON in CodeMirror

**Findings.** The audit detail panel renders before/after JSON as plain `<pre>`.
The codebase already uses CodeMirror (json mode) + theme wiring elsewhere.

**Design.** Replace the audit before/after `<pre>` blocks with a read-only
CodeMirror JSON view (json language, one-dark/light following the app theme).

### 5. Default connector

**Findings.** A `type:'postgres'`, `kind:'database'` host connector pointing at
`TARGET_DATABASE_URL` is what workflows need. Creation requires
`SECRETS_ENCRYPTION_KEY` (AES-256-GCM), which is commented out in `.env.example`;
`connectors.create` throws if it's unset.

**Design.** Seed one default connector ("Target Warehouse (Postgres)") in
`seedDatabase`, decomposing `TARGET_DATABASE_URL` into host/port/user/password/
database fields; idempotent by name; **skip with a clear log if
`SECRETS_ENCRYPTION_KEY` is unset**. Generate `SECRETS_ENCRYPTION_KEY` in all
`.env`-generation paths (item 7).

### 6. Marketplace — default registry

**Findings.** No default registry is seeded unless `MARKETPLACE_REGISTRY_URL` or
`MARKETPLACE_REGISTRY_DIR` is set; bootstrap seeds one http registry from the URL
when the table is empty (`packages/bootstrap/src/index.ts:195`). Dev `.env`
currently points at the **local** sibling dir. The remote
`https://raw.githubusercontent.com/fmwasekaga/openldr-ce-marketplace/main` is
public and serves a valid index (`whonet-sqlite@1.1.0`, verified HTTP 200).

**Design.** Default `MARKETPLACE_REGISTRY_URL` to the raw-GitHub URL in the config
schema; uncomment it in `.env(.prod).example`; flip the dev-generated `.env` off
the local dir to the remote URL. The seeded registry is an ordinary removable row.

### 7. Cross-cutting — `SECRETS_ENCRYPTION_KEY` + workflows Plugins category

- **`SECRETS_ENCRYPTION_KEY`:** generate it (base64, 32 bytes) in
  `install/install.sh`, `install/install.ps1`, `install/development.sh`,
  `install/development.ps1`, and document it in `.env(.prod).example`. Needed for
  connectors, DHIS2, and `resolveSecret`.
- **Workflows Plugins category** (`sidebar.tsx:158`): intentional — only shows
  with ≥1 plugin. Leave as-is (optionally a subtle "no plugins installed" hint;
  low priority, deferred).

### 8. Seed wiring (ties 2/5/6 together)

`seedDatabase()` becomes the single idempotent "full starter set":
required published forms (existing), default target-DB connector (item 5),
sample org/patient/workflow demo data (existing). Registry is seeded by the
existing bootstrap env path (item 6). Fresh installs run it: the dev bootstrap
(`development.sh/.ps1`) runs `openldr db seed` after `db reset`, and generated
dev `.env` sets `SEED_ON_START=true`.

## Non-goals

- Bundling or auto-downloading LOINC/SNOMED/RxNorm (license-restricted).
- Shipping `patients`/`orders`/`facilities` forms/pages (those pages aren't built).
- A workflows "no plugins" empty-state hint (deferred).

## Verification

Re-run the fresh-install cycle (nuke containers+volumes → clone → bootstrap) and
confirm: dashboard renders with no 500, Users edit panel finds its form,
Forms can bind FHIR R4 coded fields, Audit JSON is syntax-highlighted, a default
target-DB connector + default marketplace registry are present, and demo data is
visible.
