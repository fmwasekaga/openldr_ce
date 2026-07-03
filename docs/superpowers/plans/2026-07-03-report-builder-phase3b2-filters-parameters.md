# Report Builder — Phase 3b-2: Filters + Parameters + Binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let report authors filter block queries (with literal ⇄ parameter binding), define report parameters, and supply parameter values through a persistent bar that drives both the live canvas and the PDF preview.

**Architecture:** One additive schema field (`ReportParam.optionsSql`) plus three new `apps/studio/src/reports-builder/` components — `FilterListEditor` (inspector), `ParametersEditor` (dialog), `ParamValuesBar` (persistent strip) — wired into `QueryEditor`/`BlockInspector` and `ReportBuilderPage`. A single `paramValues` state flows to both `useBlockData` (canvas) and `PreviewPdfDialog` (preview); filter values bound to `{{param.x}}` are substituted identically on client and server.

**Tech Stack:** TypeScript, React, Zod, Vitest + React Testing Library, shadcn/ui, `@openldr/report-builder`, `@openldr/dashboards` (`runWidgetQuery`, `QueryModel`).

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase3b2-filters-parameters-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `packages/report-builder/src/schema.ts` | Add optional `optionsSql` to `ReportParamSchema` | Modify |
| `packages/report-builder/src/schema.test.ts` | Assert `optionsSql` parses / is optional | Modify (or Create if absent) |
| `apps/studio/src/reports-builder/FilterListEditor.tsx` | Per-query filter rows (dimension/op/value ⇄ param) | Create |
| `apps/studio/src/reports-builder/FilterListEditor.test.tsx` | RTL for FilterListEditor | Create |
| `apps/studio/src/reports-builder/QueryEditor.tsx` | Embed FilterListEditor; accept `parameters` | Modify |
| `apps/studio/src/reports-builder/BlockInspector.tsx` | Thread `parameters` to QueryEditor | Modify |
| `apps/studio/src/reports-builder/ParametersEditor.tsx` | Dialog to edit `template.parameters[]` | Create |
| `apps/studio/src/reports-builder/ParametersEditor.test.tsx` | RTL for ParametersEditor | Create |
| `apps/studio/src/reports-builder/ParamValuesBar.tsx` | Persistent param-values controls | Create |
| `apps/studio/src/reports-builder/ParamValuesBar.test.tsx` | RTL for ParamValuesBar | Create |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` | `paramValues` state + wiring | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` | Assert paramValues reaches preview | Modify |
| `apps/studio/src/reports-builder/useBlockData.test.ts` | Non-empty params substitution | Modify (or Create if absent) |

**Reuse (do not reimplement):** `runWidgetQuery` (options SQL, first result column), `DateRangePicker`/`DatePicker`/`Select`/`Input`/`Button`/`Label` shadcn primitives, `DashboardFilterEditor` (UX pattern for ParametersEditor), `DashboardFilterBar` (options-SQL + control-per-type pattern for ParamValuesBar), `BuilderForm` (already in QueryEditor).

**Types (studio):** builder filters are `{ dimension: string; op: string; value: unknown }` (from `api.ts` `WidgetQuery`); `ReportParam` + `ReportParamSchema` come from `@openldr/report-builder/pure`; `QueryModel`/`ModelDimension`/`runWidgetQuery`/`listModels` from `../api`.

---

## Task 1: Schema — add `optionsSql` to `ReportParamSchema`

**Files:**
- Modify: `packages/report-builder/src/schema.ts:16-22`
- Test: `packages/report-builder/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/report-builder/src/schema.test.ts` (create the file with this content if it does not exist):

```ts
import { describe, it, expect } from 'vitest';
import { ReportParamSchema } from './schema';

describe('ReportParamSchema optionsSql', () => {
  it('accepts a select param with optionsSql', () => {
    const p = ReportParamSchema.parse({ id: 'site', label: 'Site', type: 'select', optionsSql: 'SELECT name FROM sites' });
    expect(p.optionsSql).toBe('SELECT name FROM sites');
  });

  it('leaves optionsSql undefined when omitted', () => {
    const p = ReportParamSchema.parse({ id: 'q', label: 'Query', type: 'text' });
    expect(p.optionsSql).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/schema.test.ts`
Expected: FAIL — `optionsSql` is stripped by zod (undefined) in the first test.

- [ ] **Step 3: Add the field**

In `packages/report-builder/src/schema.ts`, modify `ReportParamSchema` (currently lines 16-22) to add `optionsSql`:

```ts
export const ReportParamSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['daterange', 'select', 'text']),
  required: z.boolean().default(false),
  optionsKey: z.string().optional(),
  optionsSql: z.string().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/report-builder exec vitest run src/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/report-builder/src/schema.ts packages/report-builder/src/schema.test.ts
git commit -m "feat(report-builder): add optional optionsSql to ReportParamSchema"
```

---

## Task 2: `FilterListEditor` component

A list of filter rows for a builder query. Each row: dimension `Select`, op `Select`, and a value with a literal ⇄ parameter toggle. Parameter mode stores `{{param.<id>}}`; the toggle state is derived from the stored value.

**Files:**
- Create: `apps/studio/src/reports-builder/FilterListEditor.tsx`
- Test: `apps/studio/src/reports-builder/FilterListEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterListEditor, type BuilderFilter } from './FilterListEditor';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

const DIMS: ModelDimension[] = [
  { key: 'status', label: 'Status', column: 'status', kind: 'string' },
  { key: 'authored_on', label: 'Authored', column: 'authored_on', kind: 'date' },
];
const PARAMS: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false }];

describe('FilterListEditor', () => {
  it('adds a filter with the first dimension and eq op', () => {
    const onChange = vi.fn();
    render(<FilterListEditor filters={[]} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledWith([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('binds a value to a parameter, serialising {{param.id}}', () => {
    const onChange = vi.fn();
    const filters: BuilderFilter[] = [{ dimension: 'status', op: 'eq', value: '' }];
    render(<FilterListEditor filters={filters} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    // Toggle row 0 to parameter mode.
    fireEvent.click(screen.getByRole('button', { name: /filter-0-mode-param/i }));
    // Pick the "site" parameter from the native param select.
    fireEvent.change(screen.getByLabelText('filter-0-param'), { target: { value: 'site' } });
    expect(onChange).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'eq', value: '{{param.site}}' }]);
  });

  it('unbinds a parameter value back to a literal', () => {
    const onChange = vi.fn();
    const filters: BuilderFilter[] = [{ dimension: 'status', op: 'eq', value: '{{param.site}}' }];
    render(<FilterListEditor filters={filters} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /filter-0-mode-literal/i }));
    expect(onChange).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'eq', value: '' }]);
  });

  it('splits an `in` literal on commas into an array', () => {
    const onChange = vi.fn();
    const filters: BuilderFilter[] = [{ dimension: 'status', op: 'in', value: '' }];
    render(<FilterListEditor filters={filters} dimensions={DIMS} parameters={PARAMS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('filter-0-value'), { target: { value: 'a, b ,c' } });
    expect(onChange).toHaveBeenLastCalledWith([{ dimension: 'status', op: 'in', value: ['a', 'b', 'c'] }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/FilterListEditor.test.tsx`
Expected: FAIL — module `./FilterListEditor` not found.

- [ ] **Step 3: Write the component**

`apps/studio/src/reports-builder/FilterListEditor.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import type { ModelDimension } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

// Studio builder-filter shape (loose, mirrors api.ts WidgetQuery filters).
export interface BuilderFilter { dimension: string; op: string; value: unknown }

const OPS = ['eq', 'in', 'contains', 'gte', 'lte', 'between'] as const;
const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;

function isParamValue(v: unknown): v is string {
  return typeof v === 'string' && PARAM_TOKEN.test(v);
}
function paramId(v: unknown): string {
  return typeof v === 'string' ? (v.match(PARAM_TOKEN)?.[1] ?? '') : '';
}
// Turn a literal input string into the stored value for the given op.
function literalToValue(op: string, raw: string): unknown {
  if (op === 'in' || op === 'between') return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return raw;
}
function valueToLiteral(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
}

export function FilterListEditor({ filters, dimensions, parameters, onChange }: {
  filters: BuilderFilter[];
  dimensions: ModelDimension[];
  parameters: ReportParam[];
  onChange: (f: BuilderFilter[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<BuilderFilter>) =>
    onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () =>
    onChange([...filters, { dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Filters</div>
      {filters.map((f, i) => {
        const paramMode = isParamValue(f.value);
        return (
          <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
            <div className="flex gap-1">
              <select
                aria-label={`filter-${i}-dimension`}
                className="h-7 flex-1 rounded border border-border bg-background text-xs"
                value={f.dimension}
                onChange={(e) => update(i, { dimension: e.target.value })}
              >
                {dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <select
                aria-label={`filter-${i}-op`}
                className="h-7 w-20 rounded border border-border bg-background text-xs"
                value={f.op}
                onChange={(e) => update(i, { op: e.target.value })}
              >
                {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex">
                <Button
                  type="button" size="sm" className="h-7 rounded-r-none px-2 text-[10px]"
                  aria-label={`filter-${i}-mode-literal`}
                  variant={paramMode ? 'outline' : 'default'}
                  onClick={() => update(i, { value: '' })}
                >Value</Button>
                <Button
                  type="button" size="sm" className="h-7 rounded-l-none px-2 text-[10px]"
                  aria-label={`filter-${i}-mode-param`}
                  variant={paramMode ? 'default' : 'outline'}
                  onClick={() => update(i, { value: `{{param.${parameters[0]?.id ?? ''}}}` })}
                >Param</Button>
              </div>
              {paramMode ? (
                <select
                  aria-label={`filter-${i}-param`}
                  className="h-7 flex-1 rounded border border-border bg-background text-xs"
                  value={paramId(f.value)}
                  onChange={(e) => update(i, { value: `{{param.${e.target.value}}}` })}
                >
                  {parameters.length === 0 && <option value="">(no parameters)</option>}
                  {parameters.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              ) : (
                <Input
                  aria-label={`filter-${i}-value`}
                  className="h-7 flex-1 text-xs"
                  value={valueToLiteral(f.value)}
                  onChange={(e) => update(i, { value: literalToValue(f.op, e.target.value) })}
                />
              )}
              <Button
                type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                aria-label={`filter-${i}-remove`} onClick={() => remove(i)}
              ><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={add}>Add filter</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/FilterListEditor.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/FilterListEditor.tsx apps/studio/src/reports-builder/FilterListEditor.test.tsx
git commit -m "feat(studio): FilterListEditor with literal-param binding for report queries"
```

---

## Task 3: Embed `FilterListEditor` in `QueryEditor`; thread `parameters`

`QueryEditor` gains a `parameters` prop and renders `FilterListEditor` below `BuilderForm`, operating on the builder query's `filters`. `BlockInspector` threads `parameters` through.

**Files:**
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx`
- Modify: `apps/studio/src/reports-builder/BlockInspector.tsx:8-17,32-34`

- [ ] **Step 1: Write the failing test**

Append to (or create) `apps/studio/src/reports-builder/QueryEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryEditor } from './QueryEditor';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

vi.mock('../api', () => ({
  listModels: vi.fn().mockResolvedValue([
    { id: 'service_requests', label: 'Orders', dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }], metrics: [{ key: 'count', label: 'Count', agg: 'count' }] },
  ]),
}));

const PARAMS: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false }];

describe('QueryEditor filters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds a filter to a kpi block query', async () => {
    const block: Block = { kind: 'kpi', query: { mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] }, label: '' };
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={PARAMS} onChange={onChange} />);
    await waitFor(() => screen.getByRole('button', { name: /add filter/i }));
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ filters: [{ dimension: 'status', op: 'eq', value: '' }] }) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/QueryEditor.test.tsx`
Expected: FAIL — `QueryEditor` has no `parameters` prop / renders no "Add filter" button.

- [ ] **Step 3: Modify `QueryEditor`**

Edit `apps/studio/src/reports-builder/QueryEditor.tsx`. Add imports and the `parameters` prop, compute the model's dimensions, and render `FilterListEditor` writing filters back into the query. Full file:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listModels, type QueryModel, type WidgetQuery } from '../api';
import { BuilderForm } from '../dashboard/editor/BuilderForm';
import { FilterListEditor, type BuilderFilter } from './FilterListEditor';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
const EMPTY: BuilderQuery = { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] };
const CHART_TYPES: { v: 'bar' | 'line' | 'pie'; label: string }[] = [{ v: 'bar', label: 'Bar' }, { v: 'line', label: 'Line' }, { v: 'pie', label: 'Pie' }];

export function QueryEditor({ block, parameters, onChange }: { block: Block; parameters: ReportParam[]; onChange: (patch: Partial<Block>) => void }): JSX.Element {
  const [models, setModels] = useState<QueryModel[]>([]);
  useEffect(() => { listModels().then(setModels).catch(() => setModels([])); }, []);

  const isTable = block.kind === 'table';
  const query: BuilderQuery = isTable
    ? (block.source === 'primary' ? EMPTY : (block.source as BuilderQuery))
    : ((block as { query?: WidgetQuery }).query?.mode === 'builder' ? (block as { query: BuilderQuery }).query : EMPTY);

  const setQuery = (q: BuilderQuery) => {
    if (block.kind === 'kpi' || block.kind === 'chart') onChange({ query: q } as Partial<Block>);
    else if (isTable) onChange({ source: q } as Partial<Block>);
  };

  const showBuilder = !isTable || block.source !== 'primary';
  const dimensions = models.find((m) => m.id === query.model)?.dimensions ?? [];

  return (
    <div className="flex flex-col gap-3">
      {isTable && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={block.source === 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: 'primary' } as Partial<Block>)}>Primary dataset</Button>
          <Button type="button" size="sm" variant={block.source !== 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: { ...EMPTY } } as Partial<Block>)}>Own query</Button>
        </div>
      )}

      {showBuilder && (
        models.length ? <BuilderForm models={models} value={query} onChange={setQuery} /> : <p className="text-xs text-muted-foreground">Loading data sources…</p>
      )}

      {showBuilder && models.length > 0 && (
        <FilterListEditor
          filters={(query.filters ?? []) as BuilderFilter[]}
          dimensions={dimensions}
          parameters={parameters}
          onChange={(f) => setQuery({ ...query, filters: f as BuilderQuery['filters'] })}
        />
      )}

      {block.kind === 'chart' && (
        <div className="flex flex-col gap-1 text-xs">Chart type
          <div className="flex gap-1">
            {CHART_TYPES.map((c) => (
              <Button key={c.v} type="button" size="sm" variant={block.chartType === c.v ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ chartType: c.v } as Partial<Block>)}>{c.label}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Thread `parameters` through `BlockInspector`**

Edit `apps/studio/src/reports-builder/BlockInspector.tsx`:
- Add `import type { Block, ReportParam } from '@openldr/report-builder/pure';` (replace the existing `Block`-only import).
- Add `parameters: ReportParam[];` to the props type.
- Add `parameters` to the destructured params.
- Pass it to `QueryEditor`: change line 33 to `<QueryEditor block={block} parameters={parameters} onChange={onPatchBlock} />`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/QueryEditor.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/reports-builder/QueryEditor.test.tsx apps/studio/src/reports-builder/BlockInspector.tsx
git commit -m "feat(studio): wire FilterListEditor into QueryEditor + thread parameters"
```

---

## Task 4: `ParametersEditor` dialog

Mirrors `DashboardFilterEditor` UX but writes the `ReportParam` shape (`daterange`/`select`/`text` + `required` + `optionsSql` for select).

**Files:**
- Create: `apps/studio/src/reports-builder/ParametersEditor.tsx`
- Test: `apps/studio/src/reports-builder/ParametersEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParametersEditor } from './ParametersEditor';
import type { ReportParam } from '@openldr/report-builder/pure';

describe('ParametersEditor', () => {
  it('adds a parameter and saves it to the list', () => {
    const onSave = vi.fn();
    render(<ParametersEditor open parameters={[]} onClose={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /add parameter/i }));
    fireEvent.click(screen.getByRole('button', { name: /save parameters/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ReportParam[];
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe('text');
  });

  it('reveals Options SQL only for select type', () => {
    const params: ReportParam[] = [{ id: 'site', label: 'Site', type: 'text', required: false }];
    render(<ParametersEditor open parameters={params} onClose={() => {}} onSave={() => {}} />);
    expect(screen.queryByLabelText('param-0-options-sql')).toBeNull();
    fireEvent.change(screen.getByLabelText('param-0-type'), { target: { value: 'select' } });
    expect(screen.getByLabelText('param-0-options-sql')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParametersEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

`apps/studio/src/reports-builder/ParametersEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { ReportParam } from '@openldr/report-builder/pure';

const TYPES: ReportParam['type'][] = ['text', 'select', 'daterange'];

function newId(): string { return `p_${crypto.randomUUID().slice(0, 6)}`; }

export function ParametersEditor({ open, parameters, onClose, onSave }: {
  open: boolean;
  parameters: ReportParam[];
  onClose: () => void;
  onSave: (p: ReportParam[]) => void;
}): JSX.Element {
  const [list, setList] = useState<ReportParam[]>(parameters);
  useEffect(() => { if (open) setList(parameters); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const update = (i: number, patch: Partial<ReportParam>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; setList(next);
  };
  const add = () => setList([...list, { id: newId(), label: 'New Parameter', type: 'text', required: false }]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-lg max-h-[80vh] flex flex-col p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Report Parameters</DialogTitle>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {list.length === 0 && <p className="text-sm text-muted-foreground">No parameters yet. Add one below.</p>}
          {list.map((p, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Variable ID</Label>
                  <Input aria-label={`param-${i}-id`} className="h-8 text-xs" value={p.id}
                    onChange={(e) => update(i, { id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Label</Label>
                  <Input aria-label={`param-${i}-label`} className="h-8 text-xs" value={p.label}
                    onChange={(e) => update(i, { label: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</Label>
                  <select aria-label={`param-${i}-type`} className="h-8 w-full rounded border border-border bg-background text-xs"
                    value={p.type} onChange={(e) => update(i, { type: e.target.value as ReportParam['type'], optionsSql: undefined })}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {p.type === 'select' && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Options SQL</Label>
                  <Input aria-label={`param-${i}-options-sql`} className="h-8 font-mono text-xs"
                    placeholder="SELECT name FROM … — first column populates the dropdown"
                    value={p.optionsSql ?? ''} onChange={(e) => update(i, { optionsSql: e.target.value || undefined })} />
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" aria-label={`param-${i}-required`} checked={p.required}
                    onChange={(e) => update(i, { required: e.target.checked })} />Required
                </label>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" aria-label={`param-${i}-up`} className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`param-${i}-down`} className="h-7 w-7" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`param-${i}-remove`} className="h-7 w-7 text-destructive" onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button variant="outline" size="sm" onClick={add}>Add Parameter</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => { onSave(list); onClose(); }}>Save Parameters</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParametersEditor.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ParametersEditor.tsx apps/studio/src/reports-builder/ParametersEditor.test.tsx
git commit -m "feat(studio): ParametersEditor dialog for report parameters"
```

---

## Task 5: `ParamValuesBar` persistent strip

One control per parameter; `select` options come from running `optionsSql` via `runWidgetQuery`. Returns `null` when there are no parameters.

**Files:**
- Create: `apps/studio/src/reports-builder/ParamValuesBar.tsx`
- Test: `apps/studio/src/reports-builder/ParamValuesBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParamValuesBar } from './ParamValuesBar';
import type { ReportParam } from '@openldr/report-builder/pure';
import { runWidgetQuery } from '../api';

vi.mock('../api', () => ({ runWidgetQuery: vi.fn() }));

describe('ParamValuesBar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when there are no parameters', () => {
    const { container } = render(<ParamValuesBar parameters={[]} values={{}} onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('writes a text value on change', () => {
    const params: ReportParam[] = [{ id: 'q', label: 'Query', type: 'text', required: false }];
    const onChange = vi.fn();
    render(<ParamValuesBar parameters={params} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith({ q: 'abc' });
  });

  it('runs optionsSql to populate a select parameter', async () => {
    (runWidgetQuery as unknown as vi.Mock).mockResolvedValue({ columns: [{ key: 'name' }], rows: [{ name: 'Ndola' }, { name: 'Lusaka' }] });
    const params: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false, optionsSql: 'SELECT name FROM sites' }];
    render(<ParamValuesBar parameters={params} values={{}} onChange={() => {}} />);
    await waitFor(() => expect(runWidgetQuery).toHaveBeenCalledWith({ mode: 'sql', sql: 'SELECT name FROM sites' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParamValuesBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

`apps/studio/src/reports-builder/ParamValuesBar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { runWidgetQuery } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

const ALL = '__all__';

export function ParamValuesBar({ parameters, values, onChange }: {
  parameters: ReportParam[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}): JSX.Element | null {
  const [options, setOptions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    for (const p of parameters) {
      if (p.type !== 'select' || !p.optionsSql) continue;
      runWidgetQuery({ mode: 'sql', sql: p.optionsSql })
        .then((r) => {
          if (!alive || !r.columns?.length) return;
          const key = r.columns[0].key;
          const opts = r.rows.map((row) => String(row[key])).filter((v) => v !== 'null' && v !== '');
          setOptions((prev) => ({ ...prev, [p.id]: opts }));
        })
        .catch(() => {});
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parameters.map((p) => [p.id, p.optionsSql]))]);

  if (parameters.length === 0) return null;

  const set = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = { ...values };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') delete next[k]; else next[k] = v; }
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-2">
      {parameters.map((p) => (
        <div key={p.id} className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {p.label}{p.required && <span className="text-destructive"> *</span>}
          </Label>
          {p.type === 'daterange' ? (
            <DateRangePicker
              value={values.from || values.to ? { from: values.from ?? '', to: values.to ?? '' } : null}
              onChange={(v) => set({ from: v?.from, to: v?.to })}
              className="h-8 text-xs"
            />
          ) : p.type === 'select' ? (
            <Select value={values[p.id] ?? ALL} onValueChange={(v) => set({ [p.id]: v === ALL ? undefined : v })}>
              <SelectTrigger aria-label={p.label} className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {(options[p.id] ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input aria-label={p.label} className="h-8 w-40 text-xs" value={values[p.id] ?? ''} onChange={(e) => set({ [p.id]: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParamValuesBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ParamValuesBar.tsx apps/studio/src/reports-builder/ParamValuesBar.test.tsx
git commit -m "feat(studio): ParamValuesBar drives param values from optionsSql + controls"
```

---

## Task 6: Wire everything into `ReportBuilderPage`

Add `paramValues` state, a header **Parameters** button opening `ParametersEditor`, the `ParamValuesBar` below the header, and route `paramValues` into `useBlockData` and `PreviewPdfDialog`.

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Append a test to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` (keep existing api-mock additions for `runWidgetQuery`/`listModels` from P3b-1):

```tsx
it('passes entered parameter values to the PDF preview', async () => {
  // Render a template that already has one text parameter + is saved (tplId set).
  // (Use the file's existing render helper / api mocks; getReportTemplate returns a template
  //  whose parameters = [{ id: 'q', label: 'Query', type: 'text', required: false }].)
  // 1. type into the ParamValuesBar 'Query' input
  // 2. click "Preview PDF"
  // 3. assert previewReportTemplate was called with params containing { q: 'abc' }
  // See existing preview test for the harness; assert:
  //   expect(previewReportTemplate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ q: 'abc' }));
});
```

Implement this concretely against the file's existing mocks (the P3b-1 test already mocks `previewReportTemplate`, `getReportTemplate`, `runWidgetQuery`, `listModels`). Set the mocked `getReportTemplate` to return a template with one text parameter, drive the input by its label `Query`, click `Preview PDF`, and assert `previewReportTemplate` received `{ q: 'abc' }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: FAIL — `previewReportTemplate` currently receives `{}` (hardcoded).

- [ ] **Step 3: Modify `ReportBuilderPage`**

Apply these edits to `apps/studio/src/reports-builder/ReportBuilderPage.tsx`:

1. Add imports:
```tsx
import { ParametersEditor } from './ParametersEditor';
import { ParamValuesBar } from './ParamValuesBar';
```

2. Add state (near the other `useState` calls):
```tsx
const [paramValues, setParamValues] = useState<Record<string, string>>({});
const [paramsOpen, setParamsOpen] = useState(false);
```

3. Change the `useBlockData` call to use real values:
```tsx
const blockData = useBlockData(template, paramValues);
```

4. In the header button group, add a **Parameters** button before **Preview PDF**:
```tsx
<Button size="sm" variant="outline" onClick={() => setParamsOpen(true)}>Parameters</Button>
```

5. Render the `ParamValuesBar` immediately after the header `</div>` and the error line (above the 3-pane `<div className="flex min-h-0 flex-1 overflow-hidden">`):
```tsx
<ParamValuesBar parameters={template.parameters} values={paramValues} onChange={setParamValues} />
```

6. Pass `parameters` to `BlockInspector`:
```tsx
parameters={template.parameters}
```
(add this prop alongside the existing `block`/`colSpan`/… props).

7. Change the `PreviewPdfDialog` params and add the `ParametersEditor` dialog at the bottom (next to it):
```tsx
{tplId && <PreviewPdfDialog open={previewOpen} reportId={tplId} params={paramValues} onClose={() => setPreviewOpen(false)} />}
<ParametersEditor
  open={paramsOpen}
  parameters={template.parameters}
  onClose={() => setParamsOpen(false)}
  onSave={(p) => update({ ...template, parameters: p })}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "feat(studio): wire paramValues bar + ParametersEditor into ReportBuilderPage"
```

---

## Task 7: `useBlockData` — substitution with non-empty params

Confirm a filter value of `{{param.x}}` is replaced by the supplied param value before `runWidgetQuery`.

**Files:**
- Modify: `apps/studio/src/reports-builder/useBlockData.test.ts` (create if absent)

- [ ] **Step 1: Write the failing/covering test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBlockData } from './useBlockData';
import { runWidgetQuery } from '../api';
import type { ReportTemplate } from '@openldr/report-builder/pure';

vi.mock('../api', () => ({ runWidgetQuery: vi.fn().mockResolvedValue({ columns: [], rows: [] }) }));

function tpl(): ReportTemplate {
  return {
    id: 't', name: 'T', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r0', cells: [{ colSpan: 12, block: {
      kind: 'kpi', label: '', query: { mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
        filters: [{ dimension: 'status', op: 'eq', value: '{{param.status}}' }] },
    } }] }],
  } as ReportTemplate;
}

describe('useBlockData param substitution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('substitutes a param value into a bound filter before querying', async () => {
    renderHook(() => useBlockData(tpl(), { status: 'active' }));
    await waitFor(() => expect(runWidgetQuery).toHaveBeenCalled());
    const arg = (runWidgetQuery as unknown as vi.Mock).mock.calls[0][0];
    expect(arg.filters[0].value).toBe('active');
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/useBlockData.test.ts`
Expected: PASS (the substitution already exists in `useBlockData.resolve()`; this locks the behaviour). If it FAILS, fix `resolve()` rather than the test.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/reports-builder/useBlockData.test.ts
git commit -m "test(studio): lock useBlockData param substitution for bound filters"
```

---

## Task 8: Full gate — cross-package typecheck + test suites

The schema edit lives in `@openldr/report-builder`, consumed by server/bootstrap/cli — run the **forced** typecheck so turbo cache can't hide a cross-package break. Never pipe turbo through `tail` (it masks the exit code).

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all packages pass (no `report-builder` / studio / server / bootstrap / cli type errors).

- [ ] **Step 2: Run the affected test suites**

Run:
```bash
pnpm --filter @openldr/report-builder test
pnpm --filter @openldr/studio exec vitest run src/reports-builder
```
Expected: report-builder green; all `reports-builder/` suites green. (The pre-existing `apps/studio/src/api.test.ts` vitest-dedupe flake, if seen, is unrelated — see the studio-test-vitest-dedupe memory.)

- [ ] **Step 3: Final commit (if any lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(report-builder): P3b-2 gate green (filters + parameters + binding)"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** `optionsSql` (Task 1) · `FilterListEditor` literal⇄param (Task 2) · QueryEditor/inspector threading (Task 3) · `ParametersEditor` (Task 4) · `ParamValuesBar` driving canvas+preview via optionsSql (Task 5) · `paramValues` → `useBlockData` + `PreviewPdfDialog` (Task 6) · substitution lock (Task 7). All spec §A–§C components + data flow covered.
- **Out of scope (do not add):** SQL-mode authoring / `dashboard.raw_sql` gate (P3b-3), multi-series/breakdown (P3b-4), multiple daterange params + P3a hardening (P3c).
- **daterange v1:** `ParamValuesBar` daterange writes `from`/`to` keys; a `between` filter binds via `{{param.from}}`/`{{param.to}}` selected in `FilterListEditor`'s param dropdown (single-daterange assumption). If a param dropdown should list `from`/`to` sub-tokens explicitly, extend `FilterListEditor`'s param `<option>` list — otherwise authors bind to a scalar param; acceptable for v1.
- **Purity:** every new `reports-builder/` file imports layout/types from `@openldr/report-builder/pure`, never the server barrel (pdfkit).
- **Type consistency:** `BuilderFilter = { dimension: string; op: string; value: unknown }` used identically in FilterListEditor and QueryEditor; `ReportParam` from `/pure` used in all param components.
```
