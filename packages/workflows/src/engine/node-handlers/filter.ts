import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import type { WorkflowItem } from '../items';

/**
 * Filter node — per-item condition. Passing items are returned; pruned items are
 * dropped. ctx.branches[node.id] is set to 'true' if any items passed, 'false'
 * otherwise (runner uses this to prune the downstream 'true' handle when nothing passes).
 */
export const filterHandler: NodeHandler = async (node, ctx, input) => {
  const raw = (node.data.condition as string | undefined) ?? '';
  const passes = (item: WorkflowItem): boolean => {
    const resolved = resolveTemplate(raw, ctx, [item]);
    if (!resolved.trim()) return false;
    try {
      const sandbox = { $input: [item], $json: item.json, $items: [item.json], input: [item] };
      return Boolean(vm.runInNewContext(resolved, sandbox, { timeout: 1000 }));
    } catch (err) {
      throw new Error(`Filter condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const kept = input.filter(passes);
  ctx.branches[node.id] = kept.length > 0 ? 'true' : 'false';
  return kept;
};
