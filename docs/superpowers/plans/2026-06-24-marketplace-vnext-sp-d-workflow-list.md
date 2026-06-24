# SP-D — Workflow List/Index Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an n8n-style workflow **list/index page** at `/workflows` (list, open, new, rename, duplicate, delete saved workflow designs) and move the builder to `/workflows/:id` (+ `/workflows/new`), so you can manage and switch between designs instead of dropping straight into a single blank builder.

**Architecture:** Web-only. The backend CRUD already exists (`fetchWorkflows`/`fetchWorkflow`/`createWorkflow`/`updateWorkflow`/`deleteWorkflow` in `apps/web/src/api.ts`; server routes in `apps/server/src/workflows-routes.ts`). We add a `WorkflowList` page, make the existing builder (`workflows/page.tsx`) load the workflow named by a `:id` route param (it currently always starts blank), and split the routes in `App.tsx`. The workflow-builder subsystem uses literal English strings (not i18n) — we match that convention here.

**Tech Stack:** React + react-router-dom, zustand workflow store, shadcn `Table`/`Button`/`Dialog`/`Input`/`ConfirmDialog`, Vitest + Testing Library.

---

## Reference (verified)

- Builder page: `apps/web/src/workflows/page.tsx` (`Workflows` component). Today it never loads an existing workflow — the store starts `workflowId: null` and the first save creates one.
- Store: `apps/web/src/workflows/hooks/use-workflow-store.ts` — `setWorkflow(id, name, nodes, edges)` (line ~148), `reset()` (line ~159, sets `workflowId: null`), `workflowName`, `workflowId`.
- API client (`apps/web/src/api.ts`): `Workflow` interface (~1031) with `{ id, name, description, definition: { nodes, edges }, enabled, createdBy, createdAt, updatedAt }`; `fetchWorkflows()` (~1076), `fetchWorkflow(id)` (~1082), `createWorkflow(body)` (~1088), `updateWorkflow(id, body)` (~1096), `deleteWorkflow(id)` (~1104). `body` is `Omit<Workflow,'createdAt'|'updatedAt'>`.
- Serializer: `apps/web/src/workflows/lib/serializer.ts` — `deserializeWorkflow(def)` returns `{ nodes, edges }` (definition is already ReactFlow shape).
- Route today: `App.tsx:34` — `<Route path="/workflows" element={<RequireRole roles={['lab_admin','lab_manager']}><Workflows /></RequireRole>} />`, import at `App.tsx:22`.
- Run-history already exists (`RunHistoryDrawer`) — NOT part of this work.

## File Structure

- **Create** `apps/web/src/workflows/WorkflowList.tsx` — the list/index page.
- **Create** `apps/web/src/workflows/WorkflowList.test.tsx` — list page test.
- **Modify** `apps/web/src/workflows/page.tsx` — load the `:id` workflow into the store on mount (or reset for `new`); add a "← Workflows" back link.
- **Modify** `apps/web/src/workflows/page.test.tsx` (create if absent) — load-by-id test.
- **Modify** `apps/web/src/App.tsx` — split routes: `/workflows` → list; `/workflows/new` + `/workflows/:id` → builder.

---

### Task 1: `WorkflowList` page (TDD)

**Files:**
- Create: `apps/web/src/workflows/WorkflowList.tsx`
- Test: `apps/web/src/workflows/WorkflowList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/WorkflowList.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, fetchWorkflows: vi.fn(), createWorkflow: vi.fn(), deleteWorkflow: vi.fn() };
});
import * as api from '@/api';
import { WorkflowList } from './WorkflowList';

const wf = (over = {}) => ({ id: 'wf_1', name: 'AMR sync', description: null, definition: { nodes: [], edges: [] }, enabled: true, createdBy: null, createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  (api.fetchWorkflows as any).mockResolvedValue([wf()]);
});

describe('WorkflowList', () => {
  it('lists workflows', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    expect(await screen.findByText('AMR sync')).toBeTruthy();
  });

  it('navigates to the builder for a new workflow', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('workflow-new'));
    expect(navigateMock).toHaveBeenCalledWith('/workflows/new');
  });

  it('opens a workflow in the builder', async () => {
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('open-wf_1'));
    expect(navigateMock).toHaveBeenCalledWith('/workflows/wf_1');
  });

  it('duplicates a workflow', async () => {
    (api.createWorkflow as any).mockResolvedValue(wf({ id: 'wf_2', name: 'AMR sync (copy)' }));
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('duplicate-wf_1'));
    await waitFor(() => expect(api.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ name: 'AMR sync (copy)' })));
  });

  it('deletes a workflow after confirm', async () => {
    (api.deleteWorkflow as any).mockResolvedValue(undefined);
    render(<MemoryRouter><WorkflowList /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('delete-wf_1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteWorkflow).toHaveBeenCalledWith('wf_1'));
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `pnpm -C apps/web test WorkflowList`
Expected: FAIL — `Cannot find module './WorkflowList'`.

- [ ] **Step 3: Implement `WorkflowList.tsx`**
```typescript
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchWorkflows, createWorkflow, deleteWorkflow, type Workflow } from '@/api';

function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function WorkflowList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Workflow[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchWorkflows()); }
    catch (e) { toast.error(`Failed to load workflows: ${e instanceof Error ? e.message : String(e)}`); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onDuplicate = useCallback(async (w: Workflow) => {
    try {
      await createWorkflow({
        id: newWorkflowId(), name: `${w.name} (copy)`, description: w.description,
        definition: w.definition, enabled: w.enabled, createdBy: null,
      });
      toast.success(`Duplicated ${w.name}`);
      await load();
    } catch (e) { toast.error(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [load]);

  const onDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const w = pendingDelete; setPendingDelete(null);
    try { await deleteWorkflow(w.id); await load(); }
    catch (e) { toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [pendingDelete, load]);

  return (
    <AppShell title="Workflows" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="workflow-list">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Workflows</h1>
          <Button data-testid="workflow-new" onClick={() => navigate('/workflows/new')}>New workflow</Button>
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No workflows yet. Create one to get started.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((w) => (
                <TableRow key={w.id} data-testid={`workflow-row-${w.id}`}>
                  <TableCell>
                    <button className="font-medium text-primary hover:underline" data-testid={`open-${w.id}`} onClick={() => navigate(`/workflows/${w.id}`)}>{w.name}</button>
                  </TableCell>
                  <TableCell><Badge variant={w.enabled ? 'default' : 'outline'}>{w.enabled ? 'Enabled' : 'Disabled'}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(w.updatedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" data-testid={`open-btn-${w.id}`} onClick={() => navigate(`/workflows/${w.id}`)}>Open</Button>
                      <Button variant="outline" size="sm" data-testid={`duplicate-${w.id}`} onClick={() => void onDuplicate(w)}>Duplicate</Button>
                      <Button variant="ghost" size="sm" data-testid={`delete-${w.id}`} onClick={() => setPendingDelete(w)}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        description="This permanently deletes the workflow design."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { void onDelete(); }}
      />
    </AppShell>
  );
}
```
Note: rename is handled in the builder (the name field there) — the list keeps open/new/duplicate/delete to stay focused. (If inline rename is wanted later, add a small dialog calling `updateWorkflow`.)

- [ ] **Step 4: Run the test, make it PASS**

Run: `pnpm -C apps/web test WorkflowList`
Expected: 5/5 PASS. (If `ConfirmDialog`'s action button text differs, match the repo's other ConfirmDialog tests — the action label is the `confirmLabel`, "Delete".)

- [ ] **Step 5: typecheck + commit**
```bash
pnpm -C apps/web typecheck
git add apps/web/src/workflows/WorkflowList.tsx apps/web/src/workflows/WorkflowList.test.tsx
git commit -m "feat(web): workflow list/index page (SP-D)"
```

---

### Task 2: Builder loads the `:id` workflow (TDD)

**Files:**
- Modify: `apps/web/src/workflows/page.tsx`
- Test: `apps/web/src/workflows/page.test.tsx` (create)

The builder must load the workflow named by the route param. `/workflows/new` (or no id) = blank.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/page.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, fetchWorkflow: vi.fn() };
});
// Spy on the store's setWorkflow without rendering the full canvas heavy deps.
const setWorkflow = vi.fn();
const reset = vi.fn();
vi.mock('./hooks/use-workflow-store', () => ({
  useWorkflowStore: (sel?: (s: any) => unknown) => {
    const state = { configNodeId: null, workflowId: null, setWorkflow, reset };
    return sel ? sel(state) : state;
  },
}));
vi.mock('./hooks/use-workflow-api', () => ({ useWorkflowApi: () => ({ save: vi.fn(), execute: vi.fn(), fireTrigger: vi.fn(), saving: false, executing: false, lastExecution: null }) }));
// Stub the heavy canvas/panel children so the page mounts in jsdom.
vi.mock('./components/canvas', () => ({ Canvas: () => null }));
vi.mock('./components/sidebar', () => ({ Sidebar: () => null }));
vi.mock('./components/panels/node-config-panel', () => ({ NodeConfigPanel: () => null }));
vi.mock('./components/panels/toolbar', () => ({ Toolbar: () => null }));
vi.mock('./components/panels/execution-panel', () => ({ ExecutionPanel: () => null }));
vi.mock('./components/panels/run-history-drawer', () => ({ RunHistoryDrawer: () => null }));
vi.mock('./components/panels/datasets-drawer', () => ({ DatasetsDrawer: () => null }));

import * as api from '@/api';
import { Workflows } from './page';

const wf = { id: 'wf_1', name: 'AMR sync', description: null, definition: { nodes: [{ id: 'n1' }], edges: [] }, enabled: true, createdBy: null, createdAt: '', updatedAt: '' };

beforeEach(() => { vi.clearAllMocks(); (api.fetchWorkflow as any).mockResolvedValue(wf); });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workflows/new" element={<Workflows />} />
        <Route path="/workflows/:id" element={<Workflows />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Workflows builder', () => {
  it('loads the workflow named by :id into the store', async () => {
    renderAt('/workflows/wf_1');
    await waitFor(() => expect(api.fetchWorkflow).toHaveBeenCalledWith('wf_1'));
    await waitFor(() => expect(setWorkflow).toHaveBeenCalledWith('wf_1', 'AMR sync', wf.definition.nodes, wf.definition.edges));
  });

  it('starts blank for /workflows/new (resets, no fetch)', async () => {
    renderAt('/workflows/new');
    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(api.fetchWorkflow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `pnpm -C apps/web test workflows/page`
Expected: FAIL — the page doesn't read the route param / call fetchWorkflow/reset yet.

- [ ] **Step 3: Implement the load in `page.tsx`**

Add imports at the top of `apps/web/src/workflows/page.tsx`:
```typescript
import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchWorkflow } from '@/api';
```
(Keep the existing `useState` import — merge into one `import { useEffect, useState } from 'react'`.)

Inside `Workflows()`, after the existing hooks (e.g. after `const workflowId = useWorkflowStore(...)`), add:
```typescript
  const { id } = useParams();
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const reset = useWorkflowStore((s) => s.reset);

  useEffect(() => {
    if (!id || id === 'new') { reset(); return; }
    let active = true;
    void fetchWorkflow(id)
      .then((w) => { if (active) setWorkflow(w.id, w.name, w.definition.nodes, w.definition.edges); })
      .catch(() => { /* a missing id just leaves a blank builder; save will create one */ });
    return () => { active = false; };
  }, [id, setWorkflow, reset]);
```
Note: the `Workflow.definition` type in api.ts is `{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }` (already ReactFlow shape — no transform needed; `deserializeWorkflow` is the identity over `{nodes,edges}`). If TypeScript complains that `definition.nodes`/`edges` aren't the store's node/edge types, cast via the existing types: `setWorkflow(w.id, w.name, w.definition.nodes as WorkflowNode[], w.definition.edges as WorkflowEdge[])` and import `type { WorkflowNode, WorkflowEdge } from './lib/types'`.

Add a back-to-list link in the header. In the `<Toolbar ... />` area or just above it, add a small link (the Toolbar is mocked in tests, so put the link directly in the page JSX, e.g. right inside the outer `<div className="flex h-full flex-col">` before `<Toolbar`):
```tsx
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <Link to="/workflows" className="text-xs text-muted-foreground hover:text-foreground hover:underline" data-testid="back-to-workflows">← Workflows</Link>
          </div>
```

- [ ] **Step 4: Run the test, make it PASS**

Run: `pnpm -C apps/web test workflows/page`
Expected: 2/2 PASS.

- [ ] **Step 5: typecheck + commit**
```bash
pnpm -C apps/web typecheck
git add apps/web/src/workflows/page.tsx apps/web/src/workflows/page.test.tsx
git commit -m "feat(web): builder loads workflow by :id route param (SP-D)"
```

---

### Task 3: Split the routes in `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx` (import ~line 22; route ~line 34)

- [ ] **Step 1: Add the list import**

After the existing `import { Workflows } from './workflows/page';` (line 22), add:
```typescript
import { WorkflowList } from './workflows/WorkflowList';
```

- [ ] **Step 2: Replace the single route with three**

Replace line 34:
```tsx
      <Route path="/workflows" element={<RequireRole roles={['lab_admin', 'lab_manager']}><Workflows /></RequireRole>} />
```
with:
```tsx
      <Route path="/workflows" element={<RequireRole roles={['lab_admin', 'lab_manager']}><WorkflowList /></RequireRole>} />
      <Route path="/workflows/new" element={<RequireRole roles={['lab_admin', 'lab_manager']}><Workflows /></RequireRole>} />
      <Route path="/workflows/:id" element={<RequireRole roles={['lab_admin', 'lab_manager']}><Workflows /></RequireRole>} />
```

- [ ] **Step 3: Verify nav still points at `/workflows`**

The main nav links to `/workflows` (now the list) — that's correct, no nav change needed. Grep to confirm nothing deep-links into the builder expecting a blank page: `git grep -n "to=\"/workflows\"\|navigate('/workflows')" apps/web/src` — the nav entry to `/workflows` is right (lands on the list).

- [ ] **Step 4: typecheck + full web test**

Run: `pnpm -C apps/web typecheck` (PASS) and `pnpm -C apps/web test workflows` (WorkflowList + page green).

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): route /workflows -> list, /workflows/:id + /new -> builder (SP-D)"
```

---

### Task 4: Full gate + finish

- [ ] **Step 1: Full gate**
```bash
pnpm turbo run typecheck lint test build
```
All green. If `@openldr/web#test` shows the known turbo parallel flake, re-run isolated: `pnpm -C apps/web test` and trust that.

- [ ] **Step 2: Finish the branch** — `superpowers:finishing-a-development-branch`: merge `feat/workflow-list-sp-d` to **local `main`** (ff/clean), do NOT push, remove the branch. Re-run the gate on `main`.

- [ ] **Step 3: Update memory** — `workflow-builder-workstream` + the marketplace/extensibility umbrella note: SP-D done (workflow list at `/workflows`, builder at `/workflows/:id`), the documented "no list page" gap is closed.

---

## Self-Review

**Spec coverage (SP-D section of the design):** list page at `/workflows` (open/new/rename/duplicate/delete) — Task 1 (rename deferred to the builder's name field, noted); builder at `/workflows/:id` + `/new` — Tasks 2+3; reuses existing CRUD + run-history, no backend — confirmed (no server task); role-gated as today — Task 3 keeps `RequireRole roles={['lab_admin','lab_manager']}`. ✅

**Placeholder scan:** complete code in every step; the one "if TS complains, cast" note is a concrete conditional with the exact cast shown, not a placeholder. No TBD/TODO.

**Type consistency:** `Workflow` shape (`definition.nodes/edges`) used in Tasks 1+2 matches api.ts; `setWorkflow(id,name,nodes,edges)` / `reset()` match the store; `newWorkflowId()` mirrors the existing one in `use-workflow-api.ts`. Test data-testids (`workflow-new`, `open-<id>`, `duplicate-<id>`, `delete-<id>`, `back-to-workflows`) are consistent between component and tests.

**Note:** workflow-builder subsystem uses literal English (not i18n); this plan matches that — no i18n keys added (consistent, avoids scope creep).
