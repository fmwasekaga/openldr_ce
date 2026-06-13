# CLI Completeness + `export` — Design Spec

**PRD mapping:** §8 build-sequence step 8 — P1-CLI-1 (first-class CLI exposing every subsystem, incl. `export`), P1-CLI-2 (every command emits `--json`), P1-NFR-1 / DP-2 (data portability — a client extracts their complete dataset in open formats, no maintainer in the loop). `provenance audit` (P1-NFR-6) already shipped in sub-project 4.

**Status:** Approved design (2026-06-13). Small, self-contained sub-project — the one missing required command is `export`; the rest is a completeness audit.

---

## 1. Context — what already exists

The CLI already covers the PRD §5.9 minimum set except `export`:
- `health`, `fhir validate <file>`, `db migrate|seed|reset`, `forms extract`, `ingest <file> [--plugin <id>]`, `pipeline status|retry <id>|logs <batchId>`, `queue status`, `provenance audit`, `plugin install|list|test|run|remove`, `report list|run`, `audit list`, `user list|show|create|set-role|activate|deactivate`.
- **Every** command already takes `--json` (P1-CLI-2 ✓).
- The PRD lists `pipeline logs [--stage]`; CE's pipeline has no per-stage sub-logs (a batch is processed atomically by one worker), so `--stage` is **N/A** and intentionally omitted — documented here rather than added as a no-op.

**The only gap is `export`** (P1-CLI-1 / P1-NFR-1 / DP-2).

## 2. Key decisions (locked during brainstorming)

1. **Export = canonical FHIR + flat CSV.** The internal canonical `fhir_resources` (lossless system of record) as FHIR (NDJSON + a collection Bundle), AND the 7 external flat tables as CSV. Covers all three PRD-listed formats (FHIR Bundle / JSON / CSV).
2. **Output = a directory of files + a manifest.** One `export` run writes the whole dataset to `--out <dir>`; no per-format stdout streaming (YAGNI).

## 3. Architecture

`export` reads from BOTH databases, so it goes through `createDbContext` (the existing db context already used by the `db migrate|reset|seed` commands), which exposes `internalDb: Kysely<InternalSchema>` and `externalStore` (a `TargetStorePort` with `.db`). No new `AppContext` surface.

Data extraction lives in `@openldr/db` (it owns both schemas and returns plain data — no filesystem). File writing + formatting is a CLI concern (`packages/cli/src/export.ts`).

```
openldr export --out <dir>
   └─ createDbContext(cfg)
        ├─ exportCanonicalResources(internalDb)  → FhirResource[]      (@openldr/db)
        └─ exportFlatTables(externalDb)           → TableExport[]        (@openldr/db)
   └─ export.ts writes: fhir.ndjson, fhir-bundle.json, <table>.csv ×N, manifest.json
```

## 4. `@openldr/db` additions

```ts
import type { FhirResource } from '@openldr/fhir';

export interface TableExport {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** All canonical resources (the `resource` jsonb of every fhir_resources row). */
export function exportCanonicalResources(db: Kysely<InternalSchema>): Promise<FhirResource[]>;

/** Every row of each of the 7 external flat tables, with column lists. */
export function exportFlatTables(db: Kysely<ExternalSchema>): Promise<TableExport[]>;
```

- `exportCanonicalResources` selects `resource` from `fhir_resources` ordered by `resource_type, id`; returns the parsed jsonb objects.
- `exportFlatTables` iterates the fixed list `['patients','organizations','locations','specimens','service_requests','diagnostic_reports','observations']`, `selectAll()` per table; `columns` come from a static `EXTERNAL_TABLE_COLUMNS` map (the known column keys) so the CSV has a stable header even when a table is empty.

## 5. CLI — `packages/cli/src/export.ts` + registration

`openldr export [--out <dir>] [--json]` (default `--out ./openldr-export`):

1. `mkdirSync(out, { recursive: true })`.
2. `const { internalDb, externalStore, close } = await createDbContext(loadConfig())`.
3. `resources = await exportCanonicalResources(internalDb)`; write `fhir.ndjson` = `toNdjson(resources)` and `fhir-bundle.json` = `JSON.stringify(toBundle(resources), null, 2)`.
4. `tables = await exportFlatTables(externalStore.db as unknown as Kysely<ExternalSchema>)`; for each write `<table>.csv` = `toCsv(columns.map((k) => ({ key: k, label: k })), rows)` (reusing `@openldr/reporting`'s `toCsv`).
5. Write `manifest.json` LAST (so its presence signals a complete export).
6. Human output: a summary line per artifact + the out dir; `--json` emits the manifest object. Exit 0; on any error, clean message + exit 1 (registered like the other commands).

Pure helpers in `export.ts` (unit-tested): `toNdjson(resources): string`, `toBundle(resources): Bundle` (`{ resourceType: 'Bundle', type: 'collection', entry: resources.map((r) => ({ resource: r })) }`), `buildManifest(resources, tables, generatedAt): Manifest`.

`Manifest = { generatedAt: string; fhirResourceCount: number; tables: Record<string, number>; formats: string[] }`.

## 6. Error handling

- Output dir created with `recursive: true` (idempotent).
- DB unreachable → `createDbContext`/query throws → the command's try/catch prints `export failed: <message>` + exit 1 (matches the other CLI commands). No partial-success masking: `manifest.json` is written only after all data files succeed, so a present manifest means a complete export.
- `ctx.close()` in `finally`.

## 7. Testing & acceptance

**Unit (hermetic):** `toNdjson` (one line per resource, trailing handling), `toBundle` (collection Bundle shape + entry count), `buildManifest` (counts + formats). `@openldr/db` export helpers are DB-bound → verified in integration.

**Integration (docker):** ingest the WHONET sample → `openldr export --out ./tmp-export-<x>` →
- `fhir.ndjson` has one line per canonical resource (matches the ingested count);
- `fhir-bundle.json` parses as a `Bundle` with `entry.length === fhirResourceCount`;
- `observations.csv` exists with a header + rows; the other 6 `<table>.csv` exist (header even if empty);
- `manifest.json` lists `fhirResourceCount` + per-table counts; `--json` returns the same manifest.

**Final gate:** `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build && pnpm --filter @openldr/server build:check` green; depcruise unaffected (the new db helpers + CLI command import no adapter).

## 8. Done criteria (maps to PRD §5.9, §6)

- [ ] `openldr export [--out <dir>] [--json]` writes canonical FHIR (NDJSON + Bundle) + per-table CSV + manifest (P1-CLI-1, P1-NFR-1, DP-2).
- [ ] `@openldr/db` `exportCanonicalResources` + `exportFlatTables` (no adapter, no filesystem).
- [ ] CLI §5.9 command set complete; `--json` on every command (P1-CLI-2); `pipeline logs --stage` documented as N/A.
- [ ] `pnpm -r typecheck && test && depcruise && build` green; live docker acceptance shows a complete export of the ingested dataset.

## 9. Out of scope (deferred)

- Selective/filtered export (by date, facility, resource type) — Phase 1 exports everything.
- Streaming/very-large-dataset export (the in-memory Bundle is fine at P1 scale; NDJSON is the scalable artifact).
- Compression / archive packaging (`.zip`/`.tar.gz`) of the output directory.
- Import / round-trip restore (export-only this round).
- A UI export button (CLI-only; the dashboard export of a single report already exists via the report `.csv` endpoint).
