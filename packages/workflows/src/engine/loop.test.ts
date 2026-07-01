import { describe, it, expect } from 'vitest';
import { computeLoopBody, planIterations, buildIterationNodes } from './loop';
import type { WorkflowEdge } from '../types';
import type { RunnerNode } from './node-handlers';

const N = (id: string, type = 'action'): RunnerNode => ({ id, type, data: {} });
const E = (id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge =>
  ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) }) as WorkflowEdge;

describe('computeLoopBody', () => {
  // trigger -> loop ; loop --loop--> b1 -> b2(leaf) ; loop --done--> cont
  const nodes = [N('t', 'trigger'), N('loop', 'loop'), N('b1'), N('b2'), N('cont')];
  const edges = [
    E('e0', 't', 'loop'),
    E('e1', 'loop', 'b1', 'loop'),
    E('e2', 'b1', 'b2'),
    E('e3', 'loop', 'cont', 'done'),
  ];

  it('returns the dominated body region and its edges', () => {
    const { bodyNodeIds, bodyEdges } = computeLoopBody('loop', nodes, edges);
    expect([...bodyNodeIds].sort()).toEqual(['b1', 'b2']);
    expect(bodyEdges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('throws when there is no loop-handle body', () => {
    const bad = [N('t', 'trigger'), N('loop', 'loop'), N('cont')];
    const be = [E('e0', 't', 'loop'), E('e1', 'loop', 'cont', 'done')];
    expect(() => computeLoopBody('loop', bad, be)).toThrow(/no body connected/);
  });

  it('throws when the body escapes back into the main flow', () => {
    const escNodes = [N('t', 'trigger'), N('loop', 'loop'), N('b1'), N('cont')];
    const escEdges = [
      E('e0', 't', 'loop'),
      E('e1', 'loop', 'b1', 'loop'),
      E('e2', 'b1', 'cont'),
      E('e3', 'loop', 'cont', 'done'),
    ];
    expect(() => computeLoopBody('loop', escNodes, escEdges)).toThrow(/must not connect back into the main flow/);
  });
});

describe('planIterations', () => {
  const items = [{ json: { a: 1 } }, { json: { a: 2 } }, { json: { a: 3 } }];

  it('count mode: clamps iterations to [1,1000], item undefined, batch = all input', () => {
    const plan = planIterations({ loopMode: 'count', iterations: 2 }, items);
    expect(plan.map((p) => p.index)).toEqual([0, 1]);
    expect(plan[0].item).toBeUndefined();
    expect(plan[0].batch).toBe(items);
    expect(planIterations({ loopMode: 'count', iterations: 0 }, items)).toHaveLength(1);
    expect(planIterations({ loopMode: 'count', iterations: 5000 }, items)).toHaveLength(1000);
  });

  it('items mode: batches by batchSize, item = first json of the batch', () => {
    const plan = planIterations({ loopMode: 'items', batchSize: 2 }, items);
    expect(plan).toHaveLength(2);
    expect(plan[0].batch).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
    expect(plan[0].item).toEqual({ a: 1 });
    expect(plan[1].batch).toEqual([{ json: { a: 3 } }]);
    expect(plan[1].item).toEqual({ a: 3 });
  });

  it('items mode: zero input items → zero iterations', () => {
    expect(planIterations({ loopMode: 'items', batchSize: 1 }, [])).toEqual([]);
  });

  it('items mode: batchSize defaults to 1 and is floored to >= 1', () => {
    expect(planIterations({ loopMode: 'items' }, items)).toHaveLength(3);
    expect(planIterations({ loopMode: 'items', batchSize: 0 }, items)).toHaveLength(3);
  });
});

describe('buildIterationNodes', () => {
  it('replaces the loop node with a synthetic manual trigger and includes only body nodes', () => {
    const nodes = [N('t', 'trigger'), N('loop', 'loop'), N('b1'), N('b2'), N('cont')];
    const out = buildIterationNodes(nodes.find((n) => n.id === 'loop')!, new Set(['b1', 'b2']), nodes);
    expect(out[0]).toEqual({ id: 'loop', type: 'trigger', data: { triggerType: 'manual', config: {} } });
    expect(out.slice(1).map((n) => n.id).sort()).toEqual(['b1', 'b2']);
  });
});
