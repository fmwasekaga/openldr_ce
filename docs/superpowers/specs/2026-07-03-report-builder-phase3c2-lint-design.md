# Report Builder — Phase 3c-2: Lint System — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** P3c-1 (`e6949269`) — safety fixes
**Parent:** P3c polish (A safety ✓, **B lint** ← this, C authoring UX, D i18n)
**Related:** [report-builder-workstream]; mirrors the Form Builder lint (`lintFormSchema`/`FormLintIssue`/
`LintSummary`, `canPublish={!hasErrors}`); absorbs the P3b-2 dangling-param-ref follow-up

## Problem

A self-service report author can build a template that silently misbehaves: a data block with no query
(blank chart), a `{{param.x}}` filter bound to a parameter that was renamed/deleted (resolves to empty), a
SQL `{{var}}` bound to nothing, or an unused/duplicate parameter. P3c-2 adds a **lint** pass — a pure
`lintReportTemplate` producing severity-tagged issues — surfaced as a header summary, an expandable issue
list, and per-block canvas markers, with errors blocking Publish. This mirrors the Form Builder's lint
exactly and closes the P3b-2 dangling-param-ref follow-up.

## What it mirrors (Form Builder precedent)

- `packages/forms/src/lint.ts`: pure `lintFormSchema(form): FormLintIssue[]`, `FormLintIssue = { severity:
  'error'|'warning', code: <union>, message, fieldId?/sectionId? }`.
- `apps/studio/src/forms-builder/LintSummary.tsx`: compact count badge, null when clean.
- `FormBuilderPage`: `issues = useMemo(() => lintFormSchema(schema), [schema])`,
  `hasErrors = issues.some(i => i.severity==='error')`, `canPublish={!hasErrors}`, `issues` also fed to
  `FieldListPane` for per-field indicators.

## Decisions (locked during brainstorm 2026-07-03)

1. **Incomplete data blocks = error** (empty query / unbound SQL var block Publish).
2. **UI = header badge + expandable issue list + per-block canvas markers** (fullest option).
3. **Publish-only gating:** errors disable Publish; Save is always allowed (mirrors Form Builder).

## Architecture

### A. Pure linter — `lintReportTemplate`

New `packages/report-builder/src/lint.ts`, exported from `./pure` (browser+server safe; imports
`ReportTemplate`/`Block` from `./schema` and the `WidgetQuery` shape from `@openldr/dashboards`, already a
dep):

```ts
export type ReportLintSeverity = 'error' | 'warning';
export interface ReportLintIssue {
  severity: ReportLintSeverity;
  code:
    | 'empty-name' | 'empty-query' | 'unbound-sql-var'
    | 'orphaned-param-ref' | 'duplicate-param-id'
    | 'unused-parameter' | 'empty-report';
  message: string;
  rowIndex?: number;   // data-block locator
  cellIndex?: number;
  paramId?: string;    // parameter locator
}
export function lintReportTemplate(t: ReportTemplate): ReportLintIssue[];
```

**Rules** (walk `t.rows[].cells[].block`, `t.dataset`, `t.parameters`):

| code | severity | condition | locator |
| --- | --- | --- | --- |
| `empty-name` | error | `t.name.trim() === ''` | — |
| `empty-query` | error | kpi/chart/table-own block: builder query with no `model`, or sql query with empty `sql`; OR `table` `source:'primary'` while `t.dataset` is missing | row/cell |
| `unbound-sql-var` | error | a sql block whose `sql` contains a `{{var}}` (`/\{\{(\w+)\}\}/g`) with no matching key in its `values` | row/cell |
| `orphaned-param-ref` | error | a builder filter value or sql `values` entry `{{param.<id>}}` (`/\{\{\s*param\.(\w+)\s*\}\}/`) whose `<id>` ∉ defined parameter ids | row/cell |
| `duplicate-param-id` | error | an id appearing more than once in `t.parameters` | paramId |
| `unused-parameter` | warning | a defined parameter id never referenced by any `{{param.<id>}}` across all filters/sql-values | paramId |
| `empty-report` | warning | `t.rows` has no data block (kpi/chart/table) | — |

**Reference collection:** a single pass gathers every `{{param.<id>}}` id used (from builder filter values +
sql `values`) into a `Set`, powering both `orphaned-param-ref` (used-but-undefined) and `unused-parameter`
(defined-but-unused). The `{{param}}`/`{{var}}` regexes are identical to those in `chart-data`,
`SqlQueryEditor`, and `useBlockData` — do not diverge.

### B. `LintSummary` (header badge + expandable list)

New `apps/studio/src/reports-builder/LintSummary.tsx`. Props `{ issues, onSelectBlock }`. Returns `null`
when `issues` is empty. Otherwise a badge ("N errors, M warnings", amber styling) that opens a shadcn
`Popover` (or a simple toggle-expand if Popover is unavailable) listing each issue's `message`; an issue
with a `rowIndex/cellIndex` is clickable → `onSelectBlock(rowIndex, cellIndex)` selects that block in the
builder. Error rows are styled destructive, warnings amber.

### C. `ReportBuilderPage` wiring

- `const issues = useMemo(() => lintReportTemplate(template), [template]);`
- `const hasErrors = issues.some((i) => i.severity === 'error');`
- Render `<LintSummary issues={issues} onSelectBlock={(r, c) => setSelected({ row: r, cell: c })} />` in the
  header.
- The **Publish** button gains `disabled={hasErrors}`. Save/Preview unchanged.

### D. Per-block canvas markers

`issues` thread `ReportBuilderPage → ReportCanvas → CanvasBlock`. `ReportCanvas` computes, per cell, whether
any issue matches its `(rowIndex, cellIndex)` and its worst severity; `CanvasBlock` (or its canvas wrapper)
renders a small corner indicator — **red** dot/icon if the block has an error, **amber** if warning-only.
Mirrors `FieldListPane`'s per-field indicator approach. Blocks without issues are unchanged.

## Testing

- **`lintReportTemplate`** (pure unit, `lint.test.ts`): one focused case per rule — unconfigured chart →
  `empty-query`; `table` primary without dataset → `empty-query`; filter bound to a missing param →
  `orphaned-param-ref`; sql `{{ward}}` with empty `values` → `unbound-sql-var`; two params same id →
  `duplicate-param-id`; a defined-but-unreferenced param → `unused-parameter`; blank name → `empty-name`; no
  rows → `empty-report`; a fully-valid template → `[]`.
- **`LintSummary`** (RTL): counts render; clean → renders nothing; expanding shows messages; clicking an
  issue with a locator calls `onSelectBlock`.
- **`ReportBuilderPage`** (RTL): a template with an error disables Publish; a clean template enables it.
- **Per-block marker** (RTL): a `CanvasBlock` given a matching issue renders its indicator (error vs
  warning colour).

## Scope boundaries (YAGNI for P3c-2)

**In:** the pure 7-rule linter, `LintSummary` (badge + expandable list + click-to-select), Publish gating,
per-block canvas markers.

**Out:** auto-fix / quick-fix actions; server- or CLI-side lint enforcement on publish (client gate only for
now); i18n of the messages (English now; P3c-4 sweeps them); block duplicate / header-footer toggle /
keyboard shortcuts / true drag-reorder (P3c-3).

## Non-obvious constraints

- **Purity:** `lintReportTemplate` is pure and lives in `@openldr/report-builder/pure` (no pdfkit, no server
  imports) so the browser bundle stays clean. `LintSummary`/canvas markers are studio code.
- **Regex parity:** reuse the exact `{{param.<id>}}` and `{{var}}` patterns already in the codebase — a
  divergent regex would make lint disagree with what actually renders/substitutes.
- **No schema change:** lint reads the existing `ReportTemplate`; it adds no persisted fields.
- **Determinism:** issues are produced in a stable order (rows top-to-bottom, then parameters) so the summary
  list and any snapshot tests are stable.
- **Cross-package:** only `@openldr/report-builder` (new pure module) + `apps/studio` (UI). No dashboards
  change. Still run the forced typecheck (report-builder pure is consumed by server/cli/studio).
