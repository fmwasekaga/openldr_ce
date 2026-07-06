# Report Builder — Date-Range Lint + Canvas Param + Dark-Theme Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three live-builder defects surfaced by the Slice G `rt-amr-resistance` template: lint false-positives on the `daterange` `from`/`to` binding, an empty canvas table when the date range is unset, and white-on-white report text in dark mode.

**Architecture:** Three independent fixes. (1) `lintReportTemplate` learns that a `daterange` param provides the `from`/`to` ref keys. (2) `useBlockData` drops its own drifted `resolve()` and reuses the shared `resolveQueryParams` (substitute + blank-drop) from `@openldr/report-builder/pure`. (3) The canvas report "page" gets a `.report-page-surface` class that pins the light-theme CSS variables so it renders dark-on-white regardless of app theme.

**Tech Stack:** TypeScript, zod, React + Testing Library, vitest, Tailwind/CSS variables.

**Design spec:** `docs/superpowers/specs/2026-07-06-report-builder-daterange-theme-fixes-design.md`

**Conventions (repo memory):**
- Work on a fresh branch `report-builder-daterange-theme-fixes` off `main` (local main tip `112ba7b4`).
- Never pipe turbo through `tail`. Run one package's tests from repo root, e.g. `pnpm --filter @openldr/report-builder exec vitest run src/lint.test.ts`.
- Commit after every green step; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Note: temporary viewing files `apps/studio/vite.demo.config.ts` and `.claude/launch.json` exist from a live-preview session; the studio tsconfig is `include:["src"]` so they do NOT affect typecheck. Leave them; they are cleaned up separately.

---

## File Structure

**Modify:**
- `packages/report-builder/src/lint.ts` — daterange-aware param-ref checking.
- `packages/report-builder/src/pure.ts` — export the `run-template` module (adds `resolveQueryParams`).
- `apps/studio/src/reports-builder/useBlockData.ts` — reuse `resolveQueryParams`; delete the local `resolve()`.
- `apps/studio/src/tokens.css` — add the `.report-page-surface` class.
- `apps/studio/src/reports-builder/ReportCanvas.tsx` — apply `report-page-surface` to the page container.

**Test files touched:** `packages/report-builder/src/lint.test.ts`, `apps/studio/src/reports-builder/useBlockData.test.tsx`, `apps/studio/src/reports-builder/ReportCanvas.test.tsx`.

---

## Task 1: Lint understands `daterange` → `from`/`to`

**Files:**
- Modify: `packages/report-builder/src/lint.ts`
- Test: `packages/report-builder/src/lint.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/report-builder/src/lint.test.ts` (reuse the existing `withRows`, `codes` helpers and vitest imports):

```ts
describe('lintReportTemplate daterange params (Slice G follow-up)', () => {
  const tableWithDateFilters = (params: ReportTemplate['parameters']) => withRows(
    [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', columns: [], source: {
      mode: 'builder', model: 'observations', metric: { key: 'tested', agg: 'count' },
      filters: [
        { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
        { dimension: 'effective_date_time', op: 'lte', value: '{{param.to}}' },
      ],
    } } }] }] as never,
    { parameters: params },
  );

  it('accepts {{param.from}}/{{param.to}} when a daterange param is defined (no orphan errors, no unused warning)', () => {
    const cs = codes(tableWithDateFilters([{ id: 'dateRange', label: 'Date range', type: 'daterange', required: false }] as never));
    expect(cs).not.toContain('orphaned-param-ref');
    expect(cs).not.toContain('unused-parameter');
  });

  it('still flags {{param.from}} as orphaned when no daterange param is defined', () => {
    expect(codes(tableWithDateFilters([] as never))).toContain('orphaned-param-ref');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/lint.test.ts`
Expected: the first case FAILS — `from`/`to` are reported as `orphaned-param-ref` and `dateRange` as `unused-parameter`. The second case already passes.

- [ ] **Step 3: Make the linter daterange-aware**

In `packages/report-builder/src/lint.ts`, after the line `const definedSet = new Set(t.parameters.map((p) => p.id));` add:

```ts
  // A `daterange` param populates fixed `from`/`to` value keys at runtime (ParamValuesBar),
  // so filters bind {{param.from}}/{{param.to}} rather than {{param.<id>}}.
  const dateRangeParamIds = t.parameters.filter((p) => p.type === 'daterange').map((p) => p.id);
  const providedKeys = new Set<string>(dateRangeParamIds.length ? ['from', 'to'] : []);
```

Then replace the `consumeRefs` function:

```ts
  const consumeRefs = (q: WidgetQuery, loc?: { rowIndex: number; cellIndex: number }) => {
    for (const id of paramRefs(q)) {
      usedParamIds.add(id);
      if (!definedSet.has(id)) issues.push({ severity: 'error', code: 'orphaned-param-ref', message: `References parameter "${id}" which is not defined`, ...loc });
    }
  };
```

with:

```ts
  const consumeRefs = (q: WidgetQuery, loc?: { rowIndex: number; cellIndex: number }) => {
    for (const id of paramRefs(q)) {
      if (providedKeys.has(id)) { for (const dp of dateRangeParamIds) usedParamIds.add(dp); continue; }
      usedParamIds.add(id);
      if (!definedSet.has(id)) issues.push({ severity: 'error', code: 'orphaned-param-ref', message: `References parameter "${id}" which is not defined`, ...loc });
    }
  };
```

(When a ref is `from`/`to` and a daterange param exists, mark the daterange param(s) used and skip the orphan check. When no daterange param exists, `providedKeys` is empty so `from`/`to` fall through to the normal orphan check — still an error.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/lint.test.ts`
Expected: PASS (both new cases + all pre-existing lint tests stay green — the change only affects `from`/`to` refs when a daterange param is present).

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/lint.ts packages/report-builder/src/lint.test.ts
git commit -m "fix(report-builder): lint understands daterange from/to binding"
```

---

## Task 2: Canvas reuses the shared `resolveQueryParams` (dedupe + blank-drop)

**Files:**
- Modify: `packages/report-builder/src/pure.ts`
- Modify: `apps/studio/src/reports-builder/useBlockData.ts`
- Test: `apps/studio/src/reports-builder/useBlockData.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `apps/studio/src/reports-builder/useBlockData.test.tsx` (the file already mocks `runWidgetQuery`, imports `renderHook`, `waitFor`, `createEmptyTemplate`, `addRowWithBlock`, `newBlock`, `updateBlockAt`, and defines `result`):

```ts
it('drops a filter bound to an unset param (blank-drop via resolveQueryParams)', async () => {
  runWidgetQuery.mockResolvedValue(result(0));
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('chart'));
  t = updateBlockAt(t, 0, 0, { query: {
    mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' },
    filters: [
      { dimension: 'status', op: 'eq', value: 'final' },
      { dimension: 'effective_date_time', op: 'gte', value: '{{param.from}}' },
    ],
  } } as any);
  renderHook(() => useBlockData(t, {})); // empty params → {{param.from}} → '' → dropped
  await waitFor(() => expect(runWidgetQuery).toHaveBeenCalled());
  const sent = runWidgetQuery.mock.calls[0][0];
  expect(sent.filters).toEqual([{ dimension: 'status', op: 'eq', value: 'final' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/useBlockData.test.tsx`
Expected: FAIL — the current local `resolve()` substitutes `{{param.from}}` → `''` but keeps the filter, so `sent.filters` still contains the `effective_date_time >= ''` entry.

- [ ] **Step 3: Export `run-template` from the pure barrel**

In `packages/report-builder/src/pure.ts`, add a line after `export * from './render/chart-data';`:

```ts
export * from './render/run-template';
```

(`run-template.ts` imports only types from `@openldr/dashboards`/`@openldr/reporting` plus schema/layout — no `pdfkit` — so it is safe for the pure entrypoint.)

- [ ] **Step 4: Replace the local `resolve()` with `resolveQueryParams` in `useBlockData.ts`**

In `apps/studio/src/reports-builder/useBlockData.ts`:

Change the imports (lines 2-3) to add `resolveQueryParams`:

```ts
import { runWidgetQuery, type WidgetQuery, type ReportResult } from '../api';
import { resolveQueryParams, type Block, type ReportTemplate } from '@openldr/report-builder/pure';
```

Delete the `TOKEN` constant and the entire local `resolve` function (the block:

```ts
const TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;
function resolve(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  const sub = (v: unknown) => (typeof v === 'string' && v.includes('{{') ? v.replace(TOKEN, (_m, k: string) => params[k] ?? '') : v);
  if (clone.mode === 'builder') {
    clone.filters = (clone.filters ?? []).map((f) => ({ ...f, value: sub(f.value) as never }));
  } else if (clone.values) {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(clone.values)) next[k] = sub(v);
    clone.values = next as never;
  }
  return clone;
}
```

).

Change the resolve call (currently `const rq = resolve(q, params);` inside the `template.rows.forEach` loop) to use the shared function. The studio `WidgetQuery` (from `../api`) is a structurally-compatible but nominally-distinct mirror of the dashboards `WidgetQuery` that `resolveQueryParams` expects, so bridge with a cast:

```ts
      // resolveQueryParams substitutes {{param.*}} AND drops blank-valued filters (so an unset
      // date range means "all dates"), matching the PDF render path. Cast bridges the api vs
      // dashboards WidgetQuery mirror (identical shape at runtime).
      const rq = resolveQueryParams(q as never, params) as unknown as WidgetQuery;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/useBlockData.test.tsx`
Expected: PASS — the date filter is dropped, `sent.filters` is just the literal `status` filter. All pre-existing `useBlockData` tests stay green (substitution behavior is unchanged for set params).

- [ ] **Step 6: Typecheck both packages**

Run: `pnpm --filter @openldr/report-builder exec tsc --noEmit` then `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: both clean (the pure barrel export is additive; the cast satisfies the WidgetQuery bridge).

- [ ] **Step 7: Commit**

```bash
git add packages/report-builder/src/pure.ts apps/studio/src/reports-builder/useBlockData.ts apps/studio/src/reports-builder/useBlockData.test.tsx
git commit -m "fix(studio): canvas reuses resolveQueryParams (drops blank param-filters)"
```

---

## Task 3: Report page renders as a light-theme island

**Files:**
- Modify: `apps/studio/src/tokens.css`
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx`
- Test: `apps/studio/src/reports-builder/ReportCanvas.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `apps/studio/src/reports-builder/ReportCanvas.test.tsx` (reuse the existing `template()` helper and imports):

```ts
it('renders the report page as a light-theme surface (readable text in dark mode)', () => {
  const { container } = render(<ReportCanvas template={template()} selected={null} onSelect={() => {}} />);
  expect(container.querySelector('.report-page-surface')).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: FAIL — no element carries the `report-page-surface` class yet.

- [ ] **Step 3: Add the `.report-page-surface` CSS class**

In `apps/studio/src/tokens.css`, add this rule immediately after the `:root[data-theme='light'] { … }` block (after its closing `}`):

```css
/* The report-builder canvas "page" is always a printed white sheet. Pin the light-theme base
   variables locally so title/text blocks, data-widget tables, muted placeholders, and the page
   number render dark-on-white regardless of the app theme (mirrors the always-light PDF). */
.report-page-surface {
  --bg: #ffffff; --sidebar: #fafafa; --card: #ffffff;
  --border: #e4e4e7; --border-2: #d4d4d8; --rule: #e4e4e7;
  --text: #18181b; --text-muted: #71717a; --table-head: #f4f4f5;
  color-scheme: light;
  color: var(--text);
}
```

(The values are copied verbatim from the `:root[data-theme='light']` block. The shadcn tokens `--foreground: var(--text)`, `--muted-foreground: var(--text-muted)`, `--border`, etc. therefore resolve to light values within the page subtree.)

- [ ] **Step 4: Apply the class to the page container**

In `apps/studio/src/reports-builder/ReportCanvas.tsx`, the per-page container `<div>` currently has:

```tsx
        <div key={pageNo} className="relative bg-white shadow-sm ring-1 ring-border" style={{ width: CANVAS_W, height: ph * scale }}>
```

Add `report-page-surface` to its className:

```tsx
        <div key={pageNo} className="report-page-surface relative bg-white shadow-sm ring-1 ring-border" style={{ width: CANVAS_W, height: ph * scale }}>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: PASS (new case + all pre-existing ReportCanvas tests stay green — only a class was added to the page container).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/tokens.css apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/ReportCanvas.test.tsx
git commit -m "fix(studio): report canvas page renders as a light-theme surface (dark-mode readability)"
```

---

## Task 4: Full-workspace gate

**Files:** none (verification only)

- [ ] **Step 1: Forced typecheck across all packages**

Run: `pnpm turbo run typecheck --force`
Expected: 31/31 packages PASS. Do NOT pipe through `tail`. (The pure-barrel export + lint change are in the shared `@openldr/report-builder` package.)

- [ ] **Step 2: Forced full test run**

Run: `pnpm turbo run test --force`
Expected: PASS across the workspace. Two pre-existing flakes are NOT regressions and are acceptable: `apps/studio/src/api.test.ts > "includes server error messages…"` (the vitest-dedupe flake, red on `main` identically) and various packages timing out under the 30-package parallel run (re-run any failing file with `pnpm --filter <pkg> exec vitest run <file>` to confirm it passes in isolation). Any OTHER failure must be fixed.

- [ ] **Step 3: Confirm the touched packages are clean**

Run: `pnpm --filter @openldr/report-builder test` and `pnpm --filter @openldr/studio exec vitest run src/reports-builder/`
Expected: all green (report-builder lint/render suites; studio reports-builder suites).

- [ ] **Step 4: Final commit (only if a gate fixup was needed)**

```bash
git add -A
git commit -m "chore(report-builder): gate — forced typecheck + full test green"
```

If Steps 1–3 required no fixups, skip this commit.

---

## Done criteria

- A published template with a `daterange` param and `{{param.from}}`/`{{param.to}}` filters lints clean (no orphan errors, no unused warning), so Publish isn't blocked; `{{param.from}}` with no daterange param still errors.
- The canvas table query drops blank param-filters (unset date range → "all dates"), so the canvas populates without needing a date picked — and `useBlockData` reuses the shared `resolveQueryParams` (no more drift).
- The report canvas page renders dark-on-white regardless of app theme (readable title/text/table in dark mode).
- Forced 31-package typecheck + full test green (modulo the two documented pre-existing flakes).

## Manual verification (post-merge, optional)

Open the running dev builder (`:5180`) on `rt-amr-resistance` in dark mode: the lint badge shows 0 errors, the canvas title/text/table render in dark text on the white page, and the table populates without picking a date.

## Follow-ups (not this slice)

- Query-model slices C/D/E/F (other reports become templates).
- Reconsidering the daterange binding convention (kept as-is here).
