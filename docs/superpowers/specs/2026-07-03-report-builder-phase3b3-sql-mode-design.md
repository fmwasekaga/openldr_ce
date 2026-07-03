# Report Builder — Phase 3b-3: SQL Mode — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** P3b-2 (`71e30a8f`) — filters + parameters + binding
**Parent design:** `docs/superpowers/specs/2026-07-03-report-builder-phase3b-data-parameters-design.md` (§C SQL mode, decomposition #3)
**Related:** [report-builder-workstream], `WidgetEditorDialog` (CodeMirror machinery), `assertSqlAuthoringAllowed` (dashboards route gate), `resolveQueryParams` (Phase-2 render)

## Problem

P3b-1/P3b-2 gave report data blocks a **builder** query editor with filters + parameter binding. Some
reports need raw SQL (joins, window functions, hand-tuned aggregates) the builder can't express. P3b-3 adds
a **Builder / SQL toggle** to the block inspector, a compact SQL editor, `dashboard.raw_sql` authoring
gating (client + server), and SQL-variable → report-parameter binding — with the live canvas and PDF
preview both reflecting parameter values, as in P3b-2.

## What already exists (no work needed)

- `WidgetQuerySchema` (`@openldr/dashboards`) already permits `mode:'sql'` blocks (`sql`,
  `variableBindings?`, `variables?`, `values?`). Report blocks store a `WidgetQuery`, so **a SQL report
  block needs no schema change / migration**.
- **Render substitution:** Phase-2 `resolveQueryParams` (`run-template.ts`) already substitutes
  `{{param.x}}` tokens in a sql-mode query's `values`. `ctx.dashboards.query` then applies the `{{var}}`
  template substitution server-side (the exact path `WidgetEditorDialog`'s "vetted preview" uses). So a SQL
  var bound to a param via `values[var]='{{param.<id>}}'` resolves at render with **zero new server render
  code**.
- **Execution is not gated:** `POST /api/dashboards/query` runs any sql-mode query regardless of
  `dashboard.raw_sql`. The flag is an **authoring** gate only, enforced on the dashboards *save* route via
  `assertSqlAuthoringAllowed`. So report canvas + preview already *execute* SQL blocks; only *authoring*
  needs gating.
- **CodeMirror machinery:** `WidgetEditorDialog` has a reusable callback-ref mount pattern (Radix portal
  timing), an `sr-only` `<textarea aria-label="SQL">` fallback for tests, `EditorState.readOnly`/
  `EditorView.editable` gating, and `extractVariables`/`extractLogicalVariables` for `{{var}}` detection.
- **Client flag:** `fetchClientConfig()` → `/api/config` → `dashboardSqlEnabled: boolean`
  (`= dashboard.raw_sql && TARGET_STORE_ADAPTER==='pg'`). `DashboardPage` already consumes it as
  `sqlEnabled` for `WidgetEditorDialog`.

## Decisions (locked during brainstorm 2026-07-03)

1. **SQL editing surface = a NEW compact modal** (`SqlQueryEditor`, ~200 lines) opened from the inspector,
   reusing `WidgetEditorDialog`'s low-level machinery but tailored to reports (var→param binding, writes
   into the block's `WidgetQuery`). (Rejected: reuse the full 685-line dashboards dialog — dashboards-shaped
   and awkward; inline-in-inspector — 264px is too cramped.)
2. **Server authoring gate = mirror dashboards.** Add `assertReportSqlAuthoringAllowed` to the
   report-templates create/update routes. (Rejected: client-only gating — bypassable via direct API, lets a
   `lab_manager` persist arbitrary SQL that executes at render.)
3. **Var→param binding storage = `values[var]='{{param.<id>}}'`** (no `variableBindings` needed; reuses
   existing render substitution).

## Architecture

### Storage model

A SQL block: `query = { mode:'sql', sql:'…{{var}}…', values: { <var>: '{{param.<id>}}' } }`.

- **Render (server):** `resolveQueryParams` replaces `{{param.id}}` in `values` → real values;
  `ctx.dashboards.query` then substitutes `{{var}}` in `sql` using `values`. Already implemented.
- **Canvas (client):** `useBlockData.resolve()` — extended (see §C) to substitute `{{param.x}}` into
  sql-mode `values` too — then `runWidgetQuery({mode:'sql', sql, values})` → `/api/dashboards/query` →
  server substitutes `{{var}}`. So canvas and PDF agree.

The stored `sql` is always the template with `{{var}}` placeholders; `values` carries the param bindings.
Gating and vetting operate on the `sql` text only (matching dashboards).

### A. `SqlQueryEditor` (new compact modal)

`apps/studio/src/reports-builder/SqlQueryEditor.tsx`. Props:
`{ open, sql, values, parameters, sqlEnabled, onClose, onSave }`.

- CodeMirror editor (reuses the `WidgetEditorDialog` mount pattern + `sr-only` textarea). Read-only when
  `sqlEnabled` is false (`EditorState.readOnly` + `editable(false)` + `readOnly` on the textarea).
- Detected `{{var}}` chips (via `extractVariables`). Each var gets a **param dropdown** listing the report's
  `parameters`; selecting one stores `values[var]='{{param.<id>}}'`, unbinding removes the key.
- Save → `onSave({ mode:'sql', sql, values })`.
- **No in-modal Run/preview** — the live canvas (driven by the P3b-2 params bar) is the preview.

### B. `QueryEditor` — Builder / SQL toggle

`QueryEditor` gains a mode toggle (two buttons) atop the data-block inspector body:

- **Builder** (existing): `BuilderForm` + `FilterListEditor`.
- **SQL:** an "Edit SQL" button (opens `SqlQueryEditor`), a read-only SQL snippet, and the list of bound
  params. The block's query is the sql-mode `WidgetQuery`.
- **Gating:** the **SQL toggle is disabled when `sqlEnabled` is false AND the block is not already
  `mode:'sql'`** — so an existing (vetted) SQL block can still be viewed/previewed with the flag off, but no
  new SQL authoring is possible. `sqlEnabled` is threaded in as a new `QueryEditor` prop.
- Switching Builder→SQL seeds `sql='select 1 as value'`, `values={}`; SQL→Builder resets to the empty
  builder query. Switching discards the other mode's config (acceptable v1).

### C. `useBlockData` — sql-mode param substitution

`resolve()` currently substitutes `{{param.x}}` only in `clone.filters` (builder). Extend it: when
`clone.mode === 'sql'` and `clone.values` is present, substitute `{{param.x}}` in each `values` entry —
identical rule to server `resolveQueryParams`. `hasModel()` already returns true for sql (`sql.trim()`),
so sql blocks already fetch; this makes their param binding take effect on the canvas.

### D. Client flag wiring

`ReportBuilderPage` fetches `fetchClientConfig()` once (like `DashboardPage`), stores `sqlEnabled`, and
threads it → `BlockInspector` → `QueryEditor` → `SqlQueryEditor`.

### E. Server authoring gate

New `assertReportSqlAuthoringAllowed(sqlEnabled, template, prevTemplates)` in `report-templates-routes.ts`,
mirroring `assertSqlAuthoringAllowed`:

- `reportSqlTemplates(t)` collects trimmed `sql` from every sql-mode block query — walk
  `t.rows[].cells[].block` (`kpi`/`chart` → `.query`; `table` → `.source` when not `'primary'`) plus
  `t.dataset` — into a `Set<string>`.
- On **POST** (create): `prevTemplates = new Set()` → any sql-mode block is new and rejected when the flag
  is off. On **PUT** (update): `prevTemplates = reportSqlTemplates(before)` → unchanged SQL is exempt.
- Flag source: `await ctx.featureFlags.get('dashboard.raw_sql')` (same as the dashboards route; the
  route-level gate uses the raw flag, not the pg-ANDed client value — consistent with dashboards).
- On violation, reply 400 with a clear error (reuse the route's existing error shape).

`persistedSqlTemplates`/`assertSqlAuthoringAllowed` live in `dashboards-routes.ts` and are dashboards-typed
(`Dashboard`). Rather than couple the two routes, the report gate is a small self-contained mirror in
`report-templates-routes.ts` (report blocks have a different shape than dashboard `widgets[]`).

## Testing

- **`SqlQueryEditor`** (RTL): `{{var}}` detection renders chips; binding a var to a param writes
  `values[var]='{{param.<id>}}'`; unbind removes the key; the `sr-only` SQL textarea is `readOnly` when
  `sqlEnabled` is false and editable when true.
- **`QueryEditor`** (RTL): Builder↔SQL toggle switches the rendered body; the SQL toggle is disabled for a
  builder block when `sqlEnabled` is false and enabled when true; an already-sql block shows SQL mode even
  with the flag off.
- **`useBlockData`** (RTL/unit): a sql-mode block with `values:{ ward:'{{param.site}}' }` and
  `params:{ site:'ICU' }` calls `runWidgetQuery` with `values.ward==='ICU'`.
- **Server gate** (`report-templates-routes.test.ts`): POST with a sql block + flag off → 400; PUT changing
  a block's SQL + flag off → 400; PUT that keeps the same SQL (layout/binding edit) + flag off → ok; all
  allowed when the flag is on. Uses the existing mocked `ctx` + a mocked `featureFlags.get`.

## Scope boundaries (YAGNI for P3b-3)

**In:** Builder/SQL toggle, compact `SqlQueryEditor` modal (read-only gating), SQL var→param binding via
`values` tokens, `useBlockData` sql substitution, client flag wiring, server authoring gate + tests.

**Out:** in-modal Run/preview (canvas is the preview); daterange param → SQL var (`{{var_from}}`/
`{{var_to}}` convention) — SQL vars bind to **scalar** params (text/select) only in v1; multi-series
(P3b-4); a test-values UI; the P3b-2-deferred lint/validation follow-ups (P3c).

## Non-obvious constraints

- **Purity:** new `reports-builder/` files import report types from `@openldr/report-builder/pure` only.
  `SqlQueryEditor` imports CodeMirror packages + studio api directly (browser code) — do NOT import from
  `WidgetEditorDialog` (it pulls the whole dashboards dialog); copy/adapt the small machinery instead, or
  extract shared helpers if clean.
- **Cross-package:** the server gate change is in `apps/server`; run the forced typecheck (no schema/shared
  type change here, but the server + studio both move). No `@openldr/report-builder` change expected.
- **Vetting parity:** the server gate compares trimmed `sql` text only (like dashboards). `values` (the
  param bindings) can change freely with the flag off — only new/edited `sql` is gated.
- **jsdom + CodeMirror:** CodeMirror needs layout APIs jsdom lacks; the mount is wrapped in try/catch and
  tests assert against the `sr-only` textarea (mirror `WidgetEditorDialog.test.tsx`).
