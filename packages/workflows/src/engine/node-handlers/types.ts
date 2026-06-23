import type { ExecutionContext } from '../execution-context';

export interface RunnerNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Signature every node handler implements. */
export type NodeHandler = (
  node: RunnerNode,
  ctx: ExecutionContext,
  upstreamOutput: unknown,
) => Promise<unknown> | unknown;
