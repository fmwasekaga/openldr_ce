# Workflow Builder — SP-3a: Source Nodes (Design)

**Date:** 2026-06-23
**Status:** Design — awaiting user approval of the written spec
**Branch / worktree:** `feat/workflow-builder-sp3` (off `main` `9fa8289`, which has SP-1 + SP-4 + SP-2)
**Builds on:** SP-1 engine + handler registry + `ExecutionContext`; reuses `ctx.dashboards.query` (SP-1/dashboards) and `ctx.fhirStore`.

---

## 1. Background & goal

SP-1/2/4 gave the workflow builder a canvas, persistence, triggers, run history, and a sandboxed Code node — but workflows still can't **read the lab's real data** declaratively. SP-3a adds **source nodes** so a workflow can pull data in: a gated **SQL query** over the reporting `ExternalSchema`, a **FHIR query**, and an allow-listed **HTTP** fetch. This is the read half of "replace the hand-built DB views" — the SQL node is the direct view replacement; its rows feed the Code/Set/Filter/Merge nodes already shipped.

SP-3 was split during brainstorming: **SP-3a = source/read nodes (this spec)**; **SP-3b = sink/write nodes** (materialize-to-dataset, export artifact, DHIS2 push) is a separate later cycle.

### Confirmed decisions
| Decision | Choice |
| --- | --- |
| Source nodes in SP-3a | **SQL query** (gated, raw SELECT over ExternalSchema), **FHIR query**, **HTTP**. (The "ExternalSchema query" and "raw SQL" collapse into one SQL node, since the gated SQL already runs against the reporting `ExternalSchema` DB.) |
| Query node form | **Raw SQL only (gated).** Reuses the dashboards sql-runner (read-only txn, row cap, timeout, `DASHBOARD_SQL_ENABLED`+pg gate). Governed-builder mode deferred. |
| HTTP SSRF posture | **Config host allow-list** (`WORKFLOW_HTTP_ALLOWLIST`). Requests to any host not on the list are rejected before fetching. Empty list ⇒ nothing allowed (strict default). |
| Service access | **Inject a `WorkflowServices` interface** via `RunWorkflowOptions` → `ExecutionContext` (the engine defines it; the server implements it). No new package coupling. |
| Engine/runtime | In-process; additive to the existing handler registry. No migrations. |

### Rejected alternatives
- **Builder / builder+SQL query forms:** the governed builder is a substantial node-form UI; raw SQL is the most direct DB-view replacement. Deferred.
- **HTTP "block private ranges" or "allow any":** the allow-list is stricter and chosen; private-range blocking is implied (off-list hosts, including internal IPs, are rejected anyway).
- **Handlers in the server / passing `AppContext` into the engine:** split registry / circular dependency. Rejected in favor of the injected `WorkflowServices`.

---

## 2. Architecture — `WorkflowServices` injection

The engine package must not import `@openldr/bootstrap` (bootstrap already depends on `@openldr/workflows`). So the engine **defines** the capability interface and the server **provides** it:

```ts
// packages/workflows/src/engine/services.ts
export interface SqlResult { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }
export interface HttpRequest { url: string; method?: string; headers?: Record<string, string>; body?: unknown }
export interface HttpResponse { status: number; headers: Record<string, string>; data: unknown }

export interface WorkflowServices {
  runSql(sql: string): Promise<SqlResult>;
  fhirQuery(resourceType: string, limit: number): Promise<{ resources: unknown[] }>;
  httpFetch(req: HttpRequest): Promise<HttpResponse>;
}
```

- `ExecutionContext` gains `services?: WorkflowServices`; `createContext` accepts it; `RunWorkflowOptions` gains `services?`. Threaded exactly like `codeLimits` (SP-2).
- Source handlers read `ctx.services`; if it is `undefined` (pure-engine unit tests with no server), they throw `"<node> requires server services"` — so the engine stays runnable standalone and the dependency is explicit.

### Server implementation (bootstrap)
```ts
const workflowServices: WorkflowServices = {
  runSql: async (sql) => {
    const r = await dashboards.query({ mode: 'sql', sql });   // enforces DASHBOARD_SQL_ENABLED + pg, read-only txn, row cap, timeout
    return { columns: r.columns.map((c) => ({ key: c.key, label: c.label })), rows: r.rows };
  },
  fhirQuery: async (resourceType, limit) => ({ resources: (await termFhirStore.listByType(resourceType, limit)).map((x) => x.resource) }),
  httpFetch: (req) => guardedFetch(req, cfg.WORKFLOW_HTTP_ALLOWLIST),
};
```
Passed via `RunWorkflowOptions.services` at both run call-sites (execute-stream route, trigger-runner). `guardedFetch` lives in the engine (`services.ts`) and is unit-testable without a server.

---

## 3. Source nodes

### 3.1 SQL Query node
- **Config:** `sql` (a SELECT statement; templated via `{{ $input.x }}` before running).
- **Handler** (`node-handlers/sql.ts`): resolve templates, `const r = await ctx.services.runSql(sql)`, return `r` (`{ columns, rows }`). Errors (SQL disabled, syntax, timeout) surface as `node:error` (the dashboards sql-runner already throws clear messages).
- **Output:** `{ columns, rows }` — downstream nodes read `{{ $input.rows }}` / iterate via Code.

### 3.2 FHIR Query node
- **Config:** `resourceType` (e.g. `Observation`), `limit` (default 100).
- **Handler** (`fhir.ts`): `return await ctx.services.fhirQuery(resourceType, limit)` → `{ resources }`.
- **Output:** `{ resources: [...] }`. (Richer querying/filtering is done downstream with Code/Filter; `listByType` is the store's only list primitive.)

### 3.3 HTTP node
- **Config:** `url`, `method`, `headers` (JSON), `body` (the existing ported `http-form`); all templated.
- **Handler** (`http.ts`): resolve templates, `return await ctx.services.httpFetch({ url, method, headers, body })` → `{ status, headers, data }`.
- **Allow-list:** `guardedFetch` parses the URL host and rejects (`throw new Error('HTTP host not allowed: <host>')`) unless the host matches an entry in `WORKFLOW_HTTP_ALLOWLIST` (exact host match, comma-separated config). Empty list ⇒ all rejected. JSON responses parsed into `data`; non-JSON returned as text.

### Handler routing
In `node-handlers/index.ts`, add to `ACTION_HANDLERS`: `'sql-query': sqlHandler`, `'fhir-query': fhirHandler`, `'http-request': httpHandler` (the standalone declared `http-request` as an action; the new ones follow suit). The web templates set `data.action` accordingly.

---

## 4. Config

Add to `@openldr/config`: `WORKFLOW_HTTP_ALLOWLIST` (string, default `''`). Parsed in `guardedFetch` as a comma-separated host list (trimmed, lowercased). SQL gating reuses the existing `DASHBOARD_SQL_ENABLED` (enforced inside `dashboards.query`) — no new SQL flag.

## 5. Web

- Enable the three source template ids in `apps/web/src/workflows/constants.ts` `IMPLEMENTED_TEMPLATE_IDS` (confirm the real ids; add SQL/FHIR templates to the catalog if not present, matching the action-node shape with `data.action`).
- **SQL form:** a SELECT-only textarea (monospace; `{{ $input }}` hint). CodeMirror SQL is a later nicety.
- **FHIR form:** `resourceType` input + `limit` number.
- **HTTP form:** already in the ported tree — add a hint that only allow-listed hosts are reachable.
- Output rows/JSON render in the existing node-config Output tab + results/Logs panels (no new viewer).

## 6. Testing

- **Handler unit tests** with a fake `ctx.services`: `sqlHandler` delegates to `runSql` and returns its result + templates the SQL; `fhirHandler` delegates to `fhirQuery`; `httpHandler` delegates to `httpFetch`; each throws a clear error when `ctx.services` is absent.
- **`guardedFetch` unit tests:** rejects an off-allow-list host; allows an on-list host (mock `fetch`); empty allow-list rejects everything; parses JSON vs text.
- **Integration:** a `runWorkflow` test with an injected fake `services` — trigger → SQL (returns 2 rows) → Set (maps a field) → Log — completes and the Log sees the mapped value.
- Full `turbo typecheck lint test build` + depcruise green. Manual e2e (run a SQL node against the live reporting DB) deferred to acceptance.

## 7. Collision / scope
Additive: new `services.ts` + three handlers + registry lines, `ExecutionContext`/`RunWorkflowOptions.services`, one config flag, bootstrap service impl + passing at two call-sites, web palette enable + two small forms. No migrations. Independent of the marketplace work.

## 8. Open questions / deferred (to SP-3b or later)
- Sink nodes (materialize-to-dataset, export artifact, DHIS2 push) — SP-3b.
- Governed builder query mode; CodeMirror SQL editor in the node form.
- Richer FHIR querying (search params) beyond `listByType`.
- Per-request HTTP timeout/size caps (the allow-list is the v1 guard; add caps in a follow-up if needed).
