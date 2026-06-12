# Eventing + Ingest Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `event-bus` adapter's `publish`/`subscribe` stubs and the `@openldr/ingest` placeholder with a working pipeline: Postgres outbox eventing (publish + drain + worker + retry/backoff), a `Converter` abstraction with two built-ins, `acceptPayload`/`handleIngestEvent` orchestration (blob → event → convert → `persistResource` with batch-id provenance + graceful failure), composition wiring, and `ingest`/`pipeline`/`queue`/`provenance audit` CLI.

**Architecture:** `adapter-event-bus` implements the real `EventingPort` over an `outbox_events` table (raw SQL, `FOR UPDATE SKIP LOCKED` claim, exponential backoff). `@openldr/ingest` orchestrates accept→event→convert→persist, reusing 2b's `persistResource` (so it inherits canonical+flattened storage and DP-7). `@openldr/bootstrap` `createIngestContext` composes it; `apps/server` runs the worker; the CLI does accept-then-`drain()` in one process. `@openldr/ingest` imports only ports/fhir/forms/db/core — no adapter (DP-1).

**Tech Stack:** TypeScript (ESM, Bundler resolution), pg (raw SQL in the adapter), Kysely (BatchStore), Vitest, commander.

**Reference:** `docs/superpowers/specs/2026-06-12-eventing-ingest-design.md`

**Conventions:** Commits `git -c commit.gpgsign=false commit`, **no** `Co-authored-by` trailer (P1-CONV-2). Local imports omit extensions. `import type` for type-only. Integration (drain/worker against real Postgres) is verified in Task 8; pure/DI logic is unit-tested with fakes.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/internal.ts` | add `OutboxEventsTable` + `IngestBatchesTable` (modify) |
| `packages/db/src/migrations/internal/002_outbox.ts` / `003_ingest_batches.ts` | new migrations |
| `packages/db/src/migrations/internal/index.ts` | register 002, 003 (modify) |
| `packages/adapter-event-bus/src/backoff.ts` | pure exponential backoff |
| `packages/adapter-event-bus/src/index.ts` | real publish/subscribe/drain/startWorker/stats (modify) |
| `packages/ingest/src/converter.ts` | `Converter` + `ConverterRegistry` |
| `packages/ingest/src/converters/{fhir-bundle,questionnaire-response}.ts` | built-ins |
| `packages/ingest/src/default-converters.ts` | registry with built-ins |
| `packages/ingest/src/batch-store.ts` | `BatchStore` over internal Kysely |
| `packages/ingest/src/accept.ts` | `acceptPayload` |
| `packages/ingest/src/handle.ts` | `handleIngestEvent` |
| `packages/ingest/src/index.ts` | public surface |
| `packages/bootstrap/src/ingest-context.ts` | `createIngestContext` |
| `apps/server/src/index.ts` | start the worker (modify) |
| `packages/cli/src/ingest.ts` + `index.ts` | `ingest`/`pipeline`/`queue`/`provenance` commands |

---

## Task 1: `@openldr/db` — outbox + ingest_batches migrations

**Files:**
- Modify: `packages/db/src/schema/internal.ts`
- Create: `packages/db/src/migrations/internal/002_outbox.ts`, `packages/db/src/migrations/internal/003_ingest_batches.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Test: `packages/db/src/migrations/migrations.test.ts` (modify)

- [ ] **Step 1: Replace `packages/db/src/schema/internal.ts`** (adds the two tables)

```ts
import type { Generated, JSONColumnType } from 'kysely';
import type { FhirResource } from '@openldr/fhir';

export interface FhirResourcesTable {
  resource_type: string;
  id: string;
  version_id: string | null;
  resource: JSONColumnType<FhirResource>;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: string;
  type: string;
  payload: JSONColumnType<unknown>;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  last_error: string | null;
  batch_id: string | null;
  available_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IngestBatchesTable {
  batch_id: string;
  source: string | null;
  blob_key: string;
  content_type: string | null;
  converter: string;
  status: Generated<string>;
  resource_count: Generated<number>;
  attempts: Generated<number>;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InternalSchema {
  fhir_resources: FhirResourcesTable;
  outbox_events: OutboxEventsTable;
  ingest_batches: IngestBatchesTable;
}
```

- [ ] **Step 2: Create `packages/db/src/migrations/internal/002_outbox.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('outbox_events')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('payload', 'jsonb', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (c) => c.notNull().defaultTo(5))
    .addColumn('last_error', 'text')
    .addColumn('batch_id', 'text')
    .addColumn('available_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('outbox_events_status_available_idx')
    .ifNotExists()
    .on('outbox_events')
    .columns(['status', 'available_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('outbox_events').ifExists().execute();
}
```

- [ ] **Step 3: Create `packages/db/src/migrations/internal/003_ingest_batches.ts`**

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ingest_batches')
    .ifNotExists()
    .addColumn('batch_id', 'text', (c) => c.primaryKey())
    .addColumn('source', 'text')
    .addColumn('blob_key', 'text', (c) => c.notNull())
    .addColumn('content_type', 'text')
    .addColumn('converter', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('received'))
    .addColumn('resource_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingest_batches').ifExists().execute();
}
```

- [ ] **Step 4: Replace `packages/db/src/migrations/internal/index.ts`**

```ts
import type { Migration } from 'kysely';
import * as m001 from './001_fhir_resources';
import * as m002 from './002_outbox';
import * as m003 from './003_ingest_batches';

export const internalMigrations: Record<string, Migration> = {
  '001_fhir_resources': { up: m001.up, down: m001.down },
  '002_outbox': { up: m002.up, down: m002.down },
  '003_ingest_batches': { up: m003.up, down: m003.down },
};
```

- [ ] **Step 5: Update the migrations test** — replace the internal-map assertion in `packages/db/src/migrations/migrations.test.ts`'s first `it(...)` with:

```ts
  it('internal has the three migrations with up/down', () => {
    expect(Object.keys(internalMigrations)).toEqual(['001_fhir_resources', '002_outbox', '003_ingest_batches']);
    for (const m of Object.values(internalMigrations)) {
      expect(typeof m.up).toBe('function');
      expect(typeof m.down).toBe('function');
    }
  });
```

- [ ] **Step 6: Run + typecheck**

Run: `pnpm --filter @openldr/db test migrations && pnpm --filter @openldr/db typecheck`
Expected: migration-map tests pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(db): outbox_events + ingest_batches internal migrations"
```

---

## Task 2: `adapter-event-bus` — real outbox eventing

**Files:**
- Create: `packages/adapter-event-bus/src/backoff.ts`, `packages/adapter-event-bus/src/backoff.test.ts`, `packages/adapter-event-bus/src/publish.test.ts`
- Modify: `packages/adapter-event-bus/src/index.ts`

- [ ] **Step 1: Create `packages/adapter-event-bus/src/backoff.ts`**

```ts
const BASE_MS = 1000;
const MAX_BACKOFF_MS = 300_000;

/** Exponential backoff in ms for a given (1-based) attempt count, capped. */
export function backoff(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_MS * 2 ** attempts);
}
```

- [ ] **Step 2: Write the test `packages/adapter-event-bus/src/backoff.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { backoff } from './backoff';

describe('backoff', () => {
  it('grows exponentially and caps', () => {
    expect(backoff(1)).toBe(2000);
    expect(backoff(2)).toBe(4000);
    expect(backoff(3)).toBe(8000);
    expect(backoff(100)).toBe(300_000);
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @openldr/adapter-event-bus test backoff`
Expected: PASS (1 test).

- [ ] **Step 4: Replace `packages/adapter-event-bus/src/index.ts`** (keeps `healthCheck`, implements the rest)

```ts
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { probe, errorMessage, redact } from '@openldr/core';
import type { EventEnvelope, EventHandler, EventingPort } from '@openldr/ports';
import { backoff } from './backoff';

export interface EventBusConfig {
  url: string;
}

export interface EventBusDeps {
  pool?: pg.Pool;
}

export interface DrainResult {
  processed: number;
  failed: number;
}

export interface EventBus extends EventingPort {
  drain(opts?: { limit?: number }): Promise<DrainResult>;
  startWorker(opts?: { intervalMs?: number }): { stop(): Promise<void> };
  stats(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

interface ClaimedRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export function createEventBus(cfg: EventBusConfig, deps: EventBusDeps = {}): EventBus {
  const pool = deps.pool ?? new pg.Pool({ connectionString: cfg.url });
  const handlers = new Map<string, EventHandler>();

  async function publish(event: EventEnvelope): Promise<void> {
    const id = randomUUID();
    const batchId = (event.payload as { batchId?: string } | null)?.batchId ?? null;
    await pool.query(
      `insert into outbox_events (id, type, payload, batch_id) values ($1, $2, $3, $4)`,
      [id, event.type, JSON.stringify(event.payload), batchId],
    );
    await pool.query(`select pg_notify('openldr_events', $1)`, [event.type]);
  }

  async function subscribe(type: string, handler: EventHandler): Promise<void> {
    handlers.set(type, handler);
  }

  async function claim(limit: number): Promise<ClaimedRow[]> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const res = await client.query(
        `select id, type, payload, attempts, max_attempts from outbox_events
         where status='pending' and available_at <= now()
         order by available_at limit $1 for update skip locked`,
        [limit],
      );
      const rows = res.rows as ClaimedRow[];
      if (rows.length > 0) {
        await client.query(`update outbox_events set status='processing', updated_at=now() where id = any($1::text[])`, [
          rows.map((r) => r.id),
        ]);
      }
      await client.query('commit');
      return rows;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async function drain(opts: { limit?: number } = {}): Promise<DrainResult> {
    const rows = await claim(opts.limit ?? 20);
    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      const handler = handlers.get(row.type);
      if (!handler) {
        await pool.query(`update outbox_events set status='pending', updated_at=now() where id=$1`, [row.id]);
        continue;
      }
      try {
        await handler({ type: row.type, payload: row.payload });
        await pool.query(`update outbox_events set status='done', updated_at=now() where id=$1`, [row.id]);
        processed++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const msg = redact(errorMessage(err));
        if (attempts < row.max_attempts) {
          await pool.query(
            `update outbox_events set status='pending', attempts=$2,
             available_at = now() + ($3 || ' milliseconds')::interval, last_error=$4, updated_at=now() where id=$1`,
            [row.id, attempts, String(backoff(attempts)), msg],
          );
        } else {
          await pool.query(
            `update outbox_events set status='failed', attempts=$2, last_error=$3, updated_at=now() where id=$1`,
            [row.id, attempts, msg],
          );
          failed++;
        }
      }
    }
    return { processed, failed };
  }

  function startWorker(opts: { intervalMs?: number } = {}): { stop(): Promise<void> } {
    const intervalMs = opts.intervalMs ?? 2000;
    let stopped = false;
    let listenClient: pg.PoolClient | undefined;
    const tick = () => {
      if (stopped) return;
      void drain().catch(() => undefined);
    };
    void (async () => {
      listenClient = await pool.connect();
      await listenClient.query('listen openldr_events');
      listenClient.on('notification', () => tick());
    })();
    const timer = setInterval(tick, intervalMs);
    return {
      async stop() {
        stopped = true;
        clearInterval(timer);
        if (listenClient) {
          try {
            await listenClient.query('unlisten openldr_events');
          } finally {
            listenClient.release();
          }
        }
      },
    };
  }

  async function stats(): Promise<Record<string, number>> {
    const res = await pool.query(`select status, count(*)::int as count from outbox_events group by status`);
    const out: Record<string, number> = {};
    for (const r of res.rows as Array<{ status: string; count: number }>) out[r.status] = r.count;
    return out;
  }

  return {
    publish,
    subscribe,
    drain,
    startWorker,
    stats,
    async healthCheck() {
      return probe(async () => {
        await pool.query("select pg_notify('openldr_health', 'ping')");
        return 'pg_notify reachable';
      });
    },
    async close() {
      await pool.end();
    },
  };
}
```

- [ ] **Step 5: Write the test `packages/adapter-event-bus/src/publish.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './index';

function fakePool() {
  return { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(), end: vi.fn(async () => {}) };
}

describe('event-bus publish', () => {
  it('inserts an outbox row with batch_id and notifies', async () => {
    const pool = fakePool();
    const bus = createEventBus({ url: 'x' }, { pool: pool as never });
    await bus.publish({ type: 'ingest.received', payload: { batchId: 'b1', foo: 1 } });
    const insert = pool.query.mock.calls.find((c) => String(c[0]).includes('insert into outbox_events'));
    expect(insert).toBeDefined();
    expect(insert?.[1]?.[1]).toBe('ingest.received'); // type
    expect(insert?.[1]?.[3]).toBe('b1'); // batch_id
    const notify = pool.query.mock.calls.find((c) => String(c[0]).includes('pg_notify'));
    expect(notify?.[1]?.[0]).toBe('ingest.received');
  });
});
```

- [ ] **Step 6: Run + typecheck**

Run: `pnpm --filter @openldr/adapter-event-bus test && pnpm --filter @openldr/adapter-event-bus typecheck`
Expected: backoff 1 + publish 1 pass; the existing healthcheck test still passes; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(adapter-event-bus): real outbox publish/drain/startWorker/stats + backoff"
```

---

## Task 3: `@openldr/ingest` — Converter interface + built-ins

**Files:**
- Modify: `packages/ingest/package.json` (replace placeholder)
- Create: `packages/ingest/tsconfig.json`, `packages/ingest/src/converter.ts`, `packages/ingest/src/converters/fhir-bundle.ts`, `packages/ingest/src/converters/questionnaire-response.ts`, `packages/ingest/src/default-converters.ts`, `packages/ingest/src/converters/converters.test.ts`

- [ ] **Step 1: Replace `packages/ingest/package.json`**

```json
{
  "name": "@openldr/ingest",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*",
    "@openldr/db": "workspace:*",
    "@openldr/fhir": "workspace:*",
    "@openldr/forms": "workspace:*",
    "@openldr/ports": "workspace:*",
    "kysely": "^0.27.5"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

- [ ] **Step 2: Create `packages/ingest/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `packages/ingest/src/converter.ts`**

```ts
import type { FhirResource } from '@openldr/fhir';

export interface ConvertContext {
  source?: string;
  batchId: string;
}

export interface Converter {
  readonly id: string;
  readonly version: string;
  convert(raw: Uint8Array, ctx: ConvertContext): Promise<FhirResource[]>;
}

export class ConverterRegistry {
  private readonly map = new Map<string, Converter>();
  register(c: Converter): void {
    this.map.set(c.id, c);
  }
  get(id: string): Converter | undefined {
    return this.map.get(id);
  }
  list(): string[] {
    return [...this.map.keys()].sort();
  }
}
```

- [ ] **Step 4: Create `packages/ingest/src/converters/fhir-bundle.ts`**

```ts
import type { FhirResource } from '@openldr/fhir';
import type { Converter } from '../converter';

const decoder = new TextDecoder();

export const fhirBundleConverter: Converter = {
  id: 'fhir-bundle',
  version: '1',
  async convert(raw) {
    const data = JSON.parse(decoder.decode(raw)) as Record<string, unknown>;
    if (data.resourceType === 'Bundle') {
      const entry = (data.entry as Array<{ resource?: FhirResource }> | undefined) ?? [];
      return entry.map((e) => e.resource).filter((r): r is FhirResource => Boolean(r));
    }
    if (typeof data.resourceType === 'string') return [data as FhirResource];
    throw new Error('payload is not a FHIR Bundle or resource');
  },
};
```

- [ ] **Step 5: Create `packages/ingest/src/converters/questionnaire-response.ts`**

```ts
import type { FhirResource, Questionnaire, QuestionnaireResponse } from '@openldr/fhir';
import { extractResources } from '@openldr/forms';
import type { Converter } from '../converter';

const decoder = new TextDecoder();

export const questionnaireResponseConverter: Converter = {
  id: 'questionnaire-response',
  version: '1',
  async convert(raw): Promise<FhirResource[]> {
    const data = JSON.parse(decoder.decode(raw)) as { questionnaire?: Questionnaire; response?: QuestionnaireResponse };
    if (!data.questionnaire || !data.response) {
      throw new Error('payload must be { questionnaire, response }');
    }
    const { resources, invalid } = extractResources(data.response, data.questionnaire, {});
    if (invalid.length > 0) {
      throw new Error(`extraction produced ${invalid.length} invalid resource(s)`);
    }
    return resources;
  },
};
```

- [ ] **Step 6: Create `packages/ingest/src/default-converters.ts`**

```ts
import { ConverterRegistry } from './converter';
import { fhirBundleConverter } from './converters/fhir-bundle';
import { questionnaireResponseConverter } from './converters/questionnaire-response';

export function defaultConverters(): ConverterRegistry {
  const registry = new ConverterRegistry();
  registry.register(fhirBundleConverter);
  registry.register(questionnaireResponseConverter);
  return registry;
}
```

- [ ] **Step 7: Write the test `packages/ingest/src/converters/converters.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fhirBundleConverter } from './fhir-bundle';
import { questionnaireResponseConverter } from './questionnaire-response';
import { defaultConverters } from '../default-converters';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const ctx = { batchId: 'b1' };

describe('fhir-bundle converter', () => {
  it('returns the resources of a Bundle', async () => {
    const out = await fhirBundleConverter.convert(
      enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] }),
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].resourceType).toBe('Patient');
  });
  it('wraps a single resource', async () => {
    const out = await fhirBundleConverter.convert(enc({ resourceType: 'Patient', id: 'p1' }), ctx);
    expect(out).toHaveLength(1);
  });
  it('throws on non-FHIR', async () => {
    await expect(fhirBundleConverter.convert(enc({ foo: 1 }), ctx)).rejects.toThrow();
  });
});

describe('questionnaire-response converter', () => {
  it('extracts resources from { questionnaire, response }', async () => {
    const questionnaire = {
      resourceType: 'Questionnaire',
      status: 'active',
      extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/form', valueString: JSON.stringify({ id: 'f', name: 'f', title: { en: 'F' }, status: 'active', languages: ['en'] }) }],
      item: [
        {
          linkId: 'demo',
          type: 'group',
          extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/form-section', valueString: JSON.stringify({ id: 'demo', title: { en: 'D' }, resourceType: 'Patient' }) }],
          item: [
            { linkId: 'sex', type: 'choice', extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/form-field', valueString: JSON.stringify({ id: 'sex', type: 'choice', label: { en: 'Sex' }, fhirPath: 'gender', options: [{ code: 'female', display: { en: 'F' } }] }) }] },
          ],
        },
      ],
    };
    const response = { resourceType: 'QuestionnaireResponse', status: 'completed', item: [{ linkId: 'demo', item: [{ linkId: 'sex', answer: [{ valueCoding: { code: 'female' } }] }] }] };
    const out = await questionnaireResponseConverter.convert(enc({ questionnaire, response }), ctx);
    expect(out.some((r) => r.resourceType === 'Patient')).toBe(true);
  });
});

describe('defaultConverters', () => {
  it('registers both built-ins', () => {
    expect(defaultConverters().list()).toEqual(['fhir-bundle', 'questionnaire-response']);
  });
});
```

- [ ] **Step 8: Create a temporary `packages/ingest/src/index.ts`** (so the package resolves; Task 4 extends it)

```ts
export * from './converter';
export * from './default-converters';
```

- [ ] **Step 9: Install, run, typecheck**

Run: `pnpm install && pnpm --filter @openldr/ingest test && pnpm --filter @openldr/ingest typecheck`
Expected: converters tests pass; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(ingest): Converter interface + fhir-bundle/questionnaire-response built-ins (P1-INGEST-3)"
```

---

## Task 4: `@openldr/ingest` — BatchStore + accept + handle

**Files:**
- Create: `packages/ingest/src/batch-store.ts`, `packages/ingest/src/accept.ts`, `packages/ingest/src/handle.ts`, `packages/ingest/src/pipeline.test.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Create `packages/ingest/src/batch-store.ts`**

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export interface IngestBatch {
  batch_id: string;
  source: string | null;
  blob_key: string;
  content_type: string | null;
  converter: string;
  status: string;
  resource_count: number;
  attempts: number;
  last_error: string | null;
}

export interface BatchStore {
  create(b: { batchId: string; source: string; blobKey: string; contentType?: string; converter: string }): Promise<void>;
  markProcessing(batchId: string): Promise<void>;
  markDone(batchId: string, resourceCount: number): Promise<void>;
  markFailed(batchId: string, error: string): Promise<void>;
  reset(batchId: string): Promise<void>;
  get(batchId: string): Promise<IngestBatch | undefined>;
  list(): Promise<IngestBatch[]>;
  provenanceGaps(): Promise<{ resource_type: string; id: string }[]>;
}

const COLUMNS = ['batch_id', 'source', 'blob_key', 'content_type', 'converter', 'status', 'resource_count', 'attempts', 'last_error'] as const;

export function createBatchStore(db: Kysely<InternalSchema>): BatchStore {
  return {
    async create(b) {
      await db
        .insertInto('ingest_batches')
        .values({ batch_id: b.batchId, source: b.source, blob_key: b.blobKey, content_type: b.contentType ?? null, converter: b.converter, status: 'received' })
        .execute();
    },
    async markProcessing(batchId) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'processing', attempts: sql`attempts + 1`, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markDone(batchId, resourceCount) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'done', resource_count: resourceCount, last_error: null, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markFailed(batchId, error) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'failed', last_error: error, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async reset(batchId) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'received', last_error: null, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async get(batchId) {
      return db.selectFrom('ingest_batches').select(COLUMNS).where('batch_id', '=', batchId).executeTakeFirst();
    },
    async list() {
      return db.selectFrom('ingest_batches').select(COLUMNS).orderBy('created_at', 'desc').limit(100).execute();
    },
    async provenanceGaps() {
      return db
        .selectFrom('fhir_resources')
        .select(['resource_type', 'id'])
        .where((eb) => eb.or([eb('source_system', 'is', null), eb('plugin_id', 'is', null), eb('batch_id', 'is', null)]))
        .limit(500)
        .execute();
    },
  };
}
```

- [ ] **Step 2: Create `packages/ingest/src/accept.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { BlobStoragePort, EventingPort } from '@openldr/ports';
import type { Logger } from '@openldr/core';
import type { BatchStore } from './batch-store';

export interface AcceptInput {
  data: Uint8Array;
  source: string;
  converter: string;
  contentType?: string;
  filename?: string;
}

export interface AcceptDeps {
  blob: BlobStoragePort;
  eventing: EventingPort;
  batches: BatchStore;
  logger: Logger;
}

export async function acceptPayload(deps: AcceptDeps, input: AcceptInput): Promise<{ batchId: string; blobKey: string }> {
  const batchId = randomUUID();
  const blobKey = `ingest/${batchId}/${input.filename ?? 'payload'}`;
  await deps.blob.put(blobKey, input.data, input.contentType);
  await deps.batches.create({ batchId, source: input.source, blobKey, contentType: input.contentType, converter: input.converter });
  await deps.eventing.publish({ type: 'ingest.received', payload: { batchId, blobKey, source: input.source, converter: input.converter } });
  deps.logger.info({ batchId, source: input.source, converter: input.converter }, 'ingest payload accepted');
  return { batchId, blobKey };
}
```

- [ ] **Step 3: Create `packages/ingest/src/handle.ts`**

```ts
import { type Logger, errorMessage, redact } from '@openldr/core';
import type { BlobStoragePort, EventEnvelope } from '@openldr/ports';
import type { Provenance, PersistResult } from '@openldr/db';
import type { ConverterRegistry } from './converter';
import type { BatchStore } from './batch-store';

export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resource: unknown, provenance: Provenance) => Promise<PersistResult>;
  converters: ConverterRegistry;
  batches: BatchStore;
  logger: Logger;
}

interface IngestPayload {
  batchId: string;
  blobKey: string;
  source: string;
  converter: string;
}

export async function handleIngestEvent(deps: HandleDeps, event: EventEnvelope): Promise<void> {
  const { batchId, blobKey, source, converter } = event.payload as IngestPayload;
  await deps.batches.markProcessing(batchId);
  try {
    const raw = await deps.blob.get(blobKey);
    const c = deps.converters.get(converter);
    if (!c) throw new Error(`unknown converter: ${converter}`);
    const resources = await c.convert(raw, { source, batchId });
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    for (const resource of resources) {
      await deps.persist(resource, provenance);
    }
    await deps.batches.markDone(batchId, resources.length);
    deps.logger.info({ batchId, source, converter, count: resources.length }, 'ingest batch persisted');
  } catch (err) {
    const msg = redact(errorMessage(err));
    await deps.batches.markFailed(batchId, msg);
    deps.logger.error({ batchId, error: msg }, 'ingest batch failed');
    throw err;
  }
}
```

- [ ] **Step 4: Replace `packages/ingest/src/index.ts`**

```ts
export * from './converter';
export * from './default-converters';
export * from './batch-store';
export * from './accept';
export * from './handle';
```

- [ ] **Step 5: Write the test `packages/ingest/src/pipeline.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { acceptPayload } from './accept';
import { handleIngestEvent } from './handle';
import { defaultConverters } from './default-converters';

const logger = { info: vi.fn(), error: vi.fn() } as never;
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe('acceptPayload', () => {
  it('stores the blob, records the batch, and publishes', async () => {
    const blob = { put: vi.fn(async () => {}), get: vi.fn(), exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn() };
    const eventing = { publish: vi.fn(async () => {}), subscribe: vi.fn(), healthCheck: vi.fn() };
    const batches = { create: vi.fn(async () => {}) } as never;
    const out = await acceptPayload({ blob: blob as never, eventing: eventing as never, batches, logger }, { data: enc({ resourceType: 'Patient' }), source: 'test', converter: 'fhir-bundle' });
    expect(out.batchId).toBeTruthy();
    expect(blob.put).toHaveBeenCalledOnce();
    expect(eventing.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingest.received', payload: expect.objectContaining({ batchId: out.batchId, converter: 'fhir-bundle' }) }));
  });
});

describe('handleIngestEvent', () => {
  function deps(persist = vi.fn(async () => ({ saved: true, flattened: 'written' as const }))) {
    return {
      blob: { get: vi.fn(async () => enc({ resourceType: 'Bundle', type: 'collection', entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }] })) } as never,
      persist,
      converters: defaultConverters(),
      batches: { markProcessing: vi.fn(async () => {}), markDone: vi.fn(async () => {}), markFailed: vi.fn(async () => {}) } as never,
      logger,
    };
  }

  it('converts, persists each resource with provenance, marks done', async () => {
    const persist = vi.fn(async () => ({ saved: true, flattened: 'written' as const }));
    const d = deps(persist);
    await handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'fhir-bundle' } });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Patient' }), expect.objectContaining({ batchId: 'b1', sourceSystem: 'test', pluginId: 'fhir-bundle' }));
    expect(d.batches.markDone).toHaveBeenCalledWith('b1', 1);
  });

  it('marks failed and rethrows on an unknown converter', async () => {
    const d = deps();
    await expect(handleIngestEvent(d, { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'test', converter: 'nope' } })).rejects.toThrow();
    expect(d.batches.markFailed).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run + typecheck**

Run: `pnpm --filter @openldr/ingest test && pnpm --filter @openldr/ingest typecheck`
Expected: converters + pipeline tests pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(ingest): BatchStore + acceptPayload + handleIngestEvent (P1-INGEST-1/4/5/6)"
```

---

## Task 5: `@openldr/bootstrap` — createIngestContext

**Files:**
- Modify: `packages/bootstrap/package.json` (add `@openldr/ingest` dep)
- Create: `packages/bootstrap/src/ingest-context.ts`
- Modify: `packages/bootstrap/src/index.ts` (re-export)

- [ ] **Step 1: Add `@openldr/ingest` in `packages/bootstrap/package.json`** — inside `dependencies`, add `"@openldr/ingest": "workspace:*",`. (`@openldr/adapter-s3-bucket`, `@openldr/adapter-event-bus`, `@openldr/adapter-db-store`, `@openldr/db`, `kysely` already exist.) Run `pnpm install`.

- [ ] **Step 2: Create `packages/bootstrap/src/ingest-context.ts`**

```ts
import { Kysely } from 'kysely';
import { createDbStore } from '@openldr/adapter-db-store';
import { createS3Bucket } from '@openldr/adapter-s3-bucket';
import { createEventBus } from '@openldr/adapter-event-bus';
import type { Config } from '@openldr/config';
import { createLogger } from '@openldr/core';
import {
  createInternalDb,
  createFhirStore,
  createFlatWriter,
  createMigrator,
  persistResource,
  internalMigrations,
  externalMigrations,
  type ExternalSchema,
  type Provenance,
} from '@openldr/db';
import {
  acceptPayload,
  handleIngestEvent,
  defaultConverters,
  createBatchStore,
  type AcceptInput,
  type BatchStore,
} from '@openldr/ingest';

export interface IngestContext {
  accept(input: AcceptInput): Promise<{ batchId: string; blobKey: string }>;
  drain(): Promise<{ processed: number; failed: number }>;
  startWorker(): { stop(): Promise<void> };
  batches: BatchStore;
  republish(batch: { batch_id: string; blob_key: string; source: string | null; converter: string }): Promise<void>;
  queueStats(): Promise<Record<string, number>>;
  migrateAll(): Promise<void>;
  close(): Promise<void>;
}

export async function createIngestContext(cfg: Config): Promise<IngestContext> {
  const logger = createLogger({ level: cfg.LOG_LEVEL });
  const internal = createInternalDb(cfg.INTERNAL_DATABASE_URL);
  const externalStore = createDbStore({ url: cfg.TARGET_DATABASE_URL });
  const externalDb = externalStore.db as unknown as Kysely<ExternalSchema>;
  const blob = createS3Bucket({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  });
  const eventing = createEventBus({ url: cfg.INTERNAL_DATABASE_URL });

  const fhirStore = createFhirStore(internal.db);
  const flatWriter = createFlatWriter(externalDb);
  const persist = (resource: unknown, provenance: Provenance) => persistResource({ fhirStore, flatWriter, logger }, resource, provenance);
  const converters = defaultConverters();
  const batches = createBatchStore(internal.db);

  await eventing.subscribe('ingest.received', (event) => handleIngestEvent({ blob, persist, converters, batches, logger }, event));

  const internalMigrator = createMigrator(internal.db, internalMigrations);
  const externalMigrator = createMigrator(externalDb, externalMigrations);

  return {
    accept: (input) => acceptPayload({ blob, eventing, batches, logger }, input),
    drain: () => eventing.drain(),
    startWorker: () => eventing.startWorker(),
    batches,
    async republish(batch) {
      await eventing.publish({ type: 'ingest.received', payload: { batchId: batch.batch_id, blobKey: batch.blob_key, source: batch.source ?? 'cli', converter: batch.converter } });
    },
    queueStats: () => eventing.stats(),
    async migrateAll() {
      await internalMigrator.migrateToLatest();
      await externalMigrator.migrateToLatest();
    },
    async close() {
      await Promise.allSettled([internal.close(), externalStore.close(), eventing.close()]);
    },
  };
}
```

- [ ] **Step 3: Append to `packages/bootstrap/src/index.ts`**

```ts
export * from './ingest-context';
```

- [ ] **Step 4: Typecheck + depcruise**

Run: `pnpm install && pnpm --filter @openldr/bootstrap typecheck && pnpm depcruise`
Expected: typecheck clean; depcruise no violations.

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(bootstrap): createIngestContext wiring the ingest pipeline (DP-1)"
```

---

## Task 6: `apps/server` — run the worker

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Replace `apps/server/src/index.ts`** (adds the background worker; keeps `GET /health`)

```ts
import { loadConfig } from '@openldr/config';
import { createAppContext, createIngestContext } from '@openldr/bootstrap';
import { buildApp } from './app';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ctx = await createAppContext(cfg);
  const app = buildApp(ctx);

  const ingest = await createIngestContext(cfg);
  const worker = ingest.startWorker();

  const close = async () => {
    await worker.stop();
    await app.close();
    await ingest.close();
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  // Bind to all interfaces; the reverse proxy owns the external port (P1-NFR-7).
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  process.stderr.write(`server failed to start: ${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server build`
Expected: typecheck clean; `dist/index.js` produced.

- [ ] **Step 3: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(server): run the ingest worker in the deployable (§3.1)"
```

---

## Task 7: CLI — ingest / pipeline / queue / provenance

**Files:**
- Create: `packages/cli/src/ingest.ts`, `packages/cli/src/__fixtures__/sample-bundle.json`, `packages/cli/src/__fixtures__/sample-qr.json`, `packages/cli/src/__fixtures__/bad.json`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create `packages/cli/src/ingest.ts`**

```ts
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createIngestContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runIngest(file: string, opts: JsonOpt & { source: string; converter: string }): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const data = readFileSync(file);
    const { batchId } = await ctx.accept({ data: new Uint8Array(data), source: opts.source, converter: opts.converter, filename: basename(file) });
    await ctx.drain();
    const batch = await ctx.batches.get(batchId);
    emit(
      opts.json,
      { batchId, status: batch?.status, resourceCount: batch?.resource_count, error: batch?.last_error },
      `batch ${batchId}: ${batch?.status} (${batch?.resource_count ?? 0} resources)${batch?.last_error ? ' — ' + batch.last_error : ''}`,
    );
    return batch?.status === 'done' ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runPipelineStatus(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const rows = await ctx.batches.list();
    emit(
      opts.json,
      rows,
      rows.map((r) => `  ${r.batch_id.slice(0, 8)}  ${r.status.padEnd(10)} ${r.converter.padEnd(22)} ${r.resource_count} res  ${r.last_error ?? ''}`).join('\n') || '  (no batches)',
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runPipelineRetry(batchId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const batch = await ctx.batches.get(batchId);
    if (!batch) {
      emit(opts.json, { ok: false, error: 'batch not found' }, `batch ${batchId} not found`);
      return 1;
    }
    await ctx.batches.reset(batchId);
    await ctx.republish({ batch_id: batch.batch_id, blob_key: batch.blob_key, source: batch.source, converter: batch.converter });
    await ctx.drain();
    const after = await ctx.batches.get(batchId);
    emit(opts.json, { batchId, status: after?.status }, `retried ${batchId}: ${after?.status}`);
    return after?.status === 'done' ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runPipelineLogs(batchId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const batch = await ctx.batches.get(batchId);
    emit(
      opts.json,
      batch ?? { error: 'not found' },
      batch ? `${batch.batch_id}  status=${batch.status} attempts=${batch.attempts} error=${batch.last_error ?? '-'}` : 'not found',
    );
    return batch ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runQueueStatus(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const stats = await ctx.queueStats();
    emit(opts.json, stats, Object.entries(stats).map(([k, v]) => `  ${k.padEnd(12)} ${v}`).join('\n') || '  (empty)');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runProvenanceAudit(opts: JsonOpt): Promise<number> {
  const ctx = await createIngestContext(loadConfig());
  try {
    const gaps = await ctx.batches.provenanceGaps();
    emit(
      opts.json,
      { gaps: gaps.length, records: gaps },
      gaps.length === 0 ? 'provenance audit: 0 gaps' : `provenance audit: ${gaps.length} record(s) missing source/plugin/batch`,
    );
    return gaps.length === 0 ? 0 : 1;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 2: Create the fixtures**

`packages/cli/src/__fixtures__/sample-bundle.json`:
```json
{ "resourceType": "Bundle", "type": "collection", "entry": [
  { "resource": { "resourceType": "Organization", "id": "ing-org", "name": "Ingest Lab" } },
  { "resource": { "resourceType": "Patient", "id": "ing-pat", "gender": "male", "birthDate": "1985-03-02" } }
] }
```
`packages/cli/src/__fixtures__/sample-qr.json` — generate from the patient-intake sample's Questionnaire + a filled response (run from repo root):
```bash
pnpm exec tsx -e "import { patientIntakeForm } from './packages/forms/src/samples/forms'; import { toQuestionnaire } from './packages/forms/src/to-questionnaire'; const q = toQuestionnaire(patientIntakeForm()); const response = { resourceType:'QuestionnaireResponse', status:'completed', item:[{ linkId:'demographics', item:[{ linkId:'family', answer:[{valueString:'Doe'}] },{ linkId:'given', answer:[{valueString:'Jane'}] },{ linkId:'sex', answer:[{valueCoding:{code:'female'}}] },{ linkId:'birthDate', answer:[{valueDate:'1990-05-01'}] }] }] }; process.stdout.write(JSON.stringify({ questionnaire: q, response }, null, 2));" > packages/cli/src/__fixtures__/sample-qr.json
```
`packages/cli/src/__fixtures__/bad.json`:
```json
{ "not": "a fhir resource" }
```

- [ ] **Step 3: Register commands in `packages/cli/src/index.ts`** — add the import near the others:
```ts
import { runIngest, runPipelineStatus, runPipelineRetry, runPipelineLogs, runQueueStatus, runProvenanceAudit } from './ingest';
```
and insert before `program.parseAsync(process.argv);`:
```ts
program
  .command('ingest <file>')
  .description('Ingest a payload through the pipeline (accept + drain)')
  .option('--source <s>', 'source system identifier', 'cli')
  .option('--converter <id>', 'converter id', 'fhir-bundle')
  .option('--json', 'emit JSON', false)
  .action(async (file: string, opts: { source: string; converter: string; json: boolean }) => {
    try {
      process.exitCode = await runIngest(file, opts);
    } catch (err) {
      process.stderr.write(`ingest failed: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  });

const pipeline = program.command('pipeline').description('Inspect the ingest pipeline');
pipeline.command('status').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineStatus(opts); } catch (err) { process.stderr.write(`pipeline status failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
pipeline.command('retry <batchId>').option('--json', 'emit JSON', false).action(async (batchId: string, opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineRetry(batchId, opts); } catch (err) { process.stderr.write(`pipeline retry failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
pipeline.command('logs <batchId>').option('--json', 'emit JSON', false).action(async (batchId: string, opts: { json: boolean }) => {
  try { process.exitCode = await runPipelineLogs(batchId, opts); } catch (err) { process.stderr.write(`pipeline logs failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});

const queue = program.command('queue').description('Inspect the event queue');
queue.command('status').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runQueueStatus(opts); } catch (err) { process.stderr.write(`queue status failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});

const provenance = program.command('provenance').description('Provenance tooling');
provenance.command('audit').option('--json', 'emit JSON', false).action(async (opts: { json: boolean }) => {
  try { process.exitCode = await runProvenanceAudit(opts); } catch (err) { process.stderr.write(`provenance audit failed: ${errorMessage(err)}\n`); process.exitCode = 1; }
});
```
(The existing `errorMessage` import already covers these — do not add a duplicate.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm install && pnpm --filter @openldr/cli typecheck && pnpm --filter @openldr/cli build`
Expected: typecheck clean; `dist/index.js` produced. (These are infra commands, verified in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(cli): ingest / pipeline / queue / provenance audit (P1-CLI-1/2, DP-4)"
```

---

## Task 8: Integration acceptance + final gate

> Requires the dev docker stack (Postgres + MinIO). Run the CLI via `pnpm openldr` (tsx).

- [ ] **Step 1: Stack up + migrate**

Run: `docker compose up -d` ; confirm postgres + minio healthy (`docker compose ps`).
Run: `pnpm openldr db reset --json` (drops + re-migrates — now includes `outbox_events` + `ingest_batches`).
Verify: `docker compose exec -T postgres psql -U openldr -d openldr -c "\dt"` shows `outbox_events`, `ingest_batches`, `fhir_resources`.

- [ ] **Step 2: Ingest a FHIR Bundle**

Run: `pnpm openldr ingest packages/cli/src/__fixtures__/sample-bundle.json --source test --json`
Expected: JSON `status: "done"`, `resourceCount: 2`; exit 0.
Verify canonical + flat + provenance:
Run: `docker compose exec -T postgres psql -U openldr -d openldr -c "select resource_type,id,source_system,batch_id from fhir_resources where source_system='test';"` → Organization + Patient rows with `source_system=test` and a non-null `batch_id`.
Run: `docker compose exec -T postgres psql -U openldr -d openldr_target -c "select id from patients where id='ing-pat';"` → one row (flattened).

- [ ] **Step 3: Ingest a QuestionnaireResponse**

Run: `pnpm openldr ingest packages/cli/src/__fixtures__/sample-qr.json --converter questionnaire-response --source forms --json`
Expected: `status: "done"`, `resourceCount >= 1`; exit 0. A Patient (gender female) persisted with `source_system=forms`.

- [ ] **Step 4: Queue + pipeline + provenance**

Run: `pnpm openldr queue status --json` → shows `done` count >= 2.
Run: `pnpm openldr pipeline status` → lists the batches as `done`.
Run: `pnpm openldr provenance audit --json` → `{ "gaps": 0, ... }`; exit 0 (P1-NFR-6).

- [ ] **Step 5: Graceful failure (DP-7)**

Run: `pnpm openldr ingest packages/cli/src/__fixtures__/bad.json --json`
Expected: the command completes (no crash); after `drain()` the batch is `failed` (the converter threw, the outbox retried per backoff then failed), exit 1. `pnpm openldr pipeline status` shows the batch `failed` with an error; `queue status` shows a `failed` (or `pending` if still within the retry window) count. No stack-trace crash.

- [ ] **Step 6: Final workspace gate**

Run: `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build`
Expected: typecheck clean; all tests pass; `depcruise` no violations (confirms `@openldr/ingest` imports no `adapter-*`/`apps/*`); builds succeed.

- [ ] **Step 7: Commit any final lockfile delta**

Run: `git status --short` — commit `pnpm-lock.yaml` if changed (`chore: finalize eventing/ingest lockfile`).

---

## Done criteria (maps to spec §9)

- [ ] Real outbox `EventingPort` (publish/drain/startWorker/stats + retry/backoff) replacing the stubs.
- [ ] `acceptPayload` stores raw in blob + emits event with batch-id provenance (P1-INGEST-1/2).
- [ ] `Converter` interface + `fhir-bundle`/`questionnaire-response` built-ins (P1-INGEST-3).
- [ ] Provenance (converter id+version, batch id) stamped on every persisted record (P1-INGEST-4, DP-3).
- [ ] Persist via 2b `persistResource` — canonical + flattened (P1-INGEST-5).
- [ ] Graceful failure → mark/queue/retry/backoff + structured log, no crash (P1-INGEST-6, DP-7).
- [ ] `ingest`/`pipeline status|retry|logs`/`queue status`/`provenance audit` CLI (P1-CLI-1/2).
- [ ] `provenance audit` zero gaps on the reference flow (P1-NFR-6).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm depcruise && pnpm -r build` green.
