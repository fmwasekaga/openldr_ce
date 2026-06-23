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
});
