# Sub-project 2b — FHIR Storage + Flattening + Migrations

**Date:** 2026-06-12
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase1.md` — P1-FHIR-3 (flattening), the storage half of P1-FHIR-1, and the `db migrate|seed|reset` slice of P1-CLI-1/2
**Build-sequence step:** §8 step 2, second half (follows 2a model+validation)

---

## 1. Purpose & scope

Deliver the persistence layer for CE's FHIR-canonical model: a migration framework for **both** databases, an internal canonical FHIR store, the pure **flattening** projection, an external flat-table writer, the DP-7 `persistResource` spine primitive, and the `openldr db` CLI.

CE is FHIR-canonical (DP-6): ingested data becomes FHIR R4, is stored as the **canonical source of truth internally** (jsonb in internal Postgres + provenance), and is projected **outward** as flattened scalar tables in the external/target DB (P1-FHIR-3) that reporting reads. This sub-project builds those persistence primitives; the ingest pipeline (§8 step 4) orchestrates them with batch/provenance/retry.

**In scope (2b):**
- New `@openldr/db` package: migrations, internal store, flatten transforms, external writer, `persistResource`.
- Internal `fhir_resources` table + `FhirStore` (save/get canonical jsonb).
- Pure flatten transforms (FHIR resource → scalar row) for the seven domain resources; external flat tables.
- `FlatWriter` (upsert via `TargetStorePort`) + `persistResource` (DP-7 graceful degradation).
- Static, bundler-safe Kysely migrator (internal + external).
- `createDbContext` in `@openldr/bootstrap`; `openldr db migrate|reset|seed` CLI.

**Out of scope (deferred):**
- Ingest pipeline orchestration, batch ids, retry/queue (§8 step 4).
- Richer per-row child tables (e.g. an `identifiers` table); multi-identifier flattening picks a primary pair for now.
- MSSQL/Oracle external dialects (the external schema is scalar-only so it stays portable, but only the Postgres dialect is wired).
- kysely-codegen (DB interfaces are hand-written; codegen is an optional later dev convenience).
- REST FHIR endpoints, terminology, reporting queries.

---

## 2. Cross-cutting principles this sub-project demonstrates

- **DP-6 FHIR R4 native** — canonical FHIR stored internally; flat projection outward.
- **DP-3 Provenance** — `fhir_resources` and every flat table carry source/plugin/version/batch columns.
- **DP-7 Graceful degradation** — `persistResource` saves internally (must succeed) and treats the external write as best-effort; an unreachable external DB degrades only the persist stage, logged, no crash.
- **DP-1 Ports-and-adapters** — `@openldr/db` uses `TargetStorePort` for the external DB and never imports a concrete adapter; the composition root injects it.
- **DP-5 Lean** — hand-written DB types; static in-code migrations (no dynamic import).

---

## 3. Package `@openldr/db`

A supporting infrastructure package, consistent with `ports`/`config`/`bootstrap`/`adapter-*` already living outside the named domain-module list. Depends on `@openldr/fhir` (resource types + `validateResource`), `@openldr/ports` (`TargetStorePort`, `TargetSchema`), `@openldr/core` (logger, errors), `kysely`, `pg`. `@openldr/fhir` is unchanged and stays pure (zod only).

```
packages/db/src/
├─ schema/
│  ├─ internal.ts        # Kysely DB interface: { fhir_resources: FhirResourcesTable }
│  └─ external.ts        # Kysely DB interface: { patients, specimens, ... }
├─ migrations/
│  ├─ internal/001_fhir_resources.ts   # up(db)/down(db) via Kysely schema builder
│  ├─ internal/index.ts                 # internalMigrations: Record<string, Migration>
│  ├─ external/001_flat_tables.ts
│  └─ external/index.ts                  # externalMigrations: Record<string, Migration>
├─ migrator.ts          # createMigrator(db, migrations), migrateToLatest(), migrateDown()
├─ internal-db.ts       # createInternalDb(url) → { db: Kysely<InternalSchema>, close() }
├─ fhir-store.ts        # createFhirStore(db) → { save, get }
├─ flatten/
│  ├─ patient.ts … location.ts          # PURE flatten<Resource>(resource, prov) → row
│  ├─ index.ts                          # flattenResource(resource, prov) → { table, row } | null
├─ flat-writer.ts       # createFlatWriter(db) → { write }
├─ persist.ts           # persistResource(deps, resource, prov) → PersistResult
├─ provenance.ts        # Provenance type
└─ index.ts
```

dependency-cruiser: the existing `no-adapter-imports-outside-bootstrap` rule already forbids `@openldr/db` from importing any `adapter-*`. No rule change needed.

---

## 4. Provenance

```ts
// provenance.ts
export interface Provenance {
  sourceSystem?: string;
  pluginId?: string;
  pluginVersion?: string;
  batchId?: string;
}
```
All fields optional in 2b (ingest populates them in step 4). Carried into both `fhir_resources` and every flat row.

---

## 5. Internal canonical store

`createInternalDb(url)` builds a `Kysely<InternalSchema>` over a pg `Pool` on `INTERNAL_DATABASE_URL` (internal DB is always Postgres; not behind a port), exposing `{ db, close }`.

Migration `internal/001_fhir_resources` (Kysely schema builder):
```
fhir_resources(
  resource_type   text not null,
  id              text not null,
  version_id      text,
  resource        jsonb not null,
  source_system   text,
  plugin_id       text,
  plugin_version  text,
  batch_id        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (resource_type, id)
)
```

`createFhirStore(db)`:
- `save(resource, provenance?) → { resourceType, id }` — requires `resource.resourceType` and an `id` (generates one via `crypto.randomUUID()` if absent); upserts on conflict `(resource_type, id)` updating `resource`, `version_id`, provenance, `updated_at`.
- `get(resourceType, id) → FhirResource | null` — returns the canonical `resource` jsonb.

This is the only place internal canonical FHIR is read/written in 2b.

---

## 6. Flattening (pure) + external flat tables

Per PRD §3.2 the external DB receives **scalar columns, never jsonb**. Each `flatten<Resource>(resource, prov)` is a pure function returning a plain row object; `flattenResource(resource, prov)` dispatches on `resourceType` and returns `{ table, row } | null` (`null` for non-domain types like Bundle/OperationOutcome).

External migration `external/001_flat_tables` creates seven tables; each has `id text primary key`, the scalar columns below, the four provenance columns (`source_system`, `plugin_id`, `plugin_version`, `batch_id`), and `created_at timestamptz not null default now()`. No jsonb, no cross-table foreign keys (portable + insert-order independent).

| Table | Scalar columns (beyond id + provenance + created_at) |
|-------|------|
| `patients` | identifier_system, identifier_value, family_name, given_name, gender, birth_date, managing_organization |
| `specimens` | identifier_value, accession, status, type_code, type_text, subject_ref, parent_ref, received_time |
| `service_requests` | identifier_value, status, intent, priority, code_code, code_text, subject_ref, authored_on |
| `diagnostic_reports` | identifier_value, status, code_code, code_text, subject_ref, effective_date_time, issued, conclusion |
| `observations` | identifier_value, status, code_code, code_text, subject_ref, specimen_ref, value_quantity, value_unit, value_code, value_text, interpretation_code, effective_date_time |
| `organizations` | identifier_value, name, type_text, part_of_ref |
| `locations` | identifier_value, status, name, type_text, managing_organization, part_of_ref |

Extraction rules (consistent across resources): a multi-valued `identifier` flattens to the first identifier's `system`/`value`; a `CodeableConcept` flattens to `<field>_code` (first coding's `code`) + `<field>_text` (`.text` or first coding `.display`); a `Reference` flattens to its `.reference` string; `HumanName` → `family_name` + first `given`. Unknown/missing values → `null`.

---

## 7. FlatWriter + persistResource (DP-7 spine)

`createFlatWriter(db: Kysely<ExternalSchema>)`:
- `write(resource, provenance?) → 'written' | 'skipped'` — `flattenResource`; if `null`, returns `'skipped'`; else upsert into `{table}` on conflict `(id)` do update. Throws on a DB error (the caller decides degradation).

The external Kysely is obtained by typing the `TargetStorePort`'s generic `db` to `ExternalSchema` at the composition root.

`persistResource(deps, resource, provenance?)` — the reusable spine primitive the ingest pipeline will call:
```ts
interface PersistResult {
  saved: boolean;                 // canonical save succeeded (always true on return, else it throws)
  flattened: 'written' | 'skipped' | 'degraded';
  externalError?: string;         // present iff degraded (redacted)
}
function persistResource(
  deps: { fhirStore: FhirStore; flatWriter: FlatWriter; logger: Logger },
  resource: unknown,
  provenance?: Provenance,
): Promise<PersistResult>;
```
Flow: `validateResource` (throw on invalid — caller must pass valid FHIR) → `fhirStore.save` (throw on failure: internal is the source of truth and must succeed) → `try flatWriter.write` → on success `flattened: 'written'|'skipped'`; on failure log a structured error and return `flattened: 'degraded'` with `externalError` (redacted), **not** throwing (DP-7). So an unreachable external DB degrades only the projection; the canonical record is safe.

---

## 8. Migrator (static, bundler-safe)

`migrations/{internal,external}/index.ts` export an object map `Record<string, Migration>` (Kysely `Migration = { up(db), down(db) }`) — statically imported migration modules keyed by sortable name (`001_…`). No `FileMigrationProvider`, no fs, no dynamic import (avoids the `Dynamic require` ESM-bundle pitfall).

`createMigrator(db, migrations)` wraps Kysely's `Migrator` with a provider returning the static map; helpers `migrateToLatest()` and `migrateDown()` return Kysely's `MigrationResultSet`. Internal and external each get their own migrator (own `kysely_migration`/`kysely_migration_lock` tables in their respective DB).

---

## 9. Composition + CLI

`@openldr/bootstrap` adds `createDbContext(config)` (separate from `createAppContext`, so `db` commands need only the two Postgres DBs — not Keycloak/MinIO):
```ts
interface DbContext {
  internalDb: Kysely<InternalSchema>;
  externalStore: TargetStorePort;
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  persist(resource: unknown, prov?: Provenance): Promise<PersistResult>;
  migrateAll(): Promise<{ internal: MigrationResultSet; external: MigrationResultSet }>;
  reset(opts?: { force?: boolean }): Promise<void>;
  close(): Promise<void>;
}
```
It builds `createInternalDb(INTERNAL_DATABASE_URL)`, the `db-store` adapter (external), `createFhirStore`, `createFlatWriter` (typing `externalStore.db` to `ExternalSchema`), and both migrators. `reset` refuses when `NODE_ENV === 'production'` unless `force`.

`openldr db` CLI (in `@openldr/cli`, using `createDbContext`):
- `db migrate [--json]` — run internal + external migrators to latest; report applied migration names; exit 0 on success, 1 on error.
- `db reset [--json] [--force]` — drop + re-migrate; refuses in production without `--force`.
- `db seed [--json]` — `persistResource` a tiny sample (one Organization, one Location, one Patient referencing them); reports inserted ids.

---

## 10. Testing & acceptance

**Unit (no infra)**
- Each pure `flatten<Resource>`: a representative resource → the expected scalar row (identifier/CodeableConcept/Reference extraction rules verified); `flattenResource` dispatch returns `null` for Bundle.
- `persistResource` DP-7: with a fake `flatWriter` that throws and a fake `fhirStore` that succeeds → result `{ saved:true, flattened:'degraded', externalError: <redacted> }`, no throw; with both succeeding → `'written'`; with a non-domain resource → `'skipped'`.
- `persistResource` rejects invalid FHIR (throws before saving).
- Migration maps: `internalMigrations`/`externalMigrations` are keyed and ordered; each migration has `up`/`down`.

**Integration (dev docker stack, run via `pnpm openldr` / tsx)**
- `openldr db migrate` → internal `fhir_resources` exists; external `patients`+6 others exist; exit 0.
- `persistResource(validPatient)` → a row in internal `fhir_resources` (canonical jsonb) **and** a scalar row in external `patients` with the projected columns; `FhirStore.get('Patient', id)` round-trips.
- Stop the external Postgres connection (point external at a dead port, or stop the service) → `persistResource` returns `flattened:'degraded'`, internal row still written, **no crash** (DP-7).
- `openldr db seed` inserts the sample set; `db reset` drops and recreates cleanly.

**Gate**
- `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green; `depcruise` confirms `@openldr/db` imports no `adapter-*` and `@openldr/fhir` remains pure.

---

## 11. Acceptance criteria checklist

- [ ] `@openldr/db` package created; `@openldr/fhir` unchanged/pure (P1-FHIR-1 storage half, P1-FHIR-3).
- [ ] Internal `fhir_resources` table + `FhirStore.save/get` round-trips canonical FHIR (DP-6).
- [ ] Pure flatten transforms for the seven resources; external scalar flat tables, never jsonb (P1-FHIR-3, §3.2).
- [ ] Provenance columns on `fhir_resources` and every flat table (DP-3).
- [ ] `persistResource` saves internally then best-effort externally; external failure → `degraded`, no crash (DP-7).
- [ ] Static in-code Kysely migrator for both DBs; no dynamic import.
- [ ] `openldr db migrate|reset|seed [--json]` work via `createDbContext` (P1-CLI-1/2, DP-4).
- [ ] Full gate green; dependency-cruiser clean (db imports no adapter; fhir still pure).

---

## 12. Open items carried forward (not blocking 2b)

- Ingest pipeline orchestration + batch ids + retry/queue (§8 step 4) — will call `persistResource`.
- Child/junction flat tables (identifiers, components) for richer analytics — later.
- MSSQL/Oracle external dialects behind the port — Phase 2.
- kysely-codegen as a dev convenience to verify hand-written DB types against a live DB.
- License headers pending company/legal sign-off (§9).
