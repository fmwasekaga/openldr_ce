# Workflow Run History — Master-Detail Redesign (Slice 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Run History detail into a master-detail view — a node table (showing each node's run-time label) over a selected-node detail pane with Output / Result / Logs tabs — with edge-to-edge dividers.

**Architecture:** Record each node's `label` in the run result (tiny engine + API-type change), then rewrite the web `RunDetail` component. No new endpoints.

**Tech Stack:** TypeScript, React, Vitest. Packages: `@openldr/workflows`, `apps/web`.

**Conventions:** Run web tests isolated (`pnpm -C apps/web test`); gate via `pnpm exec turbo typecheck --force`. Edge-to-edge dividers use `@/components/ui/bleed`. Worktree branch → merge to local `main`, not pushed.

---

## File Structure

**Modify:**
- `packages/workflows/src/engine/run-workflow.ts` — record `label` on each `NodeRunResult`.
- `packages/workflows/src/engine/run-workflow.test.ts` — assert `label` is recorded.
- `apps/web/src/api.ts` — add `label?: string` to `NodeRunResult`.
- `apps/web/src/workflows/components/panels/run-history-drawer.tsx` — rewrite `RunDetail` (master-detail) + imports.
- `apps/web/src/workflows/components/panels/run-history-drawer.test.tsx` — rewrite for master-detail.

---

## Task 1: Record the node label in the run result

**Files:**
- Modify: `packages/workflows/src/engine/run-workflow.ts`, `apps/web/src/api.ts`
- Test: `packages/workflows/src/engine/run-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/workflows/src/engine/run-workflow.test.ts` (the file already imports `runWorkflow`):

```typescript
it('records each node label in the run results', async () => {
  const res = await runWorkflow(
    [{ id: 'n1', type: 'action', data: { action: 'log', label: 'My Node', message: 'hi', level: 'log' } }],
    [],
    { onEvent: () => {} },
  );
  expect(res.results[0].label).toBe('My Node');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/workflows test run-workflow.test.ts`
Expected: FAIL — `res.results[0].label` is `undefined` (not recorded).

- [ ] **Step 3: Record the label (engine)**

In `packages/workflows/src/engine/run-workflow.ts`, in the **success** `results.push({ … })` (the object with `nodeId, type, status: 'success', output, meta, durationMs, logs`), add a `label` field:
```typescript
        label: node.data.label as string | undefined,
```
And in the **error** `results.push({ … })` (the object with `nodeId, type, status: 'error', error, durationMs, logs`), add the same line:
```typescript
        label: node.data.label as string | undefined,
```

- [ ] **Step 4: Add `label` to the API + engine result types**

The engine's `NodeRunResult` type (the shape pushed into `results`) must accept `label`. Find the `NodeRunResult` interface/type in `packages/workflows/src/engine/run-workflow.ts` (or wherever `results.push` is typed) and add `label?: string;`. Then in `apps/web/src/api.ts`, add to the `NodeRunResult` interface (~line 966):
```typescript
  label?: string;
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/workflows test run-workflow.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C packages/workflows typecheck` → PASS, then:
```bash
git add packages/workflows/src/engine/run-workflow.ts packages/workflows/src/engine/run-workflow.test.ts apps/web/src/api.ts
git commit -m "feat(workflows): record node label in run results"
```

---

## Task 2: Rewrite RunDetail as master-detail

**Files:**
- Modify: `apps/web/src/workflows/components/panels/run-history-drawer.tsx`
- Test: `apps/web/src/workflows/components/panels/run-history-drawer.test.tsx`

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `apps/web/src/workflows/components/panels/run-history-drawer.test.tsx` with:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunDetail } from './run-history-drawer';

// CodeMirror (JsonView) is awkward in jsdom — render it as a textarea showing the value.
vi.mock('../node-forms/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea data-testid="json" readOnly value={value} />,
}));

const mkRun = (results: unknown[]) => ({
  id: 'r1', triggerSource: 'event' as const, status: 'completed' as const,
  startedAt: '2026-06-30T00:00:00.000Z', finishedAt: '2026-06-30T00:00:01.000Z', error: null,
  result: { status: 'completed', results },
}) as never;

const run = mkRun([
  { nodeId: 'sql-1', label: 'Query batch rows', type: 'action', status: 'success', durationMs: 5,
    output: [{ json: { batchId: 'b1' } }], meta: { persisted: 1 }, logs: [] },
  { nodeId: 'log-1', label: 'Log', type: 'action', status: 'success', durationMs: 0,
    output: [{ json: { ok: true } }], meta: undefined, logs: [{ level: 'log', message: 'batch rows: 1', ts: 1 }] },
]);

describe('RunDetail master-detail', () => {
  it('shows node labels (not just ids) in the table', () => {
    render(<RunDetail run={run} loading={false} />);
    expect(screen.getByText('Query batch rows')).toBeInTheDocument();
    expect(screen.getByText('Log')).toBeInTheDocument();
  });

  it('auto-selects the first node and shows its output', () => {
    render(<RunDetail run={run} loading={false} />);
    const text = screen.getAllByTestId('json').map((v) => (v as HTMLTextAreaElement).value).join('\n');
    expect(text).toContain('batchId');
    expect(text).toContain('b1');
  });

  it('selecting a node shows its output and its logs tab', () => {
    render(<RunDetail run={run} loading={false} />);
    fireEvent.click(screen.getByText('Log'));
    // Output tab (default) shows the Log node output.
    expect(screen.getAllByTestId('json').map((v) => (v as HTMLTextAreaElement).value).join('\n')).toContain('ok');
    // Switch to Logs tab → the node's log line shows.
    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    expect(screen.getByText('batch rows: 1')).toBeInTheDocument();
  });

  it('auto-selects a failed node and its Result tab shows its meta', () => {
    const failRun = mkRun([
      { nodeId: 'a', label: 'Node A', type: 'action', status: 'success', durationMs: 1, output: [{ json: { a: 1 } }], logs: [] },
      { nodeId: 'b', label: 'Node B', type: 'action', status: 'error', durationMs: 1, error: 'boom', output: undefined, meta: { tried: true }, logs: [] },
    ]);
    render(<RunDetail run={failRun} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /result/i }));
    // The default-selected node is the failed one (b), so its meta shows.
    const ta = screen.getByTestId('json') as HTMLTextAreaElement;
    expect(ta.value).toContain('tried');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web test run-history-drawer.test.tsx`
Expected: FAIL — labels not shown / no tabs / no auto-select.

- [ ] **Step 3: Update imports**

In `run-history-drawer.tsx`, change the React import to drop `Fragment` and keep `useEffect, useState`:
```typescript
import { useEffect, useState } from 'react';
```
Add the bleed import near the other UI imports:
```typescript
import { Bleed, Divider } from '@/components/ui/bleed';
```

- [ ] **Step 4: Replace the `RunDetail` function**

Replace the ENTIRE `export function RunDetail(...) { … }` (from `export function RunDetail` to its closing brace) with:

```tsx
export function RunDetail({ run, loading, error }: { run: WorkflowRunSummary; loading: boolean; error?: string }) {
  const exec = asExecuteResponse(run.result);
  const results: NodeRunResult[] = exec?.results ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'output' | 'result' | 'logs'>('output');

  // Reset selection + tab when a different run is opened.
  useEffect(() => {
    setSelectedId(null);
    setTab('output');
  }, [run.id]);

  // Selected node: explicit click, else the first failed node, else the first node.
  const selected =
    results.find((r) => r.nodeId === selectedId) ??
    results.find((r) => r.status === 'error') ??
    results[0] ??
    null;

  const selectedFiles = selected ? outputBinaries(selected.output) : [];
  const selectedLogs: LogEntry[] = selected?.logs ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          {run.status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <XCircle className="h-4 w-4 text-rose-400" />
          )}
          {run.status === 'completed' ? 'Completed' : 'Failed'}
        </span>
        <span>·</span>
        <span>{run.triggerSource}</span>
        <span>·</span>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
      </div>

      {run.error && (
        <div className="border-b border-border bg-rose-500/5 px-4 py-2 font-mono text-[11px] text-rose-400">
          {run.error}
        </div>
      )}

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading detail…</div>
      ) : error ? (
        <div className="p-4 text-sm text-destructive">{error}</div>
      ) : results.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No per-node results recorded.</div>
      ) : (
        <>
          {/* Master: node table (edge-to-edge row rules via Bleed). */}
          <div className="px-4 pt-3">
            <Bleed>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Node</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow
                      key={r.nodeId}
                      className={cn('cursor-pointer', selected?.nodeId === r.nodeId && 'bg-secondary/60')}
                      onClick={() => setSelectedId(r.nodeId)}
                    >
                      <TableCell>
                        <span className="text-foreground">{r.label ?? r.nodeId}</span>
                        {r.label && (
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/50">{r.nodeId}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.type}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                            r.status === 'success'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : r.status === 'skipped'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-rose-500/15 text-rose-400',
                          )}
                          title={r.error ?? ''}
                        >
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{r.durationMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Bleed>
          </div>

          {/* Detail: selected node's data. */}
          {selected && (
            <div className="flex min-h-0 flex-1 flex-col px-4 pt-3">
              <div className="mb-2 text-[11px] font-medium text-foreground">{selected.label ?? selected.nodeId}</div>
              <div className="flex gap-4 text-[11px]">
                {(['output', 'result', 'logs'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      'pb-1.5 capitalize',
                      tab === t
                        ? 'border-b-2 border-violet-500 text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Divider className="mb-2" />
              <div className="min-h-0 flex-1 overflow-auto pb-4">
                {tab === 'output' && (
                  <div className="space-y-2">
                    <JsonView data={selected.output} emptyLabel="No output recorded." />
                    {selectedFiles.map((f) => (
                      <button
                        key={f.field}
                        type="button"
                        onClick={() => void downloadWorkflowArtifact(f.objectKey, f.fileName)}
                        className="inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/10 hover:text-violet-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {f.fileName}
                      </button>
                    ))}
                  </div>
                )}
                {tab === 'result' && <JsonView data={selected.meta} emptyLabel="No result data." />}
                {tab === 'logs' &&
                  (selectedLogs.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground/70">No logs.</p>
                  ) : (
                    <div className="rounded-md bg-[#0a0a0b] px-3 py-2 font-mono text-[11px] leading-relaxed">
                      {selectedLogs.map((entry, i) => (
                        <div
                          key={`${entry.ts}-${i}`}
                          className={cn(
                            'whitespace-pre-wrap break-words py-0.5',
                            entry.level === 'error'
                              ? 'text-rose-400'
                              : entry.level === 'warn'
                                ? 'text-amber-400'
                                : entry.level === 'info'
                                  ? 'text-sky-400'
                                  : 'text-foreground',
                          )}
                        >
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C apps/web test run-history-drawer.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck for unused imports**

Run: `pnpm -C apps/web typecheck`
Expected: PASS. If `Fragment` is reported unused, confirm it was removed from the React import (Step 3). The old global `logs` flatMap variable and the produced-files IIFE are gone (replaced by the per-node detail) — ensure no leftover references remain.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/workflows/components/panels/run-history-drawer.tsx apps/web/src/workflows/components/panels/run-history-drawer.test.tsx
git commit -m "feat(web): Run History master-detail node inspector (labels, tabs, edge-to-edge)"
```

---

## Task 3: Gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm exec turbo typecheck --force`
Expected: PASS (all packages — the `label` field is additive).

- [ ] **Step 2: Run the affected suites**

Run: `pnpm -C packages/workflows test` then `pnpm -C apps/web test` (web isolated — known parallel flake).
Expected: PASS for each.

- [ ] **Step 3: Commit if any incidental fixes were needed**
```bash
git add -A
git commit -m "chore(web): slice 4b run-history redesign — gate green"
```
(Skip if nothing changed.)

---

## Manual verification (after the gate)

Open a workflow → Run History → click a past run. You see a **node table** with readable labels (the synthetic id muted beside each), a selected row, and below it a tabbed **Output / Result / Logs** detail for the selected node — Output showing the node's data (e.g. the Event Trigger's payload incl. `batchId`, the sql-query's rows). A failed node is auto-selected. All dividers (table rules, the table↔detail separator, the tab underline) reach the drawer edges.

---

## Done criteria for Slice 4b

- Each `NodeRunResult` records the node `label` (engine + API type).
- Run History detail is master-detail: node table (labels) + selected-node Output/Result/Logs tabs; failed node auto-selected; dividers edge-to-edge.
- `pnpm exec turbo typecheck --force` and the workflows + web suites are green.
