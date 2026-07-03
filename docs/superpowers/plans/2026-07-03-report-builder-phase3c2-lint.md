# Report Builder — Phase 3c-2: Lint System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure `lintReportTemplate` (7 rules) and surface it as a header badge + expandable issue list + per-block canvas markers, with errors disabling Publish — mirroring the Form Builder lint and closing the P3b-2 dangling-param-ref follow-up.

**Architecture:** A pure `lintReportTemplate(template): ReportLintIssue[]` in `@openldr/report-builder/pure` walks blocks/dataset/parameters and returns severity-tagged issues. `ReportBuilderPage` memoizes them, gates Publish on `hasErrors`, renders a `LintSummary` popover, and threads issues into `ReportCanvas` for per-cell markers.

**Tech Stack:** TypeScript, React, Vitest + React Testing Library, shadcn `Popover`, `@openldr/report-builder/pure`.

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase3c2-lint-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/report-builder/src/lint.ts` | pure `lintReportTemplate` + `ReportLintIssue` | Create |
| `packages/report-builder/src/lint.test.ts` | per-rule unit tests | Create |
| `packages/report-builder/src/pure.ts` | export `./lint` | Modify |
| `apps/studio/src/reports-builder/LintSummary.tsx` | badge + popover issue list | Create |
| `apps/studio/src/reports-builder/LintSummary.test.tsx` | RTL | Create |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` | memoize issues, gate Publish, render LintSummary, pass issues to canvas | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` | Publish-gating test | Modify |
| `apps/studio/src/reports-builder/ReportCanvas.tsx` | per-cell lint marker | Modify |
| `apps/studio/src/reports-builder/ReportCanvas.test.tsx` | marker test (create if absent) | Modify/Create |

**Types:** `ReportLintIssue = { severity: 'error'|'warning'; code; message; rowIndex?; cellIndex?; paramId? }`.

---

## Task 1: Pure `lintReportTemplate`

**Files:**
- Create: `packages/report-builder/src/lint.ts`
- Test: `packages/report-builder/src/lint.test.ts`
- Modify: `packages/report-builder/src/pure.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/report-builder/src/lint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lintReportTemplate } from './lint';
import type { ReportTemplate } from './schema';

const base: ReportTemplate = {
  id: 't', name: 'R', description: '', category: 'operational', status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [], rows: [], createdAt: undefined, updatedAt: undefined,
} as ReportTemplate;

function withRows(rows: ReportTemplate['rows'], extra: Partial<ReportTemplate> = {}): ReportTemplate {
  return { ...base, rows, ...extra } as ReportTemplate;
}
const kpi = (query: unknown) => ({ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query } }] });
const codes = (t: ReportTemplate) => lintReportTemplate(t).map((i) => i.code);

describe('lintReportTemplate', () => {
  it('flags a blank name', () => {
    expect(codes(withRows([kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never, { name: '' }))).toContain('empty-name');
  });

  it('flags a data block with no model (empty-query)', () => {
    expect(codes(withRows([kpi({ mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] })] as never))).toContain('empty-query');
  });

  it('flags a primary table with no dataset (empty-query)', () => {
    const rows = [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'table', source: 'primary', columns: [] } }] }] as never;
    expect(codes(withRows(rows))).toContain('empty-query');
  });

  it('flags an orphaned {{param.x}} filter ref', () => {
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'status', op: 'eq', value: '{{param.missing}}' }] })] as never;
    expect(codes(withRows(rows))).toContain('orphaned-param-ref');
  });

  it('flags an unbound SQL variable', () => {
    const rows = [kpi({ mode: 'sql', sql: 'select {{ward}}', values: {} })] as never;
    expect(codes(withRows(rows))).toContain('unbound-sql-var');
  });

  it('flags duplicate parameter ids', () => {
    const params = [{ id: 'x', label: 'A', type: 'text', required: false }, { id: 'x', label: 'B', type: 'text', required: false }] as never;
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'd', op: 'eq', value: '{{param.x}}' }] })] as never;
    expect(codes(withRows(rows, { parameters: params }))).toContain('duplicate-param-id');
  });

  it('warns on an unused parameter', () => {
    const params = [{ id: 'unused', label: 'U', type: 'text', required: false }] as never;
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never;
    const issues = lintReportTemplate(withRows(rows, { parameters: params }));
    expect(issues.find((i) => i.code === 'unused-parameter')?.severity).toBe('warning');
  });

  it('warns on an empty report (no data blocks)', () => {
    expect(codes(withRows([]))).toContain('empty-report');
  });

  it('returns no issues for a valid single-block report', () => {
    const rows = [kpi({ mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] })] as never;
    expect(lintReportTemplate(withRows(rows))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/lint.test.ts`
Expected: FAIL — module `./lint` not found.

- [ ] **Step 3: Write the linter**

Create `packages/report-builder/src/lint.ts`:

```ts
import type { WidgetQuery } from '@openldr/dashboards';
import type { Block, ReportTemplate } from './schema';

export type ReportLintSeverity = 'error' | 'warning';
export interface ReportLintIssue {
  severity: ReportLintSeverity;
  code: 'empty-name' | 'empty-query' | 'unbound-sql-var' | 'orphaned-param-ref' | 'duplicate-param-id' | 'unused-parameter' | 'empty-report';
  message: string;
  rowIndex?: number;
  cellIndex?: number;
  paramId?: string;
}

const PARAM_TOKEN = /\{\{\s*param\.(\w+)\s*\}\}/g;
const VAR_TOKEN = /\{\{(\w+)\}\}/g;

function isDataBlock(b: Block): boolean {
  return b.kind === 'kpi' || b.kind === 'chart' || b.kind === 'table';
}
// The runnable query for a data block (kpi/chart carry `query`; table carries `source` unless 'primary').
function dataQuery(b: Block): WidgetQuery | null {
  if (b.kind === 'kpi' || b.kind === 'chart') return b.query;
  if (b.kind === 'table') return b.source === 'primary' ? null : b.source;
  return null;
}
// Collect {{param.<id>}} ids referenced by a query's builder filter values or sql `values`.
function paramRefs(q: WidgetQuery): string[] {
  const ids: string[] = [];
  const scan = (v: unknown) => {
    if (typeof v !== 'string') return;
    PARAM_TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PARAM_TOKEN.exec(v))) ids.push(m[1]);
  };
  if (q.mode === 'builder') for (const f of q.filters ?? []) scan(f.value);
  else if (q.values) for (const v of Object.values(q.values)) scan(v);
  return ids;
}

export function lintReportTemplate(t: ReportTemplate): ReportLintIssue[] {
  const issues: ReportLintIssue[] = [];
  const definedSet = new Set(t.parameters.map((p) => p.id));
  const usedParamIds = new Set<string>();

  if (t.name.trim() === '') issues.push({ severity: 'error', code: 'empty-name', message: 'Report has no name' });

  let dataBlocks = 0;
  const consumeRefs = (q: WidgetQuery, loc?: { rowIndex: number; cellIndex: number }) => {
    for (const id of paramRefs(q)) {
      usedParamIds.add(id);
      if (!definedSet.has(id)) issues.push({ severity: 'error', code: 'orphaned-param-ref', message: `References parameter "${id}" which is not defined`, ...loc });
    }
  };

  t.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    const block = cell.block;
    if (!isDataBlock(block)) return;
    dataBlocks++;
    const loc = { rowIndex: r, cellIndex: c };
    if (block.kind === 'table' && block.source === 'primary') {
      if (!t.dataset) issues.push({ severity: 'error', code: 'empty-query', message: 'Table uses the primary dataset but none is configured', ...loc });
      else consumeRefs(t.dataset, loc);
      return;
    }
    const q = dataQuery(block);
    if (!q) return;
    const empty = q.mode === 'builder' ? !q.model : !q.sql?.trim();
    if (empty) { issues.push({ severity: 'error', code: 'empty-query', message: 'Data block has no query configured', ...loc }); return; }
    if (q.mode === 'sql') {
      const values = q.values ?? {};
      const seen = new Set<string>();
      VAR_TOKEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_TOKEN.exec(q.sql))) {
        const name = m[1];
        if (!seen.has(name) && !(name in values)) { seen.add(name); issues.push({ severity: 'error', code: 'unbound-sql-var', message: `SQL variable {{${name}}} is not bound to a parameter`, ...loc }); }
      }
    }
    consumeRefs(q, loc);
  }));

  const seenIds = new Set<string>();
  for (const p of t.parameters) {
    if (seenIds.has(p.id)) issues.push({ severity: 'error', code: 'duplicate-param-id', message: `Duplicate parameter id "${p.id}"`, paramId: p.id });
    else seenIds.add(p.id);
  }
  for (const p of t.parameters) {
    if (!usedParamIds.has(p.id)) issues.push({ severity: 'warning', code: 'unused-parameter', message: `Parameter "${p.id}" is defined but never used`, paramId: p.id });
  }
  if (dataBlocks === 0) issues.push({ severity: 'warning', code: 'empty-report', message: 'Report has no data blocks' });

  return issues;
}
```

- [ ] **Step 4: Export from the pure barrel**

In `packages/report-builder/src/pure.ts`, add:
```ts
export * from './lint';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/lint.test.ts`
Expected: PASS (9 tests). Also `pnpm --filter @openldr/report-builder exec tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/report-builder/src/lint.ts packages/report-builder/src/lint.test.ts packages/report-builder/src/pure.ts
git commit -m "feat(report-builder): pure lintReportTemplate (7 rules)"
```

---

## Task 2: `LintSummary` component

**Files:**
- Create: `apps/studio/src/reports-builder/LintSummary.tsx`
- Test: `apps/studio/src/reports-builder/LintSummary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/reports-builder/LintSummary.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LintSummary } from './LintSummary';
import type { ReportLintIssue } from '@openldr/report-builder/pure';

const issues: ReportLintIssue[] = [
  { severity: 'error', code: 'empty-query', message: 'Data block has no query configured', rowIndex: 0, cellIndex: 0 },
  { severity: 'warning', code: 'unused-parameter', message: 'Parameter "x" is defined but never used', paramId: 'x' },
];

describe('LintSummary', () => {
  it('renders nothing when there are no issues', () => {
    const { container } = render(<LintSummary issues={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the error/warning counts', () => {
    render(<LintSummary issues={issues} />);
    expect(screen.getByText(/1 error/i)).toBeTruthy();
    expect(screen.getByText(/1 warning/i)).toBeTruthy();
  });

  it('expands to the messages and selects a located block on click', async () => {
    const onSelectBlock = vi.fn();
    render(<LintSummary issues={issues} onSelectBlock={onSelectBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /error/i }));
    const item = await screen.findByText(/no query configured/i);
    fireEvent.click(item);
    expect(onSelectBlock).toHaveBeenCalledWith(0, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/LintSummary.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/studio/src/reports-builder/LintSummary.tsx`:

```tsx
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ReportLintIssue } from '@openldr/report-builder/pure';

export function LintSummary({ issues, onSelectBlock }: { issues: ReportLintIssue[]; onSelectBlock?: (row: number, cell: number) => void }): JSX.Element | null {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const tone = errors > 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-amber-500/40 bg-amber-500/10 text-amber-700';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Lint issues" className={`rounded-md border px-2 py-1 text-xs ${tone}`}>
          {errors} errors, {warnings} warnings
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 text-xs">
        <ul className="max-h-64 divide-y divide-border overflow-y-auto">
          {issues.map((iss, i) => {
            const locatable = iss.rowIndex !== undefined && iss.cellIndex !== undefined && !!onSelectBlock;
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!locatable}
                  onClick={() => { if (iss.rowIndex !== undefined && iss.cellIndex !== undefined) onSelectBlock?.(iss.rowIndex, iss.cellIndex); }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className={iss.severity === 'error' ? 'text-destructive' : 'text-amber-600'}>{iss.severity === 'error' ? '●' : '▲'}</span>
                  <span className="text-foreground">{iss.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/LintSummary.test.tsx`
Expected: PASS (3 tests). If the Radix `Popover` content doesn't mount in jsdom on click, mirror how `PreviewPdfDialog.test`/`WidgetEditorDialog.test` handle Radix portals (they render on open); the click-trigger-then-findByText pattern used here matches the AlertDialog test that already works in this repo. Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/LintSummary.tsx apps/studio/src/reports-builder/LintSummary.test.tsx
git commit -m "feat(studio): LintSummary badge + popover issue list"
```

---

## Task 3: Wire lint into `ReportBuilderPage` (gate Publish + header badge)

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`. Use the existing `renderId`-style helper but point the mocked `getReportTemplate` at a template with an unconfigured kpi (empty-query → error) for the disabled case, and a valid one for enabled. If the helper doesn't allow overriding the returned template per-test, add a small variant (mirror how the file sets `getReportTemplate.mockResolvedValue(...)`):

```tsx
it('disables Publish when the template has a lint error', async () => {
  const t = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query: { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] } } }] }] };
  vi.mocked(getReportTemplate).mockResolvedValue(t as never);
  renderId();
  expect(await screen.findByRole('button', { name: /^publish$/i })).toBeDisabled();
});

it('enables Publish for a clean template', async () => {
  const t = { id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' }, filters: [] } } }] }] };
  vi.mocked(getReportTemplate).mockResolvedValue(t as never);
  renderId();
  expect(await screen.findByRole('button', { name: /^publish$/i })).toBeEnabled();
});
```

Ensure `getReportTemplate` is imported from `../api` in the test.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: FAIL — Publish isn't disabled (no lint yet).

- [ ] **Step 3: Wire it in**

In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`:
- Add imports:
```tsx
import { lintReportTemplate } from '@openldr/report-builder/pure';
import { LintSummary } from './LintSummary';
```
- After `selectedBlock` memo (or near the other memos), add:
```tsx
const issues = useMemo(() => lintReportTemplate(template), [template]);
const hasErrors = issues.some((i) => i.severity === 'error');
```
- In the header button group (`<div className="flex items-center gap-1.5">`), add the LintSummary as the first child (before Undo):
```tsx
<LintSummary issues={issues} onSelectBlock={(r, c) => setSelected({ row: r, cell: c })} />
```
- Add `disabled={hasErrors}` to the Publish button:
```tsx
<Button size="sm" variant="outline" disabled={hasErrors} onClick={() => { void publish(); }}>Publish</Button>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: PASS (new tests + existing). Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "feat(studio): report builder lint summary + Publish gated on lint errors"
```

---

## Task 4: Per-block canvas markers

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportCanvas.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx` (pass `issues` to canvas)
- Test: `apps/studio/src/reports-builder/ReportCanvas.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Create (or add to) `apps/studio/src/reports-builder/ReportCanvas.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportCanvas } from './ReportCanvas';
import type { ReportTemplate, ReportLintIssue } from '@openldr/report-builder/pure';

const template: ReportTemplate = {
  id: 't', name: 'R', description: '', category: 'operational', status: 'draft',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
  parameters: [],
  rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'title', text: 'Hi', style: {} } }] }],
} as ReportTemplate;

describe('ReportCanvas lint markers', () => {
  it('renders an error marker on a cell with an error issue', () => {
    const issues: ReportLintIssue[] = [{ severity: 'error', code: 'empty-query', message: 'x', rowIndex: 0, cellIndex: 0 }];
    const { container } = render(<ReportCanvas template={template} selected={null} onSelect={() => {}} issues={issues} />);
    const marker = container.querySelector('[data-testid="lint-marker-0-0"]');
    expect(marker).toBeTruthy();
    expect(marker?.className).toContain('bg-destructive');
  });

  it('renders no marker when there are no issues for a cell', () => {
    const { container } = render(<ReportCanvas template={template} selected={null} onSelect={() => {}} issues={[]} />);
    expect(container.querySelector('[data-testid="lint-marker-0-0"]')).toBeNull();
  });
});
```

Note: `ReportCanvas` uses `createDomMeasurer` (canvas `getContext`) — jsdom logs a benign warning but still lays out boxes (the existing `ReportBuilderPage`/canvas tests rely on this). If the marker query returns null because no box is laid out under jsdom, mirror the jsdom canvas stub the existing reports-builder tests use (check `domMeasurer.ts` / existing canvas tests) — but `computeLayout` runs deterministically without real canvas metrics for a title block, so a box should exist.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: FAIL — `ReportCanvas` has no `issues` prop / no marker.

- [ ] **Step 3: Add the marker to `ReportCanvas.tsx`**

In `apps/studio/src/reports-builder/ReportCanvas.tsx`:
- Add `ReportLintIssue` to the pure import: `import { computeLayout, type PageSpec, type PositionedBox, type ReportTemplate, type ReportLintIssue } from '@openldr/report-builder/pure';`
- Add `issues` to the props: change the signature to include `issues?: ReportLintIssue[]` (default handled inline).
- Add a helper before the return:
```tsx
  const cellSeverity = (r: number, c: number): 'error' | 'warning' | null => {
    const matched = (issues ?? []).filter((i) => i.rowIndex === r && i.cellIndex === c);
    if (matched.some((i) => i.severity === 'error')) return 'error';
    return matched.length ? 'warning' : null;
  };
```
- Inside the cell `<div>` (the one with `data-testid={\`canvas-cell-...\`}`), render a marker as the first child, before `<CanvasBlock … />`:
```tsx
{(() => { const sev = cellSeverity(b.rowIndex, b.cellIndex); return sev ? (
  <span data-testid={`lint-marker-${b.rowIndex}-${b.cellIndex}`} className={`pointer-events-none absolute right-1 top-1 z-10 h-2 w-2 rounded-full ${sev === 'error' ? 'bg-destructive' : 'bg-amber-500'}`} />
) : null; })()}
```

- [ ] **Step 4: Pass `issues` from `ReportBuilderPage`**

In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`, pass `issues` to the canvas:
```tsx
<ReportCanvas template={template} selected={selected} onSelect={(row, cell) => setSelected({ row, cell })} data={blockData} issues={issues} />
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportCanvas.test.tsx`
Expected: PASS. Run the whole suite for regressions: `pnpm --filter @openldr/studio exec vitest run src/reports-builder` → all green. Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/ReportCanvas.tsx apps/studio/src/reports-builder/ReportCanvas.test.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx
git commit -m "feat(studio): per-block lint markers on the report canvas"
```

---

## Task 5: Full gate — forced typecheck + suites

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages pass (new pure `lint` module consumed by studio; no other package changes).

- [ ] **Step 2: Run affected suites**

Run:
```bash
pnpm --filter @openldr/report-builder exec vitest run
pnpm --filter @openldr/studio exec vitest run src/reports-builder
```
Expected: report-builder green (incl. lint), studio reports-builder green. (The pre-existing `apps/studio/src/api.test.ts` vitest-dedupe flake is a different file.)

- [ ] **Step 3: Final commit (only if lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(report-builder): P3c-2 lint gate green"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** pure linter 7 rules (Task 1) · `LintSummary` badge+popover+click-select (Task 2) · Publish gating + header badge (Task 3) · per-block markers (Task 4). All spec sections covered.
- **Regex parity:** `PARAM_TOKEN`/`VAR_TOKEN` match those in `chart-data`/`SqlQueryEditor`/`useBlockData`; `{{param.x}}` (has a dot) never matches `VAR_TOKEN` (`\w+`), so a param binding isn't mis-flagged as an unbound var.
- **Determinism:** issues emitted name-first, then rows top-to-bottom, then dataset, then params (dup then unused), then empty-report — stable order for the summary list.
- **Type consistency:** `ReportLintIssue` fields (`severity`/`code`/`message`/`rowIndex`/`cellIndex`/`paramId`) identical across `lint.ts`, `LintSummary`, `ReportCanvas`; `onSelectBlock(row, cell)` signature identical in `LintSummary` and the `ReportBuilderPage` call.
- **Out of scope:** auto-fix, server/CLI lint enforcement, i18n (P3c-4), authoring UX (P3c-3).
- **Cross-package:** only `@openldr/report-builder` (new pure module) + `apps/studio`; forced typecheck in Task 5.
```
