# Workflow Builder — SP-3b Sink Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three sink nodes so workflows can produce output — materialize results to an internal dataset, export a CSV/XLSX/PDF artifact to blob, and push to DHIS2 via an existing mapping.

**Architecture:** Extend the SP-3a `WorkflowServices` with `materializeDataset` + `exportArtifact` (always available, built in bootstrap from a new `WorkflowDatasetStore` + `ctx.blob` + reporting render helpers) and an optional `dhis2Push?` assigned in `apps/server/src/index.ts` once the conditional DHIS2 context exists. Three new handlers route as action subtypes; a `workflowId` is threaded into the run so materialize can stamp datasets.

**Tech Stack:** TypeScript, Kysely/Postgres, `@openldr/reporting` (`toCsv`), `@openldr/report-pdf` (`renderReportPdf`), `xlsx`, `ctx.blob` (BlobStoragePort), the DHIS2 context `runMapping`, Vitest + pg-mem, React (forms).

**Reference spec:** `docs/superpowers/specs/2026-06-23-workflow-builder-sp3b-sink-nodes-design.md`
**Builds on:** `main` `8e50a3d` (SP-1+SP-4+SP-2+SP-3a).

---

## Conventions
- CWD is the worktree `…/.claude/worktrees/feat-workflow-builder-sp3b`. Deps installed.
- Commit after each task. Package gate after package tasks; full `turbo` gate at the end.
- **Migration number:** plan uses **`031_workflow_datasets`**. Before Task 1, `ls packages/db/src/migrations/internal/` — marketplace added `030_marketplace_installs`; use the next free integer if `031` is taken (keep filename + registry key + `migrations.test.ts` list consistent).

---

## Task 1: `WorkflowDatasetStore` + migration

**Files:**
- Modify: `packages/workflows/src/types.ts` (dataset Zod type)
- Create: `packages/workflows/src/dataset-store.ts`, `dataset-store.test.ts`
- Modify: `packages/workflows/src/index.ts`
- Create: `packages/db/src/migrations/internal/031_workflow_datasets.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Add the dataset type to `types.ts`**

```ts
export const WorkflowDatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  rows: z.array(z.record(z.unknown())).default([]),
  rowCount: z.number().default(0),
  workflowId: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type WorkflowDataset = z.infer<typeof WorkflowDatasetSchema>;
```

- [ ] **Step 2: Write the failing store test** (`dataset-store.test.ts`, pg-mem)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createWorkflowDatasetStore } from './dataset-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: Kysely<any>;
beforeEach(async () => {
  db = newDb().adapters.createKysely();
  await db.schema.createTable('workflow_datasets')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.unique())
    .addColumn('columns', 'jsonb').addColumn('rows', 'jsonb')
    .addColumn('row_count', 'integer').addColumn('workflow_id', 'text')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text')
    .execute();
});

describe('WorkflowDatasetStore', () => {
  it('upserts by name (latest wins), lists, gets', async () => {
    const store = createWorkflowDatasetStore(db);
    await store.upsertByName({ name: 'amr', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }], rowCount: 1, workflowId: 'w1' });
    await store.upsertByName({ name: 'amr', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }], rowCount: 2, workflowId: 'w1' });
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].rowCount).toBe(2);
    expect((await store.getByName('amr'))?.rows.length).toBe(2);
    expect(await store.getByName('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails, then write `dataset-store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowDataset, WorkflowDatasetSchema } from './types';

export interface DatasetInput {
  name: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  workflowId: string | null;
}

function fromRow(r: Record<string, unknown>): WorkflowDataset {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
  return WorkflowDatasetSchema.parse({
    id: r.id, name: r.name, columns: parse(r.columns), rows: parse(r.rows),
    rowCount: Number(r.row_count ?? 0), workflowId: r.workflow_id ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface WorkflowDatasetStore {
  upsertByName(d: DatasetInput): Promise<WorkflowDataset>;
  list(): Promise<{ name: string; rowCount: number; workflowId: string | null; updatedAt?: string }[]>;
  getByName(name: string): Promise<WorkflowDataset | undefined>;
}

export function createWorkflowDatasetStore(db: Kysely<InternalSchema>): WorkflowDatasetStore {
  const T = 'workflow_datasets' as const;
  const store: WorkflowDatasetStore = {
    async upsertByName(d) {
      await db.deleteFrom(T).where('name', '=', d.name).execute();
      await db.insertInto(T).values({
        id: randomUUID(), name: d.name, columns: JSON.stringify(d.columns), rows: JSON.stringify(d.rows),
        row_count: d.rowCount, workflow_id: d.workflowId ?? null,
      } as never).execute();
      return (await store.getByName(d.name))!;
    },
    async list() {
      const rows = await db.selectFrom(T).selectAll().orderBy('name').execute();
      return rows.map((r) => {
        const d = fromRow(r as Record<string, unknown>);
        return { name: d.name, rowCount: d.rowCount, workflowId: d.workflowId, updatedAt: d.updatedAt };
      });
    },
    async getByName(name) {
      const r = await db.selectFrom(T).selectAll().where('name', '=', name).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
  };
  return store;
}
```

Run: `pnpm --filter @openldr/workflows test dataset-store` → PASS.

- [ ] **Step 4: Export from `index.ts`** — append:

```ts
export { createWorkflowDatasetStore, type WorkflowDatasetStore, type DatasetInput } from './dataset-store';
```

- [ ] **Step 5: Create the migration `031_workflow_datasets.ts`** (confirm number free first)

```ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_datasets').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('columns', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('rows', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('row_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('workflow_id', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_datasets').ifExists().execute();
}
```

- [ ] **Step 6: Register + schema type + test list.** In `migrations/internal/index.ts` add `import * as m031 from './031_workflow_datasets';` + `'031_workflow_datasets': { up: m031.up, down: m031.down },`. In `schema/internal.ts` add (match the `Generated`/`JSONColumnType` convention used by `WorkflowRunsTable`):

```ts
export interface WorkflowDatasetsTable {
  id: string;
  name: string;
  columns: JSONColumnType<{ key: string; label: string }[]>;
  rows: JSONColumnType<Record<string, unknown>[]>;
  row_count: Generated<number>;
  workflow_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
```
Register `workflow_datasets: WorkflowDatasetsTable;` on `InternalSchema`. Add `'031_workflow_datasets'` to `migrations.test.ts` expected-keys.

- [ ] **Step 7: Gates + commit**

Run: `pnpm --filter @openldr/db test && pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/db typecheck`
Expected: green.

```bash
git add packages/workflows/src/types.ts packages/workflows/src/dataset-store.ts packages/workflows/src/dataset-store.test.ts packages/workflows/src/index.ts packages/db/src/migrations/internal/031_workflow_datasets.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(workflows): WorkflowDatasetStore + migration 031 workflow_datasets"
```

---

## Task 2: Services extension + workflowId threading + sink handlers

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`
- Modify: `packages/workflows/src/engine/execution-context.ts`, `run-workflow.ts`
- Create: `packages/workflows/src/engine/node-handlers/{materialize,export,dhis2-push}.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Create: `packages/workflows/src/engine/node-handlers/sink-handlers.test.ts`
- Modify: `packages/workflows/src/index.ts`, `run-workflow.test.ts`

- [ ] **Step 1: Extend `services.ts`** — add the sink types + methods to `WorkflowServices`:

```ts
export interface ExportArtifactInput { format: 'csv' | 'xlsx' | 'pdf'; filename?: string; title?: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
export interface ExportArtifactResult { objectKey: string; format: string; byteSize: number }
export interface Dhis2PushInput { mappingId: string; period: string; dryRun?: boolean }
```
and on the interface:
```ts
  materializeDataset(name: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[], workflowId: string | null): Promise<{ dataset: string; rowCount: number }>;
  exportArtifact(input: ExportArtifactInput): Promise<ExportArtifactResult>;
  dhis2Push?(input: Dhis2PushInput): Promise<unknown>;
```

- [ ] **Step 2: Thread `workflowId`** through `execution-context.ts` (field + 6th param) and `run-workflow.ts` (`RunWorkflowOptions.workflowId?` forwarded):

```ts
// ExecutionContext: add
  workflowId?: string;
// createContext: add param after services
  workflowId?: string,
// return: include workflowId
  return { input, nodeOutputs: {}, logs: {}, emit, edges, codeLimits, services, workflowId };
```
```ts
// run-workflow.ts RunWorkflowOptions: add workflowId?: string;
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges, opts.codeLimits, opts.services, opts.workflowId);
```

- [ ] **Step 3: Write the failing sink-handler tests** (`sink-handlers.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { materializeHandler } from './materialize';
import { exportHandler } from './export';
import { dhis2PushHandler } from './dhis2-push';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const base: WorkflowServices = {
  runSql: vi.fn(), fhirQuery: vi.fn(), httpFetch: vi.fn(),
  materializeDataset: vi.fn(async (name, _c, rows) => ({ dataset: name, rowCount: rows.length })),
  exportArtifact: vi.fn(async (i) => ({ objectKey: `k/${i.format}`, format: i.format, byteSize: 10 })),
  dhis2Push: vi.fn(async () => ({ status: 'OK', imported: 1 })),
} as never;
const ctxWith = (svc?: Partial<WorkflowServices>, workflowId = 'w1') =>
  createContext(undefined, () => {}, [], undefined, svc as WorkflowServices, workflowId);

describe('sink handlers', () => {
  it('materialize delegates with name, rows, and workflowId', async () => {
    const ctx = ctxWith(base);
    const out = await materializeHandler({ id: 'm', type: 'action', data: { action: 'materialize-dataset', config: { datasetName: 'amr' } } }, ctx, { columns: [], rows: [{ a: 1 }, { a: 2 }] });
    expect(out).toEqual({ dataset: 'amr', rowCount: 2 });
    expect(base.materializeDataset).toHaveBeenCalledWith('amr', [], [{ a: 1 }, { a: 2 }], 'w1');
  });
  it('export delegates with the chosen format', async () => {
    const ctx = ctxWith(base);
    const out = await exportHandler({ id: 'e', type: 'action', data: { action: 'export-artifact', config: { format: 'csv' } } }, ctx, { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] });
    expect((out as { format: string }).format).toBe('csv');
  });
  it('dhis2-push delegates when available', async () => {
    const ctx = ctxWith(base);
    const out = await dhis2PushHandler({ id: 'd', type: 'action', data: { action: 'dhis2-push', config: { mappingId: 'map1', period: '202401' } } }, ctx, undefined);
    expect((out as { status: string }).status).toBe('OK');
  });
  it('dhis2-push throws when capability is absent', async () => {
    const ctx = ctxWith({ ...base, dhis2Push: undefined });
    await expect(dhis2PushHandler({ id: 'd', type: 'action', data: { config: { mappingId: 'm', period: 'p' } } }, ctx, undefined)).rejects.toThrow(/not available/);
  });
  it('each throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(materializeHandler({ id: 'm', type: 'action', data: { config: { datasetName: 'x' } } }, ctx, { rows: [] })).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 4: Write `materialize.ts`**

```ts
import type { NodeHandler } from './types';

export const materializeHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('Materialize node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Materialize node: datasetName is required');
  const up = (upstream ?? {}) as { columns?: { key: string; label: string }[]; rows?: Record<string, unknown>[] };
  const rows = Array.isArray(up.rows) ? up.rows : Array.isArray(upstream) ? (upstream as Record<string, unknown>[]) : [];
  const columns = up.columns ?? [];
  return ctx.services.materializeDataset(name, columns, rows, ctx.workflowId ?? null);
};
```

- [ ] **Step 5: Write `export.ts`**

```ts
import type { NodeHandler } from './types';

export const exportHandler: NodeHandler = async (node, ctx, upstream) => {
  if (!ctx.services) throw new Error('Export node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = (String(config.format ?? 'csv') as 'csv' | 'xlsx' | 'pdf');
  const up = (upstream ?? {}) as { columns?: { key: string; label: string }[]; rows?: Record<string, unknown>[] };
  const rows = Array.isArray(up.rows) ? up.rows : Array.isArray(upstream) ? (upstream as Record<string, unknown>[]) : [];
  const columns = up.columns ?? (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : []);
  return ctx.services.exportArtifact({ format, filename: config.filename as string | undefined, title: (node.data.label as string) ?? 'Workflow Export', columns, rows });
};
```

- [ ] **Step 6: Write `dhis2-push.ts`**

```ts
import type { NodeHandler } from './types';

export const dhis2PushHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services?.dhis2Push) {
    throw new Error('DHIS2 push not available (DHIS2 is not the configured reporting target)');
  }
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mappingId = String(config.mappingId ?? '').trim();
  const period = String(config.period ?? '').trim();
  if (!mappingId || !period) throw new Error('DHIS2 push node: mappingId and period are required');
  return ctx.services.dhis2Push({ mappingId, period, dryRun: Boolean(config.dryRun) });
};
```

- [ ] **Step 7: Route them** in `node-handlers/index.ts` — import the three and add to `ACTION_HANDLERS`:

```ts
import { materializeHandler } from './materialize';
import { exportHandler } from './export';
import { dhis2PushHandler } from './dhis2-push';
// ...
  'materialize-dataset': materializeHandler,
  'export-artifact': exportHandler,
  'dhis2-push': dhis2PushHandler,
```

- [ ] **Step 8: Export new types from `index.ts`** — extend the existing services export line to also export `ExportArtifactInput`, `ExportArtifactResult`, `Dhis2PushInput`.

- [ ] **Step 9: Add a run-workflow integration test** to `run-workflow.test.ts`:

```ts
  it('runs a materialize sink with an injected service', async () => {
    const saved: unknown[] = [];
    const services = {
      runSql: async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }] }),
      fhirQuery: async () => ({ resources: [] }),
      httpFetch: async () => ({ status: 200, headers: {}, data: null }),
      materializeDataset: async (name: string, _c: unknown, rows: unknown[]) => { saved.push({ name, rows }); return { dataset: name, rowCount: rows.length }; },
      exportArtifact: async () => ({ objectKey: 'k', format: 'csv', byteSize: 0 }),
    };
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'q', type: 'action', data: { action: 'sql-query', config: { sql: 'select 1' } } },
      { id: 'm', type: 'action', data: { action: 'materialize-dataset', config: { datasetName: 'ds1' } } },
    ];
    const edges = [{ id: 'e1', source: 't', target: 'q' }, { id: 'e2', source: 'q', target: 'm' }];
    const res = await runWorkflow(nodes, edges, { services: services as never, workflowId: 'w1' });
    expect(res.status).toBe('completed');
    expect(saved.length).toBe(1);
  });
```

- [ ] **Step 10: Gate + commit**

Run: `pnpm --filter @openldr/workflows test && pnpm --filter @openldr/workflows typecheck`
Expected: green.

```bash
git add packages/workflows/src/engine packages/workflows/src/index.ts
git commit -m "feat(workflows): materialize/export/dhis2-push sink handlers + workflowId threading"
```

---

## Task 3: Bootstrap service impls + routes + DHIS2 wiring

**Files:**
- Modify: `packages/bootstrap/src/index.ts`
- Modify: `apps/server/src/workflows-routes.ts`, `apps/server/src/index.ts`
- Modify: `packages/workflows/src/trigger-runner.ts`
- Modify: `apps/server/src/workflows-routes.test.ts`

- [ ] **Step 1: Build the sink services + dataset store in bootstrap.** In `packages/bootstrap/src/index.ts`:
  - imports: add `createWorkflowDatasetStore, type WorkflowDatasetStore` and the new service types to the `@openldr/workflows` import; ensure `toCsv` (from `@openldr/reporting`), `renderReportPdf` (already imported), and `import * as XLSX from 'xlsx'` are available (XLSX is already imported by report-scheduler — import it here too).
  - construct `const workflowDatasets = createWorkflowDatasetStore(internal.db);`
  - in the `workflowServices` object (added in SP-3a), add:

```ts
    materializeDataset: async (name, columns, rows, workflowId) => {
      await workflowDatasets.upsertByName({ name, columns, rows, rowCount: rows.length, workflowId });
      return { dataset: name, rowCount: rows.length };
    },
    exportArtifact: async ({ format, filename, title, columns, rows }) => {
      let bytes: Buffer; let contentType: string; const ext = format;
      if (format === 'pdf') {
        bytes = await renderReportPdf({ title: title ?? 'Workflow Export', generatedAt: new Date().toISOString(), params: {}, columns, rows });
        contentType = 'application/pdf';
      } else if (format === 'xlsx') {
        const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? ''])));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Export');
        bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        bytes = Buffer.from(toCsv(columns, rows), 'utf8');
        contentType = 'text/csv';
      }
      const objectKey = `workflow-artifacts/${randomUUID()}/${filename ?? `export.${ext}`}`;
      await blob.put(objectKey, bytes, contentType);
      return { objectKey, format, byteSize: bytes.length };
    },
```
  (`randomUUID` from `node:crypto` — already imported in bootstrap? if not, add the import. `blob` is in scope.)
  - add `datasets: workflowDatasets` to the `workflows` object; widen `AppContext.workflows` with `datasets: WorkflowDatasetStore` and add the sink methods to its `services` type (the `WorkflowServices` type already includes them, so no extra change if `services: WorkflowServices`).

- [ ] **Step 2: Assign `dhis2Push` after the DHIS2 context exists.** In `apps/server/src/index.ts`, inside the `if (dhis2 && cfg.DHIS2_SYNC_ENABLED)` area OR right after `dhis2` is built (line ~50), add (guard on `dhis2` truthiness, independent of SYNC_ENABLED so push works even with sync off):

```ts
  if (dhis2) {
    ctx.workflows.services.dhis2Push = ({ mappingId, period, dryRun }) =>
      dhis2!.runMapping({ mappingId, period, dryRun: Boolean(dryRun), trigger: 'workflow' });
  }
```
> `runMapping` takes `& RunCallbacks`. If `RunCallbacks` has required fields, pass no-op callbacks (read `dhis2-context.ts` `RunCallbacks` — the scheduled caller spreads `...cb`; if optional, the call above is fine; if required, add the minimal no-op callbacks the type needs).

- [ ] **Step 3: Add dataset + artifact routes.** In `apps/server/src/workflows-routes.ts` (all `MANAGE`-gated):

```ts
  app.get('/api/workflows/datasets', MANAGE, async () => ctx.workflows.datasets.list());
  app.get('/api/workflows/datasets/:name', MANAGE, async (req, reply) => {
    const { name } = req.params as { name: string };
    const d = await ctx.workflows.datasets.getByName(name);
    if (!d) { reply.code(404); return { error: `unknown dataset: ${name}` }; }
    return d;
  });
  app.get('/api/workflows/artifacts/*', MANAGE, async (req, reply) => {
    const key = (req.params as Record<string, string>)['*'];
    try {
      const buf = await ctx.blob.get(key);   // confirm BlobStoragePort method name (get/getObject); adjust if different
      reply.header('content-type', 'application/octet-stream');
      return reply.send(buf);
    } catch { reply.code(404); return { error: 'artifact not found' }; }
  });
```
> Verify `ctx.blob`'s read method name in `@openldr/ports`/the S3 adapter (`get`, `getObject`, or returns a stream). Use the real method; if it returns a stream, pipe it. If `blob` isn't already on `AppContext` as `ctx.blob`, it is (bootstrap returns `blob`).

- [ ] **Step 4: Pass `workflowId` into runs.** In `workflows-routes.ts` execute-stream, add `workflowId: id` to the `runWorkflow(...)` opts. In `packages/workflows/src/trigger-runner.ts` `runAndRecord`, add `workflowId` to the `runWorkflow(...)` opts (it already has the `workflowId` param).

- [ ] **Step 5: Update route-test stubs.** In `apps/server/src/workflows-routes.test.ts`, extend both `ctx.workflows` stubs with `datasets: { list: async () => [], getByName: async () => undefined }` and ensure the fake `services` (if present) won't be called by the existing trigger→log test. Add a `ctx.blob` stub (`{ get: async () => Buffer.from('x') }`) if any new test exercises the artifact route. Add 2 cases: `GET /api/workflows/datasets` → `[]`; `GET /api/workflows/datasets/:name` unknown → 404.

- [ ] **Step 6: Gates + commit**

Run: `pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck && pnpm --filter @openldr/server test workflows-routes`
Expected: green.

```bash
git add packages/bootstrap/src/index.ts apps/server/src/workflows-routes.ts apps/server/src/index.ts packages/workflows/src/trigger-runner.ts apps/server/src/workflows-routes.test.ts
git commit -m "feat: server sink services (materialize/export), dataset+artifact routes, dhis2Push wiring"
```

---

## Task 4: Web — sink forms + Datasets view + enable

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Create: `apps/web/src/workflows/components/node-forms/{materialize-form,export-form,dhis2-push-form}.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`
- Modify: `apps/web/src/api.ts` (dataset list/get client + artifact URL helper)
- Modify: `apps/web/src/workflows/components/panels/run-history-drawer.tsx` (artifact download link)
- Create: `apps/web/src/workflows/components/panels/datasets-drawer.tsx` + a toolbar button

- [ ] **Step 1: Add templates + enable.** In `constants.ts` add three action templates near the other sinks — `materialize-dataset` ("Materialize Dataset", `config:{ datasetName:'' }`), `export-artifact` ("Export File", `config:{ format:'csv', filename:'' }`), `dhis2-push` ("DHIS2 Push", `config:{ mappingId:'', period:'', dryRun:false }`) — with valid lucide icons (e.g. `Save`, `Download`, `Share2`; confirm they resolve). Add the three ids to `IMPLEMENTED_TEMPLATE_IDS`. Config keys MUST match the handlers (`datasetName`; `format`/`filename`; `mappingId`/`period`/`dryRun`).

- [ ] **Step 2: Create the three forms** (small; follow the SP-3a `fhir-form.tsx` pattern with the shared `FormField`/`TextInput`/`Select`/`TextArea` helpers):
  - `materialize-form.tsx`: a `datasetName` text input (+ hint "downstream of a SQL/Code node; upserts by name").
  - `export-form.tsx`: a `format` `<Select>` (csv/xlsx/pdf) + `filename` text input.
  - `dhis2-push-form.tsx`: `mappingId` text input + `period` text input (e.g. `202401`) + a `dryRun` checkbox/switch + a hint "requires DHIS2 as the reporting target."

- [ ] **Step 3: Register the three forms** in `node-forms/index.tsx` `pickForm` (templateId → form).

- [ ] **Step 4: Dataset API client + Datasets drawer.** Append to `apps/web/src/api.ts`:

```ts
export interface WorkflowDatasetSummary { name: string; rowCount: number; workflowId: string | null; updatedAt?: string }
export async function fetchWorkflowDatasets(): Promise<WorkflowDatasetSummary[]> {
  const res = await authFetch('/api/workflows/datasets');
  if (!res.ok) throw new Error(`datasets failed: ${res.status}`);
  return res.json() as Promise<WorkflowDatasetSummary[]>;
}
```
Create `datasets-drawer.tsx` (a shadcn Sheet listing `fetchWorkflowDatasets()` — name, rowCount, updatedAt; a "Download CSV" link to `/api/workflows/datasets/<name>.csv`). Add a toolbar "Datasets" button opening it (mirror the History button).

> The `.csv` download endpoint: if you didn't add it in Task 3, add `GET /api/workflows/datasets/:name.csv` returning `toCsv(...)` — OR have the drawer fetch the full dataset and build the CSV client-side. Pick one and keep it consistent; the server route is cleaner.

- [ ] **Step 5: Artifact download link in Run History.** In `run-history-drawer.tsx`, when a run's `result` contains an export node output with an `objectKey`, render a "Download" link to `/api/workflows/artifacts/<objectKey>`. (Scan `result.results` for an output with `objectKey`.)

- [ ] **Step 6: Gates + commit**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test`
Expected: green.

```bash
git add apps/web/src/workflows apps/web/src/api.ts
git commit -m "feat(web): sink node forms (materialize/export/dhis2-push) + Datasets view + artifact download"
```

---

## Task 5: Full gate + verification

- [ ] **Step 1: Full gate** — `pnpm turbo typecheck lint test build` (re-run `@openldr/web`/`@openldr/server` isolated if the known parallel flake hits).
- [ ] **Step 2: depcruise** — `pnpm depcruise` → clean.
- [ ] **Step 3: Manual e2e** (live stack): Trigger → SQL (`select 1 as n`) → Materialize ("ds1"); Run; open the Datasets view, confirm `ds1` with 1 row + download CSV. Trigger → SQL → Export (csv); Run; download the artifact from Run History. With DHIS2 configured, a DHIS2 Push node (dryRun) returns a push outcome; without DHIS2, it errors "not available".
- [ ] **Step 4:** Commit fixes; proceed to `superpowers:finishing-a-development-branch`. This completes the Workflow Builder workstream.

---

## Self-review notes (author)
- **Spec coverage:** §2 services extension → Task 2/3; §3.1 materialize → Tasks 1,2,3,4; §3.2 export → Tasks 2,3,4; §3.3 dhis2 → Tasks 2,3,4; §4 web → Task 4; §5 testing → Tasks 1,2,3 + 5.
- **Type consistency:** `WorkflowDataset`/`DatasetInput`/`WorkflowDatasetStore`, `ExportArtifactInput`/`ExportArtifactResult`/`Dhis2PushInput`, `materializeHandler`/`exportHandler`/`dhis2PushHandler`, `ctx.workflowId`, `RunWorkflowOptions.workflowId`, `ctx.workflows.datasets`/`.services.dhis2Push`. Config keys `datasetName`/`format`/`filename`/`mappingId`/`period`/`dryRun` uniform between handlers (Task 2) and forms (Task 4).
- **Soft spots flagged:** migration number free-check (Task 1); `JSONColumnType`/`Generated` convention (Task 1); `RunCallbacks` requiredness for `runMapping` (Task 3 Step 2); `ctx.blob` read method name + return type (Task 3 Step 3); `randomUUID` import presence in bootstrap (Task 3 Step 1); lucide icon validity + `node(...)` helper signature (Task 4); shared form helper props (Task 4).
- **Placeholder scan:** none — code concrete; "verify against real file" notes are guardrails.
