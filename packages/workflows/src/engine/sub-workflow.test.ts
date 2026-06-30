import { describe, it, expect } from 'vitest';
import { assertSubWorkflowAllowed, extractTerminalItems, MAX_SUBWORKFLOW_DEPTH } from './sub-workflow';
import type { NodeRunResult } from './run-workflow';
import type { WorkflowEdge } from '../types';

describe('assertSubWorkflowAllowed', () => {
  it('allows a fresh workflow id', () => {
    expect(() => assertSubWorkflowAllowed('wf-b', ['wf-a'])).not.toThrow();
  });

  it('rejects a cycle', () => {
    expect(() => assertSubWorkflowAllowed('wf-a', ['wf-a'])).toThrow(/cycle detected: wf-a/);
  });

  it('rejects exceeding the max depth', () => {
    const stack = Array.from({ length: MAX_SUBWORKFLOW_DEPTH }, (_, i) => `wf-${i}`);
    expect(() => assertSubWorkflowAllowed('wf-new', stack)).toThrow(/max nesting depth \(5\) exceeded/);
  });
});

describe('extractTerminalItems', () => {
  const edges: WorkflowEdge[] = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
  ] as WorkflowEdge[];

  const mk = (nodeId: string, status: NodeRunResult['status'], output: unknown): NodeRunResult => ({
    nodeId, type: 'action', status, output, durationMs: 0,
  });

  it('returns concatenated output of successful leaf nodes only', () => {
    // a and b have outgoing edges → not leaves. c is the only leaf.
    const results = [
      mk('a', 'success', [{ json: { a: 1 } }]),
      mk('b', 'success', [{ json: { b: 1 } }]),
      mk('c', 'success', [{ json: { c: 1 } }, { json: { c: 2 } }]),
    ];
    expect(extractTerminalItems(edges, results)).toEqual([{ json: { c: 1 } }, { json: { c: 2 } }]);
  });

  it('concatenates multiple leaves and skips failed / non-array outputs', () => {
    const twoLeafEdges: WorkflowEdge[] = [{ id: 'e1', source: 'a', target: 'b' }] as WorkflowEdge[];
    // leaves: b and c (neither is an edge source).
    const results = [
      mk('a', 'success', [{ json: { a: 1 } }]),
      mk('b', 'success', [{ json: { b: 1 } }]),
      mk('c', 'success', [{ json: { c: 1 } }]),
      mk('d', 'error', undefined),
    ];
    expect(extractTerminalItems(twoLeafEdges, results)).toEqual([{ json: { b: 1 } }, { json: { c: 1 } }]);
  });
});
