# Workflow Builder — SP-3c: Dataset Queryability (Design)

**Date:** 2026-06-23
**Status:** Design — awaiting user approval of the written spec
**Branch / worktree:** `feat/workflow-builder-sp3c` (off `main` `34082d7`, which has SP-1+SP-2+SP-3a+SP-3b+SP-4)
**Builds on:** SP-3b (`workflow_datasets` internal table + materialize sink + `WorkflowServices`); reuses the target store (`store.transaction`) the SQL node + dashboards query.

---

## 1. Background & goal

SP-3b materializes a workflow result into the internal `workflow_datasets` table (JSONB), but that's invisible to the SQL node and dashboards (which query the **target/reporting DB**). SP-3c closes the loop so **a workflow-produced dataset behaves like a DB view**: queryable by the SQL node + dashboards, and re-loadable into another workflow. This is the final integration of the "replace hand-built DB views" goal.

### Confirmed decisions
| Decision | Choice |
| --- | --- |
| Approach | **Both:** (a) publish the dataset as a **real table in the target/reporting DB** (so the SQL node + dashboards query it), and (b) a **Load-Dataset source node** (so workflows can chain off a stored dataset). |
| Publish gating | **Opt-in `WORKFLOW_DATASET_PUBLISH_ENABLED` (default OFF)**, and **pg only** (`TARGET_STORE_ADAPTER==='pg'`). Off ⇒ internal-only (no reporting-DB DDL). |
| Published table shape | **Single `data jsonb` column**, one row per dataset row. Queried via `data->>'col'`. (Builder-model charting deferred; SQL-widget querying works.) |
| Canonical store | Internal `workflow_datasets` stays the source of truth (feeds Load node + Datasets view; works on mssql). A nullable `published_table` column records the published name. |
| Service access | `WorkflowServices` gains `loadDataset(name)`; `materializeDataset`'s publish is internal to its bootstrap impl (config-driven, no interface signature change). |

### Rejected alternatives
- **Load-dataset node only** (no real table) — doesn't make datasets queryable by dashboards/SQL. Rejected (chose Both).
- **On-by-default publish** / **typed (numeric/bool/text) columns** / **dedicated schema** — rejected in favor of opt-in flag + single JSONB column (simplest, lossless, no type inference).

---

## 2. Publish to the reporting DB

In the bootstrap `materializeDataset` impl (added in SP-3b), after the internal `upsertByName`:

```ts
let publishedTable: string | null = null;
if (cfg.WORKFLOW_DATASET_PUBLISH_ENABLED && cfg.TARGET_STORE_ADAPTER === 'pg') {
  publishedTable = `wf_ds_${sanitize(name)}`;          // sanitize: lowercase, [^a-z0-9_]→_, trim _, length-cap
  await store.transaction(async (trx) => {
    await sql`drop table if exists ${sql.id(publishedTable)}`.execute(trx);
    await sql`create table ${sql.id(publishedTable)} (data jsonb not null)`.execute(trx);
    if (rows.length) {
      await trx.insertInto(publishedTable as never)
        .values(rows.map((r) => ({ data: JSON.stringify(r) })) as never)
        .execute();
    }
  });
}
// record publishedTable on the internal registry row
```

- **Identifier safety:** the table name is built from a hard-sanitized dataset name and emitted via `sql.id(...)` (Kysely identifier quoting) — no user text reaches raw SQL. The `wf_ds_` prefix namespaces workflow tables away from lab tables.
- **Drop+recreate** each materialize = latest-wins (matches upsert-by-name).
- **mssql / flag off:** publish skipped (internal write still happens); a one-line log notes it. Safe no-op.
- The SQL node + dashboards SQL widgets then run e.g. `select data->>'specimen_type' as specimen_type, (data->>'n')::int as n from wf_ds_amr`.

## 3. Internal store + migration

- `workflow_datasets` stays canonical. **Migration `0NN_workflow_dataset_published`** adds a nullable `published_table text` column; `WorkflowDatasetStore.upsertByName` accepts/persists it; `list`/`getByName` return it. (Next free integer — marketplace is at ~030–031 territory; confirm at impl.)
- The materialize impl sets `published_table` to the published name (or null when not published).

## 4. Load-Dataset source node

- **Config:** `datasetName`.
- **Handler** (`node-handlers/load-dataset.ts`): `if (!ctx.services) throw …; return ctx.services.loadDataset(name)`. Output `{ columns, rows }` — identical shape to the SQL node, so downstream Set/Filter/Code/Merge/sink nodes chain naturally. Errors clearly if the dataset doesn't exist.
- **Service:** `WorkflowServices.loadDataset(name): Promise<{ columns: {key,label}[]; rows: Record<string,unknown>[] }>`; bootstrap impl reads `workflowDatasets.getByName(name)` (throws if missing). Works on any adapter (reads internal store).
- **Routing:** action subtype `load-dataset` in `ACTION_HANDLERS`.

## 5. Config
Add `WORKFLOW_DATASET_PUBLISH_ENABLED` (boolean, default `false`) to `@openldr/config`.

## 6. Web
- Enable a **Load-Dataset** source template + form (`datasetName` input; hint "reads a previously materialized dataset").
- The **Datasets drawer** shows `published_table` when present, with a copyable hint: `SELECT data->>'<col>' FROM <published_table>`.
- The **SQL-node form** hint gains a line: published datasets are queryable as `wf_ds_<name>` via `data->>'col'`.
- Config keys match handlers (`datasetName`).

## 7. Testing
- `loadDataset` handler (delegates to service; throws when service/dataset absent).
- Publish path unit test (fake/pg-mem target store): sanitization maps unsafe names; drop+recreate; rows inserted as jsonb; **skipped when flag off or adapter≠pg**.
- `WorkflowDatasetStore` `published_table` round-trips; migration up/down test.
- Integration (fake services): SQL → materialize (records `published_table` when enabled) → Load-Dataset reads the same rows back.
- Route: Datasets list/get returns `published_table`. Full `turbo typecheck lint test build` + depcruise green. Manual e2e (enable flag, materialize, `SELECT … FROM wf_ds_x` in a dashboard SQL widget + the SQL node; Load-Dataset chains) deferred to acceptance (needs live pg target).

## 8. Collision / scope
One migration (add column). Bootstrap materialize impl gains the publish branch; `loadDataset` service + handler; one config flag; web Load-Dataset form + Datasets-view hint. Additive; pg-only DDL behind an opt-in flag with hard sanitization. Independent of marketplace except the migration integer.

## 9. Open questions / deferred
- Builder-model charting of published datasets (would need a model that maps jsonb fields → columns, or typed columns) — deferred.
- Typed columns / per-column inference — deferred (chose single JSONB).
- mssql publish — deferred (pg-first).
- Dropping a dataset's published table when the dataset is deleted/renamed (v1 has no dataset delete; add cleanup with that feature).
- Row-count/size caps on publish — deferred (the materialize upstream is already row-capped by the SQL sql-runner).
