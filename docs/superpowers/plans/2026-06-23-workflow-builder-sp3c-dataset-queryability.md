# Workflow Builder — SP-3c Dataset Queryability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a workflow-materialized dataset behave like a DB view — publish it as a real (single `jsonb` column) table in the target/reporting DB so the SQL node + dashboards can query it, and add a Load-Dataset source node to re-load datasets into workflows.

**Architecture:** Extend SP-3b's bootstrap `materializeDataset` to also create/replace a `wf_ds_<name>` table in the target store (via `store.transaction`) when `WORKFLOW_DATASET_PUBLISH_ENABLED` + pg; record the published name on the internal `workflow_datasets` registry. Add `loadDataset` to `WorkflowServices` + a `load-dataset` handler that returns a stored dataset's `{columns,rows}`.

**Tech Stack:** TypeScript, Kysely (`sql` tagged DDL via `store.transaction`), Postgres `jsonb`, Zod (config), Vitest + pg-mem, React (form + drawer).

**Reference spec:** `docs/superpowers/specs/2026-06-23-workflow-builder-sp3c-dataset-queryability-design.md`
**Builds on:** `main` `34082d7` (SP-1/2/3a/3b/4). SP-3b artifacts extended: `packages/workflows/src/dataset-store.ts`, the bootstrap `materializeDataset` impl, `WorkflowServices`.

---

## Conventions
- CWD is the worktree `…/.claude/worktrees/feat-workflow-builder-sp3c`. Deps installed.
- Commit after each task. Package gate after package tasks; full `turbo` gate at the end.
- **Migration number:** plan uses **`032_workflow_dataset_published`**. Before Task 1, `ls packages/db/src/migrations/internal/` (SP-3b added `031_workflow_datasets`); use the next free integer if taken, keeping filename + registry key + `migrations.test.ts` list consistent.

---

## Task 1: `published_table` on the dataset store + migration

**Files:**
- Modify: `packages/workflows/src/types.ts` (add `publishedTable` to `WorkflowDatasetSchema`)
- Modify: `packages/workflows/src/dataset-store.ts` (persist + `markPublished` + return it)
- Modify: `packages/workflows/src/dataset-store.test.ts`
- Create: `packages/db/src/migrations/internal/032_workflow_dataset_published.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`, `packages/db/src/migrations/migrations.test.ts`

- [ ] **Step 1: Add `publishedTable` to `WorkflowDatasetSchema`** in `types.ts` (after `workflowId`):

```ts
  publishedTable: z.string().nullable().default(null),
```

- [ ] **Step 2: Update the failing store test** in `dataset-store.test.ts` — add `published_table` to the pg-mem table and a `markPublished` assertion:

In the `beforeEach` table create, add `.addColumn('published_table', 'text')`. Then extend the test:
```ts
    await store.markPublished('amr', 'wf_ds_amr');
    expect((await store.getByName('amr'))?.publishedTable).toBe('wf_ds_amr');
    expect((await store.list())[0].publishedTable).toBe('wf_ds_amr');
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test dataset-store`
Expected: FAIL — `markPublished` not a function / `publishedTable` undefined.

- [ ] **Step 4: Update `dataset-store.ts`** — `fromRow` maps `published_table`; `list` returns it; add `markPublished`; add `publishedTable` to the `WorkflowDatasetStore` interface:

```ts
function fromRow(r: Record<string, unknown>): WorkflowDataset {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? []));
  return WorkflowDatasetSchema.parse({
    id: r.id, name: r.name, columns: parse(r.columns), rows: parse(r.rows),
    rowCount: Number(r.row_count ?? 0), workflowId: r.workflow_id ?? null,
    publishedTable: r.published_table ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}
```
Interface: add `markPublished(name: string, publishedTable: string): Promise<void>;` and change `list()`'s return type to include `publishedTable: string | null`. Implementation:
```ts
    async list() {
      const rows = await db.selectFrom(T).selectAll().orderBy('name').execute();
      return rows.map((r) => {
        const d = fromRow(r as Record<string, unknown>);
        return { name: d.name, rowCount: d.rowCount, workflowId: d.workflowId, updatedAt: d.updatedAt, publishedTable: d.publishedTable };
      });
    },
    async markPublished(name, publishedTable) {
      await db.updateTable(T).set({ published_table: publishedTable } as never).where('name', '=', name).execute();
    },
```
(`upsertByName` is unchanged — it inserts without `published_table`, which defaults to null; `markPublished` sets it after a successful publish.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test dataset-store`
Expected: PASS.

- [ ] **Step 6: Create migration `032_workflow_dataset_published.ts`** (confirm number free)

```ts
import { type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflow_datasets').addColumn('published_table', 'text').execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('workflow_datasets').dropColumn('published_table').execute();
}
```

- [ ] **Step 7: Register + schema type + test list.** In `migrations/internal/index.ts` add `import * as m032 from './032_workflow_dataset_published';` + `'032_workflow_dataset_published': { up: m032.up, down: m032.down },`. In `schema/internal.ts` add `published_table: string | null;` to `WorkflowDatasetsTable`. Add `'032_workflow_dataset_published'` to `migrations.test.ts` expected-keys.

- [ ] **Step 8: Gates + commit**

Run: `pnpm --filter @openldr/db test && pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/db typecheck`
Expected: green.

```bash
git add packages/workflows/src/types.ts packages/workflows/src/dataset-store.ts packages/workflows/src/dataset-store.test.ts packages/db/src/migrations/internal/032_workflow_dataset_published.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts packages/db/src/migrations/migrations.test.ts
git commit -m "feat(workflows): published_table on dataset store + migration 032"
```

---

## Task 2: `loadDataset` service + Load-Dataset handler

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`
- Create: `packages/workflows/src/engine/node-handlers/load-dataset.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Create: `packages/workflows/src/engine/node-handlers/load-dataset.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/sink-handlers.test.ts` and `run-workflow.test.ts` (extend fake `services` with `loadDataset`)

- [ ] **Step 1: Add `loadDataset` to `WorkflowServices`** in `services.ts` (after `fhirQuery`):

```ts
  loadDataset(name: string): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }>;
```

- [ ] **Step 2: Write the failing handler test** (`load-dataset.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { loadDatasetHandler } from './load-dataset';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

const services = { loadDataset: vi.fn(async (name: string) => ({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1, name }] })) } as unknown as WorkflowServices;

describe('loadDatasetHandler', () => {
  it('delegates to services.loadDataset', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    const out = await loadDatasetHandler({ id: 'l', type: 'action', data: { action: 'load-dataset', config: { datasetName: 'amr' } } }, ctx, undefined);
    expect((out as { rows: { name: string }[] }).rows[0].name).toBe('amr');
  });
  it('throws without a datasetName', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, services);
    await expect(loadDatasetHandler({ id: 'l', type: 'action', data: { config: {} } }, ctx, undefined)).rejects.toThrow(/datasetName is required/);
  });
  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(loadDatasetHandler({ id: 'l', type: 'action', data: { config: { datasetName: 'x' } } }, ctx, undefined)).rejects.toThrow(/requires server services/);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then write `load-dataset.ts`**

```ts
import type { NodeHandler } from './types';

export const loadDatasetHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services) throw new Error('Load Dataset node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Load Dataset node: datasetName is required');
  return ctx.services.loadDataset(name);
};
```

Run: `pnpm --filter @openldr/workflows test load-dataset` → PASS.

- [ ] **Step 4: Route it** in `node-handlers/index.ts` — import `loadDatasetHandler` and add `'load-dataset': loadDatasetHandler,` to `ACTION_HANDLERS`.

- [ ] **Step 5: Fix the other fake-`services` stubs.** `sink-handlers.test.ts` and `run-workflow.test.ts` build inline `WorkflowServices` literals that now miss the required `loadDataset` — add `loadDataset: async () => ({ columns: [], rows: [] })` to each (typecheck will point them out).

- [ ] **Step 6: Gate + commit**

Run: `pnpm --filter @openldr/workflows test && pnpm --filter @openldr/workflows typecheck`
Expected: green.

```bash
git add packages/workflows/src/engine/services.ts packages/workflows/src/engine/node-handlers/load-dataset.ts packages/workflows/src/engine/node-handlers/load-dataset.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/engine/node-handlers/sink-handlers.test.ts packages/workflows/src/engine/run-workflow.test.ts
git commit -m "feat(workflows): loadDataset service + Load-Dataset source handler"
```

---

## Task 3: Config flag + bootstrap publish + loadDataset impl

**Files:**
- Modify: `packages/config/src/schema.ts` (+ `schema.test.ts`)
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add the config flag.** In `packages/config/src/schema.ts` after `WORKFLOW_HTTP_ALLOWLIST` (use the `envBoolean(false)` helper the other booleans use, e.g. `DASHBOARD_SQL_ENABLED`):

```ts
    WORKFLOW_DATASET_PUBLISH_ENABLED: envBoolean(false),
```
Add to `schema.test.ts`:
```ts
  it('defaults WORKFLOW_DATASET_PUBLISH_ENABLED to false', () => {
    expect(ConfigSchema.parse(base).WORKFLOW_DATASET_PUBLISH_ENABLED).toBe(false);
  });
```
Run: `pnpm --filter @openldr/config test` → green.

- [ ] **Step 2: Import `sql`** in `packages/bootstrap/src/index.ts` — change `import { Kysely } from 'kysely';` to `import { Kysely, sql } from 'kysely';`.

- [ ] **Step 3: Add a sanitize helper** near the top of the bootstrap module (module scope, before `createAppContext`):

```ts
/** Map a dataset name to a safe `wf_ds_<...>` table identifier. */
function datasetTableName(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'ds';
  return `wf_ds_${safe}`;
}
```

- [ ] **Step 4: Extend the `materializeDataset` impl** in the `workflowServices` object. Replace the current body:

```ts
    materializeDataset: async (name, columns, rows, workflowId) => {
      await workflowDatasets.upsertByName({ name, columns, rows, rowCount: rows.length, workflowId });
      if (cfg.WORKFLOW_DATASET_PUBLISH_ENABLED && cfg.TARGET_STORE_ADAPTER === 'pg') {
        const table = datasetTableName(name);
        await store.transaction(async (trx) => {
          await sql`drop table if exists ${sql.table(table)}`.execute(trx);
          await sql`create table ${sql.table(table)} (data jsonb not null)`.execute(trx);
          if (rows.length) {
            await sql`insert into ${sql.table(table)} (data) select * from jsonb_array_elements(${sql.lit(JSON.stringify(rows))}::jsonb)`.execute(trx);
          }
        });
        await workflowDatasets.markPublished(name, table);
        return { dataset: name, rowCount: rows.length };
      }
      return { dataset: name, rowCount: rows.length };
    },
```

> Verify Kysely identifier + literal helpers against the installed version: `sql.table(name)` for the table identifier and `sql.lit(...)` for the JSON string literal. If `sql.lit` isn't available, use a bound parameter: `` sql`... jsonb_array_elements(${JSON.stringify(rows)}::jsonb)` `` (Kysely interpolates non-`sql` values as parameters — preferred over `sql.lit`). Use the parameter form if unsure. `store` is the target store (`const { store } = selectTargetStore(cfg)`) and exposes `transaction`.

- [ ] **Step 5: Add the `loadDataset` impl** to the `workflowServices` object (after `fhirQuery` or near `materializeDataset`):

```ts
    loadDataset: async (name) => {
      const d = await workflowDatasets.getByName(name);
      if (!d) throw new Error(`Dataset not found: ${name}`);
      return { columns: d.columns, rows: d.rows };
    },
```

- [ ] **Step 6: Gates + commit**

Run: `pnpm --filter @openldr/config typecheck && pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck`
Expected: green.

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts packages/bootstrap/src/index.ts
git commit -m "feat: WORKFLOW_DATASET_PUBLISH_ENABLED + publish dataset table + loadDataset impl"
```

---

## Task 4: Web — Load-Dataset node + Datasets view hint

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Create: `apps/web/src/workflows/components/node-forms/load-dataset-form.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`
- Modify: `apps/web/src/workflows/components/node-forms/sql-form.tsx` (hint)
- Modify: `apps/web/src/workflows/components/panels/datasets-drawer.tsx` + `apps/web/src/api.ts` (surface `publishedTable`)

- [ ] **Step 1: Add the template + enable.** In `constants.ts` add an action template `load-dataset` ("Load Dataset", `config:{ datasetName:'' }`, `action:'load-dataset'`, a valid lucide icon e.g. `FolderInput` or reuse `Database`) near the other sources; add `'load-dataset'` to `IMPLEMENTED_TEMPLATE_IDS`. Config key `datasetName` MUST match the handler.

- [ ] **Step 2: Create `load-dataset-form.tsx`** (mirrors `fhir-form.tsx`):

```tsx
import type { NodeFormProps } from './index';
import { FormField, TextInput } from './shared';

export function LoadDatasetForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; config?: { datasetName?: string } };
  const config = data.config ?? {};
  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value })} />
      </FormField>
      <FormField label="Dataset name" hint="Reads a previously materialized dataset's rows into this workflow.">
        <TextInput value={config.datasetName ?? ''} onChange={(e) => update({ config: { ...config, datasetName: e.target.value } })} />
      </FormField>
    </div>
  );
}
```
Register it in `node-forms/index.tsx` `pickForm` (templateId `load-dataset` → `LoadDatasetForm`).

- [ ] **Step 3: SQL-form hint.** In `sql-form.tsx`, extend the SQL field hint to add: "Published datasets are queryable as `wf_ds_<name>` (one `data jsonb` column) — e.g. `select data->>'col' from wf_ds_amr`."

- [ ] **Step 4: Surface `publishedTable` in the Datasets drawer.** In `apps/web/src/api.ts`, add `publishedTable?: string | null` to `WorkflowDatasetSummary`. In `datasets-drawer.tsx`, when a row has `publishedTable`, show it with a copyable hint `SELECT data->>'<col>' FROM <publishedTable>` (a small monospace line / code element).

- [ ] **Step 5: Gates + commit**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test`
Expected: green.

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/node-forms/load-dataset-form.tsx apps/web/src/workflows/components/node-forms/index.tsx apps/web/src/workflows/components/node-forms/sql-form.tsx apps/web/src/workflows/components/panels/datasets-drawer.tsx apps/web/src/api.ts
git commit -m "feat(web): Load-Dataset node + published-table hint in Datasets view + SQL form"
```

---

## Task 5: Full gate + verification

- [ ] **Step 1: Full gate** — `pnpm turbo typecheck lint test build` (re-run `@openldr/web`/`@openldr/server` isolated if the known parallel flake hits).
- [ ] **Step 2: depcruise** — `pnpm depcruise` → clean.
- [ ] **Step 3: Manual e2e** (live pg target, `WORKFLOW_DATASET_PUBLISH_ENABLED=true`): Trigger → SQL (`select 'blood' as specimen, 5 as n`) → Materialize ("amr"); Run; confirm the Datasets drawer shows `published_table = wf_ds_amr`; in a dashboard SQL widget (and a new workflow SQL node) run `select data->>'specimen' as specimen, (data->>'n')::int as n from wf_ds_amr` → 1 row. Add a Load-Dataset node ("amr") → Log; Run; confirm it reads the rows back. With the flag off, confirm no `wf_ds_*` table is created (internal only).
- [ ] **Step 4:** Commit fixes; proceed to `superpowers:finishing-a-development-branch`. This completes SP-3 (and the Workflow Builder workstream incl. queryable datasets).

---

## Self-review notes (author)
- **Spec coverage:** §2 publish → Task 3; §3 store/migration → Task 1; §4 Load-Dataset → Task 2 + Task 4; §5 config → Task 3; §6 web → Task 4; §7 testing → Tasks 1,2,3 + 5.
- **Type consistency:** `publishedTable`/`published_table`, `markPublished`, `loadDataset`, `loadDatasetHandler`, `datasetTableName`, `WORKFLOW_DATASET_PUBLISH_ENABLED`, config key `datasetName` — uniform across tasks and matching the handler.
- **Soft spots flagged:** migration number free-check (Task 1); Kysely `sql.table`/`sql.lit` vs bound-parameter form for the DDL/insert (Task 3 Step 4 — prefer the parameter form if unsure); `envBoolean` helper name + `base` fixture (Task 3 Step 1 / config test); `store` variable + `transaction` in bootstrap (Task 3); lucide icon validity + `node(...)` helper signature (Task 4); the inline fake-`services` literals needing `loadDataset` (Task 2 Step 5).
- **Placeholder scan:** none — code concrete; "verify against real file" notes are guardrails.
