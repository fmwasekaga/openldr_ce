import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';

/**
 * Merge items from multiple incoming branches. Uses `ctx.edges` + `ctx.nodeOutputs`
 * to discover all source nodes feeding into this merge node, then combines based on mode.
 */
export const mergeHandler: NodeHandler = async (node, ctx, _input) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mode = (config.mode as string) ?? 'append';
  const branches: WorkflowItem[][] = ctx.edges
    .filter((e) => e.target === node.id)
    .map((e) => ctx.nodeOutputs[e.source])
    .filter((v): v is WorkflowItem[] => Array.isArray(v));

  switch (mode) {
    case 'combine': {
      const merged: Record<string, unknown> = {};
      for (const items of branches) for (const it of items) Object.assign(merged, it.json);
      return [{ json: merged }];
    }
    case 'chooseBranch': {
      const index = Number(config.preferredBranch ?? 0);
      return branches[index] ?? branches[0] ?? [];
    }
    case 'append':
    default:
      return branches.flat();
  }
};
