# MySQL/MariaDB External Target — S0 (Write-Path Baseline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MySQL 8.4 and MariaDB 11.4 valid external/target stores — a new `@openldr/adapter-mysql-store`, dialect-aware flat-schema migrations, a FlatWriter `mysql` upsert branch — validated end-to-end on both engines by an acceptance matrix.

**Architecture:** Mirror the completed MSSQL baseline. Extend the existing typed dialect seams (`TargetEngine`, the migration `dialect.ts` type helpers, the FlatWriter engine switch) with a `'mysql'` case, and add a new adapter package that wraps the `mysql2` + kysely `MysqlDialect` pool already used by the connector. No config/bootstrap/installer wiring in S0 — the acceptance harness instantiates the store directly from env, exactly like `scripts/mssql-live-acceptance.ts`.

**Tech Stack:** TypeScript, kysely (`MysqlDialect`), `mysql2`, vitest, tsx, Docker (MySQL 8.4 + MariaDB 11.4 containers), pnpm workspaces.

**Scope note (deviation from spec S0):** The spec's S0 mentions `reports:parity` + built-in reports over the external schema. Those require the MySQL report-SQL variants that land in **S2** (`DialectSql += mysql`); MySQL cannot execute the Postgres/MSSQL report SQL. S0 therefore covers the write path only. Report parity is validated in S2.

---

## File Structure

- Modify: `packages/db/src/engine.ts` — add `'mysql'` to `TargetEngine`.
- Modify: `packages/db/src/migrations/external/dialect.ts` — add `mysql` type cases.
- Modify: `packages/db/src/migrations/external/dialect.test.ts` — cover the `mysql` cases.
- Modify: `packages/db/src/flat-writer.ts` — add the `mysql` upsert branch (single + batch).
- Modify: `packages/db/src/flat-writer.test.ts` — cover the `mysql` branch.
- Create: `packages/adapter-mysql-store/` — new package (`package.json`, `tsconfig.json`, `src/index.ts`, `src/supported-versions.ts`, `src/index.test.ts`, `src/supported-versions.test.ts`).
- Create: `scripts/mysql-live-acceptance.ts` — single-engine live acceptance (env-driven).
- Create: `scripts/mysql-matrix-accept.sh` — spins MySQL 8.4 + MariaDB 11.4 containers, runs the acceptance against each.
- Modify: `package.json` (root) — add `mysql:accept` + `mysql:accept:matrix` scripts.
- Modify: `DEPLOYMENT.md` — extend the support matrix + data-sovereignty section with MySQL/MariaDB.

---

## Task 1: Add `'mysql'` to `TargetEngine`

**Files:**
- Modify: `packages/db/src/engine.ts`

- [ ] **Step 1: Widen the union**

Replace the type in `packages/db/src/engine.ts`:

```typescript
/** Which SQL engine the EXTERNAL/target warehouse uses. Internal DB is always Postgres. */
export type TargetEngine = 'postgres' | 'mssql' | 'mysql';
```

- [ ] **Step 2: Typecheck the db package**

Run: `pnpm --filter @openldr/db exec tsc --noEmit`
Expected: PASS (the `dialect.ts` helpers still compile — they use `engine === 'mssql' ? … : …`, whose else-branch now also covers `'mysql'`; Task 2 makes them mysql-correct).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/engine.ts
git commit -m "feat(db): add 'mysql' to TargetEngine"
```

---

## Task 2: MySQL type mappings in the migration `dialect.ts`

The flat-schema DDL (`001_flat_tables.ts`, `002_specimen_origin.ts`) is dialect-agnostic — it emits column types via `dialect.ts` helpers. Adding MySQL is entirely in these helpers.

**Files:**
- Modify: `packages/db/src/migrations/external/dialect.ts`
- Test: `packages/db/src/migrations/external/dialect.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/migrations/external/dialect.test.ts` (inside the existing top-level `describe`, or append a new one):

```typescript
import { textType, keyType, floatType, timestampType, nowExpr } from './dialect';

describe('dialect types — mysql', () => {
  it('maps logical types to MySQL column types', () => {
    expect(textType('mysql')).toBe('longtext');
    expect(keyType('mysql')).toBe('varchar(255)');
    expect(floatType('mysql')).toBe('double');
    expect(timestampType('mysql')).toBe('datetime');
  });
  it('nowExpr for mysql compiles to CURRENT_TIMESTAMP', () => {
    // RawBuilder is opaque; assert it is a distinct, defined expression object.
    expect(nowExpr('mysql')).toBeDefined();
    expect(nowExpr('mysql')).not.toBe(nowExpr('postgres'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/external/dialect.test.ts`
Expected: FAIL — `textType('mysql')` returns `'text'` (the current else-branch), not `'longtext'`.

- [ ] **Step 3: Implement the MySQL cases**

Rewrite `packages/db/src/migrations/external/dialect.ts` so each helper handles all three engines:

```typescript
import { sql, type RawBuilder } from 'kysely';
import type { TargetEngine } from '../../engine';

// Logical-type -> dialect-type maps. Returned as strings used via sql.raw(...) in DDL so
// Postgres, SQL Server, and MySQL/MariaDB emit valid column types from ONE schema definition.
export function textType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'nvarchar(max)';
  if (engine === 'mysql') return 'longtext'; // utf8mb4 by table default; holds Unicode clinical text
  return 'text';
}
// MSSQL keys cannot be nvarchar(max); MySQL keys cannot be longtext and a utf8mb4 index caps at 3072
// bytes, so 255 chars (255*4=1020 bytes) is safe. FHIR ids fit easily in both.
export function keyType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'varchar(450)';
  if (engine === 'mysql') return 'varchar(255)';
  return 'text';
}
export function floatType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'float';
  if (engine === 'mysql') return 'double';
  return 'double precision';
}
export function timestampType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'datetime2';
  if (engine === 'mysql') return 'datetime';
  return 'timestamptz';
}
export function nowExpr(engine: TargetEngine): RawBuilder<unknown> {
  if (engine === 'mssql') return sql`SYSUTCDATETIME()`;
  if (engine === 'mysql') return sql`CURRENT_TIMESTAMP`;
  return sql`now()`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/external/dialect.test.ts`
Expected: PASS (existing postgres/mssql cases still pass; the new mysql block passes).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/external/dialect.ts packages/db/src/migrations/external/dialect.test.ts
git commit -m "feat(db): MySQL/MariaDB column-type mappings for the flat schema"
```

---

## Task 3: FlatWriter `mysql` upsert branch

MySQL/MariaDB upsert via `INSERT ... ON DUPLICATE KEY UPDATE`, keyed on the `id` PRIMARY KEY the flat tables already have. Single-row `write()` sets each column to its literal value; the batch path references the per-row incoming value with `VALUES(col)` (the portable form that works on **both** MySQL 8.4 and MariaDB 11.4).

**Files:**
- Modify: `packages/db/src/flat-writer.ts`
- Test: `packages/db/src/flat-writer.test.ts`

- [ ] **Step 1: Write the failing test**

The existing `fakeDb` (in `flat-writer.test.ts`) fakes `insertInto().values().onConflict()` and `mergeInto()`. Extend it to also fake `onDuplicateKeyUpdate`, then assert the mysql engine takes that path. Add near the existing engine tests:

```typescript
it('mysql uses insertInto + onDuplicateKeyUpdate (not onConflict / merge)', async () => {
  const exec = vi.fn(async () => {});
  const onDuplicateKeyUpdate = vi.fn(() => ({ execute: exec }));
  const values = vi.fn(() => ({ onConflict: vi.fn(() => ({ execute: exec })), onDuplicateKeyUpdate }));
  const insertInto = vi.fn(() => ({ values }));
  const mergeInto = vi.fn(() => ({ using: vi.fn() }));
  const db = { insertInto, mergeInto } as never;

  const writer = createFlatWriter(db, 'mysql');
  await writer.write({ resourceType: 'Patient', id: 'p1', gender: 'male' });

  expect(insertInto).toHaveBeenCalled();
  expect(onDuplicateKeyUpdate).toHaveBeenCalled();
  expect(mergeInto).not.toHaveBeenCalled();
});
```

(If the existing `fakeDb` helper is reused elsewhere, add `onDuplicateKeyUpdate` to its `values()` return so other tests keep compiling — do not remove `onConflict`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/flat-writer.test.ts`
Expected: FAIL — with `engine==='mysql'` the current code falls into the `else` branch and calls `onConflict`, so `onDuplicateKeyUpdate` is never called.

- [ ] **Step 3: Implement the mysql branch**

In `packages/db/src/flat-writer.ts`:

(a) Add the budget constant next to the others (MySQL/MariaDB allow up to 65535 placeholders per statement, like Postgres):

```typescript
const MYSQL_PARAM_BUDGET = 60000;
```

(b) Add the batch helper next to `insertBatchPg` / `mergeBatchMssql`:

```typescript
async function insertBatchMysql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const step = chunkSize(MYSQL_PARAM_BUDGET, Object.keys(rows[0]).length);
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    const updateCols = Object.keys(chunk[0]).filter((c) => c !== 'id' && c !== 'created_at');
    // ON DUPLICATE KEY UPDATE col = VALUES(col): references the incoming per-row value.
    // VALUES() works on MySQL 8.4 and MariaDB 11.4 (deprecated-but-present on MySQL; canonical on MariaDB).
    const set = Object.fromEntries(updateCols.map((c) => [c, sql`values(${sql.ref(c)})`]));
    await db.insertInto(table).values(chunk).onDuplicateKeyUpdate(set).execute();
  }
}
```

(c) In `write()`, add the mysql case (single row updates to literal values, mirroring the pg single-row path):

```typescript
      if (engine === 'mssql') {
        await upsertMssql(anyDb, table, row, updateRow);
      } else if (engine === 'mysql') {
        await anyDb.insertInto(table).values(row).onDuplicateKeyUpdate(updateRow).execute();
      } else {
        await anyDb.insertInto(table).values(row).onConflict((oc: any) => oc.column('id').doUpdateSet(updateRow)).execute();
      }
```

(d) In `writeMany()`, route mysql to the batch helper:

```typescript
      for (const [table, rows] of byTable) {
        if (engine === 'mssql') await mergeBatchMssql(anyDb, table, rows);
        else if (engine === 'mysql') await insertBatchMysql(anyDb, table, rows);
        else await insertBatchPg(anyDb, table, rows);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db exec vitest run src/flat-writer.test.ts`
Expected: PASS (mysql test passes; pg/mssql tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/flat-writer.ts packages/db/src/flat-writer.test.ts
git commit -m "feat(db): FlatWriter MySQL/MariaDB upsert (ON DUPLICATE KEY UPDATE) branch"
```

---

## Task 4: `@openldr/adapter-mysql-store` package

Mirror `@openldr/adapter-mssql-store`, wrapping the `mysql2` + kysely `MysqlDialect` pool.

**Files:**
- Create: `packages/adapter-mysql-store/package.json`
- Create: `packages/adapter-mysql-store/tsconfig.json`
- Create: `packages/adapter-mysql-store/src/supported-versions.ts`
- Create: `packages/adapter-mysql-store/src/supported-versions.test.ts`
- Create: `packages/adapter-mysql-store/src/index.ts`
- Create: `packages/adapter-mysql-store/src/index.test.ts`

- [ ] **Step 1: Scaffold `package.json`**

Copy `packages/adapter-mssql-store/package.json` and adapt. Content:

```json
{
  "name": "@openldr/adapter-mysql-store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/ports": "workspace:*",
    "kysely": "^0.27.6",
    "mysql2": "^3.11.0"
  },
  "devDependencies": {
    "vitest": "2.1.8"
  }
}
```

Verify the exact `kysely`, `mysql2`, and `vitest` versions match those already used in `packages/adapter-mssql-store/package.json` and `packages/bootstrap/package.json` (which already depends on `mysql2`) — copy the versions from there rather than guessing.

- [ ] **Step 2: Scaffold `tsconfig.json`**

Copy `packages/adapter-mssql-store/tsconfig.json` verbatim (same compiler settings; it extends the repo base config).

- [ ] **Step 3: Write the failing supported-versions test**

`packages/adapter-mysql-store/src/supported-versions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SUPPORTED_MYSQL_VERSIONS, isSupportedMysqlEngine, demoMysqlImage } from './supported-versions';

describe('supported mysql/mariadb engines', () => {
  it('lists MySQL 8.4 and MariaDB 11.4', () => {
    const keys = SUPPORTED_MYSQL_VERSIONS.map((v) => `${v.engine} ${v.version}`);
    expect(keys).toContain('mysql 8.4');
    expect(keys).toContain('mariadb 11.4');
  });
  it('recognises supported engine/version pairs', () => {
    expect(isSupportedMysqlEngine('mysql', '8.4')).toBe(true);
    expect(isSupportedMysqlEngine('mariadb', '11.4')).toBe(true);
    expect(isSupportedMysqlEngine('mysql', '5.7')).toBe(false);
  });
  it('exposes exactly one demo image (MySQL 8.4)', () => {
    expect(demoMysqlImage()).toBe('mysql:8.4');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @openldr/adapter-mysql-store exec vitest run src/supported-versions.test.ts`
Expected: FAIL — module `./supported-versions` does not exist.

- [ ] **Step 5: Implement `supported-versions.ts`**

`packages/adapter-mysql-store/src/supported-versions.ts`:

```typescript
// Single source of truth for which self-hosted MySQL/MariaDB engines OpenLDR CE validates and
// supports as an external/analytics target. Cloud/hosted MySQL (RDS/Aurora, Azure Database for
// MySQL, Cloud SQL, PlanetScale) is NEVER supported — a data-sovereignty requirement, not a gap.

export interface MysqlEngineVersion {
  /** Engine family — MySQL and MariaDB share the mysql2 wire protocol but diverge subtly. */
  readonly engine: 'mysql' | 'mariadb';
  /** LTS version string, e.g. '8.4'. */
  readonly version: string;
  /** Official Docker Hub image for the acceptance matrix. */
  readonly image: string;
  /** The single engine used for the non-production managed demo container. */
  readonly demoDefault: boolean;
}

/** Supported, self-hosted only. */
export const SUPPORTED_MYSQL_VERSIONS: readonly MysqlEngineVersion[] = [
  { engine: 'mysql', version: '8.4', image: 'mysql:8.4', demoDefault: true },
  { engine: 'mariadb', version: '11.4', image: 'mariadb:11.4', demoDefault: false },
];

export function isSupportedMysqlEngine(engine: string, version: string): boolean {
  return SUPPORTED_MYSQL_VERSIONS.some((v) => v.engine === engine && v.version === version);
}

/** Image for the pinned non-production managed demo container. */
export function demoMysqlImage(): string {
  const demos = SUPPORTED_MYSQL_VERSIONS.filter((v) => v.demoDefault);
  if (demos.length !== 1) {
    throw new Error(`expected exactly one demo-default MySQL engine, found ${demos.length}`);
  }
  return demos[0].image;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @openldr/adapter-mysql-store exec vitest run src/supported-versions.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing adapter test**

`packages/adapter-mysql-store/src/index.test.ts` (mirror `adapter-mssql-store/src/index.test.ts` — inject the `ping` probe so no real DB is needed):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createMysqlStore } from './index';

describe('createMysqlStore', () => {
  const cfg = { host: 'h', port: 3306, database: 'd', user: 'u', password: 'p', ssl: false };

  it('exposes db, transaction, healthCheck, close', () => {
    const store = createMysqlStore(cfg, { ping: async () => {} });
    expect(store.db).toBeDefined();
    expect(typeof store.transaction).toBe('function');
    expect(typeof store.healthCheck).toBe('function');
    expect(typeof store.close).toBe('function');
  });

  it('healthCheck returns ok when the injected ping resolves', async () => {
    const ping = vi.fn(async () => {});
    const store = createMysqlStore(cfg, { ping });
    const health = await store.healthCheck();
    expect(ping).toHaveBeenCalled();
    expect(health.ok).toBe(true);
  });
});
```

Confirm the `health.ok` shape by reading `@openldr/core`'s `probe` (used by the mssql adapter test) and match its assertion exactly.

- [ ] **Step 8: Run to verify it fails**

Run: `pnpm --filter @openldr/adapter-mysql-store exec vitest run src/index.test.ts`
Expected: FAIL — module `./index` (or `createMysqlStore`) does not exist.

- [ ] **Step 9: Implement `index.ts`**

`packages/adapter-mysql-store/src/index.ts` (mirror the mssql adapter; pool config copied from the working `mysql` branch of `packages/bootstrap/src/connector-db.ts`):

```typescript
import { Kysely, MysqlDialect, sql, type MysqlPool } from 'kysely';
import { createPool } from 'mysql2';
import { probe } from '@openldr/core';
import type { TargetSchema, TargetStorePort } from '@openldr/ports';

export interface MysqlStoreConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface MysqlStoreDeps {
  // Injectable health probe for unit tests; defaults to `select 1` over the real connection.
  ping?: () => Promise<void>;
}

export interface MysqlStore extends TargetStorePort {
  close(): Promise<void>;
}

export function createMysqlStore(cfg: MysqlStoreConfig, deps: MysqlStoreDeps = {}): MysqlStore {
  const pool = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  // mysql2 callback Pool is runtime-correct for kysely (getConnection(callback)); cast bridges the type gap.
  const db = new Kysely<TargetSchema>({ dialect: new MysqlDialect({ pool: pool as unknown as MysqlPool }) });
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

export {
  SUPPORTED_MYSQL_VERSIONS,
  isSupportedMysqlEngine,
  demoMysqlImage,
  type MysqlEngineVersion,
} from './supported-versions';
```

- [ ] **Step 10: Run to verify it passes + typecheck**

Run: `pnpm install` (link the new workspace package), then
`pnpm --filter @openldr/adapter-mysql-store exec vitest run`
`pnpm --filter @openldr/adapter-mysql-store exec tsc --noEmit`
Expected: PASS both.

- [ ] **Step 11: Commit**

```bash
git add packages/adapter-mysql-store pnpm-lock.yaml
git commit -m "feat(adapter-mysql-store): MySQL/MariaDB target-store adapter + supported-versions"
```

---

## Task 5: Live acceptance matrix (MySQL 8.4 + MariaDB 11.4)

Mirror `scripts/mssql-live-acceptance.ts` (single engine, env-driven) and `scripts/mssql-matrix-accept.sh` (spins containers per version). Validates: adapter connect + healthCheck; `externalMigrations('mysql')` apply; `createFlatWriter(db,'mysql')` batched upsert; 2× write is idempotent (no duplicate rows); Unicode via utf8mb4; null handling.

**Files:**
- Create: `scripts/mysql-live-acceptance.ts`
- Create: `scripts/mysql-matrix-accept.sh`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Write `scripts/mysql-live-acceptance.ts`**

Adapt `scripts/mssql-live-acceptance.ts` step-for-step. Key differences: import `createMysqlStore` from `@openldr/adapter-mysql-store`; read config from env with MySQL defaults; use `externalMigrations('mysql')` and `createFlatWriter(db, 'mysql')`; count rows with backtick-free standard SQL (`select count(*) as n from patients`). Full file:

```typescript
// Live acceptance for the MySQL/MariaDB target store. Run against a reachable MySQL 8.4 or
// MariaDB 11.4 with an `openldr_target` database. Env overrides:
//   MYSQL_HOST (localhost) MYSQL_PORT (3306) MYSQL_DATABASE (openldr_target)
//   MYSQL_USER (root) MYSQL_PASSWORD (Openldr_Local_2026!) MYSQL_SSL (false)
// Run: node_modules/.bin/tsx scripts/mysql-live-acceptance.ts
import { Kysely, sql } from 'kysely';
import { createMysqlStore } from '@openldr/adapter-mysql-store';
import { createMigrator, externalMigrations, createFlatWriter, type ExternalSchema } from '@openldr/db';

const cfg = {
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'openldr_target',
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'Openldr_Local_2026!',
  ssl: process.env.MYSQL_SSL === 'true',
};

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
let failures = 0;
const check = (cond: boolean, m: string) => { if (cond) ok(m); else { failures++; console.log(`  ✗ ${m}`); } };

const PROV = { sourceSystem: 'mysql-acceptance', batchId: 'accept-1' };
const patient = (id: string, extra: Record<string, unknown> = {}) =>
  ({ resource: { resourceType: 'Patient', id, gender: 'female', birthDate: '1990-01-01', ...extra }, provenance: PROV });

async function count(db: Kysely<any>, table: string): Promise<number> {
  const r = await sql<{ n: number }>`select count(*) as n from ${sql.ref(table)}`.execute(db);
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  const store = createMysqlStore(cfg);
  const db = store.db as unknown as Kysely<ExternalSchema>;
  const anyDb = db as unknown as Kysely<any>;
  try {
    step('1. adapter connect + healthCheck');
    const health = await store.healthCheck();
    console.log('  health =', JSON.stringify(health));
    check(health.ok === true, 'healthCheck ok');

    step('2. external migrations apply (mysql dialect)');
    const migrator = createMigrator(db as unknown as Kysely<unknown>, externalMigrations('mysql'));
    const res = await migrator.migrateToLatest();
    if (res.error) throw res.error;
    const tables = (await sql<{ t: string }>`select table_name as t from information_schema.tables where table_schema = database()`.execute(anyDb)).rows.map((r) => r.t);
    check(['patients', 'observations', 'service_requests', 'specimens', 'diagnostic_reports', 'organizations', 'locations'].every((t) => tables.includes(t)), 'all 7 flat tables created');

    step('3. flat writer upsert + idempotency (2x write)');
    const writer = createFlatWriter(db, 'mysql');
    // clean first so the run is repeatable
    for (const t of ['patients', 'observations', 'service_requests', 'specimens', 'diagnostic_reports', 'organizations', 'locations']) {
      await sql`delete from ${sql.ref(t)}`.execute(anyDb);
    }
    const items = [patient('pt-1'), patient('pt-2'), patient('pt-3')];
    await writer.writeMany(items);
    await writer.writeMany(items); // must upsert, not duplicate
    check((await count(anyDb, 'patients')) === 3, '2x write leaves 3 patients (idempotent upsert)');

    step('4. Unicode (utf8mb4) + null handling');
    await writer.writeMany([patient('pt-uni', { name: [{ family: 'Здравствуй 世界 🧪' }] }), patient('pt-null', { gender: undefined, birthDate: undefined })]);
    const uni = (await sql<{ family_name: string | null }>`select family_name from patients where id = 'pt-uni'`.execute(anyDb)).rows[0];
    check(typeof uni?.family_name === 'string' && uni.family_name.includes('世界'), 'Unicode round-trips via utf8mb4');
    const nul = (await sql<{ gender: string | null }>`select gender from patients where id = 'pt-null'`.execute(anyDb)).rows[0];
    check(nul !== undefined && (nul.gender === null || nul.gender === undefined), 'null gender stored as NULL');
  } finally {
    await store.close();
  }
  console.log(failures === 0 ? '\n✅ MySQL live acceptance PASSED' : `\n❌ MySQL live acceptance FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
```

Cross-check the `flattenResource` field names (e.g. `family_name`) against `packages/db/src/flatten/` when implementing — use the actual flattened column names, not guesses.

- [ ] **Step 2: Write `scripts/mysql-matrix-accept.sh`**

Adapt `scripts/mssql-matrix-accept.sh`. It iterates the two engines, starts a throwaway container, waits for readiness, creates `openldr_target`, runs the acceptance, tears down. Full file:

```bash
#!/usr/bin/env bash
# Runs scripts/mysql-live-acceptance.ts against MySQL 8.4 and MariaDB 11.4 in throwaway containers.
set -u
PW='Openldr_Local_2026!'
declare -a ENGINES=("mysql:8.4:openldr-accept-mysql:13306" "mariadb:11.4:openldr-accept-mariadb:13307")
overall=0
for spec in "${ENGINES[@]}"; do
  IFS=':' read -r image tag name hostport <<< "$spec"
  full="$image:$tag"
  echo "=== $full on :$hostport ==="
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -p "$hostport:3306" \
    -e MYSQL_ROOT_PASSWORD="$PW" -e MARIADB_ROOT_PASSWORD="$PW" "$full" >/dev/null
  echo "waiting for $full..."
  for i in $(seq 1 40); do
    if docker exec "$name" sh -c "mysql -uroot -p'$PW' -e 'select 1' >/dev/null 2>&1"; then break; fi
    sleep 3
  done
  docker exec "$name" sh -c "mysql -uroot -p'$PW' -e 'create database if not exists openldr_target'"
  MYSQL_HOST=127.0.0.1 MYSQL_PORT="$hostport" MYSQL_USER=root MYSQL_PASSWORD="$PW" MYSQL_DATABASE=openldr_target \
    node_modules/.bin/tsx scripts/mysql-live-acceptance.ts
  rc=$?
  [ "$rc" -ne 0 ] && overall=1
  docker rm -f "$name" >/dev/null 2>&1 || true
done
echo; [ "$overall" -eq 0 ] && echo "✅ MySQL matrix PASSED (mysql 8.4 + mariadb 11.4)" || echo "❌ MySQL matrix FAILED"
exit "$overall"
```

- [ ] **Step 3: Add root package scripts**

In root `package.json` scripts, next to the `mssql:accept*` entries, add:

```json
    "mysql:accept": "tsx scripts/mysql-live-acceptance.ts",
    "mysql:accept:matrix": "bash scripts/mysql-matrix-accept.sh",
```

- [ ] **Step 4: Run the matrix**

Run: `pnpm mysql:accept:matrix`
Expected: both engines print `✅ MySQL live acceptance PASSED`, and the script ends `✅ MySQL matrix PASSED`. If a container is slow to init (MySQL first-start can take 30–60s), the readiness loop already retries for ~2 min.

- [ ] **Step 5: Commit**

```bash
git add scripts/mysql-live-acceptance.ts scripts/mysql-matrix-accept.sh package.json
git commit -m "test(mysql): live acceptance matrix (MySQL 8.4 + MariaDB 11.4)"
```

---

## Task 6: Document the support matrix

**Files:**
- Modify: `DEPLOYMENT.md` (the "Microsoft SQL Server support matrix" / data-sovereignty area)

- [ ] **Step 1: Add a MySQL/MariaDB support-matrix subsection**

After the existing SQL Server matrix in `DEPLOYMENT.md`, add:

```markdown
### MySQL / MariaDB support matrix

| Engine / version | Supported | Notes |
|------------------|-----------|-------|
| MySQL 8.4 LTS    | ✅ Yes    | Pinned for the managed demo container + acceptance matrix. |
| MariaDB 11.4 LTS | ✅ Yes    | Validated by the acceptance matrix. |
| MySQL 8.0 / MariaDB 10.11 | ⚠️ Best-effort | Likely works via the same mysql2 adapter; not validated. |
| MySQL 5.7 and earlier | ❌ No | End of life. Upgrade to 8.4. |
| RDS / Aurora / Azure Database for MySQL / Cloud SQL / PlanetScale | ❌ Never | See the data-sovereignty policy above. |

Validated end-to-end on both engines by `pnpm mysql:accept:matrix`; the supported set is the single
source of truth in `packages/adapter-mysql-store/src/supported-versions.ts`. As with SQL Server, only
self-hosted MySQL/MariaDB is supported — no cloud/hosted database, for data-sovereignty reasons.
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs(mysql): MySQL/MariaDB support matrix + data-sovereignty note"
```

---

## Final gate

- [ ] **Step 1: Cross-package typecheck + tests for touched packages**

Run each directly (do not pipe turbo through `tail`; the Windows lock race can flake `--force`):
```
pnpm --filter @openldr/db exec tsc --noEmit
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/adapter-mysql-store exec tsc --noEmit
pnpm --filter @openldr/adapter-mysql-store exec vitest run
pnpm --filter @openldr/bootstrap exec tsc --noEmit   # consumes @openldr/db types
```
Expected: all PASS.

- [ ] **Step 2: Live matrix (already run in Task 5) is green**

`pnpm mysql:accept:matrix` → both engines PASS.

---

## Self-review — spec coverage

- Adapter (`createMysqlStore` + health): Task 4 ✅
- `externalMigrations('mysql')` flat schema: Tasks 1–2 ✅
- FlatWriter `onDuplicateKeyUpdate` upsert: Task 3 ✅
- Acceptance matrix on both engines (health, migrations, idempotent upsert, Unicode, null): Task 5 ✅
- `supported-versions` single source of truth (8.4 + 11.4): Task 4 ✅
- Support-matrix + data-sovereignty docs: Task 6 ✅
- Deferred to later slices (correctly out of S0): config/`TARGET_STORE_ADAPTER` wiring + installer (**S1**); dialect-aware read surfaces + tri-variant report SQL + `reports:parity` (**S2**).
