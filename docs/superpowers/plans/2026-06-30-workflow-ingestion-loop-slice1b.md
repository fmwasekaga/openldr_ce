# Workflow Ingestion Loop — Slice 1b (Builder UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Form Validate and Persist Store host nodes drivable from the Workflow Builder UI — render their declarative `config[]` panels, add them to the palette, and show run meta (already free).

**Architecture:** Generalize the existing `PluginNodeForm` into a node-type-agnostic declarative form (`DeclarativeNodeForm`) that matches host descriptors by `id` (no `pluginId` required) and degrades gracefully when there's no descriptor. Route the two host nodes (plus an auto-fallback for any unregistered `action` node) to it, and add two palette templates marked implemented. No backend changes — the descriptors, `forms` resolver, and Output-tab meta view already exist from Slice 1.

**Tech Stack:** React + TypeScript, Vite, Vitest + @testing-library/react, ReactFlow. All changes are in `apps/web`.

**Conventions:** Run web tests isolated — `pnpm -C apps/web test` (the turbo `web#test` is a known parallel flake; never trust a turbo `web#test` red). Frequent commits. Work stays on the worktree branch, merged to local `main` at finish, not pushed.

---

## File Structure

**Modify:**
- `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx` — generalize descriptor matching to host nodes; rename the component to `DeclarativeNodeForm` and keep `PluginNodeForm` as an alias export.
- `apps/web/src/workflows/components/node-forms/plugin-node-form.test.tsx` — add host-node render tests (existing plugin tests stay as the regression guard).
- `apps/web/src/workflows/components/node-forms/index.tsx` — register `form-validate` + `persist-store`; route unregistered `action` nodes to the declarative form.
- `apps/web/src/workflows/constants.ts` — add two palette templates in the Core category.
- `apps/web/src/workflows/components/sidebar.tsx` — add the two template ids to `IMPLEMENTED_TEMPLATE_IDS`.

**Create:**
- `apps/web/src/workflows/components/node-forms/pick-form.test.tsx` — tests for `pickForm` routing.
- `apps/web/src/workflows/components/sidebar-ingestion-nodes.test.tsx` — palette presence test (kept separate from the existing `sidebar.test.tsx` to avoid churn).

---

## Task 1: Generalize the declarative form to host nodes

**Files:**
- Modify: `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx`
- Test: `apps/web/src/workflows/components/node-forms/plugin-node-form.test.tsx`

- [ ] **Step 1: Add the failing host-node tests**

Append these two tests inside the existing `plugin-node-form.test.tsx` (it already mocks `@/api`, `./code-editor`, and `@/components/ui/select`). Add an import for `DeclarativeNodeForm` at the top alongside the existing `PluginNodeForm` import:

```typescript
import { PluginNodeForm, DeclarativeNodeForm } from './plugin-node-form';
```

Then append, after the existing `describe('PluginNodeForm', …)` block:

```typescript
const hostDescriptor = {
  id: 'form-validate', source: 'host', label: 'Form Validate', kind: 'transform',
  description: '', ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] },
  capabilities: [], config: [{ key: 'formId', label: 'Form', type: 'select', required: true, optionsSource: 'forms' }],
};
const hostNode = { id: 'h1', type: 'action', data: { label: 'Form Validate', action: 'form-validate', templateId: 'form-validate', config: {} } } as never;

describe('DeclarativeNodeForm (host nodes)', () => {
  it('matches a host descriptor by id and renders its config with resolved options', async () => {
    (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([hostDescriptor]);
    (api.fetchNodeOptions as ReturnType<typeof vi.fn>).mockResolvedValue([{ value: 'form-1', label: 'AMR Result' }]);
    render(<DeclarativeNodeForm node={hostNode} update={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Form')).toBeInTheDocument());
    expect(api.fetchNodeOptions).toHaveBeenCalledWith('forms', undefined);
    await screen.findByRole('option', { name: 'AMR Result' });
  });

  it('writes config.formId when the select changes', async () => {
    (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([hostDescriptor]);
    (api.fetchNodeOptions as ReturnType<typeof vi.fn>).mockResolvedValue([{ value: 'form-1', label: 'AMR Result' }]);
    const update = vi.fn();
    render(<DeclarativeNodeForm node={hostNode} update={update} />);
    const select = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: 'AMR Result' });
    fireEvent.change(select, { target: { value: 'form-1' } });
    await waitFor(() => {
      const call = update.mock.calls.find(([arg]) => (arg as { config?: Record<string, unknown> }).config?.formId === 'form-1');
      expect(call).toBeTruthy();
    });
  });

  it('renders label-only without an error when no descriptor matches a host node', async () => {
    (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<DeclarativeNodeForm node={hostNode} update={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Label')).toBeInTheDocument());
    expect(screen.queryByText(/no longer installed/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C apps/web test plugin-node-form.test.tsx`
Expected: FAIL — `DeclarativeNodeForm` is not exported; host descriptor not matched.

- [ ] **Step 3: Generalize the component**

In `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx`:

(a) Rename the exported function `PluginNodeForm` to `DeclarativeNodeForm`, and add an alias export at the end of the file so existing imports keep working:

```typescript
/** Back-compat alias — plugin nodes route here too. */
export const PluginNodeForm = DeclarativeNodeForm;
```

(b) Widen the `data` cast to include host-node fields, and generalize the descriptor-matching `useEffect`. Replace the current `data` declaration and `useEffect` body with:

```typescript
  const data = node.data as {
    label?: string;
    pluginId?: string;
    nodeId?: string;
    action?: string;
    templateId?: string;
    config?: Record<string, unknown>;
  };
  const config = data.config ?? {};
  const [fields, setFields] = useState<WorkflowNodeConfigField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlugin = Boolean(data.pluginId);
  const hostId = data.action ?? data.templateId ?? data.nodeId;

  useEffect(() => {
    void fetchWorkflowNodes()
      .then((nodes) => {
        const match = isPlugin
          ? nodes.find(
              (n) =>
                n.pluginId === data.pluginId &&
                (n.id === `${data.pluginId}:${data.nodeId}` || n.id === data.nodeId),
            )
          : nodes.find((n) => n.source === 'host' && n.id === hostId);
        if (!match) {
          // Plugin nodes whose plugin was uninstalled show a warning; host nodes
          // with no declarative config simply render label-only.
          if (isPlugin) setError('This plugin node is no longer installed.');
          setFields([]);
          return;
        }
        setFields(match.config);
      })
      .catch(() => {
        if (isPlugin) setError('Could not load node configuration.');
        setFields([]);
      });
  }, [data.pluginId, data.nodeId, isPlugin, hostId]);
```

(Leave the rest of the component — the `setField`, the JSX, and the `PluginField` child — unchanged. `pluginId={data.pluginId}` stays; it is `undefined` for host nodes, which makes `fetchNodeOptions(source, undefined)` omit the `pluginId` query param.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/web test plugin-node-form.test.tsx`
Expected: PASS — both the original plugin tests and the three new host-node tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/workflows/components/node-forms/plugin-node-form.tsx apps/web/src/workflows/components/node-forms/plugin-node-form.test.tsx
git commit -m "feat(web): generalize PluginNodeForm into DeclarativeNodeForm (host nodes)"
```

---

## Task 2: Route host nodes + auto-fallback in pickForm

**Files:**
- Modify: `apps/web/src/workflows/components/node-forms/index.tsx`
- Test: `apps/web/src/workflows/components/node-forms/pick-form.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/components/node-forms/pick-form.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickForm } from './index';
import { DeclarativeNodeForm } from './plugin-node-form';
import { SqlForm } from './sql-form';
import { DefaultForm } from './default-form';

const mk = (data: Record<string, unknown>, type = 'action') => ({ id: 'n', type, data }) as never;

describe('pickForm routing', () => {
  it('routes form-validate to the declarative form', () => {
    expect(pickForm(mk({ templateId: 'form-validate', action: 'form-validate' }))).toBe(DeclarativeNodeForm);
  });

  it('routes persist-store to the declarative form', () => {
    expect(pickForm(mk({ templateId: 'persist-store', action: 'persist-store' }))).toBe(DeclarativeNodeForm);
  });

  it('still routes a registered host node to its bespoke form', () => {
    expect(pickForm(mk({ templateId: 'sql-query' }))).toBe(SqlForm);
  });

  it('falls back to the declarative form for an unregistered action node', () => {
    expect(pickForm(mk({ templateId: 'some-future-host-node', action: 'some-future-host-node' }))).toBe(DeclarativeNodeForm);
  });

  it('falls back to DefaultForm for an unregistered non-action node', () => {
    expect(pickForm(mk({ templateId: 'mystery' }, 'mystery'))).toBe(DefaultForm);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/web test pick-form.test.tsx`
Expected: FAIL — `form-validate`/`persist-store` not registered; unregistered action node returns `DefaultForm`.

- [ ] **Step 3: Register the nodes and add the fallback**

In `apps/web/src/workflows/components/node-forms/index.tsx`:

(a) Update the import to bring in the declarative form by its new name:

```typescript
import { DeclarativeNodeForm } from './plugin-node-form';
```

(b) In the `FORMS` registry object, replace the `'plugin-node': PluginNodeForm,` entry with these three entries:

```typescript
  'plugin-node': DeclarativeNodeForm,
  'form-validate': DeclarativeNodeForm,
  'persist-store': DeclarativeNodeForm,
```

(c) In `pickForm`, replace the final `return DefaultForm;` with an action-node fallback:

```typescript
  if (node.type === 'plugin-node') return DeclarativeNodeForm;

  // Any unregistered host action node renders its descriptor config[] declaratively
  // (and degrades to label-only if it has none).
  if (node.type === 'action') return DeclarativeNodeForm;

  return DefaultForm;
```

(Keep the existing heuristic branches above this — `code`, `webhook`, `loop`, `data.action === 'log'` — unchanged. Remove the now-duplicated `if (node.type === 'plugin-node') return PluginNodeForm;` line if present, since it's replaced by the `DeclarativeNodeForm` version above.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C apps/web test pick-form.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing node-config-panel + plugin-node tests for regressions**

Run: `pnpm -C apps/web test plugin-node-form.test.tsx node-config-panel`
Expected: PASS (no regression in plugin-node rendering or the panel).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS, then:

```bash
git add apps/web/src/workflows/components/node-forms/index.tsx apps/web/src/workflows/components/node-forms/pick-form.test.tsx
git commit -m "feat(web): route Form Validate + Persist Store to the declarative form"
```

---

## Task 3: Add palette entries + mark implemented

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Modify: `apps/web/src/workflows/components/sidebar.tsx`
- Test: `apps/web/src/workflows/components/sidebar-ingestion-nodes.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/workflows/components/sidebar-ingestion-nodes.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sidebar } from './sidebar';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof api>()), fetchWorkflowNodes: vi.fn() }));

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('Sidebar — ingestion nodes', () => {
  it('shows Form Validate and Persist Store as draggable palette items', async () => {
    render(<Sidebar />);
    const coreHeader = await screen.findByText('Core');
    fireEvent.click(coreHeader.closest('button')!);

    const formValidate = await screen.findByText('Form Validate');
    const persistStore = await screen.findByText('Persist Store');

    // Draggable card is not aria-disabled (i.e. it's "implemented", not "coming soon").
    expect(formValidate.closest('[draggable]')).toHaveAttribute('draggable', 'true');
    expect(persistStore.closest('[draggable]')).toHaveAttribute('draggable', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C apps/web test sidebar-ingestion-nodes.test.tsx`
Expected: FAIL — the two templates don't exist in the palette yet.

- [ ] **Step 3: Add the palette templates**

In `apps/web/src/workflows/constants.ts`, find the `Core` category's `items` array (it contains `node('materialize-dataset', …)` and `node('export-artifact', …)`). Add these two entries immediately after `materialize-dataset` (matching the existing `node(...)` call style — `node(id, type, label, lucideIcon, description, opts)`):

```typescript
      node('form-validate', 'action', 'Form Validate', 'ClipboardCheck', 'Validate items against a form → FHIR resources', {
        keywords: ['form', 'validate', 'fhir', 'ingest'],
        data: { action: 'form-validate', config: {} },
      }),
      node('persist-store', 'action', 'Persist Store', 'Database', 'Persist FHIR resources and emit data.persisted', {
        keywords: ['persist', 'save', 'fhir', 'store', 'sink'],
        data: { action: 'persist-store', config: {} },
      }),
```

(If `ClipboardCheck` or `Database` is not already imported/resolvable by the sidebar's `resolveLucideIcon`, any valid lucide-react icon name works — these are both standard lucide icons, so no import change is needed; icons are resolved by name at render.)

- [ ] **Step 4: Mark the templates implemented**

In `apps/web/src/workflows/components/sidebar.tsx`, find the `IMPLEMENTED_TEMPLATE_IDS` set (a `Set<string>` of template ids that gates whether a card is draggable). Add the two ids to it:

```typescript
  'form-validate',
  'persist-store',
```

(Add them as entries in the existing `new Set([...])` literal — match the surrounding formatting.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C apps/web test sidebar-ingestion-nodes.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS, then:

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/sidebar.tsx apps/web/src/workflows/components/sidebar-ingestion-nodes.test.tsx
git commit -m "feat(web): add Form Validate + Persist Store to the builder palette"
```

---

## Task 4: Gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm exec turbo typecheck --force`
Expected: PASS (all packages). `--force` is a turbo flag (do NOT use `pnpm typecheck -- --force`, which forwards `--force` to `tsc` and fails).

- [ ] **Step 2: Run the web test suite isolated**

Run: `pnpm -C apps/web test`
Expected: PASS. (Run web isolated — the turbo `web#test` is a known parallel flake; this is the authoritative result.)

- [ ] **Step 3: Commit if any incidental fixes were needed**

```bash
git add -A
git commit -m "chore(web): slice 1b builder UI — gate green"
```

(If nothing changed, skip.)

---

## Manual verification (after the gate)

Not a code step — for the human/driver. With a published form present: open the builder, drag **Manual Trigger → Code/Convert (produce items shaped like form answers) → Form Validate (pick the form) → Persist Store**, run, and confirm the Output tab shows Form Validate's `meta` (validated/invalid) and Persist Store's `meta` (persisted count), and rows land in the store.

---

## Done criteria for Slice 1b

- `DeclarativeNodeForm` renders host nodes' descriptor `config[]` (and plugin nodes unchanged).
- `pickForm` routes `form-validate`/`persist-store` (and any unregistered `action` node) to it.
- Both nodes appear in the palette as draggable items.
- `pnpm exec turbo typecheck --force` and `pnpm -C apps/web test` are green.
