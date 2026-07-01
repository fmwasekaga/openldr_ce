import type { WorkflowNode, WorkflowEdge, WorkflowDefinition } from './types';

export function serializeWorkflow(
  name: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  id?: string,
): WorkflowDefinition {
  return {
    id,
    name,
    description: '',
    nodes: nodes.map((n) => ({
      ...n,
      selected: undefined,
      dragging: undefined,
    })),
    edges: edges.map((e) => ({
      ...e,
      selected: undefined,
    })),
  };
}

export function deserializeWorkflow(definition: WorkflowDefinition): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  return {
    nodes: definition.nodes,
    edges: definition.edges,
  };
}
