# Slice A — Tier-1 In-Memory Transform Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up 12 "Coming soon" workflow nodes that operate purely on in-memory `WorkflowItem[]` — no DB, network, credentials, or engine changes — turning the largest batch of placeholders into working nodes.

**Architecture:** Each node is a `NodeHandler` (same shape as the existing `set`/`merge`/`filter` handlers) registered in `node-handlers/index.ts`, plus its template id added to `IMPLEMENTED_TEMPLATE_IDS` so the palette enables it. The 9 pure-data nodes get their config UI for free from the existing `DeclarativeNodeForm`, which renders a host node's `config[]` from `HOST_NODE_DESCRIPTORS`. `no-op` already has a handler (`defaultHandler`); `stop-error` and `switch` already have bespoke React forms and (for switch) dynamic canvas output handles — they only need an engine handler.

**Tech Stack:** TypeScript, Vitest, `@openldr/workflows` engine, `node:vm` (switch condition eval, mirroring the `if` handler).

**Nodes in this slice:** `no-op`, `stop-error`, `switch`, `sort`, `limit`, `remove-duplicates`, `rename-keys`, `split-out`, `aggregate`, `summarize`, `date-time`, `compare-datasets`. Plus removing the redundant `edit-fields` and `item-lists` palette entries.

**Out of scope (deferred per the inventory spec):** `wait` (durable-wait design), `loop`/`execute-workflow` (engine control-flow specs), all Tier 2–6 nodes.

---

## Key facts (verified in code)

- **Handler signature** (`packages/workflows/src/engine/node-handlers/types.ts`): `(node: RunnerNode, ctx: ExecutionContext, input: WorkflowItem[]) => Promise<WorkflowItem[]> | WorkflowItem[]`. `RunnerNode = { id, type, data: Record<string,unknown> }`. `WorkflowItem = { json: Record<string,unknown>, binary?: ... }`.
- **Action handler dispatch** (`node-handlers/index.ts`): `ACTION_HANDLERS[node.data.action]`; unknown → `defaultHandler` (passthrough). `no-op` is already mapped to `defaultHandler`.
- **Condition dispatch** (`pickHandler`): `node.type === 'condition'` → `templateId === 'filter' ? filterHandler : ifHandler`. We add a `switch` branch here.
- **Branch routing** (`run-workflow.ts:183-188`): after a node runs, if `ctx.branches[node.id]` is set, the runner skips every outgoing edge whose `sourceHandle` is set and `!== branch`. Arbitrary handle names work — this is exactly how `switch` routes.
- **Multi-input** (`merge.ts`): a handler reads all incoming branches via `ctx.edges.filter(e => e.target === node.id).map(e => ctx.nodeOutputs[e.source])`. `compare-datasets` uses the same pattern.
- **Config UI**: `pickForm` (`node-forms/index.tsx`) routes any unregistered `action` node to `DeclarativeNodeForm`, which calls `fetchWorkflowNodes()`, finds the host descriptor where `id === node.data.action`, and renders its `config[]`. So a pure-data node needs a `HOST_NODE_DESCRIPTORS` entry with `config[]`. `stop-error` (StopErrorForm) and `switch` (SwitchForm) are already registered by templateId → no descriptor needed for their UI.
- **`WorkflowConfigField`** (`packages/marketplace/src/workflow-node.ts`): `{ key, label, type, required?, default?, options?: {value,label}[], optionsSource?, detailSource? }`; `type ∈ text|number|boolean|select|multiselect|file|json`.
- **No descriptor-parity test** — triggers are "implemented" with no descriptor. So only the 9 declarative-config nodes need descriptors.
- **No server changes** — the registry (`createWorkflowNodeRegistry`) serves `HOST_NODE_DESCRIPTORS` at `/api/workflows/nodes` automatically.

## Test command

Single file: `pnpm -C packages/workflows exec vitest run <path>`
Full package: `pnpm -C packages/workflows test`

## File structure

- **Create** (handlers): `packages/workflows/src/engine/node-handlers/{stop-error,switch,sort,limit,remove-duplicates,rename-keys,split-out,aggregate,summarize,date-time,compare-datasets}.ts`
- **Create** (tests): one `*.test.ts` beside each handler above.
- **Modify**: `packages/workflows/src/engine/node-handlers/index.ts` (register handlers + switch dispatch), `packages/workflows/src/host-nodes.ts` (9 descriptors), `apps/web/src/workflows/constants.ts` (drop 2 entries, add config defaults, add 12 ids to `IMPLEMENTED_TEMPLATE_IDS`).

---

## Task 1: Palette cleanup + enable `no-op`

`no-op` already runs (`ACTION_HANDLERS['no-op'] = defaultHandler`); it just isn't enabled in the palette. Also drop the two redundant entries (resolved decision: `set` covers `edit-fields`; discrete nodes cover `item-lists`).

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Test: `packages/workflows/src/engine/node-handlers/default.test.ts` (create)

- [ ] **Step 1: Write the failing test** — confirm the default/no-op handler passes items through unchanged.

Create `packages/workflows/src/engine/node-handlers/default.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { defaultHandler } from './default';
import { createContext } from '../execution-context';

describe('defaultHandler (no-op passthrough)', () => {
  it('returns the input items unchanged', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { a: 1 } }, { json: { b: 2 } }];
    const result = await defaultHandler({ id: 'n1', type: 'action', data: { action: 'no-op' } }, ctx, input);
    expect(result).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (handler already exists — this locks the contract).

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/default.test.ts`
Expected: PASS.

- [ ] **Step 3: Remove redundant palette entries.** In `apps/web/src/workflows/constants.ts`, in the `Data Transformation` category `items`, delete these two lines:

```typescript
      node('edit-fields', 'action', 'Edit Fields (Set)', 'Pencil', 'Set field values'),
```
```typescript
      node('item-lists', 'action', 'Item Lists', 'List', 'Array helpers'),
```

- [ ] **Step 4: Enable `no-op`.** In the same file add `'no-op'` to `IMPLEMENTED_TEMPLATE_IDS` (in the `// actions` group):

```typescript
  'set', 'log', 'merge', 'no-op',
```

- [ ] **Step 5: Typecheck the web package.**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/workflows/constants.ts packages/workflows/src/engine/node-handlers/default.test.ts
git commit -m "feat(workflows): enable no-op node, drop redundant edit-fields/item-lists"
```

---

## Task 2: `stop-error` handler

Throws a (templated) error message, halting the run. UI form already exists (`StopErrorForm`).

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/stop-error.ts`
- Create: `packages/workflows/src/engine/node-handlers/stop-error.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`, `apps/web/src/workflows/constants.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/stop-error.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stopErrorHandler } from './stop-error';
import { createContext } from '../execution-context';

const node = (errorMessage?: string) => ({ id: 's1', type: 'action', data: { action: 'stop-error', config: errorMessage === undefined ? {} : { errorMessage } } });

describe('stopErrorHandler', () => {
  it('throws the configured message', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(stopErrorHandler(node('boom'), ctx, [])).rejects.toThrow('boom');
  });

  it('resolves templates in the message', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      stopErrorHandler(node('bad: {{ $json.reason }}'), ctx, [{ json: { reason: 'nope' } }]),
    ).rejects.toThrow('bad: nope');
  });

  it('falls back to a default message when none is set', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(stopErrorHandler(node(), ctx, [])).rejects.toThrow('Workflow stopped');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/stop-error.test.ts`
Expected: FAIL — `Cannot find module './stop-error'`.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/stop-error.ts`:

```typescript
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Halts the workflow by throwing. The message supports {{ $json.x }} templates. */
export const stopErrorHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const raw = (config.errorMessage as string) ?? '';
  const message = resolveTemplate(raw, ctx, input).trim() || 'Workflow stopped';
  throw new Error(message);
};
```

- [ ] **Step 4: Register the handler.** In `node-handlers/index.ts` add the import and the `ACTION_HANDLERS` entry:

```typescript
import { stopErrorHandler } from './stop-error';
```
```typescript
  'no-op': defaultHandler,
  'stop-error': stopErrorHandler,
```

- [ ] **Step 5: Enable in palette.** In `constants.ts` add `'stop-error'` to `IMPLEMENTED_TEMPLATE_IDS`:

```typescript
  'set', 'log', 'merge', 'no-op', 'stop-error',
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/stop-error.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/stop-error.ts packages/workflows/src/engine/node-handlers/stop-error.test.ts packages/workflows/src/engine/node-handlers/index.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement stop-error node"
```

---

## Task 3: `switch` handler

Evaluates ordered rules; first match selects the named output branch, else `fallbackOutput`. Sets `ctx.branches[node.id]` so the runner prunes the other edges. Mirrors `ifHandler` (vm-evaluated condition). UI form + dynamic canvas handles already exist.

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/switch.ts`
- Create: `packages/workflows/src/engine/node-handlers/switch.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`, `apps/web/src/workflows/constants.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/switch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { switchHandler } from './switch';
import { createContext } from '../execution-context';

const node = (rules: Array<{ name: string; condition: string }>, fallbackOutput = 'fallback') => ({
  id: 'sw1', type: 'condition', data: { templateId: 'switch', rules, fallbackOutput },
});

describe('switchHandler', () => {
  it('selects the first matching rule and passes items through', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { status: 200 } }];
    const result = await switchHandler(
      node([
        { name: 'ok', condition: '$json.status === 200' },
        { name: 'err', condition: '$json.status >= 400' },
      ]),
      ctx,
      input,
    );
    expect(ctx.branches['sw1']).toBe('ok');
    expect(result).toBe(input);
  });

  it('falls back when no rule matches', async () => {
    const ctx = createContext(undefined, () => {});
    await switchHandler(node([{ name: 'ok', condition: '$json.status === 200' }]), ctx, [{ json: { status: 500 } }]);
    expect(ctx.branches['sw1']).toBe('fallback');
  });

  it('skips empty conditions and uses fallback', async () => {
    const ctx = createContext(undefined, () => {});
    await switchHandler(node([{ name: 'ok', condition: '' }]), ctx, [{ json: {} }]);
    expect(ctx.branches['sw1']).toBe('fallback');
  });

  it('throws a descriptive error when a rule expression is invalid', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      switchHandler(node([{ name: 'bad', condition: 'this is not js (' }]), ctx, [{ json: {} }]),
    ).rejects.toThrow(/Switch rule "bad"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/switch.test.ts`
Expected: FAIL — `Cannot find module './switch'`.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/switch.ts`:

```typescript
import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

interface SwitchRule { name: string; condition: string }

/**
 * Multi-branch router. Evaluates each rule's condition (after `{{ }}` template
 * resolution) in a vm sandbox; the first truthy rule sets the chosen output
 * handle in `ctx.branches[node.id]`. No match → `fallbackOutput`. Items pass
 * through unchanged; the runner prunes the non-chosen outgoing edges.
 */
export const switchHandler: NodeHandler = async (node, ctx, input) => {
  const rules = (node.data.rules as SwitchRule[] | undefined) ?? [];
  const fallback = (node.data.fallbackOutput as string | undefined) ?? 'fallback';
  let branch = fallback;
  for (const rule of rules) {
    const resolved = resolveTemplate(rule.condition ?? '', ctx, input);
    if (!resolved.trim()) continue;
    try {
      const sandbox = { $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input };
      if (vm.runInNewContext(resolved, sandbox, { timeout: 1000 })) {
        branch = rule.name;
        break;
      }
    } catch (err) {
      throw new Error(`Switch rule "${rule.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = branch;
  return input;
};
```

- [ ] **Step 4: Wire dispatch.** In `node-handlers/index.ts` add the import and a `switch` case in `pickHandler`'s condition branch:

```typescript
import { switchHandler } from './switch';
```
```typescript
  if (node.type === 'condition') {
    const templateId = (node.data.templateId as string | undefined) ?? '';
    if (templateId === 'filter') return filterHandler;
    if (templateId === 'switch') return switchHandler;
    return ifHandler;
  }
```

- [ ] **Step 5: Enable in palette.** In `constants.ts` add `'switch'` to `IMPLEMENTED_TEMPLATE_IDS` (in the `// conditions` group):

```typescript
  'if', 'filter', 'switch',
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/switch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/switch.ts packages/workflows/src/engine/node-handlers/switch.test.ts packages/workflows/src/engine/node-handlers/index.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement switch node (multi-branch routing)"
```

---

## Task 4: `sort` handler

Single-field stable sort, ascending or descending. Config-driven UI via descriptor.

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/sort.ts` + `.test.ts`
- Modify: `node-handlers/index.ts`, `host-nodes.ts`, `constants.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/sort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sortHandler } from './sort';
import { createContext } from '../execution-context';

const node = (field: string, order = 'asc') => ({ id: 'so1', type: 'action', data: { action: 'sort', config: { field, order } } });
const ctx = () => createContext(undefined, () => {});

describe('sortHandler', () => {
  it('sorts ascending by field', async () => {
    const result = await sortHandler(node('n'), ctx(), [{ json: { n: 3 } }, { json: { n: 1 } }, { json: { n: 2 } }]);
    expect(result.map((i) => i.json.n)).toEqual([1, 2, 3]);
  });

  it('sorts descending by field', async () => {
    const result = await sortHandler(node('n', 'desc'), ctx(), [{ json: { n: 1 } }, { json: { n: 3 } }, { json: { n: 2 } }]);
    expect(result.map((i) => i.json.n)).toEqual([3, 2, 1]);
  });

  it('returns input unchanged when no field is set', async () => {
    const input = [{ json: { n: 2 } }, { json: { n: 1 } }];
    const result = await sortHandler(node(''), ctx(), input);
    expect(result).toEqual(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/sort.test.ts`
Expected: FAIL — `Cannot find module './sort'`.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/sort.ts`:

```typescript
import type { NodeHandler } from './types';

/** Order items by a single json field. Nullish values sort first (asc). */
export const sortHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const desc = (config.order as string) === 'desc';
  if (!field) return input;
  const sorted = [...input].sort((a, b) => {
    const av = a.json[field] as unknown;
    const bv = b.json[field] as unknown;
    if (av == null && bv == null) return 0;
    if (av == null) return -1;
    if (bv == null) return 1;
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return desc ? sorted.reverse() : sorted;
};
```

- [ ] **Step 4: Register handler.** In `index.ts` add import + entry:

```typescript
import { sortHandler } from './sort';
```
```typescript
  'sort': sortHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`, in the Transforms block of `HOST_NODE_DESCRIPTORS`, add:

```typescript
  { id: 'sort', source: 'host', label: 'Sort', kind: 'transform', description: 'Order items by a field.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Sort field', type: 'text', required: true }, { key: 'order', label: 'Order', type: 'select', options: [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }] }] },
```

- [ ] **Step 6: Add config default + enable.** In `constants.ts`, replace the `sort` palette entry with one carrying a default config, and add `'sort'` to `IMPLEMENTED_TEMPLATE_IDS`:

```typescript
      node('sort', 'action', 'Sort', 'ArrowDownUp', 'Order items by field', {
        data: { config: { field: '', order: 'asc' } },
      }),
```

Add to the conditions/actions area of `IMPLEMENTED_TEMPLATE_IDS` (group with the other transforms):

```typescript
  'sort', 'limit', 'remove-duplicates', 'rename-keys', 'split-out', 'aggregate', 'summarize', 'date-time', 'compare-datasets',
```

> Note: add the full transforms line now; later tasks (5–12) only add their handler/descriptor — the id is already present. If you prefer strict per-task isolation, add just `'sort'` here and one id per subsequent task.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/sort.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/sort.ts packages/workflows/src/engine/node-handlers/sort.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement sort node"
```

---

## Task 5: `limit` handler

Keep the first or last N items.

**Files:** Create `limit.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/limit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { limitHandler } from './limit';
import { createContext } from '../execution-context';

const node = (maxItems: number, keep = 'first') => ({ id: 'l1', type: 'action', data: { action: 'limit', config: { maxItems, keep } } });
const ctx = () => createContext(undefined, () => {});
const items = [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }];

describe('limitHandler', () => {
  it('keeps the first N items', async () => {
    const result = await limitHandler(node(2), ctx(), items);
    expect(result.map((i) => i.json.n)).toEqual([1, 2]);
  });

  it('keeps the last N items', async () => {
    const result = await limitHandler(node(2, 'last'), ctx(), items);
    expect(result.map((i) => i.json.n)).toEqual([2, 3]);
  });

  it('returns all items when max is 0 or unset', async () => {
    const result = await limitHandler(node(0), ctx(), items);
    expect(result).toEqual(items);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/limit.ts`:

```typescript
import type { NodeHandler } from './types';

/** Keep the first (default) or last N items. max <= 0 → passthrough. */
export const limitHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const max = Number(config.maxItems ?? 0);
  if (!Number.isFinite(max) || max <= 0) return input;
  return (config.keep as string) === 'last' ? input.slice(-max) : input.slice(0, max);
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { limitHandler } from './limit';
```
```typescript
  'limit': limitHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'limit', source: 'host', label: 'Limit', kind: 'transform', description: 'Keep the first or last N items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'maxItems', label: 'Max items', type: 'number', required: true }, { key: 'keep', label: 'Keep', type: 'select', options: [{ value: 'first', label: 'First' }, { value: 'last', label: 'Last' }] }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `limit` entry:

```typescript
      node('limit', 'action', 'Limit', 'Minimize2', 'Keep first N items', {
        data: { config: { maxItems: 50, keep: 'first' } },
      }),
```

(`'limit'` is already in `IMPLEMENTED_TEMPLATE_IDS` from Task 4's transforms line.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/limit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/limit.ts packages/workflows/src/engine/node-handlers/limit.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement limit node"
```

---

## Task 6: `remove-duplicates` handler

Drop duplicate items by a field, or by whole-item value when no field set.

**Files:** Create `remove-duplicates.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/remove-duplicates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { removeDuplicatesHandler } from './remove-duplicates';
import { createContext } from '../execution-context';

const node = (field = '') => ({ id: 'rd1', type: 'action', data: { action: 'remove-duplicates', config: { field } } });
const ctx = () => createContext(undefined, () => {});

describe('removeDuplicatesHandler', () => {
  it('dedupes by a field, keeping first occurrence', async () => {
    const result = await removeDuplicatesHandler(node('id'), ctx(), [
      { json: { id: 1, v: 'a' } },
      { json: { id: 1, v: 'b' } },
      { json: { id: 2, v: 'c' } },
    ]);
    expect(result).toEqual([{ json: { id: 1, v: 'a' } }, { json: { id: 2, v: 'c' } }]);
  });

  it('dedupes by whole item when no field set', async () => {
    const result = await removeDuplicatesHandler(node(), ctx(), [
      { json: { a: 1 } },
      { json: { a: 1 } },
      { json: { a: 2 } },
    ]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/remove-duplicates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/remove-duplicates.ts`:

```typescript
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Drop duplicate items, keeping the first. Keyed by a field, or whole-item JSON. */
export const removeDuplicatesHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const seen = new Set<string>();
  const out: WorkflowItem[] = [];
  for (const item of input) {
    const key = field ? JSON.stringify(item.json[field]) : JSON.stringify(item.json);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { removeDuplicatesHandler } from './remove-duplicates';
```
```typescript
  'remove-duplicates': removeDuplicatesHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'remove-duplicates', source: 'host', label: 'Remove Duplicates', kind: 'transform', description: 'Drop duplicate items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Dedupe by field (blank = whole item)', type: 'text' }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `remove-duplicates` entry:

```typescript
      node('remove-duplicates', 'action', 'Remove Duplicates', 'CopyMinus', 'Drop duplicate items', {
        data: { config: { field: '' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/remove-duplicates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/remove-duplicates.ts packages/workflows/src/engine/node-handlers/remove-duplicates.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement remove-duplicates node"
```

---

## Task 7: `rename-keys` handler

Rename object fields per a `{ from, to }[]` config (rendered as a JSON field).

**Files:** Create `rename-keys.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/rename-keys.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renameKeysHandler } from './rename-keys';
import { createContext } from '../execution-context';

const node = (renames: Array<{ from: string; to: string }>) => ({ id: 'rk1', type: 'action', data: { action: 'rename-keys', config: { renames } } });
const ctx = () => createContext(undefined, () => {});

describe('renameKeysHandler', () => {
  it('renames matching keys, preserving others', async () => {
    const result = await renameKeysHandler(node([{ from: 'a', to: 'x' }]), ctx(), [{ json: { a: 1, b: 2 } }]);
    expect(result).toEqual([{ json: { x: 1, b: 2 } }]);
  });

  it('ignores renames whose source key is absent', async () => {
    const result = await renameKeysHandler(node([{ from: 'missing', to: 'x' }]), ctx(), [{ json: { a: 1 } }]);
    expect(result).toEqual([{ json: { a: 1 } }]);
  });

  it('skips incomplete rename pairs', async () => {
    const result = await renameKeysHandler(node([{ from: 'a', to: '' }]), ctx(), [{ json: { a: 1 } }]);
    expect(result).toEqual([{ json: { a: 1 } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/rename-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/rename-keys.ts`:

```typescript
import type { NodeHandler } from './types';

/** Rename object keys per a { from, to }[] config. Missing/incomplete pairs are skipped. */
export const renameKeysHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const renames = (config.renames as Array<{ from: string; to: string }> | undefined) ?? [];
  return input.map((item) => {
    const json: Record<string, unknown> = { ...item.json };
    for (const { from, to } of renames) {
      if (!from || !to) continue;
      if (Object.prototype.hasOwnProperty.call(json, from)) {
        json[to] = json[from];
        delete json[from];
      }
    }
    return { json };
  });
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { renameKeysHandler } from './rename-keys';
```
```typescript
  'rename-keys': renameKeysHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'rename-keys', source: 'host', label: 'Rename Keys', kind: 'transform', description: 'Rename object fields.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'renames', label: 'Renames ([{ "from": "old", "to": "new" }])', type: 'json' }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `rename-keys` entry:

```typescript
      node('rename-keys', 'action', 'Rename Keys', 'TextCursorInput', 'Rename object fields', {
        data: { config: { renames: [] } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/rename-keys.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/rename-keys.ts packages/workflows/src/engine/node-handlers/rename-keys.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement rename-keys node"
```

---

## Task 8: `split-out` handler

Explode an array field into one item per element.

**Files:** Create `split-out.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/split-out.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { splitOutHandler } from './split-out';
import { createContext } from '../execution-context';

const node = (field: string) => ({ id: 'sp1', type: 'action', data: { action: 'split-out', config: { field } } });
const ctx = () => createContext(undefined, () => {});

describe('splitOutHandler', () => {
  it('splits an array of objects into one item each', async () => {
    const result = await splitOutHandler(node('rows'), ctx(), [{ json: { rows: [{ a: 1 }, { a: 2 }] } }]);
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });

  it('wraps primitive array elements under `value`', async () => {
    const result = await splitOutHandler(node('tags'), ctx(), [{ json: { tags: ['x', 'y'] } }]);
    expect(result).toEqual([{ json: { value: 'x' } }, { json: { value: 'y' } }]);
  });

  it('passes through items whose field is not an array', async () => {
    const result = await splitOutHandler(node('rows'), ctx(), [{ json: { rows: 5 } }]);
    expect(result).toEqual([{ json: { rows: 5 } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/split-out.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/split-out.ts`:

```typescript
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Explode an array field into one item per element. Non-array → passthrough. */
export const splitOutHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  if (!field) return input;
  const out: WorkflowItem[] = [];
  for (const item of input) {
    const value = item.json[field];
    if (Array.isArray(value)) {
      for (const el of value) {
        const json = el !== null && typeof el === 'object' && !Array.isArray(el)
          ? (el as Record<string, unknown>)
          : { value: el };
        out.push({ json });
      }
    } else {
      out.push(item);
    }
  }
  return out;
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { splitOutHandler } from './split-out';
```
```typescript
  'split-out': splitOutHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'split-out', source: 'host', label: 'Split Out', kind: 'transform', description: 'Split an array field into items.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Field to split out', type: 'text', required: true }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `split-out` entry:

```typescript
      node('split-out', 'action', 'Split Out', 'SplitSquareHorizontal', 'Split array into items', {
        data: { config: { field: '' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/split-out.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/split-out.ts packages/workflows/src/engine/node-handlers/split-out.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement split-out node"
```

---

## Task 9: `aggregate` handler

Collect a field across all items into a single item holding an array (inverse of split-out).

**Files:** Create `aggregate.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/aggregate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { aggregateHandler } from './aggregate';
import { createContext } from '../execution-context';

const node = (field = '', outputField = '') => ({ id: 'ag1', type: 'action', data: { action: 'aggregate', config: { field, outputField } } });
const ctx = () => createContext(undefined, () => {});

describe('aggregateHandler', () => {
  it('collects one field into an array under outputField', async () => {
    const result = await aggregateHandler(node('n', 'all'), ctx(), [{ json: { n: 1 } }, { json: { n: 2 } }]);
    expect(result).toEqual([{ json: { all: [1, 2] } }]);
  });

  it('defaults outputField to the field name', async () => {
    const result = await aggregateHandler(node('n'), ctx(), [{ json: { n: 1 } }]);
    expect(result).toEqual([{ json: { n: [1] } }]);
  });

  it('aggregates whole item json when no field set', async () => {
    const result = await aggregateHandler(node('', 'data'), ctx(), [{ json: { a: 1 } }, { json: { b: 2 } }]);
    expect(result).toEqual([{ json: { data: [{ a: 1 }, { b: 2 }] } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/aggregate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/aggregate.ts`:

```typescript
import type { NodeHandler } from './types';

/** Collect a field (or whole-item json) across all items into one item with an array. */
export const aggregateHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const outputField = (config.outputField as string) || field || 'data';
  const values = field ? input.map((i) => i.json[field]) : input.map((i) => i.json);
  return [{ json: { [outputField]: values } }];
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { aggregateHandler } from './aggregate';
```
```typescript
  'aggregate': aggregateHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'aggregate', source: 'host', label: 'Aggregate', kind: 'transform', description: 'Collect items into one.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'field', label: 'Field to aggregate (blank = whole item)', type: 'text' }, { key: 'outputField', label: 'Output field', type: 'text' }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `aggregate` entry:

```typescript
      node('aggregate', 'action', 'Aggregate', 'Combine', 'Collect items into one', {
        data: { config: { field: '', outputField: '' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/aggregate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/aggregate.ts packages/workflows/src/engine/node-handlers/aggregate.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement aggregate node"
```

---

## Task 10: `summarize` handler

Group items by a field and compute sum/avg/min/max/count.

**Files:** Create `summarize.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/summarize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { summarizeHandler } from './summarize';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'sm1', type: 'action', data: { action: 'summarize', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('summarizeHandler', () => {
  it('counts all items when operation=count, no group', async () => {
    const result = await summarizeHandler(node({ operation: 'count' }), ctx(), [{ json: {} }, { json: {} }]);
    expect(result).toEqual([{ json: { count: 2 } }]);
  });

  it('sums a field grouped by another field', async () => {
    const result = await summarizeHandler(
      node({ groupBy: 'g', field: 'v', operation: 'sum' }),
      ctx(),
      [{ json: { g: 'a', v: 1 } }, { json: { g: 'a', v: 2 } }, { json: { g: 'b', v: 5 } }],
    );
    expect(result).toEqual([{ json: { g: 'a', sum_v: 3 } }, { json: { g: 'b', sum_v: 5 } }]);
  });

  it('computes avg of a field', async () => {
    const result = await summarizeHandler(node({ field: 'v', operation: 'avg' }), ctx(), [{ json: { v: 2 } }, { json: { v: 4 } }]);
    expect(result).toEqual([{ json: { avg_v: 3 } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/summarize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/summarize.ts`:

```typescript
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/** Group items by a field and reduce a numeric field (sum/avg/min/max) or count. */
export const summarizeHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const groupBy = (config.groupBy as string) ?? '';
  const field = (config.field as string) ?? '';
  const operation = (config.operation as string) ?? 'count';

  const groups = new Map<string, WorkflowItem[]>();
  for (const item of input) {
    const key = groupBy ? String(item.json[groupBy] ?? '') : '__all__';
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  const compute = (items: WorkflowItem[]): number => {
    if (operation === 'count') return items.length;
    const nums = items.map((i) => Number(i.json[field])).filter((n) => Number.isFinite(n));
    if (nums.length === 0) return 0;
    switch (operation) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'min': return Math.min(...nums);
      case 'max': return Math.max(...nums);
      default: return items.length;
    }
  };

  const resultKey = operation === 'count' ? 'count' : `${operation}_${field}`;
  return [...groups.entries()].map(([key, items]) => ({
    json: {
      ...(groupBy ? { [groupBy]: key } : {}),
      [resultKey]: compute(items),
    },
  }));
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { summarizeHandler } from './summarize';
```
```typescript
  'summarize': summarizeHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'summarize', source: 'host', label: 'Summarize', kind: 'transform', description: 'Sum, avg, min, max, count.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'groupBy', label: 'Group by field (blank = all)', type: 'text' }, { key: 'field', label: 'Value field', type: 'text' }, { key: 'operation', label: 'Operation', type: 'select', options: [{ value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'avg', label: 'Average' }, { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' }] }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `summarize` entry:

```typescript
      node('summarize', 'action', 'Summarize', 'Sigma', 'Sum, avg, min, max, count', {
        data: { config: { groupBy: '', field: '', operation: 'count' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/summarize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/summarize.ts packages/workflows/src/engine/node-handlers/summarize.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement summarize node"
```

---

## Task 11: `date-time` handler

Format the current time, or parse/offset a date field, writing to an output field. Uses the built-in `Date` (no new dependency).

**Files:** Create `date-time.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/date-time.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { dateTimeHandler } from './date-time';
import { createContext } from '../execution-context';

const node = (cfg: Record<string, unknown>) => ({ id: 'dt1', type: 'action', data: { action: 'date-time', config: cfg } });
const ctx = () => createContext(undefined, () => {});

describe('dateTimeHandler', () => {
  it('formats a date field to ISO', async () => {
    const result = await dateTimeHandler(
      node({ field: 'd', operation: 'format', outputField: 'iso' }),
      ctx(),
      [{ json: { d: '2026-01-02T03:04:05.000Z' } }],
    );
    expect((result[0].json as Record<string, unknown>).iso).toBe('2026-01-02T03:04:05.000Z');
  });

  it('adds a duration to a date field', async () => {
    const result = await dateTimeHandler(
      node({ field: 'd', operation: 'add', amount: 1, unit: 'days', outputField: 'next' }),
      ctx(),
      [{ json: { d: '2026-01-01T00:00:00.000Z' } }],
    );
    expect((result[0].json as Record<string, unknown>).next).toBe('2026-01-02T00:00:00.000Z');
  });

  it('writes null for an unparseable date', async () => {
    const result = await dateTimeHandler(
      node({ field: 'd', operation: 'format', outputField: 'iso' }),
      ctx(),
      [{ json: { d: 'not-a-date' } }],
    );
    expect((result[0].json as Record<string, unknown>).iso).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/date-time.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/date-time.ts`:

```typescript
import type { NodeHandler } from './types';

const UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * Date helper. Operations:
 *  - 'now'      → current time as ISO into outputField
 *  - 'format'   → parse field → ISO into outputField
 *  - 'add'      → field + amount*unit → ISO
 *  - 'subtract' → field - amount*unit → ISO
 * An unparseable field writes null.
 */
export const dateTimeHandler: NodeHandler = async (node, _ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const field = (config.field as string) ?? '';
  const operation = (config.operation as string) ?? 'format';
  const outputField = (config.outputField as string) || 'date';
  const amount = Number(config.amount ?? 0);
  const unit = (config.unit as string) ?? 'days';
  const offset = (Number.isFinite(amount) ? amount : 0) * (UNIT_MS[unit] ?? 0);

  return input.map((item) => {
    const json: Record<string, unknown> = { ...item.json };
    let date: Date;
    if (operation === 'now') {
      date = new Date();
    } else {
      date = new Date(item.json[field] as string | number);
      if (Number.isNaN(date.getTime())) {
        json[outputField] = null;
        return { json };
      }
    }
    if (operation === 'add') date = new Date(date.getTime() + offset);
    if (operation === 'subtract') date = new Date(date.getTime() - offset);
    json[outputField] = date.toISOString();
    return { json };
  });
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { dateTimeHandler } from './date-time';
```
```typescript
  'date-time': dateTimeHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'date-time', source: 'host', label: 'Date & Time', kind: 'transform', description: 'Format, parse, offset dates.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'operation', label: 'Operation', type: 'select', options: [{ value: 'format', label: 'Format' }, { value: 'now', label: 'Now' }, { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }] }, { key: 'field', label: 'Date field', type: 'text' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'unit', label: 'Unit', type: 'select', options: [{ value: 'seconds', label: 'Seconds' }, { value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }] }, { key: 'outputField', label: 'Output field', type: 'text' }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `date-time` entry:

```typescript
      node('date-time', 'action', 'Date & Time', 'Clock4', 'Format, parse, offset dates', {
        data: { config: { operation: 'format', field: '', amount: 0, unit: 'days', outputField: 'date' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/date-time.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/date-time.ts packages/workflows/src/engine/node-handlers/date-time.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement date-time node"
```

---

## Task 12: `compare-datasets` handler

Diff two incoming branches by a key field, tagging each result with `__status` (added/removed/changed/same). Reads branches like `merge` does.

**Files:** Create `compare-datasets.ts` + `.test.ts`; modify `index.ts`, `host-nodes.ts`, `constants.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/compare-datasets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { compareDatasetsHandler } from './compare-datasets';
import { createContext } from '../execution-context';

function ctxWith(a: unknown[], b: unknown[]) {
  const c = createContext(undefined, () => {}, [
    { id: 'e1', source: 'A', target: 'cd1' },
    { id: 'e2', source: 'B', target: 'cd1' },
  ]);
  c.nodeOutputs['A'] = a as never;
  c.nodeOutputs['B'] = b as never;
  return c;
}
const node = (key: string) => ({ id: 'cd1', type: 'action', data: { action: 'compare-datasets', config: { key } } });

describe('compareDatasetsHandler', () => {
  it('tags removed, added, changed, and same rows by key', async () => {
    const a = [{ json: { id: 1, v: 'x' } }, { json: { id: 2, v: 'y' } }];
    const b = [{ json: { id: 2, v: 'YY' } }, { json: { id: 3, v: 'z' } }];
    const result = await compareDatasetsHandler(node('id'), ctxWith(a, b), []);
    const byId = Object.fromEntries(result.map((r) => [r.json.id, r.json.__status]));
    expect(byId).toEqual({ 1: 'removed', 2: 'changed', 3: 'added' });
  });

  it('tags identical rows as same', async () => {
    const a = [{ json: { id: 1, v: 'x' } }];
    const b = [{ json: { id: 1, v: 'x' } }];
    const result = await compareDatasetsHandler(node('id'), ctxWith(a, b), []);
    expect(result).toEqual([{ json: { id: 1, v: 'x', __status: 'same' } }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/compare-datasets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/compare-datasets.ts`:

```typescript
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Diff two incoming branches by a key field. Branch order follows edge order:
 * the first incoming edge is "A" (old), the second is "B" (new). Each output
 * item is tagged `__status`: removed (A only), added (B only), changed (key in
 * both, json differs), same. With no key, items are concatenated unchanged.
 */
export const compareDatasetsHandler: NodeHandler = async (node, ctx, _input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const key = (config.key as string) ?? '';
  const branches: WorkflowItem[][] = ctx.edges
    .filter((e) => e.target === node.id)
    .map((e) => ctx.nodeOutputs[e.source])
    .filter((v): v is WorkflowItem[] => Array.isArray(v));
  const a = branches[0] ?? [];
  const b = branches[1] ?? [];
  if (!key) return [...a, ...b];

  const indexBy = (items: WorkflowItem[]) => {
    const m = new Map<string, WorkflowItem>();
    for (const it of items) m.set(String(it.json[key]), it);
    return m;
  };
  const ma = indexBy(a);
  const mb = indexBy(b);
  const out: WorkflowItem[] = [];
  for (const [k, itemA] of ma) {
    const itemB = mb.get(k);
    if (!itemB) out.push({ json: { ...itemA.json, __status: 'removed' } });
    else if (JSON.stringify(itemA.json) !== JSON.stringify(itemB.json)) out.push({ json: { ...itemB.json, __status: 'changed' } });
    else out.push({ json: { ...itemA.json, __status: 'same' } });
  }
  for (const [k, itemB] of mb) {
    if (!ma.has(k)) out.push({ json: { ...itemB.json, __status: 'added' } });
  }
  return out;
};
```

- [ ] **Step 4: Register handler.** In `index.ts`:

```typescript
import { compareDatasetsHandler } from './compare-datasets';
```
```typescript
  'compare-datasets': compareDatasetsHandler,
```

- [ ] **Step 5: Add descriptor.** In `host-nodes.ts`:

```typescript
  { id: 'compare-datasets', source: 'host', label: 'Compare Datasets', kind: 'transform', description: 'Diff two item lists by a key.', ports: { inputs: [port('in')], outputs: [port('out')] }, capabilities: [], config: [{ key: 'key', label: 'Match by field', type: 'text', required: true }] },
```

- [ ] **Step 6: Config default.** In `constants.ts` replace the `compare-datasets` entry:

```typescript
      node('compare-datasets', 'action', 'Compare Datasets', 'GitCompare', 'Diff two item lists', {
        data: { config: { key: '' } },
      }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/compare-datasets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/workflows/src/engine/node-handlers/compare-datasets.ts packages/workflows/src/engine/node-handlers/compare-datasets.test.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/host-nodes.ts apps/web/src/workflows/constants.ts
git commit -m "feat(workflows): implement compare-datasets node"
```

---

## Task 13: Full verification gate

- [ ] **Step 1: Run the workflows package test suite**

Run: `pnpm -C packages/workflows test`
Expected: all tests pass, including the new handler suites and existing `host-nodes`/`node-registry` tests (now reflecting the added descriptors).

- [ ] **Step 2: Typecheck the web package**

Run: `pnpm -C apps/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the web test suite (isolated — never trust a turbo `web#test` red)**

Run: `pnpm -C apps/web test`
Expected: pass (per project convention, run isolated; turbo `web#test` has a known parallel flake).

- [ ] **Step 4: Verify descriptor count parity in the registry test**

The `node-registry` test asserts `nodes.length === HOST_NODE_DESCRIPTORS.length` with no plugins. Adding 9 descriptors keeps this self-consistent (the test reads the constant), so no edit is needed — confirm it still passes from Step 1.

- [ ] **Step 5: Manual smoke (optional, documented for the reviewer).** Per the run-history workstream note, the builder's "Run" executes the full graph manually. To smoke-test: drag e.g. a Manual Trigger → Set (emit a few items) → Sort, configure the field, Run, and confirm the Sort node's Output tab in run history shows ordered items. Switch needs edges connected from its named output handles to observe branch pruning.

- [ ] **Step 6: Final commit (if any uncommitted gate fixups)**

```bash
git add -A
git commit -m "test(workflows): slice A transform nodes — gate green"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Slice A in the inventory spec lists no-op, stop-error, sort, limit, remove-duplicates, rename-keys, split-out, aggregate (A1) + summarize, switch, compare-datasets, date-time (A2), plus dropping edit-fields/item-lists. All 12 nodes + the cleanup have tasks. `wait` is correctly excluded (deferred). ✔
- **Placeholder scan:** every code step has complete code; no TBD/TODO. ✔
- **Type consistency:** all handlers use the `NodeHandler` signature and `WorkflowItem` shape; `switch` is dispatched via `pickHandler` (condition + templateId), all others via `ACTION_HANDLERS[action]`; descriptor objects match `WorkflowNodeDescriptor`/`WorkflowConfigField`. ✔
- **Scope:** single package (`@openldr/workflows`) + one web constants file; no server or DB changes. ✔
