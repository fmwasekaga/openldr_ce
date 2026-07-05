# Report Builder — Phase 3c-4: i18n Sweep — Design Spec

**Date:** 2026-07-05
**Status:** Approved for planning
**Depends on:** P3c-3 (`5c394ff9`) — authoring UX
**Parent:** P3c polish (A safety ✓, B lint ✓, C authoring UX ✓, **D i18n** ← this — final P3c slice)
**Related:** [report-builder-workstream], [i18n-workstream] (en/fr/pt bundles, key parity, language switcher)

## Problem

Every user-facing string in `apps/studio/src/reports-builder/*` is hardcoded English, so the Report Builder
ignores the app's en/fr/pt language switcher (the rest of Studio is already localized). P3c-4 sweeps those
strings into the i18n bundles and renders them via `t()`, completing Phase 3c. It is the last slice done
because the strings only just settled (through P3c-3).

## What exists (the i18n system)

- `apps/studio/src/i18n/{en,fr,pt}.ts`: nested resource objects. `en` is the source of truth; `fr`/`pt` are
  typed `typeof en` (a missing/extra key is a compile error) AND checked at runtime by
  `apps/studio/src/i18n/parity.test.ts` (fr/pt key paths must equal en's exactly).
- `apps/studio/src/i18n/index.ts` inits i18next with the three bundles; components use
  `const { t } = useTranslation();` then `t('dotted.key')`.
- `en` already has reusable generics: `common.save`='Save', `common.delete`='Delete',
  `common.cancel`='Cancel', `common.loading`='Loading…', plus a `table.addFilter`='Add filter'.
- `setupTests.ts` does NOT globally load `@/i18n`; today only test files that render translated components
  `import '@/i18n'` themselves (e.g. `reports/ReportParametersBar.test.tsx`).

## Decisions (locked during brainstorm 2026-07-05)

1. **Global test i18n:** add `import '@/i18n';` to `setupTests.ts` so every studio test resolves `t()` to the
   `en` bundle (no per-file churn, no missed-file failures).
2. **Lint messages stay English:** the pure `lintReportTemplate` (in `@openldr/report-builder`, no
   react-i18next) keeps returning English `message` strings; only component strings are swept. (LintSummary's
   own count *badge* is a component string and IS translated.)
3. **`en` values stay byte-identical** to today's hardcoded strings, so the existing (passing)
   reports-builder RTL suite is the regression guard.

## Architecture

### A. Keys — new `reportBuilder.*` + reuse `common.*`

Add a `reportBuilder` section to `en.ts`, grouped by area so the bundle stays navigable:
`reportBuilder.header.*` (undo/redo/parameters/preview/save/publish/delete/name-placeholder/delete-confirm/
moving-row), `.palette.*` (heading + block-kind labels), `.inspector.*` (width/rowOrder/up/down/rowRepeat +
normal/header/footer/duplicate), `.query.*` (builder/sql/primary/own/chartType + bar/line/pie/breakdown/
editSql/loadingSources), `.filters.*` (filters/value/param/addFilter/unbound/noParams), `.parameters.*`
(dialog title/fields/required/add/save/empty/validation), `.paramValues.*` (all/optionsFailed), `.sql.*`
(title/bindVars), `.canvas.*` (empty-state/pageOfPages/dragToReorder + block placeholders), `.lint.*`
(summary badge with `{{errors}}`/`{{warnings}}` interpolation), `.preview.*` (title/rendering).

**Reuse `common.*`** for exact matches already present — `common.save`, `common.delete`, `common.cancel`,
`common.loading` — rather than adding `reportBuilder` duplicates. New builder-specific strings go under
`reportBuilder.*`.

### B. Test environment

`setupTests.ts` gains `import '@/i18n';` (top of file). i18next initializes once; inert for tests that don't
translate. Because `en` values equal the previous hardcoded strings, all existing reports-builder tests pass
unchanged — no per-test edits.

### C. Component sweep

Each component adds `const { t } = useTranslation();` (`import { useTranslation } from 'react-i18next';`) and
replaces literals with `t('reportBuilder.…')` / `t('common.…')`. Interpolated strings pass values:
`t('reportBuilder.lint.summary', { errors, warnings })`, `t('reportBuilder.canvas.pageOfPages', { page,
total })`. Files:

`ReportBuilderPage`, `BlockPalette`, `BlockInspector`, `QueryEditor`, `FilterListEditor`, `ParametersEditor`,
`ParamValuesBar`, `SqlQueryEditor`, `LintSummary`, `CanvasBlock`, `ReportCanvas`, `PreviewPdfDialog` (~12–13
files). `aria-label`s are translated too (they resolve to the same English in tests, so RTL
`getByLabelText`/`getByRole name` queries still match).

`BlockPalette` and `CanvasBlock` block-kind labels (Title/Text/KPI/Chart/Table/Image/Divider/Page break) map
each `BlockKind` → `t('reportBuilder.palette.kind.<kind>')`.

### D. fr / pt translations

Add the identical `reportBuilder.*` key tree to `fr.ts` and `pt.ts` with French and Portuguese values.
`parity.test.ts` + the `typeof en` typing guarantee completeness.

## Testing

- **`parity.test.ts`**: unchanged; automatically asserts the new `reportBuilder.*` keys exist in fr and pt
  (fails if any are missing/extra).
- **Existing reports-builder suite** (~88 tests): must stay green with NO test edits — the regression guard
  that en values == old strings and the global i18n load works.
- **One wiring spot-check** (optional, in an existing or new small test): set i18n language to `fr`
  (`i18n.changeLanguage('fr')`) and assert a builder string renders translated — proves `t()` is actually
  wired, not just returning en.

## Scope boundaries (YAGNI for P3c-4)

**In:** sweep all reports-builder component strings → `reportBuilder.*`/`common.*`; fr + pt translations;
global test i18n load. **Out:** localizing the pure linter's `message` strings (deferred); translating the
server/CLI/PDF-render side (server-rendered PDF text isn't in this scope); the P3c-3 deferred a11y/comment
polish; P4 coexistence.

## Non-obvious constraints

- **Byte-identical en:** the `en` value for every swept string MUST equal the current literal (including
  punctuation/ellipsis `…`, arrows `↑`/`↓`, symbols) so RTL queries and snapshot-style assertions keep
  matching. This is the difference between a green sweep and a broken suite.
- **Parity + typing:** every key added to `en` MUST be added to `fr` and `pt` (tsc `typeof en` error +
  `parity.test.ts` runtime failure otherwise). Keep the three files structurally aligned.
- **Interpolation:** use i18next `{{var}}` placeholders (NOT template literals) for count/page strings; pass
  the values object to `t()`. `interpolation.escapeValue` is already `false` in `index.ts`.
- **Reuse over duplication:** don't add `reportBuilder.save` when `common.save` already says 'Save' — reuse
  the common key. Only genuinely builder-specific strings get new keys.
- **No behavior change:** this slice is presentation-only. No component logic, props, schema, or package
  boundary changes; run the forced typecheck because `fr`/`pt` are typed against `en`.
