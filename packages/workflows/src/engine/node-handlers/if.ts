import vm from 'node:vm';
import type { NodeHandler } from './types';
import { resolveTemplate } from '../template';

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
      const sandbox = { $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input };
      branch = vm.runInNewContext(resolved, sandbox, { timeout: 1000 }) ? 'true' : 'false';
    } catch (err) {
      throw new Error(`Condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = branch;
  return input;
};
