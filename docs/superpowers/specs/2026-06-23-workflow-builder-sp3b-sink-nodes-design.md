# Workflow Builder — SP-3b: Sink Nodes (Design)

**Date:** 2026-06-23
**Status:** Design — awaiting user approval of the written spec
**Branch / worktree:** `feat/workflow-builder-sp3b` (off `main` `8e50a3d`, which has SP-1+SP-4+SP-2+SP-3a)
**Builds on:** SP-3a's `WorkflowServices` injection; reuses `ctx.blob`, `toCsv`/`renderReportPdf`/the `renderXlsx` pattern, and the DHIS2 context's `runMapping`.

---

## 1. Background & goal

SP-3a let workflows read data; SP-3b lets them **produce output** — the write half of "replace the hand-built DB views + analysis projects." Three sink nodes: **materialize-to-dataset** (persist results so they're reusable/inspectable), **export artifact** (CSV/XLSX/PDF download), and **DHIS2 push** (send results onward via an existing mapping). This is the final slice of the Workflow Builder workstream.

### Confirmed decisions
| Decision | Choice |
| --- | --- |
| Sinks in SP-3b | **All three:** materialize-to-dataset, export artifact, DHIS2 push. |
| Materialize model | **Internal `workflow_datasets` table** (name + columns + rows JSONB, upsert by name) + read/list/download API + a simple Datasets view. Dashboards/SQL-node integration **deferred**. |
| DHIS2 push | Triggers an **existing DHIS2 mapping** for a period via the DHIS2 context's `runMapping`; available **only when DHIS2 is the configured reporting target** (node errors clearly otherwise). |
| Service access | Extend the SP-3a `WorkflowServices` with `materializeDataset` + `exportArtifact` (always available) and an **optional `dhis2Push?`** assigned post-construction in `apps/server/src/index.ts` once the DHIS2 context exists. |
| Export delivery | Render via existing helpers → `ctx.blob`; `objectKey` lands in the recorded run; a role-gated download route streams it; Run History shows a download link. |

### Rejected alternatives
- **Materialize into the reporting/target DB as a real table** (runtime DDL + writes in the target DB) and **register-as-dashboard-model** — more powerful but heavier/riskier; deferred in favor of the internal-table model.
- **DHIS2 "push arbitrary rows"** — the DHIS2 integration is mapping/period-based (`runMapping`); reusing it (not reinventing a raw dataValueSets push) is the right call.

---

## 2. Architecture — `WorkflowServices` sink extension

Extend the SP-3a interface (engine-defined; server-implemented):

```ts
// added to packages/workflows/src/engine/services.ts
export interface ExportArtifactInput { format: 'csv' | 'xlsx' | 'pdf'; filename?: string; title?: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
export interface ExportArtifactResult { objectKey: string; format: string; byteSize: number }
export interface Dhis2PushInput { mappingId: string; period: string; dryRun?: boolean }

export interface WorkflowServices {
  runSql(sql: string): Promise<SqlResult>;
  fhirQuery(resourceType: string, limit: number): Promise<{ resources: unknown[] }>;
  httpFetch(req: HttpRequest): Promise<HttpResponse>;
  // SP-3b:
  materializeDataset(name: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[], workflowId: string | null): Promise<{ dataset: string; rowCount: number }>;
  exportArtifact(input: ExportArtifactInput): Promise<ExportArtifactResult>;
  /** Optional — present only when DHIS2 is the configured reporting target. */
  dhis2Push?(input: Dhis2PushInput): Promise<unknown>;
}
```

- `materializeDataset` + `exportArtifact` are built in **bootstrap** (always available).
- `dhis2Push` is left **undefined** by bootstrap and **assigned in `apps/server/src/index.ts`** after `createDhis2Context`: `if (dhis2) ctx.workflows.services.dhis2Push = ({mappingId,period,dryRun}) => dhis2.runMapping({ mappingId, period, dryRun, trigger: 'workflow' })`. The handler throws `"DHIS2 push not available (DHIS2 is not the configured reporting target)"` when it's absent. No engine→dhis2 coupling.

---

## 3. Sink nodes

### 3.1 Materialize-to-dataset
- **Config:** `datasetName`.
- **Handler** (`node-handlers/materialize.ts`): read upstream `{ columns, rows }` (accept `{rows}` with no columns too), call `ctx.services.materializeDataset(name, columns, rows, <workflowId from ctx>)`. Output `{ dataset, rowCount }`.
- **Persistence:** migration `0NN_workflow_datasets` (id, `name` unique, columns jsonb, rows jsonb, row_count int, workflow_id text, created_at/updated_at). `WorkflowDatasetStore` (`upsertByName`, `list`, `getByName`) in `packages/workflows`, pg-mem tested.
- **Read API:** `GET /api/workflows/datasets` (list: name/rowCount/updatedAt), `GET /api/workflows/datasets/:name` (full), `GET /api/workflows/datasets/:name.csv` (download via `toCsv`); all `requireRole('lab_admin','lab_manager')`.
- **Web:** a "Datasets" drawer/view (list + open + download). Charting/SQL-over-dataset deferred.

> The runner needs the current workflow id to stamp datasets. Thread it: add `workflowId?: string` to `RunWorkflowOptions` → `ExecutionContext`; the server passes the workflow being run; the materialize handler reads `ctx.workflowId ?? null`.

### 3.2 Export artifact
- **Config:** `format` (`csv`|`xlsx`|`pdf`), `filename` (optional; defaulted).
- **Handler** (`export.ts`): read upstream `{ columns, rows }`, `ctx.services.exportArtifact({ format, filename, title, columns, rows })`. Output `{ objectKey, format, byteSize }`.
- **Service impl (bootstrap):** `csv` → `toCsv`; `xlsx` → the `renderXlsx` helper (xlsx lib, same as report-scheduler); `pdf` → `renderReportPdf({ title, columns, rows, ... })`. Write to `ctx.blob` under `workflow-artifacts/<id>/<filename>`. Returns objectKey + byteSize.
- **Download:** `GET /api/workflows/artifacts/*` (role-gated) streams from blob with the right content-type. The export node's output (with `objectKey`) is part of the recorded run; the Run History drawer renders a download link when present.

### 3.3 DHIS2 push
- **Config:** `mappingId`, `period`, `dryRun` (bool).
- **Handler** (`dhis2-push.ts`): `if (!ctx.services?.dhis2Push) throw new Error('DHIS2 push not available …')`; else `return ctx.services.dhis2Push({ mappingId, period, dryRun })`. Output: the `runMapping` outcome (status/imported/updated/ignored/conflicts).
- **Wiring:** as in §2 — assigned in `index.ts` after the DHIS2 context is built. `runMapping` already audits the push.

### Handler routing
Add to `ACTION_HANDLERS`: `'materialize-dataset'`, `'export-artifact'`, `'dhis2-push'`.

---

## 4. Web

- Enable the three sink template ids in `IMPLEMENTED_TEMPLATE_IDS`; add catalog templates (action nodes with the right `data.action` + `config` defaults; valid lucide icons).
- **Forms:** materialize (dataset name), export (format select + filename), dhis2-push (mapping id/picker + period + dryRun toggle). Reuse the shared form helpers.
- **Datasets view** (list/open/download) + **artifact download link** in the Run History drawer.
- Config keys must match the handlers: `datasetName`; `format`/`filename`; `mappingId`/`period`/`dryRun`.

## 5. Testing
- Handler unit tests with a fake `services` (each delegates; dhis2-push throws when `dhis2Push` absent; materialize passes the workflowId).
- `WorkflowDatasetStore` pg-mem (upsert-by-name replaces; list/get).
- `exportArtifact` impl test (at least CSV bytes correct) — may live in bootstrap or as a small pure helper.
- Migration test (datasets table up/down).
- Route tests: datasets list/get/404, artifact download, RBAC 403.
- Integration: SQL → materialize (dataset persisted); SQL → export (objectKey produced).
- Full `turbo typecheck lint test build` + depcruise green. Manual e2e (materialize a SQL result, download a CSV, dry-run a DHIS2 push) deferred to acceptance.

## 6. Collision / scope
One migration (`workflow_datasets`; next free integer — marketplace took 030, so likely 031; renumber on merge if needed). Rest additive: engine services + three handlers + registry, `RunWorkflowOptions.workflowId`, bootstrap service impls + dataset store + routes, `index.ts` dhis2Push assignment, web forms/view. Independent of marketplace except the migration integer + the usual shared touch-points (config/bootstrap/api) which merge additively.

## 7. Open questions / deferred
- Dashboards/SQL-node consumption of materialized datasets (register-as-model, or let the SQL node read `workflow_datasets`).
- Dataset retention/versioning (v1 upserts by name — latest wins).
- Export size caps / streaming for very large results.
- DHIS2 push of *workflow-computed* rows (vs triggering an existing mapping) — would need a row→dataValueSet mapping UI; out of scope.
- Artifact retention/pruning.
