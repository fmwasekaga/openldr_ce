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

  it('nested loop: inner runs inside outer body; done accumulates outer×inner; inner $index shadows outer', async () => {
    // Outer (count 2) body IS an inner loop (count 3). The inner body is a `set`
    // node that stamps the current $index into each item. In count mode the inner
    // loop re-runs its 1-item batch 3 times → the inner `done` accumulates 3 items
    // (idx 0,1,2). Inner `done` feeds a passthrough `set` (`collect`) which is the
    // outer body's terminal leaf, so the outer body's accumulation per outer
    // iteration = 3 items. Outer count 2 → outer `done` accumulates 2 × 3 = 6.
    // `set` is an ACTION subtype: pickHandler routes on data.action, so the node
    // must be type:'action' with action:'set' (a bare type:'set' falls through to
    // the passthrough default handler and would ignore the config).
    const set = (id: string, name: string, value: string) => ({
      id,
      type: 'action',
      data: { action: 'set', config: { fields: [{ name, value }], keepExisting: true } },
    });
    const nodes = [
      trigger('t'),
      loop('outer', { loopMode: 'count', iterations: 2 }),
      loop('inner', { loopMode: 'count', iterations: 3 }),
      set('stamp', 'idx', '{{ $index }}'),
      set('collect', 'seen', 'yes'),
      log('end'),
    ];
    const edges = [
      edge('e0', 't', 'outer'),
      edge('e1', 'outer', 'inner', 'loop'),   // outer body entry = inner loop
      edge('e2', 'inner', 'stamp', 'loop'),   // inner body = stamp
      edge('e3', 'inner', 'collect', 'done'), // inner done -> outer body terminal leaf
      edge('e4', 'outer', 'end', 'done'),     // outer done continuation
    ];
    const res = await runWorkflow(nodes, edges, { input: [{ json: { x: 1 } }] });
    expect(res.status).toBe('completed');
    const outer = res.results.find((r) => r.nodeId === 'outer')!;
    const outerItems = outer.output as Array<{ json: { idx?: string } }>;
    expect(outerItems.length).toBe(6); // 2 outer × 3 inner
    expect(res.results.find((r) => r.nodeId === 'end')!.status).toBe('success');
    // Inner $index (0,1,2) surfaced through the innermost loopVars frame, proving it
    // shadows the outer index. The stamped idx survives through `collect`
    // (keepExisting), so the 6 accumulated items carry inner indices 0,1,2 twice.
    const stamped = outerItems.map((i) => i.json.idx).sort();
    expect(stamped).toEqual(['0', '0', '1', '1', '2', '2']);
  });
});
