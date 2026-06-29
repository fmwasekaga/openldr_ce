import type { ExecutionContext } from '../execution-context';
import type { WorkflowItem } from '../items';

export interface RunnerNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Signature every node handler implements. */
export type NodeHandler = (
  node: RunnerNode,
  ctx: ExecutionContext,
  input: WorkflowItem[],
) => Promise<WorkflowItem[]> | WorkflowItem[];
