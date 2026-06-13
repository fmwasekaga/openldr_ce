# CLI Completeness + `export` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `openldr export` — a one-command data-portability export of the complete dataset (canonical FHIR as NDJSON + a collection Bundle, plus per-table flat CSV + a manifest) to a directory — completing the PRD §5.9 CLI surface.

**Architecture:** Data extraction (`exportCanonicalResources`, `exportFlatTables`) lives in `@openldr/db` (owns both schemas, returns plain data — no filesystem, no adapter). The CLI `export.ts` reads via the existing `createDbContext` (internal + external Kysely), formats with pure helpers (`toNdjson`/`toBundle`/`buildManifest`) + `@openldr/reporting`'s `toCsv`, and writes the output directory.

**Tech Stack:** TypeScript (ESM), Kysely, Vitest, commander, node:fs.

**Reference:** `docs/superpowers/specs/2026-06-13-cli-export-design.md`

**Conventions:** Commits `git -c commit.gpgsign=false commit`, **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions; `import type` for type-only. New `@openldr/db` helpers import no `adapter-*`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/src/export-data.ts` | `exportCanonicalResources`, `exportFlatTables`, `EXTERNAL_TABLE_COLUMNS`, `TableExport` |
| `packages/db/src/index.ts` | export the new module (modify) |
| `packages/db/src/export-data.test.ts` | column-map coverage (pure) |
| `packages/cli/src/export.ts` | `runExport` + pure formatters |
| `packages/cli/src/export.test.ts` | formatter unit tests |
| `packages/cli/src/index.ts` | register `export` (modify) |
| `.gitignore` | ignore `openldr-export/` + `tmp-export*/` (modify) |

---

## Task 1: `@openldr/db` — export extraction helpers

**Files:**
- Create: `packages/db/src/export-data.ts`, `packages/db/src/export-data.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/src/export-data.ts`**

```ts
import type { Kysely } from 'kysely';
import type { FhirResource } from '@openldr/fhir';
import type { InternalSchema } from './schema/internal';
import type { ExternalSchema } from './schema/external';

export interface TableExport {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Stable column lists per external flat table (so empty tables still get a CSV header). */
export const EXTERNAL_TABLE_COLUMNS: Record<keyof ExternalSchema, string[]> = {
  patients: ['id', 'identifier_system', 'identifier_value', 'family_name', 'given_name', 'gender', 'birth_date', 'managing_organization', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  specimens: ['id', 'identifier_value', 'accession', 'status', 'type_code', 'type_text', 'subject_ref', 'parent_ref', 'received_time', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  service_requests: ['id', 'identifier_value', 'status', 'intent', 'priority', 'code_code', 'code_text', 'subject_ref', 'authored_on', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  diagnostic_reports: ['id', 'identifier_value', 'status', 'code_code', 'code_text', 'subject_ref', 'effective_date_time', 'issued', 'conclusion', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  observations: ['id', 'identifier_value', 'status', 'code_code', 'code_text', 'subject_ref', 'specimen_ref', 'value_quantity', 'value_unit', 'value_code', 'value_text', 'interpretation_code', 'effective_date_time', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  organizations: ['id', 'identifier_value', 'name', 'type_text', 'part_of_ref', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
  locations: ['id', 'identifier_value', 'status', 'name', 'type_text', 'managing_organization', 'part_of_ref', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
};

/** All canonical resources (the `resource` jsonb of every fhir_resources row), ordered by type+id. */
export async function exportCanonicalResources(db: Kysely<InternalSchema>): Promise<FhirResource[]> {
  const rows = await db.selectFrom('fhir_resources').select('resource').orderBy('resource_type').orderBy('id').execute();
  return rows.map((r) => r.resource as unknown as FhirResource);
}

/** Every row of each external flat table (explicit per-table for clean typing). */
export async function exportFlatTables(db: Kysely<ExternalSchema>): Promise<TableExport[]> {
  return [
    { table: 'patients', columns: EXTERNAL_TABLE_COLUMNS.patients, rows: (await db.selectFrom('patients').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'organizations', columns: EXTERNAL_TABLE_COLUMNS.organizations, rows: (await db.selectFrom('organizations').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'locations', columns: EXTERNAL_TABLE_COLUMNS.locations, rows: (await db.selectFrom('locations').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'specimens', columns: EXTERNAL_TABLE_COLUMNS.specimens, rows: (await db.selectFrom('specimens').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'service_requests', columns: EXTERNAL_TABLE_COLUMNS.service_requests, rows: (await db.selectFrom('service_requests').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'diagnostic_reports', columns: EXTERNAL_TABLE_COLUMNS.diagnostic_reports, rows: (await db.selectFrom('diagnostic_reports').selectAll().execute()) as Record<string, unknown>[] },
    { table: 'observations', columns: EXTERNAL_TABLE_COLUMNS.observations, rows: (await db.selectFrom('observations').selectAll().execute()) as Record<string, unknown>[] },
  ];
}
```

- [ ] **Step 2: Create `packages/db/src/export-data.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { EXTERNAL_TABLE_COLUMNS } from './export-data';

describe('EXTERNAL_TABLE_COLUMNS', () => {
  it('covers the 7 external flat tables', () => {
    expect(Object.keys(EXTERNAL_TABLE_COLUMNS).sort()).toEqual(
      ['diagnostic_reports', 'locations', 'observations', 'organizations', 'patients', 'service_requests', 'specimens'],
    );
  });
  it('every table includes id + provenance columns', () => {
    for (const cols of Object.values(EXTERNAL_TABLE_COLUMNS)) {
      expect(cols).toContain('id');
      expect(cols).toContain('source_system');
      expect(cols).toContain('batch_id');
    }
  });
});
```

- [ ] **Step 3: Add to `packages/db/src/index.ts`** — append:

```ts
export * from './export-data';
```

- [ ] **Step 4: Test + typecheck**

Run: `pnpm --filter @openldr/db test export-data && pnpm --filter @openldr/db typecheck`
Expected: column-map tests pass; typecheck clean. (The query functions are exercised against Postgres in Task 3.)
If `db.selectFrom('fhir_resources').select('resource')` mis-types the row, the `as unknown as FhirResource` cast handles the jsonb→object shape. Do NOT redesign.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): exportCanonicalResources + exportFlatTables (P1-NFR-1)"
```

---

## Task 2: CLI — `export` command

**Files:**
- Create: `packages/cli/src/export.ts`, `packages/cli/src/export.test.ts`
- Modify: `packages/cli/src/index.ts`, `.gitignore`

- [ ] **Step 1: Create `packages/cli/src/export.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { createDbContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { exportCanonicalResources, exportFlatTables, type TableExport, type ExternalSchema } from '@openldr/db';
import { toCsv } from '@openldr/reporting';
import type { FhirResource } from '@openldr/fhir';

export interface ExportManifest {
  generatedAt: string;
  fhirResourceCount: number;
  tables: Record<string, number>;
  formats: string[];
}

export function toNdjson(resources: FhirResource[]): string {
  return resources.map((r) => JSON.stringify(r)).join('\n') + (resources.length ? '\n' : '');
}

export function toBundle(resources: FhirResource[]): { resourceType: 'Bundle'; type: 'collection'; entry: { resource: FhirResource }[] } {
  return { resourceType: 'Bundle', type: 'collection', entry: resources.map((r) => ({ resource: r })) };
}

export function buildManifest(resources: FhirResource[], tables: TableExport[], generatedAt: string): ExportManifest {
  const t: Record<string, number> = {};
  for (const x of tables) t[x.table] = x.rows.length;
  return { generatedAt, fhirResourceCount: resources.length, tables: t, formats: ['fhir.ndjson', 'fhir-bundle.json', 'csv'] };
}

export async function runExport(opts: { out: string; json: boolean }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    mkdirSync(opts.out, { recursive: true });
    const resources = await exportCanonicalResources(ctx.internalDb);
    writeFileSync(join(opts.out, 'fhir.ndjson'), toNdjson(resources));
    writeFileSync(join(opts.out, 'fhir-bundle.json'), JSON.stringify(toBundle(resources), null, 2) + '\n');

    const tables = await exportFlatTables(ctx.externalStore.db as unknown as Kysely<ExternalSchema>);
    for (const t of tables) {
      writeFileSync(join(opts.out, `${t.table}.csv`), toCsv(t.columns.map((k) => ({ key: k, label: k })), t.rows));
    }

    const manifest = buildManifest(resources, tables, new Date().toISOString());
    writeFileSync(join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    if (opts.json) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
    } else {
      process.stdout.write(`exported ${manifest.fhirResourceCount} FHIR resources + ${tables.length} flat tables to ${opts.out}\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
```

> `new Date()` is fine here — the CLI is an application entry point, not a workflow script. `ctx.externalStore.db` is the external Kysely (cast to `ExternalSchema`, the established pattern). `ExternalSchema` is exported from `@openldr/db` (via `./schema/external`).

- [ ] **Step 2: Create `packages/cli/src/export.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toNdjson, toBundle, buildManifest } from './export';
import type { FhirResource } from '@openldr/fhir';

const resources: FhirResource[] = [
  { resourceType: 'Patient', id: 'p1' },
  { resourceType: 'Observation', id: 'o1' },
];

describe('toNdjson', () => {
  it('emits one JSON object per line with a trailing newline', () => {
    const out = toNdjson(resources);
    expect(out.trimEnd().split('\n')).toHaveLength(2);
    expect(JSON.parse(out.trimEnd().split('\n')[0]).resourceType).toBe('Patient');
    expect(out.endsWith('\n')).toBe(true);
  });
  it('returns empty string for no resources', () => {
    expect(toNdjson([])).toBe('');
  });
});

describe('toBundle', () => {
  it('wraps resources in a collection Bundle', () => {
    const b = toBundle(resources);
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('collection');
    expect(b.entry).toHaveLength(2);
    expect(b.entry[0].resource.id).toBe('p1');
  });
});

describe('buildManifest', () => {
  it('counts resources and tables', () => {
    const m = buildManifest(resources, [{ table: 'patients', columns: ['id'], rows: [{ id: 'p1' }] }, { table: 'observations', columns: ['id'], rows: [] }], '2026-01-01T00:00:00Z');
    expect(m.fhirResourceCount).toBe(2);
    expect(m.tables).toEqual({ patients: 1, observations: 0 });
    expect(m.formats).toContain('csv');
    expect(m.generatedAt).toBe('2026-01-01T00:00:00Z');
  });
});
```

- [ ] **Step 3: Register in `packages/cli/src/index.ts`** — add the import beside the others:

```ts
import { runExport } from './export';
```

Insert before `program.parseAsync(process.argv);`:

```ts
program
  .command('export')
  .description('Export the complete dataset: canonical FHIR (NDJSON + Bundle) + flat-table CSV + manifest')
  .option('--out <dir>', 'output directory', 'openldr-export')
  .option('--json', 'emit the manifest as JSON', false)
  .action(async (opts: { out: string; json: boolean }) => {
    try {
      process.exitCode = await runExport(opts);
    } catch (err) {
      process.stderr.write(`export failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });
```

(`errorMessage` is already imported.)

- [ ] **Step 4: Ignore export output in `.gitignore`** — append:

```
openldr-export/
tmp-export*/
```

- [ ] **Step 5: Typecheck + test + build**

Run: `pnpm --filter @openldr/cli test && pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: export formatter tests pass (+ existing CLI tests); typecheck clean; `dist/index.js` produced. Fix only minimal issues.

- [ ] **Step 6: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): export complete dataset to a directory (P1-CLI-1, P1-NFR-1, DP-2)"
```

---

## Task 3: Integration acceptance + final gate

> Requires the docker stack (Postgres + MinIO) and the WHONET plugin from sub-project 5.

- [ ] **Step 1: Data**

Run: `docker compose up -d`; `pnpm openldr db reset --json`.
Run: `pnpm build:plugins && pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm --json && pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --source whonet --json` → batch done (12 resources).

- [ ] **Step 2: Export**

Run: `pnpm openldr export --out tmp-export-acc --json` → prints a manifest with `fhirResourceCount: 12` and a `tables` map; exit 0.

- [ ] **Step 3: Verify artifacts**

```bash
ls tmp-export-acc
wc -l < tmp-export-acc/fhir.ndjson
node -e "const b=require('./tmp-export-acc/fhir-bundle.json'); console.log(b.resourceType, b.type, b.entry.length)"
node -e "const m=require('./tmp-export-acc/manifest.json'); console.log(m.fhirResourceCount, JSON.stringify(m.tables))"
head -1 tmp-export-acc/observations.csv
```
Expected: the dir lists `fhir.ndjson`, `fhir-bundle.json`, `manifest.json`, and 7 `<table>.csv`; `fhir.ndjson` has 12 lines; the Bundle prints `Bundle collection 12`; `manifest.fhirResourceCount` is 12 with per-table counts; `observations.csv` has a header (+ 8 AST rows). Then `rm -rf tmp-export-acc`.

- [ ] **Step 4: Validate the exported Bundle round-trips**

Run: `pnpm openldr export --out tmp-export-acc --json >/dev/null` (regenerate) then `pnpm openldr fhir validate tmp-export-acc/fhir-bundle.json --json` → a validity summary with no errors (the canonical resources were validated on ingest, so the export round-trips). Then `rm -rf tmp-export-acc`.

- [ ] **Step 5: Final gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build && pnpm --filter @openldr/server build:check`
Expected: typecheck clean; all tests pass; depcruise no violations (the new db helpers + CLI command import no `adapter-*`); builds succeed; server smoke OK.

- [ ] **Step 6: Commit any lockfile delta**

Run: `git status --short` — commit `pnpm-lock.yaml` if changed (`chore: finalize cli-export lockfile`).

---

## Done criteria (maps to spec §8)

- [ ] `openldr export [--out <dir>] [--json]` writes canonical FHIR (NDJSON + collection Bundle) + per-table CSV + `manifest.json` (P1-CLI-1, P1-NFR-1, DP-2).
- [ ] `@openldr/db` `exportCanonicalResources` + `exportFlatTables` + `EXTERNAL_TABLE_COLUMNS` (no adapter, no filesystem).
- [ ] PRD §5.9 CLI command set complete; `--json` on every command (P1-CLI-2).
- [ ] `pnpm -r typecheck && test && depcruise && build` green; live docker acceptance shows a complete, valid export of the ingested dataset.
