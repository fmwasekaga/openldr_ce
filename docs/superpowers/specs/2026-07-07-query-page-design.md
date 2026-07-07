# Query Page — Design Spec

- **Date:** 2026-07-07
- **Status:** Approved design, ready for implementation planning
- **Author:** brainstormed with Fredrick (visual companion)
- **Surface:** `apps/studio` (new global page) + `apps/server` (new routes) + `packages/db` (new store/migration)

---

## 1. Overview

A new **Query** page in Studio: a SQL workbench for browsing connected databases, authoring
and running SQL, and — the point of the whole thing — **saving parameterized live queries
("Custom Queries") as durable, reusable entities** that other Studio surfaces (workflows,
dashboards, reports) can consume.

Inspired by the standalone workbench prototype at `D:\Projects\Testing\workbench` (dockview +
glide-data-grid + CodeMirror), but reskinned to Studio's own theme-aware design system and
folded in as a normal in-shell page rather than a separate tool.

### Core value

```
Custom Query (live SQL, parameterized)
        │  saved here, exposed via API
        ▼
   consumed by a Workflow source node  ──▶  populates a Dataset (materialized workflow_datasets)
        │                                            │
        └──▶ consumed live by dashboards/reports     └──▶ browsable/queryable here like a table
```

The Custom Query becomes a **named source** other pages pick from a dropdown instead of
re-writing SQL. This spec builds the authoring surface + the durable entity; the workflow
source node that reads a Custom Query is designed here and built in a follow-up slice.

---

## 2. Goals / Non-goals

### Goals
- A `/query` global page, in the Studio shell, theme-aware (light + dark).
- Left **explorer tree**: `System → { Connectors, Datasets, Custom Queries }`, collapsible.
- Browse a connector's schemas/tables; open a table in a paginated, filterable grid.
- A **tabbed workspace**: many tabs open at once, each either a *table browse* or a *query*.
- A **query tab**: CodeMirror SQL editor split over a live results grid (draggable divider).
- **Save Custom Queries**: durable `{ name, connectorId, sql, params[] }` with a REST API.
- **Parameterized** Custom Queries reusing the existing `text | select | daterange` model.
- A typed **Run sheet** (right-side `Sheet`) to supply parameter values when testing.
- Browse/query existing **Datasets** (`workflow_datasets`) like tables.

### Non-goals (this slice)
- The Workflow source node that turns a Custom Query into a Dataset (designed §9, built next).
- Materializing / caching Custom Query results (they are always live).
- Write SQL (INSERT/UPDATE/DDL). Read-only `SELECT`/`WITH` only, matching the dashboard gate.
- New parameter types beyond `text | select | daterange` (trivial to add later).
- Cross-connector joins, query versioning/history, collaborative editing.
- Housekeeping of orphaned datasets left by deleted workflows (noted §8, out of scope).

---

## 3. Placement & navigation

- Route: `/query`, registered in `apps/studio/src/App.tsx`, wrapped in `AppShell`.
- Nav entry added to `NAV` in `apps/studio/src/shell/AppShell.tsx` (`nav.query`, a `Database`
  or `Terminal` lucide icon). Roles: gated to `lab_admin`, `lab_manager`, `data_analyst`
  (SQL authoring is powerful; mirrors who can touch dashboards/reports). i18n keys added to
  en/fr/pt with the `EnShape` key-parity constraint.
- The page renders its own two-column interior (explorer tree + workspace) inside the normal
  content area. The global rail already collapses to icons, so the double-left-column is fine.

---

## 4. The explorer tree

Root node **System**, three branches, each lazy-loaded and collapsible:

```
System
├─ 🔌 Connectors
│    └─ <connector name> (postgres/mssql/mysql…)
│         └─ <schema>
│              └─ <table>            → click: opens a table-browse tab
├─ 📦 Datasets
│    └─ <dataset name>               → click: opens a dataset-browse tab (read stored rows /
│                                       SELECT from published_table)
└─ ⚡ Custom Queries
     └─ <query name>                 → click: opens a query tab loaded with saved SQL + params
```

- **Connectors** are read from the existing `ConnectorStore`, filtered to SQL-database types.
  Expanding a connector calls a **new introspection endpoint** (§7) to list schemas → tables.
- **Datasets** are read from `workflow_datasets` (list). A dataset with a `published_table`
  can be queried live; otherwise its stored `rows` are shown read-only.
- **Custom Queries** are read from the new `custom_queries` store (§6). A kebab/right-click menu
  offers Rename / Duplicate / Delete. A `+ New query` action opens a blank query tab.
- A filter box at the top of the tree filters visible nodes (client-side over loaded nodes).
- Collapse control on the tree header hides it entirely, giving the workspace full width.

---

## 5. Workspace (tabbed)

A tab bar spanning the workspace. Tabs are one of two kinds; both closable, reorderable is
out of scope for v1.

### 5a. Table-browse tab (from a Connector table or a Dataset)
- Toolbar: **Filter**, **Sort**, **Refresh**, and a **`</> SQL`** button that opens a *new*
  query tab seeded with `SELECT * FROM <table>` bound to the same connector.
- Body: paginated, filterable data grid.
- Footer status bar: `<from>–<to> of <total>` + `‹ Prev` / `Next ›` pagination.
- Data is fetched via the run/browse endpoint (§7) with server-side `limit`/`offset` and an
  optional filter expression; the grid never loads a whole table.

### 5b. Query tab (Custom Query authoring)
- **CSS flex split**: editor pane on top, results pane below, draggable horizontal divider
  (port the prototype's `QueryPanel` split — synchronous sizing so the grid paints on mount).
- Editor: CodeMirror with `@codemirror/lang-sql`, Studio-themed (not `oneDark`; use the
  Studio token bridge so it matches light/dark). `{{param.*}}` tokens are highlighted.
- Editor toolbar: **▶ Run** (⌘↵), **💾 Save**, a **Parameters** button (opens the
  `ParametersEditor`), the bound **connector** selector, and a dialect/timing readout.
- Results pane: the live result grid + a status line (`N rows · M ms`). Multiple `;`-separated
  statements produce multiple result tabs (as in the prototype), read-only.
- **Run** with declared params → opens the **Run sheet** (§8) to collect values, then executes.

### Tab/session model
- Tabs live in a page-level store (Zustand, mirroring `dashboard/store.ts`). No server-side
  session; open tabs are ephemeral (optionally persisted to `localStorage` for reload comfort —
  nice-to-have, not required).

---

## 6. Data model — Custom Query entity

### Storage: new internal table `custom_queries` (new migration, `packages/db`)

| column        | type          | notes                                                        |
|---------------|---------------|--------------------------------------------------------------|
| `id`          | text PK        | `cq_<uuid6>`                                                 |
| `name`        | text NOT NULL UNIQUE | display name, also the reference key surfaced to consumers |
| `connector_id`| text NOT NULL  | FK-by-convention to `connectors.id` (no hard cascade)       |
| `sql`         | text NOT NULL  | read-only SELECT/WITH, may contain `{{param.*}}`            |
| `params`      | jsonb NOT NULL default `'[]'` | array of `CustomQueryParam` (below)          |
| `created_at`  | timestamptz    | `now()`                                                      |
| `updated_at`  | timestamptz    | `now()`                                                      |

Added to `packages/db/src/schema/internal.ts` (`CustomQueriesTable`) + a `CustomQueryStore`
(`packages/db/src/custom-query-store.ts`) with `list/get/getByName/create/update/remove`,
following `report-schedule-store.ts` as the pattern.

### `CustomQueryParam` — reuse the report-builder shape

Mirror `ReportParam` (`packages/report-builder/src/schema.ts`) exactly so a query authored here
is described identically to report/dashboard params:

```ts
{ id: string; label: string; type: 'text' | 'select' | 'daterange'; required: boolean; optionsSql?: string }
```

- `daterange` binds `{{param.from}}` + `{{param.to}}` (same convention the report-builder lint
  already encodes).
- `select` carries `optionsSql` — a read-only query run against the query's connector to
  populate the dropdown.
- The canonical Zod schema lives in a shared `pure` module so server + studio + future
  consumers validate against one definition (avoid the hand-maintained-mirror drift noted for
  `apps/studio/src/api.ts`).

### Consumption contract (stable, depended on by §9)
A saved Custom Query is addressable by `id` (and `name`). Consumers receive
`{ id, name, connectorId, sql, params }` and are responsible for supplying param values, which
are resolved with the shared `resolveQueryParams` before execution.

---

## 7. Backend routes (`apps/server`)

New `registerQueryRoutes(app, ctx, { connectors, customQueries })`, registered in `app.ts`
alongside the connectors routes, sharing a `createConnectorStore(ctx.internalDb)`.

### Introspection (Connectors branch)
- `GET  /api/query/connectors` — SQL-typed connectors (id, name, type).
- `GET  /api/query/connectors/:id/schemas` — list schemas.
- `GET  /api/query/connectors/:id/schemas/:schema/tables` — list tables (+ optional columns).

  Introspection is dialect-specific (Postgres `information_schema`, MSSQL `sys.*`). Factor the
  connector→driver path already used by the workflow `postgres` host node
  (`packages/workflows/src/host-nodes.ts:67`) into a reusable read-only query executor.

### Execution
- `POST /api/query/run` — body `{ connectorId, sql, params?, limit?, offset? }`. Runs read-only
  (`SELECT`/`WITH` only — reuse the dashboard authoring-gate validation), substitutes
  `{{param.*}}` via the shared resolver, returns `{ columns, rows, rowCount, ms }`. Applies a
  hard row cap and honors `limit`/`offset` for grid pagination.
- `GET  /api/query/tables/:connectorId/:schema/:table` — convenience browse (server-side
  paginate/filter) → same result envelope. (May be `/run` with a generated SELECT instead;
  decide in planning.)
- `POST /api/query/param-options` — body `{ connectorId, optionsSql }` → distinct values for a
  `select` param's dropdown. Read-only, capped.

### Custom Query CRUD
- `GET/POST /api/custom-queries`, `GET/PUT/DELETE /api/custom-queries/:id`. `POST`/`PUT`
  validate the shared schema; audited via `recordAudit` (`customQuery.create/update/delete`).

### Datasets (read-only here)
- Reuse/observe existing `workflow_datasets` access: `GET /api/query/datasets` (list) and
  browse via `/api/query/run` against `published_table` when present, else return stored rows.

All routes gated by `requireRole` (`lab_admin`/`lab_manager`/`data_analyst`) and the existing
`DASHBOARD_SQL_ENABLED`-style raw-SQL flag where the dashboard already gates arbitrary SQL.

---

## 8. Parameterized Run sheet

- Trigger: **Run** on a query tab that has declared params (or a param chip click).
- UI: right-side `Sheet` (`components/ui/sheet.tsx`) titled "Run parameters", one control per
  declared param rendered by **type**:
  - `daterange` → a single date-range picker filling both `from` & `to`.
  - `select` → a dropdown populated live via `POST /api/query/param-options`.
  - `text` → an `Input`.
- Values default from each param's default; `required` params block Run until filled.
- On confirm, values feed the **shared `resolveQueryParams`** (`useBlockData.ts` today) →
  `{{param.*}}` substitution → `POST /api/query/run`. Same substitution semantics a workflow or
  dashboard uses, so testing here is faithful to production consumption.

*Note:* the Run sheet reads the query's **declared param list** to know types — types are never
inferred from the SQL tokens.

---

## 9. Workflow consumption (designed now, built next)

A follow-up slice adds a Workflow **source node** "Custom Query" that:
- config: `customQueryId` (select, `optionsSource: 'custom-queries'`), plus inputs for any
  declared params (the node exposes the query's `params` as node config).
- run: fetches the Custom Query, resolves params from node config/inputs, executes read-only
  against its connector, emits rows as `WorkflowItem[]`.
- a downstream "Publish Dataset" step writes those rows into `workflow_datasets` (existing
  materialized path), which then appears under the **Datasets** branch here — closing the loop.

The stable contract in §6 (address by id, receive `{sql, params, connectorId}`, resolve with
the shared resolver) is what makes this buildable without reworking the page.

---

## 10. Components (studio) — file breakdown

```
apps/studio/src/query/
  QueryPage.tsx            # route shell: tree | workspace, collapse state
  store.ts                 # zustand: open tabs, active tab, tree expansion
  tree/
    ExplorerTree.tsx       # System → Connectors/Datasets/Custom Queries, lazy load, filter
    TreeNode.tsx
  workspace/
    TabBar.tsx
    TableTab.tsx           # browse grid + toolbar + pagination footer
    QueryTab.tsx           # editor/results split (port QueryPanel), toolbar, Save
    SqlEditor.tsx          # CodeMirror, Studio-themed, {{param}} highlight
    ResultsGrid.tsx        # result set(s), status line
  params/
    RunParamsSheet.tsx     # typed Sheet (reuses resolveQueryParams)
    # ParametersEditor reused from reports-builder (extract to shared if needed)
  api.ts                   # typed client for /api/query/* and /api/custom-queries
```

Grid choice: reuse Studio's existing `components/data-table` (TanStack) rather than pulling in
glide-data-grid — keeps the bundle lean and the look native. Revisit only if perf on large
result sets demands a virtualized canvas grid.

---

## 11. Security & correctness
- Read-only enforcement server-side (parse/allow only `SELECT`/`WITH`), not just UI.
- Row cap on every execution path; `limit`/`offset` for browse.
- Param substitution via the shared resolver (parameterization, not string-concat of user
  values into SQL where avoidable; where values must interpolate, they pass through the same
  vetted path the dashboard uses).
- Connector secrets never leave the server; the studio only ever sends `connectorId`.
- RBAC + raw-SQL feature flag on all routes. Audit on Custom Query mutations.

---

## 12. Testing
- **db:** `custom-query-store` CRUD unit tests; migration round-trip in `migrations.test.ts`.
- **server:** `query-routes.test.ts` (introspection shapes, read-only rejection of non-SELECT,
  param resolution, row cap, RBAC) + `custom-queries` CRUD tests.
- **studio:** `QueryPage`, `ExplorerTree` (lazy load + filter), `QueryTab` (run→results),
  `RunParamsSheet` (renders control per type; required-gating), `store` tab lifecycle.
- **gate:** `pnpm turbo run typecheck test --force` (never pipe through `tail`); watch the two
  known pre-existing flakes.

---

## 13. Build slices (for writing-plans)
1. **S1 — entity + API:** `custom_queries` migration + store + shared param schema +
   `/api/custom-queries` CRUD + audit + tests.
2. **S2 — introspection + run:** `/api/query/connectors*`, `/api/query/run`, `/param-options`,
   read-only gate, row cap, reusable connector executor + tests.
3. **S3 — page shell + tree:** `/query` route, nav entry, i18n, `ExplorerTree` over live
   connectors/datasets/custom-queries, collapse/filter.
4. **S4 — workspace tabs:** TabBar + TableTab (browse/paginate/filter) + `</> SQL` seeding.
5. **S5 — query tab:** editor/results split, Save, multi-statement results.
6. **S6 — parameters:** ParametersEditor wiring + RunParamsSheet + resolver integration.
7. **(next) S7 — workflow source node:** Custom Query → Dataset (separate spec/plan).

---

## 14. Open questions / risks
- **Introspection dialects:** Postgres + MSSQL first; MySQL/others as connectors demand. Each
  needs its `information_schema`/`sys` variant.
- **Browse vs run unification:** table browse may just be a generated `SELECT * … LIMIT/OFFSET`
  through `/api/query/run`; confirm in planning to avoid two code paths.
- **Grid at scale:** TanStack table vs a virtualized canvas grid if result sets get large.
- **Orphaned datasets:** deleting a workflow leaves `workflow_datasets` rows (confirmed: no
  cascade). Out of scope, but the Datasets branch should tolerate a null/dangling `workflow_id`.
```
