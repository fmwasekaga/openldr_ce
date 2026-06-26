import { describe, it, expect } from 'vitest';
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
      { id: 'l', type: 'action', data: { action: 'log', message: 'hi {{ $input.triggered }}' } },
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

  it('runs a SQL source node and feeds rows downstream', async () => {
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
      { id: 'l', type: 'action', data: { action: 'log', message: 'first={{ $input.rows.0.name }}' } },
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
      { id: 'l', type: 'action', data: { action: 'log', message: 'n={{ $input.n }}' } },
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
    const cOut = res.results.find((r) => r.nodeId === 'c')?.output;
    expect(cOut).toEqual({ n: 42 });
    expect(events.some((e) => e.type === 'node:log' && e.entry.message === 'in code')).toBe(true);
  });
});
