import { describe, it, expect } from 'vitest';
import { runWorkflow } from './run-workflow';
import type { WorkflowEdge } from '../types';

const trigger = (id: string) => ({ id, type: 'trigger', data: { triggerType: 'manual', config: {} } });
const loop = (id: string, data: Record<string, unknown>) => ({ id, type: 'loop', data });
const log = (id: string) => ({ id, type: 'action', data: { action: 'log', message: 'i={{ $index }}' } });
const edge = (id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge =>
  ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) }) as WorkflowEdge;

describe('loop runner', () => {
  it('count mode: runs the body N times and accumulates its output on done', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 3 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { x: 1 } }] });
    expect(res.status).toBe('completed');
    const loopResult = res.results.find((r) => r.nodeId === 'lp')!;
    expect((loopResult.output as unknown[]).length).toBe(3);
    expect(res.results.find((r) => r.nodeId === 'end')!.status).toBe('success');
  });

  it('items mode batchSize 1: one iteration per item', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'items', batchSize: 1 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { a: 1 } }, { json: { a: 2 } }] });
    expect(res.status).toBe('completed');
    expect((res.results.find((r) => r.nodeId === 'lp')!.output as unknown[]).length).toBe(2);
  });

  it('malformed loop (empty body) fails the loop node', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 2 }), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: {} }] });
    expect(res.status).toBe('failed');
    expect(res.results.find((r) => r.nodeId === 'lp')!.error).toMatch(/no body connected/);
  });

  it('accumulation cap throws', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 5 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { a: 1 } }, { json: { a: 2 } }], loopMaxItems: 3 });
    expect(res.status).toBe('failed');
    expect(res.results.find((r) => r.nodeId === 'lp')!.error).toMatch(/exceeded the limit/);
  });

  it('body nodes do not run in the main pass (no duplicate output)', async () => {
    const nodes = [trigger('t'), loop('lp', { loopMode: 'count', iterations: 1 }), log('body'), log('end')];
    const edges = [edge('e0', 't', 'lp'), edge('e1', 'lp', 'body', 'loop'), edge('e2', 'lp', 'end', 'done')];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { a: 1 } }] });
    expect(res.results.some((r) => r.nodeId === 'body')).toBe(false);
  });
});
