# Report Builder — Phase 3c-1: Safety / Correctness Fixes — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Depends on:** P3b-4 (`61c27149`) — Phase 3b complete
**Parent:** P3c polish (decomposed into P3c-1 safety, P3c-2 lint, P3c-3 authoring UX, P3c-4 i18n)
**Related:** [report-builder-workstream]; closes carried P3a-hardening + P3b-2/P3b-4 deferred review follow-ups

## Problem

Phase 3b shipped the full data/parameters/SQL/multi-series authoring flow, deferring a set of small
correctness and hardening items. P3c-1 closes them: a destructive delete has no confirmation, a save→navigate
sequence can clobber in-flight edits, parameters can have empty/duplicate ids, options-SQL failures are
silent, the `breakdown` schema is wider than the compiler honors, and a now-dead chart mapping branch
lingers. None is a feature; each is a targeted fix.

## Fixes (six)

### 1. Delete confirmation
`ReportBuilderPage`'s Delete button calls `deleteReportTemplate(tplId)` + `navigate('/reports')`
immediately (`handleDelete`). Gate it behind a shadcn `AlertDialog` (component exists at
`apps/studio/src/components/ui/alert-dialog.tsx`; mirror the existing delete-confirm in `pages/Forms.tsx` /
`workflows/WorkflowList.tsx`). A `confirmDeleteOpen` state opens the dialog; the destructive action runs only
on confirm. No delete when the report was never saved (`tplId` null) — the button may hide or the dialog's
confirm no-ops.

### 2. Save→navigate refetch clobber
For a NEW report, `save()` creates it then `navigate('/reports/builder/:id', { replace: true })`, which
changes `id` and re-runs the `[id]` load effect → `getReportTemplate(id)` → `setTemplate(fetched)`, discarding
any edit made between save completing and the fetch resolving. Fix with a `loadedIdRef = useRef<string|null>`:

- The load effect returns early when `!id || loadedIdRef.current === id`; on a real fetch it sets
  `loadedIdRef.current = id` after `setTemplate`.
- `save()` sets `loadedIdRef.current = saved.id` right after `setTemplate(saved)` / `setTplId(saved.id)`, so
  the post-create navigation sees `loadedIdRef.current === id` and skips the refetch.
- Initial mount with an `:id` in the URL still loads (`loadedIdRef.current` starts `null`); genuine
  navigation to a *different* report id still loads (ref differs).

### 3. Parameter id uniqueness / non-empty
`ParametersEditor` allows a blank id (after the `[A-Za-z0-9_]` sanitize) or two params with the same id,
making `{{param.<id>}}` ambiguous or unmatchable. On the editor, compute validity: **invalid** when any
`id.trim() === ''` or any id appears more than once. When invalid, **disable Save** and show an inline
message (e.g., "Parameter ids must be unique and non-empty"). Editing to fix re-enables Save.

### 4. options-SQL error surfacing
`ParamValuesBar` runs each select param's `optionsSql` via `runWidgetQuery` and swallows failures
(`.catch(() => {})`), leaving the dropdown silently empty. Track a per-param error map
(`Record<string, string>`); on catch, record the message; render a small inline warning near that param's
control (muted/destructive text, e.g., "options failed"). Success clears it.

### 5. Narrow `breakdown` schema to key-only
The dashboards builder `WidgetQuerySchema` sets `breakdown: DimensionRefSchema.optional()`, which permits a
`grain` the compiler never reads (`compileBuilderQuery`/`runBuilderQuery` only use `breakdown.key`). Narrow it
to `breakdown: z.object({ key: z.string() }).optional()` so a hand-built API payload can't smuggle a
silently-ignored `grain`. Mirror the studio `api.ts` `WidgetQuery` builder type to `breakdown?: { key:
string }`. `chartOpts` and the QueryEditor breakdown dropdown already only produce/read `{ key }`, so no other
change.

### 6. Remove dead `blockToWidgetConfig` chart branch
Since P3b-4, `CanvasBlock` renders chart blocks via `ReportChart` and only calls
`blockToWidgetConfig(block, result)` for kpi/table. The `block.kind === 'chart'` branch in
`blockToWidgetConfig` is unreachable. Remove that branch (and the 3 chart-specific cases in
`blockToWidgetConfig.test.ts`), keeping the kpi and table branches + their tests.

## Testing

- **Delete confirm** (RTL): clicking Delete does NOT call `deleteReportTemplate`; confirming in the dialog
  does.
- **Clobber guard** (RTL/targeted): after `save()` on a new report, a mocked `getReportTemplate` is NOT
  called again by the navigation (or: an edit made post-save survives). Assert `getReportTemplate` call count
  stays 0 for the just-created id after the `replace` navigation.
- **Param validation** (RTL): two params with the same id (or an empty id) disable Save + show the message;
  fixing re-enables.
- **options-SQL error** (RTL): a `runWidgetQuery` rejection for a select param renders the inline warning.
- **breakdown schema** (zod unit): `WidgetQuerySchema.parse({ …, breakdown: { key: 'x', grain: 'month' } })`
  yields `breakdown: { key: 'x' }` (grain stripped).
- **blockToWidgetConfig**: kpi/table tests still pass; chart-type tests removed.

## Scope boundaries (YAGNI for P3c-1)

**In:** the six fixes above.
**Out:** lint system (P3c-2), block duplicate / header-footer-repeat toggle / empty states / keyboard
shortcuts / true drag-reorder (P3c-3), i18n (P3c-4).

## Non-obvious constraints

- **Purity:** `ParametersEditor`/`ParamValuesBar`/`ReportBuilderPage`/`blockToWidgetConfig` are studio code;
  the only shared-package touch is the dashboards `breakdown` schema narrow — run the forced typecheck
  (studio + report-builder + server all consume `WidgetQuery`).
- **Backward compat:** narrowing `breakdown` is safe because the only producers already emit `{ key }`; any
  persisted template/dashboard with a `breakdown.grain` would have that field stripped on next parse (none
  exist — breakdown shipped in P3b-4 and its UI never set grain).
- **Conventions:** shadcn `AlertDialog` for the confirm; mirror an existing delete-confirm; keep the
  `loadedIdRef` guard minimal (no new library, no route-guard machinery).
