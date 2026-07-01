import type { WorkflowNode } from './types';

export function isValidConnection(
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
  nodes: WorkflowNode[],
): boolean {
  // No self-connections
  if (connection.source === connection.target) return false;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) return false;

  // Triggers can only be sources
  if (targetNode.type === 'trigger' || targetNode.type === 'webhook') return false;

  return true;
}
