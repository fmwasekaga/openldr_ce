import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';
import { evalExpression, COND_LIMITS } from '../js-isolate';

/**
 * Whole-input boolean: evaluates the condition, records the branch in ctx.branches[id],
 * and passes the input items through (the chosen outgoing handle carries them).
 * Edge routing is handled by the runner which reads ctx.branches[node.id].
 */
export const ifHandler: NodeHandler = async (node, ctx, input) => {
  const resolved = resolveTemplate((node.data.condition as string | undefined) ?? '', ctx, input);
  let branch: 'true' | 'false' = 'false';
  if (resolved.trim()) {
    try {
      const scope = { $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input };
      branch = (await evalExpression(resolved, scope, COND_LIMITS)) ? 'true' : 'false';
    } catch (err) {
      throw new Error(`Condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = branch;
  return input;
};
