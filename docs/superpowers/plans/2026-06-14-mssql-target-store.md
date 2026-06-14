# SQL Server Target-Store Adapter (P2-DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the external/target warehouse pluggable to SQL Server (alongside Postgres), so OpenLDR CE can ingest into and report from MSSQL with parity to Postgres.

**Architecture:** A new `adapter-mssql-store` package implements the existing `TargetStorePort` over Kysely's `MssqlDialect` (`tedious`+`tarn`). `@openldr/db` stays driver-free but gains a `TargetEngine` enum that makes the external DDL (`externalMigrations(engine)`) and the FlatWriter upsert (`createFlatWriter(db, engine)`) dialect-aware (Postgres `onConflict` / MSSQL `MERGE`). Bootstrap selects the adapter via the existing `TARGET_STORE_ADAPTER` config seam and threads the engine to db. The internal operational DB stays Postgres always.

**Tech Stack:** Kysely 0.27 (`MssqlDialect`), `tedious`, `tarn`, zod config, pnpm 11 workspaces, vitest, commander CLI, Docker (mssql 2022).

---

## Key facts (verified in the codebase / feasibility probe)

- `TargetStorePort` (`packages/ports/src/target-store.ts`): `{ db: Kysely<TargetSchema>; transaction(fn); healthCheck() }`. Dialect-agnostic — already swappable.
- Postgres adapter `createDbStore(cfg, deps?)` (`packages/adapter-db-store/src/index.ts`) wires `PostgresDialect`+`pg.Pool`; `healthCheck` = `probe(() => pool.query('select 1'))`; injectable `deps.pool` for unit tests.
- `externalMigrations` is consumed in **3 places** (convert carefully): `packages/bootstrap/src/db-context.ts:15,44`, `packages/bootstrap/src/ingest-context.ts:14,82`, `packages/db/src/migrations/migrations.test.ts:3,14-16`.
- `createFlatWriter(db)` is called in `db-context.ts:42` and `ingest-context.ts:65`.
- `createDbStore(...)` is called in `index.ts:53` (createAppContext), `db-context.ts:38`, `ingest-context.ts:52`.
- Reporting has **zero raw SQL** (grep-verified) — MSSQL verification is a live run, not a rewrite.
- Probe-proven MSSQL operations (Kysely `MssqlDialect`+tedious+tarn): connect, DDL with `sql\`nvarchar(max)\``/`sql\`float\``/`sql\`datetime2\``+`SYSUTCDATETIME()`, idempotent `mergeInto().whenMatched().thenUpdateSet().whenNotMatched().thenInsertValues()` (ran twice → no dup), `groupBy`+`countAll`. Kysely rejects typed `'float'` — MSSQL types must be raw `sql`.
- `mcr.microsoft.com/mssql/server:2022-latest` is pulled locally; SA needs a strong password.

---

## Task 1: Config — add `mssql` adapter + MSSQL_* fields + conditional requireds

**Files:**
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/load.test.ts`

- [ ] **Step 1: Write failing tests** — append to `packages/config/src/load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './load';

const basePg = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  TARGET_DATABASE_URL: 'postgres://u:p@localhost:5432/openldr',
  S3_ENDPOINT: 'http://localhost:9000', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b', S3_BUCKET: 'openldr',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/openldr',
};

describe('config target-store engine', () => {
  it('defaults TARGET_STORE_ADAPTER to pg', () => {
    expect(loadConfig({ ...basePg } as never).TARGET_STORE_ADAPTER).toBe('pg');
  });
  it('accepts a full mssql config', () => {
    const cfg = loadConfig({
      ...basePg, TARGET_STORE_ADAPTER: 'mssql',
      MSSQL_HOST: '127.0.0.1', MSSQL_DATABASE: 'openldr', MSSQL_USER: 'sa', MSSQL_PASSWORD: 'Openldr_Local_2026!',
    } as never);
    expect(cfg.TARGET_STORE_ADAPTER).toBe('mssql');
    expect(cfg.MSSQL_PORT).toBe(1433);
    expect(cfg.MSSQL_TRUST_SERVER_CERT).toBe(true);
  });
  it('rejects mssql adapter without MSSQL connection fields', () => {
    expect(() => loadConfig({ ...basePg, TARGET_STORE_ADAPTER: 'mssql' } as never)).toThrow(/MSSQL_HOST/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @openldr/config test`
Expected: FAIL (TARGET_STORE_ADAPTER doesn't accept 'mssql' / MSSQL_PORT undefined).

- [ ] **Step 3: Update `packages/config/src/schema.ts`** to:

```ts
import { z } from 'zod';

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default('info'),

    AUTH_ADAPTER: z.enum(['keycloak']).default('keycloak'),
    BLOB_ADAPTER: z.enum(['minio']).default('minio'),
    EVENTING_ADAPTER: z.enum(['pg']).default('pg'),
    TARGET_STORE_ADAPTER: z.enum(['pg', 'mssql']).default('pg'),

    // Internal operational Postgres (always pg) — used by the event bus, audit, users, plugins.
    INTERNAL_DATABASE_URL: z.string().url(),
    // External analytics / target store (required when TARGET_STORE_ADAPTER=pg).
    TARGET_DATABASE_URL: z.string().url().optional(),

    // SQL Server target store (required when TARGET_STORE_ADAPTER=mssql).
    MSSQL_HOST: z.string().min(1).optional(),
    MSSQL_PORT: z.coerce.number().int().positive().default(1433),
    MSSQL_DATABASE: z.string().min(1).optional(),
    MSSQL_USER: z.string().min(1).optional(),
    MSSQL_PASSWORD: z.string().min(1).optional(),
    MSSQL_ENCRYPT: z.coerce.boolean().default(false),
    MSSQL_TRUST_SERVER_CERT: z.coerce.boolean().default(true),

    // S3 / blob storage.
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    // OIDC issuer (Keycloak realm base URL).
    OIDC_ISSUER_URL: z.string().url(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.TARGET_STORE_ADAPTER === 'mssql') {
      for (const key of ['MSSQL_HOST', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when TARGET_STORE_ADAPTER=mssql` });
        }
      }
    } else if (!cfg.TARGET_DATABASE_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TARGET_DATABASE_URL'], message: 'TARGET_DATABASE_URL is required when TARGET_STORE_ADAPTER=pg' });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @openldr/config test`
Expected: PASS (all config tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/load.test.ts
git commit -m "feat(config): mssql target-store adapter + MSSQL_* config (P2-DB-1)"
```

---

## Task 2: `@openldr/db` — TargetEngine + dialect-aware external DDL factory

**Files:**
- Create: `packages/db/src/engine.ts`
- Create: `packages/db/src/migrations/external/dialect.ts`
- Create: `packages/db/src/migrations/external/dialect.test.ts`
- Modify: `packages/db/src/migrations/external/001_flat_tables.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts`
- Modify: `packages/bootstrap/src/db-context.ts` (keep compiling — temporary `'postgres'`)
- Modify: `packages/bootstrap/src/ingest-context.ts` (keep compiling — temporary `'postgres'`)

- [ ] **Step 1: Create `packages/db/src/engine.ts`**

```ts
/** Which SQL engine the EXTERNAL/target warehouse uses. Internal DB is always Postgres. */
export type TargetEngine = 'postgres' | 'mssql';
```

- [ ] **Step 2: Write failing test** — create `packages/db/src/migrations/external/dialect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { textType, keyType, floatType, timestampType } from './dialect';

describe('dialect type map', () => {
  it('maps postgres types', () => {
    expect(textType('postgres')).toBe('text');
    expect(keyType('postgres')).toBe('text');
    expect(floatType('postgres')).toBe('double precision');
    expect(timestampType('postgres')).toBe('timestamptz');
  });
  it('maps mssql types', () => {
    expect(textType('mssql')).toBe('nvarchar(max)');
    expect(keyType('mssql')).toBe('varchar(450)');
    expect(floatType('mssql')).toBe('float');
    expect(timestampType('mssql')).toBe('datetime2');
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @openldr/db test -- dialect`
Expected: FAIL (module './dialect' not found).

- [ ] **Step 4: Create `packages/db/src/migrations/external/dialect.ts`**

```ts
import { sql, type RawBuilder } from 'kysely';
import type { TargetEngine } from '../../engine';

// Logical-type -> dialect-type maps. Returned as strings used via sql.raw(...) in DDL so
// both Postgres and SQL Server emit valid column types from ONE schema definition.
export function textType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'nvarchar(max)' : 'text';
}
// MSSQL primary keys cannot be nvarchar(max); 450 is the max safe keyable length. FHIR ids fit easily.
export function keyType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'varchar(450)' : 'text';
}
export function floatType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'float' : 'double precision';
}
export function timestampType(engine: TargetEngine): string {
  return engine === 'mssql' ? 'datetime2' : 'timestamptz';
}
export function nowExpr(engine: TargetEngine): RawBuilder<unknown> {
  return engine === 'mssql' ? sql`SYSUTCDATETIME()` : sql`now()`;
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm --filter @openldr/db test -- dialect`
Expected: PASS.

- [ ] **Step 6: Rewrite `packages/db/src/migrations/external/001_flat_tables.ts`** to be engine-aware:

```ts
import { type Kysely, type CreateTableBuilder, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

function withCommon(b: CreateTableBuilder<string, never>, engine: TargetEngine): CreateTableBuilder<string, never> {
  const text = sql.raw(textType(engine));
  return b
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
}

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  const float = sql.raw(floatType(engine));

  await withCommon(
    db.schema.createTable('patients').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_system', text)
      .addColumn('identifier_value', text)
      .addColumn('family_name', text)
      .addColumn('given_name', text)
      .addColumn('gender', text)
      .addColumn('birth_date', text)
      .addColumn('managing_organization', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('specimens').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('accession', text)
      .addColumn('status', text)
      .addColumn('type_code', text)
      .addColumn('type_text', text)
      .addColumn('subject_ref', text)
      .addColumn('parent_ref', text)
      .addColumn('received_time', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('service_requests').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('intent', text)
      .addColumn('priority', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('subject_ref', text)
      .addColumn('authored_on', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('diagnostic_reports').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('subject_ref', text)
      .addColumn('effective_date_time', text)
      .addColumn('issued', text)
      .addColumn('conclusion', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('observations').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('code_code', text)
      .addColumn('code_text', text)
      .addColumn('subject_ref', text)
      .addColumn('specimen_ref', text)
      .addColumn('value_quantity', float)
      .addColumn('value_unit', text)
      .addColumn('value_code', text)
      .addColumn('value_text', text)
      .addColumn('interpretation_code', text)
      .addColumn('effective_date_time', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('organizations').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('name', text)
      .addColumn('type_text', text)
      .addColumn('part_of_ref', text),
    engine,
  ).execute();

  await withCommon(
    db.schema.createTable('locations').ifNotExists()
      .addColumn('id', key, (c) => c.primaryKey())
      .addColumn('identifier_value', text)
      .addColumn('status', text)
      .addColumn('name', text)
      .addColumn('type_text', text)
      .addColumn('managing_organization', text)
      .addColumn('part_of_ref', text),
    engine,
  ).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['patients', 'specimens', 'service_requests', 'diagnostic_reports', 'observations', 'organizations', 'locations']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
```

- [ ] **Step 7: Rewrite `packages/db/src/migrations/external/index.ts`** to a factory:

```ts
import type { Migration } from 'kysely';
import type { TargetEngine } from '../../engine';
import * as m001 from './001_flat_tables';

export function externalMigrations(engine: TargetEngine): Record<string, Migration> {
  return {
    '001_flat_tables': { up: (db) => m001.up(db, engine), down: m001.down },
  };
}
```

- [ ] **Step 8: Export the engine type** — add to `packages/db/src/index.ts` (after the existing `export * from './schema/external';` line):

```ts
export * from './engine';
```

- [ ] **Step 9: Update `packages/db/src/migrations/migrations.test.ts`** — change the external block to call the factory:

```ts
  it('external has the flat_tables migration with up/down', () => {
    const ext = externalMigrations('postgres');
    expect(Object.keys(ext)).toEqual(['001_flat_tables']);
    expect(typeof ext['001_flat_tables'].up).toBe('function');
    expect(typeof ext['001_flat_tables'].down).toBe('function');
  });
```

- [ ] **Step 10: Keep bootstrap compiling** — in BOTH `packages/bootstrap/src/db-context.ts:44` and `packages/bootstrap/src/ingest-context.ts:82`, change `createMigrator(externalDb, externalMigrations)` to `createMigrator(externalDb, externalMigrations('postgres'))`. (Task 5 replaces `'postgres'` with the real engine.)

- [ ] **Step 11: Run db + bootstrap tests + typecheck**

Run: `pnpm --filter @openldr/db test && pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/db/src/engine.ts packages/db/src/migrations/external/dialect.ts packages/db/src/migrations/external/dialect.test.ts packages/db/src/migrations/external/001_flat_tables.ts packages/db/src/migrations/external/index.ts packages/db/src/index.ts packages/db/src/migrations/migrations.test.ts packages/bootstrap/src/db-context.ts packages/bootstrap/src/ingest-context.ts
git commit -m "feat(db): dialect-aware external DDL via externalMigrations(engine) (P2-DB-4)"
```

---

## Task 3: `@openldr/db` — dialect-aware FlatWriter upsert (PG onConflict / MSSQL MERGE)

**Files:**
- Modify: `packages/db/src/flat-writer.ts`
- Create: `packages/db/src/flat-writer.test.ts`
- Modify: `packages/bootstrap/src/db-context.ts` (keep compiling — temporary `'postgres'`)
- Modify: `packages/bootstrap/src/ingest-context.ts` (keep compiling — temporary `'postgres'`)

- [ ] **Step 1: Write failing test** — create `packages/db/src/flat-writer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFlatWriter } from './flat-writer';

// A minimal Patient flattens to { table: 'patients', row: {...} } (see flatten/patient.ts).
const patient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

function fakeDb() {
  const exec = { execute: vi.fn(async () => undefined) };
  const insertInto = vi.fn(() => ({
    values: () => ({ onConflict: (cb: (oc: { column: () => { doUpdateSet: () => typeof exec } }) => unknown) => { cb({ column: () => ({ doUpdateSet: () => exec }) }); return exec; } }),
  }));
  const mergeInto = vi.fn(() => ({
    using: () => ({ whenMatched: () => ({ thenUpdateSet: () => ({ whenNotMatched: () => ({ thenInsertValues: () => exec }) }) }) }),
  }));
  return { db: { insertInto, mergeInto } as never, insertInto, mergeInto };
}

describe('createFlatWriter dialect branch', () => {
  it('postgres uses insertInto + onConflict', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    expect(await w.write(patient)).toBe('written');
    expect(insertInto).toHaveBeenCalledWith('patients');
    expect(mergeInto).not.toHaveBeenCalled();
  });
  it('mssql uses mergeInto', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    const w = createFlatWriter(db, 'mssql');
    expect(await w.write(patient)).toBe('written');
    expect(mergeInto).toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
  });
  it('skips non-domain resources', async () => {
    const { db } = fakeDb();
    const w = createFlatWriter(db, 'mssql');
    expect(await w.write({ resourceType: 'Bundle', id: 'b1' })).toBe('skipped');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @openldr/db test -- flat-writer`
Expected: FAIL (createFlatWriter takes 1 arg; no mssql branch).

- [ ] **Step 3: Rewrite `packages/db/src/flat-writer.ts`**

```ts
import { type Kysely, sql } from 'kysely';
import type { ExternalSchema } from './schema/external';
import type { Provenance } from './provenance';
import type { TargetEngine } from './engine';
import { flattenResource } from './flatten/index';

export type WriteResult = 'written' | 'skipped';

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
}

// MSSQL has no ON CONFLICT; use MERGE keyed on id. Behaviour-equivalent to the PG upsert:
// insert-or-update exactly one flat row, idempotent on id.
async function upsertMssql(
  db: Kysely<any>,
  table: string,
  row: Record<string, unknown>,
  updateRow: Record<string, unknown>,
): Promise<void> {
  const cols = Object.keys(row);
  const valuesTuple = sql.join(cols.map((c) => sql`${row[c]}`));
  const sourceCols = sql.raw(cols.join(', '));
  const set = Object.fromEntries(Object.keys(updateRow).map((c) => [c, sql.ref(`src.${c}`)]));
  const insertValues = Object.fromEntries(cols.map((c) => [c, sql.ref(`src.${c}`)]));
  await db
    .mergeInto(`${table} as tgt`)
    .using(sql`(values (${valuesTuple}))`.as(sql`src(${sourceCols})`), (j: any) => j.onRef('tgt.id', '=', 'src.id'))
    .whenMatched()
    .thenUpdateSet(set)
    .whenNotMatched()
    .thenInsertValues(insertValues)
    .execute();
}

export function createFlatWriter(db: Kysely<ExternalSchema>, engine: TargetEngine = 'postgres'): FlatWriter {
  const anyDb = db as unknown as Kysely<any>;
  return {
    async write(resource, provenance = {}) {
      const flat = flattenResource(resource, provenance);
      if (!flat) return 'skipped';
      const { table, row } = flat;
      const updateRow = { ...row };
      delete (updateRow as Record<string, unknown>).id;
      delete (updateRow as Record<string, unknown>).created_at;

      if (engine === 'mssql') {
        await upsertMssql(anyDb, table, row, updateRow);
      } else {
        await anyDb.insertInto(table).values(row).onConflict((oc: any) => oc.column('id').doUpdateSet(updateRow)).execute();
      }
      return 'written';
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @openldr/db test -- flat-writer`
Expected: PASS (3 tests).

- [ ] **Step 5: Keep bootstrap compiling** — in `packages/bootstrap/src/db-context.ts:42` and `packages/bootstrap/src/ingest-context.ts:65`, change `createFlatWriter(externalDb)` to `createFlatWriter(externalDb, 'postgres')`. (Task 5 replaces with the real engine.)

- [ ] **Step 6: Run full db tests + bootstrap typecheck**

Run: `pnpm --filter @openldr/db test && pnpm --filter @openldr/bootstrap typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/flat-writer.ts packages/db/src/flat-writer.test.ts packages/bootstrap/src/db-context.ts packages/bootstrap/src/ingest-context.ts
git commit -m "feat(db): dialect-aware FlatWriter upsert (MSSQL MERGE) (P2-DB-2)"
```

---

## Task 4: `adapter-mssql-store` package

**Files:**
- Create: `packages/adapter-mssql-store/package.json`
- Create: `packages/adapter-mssql-store/tsconfig.json`
- Create: `packages/adapter-mssql-store/src/index.ts`
- Create: `packages/adapter-mssql-store/src/index.test.ts`

- [ ] **Step 1: Create `packages/adapter-mssql-store/package.json`**

```json
{
  "name": "@openldr/adapter-mssql-store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "lint": "echo \"no lint\"" },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/ports": "workspace:*",
    "kysely": "^0.27.5",
    "tarn": "^3.0.2",
    "tedious": "^18.6.1"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/adapter-mssql-store/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: completes; `tedious` + `tarn` resolved. If pnpm reports an ignored build script for `tedious`, add it under `allowBuilds:` in `pnpm-workspace.yaml`, re-run `pnpm install`, and include `pnpm-workspace.yaml` in this task's commit.

- [ ] **Step 4: Write failing test** — create `packages/adapter-mssql-store/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMssqlStore } from './index';

const cfg = { host: '127.0.0.1', port: 1433, database: 'openldr', user: 'sa', password: 'x', encrypt: false, trustServerCertificate: true };

describe('createMssqlStore', () => {
  it('reports up when the ping succeeds', async () => {
    const store = createMssqlStore(cfg, { ping: async () => {} });
    const r = await store.healthCheck();
    expect(r.status).toBe('up');
    await store.close();
  });
  it('reports down when the ping throws', async () => {
    const store = createMssqlStore(cfg, { ping: async () => { throw new Error('ECONNREFUSED'); } });
    const r = await store.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('ECONNREFUSED');
    await store.close();
  });
});
```

- [ ] **Step 5: Run, verify fail**

Run: `pnpm --filter @openldr/adapter-mssql-store test`
Expected: FAIL (module not found).

- [ ] **Step 6: Create `packages/adapter-mssql-store/src/index.ts`**

```ts
import { Kysely, MssqlDialect, sql } from 'kysely';
import * as tarn from 'tarn';
import * as tedious from 'tedious';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

export interface MssqlStoreConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export interface MssqlStoreDeps {
  // Injectable health probe for unit tests; defaults to `select 1` over the real connection.
  ping?: () => Promise<void>;
}

export interface MssqlStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createMssqlStore(cfg: MssqlStoreConfig, deps: MssqlStoreDeps = {}): MssqlStore {
  const dialect = new MssqlDialect({
    tarn: { ...tarn, options: { min: 0, max: 10 } },
    tedious: {
      ...tedious,
      connectionFactory: () =>
        new tedious.Connection({
          server: cfg.host,
          authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
          options: {
            port: cfg.port,
            database: cfg.database,
            encrypt: cfg.encrypt,
            trustServerCertificate: cfg.trustServerCertificate,
          },
        }),
    },
  });
  const db = new Kysely<TargetSchema>({ dialect });
  const ping = deps.ping ?? (async () => { await sql`select 1`.execute(db); });

  return {
    db,
    async transaction(fn) {
      return db.transaction().execute(fn);
    },
    async healthCheck() {
      return probe(ping);
    },
    async close() {
      await db.destroy();
    },
  };
}
```

- [ ] **Step 7: Run, verify pass**

Run: `pnpm --filter @openldr/adapter-mssql-store test && pnpm --filter @openldr/adapter-mssql-store typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/adapter-mssql-store package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(adapter-mssql-store): TargetStorePort over Kysely MssqlDialect (P2-DB-1)"
```

(If `pnpm-workspace.yaml` was not changed in Step 3, drop it from the `git add`.)

---

## Task 5: Bootstrap — `selectTargetStore` seam + thread engine through all contexts

**Files:**
- Create: `packages/bootstrap/src/target-store.ts`
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `packages/bootstrap/src/db-context.ts`
- Modify: `packages/bootstrap/src/ingest-context.ts`
- Modify: `packages/bootstrap/package.json`

- [ ] **Step 1: Add the adapter dependency** — in `packages/bootstrap/package.json` `dependencies`, add (near the other adapters):

```json
    "@openldr/adapter-mssql-store": "workspace:*",
```

Run: `pnpm install`
Expected: completes; the workspace dep links.

- [ ] **Step 2: Create `packages/bootstrap/src/target-store.ts`**

```ts
import type { Config } from '@openldr/config';
import { createDbStore } from '@openldr/adapter-db-store';
import { createMssqlStore } from '@openldr/adapter-mssql-store';
import type { TargetEngine } from '@openldr/db';
import type { TargetStorePort } from '@openldr/ports';

export interface SelectedTargetStore {
  store: TargetStorePort & { close(): Promise<void> };
  engine: TargetEngine;
}

// The composition-root seam (DP-1): the only place that chooses a concrete target-store adapter.
// `engineOverride` lets the CLI `target-store test --engine` probe a specific engine.
export function selectTargetStore(cfg: Config, engineOverride?: TargetEngine): SelectedTargetStore {
  const engine: TargetEngine = engineOverride ?? (cfg.TARGET_STORE_ADAPTER === 'mssql' ? 'mssql' : 'postgres');
  if (engine === 'mssql') {
    return {
      engine,
      store: createMssqlStore({
        host: cfg.MSSQL_HOST!,
        port: cfg.MSSQL_PORT,
        database: cfg.MSSQL_DATABASE!,
        user: cfg.MSSQL_USER!,
        password: cfg.MSSQL_PASSWORD!,
        encrypt: cfg.MSSQL_ENCRYPT,
        trustServerCertificate: cfg.MSSQL_TRUST_SERVER_CERT,
      }),
    };
  }
  return { engine, store: createDbStore({ url: cfg.TARGET_DATABASE_URL! }) };
}
```

- [ ] **Step 3: Use it in `packages/bootstrap/src/index.ts`** (createAppContext):
  - Add import: `import { selectTargetStore } from './target-store';`
  - Replace `const store = createDbStore({ url: cfg.TARGET_DATABASE_URL });` (line ~53) with `const { store } = selectTargetStore(cfg);`
  - Remove the now-unused `createDbStore` import (line 3) if nothing else uses it (createAppContext was its only use in this file).
  - Add the re-export at the bottom: `export * from './target-store';`

- [ ] **Step 4: Use it in `packages/bootstrap/src/db-context.ts`**:
  - Add import: `import { selectTargetStore } from './target-store';`
  - Replace `const externalStore = createDbStore({ url: cfg.TARGET_DATABASE_URL });` with `const { store: externalStore, engine } = selectTargetStore(cfg);`
  - Remove the `createDbStore` import.
  - Replace `createFlatWriter(externalDb, 'postgres')` → `createFlatWriter(externalDb, engine)`.
  - Replace `createMigrator(externalDb, externalMigrations('postgres'))` → `createMigrator(externalDb, externalMigrations(engine))`.

- [ ] **Step 5: Use it in `packages/bootstrap/src/ingest-context.ts`**:
  - Add import: `import { selectTargetStore } from './target-store';`
  - Replace `const externalStore = createDbStore({ url: cfg.TARGET_DATABASE_URL });` with `const { store: externalStore, engine } = selectTargetStore(cfg);`
  - Remove the `createDbStore` import.
  - Replace `createFlatWriter(externalDb, 'postgres')` → `createFlatWriter(externalDb, engine)`.
  - Replace `createMigrator(externalDb, externalMigrations('postgres'))` → `createMigrator(externalDb, externalMigrations(engine))`.

- [ ] **Step 6: Typecheck + depcruise + bootstrap tests**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/bootstrap test && pnpm depcruise`
Expected: PASS. depcruise must stay green (bootstrap is allowed to import `adapter-mssql-store`; no other package may).

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/target-store.ts packages/bootstrap/src/index.ts packages/bootstrap/src/db-context.ts packages/bootstrap/src/ingest-context.ts packages/bootstrap/package.json pnpm-lock.yaml
git commit -m "feat(bootstrap): selectTargetStore seam; thread engine to db (P2-DB-1)"
```

---

## Task 6: CLI — `target-store test --engine`

**Files:**
- Create: `packages/cli/src/target-store.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create `packages/cli/src/target-store.ts`**

```ts
import { loadConfig } from '@openldr/config';
import { selectTargetStore } from '@openldr/bootstrap';
import { errorMessage } from '@openldr/core';
import type { TargetEngine } from '@openldr/db';

export async function runTargetStoreTest(opts: { engine?: string; json: boolean }): Promise<number> {
  let engine: TargetEngine | undefined;
  if (opts.engine !== undefined) {
    if (opts.engine !== 'postgres' && opts.engine !== 'mssql') {
      const msg = `invalid --engine '${opts.engine}' (expected postgres|mssql)`;
      process.stderr.write(`${msg}\n`);
      return 1;
    }
    engine = opts.engine;
  }
  let store: { healthCheck: () => Promise<{ status: string; detail?: string }>; close: () => Promise<void> } | undefined;
  try {
    const cfg = loadConfig();
    const selected = selectTargetStore(cfg, engine);
    store = selected.store;
    const result = await selected.store.healthCheck();
    if (opts.json) {
      process.stdout.write(JSON.stringify({ engine: selected.engine, ...result }, null, 2) + '\n');
    } else {
      process.stdout.write(`target-store [${selected.engine}]: ${result.status}${result.detail ? ` (${result.detail})` : ''}\n`);
    }
    return result.status === 'up' ? 0 : 1;
  } catch (err) {
    if (opts.json) process.stdout.write(JSON.stringify({ status: 'down', error: errorMessage(err) }) + '\n');
    else process.stderr.write(`target-store test failed: ${errorMessage(err)}\n`);
    return 1;
  } finally {
    await store?.close();
  }
}
```

- [ ] **Step 2: Register the command in `packages/cli/src/index.ts`**:
  - Add import near the other `run*` imports: `import { runTargetStoreTest } from './target-store';`
  - Add the command block (place it after the `db` command group, before `forms`):

```ts
const targetStore = program.command('target-store').description('Target warehouse (Postgres/SQL Server) tools');
targetStore
  .command('test')
  .description('Probe the target store connection')
  .option('--engine <engine>', 'postgres|mssql (defaults to TARGET_STORE_ADAPTER)')
  .option('--json', 'emit machine-readable JSON', false)
  .action(async (opts: { engine?: string; json: boolean }) => {
    process.exitCode = await runTargetStoreTest(opts);
  });
```

- [ ] **Step 3: Typecheck + build:check (the artifact must RUN — repo convention)**

Run: `pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build:check`
Expected: PASS; `build:check` builds the CLI bundle and runs `node dist/index.js --help` without a "Dynamic require of" crash. Confirm `target-store` appears in `--help` output.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/target-store.ts packages/cli/src/index.ts
git commit -m "feat(cli): target-store test --engine (P2-DB, PRD §3)"
```

---

## Task 7: Dev infra — optional `mssql` compose profile + `.env.example`

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add the optional service to `docker-compose.yml`** (append under `services:`, after `keycloak`):

```yaml
  # Optional SQL Server target store. Off by default; start with:
  #   docker compose --profile mssql up -d
  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    profiles: ['mssql']
    environment:
      ACCEPT_EULA: 'Y'
      MSSQL_SA_PASSWORD: ${MSSQL_PASSWORD:-Openldr_Local_2026!}
    ports:
      - '1433:1433'
```

- [ ] **Step 2: Add MSSQL vars to `.env.example`** (append at the end):

```bash

# --- Target store engine ---
# pg (default) writes the analytics warehouse to Postgres (TARGET_DATABASE_URL).
# mssql writes it to SQL Server (MSSQL_* below); start it with: docker compose --profile mssql up -d
TARGET_STORE_ADAPTER=pg
# MSSQL_HOST=127.0.0.1
# MSSQL_PORT=1433
# MSSQL_DATABASE=openldr
# MSSQL_USER=sa
# MSSQL_PASSWORD=Openldr_Local_2026!
# MSSQL_ENCRYPT=false
# MSSQL_TRUST_SERVER_CERT=true
```

- [ ] **Step 3: Validate compose file**

Run: `docker compose config --profile mssql >/dev/null && echo "compose OK"`
Expected: `compose OK` (the merged config — including the git-ignored override — parses).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: optional mssql docker-compose profile + .env example (P2-DB)"
```

---

## Task 8: Live multi-driver acceptance (P2-NFR-3) + memory + finish branch

**Files:** none (verification + memory).

**Note on host port:** the probe used host port 11433 (the committed compose maps 1433:1433). If 1433 is free use it; otherwise add an `mssql` remap to the git-ignored `docker-compose.override.yml` and set `MSSQL_PORT` to match. The local `.env` must set `TARGET_STORE_ADAPTER=mssql` + the `MSSQL_*` values for the MSSQL run, and keep `INTERNAL_DATABASE_URL` (Postgres) + `TARGET_DATABASE_URL` (for switching back).

- [ ] **Step 1: Start SQL Server + create the database**

```bash
docker compose --profile mssql up -d
# wait until ready, then create the openldr database (tools path on the 2022 image):
docker exec $(docker compose ps -q mssql) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Openldr_Local_2026!" -No -Q "IF DB_ID('openldr') IS NULL CREATE DATABASE openldr"
```
Expected: SQL Server ready; `openldr` database created (no error). If the tools path differs, use `/opt/mssql-tools/bin/sqlcmd` and drop `-No`.

- [ ] **Step 2: Migrate the external schema into MSSQL**

With `.env` set to `TARGET_STORE_ADAPTER=mssql` + `MSSQL_*`:
Run: `pnpm openldr db migrate`
Expected: internal (Postgres) + external (SQL Server) migrate to latest with no error; the 7 flat tables exist in the `openldr` MSSQL database.

- [ ] **Step 3: Health-check the MSSQL target store**

Run: `pnpm openldr target-store test --engine mssql --json`
Expected: `{"engine":"mssql","status":"up"}`.

- [ ] **Step 4: Ingest WHONET into the MSSQL target (idempotency)**

```bash
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite   # run AGAIN
```
Expected: both ingests succeed; the second does NOT duplicate rows (MERGE upsert). Verify row counts are stable, e.g.:
`docker exec $(docker compose ps -q mssql) /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Openldr_Local_2026!" -No -d openldr -Q "SELECT COUNT(*) FROM observations"`
Expected: the same count after the first and second ingest (no doubling).

- [ ] **Step 5: Run reports against MSSQL (P2-DB-3)**

Run: `pnpm openldr report run amr-resistance --json`
Expected: AMP row shows `percentR: 100` — identical to the Postgres result. Also run `pnpm openldr report run patient-demographics --json` and confirm it returns without a Kysely MSSQL error. If any report throws a dialect error (limit/offset, count type), fix it dialect-portably in `packages/reporting/src/**` (no raw SQL), commit as `fix(reporting): <quirk> portable across pg/mssql (P2-DB-3)`, and re-run.

- [ ] **Step 6: Confirm no Postgres regression**

Set `.env` back to `TARGET_STORE_ADAPTER=pg`, then:
Run: `pnpm openldr db reset && pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm && pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite && pnpm openldr report run amr-resistance --json`
Expected: AMP `percentR: 100` on Postgres — the original path still works.

- [ ] **Step 7: Full repo gates**

Run: `pnpm typecheck && pnpm test && pnpm depcruise && pnpm build:check`
Expected: all PASS. `pnpm test` stays stack-free (no live DB) and excludes E2E.

- [ ] **Step 8: Update the build-plan memory** — record Phase-2 sub-project 1 done, the multi-driver acceptance result, and any carry-forward (e.g. MSSQL `varchar(450)` PK, encryption defaults, the openldr-DB create step). File: `C:\Users\Fredrick\.claude\projects\D--Projects-Repositories-openldr-ce\memory\openldr-ce-build-plan.md`. Cross-link `[[mssql-toolchain]]`.

- [ ] **Step 9: Finish the branch** — use superpowers:finishing-a-development-branch (merge to `main`).

---

## Self-review notes (author)

- **Spec coverage:** §3 engine seam → Task 2 (engine.ts) + Task 5 (threading); §4 adapter-mssql-store → Task 4; §5 dialect DDL → Task 2; §6 FlatWriter MERGE → Task 3; §7 config+bootstrap → Tasks 1 & 5; §8 reporting verification → Task 8 step 5; §9 dev infra → Task 7; §10 CLI → Task 6; §11 testing (unit, no live DB) → Tasks 1-4 tests; §12 live acceptance → Task 8.
- **Refinement vs spec §11:** unit tests assert dialect type-helper strings (Task 2) and FlatWriter branch selection via a fake db (Task 3) rather than compiling SQL strings — this keeps `@openldr/db` free of any driver dependency. Full per-dialect SQL is validated by the live acceptance (Task 8). Adapter health is unit-tested via an injectable `ping` (Task 4), mirroring `adapter-db-store`'s `deps.pool`.
- **Order safety:** Task 2 converts `externalMigrations` to a factory and Task 3 changes the FlatWriter signature; both update bootstrap call sites to a temporary `'postgres'` literal so every task stays green, and Task 5 replaces those with the real `engine`.
- **No placeholders:** every file has full content; every run step has an expected result.
- **Type/name consistency:** `TargetEngine = 'postgres'|'mssql'`; config enum `'pg'|'mssql'` mapped in `selectTargetStore`; `externalMigrations(engine)`, `createFlatWriter(db, engine)`, `createMssqlStore(cfg, deps)`, `selectTargetStore(cfg, engineOverride)`, `runTargetStoreTest(opts)` — consistent across tasks.
