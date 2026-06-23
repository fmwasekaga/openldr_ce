import type { NodeHandler } from './types';

/**
 * Merge data from multiple incoming branches. Uses `ctx.edges` to discover
 * all source nodes feeding into this merge node, then combines their outputs
 * based on the configured mode.
 */
export const mergeHandler: NodeHandler = async (node, ctx, _upstream) => {
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const mode = (config.mode as string) ?? 'append';

  // Collect outputs from all incoming edges
  const incomingNodeIds = ctx.edges
    .filter((e) => e.target === node.id)
    .map((e) => e.source);

  const inputs = incomingNodeIds
    .map((id) => ctx.nodeOutputs[id])
    .filter((v) => v !== undefined);

  switch (mode) {
    case 'combine': {
      // Deep-merge all objects into one
      const merged: Record<string, unknown> = {};
      for (const input of inputs) {
        if (input && typeof input === 'object' && !Array.isArray(input)) {
          Object.assign(merged, input);
        }
      }
      return merged;
    }

    case 'chooseBranch': {
      const index = Number(config.preferredBranch ?? 0);
      return inputs[index] ?? inputs[0] ?? null;
    }

    case 'append':
    default: {
      // Collect all inputs into a flat array
      const result: unknown[] = [];
      for (const input of inputs) {
        if (Array.isArray(input)) {
          result.push(...input);
        } else {
          result.push(input);
        }
      }
      return result;
    }
  }
};
