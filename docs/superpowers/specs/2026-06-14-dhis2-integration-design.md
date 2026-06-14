# Phase-2 sub-project 3 — DHIS2 integration (Slice A, headless aggregate)

**Date:** 2026-06-14
**Status:** Approved design (ready for implementation planning)
**PRD:** `openldr-ce-prd-phase2.md` — P2-DHIS2-1 (port+connector), -2 (aggregate mapping engine), -3 (orgUnit map table), -6 (push auditing), -8 (Web API default); the aggregate half of -4; dry-run from -5; the `dhis2` CLI (§3).
**Deferred to later slices:** tracker mode + scheduled/event-driven automation (-4/-5 → Slice B); mapping/orgUnit authoring UI (-7, -3 UI → Slice C).
**Build-sequence step:** Phase-2 §7 step 3 (sliced)

---

## 1. Purpose & scope

Push aggregate AMR surveillance data from OpenLDR CE to a Ministry's **DHIS2** instance, on the Ministry's own terms (their dataElements/orgUnits/periods), behind a swappable port. AMR/GLASS surveillance is aggregate `dataValueSets`, so Slice A delivers the aggregate path headless: connect, pull metadata, map CE report results → DHIS2 `dataValueSets`, preview (dry-run), push, audit.

Mirrors the headless-first precedent. The **mapping engine is pure** and fully **dry-run-testable without a live DHIS2**; only the real push + import-summary needs an instance (validated against a Dockerized seeded DHIS2 — operator-run).

**In scope (Slice A):**
- New generic `ReportingTargetPort` in `@openldr/ports` (DHIS2 + future GLASS reuse it).
- New `adapter-dhis2` (Web API: auth, pull metadata, push dataValueSets, parse import summary).
- New `@openldr/dhis2` domain package: declarative `AggregateMapping` + the pure `buildDataValueSet` engine + `validate` against pulled metadata.
- Internal migration `008_dhis2` (`dhis2_orgunit_map`, `dhis2_mappings`) + their stores.
- Bootstrap wiring (`ctx.dhis2`); CLI `dhis2 map|orgunit|pull-metadata|validate|push [--dry-run]|status`.
- Push auditing via the existing audit store; best-effort (DP-7).
- Config (`REPORTING_TARGET_ADAPTER` + `DHIS2_*` secrets) + a `dhis2` docker-compose profile.
- Live acceptance against a Dockerized seeded DHIS2 (Sierra Leone demo).

**Out of scope (deferred):**
- DHIS2 **tracker** (events) mode; **scheduled / event-driven** push automation via the eventing port (Slice B).
- Mapping authoring UI + orgUnit mapping UI (Slice C).
- GLASS submission-format export (P2-REP); a FHIR-based reporting-target adapter (port leaves room; not built).
- HTTP API for DHIS2 ops (CLI-only this slice; the UI slice adds HTTP if needed).

---

## 2. Cross-cutting principles

- **DP-1** — `@openldr/dhis2` (domain, no adapters) holds the mapping engine; only bootstrap imports `adapter-dhis2`; the port is the seam. depcruise-enforced.
- **DP-7 resilience** — a push never crashes the app; failures are audited + surfaced, not thrown into the caller.
- **DP-3 audit** — every real push records target/mapping/period/counts/import-summary/status (dry-run does not write audit).
- **DP-2 portability** — mappings are declarative data (jsonb), not code; exportable later (P2-NFR-1).
- **DP-4 agent-operability** — `dhis2 ... --json`; dry-run previews the exact payload.
- **P2-NFR-3** — the mapping reads report results, which already pass on Postgres + SQL Server.

---

## 3. Port: `ReportingTargetPort` (`@openldr/ports`)

Generic external-reporting-target seam (kept DHIS2-agnostic so a FHIR-based target could implement it later):

```ts
export interface TargetMetadata {
  dataElements: { id: string; name: string }[];
  orgUnits: { id: string; name: string }[];
  categoryOptionCombos: { id: string; name: string }[];
}
export interface PushResult {
  status: 'success' | 'warning' | 'error';
  imported: number; updated: number; ignored: number; deleted: number;
  conflicts: { object: string; value: string }[];
  raw: unknown; // the full provider response, for audit
}
export interface ReportingTargetPort {
  healthCheck(): Promise<HealthResult>;
  pullMetadata(): Promise<TargetMetadata>;
  pushAggregate(payload: unknown): Promise<PushResult>; // payload = DHIS2 dataValueSets shape
}
```

`payload` is typed `unknown` at the port (the DHIS2 `DataValueSet` shape is produced by `@openldr/dhis2`; the adapter trusts it). Selected by config `REPORTING_TARGET_ADAPTER` (`none` | `dhis2`).

---

## 4. Adapter: `adapter-dhis2`

Web API over `fetch` (basic auth `DHIS2_USERNAME:DHIS2_PASSWORD`, base64; base URL from config). Implements `ReportingTargetPort`:
- `healthCheck` → `GET {base}/api/system/info.json` (200 ⇒ up; map errors to `down` via `probe`).
- `pullMetadata` → `GET /api/dataElements.json?fields=id,name&paging=false`, `/organisationUnits.json?...`, `/categoryOptionCombos.json?...` → `TargetMetadata`.
- `pushAggregate(payload)` → `POST /api/dataValueSets.json` (JSON body) → parse DHIS2 `importCount` (imported/updated/ignored/deleted) + `conflicts` + `status` into `PushResult` (`raw` = full body).
- A `deps.fetch` seam (default global `fetch`) so the adapter is unit-testable with a stubbed fetch (mirrors `adapter-db-store`'s `deps.pool`). DP-1: only bootstrap imports it.

---

## 5. Mapping engine: `@openldr/dhis2` (domain package, pure)

Imports `@openldr/core` + (types from) `@openldr/db`/`@openldr/ports`; **no adapters, no I/O**.

**Declarative mapping** (stored as jsonb; the source is an extensible discriminated union — `report` implemented now, `query` reserved):

```ts
export type MappingSource =
  | { kind: 'report'; reportId: string; params?: Record<string, string> };
  // future: | { kind: 'query'; ... }
export interface ColumnMapping {
  column: string;            // a column key in the source rows
  dataElement: string;       // DHIS2 dataElement id
  categoryOptionCombo?: string;
}
export interface AggregateMapping {
  id: string;
  name: string;
  source: MappingSource;
  orgUnitColumn: string;     // the source column holding the CE facility id
  periodColumn?: string;     // source column for the period; else the --period arg
  columns: ColumnMapping[];  // each contributes a dataValue per row
}
```

**Engine** (pure, unit-tested):
```ts
buildDataValueSet(rows: Record<string, unknown>[], mapping: AggregateMapping,
                  orgUnitMap: Map<string,string>, period: string): { payload: DataValueSet; skipped: SkipRecord[] }
```
For each row: resolve `orgUnit` via `orgUnitMap.get(row[orgUnitColumn])` (skip + record if unmapped); derive `period` (row[periodColumn] or the arg); for each `ColumnMapping`, emit `{ dataElement, categoryOptionCombo?, orgUnit, period, value: String(row[column]) }` (skip null/empty values). Returns the `DataValueSet` (`{ dataValues: [...] }`) + a list of skipped rows/reasons (surfaced in dry-run + audit). `dispatchSource(mapping.source)` throws a clear error for any non-`report` kind in Slice A.

`validateMapping(mapping, metadata)` → checks every `dataElement`/`categoryOptionCombo` exists in `TargetMetadata` and every mapped facility has an orgUnit; returns a list of problems.

---

## 6. Storage — internal migration `008_dhis2`

- `dhis2_orgunit_map(facility_id text pk, orgunit_id text not null, orgunit_name text)` — CE Organization id → DHIS2 orgUnit uid.
- `dhis2_mappings(id text pk, name text, definition jsonb not null, created_at, updated_at)` — the `AggregateMapping`s.
- Stores in `@openldr/db`: `OrgUnitMapStore` (upsert/get/list/getMap→`Map`), `MappingStore` (upsert/get/list). The internal DB is always Postgres.

---

## 7. Push flow + dry-run + audit (P2-DHIS2-6, DP-7)

`dhis2 push <mappingId> --period <p> [--dry-run]`:
1. Load mapping + orgUnit map; run the report (`source.kind==='report'` → `ctx.reporting.run(reportId, params)`).
2. `buildDataValueSet(rows, mapping, orgUnitMap, period)` → payload + skipped.
3. **dry-run:** print the payload + skipped summary; **do not send**; no audit write.
4. **real:** `port.pushAggregate(payload)` → `PushResult`; record audit `dhis2.push` with metadata `{ target: baseUrl, mappingId, period, dataValues: payload.dataValues.length, imported/updated/ignored, conflicts, status }`; on adapter error, record `dhis2.push.failed` + return non-zero — never throw past the CLI boundary (best-effort).
A push is **idempotent** at DHIS2 (re-sending the same period/orgUnit/dataElement updates, not duplicates — DHIS2 dataValueSets upsert by key), satisfying P2-NFR-2.

---

## 8. CLI (PRD §3)

`openldr dhis2`:
- `map import <file>` (load an AggregateMapping JSON) · `map list` · `validate <mappingId>` (against pulled metadata)
- `orgunit import <file>` (load facility→orgUnit pairs JSON) · `orgunit list`
- `pull-metadata [--json]` (fetch + print counts; used by validate)
- `push <mappingId> --period <p> [--dry-run] [--json]`
- `status [--json]` (recent `dhis2.push*` events from the audit log)

All support `--json`; non-zero exit on validation failure / push error.

---

## 9. Config + dev infra

- Config: `REPORTING_TARGET_ADAPTER: z.enum(['none','dhis2']).default('none')` + `DHIS2_BASE_URL`, `DHIS2_USERNAME`, `DHIS2_PASSWORD` (optional; required when adapter=`dhis2` via superRefine, like MSSQL).
- `docker-compose.yml` `dhis2` profile (off by default): `dhis2-db` (`postgis/postgis:14-3.3`, seeded from the Sierra Leone demo dump) + `dhis2-web` (`dhis2/core:2.40.3`, mounts a `dhis.conf`, port 8085). A `scripts/dhis2-seed.mjs` (or compose init) downloads + loads the SL dump (`https://databases.dhis2.org/sierra-leone/2.40.3/dhis2-db-sierra-leone.sql.gz`, ~85 MB). `.env.example` gains the `DHIS2_*` vars + the local demo defaults (admin/district).

---

## 10. Testing & acceptance

- **Unit (no DHIS2; stays in `pnpm test`):** `buildDataValueSet` (orgUnit resolution, period derivation, skip null/unmapped, multi-column rows); `validateMapping` against a metadata fixture; `dispatchSource` rejects non-report kinds; the adapter's `pushAggregate` import-summary parsing + `healthCheck` over a stubbed `fetch`; config superRefine.
- **Live acceptance (Dockerized DHIS2 — operator-run):**
  1. `docker compose --profile dhis2 up -d` + seed (SL demo) → DHIS2 healthy (`/api/system/info`).
  2. `dhis2 pull-metadata` → real SL dataElements/orgUnits/coc counts.
  3. Import an orgUnit map (a CE facility → a real SL orgUnit uid) + an AggregateMapping (a report's columns → real SL dataElements).
  4. `dhis2 validate <mappingId>` → no problems.
  5. `dhis2 push <mappingId> --period 2026Q1 --dry-run --json` → previews a `dataValueSets` payload (no send).
  6. `dhis2 push <mappingId> --period 2026Q1` → `PushResult` imported/updated > 0; `dhis2 status` shows the audited push; re-push updates (not duplicates).
- `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check` green.

---

## 11. Risks & mitigations

- **DHIS2 boot is heavy** (seeded 85 MB SL dump, ~minutes) → it's an operator/acceptance step behind a compose profile, not in `pnpm test`; the mapping engine (the real logic) is fully unit/dry-run tested without it.
- **DHIS2 metadata ids are instance-specific** → mappings reference real ids; `validate` against pulled metadata catches stale ids before a push; acceptance uses real SL demo ids.
- **Secrets** → `DHIS2_PASSWORD` via config (env), basic-auth over HTTPS in prod; credential hardening proper is P2-HARD-3.
- **Partial pushes / conflicts** → `PushResult.conflicts` + status surfaced and audited; push is best-effort (DP-7) and idempotent at DHIS2 (P2-NFR-2).
- **Port genericity vs DHIS2 specifics** → `pushAggregate(payload: unknown)` keeps the port DHIS2-agnostic; the DHIS2 `DataValueSet` shape lives in `@openldr/dhis2`; a future FHIR target implements the same port.
- **Source extensibility** → `MappingSource` is a discriminated union; Slice A implements `report`, `dispatchSource` errors clearly on others, so adding `query` later is additive.
