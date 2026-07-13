# FHIR Storage Restructure — R3e: Drop Thin + Rename v2→Canonical

**Date:** 2026-07-13
**Slice:** R3e (restructure) — the final sub-slice of the full drop-thin cutover
**Branch:** `feat/fhir-drop-thin`
**Predecessors:** R0/R1/R2/R3a/R3b/R3c/R3d DONE + merged + pushed (`origin/main` `4122a90e`)
**Successor:** none — this completes the storage restructure's read-model migration.

## Context

The FHIR storage restructure moved CE to an async-projection CQRS model: internal versioned
canonical `fhir` schema → append-only `change_log` → projection worker → external read model. The
external read model was migrated table-by-table from the legacy **thin** flat schema
(`observations`/`specimens`/`patients`/`service_requests`/`diagnostic_reports`/`organizations`/`locations`)
to the **v2** relational schema (`v2_patients`/`v2_lab_requests`/`v2_lab_results`/`v2_facilities`/
`v2_specimens`/`v2_diagnostic_reports`). All 9 built-in reports now read v2 (R3b: demographics;
R3c: 3 non-AMR; R3d: 5 AMR).

R3e is the last sub-slice: **remove the thin schema entirely and rename the `v2_*` tables to their
canonical names**, ending at a clean, analyst-facing external warehouse with no `v2_` prefix and no
dead thin write path.

## Goal

1. Remove the thin schema: its write path (the `flatWriter` projection sink), its tables, its types,
   and every remaining reader.
2. Rename the six `v2_*` read-model tables to canonical names.
3. Prove no report or dashboard output changed, via a golden-output snapshot (the thin-vs-v2
   acceptance harnesses that proved earlier cutovers are retired here, since after the drop there is
   no thin oracle left).

PG-first, matching prior slices: Postgres is proven by the golden harness on real PG; the MSSQL/MySQL
acceptance scripts are rewritten to compile and be logically correct against the new schema, but
their live runs remain deferred (per the established PG-first convention).

## Scope decisions (resolved in brainstorming)

- **One slice, drop-then-rename.** Everything lands in R3e (chosen over splitting into drop-now /
  rename-later). Internally the work is sequenced drop-first — the reports keep reading `v2_` (their
  R3b/c/d-proven SQL, unchanged) until the mechanical `v2_`→canonical identifier swap — so the risky
  write-path removal happens with the reports untouched. The rename cannot precede the drop
  (`v2_specimens`→`specimens` collides with the thin `specimens` table until thin is gone).
- **Golden-snapshot proof.** Dropping thin removes the oracle the cutover-accept harnesses used, so
  R3e introduces a golden-output snapshot: capture the 9 reports' output (current `v2_` SQL) and the
  sample dashboard's widget outputs (current thin SQL) over the shared fixture into a committed
  golden file, then assert the post-R3e canonical reports + dashboard reproduce it byte-for-byte.
- **Upgrade re-seed deferred.** Reports and the sample dashboard are seeded idempotent-by-name
  (skip-if-exists), so an existing install that upgrades keeps DB rows whose SQL reads now-dropped
  tables. Consistent with R3b/R3c/R3d, the forced upgrade re-seed is deferred and documented; fresh
  installs get canonical SQL and work.
- **MSSQL/MySQL harnesses rewritten, not run.** `mssql/mysql-live-acceptance.ts` +
  `mssql/mysql-reports-parity.ts` are updated to compile and be correct against the new schema
  (relational writer + canonical tables), but their live runs stay deferred (PG-first).

## Canonical rename map

| v2 table | canonical name |
| --- | --- |
| `v2_patients` | `patients` |
| `v2_lab_requests` | `lab_requests` |
| `v2_lab_results` | `lab_results` |
| `v2_facilities` | `facilities` |
| `v2_specimens` | `specimens` |
| `v2_diagnostic_reports` | `diagnostic_reports` |

The canonical names reuse four names freed by dropping the thin tables (`patients`, `specimens`,
`diagnostic_reports`, plus `facilities` which is new). Interface renames in `schema/external.ts`
follow suit: the thin `PatientsTable`/`SpecimensTable`/`DiagnosticReportsTable`/`ObservationsTable`/
`ServiceRequestsTable`/`OrganizationsTable`/`LocationsTable` are deleted, and `V2PatientsTable`→
`PatientsTable`, `V2LabRequestsTable`→`LabRequestsTable`, `V2LabResultsTable`→`LabResultsTable`,
`V2FacilitiesTable`→`FacilitiesTable`, `V2SpecimensTable`→`SpecimensTable`,
`V2DiagnosticReportsTable`→`DiagnosticReportsTable`.

## Design

### Phase 1 — Golden-snapshot capture (safety net, done first)

A capture step records the current (pre-R3e) output of every report and dashboard widget over the
shared FHIR fixture, so the post-R3e canonical versions can be proven identical.

- Reuse `scripts/lib/reports-parity-fixture.ts`'s fixture (patients/specimens/observations/etc.).
- Seed it via `createRelationalWriter` (for the 9 reports, which already read `v2_`) and via
  `createFlatWriter` (for the sample dashboard, which still reads thin) on real Postgres.
- For each of the 9 `SEED_QUERIES` run the current `.sql.postgres` with a fixed param bag (the same
  bags the R3c/R3d accept harnesses used) and record the normalized rows.
- For each sample-dashboard widget in `openldr-general.json`, run its current thin SQL with the
  optional `[[ … ]]` clauses stripped and `{{param}}` tokens unbound (full-fixture, no-filter — the
  simplest deterministic execution path) and record the normalized rows.
- Write the captured rows to `scripts/lib/reports-golden.json` (committed).

This capture is a throwaway step run once against the pre-R3e state; the committed golden JSON is the
reference the post-R3e harness (Phase 6) asserts against.

### Phase 2 — Remove the thin write path

The projection worker writes both sinks in parallel; the relational (v2) writer is already a complete
peer, so removing the flat writer is subtractive.

- `packages/db/src/projection/cycle.ts`: drop `flatWriter` from `ProjectionDeps`; in
  `applyProjection` remove `deps.flatWriter.write(canonical)` and `deps.flatWriter.deleteById(...)`;
  in `reprojectAll` remove `deps.flatWriter.writeMany(...)` (and drop `flatWriter` from its `Pick`).
- `packages/bootstrap/src/db-context.ts`, `ingest-context.ts`, `index.ts`: remove every
  `createFlatWriter(...)` call and the `flatWriter`/`workflowFlatWriter` wiring passed into the
  projection runner and any context type.
- Delete `packages/db/src/flat-writer.ts`, `packages/db/src/flatten/` (index + per-resource
  flatteners), and their tests; remove `export * from './flatten/index'` and the flat-writer export
  from `packages/db/src/index.ts`.
- Grep the repo for remaining `FlatWriter` / `flattenResource` / `tableForResourceType` importers and
  update them (the projection cycle test, ingest-context, etc.).

### Phase 3 — Migration 007 (drop thin + rename v2)

New `packages/db/src/migrations/external/007_drop_thin_rename_v2.ts`, engine-aware, registered last in
`packages/db/src/migrations/external/index.ts`:

- **Drop** the 7 thin tables with `db.schema.dropTable(t).ifExists().execute()` for
  `patients`/`specimens`/`service_requests`/`diagnostic_reports`/`observations`/`organizations`/
  `locations`. (Drop before rename so `v2_specimens`→`specimens` etc. don't collide.)
- **Rename** each `v2_*` table to canonical, engine-branched:
  - Postgres / MySQL: `db.schema.alterTable('v2_x').renameTo('x').execute()` (both emit
    `ALTER TABLE … RENAME TO …`, which pg-mem also supports — verified by spike).
  - MSSQL: `sql\`EXEC sp_rename ${'v2_x'}, ${'x'}\`.execute(db)` (SQL Server has no
    `ALTER TABLE … RENAME TO`).
- `down()` renames canonical→`v2_*` back (engine-branched the same way). Recreating the dropped thin
  tables is out of scope for `down()` (documented) — the slice is one-directional and `down()` runs
  only on real PG, never under pg-mem tests.

pg-mem supports `ALTER TABLE … RENAME TO`, `DROP TABLE [IF EXISTS]`, and preserves row data across the
rename (spike-confirmed), so `makeMigratedExternalDb()` (which runs all migrations to latest) yields
the canonical schema in unit tests.

### Phase 4 — Rename everywhere (mechanical v2_→canonical)

- `packages/db/src/schema/external.ts`: delete the 7 thin interfaces; rename the 6 `V2*Table`
  interfaces per the map above; in `ExternalSchema` remove the 7 thin keys and rename the 6 `v2_`
  keys to canonical.
- `packages/db/src/relational/*.ts` + `relational/index.ts` + `relational-writer.ts`: change every
  `Insertable<V2*Table>` to the canonical interface and every `v2_*` table target in
  `v2TableForResourceType`/`projectResource` to canonical (rename the helper too if its name embeds
  `v2`).
- `packages/db/src/export-data.ts`: in `EXTERNAL_TABLE_COLUMNS` remove the 7 thin entries and rename
  the 6 `v2_` keys to canonical; in `exportFlatTables` replace the 7 thin `selectFrom(...)` reads
  with the 6 canonical tables (the export feature now exports the canonical read model).
- `packages/reporting/src/seed/report-seeds.ts`: swap all `v2_*` identifiers to canonical across all
  9 reports (all 3 engine variants; ~77 occurrences). Pure identifier rename — no logic change. Add a
  one-line R3e note to the file/report header comments in the established style.
- `packages/reporting/src/amr/query.ts` + `reports/amr-isolates.ts`: `v2_*`→canonical.
- Migration tests `003_v2_core.test.ts` / `004_v2_patients_facility.test.ts` /
  `005_v2_specimen_diagreport.test.ts` / `006`-related assertions and `relational.test.ts` /
  `relational-writer.test.ts` / `projection/cycle.test.ts`: update `v2_*` insert/select targets to
  canonical (since `makeMigratedExternalDb()` now runs through 007). `migrations.test.ts`: append
  `'007_drop_thin_rename_v2'` to the external key-list assertion.

### Phase 5 — Sample dashboard cutover

`packages/dashboards/src/samples/openldr-general.json` — the seeded default dashboard — has ~10
widgets whose SQL reads thin tables with thin columns. Rewrite each to the canonical read model,
preserving output:

- `service_requests` → `lab_requests`: `authored_on`→`authored_at`, `subject_ref`→`patient_id`,
  `code_text`→`panel_desc`, `status`/`priority` unchanged.
- `observations` → `lab_results`: `effective_date_time`→`result_timestamp`,
  `interpretation_code`→`abnormal_flag`, `code_text`→`observation_desc`, `value_*` as mapped in the
  v2 observation model.
- `specimens`/`diagnostic_reports` → canonical equivalents (column names per `schema/external.ts`).
- Preserve the Metabase-style `[[ optional ]]` filter clauses and `{{param}}` tokens, adjusting the
  filtered column names to canonical.

`facilityOptions` in `packages/reporting/src/helpers.ts` needs **no change**: it reads
`patients.managing_organization`, and after the rename `patients` is the canonical read-model table,
which carries `managing_organization`. It repoints transparently via the `ExternalSchema` type change.

### Phase 6 — Harness fate + the new golden proof

- **New `reports:accept`** (`scripts/reports-cutover-accept.ts` rewritten, or a new
  `scripts/reports-golden-accept.ts`): seed the fixture via `createRelationalWriter` into the
  canonical schema on real PG, run all 9 canonical reports + the canonical dashboard widgets over it,
  and assert each result equals `scripts/lib/reports-golden.json`. Exit non-zero on any diff.
- **Retire** `scripts/demographics-cutover-accept.ts` and the thin-vs-v2 body of
  `scripts/reports-cutover-accept.ts` (their thin oracle no longer exists). Remove their `package.json`
  script entries or repoint `reports:accept`/`demographics:accept` appropriately.
- `scripts/lib/reports-parity-fixture.ts`: drop the `createFlatWriter` seeding path (keep only
  `createRelationalWriter`); update the `TABLES` wipe-list from thin+`v2_` to the canonical tables.
- `scripts/mssql-live-acceptance.ts` + `scripts/mysql-live-acceptance.ts`: rewrite to exercise the
  relational writer into the canonical tables (was `createFlatWriter` into thin). Must compile and be
  logically correct; live runs deferred.
- `scripts/mssql-reports-parity.ts` + `scripts/mysql-reports-parity.ts`: update to canonical tables +
  relational-writer seeding (or align with the golden approach). Compile-correct; live runs deferred.
- `scripts/projection-live-acceptance.ts`: change its post-projection existence checks from thin
  (`selectFrom('patients')`/`selectFrom('observations')`) to canonical read-model tables
  (`patients`/`lab_results`).

### Phase 7 — Gate, verify, merge

- Cross-package gate `pnpm turbo run typecheck test --force` green for `@openldr/db`,
  `@openldr/reporting`, `@openldr/dashboards`, `@openldr/bootstrap` (and no NEW failures elsewhere;
  the known `@openldr/users` parallel-turbo flake and `@openldr/cli#build` Windows-native failure are
  ignored per convention).
- `pnpm reports:accept` green on real PG (dev Postgres `:5433`).
- `pnpm projection:accept` green on real PG (projection now writes only the canonical read model).
- Merge `--no-ff` to local `main`, push.

## Testing strategy

- **Unit (pg-mem / in-memory):** migration 007 test (thin dropped, canonical tables present + accept
  inserts); the updated 003–006 + relational + projection-cycle tests (canonical targets);
  `migrations.test.ts` (+007 key); `export-data.test.ts` (canonical key set). Run per-package:
  `pnpm --filter @openldr/db exec vitest run`, `pnpm --filter @openldr/reporting exec vitest run`,
  `pnpm --filter @openldr/dashboards exec vitest run`, `pnpm --filter @openldr/bootstrap exec vitest run`.
- **Type gate:** `tsc --noEmit` on `@openldr/db`, `@openldr/reporting`, `@openldr/dashboards`,
  `@openldr/bootstrap` — the schema-type rename + write-path removal must typecheck (a missed `v2_`
  reference or a lingering `FlatWriter` import fails here).
- **Behavior proof (real PG, load-bearing):** `pnpm reports:accept` — the 9 canonical reports + the
  canonical dashboard widgets equal the golden snapshot for every case; `pnpm projection:accept` —
  projection writes the canonical read model with no thin dependency.
- **Cross-package gate (per convention):** `pnpm turbo run typecheck test --force`, never piped
  through `tail`; verify suspicious failures by running the package's `vitest run` directly.

## Task breakdown (~10)

1. **Golden capture** — a capture script that records the 9 reports' + dashboard widgets' current
   output over the fixture into `scripts/lib/reports-golden.json` (committed). Run once vs. pre-R3e
   state on real PG.
2. **Remove thin write path** — delete `flat-writer.ts` + `flatten/`; unwire `flatWriter` from
   `projection/cycle.ts`, `bootstrap` contexts, and db index exports; fix importers + the
   projection-cycle test.
3. **Migration 007** — engine-aware drop-thin + rename-v2; register in index; `migrations.test.ts`
   key list; a 007 test (thin gone, canonical present).
4. **Schema types + export-data rename** — delete thin interfaces, rename `V2*Table`→canonical, fix
   `ExternalSchema`; `EXTERNAL_TABLE_COLUMNS` + `exportFlatTables` to canonical.
5. **Relational mappers/writer rename** — `Insertable<*Table>` + `v2TableForResourceType` targets to
   canonical; update `relational`/`relational-writer` tests.
6. **Seed SQL + AMR catalog rename** — `report-seeds.ts` (9 reports, 3 variants) + `amr/query.ts` +
   `amr-isolates.ts` `v2_`→canonical.
7. **Sample dashboard cutover** — rewrite `openldr-general.json` widgets thin→canonical columns.
8. **Migration/relational test rename** — 003–006 test targets to canonical; any remaining `v2_`
   test references.
9. **Harnesses** — new golden `reports:accept`; retire demographics/reports cutover-accept; fixture
   relational-only + canonical `TABLES`; rewrite mssql/mysql live-acceptance + reports-parity;
   update projection-live-acceptance. Run `pnpm reports:accept` + `pnpm projection:accept` green.
10. **Whole-slice review, gate, merge & push** — cross-package gate; spec-conformance + quality
    review; merge `--no-ff` to `main` + push; update memory (R3e DONE; storage restructure read-model
    migration complete).

## Constraints & conventions

- Next external migration index = **007** (final for this workstream's read-model migration).
- Drop-before-rename ordering within migration 007 (name-collision safety).
- `down()` is one-directional (rename-back only; no thin recreation) — dev-only, untested.
- PG-first: MSSQL/MySQL harnesses rewritten to compile + be correct; live runs deferred.
- Upgrade re-seed deferred (documented) — fresh installs get canonical SQL.
- No `Co-Authored-By: Claude`/`Codex` trailers on commits or PRs.
- Work merges to local `main` (`--no-ff`); push to origin when the slice is green.
