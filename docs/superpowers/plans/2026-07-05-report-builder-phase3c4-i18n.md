# Report Builder — Phase 3c-4: i18n Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize every user-facing string in `apps/studio/src/reports-builder/*` into the en/fr/pt i18n bundles and render them via `t()`, without changing any behavior.

**Architecture:** Add global i18n to the test setup, then group-by-group replace hardcoded strings with `t('reportBuilder.…')`/`t('common.…')`, adding the exact `en` literal + French + Portuguese values to all three bundles per string. The existing (green) reports-builder suite + `parity.test.ts` are the regression + completeness guards.

**Tech Stack:** TypeScript, React, react-i18next, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-05-report-builder-phase3c4-i18n-design.md`

---

## Ground rules (apply to EVERY task that adds strings)

1. **`en` value = the EXACT current literal** (same punctuation, ellipsis `…`, arrows `↑`/`↓`, symbols). The
   existing reports-builder tests query these literals, so any drift breaks them. When in doubt, read the
   component and copy the literal verbatim.
2. **Every key added to `en` MUST also be added to `fr` and `pt`** (French / Portuguese). Missing/extra keys
   fail `parity.test.ts` AND `tsc` (`fr`/`pt` are typed `typeof en`).
3. **Reuse `common.*`** for exact matches already present: `common.save`='Save', `common.delete`='Delete',
   `common.cancel`='Cancel', `common.loading`='Loading…'. Do NOT create `reportBuilder` duplicates of those.
4. **Interpolation:** use i18next placeholders `{{var}}` (not template literals); pass values to `t()`,
   e.g. `t('reportBuilder.lint.summary', { errors, warnings })`.
5. Each swept component adds `import { useTranslation } from 'react-i18next';` and, at the top of the
   component body, `const { t } = useTranslation();`.
6. **Verification after each sweep task:** the full reports-builder suite stays green with NO test edits, and
   `parity.test.ts` + `tsc` pass. That green suite is the proof the `en` values matched.

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `apps/studio/src/setupTests.ts` | load `@/i18n` globally for tests | Modify |
| `apps/studio/src/i18n/en.ts` | add `reportBuilder.*` keys (exact literals) | Modify |
| `apps/studio/src/i18n/fr.ts` | add `reportBuilder.*` (French) | Modify |
| `apps/studio/src/i18n/pt.ts` | add `reportBuilder.*` (Portuguese) | Modify |
| `apps/studio/src/reports-builder/*.tsx` (~12 components) | literals → `t(...)` | Modify |
| `apps/studio/src/i18n/i18n.test.ts` (or a new small test) | one wiring spot-check | Modify/Create |

---

## Task 1: Global test i18n + wiring spot-check

**Files:**
- Modify: `apps/studio/src/setupTests.ts`
- Modify: `apps/studio/src/i18n/i18n.test.ts` (add a spot-check; if it doesn't exist, add to `parity.test.ts` or create `wiring.test.ts`)

- [ ] **Step 1: Add global i18n to setup**

At the TOP of `apps/studio/src/setupTests.ts`, add:
```ts
import '@/i18n';
```
(above the `@testing-library/jest-dom/vitest` import is fine.) This initializes i18next once for all studio
tests so `t()` resolves to the `en` bundle.

- [ ] **Step 2: Add a wiring spot-check test**

Add to `apps/studio/src/i18n/i18n.test.ts` (or create `apps/studio/src/i18n/wiring.test.tsx`):
```ts
import { describe, it, expect } from 'vitest';
import i18n from './index';
import { en } from './en';

describe('reportBuilder namespace wiring', () => {
  it('en exposes a reportBuilder namespace', () => {
    expect((en as Record<string, unknown>).reportBuilder).toBeUndefined(); // (removed in Task 2 — see note)
  });
  it('t() falls back to en for a known common key', () => {
    expect(i18n.t('common.save')).toBe('Save');
  });
});
```
NOTE: the first assertion documents that `reportBuilder` does not exist YET (Task 2 adds it). After Task 2,
CHANGE that first test to `expect((en as Record<string, unknown>).reportBuilder).toBeDefined();`. (If you
prefer, skip the first assertion now and add the `toBeDefined()` check in Task 2 — either way, end state is
a `reportBuilder`-exists check.)

- [ ] **Step 3: Run — the whole studio suite must still be green**

Run: `pnpm --filter @openldr/studio exec vitest run src/i18n src/reports-builder`
Expected: PASS — adding the global i18n import is inert for existing tests (they already resolve or don't use
`t()`). If a test that previously passed now fails, STOP and report (it would mean a test depended on `t()`
returning a raw key, which is unexpected).

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/setupTests.ts apps/studio/src/i18n/i18n.test.ts
git commit -m "test(studio): load i18n globally in setupTests for the reports-builder i18n sweep"
```

---

## Task 2: Add the `reportBuilder.*` key tree (en + fr + pt)

Author the complete key tree with **exact `en` literals** + French + Portuguese, so later tasks are pure
component swaps. Read each `reports-builder` component to transcribe its literals exactly.

**Files:**
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- (adjust the Task-1 spot-check to assert `reportBuilder` is defined)

- [ ] **Step 1: Enumerate the literals**

Read every component under `apps/studio/src/reports-builder/` and list each user-facing string (button
labels, headings, placeholders, `aria-label`s, empty states, option labels). Exclude strings that already
have a `common.*` equivalent (save/delete/cancel/loading) — those will reuse the common key.

- [ ] **Step 2: Add the `reportBuilder` section to `en.ts`**

Add a `reportBuilder` object to the `en` export, grouped by area. Use the EXACT current literal as each value.
Representative shape (fill in ALL strings you enumerated; this is the naming pattern, not the full set):
```ts
  reportBuilder: {
    header: { undo: 'Undo', redo: 'Redo', parameters: 'Parameters', preview: 'Preview PDF', publish: 'Publish', namePlaceholder: 'Untitled report', deleteConfirmTitle: 'Delete this report?', deleteConfirmBody: 'This permanently deletes the report template. This cannot be undone.', deleteConfirmAction: 'Delete report', movingRow: 'Moving row' },
    palette: { heading: 'Blocks', kind: { title: 'Title', text: 'Text', kpi: 'KPI', chart: 'Chart', table: 'Table', image: 'Image', divider: 'Divider', pageBreak: 'Page break' } },
    inspector: { width: 'Width', rowOrder: 'Row order', up: '↑ Up', down: '↓ Down', moveRowUp: 'Move row up', moveRowDown: 'Move row down', rowRepeat: 'Row repeat', normal: 'Normal', repeatHeader: 'Header', repeatFooter: 'Footer', duplicate: 'Duplicate block', deleteBlock: 'Delete block', selectHint: 'Select a block to edit it, or drag a block from the palette.', textLabel: 'Text' },
    query: { builder: 'Builder', sql: 'SQL', primaryDataset: 'Primary dataset', ownQuery: 'Own query', chartType: 'Chart type', bar: 'Bar', line: 'Line', pie: 'Pie', breakdown: 'Breakdown → series', none: '(none)', editSql: 'Edit SQL', loadingSources: 'Loading data sources…' },
    filters: { heading: 'Filters', value: 'Value', param: 'Param', addFilter: 'Add filter', noParameters: '(no parameters)', unbound: '(unbound)' },
    parameters: { title: 'Report Parameters', variableId: 'Variable ID', label: 'Label', type: 'Type', optionsSql: 'Options SQL', required: 'Required', addParameter: 'Add Parameter', saveParameters: 'Save Parameters', empty: 'No parameters yet. Add one below.', invalid: 'Parameter ids must be unique and non-empty' },
    paramValues: { all: 'All', optionsFailed: 'options failed' },
    sql: { title: 'SQL query', bindVariables: 'Bind variables to parameters', save: 'Save' },
    canvas: { empty: 'Drag a block from the palette, or click one to add it.', pageOfPages: 'Page {{page}} / {{total}}', dragToReorder: 'Drag to reorder', kpi: 'KPI', title: 'Title', text: 'Text', logo: 'Logo', image: 'Image', pageBreak: '— page break —', noData: 'No data' },
    lint: { summary: '{{errors}} errors, {{warnings}} warnings', ariaLabel: 'Lint issues' },
    preview: { title: 'Preview', rendering: 'Rendering…' },
  },
```
IMPORTANT: this snippet is the STRUCTURE + naming convention. You MUST verify each `en` value against the
actual component literal and ADD any strings this snippet missed (read every component). Any `en` value that
doesn't match the component's current literal will break that component's test in a later task.

- [ ] **Step 3: Add the SAME keys to `fr.ts` and `pt.ts`**

Add an identical `reportBuilder` key tree to `fr.ts` (French) and `pt.ts` (Portuguese) with translated values.
Keep interpolation placeholders intact (`{{errors}}`, `{{warnings}}`, `{{page}}`, `{{total}}`). Match the
existing translation style in those files (e.g. `fr` "Preview PDF" → "Aperçu PDF", `pt` → "Pré-visualizar
PDF"; "Duplicate block" → fr "Dupliquer le bloc" / pt "Duplicar bloco"; etc.). Every en key must have a fr
and pt counterpart.

- [ ] **Step 4: Update the Task-1 spot-check**

In the wiring test from Task 1, ensure the final assertion is `expect((en as Record<string,
unknown>).reportBuilder).toBeDefined();`.

- [ ] **Step 5: Run parity + typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/i18n`
Expected: PASS — `parity.test.ts` confirms fr/pt match en for the new keys.
Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: exit 0 — `fr`/`pt` typed `typeof en` compile only if complete.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/i18n/i18n.test.ts
git commit -m "feat(studio): add reportBuilder.* i18n keys (en/fr/pt)"
```

---

## Task 3: Sweep header + palette (`ReportBuilderPage`, `BlockPalette`)

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`, `BlockPalette.tsx`

- [ ] **Step 1: Swap literals to `t()`**

In each file, add `import { useTranslation } from 'react-i18next';` + `const { t } = useTranslation();`, then
replace each user-facing literal with the matching `reportBuilder.*` (or `common.*`) key from Task 2. Examples:
- `ReportBuilderPage`: `Undo`→`t('reportBuilder.header.undo')`, `Save`→`t('common.save')`,
  `Publish`→`t('reportBuilder.header.publish')`, `Delete`→`t('common.delete')`, name placeholder→
  `t('reportBuilder.header.namePlaceholder')`, delete-dialog title/body/action, `Preview PDF`, `Parameters`,
  the select-hint text, and the `DragOverlay` "Moving row".
- `BlockPalette`: `Blocks`→`t('reportBuilder.palette.heading')`; each `KINDS` label →
  `t('reportBuilder.palette.kind.' + kind)` (or map explicitly). Keep the `⋮⋮` glyph as-is (not text).

`aria-label`s (e.g. "Report name", "Move row up/down") → their keys too (values equal the current English, so
RTL `getByLabelText`/`getByRole` queries still match).

- [ ] **Step 2: Verify (regression guard)**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder`
Expected: ALL green with NO test edits (en values match the old literals). If a test fails on a string
mismatch, fix the `en` value in `en.ts` (and fr/pt) to match the component's actual literal — do NOT change
the test.
Run: `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/BlockPalette.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "i18n(studio): localize report builder header + palette"
```
(Include the i18n files in the commit only if you had to correct a key/value during Step 2.)

---

## Task 4: Sweep inspector + query (`BlockInspector`, `QueryEditor`, `FilterListEditor`)

**Files:**
- Modify: `apps/studio/src/reports-builder/BlockInspector.tsx`, `QueryEditor.tsx`, `FilterListEditor.tsx`

- [ ] **Step 1: Swap literals to `t()`**

Add `useTranslation` + `t` to each and replace literals with the `reportBuilder.inspector.*` /
`reportBuilder.query.*` / `reportBuilder.filters.*` keys. Examples:
- `BlockInspector`: `Width`, `Row order`, `↑ Up`/`↓ Down` (+ their aria-labels `Move row up/down`),
  `Row repeat` + `Normal`/`Header`/`Footer`, `Duplicate block`, `Delete block`, the `Text` label.
- `QueryEditor`: `Builder`/`SQL`, `Primary dataset`/`Own query`, `Chart type` + `Bar`/`Line`/`Pie`,
  `Breakdown → series`, `(none)`, `Edit SQL`, `Loading data sources…`.
- `FilterListEditor`: `Filters`, `Value`/`Param`, `Add filter`, `(no parameters)`, `(unbound)`. Keep the
  `aria-label`s `filter-<i>-*` (they are dynamic, non-user-facing test ids — do NOT translate those).

- [ ] **Step 2: Verify**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder` → all green (no test edits).
Run: `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/reports-builder/BlockInspector.tsx apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/reports-builder/FilterListEditor.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "i18n(studio): localize report builder inspector + query editor"
```

---

## Task 5: Sweep parameters + SQL (`ParametersEditor`, `ParamValuesBar`, `SqlQueryEditor`)

**Files:**
- Modify: `apps/studio/src/reports-builder/ParametersEditor.tsx`, `ParamValuesBar.tsx`, `SqlQueryEditor.tsx`

- [ ] **Step 1: Swap literals to `t()`**

- `ParametersEditor`: `Report Parameters`, `Variable ID`, `Label`, `Type`, `Options SQL`, `Required`,
  `Add Parameter`, `Cancel`(→`common.cancel`), `Save Parameters`, the empty message, the validation message.
  Keep the dynamic `aria-label`s `param-<i>-*` untranslated (test ids).
- `ParamValuesBar`: `All`, `options failed`. (The daterange/select/input controls' `aria-label` is the
  param's own `label` — leave that as data, not a key.)
- `SqlQueryEditor`: `SQL query`, `Bind variables to parameters`, `Cancel`(→`common.cancel`), `Save`
  (→`common.save` or `reportBuilder.sql.save`), `(unbound)`. Keep `aria-label="SQL"` and `aria-label={`bind-${v}`}`
  (test ids) untranslated.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder` → all green (no test edits).
Run: `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/reports-builder/ParametersEditor.tsx apps/studio/src/reports-builder/ParamValuesBar.tsx apps/studio/src/reports-builder/SqlQueryEditor.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "i18n(studio): localize report builder parameters + SQL editor"
```

---

## Task 6: Sweep canvas + lint + preview (`ReportCanvas`, `CanvasBlock`, `LintSummary`, `PreviewPdfDialog`)

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx`, `CanvasBlock.tsx`, `LintSummary.tsx`, `PreviewPdfDialog.tsx`

- [ ] **Step 1: Swap literals to `t()`**

- `ReportCanvas`: the empty-state text, `Drag to reorder` (handle aria-label), and the `Page N / maxPage`
  footer → `t('reportBuilder.canvas.pageOfPages', { page: pageNo, total: maxPage })`.
- `CanvasBlock`: the placeholder labels (`Title`, `Text`, `KPI`, `Table`, `Logo`, `Image`, `— page break —`,
  `Loading…`(→`common.loading`), `No data`). The dynamic value `123` KPI stub and `{block.chartType} chart`
  can keep the interpolated chartType (translate the word "chart" if present: `t('reportBuilder.canvas.chartSuffix')`
  — add that key if the literal is `` `${block.chartType} chart` ``).
- `LintSummary`: the badge `{errors} errors, {warnings} warnings` → `t('reportBuilder.lint.summary', {
  errors, warnings })`; `aria-label="Lint issues"` → `t('reportBuilder.lint.ariaLabel')`. The issue `message`
  strings in the list come from the pure linter and STAY as-is (English — deferred, per spec).
- `PreviewPdfDialog`: `Preview`, `Rendering…`. Keep the sr-only DialogDescription text translated too.

- [ ] **Step 2: Verify (full suite + parity)**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder` → all green (no test edits).
Run: `pnpm --filter @openldr/studio exec vitest run src/i18n` → parity green (fr/pt still match en after any
keys you added this task).
Run: `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/CanvasBlock.tsx apps/studio/src/reports-builder/LintSummary.tsx apps/studio/src/reports-builder/PreviewPdfDialog.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "i18n(studio): localize report canvas + lint summary + preview"
```

---

## Task 7: Wiring spot-check (fr renders translated) + gate

**Files:**
- Modify: `apps/studio/src/i18n/i18n.test.ts` (or the wiring test)

- [ ] **Step 1: Add a language-switch spot-check**

Add (adjust the render target to an actual translated string you introduced, e.g. the palette heading):
```ts
import i18n from './index';
import { fr } from './fr';

it('serves the French reportBuilder value when language is fr', async () => {
  await i18n.changeLanguage('fr');
  expect(i18n.t('reportBuilder.palette.heading')).toBe(fr.reportBuilder.palette.heading);
  await i18n.changeLanguage('en'); // restore for other tests
});
```

- [ ] **Step 2: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages pass.

- [ ] **Step 3: Full studio suite (i18n + reports-builder)**

Run: `pnpm --filter @openldr/studio exec vitest run src/i18n src/reports-builder`
Expected: all green — parity, wiring, and the whole reports-builder suite. (The pre-existing
`apps/studio/src/api.test.ts` vitest-dedupe flake is a different path.)

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/i18n/i18n.test.ts
git commit -m "test(studio): report builder i18n language-switch spot-check + gate green"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** global test i18n (Task 1) · `reportBuilder.*` keys en/fr/pt (Task 2) · component sweeps
  header/palette (Task 3), inspector/query (Task 4), params/sql (Task 5), canvas/lint/preview (Task 6) ·
  wiring + gate (Task 7). Every reports-builder component is covered.
- **Regression guard:** the reports-builder suite stays green with NO test edits across Tasks 3–6 — this is
  the proof that `en` values are byte-identical. If a test fails, the fix is the `en` value, never the test.
- **Completeness guard:** `parity.test.ts` + `tsc` (`fr`/`pt` typed `typeof en`) force every new key into all
  three bundles.
- **Reuse:** `common.save`/`delete`/`cancel`/`loading` reused, not duplicated.
- **Do NOT translate:** dynamic `aria-label`/`data-testid` values used purely as test hooks (`filter-<i>-*`,
  `param-<i>-*`, `bind-<v>`, `canvas-cell-*`, `lint-marker-*`, `aria-label="SQL"`); the pure linter's issue
  `message` strings (deferred).
- **Out of scope:** lint-message localization, server/PDF-render text, P3c-3 deferred polish, P4.
- **Cross-package:** none (studio-only); forced typecheck in Task 7 per convention.
```
