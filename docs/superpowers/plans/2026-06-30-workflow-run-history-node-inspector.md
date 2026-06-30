# Workflow Run History — Per-Node Inspector (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Run History, let a user expand each node row to see that node's recorded `output` + `meta` (JSON), so event-triggered/historical runs are troubleshootable node-by-node. Also color the `event` source badge.

**Architecture:** Web-only, additive. The per-node data is already in the stored run record (`result.results[].output/meta`); the change displays it. Extract the existing file-local `JsonView` into a shared module so both the live config panel and Run History reuse it.

**Tech Stack:** React + TypeScript + Vitest + @testing-library/react. All changes in `apps/web`.

**Conventions:** Run web tests isolated (`pnpm -C apps/web test`); gate via `pnpm exec turbo typecheck --force`. Work on a worktree branch, merge to local `main`, not pushed.

---

## File Structure

**Create:**
- `apps/web/src/workflows/components/panels/json-view.tsx` — the shared read-only JSON renderer (moved from node-config-panel).
- `apps/web/src/workflows/components/panels/run-history-drawer.test.tsx` — tests for `RunDetail` expansion.

**Modify:**
- `apps/web/src/workflows/components/panels/node-config-panel.tsx` — import `JsonView` from the new module instead of defining it locally.
- `apps/web/src/api.ts` — add `'event'` to `WorkflowRunSummary['triggerSource']`.
- `apps/web/src/workflows/components/panels/run-history-drawer.tsx` — `event` badge color; expandable node rows showing output+meta; export `RunDetail`.

---

## Task 1: Extract `JsonView` into a shared module

**Files:**
- Create: `apps/web/src/workflows/components/panels/json-view.tsx`
- Modify: `apps/web/src/workflows/components/panels/node-config-panel.tsx`

This is a pure refactor (no behavior change); verification is typecheck + existing tests.

- [ ] **Step 1: Create the shared module**

Create `apps/web/src/workflows/components/panels/json-view.tsx` with the exact body moved from `node-config-panel.tsx` (its `CodeEditor` import path is `../node-forms/code-editor`):

```typescript
import { CodeEditor } from '../node-forms/code-editor';

/** Read-only JSON viewer (renders via the CodeMirror editor). Shared by the live
 *  node config panel and the Run History per-node inspector. */
export function JsonView({ data, emptyLabel }: { data: unknown; emptyLabel: string }) {
  if (data === undefined || data === null) {
    return <p className="text-xs text-muted-foreground/70 italic">{emptyLabel}</p>;
  }

  let formatted: string;
  try {
    formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch {
    formatted = String(data);
  }

  return <CodeEditor language="json" value={formatted} onChange={() => {}} readOnly minHeight="8rem" />;
}
```

- [ ] **Step 2: Use it from node-config-panel**

In `apps/web/src/workflows/components/panels/node-config-panel.tsx`:
(a) Delete the local `function JsonView({ data, emptyLabel }) { … }` definition (around line 175-190).
(b) Add an import near the top (with the other panel imports):
```typescript
import { JsonView } from './json-view';
```
(c) If, after deleting the local `JsonView`, the `CodeEditor` import in this file is now unused, remove it (the `node-config-panel` may still use `CodeEditor` elsewhere — only remove if it becomes unused, to avoid a lint/compile warning).

- [ ] **Step 3: Typecheck + existing tests**

Run: `pnpm -C apps/web typecheck` → PASS.
Run: `pnpm -C apps/web test node-config-panel` → PASS (any existing node-config-panel tests; if none match, vitest reports "no test files" which is acceptable — the typecheck covers the refactor).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflows/components/panels/json-view.tsx apps/web/src/workflows/components/panels/node-config-panel.tsx
git commit -m "refactor(web): extract JsonView into a shared panel module"
```

---

## Task 2: Run History per-node inspector + event badge

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/workflows/components/panels/run-history-drawer.tsx`
- Test: `apps/web/src/workflows/components/panels/run-history-drawer.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/components/panels/run-history-drawer.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunDetail } from './run-history-drawer';

// CodeMirror (used by JsonView) is awkward in jsdom — render it as a textarea
// that shows the value so we can assert on the JSON text.
vi.mock('../node-forms/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea data-testid="json" readOnly value={value} />,
}));

const run = {
  id: 'r1',
  triggerSource: 'event' as const,
  status: 'completed' as const,
  startedAt: '2026-06-30T00:00:00.000Z',
  finishedAt: '2026-06-30T00:00:01.000Z',
  error: null,
  result: {
    status: 'completed',
    results: [
      { nodeId: 'sql-1', type: 'action', status: 'success', durationMs: 5,
        output: [{ json: { batchId: 'b1' } }], meta: { persisted: 1 } },
    ],
  },
} as never;

describe('RunDetail per-node inspector', () => {
  it('renders the event trigger source', () => {
    render(<RunDetail run={run} loading={false} />);
    expect(screen.getByText('event')).toBeInTheDocument();
  });

  it('expands a node row to show its output and meta JSON', () => {
    render(<RunDetail run={run} loading={false} />);
    // Collapsed by default — the JSON viewer isn't shown yet.
    expect(screen.queryByTestId('json')).not.toBeInTheDocument();
    // Click the node row to expand.
    fireEvent.click(screen.getByText('sql-1'));
    const viewers = screen.getAllByTestId('json');
    const text = viewers.map((v) => (v as HTMLTextAreaElement).value).join('\n');
    expect(text).toContain('batchId');
    expect(text).toContain('b1');
    expect(text).toContain('persisted');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web test run-history-drawer.test.tsx`
Expected: FAIL — `RunDetail` is not exported / rows don't expand / no JSON viewer.

- [ ] **Step 3: Add `'event'` to the run-summary type**

In `apps/web/src/api.ts`, change the `WorkflowRunSummary.triggerSource` field (line ~1086) to include `'event'`:

```typescript
  triggerSource: 'manual' | 'schedule' | 'webhook' | 'ingest' | 'event';
```

- [ ] **Step 4: Color the event badge**

In `apps/web/src/workflows/components/panels/run-history-drawer.tsx`, add an `event` entry to the `SOURCE_VARIANT` map (now required by the `Record<…triggerSource…>` type):

```typescript
  event: 'border-fuchsia-500/40 text-fuchsia-300',
```

- [ ] **Step 5: Make node rows expandable + export RunDetail**

In `run-history-drawer.tsx`:
(a) Add `Fragment` and `useState` to the React import, and import `JsonView`:
```typescript
import { Fragment, useEffect, useState } from 'react';
```
(the file already imports `useEffect, useState`; add `Fragment`). And near the other imports:
```typescript
import { JsonView } from './json-view';
```
(b) Change the `RunDetail` declaration to be exported:
```typescript
export function RunDetail({ run, loading, error }: { run: WorkflowRunSummary; loading: boolean; error?: string }) {
```
(c) Inside `RunDetail`, add expand state at the top of the function body:
```typescript
  const [expanded, setExpanded] = useState<string | null>(null);
```
(d) In the Nodes `<tbody>`, replace the existing `{results.map((r) => ( <tr key={r.nodeId} …> … </tr> ))}` with a version that makes the row a toggle and renders an expansion row:
```tsx
                  {results.map((r) => (
                    <Fragment key={r.nodeId}>
                      <tr
                        className="cursor-pointer border-t border-border/50 hover:bg-secondary/40"
                        onClick={() => setExpanded(expanded === r.nodeId ? null : r.nodeId)}
                      >
                        <td className="py-1.5 font-mono text-muted-foreground">{r.nodeId}</td>
                        <td className="py-1.5 text-foreground">{r.type}</td>
                        <td className="py-1.5">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
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
                        </td>
                        <td className="py-1.5 text-right font-mono text-muted-foreground">{r.durationMs}ms</td>
                      </tr>
                      {expanded === r.nodeId && (
                        <tr>
                          <td colSpan={4} className="bg-secondary/20 px-2 py-2">
                            <div className="space-y-2">
                              <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Output</p>
                                <JsonView data={r.output} emptyLabel="(no output recorded)" />
                              </div>
                              {r.meta !== undefined && r.meta !== null && (
                                <div>
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Result</p>
                                  <JsonView data={r.meta} emptyLabel="" />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
```
(Leave the global Logs block and Produced-files block unchanged.)

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm -C apps/web test run-history-drawer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS, then:
```bash
git add apps/web/src/api.ts apps/web/src/workflows/components/panels/run-history-drawer.tsx apps/web/src/workflows/components/panels/run-history-drawer.test.tsx
git commit -m "feat(web): per-node output/meta inspector in Run History + event badge"
```

---

## Task 3: Gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm exec turbo typecheck --force`
Expected: PASS (all packages).

- [ ] **Step 2: Run the web suite isolated**

Run: `pnpm -C apps/web test`
Expected: PASS. (Run isolated — the turbo `web#test` is a known parallel flake.)

- [ ] **Step 3: Commit if any incidental fixes were needed**
```bash
git add -A
git commit -m "chore(web): slice 4 run-history inspector — gate green"
```
(Skip if nothing changed.)

---

## Manual verification (after the gate)

With the app running and a prior event-triggered run present: open a workflow → Run History → click a past run → click a node row. It expands to show that node's **Output** (e.g. the Event Trigger node's event payload incl. `batchId`; the sql-query node's queried rows) and **Result/meta** as formatted JSON. The `event` source badge is colored.

---

## Done criteria for Slice 4

- `JsonView` lives in `panels/json-view.tsx` and is used by both the config panel and Run History.
- Run History node rows expand to show recorded `output` + `meta` JSON.
- `WorkflowRunSummary.triggerSource` includes `'event'` and its badge is colored.
- `pnpm exec turbo typecheck --force` and `pnpm -C apps/web test` are green.
