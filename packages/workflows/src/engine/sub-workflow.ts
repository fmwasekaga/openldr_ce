import type { WorkflowEdge } from '../types';
import type { WorkflowItem } from './items';
import type { NodeRunResult } from './run-workflow';

/** Hard cap on execute-workflow nesting depth. */
export const MAX_SUBWORKFLOW_DEPTH = 5;

/**
 * Throw if invoking `workflowId` from the current `callStack` would recurse
 * illegally — either re-entering a workflow already on the stack (cycle) or
 * exceeding MAX_SUBWORKFLOW_DEPTH.
 */
export function assertSubWorkflowAllowed(workflowId: string, callStack: string[]): void {
  if (callStack.includes(workflowId)) {
    throw new Error(`Execute Workflow: cycle detected: ${workflowId}`);
  }
  if (callStack.length >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`Execute Workflow: max nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`);
  }
}

/**
 * Terminal items of a finished sub-run = the concatenated `output` of every leaf
 * node (a node that is not the `source` of any edge) that ran successfully.
 */
export function extractTerminalItems(
  edges: WorkflowEdge[],
  results: NodeRunResult[],
): WorkflowItem[] {
  const hasOutgoing = new Set(edges.map((e) => e.source));
  const out: WorkflowItem[] = [];
  for (const r of results) {
    if (r.status !== 'success') continue;
    if (hasOutgoing.has(r.nodeId)) continue;
    if (Array.isArray(r.output)) out.push(...(r.output as WorkflowItem[]));
  }
  return out;
}
