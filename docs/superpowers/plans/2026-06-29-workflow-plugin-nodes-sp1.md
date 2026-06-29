# Plugin-contributed Workflow Nodes — SP-1 (Node ABI + Registry + List API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed plugin manifest *declare* workflow-builder nodes (`workflowNodes[]`), and expose a host-side registry + list API that merges built-in host nodes with scanned plugin nodes — discovery only, no execution, no builder changes.

**Architecture:** A shared `workflowNodeDeclSchema` (zod) lives in `@openldr/marketplace` (alongside the existing `capabilitySchema`/`uiContributionSchema`), so both the flat plugin manifest (`@openldr/plugins`) and the signed artifact manifest (`@openldr/marketplace`) reference it without a `marketplace → plugins` cycle. `@openldr/workflows` gains a marketplace dependency and owns the uniform `WorkflowNodeDescriptor`, the built-in host-node descriptors, and a pure `createWorkflowNodeRegistry` that merges host + plugin nodes (validating `capabilities ⊆ readGrant`, kind↔ports, duplicate ids; invalid nodes are logged + dropped, never crash discovery). `apps/server` adds `GET /api/workflows/nodes` and a stub `GET /api/workflows/node-options/:source`.

**Tech Stack:** TypeScript, zod 3.24, Fastify, Vitest, pnpm workspaces, turbo, dependency-cruiser.

**Commits:** This repo keeps work **uncommitted** by convention — do **NOT** `git commit` or `git push`. Each task ends with a verification step (run the test) instead of a commit step.

**Deviation from spec wording (intentional):** Spec deliverable #1 says the `WorkflowNodeDecl` zod schema lives in `packages/plugins/src/manifest.ts`. It is authored in `@openldr/marketplace` instead and *imported* by `manifest.ts`. Rationale: the artifact adapters in `marketplace/artifact-manifest.ts` must validate the same `workflowNodes` shape, and `marketplace` cannot import `plugins` (that would be a cycle, since `plugins → marketplace`). This mirrors the existing precedent — `uiContributionSchema` and `capabilitySchema` both live in `marketplace` and are imported by `plugins/manifest.ts`. The `WorkflowNodeDecl` type is still re-exported from `@openldr/workflows` per deliverable #5.

---

## File Structure

**Create:**
- `packages/marketplace/src/workflow-node.ts` — `workflowNodeDeclSchema`, `workflowConfigFieldSchema`, `workflowPortSchema`, kind/field-type const arrays, types, `parseWorkflowNodeDecls`.
- `packages/marketplace/src/workflow-node.test.ts` — schema unit tests.
- `packages/workflows/src/node-registry.ts` — `WorkflowNodeDescriptor`, `createWorkflowNodeRegistry`, capability-subset + kind/ports validation.
- `packages/workflows/src/node-registry.test.ts` — registry unit tests.
- `packages/workflows/src/host-nodes.ts` — `HOST_NODE_DESCRIPTORS` (built-in nodes described in descriptor shape).
- `packages/workflows/src/host-nodes.test.ts` — host descriptor sanity tests.

**Modify:**
- `packages/marketplace/src/index.ts` — export `./workflow-node`.
- `packages/plugins/src/manifest.ts` — import `workflowNodeDeclSchema`; add optional `workflowNodes`.
- `packages/plugins/src/manifest.test.ts` — (create if absent) manifest workflowNodes tests.
- `packages/marketplace/src/artifact-manifest.ts` — add `workflowNodes` to `pluginPayload` + `LegacyPluginManifest` + `pluginManifestToArtifact`.
- `packages/marketplace/src/artifact-manifest.test.ts` — round-trip + byte-identical-when-absent tests.
- `packages/plugins/src/runtime.ts` — carry `workflowNodes` through `artifactToPluginManifest`.
- `packages/workflows/package.json` — add `@openldr/marketplace` dependency.
- `packages/workflows/src/index.ts` — export registry + descriptor + host nodes + re-export decl types.
- `apps/server/src/workflows-routes.ts` — `GET /api/workflows/nodes` + `GET /api/workflows/node-options/:source`.
- `apps/server/src/workflows-routes.test.ts` — add `plugins` stub to `fakeCtx`; node-list + node-options + role-gate tests.

---

## Task 1: Shared `workflowNodeDeclSchema` in `@openldr/marketplace`

**Files:**
- Create: `packages/marketplace/src/workflow-node.ts`
- Create: `packages/marketplace/src/workflow-node.test.ts`
- Modify: `packages/marketplace/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/marketplace/src/workflow-node.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { workflowNodeDeclSchema, parseWorkflowNodeDecls } from './workflow-node';

const VALID = {
  id: 'aggregate-push',
  label: 'DHIS2 Aggregate Push',
  kind: 'sink',
  entrypoint: 'wf_push_aggregate',
  ports: { inputs: [{ name: 'in' }], outputs: [] },
  capabilities: ['net-egress', 'host:connectors'],
  config: [
    { key: 'connectorId', label: 'Connector', type: 'select', optionsSource: 'connectors', required: true },
    { key: 'dryRun', label: 'Dry run', type: 'boolean', default: false },
  ],
};

describe('workflowNodeDeclSchema', () => {
  it('parses a valid declaration and applies field defaults', () => {
    const d = workflowNodeDeclSchema.parse(VALID);
    expect(d.kind).toBe('sink');
    expect(d.entrypoint).toBe('wf_push_aggregate');
    expect(d.capabilities).toEqual(['net-egress', 'host:connectors']);
    // field defaults
    expect(d.description).toBe('');
    expect(d.config[0].required).toBe(true);
    expect(d.config[1].required).toBe(false);
    expect(d.ports.inputs[0].binary).toBe(false);
  });

  it('defaults ports/capabilities/config when omitted', () => {
    const d = workflowNodeDeclSchema.parse({ id: 's', label: 'S', kind: 'source', entrypoint: 'convert' });
    expect(d.ports).toEqual({ inputs: [], outputs: [] });
    expect(d.capabilities).toEqual([]);
    expect(d.config).toEqual([]);
  });

  it('rejects an unknown kind', () => {
    expect(() => workflowNodeDeclSchema.parse({ ...VALID, kind: 'gateway' })).toThrow();
  });

  it('rejects an unknown config field type', () => {
    const bad = { ...VALID, config: [{ key: 'x', label: 'X', type: 'datetime' }] };
    expect(() => workflowNodeDeclSchema.parse(bad)).toThrow();
  });

  it('rejects a missing entrypoint', () => {
    const { entrypoint, ...rest } = VALID;
    expect(() => workflowNodeDeclSchema.parse(rest)).toThrow();
  });

  it('parseWorkflowNodeDecls parses an array', () => {
    const arr = parseWorkflowNodeDecls([VALID]);
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe('aggregate-push');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/marketplace exec vitest run src/workflow-node.test.ts`
Expected: FAIL — cannot resolve `./workflow-node`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/marketplace/src/workflow-node.ts`:

```ts
import { z } from 'zod';

/** Node archetype. Drives palette grouping + validation (a `source` must have no inputs). */
export const WORKFLOW_NODE_KINDS = ['source', 'transform', 'sink'] as const;
export const workflowNodeKindSchema = z.enum(WORKFLOW_NODE_KINDS);
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** Declarative config-field types the builder renders (v1). `select`/`multiselect` use either
 *  static `options` or a host-resolved `optionsSource`; `file` is the binary lane (SP-4). */
export const WORKFLOW_CONFIG_FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'multiselect', 'file'] as const;
export const workflowConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(WORKFLOW_CONFIG_FIELD_TYPES),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /** Host-owned dynamic option source (e.g. 'connectors', 'dhis2-mappings', 'reports'). Resolved in SP-3. */
  optionsSource: z.string().min(1).optional(),
});
export type WorkflowConfigField = z.infer<typeof workflowConfigFieldSchema>;

export const workflowPortSchema = z.object({ name: z.string().min(1), binary: z.boolean().default(false) });
export type WorkflowPort = z.infer<typeof workflowPortSchema>;

/** A single workflow-node contribution declared in a plugin manifest (`workflowNodes[]`).
 *  `capabilities` are capability *kind* strings (e.g. 'net-egress', 'host:connectors') that MUST be
 *  a subset of the plugin's grant; the registry enforces the subset at discovery (SP-1) and the
 *  engine re-enforces at run (SP-2). `entrypoint` is a wasm export invoked per run (SP-2). */
export const workflowNodeDeclSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: workflowNodeKindSchema,
  description: z.string().default(''),
  entrypoint: z.string().min(1),
  ports: z
    .object({ inputs: z.array(workflowPortSchema).default([]), outputs: z.array(workflowPortSchema).default([]) })
    .default({ inputs: [], outputs: [] }),
  capabilities: z.array(z.string().min(1)).default([]),
  config: z.array(workflowConfigFieldSchema).default([]),
});
export type WorkflowNodeDecl = z.infer<typeof workflowNodeDeclSchema>;

export function parseWorkflowNodeDecls(raw: unknown): WorkflowNodeDecl[] {
  return z.array(workflowNodeDeclSchema).parse(raw);
}
```

- [ ] **Step 4: Export from the marketplace barrel**

Modify `packages/marketplace/src/index.ts` — add at the end of the export list:

```ts
export * from './workflow-node';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/marketplace exec vitest run src/workflow-node.test.ts`
Expected: PASS (6 tests).

---

## Task 2: Optional `workflowNodes` on the flat plugin manifest

**Files:**
- Modify: `packages/plugins/src/manifest.ts`
- Create: `packages/plugins/src/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/plugins/src/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseManifest } from './manifest';

const BASE = {
  id: 'demo',
  version: '1.0.0',
  wasmSha256: 'a'.repeat(64),
};

describe('parseManifest workflowNodes', () => {
  it('leaves workflowNodes undefined when absent (byte-identical existing manifests)', () => {
    const m = parseManifest(BASE);
    expect(m.workflowNodes).toBeUndefined();
    expect('workflowNodes' in m).toBe(false);
  });

  it('parses a manifest declaring workflowNodes', () => {
    const m = parseManifest({
      ...BASE,
      kind: 'sink',
      entrypoints: ['wf_push_aggregate'],
      workflowNodes: [
        { id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
          ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'] },
      ],
    });
    expect(m.workflowNodes).toHaveLength(1);
    expect(m.workflowNodes![0].id).toBe('aggregate-push');
    expect(m.workflowNodes![0].config).toEqual([]); // field default applied
  });

  it('rejects an invalid workflowNodes entry', () => {
    expect(() => parseManifest({ ...BASE, workflowNodes: [{ id: 'x' }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/plugins exec vitest run src/manifest.test.ts`
Expected: FAIL — `workflowNodes` is not on the parsed manifest / not rejected.

- [ ] **Step 3: Write minimal implementation**

Modify `packages/plugins/src/manifest.ts`. Update the import line and add the field:

```ts
import { z } from 'zod';
import { uiContributionSchema, workflowNodeDeclSchema } from '@openldr/marketplace';
```

Then inside `pluginManifestSchema`, immediately after the `ui: uiContributionSchema.optional(),` line, add:

```ts
  // Workflow-builder nodes this plugin contributes (SP-1). Absent ⇒ no nodes; existing
  // manifests stay byte-identical. Each entry is validated by the shared marketplace schema.
  workflowNodes: z.array(workflowNodeDeclSchema).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/plugins exec vitest run src/manifest.test.ts`
Expected: PASS (3 tests).

---

## Task 3: `workflowNodes` on the signed artifact manifest + adapter

**Files:**
- Modify: `packages/marketplace/src/artifact-manifest.ts`
- Modify: `packages/marketplace/src/artifact-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/marketplace/src/artifact-manifest.test.ts` (append inside the existing top-level `describe`, or add a new `describe` block at the end of the file):

```ts
import { pluginManifestToArtifact, parseArtifactManifest } from './artifact-manifest';

describe('artifact manifest workflowNodes', () => {
  const NODE = {
    id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
    ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'],
  };

  it('omits payload.workflowNodes when the legacy manifest has none (byte-identical)', () => {
    const a = pluginManifestToArtifact({ id: 'p', version: '1.0.0', wasmSha256: 'a'.repeat(64) });
    expect('workflowNodes' in (a.payload as Record<string, unknown>)).toBe(false);
  });

  it('carries workflowNodes through the legacy→artifact adapter', () => {
    const a = pluginManifestToArtifact({
      id: 'p', version: '1.0.0', wasmSha256: 'a'.repeat(64), kind: 'sink',
      entrypoints: ['wf_push_aggregate'], workflowNodes: [NODE],
    });
    const payload = a.payload as { workflowNodes?: unknown[] };
    expect(payload.workflowNodes).toHaveLength(1);
  });

  it('validates payload.workflowNodes on a full artifact manifest', () => {
    const a = parseArtifactManifest({
      schemaVersion: 1, type: 'plugin', id: 'p', version: '1.0.0',
      compatibility: { ceVersion: '*' },
      payload: { kind: 'plugin', wasmSha256: 'a'.repeat(64), workflowNodes: [NODE] },
    });
    const payload = a.payload as { workflowNodes?: { id: string }[] };
    expect(payload.workflowNodes![0].id).toBe('aggregate-push');
  });
});
```

> Note: if `pluginManifestToArtifact`/`parseArtifactManifest` are already imported at the top of the test file, do not duplicate the import — drop the `import` line above.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/marketplace exec vitest run src/artifact-manifest.test.ts`
Expected: FAIL — `workflowNodes` is stripped by the schema / not carried by the adapter.

- [ ] **Step 3: Write minimal implementation**

Modify `packages/marketplace/src/artifact-manifest.ts`:

(a) Add the import near the top, after the `capabilitySchema` import:

```ts
import { workflowNodeDeclSchema } from './workflow-node';
```

(b) In `const pluginPayload = z.object({ ... })`, immediately after the `ui: uiContributionSchema.optional(),` line, add:

```ts
  // Workflow-builder nodes this plugin contributes (SP-1). Part of the signed payload; absent
  // ⇒ no nodes, so existing signed plugin artifacts stay byte-identical and verify.
  workflowNodes: z.array(workflowNodeDeclSchema).optional(),
```

(c) In the `LegacyPluginManifest` interface, add a field after `ui?: unknown;`:

```ts
  workflowNodes?: unknown;
```

(d) In `pluginManifestToArtifact`, inside the returned `payload` object, after the `...(m.ui !== undefined ? { ui: m.ui } : {}),` line, add:

```ts
      ...(m.workflowNodes !== undefined ? { workflowNodes: m.workflowNodes } : {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/marketplace exec vitest run src/artifact-manifest.test.ts`
Expected: PASS (existing tests + 3 new).

---

## Task 4: Carry `workflowNodes` through the artifact→legacy adapter in plugins runtime

**Files:**
- Modify: `packages/plugins/src/runtime.ts`
- Modify: `packages/plugins/src/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new test to `packages/plugins/src/runtime.test.ts`. First locate the existing import of `pluginManifestFromRow`/`artifactToPluginManifest`; these are **not exported** from `runtime.ts`. Instead test via the public round-trip used elsewhere in that file. Append this `describe` block at the end of the file:

```ts
import { pluginManifestToArtifact } from '@openldr/marketplace';
import { parseManifest } from './manifest';

describe('workflowNodes survive the manifest round-trip', () => {
  it('legacy manifest → artifact payload → legacy manifest preserves workflowNodes', () => {
    const node = {
      id: 'src', label: 'Src', kind: 'source', entrypoint: 'convert',
      ports: { inputs: [], outputs: [{ name: 'out' }] }, capabilities: [],
    };
    const artifact = pluginManifestToArtifact({
      id: 'p', version: '1.0.0', wasmSha256: 'a'.repeat(64), workflowNodes: [node],
    });
    const payload = artifact.payload as { workflowNodes?: { id: string }[] };
    expect(payload.workflowNodes![0].id).toBe('src');

    // Re-derive the flat manifest the way runtime.ts does for the install return value.
    const flat = parseManifest({
      id: artifact.id, version: artifact.version, wasmSha256: payload['wasmSha256' as never],
      workflowNodes: payload.workflowNodes,
    });
    expect(flat.workflowNodes).toHaveLength(1);
  });
});
```

> If `parseManifest`/`pluginManifestToArtifact` are already imported at the top of `runtime.test.ts`, drop the duplicate `import` lines.

- [ ] **Step 2: Run test to verify it fails (or passes trivially) — then make the real change**

Run: `pnpm -C packages/plugins exec vitest run src/runtime.test.ts`
The round-trip test above exercises `parseManifest` (already supports `workflowNodes` from Task 2), so it may PASS. The real gap is the **internal** `artifactToPluginManifest` in `runtime.ts` dropping `workflowNodes` when re-deriving the flat manifest from a persisted artifact row. Proceed to Step 3 to fix that for fidelity.

- [ ] **Step 3: Write the implementation**

Modify `packages/plugins/src/runtime.ts`, function `artifactToPluginManifest`. In the object passed to `parseManifest`, after the `limits: p.limits,` line, add:

```ts
    ...(p.workflowNodes !== undefined ? { workflowNodes: p.workflowNodes } : {}),
```

- [ ] **Step 4: Run the plugins suite to verify nothing regressed**

Run: `pnpm -C packages/plugins exec vitest run`
Expected: PASS (full plugins suite, including the new round-trip test).

---

## Task 5: `WorkflowNodeDescriptor` + host-node descriptors in `@openldr/workflows`

**Files:**
- Modify: `packages/workflows/package.json`
- Create: `packages/workflows/src/host-nodes.ts`
- Create: `packages/workflows/src/host-nodes.test.ts`

- [ ] **Step 1: Add the marketplace dependency + install**

Modify `packages/workflows/package.json` — add to `dependencies` (keep alphabetical-ish, after `@openldr/db`):

```json
    "@openldr/marketplace": "workspace:*",
```

Then run: `pnpm install`
Expected: lockfile updates; `@openldr/marketplace` linked into `@openldr/workflows`.

- [ ] **Step 2: Write the failing test**

Create `packages/workflows/src/host-nodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HOST_NODE_DESCRIPTORS } from './host-nodes';

describe('HOST_NODE_DESCRIPTORS', () => {
  it('describes the built-in nodes uniformly as host descriptors', () => {
    expect(HOST_NODE_DESCRIPTORS.length).toBeGreaterThan(0);
    for (const d of HOST_NODE_DESCRIPTORS) {
      expect(d.source).toBe('host');
      expect(d.pluginId).toBeUndefined();
      expect(['source', 'transform', 'sink']).toContain(d.kind);
      expect(typeof d.id).toBe('string');
      // source nodes must declare no inputs (the registry invariant)
      if (d.kind === 'source') expect(d.ports.inputs).toEqual([]);
    }
  });

  it('includes the dhis2-push sink with its config fields', () => {
    const push = HOST_NODE_DESCRIPTORS.find((d) => d.id === 'dhis2-push');
    expect(push).toBeDefined();
    expect(push!.kind).toBe('sink');
    expect(push!.config.map((c) => c.key)).toEqual(expect.arrayContaining(['mappingId', 'period', 'dryRun']));
  });

  it('has unique ids', () => {
    const ids = HOST_NODE_DESCRIPTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/host-nodes.test.ts`
Expected: FAIL — cannot resolve `./host-nodes`.

- [ ] **Step 4: Write the descriptor type + host descriptors**

Create `packages/workflows/src/host-nodes.ts`:

```ts
import type { WorkflowNodeKind, WorkflowPort, WorkflowConfigField } from '@openldr/marketplace';

/** Uniform node shape the builder will render (host + plugin nodes from one list). For a host node
 *  `source: 'host'` and `id` is the built-in node id; for a plugin node `source: 'plugin'`, `id` is
 *  `${pluginId}:${decl.id}` and `entrypoint` is the wasm export. */
export interface WorkflowNodeDescriptor {
  id: string;
  source: 'host' | 'plugin';
  pluginId?: string;
  label: string;
  kind: WorkflowNodeKind;
  description: string;
  /** wasm export invoked per run; plugin nodes only. */
  entrypoint?: string;
  ports: { inputs: WorkflowPort[]; outputs: WorkflowPort[] };
  capabilities: string[];
  config: WorkflowConfigField[];
}

const inP = (name: string): WorkflowPort => ({ name, binary: false });
const outP = (name: string): WorkflowPort => ({ name, binary: false });

/** Built-in node handlers described as descriptors (no behaviour change to the handlers).
 *  Config is minimal in SP-1 — the builder integration that renders these arrives in SP-3. */
export const HOST_NODE_DESCRIPTORS: WorkflowNodeDescriptor[] = [
  // Sources
  { id: 'sql-query', source: 'host', label: 'SQL Query', kind: 'source', description: 'Query lab data via SQL.', ports: { inputs: [], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'fhir-query', source: 'host', label: 'FHIR Query', kind: 'source', description: 'Read FHIR resources.', ports: { inputs: [], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'http-request', source: 'host', label: 'HTTP Request', kind: 'source', description: 'Fetch from an allow-listed host.', ports: { inputs: [], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'load-dataset', source: 'host', label: 'Load Dataset', kind: 'source', description: 'Load a materialized workflow dataset.', ports: { inputs: [], outputs: [outP('out')] }, capabilities: [], config: [] },
  // Transforms
  { id: 'code', source: 'host', label: 'Code', kind: 'transform', description: 'Run sandboxed JavaScript.', ports: { inputs: [inP('in')], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'set', source: 'host', label: 'Set', kind: 'transform', description: 'Set or map fields.', ports: { inputs: [inP('in')], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'merge', source: 'host', label: 'Merge', kind: 'transform', description: 'Merge inputs.', ports: { inputs: [inP('in')], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'log', source: 'host', label: 'Log', kind: 'transform', description: 'Log items.', ports: { inputs: [inP('in')], outputs: [outP('out')] }, capabilities: [], config: [] },
  { id: 'if', source: 'host', label: 'If', kind: 'transform', description: 'Branch on a condition.', ports: { inputs: [inP('in')], outputs: [outP('true'), outP('false')] }, capabilities: [], config: [] },
  { id: 'filter', source: 'host', label: 'Filter', kind: 'transform', description: 'Filter items by a condition.', ports: { inputs: [inP('in')], outputs: [outP('out')] }, capabilities: [], config: [] },
  // Sinks
  { id: 'materialize-dataset', source: 'host', label: 'Materialize Dataset', kind: 'sink', description: 'Persist items as a dataset.', ports: { inputs: [inP('in')], outputs: [] }, capabilities: [], config: [] },
  { id: 'export-artifact', source: 'host', label: 'Export Artifact', kind: 'sink', description: 'Export items to CSV/XLSX/PDF.', ports: { inputs: [inP('in')], outputs: [] }, capabilities: [], config: [] },
  {
    id: 'dhis2-push', source: 'host', label: 'DHIS2 Push', kind: 'sink',
    description: 'Push aggregate rows to DHIS2 via a mapping.',
    ports: { inputs: [inP('in')], outputs: [] }, capabilities: [],
    config: [
      { key: 'mappingId', label: 'Mapping', type: 'select', optionsSource: 'dhis2-mappings', required: true },
      { key: 'period', label: 'Period', type: 'text', required: true },
      { key: 'dryRun', label: 'Dry run', type: 'boolean', required: false, default: false },
    ],
  },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/host-nodes.test.ts`
Expected: PASS (3 tests).

---

## Task 6: `createWorkflowNodeRegistry`

**Files:**
- Create: `packages/workflows/src/node-registry.ts`
- Create: `packages/workflows/src/node-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workflows/src/node-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createWorkflowNodeRegistry } from './node-registry';
import { HOST_NODE_DESCRIPTORS } from './host-nodes';

// A persisted artifact-manifest row shape (capabilities at top level; nodes under payload).
function pluginRow(opts: {
  id: string; enabled?: boolean; capabilities?: unknown; workflowNodes?: unknown[];
}) {
  return {
    id: opts.id,
    enabled: opts.enabled ?? true,
    manifest: {
      schemaVersion: 1, type: 'plugin', id: opts.id, version: '1.0.0',
      compatibility: { ceVersion: '*' },
      capabilities: opts.capabilities ?? [],
      payload: { kind: 'plugin', wasmSha256: 'a'.repeat(64), workflowNodes: opts.workflowNodes ?? [] },
    } as Record<string, unknown>,
  };
}

const SINK = {
  id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
  ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'],
};
const SOURCE = {
  id: 'whonet', label: 'WHONET', kind: 'source', entrypoint: 'convert',
  ports: { inputs: [], outputs: [{ name: 'out' }] }, capabilities: [],
};

function reg(rows: ReturnType<typeof pluginRow>[]) {
  const warnings: string[] = [];
  const registry = createWorkflowNodeRegistry({
    plugins: { list: async () => rows },
    hostNodes: HOST_NODE_DESCRIPTORS,
    logger: { warn: (_o, m) => warnings.push(m) },
  });
  return { registry, warnings };
}

describe('createWorkflowNodeRegistry', () => {
  it('returns host nodes when no plugins are installed', async () => {
    const { registry } = reg([]);
    const nodes = await registry.list();
    expect(nodes.length).toBe(HOST_NODE_DESCRIPTORS.length);
    expect(nodes.every((n) => n.source === 'host')).toBe(true);
  });

  it('merges plugin nodes with composite ids and a granted capability', async () => {
    const { registry } = reg([pluginRow({ id: 'dhis2-sink', capabilities: [{ kind: 'host:connectors' }], workflowNodes: [SINK, SOURCE] })]);
    const nodes = await registry.list();
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('dhis2-sink:aggregate-push');
    expect(ids).toContain('dhis2-sink:whonet');
    const sink = nodes.find((n) => n.id === 'dhis2-sink:aggregate-push')!;
    expect(sink.source).toBe('plugin');
    expect(sink.pluginId).toBe('dhis2-sink');
    expect(sink.entrypoint).toBe('wf_push_aggregate');
  });

  it('drops a node whose capabilities exceed the plugin grant', async () => {
    const { registry, warnings } = reg([pluginRow({ id: 'p', capabilities: [], workflowNodes: [SINK] })]);
    const nodes = await registry.list();
    expect(nodes.find((n) => n.id === 'p:aggregate-push')).toBeUndefined();
    expect(warnings.some((m) => /capabilit/i.test(m))).toBe(true);
  });

  it('drops a source node that declares inputs', async () => {
    const bad = { ...SOURCE, ports: { inputs: [{ name: 'in' }], outputs: [] } };
    const { registry, warnings } = reg([pluginRow({ id: 'p', workflowNodes: [bad] })]);
    const nodes = await registry.list();
    expect(nodes.find((n) => n.id === 'p:whonet')).toBeUndefined();
    expect(warnings.some((m) => /source/i.test(m))).toBe(true);
  });

  it('contributes nothing for a disabled plugin', async () => {
    const { registry } = reg([pluginRow({ id: 'p', enabled: false, capabilities: [{ kind: 'host:connectors' }], workflowNodes: [SINK] })]);
    const nodes = await registry.list();
    expect(nodes.find((n) => n.pluginId === 'p')).toBeUndefined();
  });

  it('drops duplicate composite ids, keeping the first', async () => {
    const { registry, warnings } = reg([pluginRow({ id: 'p', workflowNodes: [SOURCE, SOURCE] })]);
    const nodes = await registry.list();
    expect(nodes.filter((n) => n.id === 'p:whonet')).toHaveLength(1);
    expect(warnings.some((m) => /duplicate/i.test(m))).toBe(true);
  });

  it('drops all of a plugin whose workflowNodes are malformed, without crashing', async () => {
    const { registry } = reg([pluginRow({ id: 'p', workflowNodes: [{ id: 'broken' }] })]);
    const nodes = await registry.list();
    expect(nodes.every((n) => n.source === 'host')).toBe(true);
  });

  it('treats a legacy plugin (no capabilities field) as grandfathered (allows any node caps)', async () => {
    const row = pluginRow({ id: 'p', workflowNodes: [SINK] });
    delete (row.manifest as Record<string, unknown>).capabilities;
    const { registry } = reg([row]);
    const nodes = await registry.list();
    expect(nodes.find((n) => n.id === 'p:aggregate-push')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/workflows exec vitest run src/node-registry.test.ts`
Expected: FAIL — cannot resolve `./node-registry`.

- [ ] **Step 3: Write the implementation**

Create `packages/workflows/src/node-registry.ts`:

```ts
import { readGrant, parseWorkflowNodeDecls, type Grant, type WorkflowNodeDecl } from '@openldr/marketplace';
import type { WorkflowNodeDescriptor } from './host-nodes';

/** Minimal plugin-row shape the registry scans (matches PluginRuntime.list() / the broker's view). */
export interface NodeRegistryPluginRow {
  id: string;
  enabled: boolean;
  manifest: Record<string, unknown>;
}

export interface WorkflowNodeRegistryDeps {
  plugins: { list(): Promise<NodeRegistryPluginRow[]> };
  hostNodes: WorkflowNodeDescriptor[];
  /** Optional structured logger; discovery failures are logged + the node dropped, never thrown. */
  logger?: { warn(obj: unknown, msg: string): void };
}

export interface WorkflowNodeRegistry {
  list(): Promise<WorkflowNodeDescriptor[]>;
}

/** Reads the workflowNodes declaration from a persisted row manifest: artifact rows carry it under
 *  `payload.workflowNodes`; a flat/legacy manifest carries it at the top level. */
function readNodeDecls(manifest: Record<string, unknown>): unknown {
  const payload = (manifest as { payload?: { workflowNodes?: unknown } }).payload;
  if (payload && payload.workflowNodes !== undefined) return payload.workflowNodes;
  return (manifest as { workflowNodes?: unknown }).workflowNodes;
}

/** A node's declared capability kinds must be a subset of the plugin's grant. Legacy (pre-capability)
 *  rows are grandfathered — same posture the broker takes. */
function capsSubset(nodeCaps: string[], grant: Grant): boolean {
  if (grant.legacy) return true;
  const granted = new Set(grant.capabilities.map((c) => c.kind));
  return nodeCaps.every((c) => granted.has(c));
}

export function createWorkflowNodeRegistry(deps: WorkflowNodeRegistryDeps): WorkflowNodeRegistry {
  return {
    async list(): Promise<WorkflowNodeDescriptor[]> {
      const out: WorkflowNodeDescriptor[] = [...deps.hostNodes];
      const seen = new Set(out.map((n) => n.id));

      let rows: NodeRegistryPluginRow[];
      try {
        rows = await deps.plugins.list();
      } catch (err) {
        deps.logger?.warn({ err: String(err) }, 'workflow node discovery: plugin list failed; returning host nodes only');
        return out;
      }

      for (const row of rows) {
        if (!row.enabled) continue;

        const rawDecls = readNodeDecls(row.manifest);
        if (rawDecls === undefined) continue;

        let grant: Grant;
        try {
          grant = readGrant(row.manifest);
        } catch (err) {
          deps.logger?.warn({ pluginId: row.id, err: String(err) }, 'workflow node discovery: unreadable capability grant; skipping plugin');
          continue;
        }

        let decls: WorkflowNodeDecl[];
        try {
          decls = parseWorkflowNodeDecls(rawDecls);
        } catch (err) {
          deps.logger?.warn({ pluginId: row.id, err: String(err) }, 'workflow node discovery: invalid workflowNodes; skipping plugin');
          continue;
        }

        for (const decl of decls) {
          const id = `${row.id}:${decl.id}`;
          if (seen.has(id)) {
            deps.logger?.warn({ id }, 'workflow node discovery: duplicate node id; dropping');
            continue;
          }
          if (decl.kind === 'source' && decl.ports.inputs.length > 0) {
            deps.logger?.warn({ id }, 'workflow node discovery: source node declares inputs; dropping');
            continue;
          }
          if (!capsSubset(decl.capabilities, grant)) {
            deps.logger?.warn({ id, caps: decl.capabilities }, 'workflow node discovery: node capabilities exceed plugin grant; dropping');
            continue;
          }
          seen.add(id);
          out.push({
            id,
            source: 'plugin',
            pluginId: row.id,
            label: decl.label,
            kind: decl.kind,
            description: decl.description,
            entrypoint: decl.entrypoint,
            ports: decl.ports,
            capabilities: decl.capabilities,
            config: decl.config,
          });
        }
      }

      return out;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/workflows exec vitest run src/node-registry.test.ts`
Expected: PASS (8 tests).

---

## Task 7: Export the new surface from `@openldr/workflows`

**Files:**
- Modify: `packages/workflows/src/index.ts`

- [ ] **Step 1: Add exports**

Append to `packages/workflows/src/index.ts`:

```ts
export { HOST_NODE_DESCRIPTORS, type WorkflowNodeDescriptor } from './host-nodes';
export { createWorkflowNodeRegistry, type WorkflowNodeRegistry, type WorkflowNodeRegistryDeps, type NodeRegistryPluginRow } from './node-registry';
// Re-export the declaration types so web + server consume them from one place (SP-1 deliverable #5).
export {
  type WorkflowNodeDecl,
  type WorkflowNodeKind,
  type WorkflowConfigField,
  type WorkflowPort,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_CONFIG_FIELD_TYPES,
} from '@openldr/marketplace';
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm -C packages/workflows exec tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Run the whole workflows suite**

Run: `pnpm -C packages/workflows exec vitest run`
Expected: PASS (all workflows tests).

---

## Task 8: `GET /api/workflows/nodes` + `node-options/:source` stub

**Files:**
- Modify: `apps/server/src/workflows-routes.ts`
- Modify: `apps/server/src/workflows-routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/src/workflows-routes.test.ts`, first extend `fakeCtx()` so the new route's `ctx.plugins.list()` resolves. Add a `plugins` property to the returned object (next to `pluginData`), and let tests override the plugin list. Replace the `pluginData: { list: async () => [] },` line region by adding directly after it:

```ts
    plugins: { list: async () => [] as any[] },
```

Then add these tests inside the existing `describe('workflow routes', ...)` block. They follow the file's established pattern exactly: `new Fastify()` → `app.addHook('onRequest', ...)` to inject `req.user` → `registerWorkflowRoutes(app, ctx)`.

```ts
  it('GET /api/workflows/nodes returns the host node descriptors', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nodes' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodes: Array<{ id: string; source: string; kind: string }> };
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.nodes.some((n) => n.id === 'dhis2-push' && n.source === 'host')).toBe(true);
  });

  it('GET /api/workflows/nodes merges enabled plugin nodes', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    ctx.plugins.list = async () => [{
      id: 'dhis2-sink', enabled: true,
      manifest: {
        schemaVersion: 1, type: 'plugin', id: 'dhis2-sink', version: '1.0.0',
        compatibility: { ceVersion: '*' },
        capabilities: [{ kind: 'host:connectors' }],
        payload: {
          kind: 'plugin', wasmSha256: 'a'.repeat(64),
          workflowNodes: [
            { id: 'aggregate-push', label: 'Push', kind: 'sink', entrypoint: 'wf_push_aggregate',
              ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['host:connectors'] },
          ],
        },
      },
    }];
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nodes' });
    const body = res.json() as { nodes: Array<{ id: string; source: string; pluginId?: string }> };
    const pluginNode = body.nodes.find((n) => n.id === 'dhis2-sink:aggregate-push');
    expect(pluginNode).toBeDefined();
    expect(pluginNode!.source).toBe('plugin');
    expect(pluginNode!.pluginId).toBe('dhis2-sink');
  });

  it('GET /api/workflows/node-options/:source returns [] (SP-1 stub)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = MANAGER_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/node-options/connectors' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/workflows/nodes is role-gated (technician forbidden)', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = TECHNICIAN_USER; });
    const ctx = fakeCtx();
    registerWorkflowRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/workflows/nodes' });
    expect(res.statusCode).toBe(403);
  });
```

> Note: `ctx.plugins.list` is reassigned in the merge test — since `fakeCtx()` returns an `as any` object this is fine at the type level. The `fakeCtx` `plugins` stub from Step 1 provides the default empty list for the other three tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`
Expected: FAIL — `/api/workflows/nodes` 404s (route not registered).

- [ ] **Step 3: Write the implementation**

Modify `apps/server/src/workflows-routes.ts`:

(a) Extend the existing `@openldr/workflows` import (currently `WorkflowSchema, WorkflowDefinitionSchema, runWorkflow, type RunEvent`) to add the registry + host nodes:

```ts
import {
  WorkflowSchema, WorkflowDefinitionSchema, runWorkflow, type RunEvent,
  createWorkflowNodeRegistry, HOST_NODE_DESCRIPTORS,
} from '@openldr/workflows';
```

(b) Inside `registerWorkflowRoutes`, after the `app.get('/api/workflows/datasets', ...)` block (any location among the MANAGE GET routes is fine), add:

```ts
  // Node registry: built-in host nodes merged with nodes scanned from installed+enabled plugins.
  // Discovery only (SP-1) — no execution, no builder changes. Invalid plugin nodes are dropped
  // + logged inside the registry, never crashing the listing.
  app.get('/api/workflows/nodes', MANAGE, async () => {
    const registry = createWorkflowNodeRegistry({
      plugins: ctx.plugins,
      hostNodes: HOST_NODE_DESCRIPTORS,
      logger: { warn: (obj: unknown, msg: string) => ctx.logger.warn(obj as object, msg) },
    });
    return { nodes: await registry.list() };
  });

  // optionsSource resolver for declarative `select`/`multiselect` config fields. SP-1 ships the
  // contract as a stub returning []; the real resolvers (connectors, dhis2-mappings, reports) land
  // in SP-3.
  app.get('/api/workflows/node-options/:source', MANAGE, async () => {
    return [];
  });
```

> `ctx.plugins` is the `PluginRuntime`; its `list()` returns rows shaped `{ id, enabled, manifest, ... }`, which structurally satisfies `NodeRegistryPluginRow`. If TypeScript complains about extra/missing fields, the registry's `plugins` param accepts `{ list(): Promise<NodeRegistryPluginRow[]> }`; pass `ctx.plugins` directly — `PluginRow` is a superset.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`
Expected: PASS (existing route tests + 4 new).

---

## Task 9: Full gate

- [ ] **Step 1: Typecheck everything (forced — turbo cache can mask cross-package type breakage)**

Run: `pnpm turbo run typecheck --force`
Expected: all packages PASS. Watch especially `@openldr/plugins`, `@openldr/marketplace`, `@openldr/workflows`, `@openldr/server`, and any consumer of `@openldr/workflows`/`@openldr/marketplace`.

- [ ] **Step 2: Dependency-cruiser (no new boundary violations / cycles)**

Run: `pnpm depcruise`
Expected: 0 errors. (`workflows → marketplace` is a new edge; confirm no `no-circular` violation — `marketplace` must not import `workflows`.)

- [ ] **Step 3: Targeted suites**

Run: `pnpm -C packages/marketplace exec vitest run`
Run: `pnpm -C packages/plugins exec vitest run`
Run: `pnpm -C packages/workflows exec vitest run`
Run: `pnpm -C apps/server exec vitest run src/workflows-routes.test.ts`
Expected: all PASS.

- [ ] **Step 4: Build (catches anything tsc-noEmit missed in emit)**

Run: `pnpm turbo run build --force`
Expected: PASS. (Note the documented `@openldr/web` parallel test flake — if a turbo `web#test` goes red, re-run `pnpm -C apps/web test` in isolation before trusting it; this SP touches no web code.)

- [ ] **Step 5: Acceptance check (matches the spec's acceptance criteria)**

Confirm, by re-reading the test output:
- `GET /api/workflows/nodes` lists host nodes **and** a fixture plugin's source + sink nodes with correct kind/ports/config/capabilities and composite ids (`${pluginId}:${node.id}`).
- An over-broad capability node and a malformed node are dropped (registry tests), never crashing discovery.
- Existing signed plugin artifacts with no `workflowNodes` stay byte-identical (artifact-manifest tests).
- Nothing in the existing builder or workflow runs changed behavior (SP-1 is purely additive; no handler or run-path file was modified).

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1–4 = deliverable #1 (manifest schema + adapter mirroring). Task 5 = deliverable #3 (host-node descriptors). Task 6 = deliverable #2 (registry: merge, composite id, `capabilities ⊆ readGrant`, kind↔ports, duplicate-id, fail-soft drop+log). Task 7 = deliverable #5 (types exported from `@openldr/workflows`). Task 8 = deliverable #4 (list API + node-options stub). Task 9 = acceptance gate.
- **Type consistency:** `WorkflowNodeDescriptor` is defined once in `host-nodes.ts` and imported by `node-registry.ts` + re-exported from the barrel. `WorkflowNodeDecl`/`WorkflowConfigField`/`WorkflowPort`/`WorkflowNodeKind` are defined once in `marketplace/workflow-node.ts` and re-exported. The registry uses `decl.ports.inputs` / `decl.capabilities` exactly as the schema defines them.
- **Security invariants honored:** capability-subset enforced at registry build (Task 6); legacy grant grandfathered to match the broker; `workflowNodes` is inside the signed payload (Task 3) so tampering breaks the signature; discovery is fail-soft (drop + log, never throw).
- **No behavior change:** no node *handler*, `run-workflow.ts`, or builder file is touched. Host descriptors are pure metadata.
