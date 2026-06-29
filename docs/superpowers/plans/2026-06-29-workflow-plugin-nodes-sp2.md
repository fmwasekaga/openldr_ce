# Plugin-contributed Workflow Nodes — SP-2 (Generic Execution Handler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute plugin-contributed workflow nodes at run time via one generic `plugin-node` engine handler that resolves the plugin, enforces declared capabilities like the broker, resolves connectors, invokes the wasm `{items,config}→{items,meta}` entrypoint (foreground or pinned-host worker egress), and maps the result back into the item stream.

**Architecture:** The engine (`@openldr/workflows`) stays free of `@openldr/plugins`/`bootstrap`; a `plugin-node` handler forwards a normalized `{pluginId,nodeId,config,items}` request to an injected optional `WorkflowServices.runPluginNode`, implemented in `bootstrap` (where `loadSink`, the connector store, and the broker live) — exactly mirroring the existing `dhis2Push` service. A real `wf_echo` wasm fixture in `wasm/test-sink` proves the ABI through real Extism.

**Tech Stack:** TypeScript, zod, Fastify, Vitest, pnpm/turbo, Rust + `wasm32-wasip1` (Extism PDK), dependency-cruiser.

**Commits:** This repo keeps work **uncommitted** by convention — do **NOT** `git commit` or `git push`. Each task ends with a verification step instead of a commit step.

---

## File Structure

**Create:**
- `packages/workflows/src/engine/items.ts` (+ `.test.ts`) — `WorkflowItem`/`BinaryRef` types + `toItems`/`fromItems` (minimal SP-2 boundary; canonical shim is SP-3).
- `packages/workflows/src/engine/node-handlers/plugin-node.ts` (+ `.test.ts`) — `pluginNodeHandler`.
- `packages/bootstrap/src/plugin-node-policy.ts` (+ `.test.ts`) — `assertNodeAllowed` + `capsSubset` (shared, factored).
- `packages/bootstrap/src/plugin-node-service.ts` (+ `.test.ts`) — `createPluginNodeService` → `runPluginNode`.
- `packages/plugins/src/wf-echo.integration.test.ts` — `wf_echo` through the real Extism runner.

**Modify:**
- `packages/workflows/src/engine/services.ts` — `RunPluginNodeInput`/`RunPluginNodeOutput` types + optional `runPluginNode`.
- `packages/workflows/src/engine/node-handlers/index.ts` — register `plugin-node`.
- `packages/workflows/src/index.ts` — export item + plugin-node-service types.
- `packages/bootstrap/src/index.ts` — construct + assign `workflowServices.runPluginNode`.
- `wasm/test-sink/src/lib.rs` — `wf_echo` entrypoint.
- `scripts/build-test-sink.mjs` — add `wf_echo` to `entrypoints` + a `workflowNodes` decl; rebuild.

---

## Task 1: `items.ts` — wire types + `toItems`/`fromItems`

**Files:**
- Create: `packages/workflows/src/engine/items.ts`
- Create: `packages/workflows/src/engine/items.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toItems, fromItems, type WorkflowItem } from './items';

describe('toItems', () => {
  it('passes a WorkflowItem[] through unchanged', () => {
    const items: WorkflowItem[] = [{ json: { a: 1 } }, { json: { b: 2 } }];
    expect(toItems(items)).toBe(items);
  });
  it('maps {columns,rows} to one item per row', () => {
    const out = toItems({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }] });
    expect(out).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('maps {rows} to one item per row', () => {
    expect(toItems({ rows: [{ a: 1 }] })).toEqual([{ json: { a: 1 } }]);
  });
  it('maps a plain object-array to one item per object', () => {
    expect(toItems([{ a: 1 }, { a: 2 }])).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('returns [] for undefined/null', () => {
    expect(toItems(undefined)).toEqual([]);
    expect(toItems(null)).toEqual([]);
  });
  it('wraps a scalar as a single item', () => {
    expect(toItems(42)).toEqual([{ json: { value: 42 } }]);
  });
  it('wraps a bare object as a single item', () => {
    expect(toItems({ a: 1 })).toEqual([{ json: { a: 1 } }]);
  });
});

describe('fromItems', () => {
  it('produces rows + a column union from item json', () => {
    const out = fromItems([{ json: { a: 1 } }, { json: { a: 2, b: 3 } }]);
    expect(out.rows).toEqual([{ a: 1 }, { a: 2, b: 3 }]);
    expect(out.columns).toEqual([{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/items.test.ts`
Expected: FAIL — cannot resolve `./items`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/workflows/src/engine/items.ts`:

```ts
/** n8n-style wire item. The binary lane is declared now but unused until SP-4. */
export interface BinaryRef {
  objectKey: string;
  contentType: string;
  fileName?: string;
  byteSize: number;
}
export interface WorkflowItem {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryRef>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Every element is an object carrying a `json` object → already WorkflowItem[]. ([] qualifies.) */
function isItemArray(v: unknown): v is WorkflowItem[] {
  return Array.isArray(v) && v.every((e) => isRecord(e) && isRecord((e as { json?: unknown }).json));
}

/**
 * Normalize an upstream node output into WorkflowItem[]. SP-2 minimal boundary (the canonical
 * shim is SP-3): WorkflowItem[] passes through; `{columns,rows}`/`{rows}` → one item per row;
 * a plain object-array → one item per object; undefined/null → []; any other value → a single
 * wrapped item `{ json: { value } }`.
 */
export function toItems(upstream: unknown): WorkflowItem[] {
  if (upstream === undefined || upstream === null) return [];
  if (isItemArray(upstream)) return upstream;
  if (isRecord(upstream) && Array.isArray((upstream as { rows?: unknown }).rows)) {
    return (upstream as { rows: unknown[] }).rows.map((r) => ({ json: isRecord(r) ? r : { value: r } }));
  }
  if (Array.isArray(upstream)) {
    return upstream.map((r) => ({ json: isRecord(r) ? r : { value: r } }));
  }
  if (isRecord(upstream)) return [{ json: upstream }];
  return [{ json: { value: upstream } }];
}

/** Inverse for host-node interop: items → { columns, rows }; columns = union of row keys in order. */
export function fromItems(items: WorkflowItem[]): { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } {
  const rows = items.map((i) => i.json);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  return { columns: keys.map((k) => ({ key: k, label: k })), rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/engine/items.test.ts`
Expected: PASS (8 tests).

---

## Task 2: `WorkflowServices.runPluginNode` contract

**Files:**
- Modify: `packages/workflows/src/engine/services.ts`

- [ ] **Step 1: Add the types + optional method**

Modify `packages/workflows/src/engine/services.ts`.

(a) Add an import at the top (after the existing imports, before the first interface):

```ts
import type { WorkflowItem } from './items';
```

(b) Add these two interfaces immediately above `export interface WorkflowServices {`:

```ts
export interface RunPluginNodeInput {
  pluginId: string;
  /** The node decl id within the plugin (NOT the `${pluginId}:${id}` composite). */
  nodeId: string;
  config: Record<string, unknown>;
  items: WorkflowItem[];
}
export interface RunPluginNodeOutput {
  items: WorkflowItem[];
  meta?: Record<string, unknown>;
}
```

(c) Inside `interface WorkflowServices`, after the `dhis2Push?(...)` line, add:

```ts
  /** Execute a plugin-contributed workflow node. Injected at bootstrap (like dhis2Push); absent in
   *  pure-engine tests and legacy paths. */
  runPluginNode?(input: RunPluginNodeInput): Promise<RunPluginNodeOutput>;
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: PASS (no errors).

---

## Task 3: `plugin-node` handler + registration + exports

**Files:**
- Create: `packages/workflows/src/engine/node-handlers/plugin-node.ts`
- Create: `packages/workflows/src/engine/node-handlers/plugin-node.test.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Modify: `packages/workflows/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/engine/node-handlers/plugin-node.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { pluginNodeHandler } from './plugin-node';
import { createContext } from '../execution-context';
import type { RunnerNode } from './types';

function ctxWith(runPluginNode?: ReturnType<typeof vi.fn>) {
  const ctx = createContext(undefined, () => {});
  ctx.services = runPluginNode ? ({ runPluginNode } as never) : undefined;
  return ctx;
}
const node = (data: Record<string, unknown>): RunnerNode => ({ id: 'n1', type: 'plugin-node', data });

describe('pluginNodeHandler', () => {
  it('forwards pluginId/nodeId/config and toItems(upstream) for a transform node', async () => {
    const run = vi.fn().mockResolvedValue({ items: [{ json: { ok: true } }] });
    const ctx = ctxWith(run);
    const out = await pluginNodeHandler(node({ pluginId: 'p', nodeId: 'echo', kind: 'transform', config: { note: 'x' } }), ctx, { rows: [{ a: 1 }] });
    expect(run).toHaveBeenCalledWith({ pluginId: 'p', nodeId: 'echo', config: { note: 'x' }, items: [{ json: { a: 1 } }] });
    expect(out).toEqual({ items: [{ json: { ok: true } }] });
  });

  it('passes items:[] for a source node (ignores upstream)', async () => {
    const run = vi.fn().mockResolvedValue({ items: [] });
    const ctx = ctxWith(run);
    await pluginNodeHandler(node({ pluginId: 'p', nodeId: 'src', kind: 'source', config: {} }), ctx, { rows: [{ a: 1 }] });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ items: [] }));
  });

  it('throws when the service is not available', async () => {
    const ctx = ctxWith(undefined);
    await expect(pluginNodeHandler(node({ pluginId: 'p', nodeId: 'echo' }), ctx, undefined))
      .rejects.toThrow(/not available/i);
  });

  it('throws when pluginId or nodeId is missing', async () => {
    const ctx = ctxWith(vi.fn());
    await expect(pluginNodeHandler(node({ pluginId: 'p' }), ctx, undefined)).rejects.toThrow(/required/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/plugin-node.test.ts`
Expected: FAIL — cannot resolve `./plugin-node`.

- [ ] **Step 3: Write the handler**

Create `packages/workflows/src/engine/node-handlers/plugin-node.ts`:

```ts
import type { NodeHandler } from './types';
import { toItems, type WorkflowItem } from '../items';

/**
 * Generic handler for a plugin-contributed node (node.type === 'plugin-node'). The saved node
 * carries { pluginId, nodeId, kind, config }. Execution is delegated to the injected
 * ctx.services.runPluginNode (implemented at bootstrap) so the engine stays free of plugin code.
 * Source-kind nodes ignore upstream and send items:[]; others send toItems(upstream).
 */
export const pluginNodeHandler: NodeHandler = async (node, ctx, upstream) => {
  const data = node.data as { pluginId?: unknown; nodeId?: unknown; kind?: unknown; config?: unknown };
  const pluginId = String(data.pluginId ?? '').trim();
  const nodeId = String(data.nodeId ?? '').trim();
  if (!pluginId || !nodeId) throw new Error('plugin node: pluginId and nodeId are required');
  if (!ctx.services?.runPluginNode) throw new Error('plugin node execution is not available');

  const kind = String(data.kind ?? 'transform');
  const config = (data.config && typeof data.config === 'object' && !Array.isArray(data.config)
    ? (data.config as Record<string, unknown>) : {});
  const items: WorkflowItem[] = kind === 'source' ? [] : toItems(upstream);
  return ctx.services.runPluginNode({ pluginId, nodeId, config, items });
};
```

- [ ] **Step 4: Register the handler**

Modify `packages/workflows/src/engine/node-handlers/index.ts`:

(a) Add an import after the existing handler imports (after the `loadDatasetHandler` import):

```ts
import { pluginNodeHandler } from './plugin-node';
```

(b) In `const TYPE_HANDLERS`, add the `plugin-node` entry:

```ts
const TYPE_HANDLERS: Record<string, NodeHandler> = {
  trigger: triggerHandler,
  code: codeHandler,
  'plugin-node': pluginNodeHandler,
};
```

- [ ] **Step 5: Export the new types from the workflows barrel**

Modify `packages/workflows/src/index.ts`. Add two lines at the end:

```ts
export { toItems, fromItems, type WorkflowItem, type BinaryRef } from './engine/items';
export { type RunPluginNodeInput, type RunPluginNodeOutput } from './engine/services';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C packages/workflows exec vitest run src/engine/node-handlers/plugin-node.test.ts`
Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: PASS (4 tests) and no type errors.

---

## Task 4: `assertNodeAllowed` (shared capability/egress enforcement)

**Files:**
- Create: `packages/bootstrap/src/plugin-node-policy.ts`
- Create: `packages/bootstrap/src/plugin-node-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/plugin-node-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertNodeAllowed, capsSubset } from './plugin-node-policy';
import type { Grant } from '@openldr/marketplace';

const row = (caps: unknown, enabled = true) => ({
  id: 'p', enabled,
  manifest: { capabilities: caps } as Record<string, unknown>,
});
const decl = (capabilities: string[]) => ({ id: 'n', capabilities });

describe('capsSubset', () => {
  it('allows when legacy', () => {
    expect(capsSubset(['net-egress'], { legacy: true } as Grant)).toBe(true);
  });
  it('allows a subset and rejects a superset', () => {
    const g: Grant = { legacy: false, capabilities: [{ kind: 'host:connectors' }] };
    expect(capsSubset(['host:connectors'], g)).toBe(true);
    expect(capsSubset(['host:connectors', 'net-egress'], g)).toBe(false);
  });
});

describe('assertNodeAllowed', () => {
  it('passes when caps ⊆ grant and egress not involved', () => {
    expect(() => assertNodeAllowed(decl(['host:connectors']), row([{ kind: 'host:connectors' }]), { egressEnabled: true })).not.toThrow();
  });
  it('throws when the plugin is disabled', () => {
    expect(() => assertNodeAllowed(decl([]), row([], false), { egressEnabled: true })).toThrow(/not enabled/i);
  });
  it('throws when a node capability exceeds the grant', () => {
    expect(() => assertNodeAllowed(decl(['net-egress']), row([]), { egressEnabled: true })).toThrow(/exceed/i);
  });
  it('throws when net-egress is declared but the egress kill-switch is off', () => {
    expect(() => assertNodeAllowed(decl(['net-egress']), row([{ kind: 'net-egress', allowedHosts: [] }]), { egressEnabled: false }))
      .toThrow(/egress/i);
  });
  it('grandfathers a legacy plugin (no capabilities field)', () => {
    const r = { id: 'p', enabled: true, manifest: {} as Record<string, unknown> };
    expect(() => assertNodeAllowed(decl(['net-egress']), r, { egressEnabled: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-policy.test.ts`
Expected: FAIL — cannot resolve `./plugin-node-policy`.

- [ ] **Step 3: Write the implementation**

Create `packages/bootstrap/src/plugin-node-policy.ts`:

```ts
import { readGrant, type Grant } from '@openldr/marketplace';

/** A node's declared capability kinds must be a subset of the plugin's grant. Legacy (pre-capability)
 *  rows are grandfathered — same posture as the SP-1 registry and the broker. */
export function capsSubset(nodeCaps: string[], grant: Grant): boolean {
  if (grant.legacy) return true;
  const granted = new Set<string>(grant.capabilities.map((c) => c.kind));
  return nodeCaps.every((c) => granted.has(c));
}

/** Re-enforce a workflow node's declared capabilities at execution (defense in depth vs the SP-1
 *  discovery-time check). Egress is gated only by the egress kill-switch — workflow nodes are NOT
 *  coupled to the plugin-UI master switch. Throws fail-closed. */
export function assertNodeAllowed(
  decl: { id: string; capabilities: string[] },
  row: { id: string; enabled: boolean; manifest: Record<string, unknown> },
  policy: { egressEnabled: boolean },
): void {
  if (!row.enabled) throw new Error(`plugin ${row.id} is not enabled`);
  const grant = readGrant(row.manifest);
  if (!capsSubset(decl.capabilities, grant)) {
    throw new Error(`node ${row.id}:${decl.id} declares capabilities exceeding the plugin grant`);
  }
  if (decl.capabilities.includes('net-egress') && !policy.egressEnabled) {
    throw new Error(`node ${row.id}:${decl.id} requires egress, which is disabled by the kill-switch`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-policy.test.ts`
Expected: PASS (7 tests).

---

## Task 5: `createPluginNodeService` (the host-side `runPluginNode`)

**Files:**
- Create: `packages/bootstrap/src/plugin-node-service.ts`
- Create: `packages/bootstrap/src/plugin-node-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/plugin-node-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPluginNodeService } from './plugin-node-service';

const ECHO_NODE = {
  id: 'echo', label: 'Echo', kind: 'transform', entrypoint: 'wf_echo',
  ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
};
const PUSH_NODE = {
  id: 'push', label: 'Push', kind: 'sink', entrypoint: 'wf_push',
  ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['net-egress', 'host:connectors'],
};

function pluginRow(workflowNodes: unknown[], opts: { id?: string; enabled?: boolean; capabilities?: unknown } = {}) {
  return {
    id: opts.id ?? 'p', version: '1.0.0', enabled: opts.enabled ?? true,
    manifest: {
      schemaVersion: 1, type: 'plugin', id: opts.id ?? 'p', version: '1.0.0',
      compatibility: { ceVersion: '*' }, capabilities: opts.capabilities ?? [],
      payload: { kind: 'plugin', wasmSha256: 'a'.repeat(64), workflowNodes },
    } as Record<string, unknown>,
  };
}

function deps(over: Partial<Parameters<typeof createPluginNodeService>[0]> = {}, invoke = vi.fn().mockResolvedValue({ items: [], meta: { ok: true } })) {
  const base = {
    plugins: {
      list: vi.fn().mockResolvedValue([pluginRow([ECHO_NODE])]),
      loadSink: vi.fn().mockResolvedValue({ invoke }),
    },
    connectors: {
      get: vi.fn().mockResolvedValue({ pluginId: 'p', allowedHost: 'dhis2.example', enabled: true }),
      getDecryptedConfig: vi.fn().mockResolvedValue({ baseUrl: 'https://dhis2.example', username: 'u', password: 'pw' }),
    },
    secretsKey: 'key',
    policy: () => ({ egressEnabled: true }),
  };
  return { deps: { ...base, ...over }, invoke };
}

describe('createPluginNodeService', () => {
  it('throws for an unknown/disabled plugin', async () => {
    const { deps: d } = deps({ plugins: { list: vi.fn().mockResolvedValue([]), loadSink: vi.fn() } } as never);
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] }))
      .rejects.toThrow(/not installed or disabled/i);
  });

  it('throws for an unknown node id', async () => {
    const { deps: d } = deps();
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'nope', config: {}, items: [] }))
      .rejects.toThrow(/no workflow node/i);
  });

  it('invokes the entrypoint with {items,config}, no connector → no egress, foreground', async () => {
    const { deps: d, invoke } = deps();
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: { note: 'x' }, items: [{ json: { a: 1 } }] });
    expect(invoke).toHaveBeenCalledWith('wf_echo', { items: [{ json: { a: 1 } }], config: { note: 'x' } }, { config: {}, allowedHosts: [] });
    expect(out).toEqual({ items: [], meta: { ok: true } });
  });

  it('resolves a connector for a net-egress sink and pins the host (real push)', async () => {
    const { deps: d, invoke } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([PUSH_NODE], { capabilities: [{ kind: 'net-egress', allowedHosts: [] }, { kind: 'host:connectors' }] })]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn().mockResolvedValue({ items: [] }) }) },
    } as never);
    // re-bind invoke spy through loadSink
    const sinkInvoke = vi.fn().mockResolvedValue({ items: [] });
    (d.plugins.loadSink as ReturnType<typeof vi.fn>).mockResolvedValue({ invoke: sinkInvoke });
    await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'push', config: { connectorId: 'c1', period: '2026Q1', dryRun: false }, items: [{ json: { a: 1 } }] });
    expect(d.connectors.getDecryptedConfig).toHaveBeenCalledWith('c1', 'key');
    const [entry, input, opts] = sinkInvoke.mock.calls[0];
    expect(entry).toBe('wf_push');
    // secrets ride opts.config, NOT the JSON input; connectorId stripped from input.config
    expect(input).toEqual({ items: [{ json: { a: 1 } }], config: { period: '2026Q1', dryRun: false } });
    expect(opts).toEqual({ config: { baseUrl: 'https://dhis2.example', username: 'u', password: 'pw' }, allowedHosts: ['dhis2.example'] });
  });

  it('does NOT pin a host on a dry-run even with a connector', async () => {
    const sinkInvoke = vi.fn().mockResolvedValue({ items: [] });
    const { deps: d } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([PUSH_NODE], { capabilities: [{ kind: 'net-egress', allowedHosts: [] }, { kind: 'host:connectors' }] })]), loadSink: vi.fn().mockResolvedValue({ invoke: sinkInvoke }) },
    } as never);
    await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'push', config: { connectorId: 'c1', dryRun: true }, items: [] });
    expect(sinkInvoke.mock.calls[0][2].allowedHosts).toEqual([]);
  });

  it('normalizes a missing items field in the response to []', async () => {
    const { deps: d } = deps({}, vi.fn().mockResolvedValue({ meta: { only: 'meta' } }));
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] });
    expect(out).toEqual({ items: [], meta: { only: 'meta' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-service.test.ts`
Expected: FAIL — cannot resolve `./plugin-node-service`.

- [ ] **Step 3: Write the implementation**

Create `packages/bootstrap/src/plugin-node-service.ts`:

```ts
import { parseWorkflowNodeDecls, type WorkflowNodeDecl } from '@openldr/marketplace';
import type { RunPluginNodeInput, RunPluginNodeOutput, WorkflowItem } from '@openldr/workflows';
import { assertNodeAllowed } from './plugin-node-policy';

interface SinkLike {
  invoke(entrypoint: string, input: unknown, opts?: { config?: Record<string, string>; allowedHosts?: string[] }): Promise<unknown>;
}

export interface PluginNodeServiceDeps {
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    loadSink(id: string, version?: string): Promise<SinkLike | undefined>;
  };
  connectors: {
    get(id: string): Promise<{ pluginId: string; allowedHost: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  policy: () => { egressEnabled: boolean };
}

/** Reads workflowNodes from a persisted row manifest: artifact rows under payload.workflowNodes,
 *  flat/legacy rows at the top level. */
function extractWorkflowNodes(manifest: Record<string, unknown>): unknown {
  const payload = (manifest as { payload?: { workflowNodes?: unknown } }).payload;
  if (payload && payload.workflowNodes !== undefined) return payload.workflowNodes;
  return (manifest as { workflowNodes?: unknown }).workflowNodes;
}

/**
 * The host-side runPluginNode: resolve the plugin + node decl, enforce capabilities, resolve a
 * connector (config + pinned host) when one is referenced, and invoke the wasm entrypoint with the
 * unified { items, config } envelope. The decrypted connector map rides Extism opts.config (never
 * the JSON input); the declarative node config rides input.config minus the resolved connectorId.
 */
export function createPluginNodeService(deps: PluginNodeServiceDeps): (input: RunPluginNodeInput) => Promise<RunPluginNodeOutput> {
  return async ({ pluginId, nodeId, config, items }) => {
    const rows = await deps.plugins.list();
    const row = rows.find((r) => r.id === pluginId && r.enabled);
    if (!row) throw new Error(`plugin ${pluginId} is not installed or disabled`);

    const rawDecls = extractWorkflowNodes(row.manifest);
    if (rawDecls === undefined) throw new Error(`plugin ${pluginId} contributes no workflow nodes`);
    let decls: WorkflowNodeDecl[];
    try {
      decls = parseWorkflowNodeDecls(rawDecls);
    } catch (err) {
      throw new Error(`plugin ${pluginId} has invalid workflow nodes: ${err instanceof Error ? err.message : String(err)}`);
    }
    const decl = decls.find((d) => d.id === nodeId);
    if (!decl) throw new Error(`plugin ${pluginId} has no workflow node '${nodeId}'`);

    assertNodeAllowed(decl, row, deps.policy());

    // Resolve a connector (decrypted config + pinned host) only when the node touches connectors
    // and one is configured.
    let connConfig: Record<string, string> = {};
    let allowedHost: string | null = null;
    const connectorId = typeof config.connectorId === 'string' ? config.connectorId : undefined;
    if (decl.capabilities.includes('host:connectors') && connectorId) {
      const c = await deps.connectors.get(connectorId);
      if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
      connConfig = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
      allowedHost = c.allowedHost;
    }

    const dryRun = Boolean(config.dryRun);
    const allowedHosts = decl.capabilities.includes('net-egress') && !dryRun && allowedHost ? [allowedHost] : [];

    const sink = await deps.plugins.loadSink(pluginId, row.version);
    if (!sink) throw new Error(`plugin ${pluginId} exposes no invokable wasm`);

    // connectorId is resolved host-side; strip it from the wire config (the wasm never needs it,
    // and the JSON input is echoed into run history).
    const wireConfig: Record<string, unknown> = { ...config };
    delete wireConfig.connectorId;

    const raw = await sink.invoke(decl.entrypoint, { items, config: wireConfig }, { config: connConfig, allowedHosts });
    const out = (raw && typeof raw === 'object' ? raw : {}) as { items?: unknown; meta?: unknown };
    const outItems = Array.isArray(out.items) ? (out.items as WorkflowItem[]) : [];
    return { items: outItems, meta: out.meta as Record<string, unknown> | undefined };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/bootstrap exec vitest run src/plugin-node-service.test.ts`
Expected: PASS (6 tests).

---

## Task 6: Wire `runPluginNode` into the AppContext

**Files:**
- Modify: `packages/bootstrap/src/index.ts`

- [ ] **Step 1: Add the import**

Modify `packages/bootstrap/src/index.ts`. Add near the other local imports (e.g. just after the `import { createPluginTarget } from './connector-target';` line, currently around line 35):

```ts
import { createPluginNodeService } from './plugin-node-service';
```

- [ ] **Step 2: Assign the service post-construction (next to dhis2Push)**

In `createAppContext`, find the existing line that assigns the dhis2 push service:

```ts
  workflowServices.dhis2Push = buildDhis2PushService({ pluginData, push: (input) => dhis2Orch.push(input) });
```

Immediately **after** it, add:

```ts
  // Generic plugin-node executor: resolves the node's plugin + connector, enforces capabilities,
  // and invokes the wasm {items,config} entrypoint. Mutates the same workflowServices object the
  // runner already references (like dhis2Push), so plugin-node handlers resolve it at run time.
  workflowServices.runPluginNode = createPluginNodeService({
    plugins,
    connectors: connectorStore,
    secretsKey: cfg.SECRETS_ENCRYPTION_KEY,
    policy: () => ({ egressEnabled: cfg.PLUGIN_EGRESS_ENABLED }),
  });
```

- [ ] **Step 3: Typecheck bootstrap**

Run: `pnpm -C packages/bootstrap exec tsc --noEmit`
Expected: PASS. (`connectorStore`, `plugins`, and `cfg` are all in scope at this point; `connectorStore` is created earlier in the function and `getDecryptedConfig`/`get` match the service's `connectors` dep.)

---

## Task 7: `wf_echo` wasm fixture (Rust + build script + rebuild)

**Files:**
- Modify: `wasm/test-sink/src/lib.rs`
- Modify: `scripts/build-test-sink.mjs`

- [ ] **Step 1: Add the `wf_echo` entrypoint**

Modify `wasm/test-sink/src/lib.rs`. Inside `mod plugin { ... }`, after the existing `push_aggregate` function, add:

```rust
    /// Workflow-node ABI echo: parse { items, config }, return { items, meta:{count,config} }.
    #[plugin_fn]
    pub fn wf_echo(input: Vec<u8>) -> FnResult<String> {
        let parsed: Value = if input.is_empty() {
            json!({})
        } else {
            serde_json::from_slice(&input)
                .map_err(|e| WithReturnCode::new(Error::msg(format!("invalid input JSON: {e}")), 1))?
        };
        let items = parsed.get("items").cloned().unwrap_or_else(|| json!([]));
        let config = parsed.get("config").cloned().unwrap_or_else(|| json!({}));
        let count = items.as_array().map(|a| a.len()).unwrap_or(0);
        Ok(json!({ "items": items, "meta": { "count": count, "config": config } }).to_string())
    }
```

- [ ] **Step 2: Add `wf_echo` to the staged manifest's entrypoints + a workflowNodes decl**

Modify `scripts/build-test-sink.mjs`. In the `manifest` object:

(a) Change the `entrypoints` line to:

```js
  entrypoints: ['health_check', 'push_aggregate', 'wf_echo'],
```

(b) After the `capabilities: [...]` line (before the closing `};`), add:

```js
  // SP-1/SP-2: contribute a workflow-builder transform node backed by the wf_echo entrypoint.
  workflowNodes: [
    {
      id: 'echo', label: 'Echo', kind: 'transform', entrypoint: 'wf_echo',
      ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
      config: [{ key: 'note', label: 'Note', type: 'text' }],
    },
  ],
```

- [ ] **Step 3: Rebuild the fixture**

Run (from the repo root): `node scripts/build-test-sink.mjs`
Expected: `cargo build -p test-sink --release --target wasm32-wasip1` succeeds and prints `staged .../reference-plugins/test-sink/plugin.wasm (sha256 ...) + manifest.json`.

> If the build fails because the `wasm32-wasip1` target or a Rust toolchain is missing, STOP and report BLOCKED — do not fake the artifact. (The toolchain was confirmed present when this plan was written: cargo 1.96, `wasm32-wasip1` installed.)

- [ ] **Step 4: Confirm the new entrypoint is in the staged manifest**

Run: `pnpm -C packages/plugins exec node -e "const m=require('../../reference-plugins/test-sink/manifest.json'); if(!m.entrypoints.includes('wf_echo')||!m.workflowNodes) throw new Error('manifest not updated'); console.log('ok', m.entrypoints, m.workflowNodes.length)"`
Expected: prints `ok [ 'health_check', 'push_aggregate', 'wf_echo' ] 1`.

---

## Task 8: Real-Extism integration test for `wf_echo`

**Files:**
- Create: `packages/plugins/src/wf-echo.integration.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/plugins/src/wf-echo.integration.test.ts` (mirrors `dhis2-sink.integration.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/test-sink/plugin.wasm is a gitignored build artifact
// (run `node scripts/build-test-sink.mjs` first). Absent ⇒ this suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({
    id: 'test-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'push_aggregate', 'wf_echo'],
    wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // Empty grant: no net-egress needed for wf_echo (foreground, no host pinned).
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('test-sink wf_echo through the real Extism runner (workflow-node ABI)', () => {
  it('echoes items and reports count + config in meta', async () => {
    const out = (await sink().invoke('wf_echo', {
      items: [{ json: { a: 1 } }, { json: { a: 2 } }],
      config: { note: 'hello' },
    })) as { items: { json: Record<string, unknown> }[]; meta: { count: number; config: Record<string, unknown> } };
    expect(out.items).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
    expect(out.meta.count).toBe(2);
    expect(out.meta.config).toEqual({ note: 'hello' });
  });
});
```

- [ ] **Step 2: Run the test and confirm it RAN (not skipped)**

Run: `pnpm -C packages/plugins exec vitest run src/wf-echo.integration.test.ts`
Expected: PASS with **1 test executed** (not skipped). If it reports the test as skipped, the fixture wasn't rebuilt — go back to Task 7 Step 3.

---

## Task 9: Full gate

- [ ] **Step 1: Typecheck everything (forced)**

Run: `pnpm turbo run typecheck --force`
Expected: all packages PASS. Watch `@openldr/workflows`, `@openldr/bootstrap`, `@openldr/plugins`, `@openldr/server`.

- [ ] **Step 2: Dependency-cruiser**

Run: `pnpm depcruise`
Expected: 0 errors. (No new package edges: `bootstrap` already depends on `@openldr/workflows`, `@openldr/marketplace`, and `@openldr/plugins`; `workflows` gained nothing.)

- [ ] **Step 3: Targeted suites**

Run: `pnpm -C packages/workflows exec vitest run`
Run: `pnpm -C packages/bootstrap exec vitest run`
Run: `pnpm -C packages/plugins exec vitest run`
Expected: all PASS (including the new items/handler/policy/service/integration tests).

- [ ] **Step 4: Build (forced)**

Run: `pnpm turbo run build --force`
Expected: PASS. (The `@openldr/web` chunk-size warning is pre-existing and unrelated; this SP touches no web code.)

- [ ] **Step 5: Acceptance check**

Confirm from the test output:
- A `plugin-node` handler forwards `{pluginId,nodeId,config,items}` and throws cleanly when the service is absent (handler tests).
- `createPluginNodeService` enforces capabilities, resolves a connector, pins the host only for a real (non-dry-run) egress push, keeps secrets out of the JSON input, and normalizes the response (service tests).
- `wf_echo` runs through **real Extism** with the `{items,config}→{items,meta}` envelope (integration test executed, not skipped).
- Nothing in the existing `dhis2-push` host node, `run-workflow.ts`, or existing runs changed (no such file modified except the additive handler registry entry).

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 = items boundary + wire types; Task 2 = `runPluginNode` contract; Task 3 = engine handler + registration; Task 4 = shared `assertNodeAllowed`/`capsSubset`; Task 5 = host-side service (capability enforcement, connector decrypt, egress pinning, secrets boundary, response normalization); Task 6 = bootstrap wiring; Tasks 7–8 = real `wf_echo` wasm ABI proof; Task 9 = gate.
- **Type consistency:** `RunPluginNodeInput`/`RunPluginNodeOutput`/`WorkflowItem` are defined in `@openldr/workflows` (Tasks 1–2) and imported by the bootstrap service (Task 5). `assertNodeAllowed(decl, row, {egressEnabled})` signature is identical in Tasks 4, 5. `nodeId` everywhere is the decl id (not the `${pluginId}:${id}` composite). The service's `connectors` dep (`get` + `getDecryptedConfig(id, key)`) matches the real `createConnectorStore` API and the bootstrap call site.
- **Security:** caps re-enforced at execution; egress only via pinned-host worker path gated by `PLUGIN_EGRESS_ENABLED`; connector secrets only in Extism `opts.config`; `connectorId` and all secrets stripped from the run-history-visible JSON input; fail-closed throws before any wasm runs.
- **Additive:** no node handler behavior changed; the only engine edit is one new `TYPE_HANDLERS` entry. The host `dhis2-push` node + `WorkflowServices.dhis2Push` are untouched (SP-5 migrates them).
- **Deviation from spec:** the spec sketched `connectors.getDecryptedConfig(id) → {config, allowedHost}`; the real API is `getDecryptedConfig(id, key) → Record<string,string>` plus `get(id)` for `allowedHost`. The plan uses the real API. Also, `assertNodeAllowed` enforces the egress kill-switch directly (not via `policyAllows`) so workflow-node execution is not coupled to the plugin-UI master switch (`PLUGIN_UI_ENABLED`).
