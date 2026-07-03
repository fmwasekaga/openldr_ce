# Report Builder — Phase 3b-3: SQL Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let report authors write raw SQL for a data block (via a Builder/SQL toggle + compact modal), bind SQL `{{var}}`s to report parameters, gate raw-SQL authoring behind `dashboard.raw_sql` (client + server), and reflect it all in the live canvas and PDF preview.

**Architecture:** A new compact `SqlQueryEditor` modal reuses CodeMirror machinery to author `mode:'sql'` blocks; a var→param binding stores `values[var]='{{param.<id>}}'` so the existing `resolveQueryParams` render substitution handles it with zero new render code. `QueryEditor` gains a Builder/SQL toggle (SQL disabled for new authoring when the flag is off). `useBlockData.resolve()` is extended to substitute params into sql `values`. A server `assertReportSqlAuthoringAllowed` gate mirrors the dashboards route.

**Tech Stack:** TypeScript, React, CodeMirror 6, Vitest + React Testing Library, Fastify, `@openldr/dashboards` (`WidgetQuery`, `runWidgetQuery`), `@openldr/report-builder`.

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase3b3-sql-mode-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `apps/studio/src/reports-builder/SqlQueryEditor.tsx` | Compact SQL modal: CodeMirror + var→param binding, read-only gating | Create |
| `apps/studio/src/reports-builder/SqlQueryEditor.test.tsx` | RTL for SqlQueryEditor | Create |
| `apps/studio/src/reports-builder/QueryEditor.tsx` | Builder/SQL toggle; open SqlQueryEditor; `sqlEnabled` prop | Modify |
| `apps/studio/src/reports-builder/QueryEditor.test.tsx` | toggle + gating tests | Modify |
| `apps/studio/src/reports-builder/BlockInspector.tsx` | thread `sqlEnabled` | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` | fetch `dashboardSqlEnabled`; thread `sqlEnabled` | Modify |
| `apps/studio/src/reports-builder/useBlockData.ts` | substitute `{{param.x}}` into sql `values` | Modify |
| `apps/studio/src/reports-builder/useBlockData.test.tsx` | sql-mode substitution test | Modify |
| `apps/server/src/report-templates-routes.ts` | `assertReportSqlAuthoringAllowed` + wire into POST/PUT | Modify |
| `apps/server/src/report-templates-routes.test.ts` | gate tests (+ `featureFlags` in fake ctx) | Modify |

**Reuse:** CodeMirror packages already in `apps/studio` deps (used by `WidgetEditorDialog`); `runWidgetQuery`/`fetchClientConfig`/`WidgetQuery`/`ReportParam` from `../api` + `@openldr/report-builder/pure`. **Do NOT import `WidgetEditorDialog`** (pulls the whole dashboards dialog); the small machinery (CodeMirror mount, `{{var}}` regex) is re-implemented in `SqlQueryEditor`.

**Types:** `SqlQuery = Extract<WidgetQuery, { mode:'sql' }>`. A bound var stores `values[var] = '{{param.<id>}}'`. The `sql` template uses `{{var}}` (word chars) — distinct from `{{param.id}}` (has a dot), so the var regex `\{\{(\w+)\}\}` never matches a param token.

---

## Task 1: `SqlQueryEditor` modal

Compact modal: CodeMirror SQL editor (read-only when `sqlEnabled` is false) + a binding row per detected `{{var}}` (dropdown of report parameters → stores `values[var]='{{param.<id>}}'`). Internal state seeded from props, committed on Save.

**Files:**
- Create: `apps/studio/src/reports-builder/SqlQueryEditor.tsx`
- Test: `apps/studio/src/reports-builder/SqlQueryEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SqlQueryEditor } from './SqlQueryEditor';
import type { ReportParam } from '@openldr/report-builder/pure';

const PARAMS: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false }];

describe('SqlQueryEditor', () => {
  it('renders the SQL textarea and makes it read-only when sqlEnabled is false', () => {
    render(<SqlQueryEditor open sql="select 1 as value" values={{}} parameters={PARAMS} sqlEnabled={false} onClose={() => {}} onSave={() => {}} />);
    expect((screen.getByLabelText('SQL') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('keeps the SQL textarea editable when sqlEnabled is true', () => {
    render(<SqlQueryEditor open sql="select 1 as value" values={{}} parameters={PARAMS} sqlEnabled onClose={() => {}} onSave={() => {}} />);
    expect((screen.getByLabelText('SQL') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('detects a {{var}} and binds it to a parameter, saving a {{param.id}} token', () => {
    const onSave = vi.fn();
    render(<SqlQueryEditor open sql="select * from t where ward = {{ward}}" values={{}} parameters={PARAMS} sqlEnabled onClose={() => {}} onSave={onSave} />);
    // A binding select appears for the detected var.
    fireEvent.change(screen.getByLabelText('bind-ward'), { target: { value: 'site' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith({ mode: 'sql', sql: 'select * from t where ward = {{ward}}', values: { ward: '{{param.site}}' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/SqlQueryEditor.test.tsx`
Expected: FAIL — module `./SqlQueryEditor` not found.

- [ ] **Step 3: Write the component**

Create `apps/studio/src/reports-builder/SqlQueryEditor.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WidgetQuery } from '../api';
import type { ReportParam } from '@openldr/report-builder/pure';

type SqlQuery = Extract<WidgetQuery, { mode: 'sql' }>;
type Values = NonNullable<SqlQuery['values']>;

const VAR = /\{\{(\w+)\}\}/g;
const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;

function detectVars(sql: string): string[] {
  const m = sql.match(VAR);
  return m ? [...new Set(m.map((x) => x.slice(2, -2)))] : [];
}
function boundParamId(v: unknown): string {
  return typeof v === 'string' ? (v.match(PARAM_TOKEN)?.[1] ?? '') : '';
}

export function SqlQueryEditor({ open, sql, values, parameters, sqlEnabled, onClose, onSave }: {
  open: boolean;
  sql: string;
  values: Values;
  parameters: ReportParam[];
  sqlEnabled: boolean;
  onClose: () => void;
  onSave: (q: SqlQuery) => void;
}): JSX.Element {
  const [sqlText, setSqlText] = useState(sql);
  const [vals, setVals] = useState<Values>(values);
  const readOnly = !sqlEnabled;

  const view = useRef<EditorView>();
  const sqlRef = useRef(sqlText);
  sqlRef.current = sqlText;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // CodeMirror mount via callback ref (Radix portal attaches the node after the parent effect).
  const onEditorMount = useCallback((node: HTMLDivElement | null) => {
    if (node && !view.current) {
      try {
        view.current = new EditorView({
          parent: node,
          doc: sqlRef.current,
          extensions: [
            basicSetup,
            sqlLang(),
            oneDark,
            EditorState.readOnly.of(readOnlyRef.current),
            EditorView.editable.of(!readOnlyRef.current),
            EditorView.updateListener.of((u) => { if (u.docChanged) setSqlText(u.state.doc.toString()); }),
            EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto' } }),
          ],
        });
      } catch {
        /* jsdom lacks layout APIs CodeMirror needs; the sr-only textarea covers tests */
      }
    } else if (!node && view.current) {
      view.current.destroy();
      view.current = undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open) { setSqlText(sql); setVals(values); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const vars = detectVars(sqlText);
  const bind = (v: string, paramId: string) => setVals((prev) => {
    const next = { ...prev };
    if (paramId) next[v] = `{{param.${paramId}}}`;
    else delete next[v];
    return next;
  });
  const save = () => {
    // Only keep values for vars still present in the SQL.
    const kept: Values = {};
    for (const v of vars) if (vals[v] != null) kept[v] = vals[v];
    onSave({ mode: 'sql', sql: sqlText, values: kept });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] w-[80vw] max-w-3xl flex-col gap-0 p-0">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base font-semibold">SQL query</DialogTitle>
          <DialogDescription className="sr-only">Edit the block's SQL and bind variables to report parameters</DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="min-h-0 flex-1 overflow-hidden">
            <div ref={onEditorMount} className="h-full" />
            <textarea aria-label="SQL" className="sr-only" readOnly={readOnly} value={sqlText} onChange={(e) => setSqlText(e.target.value)} />
          </div>
          {vars.length > 0 && (
            <div className="max-h-40 overflow-y-auto border-t border-border p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Bind variables to parameters</div>
              <div className="flex flex-col gap-1">
                {vars.map((v) => (
                  <div key={v} className="flex items-center gap-2 text-xs">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{`{{${v}}}`}</code>
                    <select
                      aria-label={`bind-${v}`}
                      className="h-7 flex-1 rounded border border-border bg-background text-xs"
                      value={boundParamId(vals[v])}
                      onChange={(e) => bind(v, e.target.value)}
                    >
                      <option value="">(unbound)</option>
                      {parameters.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/SqlQueryEditor.test.tsx`
Expected: PASS (3 tests). The `sr-only` textarea drives `sqlText` in jsdom (CodeMirror mount is caught); detected vars derive from `sqlText`, so the pre-seeded `sql` prop shows the `bind-ward` select immediately.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/SqlQueryEditor.tsx apps/studio/src/reports-builder/SqlQueryEditor.test.tsx
git commit -m "feat(studio): SqlQueryEditor modal — CodeMirror + var->param binding + read-only gating"
```

---

## Task 2: `QueryEditor` Builder/SQL toggle + wire `SqlQueryEditor`

Add a `sqlEnabled` prop (defaulted `false` so callers don't break yet — real value threaded in Task 3) and a Builder/SQL toggle. SQL mode shows an "Edit SQL" button + read-only snippet + bound-params summary; the SQL toggle is disabled for a non-SQL block when `sqlEnabled` is false.

**Files:**
- Modify: `apps/studio/src/reports-builder/QueryEditor.tsx`
- Test: `apps/studio/src/reports-builder/QueryEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/QueryEditor.test.tsx` (keep the existing `vi.mock('../api', ...)` + `describe` blocks; add this `describe`, reusing the file's existing mock which returns a model with a `status` dimension):

```tsx
describe('QueryEditor SQL mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables the SQL toggle for a builder block when sqlEnabled is false', async () => {
    const block: Block = { kind: 'kpi', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, label: '' };
    render(<QueryEditor block={block} parameters={[]} sqlEnabled={false} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /^sql$/i })).toBeDisabled();
  });

  it('switches a builder block to a seeded sql query when SQL is enabled', async () => {
    const block: Block = { kind: 'kpi', query: { mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [] }, label: '' };
    const onChange = vi.fn();
    render(<QueryEditor block={block} parameters={[]} sqlEnabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^sql$/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ query: { mode: 'sql', sql: 'select 1 as value', values: {} } }));
  });

  it('shows Edit SQL for an existing sql block even when sqlEnabled is false', () => {
    const block: Block = { kind: 'kpi', query: { mode: 'sql', sql: 'select 2 as value', values: {} }, label: '' };
    render(<QueryEditor block={block} parameters={[]} sqlEnabled={false} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /edit sql/i })).toBeTruthy();
  });
});
```

Ensure `beforeEach`, `fireEvent`, `screen`, `Block` are imported at the top of the file (the existing suite already imports most; add any missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/QueryEditor.test.tsx`
Expected: FAIL — no SQL toggle / `sqlEnabled` prop.

- [ ] **Step 3: Modify `QueryEditor.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listModels, type QueryModel, type WidgetQuery } from '../api';
import { BuilderForm } from '../dashboard/editor/BuilderForm';
import { FilterListEditor, type BuilderFilter } from './FilterListEditor';
import { SqlQueryEditor } from './SqlQueryEditor';
import type { Block, ReportParam } from '@openldr/report-builder/pure';

type BuilderQuery = Extract<WidgetQuery, { mode: 'builder' }>;
type SqlQuery = Extract<WidgetQuery, { mode: 'sql' }>;
const EMPTY: BuilderQuery = { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] };
const EMPTY_SQL: SqlQuery = { mode: 'sql', sql: 'select 1 as value', values: {} };
const CHART_TYPES: { v: 'bar' | 'line' | 'pie'; label: string }[] = [{ v: 'bar', label: 'Bar' }, { v: 'line', label: 'Line' }, { v: 'pie', label: 'Pie' }];
const PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/;

export function QueryEditor({ block, parameters, sqlEnabled = false, onChange }: { block: Block; parameters: ReportParam[]; sqlEnabled?: boolean; onChange: (patch: Partial<Block>) => void }): JSX.Element {
  const [models, setModels] = useState<QueryModel[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);
  useEffect(() => { listModels().then(setModels).catch(() => setModels([])); }, []);

  const isTable = block.kind === 'table';
  // The raw stored query for this block, or null (table:'primary').
  const rawQuery: WidgetQuery | null = isTable
    ? (block.source === 'primary' ? null : (block.source as WidgetQuery))
    : ((block as { query?: WidgetQuery }).query ?? null);
  const mode: 'builder' | 'sql' = rawQuery?.mode === 'sql' ? 'sql' : 'builder';
  const builderQuery: BuilderQuery = rawQuery?.mode === 'builder' ? rawQuery : EMPTY;
  const sqlQuery: SqlQuery = rawQuery?.mode === 'sql' ? rawQuery : EMPTY_SQL;

  const setQuery = (q: WidgetQuery) => {
    if (block.kind === 'kpi' || block.kind === 'chart') onChange({ query: q } as Partial<Block>);
    else if (isTable) onChange({ source: q } as Partial<Block>);
  };

  const showBuilder = !isTable || block.source !== 'primary';
  const dimensions = models.find((m) => m.id === builderQuery.model)?.dimensions ?? [];
  // SQL authoring for a new (non-sql) block requires the flag; an existing sql block stays viewable.
  const sqlToggleDisabled = !sqlEnabled && mode !== 'sql';
  const boundParams = Object.entries(sqlQuery.values ?? {})
    .map(([v, val]) => [v, (typeof val === 'string' ? val.match(PARAM_TOKEN)?.[1] : undefined)] as const)
    .filter(([, p]) => p);

  return (
    <div className="flex flex-col gap-3">
      {isTable && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={block.source === 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: 'primary' } as Partial<Block>)}>Primary dataset</Button>
          <Button type="button" size="sm" variant={block.source !== 'primary' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => onChange({ source: { ...EMPTY } } as Partial<Block>)}>Own query</Button>
        </div>
      )}

      {showBuilder && (
        <div className="flex gap-1 text-xs">
          <Button type="button" size="sm" variant={mode === 'builder' ? 'default' : 'outline'} className="h-7 flex-1" onClick={() => { if (mode !== 'builder') setQuery({ ...EMPTY }); }}>Builder</Button>
          <Button type="button" size="sm" variant={mode === 'sql' ? 'default' : 'outline'} className="h-7 flex-1" disabled={sqlToggleDisabled} onClick={() => { if (mode !== 'sql') setQuery({ ...EMPTY_SQL }); }}>SQL</Button>
        </div>
      )}

      {showBuilder && mode === 'builder' && (
        <>
          {models.length ? <BuilderForm models={models} value={builderQuery} onChange={(q) => setQuery(q)} /> : <p className="text-xs text-muted-foreground">Loading data sources…</p>}
          {models.length > 0 && (
            <FilterListEditor
              filters={(builderQuery.filters ?? []) as BuilderFilter[]}
              dimensions={dimensions}
              parameters={parameters}
              onChange={(f) => setQuery({ ...builderQuery, filters: f as BuilderQuery['filters'] })}
            />
          )}
        </>
      )}

      {showBuilder && mode === 'sql' && (
        <div className="flex flex-col gap-2">
          <pre className="max-h-24 overflow-auto rounded border border-border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{sqlQuery.sql}</pre>
          {boundParams.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {boundParams.map(([v, p]) => <div key={v}><code className="font-mono">{`{{${v}}}`}</code> → {p}</div>)}
            </div>
          )}
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSqlOpen(true)}>Edit SQL</Button>
          <SqlQueryEditor
            open={sqlOpen}
            sql={sqlQuery.sql}
            values={sqlQuery.values ?? {}}
            parameters={parameters}
            sqlEnabled={sqlEnabled}
            onClose={() => setSqlOpen(false)}
            onSave={(q) => setQuery(q)}
          />
        </div>
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/QueryEditor.test.tsx`
Expected: PASS (existing filter tests + 3 new SQL-mode tests). `tsc` stays green because `sqlEnabled` is optional (`= false`), so `BlockInspector`/`ReportBuilderPage` still compile.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/QueryEditor.tsx apps/studio/src/reports-builder/QueryEditor.test.tsx
git commit -m "feat(studio): QueryEditor Builder/SQL toggle + SqlQueryEditor wiring"
```

---

## Task 3: Thread real `sqlEnabled` from `ReportBuilderPage`

Fetch `dashboardSqlEnabled` from `/api/config` and thread it through `BlockInspector` → `QueryEditor`.

**Files:**
- Modify: `apps/studio/src/reports-builder/BlockInspector.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Test: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` (reuse the file's existing mocks; the mock for `../api` must expose `fetchClientConfig`). Add `fetchClientConfig: vi.fn().mockResolvedValue({ dashboardSqlEnabled: true, authEnforced: false, version: '', environment: '', oidc: null })` to the `../api` mock factory, then:

```tsx
it('fetches the client config for SQL gating on mount', async () => {
  renderNew(); // or the file's existing render helper
  await waitFor(() => expect(fetchClientConfig).toHaveBeenCalled());
});
```

Import `fetchClientConfig` from `../api` in the test and `waitFor` from `@testing-library/react` if not already. (If the file has a `renderNew`/`renderId` helper from Task-6 of P3b-2, reuse it; otherwise render `<ReportBuilderPage/>` within the existing router/mocks harness.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: FAIL — `fetchClientConfig` not called (not yet wired).

- [ ] **Step 3: Thread `sqlEnabled`**

In `apps/studio/src/reports-builder/BlockInspector.tsx`:
- Add `sqlEnabled: boolean;` to the props type and destructuring.
- Pass it to `QueryEditor`: `<QueryEditor block={block} parameters={parameters} sqlEnabled={sqlEnabled} onChange={onPatchBlock} />`.

In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`:
- Add `fetchClientConfig` to the import from `../api`.
- Add state + effect near the other state:
```tsx
const [sqlEnabled, setSqlEnabled] = useState(false);
useEffect(() => { fetchClientConfig().then((c) => setSqlEnabled(c.dashboardSqlEnabled)).catch(() => {}); }, []);
```
- Pass `sqlEnabled={sqlEnabled}` to `<BlockInspector … />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: PASS. Also run `pnpm --filter @openldr/studio exec vitest run src/reports-builder` — all green. And `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/BlockInspector.tsx apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "feat(studio): thread dashboardSqlEnabled into report builder SQL gating"
```

---

## Task 4: `useBlockData` — substitute params into sql `values`

Extend `resolve()` so sql-mode blocks get `{{param.x}}` replaced in their `values` (mirrors server `resolveQueryParams`), so the canvas reflects parameters for SQL blocks.

**Files:**
- Modify: `apps/studio/src/reports-builder/useBlockData.ts`
- Test: `apps/studio/src/reports-builder/useBlockData.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/useBlockData.test.tsx` (reuse the file's `vi.mock('../api', …)` returning `runWidgetQuery`):

```tsx
it('substitutes a param value into a sql block values before querying', async () => {
  const t = {
    id: 't', name: 'T', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r0', cells: [{ colSpan: 12, block: {
      kind: 'kpi', label: '', query: { mode: 'sql', sql: 'select {{ward}}', values: { ward: '{{param.site}}' } },
    } }] }],
  } as unknown as import('@openldr/report-builder/pure').ReportTemplate;
  renderHook(() => useBlockData(t, { site: 'ICU' }));
  await waitFor(() => expect(runWidgetQuery).toHaveBeenCalled());
  const arg = vi.mocked(runWidgetQuery).mock.calls[0][0] as { mode: string; values: Record<string, unknown> };
  expect(arg.mode).toBe('sql');
  expect(arg.values.ward).toBe('ICU');
});
```

(Ensure `renderHook`, `waitFor`, and `runWidgetQuery` are imported in the file — the existing substitution test already imports them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/useBlockData.test.tsx`
Expected: FAIL — `arg.values.ward` is still `'{{param.site}}'` (sql values not substituted).

- [ ] **Step 3: Extend `resolve()` in `useBlockData.ts`**

In `apps/studio/src/reports-builder/useBlockData.ts`, change the `resolve` function so it also handles sql-mode `values`. Replace:

```ts
function resolve(q: WidgetQuery, params: Record<string, string>): WidgetQuery {
  const clone = JSON.parse(JSON.stringify(q)) as WidgetQuery;
  const sub = (v: unknown) => (typeof v === 'string' && v.includes('{{') ? v.replace(TOKEN, (_m, k: string) => params[k] ?? '') : v);
  if (clone.mode === 'builder') clone.filters = (clone.filters ?? []).map((f) => ({ ...f, value: sub(f.value) as never }));
  return clone;
}
```

with:

```ts
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/useBlockData.test.tsx`
Expected: PASS (existing builder-substitution test + new sql-substitution test).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/useBlockData.ts apps/studio/src/reports-builder/useBlockData.test.tsx
git commit -m "feat(studio): useBlockData substitutes params into sql-mode values"
```

---

## Task 5: Server SQL authoring gate

Add `assertReportSqlAuthoringAllowed` mirroring the dashboards gate, and wire it into the report-template create/update routes.

**Files:**
- Modify: `apps/server/src/report-templates-routes.ts`
- Test: `apps/server/src/report-templates-routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/src/report-templates-routes.test.ts`:

1. Add a `featureFlags` stub to `fakeCtx()` (default flag OFF), controllable per test. Change the `return { … }` object in `fakeCtx` to accept a flag:
```ts
function fakeCtx(sqlEnabled = false) {
  const data: any[] = [];
  const auditEvents: any[] = [];
  return {
    reportTemplates: { /* unchanged */
      list: async () => data,
      get: async (id: string) => data.find((d) => d.id === id),
      create: async (d: any) => { data.push(d); return d; },
      update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
      remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    },
    featureFlags: { get: async (_k: string) => sqlEnabled },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
  } as any;
}
```

2. Add a `describe`:
```ts
describe('report-template raw SQL authoring gate', () => {
  const sqlTpl = (sql: string) => ({
    id: 'rt1', name: 'R', description: '', category: 'operational', status: 'draft',
    page: { size: 'A4', orientation: 'portrait', margins: { top: 40, right: 40, bottom: 40, left: 40 } },
    parameters: [], rows: [{ id: 'r', cells: [{ colSpan: 12, block: { kind: 'kpi', label: '', query: { mode: 'sql', sql, values: {} } } }] }],
  });

  it('rejects creating a report with a raw SQL block when the flag is off', async () => {
    const app = appWith(fakeCtx(false));
    const res = await app.inject({ method: 'POST', url: '/api/report-templates', payload: sqlTpl('select 1 as value') });
    expect(res.statusCode).toBe(400);
  });

  it('allows creating a raw SQL block when the flag is on', async () => {
    const app = appWith(fakeCtx(true));
    const res = await app.inject({ method: 'POST', url: '/api/report-templates', payload: sqlTpl('select 1 as value') });
    expect(res.statusCode).toBe(201);
  });

  it('allows a non-SQL edit to a persisted SQL block with the flag off (unchanged SQL is vetted)', async () => {
    const ctx = fakeCtx(true);
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-templates', payload: sqlTpl('select 1 as value') });
    // Flip flag off, then PUT the SAME sql (e.g. a name change) — must pass.
    ctx.featureFlags.get = async () => false;
    const res = await app.inject({ method: 'PUT', url: '/api/report-templates/rt1', payload: { ...sqlTpl('select 1 as value'), name: 'Renamed' } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects CHANGING the SQL text of a persisted block with the flag off', async () => {
    const ctx = fakeCtx(true);
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-templates', payload: sqlTpl('select 1 as value') });
    ctx.featureFlags.get = async () => false;
    const res = await app.inject({ method: 'PUT', url: '/api/report-templates/rt1', payload: sqlTpl('select 2 as value') });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/report-templates-routes.test.ts`
Expected: FAIL — no gate; the create-with-flag-off returns 201 instead of 400.

- [ ] **Step 3: Add the gate to `report-templates-routes.ts`**

At the top of `apps/server/src/report-templates-routes.ts`, add these helpers after the imports (add `import type { ReportTemplate, Block } from '@openldr/report-builder/pure';`):

```ts
// Collect the trimmed SQL text of every sql-mode block query in a template (kpi/chart .query,
// table .source when not 'primary', plus the optional dataset). Mirrors the dashboards gate.
function blockSql(block: Block): string | null {
  if (block.kind === 'kpi' || block.kind === 'chart') return block.query.mode === 'sql' ? block.query.sql.trim() : null;
  if (block.kind === 'table') return block.source !== 'primary' && block.source.mode === 'sql' ? block.source.sql.trim() : null;
  return null;
}
function reportSqlTemplates(t: ReportTemplate | undefined): Set<string> {
  const set = new Set<string>();
  if (!t) return set;
  if (t.dataset?.mode === 'sql') set.add(t.dataset.sql.trim());
  for (const row of t.rows) for (const cell of row.cells) { const s = blockSql(cell.block); if (s != null) set.add(s); }
  return set;
}
// Authoring gate: with `dashboard.raw_sql` off, reject NEW/changed sql-mode blocks. Unchanged SQL
// (text matches an already-persisted template) is exempt so layout/binding edits still save and the
// vetted query still previews. Only the SQL text is gated.
function assertReportSqlAuthoringAllowed(sqlEnabled: boolean, t: ReportTemplate, prev: Set<string>): void {
  if (sqlEnabled) return;
  const current = reportSqlTemplates(t);
  for (const sql of current) if (!prev.has(sql)) throw new Error('raw SQL blocks are disabled');
}
```

Then wire into the routes. In the **POST** handler, after `p.success` check:
```ts
const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
try { assertReportSqlAuthoringAllowed(sqlEnabled, p.data, new Set()); }
catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : String(e) }; }
```
In the **PUT** handler, after loading `before` (and its 404 check):
```ts
const sqlEnabled = await ctx.featureFlags.get('dashboard.raw_sql');
try { assertReportSqlAuthoringAllowed(sqlEnabled, p.data, reportSqlTemplates(before)); }
catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : String(e) }; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server exec vitest run src/report-templates-routes.test.ts`
Expected: PASS (existing route tests + 4 new gate tests). The existing tests use `fakeCtx()` (flag off) with the `minimal` template (no SQL blocks) so they remain unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/report-templates-routes.ts apps/server/src/report-templates-routes.test.ts
git commit -m "feat(server): gate raw-SQL report blocks behind dashboard.raw_sql on save"
```

---

## Task 6: Full gate — forced typecheck + suites

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all packages pass (studio + server compile; no `@openldr/report-builder` change this slice).

- [ ] **Step 2: Run affected suites**

Run:
```bash
pnpm --filter @openldr/studio exec vitest run src/reports-builder
pnpm --filter @openldr/server exec vitest run src/report-templates-routes.test.ts
```
Expected: reports-builder suite all green; server report-template routes green. (The pre-existing `apps/studio/src/api.test.ts` vitest-dedupe flake is a different file — not in these paths.)

- [ ] **Step 3: Final commit (only if lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(report-builder): P3b-3 SQL mode gate green"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** `SqlQueryEditor` modal + var→param binding (Task 1) · Builder/SQL toggle + gating UI (Task 2) · client flag thread (Task 3) · canvas sql substitution (Task 4) · server authoring gate (Task 5). Storage model `values[var]='{{param.id}}'` used consistently across Tasks 1/2/4/5.
- **No schema change:** sql-mode is already in `WidgetQuerySchema`; `resolveQueryParams` already substitutes params into sql `values` — so nothing in `@openldr/report-builder` changes.
- **Out of scope (do not add):** in-modal Run/preview, daterange→SQL var binding (scalar params only), multi-series (P3b-4), P3c lint/validation.
- **Type consistency:** `SqlQuery = Extract<WidgetQuery,{mode:'sql'}>`; `Values = NonNullable<SqlQuery['values']>`; var regex `\{\{(\w+)\}\}` (never matches `{{param.id}}`); `PARAM_TOKEN = /^\{\{\s*param\.(\w+)\s*\}\}$/` used to read a bound id in both `SqlQueryEditor` and `QueryEditor`.
- **Green intermediates:** `QueryEditor`'s `sqlEnabled` prop defaults to `false` (Task 2) so `BlockInspector`/`ReportBuilderPage` compile before Task 3 threads the real value.
- **Purity:** all `reports-builder/` files import report types from `@openldr/report-builder/pure`; `SqlQueryEditor` re-implements the CodeMirror machinery rather than importing `WidgetEditorDialog`.
```
