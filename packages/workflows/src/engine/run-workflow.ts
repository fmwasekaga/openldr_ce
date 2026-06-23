/**
 * Streaming workflow executor.
 *
 * Each node has a handler in `node-handlers/`. The runner walks the graph in
 * topological order, passing the upstream node's output into the next handler
 * via an `ExecutionContext`. Per-node lifecycle events (`node:start`,
 * `node:log`, `node:success`, `node:error`, `workflow:done`) are emitted
 * through `ctx.emit` so an SSE endpoint can stream them to the UI; the same
 * runner is also used by the legacy `/execute` route, which buffers events
 * into a single `WorkflowRunResult`.
 */

import { pickHandler, type RunnerNode } from './node-handlers';
import { createContext } from './execution-context';
import type { RunEvent, LogEntry, WorkflowEdge } from '../types';

export type WorkflowNode = RunnerNode;

export interface NodeRunResult {
  nodeId: string;
  type: string;
  status: 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  durationMs: number;
  logs?: LogEntry[];
}

export interface WorkflowRunResult {
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  results: NodeRunResult[];
}

/** Topological sort. Same algorithm as before, just keyed off the new types. */
export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

/**
 * Pick the immediate upstream node's output to feed into the next handler.
 * If a node has multiple incoming edges we just take the first that has run;
 * good enough for the linear workflows the UI builds today and matches the
 * `$input` mental model. The `nodeOutputs` map is also available to handlers
 * via `ctx` for richer routing later.
 */
function upstreamOutputFor(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  nodeOutputs: Record<string, unknown>,
): unknown {
  for (const edge of edges) {
    if (edge.target === node.id && edge.source in nodeOutputs) {
      return nodeOutputs[edge.source];
    }
  }
  return undefined;
}

export interface RunWorkflowOptions {
  /** Initial trigger payload, e.g. webhook body. */
  input?: unknown;
  /** Per-event sink. Defaults to a no-op so the legacy /execute path stays untouched. */
  onEvent?: (evt: RunEvent) => void;
}

export async function runWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  opts: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const startedAt = new Date().toISOString();
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges);
  const sorted = topologicalSort(nodes, edges);
  const results: NodeRunResult[] = [];

  // Track edges we should ignore because their source's `branch` output
  // says we went the other way (e.g. a condition that took the `true` branch
  // shouldn't run any node connected to its `false` handle).
  const skippedEdges = new Set<string>();
  const skippedNodes = new Set<string>();

  let failed = false;

  for (const node of sorted) {
    // If every incoming edge to this node was skipped, skip the node too.
    const incoming = edges.filter((e) => e.target === node.id);
    if (incoming.length > 0 && incoming.every((e) => skippedEdges.has(e.id))) {
      skippedNodes.add(node.id);
      results.push({
        nodeId: node.id,
        type: node.type,
        status: 'skipped',
        durationMs: 0,
      });
      // Cascade: also skip outgoing edges so anything purely downstream of
      // a skipped node won't fire either.
      for (const e of edges.filter((edge) => edge.source === node.id)) {
        skippedEdges.add(e.id);
      }
      continue;
    }

    ctx.emit({ type: 'node:start', nodeId: node.id, nodeType: node.type });

    const start = Date.now();
    try {
      const upstream = upstreamOutputFor(node, edges, ctx.nodeOutputs);
      const handler = pickHandler(node);
      const output = await handler(node, ctx, upstream);
      ctx.nodeOutputs[node.id] = output;

      const durationMs = Date.now() - start;
      results.push({
        nodeId: node.id,
        type: node.type,
        status: 'success',
        output,
        durationMs,
        logs: ctx.logs[node.id],
      });
      ctx.emit({
        type: 'node:success',
        nodeId: node.id,
        nodeType: node.type,
        input: upstream,
        output,
        durationMs,
      });

      // Condition node: prune the unused branch.
      if (
        node.type === 'condition' &&
        output &&
        typeof output === 'object' &&
        'branch' in (output as Record<string, unknown>)
      ) {
        const branch = (output as Record<string, unknown>).branch as
          | 'true'
          | 'false';
        for (const e of edges.filter((edge) => edge.source === node.id)) {
          if (e.sourceHandle && e.sourceHandle !== branch) {
            skippedEdges.add(e.id);
          }
        }
      }
    } catch (err) {
      failed = true;
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        nodeId: node.id,
        type: node.type,
        status: 'error',
        error: message,
        durationMs,
        logs: ctx.logs[node.id],
      });
      ctx.emit({
        type: 'node:error',
        nodeId: node.id,
        nodeType: node.type,
        error: message,
        durationMs,
      });
      // Stop on first failure (matches typical workflow tools).
      break;
    }
  }

  const status: 'completed' | 'failed' = failed ? 'failed' : 'completed';
  ctx.emit({ type: 'workflow:done', status });

  return {
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}
