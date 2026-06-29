import { describe, it, expect, vi } from 'vitest';
import { runWorkflow } from './run-workflow';
import type { RunEvent } from '../types';

const collect = () => {
  const events: RunEvent[] = [];
  return { events, onEvent: (e: RunEvent) => events.push(e) };
};

describe('runWorkflow', () => {
  it('runs nodes in topological order and emits the event protocol', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: { triggerType: 'manual' } },
      { id: 'l', type: 'action', data: { action: 'log', message: 'hi {{ $json.triggered }}' } },
    ];
    const edges = [{ id: 'e1', source: 't', target: 'l' }];
    const sink = collect();
    const res = await runWorkflow(nodes, edges, { onEvent: sink.onEvent });
    expect(res.status).toBe('completed');
    const types = sink.events.map((e) => e.type);
    expect(types).toEqual([
      'node:start', 'node:success',
      'node:start', 'node:log', 'node:success',
      'workflow:done',
    ]);
    // outputs are WorkflowItem[]
    const tOut = res.results.find((r) => r.nodeId === 't')?.output as { json: Record<string, unknown> }[];
    expect(Array.isArray(tOut)).toBe(true);
    expect(tOut[0]?.json.triggered).toBe(true);
  });

  it('prunes the untaken condition branch', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'condition', data: { templateId: 'if', condition: 'false' } },
      { id: 'a', type: 'action', data: { action: 'no-op' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'c' },
      { id: 'e2', source: 'c', target: 'a', sourceHandle: 'true' },
    ];
    const res = await runWorkflow(nodes, edges, {});
    const aResult = res.results.find((r) => r.nodeId === 'a');
    expect(aResult?.status).toBe('skipped');
  });

  it('halts on error and reports failed', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'condition', data: { templateId: 'if', condition: 'throw new Error("boom")' } },
    ];
    const edges = [{ id: 'e1', source: 't', target: 'c' }];
    const res = await runWorkflow(nodes, edges, {});
    expect(res.status).toBe('failed');
  });

  it('runs a SQL source node and feeds rows downstream as items', async () => {
    const services = {
      runSql: async () => ({ columns: [{ key: 'name', label: 'name' }], rows: [{ name: 'alice' }] }),
      fhirQuery: async () => ({ resources: [] }),
      httpFetch: async () => ({ status: 200, headers: {}, data: null }),
      materializeDataset: async (name: string, _c: unknown, rows: unknown[]) => ({ dataset: name, rowCount: rows.length }),
      exportArtifact: async () => ({ objectKey: 'k', format: 'csv', byteSize: 0 }),
      loadDataset: async () => ({ columns: [], rows: [] }),
    };
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'q', type: 'action', data: { action: 'sql-query', config: { sql: 'select name from x' } } },
      { id: 'l', type: 'action', data: { action: 'log', message: 'first={{ $json.name }}' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'q' },
      { id: 'e2', source: 'q', target: 'l' },
    ];
    const logs: string[] = [];
    const res = await runWorkflow(nodes, edges, { services, onEvent: (e) => { if (e.type === 'node:log') logs.push(e.entry.message); } });
    expect(res.status).toBe('completed');
    expect(logs).toContain('first=alice');
  });

  it('runs a materialize sink with an injected service', async () => {
    const saved: unknown[] = [];
    const services = {
      runSql: async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }] }),
      fhirQuery: async () => ({ resources: [] }),
      httpFetch: async () => ({ status: 200, headers: {}, data: null }),
      materializeDataset: async (name: string, _c: unknown, rows: unknown[]) => {
        saved.push({ name, rows });
        return { dataset: name, rowCount: rows.length };
      },
      exportArtifact: async () => ({ objectKey: 'k', format: 'csv', byteSize: 0 }),
      loadDataset: async () => ({ columns: [], rows: [] }),
    };
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'q', type: 'action', data: { action: 'sql-query', config: { sql: 'select 1' } } },
      { id: 'm', type: 'action', data: { action: 'materialize-dataset', config: { datasetName: 'ds1' } } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'q' },
      { id: 'e2', source: 'q', target: 'm' },
    ];
    const res = await runWorkflow(nodes, edges, { services: services as never, workflowId: 'w1' });
    expect(res.status).toBe('completed');
    expect(saved.length).toBe(1);
  });

  it('runs a code node, streams its log, and passes its output downstream', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'code', data: { code: "console.log('in code'); return { n: 42 };" } },
      { id: 'l', type: 'action', data: { action: 'log', message: 'n={{ $json.n }}' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'c' },
      { id: 'e2', source: 'c', target: 'l' },
    ];
    const events: RunEvent[] = [];
    // Code nodes are gated OFF by default (SEC-01); opt in for this happy-path test.
    const res = await runWorkflow(nodes, edges, {
      onEvent: (e) => events.push(e),
      codeLimits: { timeoutMs: 5000, memoryMb: 128, enabled: true },
    });
    expect(res.status).toBe('completed');
    const cOut = res.results.find((r) => r.nodeId === 'c')?.output as { json: Record<string, unknown> }[];
    expect(Array.isArray(cOut)).toBe(true);
    expect(cOut[0]?.json.n).toBe(42);
    expect(events.some((e) => e.type === 'node:log' && e.entry.message === 'in code')).toBe(true);
  });

  it('merges items from two upstream sources (multi-input)', async () => {
    // two parallel sources feeding a merge node
    const nodes = [
      { id: 'a', type: 'trigger', data: {} },
      { id: 'b', type: 'trigger', data: {} },
      { id: 'm', type: 'action', data: { action: 'merge', config: { mode: 'append' } } },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'm' },
      { id: 'e2', source: 'b', target: 'm' },
    ];
    const res = await runWorkflow(nodes, edges, {});
    expect(res.status).toBe('completed');
    const mOut = res.results.find((r) => r.nodeId === 'm')?.output as { json: Record<string, unknown> }[];
    // each trigger produces 1 item → merge appends → 2 items
    expect(Array.isArray(mOut)).toBe(true);
    expect(mOut.length).toBe(2);
  });

  it('prunes the not-taken If branch downstream node (true condition → false handle skipped)', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'i', type: 'condition', data: { templateId: 'if', condition: 'true' } },
      { id: 'yes', type: 'action', data: { action: 'no-op' } },
      { id: 'no', type: 'action', data: { action: 'no-op' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'i' },
      { id: 'e2', source: 'i', target: 'yes', sourceHandle: 'true' },
      { id: 'e3', source: 'i', target: 'no', sourceHandle: 'false' },
    ];
    const res = await runWorkflow(nodes, edges, {});
    expect(res.status).toBe('completed');
    expect(res.results.find((r) => r.nodeId === 'yes')?.status).toBe('success');
    expect(res.results.find((r) => r.nodeId === 'no')?.status).toBe('skipped');
  });

  it('prunes Filter true-handle downstream when all items are dropped', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      // filter condition that always fails: triggered=true but we check for false
      { id: 'f', type: 'condition', data: { templateId: 'filter', condition: '$json.triggered === false' } },
      { id: 'd', type: 'action', data: { action: 'no-op' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'f' },
      { id: 'e2', source: 'f', target: 'd', sourceHandle: 'true' },
    ];
    const res = await runWorkflow(nodes, edges, {});
    expect(res.status).toBe('completed');
    expect(res.results.find((r) => r.nodeId === 'f')?.status).toBe('success');
    expect(res.results.find((r) => r.nodeId === 'd')?.status).toBe('skipped');
  });

  it('threads files through runWorkflow so the trigger item carries the binary lane', async () => {
    const files = { file: { objectKey: 'uploads/x', contentType: 'application/octet-stream', byteSize: 5 } };
    const nodes = [{ id: 't', type: 'trigger', data: {} }];
    const edges: never[] = [];
    const res = await runWorkflow(nodes, edges, { files });
    expect(res.status).toBe('completed');
    const tOut = res.results.find((r) => r.nodeId === 't')?.output as { json: Record<string, unknown>; binary?: unknown }[];
    expect(Array.isArray(tOut)).toBe(true);
    expect(tOut[0]?.binary).toEqual(files);
  });

  it('plugin-node → materialize chain: sink receives the plugin items as rows', async () => {
    const materializeSpy = vi.fn().mockResolvedValue({ dataset: 'ds', rowCount: 1 });
    const runPluginNode = vi.fn().mockResolvedValue({ items: [{ json: { a: 1 } }], meta: { kind: 'dataValueSet', dataValues: 1 } });
    const services = {
      runSql: async () => ({ columns: [], rows: [] }),
      fhirQuery: async () => ({ resources: [] }),
      httpFetch: async () => ({ status: 200, headers: {}, data: null }),
      materializeDataset: materializeSpy,
      exportArtifact: async () => ({ objectKey: 'k', format: 'csv', byteSize: 0 }),
      loadDataset: async () => ({ columns: [], rows: [] }),
      runPluginNode,
    };
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'p', type: 'plugin-node', data: { pluginId: 'my-plugin', nodeId: 'my-node', kind: 'transform', config: {} } },
      { id: 'm', type: 'action', data: { action: 'materialize-dataset', config: { datasetName: 'ds' } } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'p' },
      { id: 'e2', source: 'p', target: 'm' },
    ];
    const sink = collect();
    const res = await runWorkflow(nodes, edges, { services: services as never, onEvent: sink.onEvent });
    expect(res.status).toBe('completed');
    // materializeDataset should have received rows: [{ a: 1 }]
    expect(materializeSpy).toHaveBeenCalledOnce();
    const [, , rows] = materializeSpy.mock.calls[0] as [string, unknown, Record<string, unknown>[]];
    expect(rows).toEqual([{ a: 1 }]);
    // The plugin node's meta is threaded onto its results record + node:success event.
    expect(res.results.find((r) => r.nodeId === 'p')?.meta).toEqual({ kind: 'dataValueSet', dataValues: 1 });
    const pSuccess = sink.events.find(
      (e): e is Extract<RunEvent, { type: 'node:success' }> => e.type === 'node:success' && e.nodeId === 'p',
    );
    expect(pSuccess?.meta).toEqual({ kind: 'dataValueSet', dataValues: 1 });
    // Non-plugin nodes carry no meta.
    expect(res.results.find((r) => r.nodeId === 'm')?.meta).toBeUndefined();
  });
});
