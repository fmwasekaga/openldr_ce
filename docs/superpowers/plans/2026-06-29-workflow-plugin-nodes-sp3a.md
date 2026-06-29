# Plugin-contributed Workflow Nodes — SP-3a (Engine Items Rewrite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `WorkflowItem[]` the single inter-node currency across the whole engine — every handler consumes/produces items, the runner merges + branch-routes items, and the template language adopts the item model.

**Architecture:** Backend-only refactor of `packages/workflows/src/engine/`. No `apps/web`, no new node, no optionsSource (SP-3b). The engine test suite is the regression gate.

**Tech Stack:** TypeScript, Vitest, pnpm/turbo, dependency-cruiser.

**Commits:** Work stays **uncommitted** by convention — do **NOT** `git commit`/`git push`. Each task ends with a verification step.

> **IMPORTANT structural note for the implementer:** changing the `NodeHandler` signature (Task 4) makes package-wide `tsc` RED until every handler is converted (Tasks 4–10). This is expected. **Per-task verification uses `vitest run <file>`** (Vitest/esbuild strips types, so a converted handler's test passes while siblings are mid-conversion). Package `tsc --noEmit` is only required green in the **final gate (Task 12)**. Do not stop mid-refactor because `tsc` is red.

---

## File Structure

**Modify (all under `packages/workflows/src/`):**
- `engine/items.ts` — add `rowsToItems`.
- `engine/execution-context.ts` — `nodeOutputs: Record<string, WorkflowItem[]>`, add `branches`.
- `engine/template.ts` — `$input`/`$json`/`$items`/`$node` over `WorkflowItem[]`.
- `engine/node-handlers/types.ts` — `NodeHandler` signature → items.
- `engine/node-handlers/{trigger,default,log,plugin-node,set,merge,if,filter,code,sql,fhir,http,load-dataset,materialize,export,dhis2-push}.ts` — convert.
- `engine/sandbox.ts` — `input: WorkflowItem[]` + `$json`/`$items`.
- `engine/run-workflow.ts` — `upstreamItemsFor`, branch prune via `ctx.branches`, items typing.
- `sample-workflow.ts` — update `{{ $input… }}` templates to `{{ $json… }}`.
- The matching `*.test.ts` for every file above.

---

## Task 1: `rowsToItems` helper

**Files:** Modify `engine/items.ts`; Modify `engine/items.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `items.test.ts`:

```ts
import { rowsToItems } from './items';
describe('rowsToItems', () => {
  it('wraps each row as an item', () => {
    expect(rowsToItems([{ a: 1 }, { a: 2 }])).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('returns [] for an empty row list', () => {
    expect(rowsToItems([])).toEqual([]);
  });
});
```
(Add `rowsToItems` to the existing top `import … from './items'` instead of a second import if you prefer.)

- [ ] **Step 2: Run → fail**: `pnpm -C packages/workflows exec vitest run src/engine/items.test.ts` → FAIL (no `rowsToItems`).

- [ ] **Step 3: Implement** — append to `items.ts`:

```ts
/** rows → items (source-handler convenience). */
export const rowsToItems = (rows: Record<string, unknown>[]): WorkflowItem[] => rows.map((json) => ({ json }));
```

- [ ] **Step 4: Run → pass**: same command → PASS.

---

## Task 2: Execution context — items-typed outputs + `branches`

**Files:** Modify `engine/execution-context.ts`.

- [ ] **Step 1: Edit the interface + factory**

Change the import line to include `WorkflowItem`:
```ts
import type { WorkflowItem } from './items';
```
Change `nodeOutputs` and add `branches` in `interface ExecutionContext`:
```ts
  /** Output items of every node that has run, keyed by node id. */
  nodeOutputs: Record<string, WorkflowItem[]>;
  /** Branch decision (chosen sourceHandle, e.g. 'true'/'false') set by If/Filter; read by the runner for edge-pruning. */
  branches: Record<string, string>;
```
In `createContext`, initialize `branches`:
```ts
  return { input, nodeOutputs: {}, branches: {}, logs: {}, emit, edges, codeLimits, services, workflowId, logger };
```

- [ ] **Step 2: Verify it compiles in isolation**: `pnpm -C packages/workflows exec vitest run src/engine/items.test.ts` → still PASS (no behavior change here; types used by later tasks).

---

## Task 3: Template language — `$input`/`$json`/`$items`/`$node` over items

**Files:** Modify `engine/template.ts`; Modify `engine/template.test.ts`.

- [ ] **Step 1: Rewrite the tests** to the item model. Replace `template.test.ts` body so cases pass `WorkflowItem[]` as the third arg. Representative cases (keep/adapt the file's existing structure):

```ts
import { describe, it, expect } from 'vitest';
import { resolveTemplate, resolveExpression } from './template';
import { createContext } from './execution-context';
import type { WorkflowItem } from './items';

const items: WorkflowItem[] = [{ json: { name: 'Ada', nested: { n: 1 } } }, { json: { name: 'Bob' } }];
function ctx() {
  const c = createContext(undefined, () => {});
  c.nodeOutputs['up'] = [{ json: { foo: 'bar' } }];
  return c;
}

describe('resolveExpression', () => {
  it('$json reads the first item json', () => {
    expect(resolveExpression('$json.name', ctx(), items)).toBe('Ada');
  });
  it('$items is the array of all jsons', () => {
    expect(resolveExpression('$items', ctx(), items)).toEqual([{ name: 'Ada', nested: { n: 1 } }, { name: 'Bob' }]);
  });
  it('$input is the WorkflowItem[] array', () => {
    expect(resolveExpression('$input', ctx(), items)).toEqual(items);
    expect(resolveExpression('$input.0.json.name', ctx(), items)).toBe('Ada');
  });
  it("$node('id') reads that node's items", () => {
    expect(resolveExpression("$node('up').0.json.foo", ctx(), items)).toBe('bar');
  });
});

describe('resolveTemplate', () => {
  it('substitutes $json fields', () => {
    expect(resolveTemplate('hi {{ $json.name }}', ctx(), items)).toBe('hi Ada');
  });
  it('JSON-stringifies $items', () => {
    expect(resolveTemplate('{{ $items }}', ctx(), items)).toBe(JSON.stringify([{ name: 'Ada', nested: { n: 1 } }, { name: 'Bob' }]));
  });
});
```

- [ ] **Step 2: Run → fail**: `pnpm -C packages/workflows exec vitest run src/engine/template.test.ts`.

- [ ] **Step 3: Implement** — edit `template.ts`:

Change the import + signatures so the third param is `input: WorkflowItem[]`, and compute the three roots:
```ts
import type { ExecutionContext } from './execution-context';
import type { WorkflowItem } from './items';
```
Replace `resolveExpression` body’s `$input`/`$json` block (and add `$items`):
```ts
export function resolveExpression(
  expression: string,
  ctx: ExecutionContext,
  input: WorkflowItem[],
): unknown {
  const trimmed = expression.trim();

  const nodeMatch = trimmed.match(NODE_CALL_RE);
  if (nodeMatch) {
    const [, nodeId, rest] = nodeMatch;
    return readPath(ctx.nodeOutputs[nodeId], rest);
  }

  if (trimmed.startsWith('$items')) {
    return readPath(input.map((i) => i.json), trimmed.slice('$items'.length));
  }
  if (trimmed.startsWith('$input')) {
    return readPath(input, trimmed.slice('$input'.length));
  }
  if (trimmed.startsWith('$json')) {
    return readPath(input[0]?.json, trimmed.slice('$json'.length));
  }
  return `{{ ${trimmed} }}`;
}
```
Update `resolveTemplate` and `resolveTemplatesDeep` third-param type from `upstreamOutput: unknown` to `input: WorkflowItem[]` and pass `input` through (rename the variable consistently). Keep `readPath`/`EXPR_RE`/`NODE_CALL_RE` unchanged.

> Note: `$items` is checked **before** `$input` so the `startsWith` doesn’t mis-match (`$items` does not start with `$input`, but order keeps it obvious). `readPath` already handles numeric segments (`.0.json.name`).

- [ ] **Step 4: Run → pass**: `pnpm -C packages/workflows exec vitest run src/engine/template.test.ts`.

---

## Task 4: `NodeHandler` signature + trivial handlers (trigger, default, log, plugin-node)

**Files:** Modify `engine/node-handlers/types.ts`, `trigger.ts`, `default.ts`, `log.ts`, `plugin-node.ts` + their tests.

- [ ] **Step 1: Change the signature** in `types.ts`:

```ts
import type { ExecutionContext } from '../execution-context';
import type { WorkflowItem } from '../items';

export interface RunnerNode { id: string; type: string; data: Record<string, unknown>; }

export type NodeHandler = (
  node: RunnerNode,
  ctx: ExecutionContext,
  input: WorkflowItem[],
) => Promise<WorkflowItem[]> | WorkflowItem[];
```

- [ ] **Step 2: Convert `trigger.ts`**:

```ts
import type { NodeHandler } from './types';
import { toItems } from '../items';

/** Triggers have no upstream — their output is the run's initial input, normalized to items. */
export const triggerHandler: NodeHandler = async (node, ctx) => {
  if (ctx.input !== undefined) return toItems(ctx.input);
  return [{ json: {
    triggered: true,
    triggerType: (node.data.triggerType as string | undefined) ?? 'manual',
    timestamp: new Date().toISOString(),
  } }];
};
```

- [ ] **Step 3: Convert `default.ts`** (passthrough items):

```ts
import type { NodeHandler } from './types';

/** Fallback for unimplemented node types — passes items through unchanged. */
export const defaultHandler: NodeHandler = async (_node, _ctx, input) => input;
```

- [ ] **Step 4: Convert `log.ts`** (passthrough + log):

```ts
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { LogLevel } from '../../types';

export const logHandler: NodeHandler = async (node, ctx, input) => {
  const rawMessage = (node.data.message as string | undefined) ?? '';
  const level = ((node.data.level as LogLevel | undefined) ?? 'log') as LogLevel;
  const message = resolveTemplate(rawMessage, ctx, input);
  const entry = { nodeId: node.id, level, message, ts: Date.now() };
  (ctx.logs[node.id] ??= []).push(entry);
  ctx.emit({ type: 'node:log', entry });
  return input;
};
```

- [ ] **Step 5: Convert `plugin-node.ts`** (return `result.items`; meta → log):

```ts
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

export const pluginNodeHandler: NodeHandler = async (node, ctx, input) => {
  const data = node.data as { pluginId?: unknown; nodeId?: unknown; kind?: unknown; config?: unknown };
  const pluginId = String(data.pluginId ?? '').trim();
  const nodeId = String(data.nodeId ?? '').trim();
  if (!pluginId || !nodeId) throw new Error('plugin node: pluginId and nodeId are required');
  if (!ctx.services?.runPluginNode) throw new Error('plugin node execution is not available');

  const kind = String(data.kind ?? 'transform');
  const config = (data.config && typeof data.config === 'object' && !Array.isArray(data.config)
    ? (data.config as Record<string, unknown>) : {});
  const items: WorkflowItem[] = kind === 'source' ? [] : input;
  const result = await ctx.services.runPluginNode({ pluginId, nodeId, config, items });
  if (result.meta && Object.keys(result.meta).length > 0) {
    const entry = { nodeId: node.id, level: 'info' as const, message: `plugin meta: ${JSON.stringify(result.meta)}`, ts: Date.now() };
    (ctx.logs[node.id] ??= []).push(entry);
    ctx.emit({ type: 'node:log', entry });
  }
  return result.items;
};
```

- [ ] **Step 6: Update the 4 tests** to the item model:
  - `trigger.test`: with `ctx.input` set → `toItems(input)`; without → `[{ json: { triggered:true, triggerType, timestamp } }]` (assert shape, not the timestamp value).
  - `default.test` (if present): returns its input items unchanged.
  - `log.test`: feed `[{ json: { body:{ name:'x' } } }]`; assert the emitted entry message resolves `{{ $json.body.name }}`; assert it returns the input items unchanged.
  - `plugin-node.test`: update the transform case so the handler returns `result.items` (mock `runPluginNode` → `{ items:[{json:{ok:true}}], meta:{count:1} }`); assert it returns `[{json:{ok:true}}]` and that a `node:log` with the meta was emitted; keep the "missing service throws" + "ids required" cases (now input is `[]`/items).

- [ ] **Step 7: Verify** each: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/trigger.test.ts src/engine/node-handlers/log.test.ts src/engine/node-handlers/plugin-node.test.ts` (+ default if it has a test) → PASS.

---

## Task 5: `set` + `merge`

**Files:** Modify `set.ts`, `merge.ts` + tests.

- [ ] **Step 1: Convert `set.ts`** (one output item per input item; per-item templates):

```ts
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { WorkflowItem } from '../items';

export const setHandler: NodeHandler = async (node, ctx, input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const fields = (config.fields as Array<{ name: string; value: string }>) ?? [];
  const keepExisting = Boolean(config.keepExisting);
  const sources: WorkflowItem[] = input.length > 0 ? input : [{ json: {} }];
  return sources.map((item) => {
    const base: Record<string, unknown> = keepExisting ? { ...item.json } : {};
    for (const field of fields) {
      if (!field.name) continue;
      base[field.name] = resolveTemplate(field.value ?? '', ctx, [item]);
    }
    return { json: base };
  });
};
```

- [ ] **Step 2: Convert `merge.ts`** (reads all incoming branches from `ctx.nodeOutputs`):

```ts
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

export const mergeHandler: NodeHandler = async (node, ctx, _input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mode = (config.mode as string) ?? 'append';
  const branches: WorkflowItem[][] = ctx.edges
    .filter((e) => e.target === node.id)
    .map((e) => ctx.nodeOutputs[e.source])
    .filter((v): v is WorkflowItem[] => Array.isArray(v));

  switch (mode) {
    case 'combine': {
      const merged: Record<string, unknown> = {};
      for (const items of branches) for (const it of items) Object.assign(merged, it.json);
      return [{ json: merged }];
    }
    case 'chooseBranch': {
      const index = Number(config.preferredBranch ?? 0);
      return branches[index] ?? branches[0] ?? [];
    }
    case 'append':
    default:
      return branches.flat();
  }
};
```

- [ ] **Step 3: Update `set.test` + `merge.test`**:
  - `set`: input `[{json:{a:1}}]`, fields `[{name:'b', value:'{{ $json.a }}'}]`, keepExisting false → `[{json:{b:'1'}}]`; keepExisting true → `[{json:{a:1,b:'1'}}]`; empty input → one item from `{}` base.
  - `merge`: seed `ctx.nodeOutputs` for two source ids + `ctx.edges` targeting the merge node; append → concatenated items; combine → one merged-json item; chooseBranch → the picked branch's items.

- [ ] **Step 4: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/set.test.ts src/engine/node-handlers/merge.test.ts` → PASS.

---

## Task 6: `if` + `filter` (branch via `ctx.branches`)

**Files:** Modify `if.ts`, `filter.ts` + tests.

- [ ] **Step 1: Convert `if.ts`**:

```ts
import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

/** Whole-input boolean: evaluates the condition, records the branch in ctx.branches[id],
 *  and passes the input items through (the chosen outgoing handle carries them). */
export const ifHandler: NodeHandler = async (node, ctx, input) => {
  const resolved = resolveTemplate((node.data.condition as string | undefined) ?? '', ctx, input);
  let branch: 'true' | 'false' = 'false';
  if (resolved.trim()) {
    try {
      const sandbox = { $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input };
      branch = vm.runInNewContext(resolved, sandbox, { timeout: 1000 }) ? 'true' : 'false';
    } catch (err) {
      throw new Error(`Condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = branch;
  return input;
};
```

- [ ] **Step 2: Convert `filter.ts`** (per-item; single 'true' handle):

```ts
import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { WorkflowItem } from '../items';

export const filterHandler: NodeHandler = async (node, ctx, input) => {
  const raw = (node.data.condition as string | undefined) ?? '';
  const passes = (item: WorkflowItem): boolean => {
    const resolved = resolveTemplate(raw, ctx, [item]);
    if (!resolved.trim()) return false;
    try {
      const sandbox = { $input: [item], $json: item.json, $items: [item.json], input: [item] };
      return Boolean(vm.runInNewContext(resolved, sandbox, { timeout: 1000 }));
    } catch (err) {
      throw new Error(`Filter condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const kept = input.filter(passes);
  ctx.branches[node.id] = kept.length > 0 ? 'true' : 'false';
  return kept;
};
```

- [ ] **Step 3: Update `if.test` + `filter.test`**:
  - `if`: condition `$json.n > 0` with input `[{json:{n:1}}]` → returns input unchanged AND `ctx.branches[node.id]==='true'`; `n:-1` → `'false'`; empty condition → `'false'`.
  - `filter`: condition `$json.keep === true`, input `[{json:{keep:true}},{json:{keep:false}}]` → returns `[{json:{keep:true}}]` and `ctx.branches==='true'`; all-fail → `[]` and `'false'`.
  Construct ctx via `createContext` so `ctx.branches` exists.

- [ ] **Step 4: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/if.test.ts src/engine/node-handlers/filter.test.ts` → PASS.

---

## Task 7: `code` + `sandbox`

**Files:** Modify `code.ts`, `sandbox.ts` + tests.

- [ ] **Step 1: Convert `code.ts`**: change the empty-code early return to `return input;`; change `input: upstream` → `input` (the items arg); and `toItems` the sandbox return:

```ts
import type { NodeHandler } from './types';
import { runInSandbox } from '../sandbox';
import { toItems } from '../items';
```
- empty code: `if (!code.trim()) return input;`
- the disabled-check + warning block stay unchanged.
- the call:
```ts
  try {
    const result = await runInSandbox(code, {
      input,
      nodeOutputs: ctx.nodeOutputs,
      limits: ctx.codeLimits,
      onLog: (level, message) => {
        const entry = { nodeId: node.id, level, message, ts: Date.now() };
        (ctx.logs[node.id] ??= []).push(entry);
        ctx.emit({ type: 'node:log', entry });
      },
    });
    return toItems(result);
  } catch (err) {
    throw new Error(`Code node error: ${err instanceof Error ? err.message : String(err)}`);
  }
```

- [ ] **Step 2: Convert `sandbox.ts`**: type `input` as items + expose `$json`/`$items` in the worker bootstrap.
  - `import type { WorkflowItem } from './items';`
  - `RunInSandboxOpts.input: WorkflowItem[]`; `nodeOutputs: Record<string, WorkflowItem[]>`.
  - In `BOOTSTRAP_JS`, extend the `sandbox` object:
```js
const sandbox = {
  $input: input,
  $json: (input && input[0]) ? input[0].json : undefined,
  $items: Array.isArray(input) ? input.map((i) => i && i.json) : [],
  input,
  $node: (id) => (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, id)) ? nodeOutputs[id] : undefined,
  console: { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('log') },
};
```

- [ ] **Step 3: Update `code.test` + `sandbox.test`**:
  - `code`: enabled limits; code `return [{ json: { doubled: $json.n * 2 } }]` with input `[{json:{n:2}}]` → `[{json:{doubled:4}}]`; code returning a bare object `return { a: 1 }` → `toItems` → `[{json:{a:1}}]`; empty code → returns input unchanged; disabled → throws.
  - `sandbox`: pass `input: [{ json: { n: 5 } }]`; `return $json.n` → `5` (then `code.ts` wraps); keep the escape-documentation test. Adjust any `input` fixtures to items.

- [ ] **Step 4: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/code.test.ts src/engine/sandbox.test.ts` → PASS.

---

## Task 8: Source handlers — `sql`, `fhir`, `http`, `load-dataset`

**Files:** Modify `sql.ts`, `fhir.ts`, `http.ts`, `load-dataset.ts` + tests.

- [ ] **Step 1: Convert `sql.ts`**:

```ts
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { rowsToItems } from '../items';

export const sqlHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('SQL node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const sql = resolveTemplate(String(config.sql ?? ''), ctx, input);
  if (!sql.trim()) throw new Error('SQL node: query is required');
  const result = await ctx.services.runSql(sql);
  return rowsToItems(result.rows);
};
```

- [ ] **Step 2: Convert `fhir.ts`**:

```ts
import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

export const fhirHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services) throw new Error('FHIR node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const resourceType = String(config.resourceType ?? '').trim();
  if (!resourceType) throw new Error('FHIR node: resourceType is required');
  const limit = Number(config.limit ?? 100);
  const { resources } = await ctx.services.fhirQuery(resourceType, Number.isFinite(limit) && limit > 0 ? limit : 100);
  return resources.map((r): WorkflowItem => ({ json: (r && typeof r === 'object' && !Array.isArray(r) ? r : { value: r }) as Record<string, unknown> }));
};
```

- [ ] **Step 3: Convert `http.ts`**: keep the existing resolve logic (third arg now `input`); wrap the single response as one item:

```ts
  const response = await ctx.services.httpFetch({ url, method, headers, body });
  return [{ json: { status: response.status, headers: response.headers, data: response.data } }];
```
(Change each `resolveTemplate(..., ctx, upstream)` / `resolveTemplatesDeep(..., ctx, upstream)` call's third arg to `input`, and the handler param to `input`.)

- [ ] **Step 4: Convert `load-dataset.ts`**:

```ts
import type { NodeHandler } from './types';
import { rowsToItems } from '../items';

export const loadDatasetHandler: NodeHandler = async (node, ctx) => {
  if (!ctx.services) throw new Error('Load Dataset node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Load Dataset node: datasetName is required');
  const { rows } = await ctx.services.loadDataset(name);
  return rowsToItems(rows);
};
```

- [ ] **Step 5: Update the 4 tests**: mock `ctx.services` (via `createContext` then assign `c.services = {...}`); assert items out. E.g. `sql` → `runSql` resolves `{columns:[…], rows:[{a:1}]}` → handler returns `[{json:{a:1}}]`; `fhir` → `{resources:[{id:'p1'}]}` → `[{json:{id:'p1'}}]`; `http` → response → single item with status/headers/data; `load-dataset` → rows → items.

- [ ] **Step 6: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/sql.test.ts src/engine/node-handlers/fhir.test.ts src/engine/node-handlers/http.test.ts src/engine/node-handlers/load-dataset.test.ts` → PASS.

---

## Task 9: Sink handlers — `materialize`, `export`, `dhis2-push`

**Files:** Modify `materialize.ts`, `export.ts`, `dhis2-push.ts` + tests.

- [ ] **Step 1: Convert `materialize.ts`** (consume items via `fromItems`; pass items through):

```ts
import type { NodeHandler } from './types';
import { fromItems } from '../items';

export const materializeHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Materialize node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const name = String(config.datasetName ?? '').trim();
  if (!name) throw new Error('Materialize node: datasetName is required');
  const { columns, rows } = fromItems(input);
  await ctx.services.materializeDataset(name, columns, rows, ctx.workflowId ?? null);
  return input;
};
```

- [ ] **Step 2: Convert `export.ts`**:

```ts
import type { NodeHandler } from './types';
import { fromItems } from '../items';

export const exportHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Export node requires server services');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const format = String(config.format ?? 'csv') as 'csv' | 'xlsx' | 'pdf';
  const { columns, rows } = fromItems(input);
  await ctx.services.exportArtifact({
    format,
    filename: config.filename as string | undefined,
    title: (node.data.label as string) ?? 'Workflow Export',
    columns,
    rows,
  });
  return input;
};
```

- [ ] **Step 3: Convert `dhis2-push.ts`** (config-driven; pass items through):

```ts
import type { NodeHandler } from './types';

export const dhis2PushHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services?.dhis2Push) {
    throw new Error('DHIS2 push not available (DHIS2 is not the configured reporting target)');
  }
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mappingId = String(config.mappingId ?? '').trim();
  const period = String(config.period ?? '').trim();
  if (!mappingId || !period) throw new Error('DHIS2 push node: mappingId and period are required');
  await ctx.services.dhis2Push({ mappingId, period, dryRun: Boolean(config.dryRun) });
  return input;
};
```

- [ ] **Step 4: Update the 3 tests**: feed items `[{json:{facility:'f1',value:2}}]`; assert the service is called with `fromItems`-derived `columns`/`rows` (materialize/export) or the config (dhis2-push), and that the handler returns the input items unchanged. **This is the plugin→host-sink interop at the unit level** (the sink reads a plugin's items).

- [ ] **Step 5: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/materialize.test.ts src/engine/node-handlers/export.test.ts src/engine/node-handlers/dhis2-push.test.ts` → PASS.

---

## Task 10: Runner — merge upstream items + branch prune via `ctx.branches`

**Files:** Modify `run-workflow.ts`; Modify `run-workflow.test.ts`.

- [ ] **Step 1: Replace `upstreamOutputFor` with `upstreamItemsFor`**:

```ts
import type { WorkflowItem } from './items';
```
```ts
/**
 * Feed each node the concatenation of all ran, non-skipped upstream edges' item
 * arrays. Single-input → that node's items; multi-input → concatenation (Merge
 * relies on this). Sources with no upstream get [].
 */
function upstreamItemsFor(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodeOutputs: Record<string, WorkflowItem[]>,
  skippedEdges: Set<string>,
): WorkflowItem[] {
  const out: WorkflowItem[] = [];
  for (const edge of edges) {
    if (edge.target !== node.id) continue;
    if (skippedEdges.has(edge.id)) continue;
    const items = nodeOutputs[edge.source];
    if (Array.isArray(items)) out.push(...items);
  }
  return out;
}
```

- [ ] **Step 2: Use it + branch-prune via `ctx.branches`.** In the run loop:
  - replace `const upstream = upstreamOutputFor(node, edges, ctx.nodeOutputs);` with
    `const input = upstreamItemsFor(node, edges, ctx.nodeOutputs, skippedEdges);`
  - `const output = await handler(node, ctx, input);` and `ctx.nodeOutputs[node.id] = output;`
  - the `node:success` event uses `input` and `output` (both items).
  - **Replace** the whole `if (node.type === 'condition' && output && … output.branch …)` block with a generic branch read:
```ts
      // Branch pruning: If/Filter record their chosen handle in ctx.branches.
      const branch = ctx.branches[node.id];
      if (branch !== undefined) {
        for (const e of edges.filter((edge) => edge.source === node.id)) {
          if (e.sourceHandle && e.sourceHandle !== branch) skippedEdges.add(e.id);
        }
      }
```
  - `NodeRunResult.output?: unknown` may stay `unknown` (it holds items now); no change needed, or tighten to `WorkflowItem[]`.

- [ ] **Step 3: Update `run-workflow.test`** to the item model:
  - a linear manual-trigger → set → log chain produces items end-to-end; `results[*].output` are items[].
  - **multi-input merge**: two sources → a merge(append) node receives both branches' items concatenated.
  - **branch prune (If)**: an `if` whose `false` handle leads to node B and `true` to node C; with a true condition, B is `skipped`, C runs. Assert via `results` statuses + `ctx`-independent output.
  - **branch prune (Filter)**: a filter that drops all items → its single `true`-handle downstream node is skipped.
  - **plugin-node → materialize**: a `plugin-node` (fake `services.runPluginNode` → `{items:[{json:{a:1}}]}`) feeding a `materialize` node (fake `services.materializeDataset` spy) → assert the spy received `rows: [{a:1}]` (the north-star interop).

- [ ] **Step 4: Verify**: `pnpm -C packages/workflows exec vitest run src/engine/run-workflow.test.ts` → PASS.

---

## Task 11: Seeded sample workflow templates

**Files:** Modify `packages/workflows/src/sample-workflow.ts` (+ its test if any).

- [ ] **Step 1: Update templates** — change any `{{ $input.x }}` / `{{ $input }}` in the sample node data to the new model (`{{ $json.x }}` for a field, `{{ $items }}` for the whole list). If a Log node uses `{{ $input }}`, make it `{{ $json }}` (first item) or `{{ $items }}` (all) — pick whichever the sample's intent matches.

- [ ] **Step 2: Verify** the sample still parses/serializes: `pnpm -C packages/workflows exec vitest run` (whole package) — the sample-workflow test (if present) + everything else should pass. (If there is no sample test, this is covered by Task 12.)

---

## Task 12: Full gate

- [ ] **Step 1: Typecheck (forced)** — now that every handler is converted: `pnpm turbo run typecheck --force`. Expected: all packages PASS (watch `@openldr/workflows`, `@openldr/bootstrap`, `@openldr/server`).

- [ ] **Step 2: Dependency-cruiser**: `pnpm depcruise` → 0 errors (no new package edges; engine-internal change).

- [ ] **Step 3: Targeted suites**:
  - `pnpm -C packages/workflows exec vitest run` (the big one — all handler/template/runner/sandbox/items tests).
  - `pnpm -C packages/bootstrap exec vitest run` (the `plugin-node-service` exercises the engine types).
  - `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`.
  Expected: all PASS.

- [ ] **Step 4: Build (forced)**: `pnpm turbo run build --force` → PASS. (`@openldr/web` chunk-size warning is pre-existing/unrelated; no web code changed.)

- [ ] **Step 5: Acceptance check** — confirm from output:
  - Every node passes `WorkflowItem[]`; `nodeOutputs` are items.
  - A `plugin-node → materialize` chain feeds the sink the plugin's items via `fromItems` (run-workflow test).
  - If/Filter branch-prune via `ctx.branches` (run-workflow test).
  - Templates resolve `$json`/`$items`/`$input`/`$node('id')` (template test).
  - No `apps/web` file changed.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 items helper; 2 ctx (branches + items outputs); 3 template; 4 signature + trivial handlers; 5 set/merge; 6 if/filter (branches); 7 code/sandbox; 8 sources; 9 sinks; 10 runner (merge + prune); 11 sample; 12 gate. Every handler in the spec's table has a task.
- **Type consistency:** `NodeHandler` returns `WorkflowItem[]`; `nodeOutputs: Record<string, WorkflowItem[]>`; `ctx.branches: Record<string,string>`; template/sandbox third arg is `WorkflowItem[]`; sinks use `fromItems`, sources use `rowsToItems`. The plugin-node handler returns `result.items` (matches `RunPluginNodeOutput`).
- **Mid-refactor red `tsc` is expected** (signature change ripples) — per-task verification is `vitest run <file>`; package `tsc` only at Task 12.
- **Additive boundary:** no `apps/web` edits; the public `@openldr/workflows` barrel exports gain nothing (internal types already exported in SP-2). `runWorkflow`/`WorkflowServices`/route signatures are unchanged externally.
