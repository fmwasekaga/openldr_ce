import type { NodeHandler } from './types';

/**
 * Fallback handler for node types that don't yet have a real implementation.
 * Passes the upstream output through unchanged so the graph still propagates
 * data — useful for sketching a pipeline before wiring up every node.
 */
export const defaultHandler: NodeHandler = async (node, _ctx, upstream) => {
  return {
    passthrough: true,
    type: node.type,
    label: (node.data.label as string | undefined) ?? node.id,
    input: upstream,
  };
};
