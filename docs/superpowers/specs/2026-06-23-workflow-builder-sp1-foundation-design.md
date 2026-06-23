# Workflow Builder — SP-1: Foundation + Canvas (Design)

**Date:** 2026-06-23
**Status:** Design — awaiting user approval
**Branch / worktree:** `feat/workflow-builder-sp1` (isolated worktree, parallel to the in-flight marketplace work)
**Source of truth for the UI:** `../workflow-builder` (the user's standalone Turborepo — copy the visual workflow builder *exactly*)

---

## 1. Background & goal

OpenLDR users today simplify analytics by hand: they **create database views** for reporting and **stand up separate Node.js projects** to run analysis, then **manage the two separately**. The goal is to fold both jobs into one **internal, node-based visual workflow builder** — an n8n-style canvas where a workflow reads lab data, transforms/analyses it, and writes results to a downstream sink.

The user has an existing, polished standalone implementation at `../workflow-builder` and wants its **Workflow Builder page copied exactly** (they invested significant time in the UX), adapted to run *internally* inside OpenLDR CE with access to the lab's real data.

This work runs **in parallel** with the marketplace workstream. Analysis confirms the collision surface is tiny and entirely additive (see §10).

### Decomposition (whole workstream)

The full feature is large (all data sources, all sinks, sandboxed code, four trigger types). It is split into sub-projects, each with its own spec → plan → implementation cycle:

- **SP-1 — Foundation + canvas** *(this spec)*: copy the page to parity; engine package; persistence; CRUD + manual SSE execution; 6 declarative node handlers; integration + gating. A complete, shippable vertical slice with **zero arbitrary-execution surface**.
- **SP-2 — Sandboxed Code node**: `worker_thread` execution with memory/timeout limits, captured console → `node:log`, template resolver wired to user code.
- **SP-3 — Domain data nodes**: sources (Reporting ExternalSchema query, gated raw SQL, FHIR query, HTTP) + sinks (materialize-to-dataset, export artifact CSV/XLSX/PDF, DHIS2 push). *This is the actual "replace DB views + feed reports/dashboards" payload.*
- **SP-4 — Triggers beyond manual**: scheduled (cron, report-scheduler pattern), webhook listener, on-ingest event hook.

This sequences risk: prove the page + persistence + engine end-to-end first, then add one capability per slice.

---

## 2. Confirmed product decisions

| Decision | Choice |
| --- | --- |
| Scope of this workstream | **Workflow Builder page only** (the Code Editor / Bolt-style page from the standalone is **out of scope** entirely). |
| Data sources (eventual, SP-3) | Reporting ExternalSchema **+** gated raw SQL **+** FHIR store **+** external HTTP. Node-based ⇒ open-ended catalog. |
| Output sinks (eventual, SP-3) | Materialize-to-dataset **+** export artifact **+** DHIS2 push, and anything else as future nodes. |
| Code execution model (SP-2) | **`worker_thread` + memory/timeout limits**, no ambient FS/network. (Not vm; not the marketplace capability sandbox.) |
| Triggers (eventual, SP-4) | Manual **+** scheduled (cron) **+** webhook/event **+** on-data-ingest. SP-1 ships **manual only**. |
| Architecture | **(A)** New `packages/workflows` package + thin Fastify routes + one web page, wired into `AppContext`. |
| Node palette in SP-1 | **Full ~191-template catalog visible**, but nodes whose handlers aren't implemented yet are **disabled** ("coming soon", non-draggable). |
| Durable execution engine | **Drop Inngest.** Run in-process (like `report-scheduler` / event-bus runner). |

---

## 3. SP-1 scope

### In scope
- The Workflow Builder **page copied to visual/UX parity**: ReactFlow canvas, draggable + searchable node palette, per-node config forms, node-config panel (Config / Input / Output tabs), execution panel with live Logs, Zustand store, toolbar (workflow name, Save, Run).
- A new isolated, unit-tested **`packages/workflows`** engine package (runner, node-handler registry, template resolver, `WorkflowStore`).
- **Persistence**: internal-PG `workflows` table (migration + schema type + registration) and `WorkflowStore`.
- **Fastify routes**: CRUD + `execute-stream` (SSE) in `apps/server/src/workflows-routes.ts`.
- **Integration**: `ctx.workflows` in bootstrap; route registration in `app.ts`; `/workflows` route in `App.tsx`; sidebar nav item (role-gated) + i18n in `AppShell`.
- **Working node handlers (6)**: manual **Trigger**, **Set**, **Filter**, **If/Condition**, **Merge**, **Log**. All are declarative except that **If/Filter evaluate a user-supplied boolean expression inside a bounded 1-second `vm` context** (only `$input` exposed, no `require`/globals) — a small surface, RBAC-gated to `lab_admin`/`lab_manager`. The fully-isolated `worker_thread` execution model is reserved for the **Code node in SP-2**; there is no Code node in SP-1.

### Out of scope (later slices)
- Code node execution (SP-2), domain source/sink nodes (SP-3), schedule/webhook/ingest triggers (SP-4).
- The standalone's Code Editor page, Monaco, `esbuild-wasm`, Sandpack, XTerm — none are ported.
- The legacy Inngest `/execute` path.

---

## 4. `packages/workflows` (new package)

Mirrors `packages/dashboards`: exports `src` directly (no tsup build, avoids the turbo dist-race), Zod + Kysely + pg-mem.

```
packages/workflows/
  package.json            # @openldr/workflows; deps @openldr/db, kysely, zod; dev pg-mem, vitest, typescript
  tsconfig.json           # extends repo base, include ["src"]
  src/
    index.ts              # public exports: types, store factory, runWorkflow, RunEvent
    types.ts              # Zod schemas + inferred types (see §4.1)
    store.ts              # WorkflowStore over Kysely<InternalSchema>
    store.test.ts         # pg-mem CRUD tests
    engine/
      run-workflow.ts     # runWorkflow(nodes, edges, { input, onEvent }) — ported, framework-agnostic
      run-workflow.test.ts# topological order, branch pruning, error cascade, event protocol
      execution-context.ts# ExecutionContext { input, nodeOutputs, logs, emit, edges }
      template.ts         # {{ $input.x }}, {{ $json.x }}, {{ $node('id').x }} dot-path resolver
      template.test.ts    # resolver unit tests (the standalone had none)
      node-handlers/
        index.ts          # pickHandler(node) router (type + action)
        trigger.ts set.ts filter.ts if.ts merge.ts log.ts default.ts
```

The engine code (`run-workflow`, `execution-context`, `template`, handlers) is ported **verbatim in logic** from `apps/api/src/lib/*` in the standalone — it has no Express/Inngest dependency, so it drops cleanly into a package. We **add unit tests** that the standalone deferred.

### 4.1 Type & data shapes

`WorkflowDefinition = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }`, stored as JSON. `Workflow` row: `{ id, name, description, definition, enabled, createdBy, createdAt, updatedAt }`. Node/edge shapes match the standalone's `lib/types.ts` (`WorkflowNodeData` union over trigger/action/condition/loop/webhook/code; edges carry `sourceHandle` for true/false branches). All validated with Zod on the store boundary.

### 4.2 SSE event protocol (preserved verbatim)

```
node:start    { nodeId, nodeType }
node:log      { entry: { nodeId, level, message, ts } }
node:success  { nodeId, nodeType, input, output, durationMs }
node:error    { nodeId, nodeType, error, durationMs }
workflow:done { status: 'completed' | 'failed' }
```

The frontend already speaks exactly this; the runner already emits it. We do not change the wire format.

---

## 5. Persistence

- **Migration** `packages/db/src/migrations/internal/0NN_workflows.ts` — `workflows` table: `id text pk`, `name text not null`, `description text`, `definition jsonb not null default '{}'`, `enabled boolean not null default true`, `created_by text`, `created_at/updated_at timestamptz default now()`, index on `created_by`. `down` drops the table.
- **Schema type** `WorkflowsTable` added to `packages/db/src/schema/internal.ts` and to the `InternalSchema` interface.
- **Registration** in `packages/db/src/migrations/internal/index.ts`.
- **`WorkflowStore`** (`packages/workflows/src/store.ts`): `list / get / create / update / remove`, Zod-parse on read, `JSON.stringify(definition)` on write — the `DashboardStore` pattern, tested with pg-mem.

> **Migration-number coordination (the one real parallel-work risk).** 026 is the latest committed migration; 027 is currently free. The marketplace agents could claim the next integer in parallel. **Mitigation:** pick the next free number at implementation time and, if it clashes at merge, renumber ours (migrations are independent + idempotent with `ifNotExists`, so renumbering is mechanical).

---

## 6. Server routes — Fastify (not Express)

The standalone is **Express + Inngest**; OpenLDR is **Fastify** and we are **dropping Inngest**. New `apps/server/src/workflows-routes.ts` (template: `dashboards-routes.ts` for CRUD, `ontology-routes.ts` for SSE):

- `GET  /api/workflows` — list (authenticated read).
- `GET  /api/workflows/:id` — get one (404 if missing).
- `POST /api/workflows` — create. `requireRole('lab_admin','lab_manager')` + `recordAudit('workflow.create')`.
- `PUT  /api/workflows/:id` — update. Role-gated + audited (before/after).
- `DELETE /api/workflows/:id` — delete. Role-gated + audited.
- `POST /api/workflows/:id/execute-stream` — role-gated. `reply.hijack()`, write `text/event-stream`, pipe `runWorkflow({ onEvent })` frames as `data: <json>\n\n`, terminate with a `done` frame carrying the final result. Mirrors the existing `ontology-routes.ts` SSE approach.

Registered in `apps/server/src/app.ts` via `registerWorkflowRoutes(app, ctx)`.

---

## 7. Web page (copy exactly, with mechanical adaptations)

Ported to `apps/web/src/workflows/` (page, `components/`, `hooks/`, `lib/`, `constants.ts`), routed at `/workflows`. The structure, component breakdown, store fields/actions, canvas behaviour, palette, forms, and panels match the standalone 1:1. Required swaps:

1. **`@workflow-builder/ui` → `@/components/ui`** (OpenLDR's shadcn). Any primitive the builder needs that is missing in OpenLDR (e.g. Tabs) is created in `components/ui` — per the standing "always use shadcn primitives" rule.
2. **Add deps to `apps/web/package.json`**: `@xyflow/react@^12` and `react-resizable-panels` (neither is currently installed). `zustand`, `lucide-react`, Tailwind v4, and shadcn/Radix are already present.
3. **React 18, not 19** — `@xyflow/react@12` supports both; the canvas uses no React-19-only APIs, so no source changes are expected. Any that surface are fixed during the port.
4. **Auth + SSE** — `EventSource` cannot send a bearer token, but the standalone's `executeStream` already uses **fetch + a hand-rolled SSE reader**, so we route it through OpenLDR's existing `authFetch` token attachment. No server-side `?access_token=` hack needed.
5. **Router** — `react-router-dom@6` (OpenLDR) vs `react-router@7` (standalone): the page does not depend on router internals; the route is a one-liner in `App.tsx`.
6. **Disabled-node affordance** — `constants.ts` node templates gain an `available` flag computed from the implemented-handler set; the sidebar renders unavailable tiles greyed-out, non-draggable, with a "coming soon" hint.

A Zustand store lives at `apps/web/src/workflows/store.ts` (canvas/run state — the standalone's `use-workflow-store`), distinct from a thin list/API store. API client functions (`fetchWorkflows`, CRUD, `executeStream`) added to `apps/web/src/api.ts` using `authFetch`.

---

## 8. Roles & access

- **Read** (list/get): any authenticated user.
- **Create / update / delete / execute**: `lab_admin` or `lab_manager` (matches reports/schedules gating).
- The sidebar "Workflows" nav item is shown only to those roles (same `hasRole` pattern as Settings).

---

## 9. Testing & verification

- **Package unit tests**: `store.test.ts` (pg-mem CRUD), `run-workflow.test.ts` (topo order, branch pruning, error cascade, event protocol), `template.test.ts` (dot-path / `$node` resolution, missing-path → empty).
- **Server tests**: `workflows-routes.test.ts` following `dashboards-routes.test.ts` (CRUD happy/❌ paths, RBAC 403s, SSE frame sequence for a small graph).
- **Gate**: `turbo typecheck lint test build` + `depcruise` clean across the affected packages.
- **Manual browser e2e** (the standalone left this "pending"): drag two nodes → connect → Save → Run → observe live per-node state animation (pulsing running → success/error) + the Logs tab streaming.

---

## 10. Collision surface with the parallel marketplace work

Everything new lives in **new files / new directories**. Only these shared files are **appended to** (never restructured):

| File | Change | Marketplace touches it? |
| --- | --- | --- |
| `apps/web/src/App.tsx` | +1 `<Route>` | adds settings routes — different lines, trivial merge |
| `apps/web/src/shell/AppShell.tsx` | +1 nav item + icon + i18n key | unlikely; additive |
| `packages/bootstrap/src/index.ts` | +`ctx.workflows` | adds `ctx.plugins` — additive, different block |
| `apps/server/src/app.ts` | +`registerWorkflowRoutes` | adds marketplace routes — adjacent, additive |
| `packages/db/src/migrations/internal/index.ts` + a new migration | +1 migration | **only true contention point — see §5 mitigation** |
| `apps/web/package.json` / lockfile | +2 deps | possible lockfile churn — regenerate on merge |
| i18n `en/fr/pt` | +`nav.workflows` | additive |

Net: safe to build fully in parallel; the only coordination is the migration integer.

---

## 11. Open questions / deferred

- Exact migration integer (resolve at implementation time per §5).
- Whether `description` is surfaced in the SP-1 UI or stored-only (lean: stored-only in SP-1, surface later).
- Per-user ownership (`created_by` is recorded but not enforced/filtered in SP-1; reserved like dashboards' `owner_id`).
