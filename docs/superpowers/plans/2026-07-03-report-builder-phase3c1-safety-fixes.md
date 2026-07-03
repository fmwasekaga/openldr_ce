# Report Builder — Phase 3c-1: Safety / Correctness Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six deferred safety/correctness items in the Report Builder: delete confirmation, save-refetch clobber guard, parameter id validation, options-SQL error surfacing, a key-only `breakdown` schema, and removal of a dead chart-mapping branch.

**Architecture:** Six independent, targeted fixes across `apps/studio/src/reports-builder/*`, plus one shared-package schema narrow in `@openldr/dashboards`. Each is TDD'd in isolation; only the schema narrow is cross-package.

**Tech Stack:** TypeScript, React, Zod, Vitest + React Testing Library, shadcn/ui (`AlertDialog`).

**Spec:** `docs/superpowers/specs/2026-07-03-report-builder-phase3c1-safety-fixes-design.md`

---

## File Structure

| File | Fix | Action |
| --- | --- | --- |
| `packages/dashboards/src/types.ts` | narrow builder `breakdown` to `{ key }` | Modify |
| `packages/dashboards/src/types.test.ts` | breakdown strips `grain` | Modify |
| `apps/studio/src/api.ts` | mirror `breakdown?: { key: string }` | Modify |
| `apps/studio/src/reports-builder/blockToWidgetConfig.ts` | remove dead chart branch | Modify |
| `apps/studio/src/reports-builder/blockToWidgetConfig.test.ts` | drop chart tests | Modify |
| `apps/studio/src/reports-builder/ParametersEditor.tsx` | id uniqueness/non-empty guard | Modify |
| `apps/studio/src/reports-builder/ParametersEditor.test.tsx` | validation test | Modify |
| `apps/studio/src/reports-builder/ParamValuesBar.tsx` | surface optionsSql errors | Modify |
| `apps/studio/src/reports-builder/ParamValuesBar.test.tsx` | error-surfacing test | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.tsx` | delete confirm + clobber guard | Modify |
| `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` | confirm + clobber tests | Modify |

---

## Task 1: Narrow `breakdown` schema to key-only

**Files:**
- Modify: `packages/dashboards/src/types.ts`
- Modify: `packages/dashboards/src/types.test.ts`
- Modify: `apps/studio/src/api.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/dashboards/src/types.test.ts`:

```ts
it('strips grain from a builder breakdown (key-only)', () => {
  const q = WidgetQuerySchema.parse({
    mode: 'builder', model: 'm', metric: { key: 'count', agg: 'count' },
    dimension: { key: 'status' }, breakdown: { key: 'ward', grain: 'month' }, filters: [],
  });
  expect(q).toMatchObject({ breakdown: { key: 'ward' } });
  // grain must NOT survive
  expect((q as { breakdown?: Record<string, unknown> }).breakdown).not.toHaveProperty('grain');
});
```

Ensure `WidgetQuerySchema` is imported at the top of `types.test.ts` (it likely already is; if not, `import { WidgetQuerySchema } from './types';`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/types.test.ts`
Expected: FAIL — `breakdown` currently keeps `grain` (it's `DimensionRefSchema`).

- [ ] **Step 3: Narrow the schema**

In `packages/dashboards/src/types.ts`, in the builder object of `WidgetQuerySchema`, change:
```ts
    breakdown: DimensionRefSchema.optional(),
```
to:
```ts
    breakdown: z.object({ key: z.string() }).optional(),
```

- [ ] **Step 4: Mirror the studio type**

In `apps/studio/src/api.ts`, change the builder `WidgetQuery` member's breakdown field from `breakdown?: { key: string; grain?: string };` to:
```ts
      breakdown?: { key: string };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/dashboards exec vitest run src/types.test.ts`
Expected: PASS. Also run the compile suite (breakdown compile still uses `.key`):
Run: `pnpm --filter @openldr/dashboards exec vitest run src/compile.test.ts src/compile.run.test.ts`
Expected: PASS. And `pnpm --filter @openldr/dashboards exec tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboards/src/types.ts packages/dashboards/src/types.test.ts apps/studio/src/api.ts
git commit -m "fix(dashboards): narrow builder breakdown schema to key-only"
```

---

## Task 2: Remove dead `blockToWidgetConfig` chart branch

Chart blocks now render via `ReportChart`; `blockToWidgetConfig` is only called for kpi/table.

**Files:**
- Modify: `apps/studio/src/reports-builder/blockToWidgetConfig.ts`
- Modify: `apps/studio/src/reports-builder/blockToWidgetConfig.test.ts`

- [ ] **Step 1: Update the tests (remove chart cases)**

Replace the `describe` body in `apps/studio/src/reports-builder/blockToWidgetConfig.test.ts` so ONLY the kpi and table cases remain (delete the three chart-related `it` blocks):

```ts
describe('blockToWidgetConfig', () => {
  it('maps a kpi block to a kpi widget using the numeric column', () => {
    const cfg = blockToWidgetConfig({ kind: 'kpi', query: {} as any, label: 'Total' } as any, result);
    expect(cfg.type).toBe('kpi');
    expect(cfg.visual.yAxisKey).toBe('value');
    expect(cfg.title).toBe('Total');
  });
  it('maps a table block to a table widget', () => {
    expect(blockToWidgetConfig({ kind: 'table', source: 'primary', columns: [] } as any, result).type).toBe('table');
  });
});
```

- [ ] **Step 2: Run to verify the chart tests are gone and kpi/table pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/blockToWidgetConfig.test.ts`
Expected: PASS (2 tests). (The chart branch is still present but no longer tested; Step 3 removes it.)

- [ ] **Step 3: Remove the chart branch**

In `apps/studio/src/reports-builder/blockToWidgetConfig.ts`, DELETE the `if (block.kind === 'chart') { … }` block entirely. Add a short comment where it was:
```ts
  // Chart blocks are rendered by ReportChart (see CanvasBlock); this maps kpi/table only.
```
Keep the `if (block.kind === 'kpi') { … }` branch and the final `return { ...base, type: 'table', visual: {} };`. The `CHART_TYPE` constant is now unused — delete it and its declaration.

- [ ] **Step 4: Run to verify + typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/blockToWidgetConfig.test.ts`
Expected: PASS (2 tests).
Run: `pnpm --filter @openldr/studio exec tsc --noEmit`
Expected: exit 0 (no unused `CHART_TYPE`/`axisKeys` — note `axisKeys` is still used by kpi? verify: kpi uses `y` from `axisKeys`, so keep `axisKeys`; only `CHART_TYPE` becomes unused). If `tsc`/lint flags anything else unused, remove it.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/blockToWidgetConfig.ts apps/studio/src/reports-builder/blockToWidgetConfig.test.ts
git commit -m "refactor(studio): drop dead chart branch from blockToWidgetConfig (ReportChart renders charts)"
```

---

## Task 3: Parameter id uniqueness / non-empty guard

**Files:**
- Modify: `apps/studio/src/reports-builder/ParametersEditor.tsx`
- Modify: `apps/studio/src/reports-builder/ParametersEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ParametersEditor.test.tsx`:

```tsx
it('disables Save and shows a message when ids are duplicated', () => {
  const onSave = vi.fn();
  const params: ReportParam[] = [
    { id: 'site', label: 'A', type: 'text', required: false },
    { id: 'site', label: 'B', type: 'text', required: false },
  ];
  render(<ParametersEditor open parameters={params} onClose={() => {}} onSave={onSave} />);
  expect(screen.getByRole('button', { name: /save parameters/i })).toBeDisabled();
  expect(screen.getByText(/unique and non-empty/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /save parameters/i }));
  expect(onSave).not.toHaveBeenCalled();
});

it('disables Save when an id is empty', () => {
  const params: ReportParam[] = [{ id: '', label: 'A', type: 'text', required: false }];
  render(<ParametersEditor open parameters={params} onClose={() => {}} onSave={() => {}} />);
  expect(screen.getByRole('button', { name: /save parameters/i })).toBeDisabled();
});
```

Ensure `vi`, `render`, `screen`, `fireEvent`, and `ReportParam` are imported (the file already imports most).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParametersEditor.test.tsx`
Expected: FAIL — Save isn't disabled; message absent.

- [ ] **Step 3: Add validation**

In `apps/studio/src/reports-builder/ParametersEditor.tsx`, after the `add` function (and before `return`), compute validity:
```ts
  const ids = list.map((p) => p.id.trim());
  const invalid = ids.some((id) => id === '') || new Set(ids).size !== ids.length;
```

Then, in the footer, change the Save button to be disabled when `invalid`, and add an inline message. Find the footer's Save button (`<Button size="sm" onClick={() => { onSave(list); onClose(); }}>Save Parameters</Button>`) and replace that footer's right-hand group so it reads:
```tsx
          <div className="flex items-center gap-2">
            {invalid && <span className="text-xs text-destructive">Parameter ids must be unique and non-empty</span>}
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={invalid} onClick={() => { if (!invalid) { onSave(list); onClose(); } }}>Save Parameters</Button>
          </div>
```
(Keep the "Add Parameter" button on the left as-is.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParametersEditor.test.tsx`
Expected: PASS (existing tests + 2 new). Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ParametersEditor.tsx apps/studio/src/reports-builder/ParametersEditor.test.tsx
git commit -m "fix(studio): block ParametersEditor save on empty/duplicate parameter ids"
```

---

## Task 4: Surface options-SQL errors in `ParamValuesBar`

**Files:**
- Modify: `apps/studio/src/reports-builder/ParamValuesBar.tsx`
- Modify: `apps/studio/src/reports-builder/ParamValuesBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ParamValuesBar.test.tsx`:

```tsx
it('surfaces an inline warning when optionsSql fails', async () => {
  (runWidgetQuery as unknown as vi.Mock).mockRejectedValue(new Error('bad sql'));
  const params: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false, optionsSql: 'SELECT x' }];
  render(<ParamValuesBar parameters={params} values={{}} onChange={() => {}} />);
  expect(await screen.findByText(/options failed/i)).toBeTruthy();
});
```

(Use `vi.mocked(runWidgetQuery).mockRejectedValue(...)` if the file's mock style prefers it — mirror the existing `runWidgetQuery` mock in this test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParamValuesBar.test.tsx`
Expected: FAIL — no warning rendered (error swallowed).

- [ ] **Step 3: Track + render the error**

In `apps/studio/src/reports-builder/ParamValuesBar.tsx`:
- Add an errors state next to `options`:
```tsx
  const [optErrors, setOptErrors] = useState<Record<string, string>>({});
```
- In the effect, replace the `.then(...).catch(() => {})` chain so success clears and failure records:
```tsx
      runWidgetQuery({ mode: 'sql', sql: p.optionsSql })
        .then((r) => {
          if (!alive || !r.columns?.length) return;
          const key = r.columns[0].key;
          const opts = r.rows.map((row) => String(row[key])).filter((v) => v !== 'null' && v !== '');
          setOptions((prev) => ({ ...prev, [p.id]: opts }));
          setOptErrors((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
        })
        .catch((e) => { if (alive) setOptErrors((prev) => ({ ...prev, [p.id]: e instanceof Error ? e.message : String(e) })); });
```
- In the `select` branch of the render, add a warning under the control:
```tsx
          ) : p.type === 'select' ? (
            <div className="flex flex-col gap-0.5">
              <Select value={values[p.id] ?? ALL} onValueChange={(v) => set({ [p.id]: v === ALL ? undefined : v })}>
                <SelectTrigger aria-label={p.label} className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {(options[p.id] ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              {optErrors[p.id] && <span className="text-[10px] text-destructive">options failed</span>}
            </div>
          ) : (
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ParamValuesBar.test.tsx`
Expected: PASS (existing + new). Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ParamValuesBar.tsx apps/studio/src/reports-builder/ParamValuesBar.test.tsx
git commit -m "fix(studio): surface optionsSql failures in ParamValuesBar instead of swallowing"
```

---

## Task 5: Delete confirmation dialog

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx` (reuse the file's existing mocks incl. `deleteReportTemplate`; if `deleteReportTemplate` isn't yet a spy in the `../api` mock, add it as `vi.fn().mockResolvedValue(undefined)`). Use the file's existing render helper for a saved report (`renderId`-style, so `tplId` is set):

```tsx
it('does not delete until the confirmation is accepted', async () => {
  renderId(); // renders an existing (saved) report
  fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
  expect(deleteReportTemplate).not.toHaveBeenCalled();
  // Confirm in the AlertDialog
  fireEvent.click(await screen.findByRole('button', { name: /^delete report$/i }));
  await waitFor(() => expect(deleteReportTemplate).toHaveBeenCalled());
});
```

(If the file's helper is named differently, use it. The confirm button label is `Delete report` per Step 3; the header Delete button is `Delete`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: FAIL — Delete fires `deleteReportTemplate` immediately (no dialog).

- [ ] **Step 3: Add the AlertDialog**

First READ `apps/studio/src/pages/Forms.tsx` (or `workflows/WorkflowList.tsx`) to see the exact export names this repo's `@/components/ui/alert-dialog` uses, and mirror that import. In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`:

- Add the alert-dialog import (match the names used in Forms.tsx; the standard shadcn set is):
```tsx
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
```
- Add state: `const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);`
- Change the header Delete button to open the dialog instead of deleting:
```tsx
<Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDeleteOpen(true)}>Delete</Button>
```
- Render the dialog near the bottom (next to `<ParametersEditor … />`):
```tsx
<AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete this report?</AlertDialogTitle>
      <AlertDialogDescription>This permanently deletes the report template. This cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void handleDelete(); }}>Delete report</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```
(`handleDelete` already guards on `tplId`. If the AlertDialog export names differ from the snippet, use the actual ones from the repo's `alert-dialog.tsx` — adjust to match Forms.tsx.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: PASS. Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "fix(studio): confirm before deleting a report template"
```

---

## Task 6: Save→navigate refetch clobber guard

**Files:**
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.tsx`
- Modify: `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/reports-builder/ReportBuilderPage.test.tsx`. Render the NEW route (no id), mock `createReportTemplate` to resolve a template with id `rt-new`, click Save, and assert the post-save navigation does NOT trigger a `getReportTemplate` refetch of `rt-new`:

```tsx
it('does not refetch (clobber) after saving a new report', async () => {
  renderNew(); // renders the /reports/builder/new route (no :id)
  fireEvent.click(await screen.findByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(createReportTemplate).toHaveBeenCalled());
  // The replace-navigation to /reports/builder/rt-new must NOT re-load it.
  expect(getReportTemplate).not.toHaveBeenCalledWith('rt-new');
});
```

Ensure `createReportTemplate` is a spy in the `../api` mock resolving `{ ...minimalTemplate, id: 'rt-new' }`, and `getReportTemplate` is a spy. If the test router doesn't actually change the URL param on `navigate`, this still holds (getReportTemplate never called with rt-new); if the harness DOES re-render with the new id, the `loadedIdRef` guard (Step 3) is what makes it pass.

- [ ] **Step 2: Run to verify it fails (or is trivially green)**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: If the harness re-renders with the new id, FAIL (getReportTemplate called with rt-new). If it does not, the test still documents the guard — proceed to Step 3 regardless so the guard exists.

- [ ] **Step 3: Add the `loadedIdRef` guard**

In `apps/studio/src/reports-builder/ReportBuilderPage.tsx`:
- Import `useRef` from `react` (add it to the existing `react` import). Add a ref near the top of the component, seeded `null` so the initial mount always loads once: `const loadedIdRef = useRef<string | null>(null);`
- Change the load effect to skip when already loaded and to record the loaded id:
```tsx
  useEffect(() => {
    if (!id || loadedIdRef.current === id) return;
    let cancelled = false;
    void getReportTemplate(id).then((t) => { if (!cancelled) { loadedIdRef.current = t.id; setTplId(t.id); setTemplate(t); } }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [id]);
```
- In `save()`, after `setTemplate(saved); setTplId(saved.id);`, record the loaded id so the post-create navigation is treated as already-loaded:
```tsx
      setTemplate(saved); setTplId(saved.id); loadedIdRef.current = saved.id;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/reports-builder/ReportBuilderPage.test.tsx`
Expected: PASS (all, including the clobber test). Also `pnpm --filter @openldr/studio exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/reports-builder/ReportBuilderPage.tsx apps/studio/src/reports-builder/ReportBuilderPage.test.tsx
git commit -m "fix(studio): guard report builder load effect against post-save refetch clobber"
```

---

## Task 7: Full gate — forced typecheck + suites

- [ ] **Step 1: Forced cross-package typecheck**

Run: `pnpm turbo run typecheck --force`
Expected: all 31 packages pass (the `breakdown` narrow ripples to studio + report-builder + server, all `WidgetQuery` consumers).

- [ ] **Step 2: Run affected suites**

Run:
```bash
pnpm --filter @openldr/dashboards exec vitest run
pnpm --filter @openldr/studio exec vitest run src/reports-builder
```
Expected: dashboards green; studio reports-builder green. (The pre-existing `apps/studio/src/api.test.ts` vitest-dedupe flake is a different file.)

- [ ] **Step 3: Final commit (only if lint/format touch-ups were needed)**

```bash
git add -A
git commit -m "chore(report-builder): P3c-1 safety fixes gate green"
```

---

## Self-Review Notes (verify during execution)

- **Spec coverage:** breakdown narrow (Task 1) · dead chart branch (Task 2) · param id validation (Task 3) · optionsSql error surfacing (Task 4) · delete confirm (Task 5) · clobber guard (Task 6). All six fixes covered.
- **Order:** schema narrow first (cross-package, small); the two `ReportBuilderPage` tasks (5, 6) are sequential on the same file but touch different regions (header/dialog vs load effect + save).
- **Type consistency:** `breakdown?: { key: string }` identical in dashboards schema (Task 1) and studio `api.ts` (Task 1); `loadedIdRef` typed `useRef<string|null>` (Task 6); `optErrors` `Record<string,string>` (Task 4); `invalid` boolean (Task 3).
- **Out of scope:** lint (P3c-2), authoring UX (P3c-3), i18n (P3c-4).
- **Cross-package:** only Task 1 (dashboards schema) — forced typecheck in Task 7 is the guard.
- **Backward compat:** narrowing `breakdown` strips a `grain` no producer emits; the compile path already reads only `.key`.
```
