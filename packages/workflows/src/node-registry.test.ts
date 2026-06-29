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
    expect(sink.kind).toBe('sink');
    expect(sink.capabilities).toEqual(['host:connectors']);
    // description/config are absent on the decl, so the schema defaults flow through to the descriptor.
    expect(sink.description).toBe('');
    expect(sink.config).toEqual([]);
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
