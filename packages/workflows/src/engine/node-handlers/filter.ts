import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { evalExpression, COND_LIMITS } from '../js-isolate';
import type { WorkflowItem } from '../items';

/**
 * Filter node — per-item condition. Passing items are returned; pruned items are
 * dropped. ctx.branches[node.id] is set to 'true' if any items passed, 'false'
 * otherwise (runner uses this to prune the downstream 'true' handle when nothing passes).
 */
export const filterHandler: NodeHandler = async (node, ctx, input) => {
  const raw = (node.data.condition as string | undefined) ?? '';
  const kept: WorkflowItem[] = [];
  for (const item of input) {
    const resolved = resolveTemplate(raw, ctx, [item]);
    if (!resolved.trim()) continue;
    try {
      const scope = { $input: [item], $json: item.json, $items: [item.json], input: [item] };
      if (await evalExpression(resolved, scope, COND_LIMITS)) kept.push(item);
    } catch (err) {
      throw new Error(`Filter condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = kept.length > 0 ? 'true' : 'false';
  return kept;
};
