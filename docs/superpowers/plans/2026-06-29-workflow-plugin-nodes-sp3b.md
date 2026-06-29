# Plugin-contributed Workflow Nodes — SP-3b (Builder Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make plugin-contributed workflow nodes usable in the builder UI — a "Plugins" palette category (grouped by plugin), a generic declarative config-form renderer, the real `optionsSource` resolver registry, a `plugin-node` ReactFlow node, and the SP-3a-deferred web template/sample updates.

**Architecture:** Mostly `apps/web` + one real server route (`GET /api/workflows/node-options/:source`). Saved plugin node carries `{ pluginId, nodeId, kind, config }` (the SP-2/SP-3a engine contract). The config-form fetches `GET /api/workflows/nodes` (SP-1) and looks up its descriptor by `pluginId:nodeId`; select/multiselect `optionsSource` fields fetch `node-options/:source`.

**Tech Stack:** React 18 + @xyflow/react 12, Fastify, Vitest, pnpm/turbo, dependency-cruiser.

**Commits:** Work stays **uncommitted** by convention — do **NOT** `git commit`/`git push`. Each task ends with a verification step.

> **Web test flake:** `@openldr/web` has a known parallel flake under turbo. Run web tests in **isolation** (`pnpm -C apps/web test ...`); never trust a turbo `web#test` red.

---

## Decisions (locked in the SP-3 brainstorm — do not relitigate)
- Palette = ONE "Plugins" category, grouped by plugin name.
- Config-form FETCHES `/api/workflows/nodes` and looks up its descriptor by `pluginId:nodeId` (saved node stores only `{pluginId,nodeId,kind,config}`).
- optionsSource resolvers: `connectors`, `datasets`, `dhis2-mappings`, `fhir-resource-types`.
- `plugin-node` is its own ReactFlow node type with variable handles by `kind` (source = no input, sink = no output).

---

## File Structure

**Server:**
- `apps/server/src/workflows-node-options.ts` (new) — the resolver registry (pure-ish, testable).
- `apps/server/src/workflows-routes.ts` (modify) — accept a `connectors` dep; wire the real `node-options/:source`.
- `apps/server/src/app.ts` (modify) — pass `{ connectors: createConnectorStore(ctx.internalDb) }` to `registerWorkflowRoutes`.
- `apps/server/src/workflows-routes.test.ts` (modify) — `fakeCtx` + node-options tests.

**Web:**
- `apps/web/src/api.ts` (modify) — `WorkflowNodeDescriptor`/`WorkflowNodeConfigField`/`WorkflowNodeOption` types + `fetchWorkflowNodes()` + `fetchNodeOptions(source)`.
- `apps/web/src/workflows/components/node-types/plugin-node.tsx` (new) + `node-types/index.ts` (modify) — the canvas node.
- `apps/web/src/workflows/components/sidebar.tsx` (modify) — fetch plugin nodes, append a "Plugins" category, drag wiring, draggable gate.
- `apps/web/src/workflows/components/node-forms/plugin-node-form.tsx` (new) + `node-forms/index.tsx` (modify) — the generic config form + `pickForm` wiring.
- `apps/web/src/workflows/components/node-forms/shared.tsx` (modify) — fix the `ExpressionInput` hint to `{{ $json.foo }}`.
- `apps/web/src/workflows/lib/sample-workflow.ts` (modify) — `$input` → `$json`/`$items` (SP-3a-deferred web bit).
- Tests: `plugin-node-form.test.tsx` (new), `workflows-node-options` covered by the server route test.

---

## Task 1: Server `optionsSource` resolver registry

**Files:** Create `apps/server/src/workflows-node-options.ts` + test via the route in Task 2.

- [ ] **Step 1: Implement the registry**

```ts
// apps/server/src/workflows-node-options.ts
/** An optionsSource resolver returns selectable {value,label} options for a config select. */
export interface NodeOption { value: string; label: string }

export interface NodeOptionsDeps {
  connectors: { list(): Promise<Array<{ id: string; name: string }>> };
  datasets: { list(): Promise<Array<{ name: string }>> };
  /** dhis2-sink mappings from plugin_data (id/name). */
  dhis2Mappings(): Promise<Array<{ id: string; name: string }>>;
}

/** Static FHIR resource types offered to source-node selects. */
export const FHIR_RESOURCE_TYPES = [
  'Patient', 'Observation', 'Condition', 'Encounter', 'Specimen',
  'DiagnosticReport', 'Organization', 'Location', 'Practitioner', 'ServiceRequest',
];

/** Resolve a named optionsSource to options. Unknown source → []. Never throws (best-effort). */
export async function resolveNodeOptions(source: string, deps: NodeOptionsDeps): Promise<NodeOption[]> {
  try {
    switch (source) {
      case 'connectors':
        return (await deps.connectors.list()).map((c) => ({ value: c.id, label: c.name }));
      case 'datasets':
        return (await deps.datasets.list()).map((d) => ({ value: d.name, label: d.name }));
      case 'dhis2-mappings':
        return (await deps.dhis2Mappings()).map((m) => ({ value: m.id, label: m.name }));
      case 'fhir-resource-types':
        return FHIR_RESOURCE_TYPES.map((t) => ({ value: t, label: t }));
      default:
        return [];
    }
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**: `pnpm -C apps/server exec tsc --noEmit` → PASS.

---

## Task 2: Wire the real `node-options/:source` route

**Files:** Modify `workflows-routes.ts`, `app.ts`, `workflows-routes.test.ts`.

- [ ] **Step 1: Write the failing tests** — in `workflows-routes.test.ts`:
  - Extend `fakeCtx` so the route deps resolve. The connectors store is passed as a route dep (Step 3), so add a `connectors` stub to the test's deps object (see Step 4). `ctx.workflows.datasets.list` and `ctx.pluginData.list` already exist in the fake.
  - Add tests:
    - `GET /api/workflows/node-options/fhir-resource-types` → 200, array containing `{value:'Patient',label:'Patient'}`.
    - `GET /api/workflows/node-options/connectors` → 200, maps the stub connector list to `{value,label}`.
    - `GET /api/workflows/node-options/unknown-source` → 200, `[]`.
    - technician → 403 (MANAGE-gated).

```ts
// inside the existing describe, mirroring the file's app-setup pattern:
it('GET /api/workflows/node-options/:source resolves fhir-resource-types', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = USER; });
  const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [{ id: 'c1', name: 'DHIS2 Demo' }] } });
  const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/fhir-resource-types' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual(expect.arrayContaining([{ value: 'Patient', label: 'Patient' }]));
});
it('GET /api/workflows/node-options/connectors maps the connector list', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = USER; });
  const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [{ id: 'c1', name: 'DHIS2 Demo' }] } });
  const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors' });
  expect(res.json()).toEqual([{ value: 'c1', label: 'DHIS2 Demo' }]);
});
it('GET /api/workflows/node-options/:source is role-gated (technician 403)', async () => {
  const app = Fastify(); app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
  const ctx = fakeCtx(); registerWorkflowRoutes(app, ctx, { connectors: { list: async () => [] } });
  const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors' });
  expect(res.statusCode).toBe(403);
});
```
(If `TECHNICIAN_USER` isn't already in the file, reuse the role-gate fixture the existing `/nodes` 403 test uses.)

- [ ] **Step 2: Run → fail**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`.

- [ ] **Step 3: Implement** — `workflows-routes.ts`:
  - import: `import { resolveNodeOptions } from './workflows-node-options';`
  - Change the signature to accept an optional deps object with `connectors`:
```ts
export function registerWorkflowRoutes(
  app: FastifyInstance<any, any, any, any>,
  ctx: AppContext,
  deps?: { connectors: { list(): Promise<Array<{ id: string; name: string }>> } },
): void {
```
  - Replace the SP-1 stub:
```ts
  app.get('/api/workflows/node-options/:source', MANAGE, async (req) => {
    const { source } = req.params as { source: string };
    return resolveNodeOptions(source, {
      connectors: deps?.connectors ?? { list: async () => [] },
      datasets: { list: () => ctx.workflows.datasets.list() },
      dhis2Mappings: async () => {
        const rows = await ctx.pluginData.list('dhis2-sink', 'mappings');
        return rows.map((r) => {
          const d = r.doc as { id?: string; name?: string };
          return { id: d.id ?? r.key, name: d.name ?? d.id ?? r.key };
        });
      },
    });
  });
```

- [ ] **Step 4: Wire app.ts** — change `registerWorkflowRoutes(app, ctx);` to:
```ts
  registerWorkflowRoutes(app, ctx, { connectors: createConnectorStore(ctx.internalDb) });
```
(`createConnectorStore` is already imported in app.ts; `ConnectorStore.list()` returns rows with `id`+`name` — structurally satisfies the dep.)

- [ ] **Step 5: Run → pass**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts` → all PASS (incl. the existing `/nodes` tests).

---

## Task 3: Web API client — `fetchWorkflowNodes` + `fetchNodeOptions`

**Files:** Modify `apps/web/src/api.ts` (the "Workflow types & API client" section, ~line 882).

- [ ] **Step 1: Add types + functions**

```ts
// ── Workflow node catalog (plugin-contributed + host) ──────────────────────────
export interface WorkflowNodeConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'file';
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[];
  optionsSource?: string;
}
export interface WorkflowNodeDescriptor {
  id: string;                 // composite `${pluginId}:${declId}` for plugin nodes
  source: 'host' | 'plugin';
  pluginId?: string;
  label: string;
  kind: 'source' | 'transform' | 'sink';
  description: string;
  entrypoint?: string;
  ports: { inputs: { name: string }[]; outputs: { name: string }[] };
  capabilities: string[];
  config: WorkflowNodeConfigField[];
}
export interface WorkflowNodeOption { value: string; label: string }

export async function fetchWorkflowNodes(): Promise<WorkflowNodeDescriptor[]> {
  const r = await authFetch('/api/workflows/nodes');
  if (!r.ok) throw new Error(`workflow nodes failed: ${r.status}`);
  const body = (await r.json()) as { nodes: WorkflowNodeDescriptor[] };
  return body.nodes;
}
export async function fetchNodeOptions(source: string): Promise<WorkflowNodeOption[]> {
  const r = await authFetch(`/api/workflows/node-options/${encodeURIComponent(source)}`);
  if (!r.ok) return [];
  return (await r.json()) as WorkflowNodeOption[];
}
/** The bare decl id for a plugin descriptor (strip the `${pluginId}:` prefix). */
export function pluginNodeDeclId(d: WorkflowNodeDescriptor): string {
  return d.pluginId && d.id.startsWith(`${d.pluginId}:`) ? d.id.slice(d.pluginId.length + 1) : d.id;
}
```

- [ ] **Step 2: Typecheck**: `pnpm -C apps/web exec tsc --noEmit` → PASS.

---

## Task 4: `plugin-node` ReactFlow component

**Files:** Create `node-types/plugin-node.tsx`; Modify `node-types/index.ts`.

- [ ] **Step 1: Create the component** (action-styled shell; variable handles by kind):

```tsx
// apps/web/src/workflows/components/node-types/plugin-node.tsx
import { type NodeProps } from '@xyflow/react';
import { Puzzle } from 'lucide-react';
import { NodeShell } from './base-node';

export function PluginNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as { label?: string; kind?: string; pluginId?: string; iconName?: string; iconUrl?: string };
  const kind = d.kind ?? 'transform';
  return (
    <NodeShell
      id={id}
      variant="action"
      icon={Puzzle}
      iconName={d.iconName}
      iconUrl={d.iconUrl}
      label={d.label ?? 'Plugin'}
      subtitle={d.pluginId}
      selected={selected}
      hasInput={kind !== 'source'}
      hasOutput={kind !== 'sink'}
    />
  );
}
```

- [ ] **Step 2: Register it** in `node-types/index.ts`:
```ts
import { PluginNode } from './plugin-node';
// …
export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  loop: LoopNode,
  webhook: WebhookNode,
  code: CodeNode,
  'plugin-node': PluginNode,
};
```

- [ ] **Step 3: Typecheck**: `pnpm -C apps/web exec tsc --noEmit` → PASS.

---

## Task 5: Plugins palette category (sidebar self-fetch)

**Files:** Modify `apps/web/src/workflows/components/sidebar.tsx`.

- [ ] **Step 1: Fetch plugin nodes + append a "Plugins" category.** In `Sidebar`, add state + effect that calls `fetchWorkflowNodes()`, filters `source === 'plugin'`, and builds a `NodeCategory` named `Plugins` whose items are plugin templates. Build each template via:

```ts
import { fetchWorkflowNodes, pluginNodeDeclId, type WorkflowNodeDescriptor } from '@/api';
import type { NodeTemplate } from '../lib/types';

function pluginTemplate(d: WorkflowNodeDescriptor): NodeTemplate {
  const defaults: Record<string, unknown> = {};
  for (const f of d.config) if (f.default !== undefined) defaults[f.key] = f.default;
  return {
    id: d.id,                 // composite, unique
    type: 'plugin-node',
    label: d.label,
    description: d.description || `${d.kind} node from ${d.pluginId}`,
    icon: 'Puzzle',
    keywords: [d.pluginId ?? '', d.kind],
    defaultData: {
      label: d.label,
      pluginId: d.pluginId,
      nodeId: pluginNodeDeclId(d),
      kind: d.kind,
      config: defaults,
      iconName: 'Puzzle',
      templateId: 'plugin-node',   // routes pickForm → PluginNodeForm
    } as never,
  };
}
```
In the component:
```ts
const [pluginCats, setPluginCats] = useState<NodeCategory[]>([]);
useEffect(() => {
  void fetchWorkflowNodes()
    .then((nodes) => {
      const plugins = nodes.filter((n) => n.source === 'plugin');
      if (plugins.length === 0) { setPluginCats([]); return; }
      setPluginCats([{ name: 'Plugins', icon: 'Puzzle', items: plugins.map(pluginTemplate) }]);
    })
    .catch(() => setPluginCats([]));
}, []);
const allCats = useMemo(() => [...nodeCategories, ...pluginCats], [pluginCats]);
```
Use `allCats` everywhere the component currently uses `nodeCategories` (the `visibleCategories` memo + the default-expanded init — guard the init so it still works; simplest is to base the search/`visibleCategories` memo on `allCats` and default unknown categories to expanded via the existing `?? true`).

- [ ] **Step 2: Make plugin templates draggable.** In `NodeCard`, the `available` gate is `IMPLEMENTED_TEMPLATE_IDS.has(template.id)`. Change to also allow plugin nodes:
```ts
const available = template.type === 'plugin-node' || IMPLEMENTED_TEMPLATE_IDS.has(template.id);
```
The existing `onDragStart` already stamps `reactflow-type = template.type` (`'plugin-node'`) and `reactflow-data = { ...defaultData, templateId }` — which carries `pluginId/nodeId/kind/config`. No drop-handler change needed (canvas `onDrop` is generic).

- [ ] **Step 3: Verify** the web typechecks + the suite still passes: `pnpm -C apps/web exec tsc --noEmit` and `pnpm -C apps/web test src/workflows` (isolated). Expected PASS. (A `fetchWorkflowNodes` network call in tests resolves via the existing fetch mock or returns empty → the Plugins category is simply absent; that's fine.)

---

## Task 6: Generic `PluginNodeForm` + `pickForm` wiring

**Files:** Create `node-forms/plugin-node-form.tsx`; Modify `node-forms/index.tsx`; Create `node-forms/plugin-node-form.test.tsx`.

- [ ] **Step 1: Write the failing test** — `plugin-node-form.test.tsx` (mock `@/api`, mirroring `dhis2-push-form.test.tsx`):

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginNodeForm } from './plugin-node-form';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof api>()), fetchWorkflowNodes: vi.fn(), fetchNodeOptions: vi.fn() }));

const descriptor = {
  id: 'test-sink:echo', source: 'plugin', pluginId: 'test-sink', label: 'Echo', kind: 'transform',
  description: '', entrypoint: 'wf_echo', ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] },
  capabilities: [], config: [
    { key: 'note', label: 'Note', type: 'text' },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  ],
};
const node = { id: 'n1', type: 'plugin-node', data: { label: 'Echo', pluginId: 'test-sink', nodeId: 'echo', kind: 'transform', config: { note: 'hi' } } } as never;

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([descriptor]);
  (api.fetchNodeOptions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('PluginNodeForm', () => {
  it('renders the declarative config fields from the descriptor', async () => {
    render(<PluginNodeForm node={node} update={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Note')).toBeInTheDocument());
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect((screen.getByDisplayValue('hi') as HTMLInputElement)).toBeInTheDocument();
  });

  it('calls update with the new config when a field changes', async () => {
    const update = vi.fn();
    render(<PluginNodeForm node={node} update={update} />);
    const input = await screen.findByDisplayValue('hi');
    input.focus();
    (input as HTMLInputElement).value = 'bye';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect(update).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run → fail**: `pnpm -C apps/web test src/workflows/components/node-forms/plugin-node-form.test.tsx`.

- [ ] **Step 3: Implement** `plugin-node-form.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { NodeFormProps } from './index';
import { FormField, TextInput, Select, inputClass } from './shared';
import { fetchWorkflowNodes, fetchNodeOptions, type WorkflowNodeConfigField, type WorkflowNodeOption } from '@/api';

export function PluginNodeForm({ node, update }: NodeFormProps) {
  const data = node.data as { label?: string; pluginId?: string; nodeId?: string; config?: Record<string, unknown> };
  const config = data.config ?? {};
  const [fields, setFields] = useState<WorkflowNodeConfigField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchWorkflowNodes()
      .then((nodes) => {
        const match = nodes.find((n) => n.pluginId === data.pluginId && (n.id === `${data.pluginId}:${data.nodeId}` || n.id === data.nodeId));
        if (!match) { setError('This plugin node is no longer installed.'); setFields([]); return; }
        setFields(match.config);
      })
      .catch(() => { setError('Could not load node configuration.'); setFields([]); });
  }, [data.pluginId, data.nodeId]);

  const setField = (key: string, value: unknown) => update({ config: { ...config, [key]: value } } as never);

  return (
    <div className="space-y-4">
      <FormField label="Label">
        <TextInput value={data.label ?? ''} onChange={(e) => update({ label: e.target.value } as never)} />
      </FormField>
      {error && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">{error}</p>}
      {fields === null && <p className="text-xs text-muted-foreground">Loading configuration…</p>}
      {fields?.map((f) => (
        <PluginField key={f.key} field={f} value={config[f.key]} onChange={(v) => setField(f.key, v)} />
      ))}
    </div>
  );
}

function PluginField({ field, value, onChange }: { field: WorkflowNodeConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const [options, setOptions] = useState<WorkflowNodeOption[]>(field.options ?? []);
  useEffect(() => {
    if ((field.type === 'select' || field.type === 'multiselect') && field.optionsSource) {
      void fetchNodeOptions(field.optionsSource).then(setOptions).catch(() => setOptions([]));
    }
  }, [field.optionsSource, field.type]);

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input id={`f-${field.key}`} type="checkbox" className={inputClass + ' mt-0 h-4 w-4 cursor-pointer'}
          checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={`f-${field.key}`} className="cursor-pointer text-sm text-foreground">{field.label}</label>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <FormField label={field.label}>
        <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </FormField>
    );
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
    return (
      <FormField label={field.label}>
        <div className="mt-1.5 space-y-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </FormField>
    );
  }
  if (field.type === 'file') {
    return (
      <FormField label={field.label} hint="File inputs arrive in a later release.">
        <TextInput disabled value="" placeholder="(not yet supported)" />
      </FormField>
    );
  }
  // text | number
  return (
    <FormField label={field.label}>
      <TextInput type={field.type === 'number' ? 'number' : 'text'} value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />
    </FormField>
  );
}
```

- [ ] **Step 4: Wire `pickForm`** in `node-forms/index.tsx`:
  - import: `import { PluginNodeForm } from './plugin-node-form';`
  - add to `FORMS`: `'plugin-node': PluginNodeForm,`
  - add a fallback in `pickForm` before the DefaultForm return: `if (node.type === 'plugin-node') return PluginNodeForm;`

- [ ] **Step 5: Run → pass**: `pnpm -C apps/web test src/workflows/components/node-forms/plugin-node-form.test.tsx` → PASS.

---

## Task 7: SP-3a-deferred web bits — template hints + sample workflow

**Files:** Modify `node-forms/shared.tsx`, `apps/web/src/workflows/lib/sample-workflow.ts`.

- [ ] **Step 1: Fix the `ExpressionInput` hint** in `shared.tsx`:
```tsx
    <FormField label={typeof props['aria-label'] === 'string' ? props['aria-label'] : 'Value'} hint="Templates: {{ $json.foo }} or {{ $node('id').0.json.bar }}">
      <TextInput {...props} placeholder={props.placeholder ?? '{{ $json.body }}'} />
```

- [ ] **Step 2: Update the web sample workflow templates** — read `apps/web/src/workflows/lib/sample-workflow.ts` and change any `{{ $input… }}` / `$input` references to the new model (`{{ $json.x }}` for a field, `{{ $items }}` for the whole list), matching what the engine sample (`@openldr/workflows` `sample-workflow.ts`) now uses.

- [ ] **Step 3: Grep for stragglers**: search `apps/web/src/workflows` for `$input` and update any remaining placeholder/hint strings in node-forms to `$json`/`$items` (e.g. log-form, set-form, http-request-form, if/filter forms). Leave field *names* alone — only the user-facing template hint/placeholder text.

- [ ] **Step 4: Verify**: `pnpm -C apps/web exec tsc --noEmit` and `pnpm -C apps/web test src/workflows` (isolated) → PASS.

---

## Task 8: Full gate

- [ ] **Step 1: Typecheck (forced)**: `pnpm turbo run typecheck --force` → all PASS (watch `@openldr/web`, `@openldr/server`).
- [ ] **Step 2: Depcruise**: `pnpm depcruise` → 0 errors.
- [ ] **Step 3: Server route suite**: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts` → PASS.
- [ ] **Step 4: Web suite (isolated)**: `pnpm -C apps/web test` → PASS (the known flake is parallel-only; isolated run is green — re-run once if a flaky file trips).
- [ ] **Step 5: Build (forced)**: `pnpm turbo run build --force` → PASS.
- [ ] **Step 6: Acceptance check** — confirm:
  - `GET /api/workflows/node-options/:source` resolves connectors/datasets/dhis2-mappings/fhir-resource-types (unknown → []); MANAGE-gated.
  - The Sidebar shows a "Plugins" category (when a plugin contributes nodes) whose tiles drag in as `plugin-node` nodes carrying `{pluginId,nodeId,kind,config}`.
  - `PluginNodeForm` renders the descriptor's declarative fields and resolves `optionsSource` selects.
  - The `plugin-node` canvas node shows input/output handles per kind.
  - Template hints + the web sample use `$json`/`$items`.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 resolver registry; Task 2 real route + app wiring + tests; Task 3 web client; Task 4 canvas node; Task 5 palette; Task 6 config form + pickForm; Task 7 the SP-3a-deferred web template/sample bits; Task 8 gate.
- **Saved-node contract:** plugin tiles drop with `node.type='plugin-node'`, `data={label,pluginId,nodeId,kind,config,templateId:'plugin-node'}` — exactly what the SP-2/SP-3a engine `pluginNodeHandler` reads. `nodeId` is the bare decl id (via `pluginNodeDeclId`).
- **No engine change:** SP-3b is web + one route; the `@openldr/workflows` engine is untouched (SP-3a already made it items-native). The `GET /api/workflows/nodes` descriptor shape is the SP-1 `WorkflowNodeDescriptor`.
- **Web flake:** run web tests isolated; never trust a turbo `web#test` red.
