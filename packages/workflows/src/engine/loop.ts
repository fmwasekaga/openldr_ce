import type { WorkflowEdge } from '../types';
import type { WorkflowItem } from './items';
import type { RunnerNode } from './node-handlers';

/** Forward-reachable set from `starts`, following all edges. Optionally treat
 *  `barrier` as a sink (you may reach it but never traverse OUT of it). */
function reachable(starts: string[], edges: WorkflowEdge[], barrier?: string): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === barrier) continue; // cannot pass through the barrier
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

export interface LoopBody {
  bodyNodeIds: Set<string>;
  bodyEdges: WorkflowEdge[];
}

/**
 * Compute the body region of a loop node. Both the body (reachable via the
 * `loop` handle) and the done-continuation (reachable via the `done` handle) are
 * dominated by the loop node, so they must be separated BY HANDLE: the body is
 * what the `loop` handle reaches, MINUS the done-continuation, MINUS the main
 * flow. Throws on a malformed loop.
 */
export function computeLoopBody(loopNodeId: string, nodes: RunnerNode[], edges: WorkflowEdge[]): LoopBody {
  const entry = edges.filter((e) => e.source === loopNodeId && e.sourceHandle === 'loop').map((e) => e.target);
  if (entry.length === 0) throw new Error('Loop: no body connected to the loop output');
  const doneTargets = edges.filter((e) => e.source === loopNodeId && e.sourceHandle === 'done').map((e) => e.target);

  // Reachable sets, never traversing OUT of the loop node itself.
  const fromEntry = reachable(entry, edges, loopNodeId);         // candidate body
  const contReach = reachable(doneTargets, edges, loopNodeId);   // done-continuation
  const sources = nodes.filter((n) => !edges.some((e) => e.target === n.id)).map((n) => n.id);
  const mainFlow = reachable(sources, edges, loopNodeId);        // pre-loop main flow

  const bodyNodeIds = new Set<string>();
  for (const id of fromEntry) {
    if (id === loopNodeId) continue;
    if (contReach.has(id)) continue; // belongs to the continuation, not the body
    if (mainFlow.has(id)) continue;  // belongs to the pre-loop main flow
    bodyNodeIds.add(id);
  }
  if (bodyNodeIds.size === 0) throw new Error('Loop: no body connected to the loop output');

  // Strict: a body node must not have an edge leaving the body (the only bridge
  // back to the main flow is the loop node's `done` output). Edges back to the
  // loop node itself are not part of this acyclic model and are also rejected.
  for (const e of edges) {
    if (bodyNodeIds.has(e.source) && !bodyNodeIds.has(e.target)) {
      throw new Error('Loop: body must not connect back into the main flow except via the done output');
    }
  }

  // Includes the loop-node's entry edge(s) (source = loop node) as well as
  // internal body edges — the runner needs the entry so the synthetic trigger
  // feeds the body's first nodes.
  const bodyEdges = edges.filter((e) => bodyNodeIds.has(e.target));
  return { bodyNodeIds, bodyEdges };
}

export interface LoopIteration { index: number; item?: Record<string, unknown>; batch: WorkflowItem[]; }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Build the per-iteration plan for a loop node. */
export function planIterations(
  data: { loopMode?: string; iterations?: number; batchSize?: number },
  input: WorkflowItem[],
): LoopIteration[] {
  const mode = data.loopMode ?? 'count';
  if (mode === 'items') {
    const size = Math.max(1, Math.floor(Number(data.batchSize) || 1));
    const out: LoopIteration[] = [];
    for (let i = 0, idx = 0; i < input.length; i += size, idx++) {
      const batch = input.slice(i, i + size);
      out.push({ index: idx, item: batch[0]?.json, batch });
    }
    return out;
  }
  const n = clamp(Math.floor(Number(data.iterations) || 0) || 1, 1, 1000);
  return Array.from({ length: n }, (_, index) => ({ index, item: undefined, batch: input }));
}

/** Replace the loop node with a synthetic manual trigger (emits the iteration's
 *  batch) and append the body nodes. */
export function buildIterationNodes(loopNode: RunnerNode, bodyNodeIds: Set<string>, nodes: RunnerNode[]): RunnerNode[] {
  const synthetic: RunnerNode = { id: loopNode.id, type: 'trigger', data: { triggerType: 'manual', config: {} } };
  return [synthetic, ...nodes.filter((n) => bodyNodeIds.has(n.id))];
}
